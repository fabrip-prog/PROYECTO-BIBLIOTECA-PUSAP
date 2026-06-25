import { cargarInventarioDesdeCSV } from './libros.js';

document.addEventListener("DOMContentLoaded", () => {
    // Escucha cuando el usuario selecciona un archivo desde su computadora
    const inputArchivo = document.getElementById("archivo-excel-libros");
    
    if (inputArchivo) {
        inputArchivo.addEventListener("change", function(evento) {
            const archivo = evento.target.files[0];
            if (!archivo) return;

            const lector = new FileReader();
            lector.onload = function(e) {
                const contenido = e.target.result;
                cargarInventarioDesdeCSV(contenido);
            };
           lector.readAsText(archivo, 'ISO-8859-1');
        });
    }
    
    console.log("Módulo de lectura de archivos vinculado.");
});