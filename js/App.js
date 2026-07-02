import { inventarioLibros, actualizarTablaInventario } from './libros.js';

// Arreglo en memoria para las reservas
const historialReservas = [];

document.addEventListener("DOMContentLoaded", () => {
    console.log("Inicializando el Sistema de Gestión unificado...");

    // 1. CONTROL Y CARGA DEL INVENTARIO DE LIBROS
    const datosLocales = localStorage.getItem("inventario_libros_sql");
    if (datosLocales) {
        const parsed = JSON.parse(datosLocales);
        if (parsed && parsed.length > 0) {
            inventarioLibros.length = 0;
            inventarioLibros.push(...parsed);
            actualizarTablaInventario();
        } else {
            cargarDatosDesdeSQL();
        }
    } else {
        cargarDatosDesdeSQL();
    }

    // 2. RECUPERAR HISTORIAL DE RESERVAS PREVIAS
    const guardadas = localStorage.getItem("historial_reservas");
    if (guardadas) {
        historialReservas.push(...JSON.parse(guardadas));
        actualizarTablaReservas();
    }

    // 3. ASIGNAR EL ESCUCHADOR DIRECTO AL BOTÓN DE RESERVAS
    const btnConfirmar = document.getElementById("btn-confirmar-reserva");
    if (btnConfirmar) {
        console.log("Botón de confirmación de reserva detectado y vinculado con éxito.");
        btnConfirmar.addEventListener("click", registrarNuevaReserva);
    } else {
        console.error("Error crítico: No se encontró el botón con ID 'btn-confirmar-reserva' en el HTML.");
    }
});

// Función encargada de inyectar el catálogo inicial de 8 libros relacionales
function cargarDatosDesdeSQL() {
    console.log("Inyectando catálogo relacional de contingencia...");
    inventarioLibros.length = 0; 
    
    const librosSeguros = [
        { codigo: 1, titulo: 'Historia Socioeconómica de la Argentina. 1776-1860.', autor: 'Jonathan Brown', id_editorial: 1, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 1 },
        { codigo: 2, titulo: 'Manual de Derecho Penal- Parte Especial (Segunda Edición)', autor: 'Ricardo C. Nuñez - Victor F. Reinaldi', id_editorial: 2, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
        { codigo: 3, titulo: 'Código Procesal Penal de la Nación. Anotado. Comentado. Concordado. TOMO II', autor: 'Francisco J. D\'Albora - Nicolás F. D\'Albora', id_editorial: 3, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
        { codigo: 4, titulo: 'Tratado de los Cheques', autor: 'Osvaldo R. Gómez Leo', id_editorial: 4, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
        { codigo: 5, titulo: 'Curso de Filosofia', autor: 'Carlos Escobar Saravia', id_editorial: 5, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 3 },
        { codigo: 6, titulo: 'Títulos de Crédito', autor: 'Ignacio A. Escuti', id_editorial: 6, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 2 },
        { codigo: 7, titulo: 'El Ciclo de la llusión y el Desencanto', autor: 'Pablo Gerchunoff - Lucas Llach', id_editorial: 7, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 4 },
        { codigo: 8, titulo: 'Teoría Microeconómica', autor: 'John P. Gould-Edward P. Lazear', id_editorial: 8, cantidad: 1, cantidad_disponible: 1, id_estado: 1, id_asignatura: 4 }
    ];

    librosSeguros.forEach(libro => inventarioLibros.push(libro));
    localStorage.setItem("inventario_libros_sql", JSON.stringify(inventarioLibros));
    actualizarTablaInventario();
}

// LÓGICA DE REGISTRO DE RESERVA
function registrarNuevaReserva() {
    const inputLibro = document.getElementById("id-libro-reserva");
    const inputReserva = document.getElementById("id-reserva");
    const inputUsuario = document.getElementById("usuario-lector");
    const inputFecha = document.getElementById("fecha-reserva");

    if (!inputLibro || !inputReserva || !inputUsuario || !inputFecha) {
        alert("Error de interfaz: Faltan elementos en el formulario HTML.");
        return;
    }

    const codigoBuscado = parseInt(inputLibro.value.trim());
    const idReserva = inputReserva.value.trim();
    const usuario = inputUsuario.value.trim();
    const fecha = inputFecha.value;

    // Validación de campos obligatorios
    if (!codigoBuscado || !idReserva || !usuario || !fecha) {
        alert("Por favor, complete todos los campos del formulario antes de confirmar.");
        return;
    }

    // 1. Buscar el libro en el inventario real
    const libroEncontrado = inventarioLibros.find(l => l.codigo === codigoBuscado);

    if (!libroEncontrado) {
        alert(`Error: El código de libro [${codigoBuscado}] no existe en el catálogo.`);
        return;
    }

    // 2. Controlar stock
    if (libroEncontrado.cantidad_disponible <= 0) {
        alert(`Stock Agotado: El libro "${libroEncontrado.titulo}" no posee unidades disponibles.`);
        return;
    }

    // 3. Descontar stock y guardar estado del inventario
    libroEncontrado.cantidad_disponible -= 1;
    localStorage.setItem("inventario_libros_sql", JSON.stringify(inventarioLibros));
    actualizarTablaInventario();

    // 4. Registrar en el historial de reservas
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

    // Limpieza de campos del formulario
    inputLibro.value = "";
    inputReserva.value = "";
    inputUsuario.value = "";
    inputFecha.value = "";

    alert("¡Reserva confirmada con éxito!");
}

// Función encargada de dibujar el historial inferior
function actualizarTablaReservas() {
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