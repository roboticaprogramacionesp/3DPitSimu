# ==========================================================
# PitSimulator - desktop/main.py
#
# Punto de entrada de la version de escritorio. Levanta:
#   1. Un servidor HTTP local para servir el frontend estatico
#      (index.html/js/css/components/...) -- hace falta porque el
#      frontend hace fetch() de rutas relativas (manifest.json, cada
#      .svg de componente, .hal.py, .behavior.js) que no funcionan
#      bajo file://.
#   2. El bridge QEMU (server/server.js) como proceso Node hijo,
#      AUTOMATICAMENTE al abrir la app (no al hacer clic en Simular --
#      pedido explicito del usuario). El frontend (QemuBridge.js) no
#      se toca para nada: sigue asumiendo que el WS ya esta arriba
#      cuando el usuario aprieta "Simular", exactamente igual que hoy
#      con el flujo manual de 2 terminales.
#   3. Una ventana nativa (pywebview) apuntando al servidor HTTP local.
#
# QEMU/GDB/Node viajan VENDORIZADOS (copias portables, ver desktop/
# vendor/README.md) para que la app final ande en cualquier PC sin que
# el otro usuario tenga que instalar nada -- bridge_config.py/las
# variables de entorno del sistema son solo un fallback para
# desarrollo en esta máquina si desktop/vendor/ no existe.
# ==========================================================

import functools
import http.server
import os
import subprocess
import threading

import webview

from bridge_core import (
    _log,
    _NO_WINDOW,
    BASE_DIR,
    start_bridge,
    stop_bridge,
    watch_bridge,
)


# ----------------------------------------------------------
# 0. Portapapeles nativo -- pywebview con text_select=True alcanza
# para SELECCIONAR texto, pero copiar/pegar de verdad (los eventos
# nativos "copy"/"paste" del navegador) resultó no ser confiable
# dentro del motor WebView2 embebido (confirmado en la práctica, con
# el mismo síntoma ya resuelto antes en la otra app de escritorio del
# proyecto -- "3DPit Blocks" -- con este mismo approach). PowerShell
# Get-Clipboard/Set-Clipboard es el método más confiable en Windows,
# no bloquea el hilo de la UI (corre en un subprocess aparte). Se
# expone como js_api para que el frontend (ver ReplPanel.js) lo llame
# explícitamente en vez de depender del portapapeles del navegador.
# ----------------------------------------------------------

# BUG REAL encontrado en la práctica: subprocess.run() de "powershell"
# sin esto hace parpadear una consola NEGRA visible en pantalla cada
# vez que se copia/pega (Windows abre una ventana de consola real para
# cualquier proceso de consola lanzado, salvo que se le pida
# explícitamente que no lo haga). CREATE_NO_WINDOW evita esa ventana
# por completo -- el subprocess sigue corriendo igual, solo que sin
# consola visible. (_NO_WINDOW importado de bridge_core.)


def _clipboard_get():
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
            capture_output=True, text=True, timeout=3, encoding="utf-8",
            creationflags=_NO_WINDOW,
        )
        return result.stdout.rstrip("\r\n")
    except Exception:
        return ""


def _clipboard_set(text):
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "$input | Set-Clipboard"],
            input=text, capture_output=True, text=True, encoding="utf-8", timeout=3,
            creationflags=_NO_WINDOW,
        )
        return proc.returncode == 0
    except Exception:
        return False


