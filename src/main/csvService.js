// Sincronización bidireccional entre la base SQLite y el CSV que se abre con Excel.
//
// Cómo se mantiene la coherencia:
//  - meta.csv_hash guarda el hash del CSV que ya está reflejado en la base. Si el archivo en disco
//    tiene otro hash, alguien lo editó por fuera (Excel, bloc de notas) y se importa. Si coincide,
//    no hay nada que hacer. Esto también evita el "eco": lo que la app escribe no se vuelve a importar.
//  - meta.csv_pendiente = '1' marca que la base tiene cambios que todavía no llegaron al CSV
//    (p. ej. porque Excel lo tenía abierto). Sobrevive a reinicios y se reintenta hasta lograrlo.
//  - Importar es "espejo" (el CSV manda: se eliminan los libros que ya no figuran y no tienen
//    reservas) salvo que haya cambios pendientes o falten garantías, en cuyo caso es "fusión"
//    (solo agrega y actualiza, nunca borra).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    rutas, dbQueryAll, dbQueryGet, getMeta, setMeta, guardarEnDisco, escribirAtomico,
    transaccion, recalcularDisponibilidad, respaldarAntesDe, getDb
} from './db.js';
import { decodificar, leerLibros, serializarCSV } from './csvFormat.js';
import { upsertLibro, catalogoVacio, sembrarCatalogoBase } from './catalogo.js';

const config = {
    demoraWatchMs: 600,       // espera tras el último evento del archivo (Excel dispara varios al guardar)
    demoraExportMs: 250,      // agrupa varios cambios seguidos de la app en una sola escritura
    reintentoExportMs: 5000,  // cada cuánto reintenta escribir si el CSV está bloqueado
    intentosLectura: 5,
    esperaLecturaMs: 400
};

/** Permite ajustar tiempos (los tests los acortan) */
export function configurarSincronizacion(parcial) {
    Object.assign(config, parcial);
}

const ERRORES_BLOQUEO = ['EBUSY', 'EPERM', 'EACCES'];

let notificar = () => {};
let watcher = null;
let temporizadorWatch = null;
let temporizadorExport = null;
let temporizadorReintento = null;
let reiniciarWatcher = null;
let cola = Promise.resolve();
let hashConocido = null;
const estadoSync = { estado: 'inactivo', mensaje: 'Sincronización con Excel inactiva', ultimaSync: null, archivo: '' };

const sha1 = datos => crypto.createHash('sha1').update(datos).digest('hex');
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Serializa importaciones para que nunca se pisen. Quien llama recibe el error real si la tarea falla. */
function encolar(tarea) {
    const ejecucion = cola.then(tarea);
    cola = ejecucion.catch(() => {}); // la cola no queda rota por una tarea fallida
    return ejecucion;
}

function desprender(temporizador) {
    if (temporizador && typeof temporizador.unref === 'function') temporizador.unref();
    return temporizador;
}

// ---------------------------------------------------------------------------
// Estado visible en la interfaz
// ---------------------------------------------------------------------------

export function getEstadoSync() {
    return { ...estadoSync };
}

function actualizarEstado(estado, mensaje) {
    const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const ultimaSync = estado === 'sincronizado' ? new Date().toISOString() : estadoSync.ultimaSync;
    const texto = mensaje || (estado === 'sincronizado' ? `Sincronizado con Excel · ${hora}` : '');
    if (estadoSync.estado === estado && estadoSync.mensaje === texto) return;
    Object.assign(estadoSync, { estado, mensaje: texto, ultimaSync, archivo: rutas.csv });
    notificar('sync-estado', getEstadoSync());
}

// ---------------------------------------------------------------------------
// Importación (CSV -> base)
// ---------------------------------------------------------------------------

function describirResumen(r) {
    const partes = [];
    if (r.insertados) partes.push(`${r.insertados} nuevo(s)`);
    if (r.actualizados) partes.push(`${r.actualizados} actualizado(s)`);
    if (r.eliminados) partes.push(`${r.eliminados} eliminado(s)`);
    if (r.conservados) partes.push(`${r.conservados} conservado(s) por tener reservas`);
    let texto = partes.length ? partes.join(', ') : 'sin cambios en el catálogo';
    if (r.errores.length) texto += `; ${r.errores.length} fila(s) ignorada(s)`;
    return texto;
}

/**
 * Vuelca el contenido de un CSV en la base. No guarda a disco: lo hace quien llama.
 * @param {'fusion'|'espejo'} modo  fusión = agrega/actualiza; espejo = además elimina lo que ya no figura
 */
