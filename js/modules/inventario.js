import { inventarioLibros, db_tablas_maestras } from '../state.js';
import { ipcService } from '../services/ipcService.js';
import { mostrarNotificacion } from '../ui/notificaciones.js';
import { mostrarConfirmacion } from '../ui/modales.js';
import { escaparHTML } from '../utils.js';

// Código del libro que se está editando (null = el formulario está en modo "agregar")
let codigoEnEdicion = null;

function nombreDe(lista, id, campo) {
    const item = lista.find(e => e.id === id);
    return item ? item[campo] : "";
}

/**
 * Renderiza la tabla del inventario de libros filtrando por el término de búsqueda
 */
export function actualizarTablaInventario() {
    const tbody = document.querySelector("#tabla-inventario tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!inventarioLibros || inventarioLibros.length === 0) {
        tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;'>No hay libros cargados en el inventario.</td></tr>";
        return;
    }

    const inputBuscar = document.getElementById("buscador-libros");
    const filtro = inputBuscar ? inputBuscar.value.trim().toLowerCase() : "";

    // Se resuelven los nombres una vez por libro y se reutilizan para filtrar y para mostrar
    const filas = inventarioLibros.map(libro => ({
        libro,
        editorial: nombreDe(db_tablas_maestras.editoriales, libro.id_editorial, "nombre"),
        asignatura: nombreDe(db_tablas_maestras.asignatura, libro.id_asignatura, "nombre"),
        estado: nombreDe(db_tablas_maestras.estados, libro.id_estado, "condicion")
    }));

    const filtradas = filas.filter(({ libro, editorial, asignatura, estado }) => {
        if (!filtro) return true;
        return [libro.codigo, libro.titulo, libro.autor, editorial, asignatura, estado]
            .some(valor => String(valor ?? "").toLowerCase().includes(filtro));
    });

    if (filtradas.length === 0) {
        tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;'>No se encontraron libros que coincidan con la búsqueda.</td></tr>";
        return;
    }

    filtradas.forEach(({ libro, editorial, asignatura, estado }) => {
        const fila = document.createElement("tr");
        fila.innerHTML = `
            <td>${escaparHTML(libro.codigo)}</td>
            <td>${escaparHTML(libro.titulo)}</td>
            <td>${escaparHTML(libro.autor)}</td>
            <td>${escaparHTML(editorial || "—")}</td>
            <td>${escaparHTML(asignatura || "—")}</td>
            <td>${escaparHTML(libro.cantidad)}</td>
            <td>${escaparHTML(libro.cantidad_disponible)}</td>
            <td>${escaparHTML(estado || "—")}</td>
            <td>
                <div class="acciones-fila">
                    <button type="button" class="btn" data-accion="editar-libro" data-codigo="${escaparHTML(libro.codigo)}">Editar</button>
                    <button type="button" class="btn" data-accion="eliminar-libro" data-codigo="${escaparHTML(libro.codigo)}">Eliminar</button>
                </div>
            </td>
        `;
        tbody.appendChild(fila);
    });
}

/**
 * Carga las editoriales y asignaturas existentes como sugerencias del formulario,
 * para reutilizarlas en lugar de crear variantes ("Economia" / "Economía").
 */
export function actualizarSugerencias() {
    const llenar = (idLista, items) => {
        const lista = document.getElementById(idLista);
        if (!lista) return;
        lista.innerHTML = items.map(item => `<option value="${escaparHTML(item.nombre)}"></option>`).join("");
    };
    llenar("lista-editoriales", db_tablas_maestras.editoriales);
    llenar("lista-asignaturas", db_tablas_maestras.asignatura);
}

function camposFormulario() {
    return {
        id: document.getElementById("libro-id"),
        titulo: document.getElementById("libro-titulo"),
        autor: document.getElementById("libro-autor"),
        editorial: document.getElementById("libro-editorial"),
        asignatura: document.getElementById("libro-asignatura"),
        cantidad: document.getElementById("libro-cantidad"),
        estado: document.getElementById("libro-estado")
    };
}

/** Deja el formulario en modo "agregar", vacío */
export function cancelarEdicionLibro() {
    const campos = camposFormulario();
    codigoEnEdicion = null;

    Object.values(campos).forEach(campo => { if (campo && campo !== campos.estado) campo.value = ""; });
    if (campos.id) campos.id.readOnly = false;
    if (campos.estado) {
        // Se quita la opción temporal que se agrega al editar un libro con un estado distinto de Nuevo/Usado
        campos.estado.querySelectorAll("option[data-temporal]").forEach(opcion => opcion.remove());
        campos.estado.value = "Nuevo";
    }

    const titulo = document.getElementById("titulo-form-libro");
    const guardar = document.getElementById("btn-guardar-libro");
    const cancelar = document.getElementById("btn-cancelar-edicion");
    if (titulo) titulo.textContent = "Agregar Nuevo Libro";
    if (guardar) guardar.textContent = "Guardar en Inventario";
    if (cancelar) cancelar.hidden = true;
}

