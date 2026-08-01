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
import sys
import threading
import time
from pathlib import Path

import webview


def _log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


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
# consola visible.
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


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

# ----------------------------------------------------------
# Rutas: dev (python desktop/main.py) vs. empaquetado (PyInstaller
# --onedir, ver desktop/build/prepare_dist.py) -- en ambos casos
# terminamos con una carpeta real en disco que tiene index.html y
# server/ al lado, solo cambia DONDE esta esa carpeta.
# ----------------------------------------------------------

if getattr(sys, "frozen", False):
    # Empaquetado: este .exe vive en dist/PitSimulator/, con el
    # frontend, server/ y vendor/ copiados al lado por prepare_dist.py
    # (vendor/ sin el prefijo "desktop/" -- prepare_dist.py copia el
    # CONTENIDO de desktop/vendor/, no la carpeta con ese nombre).
    APP_DIR = Path(sys.executable).resolve().parent
    VENDOR_DIR = APP_DIR / "vendor"
else:
    # Dev: este archivo vive en desktop/, la raiz del repo es un
    # nivel arriba.
    APP_DIR = Path(__file__).resolve().parent.parent
    VENDOR_DIR = Path(__file__).resolve().parent / "vendor"

BASE_DIR = APP_DIR
SERVER_DIR = APP_DIR / "server"

# QEMU/GDB "vendorizados" -- una copia PORTABLE de los binarios reales
# (ver desktop/vendor/README.md), para que la distribucion final ande
# en cualquier PC sin que el otro usuario tenga que instalar nada. Si
# no existen (repo recien clonado, sin correr el paso que los copia
# ahi), la app sigue andando igual con bridge_config.py/las variables
# de entorno del sistema -- son un plus, no un requisito.
VENDOR_QEMU_BIN = VENDOR_DIR / "qemu-xtensa" / "bin" / "qemu-system-xtensa.exe"
VENDOR_GDB_BIN = VENDOR_DIR / "xtensa-esp-elf-gdb" / "bin" / "xtensa-esp32-elf-gdb.exe"
# Node portable oficial (nodejs.org, .zip win-x64, sin instalador) --
# la app final NO debe requerir que el otro usuario tenga Node
# instalado, así que server.js se corre con ESTE node.exe si existe,
# nunca con "node" del PATH.
VENDOR_NODE_BIN = VENDOR_DIR / "nodejs" / "node.exe"

try:
    from bridge_config import DEFAULT_GDB_BIN, DEFAULT_QEMU_BIN
except ImportError:
    # No hay bridge_config.py (ej. clon fresco del repo sin copiar la
    # plantilla) -- el bridge igual intenta arrancar respetando
    # QEMU_BIN/GDB_BIN del entorno si estan seteadas ahi (o usando los
    # binarios vendorizados, si existen).
    DEFAULT_QEMU_BIN = ""
    DEFAULT_GDB_BIN = ""


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
# 2. Bridge QEMU (server/server.js) -- se lanza una sola vez, al
#    abrir la app.
# ----------------------------------------------------------

