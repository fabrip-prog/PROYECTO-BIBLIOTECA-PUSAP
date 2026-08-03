// Servicio seguro para comunicación IPC con el proceso Main de Electron

const rawIpc = window.require ? window.require('electron').ipcRenderer : null;

export const ipcService = {
    async invoke(channel, ...args) {
        if (rawIpc && typeof rawIpc.invoke === 'function') {
            return await rawIpc.invoke(channel, ...args);
        }
        console.warn(`IPC Mock: Invocado canal [${channel}] fuera del entorno de Electron`, args);
        if (channel === 'get-maestras') return { estados: [], asignatura: [], editoriales: [] };
        if (channel === 'get-libros') return [];
        if (channel === 'get-reservas') return [];
        return { success: true };
    },

    on(channel, callback) {
        if (rawIpc && typeof rawIpc.on === 'function') {
            rawIpc.on(channel, callback);
        } else {
            console.warn(`IPC Mock: Registrado listener para canal [${channel}]`);
        }
    },

    // Métodos tipados para consultas específicas
    getMaestras() {
        return this.invoke('get-maestras');
    },
    getLibros() {
        return this.invoke('get-libros');
    },
    addLibro(libro) {
        return this.invoke('add-libro', libro);
    },
    deleteLibro(codigo) {
        return this.invoke('delete-libro', codigo);
    },
    getReservas() {
        return this.invoke('get-reservas');
    },
    addReserva(reserva) {
        return this.invoke('add-reserva', reserva);
    },
    devolverReserva(data) {
        return this.invoke('devolver-reserva', data);
    },
    limpiarHistorialDevueltas() {
        return this.invoke('limpiar-historial-devueltas');
    },
    cargarCSVManual(filePath) {
        return this.invoke('cargar-csv-manual', filePath);
    },
    exportarCSVManual() {
        return this.invoke('exportar-csv-manual');
    },
    onDbActualizada(callback) {
        this.on('db-actualizada', callback);
    }
};
