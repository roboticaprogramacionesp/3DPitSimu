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

# Debe coincidir SIEMPRE con CONFIG.wsPort/CONFIG.gdbPort en
# server/server.js -- los dos puertos fijos que usa el bridge: el
# WebSocket hacia el navegador y el servidor GDB que expone QEMU.
# Ver _ensure_port_free() mas abajo.
BRIDGE_WS_PORT = 8787

# BUG REAL encontrado probando el fix de BRIDGE_WS_PORT (2026-10-01):
# liberar SOLO 8787 no alcanza. Si el usuario (o Windows) mata el
# "node.exe" padre pero no a sus hijos (ej. desde el Administrador de
# tareas, "Finalizar tarea" sobre el proceso visible -- no siempre se
# lleva puestos a los hijos, a diferencia de taskkill /T que SI usa
# stop_bridge()), un "qemu-system-xtensa.exe" huerfano puede seguir
# vivo y quedarse con el puerto 1234 aunque 8787 ya este libre (node
# murio, pero QEMU no). Confirmado en la practica: el GDB del
# PROXIMO arranque se conectaba a ese QEMU viejo/huerfano en vez del
# que recien bootea, insertaba su breakpoint contra un layout de
# memoria que no correspondia, y el firmware terminaba crasheando con
# "Guru Meditation Error (LoadProhibited)" en bucle -- el sintoma
# exacto reportado de "el puente no arranca bien". Mismo fix que para
# 8787, aplicado tambien a este puerto.
BRIDGE_GDB_PORT = 1234


def _port_owner_pid(port):
    """PID que tiene ese puerto en LISTENING (127.0.0.1 o 0.0.0.0), o
    None si esta libre. Via "netstat -ano" (siempre disponible, no
    pide admin) en vez de una libreria de terceros -- no hay ninguna
    instalada en el entorno empaquetado para esto."""
    if sys.platform != "win32":
        return None
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True, text=True, creationflags=_NO_WINDOW, timeout=5,
        )
    except Exception:
        return None
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
            local = parts[1]
            if local.endswith(f":{port}") and (
                local.startswith("127.0.0.1:") or local.startswith("0.0.0.0:")
            ):
                try:
                    return int(parts[-1])
                except ValueError:
                    continue
    return None


