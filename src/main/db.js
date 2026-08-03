import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directorio raíz del proyecto (subir 2 niveles desde src/main)
export const rootDir = path.resolve(__dirname, '../../');
export const dbPath = path.join(rootDir, 'biblioteca.db');
export const csvPath = path.join(rootDir, 'Base_Datos_Libros_pusap.csv');

let SQL = null;
let db = null;

/**
 * Inicializa el motor sql.js y la conexión a la base de datos
 */
export async function initDatabase() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    if (fs.existsSync(dbPath)) {
        const filebuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(filebuffer);
    } else {
        db = new SQL.Database();
    }
    
    // Inicializar tablas y datos base si no existen
    inicializarBBDD();
    return db;
}

/**
 * Retorna la instancia de la base de datos actual
 */
export function getDb() {
    if (!db) {
        throw new Error("La base de datos aún no ha sido inicializada.");
    }
    return db;
}

/**
 * Guarda el estado actual de la base de datos a disco y sincroniza el CSV
 */
export function saveToDisk(exportarCSVFn) {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    
    if (typeof exportarCSVFn === 'function') {
        exportarCSVFn(csvPath);
    }
}

/**
 * Ejecuta una consulta SQL y retorna todas las filas como objetos
 */
export function dbQueryAll(sql, params = []) {
    const database = getDb();
    const stmt = database.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Ejecuta una consulta SQL y retorna el primer resultado como objeto
 */
export function dbQueryGet(sql, params = []) {
    const database = getDb();
    const stmt = database.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
    }
    stmt.free();
    return result;
}

/**
 * Resuelve o crea el ID de un registro en una tabla maestra (ej: editoriales, asignatura)
 */
export function resolveId(table, name) {
    if (!name) return null;
    const trimmedName = name.trim();
    const database = getDb();
    const existing = dbQueryGet(`SELECT id FROM "${table}" WHERE LOWER(nombre) = LOWER(?)`, [trimmedName]);
    if (existing) return existing.id;
    database.run(`INSERT OR IGNORE INTO "${table}" (nombre) VALUES (?)`, [trimmedName]);
    const afterInsert = dbQueryGet(`SELECT id FROM "${table}" WHERE LOWER(nombre) = LOWER(?)`, [trimmedName]);
    return afterInsert ? afterInsert.id : null;
}

/**
 * Crea la estructura inicial de tablas y puebla datos por defecto si la BD está vacía
 */
