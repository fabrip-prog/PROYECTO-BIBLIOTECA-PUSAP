# 📚 Sistema de Gestión de Biblioteca (Control de Inventario y Reservas)

Un sistema de escritorio moderno, liviano y robusto desarrollado con **Electron**, **Node.js** y **SQLite (sql.js)**. Permite administrar de forma integral el inventario de libros de una biblioteca, controlar préstamos/reservas en tiempo real con actualización automática de stock, e integrarse de manera bidireccional con planillas de **Microsoft Excel (CSV)**.

---

## 🚀 Características Principales

- **📦 Control de Inventario:** Catálogo completo de libros con detalle de autor, editorial, asignatura, cantidad total, stock disponible y estado.
- **🔄 Auto-Sincronización Bidireccional con Excel (CSV):** Los cambios guardados en Excel se reflejan en la aplicación (también los hechos con la app cerrada) y los de la aplicación se escriben en el CSV. Si Excel tiene el archivo abierto, el cambio queda pendiente y se envía al cerrarlo. Detalle en la sección 2.
- **🛡️ Datos protegidos:** guardado atómico, respaldos automáticos, restauración si la base se daña, claves foráneas y restricciones activas, y stock siempre calculado desde las reservas.
- **✏️ Edición de libros** desde la propia aplicación, con sugerencias de editoriales y asignaturas existentes.
- **📑 Control de Reservas y Préstamos:** Registro de préstamos por usuario, control de disponibilidad con prevención de sobre-reserva y actualización atómica del stock disponible mediante transacciones SQL.
- **🔙 Gestión de Devoluciones e Historial:** Proceso de devolución con registro de fechas y observaciones. Sección de historial de devoluciones con opción de limpieza.
- **🔍 Buscador en Tiempo Real:** Filtro rápido por título, autor, editorial, asignatura, estado o código de libro.
- **💡 UX Intuitiva y Modales:** Sistema de notificaciones flotantes (Toast), ventanas modales con soporte para atajos de teclado (`Esc`) y validaciones de datos integradas.

---

## 🛠️ Tecnologías Utilizadas

