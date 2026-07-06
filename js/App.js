import { inventarioLibros, actualizarTablaInventario, db_tablas_maestras, resolverIdMaestra } from './libros.js';

// Arreglo en memoria para las reservas
const historialReservas = [];

function guardarDatosPersistentes() {
    localStorage.setItem("inventario_libros_sql", JSON.stringify(inventarioLibros));
    localStorage.setItem("db_tablas_maestras", JSON.stringify(db_tablas_maestras));
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("Inicializando el Sistema de Gestión unificado...");

    const datosMaestras = localStorage.getItem("db_tablas_maestras");
    if (datosMaestras) {
        const maestraPersistida = JSON.parse(datosMaestras);
        db_tablas_maestras.estados.length = 0;
        db_tablas_maestras.estados.push(...(maestraPersistida.estados || []));
        db_tablas_maestras.asignatura.length = 0;
        db_tablas_maestras.asignatura.push(...(maestraPersistida.asignatura || []));
        db_tablas_maestras.editoriales.length = 0;
        db_tablas_maestras.editoriales.push(...(maestraPersistida.editoriales || []));
    }

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

    const formLibro = document.getElementById("form-libro");
    if (formLibro) {
        formLibro.addEventListener("submit", agregarLibroAlInventario);
    }

    // 2. RECUPERAR HISTORIAL DE RESERVAS PREVIAS
    const guardadas = localStorage.getItem("historial_reservas");
    if (guardadas) {
        historialReservas.push(...JSON.parse(guardadas));
        actualizarTablaReservas();
    }

    const tbodyInventario = document.querySelector("#tabla-inventario tbody");
    if (tbodyInventario) {
        tbodyInventario.addEventListener("click", (evento) => {
            const boton = evento.target.closest("button[data-accion='eliminar-libro']");
            if (boton) {
                eliminarLibroDelInventario(boton.dataset.codigo);
            }
        });
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

function agregarLibroAlInventario(evento) {
    evento.preventDefault();

    const inputId = document.getElementById("libro-id");
    const inputTitulo = document.getElementById("libro-titulo");
    const inputAutor = document.getElementById("libro-autor");
    const inputEditorial = document.getElementById("libro-editorial");
    const inputAsignatura = document.getElementById("libro-asignatura");
    const inputCantidad = document.getElementById("libro-cantidad");
    const inputEstado = document.getElementById("libro-estado");

    if (!inputId || !inputTitulo || !inputAutor || !inputEditorial || !inputAsignatura || !inputCantidad || !inputEstado) {
        alert("Error de interfaz: faltan campos en el formulario de inventario.");
        return;
    }

    const codigo = inputId.value.trim();
    const titulo = inputTitulo.value.trim();
    const autor = inputAutor.value.trim();
    const editorial = inputEditorial.value.trim();
    const asignatura = inputAsignatura.value.trim();
    const cantidad = parseInt(inputCantidad.value, 10);
    const estado = inputEstado.value.trim();

    if (!codigo || !titulo || !autor || !editorial || !asignatura || Number.isNaN(cantidad) || cantidad < 1) {
        alert("Por favor, completa todos los campos antes de guardar el libro.");
        return;
    }

    const existe = inventarioLibros.some(libro => String(libro.codigo) === codigo);
    if (existe) {
        alert(`El código "${codigo}" ya existe en el inventario.`);
        return;
    }

    const idEditorial = resolverIdMaestra(db_tablas_maestras.editoriales, editorial);
    const idAsignatura = resolverIdMaestra(db_tablas_maestras.asignatura, asignatura);

    inventarioLibros.push({
        codigo,
        titulo,
        autor,
        id_editorial: idEditorial,
        cantidad,
        cantidad_disponible: cantidad,
        id_estado: 1,
        estado_text: estado,
        id_asignatura: idAsignatura
    });

    guardarDatosPersistentes();
    actualizarTablaInventario();

    inputId.value = "";
    inputTitulo.value = "";
    inputAutor.value = "";
    inputEditorial.value = "";
    inputAsignatura.value = "";
    inputCantidad.value = "";
    inputEstado.value = "Nuevo";

    alert("Libro agregado correctamente al inventario.");
}

function eliminarLibroDelInventario(codigo) {
    const codigoBuscado = String(codigo);
    const index = inventarioLibros.findIndex(libro => String(libro.codigo) === codigoBuscado);

    if (index === -1) {
        alert("No se encontró el libro a eliminar.");
        return;
    }

    const libro = inventarioLibros[index];
    const confirmar = confirm(`¿Deseas eliminar el libro "${libro.titulo}" del inventario?`);
    if (!confirmar) return;

    inventarioLibros.splice(index, 1);
    guardarDatosPersistentes();
    actualizarTablaInventario();
    alert("Libro eliminado del inventario.");
}

function eliminarReservaDelHistorial(idReserva) {
    const idReservaBuscada = String(idReserva);
    const index = historialReservas.findIndex(reserva => String(reserva.idReserva) === idReservaBuscada);

    if (index === -1) {
        alert("No se encontró la reserva a eliminar.");
        return;
    }

    const reserva = historialReservas[index];
    const confirmar = confirm(`¿Deseas eliminar la reserva ${reserva.idReserva}?`);
    if (!confirmar) return;

    historialReservas.splice(index, 1);
    localStorage.setItem("historial_reservas", JSON.stringify(historialReservas));
    actualizarTablaReservas();
    alert("Reserva eliminada correctamente.");
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

    const codigoBuscado = inputLibro.value.trim();
    const idReserva = inputReserva.value.trim();
    const usuario = inputUsuario.value.trim();
    const fecha = inputFecha.value;

    // Validación de campos obligatorios
    if (!codigoBuscado || !idReserva || !usuario || !fecha) {
        alert("Por favor, complete todos los campos del formulario antes de confirmar.");
        return;
    }

    // 1. Buscar el libro en el inventario real
    const libroEncontrado = inventarioLibros.find(l => String(l.codigo) === codigoBuscado);

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
            <td><button type="button" class="btn" data-accion="eliminar-reserva" data-id-reserva="${res.idReserva}">Eliminar</button></td>
        `;
        tbody.appendChild(fila);
    });

    tbody.querySelectorAll('button[data-accion="eliminar-reserva"]').forEach(boton => {
        boton.addEventListener('click', () => eliminarReservaDelHistorial(boton.dataset.idReserva));
    });
}