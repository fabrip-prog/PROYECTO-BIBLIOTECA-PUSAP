import path from 'path';
import fs from 'fs';
import initSqlJs from 'sql.js';

// Este módulo no depende de Electron: las rutas se configuran desde main.js (y desde los tests).

export const rutas = { root: '', user: '', db: '', csv: '', respaldos: '' };

// Mensajes para mostrar al usuario si al arrancar hubo que recuperar o recrear la base
export const avisosArranque = [];

const NOMBRE_CSV = 'Base_Datos_Libros_pusap.csv';

/**
 * Define dónde viven la base y el CSV.
 * - rootDir: carpeta de la app (index.html, node_modules).
 * - userDir: carpeta de datos (junto al .exe en modo empaquetado, la raíz del proyecto en desarrollo).
 * Un archivo opcional `biblioteca.config.json` en userDir puede apuntar el CSV a otra ruta:
 *   { "csv": "D:\\Compartido\\Base_Datos_Libros_pusap.csv" }
 */
export function configurarRutas({ rootDir, userDir, empaquetado = false }) {
    rutas.root = rootDir;
    rutas.user = userDir;
    rutas.db = path.join(userDir, 'biblioteca.db');
    rutas.csv = path.join(userDir, NOMBRE_CSV);
    rutas.respaldos = path.join(userDir, 'respaldos');

    const archivoConfig = path.join(userDir, 'biblioteca.config.json');
    if (fs.existsSync(archivoConfig)) {
        try {
            const config = JSON.parse(fs.readFileSync(archivoConfig, 'utf-8'));
            if (typeof config.csv === 'string' && config.csv.trim()) {
                rutas.csv = path.resolve(userDir, config.csv.trim());
            }
        } catch (err) {
            avisosArranque.push(`No se pudo leer biblioteca.config.json (${err.message}). Se usa la ruta del CSV por defecto.`);
        }
    }

    // El .exe trae una copia inicial de los datos: se copia a la carpeta de datos la primera vez
    if (empaquetado) {
        const copiar = (nombre, destino) => {
            const origen = path.join(rootDir, nombre);
            if (!fs.existsSync(destino) && fs.existsSync(origen)) {
                try { fs.copyFileSync(origen, destino); } catch (err) { console.error(`Error copiando ${nombre} base:`, err); }
            }
        };
        copiar('biblioteca.db', rutas.db);
        copiar(NOMBRE_CSV, rutas.csv);
    }
}

// ---------------------------------------------------------------------------
// Esquema (misma definición que crear_y_cargarBBDD, con índices y tabla meta)
// ---------------------------------------------------------------------------
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS "estados" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "condicion" TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "asignatura" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "editoriales" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "libros" (
    "codigo" INTEGER PRIMARY KEY,
    "titulo" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "id_editorial" INTEGER,
    "cantidad" INTEGER DEFAULT 1,
    "cantidad_disponible" INTEGER DEFAULT 1,
    "id_estado" INTEGER,
    "numero_curso" INTEGER,
    "id_asignatura" INTEGER,
    FOREIGN KEY("id_asignatura") REFERENCES "asignatura"("id"),
    FOREIGN KEY("id_editorial") REFERENCES "editoriales"("id"),
    FOREIGN KEY("id_estado") REFERENCES "estados"("id"),
    CONSTRAINT chk_stock_positivo CHECK ("cantidad" >= 0),
    CONSTRAINT chk_disponible_positivo CHECK ("cantidad_disponible" >= 0),
    CONSTRAINT chk_consistencia_stock CHECK ("cantidad_disponible" <= "cantidad")
);
CREATE TABLE IF NOT EXISTS "reservas" (
    "id_reserva" TEXT PRIMARY KEY,
    "codigo_libro" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "fecha_reserva" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Activa',
    "observaciones" TEXT DEFAULT '',
    "fecha_devolucion" TEXT DEFAULT '',
    FOREIGN KEY("codigo_libro") REFERENCES "libros"("codigo")
);
CREATE TABLE IF NOT EXISTS "meta" (
    "clave" TEXT PRIMARY KEY,
    "valor" TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservas_libro ON reservas(codigo_libro, estado);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);
