import { db_tablas_maestras, inventarioLibros, historialReservas } from './state.js';
import { ipcService } from './services/ipcService.js';
import { mostrarNotificacion } from './ui/notificaciones.js';
import { 
    mostrarConfirmacion, 
    cerrarConfirmacion, 
    ejecutarConfirmacion, 
    cerrarModalDevolucion 
} from './ui/modales.js';
import { 
    actualizarTablaInventario, 
    agregarLibroAlInventario, 
    eliminarLibroDelInventario 
} from './modules/inventario.js';
import { 
    actualizarTablaReservas, 
    registrarNuevaReserva, 
    confirmarDevolucionReserva, 
    limpiarHistorialReservasDevueltas 
} from './modules/reservas.js';


 // Carga y sincroniza los datos relacionales desde la base de datos SQLite
 
async function cargarDatosDesdeSQLite() {
    try {
        console.log("Cargando datos relacionales desde la base de datos SQLite...");

        // 1. Cargar tablas maestras
        const maestras = await ipcService.getMaestras();
        if (maestras) {
            db_tablas_maestras.estados.length = 0;
            db_tablas_maestras.estados.push(...(maestras.estados || []));
            db_tablas_maestras.asignatura.length = 0;
            db_tablas_maestras.asignatura.push(...(maestras.asignatura || []));
            db_tablas_maestras.editoriales.length = 0;
            db_tablas_maestras.editoriales.push(...(maestras.editoriales || []));
        }

        // 2. Cargar inventario de libros
        const libros = await ipcService.getLibros();
        if (libros) {
            inventarioLibros.length = 0;
            inventarioLibros.push(...libros);
            actualizarTablaInventario();
        }

        // 3. Cargar reservas activas e historial
        const reservas = await ipcService.getReservas();
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

    // Carga de datos inicial
    cargarDatosDesdeSQLite();

    // 1. Escuchar actualizaciones en tiempo real desde el Main Process
    ipcService.onDbActualizada(() => {
        console.log("Base de datos física actualizada. Recargando UI...");
        cargarDatosDesdeSQLite();
        mostrarNotificacion("Catálogo sincronizado automáticamente con Excel.", "success");
    });

    // 2. Control de carga manual de CSV (Excel) mediante selector nativo
    const inputArchivo = document.getElementById("archivo-excel-libros");
    if (inputArchivo) {
        inputArchivo.addEventListener("click", async (evento) => {
            evento.preventDefault();
            const res = await ipcService.seleccionarYCargarCSV();
            if (res && res.success) {
                await cargarDatosDesdeSQLite();
                mostrarNotificacion("Catálogo importado y guardado en SQLite con éxito.", "success");
            } else if (res && res.error) {
                mostrarNotificacion("Error al importar el archivo: " + res.error, "error");
            }
        });
    }

    // 3. Botón para cargar CSV por defecto
    const btnCargarPredef = document.getElementById("btn-cargar-predef");
    if (btnCargarPredef) {
        btnCargarPredef.addEventListener("click", () => {
            mostrarConfirmacion("¿Deseas sincronizar la base de datos con el archivo CSV por defecto?", async () => {
                const res = await ipcService.cargarCSVManual(null);
                if (res.success) {
                    await cargarDatosDesdeSQLite();
                    mostrarNotificacion("Base de datos sincronizada con el CSV por defecto.", "success");
                } else {
                    mostrarNotificacion("Error al sincronizar: " + res.error, "error");
                }
            });
        });
    }

    // 4. Botón para exportar base de datos a CSV
    const btnExportarCsv = document.getElementById("btn-exportar-csv");
    if (btnExportarCsv) {
        btnExportarCsv.addEventListener("click", async () => {
            const res = await ipcService.exportarCSVManual();
            if (res.success) {
                mostrarNotificacion("Inventario exportado al archivo CSV de Excel correctamente.", "success");
            } else {
                mostrarNotificacion("Error al exportar inventario: " + res.error, "error");
            }
        });
    }

    // 5. Formulario para agregar nuevo libro
    const formLibro = document.getElementById("form-libro");
    if (formLibro) {
        formLibro.addEventListener("submit", (evento) => {
            agregarLibroAlInventario(evento, cargarDatosDesdeSQLite);
        });
    }

    // 6. Delegación de evento click para eliminar libro del inventario
    const tbodyInventario = document.querySelector("#tabla-inventario tbody");
    if (tbodyInventario) {
        tbodyInventario.addEventListener("click", (evento) => {
            const boton = evento.target.closest("button[data-accion='eliminar-libro']");
            if (boton) {
                eliminarLibroDelInventario(boton.dataset.codigo, cargarDatosDesdeSQLite);
            }
        });
    }

    // 7. Buscador en tiempo real para filtrar inventario y reservas por usuario
    const buscadorLibros = document.getElementById("buscador-libros");
    if (buscadorLibros) {
        buscadorLibros.addEventListener("input", () => {
            actualizarTablaInventario();
        });
    }

    const buscadorReservas = document.getElementById("buscador-reservas");
    if (buscadorReservas) {
        buscadorReservas.addEventListener("input", () => {
            actualizarTablaReservas();
        });
    }

    const buscadorHistorial = document.getElementById("buscador-historial");
    if (buscadorHistorial) {
        buscadorHistorial.addEventListener("input", () => {
            actualizarTablaReservas();
        });
    }

    // 8. Botón confirmar reserva
    const btnConfirmar = document.getElementById("btn-confirmar-reserva");
    if (btnConfirmar) {
        btnConfirmar.addEventListener("click", () => {
            registrarNuevaReserva(cargarDatosDesdeSQLite);
        });
    }

    // 9. Botón limpiar historial devueltas
    const btnLimpiarHistorial = document.getElementById("btn-limpiar-historial");
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.addEventListener("click", () => {
            limpiarHistorialReservasDevueltas(cargarDatosDesdeSQLite);
        });
    }

    // 10. Botones y eventos de modales
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
        btnConfirmarDevolucion.addEventListener("click", () => {
            confirmarDevolucionReserva(cargarDatosDesdeSQLite);
        });
    }

    if (btnCancelarConfirmacion) {
        btnCancelarConfirmacion.addEventListener("click", cerrarConfirmacion);
    }

    if (btnConfirmarConfirmacion) {
        btnConfirmarConfirmacion.addEventListener("click", ejecutarConfirmacion);
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