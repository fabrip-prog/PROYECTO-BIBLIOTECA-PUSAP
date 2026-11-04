// Servicio de comunicación con el proceso Main de Electron.
// window.biblioteca lo define preload.cjs (la interfaz no tiene acceso directo a Node ni a ipcRenderer).

const puente = window.biblioteca || null;

export const ipcService = {
    async invoke(channel, ...args) {
        if (puente) {
            return await puente.invoke(channel, ...args);
        }
        console.warn(`IPC Mock: Invocado canal [${channel}] fuera del entorno de Electron`, args);
        if (channel === 'get-maestras') return { estados: [], asignatura: [], editoriales: [] };
        if (channel === 'get-libros') return [];
        if (channel === 'get-reservas') return [];
        if (channel === 'get-estado-sync') return null;
        return { success: true };
    },

    on(channel, callback) {
        if (puente) {
            puente.on(channel, callback);
        } else {
            console.warn(`IPC Mock: Registrado listener para canal [${channel}]`);
        }
    },

    // Consultas
    getMaestras() {
        return this.invoke('get-maestras');
    },
    getLibros() {
        return this.invoke('get-libros');
    },
    getReservas() {
        return this.invoke('get-reservas');
    },
    getEstadoSync() {
        return this.invoke('get-estado-sync');
    },

    // Libros
    addLibro(libro) {
        return this.invoke('add-libro', libro);
    },
    updateLibro(libro) {
        return this.invoke('update-libro', libro);
    },
    deleteLibro(codigo) {
        return this.invoke('delete-libro', codigo);
    },

    // Reservas
    addReserva(reserva) {
        return this.invoke('add-reserva', reserva);
    },
    devolverReserva(data) {
        return this.invoke('devolver-reserva', data);
    },
    limpiarHistorialDevueltas() {
        return this.invoke('limpiar-historial-devueltas');
    },

    // Sincronización con Excel (CSV)
    sincronizarAhora() {
        return this.invoke('sincronizar-ahora');
    },
    seleccionarYCargarCSV() {
        return this.invoke('seleccionar-y-cargar-csv');
    },
    exportarCSVManual() {
        return this.invoke('exportar-csv-manual');
    },
    abrirCSV() {
        return this.invoke('abrir-csv');
    },

    // Eventos que envía el proceso principal
    onDbActualizada(callback) {
        this.on('db-actualizada', callback);
    },
    onSyncEstado(callback) {
        this.on('sync-estado', callback);
    }
};
