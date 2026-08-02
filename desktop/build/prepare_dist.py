# ==========================================================
# PitSimulator - desktop/build/prepare_dist.py
#
# Copia el frontend estatico, server/ (con sus binarios de datos,
# excluyendo los *_old.* sobrantes) y desktop/vendor/ (QEMU+GDB
# portables, si estan presentes -- ver desktop/vendor/README.md) a
# dist/PitSimulator/, AL LADO del .exe que ya genero PyInstaller. Paso
# separado del build en si (no via --add-data) para poder re-copiar
# solo esto sin tener que recompilar el .exe cada vez que cambia nada
# mas que el frontend/los binarios vendorizados.
#
# Orden de uso:
#   1. pyinstaller --onedir --windowed --icon=desktop/build/icon.ico \
#        --name PitSimulator --distpath dist desktop/main.py
#   2. python desktop/build/prepare_dist.py
#
# Alternativa -- desktop/build/build_onefile.py: un solo .exe sin
# carpetas al lado (mas comodo para copiar suelto a otra PC/Escritorio,
# a costa de que autoextrae ~350MB en cada apertura). Ver ese archivo.
# ==========================================================

import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DIST_DIR = REPO_ROOT / "dist" / "PitSimulator"
VENDOR_SRC = REPO_ROOT / "desktop" / "vendor"

FRONTEND_ITEMS = ["index.html", "3DPit.ico", "css", "js", "components", "assets", "lib"]


def _ignore_old_binaries(dirpath, names):
    return [n for n in names if "_old." in n]


def main():

    if not DIST_DIR.exists():
        raise SystemExit(
            f"No existe {DIST_DIR} -- corré primero pyinstaller "
            "(ver el comentario de este archivo) antes de este script."
        )

    print(f"Copiando frontend a {DIST_DIR} ...")
    for name in FRONTEND_ITEMS:
        src = REPO_ROOT / name
        dst = DIST_DIR / name
        if not src.exists():
            print(f"  AVISO: {src} no existe, se omite")
            continue
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        print(f"  {name}")

    print(f"Copiando server/ a {DIST_DIR / 'server'} ...")
    server_dst = DIST_DIR / "server"
    if server_dst.exists():
        shutil.rmtree(server_dst)
    shutil.copytree(REPO_ROOT / "server", server_dst, ignore=_ignore_old_binaries)

    if VENDOR_SRC.exists():
        print(f"Copiando desktop/vendor/ (QEMU+GDB portables) a {DIST_DIR / 'vendor'} ...")
        vendor_dst = DIST_DIR / "vendor"
        if vendor_dst.exists():
            shutil.rmtree(vendor_dst)
        shutil.copytree(VENDOR_SRC, vendor_dst)
    else:
        print(f"AVISO: no existe {VENDOR_SRC} -- la distribución NO va a traer QEMU/GDB "
              "portables, va a depender de bridge_config.py/variables de entorno del sistema.")

    print("Listo.")


if __name__ == "__main__":
    main()
