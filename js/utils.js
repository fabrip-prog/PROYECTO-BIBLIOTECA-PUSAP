import { db_tablas_maestras } from './state.js';

export { db_tablas_maestras };

const ENTIDADES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Neutraliza cualquier texto antes de insertarlo con innerHTML. Los títulos, autores y usuarios
 * vienen de la base y del CSV de Excel: sin esto, una celda con HTML se ejecutaría en la interfaz.
 */
export function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caracter => ENTIDADES_HTML[caracter]);
}

export function transformarCSV(textoBruto) {
    const lineas = textoBruto.split(/\r?\n/);
    const matrizDatos = [];

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        
        if (linea === "" || 
            linea.startsWith("Plantilla") || 
            /^;+$/.test(linea) || 
            linea.toLowerCase().includes("id / código") || 
            linea.toLowerCase().includes("id_libro") ||
            linea.toLowerCase().includes("título del libro")) {
            continue;
        } 

        const celdas = linea.split(";"); 
        matrizDatos.push(celdas);
    }
    return matrizDatos;
}

/**
 * BLINDAJE SQL: Valida restricciones de integridad, tipos de datos, nulos y llaves foráneas.
 * Simula las restricciones de la base de datos relacional formal.
 */
export function validarRestriccionesSQL(libro) {
    // 1. Blindar ante Campos Nulos u Obligatorios (NOT NULL)
    if (libro.codigo === undefined || libro.codigo === null || String(libro.codigo).trim() === "") {
        return { valido: false, error: "VIOLACIÓN DE INTEGRIDAD: El campo 'codigo' (PK) no puede ser NULO." };
    }
    if (!libro.titulo || String(libro.titulo).trim() === "") {
        return { valido: false, error: "VIOLACIÓN DE INTEGRIDAD: El campo 'titulo' posee una restricción NOT NULL." };
    }
    if (!libro.autor || String(libro.autor).trim() === "") {
        return { valido: false, error: "VIOLACIÓN DE INTEGRIDAD: El campo 'autor' posee una restricción NOT NULL." };
    }

    // 2. Blindar ante Registros Inválidos o tipos incorrectos (Restricciones CHECK)
    if (isNaN(libro.cantidad) || libro.cantidad < 0) {
        return { valido: false, error: "RESTRICCIÓN CHECK VIOLADA: 'cantidad' debe ser un entero positivo (>= 0)." };
    }
    if (isNaN(libro.cantidad_disponible) || libro.cantidad_disponible < 0) {
        return { valido: false, error: "RESTRICCIÓN CHECK VIOLADA: 'cantidad_disponible' debe ser un entero positivo (>= 0)." };
    }
    if (libro.cantidad_disponible > libro.cantidad) {
        return { valido: false, error: "RESTRICCIÓN CHECK VIOLADA: La cantidad disponible no puede ser mayor al stock total." };
    }

    // 3. Blindar ante Violaciones de Llaves Foráneas (FOREIGN KEY CONSTRAINTS)
    const existeEditorial = db_tablas_maestras.editoriales.some(e => e.id === Number(libro.id_editorial));
    if (!existeEditorial) {
        return { valido: false, error: `VIOLACIÓN DE LLAVE FORÁNEA: id_editorial (${libro.id_editorial}) no existe en la tabla 'editoriales'.` };
    }

    const existeAsignatura = db_tablas_maestras.asignatura.some(a => a.id === Number(libro.id_asignatura));
    if (!existeAsignatura) {
        return { valido: false, error: `VIOLACIÓN DE LLAVE FORÁNEA: id_asignatura (${libro.id_asignatura}) no existe en la tabla 'asignatura'.` };
    }

    const existeEstado = db_tablas_maestras.estados.some(es => es.id === Number(libro.id_estado));
    if (!existeEstado) {
        return { valido: false, error: `VIOLACIÓN DE LLAVE FORÁNEA: id_estado (${libro.id_estado}) no existe en la tabla 'estados'.` };
    }

    return { valido: true, error: null };
}