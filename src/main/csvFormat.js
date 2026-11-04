// Formato CSV de intercambio con Excel: decodificación, parseo, validación y serialización.
// Es lógica pura (sin Electron ni base de datos) para poder probarla de forma aislada.

export const ENCABEZADOS = [
    'ID / Código',
    'Título del Libro',
    'Autor',
    'Editorial',
    'Asignatura',
    'Cantidad',
    'Cantidad_Disponible',
    'Estado (Nuevo/Usado)',
    'Numero_Curso'
];

// Campo interno -> posibles nombres de columna (ya normalizados, ver normalizarClave)
const ALIAS_COLUMNAS = {
    codigo: ['idcodigo', 'codigo', 'id', 'idlibro', 'cod', 'codigolibro'],
    titulo: ['titulodellibro', 'titulo', 'nombre'],
    autor: ['autor', 'autores'],
    editorial: ['editorial'],
    asignatura: ['asignatura', 'materia'],
    cantidad: ['cantidad', 'cantidadtotal', 'stock', 'ejemplares'],
    disponible: ['cantidaddisponible', 'disponible', 'disponibles'],
    estado: ['estadonuevousado', 'estado', 'condicion'],
    curso: ['numerocurso', 'curso', 'ncurso']
};

// Orden por defecto cuando el archivo no trae encabezados
const ORDEN_POSICIONAL = ['codigo', 'titulo', 'autor', 'editorial', 'asignatura', 'cantidad', 'disponible', 'estado', 'curso'];

/** Minúsculas, sin tildes ni símbolos: "ID / Código" -> "idcodigo" */
function normalizarClave(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Convierte los bytes del archivo a texto. Excel en Windows guarda CSV "normal" en
 * Windows-1252 y "CSV UTF-8" con BOM: se prueba UTF-8 estricto y, si falla, 1252.
 */
export function decodificar(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(buffer.subarray(3));
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return new TextDecoder('windows-1252').decode(buffer);
    }
}

/** Elige el separador mirando la primera línea con contenido (Excel usa ';' o ',' según la región) */
export function detectarDelimitador(texto) {
    const lineas = texto.split(/\r?\n/);
    for (const linea of lineas) {
        const limpia = linea.trim();
        if (!limpia) continue;
        const marca = limpia.match(/^sep=(.)$/i); // línea especial que Excel entiende
        if (marca) return marca[1];
        const conteo = { ';': 0, ',': 0, '\t': 0 };
        let entreComillas = false;
        for (const c of limpia) {
            if (c === '"') entreComillas = !entreComillas;
            else if (!entreComillas && c in conteo) conteo[c]++;
        }
        const mejor = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
        return mejor[1] > 0 ? mejor[0] : ';';
    }
    return ';';
}

/**
 * Parser CSV (RFC 4180): respeta comillas, comillas escapadas ("") y saltos de línea
 * dentro de una celda. Devuelve filas como arreglos de strings con su número de línea original.
 */
export function parsearCSV(texto, delimitador = ';') {
    const filas = [];
    let fila = [];
    let celda = '';
    let entreComillas = false;
    let linea = 1;
    let lineaInicioFila = 1;

    const cerrarFila = () => {
        fila.push(celda);
        filas.push({ linea: lineaInicioFila, celdas: fila });
        fila = [];
        celda = '';
        lineaInicioFila = linea;
    };

    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (entreComillas) {
            if (c === '"') {
                if (texto[i + 1] === '"') { celda += '"'; i++; }
                else entreComillas = false;
            } else {
                if (c === '\n') linea++;
                celda += c;
            }
        } else if (c === '"' && celda === '') {
            entreComillas = true;
        } else if (c === delimitador) {
            fila.push(celda);
            celda = '';
        } else if (c === '\r' || c === '\n') {
            if (c === '\r' && texto[i + 1] === '\n') i++;
            linea++;
            cerrarFila();
        } else {
            celda += c;
        }
    }
    if (celda !== '' || fila.length > 0) cerrarFila();
    return filas;
}

