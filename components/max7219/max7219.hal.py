# =============================================================
# PitSimulator — HAL Matriz MAX7219 (display7219 / "Max8x8")
#
# Reemplaza el módulo "max" del usuario (max.py -- la clase
# Max7219 real, framebuf.FrameBuffer + SPI real) por una versión
# que reusa framebuf REAL para todas las primitivas de dibujo --
# rect(), text(), line(), poly(), ellipse(), scroll(), blit(),
# pixel(), fill(), etc. vienen heredadas tal cual, así que TODO
# matrix8x8.py (la clase Max8x8 que envuelve a Max7219) sigue
# funcionando sin tocarle una sola línea -- exactamente el mismo
# motivo por el que neopixel_matrix_hal.py hereda framebuf en vez
# de reimplementar np.py entero.
#
# Lo único que cambia es la salida real: en vez de mandar bytes
# por SPI a los chips MAX7219 físicos, show() manda el framebuffer
# completo al simulador.
#
# Protocolo de salida: MAX:<ancho>x<alto>:<bitmap en hex>
#   1 bit por pixel, fila por fila, MSB primero, cada fila
#   rellenada a múltiplo de 8 bits (los MAX7219 reales siempre se
#   encadenan en módulos de 8x8, así que en la práctica width ya
#   viene múltiplo de 8 -- el padding es solo por las dudas).
#   ejemplo 8x8 con un solo pixel prendido en (0,0):
#     MAX:8x8:80000000000000000
#     (8 bytes, uno por fila -- el primer byte 0x80 = bit más
#      significativo prendido = columna 0 de la fila 0)
#
# OJO -- a propósito NO reimplementamos el empaquetado MONO_HLSB/
# MONO_HMSB a mano para armar este hex: en vez de leer directo
# self.buffer (que obligaría a replicar el bit-order exacto que
# usa cada rotate_180), leemos con el propio self.pixel(x, y) --
# el MISMO getter que ya usa matrix8x8.py en read_pixel()/
# invert_circle() -- así el HAL no necesita saber nada de cómo
# framebuf empaqueta puertas adentro, sea MONO_HLSB o MONO_HMSB,
# y el protocolo que armamos queda totalmente desacoplado de esa
# decisión interna.
#
# Uso en código del usuario (idéntico a como ya lo tenían):
#   from machine import Pin, SPI
#   from max import Max7219
#   spi = SPI(1, baudrate=10000000)
#   screen = Max7219(8, 8, spi, Pin(5))
#   screen.fill(0)
#   screen.pixel(2, 3, 1)
#   screen.show()
# =============================================================

import sys as _sys
import framebuf

_MATRIX_SIZE = 8


class Max7219(framebuf.FrameBuffer):

    def __init__(self, width, height, spi, cs, rotate_180=False):

        # Guardados solo por compatibilidad de atributos (matrix8x8.py
        # no los vuelve a tocar directamente, pero por si algún script
        # del usuario los lee) -- nunca se usan para hablarle a un SPI
        # real, ver el header de este archivo.
        self.spi = spi
        self.cs  = cs

        self.width  = width
        self.height = height

        # Igual que el driver real -- se guarda por si algún código
        # externo lo consulta (ej. marquee() calcula el ancho total
        # a partir de len(message)*8, no de esto), aunque acá no hace
        # falta para nada del lado de la simulación.
        self.cols = width  // _MATRIX_SIZE
        self.rows = height // _MATRIX_SIZE
        self.nb_matrices = self.cols * self.rows

        self.rotate_180 = rotate_180

        # 1 bit por pixel (on/off) -- mismo tamaño de buffer que el
        # driver real: width*height bits.
        self.buffer = bytearray(width * height // 8)

        fmt = framebuf.MONO_HLSB if not rotate_180 else framebuf.MONO_HMSB
        super().__init__(self.buffer, width, height, fmt)

        self.fill(0)
        self.show()

    # ── Compatibilidad con el driver real ─────────────────────

    def brightness(self, value):
        # Cosmético -- no tenemos "intensidad" real que mapear en el
        # panel (mismo motivo por el que el LCD no anima el
        # contraste real), simplemente validamos el rango como hacía
        # el driver original para no ocultar un error de uso.
        if not 0 <= value < 16:
            raise ValueError("Brightness must be between 0 and 16")

    def marquee(self, message, speed_ms=100):
        # Igual que el original: recorre el mensaje de derecha a
        # izquierda llamando a show() en cada paso -- como show() ya
        # no le habla a SPI sino que imprime el protocolo, esto sigue
        # funcionando tal cual, solo que cada frame le llega al
        # simulador en vez de a un MAX7219 real.
        import utime
        start  = self.width + 1
        extent = 0 - (len(message) * 8) - self.width
        for i in range(start, extent, -1):
            self.fill(0)
            self.text(message, i, 0, 1)
            self.show()
            utime.sleep_ms(speed_ms)

    # ── Envío al simulador ─────────────────────────────────────

    def show(self):

        w = self.width
        h = self.height

        hex_parts = []

        for y in range(h):

            row_bits = []
            for x in range(w):
                row_bits.append("1" if self.pixel(x, y) else "0")

            row = "".join(row_bits)

            # Padding a múltiplo de 8 (por si algún día width no lo
            # es -- en la práctica los MAX7219 siempre se encadenan
            # de a 8 en 8, así que esto normalmente no hace nada).
            pad = (-len(row)) % 8
            if pad:
                row += "0" * pad

            for i in range(0, len(row), 8):
                hex_parts.append("%02x" % int(row[i:i + 8], 2))

        print("MAX:%dx%d:%s" % (w, h, "".join(hex_parts)))


class _MaxModule:
    Max7219 = Max7219


_sys.modules["max"] = _MaxModule()
