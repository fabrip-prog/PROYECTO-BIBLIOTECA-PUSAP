import { BrowserWindow } from 'electron';
import path from 'path';
import { rutas } from './db.js';

let mainWindow = null;

/**
 * Crea e inicializa la ventana principal de Electron.
 * La interfaz corre aislada (sin Node): solo habla con el proceso principal a través de preload.cjs.
 */
export function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(rutas.root, 'icon.ico'),
        webPreferences: {
            preload: path.join(rutas.root, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // La app no navega ni abre ventanas nuevas: cualquier intento se bloquea
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', evento => evento.preventDefault());

    mainWindow.loadFile(path.join(rutas.root, 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });

    return mainWindow;
}

/**
 * Retorna la referencia a la ventana principal
 */
export function getMainWindow() {
    return mainWindow;
}