def start_bridge():

    if not SERVER_DIR.exists():
        _log(f"[desktop] AVISO: no se encontro {SERVER_DIR} -- el simulador "
             "abre igual, pero 'Simular' no va a poder conectar.")
        return None

    # Prioridad: 1) binarios vendorizados (portables, viajan con la
    # distribución -- ver VENDOR_QEMU_BIN/VENDOR_GDB_BIN) 2) bridge_
    # config.py (rutas reales de ESTA máquina de desarrollo) 3)
    # variable de entorno del sistema. Vendorizado gana siempre que
    # exista: es la copia probada/empaquetada, no depende de qué tenga
    # instalado la máquina donde termine corriendo la app. bridge_
    # config.py sobre la variable de entorno por lo mismo que ya
    # documentado abajo -- una variable de usuario de Windows vieja
    # (placeholder) puede pisar silenciosamente la ruta real si la
    # prioridad fuera al revés, confirmado en la práctica.
    qemu_bin = (
        str(VENDOR_QEMU_BIN) if VENDOR_QEMU_BIN.exists()
        else DEFAULT_QEMU_BIN or os.environ.get("QEMU_BIN", "")
    )
    gdb_bin = (
        str(VENDOR_GDB_BIN) if VENDOR_GDB_BIN.exists()
        else DEFAULT_GDB_BIN or os.environ.get("GDB_BIN", "")
    )

    env = {
        **os.environ,
        "QEMU_BIN": qemu_bin,
        "GDB_BIN": gdb_bin,
        "MP_ELF": str(SERVER_DIR / "micropython.elf"),
    }

    # Node -- mismo criterio: vendorizado si existe, si no el "node"
    # del PATH del sistema (solo relevante en dev; la distribución
    # final SIEMPRE debe traer el vendorizado, ver desktop/vendor/README.md).
    node_bin = str(VENDOR_NODE_BIN) if VENDOR_NODE_BIN.exists() else "node"

    _log(f"[desktop] QEMU_BIN={'vendorizado' if VENDOR_QEMU_BIN.exists() else 'externo'} "
         f"GDB_BIN={'vendorizado' if VENDOR_GDB_BIN.exists() else 'externo'} "
         f"NODE_BIN={'vendorizado' if VENDOR_NODE_BIN.exists() else 'externo'}")

    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

    try:
        proc = subprocess.Popen(
            [node_bin, "server.js"],
            cwd=str(SERVER_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=creationflags,
        )
    except FileNotFoundError:
        _log(f"[desktop] AVISO: no se encontro '{node_bin}' -- el "
             "simulador abre igual, pero 'Simular' no va a poder conectar.")
        return None

    def pump_output():
        for line in proc.stdout:
            _log(f"[bridge] {line.rstrip()}")

    threading.Thread(target=pump_output, daemon=True).start()

    _log(f"[desktop] Bridge QEMU arrancando (pid={proc.pid})...")
    return proc


def stop_bridge(proc):

    if sys.platform != "win32":
        if proc is not None and proc.poll() is None:
            proc.terminate()
        return

    # server.js no maneja SIGTERM/SIGINT, y en Windows matar el
    # proceso padre no mata a sus hijos (QEMU/GDB) -- taskkill /T
    # recorre todo el arbol de descendientes.
    if proc is not None and proc.poll() is None:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True, creationflags=_NO_WINDOW,
        )

    # Red de seguridad adicional -- confirmado en la práctica que GDB
    # (xtensa-esp-elf-gdb-3.11.exe, el intérprete Python que trae
    # embebido, NO el binario principal que sí muere con /T) a veces
    # queda vivo pese al taskkill /T de arriba, aparentemente porque
    # se re-lanza de una forma que lo "escapa" del árbol de procesos
    # que Windows le atribuye al PID original. Matar por NOMBRE de
    # imagen es más agresivo pero seguro en este contexto: estos
    # nombres son específicos de este proyecto, cualquier instancia
    # corriendo en la práctica fue lanzada por esta misma app.
    for image_name in ("qemu-system-xtensa.exe", "xtensa-esp-elf-gdb*.exe", "xtensa-esp32-elf-gdb.exe"):
        subprocess.run(
            ["taskkill", "/IM", image_name, "/F"],
            capture_output=True, creationflags=_NO_WINDOW,
        )


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
    # es más profundo (el proceso de QEMU/Node en sí murió).
    def watch_bridge():
        while True:
            time.sleep(2)
            if bridge["shutting_down"]:
                return
            proc = bridge["proc"]
            if proc is None or proc.poll() is None:
                continue  # sigue vivo (o nunca arrancó), nada que hacer
            _log("[desktop] El bridge QEMU terminó -- relanzando...")
            stop_bridge(proc)  # red de seguridad: limpia restos aunque proc ya haya muerto
            if bridge["shutting_down"]:
                return
            bridge["proc"] = start_bridge()

    threading.Thread(target=watch_bridge, daemon=True).start()

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
