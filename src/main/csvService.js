import fs from 'fs';
import { getDb, dbQueryAll, dbQueryGet, resolveId, dbPath, csvPath, csvPathsCandidates } from './db.js';

let isWritingCSV = false;
let watchTimeout = null;
const activeWatchers = new Map();

export function getIsWritingCSV() {
    return isWritingCSV;
}

/**
 * Limpia espacios y comillas dobles alrededor de los valores de celdas CSV de Excel
 */
function limpiarCelda(valor) {
    if (!valor) return '';
    let val = valor.trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1);
    }
    return val.replace(/""/g, '"').trim();
}

/**
 * Lee un archivo de texto detectando automáticamente la codificación (UTF-8 BOM, UTF-8, Latin1)
 */
function leerArchivoTexto(filePath) {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return buffer.toString('utf-8', 3);
    }
    const utf8Str = buffer.toString('utf-8');
    if (!utf8Str.includes('\uFFFD')) {
        return utf8Str;
    }
    return buffer.toString('latin1');
}

/**
 * Importa asincrónicamente el archivo CSV a la base de datos SQLite y notifica cambios a la UI
 */
export async function importarCSV(filePath = csvPath, notifyUI = null) {
    const targetPath = filePath || csvPath;
    if (!fs.existsSync(targetPath)) return;
    console.log(`Leyendo e importando cambios del archivo CSV: ${targetPath}`);

    const contenido = leerArchivoTexto(targetPath);
    const lineas = contenido.split(/\r?\n/);
    if (lineas.length === 0) return;

    // Detectar separador (';' o ',')
    let separador = ';';
    const primeraLinea = lineas[0] || '';
    if (!primeraLinea.includes(';') && primeraLinea.includes(',')) {
        separador = ',';
    }

    const rowsToProcess = [];
    for (const linea of lineas) {
        const lineaLimpia = linea.trim();
        if (lineaLimpia === "" || 
            lineaLimpia.startsWith("Plantilla") || 
            /^;+$/.test(lineaLimpia) || 
            lineaLimpia.toLowerCase().includes("id / código") || 
            lineaLimpia.toLowerCase().includes("id_libro") ||
            lineaLimpia.toLowerCase().includes("título del libro")) {
            continue;
        }
        const celdasRaw = lineaLimpia.split(separador);
        const celdas = celdasRaw.map(limpiarCelda);
        rowsToProcess.push(celdas);
    }

    const db = getDb();
    try {
        db.run("BEGIN TRANSACTION");

        for (const celdas of rowsToProcess) {
            if (celdas.length >= 6) {
                const codigoStr = celdas[0];
                const codigo = parseInt(codigoStr, 10);
                if (Number.isNaN(codigo)) continue;

                const titulo = celdas[1];
                if (!titulo) continue;

                const autor = celdas[2] || 'Anónimo';
                const nombreEditorial = celdas[3];
                const nombreAsignatura = celdas[4];
                const cantidad = parseInt(celdas[5], 10) || 0;
                
                const idEditorial = resolveId('editoriales', nombreEditorial);
                const idAsignatura = resolveId('asignatura', nombreAsignatura);
                const idEstado = 1;

                let cantidadDisponible = celdas.length >= 7 && celdas[6] !== '' ? parseInt(celdas[6], 10) : cantidad;
                if (Number.isNaN(cantidadDisponible)) {
                    cantidadDisponible = cantidad;
                }

                const libroExistente = dbQueryGet("SELECT cantidad, cantidad_disponible FROM libros WHERE codigo = ?", [codigo]);
                if (libroExistente && (celdas.length < 7 || celdas[6] === '')) {
                    const reservasActivas = libroExistente.cantidad - libroExistente.cantidad_disponible;
                    cantidadDisponible = Math.max(0, cantidad - reservasActivas);
                }

                const numeroCurso = celdas.length >= 9 && celdas[8] !== '' ? parseInt(celdas[8], 10) : null;

                db.run(`
                    INSERT OR REPLACE INTO libros (
                        codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, numero_curso, id_asignatura
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    codigo,
                    titulo,
                    autor,
                    idEditorial,
                    cantidad,
                    cantidadDisponible,
                    idEstado,
                    numeroCurso,
                    idAsignatura
                ]);
            }
        }

        db.run("COMMIT");

        // Guardamos la base de datos
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);

        console.log("¡Catálogo sincronizado exitosamente con SQLite!");

        if (typeof notifyUI === 'function') {
            notifyUI();
        }
    } catch (err) {
        db.run("ROLLBACK");
        console.error("Error al ejecutar la transacción de importación:", err);
        throw err;
    }
}

/**
 * Reintento de importación para evitar fallos si Excel tiene el archivo bloqueado
 */
export async function importarCSVConReintento(filePath = csvPath, intento = 1, notifyUI = null) {
    try {
        await importarCSV(filePath, notifyUI);
    } catch (err) {
        if (intento <= 3 && (err.code === 'EBUSY' || err.code === 'EPERM')) {
            console.log(`El archivo CSV está siendo guardado por Excel. Reintentando en 500ms (intento ${intento})...`);
            setTimeout(() => importarCSVConReintento(filePath, intento + 1, notifyUI), 500);
        } else {
            console.error("Error definitivo al importar el archivo CSV:", err);
        }
    }
}

/**
 * Exporta el catálogo de SQLite a CSV con formato Excel en español a todas las rutas conocidas
 */
export function exportarCSV(filePath = csvPath) {
    try {
        isWritingCSV = true;
        const targetPaths = Array.from(new Set([filePath || csvPath, ...csvPathsCandidates]));
        
        const libros = dbQueryAll(`
            SELECT l.codigo, l.titulo, l.autor, e.nombre as editorial, a.nombre as asignatura, l.cantidad, l.cantidad_disponible, es.condicion as estado, l.numero_curso
            FROM libros l
            LEFT JOIN editoriales e ON l.id_editorial = e.id
            LEFT JOIN asignatura a ON l.id_asignatura = a.id
            LEFT JOIN estados es ON l.id_estado = es.id
        `);

        const lines = [
            "ID / Código;Título del Libro;Autor;Editorial;Asignatura;Cantidad;Cantidad_Disponible;Estado (Nuevo/Usado);Numero_Curso"
        ];

        libros.forEach(l => {
            const line = [
                l.codigo,
                l.titulo || '',
                l.autor || '',
                l.editorial || '',
                l.asignatura || '',
                l.cantidad,
                l.cantidad_disponible,
                l.estado || 'Nuevo',
                l.numero_curso || ''
            ].join(';');
            lines.push(line);
        });

        const content = lines.join('\n');

        targetPaths.forEach(p => {
            try {
                fs.writeFileSync(p, content, { encoding: 'latin1' });
                console.log(`¡CSV de Excel exportado exitosamente a: ${p}!`);
            } catch (err) {
                console.warn(`No se pudo escribir CSV en ${p}:`, err.message);
            }
        });
    } catch (err) {
        console.error("Error al exportar a CSV:", err);
    } finally {
        setTimeout(() => {
            isWritingCSV = false;
        }, 1200);
    }
}

/**
 * Inicia la vigilancia de cambios en tiempo real en todas las rutas posibles del CSV
 */
export function iniciarVigilanteCSV(notifyUI = null) {
    const pathsToWatch = Array.from(new Set(csvPathsCandidates));
    
    pathsToWatch.forEach(p => {
        fijarVigilanteParaRuta(p, notifyUI);
    });
}

function fijarVigilanteParaRuta(filePath, notifyUI) {
    if (activeWatchers.has(filePath)) {
        try { activeWatchers.get(filePath).close(); } catch (e) {}
        activeWatchers.delete(filePath);
    }

    if (!fs.existsSync(filePath)) return;

    try {
        console.log(`Iniciando vigilancia en CSV: ${filePath}`);
        const w = fs.watch(filePath, (eventType) => {
            if (isWritingCSV) return;

            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(() => {
                console.log(`Cambio [${eventType}] detectado en CSV (${filePath}). Sincronizando con SQLite...`);
                importarCSVConReintento(filePath, 1, notifyUI);
                // Re-enganchar watcher tras guardado de Excel
                fijarVigilanteParaRuta(filePath, notifyUI);
            }, 400);
        });
        activeWatchers.set(filePath, w);
    } catch (err) {
        console.error(`Error al suscribirse al archivo CSV (${filePath}):`, err);
    }
}
