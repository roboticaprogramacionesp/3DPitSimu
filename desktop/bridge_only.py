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
import sys
import threading
import time

from bridge_core import _log, get_allowed_origins, start_bridge, stop_bridge, watch_bridge


def main():

    allowed = get_allowed_origins()

    _log("[puente] 3DPitSimu -- puente local")
    _log("[puente] Este proceso NO abre ninguna ventana -- dejalo corriendo en")
    _log("[puente] segundo plano y abrí la página del simulador en tu navegador.")
    if allowed:
        _log(f"[puente] Orígenes extra permitidos: {', '.join(allowed)}")
    else:
        _log("[puente] No hay orígenes extra configurados -- solo se van a aceptar")
        _log("[puente] conexiones desde páginas en localhost/127.0.0.1. Si vas a")
        _log("[puente] usar la versión de GitHub Pages, cerrá esto (Ctrl+C), agregá")
        _log("[puente] tu dominio a allowed_origins.txt y volvé a arrancar (ver")
        _log("[puente] desktop/README_puente.md).")
    _log("[puente] Para cerrar el puente: Ctrl+C.")

    bridge = {"proc": start_bridge(), "shutting_down": False}

    threading.Thread(target=watch_bridge, args=(bridge,), daemon=True).start()

    def _shutdown(*_args):
        if bridge["shutting_down"]:
            return
        _log("[puente] Cerrando el puente...")
        bridge["shutting_down"] = True
        stop_bridge(bridge["proc"])
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # No hay ventana/webview.start() que bloquee acá -- el proceso se
    # mantiene vivo esperando Ctrl+C (o SIGTERM), igual que cualquier
    # proceso de consola de larga duración.
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        _shutdown()


if __name__ == "__main__":
    main()
