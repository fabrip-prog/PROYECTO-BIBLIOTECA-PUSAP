import { inventarioLibros, actualizarTablaInventario } from '../js/libros.js';

export const historialReservas = [];

document.addEventListener("DOMContentLoaded", () => {
    const btnConfirmar = document.getElementById("btn-confirmar-reserva");
    if (btnConfirmar) {
        btnConfirmar.addEventListener("click", registrarNuevaReserva);
    }

    // Al levantar el módulo, recuperamos reservas anteriores del LocalStorage si existen
    const guardadas = localStorage.getItem("historial_reservas");
    if (guardadas) {
        historialReservas.push(...JSON.parse(guardadas));
        actualizarTablaReservas();
    }
});

function registrarNuevaReserva() {
    const inputLibro = document.getElementById("id-libro-reserva");
    const inputReserva = document.getElementById("id-reserva");
    const inputUsuario = document.getElementById("usuario-lector");
    const inputFecha = document.getElementById("fecha-reserva");

    if (!inputLibro || !inputReserva || !inputUsuario || !inputFecha) return;

    const codigoBuscado = parseInt(inputLibro.value.trim());
    const idReserva = inputReserva.value.trim();
    const usuario = inputUsuario.value.trim();
    const fecha = inputFecha.value;

    // Validación de campos obligatorios
    if (!codigoBuscado || !idReserva || !usuario || !fecha) {
        alert("Por favor, complete todos los campos del formulario para realizar la reserva.");
        return;
    }

    // 1. BUSCAR EL LIBRO EN EL INVENTARIO COMPARTIDO
    const libroEncontrado = inventarioLibros.find(l => l.codigo === codigoBuscado);

    if (!libroEncontrado) {
        alert(`Error: El código de libro [${codigoBuscado}] no existe en el catálogo.`);
        return;
    }

    // 2. CONTROLAR DISPONIBILIDAD
    if (libroEncontrado.cantidad_disponible <= 0) {
        alert(`Stock Agotado: "${libroEncontrado.titulo}" no posee unidades disponibles.`);
        return;
    }

    // 3. DESCONTAR STOCK Y RE-RENDERIZAR CATÁLOGO SUPERIOR
    libroEncontrado.cantidad_disponible -= 1;
    localStorage.setItem("inventario_libros_sql", JSON.stringify(inventarioLibros));
    actualizarTablaInventario();

    // 4. GENERAR REGISTRO EN EL HISTORIAL INFERIOR
    const nuevaReserva = {
        idLibro: codigoBuscado,
        idReserva: idReserva,
        usuario: usuario,
        fecha: fecha,
        estado: "Activa"
    };

    historialReservas.push(nuevaReserva);
    localStorage.setItem("historial_reservas", JSON.stringify(historialReservas));
    actualizarTablaReservas();

    // Limpieza de los inputs para una nueva carga
    inputLibro.value = "";
    inputReserva.value = "";
    inputUsuario.value = "";
    inputFecha.value = "";

    alert("¡Reserva confirmada con éxito!");
}

export function actualizarTablaReservas() {
    const tbody = document.querySelector("#tabla-reservas tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (historialReservas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #a0aec0; padding: 15px;">No hay reservas registradas en el historial.</td></tr>`;
        return;
    }

    historialReservas.forEach(res => {
        const fila = document.createElement("tr");
        fila.innerHTML = `
            <td>${res.idLibro}</td>
            <td>${res.idReserva}</td>
            <td>${res.usuario}</td>
            <td>${res.fecha}</td>
            <td><span style="color: #319795; font-weight: bold;">${res.estado}</span></td>
        `;
        tbody.appendChild(fila);
    });
}