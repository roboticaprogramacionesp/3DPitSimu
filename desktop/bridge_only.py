# ==========================================================
# PitSimulator - desktop/bridge_only.py
#
# "Puente local" standalone: arranca SOLO el bridge QEMU (server/
# server.js + QEMU + GDB vendorizados), sin servir el frontend ni
# abrir ninguna ventana propia -- para usar cuando el frontend real
# vive en GitHub Pages (ver desktop/README_puente.md), no en esta
# máquina. El navegador del estudiante (con la página de GitHub Pages
# abierta) se conecta solo a ws://127.0.0.1:8787 -- js/simulator/
# QemuBridge.js ya hace exactamente eso hoy, sin ningún cambio.
#
# Reusa start_bridge()/watch_bridge()/stop_bridge() de bridge_core.py
# tal cual (misma resolución de vendorizados/bridge_config.py que la
# app de escritorio completa, desktop/main.py) -- no reimplementa
# nada de esa lógica para no divergir.
#
# SIN ventana de consola (build --windowed, ver
# desktop/build/build_bridge_onefile.py): en vez de la ventana negra
# de antes, este proceso vive como un ícono en la bandeja del sistema
# (junto al reloj) -- clic derecho -> "Salir" para cerrarlo. El log
# sigue existiendo (ver bridge_core._log()), pero ahora va a un
# archivo (3DPitSimu-Puente.log al lado del .exe) en vez de a una
# consola, porque una consola ya no existe. Si pystray/Pillow no
# estan disponibles (ej. corriendo bridge_only.py suelto en un entorno
# sin esas libs) cae de vuelta al modo anterior (bucle + Ctrl+C), para
# no romper el uso "desde el codigo fuente" documentado mas abajo.
#
# Uso:
#   python desktop/bridge_only.py
#   (o el .exe empaquetado -- ver desktop/README_puente.md)
#
# Para permitir que una página de GitHub Pages (origen distinto de
# localhost/127.0.0.1) se conecte, hay DOS formas de sumar ese host
# (ver bridge_core.get_allowed_origins(), se combinan las dos):
#   1. Editar allowed_origins.txt (al lado de este archivo, o al lado
#      del .exe si es la version empaquetada) -- un host por linea.
#      Es la forma pensada para que alguien sin conocimientos de
#      consola pueda simplemente doble-clickear el .exe sin tocar nada
#      mas (ya viene con un default cargado, ver ese archivo).
#   2. La variable de entorno ALLOWED_ORIGINS (coma-separada si hay mas
#      de un host), para uso avanzado/scripts, ej. en PowerShell:
#        $env:ALLOWED_ORIGINS = "tuusuario.github.io"
#        python desktop/bridge_only.py
# Si ninguna de las dos tiene nada, solo se aceptan conexiones desde
# localhost/127.0.0.1 (mismo comportamiento que la app de escritorio).
# ==========================================================

import signal
import threading
import time

from bridge_core import RESOURCE_DIR, _log, get_allowed_origins, start_bridge, stop_bridge, watch_bridge

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    pystray = None


def _base_icon_image():
    # El mismo icon.ico que ya usan 3DPitSimu.exe/3DPitSimu-Puente.exe
    # como icono de archivo (ver --icon en desktop/build/build_*.py) --
    # embebido aparte via --add-data en build_bridge_onefile.py, con la
    # MISMA ruta relativa "desktop/build/icon.ico" que tiene en el repo,
    # para que esta misma cuenta sirva tanto en frozen (RESOURCE_DIR =
    # carpeta temporal autoextraida) como en dev (RESOURCE_DIR = raiz
    # del repo, ver bridge_core.py).
    icon_path = RESOURCE_DIR / "desktop" / "build" / "icon.ico"
    if icon_path.exists():
        try:
            return Image.open(icon_path).convert("RGBA")
        except Exception:
            pass
    # Respaldo si el .ico no se pudo cargar (ej. corriendo bridge_only.py
    # suelto sin ese archivo al lado) -- circulo simple, mismo color
    # indigo (#4f46e5) que el resto de la UI del proyecto.
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((4, 4, size - 4, size - 4), fill=(79, 70, 229, 255))
    draw.ellipse((20, 20, size - 20, size - 20), fill=(255, 255, 255, 255))
    return img


