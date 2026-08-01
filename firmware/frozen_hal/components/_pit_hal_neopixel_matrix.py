# =============================================================
# PitSimulator — HAL "neopixel_matrix" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/neopixel_matrix/neopixel_matrix.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

# =============================================================
# PitSimulator — HAL Matriz de NeoPixel (WS2812)
#
# Reemplaza el módulo "np" del usuario (np.py -- la clase
# NeoMatrix que ya tenían, framebuf.FrameBuffer + neopixel.NeoPixel
# real) por una versión que reusa framebuf REAL (igual que
# oled.hal.py) para todas las primitivas de dibujo -- pixel(),
# text(), blit(), fill(), rect(), scroll(), etc. vienen heredadas
# tal cual, así que ezFBfont/ezFBmarquee siguen andando sin tocarlos
# una línea -- y en show() manda el framebuffer COMPLETO al
# simulador en vez de escribirle a un neopixel.NeoPixel real (que
# necesita el periférico RMT del ESP32 -- no sabemos si este QEMU
# lo emula, y da igual: ni falta hace, todo el dibujo ya pasa por
# framebuf antes de llegar a show()).
#
# Protocolo de salida: NEO:<ancho>x<alto>:<RGB888 por pixel en hex>
#   fila por fila, 6 hex chars por pixel (RRGGBB) -- YA convertido
#   de RGB565 (formato interno del framebuf) a RGB888 y con el
#   brightness de show() ya aplicado, así el simulador solo tiene
#   que pintar, sin decodificar nada.
#   ejemplo 8x8: NEO:8x8:000000ff0000...   (64 pixeles → 384 chars hex)
#
# OJO -- a propósito NO reproducimos acá la lógica de
# xy_to_index()/rotate() del np.py original (el mapeo a índice
# físico de la tira según layout/rotation): eso es pura lógica de
# CABLEADO real (qué LED físico de la tira le corresponde a cada
# (x,y) lógico), no cambia la IMAGEN que dibujó el firmware -- y es
# justamente esa imagen lógica (el framebuffer, antes de cualquier
# remapeo) la que el simulador necesita para pintar el panel. Se
# dejan rotate()/xy_to_index() en la clase de abajo, sin usar
# internamente, solo por si algún código externo los llama directo.
#
# Uso en código del usuario (idéntico a como ya lo tenían):
#   from np import NeoMatrix
#   matrix = NeoMatrix(pin=5, width=8, height=8, layout=0, rotation=0)
#   matrix.fill(0)
#   matrix.pixel(2, 3, matrix.color(255, 0, 0))   # ver color() abajo
#   matrix.show(brightness=0.3)
#
# ── Nota sobre color() ────────────────────────────────────────
# El np.py original no traía un helper para armar el word RGB565 a
# partir de (r,g,b) -- el usuario arma ese valor a mano en su
# código (con framebuf.FrameBuffer no hay otra forma: pixel()
# espera el color ya empaquetado en el formato del buffer). Le
# agregamos un color(r,g,b) de cortesía porque es un one-liner y
# evita que cada script del usuario tenga que repetir la fórmula
# de empaquetado -- no cambia nada del comportamiento real, es
# opcional usarlo.
# =============================================================

import sys as _sys
import framebuf


class NeoMatrix(framebuf.FrameBuffer):

    def __init__(self, pin, width, height, layout=0, rotation=0):

        # Guardado solo por compatibilidad de atributos (algún
        # código del usuario podría leerlo) -- nunca se usa para
        # tocar hardware real, ver el header de este archivo.
        self.pin = pin
        self.rotation = rotation

        self.width = width
        self.height = height
        self.layout = layout
        self.n = width * height

        self.buffer = bytearray(width * height * 2)

        # RGB565: mismo formato que usaba el np.py real -- así
        # cualquier script que arme colores a mano con la fórmula
        # de 5-6-5 bits sigue funcionando igual.
        super().__init__(self.buffer, width, height, framebuf.RGB565)

    # ── Helper opcional -- ver nota en el header ──────────────

    @staticmethod
    def color(r, g, b):
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

    # ── Compatibilidad con el np.py original (no usados acá) ──

    def rotate(self, x, y):
        if self.rotation == 0:
            return x, y
        elif self.rotation == 90:
            return self.height - 1 - y, x
        elif self.rotation == 180:
            return self.width - 1 - x, self.height - 1 - y
        elif self.rotation == 270:
            return y, self.width - 1 - x

    def xy_to_index(self, x, y):
        if self.layout == 0:      # horizontal
            index = y * self.width + x
        elif self.layout == 1:    # horizontal zigzag
            if y % 2 == 0:
                index = y * self.width + x
            else:
                index = y * self.width + (self.width - 1 - x)
        elif self.layout == 2:    # vertical
            index = x * self.height + y
        elif self.layout == 3:    # vertical zigzag
            if x % 2 == 0:
                index = x * self.height + y
            else:
                index = x * self.height + (self.height - 1 - y)
        return index

    # ── Envío al simulador ─────────────────────────────────────

    def show(self, brightness=0.1):

        buf = self.buffer
        w = self.width
        h = self.height
        bright = brightness

        hex_parts = []
        i = 0

        for _ in range(w * h):

            c = buf[i] | (buf[i + 1] << 8)
            i += 2

            r = ((c >> 11) & 0x1F) * 255 // 31
            g = ((c >> 5)  & 0x3F) * 255 // 63
            b = (c & 0x1F)         * 255 // 31

            r = int(r * bright)
            g = int(g * bright)
            b = int(b * bright)

            hex_parts.append("%02x%02x%02x" % (r, g, b))

        print("NEO:%dx%d:%s" % (w, h, "".join(hex_parts)))


class _NpModule:
    NeoMatrix = NeoMatrix


_sys.modules["np"] = _NpModule()
