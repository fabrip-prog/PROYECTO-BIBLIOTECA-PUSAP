import { historialReservas } from '../state.js';
import { ipcService } from '../services/ipcService.js';
import { mostrarNotificacion } from '../ui/notificaciones.js';
import { mostrarConfirmacion, abrirModalDevolucion, cerrarModalDevolucion, getReservaSeleccionadaParaDevolver } from '../ui/modales.js';
import { escaparHTML } from '../utils.js';

/** "12 · Título del libro": el código solo no dice a quién se le prestó qué */
function celdaLibro(res) {
    const titulo = res.tituloLibro ? ` <span class="titulo-libro-reserva">${escaparHTML(res.tituloLibro)}</span>` : "";
    return `${escaparHTML(res.idLibro)}${titulo}`;
}

/**
 * Renderiza las tablas de reservas activas y reservas devueltas
 */
export function actualizarTablaReservas() {
    const tbody = document.querySelector("#tabla-reservas tbody");
    const tbodyDevueltas = document.querySelector("#tabla-reservas-devueltas tbody");
    if (!tbody || !tbodyDevueltas) return;

    const inputBuscadorReservas = document.getElementById("buscador-reservas");
    const filtroReservas = inputBuscadorReservas ? inputBuscadorReservas.value.trim().toLowerCase() : "";

    const inputBuscadorHistorial = document.getElementById("buscador-historial");
    const filtroHistorial = inputBuscadorHistorial ? inputBuscadorHistorial.value.trim().toLowerCase() : "";

    const reservasActivas = historialReservas.filter(res => {
        const esActiva = String(res.estado).toLowerCase() !== "devuelta";
        if (!esActiva) return false;
        if (!filtroReservas) return true;
        const usuarioStr = String(res.usuario || '').toLowerCase();
        return usuarioStr.includes(filtroReservas);
    });

    const reservasDevueltas = historialReservas.filter(res => {
        const esDevuelta = String(res.estado).toLowerCase() === "devuelta";
        if (!esDevuelta) return false;
        if (!filtroHistorial) return true;
        const usuarioStr = String(res.usuario || '').toLowerCase();
        return usuarioStr.includes(filtroHistorial);
    });

    tbody.innerHTML = "";
    if (reservasActivas.length === 0) {
        const mensaje = filtroReservas
            ? `No se encontraron reservas activas para el usuario "${filtroReservas}".`
            : "No hay reservas activas en este momento.";
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #a0aec0; padding: 15px;">${escaparHTML(mensaje)}</td></tr>`;
    } else {
        reservasActivas.forEach(res => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td>${celdaLibro(res)}</td>
                <td>${escaparHTML(res.idReserva)}</td>
                <td>${escaparHTML(res.usuario)}</td>
                <td>${escaparHTML(res.fecha)}</td>
                <td><span style="color: #319795; font-weight: bold;">${escaparHTML(res.estado)}</span></td>
                <td><button type="button" class="btn" data-accion="devolver-reserva" data-id-reserva="${escaparHTML(res.idReserva)}">Devolver</button></td>
            `;
            tbody.appendChild(fila);
        });
    }

    tbodyDevueltas.innerHTML = "";
    if (reservasDevueltas.length === 0) {
        const mensajeDevueltas = filtroHistorial
            ? `No se encontraron devoluciones en el historial para el usuario "${filtroHistorial}".`
            : "No hay reservas devueltas aún.";
        tbodyDevueltas.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #a0aec0; padding: 15px;">${escaparHTML(mensajeDevueltas)}</td></tr>`;
    } else {
        reservasDevueltas.forEach(res => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td>${celdaLibro(res)}</td>
                <td>${escaparHTML(res.idReserva)}</td>
                <td>${escaparHTML(res.usuario)}</td>
                <td>${escaparHTML(res.fecha)}</td>
                <td>${escaparHTML(res.fechaDevolucion || "-")}</td>
                <td>${escaparHTML(res.observaciones || "Sin observaciones")}</td>
            `;
            tbodyDevueltas.appendChild(fila);
        });
    }

    tbody.querySelectorAll('button[data-accion="devolver-reserva"]').forEach(boton => {
        boton.addEventListener('click', () => abrirModalDevolucion(boton.dataset.idReserva));
    });
}

/**
 * Registra una nueva reserva en la base de datos
 */
export async function registrarNuevaReserva(reloadCallback) {
    const inputLibro = document.getElementById("id-libro-reserva");
    const inputReserva = document.getElementById("id-reserva");
    const inputUsuario = document.getElementById("usuario-lector");
    const inputFecha = document.getElementById("fecha-reserva");

    if (!inputLibro || !inputReserva || !inputUsuario || !inputFecha) {
        mostrarNotificacion("Error de interfaz: Faltan elementos en el formulario HTML.", "error");
        return;
    }

    const codigoBuscado = inputLibro.value.trim();
    const idReserva = inputReserva.value.trim();
    const usuario = inputUsuario.value.trim();
    const fecha = inputFecha.value;

    if (!codigoBuscado || !idReserva || !usuario || !fecha) {
        mostrarNotificacion("Por favor, complete todos los campos del formulario antes de confirmar.", "error");
        return;
    }

    const nuevaReserva = {
        idLibro: codigoBuscado,
        idReserva: idReserva,
        usuario: usuario,
        fecha: fecha
    };

    const res = await ipcService.addReserva(nuevaReserva);
    if (res.success) {
        if (typeof reloadCallback === 'function') {
            await reloadCallback();
        }

        inputLibro.value = "";
        inputReserva.value = "";
        inputUsuario.value = "";
        inputFecha.value = "";

        mostrarNotificacion("¡Reserva confirmada con éxito!", "success");
    } else {
        mostrarNotificacion(res.error, "error", 5000);
    }
}

/**
 * Confirma la devolución de un libro prestado
 */
export async function confirmarDevolucionReserva(reloadCallback) {
    const reserva = getReservaSeleccionadaParaDevolver();
    if (!reserva) return;

    const textarea = document.getElementById("observaciones-devolucion");
    const observaciones = textarea ? textarea.value.trim() : "";

    // La fecha de devolución la fija el proceso principal con la hora local (toISOString usa UTC
    // y, por la noche en Argentina, devolvería el día siguiente)
    const res = await ipcService.devolverReserva({
        idReserva: reserva.idReserva,
        observaciones: observaciones || "Sin observaciones"
    });

    if (res.success) {
        if (typeof reloadCallback === 'function') {
            await reloadCallback();
        }
        cerrarModalDevolucion();
        mostrarNotificacion("Reserva marcada como devuelta y stock reincorporado correctamente.", "success");
    } else {
        mostrarNotificacion("Error al procesar la devolución: " + res.error, "error");
    }
}

/**
 * Limpia el historial de reservas que ya fueron devueltas
 */
export async function limpiarHistorialReservasDevueltas(reloadCallback) {
    const devueltas = historialReservas.filter(res => String(res.estado).toLowerCase() === "devuelta");
    if (devueltas.length === 0) {
        mostrarNotificacion("No hay reservas devueltas en el historial para limpiar.", "info");
        return;
    }

    mostrarConfirmacion("¿Deseas limpiar todo el historial de reservas devueltas en SQLite?", async () => {
        const res = await ipcService.limpiarHistorialDevueltas();
        if (res.success) {
            if (typeof reloadCallback === 'function') {
                await reloadCallback();
            }
            mostrarNotificacion("Historial de devoluciones limpiado correctamente.", "success");
        } else {
            mostrarNotificacion("Error al limpiar el historial: " + res.error, "error");
        }
    });
}
