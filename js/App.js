import { inventarioLibros, actualizarTablaInventario, db_tablas_maestras, resolverIdMaestra } from './libros.js';

// Arreglo en memoria para las reservas
const historialReservas = [];
let reservaSeleccionadaParaDevolver = null;
let confirmacionCallback = null;

function guardarDatosPersistentes() {
    localStorage.setItem("inventario_libros_sql", JSON.stringify(inventarioLibros));
    localStorage.setItem("db_tablas_maestras", JSON.stringify(db_tablas_maestras));
    localStorage.setItem("historial_reservas", JSON.stringify(historialReservas));
}

function normalizarInventario() {
    inventarioLibros.forEach(libro => {
        const total = Number(libro.cantidad) || 0;
        const disponible = Number(libro.cantidad_disponible) || 0;
        libro.cantidad_disponible = Math.max(disponible, total);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("Inicializando el Sistema de Gestión unificado...");
    cerrarModalDevolucion();

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
            normalizarInventario();
            guardarDatosPersistentes();
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

    const btnCancelarDevolucion = document.getElementById("btn-cancelar-devolucion");
    const btnConfirmarDevolucion = document.getElementById("btn-confirmar-devolucion");
    const modalDevolucion = document.getElementById("modal-devolucion");
    const btnCancelarConfirmacion = document.getElementById("btn-cancelar-confirmacion");
    const btnConfirmarConfirmacion = document.getElementById("btn-confirmar-confirmacion");
    const modalConfirmacion = document.getElementById("modal-confirmacion");

    if (btnCancelarDevolucion) {
        btnCancelarDevolucion.addEventListener("click", cerrarModalDevolucion);
    }

    if (btnConfirmarDevolucion) {
        btnConfirmarDevolucion.addEventListener("click", confirmarDevolucionReserva);
    }

    if (btnCancelarConfirmacion) {
        btnCancelarConfirmacion.addEventListener("click", cerrarConfirmacion);
    }

    if (btnConfirmarConfirmacion) {
        btnConfirmarConfirmacion.addEventListener("click", () => {
            if (confirmacionCallback) {
                const callback = confirmacionCallback;
                confirmacionCallback = null;
                callback();
            }
            cerrarConfirmacion();
        });
    }

    if (modalDevolucion) {
        modalDevolucion.addEventListener("click", (evento) => {
            if (evento.target === modalDevolucion) {
                cerrarModalDevolucion();
            }
        });
    }

    if (modalConfirmacion) {
        modalConfirmacion.addEventListener("click", (evento) => {
            if (evento.target === modalConfirmacion) {
                cerrarConfirmacion();
            }
        });
    }

    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape") {
            cerrarConfirmacion();
            cerrarModalDevolucion();
        }
    });
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
    normalizarInventario();
    guardarDatosPersistentes();
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
        mostrarNotificacion("Error de interfaz: faltan campos en el formulario de inventario.", "error");
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
        mostrarNotificacion("Por favor, completa todos los campos antes de guardar el libro.", "error");
        return;
    }

    const existe = inventarioLibros.some(libro => String(libro.codigo) === codigo);
    if (existe) {
        mostrarNotificacion(`El código "${codigo}" ya existe en el inventario.`, "error");
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

    mostrarNotificacion("Libro agregado correctamente al inventario.", "success");
}

function mostrarNotificacion(mensaje, tipo = "info") {
    const contenedor = document.getElementById("contenedor-notificaciones");
    if (!contenedor) return;

    const notificacion = document.createElement("div");
    notificacion.className = `notificacion ${tipo}`;
    notificacion.textContent = mensaje;
    contenedor.appendChild(notificacion);

    window.setTimeout(() => notificacion.classList.add("visible"), 10);
    window.setTimeout(() => {
        notificacion.classList.remove("visible");
        notificacion.classList.add("oculta");
        window.setTimeout(() => notificacion.remove(), 280);
    }, 3200);
}

function mostrarConfirmacion(mensaje, callback) {
    const modal = document.getElementById("modal-confirmacion");
    const texto = document.getElementById("modal-confirmacion-mensaje");
    if (!modal || !texto) return;

    texto.textContent = mensaje;
    confirmacionCallback = callback;
    modal.classList.remove("modal-oculto");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
}

function cerrarConfirmacion() {
    const modal = document.getElementById("modal-confirmacion");
    if (modal) {
        modal.classList.add("modal-oculto");
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
    }
    confirmacionCallback = null;
}

function eliminarLibroDelInventario(codigo) {
    const codigoBuscado = String(codigo);
    const index = inventarioLibros.findIndex(libro => String(libro.codigo) === codigoBuscado);

    if (index === -1) {
        mostrarNotificacion("No se encontró el libro a eliminar.", "error");
        return;
    }

    const libro = inventarioLibros[index];
    mostrarConfirmacion(`¿Deseas eliminar el libro "${libro.titulo}" del inventario?`, () => {
        inventarioLibros.splice(index, 1);
        guardarDatosPersistentes();
        actualizarTablaInventario();
        mostrarNotificacion("Libro eliminado del inventario.", "success");
    });
}

