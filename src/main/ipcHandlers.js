import { ipcMain, dialog } from 'electron';
import { getDb, dbQueryAll, dbQueryGet, resolveId, saveToDisk, csvPath } from './db.js';
import { importarCSV, exportarCSV } from './csvService.js';
import { getMainWindow } from './windowManager.js';

/**
 * Registra todos los canales IPC de Electron para comunicación con el Renderer Process
 */
export function registrarIpcHandlers() {

    // Helper para guardar en disco incluyendo exportación a CSV
    const guardar = () => saveToDisk(exportarCSV);

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
            const db = getDb();
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
            guardar();
            return { success: true };
        } catch (err) {
            console.error("Error al guardar libro:", err);
            return { success: false, error: err.message };
        }
    });

    // 4. Eliminar un libro
    ipcMain.handle('delete-libro', (event, codigo) => {
        try {
            const db = getDb();
            db.run("DELETE FROM libros WHERE codigo = ?", [codigo]);
            guardar();
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
        const db = getDb();
        try {
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
            if (existeReserva && existeReserva.count > 0) {
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
            guardar();

            return { success: true };
        } catch (err) {
            db.run("ROLLBACK");
            console.error("Error al registrar reserva:", err);
            return { success: false, error: err.message };
        }
    });

    // 7. Devolver reserva y restituir stock (Transacción)
    ipcMain.handle('devolver-reserva', (event, { idReserva, observaciones, fechaDevolucion }) => {
        const db = getDb();
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
            guardar();

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
            const db = getDb();
            db.run("DELETE FROM reservas WHERE estado = 'Devuelta'");
            guardar();
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
            const mainWindow = getMainWindow();
            await importarCSV(pathAImportar, () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('db-actualizada');
                }
            });
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

    // 11. Seleccionar archivo CSV mediante cuadro de diálogo nativo de Windows
    ipcMain.handle('seleccionar-y-cargar-csv', async () => {
        try {
            const mainWindow = getMainWindow();
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Seleccionar inventario de libros (CSV de Excel)',
                filters: [
                    { name: 'Archivos CSV (*.csv)', extensions: ['csv'] },
                    { name: 'Todos los archivos', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }

            const filePath = result.filePaths[0];
            await importarCSV(filePath, () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('db-actualizada');
                }
            });
            return { success: true, filePath };
        } catch (err) {
            console.error("Error en seleccionar-y-cargar-csv:", err);
            return { success: false, error: err.message };
        }
    });
}
