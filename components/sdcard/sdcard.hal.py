# =============================================================
# PitSimulator — HAL Módulo lector microSD (SPI)
#
# El código generado (ver dfplayer/generators.js "sdcard_init") hace
# exactamente lo mismo que un tutorial real:
#   spi = machine.SPI(1, sck=Pin(sck), mosi=Pin(mosi), miso=Pin(miso))
#   sd  = sdcard.SDCard(spi, Pin(cs))
#   os.mount(sd, "/sd")
#
# El driver real sdcard.py (ya vendorizado en components_wasm/libs/,
# clave "sdcard" de bundle.json) habla el protocolo SD-sobre-SPI real
# (CMD0/CMD8/CMD58/ACMD41 para inicializar, CMD17/CMD24 para
# leer/escribir bloques de 512 bytes, etc.) y entrega un objeto que
# solo implementa readblocks()/writeblocks()/ioctl() -- un
# "block device" que necesita que os.mount() lo envuelva en un
# filesystem real (VfsFat o VfsLfs2) para poder usarse con open().
#
# BUG REAL (de la plataforma, no del cableado): este build de
# MicroPython-WASM NO tiene VfsFat compilado -- "import os; os.VfsFat"
# tira AttributeError (confirmado en vivo). Sin eso, el objeto que
# entrega el driver real NUNCA se puede montar con os.mount(), sin
# importar qué tan fiel sea la emulación de SPI a nivel de bytes --
# es una limitación del propio intérprete.
#
# Lo que SÍ soporta este build es un "VFS definido por el usuario"
# (un objeto con mount()/umount()/chdir()/ilistdir()/open()/etc, el
# mismo mecanismo que MicroPython expone para filesystems custom).
# Por eso acá reemplazamos el módulo "sdcard" ENTERO (no solo
# machine.SPI, como con el RC522) por una implementación que cumple
# ese protocolo y delega todo al filesystem POSIX real que ya trae
# este runtime (os.VfsPosix -- confirmado con "dir(os)", ya incluye
# tmp/home/dev/proc/libs) -- los archivos que el alumno escriba en
# "/sd" persisten de verdad durante la simulación, exactamente como
# pasaría con una SD real.
# =============================================================

import sys as _sys
import os as _os


# Mismo criterio que _gpio_num() de _uart_bus_wasm.py -- la Pin
# "cs" que llega acá es la fake de _base_wasm.py, el número de pin
# real vive en alguno de estos atributos según la versión.
def _pit_sdcard_pin_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None


class SPI:
    # Nunca se usa de verdad (ver más abajo) -- solo existe para que
    # "machine.SPI(1, sck=Pin(..), mosi=Pin(..), miso=Pin(..))" no
    # tire AttributeError/ImportError.
    def __init__(self, id=1, baudrate=1000000, polarity=0, phase=0, sck=None, mosi=None, miso=None, *a, **kw):
        pass

    def init(self, *a, **kw):
        pass

    def deinit(self):
        pass


import machine as _machine_module
if not hasattr(_machine_module, "SPI"):
    _machine_module.SPI = SPI


class SDCard:
    def __init__(self, spi, cs, baudrate=1320000):
        # spi se ignora a propósito -- ver el comentario grande de
        # arriba, no hay protocolo SPI real que emular acá. cs SÍ se
        # usa (para el número de pin, no para hablarle de verdad) --
        # con id(self) acá en vez del pin, cada "Ejecutar" construía
        # una SDCard en una dirección de memoria distinta -> una
        # carpeta de respaldo DISTINTA cada corrida -> los archivos
        # jamás persistían entre corridas (al revés de una SD real).
        # El pin de CS es estable entre corridas (mismo cableado), así
        # que ahora identifica la "tarjeta" -- misma SD real entre
        # corridas, soporta más de un módulo si usan otro CS cada uno.
        pin_num = _pit_sdcard_pin_num(cs)
        self._dir = "/sdsim_cs%s" % (pin_num if pin_num is not None else "x")

        # El alumno le da "Ejecutar" dos veces seguidas sin reiniciar
        # QEMU/el Worker (nunca se reinicia entre corridas) -- el
        # "/sd" de la corrida anterior sigue montado, así que el
        # os.mount("/sd") de más abajo (en el código del alumno)
        # tiraría "OSError(1,)" (EPERM, ya montado). Se desmonta acá
        # preventivamente -- BUG REAL encontrado en vivo: la primera
        # idea fue envolver os.mount() para que se desmonte solo,
        # pero "os" en este build de MicroPython es un módulo de solo
        # lectura (ni agregar NI reasignar un atributo existente
        # funciona -- confirmado en vivo: hasta
        # "os.mount = otra_funcion" tira
        # "AttributeError: 'module' object has no attribute 'mount'").
        # Desmontar desde ACÁ (el constructor de SDCard, que si se
        # ejecuta de nuevo en cada corrida) es la única vía.
        try:
            _os.umount("/sd")
        except Exception:
            pass

    def mount(self, readonly, mkfs):
        try:
            _os.mkdir(self._dir)
        except OSError:
            pass

    def umount(self):
        pass

    def chdir(self, path):
        _os.chdir(self._dir + path)

    def getcwd(self):
        return "/"

    def ilistdir(self, path):
        return _os.ilistdir(self._dir + path)

    def open(self, path, mode):
        return open(self._dir + path, mode)

    def mkdir(self, path):
        _os.mkdir(self._dir + path)

    def remove(self, path):
        _os.remove(self._dir + path)

    def rename(self, old_path, new_path):
        _os.rename(self._dir + old_path, self._dir + new_path)

    def rmdir(self, path):
        _os.rmdir(self._dir + path)

    def stat(self, path):
        return _os.stat(self._dir + path)

    def statvfs(self, path):
        return (512, 512, 131072, 131072, 131072, 0, 0, 0, 0, 255)


class _FakeSdcardModule:
    pass


_fake_sdcard_module = _FakeSdcardModule()
_fake_sdcard_module.SDCard = SDCard
_sys.modules["sdcard"] = _fake_sdcard_module
