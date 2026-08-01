# =============================================================
# PitSimulator — HAL Anillo de NeoPixel (WS2812), API estándar
#
# A diferencia de neopixel_matrix.hal.py (que reemplaza "np", la
# librería 2D propia -- NeoMatrix + framebuf -- que ya traía el
# usuario para su matriz), este anillo usa la API 1D ESTÁNDAR de
# MicroPython: el módulo "neopixel" con su clase NeoPixel(pin, n),
# indexable (np[i] = (r,g,b)) + .write(). Es la forma más común de
# manejar un anillo/tira de NeoPixel, así que se reemplaza el módulo
# "neopixel" completo (sea builtin en C o no -- sys.modules se
# consulta ANTES que cualquier mecanismo de import real, mismo
# criterio que ya usa "np" acá al lado).
#
# Protocolo de salida: NEOR:<n>:<RGB888 por pixel en hex, 6 hex chars
# cada uno, en el mismo orden lógico i=0..n-1 que usó el firmware>
#   ejemplo 8 píxeles: NEOR:8:ff0000000000...   (8 pixeles -> 48 chars hex)
#
# Uso en código del usuario (idéntico a MicroPython real):
#   from machine import Pin
#   import neopixel
#   np = neopixel.NeoPixel(Pin(5), 8)
#   np[0] = (255, 0, 0)
#   np.fill((0, 0, 0))
#   np.write()
# =============================================================

import sys as _sys


def _gpio_num(pin_obj):
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


class NeoPixel:
    """
    Reemplazo sintético de neopixel.NeoPixel -- cubre la API real que
    necesita cualquier código típico (constructor, __setitem__/
    __getitem__/__len__, fill(), write()). bpp=4 (RGBW) se acepta
    para no romper la firma, pero el canal W se ignora al pintar (no
    hay forma de "ver" blanco puro distinto por separado en un
    canvas RGB del navegador sin simular la mezcla óptica real del
    LED -- no vale la pena la complejidad para una simulación
    visual).
    """

    def __init__(self, pin, n, bpp=3, timing=1):
        self._pin_num = _gpio_num(pin)
        self.n = n
        self.bpp = bpp
        self._buf = [(0, 0, 0)] * n

    def __len__(self):
        return self.n

    def __setitem__(self, i, color):
        if 0 <= i < self.n:
            self._buf[i] = color

    def __getitem__(self, i):
        return self._buf[i]

    def fill(self, color):
        for i in range(self.n):
            self._buf[i] = color

    def write(self):
        hex_parts = []
        for c in self._buf:
            r = c[0] if len(c) > 0 else 0
            g = c[1] if len(c) > 1 else 0
            b = c[2] if len(c) > 2 else 0
            hex_parts.append("%02x%02x%02x" % (r & 0xFF, g & 0xFF, b & 0xFF))
        _sys.stdout.write("NEOR:%d:%s\n" % (self.n, "".join(hex_parts)))


class _NeopixelModule:
    NeoPixel = NeoPixel


_sys.modules["neopixel"] = _NeopixelModule()
