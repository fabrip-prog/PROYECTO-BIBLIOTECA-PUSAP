import fs from 'fs';
import readline from 'readline';
import { getDb, dbQueryAll, dbQueryGet, resolveId, dbPath, csvPath } from './db.js';

let isWritingCSV = false;
let watchTimeout = null;

export function getIsWritingCSV() {
    return isWritingCSV;
}

/**
 * Importa asincrónicamente el archivo CSV a la base de datos SQLite y notifica cambios a la UI
 */
export async function importarCSV(filePath = csvPath, notifyUI = null) {
    const targetPath = filePath || csvPath;
    if (!fs.existsSync(targetPath)) return;
    console.log(`Leyendo e importando cambios del archivo CSV: ${targetPath}`);
    
    const stream = fs.createReadStream(targetPath, { encoding: 'latin1' });
    const lector = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });

    const rowsToProcess = [];
    for await (const linea of lector) {
        const lineaLimpia = linea.trim();
        if (lineaLimpia === "" || 
            lineaLimpia.startsWith("Plantilla") || 
            /^;+$/.test(lineaLimpia) || 
            lineaLimpia.toLowerCase().includes("id / código") || 
            lineaLimpia.toLowerCase().includes("id_libro") ||
            lineaLimpia.toLowerCase().includes("título del libro")) {
            continue;
        }
        const celdas = lineaLimpia.split(';');
        rowsToProcess.push(celdas);
    }

    const db = getDb();
    try {
        db.run("BEGIN TRANSACTION");

        for (const celdas of rowsToProcess) {
            if (celdas.length >= 6) {
                const codigo = parseInt(celdas[0]);
                if (Number.isNaN(codigo)) continue;

                const titulo = celdas[1]?.trim();
                if (!titulo) continue;

                const autor = celdas[2]?.trim() || 'Anónimo';
                const nombreEditorial = celdas[3]?.trim();
                const nombreAsignatura = celdas[4]?.trim();
                const cantidad = parseInt(celdas[5]) || 0;
                
                const idEditorial = resolveId('editoriales', nombreEditorial);
                const idAsignatura = resolveId('asignatura', nombreAsignatura);
                const idEstado = 1;

                const libroExistente = dbQueryGet("SELECT cantidad, cantidad_disponible FROM libros WHERE codigo = ?", [codigo]);
                let cantidadDisponible = cantidad;

                if (libroExistente) {
                    const reservasActivas = libroExistente.cantidad - libroExistente.cantidad_disponible;
                    cantidadDisponible = Math.max(0, cantidad - reservasActivas);
                }

                const numeroCurso = parseInt(celdas[8]) || null;

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

        // Guardamos la base de datos sin disparar la exportación en bucle
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);

        console.log("¡Catálogo sincronizado exitosamente con SQLite!");

        // Avisar al frontend para actualizar la visualización
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
 * Exporta el catálogo de SQLite a CSV con formato Excel en español (codificación Latin1 y separador ;)
 */
export function exportarCSV(filePath = csvPath) {
    const targetPath = filePath || csvPath;
    try {
        isWritingCSV = true;
        console.log(`Exportando catálogo a CSV compatible con Excel: ${targetPath}`);
        
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

        fs.writeFileSync(targetPath, lines.join('\n'), { encoding: 'latin1' });
        console.log("¡CSV de Excel exportado exitosamente!");
    } catch (err) {
        console.error("Error al exportar a CSV:", err);
    } finally {
        setTimeout(() => {
            isWritingCSV = false;
        }, 1000);
    }
}

/**
 * Inicia la vigilancia de cambios en tiempo real del archivo CSV para el auto-sync bidireccional
 */
export function iniciarVigilanteCSV(notifyUI = null) {
    if (!fs.existsSync(csvPath)) return;
    
    console.log(`Iniciando vigilancia de cambios en el CSV: ${csvPath}`);
    fs.watch(csvPath, (eventType) => {
        if (eventType === 'change') {
            if (isWritingCSV) return;
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(() => {
                console.log("Cambio detectado en el archivo CSV. Sincronizando...");
                importarCSVConReintento(csvPath, 1, notifyUI);
            }, 500);
        }
    });
}