# BUG REAL que esto arregla: si un "node server.js" de una sesion
# anterior queda zombie (el taskkill /T del padre no siempre se lleva
# puesto a Node -- _WATCHED_IMAGES mas abajo vigila QEMU/GDB pero
# nunca al propio Node, que es quien realmente tiene el puerto
# abierto), el proximo arranque choca con EADDRINUSE. Hasta ahora
# server.js moria ahi con una excepcion sin capturar (WebSocket.Server
# no tenia manejador de "error", ver server.js) -- proc.poll() lo veia
# como "goterminado" y watch_bridge() lo volvia a lanzar, chocando
# otra vez con el mismo puerto ocupado, en bucle infinito, sin que
# "Ejecutar" se habilitara nunca (el WS jamas llegaba a abrir del lado
# del navegador). Ahora, antes de lanzar un Node nuevo, nos fijamos si
# alguien YA esta escuchando BRIDGE_WS_PORT y lo matamos primero --
# puntual, por PID (nunca un "taskkill /IM node.exe" a ciegas, que se
# llevaria puesto cualquier OTRO Node del usuario, ej. VS Code).
def _ensure_port_free(port):

    pid = _port_owner_pid(port)
    if pid is None:
        return

    name = ""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True, text=True, creationflags=_NO_WINDOW, timeout=5,
        )
        hit = next((l for l in result.stdout.splitlines() if str(pid) in l), None)
        if hit:
            name = hit.split()[0]
    except Exception:
        pass

    _log(
        f"AVISO: el puerto {port} ya estaba ocupado "
        f"(PID {pid}{' / ' + name if name else ''}) -- liberandolo antes de arrancar el bridge."
    )
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        capture_output=True, creationflags=_NO_WINDOW,
    )

    deadline = time.time() + 5
    while time.time() < deadline and _port_owner_pid(port) is not None:
        time.sleep(0.2)

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

    _ensure_port_free(BRIDGE_WS_PORT)
    _ensure_port_free(BRIDGE_GDB_PORT)

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
    except OSError as e:
        # Antes solo se atajaba FileNotFoundError ('node_bin' no
        # existe) -- pero Popen tambien puede fallar con otros
        # OSError reales en el campo (ej. PermissionError si un
        # antivirus pone en cuarentena/bloquea el .exe vendorizado la
        # primera vez que corre). Sin este catch mas amplio, esa
        # excepcion se escapaba de start_bridge() y rompia main() ANTES
        # de que la ventana llegara a abrirse -- el usuario veia la app
        # "no abrir" sin ningun mensaje, en vez de un AVISO en el log.
        _log(f"AVISO: no se pudo arrancar '{node_bin}' ({e}) -- el bridge no puede arrancar.")
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

        # BUG REAL (reportado: "el puente no arranca bien a veces y
        # Ejecutar nunca se habilita"): esta condicion trataba
        # "proc is None" (start_bridge() fallo de entrada, ej. puerto
        # ocupado, node bloqueado por un antivirus, etc.) EXACTAMENTE
        # igual que "sigue vivo" -- el comentario de antes decia "sigue
        # vivo (o nunca arranco), nada que hacer", pero "nunca arranco"
        # es el caso que mas necesita un reintento, no uno para
        # ignorar. Con el bug, un fallo de arranque dejaba la ventana
        # abierta pero el WS nunca llegaba a existir -- "Ejecutar"
        # quedaba deshabilitado para siempre en esa sesion, sin ningun
        # reintento automatico.
        if proc is not None and proc.poll() is None:
            continue  # sigue vivo de verdad, nada que hacer

        _log(
            "El bridge QEMU termino -- relanzando..." if proc is not None
            else "El bridge QEMU nunca llego a arrancar -- reintentando..."
        )
        if on_status is not None:
            on_status("down")
        if proc is not None:
            stop_bridge(proc)  # red de seguridad: limpia restos aunque proc ya haya muerto
        if bridge["shutting_down"]:
            return
        new_proc = start_bridge(extra_env, on_status)
        bridge["proc"] = new_proc

        # BUG REAL encontrado probando el fix de arriba (2026-10-01):
        # si el usuario cierra la ventana justo mientras este
        # relanzamiento estaba en curso, on_closing() (ver main.py) ya
        # puede haber corrido y terminado su propio stop_bridge() ANTES
        # de que este proceso nuevo existiera -- "shutting_down" se
        # puso en True mientras start_bridge() de arriba todavia
        # estaba en el aire. Sin este chequeo, nadie mas limpia este
        # proceso nuevo: el loop va a volver a "while True", ver
        # shutting_down=True en el proximo chequeo, y devolver sin
        # pasar por stop_bridge() -- confirmado en la practica, dejaba
        # un QEMU/GDB/Node huerfano corriendo para siempre, ocupando
        # los puertos 8787/1234 hasta el proximo arranque (que ahora
        # SI los libera, ver _ensure_port_free(), pero es mejor no
        # dejar el huerfano desde el vamos).
        if bridge["shutting_down"]:
            if new_proc is not None:
                stop_bridge(new_proc)
            return

        # Vuelve a "idle" (icono/estado normal) apenas el relanzamiento
        # arranca bien -- sin esto, el estado quedaba pegado en "down"
        # para siempre despues de un crash, aunque el bridge ya este
        # sano de nuevo (las lineas connected/disconnected solo llegan
        # de nuevo cuando alguien se conecta/desconecta, no al arrancar).
        if on_status is not None and new_proc is not None:
            on_status("idle")
