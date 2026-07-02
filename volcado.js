import fs from 'fs';
import readline from 'readline';
import sqlite3 from 'sqlite3';

// Configuración de rutas
const RUTA_CSV = './Base_Datos_Libros_pusap.csv'; 
const RUTA_BBDD = './biblioteca.db'; 
const RUTA_SQL_ESTRUCTURA = './crear_y_cargarBBDD'; 

// Conectar a la base de datos SQLite
const db = new sqlite3.Database(RUTA_BBDD, (err) => {
    if (err) {
        console.error('Error al conectar a SQLite:', err.message);
        process.exit(1);
    }
    console.log('Conectado exitosamente a la base de datos SQLite.');
});

// Función auxiliar para ejecutar consultas SQL con Promesas
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
};

// Función auxiliar para ejecutar scripts SQL multilínea (DDL)
const dbExec = (sql) => {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Función para obtener o insertar un registro en tablas maestras (Evita duplicados)
async function obtenerOInsertarId(tabla, columnaNombre, valor) {
    if (!valor || valor.trim() === "") return null;
    const nombreLimpio = valor.trim();

    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM "${tabla}" WHERE "${columnaNombre}" = ?`, [nombreLimpio], async (err, row) => {
            if (err) return reject(err);
            if (row) {
                resolve(row.id);
            } else {
                try {
                    const nuevoId = await dbRun(`INSERT INTO "${tabla}" ("${columnaNombre}") VALUES (?)`, [nombreLimpio]);
                    resolve(nuevoId);
                } catch (insertErr) {
                    reject(insertErr);
                }
            }
        });
    });
}

// Proceso principal de lectura y volcado
async function procesarVolcado() {
    try {
        console.log('Iniciando el proceso de volcado de datos...');

        // 1. Cargar y ejecutar la estructura de tablas desde crear_y_cargarBBDD
        if (fs.existsSync(RUTA_SQL_ESTRUCTURA)) {
            console.log('Leyendo archivo de estructura SQL para inicializar las tablas...');
            const scriptSQL = fs.readFileSync(RUTA_SQL_ESTRUCTURA, 'utf8');
            await dbExec(scriptSQL);
            console.log('Tablas y registros base listos en la base de datos.');
        } else {
            console.warn(`Advertencia: No se encontró el archivo '${RUTA_SQL_ESTRUCTURA}'. Se asumirá que la estructura ya existe.`);
        }

        // Asegurar que el archivo CSV exista
        if (!fs.existsSync(RUTA_CSV)) {
            throw new Error(`No se encontró el archivo CSV en la ruta: ${RUTA_CSV}`);
        }

        // Crear la interfaz de lectura línea por línea
        const lector = readline.createInterface({
            input: fs.createReadStream(RUTA_CSV, { encoding: 'latin1' }),
            crlfDelay: Infinity
        });

        let filasProcesadas = 0;
        let filasInsertadas = 0;

        // Activar soporte de Llaves Foráneas en SQLite para validar integridad
        await dbRun('PRAGMA foreign_keys = ON;');

        for await (const linea of lector) {
            filasProcesadas++;
            const lineaLimpia = linea.trim();

            // Filtro para ignorar líneas vacías, decorativas o cabeceras
            if (lineaLimpia === "" || 
                lineaLimpia.startsWith("Plantilla") || 
                /^;+$/.test(lineaLimpia) || 
                lineaLimpia.toLowerCase().includes("id / código") || 
                lineaLimpia.toLowerCase().includes("id_libro") ||
                lineaLimpia.toLowerCase().includes("título del libro")) {
                continue;
            }

            const celdas = lineaLimpia.split(';');

            if (celdas.length >= 6) {
                const codigo = parseInt(celdas[0]) || filasProcesadas;
                const titulo = celdas[1]?.trim();
                const autor = celdas[2]?.trim() || 'Anónimo';
                const nombreEditorial = celdas[3]?.trim();
                const nombreAsignatura = celdas[4]?.trim();
                const cantidad = parseInt(celdas[5]) || 0;
                
                // Controlar opcionales dependiendo de si el CSV exportado de Excel los trae
                const cantidadDisponible = parseInt(celdas[6]) ?? cantidad;
                const condicionEstado = celdas[7]?.trim() || 'Nuevo';
                const numeroCurso = parseInt(celdas[8]) || null; // Manejo seguro de la columna numero_curso

                // Resolver relaciones e IDs (Llaves Foráneas) en tiempo de ejecución
                const idEditorial = await obtenerOInsertarId('editoriales', 'nombre', nombreEditorial);
                const idAsignatura = await obtenerOInsertarId('asignatura', 'nombre', nombreAsignatura);
                const idEstado = await obtenerOInsertarId('estados', 'condicion', condicionEstado);

                // Insertar o actualizar el libro mapeando exactamente tus columnas SQL
                const sqlLibro = `
                    INSERT OR REPLACE INTO libros (
                        codigo, titulo, autor, id_editorial, cantidad, cantidad_disponible, id_estado, numero_curso, id_asignatura
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                `;

                await dbRun(sqlLibro, [
                    codigo, titulo, autor, idEditorial, cantidad, cantidadDisponible, idEstado, numeroCurso, idAsignatura
                ]);

                filasInsertadas++;
            }
        }

        console.log(`\n¡Volcado finalizado con éxito!`);
        console.log(`-----------------------------------`);
        console.log(`Líneas analizadas en Excel: ${filasProcesadas}`);
        console.log(`Libros insertados en SQL:   ${filasInsertadas}`);
        console.log(`-----------------------------------`);

    } catch (error) {
        console.error('\n❌ Error crítico durante el volcado:', error.message);
    } finally {
        db.close(() => {
            console.log('Conexión con SQLite cerrada.');
        });
    }
}

// Ejecutar automatización
procesarVolcado();