export function inicializarBBDD() {
    const database = getDb();
    
    database.run(`
        CREATE TABLE IF NOT EXISTS "estados" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "condicion" TEXT NOT NULL UNIQUE
        );
    `);
    database.run(`
        CREATE TABLE IF NOT EXISTS "asignatura" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "nombre" TEXT NOT NULL UNIQUE
        );
    `);
    database.run(`
        CREATE TABLE IF NOT EXISTS "editoriales" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "nombre" TEXT NOT NULL UNIQUE
        );
    `);
    database.run(`
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
            FOREIGN KEY("id_estado") REFERENCES "estados"("id")
        );
    `);
    database.run(`
        CREATE TABLE IF NOT EXISTS "reservas" (
            "id_reserva" TEXT PRIMARY KEY,
            "codigo_libro" TEXT NOT NULL,
            "usuario" TEXT NOT NULL,
            "fecha_reserva" TEXT NOT NULL,
            "estado" TEXT NOT NULL DEFAULT 'Activa',
            "observaciones" TEXT DEFAULT '',
            "fecha_devolucion" TEXT DEFAULT '',
            FOREIGN KEY("codigo_libro") REFERENCES "libros"("codigo")
        );
    `);

    // 1. Población de estados si está vacío
    const checkEstados = dbQueryGet("SELECT count(*) as count FROM estados");
    if (checkEstados && checkEstados.count === 0) {
        database.run("INSERT OR IGNORE INTO estados (id, condicion) VALUES (1, '1 usado/nuevo')");
    }

    // 2. Población de asignaturas si está vacío
    const checkAsignaturas = dbQueryGet("SELECT count(*) as count FROM asignatura");
    if (checkAsignaturas && checkAsignaturas.count === 0) {
        const asignaturas = ['Historia/Economía', 'Derecho', 'Filosofía', 'Economia'];
        asignaturas.forEach(a => {
            database.run("INSERT OR IGNORE INTO asignatura (nombre) VALUES (?)", [a]);
        });
    }

    // 3. Población de editoriales si está vacío
    const checkEditoriales = dbQueryGet("SELECT count(*) as count FROM editoriales");
    if (checkEditoriales && checkEditoriales.count === 0) {
        const editoriales = [
            'Siglo Veintiuno de Argentina Editores (en coedición con el Instituto Di Tella)',
            'Marcos Lerner Editora Cordoba',
            'LexisNexis Abeledo-Perrot',
            'LexisNexis',
            'Virtudes Editorial Universitaria',
            'Astrea',
            'Ariel Sociedad Económica.',
            'Fondo de Cultura Económica'
        ];
        editoriales.forEach(e => {
            database.run("INSERT OR IGNORE INTO editoriales (nombre) VALUES (?)", [e]);
        });
    }

    // 4. Población de libros si está vacío
    const checkLibros = dbQueryGet("SELECT count(*) as count FROM libros");
    if (checkLibros && checkLibros.count === 0) {
        if (fs.existsSync(csvPath)) {
            console.log("Inicializando base de datos desde el archivo CSV existente...");
            importarCSVSync(csvPath);
        } else {
            console.log("No se encontró CSV de inventario. Inyectando catálogo base...");
            const librosSeguros = [
                { codigo: 1, titulo: 'Historia Socioeconómica de la Argentina. 1776-1860.', autor: 'Jonathan Brown', id_editorial: 1, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 1 },
                { codigo: 2, titulo: 'Manual de Derecho Penal- Parte Especial (Segunda Edición)', autor: 'Ricardo C. Nuñez - Victor F. Reinaldi', id_editorial: 2, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
                { codigo: 3, titulo: 'Código Procesal Penal de la Nación. Anotado. Comentado. Concordado. TOMO II', autor: 'Francisco J. D\'Albora - Nicolás F. D\'Albora', id_editorial: 3, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
                { codigo: 4, titulo: 'Tratado de los Cheques', autor: 'Osvaldo R. Gómez Leo', id_editorial: 4, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
                { codigo: 5, titulo: 'Curso de Filosofia', autor: 'Carlos Escobar Saravia', id_editorial: 5, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 3 },
                { codigo: 6, titulo: 'Títulos de Crédito', autor: 'Ignacio A. Escuti', id_editorial: 6, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
                { codigo: 7, titulo: 'El Ciclo de la llusión y el Desencanto', autor: 'Pablo Gerchunoff - Lucas Llach', id_editorial: 7, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 4 },
                { codigo: 8, titulo: 'Teoría Microeconómica', autor: 'John P. Gould-Edward P. Lazear', id_editorial: 8, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 4 }
            ];

            librosSeguros.forEach(l => {
                database.run(`
                    INSERT OR REPLACE INTO libros (codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, id_asignatura)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [l.codigo, l.titulo, l.autor, l.id_editorial, l.cantidad, l.cantidad_disponible, l.id_estado, l.id_asignatura]);
            });
        }
    }
}

/**
 * Importación síncrona inicial para inicializar la BD si no existían datos
 */
function importarCSVSync(filePath) {
    try {
        const content = fs.readFileSync(filePath, { encoding: 'latin1' });
        const lines = content.split(/\r?\n/);
        const database = getDb();

        database.run("BEGIN TRANSACTION");
        for (const line of lines) {
            const lineaLimpia = line.trim();
            if (lineaLimpia === "" || 
                lineaLimpia.startsWith("Plantilla") || 
                /^;+$/.test(lineaLimpia) || 
                lineaLimpia.toLowerCase().includes("id / código") || 
                lineaLimpia.toLowerCase().includes("id_libro") ||
                lineaLimpia.toLowerCase().includes("título del libro")) {
                continue;
            }
            const celdas = lineaLimpia.split(';');
            if (celdas.length >= 6) {
                const codigo = parseInt(celdas[0]);
                if (Number.isNaN(codigo)) continue;

                const titulo = celdas[1]?.trim();
                if (!titulo) continue;

                const autor = celdas[2]?.trim() || 'Anónimo';
                const nombreEditorial = celdas[3]?.trim();
                const nombreAsignatura = celdas[4]?.trim();
                const cantidad = parseInt(celdas[5]) || 0;
                
                const idEditorial = resolveId('editoriales', nombreEditorial);
                const idAsignatura = resolveId('asignatura', nombreAsignatura);
                const idEstado = 1;

                const libroExistente = dbQueryGet("SELECT cantidad, cantidad_disponible FROM libros WHERE codigo = ?", [codigo]);
                let cantidadDisponible = cantidad;

                if (libroExistente) {
                    const reservasActivas = libroExistente.cantidad - libroExistente.cantidad_disponible;
                    cantidadDisponible = Math.max(0, cantidad - reservasActivas);
                }

                const numeroCurso = parseInt(celdas[8]) || null;

                database.run(`
                    INSERT OR REPLACE INTO libros (
                        codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, numero_curso, id_asignatura
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    codigo,
                    titulo,
                    autor,
                    idEditorial,
                    cantidad,
                    cantidadDisponible,
                    idEstado,
                    numeroCurso,
                    idAsignatura
                ]);
            }
        }
        database.run("COMMIT");
        console.log("Sincronización inicial desde archivo CSV de Excel finalizada.");
    } catch (err) {
        if (db) db.run("ROLLBACK");
        console.error("Error al inicializar catálogo desde CSV:", err);
    }
}
