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


def _log_file_path():
    # Nombre del log = nombre del propio .exe (3DPitSimu.log o
    # 3DPitSimu-Puente.log) -- asi cada app escribe el suyo aunque las
    # dos terminen viviendo en la misma carpeta.
    stem = Path(sys.executable).stem if getattr(sys, "frozen", False) else "3DPitSimu-dev"
    return APP_DIR / f"{stem}.log"


def _log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    # Ademas de la consola (si la hay -- 3DPitSimu-Puente ahora corre
    # --windowed, sin ninguna, ver bridge_only.py), se anota en un
    # archivo al lado del .exe -- unica forma de ver estos logs sin
    # consola/icono de bandeja abierto, y sirve para diagnosticar sin
    # tener que reproducir el problema con una build --console aparte.
    try:
        with open(_log_file_path(), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass  # nunca romper por un problema de logging (disco lleno, permisos, etc.)


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


def start_bridge(extra_env=None, on_status=None):

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
            # server.js ya loguea estas dos lineas exactas en
            # wss.on("connection")/ws.on("close") (ver server/server.js)
            # -- se reusan tal cual en vez de agregar un mecanismo de
            # status nuevo (ej. un endpoint HTTP), para no tocar el
            # archivo de seguridad del WebSocket por esto. on_status
            # es opcional (None en el uso de siempre, ej. si alguien
            # importa start_bridge() sin pasar callback) para no
            # romper nada de lo existente.
            if on_status is not None:
                if "PitSimulator conectado." in line:
                    on_status("connected")
                elif "PitSimulator desconectado." in line:
                    on_status("disconnected")

    threading.Thread(target=pump_output, daemon=True).start()

    _log(f"Bridge QEMU arrancando (pid={proc.pid})...")
    return proc


# BUG REAL encontrado probando el fix de mas abajo: "xtensa-esp-elf-gdb.exe"
# (el nombre que se usaba antes en el taskkill /IM) no corresponde a NINGUN
# archivo real de desktop/vendor/xtensa-esp-elf-gdb/bin/ -- nunca mataba nada.
# El binario que realmente se lanza (VENDOR_GDB_BIN, mas arriba) es
# xtensa-esp32-elf-gdb.exe, y ESE a su vez arranca como proceso hijo
# xtensa-esp-elf-gdb-no-python.exe (el interprete real, confirmado viendo
# tasklist en la practica) -- son los dos nombres que hay que vigilar/matar.
_WATCHED_IMAGES = ("qemu-system-xtensa.exe", "xtensa-esp32-elf-gdb.exe", "xtensa-esp-elf-gdb-no-python.exe")


def _any_watched_image_running():
    try:
        result = subprocess.run(
            ["tasklist"], capture_output=True, text=True, creationflags=_NO_WINDOW,
        )
    except Exception:
        return False
    output = result.stdout.lower()
    return any(name.lower() in output for name in _WATCHED_IMAGES)


def stop_bridge(proc):

    if sys.platform != "win32":
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        return

    # server.js no maneja SIGTERM/SIGINT, y en Windows matar el
    # proceso padre no mata a sus hijos (QEMU/GDB) -- taskkill /T
    # recorre todo el arbol de descendientes.
    if proc is not None and proc.poll() is None:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True, creationflags=_NO_WINDOW,
        )
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    # Red de seguridad adicional -- confirmado en la practica que GDB
    # (el interprete Python que trae embebido, NO el binario principal
    # que si muere con /T) a veces queda vivo pese al taskkill /T de
    # arriba. Matar por NOMBRE de imagen es mas agresivo pero seguro
    # en este contexto: estos nombres son especificos de este
    # proyecto, cualquier instancia corriendo en la practica fue
    # lanzada por esta misma app.
    for image_name in _WATCHED_IMAGES + ("xtensa-esp-elf-gdb*.exe",):
        subprocess.run(
            ["taskkill", "/IM", image_name, "/F"],
            capture_output=True, creationflags=_NO_WINDOW,
        )

    # BUG REAL (build --onefile): taskkill /F devuelve el control apenas
    # PIDE la terminacion, no cuando el proceso realmente murio -- Windows
    # tarda un instante mas en liberar los handles de los .exe/.dll que
    # tenia abiertos. Como QEMU/GDB/Node vendorizados corren DESDE la
    # carpeta temporal _MEI que PyInstaller autoextrae (ver VENDOR_DIR
    # arriba, sale de RESOURCE_DIR = sys._MEIPASS en onefile), si siguen
    # "vivos" un instante mas cuando el proceso Python principal termina,
    # el bootloader de PyInstaller no puede borrar esos archivos al
    # limpiar _MEI -- de ahi el warning "Failed to remove temporary
    # directory" (a veces deja la carpeta a medio borrar). Peor: si de
    # verdad no llegaron a morir, se quedan escuchando el puerto 8787, y
    # el PROXIMO puente (3DPitSimu-Puente.exe, mismo puerto fijo) falla
    # al arrancar porque el puerto ya esta ocupado. Por eso se espera
    # activamente (con reintentos) a que no quede nada vivo, en vez de
    # asumir que taskkill ya termino el trabajo.
    deadline = time.time() + 5
    while time.time() < deadline and _any_watched_image_running():
        time.sleep(0.2)
    if _any_watched_image_running():
        for image_name in _WATCHED_IMAGES:
            subprocess.run(
                ["taskkill", "/IM", image_name, "/F"],
                capture_output=True, creationflags=_NO_WINDOW,
            )
        time.sleep(0.3)


def watch_bridge(bridge, extra_env=None, on_status=None):
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
        if on_status is not None:
            on_status("down")
        stop_bridge(proc)  # red de seguridad: limpia restos aunque proc ya haya muerto
        if bridge["shutting_down"]:
            return
        new_proc = start_bridge(extra_env, on_status)
        bridge["proc"] = new_proc
        # Vuelve a "idle" (icono/estado normal) apenas el relanzamiento
        # arranca bien -- sin esto, el estado quedaba pegado en "down"
        # para siempre despues de un crash, aunque el bridge ya este
        # sano de nuevo (las lineas connected/disconnected solo llegan
        # de nuevo cuando alguien se conecta/desconecta, no al arrancar).
        if on_status is not None and new_proc is not None:
            on_status("idle")
