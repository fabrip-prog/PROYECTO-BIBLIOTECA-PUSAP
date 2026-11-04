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
    actualizarSugerencias,
    guardarLibroDelFormulario,
    iniciarEdicionLibro,
    cancelarEdicionLibro,
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
            actualizarSugerencias();
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

// ==========================================
// ESTADO DE LA SINCRONIZACIÓN CON EXCEL
// ==========================================

let ultimoEstadoSync = null;

function mostrarEstadoSync(estado) {
    const indicador = document.getElementById("estado-sync");
    if (!indicador || !estado) return;

    indicador.className = `estado-sync estado-sync-${estado.estado}`;
    indicador.textContent = estado.mensaje || "Sincronización con Excel inactiva";
    indicador.title = estado.archivo ? `Archivo de sincronización: ${estado.archivo}` : "";

    // Solo se avisa con un toast cuando el estado cambia a algo que requiere atención (o se resuelve)
    if (ultimoEstadoSync !== null && ultimoEstadoSync !== estado.estado) {
        if (estado.estado === "bloqueado") {
            mostrarNotificacion(estado.mensaje, "info", 6000);
        } else if (estado.estado === "error") {
            mostrarNotificacion(estado.mensaje, "error", 7000);
        } else if (estado.estado === "sincronizado" && ultimoEstadoSync === "bloqueado") {
            mostrarNotificacion("Los cambios pendientes se copiaron al CSV de Excel.", "success");
        }
    }
    ultimoEstadoSync = estado.estado;
}

/**
 * Informa el resultado de una importación (manual o detectada al guardar en Excel):
 * resumen de cambios, filas ignoradas y advertencias.
 */
function informarImportacion(prefijo, mensaje, resumen) {
    const errores = resumen?.errores || [];
    const advertencias = resumen?.advertencias || [];

    if (mensaje) {
        mostrarNotificacion(`${prefijo}: ${mensaje}.`, "success", 5000);
    }
    if (errores.length) {
        const detalle = errores.slice(0, 3).map(e => `línea ${e.linea}: ${e.motivo}`).join(" · ");
        const resto = errores.length > 3 ? ` (y ${errores.length - 3} más)` : "";
        mostrarNotificacion(`Filas ignoradas — ${detalle}${resto}`, "error", 10000);
    }
    if (advertencias.length) {
        const resto = advertencias.length > 1 ? ` (y ${advertencias.length - 1} aviso(s) más)` : "";
        mostrarNotificacion(advertencias[0] + resto, "info", 9000);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("Inicializando el Sistema de Gestión con persistencia SQLite y Control de Reservas...");
    cerrarModalDevolucion();

    // Carga de datos inicial
    cargarDatosDesdeSQLite();
    ipcService.getEstadoSync().then(mostrarEstadoSync).catch(() => {});

    // 1. Escuchar actualizaciones en tiempo real desde el Main Process
    ipcService.onDbActualizada(async (info) => {
        console.log("Base de datos física actualizada. Recargando UI...");
        await cargarDatosDesdeSQLite();
        informarImportacion("Excel", info?.mensaje || "catálogo sincronizado", info);
    });
    ipcService.onSyncEstado(mostrarEstadoSync);

    // 2. Importar un CSV elegido con el selector nativo (se fusiona: nunca borra libros)
    const btnImportar = document.getElementById("btn-importar-csv");
    if (btnImportar) {
        btnImportar.addEventListener("click", async () => {
            const res = await ipcService.seleccionarYCargarCSV();
            if (res.canceled) return;
            if (res.success) {
                await cargarDatosDesdeSQLite();
                informarImportacion("Importación", res.mensaje, res.resumen);
            } else {
                mostrarNotificacion("Error al importar el archivo: " + res.error, "error", 6000);
            }
        });
    }

    // 3. Sincronizar ahora con el CSV de Excel
    const btnSincronizar = document.getElementById("btn-sincronizar");
    if (btnSincronizar) {
        btnSincronizar.addEventListener("click", () => {
            mostrarConfirmacion(
                "Se leerá el CSV de Excel y la base quedará igual a él. Los libros que ya no figuren en el archivo y no tengan reservas se eliminarán (antes se guarda un respaldo). ¿Continuar?",
                async () => {
                    const res = await ipcService.sincronizarAhora();
                    if (res.success) {
                        await cargarDatosDesdeSQLite();
                        informarImportacion("Sincronización", res.mensaje, res.resumen);
                    } else {
                        mostrarNotificacion("Error al sincronizar: " + res.error, "error", 6000);
                    }
                }
            );
        });
    }

    // 4. Exportar la base al CSV ahora mismo
    const btnExportarCsv = document.getElementById("btn-exportar-csv");
    if (btnExportarCsv) {
        btnExportarCsv.addEventListener("click", async () => {
            const res = await ipcService.exportarCSVManual();
            if (res.success) {
                mostrarNotificacion("Inventario exportado al archivo CSV de Excel correctamente.", "success");
            } else {
                mostrarNotificacion("No se pudo exportar: " + res.error, "error", 6000);
            }
        });
    }

    // 5. Abrir el CSV con el programa asociado (Excel)
    const btnAbrirCsv = document.getElementById("btn-abrir-csv");
    if (btnAbrirCsv) {
        btnAbrirCsv.addEventListener("click", async () => {
            const res = await ipcService.abrirCSV();
            if (!res.success) {
                mostrarNotificacion("No se pudo abrir el CSV: " + res.error, "error", 6000);
            }
        });
    }

    // 6. Formulario para agregar o editar un libro
    const formLibro = document.getElementById("form-libro");
    if (formLibro) {
        formLibro.addEventListener("submit", (evento) => {
            guardarLibroDelFormulario(evento, cargarDatosDesdeSQLite);
        });
    }

    const btnCancelarEdicion = document.getElementById("btn-cancelar-edicion");
    if (btnCancelarEdicion) {
        btnCancelarEdicion.addEventListener("click", cancelarEdicionLibro);
    }

    // 7. Delegación de eventos para editar / eliminar libros del inventario
    const tbodyInventario = document.querySelector("#tabla-inventario tbody");
    if (tbodyInventario) {
        tbodyInventario.addEventListener("click", (evento) => {
            const boton = evento.target.closest("button[data-accion]");
            if (!boton) return;
            if (boton.dataset.accion === "eliminar-libro") {
                eliminarLibroDelInventario(boton.dataset.codigo, cargarDatosDesdeSQLite);
            } else if (boton.dataset.accion === "editar-libro") {
                iniciarEdicionLibro(boton.dataset.codigo);
            }
        });
    }

    // 8. Buscador en tiempo real para filtrar inventario y reservas por usuario
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

    // 9. Botón confirmar reserva
    const btnConfirmar = document.getElementById("btn-confirmar-reserva");
    if (btnConfirmar) {
        btnConfirmar.addEventListener("click", () => {
            registrarNuevaReserva(cargarDatosDesdeSQLite);
        });
    }

    // 10. Botón limpiar historial devueltas
    const btnLimpiarHistorial = document.getElementById("btn-limpiar-historial");
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.addEventListener("click", () => {
            limpiarHistorialReservasDevueltas(cargarDatosDesdeSQLite);
        });
    }

    // 11. Botones y eventos de modales
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
