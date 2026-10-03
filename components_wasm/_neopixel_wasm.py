# =============================================================
# PitSimulator — HAL de NeoPixel (WS2812) para el runtime WASM
#
# Port directo de components/neopixel_ring/neopixel_ring.hal.py (ver
# ese archivo para el historial/diseño completo) -- la clase en sí no
# toca nada específico de QEMU, solo imprime por stdout, así que se
# reusa tal cual. Mismo protocolo de salida ("NEOR:<n>:<hex...>") que
# ya entiende SignalEngine.applyNeopixelRingFrame() del lado QEMU --
# WasmBridge.js reusa el mismo parseo/render, sin duplicar nada ahí.
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
