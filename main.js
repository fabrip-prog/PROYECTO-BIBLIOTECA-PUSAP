import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

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

// Respondedor limpio para evitar cuelgues en el canal
ipcMain.on('solicitar-libros-sql', (event) => {
    // Si no usamos base de datos física por bloqueo, devolvemos un array simulado de inmediato
    event.reply('respuesta-libros-sql', []);
});

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});