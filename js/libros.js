// Memoria local exclusiva para libros
export let inventarioLibros = [];

export function actualizarTablaInventario() {
    const tbody = document.querySelector("#tabla-inventario tbody");
    tbody.innerHTML = "";

    inventarioLibros.forEach(libro => {
        const fila = document.createElement("tr");
        fila.innerHTML = `
            <td>${libro.id}</td>
            <td>${libro.titulo}</td>
            <td>${libro.autor}</td>
            <td>${libro.editorial}</td>
            <td>${libro.asignatura}</td>
            <td>${libro.cantidad}</td>
            <td>${libro.cantidadDisponible}</td>
            <td>${libro.estado}</td>
        `;
        tbody.appendChild(fila);
    });
}

export function registrarNuevoLibro(evento) {
    evento.preventDefault();
    
    const nuevoLibro = {
        id: document.getElementById("libro-id").value,
        titulo: document.getElementById("libro-titulo").value,
        autor: document.getElementById("libro-autor").value,
        editorial: document.getElementById("libro-editorial").value,
        asignatura: document.getElementById("libro-asignatura").value,
        cantidad: parseInt(document.getElementById("libro-cantidad").value),
        cantidadDisponible: parseInt(document.getElementById("libro-cantidad").value),
        estado: document.getElementById("libro-estado").value
    };

    if (inventarioLibros.some(l => l.id === nuevoLibro.id)) {
        alert("El ID ya existe.");
        return;
    }

    inventarioLibros.push(nuevoLibro);
    actualizarTablaInventario();
    document.getElementById("form-libro").reset();
}
import { transformarCSV } from './utils.js';


export function cargarInventarioDesdeCSV(textoCSV) {
    const matriz = transformarCSV(textoCSV);
    inventarioLibros = []; // Limpiar previo

    matriz.forEach(fila => {
        // Validación para evitar filas mal formateadas
        if (fila.length >= 6) {
            const libro = {
                id: fila[0],
                titulo: fila[1],
                autor: fila[2],
                editorial: fila[3],
                asignatura: fila[4],
                cantidad: parseInt(fila[5]) || 0,
                cantidadDisponible: parseInt(fila[6]) || 0,
                estado: fila[7] || "Nuevo"
            };
            inventarioLibros.push(libro);
        }
    });

    inyectarInventarioEnHTML();
}

export function inyectarInventarioEnHTML() {
    const tbody = document.querySelector("#tabla-inventario tbody");
    tbody.innerHTML = ""; // Limpiar la fila de prueba fija del HTML

    inventarioLibros.forEach(libro => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${libro.id}</td>
            <td>${libro.titulo}</td>
            <td>${libro.autor}</td>
            <td>${libro.editorial}</td>
            <td>${libro.asignatura}</td>
            <td>${libro.cantidad}</td>
            <td>${libro.cantidadDisponible}</td>
            <td>${libro.estado}</td>
        `;
        tbody.appendChild(tr);
    });
}