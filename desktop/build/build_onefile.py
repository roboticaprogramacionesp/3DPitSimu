# ==========================================================
# PitSimulator - desktop/build/build_onefile.py
#
# Alternativa a "pyinstaller --onedir + prepare_dist.py" (ver ese
# archivo): arma UN SOLO .exe que no depende de ninguna carpeta al
# lado (frontend, server/ y desktop/vendor/ quedan embebidos adentro).
# Pensado para cuando alguien va a copiar el ejecutable suelto a otra
# parte (Escritorio, USB, otra PC) -- con --onedir es facil copiar
# solo el .exe y olvidarse de _internal/server/vendor, y la app ni
# arranca (falla con "Failed to load Python DLL").
#
# Costo real de esta alternativa: los recursos embebidos (~350MB sin
# comprimir: QEMU+GDB+Node vendorizados + server/ + frontend) se
# AUTOEXTRAEN a una carpeta temporal en CADA apertura -- unos segundos
# mas de arranque que la version --onedir, cada vez. Si eso importa
# mas que la comodidad de "un solo archivo", usar prepare_dist.py en
# vez de este script.
#
# Uso:
#   python desktop/build/build_onefile.py
#
# Requiere lo mismo que prepare_dist.py (server/ con flash_image.bin y
# micropython.elf compilados, ver server/README.md; desktop/vendor/
# con QEMU+GDB+Node portables, ver desktop/vendor/README.md).
# ==========================================================

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STAGING_DIR = REPO_ROOT / "build" / "_onefile_server_staging"

FRONTEND_ITEMS = ["index.html", "3DPit.ico", "css", "js", "components", "assets", "lib"]

# Igual que _ignore_old_binaries de prepare_dist.py, pero ademas deja
# afuera ESP32_GENERIC.bin (build intermedio pre-merge, server.js
# nunca lo usa en runtime -- confirmado, solo lee flash_image.bin/
# micropython.elf) y node_modules (se copia aparte, mas abajo, para no
# arrastrar sus propios archivos "_old"/backup si los tuviera).
def _ignore_extras(dirpath, names):
    return [
        n for n in names
        if "_old." in n or "_prev_" in n or n == "ESP32_GENERIC.bin" or n == "node_modules"
    ]


def stage_clean_server():
    if STAGING_DIR.exists():
        shutil.rmtree(STAGING_DIR)
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

    print("Armando copia limpia de server/ (sin binarios _old/_prev viejos)...")
    staged_server = stage_clean_server()

    args = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--windowed",
        "--icon", str(REPO_ROOT / "desktop" / "build" / "icon.ico"),
        "--name", "3DPitSimu",
        "--distpath", str(REPO_ROOT / "dist"),
    ]
    for item in FRONTEND_ITEMS:
        src = REPO_ROOT / item
        args += ["--add-data", f"{src};{item if (src).is_dir() else '.'}"]
    args += ["--add-data", f"{staged_server};server"]
    args += ["--add-data", f"{vendor_dir};vendor"]
    args += [str(REPO_ROOT / "desktop" / "main.py")]

    print("Corriendo PyInstaller (puede tardar varios minutos, hay que comprimir ~350MB)...")
    subprocess.run(args, check=True)

    shutil.rmtree(STAGING_DIR, ignore_errors=True)

    exe = REPO_ROOT / "dist" / "3DPitSimu.exe"
    if exe.exists():
        print(f"Listo: {exe} ({exe.stat().st_size / 1_000_000:.0f} MB)")
    else:
        print("AVISO: PyInstaller terminó pero no se encontró el .exe esperado -- revisar arriba.")


if __name__ == "__main__":
    main()
