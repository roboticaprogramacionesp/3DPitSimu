# ==========================================================
# PitSimulator - desktop/build/build_bridge_onefile.py
#
# Version --onefile del "puente local" (ver desktop/bridge_only.py y
# desktop/README_puente.md): UN SOLO .exe, sin ninguna carpeta al lado
# -- server/, desktop/vendor/ y allowed_origins.txt quedan embebidos
# adentro, se autoextraen a una carpeta temporal en cada apertura.
# Mismo criterio que desktop/build/build_onefile.py (la version de la
# app de escritorio completa), pero apuntando a bridge_only.py, con
# --windowed (sin ventana de consola -- corre como icono de bandeja,
# ver bridge_only.py) y sin el frontend (ese vive en GitHub Pages, el
# puente no lo sirve).
#
# Uso:
#   python desktop/build/build_bridge_onefile.py
#
# Requiere lo mismo que build_onefile.py (server/ compilado,
# desktop/vendor/ con QEMU+GDB+Node portables) MAS
# desktop/allowed_origins.txt (el default que trae embebido -- se
# puede pisar sin recompilar dejando un allowed_origins.txt al lado
# del .exe final, ver bridge_core._allowed_origins_candidates()).
# ==========================================================

import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STAGING_DIR = REPO_ROOT / "build" / "_onefile_server_staging"


def _ignore_extras(dirpath, names):
    return [
        n for n in names
        if "_old." in n or "_prev_" in n or n == "ESP32_GENERIC.bin" or n == "node_modules"
    ]


def _rmtree_retry(path, attempts=10, delay=0.5):
    # BUG REAL (repo vive adentro de OneDrive): justo despues de que un
    # build anterior copio miles de archivos chicos a node_modules/ ahi
    # adentro, OneDrive los toma un instante para sincronizarlos/
    # indexarlos y los deja bloqueados -- un shutil.rmtree() inmediato
    # de ESTE staging (por ejemplo, al arrancar OTRO build enseguida)
    # puede pisar justo ese bloqueo transitorio (PermissionError,
    # confirmado en la practica). Reintentar con una pausa corta
    # alcanza porque el lock se libera solo en segundos.
    for attempt in range(attempts):
        try:
            shutil.rmtree(path)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)


def stage_clean_server():
    if STAGING_DIR.exists():
        _rmtree_retry(STAGING_DIR)
    shutil.copytree(REPO_ROOT / "server", STAGING_DIR, ignore=_ignore_extras)
    shutil.copytree(REPO_ROOT / "server" / "node_modules", STAGING_DIR / "node_modules")
    return STAGING_DIR


def main():

    vendor_dir = REPO_ROOT / "desktop" / "vendor"
    if not vendor_dir.exists():
        raise SystemExit(
            f"No existe {vendor_dir} -- ver desktop/vendor/README.md, hace falta "
            "para que el .exe final incluya QEMU/GDB/Node."
        )

    allowed_origins_file = REPO_ROOT / "desktop" / "allowed_origins.txt"
    if not allowed_origins_file.exists():
        print(f"AVISO: no existe {allowed_origins_file} -- el .exe va a arrancar "
              "sin ningun host extra permitido por default (solo localhost).")

    print("Armando copia limpia de server/ (sin binarios _old/_prev viejos)...")
    staged_server = stage_clean_server()

    args = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--windowed",
        "--icon", str(REPO_ROOT / "desktop" / "build" / "icon.ico"),
        "--name", "3DPitSimu-Puente",
        "--distpath", str(REPO_ROOT / "dist"),
        "--add-data", f"{staged_server};server",
        "--add-data", f"{vendor_dir};vendor",
        # Mismo icon.ico de arriba (--icon), pero embebido tambien como
        # DATO -- --icon solo lo usa para el icono de archivo del .exe,
        # no lo deja accesible en runtime. bridge_only.py lo carga desde
        # aca para el icono de la bandeja del sistema (ver
        # bridge_only._tray_icon_image()). "desktop/build" como destino
        # para que la ruta relativa coincida con la del repo (ver
        # bridge_core.RESOURCE_DIR).
        "--add-data", f"{REPO_ROOT / 'desktop' / 'build' / 'icon.ico'};desktop/build",
    ]
    if allowed_origins_file.exists():
        args += ["--add-data", f"{allowed_origins_file};."]
    args += [str(REPO_ROOT / "desktop" / "bridge_only.py")]

    print("Corriendo PyInstaller (puede tardar varios minutos, hay que comprimir ~350MB)...")
    subprocess.run(args, check=True)

    shutil.rmtree(STAGING_DIR, ignore_errors=True)

    exe = REPO_ROOT / "dist" / "3DPitSimu-Puente.exe"
    if exe.exists():
        print(f"Listo: {exe} ({exe.stat().st_size / 1_000_000:.0f} MB)")
    else:
        print("AVISO: PyInstaller terminó pero no se encontró el .exe esperado -- revisar arriba.")


if __name__ == "__main__":
    main()
