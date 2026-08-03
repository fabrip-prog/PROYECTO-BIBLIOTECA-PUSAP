import { historialReservas } from '../state.js';

let confirmacionCallback = null;
let reservaSeleccionadaParaDevolver = null;

// ==========================================
// MODAL DE CONFIRMACIÓN
// ==========================================

export function mostrarConfirmacion(mensaje, callback) {
    const modal = document.getElementById("modal-confirmacion");
    const texto = document.getElementById("modal-confirmacion-mensaje");
    if (!modal || !texto) return;

    texto.textContent = mensaje;
    confirmacionCallback = callback;
    modal.classList.remove("modal-oculto");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
}

export function cerrarConfirmacion() {
    const modal = document.getElementById("modal-confirmacion");
    if (modal) {
        modal.classList.add("modal-oculto");
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
    }
    confirmacionCallback = null;
}

export function ejecutarConfirmacion() {
    if (confirmacionCallback) {
        const callback = confirmacionCallback;
        confirmacionCallback = null;
        callback();
    }
    cerrarConfirmacion();
}

// ==========================================
// MODAL DE DEVOLUCIÓN DE RESERVAS
// ==========================================

export function abrirModalDevolucion(idReserva) {
    const reserva = historialReservas.find(item => String(item.idReserva) === String(idReserva));

    if (!reserva || String(reserva.estado).toLowerCase() === "devuelta") {
        return;
    }

    reservaSeleccionadaParaDevolver = reserva;
    const modal = document.getElementById("modal-devolucion");
    const info = document.getElementById("modal-reserva-info");
    const textarea = document.getElementById("observaciones-devolucion");

    if (!modal || !info || !textarea) return;

    info.textContent = `Reserva ${reserva.idReserva} para el libro ${reserva.idLibro} del usuario ${reserva.usuario}.`;
    textarea.value = reserva.observaciones || "";
    modal.classList.remove("modal-oculto");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    textarea.focus();
}

export function cerrarModalDevolucion() {
    const modal = document.getElementById("modal-devolucion");
    const textarea = document.getElementById("observaciones-devolucion");

    if (modal) {
        modal.classList.add("modal-oculto");
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
    }

    if (textarea) {
        textarea.value = "";
    }

    reservaSeleccionadaParaDevolver = null;
}

export function getReservaSeleccionadaParaDevolver() {
    return reservaSeleccionadaParaDevolver;
}
