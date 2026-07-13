import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conectar a la base de datos biblioteca.db en la raíz del proyecto
const dbPath = path.join(__dirname, 'biblioteca.db');
const csvPath = path.join(__dirname, 'Base_Datos_Libros_pusap.csv');

// Inicializar sql.js
const SQL = await initSqlJs();
let db;

if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
} else {
    db = new SQL.Database();
}

let isWritingCSV = false;

function saveToDisk() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    
    // Sincronizar automáticamente hacia el archivo CSV de Excel para mantenerlo actualizado
    exportarCSV(csvPath);
}

// Helpers para consultas
function dbQueryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function dbQueryGet(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
    }
    stmt.free();
    return result;
}

function resolveId(table, name) {
    if (!name) return null;
    const trimmedName = name.trim();
    const existing = dbQueryGet(`SELECT id FROM "${table}" WHERE LOWER(nombre) = LOWER(?)`, [trimmedName]);
    if (existing) return existing.id;
    db.run(`INSERT OR IGNORE INTO "${table}" (nombre) VALUES (?)`, [trimmedName]);
    const afterInsert = dbQueryGet(`SELECT id FROM "${table}" WHERE LOWER(nombre) = LOWER(?)`, [trimmedName]);
    return afterInsert ? afterInsert.id : null;
}

// Importar archivo CSV de forma síncrona para la inicialización
function importarCSVSync(filePath) {
    try {
        const content = fs.readFileSync(filePath, { encoding: 'latin1' });
        const lines = content.split(/\r?\n/);

        db.run("BEGIN TRANSACTION");
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

                // Si el libro ya existía, conservamos su stock disponible en base al total y reservas activas
                const libroExistente = dbQueryGet("SELECT cantidad, cantidad_disponible FROM libros WHERE codigo = ?", [codigo]);
                let cantidadDisponible = cantidad;

                if (libroExistente) {
                    const reservasActivas = libroExistente.cantidad - libroExistente.cantidad_disponible;
                    cantidadDisponible = Math.max(0, cantidad - reservasActivas);
                }

                const numeroCurso = parseInt(celdas[8]) || null;

                db.run(`
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
        db.run("COMMIT");
        console.log("Sincronización inicial desde archivo CSV de Excel finalizada.");
    } catch (err) {
        db.run("ROLLBACK");
        console.error("Error al inicializar catálogo desde CSV:", err);
    }
}

// Importar archivo CSV asincrónicamente con retransmisión a la UI
async function importarCSV(filePath) {
    if (!fs.existsSync(filePath)) return;
    console.log(`Leyendo e importando cambios del archivo CSV: ${filePath}`);
    
    const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
    const lector = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });

    const rowsToProcess = [];
    for await (const linea of lector) {
        const lineaLimpia = linea.trim();
        if (lineaLimpia === "" || 
            lineaLimpia.startsWith("Plantilla") || 
            /^;+$/.test(lineaLimpia) || 
            lineaLimpia.toLowerCase().includes("id / código") || 
            lineaLimpia.toLowerCase().includes("id_libro") ||
            lineaLimpia.toLowerCase().includes("título del libro")) {
            continue;
        }
        const celdas = lineaLimpia.split(';');
        rowsToProcess.push(celdas);
    }

    try {
        db.run("BEGIN TRANSACTION");

        for (const celdas of rowsToProcess) {
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

                db.run(`
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

        db.run("COMMIT");

        // Guardamos la base de datos sin disparar la exportación en bucle
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);

        console.log("¡Catálogo sincronizado exitosamente con SQLite!");

        // Avisar al frontend para actualizar la visualización
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('db-actualizada');
        }
    } catch (err) {
        db.run("ROLLBACK");
        console.error("Error al ejecutar la transacción de importación:", err);
        throw err;
    }
}

