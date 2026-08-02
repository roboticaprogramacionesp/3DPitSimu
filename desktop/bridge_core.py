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
# empaquetado -- y dentro de empaquetado, --onedir (una carpeta con el
# .exe y server/vendor/etc AL LADO) vs. --onefile (un solo .exe que
# AUTOEXTRAE esos recursos a una carpeta temporal en cada apertura,
# ver sys._MEIPASS -- PyInstaller la crea solo cuando el build es
# onefile, por eso alcanza con mirar si existe para distinguir los dos
# modos empaquetados sin necesitar un flag propio).
#
# APP_DIR es SIEMPRE donde vive el .exe real (Desktop, dist/, donde
# sea) -- ahi es donde tiene sentido buscar/crear archivos que el
# usuario deba poder editar a mano (allowed_origins.txt). RESOURCE_DIR
# es de donde salen los recursos empaquetados (server/, vendor/, y en
# main.py el frontend) -- coincide con APP_DIR salvo en onefile, donde
# apunta a la carpeta temporal autoextraida.
# ----------------------------------------------------------

if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(sys._MEIPASS) if hasattr(sys, "_MEIPASS") else APP_DIR
    VENDOR_DIR = RESOURCE_DIR / "vendor"
    CONFIG_DIR = APP_DIR
else:
    APP_DIR = Path(__file__).resolve().parent.parent
    RESOURCE_DIR = APP_DIR
    VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
    # A diferencia de APP_DIR (raiz del repo, para servir el frontend
    # desde main.py), la config del bridge vive junto a ESTE archivo
    # (desktop/) -- en frozen ambos coinciden (todo vive al lado del
    # .exe), en dev no.
    CONFIG_DIR = Path(__file__).resolve().parent

BASE_DIR = RESOURCE_DIR
SERVER_DIR = RESOURCE_DIR / "server"

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

def _allowed_origins_candidates():
    # APP_DIR primero: al lado del .exe REAL (Desktop, USB, donde sea)
    # -- funciona en onedir Y en onefile, y es editable sin recompilar
    # nada (a diferencia de la carpeta temporal autoextraida de
    # onefile, que se borra al cerrar). CONFIG_DIR cubre dev (desktop/
    # allowed_origins.txt). RESOURCE_DIR es el que trae EMBEBIDO un
    # build onefile (ver desktop/build/build_bridge_onefile.py) -- el
    # default con el que arranca sin que nadie toque nada, si no hay
    # ninguno de los otros dos.
    seen = []
    for d in (APP_DIR, CONFIG_DIR, RESOURCE_DIR):
        p = d / "allowed_origins.txt"
        if p not in seen:
            seen.append(p)
    return seen


def read_allowed_origins_file():
    """Hosts extra listados en allowed_origins.txt (uno por linea,
    '#' para comentarios) -- para que quien reciba el puente empaquetado
    NO tenga que abrir una consola/PowerShell a setear ALLOWED_ORIGINS:
    alcanza con doble click al .exe. Se puede editar ese .txt a mano
    (ej. para apuntar a otro usuario/repo de GitHub Pages) sin tener
    que recompilar nada -- ver _allowed_origins_candidates()."""
    for path in _allowed_origins_candidates():
        if path.exists():
            hosts = []
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.split("#", 1)[0].strip()
                if line:
                    hosts.append(line)
            return hosts
    return []


def get_allowed_origins():
    """Union de la env var ALLOWED_ORIGINS (coma-separada) y el archivo
    allowed_origins.txt -- ver start_bridge()/read_allowed_origins_file()."""
    from_env = [h.strip() for h in os.environ.get("ALLOWED_ORIGINS", "").split(",") if h.strip()]
    from_file = read_allowed_origins_file()
    # dict.fromkeys en vez de set() para no perder el orden (mas facil
    # de leer en los logs) y no repetir si el mismo host esta en los dos.
    return list(dict.fromkeys(from_env + from_file))


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

    allowed_origins = get_allowed_origins()

    env = {
        **os.environ,
        "QEMU_BIN": qemu_bin,
        "GDB_BIN": gdb_bin,
        "MP_ELF": str(SERVER_DIR / "micropython.elf"),
        **({"ALLOWED_ORIGINS": ",".join(allowed_origins)} if allowed_origins else {}),
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
