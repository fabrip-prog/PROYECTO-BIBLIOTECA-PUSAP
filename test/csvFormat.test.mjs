import test from 'node:test';
import assert from 'node:assert/strict';
import { decodificar, detectarDelimitador, parsearCSV, serializarCSV, leerLibros, ENCABEZADOS } from '../src/main/csvFormat.js';

test('decodifica UTF-8 con BOM, UTF-8 sin BOM y Windows-1252 (Excel en español)', () => {
    assert.equal(decodificar(Buffer.from('﻿Año;Café', 'utf-8')), 'Año;Café');
    assert.equal(decodificar(Buffer.from('Año;Café', 'utf-8')), 'Año;Café');
    assert.equal(decodificar(Buffer.from('Año;Café', 'latin1')), 'Año;Café');
    // 0x80 es "€" en Windows-1252 y no es UTF-8 válido
    assert.equal(decodificar(Buffer.from([0x41, 0xF1, 0x80])), 'Añ€');
});

test('detecta el separador por la primera línea, ignorando comillas', () => {
    assert.equal(detectarDelimitador('a;b;c\n1;2;3'), ';');
    assert.equal(detectarDelimitador('a,b,c\n1,2,3'), ',');
    assert.equal(detectarDelimitador('a\tb\tc'), '\t');
    assert.equal(detectarDelimitador('sep=|\na|b'), '|');
    assert.equal(detectarDelimitador('"a;b;c",d,e'), ',', 'los ";" dentro de comillas no cuentan');
    assert.equal(detectarDelimitador(''), ';');
});

test('el parser respeta comillas, comillas escapadas y saltos de línea dentro de celdas', () => {
    const filas = parsearCSV('a;"b;c";"d ""x"" e"\r\n"línea1\nlínea2";z\r\n', ';');
    assert.deepEqual(filas.map(f => f.celdas), [['a', 'b;c', 'd "x" e'], ['línea1\nlínea2', 'z']]);
    assert.equal(filas[1].linea, 2);
});

test('serializar y volver a parsear conserva cualquier texto', () => {
    const raros = ['Cálculo; I', 'Dijo "hola"', 'dos\nlíneas', 'precio € – “comillas” ñ', '  espacios  ', ''];
    const filas = raros.map((t, i) => [i + 1, t || 'x', 'Autor', 'Ed', 'As', 1, 1, 'Nuevo', '']);
    const buffer = serializarCSV(filas);
    assert.equal(buffer[0], 0xEF, 'debe empezar con BOM para que Excel respete las tildes');
    const leidos = leerLibros(decodificar(buffer));
    assert.equal(leidos.errores.length, 0);
    assert.deepEqual(leidos.libros.map(l => l.titulo), raros.map(t => (t || 'x').trim()));
});

test('mapea por nombre de columna aunque cambie el orden y salta títulos previos al encabezado', () => {
    const texto = [
        'Plantilla de inventario;;;',
        ';;;',
        'Título del Libro;ID / Código;Cantidad;Autor',
        'El Aleph;7;3;Borges'
    ].join('\n');
    const { libros, errores } = leerLibros(texto);
    assert.equal(errores.length, 0);
    assert.deepEqual(
        { codigo: libros[0].codigo, titulo: libros[0].titulo, cantidad: libros[0].cantidad, autor: libros[0].autor },
        { codigo: 7, titulo: 'El Aleph', cantidad: 3, autor: 'Borges' }
    );
    assert.equal(libros[0].curso, undefined, 'si la columna no existe, no se debe pisar el curso actual');
});

test('sin encabezado se asume el orden clásico de columnas', () => {
    const { libros } = leerLibros('1;Título;Autor;Editorial;Materia;2;2;Usado;15');
    assert.equal(libros[0].cantidad, 2);
    assert.equal(libros[0].estado, 'Usado');
    assert.equal(libros[0].curso, 15);
});

test('las filas inválidas se informan con su línea y no frenan al resto', () => {
    const texto = [ENCABEZADOS.join(';'), '1;Bueno;A;E;S;1;1;;', 'abc;Mal código;A;E;S;1;1;;', '3;;A;E;S;1;1;;', '4;Cantidad mala;A;E;S;muchos;1;;', '5;Otro bueno;A;E;S;2;2;;'].join('\n');
    const { libros, errores } = leerLibros(texto);
    assert.deepEqual(libros.map(l => l.codigo), [1, 5]);
    assert.deepEqual(errores.map(e => e.linea), [3, 4, 5]);
});

test('acepta números tal como los deja Excel ("5.0") y avisa de códigos repetidos', () => {
    const texto = [ENCABEZADOS.join(';'), '1.0;Uno;A;E;S;3.0;3;;', '1;Uno repetido;A;E;S;1;1;;'].join('\n');
    const { libros, advertencias } = leerLibros(texto);
    assert.equal(libros.length, 1);
    assert.equal(libros[0].titulo, 'Uno repetido');
    assert.match(advertencias[0], /repetido/);
});

test('cantidad vacía vale 1 y autor vacío "Anónimo"', () => {
    const { libros } = leerLibros([ENCABEZADOS.join(';'), '9;Sin datos;;;;;;;'].join('\n'));
    assert.equal(libros[0].cantidad, 1);
    assert.equal(libros[0].autor, 'Anónimo');
});
