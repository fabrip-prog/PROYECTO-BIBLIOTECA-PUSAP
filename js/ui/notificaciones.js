/**
 * Muestra una notificación flotante estilo Toast en la interfaz.
 * `duracionMs` permite dejar más tiempo los mensajes largos (resúmenes de sincronización, errores).
 */
export function mostrarNotificacion(mensaje, tipo = "info", duracionMs = 3200) {
    const contenedor = document.getElementById("contenedor-notificaciones");
    if (!contenedor) return;

    const notificacion = document.createElement("div");
    notificacion.className = `notificacion ${tipo}`;
    notificacion.textContent = mensaje;
    contenedor.appendChild(notificacion);

    window.setTimeout(() => notificacion.classList.add("visible"), 10);
    window.setTimeout(() => {
        notificacion.classList.remove("visible");
        notificacion.classList.add("oculta");
        window.setTimeout(() => notificacion.remove(), 280);
    }, duracionMs);
}
