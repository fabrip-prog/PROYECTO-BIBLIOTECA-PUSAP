const controladorReservas = {
    reservas: [],

    agregarReserva(){
        const nuevaReserva = new Reserva(
            document.getElementById('usuario').value,
            document.getElementById('libro').value
        );
        this.reservas.push(nuevaReserva);
        vistaMostrarReservas.renderizar(this.reservas);
        this.guardarReservasEnStorage();
    },

    completar(id){
        const reserva = this.reservas.find(r => r.id === id);
        if (reserva) reserva.completada = !reserva.completada;
        vistaMostrarReservas.renderizar(this.reservas);
        this.guardarReservasEnStorage();
    },

    eliminar(id){
        this.reservas = this.reservas.filter(r => r.id !== id);
        vistaMostrarReservas.renderizar(this.reservas);
    },

    guardarReservasEnStorage(){
        localStorage.setItem('reservaciones', JSON.stringify(this.reservas));
    },

    cargarReservasDesdeStorage(){
        const reservasGuardadas = localStorage.getItem('reservaciones');
        if (reservasGuardadas) {
            this.reservas = this.recuperarReservasdeStorage(reservasGuardadas);
        }
        vistaMostrarReservas.renderizar(this.reservas);

        this.reservas.forEach(reserva => {
            console.log(reserva instanceof Reserva);
        });
    },

    recuperarReservasdeStorage(reservasGuardadas){
        try {
            return JSON.parse(reservasGuardadas);
        } catch (error) {
            console.error('Error al recuperar reservas:', error);
            return [];
        }
    }
};

controladorReservas.cargarReservasDesdeStorage();