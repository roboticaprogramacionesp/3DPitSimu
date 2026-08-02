# ==========================================================
# PitSimulator - desktop/bridge_core.py
#
# Logica compartida del "puente" (QEMU+GDB+server/server.js) entre
# desktop/main.py (app de escritorio completa, con ventana) y
# desktop/bridge_only.py (puente standalone sin ventana, para usar
# la version de GitHub Pages -- ver desktop/README_puente.md).
# Extraido de main.py sin cambiar el comportamiento (mismo criterio
# de resolucion de rutas/vendorizados/bridge_config.py de siempre),
# para no duplicar esta logica en dos archivos y que diverjan.
# ==========================================================

import os
import subprocess
import sys
import threading
import time
from pathlib import Path


def _log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# Windows abre una consola visible para cualquier proceso de consola
# lanzado salvo que se le pida explicitamente que no lo haga.
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


# ----------------------------------------------------------
# Rutas: dev (python desktop/main.py o desktop/bridge_only.py) vs.
# empaquetado (PyInstaller --onedir) -- en ambos casos terminamos con
# una carpeta real en disco que tiene server/ al lado, solo cambia
# DONDE esta esa carpeta. sys.executable en tiempo de ejecucion
# siempre apunta al .exe que esta corriendo de verdad (el de main.py
# o el de bridge_only.py, cada uno con su propio dist/), asi que esta
# resolucion sirve igual para los dos sin importar desde cual de los
# dos se importe este modulo.
# ----------------------------------------------------------

if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
    VENDOR_DIR = APP_DIR / "vendor"
else:
    APP_DIR = Path(__file__).resolve().parent.parent
    VENDOR_DIR = Path(__file__).resolve().parent / "vendor"

BASE_DIR = APP_DIR
SERVER_DIR = APP_DIR / "server"

VENDOR_QEMU_BIN = VENDOR_DIR / "qemu-xtensa" / "bin" / "qemu-system-xtensa.exe"
VENDOR_GDB_BIN = VENDOR_DIR / "xtensa-esp-elf-gdb" / "bin" / "xtensa-esp32-elf-gdb.exe"
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
# Bridge QEMU (server/server.js)
# ----------------------------------------------------------

def start_bridge(extra_env=None):

    if not SERVER_DIR.exists():
        _log(f"AVISO: no se encontro {SERVER_DIR} -- el bridge no puede arrancar.")
        return None

    # Prioridad: 1) binarios vendorizados (portables, viajan con la
    # distribucion) 2) bridge_config.py (rutas reales de ESTA maquina
    # de desarrollo) 3) variable de entorno del sistema. Vendorizado
    # gana siempre que exista. bridge_config.py sobre la variable de
    # entorno porque una variable de usuario de Windows vieja
    # (placeholder) puede pisar silenciosamente la ruta real si la
    # prioridad fuera al reves, confirmado en la practica.
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
        **(extra_env or {}),
    }

    # Node -- mismo criterio: vendorizado si existe, si no el "node"
    # del PATH del sistema (solo relevante en dev; la distribucion
    # final SIEMPRE debe traer el vendorizado).
    node_bin = str(VENDOR_NODE_BIN) if VENDOR_NODE_BIN.exists() else "node"

    _log(f"QEMU_BIN={'vendorizado' if VENDOR_QEMU_BIN.exists() else 'externo'} "
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
        _log(f"AVISO: no se encontro '{node_bin}' -- el bridge no puede arrancar.")
        return None

    def pump_output():
        for line in proc.stdout:
            _log(f"[bridge] {line.rstrip()}")

    threading.Thread(target=pump_output, daemon=True).start()

    _log(f"Bridge QEMU arrancando (pid={proc.pid})...")
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

    # Red de seguridad adicional -- confirmado en la practica que GDB
    # (el interprete Python que trae embebido, NO el binario principal
    # que si muere con /T) a veces queda vivo pese al taskkill /T de
    # arriba. Matar por NOMBRE de imagen es mas agresivo pero seguro
    # en este contexto: estos nombres son especificos de este
    # proyecto, cualquier instancia corriendo en la practica fue
    # lanzada por esta misma app.
    for image_name in ("qemu-system-xtensa.exe", "xtensa-esp-elf-gdb*.exe", "xtensa-esp32-elf-gdb.exe"):
        subprocess.run(
            ["taskkill", "/IM", image_name, "/F"],
            capture_output=True, creationflags=_NO_WINDOW,
        )


def watch_bridge(bridge, extra_env=None):
    """Corre en un thread propio. `bridge` es un dict {"proc":..., "shutting_down": bool}
    compartido con quien lo llama -- si el proceso del bridge muere solo (QEMU/Node
    crashea), lo relanza automaticamente sin que el usuario tenga que hacer nada."""
    while True:
        time.sleep(2)
        if bridge["shutting_down"]:
            return
        proc = bridge["proc"]
        if proc is None or proc.poll() is None:
            continue  # sigue vivo (o nunca arranco), nada que hacer
        _log("El bridge QEMU termino -- relanzando...")
        stop_bridge(proc)  # red de seguridad: limpia restos aunque proc ya haya muerto
        if bridge["shutting_down"]:
            return
        bridge["proc"] = start_bridge(extra_env)