`;

// Tablas maestras: nombre de tabla -> columna de texto (lista cerrada para no interpolar SQL arbitrario)
const MAESTRAS = { editoriales: 'nombre', asignatura: 'nombre', estados: 'condicion' };

let SQL = null;
let db = null;
let profundidadTx = 0;

// ---------------------------------------------------------------------------
// Archivos: escritura atómica y respaldos
// ---------------------------------------------------------------------------

/**
 * Escribe en un temporal y lo renombra encima del destino, así un corte de luz o un cierre
 * a mitad de escritura nunca deja un archivo a medias. Lanza si el destino está bloqueado.
 */
export function escribirAtomico(destino, contenido) {
    const temporal = `${destino}.tmp`;
    const fd = fs.openSync(temporal, 'w');
    try {
        fs.writeSync(fd, contenido);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        fs.renameSync(temporal, destino);
    } catch (err) {
        try { fs.unlinkSync(temporal); } catch { /* ya no existe */ }
        throw err;
    }
}

function dormirSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exporta la base a bytes. sql.js reinicia los PRAGMA al exportar, por eso se reactivan las claves foráneas. */
function exportarBytes() {
    const bytes = Buffer.from(db.export());
    db.run('PRAGMA foreign_keys = ON');
    return bytes;
}

function respaldar(prefijo, sufijo, conservar, bytes) {
    try {
        fs.mkdirSync(rutas.respaldos, { recursive: true });
        const destino = path.join(rutas.respaldos, `${prefijo}-${sufijo}.db`);
        if (fs.existsSync(destino)) return;
        fs.writeFileSync(destino, bytes);
        const viejos = fs.readdirSync(rutas.respaldos)
            .filter(n => n.startsWith(`${prefijo}-`) && n.endsWith('.db'))
            .sort()
            .reverse()
            .slice(conservar);
        viejos.forEach(n => { try { fs.unlinkSync(path.join(rutas.respaldos, n)); } catch { /* en uso */ } });
    } catch (err) {
        console.warn('No se pudo crear el respaldo:', err.message);
    }
}

const dosDigitos = n => String(n).padStart(2, '0');
function fechaLocal(d = new Date()) {
    return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

/** Copia puntual de la base actual; se usa antes de operaciones que pueden borrar libros */
export function respaldarAntesDe(motivo) {
    if (!db) return;
    const d = new Date();
    const sello = `${fechaLocal(d)}_${dosDigitos(d.getHours())}${dosDigitos(d.getMinutes())}${dosDigitos(d.getSeconds())}`;
    respaldar(motivo, sello, 5, exportarBytes());
}

// ---------------------------------------------------------------------------
// Apertura y recuperación
// ---------------------------------------------------------------------------

function abrirArchivo(ruta) {
    const base = new SQL.Database(fs.readFileSync(ruta));
    const resultado = base.exec('PRAGMA quick_check');
    if (resultado[0]?.values[0][0] !== 'ok') {
        base.close();
        throw new Error('la verificación de integridad falló');
    }
    return base;
}

function abrirBase() {
    if (!fs.existsSync(rutas.db)) {
        db = new SQL.Database();
        return;
    }
    try {
        db = abrirArchivo(rutas.db);
        return;
    } catch (err) {
        console.error('La base de datos no se pudo abrir:', err);
    }

    // Base dañada: se aparta (no se borra) y se busca el respaldo más reciente que abra bien
    const apartada = `${rutas.db}.danada-${Date.now()}`;
    fs.renameSync(rutas.db, apartada);
    const candidatos = fs.existsSync(rutas.respaldos)
        ? fs.readdirSync(rutas.respaldos).filter(n => n.endsWith('.db')).sort().reverse()
        : [];
    for (const nombre of candidatos) {
        try {
            db = abrirArchivo(path.join(rutas.respaldos, nombre));
            avisosArranque.push(`La base de datos estaba dañada. Se restauró el respaldo "${nombre}". El archivo dañado se guardó como ${path.basename(apartada)}.`);
            return;
        } catch { /* probar el siguiente */ }
    }
    db = new SQL.Database();
    avisosArranque.push(`La base de datos estaba dañada y no había respaldos. Se creó una nueva y el catálogo se reconstruirá desde el CSV (las reservas anteriores quedaron en ${path.basename(apartada)}).`);
}

/**
 * Inicializa el motor sql.js y abre (o crea) la base de datos
 */
export async function initDatabase() {
    if (!SQL) {
        const wasmPath = path.join(rutas.root, 'node_modules/sql.js/dist/sql-wasm.wasm');
        SQL = await initSqlJs({
            locateFile: file => (file.endsWith('.wasm') && fs.existsSync(wasmPath) ? wasmPath : file)
        });
    }
    if (db) { try { db.close(); } catch { /* ya cerrada */ } }
    profundidadTx = 0;

    const existia = fs.existsSync(rutas.db);
    const avisosPrevios = avisosArranque.length;
    abrirBase();
    const recuperada = avisosArranque.length > avisosPrevios;
    db.run('PRAGMA foreign_keys = ON');
    inicializarBBDD();

    // Un respaldo por día, solo si la base abrió sin problemas (no se respalda algo recién recuperado)
    if (existia && !recuperada) {
        respaldar('diario', fechaLocal(), 7, exportarBytes());
    }
    guardarEnDisco();
    return db;
}

/**
 * Retorna la instancia de la base de datos actual
 */
export function getDb() {
    if (!db) {
        throw new Error('La base de datos aún no ha sido inicializada.');
    }
    return db;
}

/**
 * Guarda el estado actual de la base de datos a disco de forma atómica
 */
export function guardarEnDisco() {
    if (!db) return;
    if (profundidadTx > 0) throw new Error('No se puede guardar a disco dentro de una transacción.');
    const bytes = exportarBytes();
    let ultimoError = null;
    for (let intento = 0; intento < 4; intento++) {
        try {
            escribirAtomico(rutas.db, bytes);
            return;
        } catch (err) {
            ultimoError = err;
            // OneDrive o un antivirus pueden retener el archivo unos milisegundos
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) break;
            dormirSync(60 * (intento + 1));
        }
    }
    throw ultimoError;
}

/**
 * Ejecuta `fn` dentro de una transacción: todo o nada. Si ya hay una abierta, participa de ella.
 */
export function transaccion(fn) {
    const database = getDb();
    if (profundidadTx > 0) return fn();
    database.run('BEGIN');
    profundidadTx++;
    try {
        const resultado = fn();
        database.run('COMMIT');
        return resultado;
    } catch (err) {
        try { database.run('ROLLBACK'); } catch { /* sin transacción activa */ }
        throw err;
    } finally {
        profundidadTx--;
    }
}

/**
 * Ejecuta una consulta SQL y retorna todas las filas como objetos
 */
export function dbQueryAll(sql, params = []) {
    const stmt = getDb().prepare(sql);
    try {
        stmt.bind(params);
        const filas = [];
        while (stmt.step()) filas.push(stmt.getAsObject());
        return filas;
    } finally {
        stmt.free();
    }
}

/**
 * Ejecuta una consulta SQL y retorna el primer resultado como objeto
 */
export function dbQueryGet(sql, params = []) {
    const stmt = getDb().prepare(sql);
    try {
        stmt.bind(params);
        return stmt.step() ? stmt.getAsObject() : null;
    } finally {
        stmt.free();
    }
}

/**
 * Resuelve (o crea) el ID de un registro en una tabla maestra (editoriales, asignatura, estados)
 */
export function resolveId(tabla, valor) {
    const columna = MAESTRAS[tabla];
    if (!columna) throw new Error(`Tabla maestra desconocida: ${tabla}`);
    const nombre = String(valor ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) return null;

    const existente = dbQueryGet(`SELECT id FROM "${tabla}" WHERE LOWER("${columna}") = LOWER(?)`, [nombre]);
    if (existente) return existente.id;
    getDb().run(`INSERT INTO "${tabla}" ("${columna}") VALUES (?)`, [nombre]);
    return dbQueryGet('SELECT last_insert_rowid() AS id').id;
}

export function getMeta(clave) {
    const fila = dbQueryGet('SELECT valor FROM meta WHERE clave = ?', [clave]);
    return fila ? fila.valor : null;
}

/** Guarda un dato interno de sincronización. Se persiste en el próximo guardarEnDisco() */
export function setMeta(clave, valor) {
    getDb().run(
        'INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
        [clave, valor === null || valor === undefined ? null : String(valor)]
    );
}

/**
 * La disponibilidad no es un dato libre: es la cantidad menos las reservas sin devolver.
 * Recalcularla desde las reservas evita que el stock se desfase (por ediciones en Excel, cortes, etc.).
 */
export function recalcularDisponibilidad(codigo = null) {
    const filtro = codigo === null ? '' : ' WHERE codigo = ?';
    getDb().run(`
        UPDATE libros SET cantidad_disponible = MAX(0, MIN(cantidad, cantidad - (
            SELECT COUNT(*) FROM reservas r
            WHERE r.codigo_libro = libros.codigo AND r.estado <> 'Devuelta'
        )))${filtro}
    `, codigo === null ? [] : [codigo]);
}

/**
 * Crea la estructura si falta y deja la base consistente
 */
export function inicializarBBDD() {
    const database = getDb();
    database.exec(ESQUEMA);
    database.run("INSERT OR IGNORE INTO estados (condicion) VALUES ('Nuevo')");
    database.run("INSERT OR IGNORE INTO estados (condicion) VALUES ('Usado')");
    recalcularDisponibilidad();
}