export function importarBuffer(buffer, { modo = 'fusion' } = {}) {
    const { libros, errores, advertencias } = leerLibros(decodificar(buffer));
    const resumen = { insertados: 0, actualizados: 0, sinCambios: 0, eliminados: 0, conservados: 0, errores, advertencias, modo };

    // Qué libros de la base ya no figuran en el archivo
    let eliminables = [];
    if (modo === 'espejo') {
        const codigosArchivo = new Set(libros.map(l => l.codigo));
        const enBase = dbQueryAll('SELECT codigo, titulo FROM libros');
        const ausentes = enBase.filter(b => !codigosArchivo.has(b.codigo));
        for (const libro of ausentes) {
            const { n } = dbQueryGet('SELECT COUNT(*) AS n FROM reservas WHERE codigo_libro = ?', [libro.codigo]);
            if (n > 0) {
                resumen.conservados++;
                advertencias.push(`El libro ${libro.codigo} "${libro.titulo}" ya no está en el CSV pero se conservó porque tiene reservas.`);
            } else {
                eliminables.push(libro);
            }
        }

        // Frenos de seguridad: un archivo truncado o con errores no debe vaciar el catálogo
        if (libros.length === 0 && enBase.length > 0) {
            if (ausentes.length) advertencias.push('El CSV no contiene libros válidos: no se eliminó nada.');
            eliminables = [];
        } else if (errores.length > 0 && eliminables.length > 0) {
            advertencias.push(`No se eliminaron ${eliminables.length} libro(s) porque el CSV tiene filas con errores y no se puede asegurar que estén realmente borrados.`);
            eliminables = [];
        } else if (eliminables.length > Math.max(3, Math.floor(enBase.length / 2))) {
            advertencias.push(`El CSV tiene muchos menos libros que la base (${libros.length} de ${enBase.length}): por seguridad no se eliminó ninguno. Si es intencional, borralos desde la app.`);
            eliminables = [];
        }
    }

    if (eliminables.length > 0) respaldarAntesDe('antes-de-sincronizar');

    const erroresDeLectura = errores.length; // `errores` es el mismo arreglo que resumen.errores: se fija el tamaño antes de seguir
    transaccion(() => {
        for (const libro of libros) {
            try {
                const resultado = upsertLibro(libro);
                if (resultado === 'insertado') resumen.insertados++;
                else if (resultado === 'actualizado') resumen.actualizados++;
                else resumen.sinCambios++;
            } catch (err) {
                resumen.errores.push({ linea: libro.linea, motivo: `libro ${libro.codigo}: ${err.message}` });
            }
        }
        // Si algo falló en medio no se borra nada (mismo criterio que arriba)
        if (eliminables.length > 0 && resumen.errores.length === erroresDeLectura) {
            for (const libro of eliminables) {
                getDb().run('DELETE FROM libros WHERE codigo = ?', [libro.codigo]);
                resumen.eliminados++;
            }
        }
        recalcularDisponibilidad();
    });

    // Si se bajó la cantidad por debajo de lo que está prestado, la disponibilidad queda en 0
    const sobrePrestados = dbQueryAll(`
        SELECT l.codigo, l.titulo, l.cantidad, COUNT(*) AS prestados
        FROM libros l JOIN reservas r ON r.codigo_libro = l.codigo AND r.estado <> 'Devuelta'
        GROUP BY l.codigo HAVING COUNT(*) > l.cantidad
    `);
    sobrePrestados.forEach(l => advertencias.push(
        `El libro ${l.codigo} "${l.titulo}" tiene ${l.prestados} ejemplar(es) prestado(s) pero la cantidad es ${l.cantidad}.`));

    resumen.huboCambios = resumen.insertados + resumen.actualizados + resumen.eliminados > 0;
    resumen.mensaje = describirResumen(resumen);
    return resumen;
}

/**
 * Importa el CSV de sincronización y deja base y archivo coherentes.
 * 'auto' = espejo, salvo que haya cambios de la app sin enviar al CSV (entonces fusión).
 */
function aplicarCSV(buffer, modo = 'auto') {
    const modoReal = modo === 'auto' ? (getMeta('csv_pendiente') === '1' ? 'fusion' : 'espejo') : modo;
    const hash = sha1(buffer);
    const resumen = importarBuffer(buffer, { modo: modoReal });
    setMeta('csv_hash', hash);
    hashConocido = hash;
    guardarEnDisco();

    // Reescribe el CSV en su forma canónica (disponibilidad recalculada, codificación UTF-8).
    // Si Excel lo tiene abierto y no hay nada pendiente, se omite sin alarmar.
    intentarExportar();
    if (getMeta('csv_pendiente') !== '1') actualizarEstado('sincronizado');
    return resumen;
}

async function leerConReintento(ruta) {
    let ultimo;
    for (let i = 0; i < config.intentosLectura; i++) {
        try {
            return fs.readFileSync(ruta);
        } catch (err) {
            ultimo = err;
            if (!ERRORES_BLOQUEO.includes(err.code)) throw err;
            await esperar(config.esperaLecturaMs); // Excel suele tener el archivo ocupado un instante al guardar
        }
    }
    throw ultimo;
}

