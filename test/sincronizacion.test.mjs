import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configurarRutas, initDatabase, rutas, dbQueryAll, dbQueryGet, getMeta, setMeta, guardarEnDisco, getDb, avisosArranque } from '../src/main/db.js';
import {
    crearLibro, actualizarLibro, eliminarLibro, crearReserva, devolverReserva,
    limpiarHistorialDevueltas, listarLibros, listarReservas
} from '../src/main/catalogo.js';
import {
    importarBuffer, exportarCSV, registrarCambio, iniciarSincronizacion, detenerSincronizacion,
    configurarSincronizacion, getEstadoSync, generarContenidoCSV
} from '../src/main/csvService.js';
import { ENCABEZADOS } from '../src/main/csvFormat.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carpetas = [];

configurarSincronizacion({ demoraWatchMs: 60, demoraExportMs: 20, reintentoExportMs: 60, esperaLecturaMs: 20 });

/** Carpeta de datos descartable con una base nueva */
async function entorno({ conservar = false } = {}) {
    const dir = conservar && carpetas.length ? carpetas[carpetas.length - 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-test-'));
    if (!carpetas.includes(dir)) carpetas.push(dir);
    configurarRutas({ rootDir: raiz, userDir: dir });
    await initDatabase();
    return dir;
}

afterEach(() => detenerSincronizacion());
process.on('exit', () => carpetas.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const libro = (codigo, extra = {}) => ({ codigo, titulo: `Libro ${codigo}`, autor: 'Autor', editorial: 'Ed A', asignatura: 'Mat', cantidad: 2, estado: 'Nuevo', ...extra });
const csv = (...filas) => Buffer.from([ENCABEZADOS.join(';'), ...filas].join('\r\n'), 'latin1');

async function esperarHasta(condicion, ms = 4000) {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
        if (condicion()) return true;
        await new Promise(r => setTimeout(r, 15));
    }
    return false;
}

// ---------------------------------------------------------------------------
// Reglas de stock
// ---------------------------------------------------------------------------

test('reservar y devolver mantienen la disponibilidad derivada de las reservas', async () => {
    await entorno();
    crearLibro(libro(1, { cantidad: 2 }));
    crearReserva({ idLibro: '1', idReserva: 'R1', usuario: 'Ana', fecha: '2026-01-10' });
    assert.equal(listarLibros()[0].cantidad_disponible, 1);
    crearReserva({ idLibro: 1, idReserva: 'R2', usuario: 'Beto', fecha: '2026-01-11' });
    assert.equal(listarLibros()[0].cantidad_disponible, 0);

    assert.throws(() => crearReserva({ idLibro: 1, idReserva: 'R3', usuario: 'Cris', fecha: '2026-01-12' }), /Stock agotado/);
    assert.throws(() => crearReserva({ idLibro: 1, idReserva: 'R1', usuario: 'Dani', fecha: '2026-01-12' }), /ya existe|Stock agotado/);

    devolverReserva({ idReserva: 'R1', observaciones: 'ok', fechaDevolucion: '2026-01-20' });
    assert.equal(listarLibros()[0].cantidad_disponible, 1);
    assert.throws(() => devolverReserva({ idReserva: 'R1' }), /ya fue devuelta/);
    assert.equal(listarReservas().find(r => r.idReserva === 'R1').estado, 'Devuelta');
});

test('validaciones: libro inexistente, fecha inválida, código duplicado', async () => {
    await entorno();
    crearLibro(libro(1));
    assert.throws(() => crearLibro(libro(1)), /ya existe/);
    assert.throws(() => crearLibro(libro('LIB-0005')), /número entero/);
    assert.throws(() => crearReserva({ idLibro: 99, idReserva: 'X', usuario: 'Ana', fecha: '2026-01-01' }), /no existe/);
    assert.throws(() => crearReserva({ idLibro: 1, idReserva: 'X', usuario: 'Ana', fecha: '2026-02-30' }), /fecha/);
    assert.equal(listarReservas().length, 0, 'una reserva rechazada no deja rastro');
});

test('no se puede bajar la cantidad por debajo de lo prestado ni eliminar libros con reservas', async () => {
    await entorno();
    crearLibro(libro(1, { cantidad: 3 }));
    crearReserva({ idLibro: 1, idReserva: 'R1', usuario: 'Ana', fecha: '2026-01-10' });
    crearReserva({ idLibro: 1, idReserva: 'R2', usuario: 'Beto', fecha: '2026-01-10' });

    assert.throws(() => actualizarLibro(libro(1, { cantidad: 1 })), /prestado/);
    actualizarLibro(libro(1, { cantidad: 5, titulo: 'Nuevo título' }));
    const l = listarLibros()[0];
    assert.deepEqual([l.titulo, l.cantidad, l.cantidad_disponible], ['Nuevo título', 5, 3]);

    assert.throws(() => eliminarLibro(1), /sin devolver/);
    devolverReserva({ idReserva: 'R1' });
    devolverReserva({ idReserva: 'R2' });
    assert.throws(() => eliminarLibro(1), /historial/);
    assert.equal(limpiarHistorialDevueltas(), 2);
    eliminarLibro(1);
    assert.equal(listarLibros().length, 0);
});

test('las claves foráneas siguen activas después de guardar (sql.js las reinicia al exportar)', async () => {
    await entorno();
    guardarEnDisco();
    assert.equal(dbQueryGet('PRAGMA foreign_keys')['foreign_keys'], 1);
    assert.throws(() => getDb().run("INSERT INTO reservas (id_reserva, codigo_libro, usuario, fecha_reserva) VALUES ('X', 999, 'a', '2026-01-01')"), /FOREIGN KEY/);
});

test('el estado Nuevo/Usado se guarda de verdad (antes siempre quedaba en 1)', async () => {
    await entorno();
    crearLibro(libro(1, { estado: 'Usado' }));
    crearLibro(libro(2, { estado: 'Nuevo' }));
    const estados = dbQueryAll('SELECT l.codigo, e.condicion FROM libros l JOIN estados e ON e.id = l.id_estado ORDER BY l.codigo');
    assert.deepEqual(estados.map(e => e.condicion), ['Usado', 'Nuevo']);
});

// ---------------------------------------------------------------------------
// Importación desde el CSV
// ---------------------------------------------------------------------------

test('importar cuenta nuevos / actualizados / sin cambios e ignora la columna de disponibilidad', async () => {
    await entorno();
    crearLibro(libro(1, { cantidad: 3 }));
    crearReserva({ idLibro: 1, idReserva: 'R1', usuario: 'Ana', fecha: '2026-01-10' });

    // Excel dice "disponible = 3" pero hay una reserva activa: manda la reserva
    const r1 = importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;3;3;Nuevo;', '2;Dos;Autor;Ed B;Mat;1;1;Usado;'), { modo: 'fusion' });
    assert.deepEqual([r1.insertados, r1.actualizados, r1.sinCambios], [1, 0, 1]);
    assert.equal(dbQueryGet('SELECT cantidad_disponible AS d FROM libros WHERE codigo = 1').d, 2);

    const r2 = importarBuffer(csv('1;Libro 1 corregido;Autor;Ed A;Mat;4;4;Nuevo;'), { modo: 'fusion' });
    assert.equal(r2.actualizados, 1);
    const l1 = dbQueryGet('SELECT cantidad, cantidad_disponible AS d FROM libros WHERE codigo = 1');
    assert.deepEqual([l1.cantidad, l1.d], [4, 3]);
    assert.equal(listarReservas().length, 1, 'actualizar un libro no debe borrar sus reservas (INSERT OR REPLACE sí lo hacía)');
});

test('modo espejo elimina lo que ya no está, pero conserva los libros con reservas', async () => {
    await entorno();
    [1, 2, 3, 4].forEach(c => crearLibro(libro(c)));
    crearReserva({ idLibro: 2, idReserva: 'R1', usuario: 'Ana', fecha: '2026-01-10' });

    const r = importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;2;2;Nuevo;', '4;Libro 4;Autor;Ed A;Mat;2;2;Nuevo;'), { modo: 'espejo' });
    assert.equal(r.eliminados, 1, 'solo el 3');
    assert.equal(r.conservados, 1, 'el 2 tiene reserva');
    assert.deepEqual(listarLibros().map(l => l.codigo), [1, 2, 4]);
    assert.ok(fs.readdirSync(rutas.respaldos).some(n => n.startsWith('antes-de-sincronizar')), 'antes de borrar se hace un respaldo');
});

test('modo espejo no borra nada ante un archivo vacío, con errores o que vaciaría el catálogo', async () => {
    await entorno();
    [1, 2, 3, 4, 5, 6].forEach(c => crearLibro(libro(c)));

    importarBuffer(csv(), { modo: 'espejo' });
    assert.equal(listarLibros().length, 6, 'archivo vacío');

    const conError = importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;2;2;;', 'x;roto;;;;;;;'), { modo: 'espejo' });
    assert.equal(listarLibros().length, 6, 'con filas erróneas no se puede asegurar qué se borró');
    assert.equal(conError.errores.length, 1);

    const masivo = importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;2;2;;'), { modo: 'espejo' });
    assert.equal(listarLibros().length, 6, 'borraría 5 de 6');
    assert.match(masivo.advertencias.join(' '), /por seguridad/);
});

test('modo fusión nunca borra', async () => {
    await entorno();
    [1, 2].forEach(c => crearLibro(libro(c)));
    importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;2;2;;'), { modo: 'fusion' });
    assert.equal(listarLibros().length, 2);
});

test('una cantidad menor a lo prestado deja disponibilidad 0 y avisa', async () => {
    await entorno();
    crearLibro(libro(1, { cantidad: 3 }));
    ['R1', 'R2'].forEach(id => crearReserva({ idLibro: 1, idReserva: id, usuario: 'x', fecha: '2026-01-01' }));
    const r = importarBuffer(csv('1;Libro 1;Autor;Ed A;Mat;1;1;;'), { modo: 'fusion' });
    assert.equal(dbQueryGet('SELECT cantidad_disponible AS d FROM libros').d, 0);
    assert.match(r.advertencias.join(' '), /prestado/);
});

// ---------------------------------------------------------------------------
// Exportación y sincronización
// ---------------------------------------------------------------------------

test('exportar e importar es una ida y vuelta sin pérdidas, con caracteres especiales', async () => {
    await entorno();
    crearLibro(libro(1, { titulo: 'Cálculo; vol. 1 "avanzado" – €', autor: 'Ñandú\nPérez' }));
    assert.equal(exportarCSV().success, true);

    const antes = listarLibros();
    const r = importarBuffer(fs.readFileSync(rutas.csv), { modo: 'espejo' });
    assert.equal(r.huboCambios, false);
    assert.deepEqual(listarLibros(), antes);
});

test('al arrancar sin CSV se siembra el catálogo base y se genera el archivo', async () => {
    await entorno();
    iniciarSincronizacion();
    assert.equal(await esperarHasta(() => fs.existsSync(rutas.csv)), true);
    assert.equal(listarLibros().length, 8);
    assert.equal(await esperarHasta(() => getMeta('csv_pendiente') === '0'), true);
    assert.equal(getEstadoSync().estado, 'sincronizado');
});

test('lo editado en Excel con la app cerrada se importa al abrirla', async () => {
    const dir = await entorno();
    crearLibro(libro(1));
    exportarCSV();
    detenerSincronizacion();

    // El usuario edita el CSV con la app cerrada: cambia un título y agrega un libro (guardado ANSI, como Excel)
    const editado = fs.readFileSync(rutas.csv, 'utf-8').replace('Libro 1', 'Libro uno editado') + '2;Libro 2;Autor;Ed;Mat;1;1;Nuevo;\r\n';
    fs.writeFileSync(rutas.csv, Buffer.from(editado.replace('﻿', ''), 'latin1'));

    await entorno({ conservar: true }); // reabre la base
    assert.equal(path.dirname(rutas.csv), dir);
    iniciarSincronizacion();
    assert.deepEqual(listarLibros().map(l => l.titulo), ['Libro uno editado', 'Libro 2']);
});

test('sin hash previo (primera vez con esta versión) se fusiona y NO se borra lo que solo está en la base', async () => {
    await entorno();
    crearLibro(libro(1));
    crearLibro(libro(2));
    fs.writeFileSync(rutas.csv, csv('1;Libro 1;Autor;Ed A;Mat;2;2;;'));
    assert.equal(getMeta('csv_hash'), null);
    iniciarSincronizacion();
    assert.equal(listarLibros().length, 2);
});

test('con hash conocido, borrar una fila en Excel con la app cerrada sí elimina el libro', async () => {
    await entorno();
    [1, 2, 3].forEach(c => crearLibro(libro(c)));
    exportarCSV();
    detenerSincronizacion();
    const sinTres = fs.readFileSync(rutas.csv, 'utf-8').split('\r\n').filter(l => !l.startsWith('3;')).join('\r\n');
    fs.writeFileSync(rutas.csv, sinTres);

    await entorno({ conservar: true });
    iniciarSincronizacion();
    assert.deepEqual(listarLibros().map(l => l.codigo), [1, 2]);
});

test('vigilante: un guardado externo se importa y la propia escritura de la app no genera eco', async () => {
    await entorno();
    const eventos = [];
    crearLibro(libro(1));
    exportarCSV();
    iniciarSincronizacion((canal, datos) => eventos.push({ canal, datos }));

    // Escritura propia: no debe disparar importación
    crearLibro(libro(2));
    registrarCambio();
    assert.equal(await esperarHasta(() => getMeta('csv_pendiente') === '0'), true);
    await new Promise(r => setTimeout(r, 400));
    assert.equal(eventos.filter(e => e.canal === 'db-actualizada').length, 0, 'sin eco de la escritura propia');

    // Guardado externo (Excel en Windows: ANSI, sin BOM, fin de línea CRLF)
    const editado = fs.readFileSync(rutas.csv, 'utf-8').replace('Libro 2', 'Libro 2 desde Excel');
    fs.writeFileSync(rutas.csv, Buffer.from(editado.replace('﻿', ''), 'latin1'));
    assert.equal(await esperarHasta(() => eventos.some(e => e.canal === 'db-actualizada')), true, 'se detecta el cambio externo');
    assert.equal(dbQueryGet('SELECT titulo FROM libros WHERE codigo = 2').titulo, 'Libro 2 desde Excel');

    // Guardado de Excel reemplazando el archivo (borrar + renombrar): el vigilante debe seguir vivo
    const otro = path.join(rutas.user, 'temporal.csv');
    fs.writeFileSync(otro, Buffer.from(editado.replace('﻿', '').replace('Libro 1', 'Libro 1 v2'), 'latin1'));
    fs.rmSync(rutas.csv);
    fs.renameSync(otro, rutas.csv);
    assert.equal(await esperarHasta(() => dbQueryGet('SELECT titulo FROM libros WHERE codigo = 1').titulo === 'Libro 1 v2'), true, 'sigue vigilando tras reemplazo del archivo');
});

test('si Excel bloquea el CSV, el cambio queda pendiente, se avisa y se reintenta hasta lograrlo', async () => {
    await entorno();
    crearLibro(libro(1));
    exportarCSV();
    const estados = [];
    iniciarSincronizacion((canal, datos) => { if (canal === 'sync-estado') estados.push(datos.estado); });

    const renombrarReal = fs.renameSync;
    fs.renameSync = (origen, destino) => {
        if (String(destino).endsWith('.csv')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        return renombrarReal(origen, destino);
    };
    try {
        crearLibro(libro(2));
        registrarCambio();
        assert.equal(await esperarHasta(() => getEstadoSync().estado === 'bloqueado'), true);
        assert.equal(getMeta('csv_pendiente'), '1');
        assert.ok(!fs.readFileSync(rutas.csv, 'utf-8').includes('Libro 2'), 'el CSV no se corrompe ni se escribe a medias');
    } finally {
        fs.renameSync = renombrarReal;
    }

    assert.equal(await esperarHasta(() => getEstadoSync().estado === 'sincronizado'), true, 'al liberarse, se completa solo');
    assert.equal(getMeta('csv_pendiente'), '0');
    assert.ok(fs.readFileSync(rutas.csv, 'utf-8').includes('Libro 2'));
});

test('un cambio pendiente sobrevive al reinicio y se envía al abrir', async () => {
    await entorno();
    crearLibro(libro(1));
    exportarCSV();
    crearLibro(libro(2));
    setMeta('csv_pendiente', '1'); // como si la app se hubiera cerrado con Excel abierto
    guardarEnDisco();
    detenerSincronizacion();

    await entorno({ conservar: true });
    iniciarSincronizacion();
    assert.equal(await esperarHasta(() => fs.readFileSync(rutas.csv, 'utf-8').includes('Libro 2')), true);
    assert.equal(getMeta('csv_pendiente'), '0');
});

// ---------------------------------------------------------------------------
// Robustez de la base
// ---------------------------------------------------------------------------

test('una base dañada se restaura desde el respaldo diario', async () => {
    await entorno();
    crearLibro(libro(1));
    guardarEnDisco();
    await entorno({ conservar: true }); // segunda apertura: crea el respaldo diario
    assert.ok(fs.readdirSync(rutas.respaldos).some(n => n.startsWith('diario-')));

    fs.writeFileSync(rutas.db, Buffer.from('esto no es una base sqlite'.repeat(50)));
    const avisosPrevios = avisosArranque.length;
    await entorno({ conservar: true });
    assert.ok(avisosArranque.length > avisosPrevios);
    assert.match(avisosArranque.at(-1), /restauró el respaldo/);
    assert.deepEqual(listarLibros().map(l => l.codigo), [1]);
});

test('la disponibilidad desfasada se corrige al abrir', async () => {
    await entorno();
    crearLibro(libro(1, { cantidad: 2 }));
    crearReserva({ idLibro: 1, idReserva: 'R1', usuario: 'Ana', fecha: '2026-01-10' });
    getDb().run('UPDATE libros SET cantidad_disponible = 2'); // desfase (por ejemplo, una edición vieja en Excel)
    guardarEnDisco();
    await entorno({ conservar: true });
    assert.equal(listarLibros()[0].cantidad_disponible, 1);
});

test('el CSV generado es estable: exportar dos veces no cambia el contenido', async () => {
    await entorno();
    crearLibro(libro(1));
    const a = generarContenidoCSV();
    const b = generarContenidoCSV();
    assert.ok(a.equals(b));
});
