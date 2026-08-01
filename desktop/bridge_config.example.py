# ==========================================================
# PitSimulator - desktop/bridge_config.example.py
#
# Plantilla de referencia -- copiar a "bridge_config.py" (ese SI
# esta gitignored, ver .gitignore) y completar con las rutas reales
# de QEMU/GDB de tu maquina. Mismo espiritu que server/runserver.txt,
# solo que en formato Python para que desktop/main.py lo importe
# directo en vez de tener que pegarlo a mano en una terminal cada vez.
#
# Este archivo tiene PRIORIDAD sobre QEMU_BIN/GDB_BIN del entorno --
# a proposito (una variable de usuario de Windows vieja/mal seteada
# puede pisar silenciosamente la ruta real si fuera al reves, ya paso
# en la práctica). Solo si este archivo no existe, main.py cae a las
# variables de entorno del sistema como fallback.
# ==========================================================

DEFAULT_QEMU_BIN = r"C:\ruta\a\qemu-system-xtensa.exe"
DEFAULT_GDB_BIN = r"C:\ruta\a\xtensa-esp32-elf-gdb.exe"