/** Reacciona a un cambio del CSV hecho fuera de la app */
async function procesarCambioExterno() {
    let buffer;
    try {
        buffer = await leerConReintento(rutas.csv);
    } catch (err) {
        if (err.code !== 'ENOENT') actualizarEstado('error', `No se pudo leer el CSV: ${err.message}`);
        return; // si fue borrado, se recrea en la próxima escritura
    }
    if (buffer.length === 0) return;                // Excel está a mitad de guardado
    if (sha1(buffer) === hashConocido) return;      // es lo que la app misma escribió

    try {
        const resumen = aplicarCSV(buffer, 'auto');
        console.log(`CSV modificado externamente: ${resumen.mensaje}`);
        if (resumen.huboCambios || resumen.errores.length || resumen.advertencias.length) {
            notificar('db-actualizada', { origen: 'excel', mensaje: resumen.mensaje, errores: resumen.errores, advertencias: resumen.advertencias });
        }
    } catch (err) {
        console.error('Error al importar el CSV modificado:', err);
        actualizarEstado('error', `No se pudo importar el CSV: ${err.message}`);
    }
}

/**
 * Botón "Sincronizar con Excel": lee el CSV vigente y lo refleja en la base
 */
export function sincronizarAhora() {
    return encolar(async () => {
        if (!fs.existsSync(rutas.csv)) {
            registrarCambio();
            return { success: true, resumen: null, mensaje: 'El CSV no existía: se generó desde la base.' };
        }
        const buffer = await leerConReintento(rutas.csv);
        const resumen = aplicarCSV(buffer, 'auto');
        return { success: true, resumen, mensaje: resumen.mensaje };
    });
}

/**
 * Importa un CSV elegido por el usuario. Siempre en modo fusión: cargar una lista parcial
 * nunca borra el catálogo. El resultado se envía luego al CSV de sincronización.
 */
export function importarArchivo(ruta) {
    return encolar(async () => {
        const buffer = await leerConReintento(ruta);
        const resumen = importarBuffer(buffer, { modo: 'fusion' });
        registrarCambio();
        return { success: true, resumen, mensaje: resumen.mensaje };
    });
}

// ---------------------------------------------------------------------------
// Exportación (base -> CSV)
// ---------------------------------------------------------------------------

export function generarContenidoCSV() {
    const libros = dbQueryAll(`
        SELECT l.codigo, l.titulo, l.autor, e.nombre AS editorial, a.nombre AS asignatura,
               l.cantidad, l.cantidad_disponible, es.condicion AS estado, l.numero_curso
        FROM libros l
        LEFT JOIN editoriales e ON l.id_editorial = e.id
        LEFT JOIN asignatura a ON l.id_asignatura = a.id
        LEFT JOIN estados es ON l.id_estado = es.id
        ORDER BY l.codigo
    `);
    return serializarCSV(libros.map(l => [
        l.codigo, l.titulo, l.autor, l.editorial ?? '', l.asignatura ?? '',
        l.cantidad, l.cantidad_disponible, l.estado ?? 'Nuevo', l.numero_curso ?? ''
    ]));
}

function marcarSincronizado(hash) {
    hashConocido = hash;
    if (getMeta('csv_hash') === hash && getMeta('csv_pendiente') === '0') return;
    setMeta('csv_hash', hash);
    setMeta('csv_pendiente', '0');
    guardarEnDisco();
}

/**
 * Escribe la base en el CSV (atómico). No lanza: informa si el archivo está bloqueado.
 */
export function exportarCSV() {
    try {
        const contenido = generarContenidoCSV();
        const hash = sha1(contenido);
        let igual = false;
        try { igual = fs.existsSync(rutas.csv) && sha1(fs.readFileSync(rutas.csv)) === hash; } catch { /* se intentará escribir */ }
        if (!igual) {
            try {
                escribirAtomico(rutas.csv, contenido);
            } catch (err) {
                const bloqueado = ERRORES_BLOQUEO.includes(err.code);
                return { success: false, bloqueado, error: bloqueado ? 'El CSV está abierto en otro programa (Excel).' : err.message };
            }
        }
        marcarSincronizado(hash);
        return { success: true, escrito: !igual };
    } catch (err) {
        console.error('Error al exportar a CSV:', err);
        return { success: false, error: err.message };
    }
}

