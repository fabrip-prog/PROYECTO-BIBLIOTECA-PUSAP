// Reglas de negocio del catálogo y las reservas. Opera sobre la base (db.js) sin depender de Electron,
// y es la única puerta de escritura: tanto la interfaz como la importación del CSV pasan por aquí,
// así las validaciones y el cálculo de stock son idénticos en ambos caminos.
import { getDb, dbQueryAll, dbQueryGet, resolveId, transaccion, recalcularDisponibilidad } from './db.js';

const dosDigitos = n => String(n).padStart(2, '0');

/** Fecha local en formato AAAA-MM-DD (toISOString usa UTC y a la noche devuelve el día siguiente) */
export function hoyLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

function fechaValida(texto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const d = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function entero(valor, campo, minimo) {
    const texto = String(valor ?? '').trim();
    if (!/^-?\d+$/.test(texto) || Number(texto) < minimo) {
        throw new Error(`${campo} debe ser un número entero${minimo > 0 ? ` mayor o igual a ${minimo}` : ' no negativo'}.`);
    }
    return Number(texto);
}

function texto(valor, campo, { obligatorio = true, maximo = 300 } = {}) {
    const limpio = String(valor ?? '').trim();
    if (obligatorio && !limpio) throw new Error(`${campo} es obligatorio.`);
    if (limpio.length > maximo) throw new Error(`${campo} supera los ${maximo} caracteres.`);
    return limpio;
}

function contarPrestados(codigo) {
    return dbQueryGet("SELECT COUNT(*) AS n FROM reservas WHERE codigo_libro = ? AND estado <> 'Devuelta'", [codigo]).n;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function listarMaestras() {
    return {
        estados: dbQueryAll('SELECT * FROM estados ORDER BY id'),
        asignatura: dbQueryAll('SELECT * FROM asignatura ORDER BY nombre'),
        editoriales: dbQueryAll('SELECT * FROM editoriales ORDER BY nombre')
    };
}

export function listarLibros() {
    return dbQueryAll('SELECT * FROM libros ORDER BY codigo');
}

export function listarReservas() {
    return dbQueryAll(`
        SELECT r.*, l.titulo AS titulo_libro
        FROM reservas r
        LEFT JOIN libros l ON l.codigo = r.codigo_libro
        ORDER BY r.rowid DESC
    `).map(r => ({
        idLibro: r.codigo_libro,
        tituloLibro: r.titulo_libro || '',
        idReserva: r.id_reserva,
        usuario: r.usuario,
        fecha: r.fecha_reserva,
        estado: r.estado,
        observaciones: r.observaciones,
        fechaDevolucion: r.fecha_devolucion
    }));
}

// ---------------------------------------------------------------------------
// Libros
// ---------------------------------------------------------------------------

/** Convierte "Nuevo", "usado" o "1 usado/nuevo" en el id de la tabla estados */
function resolverEstado(textoEstado, existente) {
    const t = String(textoEstado ?? '').trim();
    if (!t) return existente ? existente.id_estado : resolveId('estados', 'Nuevo');

    const exacto = dbQueryGet('SELECT id FROM estados WHERE LOWER(condicion) = LOWER(?)', [t]);
    if (exacto) return exacto.id;
    if (/usado/i.test(t) && !/nuevo/i.test(t)) return resolveId('estados', 'Usado');
    if (/nuevo/i.test(t)) return resolveId('estados', 'Nuevo');
    return resolveId('estados', t); // condición propia (p. ej. "Dañado")
}

/**
 * Inserta o actualiza un libro SIN pisar el stock prestado: la disponibilidad se recalcula
 * desde las reservas. Usa UPSERT (no INSERT OR REPLACE, que borraría la fila y rompería las reservas).
 * `curso` undefined = no tocar el valor actual. Retorna 'insertado' | 'actualizado' | 'sinCambios'.
 */
export function upsertLibro(libro) {
    const database = getDb();
    const idEditorial = resolveId('editoriales', libro.editorial);
    const idAsignatura = resolveId('asignatura', libro.asignatura);
    const existente = dbQueryGet('SELECT * FROM libros WHERE codigo = ?', [libro.codigo]);
    const idEstado = resolverEstado(libro.estado, existente);

    if (!existente) {
        database.run(`
            INSERT INTO libros (codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, numero_curso, id_asignatura)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [libro.codigo, libro.titulo, libro.autor, idEditorial, libro.cantidad, libro.cantidad, idEstado, libro.curso ?? null, idAsignatura]);
        return 'insertado';
    }

    const curso = libro.curso === undefined ? existente.numero_curso : libro.curso;
    const igual = existente.titulo === libro.titulo
        && existente.autor === libro.autor
        && (existente.id_editorial ?? null) === idEditorial
        && (existente.id_asignatura ?? null) === idAsignatura
        && existente.cantidad === libro.cantidad
        && (existente.id_estado ?? null) === idEstado
        && (existente.numero_curso ?? null) === (curso ?? null);
    if (igual) return 'sinCambios';

    database.run(`
        UPDATE libros SET titulo = ?, autor = ?, id_editorial = ?, cantidad = ?, id_estado = ?, numero_curso = ?, id_asignatura = ?
        WHERE codigo = ?
    `, [libro.titulo, libro.autor, idEditorial, libro.cantidad, idEstado, curso ?? null, idAsignatura, libro.codigo]);
    recalcularDisponibilidad(libro.codigo);
    return 'actualizado';
}

function validarLibro(datos) {
    return {
        codigo: entero(datos?.codigo, 'El código', 1),
        titulo: texto(datos?.titulo, 'El título'),
        autor: texto(datos?.autor, 'El autor'),
        editorial: texto(datos?.editorial, 'La editorial', { obligatorio: false }),
        asignatura: texto(datos?.asignatura, 'La asignatura', { obligatorio: false }),
        cantidad: entero(datos?.cantidad, 'La cantidad', 0),
        estado: texto(datos?.estado, 'El estado', { obligatorio: false, maximo: 60 }),
        curso: datos?.curso === undefined || datos?.curso === null || datos?.curso === '' ? undefined : entero(datos.curso, 'El número de curso', 0)
    };
}

export function crearLibro(datos) {
    const libro = validarLibro(datos);
    return transaccion(() => {
        if (dbQueryGet('SELECT 1 AS x FROM libros WHERE codigo = ?', [libro.codigo])) {
            throw new Error(`El código ${libro.codigo} ya existe en el inventario.`);
        }
        upsertLibro(libro);
        return libro.codigo;
    });
}

export function actualizarLibro(datos) {
    const libro = validarLibro(datos);
    return transaccion(() => {
        if (!dbQueryGet('SELECT 1 AS x FROM libros WHERE codigo = ?', [libro.codigo])) {
            throw new Error(`El libro ${libro.codigo} no existe.`);
        }
        const prestados = contarPrestados(libro.codigo);
        if (libro.cantidad < prestados) {
            throw new Error(`No se puede dejar la cantidad en ${libro.cantidad}: hay ${prestados} ejemplar(es) prestado(s) sin devolver.`);
        }
        upsertLibro(libro);
        return libro.codigo;
    });
}

export function eliminarLibro(codigoCrudo) {
    const codigo = entero(codigoCrudo, 'El código', 1);
    return transaccion(() => {
        const libro = dbQueryGet('SELECT titulo FROM libros WHERE codigo = ?', [codigo]);
        if (!libro) throw new Error(`El libro ${codigo} no existe.`);

        const { activas, total } = dbQueryGet(
            "SELECT COALESCE(SUM(estado <> 'Devuelta'), 0) AS activas, COUNT(*) AS total FROM reservas WHERE codigo_libro = ?", [codigo]);
        if (activas > 0) {
            throw new Error(`No se puede eliminar "${libro.titulo}": tiene ${activas} reserva(s) sin devolver.`);
        }
        if (total > 0) {
            throw new Error(`No se puede eliminar "${libro.titulo}": figura en ${total} reserva(s) del historial. Limpiá primero el historial de devueltas.`);
        }
        getDb().run('DELETE FROM libros WHERE codigo = ?', [codigo]);
    });
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export function crearReserva(datos) {
    const codigo = entero(datos?.idLibro, 'El código de libro', 1);
    const idReserva = texto(datos?.idReserva, 'El ID de reserva', { maximo: 60 });
    const usuario = texto(datos?.usuario, 'El usuario', { maximo: 120 });
    const fecha = texto(datos?.fecha, 'La fecha');
    if (!fechaValida(fecha)) throw new Error('La fecha de reserva no es válida.');

    return transaccion(() => {
        const libro = dbQueryGet('SELECT titulo, cantidad FROM libros WHERE codigo = ?', [codigo]);
        if (!libro) throw new Error(`El código de libro [${codigo}] no existe en el catálogo.`);
        if (libro.cantidad - contarPrestados(codigo) <= 0) {
            throw new Error(`Stock agotado: "${libro.titulo}" no posee unidades disponibles.`);
        }
        if (dbQueryGet('SELECT 1 AS x FROM reservas WHERE id_reserva = ?', [idReserva])) {
            throw new Error(`El ID de reserva "${idReserva}" ya existe en el sistema.`);
        }
        getDb().run(`
            INSERT INTO reservas (id_reserva, codigo_libro, usuario, fecha_reserva, estado, observaciones, fecha_devolucion)
            VALUES (?, ?, ?, ?, 'Activa', '', '')
        `, [idReserva, codigo, usuario, fecha]);
        recalcularDisponibilidad(codigo);
    });
}

export function devolverReserva(datos) {
    const idReserva = texto(datos?.idReserva, 'El ID de reserva', { maximo: 60 });
    const observaciones = texto(datos?.observaciones, 'Las observaciones', { obligatorio: false, maximo: 1000 }) || 'Sin observaciones';
    const fecha = fechaValida(datos?.fechaDevolucion) ? datos.fechaDevolucion : hoyLocal();

    return transaccion(() => {
        const reserva = dbQueryGet('SELECT codigo_libro, estado FROM reservas WHERE id_reserva = ?', [idReserva]);
        if (!reserva) throw new Error(`No se encontró la reserva con ID ${idReserva}.`);
        if (reserva.estado === 'Devuelta') throw new Error(`La reserva con ID ${idReserva} ya fue devuelta.`);

        getDb().run(
            "UPDATE reservas SET estado = 'Devuelta', observaciones = ?, fecha_devolucion = ? WHERE id_reserva = ?",
            [observaciones, fecha, idReserva]);
        recalcularDisponibilidad(reserva.codigo_libro);
    });
}

export function limpiarHistorialDevueltas() {
    return transaccion(() => {
        getDb().run("DELETE FROM reservas WHERE estado = 'Devuelta'");
        return getDb().getRowsModified();
    });
}

// ---------------------------------------------------------------------------
// Catálogo inicial (solo si no hay base ni CSV)
// ---------------------------------------------------------------------------

const CATALOGO_BASE = [
    { codigo: 1, titulo: 'Historia Socioeconómica de la Argentina. 1776-1860.', autor: 'Jonathan Brown', editorial: 'Siglo Veintiuno de Argentina Editores (en coedición con el Instituto Di Tella)', asignatura: 'Historia/Economía', curso: 214 },
    { codigo: 2, titulo: 'Manual de Derecho Penal- Parte Especial (Segunda Edición)', autor: 'Ricardo C. Nuñez - Victor F. Reinaldi', editorial: 'Marcos Lerner Editora Cordoba', asignatura: 'Derecho', curso: 27 },
    { codigo: 3, titulo: 'Código Procesal Penal de la Nación. Anotado. Comentado. Concordado. TOMO II', autor: "Francisco J. D'Albora - Nicolás F. D'Albora", editorial: 'LexisNexis Abeledo-Perrot', asignatura: 'Derecho', curso: 42 },
    { codigo: 4, titulo: 'Tratado de los Cheques', autor: 'Osvaldo R. Gómez Leo', editorial: 'LexisNexis', asignatura: 'Derecho', curso: 39 },
    { codigo: 5, titulo: 'Curso de Filosofia', autor: 'Carlos Escobar Saravia', editorial: 'Virtudes Editorial Universitaria', asignatura: 'Filosofía', curso: 34 },
    { codigo: 6, titulo: 'Títulos de Crédito', autor: 'Ignacio A. Escuti', editorial: 'Astrea', asignatura: 'Derecho', curso: 38 },
    { codigo: 7, titulo: 'El Ciclo de la llusión y el Desencanto', autor: 'Pablo Gerchunoff - Lucas Llach', editorial: 'Ariel Sociedad Económica.', asignatura: 'Economia', curso: 213 },
    { codigo: 8, titulo: 'Teoría Microeconómica', autor: 'John P. Gould-Edward P. Lazear', editorial: 'Fondo de Cultura Económica', asignatura: 'Economia', curso: 216 }
];

export function catalogoVacio() {
    return dbQueryGet('SELECT COUNT(*) AS n FROM libros').n === 0;
}

export function sembrarCatalogoBase() {
    transaccion(() => CATALOGO_BASE.forEach(l => upsertLibro({ ...l, cantidad: 1, estado: 'Nuevo' })));
}