// Reintento de importación para evitar fallos si Excel tiene el archivo bloqueado temporalmente
async function importarCSVConReintento(filePath, intento = 1) {
    try {
        await importarCSV(filePath);
    } catch (err) {
        if (intento <= 3 && (err.code === 'EBUSY' || err.code === 'EPERM')) {
            console.log(`El archivo CSV está siendo guardado por Excel. Reintentando en 500ms (intento ${intento})...`);
            setTimeout(() => importarCSVConReintento(filePath, intento + 1), 500);
        } else {
            console.error("Error definitivo al importar el archivo CSV:", err);
        }
    }
}

// Exportar catálogo de SQLite a CSV con formato Excel en español (codificación Latin1 y separador ;)
function exportarCSV(filePath) {
    try {
        isWritingCSV = true;
        console.log(`Exportando catálogo a CSV compatible con Excel: ${filePath}`);
        
        const libros = dbQueryAll(`
            SELECT l.codigo, l.titulo, l.autor, e.nombre as editorial, a.nombre as asignatura, l.cantidad, l.cantidad_disponible, es.condicion as estado, l.numero_curso
            FROM libros l
            LEFT JOIN editoriales e ON l.id_editorial = e.id
            LEFT JOIN asignatura a ON l.id_asignatura = a.id
            LEFT JOIN estados es ON l.id_estado = es.id
        `);

        const lines = [
            "ID / Código;Título del Libro;Autor;Editorial;Asignatura;Cantidad;Cantidad_Disponible;Estado (Nuevo/Usado);Numero_Curso"
        ];

        libros.forEach(l => {
            const line = [
                l.codigo,
                l.titulo || '',
                l.autor || '',
                l.editorial || '',
                l.asignatura || '',
                l.cantidad,
                l.cantidad_disponible,
                l.estado || 'Nuevo',
                l.numero_curso || ''
            ].join(';');
            lines.push(line);
        });

        fs.writeFileSync(filePath, lines.join('\n'), { encoding: 'latin1' });
        console.log("¡CSV de Excel exportado exitosamente!");
    } catch (err) {
        console.error("Error al exportar a CSV:", err);
    } finally {
        // Pausamos brevemente antes de reactivar el watcher para evitar bucles infinitos de eventos de disco
        setTimeout(() => {
            isWritingCSV = false;
        }, 1000);
    }
}

