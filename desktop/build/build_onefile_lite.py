# ==========================================================
# PitSimulator - desktop/build/build_onefile_lite.py
#
# Variante liviana de build_onefile.py: arma el .exe SIN
# desktop/vendor/ (QEMU+GDB+Node vendorizados, ~156MB) ni server/
# (bridge Node para QEMU, ~25MB de binarios activos + node_modules) --
# ninguno de los dos hace falta para el modo navegador (WASM, ver
# js/app.js), que es el ÚNICO modo al que un alumno/docente puede
# llegar desde la UI (ver el comentario grande en index.html sobre
# btnWasmModeToggle, oculto a propósito). desktop/main.py YA no lanza
# el bridge QEMU por default tampoco (PIT_USE_QEMU_BRIDGE=1 para
# reactivarlo, ver desktop/main.py) -- este script solo deja de
# EMPAQUETAR los archivos que ese camino necesitaría, ya que nadie en
# el build liviano va a poder pedirlo de todas formas.
#
# Resultado esperado: bastante más chico que build_onefile.py (que
# sigue intacto, para cuando VOS quieras seguir probando QEMU a mano
# con el hash "#modo=qemu" + PIT_USE_QEMU_BRIDGE=1) -- sale como
# dist/3DPitSimu-Lite.exe, nombre distinto a propósito para no pisar
# el .exe completo si ambos se generan en la misma carpeta.
#
# --noupx: el .exe armado así quedó marcado como virus por Windows
# Defender (falso positivo conocido contra el bootloader --onefile,
# que se autoextrae a una carpeta temporal en cada apertura). UPX
# (la compresión que PyInstaller aplica por default a los binarios)
# es, además de la autoextracción en sí, uno de los disparadores más
# comunes de esa misma heurística -- vale la pena probar sin ella
# antes de resignarse al aviso o pasarse a --onedir (carpeta, ver
# build_onedir_lite.py -- no da este aviso pero hay que moverla
# ENTERA, no el .exe suelto).
#
# Uso:
#   python desktop/build/build_onefile_lite.py
# ==========================================================

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

FRONTEND_ITEMS = ["index.html", "3DPit.ico", "css", "js", "components", "components_wasm", "assets", "lib"]


def main():

    args = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--windowed", "--noupx",
        "--icon", str(REPO_ROOT / "desktop" / "build" / "icon.ico"),
        "--name", "3DPitSimu-Lite",
        "--distpath", str(REPO_ROOT / "dist"),
    ]
    for item in FRONTEND_ITEMS:
        src = REPO_ROOT / item
        args += ["--add-data", f"{src};{item if (src).is_dir() else '.'}"]
    args += [str(REPO_ROOT / "desktop" / "main.py")]

    print("Corriendo PyInstaller (sin vendor/server -- debería ser bastante más rápido y liviano)...")
    subprocess.run(args, check=True)

    exe = REPO_ROOT / "dist" / "3DPitSimu-Lite.exe"
    if exe.exists():
        print(f"Listo: {exe} ({exe.stat().st_size / 1_000_000:.0f} MB)")
    else:
        print("AVISO: PyInstaller terminó pero no se encontró el .exe esperado -- revisar arriba.")


if __name__ == "__main__":
    main()