function abrirModalDevolucion(idReserva) {
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

function cerrarModalDevolucion() {
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

function confirmarDevolucionReserva() {
    if (!reservaSeleccionadaParaDevolver) return;

    const textarea = document.getElementById("observaciones-devolucion");
    const observaciones = textarea ? textarea.value.trim() : "";
    const reserva = reservaSeleccionadaParaDevolver;

    reserva.estado = "Devuelta";
    reserva.observaciones = observaciones || "Sin observaciones";
    reserva.fechaDevolucion = new Date().toISOString().split("T")[0];

    guardarDatosPersistentes();
    actualizarTablaInventario();
    actualizarTablaReservas();
    cerrarModalDevolucion();
    mostrarNotificacion("Reserva marcada como devuelta correctamente.", "success");
}

// LÓGICA DE REGISTRO DE RESERVA
function registrarNuevaReserva() {
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

    // Validación de campos obligatorios
    if (!codigoBuscado || !idReserva || !usuario || !fecha) {
        mostrarNotificacion("Por favor, complete todos los campos del formulario antes de confirmar.", "error");
        return;
    }

    // 1. Buscar el libro en el inventario real
    const libroEncontrado = inventarioLibros.find(l => String(l.codigo) === codigoBuscado);

    if (!libroEncontrado) {
        mostrarNotificacion(`Error: El código de libro [${codigoBuscado}] no existe en el catálogo.`, "error");
        return;
    }

    // 2. Restaurar la disponibilidad visual del libro si quedó afectada por errores previos
    const libroEncontradoActualizado = inventarioLibros.find(l => String(l.codigo) === codigoBuscado);
    if (libroEncontradoActualizado) {
        const total = Number(libroEncontradoActualizado.cantidad) || 0;
        libroEncontradoActualizado.cantidad_disponible = Math.max(Number(libroEncontradoActualizado.cantidad_disponible) || 0, total);
        guardarDatosPersistentes();
        actualizarTablaInventario();
    }

    // 3. Registrar en el historial de reservas
    const nuevaReserva = {
        idLibro: codigoBuscado,
        idReserva: idReserva,
        usuario: usuario,
        fecha: fecha,
        estado: "Activa",
        observaciones: "",
        fechaDevolucion: ""
    };

    historialReservas.push(nuevaReserva);
    localStorage.setItem("historial_reservas", JSON.stringify(historialReservas));
    actualizarTablaReservas();

    // Limpieza de campos del formulario
    inputLibro.value = "";
    inputReserva.value = "";
    inputUsuario.value = "";
    inputFecha.value = "";

    mostrarNotificacion("¡Reserva confirmada con éxito!", "success");
}

// Función encargada de dibujar el historial inferior
function actualizarTablaReservas() {
    const tbody = document.querySelector("#tabla-reservas tbody");
    const tbodyDevueltas = document.querySelector("#tabla-reservas-devueltas tbody");
    if (!tbody || !tbodyDevueltas) return;

    const reservasActivas = historialReservas.filter(res => String(res.estado).toLowerCase() !== "devuelta");
    const reservasDevueltas = historialReservas.filter(res => String(res.estado).toLowerCase() === "devuelta");

    tbody.innerHTML = "";
    if (reservasActivas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #a0aec0; padding: 15px;">No hay reservas activas en este momento.</td></tr>`;
    } else {
        reservasActivas.forEach(res => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td>${res.idLibro}</td>
                <td>${res.idReserva}</td>
                <td>${res.usuario}</td>
                <td>${res.fecha}</td>
                <td><span style="color: #319795; font-weight: bold;">${res.estado}</span></td>
                <td><button type="button" class="btn" data-accion="devolver-reserva" data-id-reserva="${res.idReserva}">Devolver</button></td>
            `;
            tbody.appendChild(fila);
        });
    }

    tbodyDevueltas.innerHTML = "";
    if (reservasDevueltas.length === 0) {
        tbodyDevueltas.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #a0aec0; padding: 15px;">No hay reservas devueltas aún.</td></tr>`;
    } else {
        reservasDevueltas.forEach(res => {
            const fila = document.createElement("tr");
            fila.innerHTML = `
                <td>${res.idLibro}</td>
                <td>${res.idReserva}</td>
                <td>${res.usuario}</td>
                <td>${res.fecha}</td>
                <td>${res.fechaDevolucion || "-"}</td>
                <td>${res.observaciones || "Sin observaciones"}</td>
            `;
            tbodyDevueltas.appendChild(fila);
        });
    }

    tbody.querySelectorAll('button[data-accion="devolver-reserva"]').forEach(boton => {
        boton.addEventListener('click', () => abrirModalDevolucion(boton.dataset.idReserva));
    });
}