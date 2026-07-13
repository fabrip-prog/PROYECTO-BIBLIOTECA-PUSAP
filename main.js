import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conectar a la base de datos biblioteca.db en la raíz del proyecto
const dbPath = path.join(__dirname, 'biblioteca.db');

// Inicializar sql.js
const SQL = await initSqlJs();
let db;

if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
} else {
    db = new SQL.Database();
}

function saveToDisk() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
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

    saveToDisk();
}

inicializarBBDD();

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
        const resolveId = (table, name) => {
            if (!name) return null;
            const existing = dbQueryGet(`SELECT id FROM "${table}" WHERE LOWER(nombre) = LOWER(?)`, [name.trim()]);
            if (existing) return existing.id;
            db.run(`INSERT INTO "${table}" (nombre) VALUES (?)`, [name.trim()]);
            saveToDisk();
            const last = dbQueryGet(`SELECT last_insert_rowid() as id`);
            return last ? last.id : null;
        };

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

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});