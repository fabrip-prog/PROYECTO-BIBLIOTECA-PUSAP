import { ipcMain, dialog, shell } from 'electron';
import { rutas } from './db.js';
import {
    listarMaestras, listarLibros, listarReservas,
    crearLibro, actualizarLibro, eliminarLibro,
    crearReserva, devolverReserva, limpiarHistorialDevueltas
} from './catalogo.js';
import {
    registrarCambio, exportarAhora, sincronizarAhora, importarArchivo, getEstadoSync
} from './csvService.js';
import { getMainWindow } from './windowManager.js';

/** Lecturas: si fallan, el error llega al renderer como excepción */
function consulta(canal, fn) {
    ipcMain.handle(canal, () => {
        try {
            return fn();
        } catch (err) {
            console.error(`Error en ${canal}:`, err);
            throw err;
        }
    });
}

/** Acciones: siempre responden { success, ... } para que la interfaz muestre el motivo */
function accion(canal, fn) {
    ipcMain.handle(canal, async (_evento, ...args) => {
        try {
            return { success: true, ...(await fn(...args)) };
        } catch (err) {
            console.error(`Error en ${canal}:`, err);
            return { success: false, error: err.message };
        }
    });
}

/** Acción que modifica la base: al terminar se persiste y se encola el envío al CSV */
function modificacion(canal, fn) {
    accion(canal, async (...args) => {
        const resultado = (await fn(...args)) ?? {};
        registrarCambio();
        return resultado;
    });
}

/**
 * Registra todos los canales IPC de Electron para comunicación con el Renderer Process
 */
export function registrarIpcHandlers() {
    consulta('get-maestras', listarMaestras);
    consulta('get-libros', listarLibros);
    consulta('get-reservas', listarReservas);
    consulta('get-estado-sync', getEstadoSync);

    modificacion('add-libro', libro => { crearLibro(libro); });
    modificacion('update-libro', libro => { actualizarLibro(libro); });
    modificacion('delete-libro', codigo => { eliminarLibro(codigo); });

    modificacion('add-reserva', reserva => { crearReserva(reserva); });
    modificacion('devolver-reserva', datos => { devolverReserva(datos); });
    modificacion('limpiar-historial-devueltas', () => ({ eliminadas: limpiarHistorialDevueltas() }));

    // Sincronización con Excel
    accion('sincronizar-ahora', async () => {
        const r = await sincronizarAhora();
        return { mensaje: r.mensaje, resumen: r.resumen };
    });

    accion('exportar-csv-manual', () => {
        const r = exportarAhora();
        if (!r.success) throw new Error(r.error);
        return { archivo: rutas.csv };
    });

    accion('abrir-csv', async () => {
        const r = exportarAhora(); // se abre siempre una versión al día
        if (!r.success && !r.bloqueado) throw new Error(r.error);
        const error = await shell.openPath(rutas.csv);
        if (error) throw new Error(error);
        return {};
    });

    accion('seleccionar-y-cargar-csv', async () => {
        const ventana = getMainWindow();
        const seleccion = await dialog.showOpenDialog(ventana, {
            title: 'Seleccionar inventario de libros (CSV de Excel)',
            filters: [
                { name: 'Archivos CSV (*.csv)', extensions: ['csv'] },
                { name: 'Todos los archivos', extensions: ['*'] }
            ],
            properties: ['openFile']
        });
        if (seleccion.canceled || !seleccion.filePaths?.length) return { canceled: true };

        const r = await importarArchivo(seleccion.filePaths[0]);
        return { filePath: seleccion.filePaths[0], mensaje: r.mensaje, resumen: r.resumen };
    });
}
