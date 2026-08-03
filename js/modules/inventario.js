import { inventarioLibros, db_tablas_maestras } from '../state.js';
import { ipcService } from '../services/ipcService.js';
import { mostrarNotificacion } from '../ui/notificaciones.js';
import { mostrarConfirmacion } from '../ui/modales.js';

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

    const librosFiltrados = inventarioLibros.filter(libro => {
        if (!filtro) return true;

        const editorialObj = db_tablas_maestras.editoriales.find(e => e.id === libro.id_editorial);
        const asignaturaObj = db_tablas_maestras.asignatura.find(a => a.id === libro.id_asignatura);
        const estadoObj = db_tablas_maestras.estados.find(es => es.id === libro.id_estado);

        const nombreEditorial = editorialObj ? editorialObj.nombre.toLowerCase() : `editorial #${libro.id_editorial}`;
        const nombreAsignatura = asignaturaObj ? asignaturaObj.nombre.toLowerCase() : `asignatura #${libro.id_asignatura}`;
        const condicionEstado = estadoObj ? estadoObj.condicion.toLowerCase() : '1 usado/nuevo';

        const codigoStr = String(libro.codigo).toLowerCase();
        const tituloStr = String(libro.titulo || '').toLowerCase();
        const autorStr = String(libro.autor || '').toLowerCase();

        return codigoStr.includes(filtro) ||
               tituloStr.includes(filtro) ||
               autorStr.includes(filtro) ||
               nombreEditorial.includes(filtro) ||
               nombreAsignatura.includes(filtro) ||
               condicionEstado.includes(filtro);
    });

    if (librosFiltrados.length === 0) {
        tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;'>No se encontraron libros que coincidan con la búsqueda.</td></tr>";
        return;
    }

    librosFiltrados.forEach(libro => {
        const editorialObj = db_tablas_maestras.editoriales.find(e => e.id === libro.id_editorial);
        const asignaturaObj = db_tablas_maestras.asignatura.find(a => a.id === libro.id_asignatura);
        const estadoObj = db_tablas_maestras.estados.find(es => es.id === libro.id_estado);

        const nombreEditorial = editorialObj ? editorialObj.nombre : `Editorial #${libro.id_editorial}`;
        const nombreAsignatura = asignaturaObj ? asignaturaObj.nombre : `Asignatura #${libro.id_asignatura}`;
        const condicionEstado = estadoObj ? estadoObj.condicion : '1 usado/nuevo';

        const fila = document.createElement("tr");
        fila.innerHTML = `
            <td>${libro.codigo}</td>
            <td>${libro.titulo}</td>
            <td>${libro.autor}</td>
            <td>${nombreEditorial}</td>
            <td>${nombreAsignatura}</td>
            <td>${libro.cantidad}</td>
            <td>${libro.cantidad_disponible}</td>
            <td>${condicionEstado}</td>
            <td><button type="button" class="btn" data-accion="eliminar-libro" data-codigo="${libro.codigo}">Eliminar</button></td>
        `;
        tbody.appendChild(fila);
    });
}

/**
 * Agrega un nuevo libro al inventario previa validación
 */
export async function agregarLibroAlInventario(evento, reloadCallback) {
    if (evento && typeof evento.preventDefault === 'function') {
        evento.preventDefault();
    }

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

    const res = await ipcService.addLibro(nuevoLibro);
    if (res.success) {
        if (typeof reloadCallback === 'function') {
            await reloadCallback();
        }

        inputId.value = "";
        inputTitulo.value = "";
        inputAutor.value = "";
        inputEditorial.value = "";
        inputAsignatura.value = "";
        inputCantidad.value = "";
        inputEstado.value = "Nuevo";

        mostrarNotificacion("Libro agregado correctamente al inventario.", "success");
    } else {
        mostrarNotificacion("Error al guardar libro en la BBDD: " + res.error, "error");
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

    mostrarConfirmacion(`¿Deseas eliminar el libro "${libro.titulo}" del catálogo de SQLite?`, async () => {
        const res = await ipcService.deleteLibro(codigoBuscado);
        if (res.success) {
            if (typeof reloadCallback === 'function') {
                await reloadCallback();
            }
            mostrarNotificacion("Libro eliminado del catálogo.", "success");
        } else {
            mostrarNotificacion("Error al eliminar libro: " + res.error, "error");
        }
    });
}
