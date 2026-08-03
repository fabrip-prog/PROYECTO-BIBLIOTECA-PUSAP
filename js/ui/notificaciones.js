/**
 * Muestra una notificación flotante estilo Toast en la interfaz
 */
export function mostrarNotificacion(mensaje, tipo = "info") {
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
    }, 3200);
}
