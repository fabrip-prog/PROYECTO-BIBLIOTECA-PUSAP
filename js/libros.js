// Tablas maestras simuladas para resolver las relaciones de IDs a nombres de texto
export const db_tablas_maestras = {
    estados: [{ id: 1, condicion: '1 usado/nuevo' }],
    asignatura: [
        { id: 1, nombre: 'Historia/Economía' },
        { id: 2, nombre: 'Derecho' },
        { id: 3, nombre: 'Filosofía' },
        { id: 4, nombre: 'Economia' }
    ],
    editoriales: [
        { id: 1, nombre: 'Siglo Veintiuno de Argentina Editores' },
        { id: 2, nombre: 'Marcos Lerner Editora Cordoba' },
        { id: 3, nombre: 'LexisNexis Abeledo-Perrot' },
        { id: 4, nombre: 'LexisNexis' },
        { id: 5, nombre: 'Virtudes Editorial Universitaria' },
        { id: 6, nombre: 'Astrea' },
        { id: 7, nombre: 'Ariel Sociedad Económica.' },
        { id: 8, nombre: 'Fondo de Cultura Económica' }
    ]
};

// Array compartido en memoria del inventario de libros
export const inventarioLibros = [];

export function resolverIdMaestra(tabla, valor, campo = 'nombre') {
    const texto = String(valor || '').trim();
    if (!texto) return null;

    const existente = tabla.find(item => String(item[campo] || '').trim().toLowerCase() === texto.toLowerCase());
    if (existente) return existente.id;

    const nuevoId = tabla.length > 0 ? Math.max(...tabla.map(item => Number(item.id) || 0)) + 1 : 1;
    tabla.push({ id: nuevoId, [campo]: texto });
    return nuevoId;
}

export function actualizarTablaInventario() {
    const tbody = document.querySelector("#tabla-inventario tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!inventarioLibros || inventarioLibros.length === 0) {
        tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No hay libros cargados en el inventario.</td></tr>";
        return;
    }

    inventarioLibros.forEach(libro => {
        // Mapeamos de ID numérico a texto de forma segura
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