class Api:
    def get_clipboard(self):
        try:
            return _clipboard_get()
        except Exception:
            return ""

    def set_clipboard(self, text):
        try:
            return {"status": "ok" if _clipboard_set(text) else "error"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

# Rutas/vendorizados/bridge_config.py, start_bridge()/stop_bridge() --
# ver desktop/bridge_core.py (compartido con desktop/bridge_only.py).

# ----------------------------------------------------------
# 1. Servidor HTTP local para el frontend estatico
# ----------------------------------------------------------

class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    # SimpleHTTPRequestHandler loguea cada request a stderr por
    # default -- silenciado para no mezclar ruido HTTP con los logs
    # del bridge QEMU en la misma consola.
    def log_message(self, format, *args):
        pass


def start_static_server(root_dir):
    handler = functools.partial(_QuietHandler, directory=str(root_dir))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    port = httpd.server_address[1]
    _log(f"[desktop] Frontend servido en http://127.0.0.1:{port}/")
    return httpd, port


# ----------------------------------------------------------
# 3. Arranque
# ----------------------------------------------------------

def main():

    _log("[desktop] Arrancando...")
    httpd, port = start_static_server(BASE_DIR)

    # Estado mutable compartido con el watcher de abajo -- un dict en
    # vez de una variable local de main() porque el hilo del watcher
    # necesita LEER y ACTUALIZAR cuál es el proceso "actual" del
    # bridge, y una closure sobre una variable local de otra función
    # no se puede reasignar así nomás desde adentro (nonlocal andaría,
    # pero un dict es más simple de pasar entre las funciones de acá
    # abajo sin duplicar la lógica de arranque/parada en cada una).
    bridge = {"proc": start_bridge(), "shutting_down": False}

    # BUG REAL que esto resuelve: si el bridge (QEMU/GDB) se cuelga o
    # crashea de una forma que server.js no nota solo (server.js sí
    # hace process.exit() cuando QEMU termina, ver el "proc.on(exit)"
    # de server.js -- lo que faltaba era quién relanza TODO el proceso
    # de Node después de eso), antes la única forma de recuperarse era
    # cerrar la app entera y volver a abrirla. Este watcher nota que
    # bridge_proc terminó (por el motivo que sea) y relanza todo de
    # nuevo (stop_bridge por las dudas -- limpia cualquier GDB/QEMU
    # huérfano que haya quedado -- y start_bridge de cero). El usuario
    # no tiene que hacer nada -- el frontend (QemuBridge.js) ya sabe
    # reconectar solo apenas el WS vuelve a estar arriba. La forma
    # "normal" de destrabar un REPL colgado sigue siendo "🔄 Recargar"
    # del menú de proyecto (recarga la página, ver Toolbar.js) -- este
    # watcher es una red de seguridad aparte, para cuando el problema
    # es más profundo (el proceso de QEMU/Node en sí murió). Implementación
    # compartida con desktop/bridge_only.py, ver bridge_core.watch_bridge().
    threading.Thread(target=watch_bridge, args=(bridge,), daemon=True).start()

    _log("[desktop] Creando ventana...")
    window = webview.create_window(
        "PitSimulator",
        f"http://127.0.0.1:{port}/index.html",
        # Antes 1400x900 -- tapaba pantallas chicas al abrir. Arranca
        # más chica, el usuario maximiza/agranda si quiere (resizable
        # ya es True por default).
        width=1100,
        height=720,
        min_size=(900, 600),
        # pywebview no deja seleccionar texto por defecto (text_select
        # es False) -- sin esto, ni seleccionar se podía.
        text_select=True,
        # Portapapeles nativo (ver clase Api arriba) -- queda expuesto
        # en el frontend como window.pywebview.api.get_clipboard()/
        # set_clipboard(), ver ReplPanel.js _bindNativeClipboard().
        js_api=Api(),
    )

    def on_closing():
        _log("[desktop] Cerrando -- deteniendo el bridge QEMU...")
        # Avisarle al watcher ANTES de matar el proceso -- si no, hay
        # una ventana real (hasta 2s, el intervalo de polling) donde
        # nota "terminó" y lo relanza justo cuando la app se está
        # cerrando.
        bridge["shutting_down"] = True
        stop_bridge(bridge["proc"])

    window.events.closing += on_closing

    # Solo para pruebas automatizadas (Playwright/CI no puede clickear una
    # ventana nativa) -- si esta seteada, cierra la ventana sola despues
    # de N segundos, disparando el mismo evento "closing" que un cierre
    # real, para poder validar la limpieza de procesos sin interaccion
    # humana. Nunca esta seteada en el uso normal.
    autoclose = os.environ.get("PIT_DESKTOP_AUTOCLOSE_SECONDS")
    if autoclose:
        _log(f"[desktop] Auto-cierre programado en {autoclose}s (solo pruebas)")
        threading.Timer(float(autoclose), window.destroy).start()

    _log("[desktop] webview.start()...")
    webview.start()
    _log("[desktop] webview.start() retorno.")

    httpd.shutdown()


if __name__ == "__main__":
    main()