/** Escapa una celda para escribirla en CSV */
function escaparCelda(valor, delimitador) {
    const s = valor === null || valor === undefined ? '' : String(valor);
    if (s.includes('"') || s.includes(delimitador) || /[\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Genera el contenido del CSV para Excel: UTF-8 con BOM (conserva tildes y símbolos),
 * separador ';' y fin de línea CRLF.
 */
export function serializarCSV(filas, delimitador = ';') {
    const lineas = [ENCABEZADOS, ...filas].map(f => f.map(v => escaparCelda(v, delimitador)).join(delimitador));
    return Buffer.from('﻿' + lineas.join('\r\n') + '\r\n', 'utf-8');
}

/** Busca la fila de encabezados entre las primeras filas (puede haber títulos de plantilla antes) */
function localizarEncabezado(filas) {
    const limite = Math.min(filas.length, 15);
    for (let i = 0; i < limite; i++) {
        const mapa = {};
        let coincidencias = 0;
        filas[i].celdas.forEach((celda, idx) => {
            const clave = normalizarClave(celda);
            for (const [campo, alias] of Object.entries(ALIAS_COLUMNAS)) {
                if (alias.includes(clave) && mapa[campo] === undefined) {
                    mapa[campo] = idx;
                    coincidencias++;
                }
            }
        });
        if (coincidencias >= 3 && mapa.codigo !== undefined && mapa.titulo !== undefined) {
            return { indice: i, mapa };
        }
    }
    return null;
}

function parsearEntero(texto) {
    const limpio = String(texto ?? '').trim().replace(',', '.');
    if (!/^-?\d+(\.0+)?$/.test(limpio)) return NaN; // acepta "5" y "5.0" (típico de Excel)
    return Math.trunc(Number(limpio));
}

/**
 * Convierte el contenido de un CSV en libros normalizados.
 * @returns {{ libros: object[], errores: {linea:number, motivo:string}[], advertencias: string[] }}
 *   Una fila inválida no frena al resto: se informa en `errores` y se omite.
 */
export function leerLibros(texto) {
    const delimitador = detectarDelimitador(texto);
    const filas = parsearCSV(texto, delimitador)
        .filter(f => !/^sep=.$/i.test((f.celdas[0] ?? '').trim()) || f.celdas.length > 1);

    const encabezado = localizarEncabezado(filas);
    let mapa;
    let inicio;
    if (encabezado) {
        mapa = encabezado.mapa;
        inicio = encabezado.indice + 1;
    } else {
        mapa = Object.fromEntries(ORDEN_POSICIONAL.map((campo, idx) => [campo, idx]));
        inicio = 0;
    }

    const libros = [];
    const errores = [];
    const advertencias = [];
    const vistos = new Map(); // codigo -> índice en `libros`

    // undefined = la columna no existe en el archivo (se conserva el valor actual de la base)
    const celda = (f, campo) => (mapa[campo] === undefined ? undefined : String(f.celdas[mapa[campo]] ?? '').trim());

    for (let i = inicio; i < filas.length; i++) {
        const f = filas[i];
        if (f.celdas.every(c => c.trim() === '')) continue; // fila vacía o ";;;;"
        const primera = f.celdas[0].trim();
        if (f.celdas.length === 1 && /^plantilla/i.test(primera)) continue;

        const codigo = parsearEntero(celda(f, 'codigo'));
        if (!Number.isInteger(codigo) || codigo < 1) {
            errores.push({ linea: f.linea, motivo: `código inválido "${celda(f, 'codigo')}" (debe ser un número entero positivo)` });
            continue;
        }
        const titulo = celda(f, 'titulo');
        if (!titulo) {
            errores.push({ linea: f.linea, motivo: `el libro ${codigo} no tiene título` });
            continue;
        }

        let cantidad = 1;
        const textoCantidad = celda(f, 'cantidad');
        if (textoCantidad) {
            cantidad = parsearEntero(textoCantidad);
            if (!Number.isInteger(cantidad) || cantidad < 0) {
                errores.push({ linea: f.linea, motivo: `cantidad inválida "${textoCantidad}" en el libro ${codigo}` });
                continue;
            }
        }

        let curso;
        const textoCurso = celda(f, 'curso');
        if (textoCurso !== undefined) {
            if (textoCurso === '') curso = null;
            else {
                curso = parsearEntero(textoCurso);
                if (!Number.isInteger(curso)) {
                    advertencias.push(`Línea ${f.linea}: número de curso inválido "${textoCurso}" (se dejó vacío).`);
                    curso = null;
                }
            }
        }

        const libro = {
            linea: f.linea,
            codigo,
            titulo,
            autor: celda(f, 'autor') || 'Anónimo',
            editorial: celda(f, 'editorial') || '',
            asignatura: celda(f, 'asignatura') || '',
            cantidad,
            estado: celda(f, 'estado') || '',
            curso
        };

        if (vistos.has(codigo)) {
            advertencias.push(`El código ${codigo} aparece repetido (líneas ${libros[vistos.get(codigo)].linea} y ${f.linea}): se usó la última.`);
            libros[vistos.get(codigo)] = libro;
        } else {
            vistos.set(codigo, libros.length);
            libros.push(libro);
        }
    }

    return { libros, errores, advertencias };
}
