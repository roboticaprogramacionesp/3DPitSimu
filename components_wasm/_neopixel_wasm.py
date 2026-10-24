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
        # GPIO48 es el pin dedicado del LED RGB ONBOARD en el
        # ESP32-S3-Uno (DIYables) -- a diferencia de un anillo/tira
        # externo (protocolo "NEOR:", ver SignalEngine.
        # applyNeopixelRingFrame(), que busca "el primer
        # neopixel_ring del lienzo" porque ese protocolo no lleva
        # ningún id de pin/dispositivo), acá SÍ hay un pin conocido Y
        # un Worker por ESP32 (cada WasmBridge ya sabe cuál es "su"
        # esp32, ver this.esp32 en WasmBridge.js) -- "NEOS3:" aprovecha
        # eso para actualizar el LED de LA PLACA CORRECTA sin
        # ambigüedad, aunque haya 2+ ESP32-S3 en el mismo proyecto.
        if self._pin_num == 48 and self.n >= 1:
            c = self._buf[0]
            r = c[0] if len(c) > 0 else 0
            g = c[1] if len(c) > 1 else 0
            b = c[2] if len(c) > 2 else 0
            _sys.stdout.write("NEOS3:%02x%02x%02x\n" % (r & 0xFF, g & 0xFF, b & 0xFF))
            return

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
