import { app, dialog } from 'electron';
import path from 'path';
import { configurarRutas, initDatabase, avisosArranque } from './src/main/db.js';
import { iniciarSincronizacion, detenerSincronizacion } from './src/main/csvService.js';
import { createWindow, getMainWindow } from './src/main/windowManager.js';
import { registrarIpcHandlers } from './src/main/ipcHandlers.js';

// Carpeta de la app y carpeta de datos (base y CSV). BIBLIOTECA_DATA_DIR permite apuntarla a otro lado,
// por ejemplo para probar sin tocar los datos reales.
const rootDir = app.getAppPath();
const userDir = process.env.BIBLIOTECA_DATA_DIR
    || (app.isPackaged ? path.dirname(process.execPath) : rootDir);
configurarRutas({ rootDir, userDir, empaquetado: app.isPackaged });

// Dos instancias abiertas tendrían cada una su copia de la base en memoria y se pisarían al guardar
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const ventana = getMainWindow();
        if (ventana) {
            if (ventana.isMinimized()) ventana.restore();
            ventana.focus();
        }
    });

    app.whenReady().then(async () => {
        if (process.platform === 'win32') {
            app.setAppUserModelId('Sistema.Biblioteca.PUSAP');
        }

        try {
            await initDatabase();
        } catch (err) {
            console.error('No se pudo iniciar la base de datos:', err);
            dialog.showErrorBox('Sistema de Biblioteca', `No se pudo abrir la base de datos.\n\n${err.message}`);
            app.quit();
            return;
        }

        registrarIpcHandlers();
        const ventana = createWindow();

        // Importa lo que se haya editado en Excel con la app cerrada y empieza a vigilar el CSV
        iniciarSincronizacion((canal, datos) => {
            const actual = getMainWindow();
            if (actual && !actual.isDestroyed()) actual.webContents.send(canal, datos);
        });

        for (const aviso of avisosArranque) {
            dialog.showMessageBox(ventana, { type: 'warning', title: 'Sistema de Biblioteca', message: aviso });
        }
    });

    // Último intento de enviar al CSV lo que haya quedado pendiente
    app.on('before-quit', () => {
        try { detenerSincronizacion({ vaciar: true }); } catch (err) { console.error(err); }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
