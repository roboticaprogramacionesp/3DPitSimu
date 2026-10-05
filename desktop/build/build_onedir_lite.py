# ==========================================================
# PitSimulator - desktop/build/build_onedir_lite.py
#
# Variante --onedir de build_onefile_lite.py: arma una CARPETA
# (dist/3DPitSimu-Lite/) con el .exe + sus archivos de soporte al
# lado, en vez de un solo .exe que se autoextrae a una carpeta
# temporal en cada apertura.
#
# Por qué: el .exe de --onefile (build_onefile_lite.py) quedó
# marcado como virus por Windows Defender -- falso positivo conocido
# y frecuente contra el bootloader de PyInstaller --onefile (el
# patrón "se autoextrae solo al arrancar" coincide con heurísticas de
# malware, sin que haya nada malicioso de verdad). --onedir no tiene
# ese paso de autoextracción (todo ya está desempaquetado de
# antemano), así que dispara este tipo de falso positivo con mucha
# menos frecuencia.
#
# Costo real de esta alternativa: hay que repartir la CARPETA entera
# (dist/3DPitSimu-Lite/), no un solo archivo -- copiarla a otra PC/USB
# tiene que llevarse todo, no solo el .exe.
#
# Mismo alcance que build_onefile_lite.py: sin desktop/vendor/ (QEMU+
# GDB) ni server/ (bridge Node para QEMU) -- no hacen falta para el
# modo navegador (WASM), el único al que un alumno/docente puede
# llegar desde la UI. build_onefile.py/prepare_dist.py (con esos dos)
# siguen intactos para cuando el desarrollador quiera seguir probando
# QEMU a mano.
#
# Uso:
#   python desktop/build/build_onedir_lite.py
# ==========================================================

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

FRONTEND_ITEMS = ["index.html", "3DPit.ico", "css", "js", "components", "components_wasm", "assets", "lib"]


def main():

    args = [
        sys.executable, "-m", "PyInstaller",
        "--onedir", "--windowed",
        "--icon", str(REPO_ROOT / "desktop" / "build" / "icon.ico"),
        "--name", "3DPitSimu-Lite",
        "--distpath", str(REPO_ROOT / "dist"),
    ]
    for item in FRONTEND_ITEMS:
        src = REPO_ROOT / item
        args += ["--add-data", f"{src};{item if (src).is_dir() else '.'}"]
    args += [str(REPO_ROOT / "desktop" / "main.py")]

    print("Corriendo PyInstaller (--onedir, sin vendor/server)...")
    subprocess.run(args, check=True)

    out_dir = REPO_ROOT / "dist" / "3DPitSimu-Lite"
    exe = out_dir / "3DPitSimu-Lite.exe"
    if exe.exists():
        print(f"Listo: {out_dir} (carpeta completa -- repartir ENTERA, no solo el .exe)")
    else:
        print("AVISO: PyInstaller terminó pero no se encontró el .exe esperado -- revisar arriba.")


if __name__ == "__main__":
    main()
