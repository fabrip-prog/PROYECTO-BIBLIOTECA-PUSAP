import { BrowserWindow } from 'electron';
import path from 'path';
import { rootDir } from './db.js';

let mainWindow = null;

/**
 * Crea e inicializa la ventana principal de Electron
 */
export function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });

    const htmlPath = path.join(rootDir, 'index.html');
    mainWindow.loadFile(htmlPath);

    return mainWindow;
}

/**
 * Retorna la referencia a la ventana principal
 */
export function getMainWindow() {
    return mainWindow;
}