/** Pasa el formulario a modo "editar" con los datos del libro elegido */
export function iniciarEdicionLibro(codigo) {
    const libro = inventarioLibros.find(l => Number(l.codigo) === Number(codigo));
    if (!libro) {
        mostrarNotificacion("No se encontró el libro a editar.", "error");
        return;
    }
    const campos = camposFormulario();
    if (Object.values(campos).some(campo => !campo)) return;

    cancelarEdicionLibro();
    codigoEnEdicion = Number(libro.codigo);

    campos.id.value = libro.codigo;
    campos.id.readOnly = true; // el código identifica al libro y sus reservas: no se cambia
    campos.titulo.value = libro.titulo;
    campos.autor.value = libro.autor;
    campos.editorial.value = nombreDe(db_tablas_maestras.editoriales, libro.id_editorial, "nombre");
    campos.asignatura.value = nombreDe(db_tablas_maestras.asignatura, libro.id_asignatura, "nombre");
    campos.cantidad.value = libro.cantidad;

    // Si el libro tiene un estado fuera de Nuevo/Usado (p. ej. "1 usado/nuevo") se conserva tal cual
    const estado = nombreDe(db_tablas_maestras.estados, libro.id_estado, "condicion") || "Nuevo";
    if (![...campos.estado.options].some(opcion => opcion.value === estado)) {
        const opcion = new Option(estado, estado);
        opcion.dataset.temporal = "1";
        campos.estado.add(opcion);
    }
    campos.estado.value = estado;

    document.getElementById("titulo-form-libro").textContent = `Editar libro #${libro.codigo}`;
    document.getElementById("btn-guardar-libro").textContent = "Guardar cambios";
    document.getElementById("btn-cancelar-edicion").hidden = false;
    document.getElementById("form-libro").scrollIntoView({ behavior: "smooth", block: "center" });
    campos.titulo.focus();
}

/**
 * Agrega un libro nuevo o guarda los cambios del que se está editando, según el modo del formulario
 */
export async function guardarLibroDelFormulario(evento, reloadCallback) {
    if (evento && typeof evento.preventDefault === 'function') {
        evento.preventDefault();
    }

    const campos = camposFormulario();
    if (Object.values(campos).some(campo => !campo)) {
        mostrarNotificacion("Error de interfaz: faltan campos en el formulario de inventario.", "error");
        return;
    }

    const codigo = parseInt(campos.id.value.trim(), 10);
    const libro = {
        codigo,
        titulo: campos.titulo.value.trim(),
        autor: campos.autor.value.trim(),
        editorial: campos.editorial.value.trim(),
        asignatura: campos.asignatura.value.trim(),
        cantidad: parseInt(campos.cantidad.value, 10),
        estado: campos.estado.value.trim()
    };

    if (Number.isNaN(codigo) || !libro.titulo || !libro.autor || !libro.editorial || !libro.asignatura || Number.isNaN(libro.cantidad) || libro.cantidad < 1) {
        mostrarNotificacion("Por favor, completa todos los campos con valores válidos. El código de libro debe ser numérico.", "error");
        return;
    }

    const editando = codigoEnEdicion !== null;
    if (!editando && inventarioLibros.some(l => Number(l.codigo) === codigo)) {
        mostrarNotificacion(`El código "${codigo}" ya existe en el inventario.`, "error");
        return;
    }

    const res = editando ? await ipcService.updateLibro(libro) : await ipcService.addLibro(libro);
    if (res.success) {
        if (typeof reloadCallback === 'function') {
            await reloadCallback();
        }
        cancelarEdicionLibro();
        mostrarNotificacion(editando ? "Cambios guardados correctamente." : "Libro agregado correctamente al inventario.", "success");
    } else {
        mostrarNotificacion("Error al guardar el libro: " + res.error, "error", 5000);
    }
}

/**
 * Elimina un libro del inventario tras solicitar confirmación
 */
export function eliminarLibroDelInventario(codigo, reloadCallback) {
    const codigoBuscado = Number(codigo);
    const libro = inventarioLibros.find(l => Number(l.codigo) === codigoBuscado);

    if (!libro) {
        mostrarNotificacion("No se encontró el libro a eliminar.", "error");
        return;
    }

    mostrarConfirmacion(`¿Deseas eliminar el libro "${libro.titulo}" del catálogo?`, async () => {
        const res = await ipcService.deleteLibro(codigoBuscado);
        if (res.success) {
            if (codigoEnEdicion === codigoBuscado) cancelarEdicionLibro();
            if (typeof reloadCallback === 'function') {
                await reloadCallback();
            }
            mostrarNotificacion("Libro eliminado del catálogo.", "success");
        } else {
            mostrarNotificacion("No se pudo eliminar: " + res.error, "error", 5000);
        }
    });
}
