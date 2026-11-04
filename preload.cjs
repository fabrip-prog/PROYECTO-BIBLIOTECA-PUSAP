// Puente entre la interfaz y el proceso principal. Es CommonJS (.cjs) porque el proyecto es ESM
// ("type": "module") y el preload en modo sandbox solo admite require().
// La interfaz no recibe Node ni ipcRenderer: únicamente estas dos funciones, con canales permitidos.
const { contextBridge, ipcRenderer } = require('electron');

const CANALES_INVOKE = new Set([
    'get-maestras', 'get-libros', 'get-reservas', 'get-estado-sync',
    'add-libro', 'update-libro', 'delete-libro',
    'add-reserva', 'devolver-reserva', 'limpiar-historial-devueltas',
    'sincronizar-ahora', 'exportar-csv-manual', 'abrir-csv', 'seleccionar-y-cargar-csv'
]);

const CANALES_EVENTO = new Set(['db-actualizada', 'sync-estado']);

contextBridge.exposeInMainWorld('biblioteca', {
    invoke(canal, ...args) {
        if (!CANALES_INVOKE.has(canal)) {
            return Promise.reject(new Error(`Canal IPC no permitido: ${canal}`));
        }
        return ipcRenderer.invoke(canal, ...args);
    },
    on(canal, callback) {
        if (!CANALES_EVENTO.has(canal)) {
            throw new Error(`Evento IPC no permitido: ${canal}`);
        }
        ipcRenderer.on(canal, (_evento, datos) => callback(datos));
    }
});
