import { inventarioLibros, actualizarTablaInventario, db_tablas_maestras, resolverIdMaestra } from './libros.js';

// Importación segura de ipcRenderer de Electron
const { ipcRenderer } = window.require ? window.require('electron') : {
    invoke: async (channel, ...args) => {
        console.warn(`IPC Mock: ${channel}`, args);
        if (channel === 'get-maestras') return { estados: [], asignatura: [], editoriales: [] };
        if (channel === 'get-libros') return [];
        if (channel === 'get-reservas') return [];
        return { success: true };
    }
};

// Arreglos en memoria locales para vistas
const historialReservas = [];
let reservaSeleccionadaParaDevolver = null;
let confirmacionCallback = null;

// Cargar todos los datos de manera síncrona en la vista desde la base de datos real SQLite
async function cargarDatosDesdeSQLite() {
    try {
        console.log("Cargando datos relacionales desde la base de datos SQLite...");

        // 1. Cargar tablas maestras
        const maestras = await ipcRenderer.invoke('get-maestras');
        if (maestras) {
            db_tablas_maestras.estados.length = 0;
            db_tablas_maestras.estados.push(...(maestras.estados || []));
            db_tablas_maestras.asignatura.length = 0;
            db_tablas_maestras.asignatura.push(...(maestras.asignatura || []));
            db_tablas_maestras.editoriales.length = 0;
            db_tablas_maestras.editoriales.push(...(maestras.editoriales || []));
        }

        // 2. Cargar inventario de libros
        const libros = await ipcRenderer.invoke('get-libros');
        if (libros) {
            inventarioLibros.length = 0;
            inventarioLibros.push(...libros);
            actualizarTablaInventario();
        }

        // 3. Cargar reservas activas e historial
        const reservas = await ipcRenderer.invoke('get-reservas');
        if (reservas) {
            historialReservas.length = 0;
            historialReservas.push(...reservas);
            actualizarTablaReservas();
        }
    } catch (err) {
        console.error("Error al sincronizar datos con SQLite:", err);
        mostrarNotificacion("Error al sincronizar con la base de datos física.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("Inicializando el Sistema de Gestión con persistencia SQLite y Control de Reservas...");
    cerrarModalDevolucion();

    // Carga de base de datos inicializada
    cargarDatosDesdeSQLite();

    const formLibro = document.getElementById("form-libro");
    if (formLibro) {
        formLibro.addEventListener("submit", agregarLibroAlInventario);
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

    // Escuchador de confirmación de reserva
    const btnConfirmar = document.getElementById("btn-confirmar-reserva");
    if (btnConfirmar) {
        btnConfirmar.addEventListener("click", registrarNuevaReserva);
    } else {
        console.error("Error crítico: No se encontró el botón con ID 'btn-confirmar-reserva' en el HTML.");
    }

    // Escuchador para limpiar historial de reservas devueltas
    const btnLimpiarHistorial = document.getElementById("btn-limpiar-historial");
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.addEventListener("click", limpiarHistorialReservasDevueltas);
    }

    // Escuchadores de los modales de devolución y confirmación
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

async function agregarLibroAlInventario(evento) {
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

    const codigoStr = inputId.value.trim();
    const codigo = parseInt(codigoStr, 10);
    const titulo = inputTitulo.value.trim();
    const autor = inputAutor.value.trim();
    const editorial = inputEditorial.value.trim();
    const asignatura = inputAsignatura.value.trim();
    const cantidad = parseInt(inputCantidad.value, 10);
    const estado = inputEstado.value.trim();

    if (Number.isNaN(codigo) || !titulo || !autor || !editorial || !asignatura || Number.isNaN(cantidad) || cantidad < 1) {
        mostrarNotificacion("Por favor, completa todos los campos con valores válidos. El código de libro debe ser numérico.", "error");
        return;
    }

    const existe = inventarioLibros.some(libro => Number(libro.codigo) === codigo);
    if (existe) {
        mostrarNotificacion(`El código "${codigo}" ya existe en el inventario.`, "error");
        return;
    }

    const nuevoLibro = {
        codigo,
        titulo,
        autor,
        id_editorial: editorial,
        cantidad,
        cantidad_disponible: cantidad,
        id_estado: 1,
        id_asignatura: asignatura
    };

    const res = await ipcRenderer.invoke('add-libro', nuevoLibro);
    if (res.success) {
        await cargarDatosDesdeSQLite();

        inputId.value = "";
        inputTitulo.value = "";
        inputAutor.value = "";
        inputEditorial.value = "";
        inputAsignatura.value = "";
        inputCantidad.value = "";
        inputEstado.value = "Nuevo";

        mostrarNotificacion("Libro agregado correctamente al inventario de SQLite.", "success");
    } else {
        mostrarNotificacion("Error al guardar libro en la BBDD: " + res.error, "error");
    }
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
    const codigoBuscado = Number(codigo);
    const libro = inventarioLibros.find(l => Number(l.codigo) === codigoBuscado);

    if (!libro) {
        mostrarNotificacion("No se encontró el libro a eliminar.", "error");
        return;
    }

    mostrarConfirmacion(`¿Deseas eliminar el libro "${libro.titulo}" del catálogo de SQLite?`, async () => {
        const res = await ipcRenderer.invoke('delete-libro', codigoBuscado);
        if (res.success) {
            await cargarDatosDesdeSQLite();
            mostrarNotificacion("Libro eliminado del catálogo en SQLite.", "success");
        } else {
            mostrarNotificacion("Error al eliminar libro: " + res.error, "error");
        }
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

async function confirmarDevolucionReserva() {
    if (!reservaSeleccionadaParaDevolver) return;

    const textarea = document.getElementById("observaciones-devolucion");
    const observaciones = textarea ? textarea.value.trim() : "";
    const reserva = reservaSeleccionadaParaDevolver;

    const res = await ipcRenderer.invoke('devolver-reserva', {
        idReserva: reserva.idReserva,
        observaciones: observaciones || "Sin observaciones",
        fechaDevolucion: new Date().toISOString().split("T")[0]
    });

    if (res.success) {
        await cargarDatosDesdeSQLite();
        cerrarModalDevolucion();
        mostrarNotificacion("Reserva marcada como devuelta y stock reincorporado correctamente.", "success");
    } else {
        mostrarNotificacion("Error al procesar la devolución: " + res.error, "error");
    }
}

// LÓGICA DE REGISTRO DE RESERVA EN SQLITE
async function registrarNuevaReserva() {
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

    const nuevaReserva = {
        idLibro: codigoBuscado,
        idReserva: idReserva,
        usuario: usuario,
        fecha: fecha
    };

    const res = await ipcRenderer.invoke('add-reserva', nuevaReserva);
    if (res.success) {
        await cargarDatosDesdeSQLite();

        // Limpieza de campos del formulario
        inputLibro.value = "";
        inputReserva.value = "";
        inputUsuario.value = "";
        inputFecha.value = "";

        mostrarNotificacion("¡Reserva confirmada y persistida con éxito en SQLite!", "success");
    } else {
        mostrarNotificacion(res.error, "error");
    }
}

// Función encargada de dibujar el historial de reservas en la vista
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

async function limpiarHistorialReservasDevueltas() {
    const devueltas = historialReservas.filter(res => String(res.estado).toLowerCase() === "devuelta");
    if (devueltas.length === 0) {
        mostrarNotificacion("No hay reservas devueltas en el historial para limpiar.", "info");
        return;
    }

    mostrarConfirmacion("¿Deseas limpiar todo el historial de reservas devueltas en SQLite?", async () => {
        const res = await ipcRenderer.invoke('limpiar-historial-devueltas');
        if (res.success) {
            await cargarDatosDesdeSQLite();
            mostrarNotificacion("Historial de devoluciones limpiado correctamente.", "success");
        } else {
            mostrarNotificacion("Error al limpiar el historial: " + res.error, "error");
        }
    });
}