- **Entorno de Escritorio:** [Electron](https://www.electronjs.org/) (v43+)
- **Base de Datos Embedded:** [SQLite](https://www.sqlite.org/) impulsado por `sql.js` (WebAssembly)
- **Frontend / UI:** HTML5, Vanilla CSS3 (Diseño responsivo y accesible), ES6 JavaScript Modules
- **Persistencia de Datos:** SQLite (`biblioteca.db`) + CSV (`Base_Datos_Libros_pusap.csv`) escrito en UTF-8 con BOM (lee también Windows-1252)

---

## 📋 Requisitos Previos

Asegúrate de contar con los siguientes componentes instalados en tu sistema operativo:

- **Node.js**: v18.0.0 o superior ([Descargar Node.js](https://nodejs.org/))
- **npm**: Administrador de paquetes de Node.js (incluido con Node.js)
- **Sistema Operativo:** Windows 10/11 (Compatible también con Linux y macOS)

---

## 💻 Instalación y Puesta en Marcha

### 1. Clonar o descargar el repositorio
```bash
git clone https://github.com/fabrip-prog/PROYECTO-BIBLIOTECA-PUSAP.git
cd PROYECTO-BIBLIOTECA-PUSAP
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Iniciar la Aplicación

#### Opción A: Desde la consola / terminal
```bash
npm start
```

#### Opción B: Mediante el ejecutable directo en Windows
Haz doble clic sobre el archivo script:
```text
Iniciar-Biblioteca.bat
```

---

## 📖 Guía Detallada de Funcionalidades y Modo de Uso

### 1. 📦 Módulo de Inventario de Libros

#### A. Catálogo de Disponibilidad
Muestra la lista de libros registrados en la base de datos con las siguientes columnas:
- **ID / Código:** Identificador numérico del libro.
- **Título del Libro:** Nombre de la obra.
- **Autor:** Creador o autores del libro.
- **Editorial:** Casa editorial (relacionada automáticamente en la BD).
- **Asignatura:** Área de conocimiento o materia.
- **Cantidad:** Número total de ejemplares físicos.
- **Cantidad Disponibles:** Unidades libres para reserva/préstamo.
- **Estado:** Condición del libro (`Nuevo` / `Usado`).
- **Acciones:** Botones para editar o eliminar el registro. **Editar** carga el libro en el formulario (el código no se puede cambiar); no permite bajar la cantidad por debajo de los ejemplares prestados. **Eliminar** se bloquea si el libro tiene reservas sin devolver o figura en el historial.

#### B. Agregar Nuevo Libro
1. Completa el formulario **"Agregar Nuevo Libro"**:
   - **ID / Código:** Código numérico único (ej. `101`).
   - **Título, Autor, Editorial, Asignatura:** Información bibliográfica.
   - **Cantidad Total:** Número de copias físicas (debe ser mayor o igual a 1).
   - **Estado:** Selecciona `Nuevo` o `Usado`.
2. Presiona el botón **"Guardar en Inventario"**.
3. El sistema verificará que el código no exista previamente y creará automáticamente los registros en las tablas maestras si la editorial o asignatura son nuevas.

#### C. Búsqueda y Filtrado en Tiempo Real
En la caja de búsqueda `🔍 Buscar libros por título, autor, editorial, asignatura o código...`, escribe cualquier término. La tabla filtrará instantáneamente los resultados coincidentes sin necesidad de recargar la página.

#### D. Eliminar Libro
1. En la tabla de inventario, haz clic en el botón **"Eliminar"** junto al libro deseado.
2. Confirma la acción en el cuadro modal emergente.

---

### 2. 🔄 Importación, Exportación y Auto-Sincronización CSV (Excel)

El sistema soporta una integración completa con planillas de cálculo de Microsoft Excel a través de archivos `.csv` delimitados por punto y coma (`;`).

Sobre la tabla de inventario hay un indicador de estado (verde = sincronizado, amarillo = el CSV está abierto en Excel, rojo = error) y cuatro botones.

#### A. Cómo se mantienen sincronizados la base y el CSV
- **App → CSV:** cada cambio hecho en la aplicación (altas, ediciones, reservas, devoluciones) se escribe en el CSV en un segundo. La escritura es atómica: el archivo nunca queda a medias.
- **CSV → App:** al guardar el CSV en Excel (o en un editor de texto), la aplicación lo detecta, importa los cambios y actualiza la pantalla con un resumen (*"1 nuevo(s), 2 actualizado(s)…"*). Funciona aunque Excel reemplace el archivo al guardar.
- **Con la aplicación cerrada:** al abrirla se compara el CSV con la última versión sincronizada; si lo editaste mientras estaba cerrada, esos cambios se importan.
- **Sin eco:** lo que escribe la propia aplicación no se vuelve a importar (se compara el contenido del archivo, no los tiempos).
- **Excel abierto = archivo bloqueado:** Windows no deja que otro programa escriba un CSV que Excel tiene abierto. En ese caso el indicador se pone amarillo, el cambio queda **pendiente** (se conserva aunque cierres la app) y se copia al CSV apenas cierres Excel.
- **Filas con errores:** una fila inválida (código no numérico, sin título, cantidad negativa…) se omite y se informa con su número de línea; el resto se importa igual.

#### B. Qué manda en cada dato
- **`Cantidad_Disponible` se calcula siempre** como *cantidad − reservas sin devolver*. Se escribe en el CSV para que la veas, pero **si la editas en Excel se ignora**. Para cambiar el stock, edita `Cantidad`.
- Si bajas `Cantidad` por debajo de lo que está prestado, la disponibilidad queda en 0 y se muestra un aviso.
- Si **borras una fila en Excel**, el libro se elimina de la base, salvo que tenga reservas (activas o en historial): esos se conservan. Antes de borrar se guarda un respaldo, y no se borra nada si el CSV está vacío, tiene filas con errores o eliminaría más de la mitad del catálogo.
- El CSV se escribe en **UTF-8 con BOM** (Excel respeta tildes y símbolos como €). Al leer se acepta UTF-8 y también el CSV "normal" de Excel (Windows-1252), con separador `;` o `,`, y las columnas se identifican por su nombre aunque cambien de orden.

#### C. Los botones
- **Abrir en Excel:** actualiza el CSV y lo abre con el programa asociado.
- **Sincronizar ahora:** lee el CSV y deja la base igual a él (con las salvaguardas de arriba). Si hay cambios de la app todavía sin enviar al CSV, solo agrega y actualiza, nunca borra.
- **Importar otro CSV…:** suma a la base los libros de otro archivo. Es una fusión: nunca elimina libros.
- **Exportar a CSV:** escribe la base en el CSV en ese momento e informa si no se pudo.

#### D. Respaldos y ubicación de los archivos
- Se guarda un respaldo diario de la base en `respaldos/` (últimos 7) y otro antes de cualquier sincronización que elimine libros. Si `biblioteca.db` se daña, al abrir la app se restaura sola el respaldo más reciente.
- Por defecto la base y el CSV están junto a la aplicación (junto al `.exe` si está empaquetada). Para usar un CSV en otra carpeta, crea `biblioteca.config.json` junto a `biblioteca.db`:
  ```json
  { "csv": "D:\\Compartido\\Base_Datos_Libros_pusap.csv" }
  ```
- La variable de entorno `BIBLIOTECA_DATA_DIR` cambia la carpeta de datos completa (útil para probar sin tocar los datos reales).
- Solo puede haber una instancia de la aplicación abierta (evita que dos copias se pisen al guardar).

---

### 3. 🔖 Control de Reservas y Préstamos

#### A. Registrar Nueva Reserva
1. En la sección **"Control de Reservas"**, completa los campos:
   - **ID Libro a Reservar:** Código numérico del libro existente en el inventario.
   - **ID Reserva:** Código identificador único para el préstamo (ej. `RES-0001`).
   - **Usuario / Lector:** Nombre del estudiante, docente o usuario que retira el libro.
   - **Fecha Reserva:** Fecha en la que se efectúa el préstamo.
2. Haz clic en **"Confirmar Reserva"**.
3. **Validaciones automáticas:**
   - Si el libro no existe o la **Cantidad Disponible** es `0`, el sistema denegará la reserva y mostrará una alerta.
   - Si el ID de Reserva ya existe, se evitará la duplicidad.
   - Al confirmarse con éxito, se restará automáticamente `1` unidad de la `Cantidad_Disponible` del libro mediante una transacción SQL atómica.

#### B. Devolución de Libros
1. En la tabla **"Reservas Activas"**, localiza el préstamo a finalizar y presiona **"Registrar devolución"**.
2. Aparecerá una ventana modal donde podrás:
   - Visualizar los detalles del préstamo.
   - Ingresar observaciones de entrega (ej. *"Libro devuelto en buen estado"* o *"Tapa levemente gastada"*).
3. Presiona **"Guardar devolución"**.
4. La reserva pasará al estado **"Devuelta"**, se registrará la fecha de devolución y se sumará automáticamente `1` unidad a la `Cantidad_Disponible` en el catálogo.

#### C. Historial de Reservas Devueltas y Limpieza
- Todas las devoluciones completadas se almacenan en la tabla **"Historial de Reservas Devueltas"** indicando fechas y observaciones.
- Para limpiar el registro histórico de devoluciones completadas, presiona el botón **"Limpiar Historial"** y confirma la acción en el modal.

---

## 🗄️ Estructura de la Base de Datos SQLite

La base de datos se guarda físicamente en `biblioteca.db` y consta del siguiente esquema relacional:

- **`libros`**: `codigo` (PK), `titulo`, `autor`, `id_editorial` (FK), `cantidad`, `cantidad_disponible`, `id_estado` (FK), `numero_curso`, `id_asignatura` (FK).
- **`reservas`**: `id_reserva` (PK), `codigo_libro` (FK), `usuario`, `fecha_reserva`, `estado` (`'Activa'` / `'Devuelta'`), `observaciones`, `fecha_devolucion`.
- **`editoriales`**: `id` (PK AUTOINCREMENT), `nombre` (UNIQUE).
- **`asignatura`**: `id` (PK AUTOINCREMENT), `nombre` (UNIQUE).
- **`estados`**: `id` (PK AUTOINCREMENT), `condicion` (UNIQUE). Los libros nuevos usan `Nuevo` / `Usado`.
- **`meta`**: `clave` (PK), `valor`. Datos internos de la sincronización (hash del último CSV reflejado y marca de cambios pendientes de enviar).

Las claves foráneas están activas y `libros` tiene restricciones `CHECK` (`cantidad >= 0`, `0 <= cantidad_disponible <= cantidad`).

---

## 📂 Estructura del Proyecto

```text
Sistema-Bibliotecario/
├── Iniciar-Biblioteca.bat           # Script de inicio rápido en Windows
├── Base_Datos_Libros_pusap.csv     # Archivo CSV de sincronización con Excel
├── biblioteca.db                    # Archivo de base de datos SQLite
├── index.html                       # Interfaz visual principal (HTML5)
├── style.css                        # Estilos CSS de la aplicación
├── main.js                          # Proceso Principal de Electron (Main Process)
├── preload.cjs                      # Puente seguro Main <-> interfaz (solo canales permitidos)
├── package.json                     # Configuración de dependencias y scripts npm
├── respaldos/                       # Respaldos automáticos de la base (se crea sola)
├── test/                            # Pruebas automáticas (npm test)
├── src/
│   └── main/
│       ├── db.js                    # SQLite (sql.js): esquema, transacciones, guardado atómico, respaldos
│       ├── catalogo.js              # Reglas de libros y reservas (validaciones y cálculo de stock)
│       ├── csvFormat.js             # Lectura/escritura del CSV de Excel (codificación, comillas, columnas)
│       ├── csvService.js            # Sincronización base <-> CSV: importar, exportar, vigilar, reintentar
│       ├── ipcHandlers.js           # Handlers de comunicación IPC (Main <-> Renderer)
│       └── windowManager.js         # Configuración y creación de ventanas BrowserWindow
└── js/                              # Proceso de Renderizado (Renderer Process)
    ├── App.js                       # Punto de entrada de la UI y listeners globales
    ├── state.js                     # Estado reactivo en memoria
    ├── utils.js                     # Funciones de ayuda
    ├── modules/
    │   ├── inventario.js            # Lógica de renderizado y acciones de inventario
    │   └── reservas.js              # Lógica de registro, devolución e historial de reservas
    ├── services/
    │   └── ipcService.js            # Cliente IPC para llamadas asíncronas al Main Process
    └── ui/
        ├── modales.js               # Manejo de diálogos modales (Confirmación / Devolución)
        └── notificaciones.js        # Sistema de alertas Toast de la interfaz
```

---

## ✅ Pruebas

```bash
npm test
```

Verifica el formato CSV (comillas, tildes, codificaciones), las reglas de stock y reservas, la sincronización en ambos sentidos, el bloqueo por Excel y la recuperación de una base dañada. Trabajan sobre carpetas temporales: no tocan tus datos.

---

## 📦 Empaquetado y Distribución

Para generar el paquete ejecutable redistribuible para Windows (`.exe`):

```bash
npm run package
```

El ejecutable compilado se generará en la carpeta `dist/Sistema-Biblioteca-win32-x64/`.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **ISC**.