# Estado de conexion del puente, reflejado en el icono de la bandeja
# como un badge circular chico (esquina inferior derecha) sobre el
# icon.ico de siempre -- mismo patron que el punto de "en linea" de
# Slack/Discord/Teams. "idle" (arrancado, sin nadie conectado todavia)
# no dibuja ningun badge -- CERO cambio visual respecto de como se veia
# el icono antes de este cambio, para no romper la identidad de marca
# ya conocida por quien lo usa.
_STATUS_BADGE_COLOR = {
    "connected": (34, 197, 94, 255),   # verde -- el navegador esta conectado
    "down": (239, 68, 68, 255),        # rojo -- el bridge se cayo, reintentando
}

_STATUS_TITLE = {
    "idle": "3DPitSimu -- Puente local activo",
    "disconnected": "3DPitSimu -- Puente local activo",
    "connected": "3DPitSimu -- Puente local activo (conectado)",
    "down": "3DPitSimu -- Puente reiniciando...",
}


def _tray_icon_image(status="idle"):
    img = _base_icon_image().copy()
    color = _STATUS_BADGE_COLOR.get(status)
    if color is not None:
        w, h = img.size
        d = max(int(w * 0.42), 16)
        x1, y1 = w - d, h - d
        draw = ImageDraw.Draw(img)
        # Borde blanco alrededor del badge para que se lea bien encima
        # de cualquier color de fondo del icono base.
        draw.ellipse((x1 - 3, y1 - 3, w, h), fill=(255, 255, 255, 255))
        draw.ellipse((x1, y1, w, h), fill=color)
    return img


def main():

    allowed = get_allowed_origins()

    _log("[puente] 3DPitSimu -- puente local")
    if allowed:
        _log(f"[puente] Orígenes extra permitidos: {', '.join(allowed)}")
    else:
        _log("[puente] No hay orígenes extra configurados -- solo se van a aceptar")
        _log("[puente] conexiones desde páginas en localhost/127.0.0.1. Si vas a")
        _log("[puente] usar la versión de GitHub Pages, agregá tu dominio a")
        _log("[puente] allowed_origins.txt y volvé a arrancar (ver desktop/README_puente.md).")

    icon_holder = {"icon": None}
    status_holder = {"status": "idle"}

    def _on_status(status):
        status_holder["status"] = status
        icon = icon_holder["icon"]
        if icon is not None:
            # pystray soporta reasignar .icon/.title en caliente desde
            # otro hilo (icon.run() bloquea el hilo principal mas
            # abajo) -- asi el badge cambia sin reiniciar el icono de
            # bandeja.
            icon.icon = _tray_icon_image(status)
            icon.title = _STATUS_TITLE.get(status, _STATUS_TITLE["idle"])

    bridge = {"proc": start_bridge(on_status=_on_status), "shutting_down": False}

    threading.Thread(
        target=watch_bridge, args=(bridge,), kwargs={"on_status": _on_status}, daemon=True
    ).start()

    def _shutdown(*_args):
        if bridge["shutting_down"]:
            return
        _log("[puente] Cerrando el puente...")
        bridge["shutting_down"] = True
        stop_bridge(bridge["proc"])
        if icon_holder["icon"] is not None:
            icon_holder["icon"].stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    if pystray is not None:
        _log("[puente] Sin ventana -- buscá el ícono junto al reloj (bandeja del")
        _log("[puente] sistema). Un punto verde aparece en el ícono cuando el")
        _log("[puente] navegador está conectado. Clic derecho -> 'Salir' para cerrar.")

        def _on_exit(icon, item):
            _shutdown()

        icon = pystray.Icon(
            "3DPitSimu-Puente",
            _tray_icon_image(status_holder["status"]),
            _STATUS_TITLE[status_holder["status"]],
            menu=pystray.Menu(pystray.MenuItem("Salir", _on_exit)),
        )
        icon_holder["icon"] = icon
        icon.run()  # bloquea este hilo hasta icon.stop() (ver _shutdown/_on_exit)
    else:
        # Sin pystray/Pillow (ej. entorno de desarrollo sin esas libs
        # instaladas) -- mismo comportamiento de antes: bucle + Ctrl+C.
        _log("[puente] (pystray no disponible -- corriendo sin ícono de bandeja,")
        _log("[puente] Ctrl+C para cerrar si hay consola.)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            _shutdown()


if __name__ == "__main__":
    main()
