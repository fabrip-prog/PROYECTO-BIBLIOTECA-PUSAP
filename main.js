import { app } from 'electron';
import { initDatabase } from './src/main/db.js';
import { iniciarVigilanteCSV } from './src/main/csvService.js';
import { createWindow, getMainWindow } from './src/main/windowManager.js';
import { registrarIpcHandlers } from './src/main/ipcHandlers.js';

// Inicializar base de datos SQLite y registrar handlers de comunicación IPC
await initDatabase();
registrarIpcHandlers();

// Vigilante de cambios en tiempo real del archivo CSV para el auto-sync bidireccional
iniciarVigilanteCSV(() => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('db-actualizada');
    }
});

// Ciclo de vida de la aplicación Electron
app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('Sistema.Biblioteca.PUSAP');
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});