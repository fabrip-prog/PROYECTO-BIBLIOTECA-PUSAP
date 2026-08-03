// Estado en memoria compartido de la aplicación

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

export const inventarioLibros = [];

export const historialReservas = [];


 //Resuelve un nombre de la tabla maestra a su ID numérico correspondiente
 
export function resolverIdMaestra(tabla, valor, campo = 'nombre') {
    const texto = String(valor || '').trim();
    if (!texto) return null;

    const existente = tabla.find(item => String(item[campo] || '').trim().toLowerCase() === texto.toLowerCase());
    if (existente) return existente.id;

    const nuevoId = tabla.length > 0 ? Math.max(...tabla.map(item => Number(item.id) || 0)) + 1 : 1;
    tabla.push({ id: nuevoId, [campo]: texto });
    return nuevoId;
}