// Inicializar estructura y datos base si no existen
function inicializarBBDD() {
    db.run(`
        CREATE TABLE IF NOT EXISTS "estados" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "condicion" TEXT NOT NULL UNIQUE
        );
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS "asignatura" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "nombre" TEXT NOT NULL UNIQUE
        );
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS "editoriales" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "nombre" TEXT NOT NULL UNIQUE
        );
    `);
    db.run(`
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
    db.run(`
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
    if (checkEstados.count === 0) {
        db.run("INSERT OR IGNORE INTO estados (id, condicion) VALUES (1, '1 usado/nuevo')");
    }

    // 2. Población de asignaturas si está vacío
    const checkAsignaturas = dbQueryGet("SELECT count(*) as count FROM asignatura");
    if (checkAsignaturas.count === 0) {
        const asignaturas = ['Historia/Economía', 'Derecho', 'Filosofía', 'Economia'];
        asignaturas.forEach(a => {
            db.run("INSERT OR IGNORE INTO asignatura (nombre) VALUES (?)", [a]);
        });
    }

    // 3. Población de editoriales si está vacío
    const checkEditoriales = dbQueryGet("SELECT count(*) as count FROM editoriales");
    if (checkEditoriales.count === 0) {
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
            db.run("INSERT OR IGNORE INTO editoriales (nombre) VALUES (?)", [e]);
        });
    }

    // 4. Población de libros si está vacío
    const checkLibros = dbQueryGet("SELECT count(*) as count FROM libros");
    if (checkLibros.count === 0) {
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
                db.run(`
                    INSERT OR REPLACE INTO libros (codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, id_asignatura)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [l.codigo, l.titulo, l.autor, l.id_editorial, l.cantidad, l.cantidad_disponible, l.id_estado, l.id_asignatura]);
            });
        }
    }

    saveToDisk();
}

inicializarBBDD();

// Vigilante de cambios en tiempo real del archivo CSV para el auto-sync bidireccional
let watchTimeout = null;
if (fs.existsSync(csvPath)) {
    console.log(`Iniciando vigilancia de cambios en el CSV: ${csvPath}`);
    fs.watch(csvPath, (eventType) => {
        if (eventType === 'change') {
            if (isWritingCSV) return; // Ignorar el trigger si la escritura se inició desde la aplicación
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(() => {
                console.log("Cambio detectado en el archivo CSV. Sincronizando...");
                importarCSVConReintento(csvPath);
            }, 500);
        }
    });
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });

    mainWindow.loadFile('index.html');
}

// ==========================================
// CANALES IPC DE ELECTRON PARA CONSULTAS SQL
// ==========================================

// 1. Obtener tablas maestras
ipcMain.handle('get-maestras', () => {
    try {
        const estados = dbQueryAll("SELECT * FROM estados");
        const asignatura = dbQueryAll("SELECT * FROM asignatura");
        const editoriales = dbQueryAll("SELECT * FROM editoriales");
        return { estados, asignatura, editoriales };
    } catch (err) {
        console.error("Error al obtener tablas maestras:", err);
        throw err;
    }
});

// 2. Obtener libros
ipcMain.handle('get-libros', () => {
    try {
        return dbQueryAll("SELECT * FROM libros");
    } catch (err) {
        console.error("Error al obtener libros:", err);
        throw err;
    }
});

// 3. Guardar o actualizar libro
ipcMain.handle('add-libro', (event, libro) => {
    try {

        const idEditorial = typeof libro.id_editorial === 'string' 
            ? resolveId('editoriales', libro.id_editorial) 
            : libro.id_editorial;

        const idAsignatura = typeof libro.id_asignatura === 'string'
            ? resolveId('asignatura', libro.id_asignatura)
            : libro.id_asignatura;

        const idEstado = 1; // 1 usado/nuevo por defecto

        db.run(`
            INSERT OR REPLACE INTO libros (
                codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, numero_curso, id_asignatura
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            libro.codigo,
            libro.titulo,
            libro.autor,
            idEditorial,
            libro.cantidad,
            libro.cantidad_disponible ?? libro.cantidad,
            idEstado,
            libro.numero_curso || null,
            idAsignatura
        ]);
        saveToDisk();
        return { success: true };
    } catch (err) {
        console.error("Error al guardar libro:", err);
        return { success: false, error: err.message };
    }
});

// 4. Eliminar un libro
ipcMain.handle('delete-libro', (event, codigo) => {
    try {
        db.run("DELETE FROM libros WHERE codigo = ?", [codigo]);
        saveToDisk();
        return { success: true };
    } catch (err) {
        console.error("Error al eliminar libro:", err);
        return { success: false, error: err.message };
    }
});

// 5. Obtener historial de reservas
ipcMain.handle('get-reservas', () => {
    try {
        const rows = dbQueryAll("SELECT * FROM reservas");
        return rows.map(r => ({
            idLibro: r.codigo_libro,
            idReserva: r.id_reserva,
            usuario: r.usuario,
            fecha: r.fecha_reserva,
            estado: r.estado,
            observaciones: r.observaciones,
            fechaDevolucion: r.fecha_devolucion
        }));
    } catch (err) {
        console.error("Error al obtener reservas:", err);
        throw err;
    }
});