/** Exporta y, si hay cambios pendientes que no pudieron salir, mantiene el reintento y avisa */
function intentarExportar() {
    clearTimeout(temporizadorReintento);
    const critico = getMeta('csv_pendiente') === '1';
    const resultado = exportarCSV();

    if (resultado.success) {
        actualizarEstado('sincronizado');
    } else if (critico) {
        actualizarEstado(
            resultado.bloqueado ? 'bloqueado' : 'error',
            resultado.bloqueado
                ? 'El CSV está abierto en Excel: los cambios de la app se copiarán cuando lo cierres.'
                : `No se pudo escribir el CSV: ${resultado.error}`
        );
        temporizadorReintento = desprender(setTimeout(intentarExportar, config.reintentoExportMs));
    }
    return resultado;
}

/**
 * Debe llamarse después de cada modificación hecha desde la app. Persiste la base, deja
 * constancia de que el CSV quedó atrás y programa su actualización.
 */
export function registrarCambio() {
    setMeta('csv_pendiente', '1');
    guardarEnDisco();
    clearTimeout(temporizadorExport);
    temporizadorExport = desprender(setTimeout(intentarExportar, config.demoraExportMs));
}

/** Botón "Exportar": escribe ya, sin esperar, e informa el resultado */
export function exportarAhora() {
    clearTimeout(temporizadorExport);
    setMeta('csv_pendiente', '1');
    guardarEnDisco();
    return intentarExportar();
}

// ---------------------------------------------------------------------------
// Vigilancia del archivo
// ---------------------------------------------------------------------------

function detenerWatcher() {
    clearTimeout(temporizadorWatch);
    clearTimeout(reiniciarWatcher);
    if (watcher) {
        try { watcher.close(); } catch { /* ya cerrado */ }
        watcher = null;
    }
}

/**
 * Se vigila la CARPETA y se filtra por nombre: Excel guarda reemplazando el archivo, y un watcher
 * sobre el archivo en sí queda apuntando al viejo y deja de enterarse.
 */
function iniciarWatcher() {
    detenerWatcher();
    const carpeta = path.dirname(rutas.csv);
    const nombre = path.basename(rutas.csv).toLowerCase();
    if (!fs.existsSync(carpeta)) {
        actualizarEstado('error', `La carpeta del CSV no existe: ${carpeta}`);
        return;
    }
    try {
        watcher = fs.watch(carpeta, { persistent: false }, (_evento, archivo) => {
            if (archivo && String(archivo).toLowerCase() !== nombre) return;
            clearTimeout(temporizadorWatch);
            temporizadorWatch = desprender(setTimeout(() => {
                encolar(procesarCambioExterno).catch(err => console.error('Error al procesar el cambio del CSV:', err));
            }, config.demoraWatchMs));
        });
        watcher.on('error', err => {
            console.error('El vigilante del CSV falló, se reinicia:', err.message);
            reiniciarWatcher = desprender(setTimeout(iniciarWatcher, 3000));
        });
    } catch (err) {
        console.error('No se pudo vigilar el CSV:', err);
        actualizarEstado('error', `No se pudo vigilar el CSV: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Pone base y CSV en el mismo estado al arrancar y empieza a vigilar cambios.
 * Cubre lo que antes se perdía: ediciones hechas en Excel con la aplicación cerrada.
 * @param {(canal: string, datos: any) => void} notificarFn  envía eventos a la interfaz
 */
export function iniciarSincronizacion(notificarFn) {
    notificar = typeof notificarFn === 'function' ? notificarFn : () => {};
    cola = Promise.resolve();
    estadoSync.archivo = rutas.csv;
    hashConocido = getMeta('csv_hash');

    try {
        if (!fs.existsSync(rutas.csv)) {
            if (catalogoVacio()) sembrarCatalogoBase();
            registrarCambio();
        } else {
            const buffer = fs.readFileSync(rutas.csv);
            const cambioExterno = sha1(buffer) !== hashConocido;
            if (cambioExterno) {
                // Sin hash previo (primera vez con esta versión) no hay garantía de que el CSV
                // sea la verdad: se fusiona sin borrar nada.
                const resumen = aplicarCSV(buffer, hashConocido === null ? 'fusion' : 'auto');
                console.log(`Sincronización inicial con el CSV: ${resumen.mensaje}`);
            } else if (getMeta('csv_pendiente') === '1') {
                intentarExportar();
            } else {
                actualizarEstado('sincronizado');
            }
        }
    } catch (err) {
        console.error('Error en la sincronización inicial:', err);
        actualizarEstado('error', `Error al sincronizar con el CSV: ${err.message}`);
    }
    iniciarWatcher();
}

/**
 * Detiene vigilancia y temporizadores. Con `vaciar` intenta un último envío al CSV (cierre de la app).
 */
export function detenerSincronizacion({ vaciar = false } = {}) {
    detenerWatcher();
    clearTimeout(temporizadorExport);
    clearTimeout(temporizadorReintento);
    if (vaciar && getMeta('csv_pendiente') === '1') exportarCSV();
}
