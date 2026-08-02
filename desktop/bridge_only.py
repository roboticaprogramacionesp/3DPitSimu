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
# localhost/127.0.0.1) se conecte, seteá ALLOWED_ORIGINS ANTES de
# arrancar (coma-separado si hay más de un host), ej. en PowerShell:
#   $env:ALLOWED_ORIGINS = "tuusuario.github.io"
#   python desktop/bridge_only.py
# Sin esa variable seteada, sigue aceptando solo localhost/127.0.0.1
# (mismo comportamiento que la app de escritorio).
# ==========================================================

import os
import signal
import sys
import threading
import time

from bridge_core import _log, start_bridge, stop_bridge, watch_bridge


def main():

    allowed = os.environ.get("ALLOWED_ORIGINS", "").strip()

    _log("[puente] PitSimulator -- puente local")
    _log("[puente] Este proceso NO abre ninguna ventana -- dejalo corriendo en")
    _log("[puente] segundo plano y abrí la página del simulador en tu navegador.")
    if allowed:
        _log(f"[puente] Orígenes extra permitidos (ALLOWED_ORIGINS): {allowed}")
    else:
        _log("[puente] ALLOWED_ORIGINS no está seteada -- solo se van a aceptar")
        _log("[puente] conexiones desde páginas en localhost/127.0.0.1. Si vas a")
        _log("[puente] usar la versión de GitHub Pages, cerrá esto (Ctrl+C),")
        _log("[puente] seteá ALLOWED_ORIGINS a tu dominio de GitHub Pages y volvé")
        _log("[puente] a arrancar (ver desktop/README_puente.md).")
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
