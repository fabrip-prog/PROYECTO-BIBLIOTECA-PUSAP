export function transformarCSV(textoBruto) {
    const lineas = textoBruto.split(/\r?\n/);
    const matrizDatos = [];

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        
        // Ignoramos líneas vacías, decorativas o que contengan los títulos de las columnas
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