// 6. Registrar una reserva y descontar stock (Transacción)
ipcMain.handle('add-reserva', (event, reserva) => {
    try {
        // Iniciar transacción manual en sql.js
        db.run("BEGIN TRANSACTION");

        // Verificar existencia y disponibilidad del libro
        const libro = dbQueryGet("SELECT cantidad_disponible, titulo FROM libros WHERE codigo = ?", [reserva.idLibro]);
        if (!libro) {
            throw new Error(`El código de libro [${reserva.idLibro}] no existe en el catálogo.`);
        }
        if (libro.cantidad_disponible <= 0) {
            throw new Error(`Stock Agotado: "${libro.titulo}" no posee unidades disponibles.`);
        }

        // Verificar duplicados de ID de Reserva
        const existeReserva = dbQueryGet("SELECT count(*) as count FROM reservas WHERE id_reserva = ?", [reserva.idReserva]);
        if (existeReserva.count > 0) {
            throw new Error(`Error: El ID de Reserva "${reserva.idReserva}" ya existe en el sistema.`);
        }

        // Insertar en la tabla reservas
        db.run(`
            INSERT INTO reservas (id_reserva, codigo_libro, usuario, fecha_reserva, estado, observaciones, fecha_devolucion)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            reserva.idReserva,
            reserva.idLibro,
            reserva.usuario,
            reserva.fecha,
            'Activa',
            '',
            ''
        ]);

        // Descontar una unidad disponible del libro
        db.run(`
            UPDATE libros 
            SET cantidad_disponible = cantidad_disponible - 1 
            WHERE codigo = ?
        `, [reserva.idLibro]);

        db.run("COMMIT");
        saveToDisk();

        return { success: true };
    } catch (err) {
        db.run("ROLLBACK");
        console.error("Error al registrar reserva:", err);
        return { success: false, error: err.message };
    }
});

// 7. Devolver reserva y restituir stock (Transacción)
ipcMain.handle('devolver-reserva', (event, { idReserva, observaciones, fechaDevolucion }) => {
    try {
        db.run("BEGIN TRANSACTION");

        // Obtener detalles de la reserva
        const resObj = dbQueryGet("SELECT codigo_libro, estado FROM reservas WHERE id_reserva = ?", [idReserva]);
        if (!resObj) {
            throw new Error(`No se encontró la reserva con ID ${idReserva}.`);
        }
        if (resObj.estado === 'Devuelta') {
            throw new Error(`La reserva con ID ${idReserva} ya fue devuelta.`);
        }

        // Registrar devolución en reservas
        db.run(`
            UPDATE reservas 
            SET estado = 'Devuelta', observaciones = ?, fecha_devolucion = ? 
            WHERE id_reserva = ?
        `, [observaciones, fechaDevolucion, idReserva]);

        // Incrementar una unidad disponible al libro
        db.run(`
            UPDATE libros 
            SET cantidad_disponible = cantidad_disponible + 1 
            WHERE codigo = ?
        `, [resObj.codigo_libro]);

        db.run("COMMIT");
        saveToDisk();

        return { success: true };
    } catch (err) {
        db.run("ROLLBACK");
        console.error("Error al procesar devolución de reserva:", err);
        return { success: false, error: err.message };
    }
});

// 8. Limpiar historial de reservas devueltas
ipcMain.handle('limpiar-historial-devueltas', () => {
    try {
        db.run("DELETE FROM reservas WHERE estado = 'Devuelta'");
        saveToDisk();
        return { success: true };
    } catch (err) {
        console.error("Error al limpiar historial de reservas devueltas:", err);
        return { success: false, error: err.message };
    }
});

// 9. Cargar CSV Manual o por Defecto
ipcMain.handle('cargar-csv-manual', async (event, filePath) => {
    try {
        const pathAImportar = filePath || csvPath;
        await importarCSV(pathAImportar);
        return { success: true };
    } catch (err) {
        console.error("Error en importar CSV manual:", err);
        return { success: false, error: err.message };
    }
});

// 10. Exportar CSV Manual
ipcMain.handle('exportar-csv-manual', () => {
    try {
        exportarCSV(csvPath);
        return { success: true };
    } catch (err) {
        console.error("Error en exportar CSV manual:", err);
        return { success: false, error: err.message };
    }
});

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});