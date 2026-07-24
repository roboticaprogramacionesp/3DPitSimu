# =============================================================
# PitSimulator — HAL TM1637 (4 dígitos, 7 segmentos, CLK+DIO)
#
# Reemplaza el módulo "tm1637" real (API compatible con la
# librería más usada -- mcauser/micropython-tm1637) por uno que
# NO bit-banguea CLK/DIO de verdad: en vez de eso, cada método que
# cambia lo que se ve en el display manda directo los 4 bytes de
# segmentos ya codificados al simulador.
#
# Por qué (mismo criterio que el I2C dummy de oled_hal.py): la
# librería real arma un byte por dígito y lo clockea bit a bit por
# DIO/CLK -- simular eso de verdad implicaría docenas de
# toggles de Pin.on()/off() (cada uno emite "GPIO:pin:valor" por
# stdout, ver _base.hal.py) por cada write(), sin ganar nada: lo
# único que le importa al simulador es el resultado final (qué
# segmentos quedaron prendidos), no la señal eléctrica bit a bit.
# Por eso clk/dio se reciben y se guardan (para que la firma del
# constructor sea compatible con código real) pero nunca se tocan.
#
# Protocolo de salida: TM1637:<8 hex = 4 bytes, uno por dígito>
#   cada byte: bit0=a bit1=b bit2=c bit3=d bit4=e bit5=f bit6=g
#   (igual convención que el chip real / la librería real)
#   bit7 del byte de ÍNDICE 1 (el 2do dígito) = los dos puntos ":"
#   -- también igual que la librería real, que guarda el colón ahí.
#
# Uso en código del usuario (idéntico a la librería real):
#   from machine import Pin
#   import tm1637
#
#   tm = tm1637.TM1637(clk=Pin(22), dio=Pin(21))
#   tm.numbers(12, 34)
#   tm.number(1234)
#   tm.show("12:34")
#   tm.temperature(25)
#   tm.scroll("Hola")
# =============================================================

import sys


# Best-effort: clk/dio acá llegan como machine.Pin(N) real (ej.
# TM1637(clk=Pin(22), dio=Pin(21))) -- probamos los nombres de
# atributo más comunes para sacar el número de GPIO. OJO: sin ver la
# clase Pin real de _base_hal.py esto es una suposición razonable,
# no una certeza -- avisar si hace falta ajustar el atributo exacto.
def _gpio_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    # Ver el mismo fix en _i2c_bus.hal.py/_adc_bus.hal.py -- faltaba
    # "_pin_num" (el atributo real de la Pin de _base_hal.py).
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None

try:
    from utime import sleep_ms
except ImportError:
    from time import sleep
    def sleep_ms(ms):
        sleep(ms / 1000)


# Segmentos para los dígitos 0-9 (bit0=a ... bit6=g), misma tabla
# que usa la librería real y el propio chip TM1637.
_DIGIT_SEGMENTS = (
    0x3F, 0x06, 0x5B, 0x4F, 0x66,  # 0 1 2 3 4
    0x6D, 0x7D, 0x07, 0x7F, 0x6F,  # 5 6 7 8 9
)

# Letras/símbolos extra soportados -- lo mínimo para poder mostrar
# palabras cortas típicas de estos proyectos ("Hi", "Lo", "Err",
# scroll de texto, etc.). Cualquier carácter no reconocido se
# muestra apagado (espacio en blanco) en vez de tirar una excepción
# -- a diferencia de la librería real, acá preferimos no reventar
# el firmware del usuario por un carácter raro en un scroll().
_CHAR_SEGMENTS = {
    "A": 0x77, "B": 0x7C, "C": 0x39, "D": 0x5E, "E": 0x79, "F": 0x71,
    "G": 0x3D, "H": 0x76, "I": 0x06, "J": 0x1E, "L": 0x38, "N": 0x54,
    "O": 0x3F, "P": 0x73, "R": 0x50, "S": 0x6D, "U": 0x3E, "Y": 0x6E,
    "-": 0x40, " ": 0x00, "_": 0x08, "°": 0x63,
}


class TM1637:

    def __init__(self, clk=None, dio=None, **kwargs):

        # clk/dio se guardan SOLO por compatibilidad de firma -- ver
        # el comentario grande al principio del archivo. Nunca se
        # llama a .value()/.on()/.off() sobre ellos.
        self.clk = clk
        self.dio = dio

        # Declarar ante el simulador qué GPIO reales usó el código del
        # usuario para CLK/DIO -- una sola vez, al construirse (ver
        # _gpio_num arriba y SignalEngine.isWiredToDeclaredPins).
        clk_num = _gpio_num(clk)
        dio_num = _gpio_num(dio)
        if clk_num is not None and dio_num is not None:
            sys.stdout.write("PININFO:tm1637:clk=%d,dio=%d\n" % (clk_num, dio_num))

        self._segments = bytearray(4)
        self._brightness = 7

        self._send()

    # ── Brillo (no afecta la forma, no hace falta reenviar) ──────

    def brightness(self, val=None):
        if val is None:
            return self._brightness
        self._brightness = max(0, min(val, 7))

    # ── Escritura cruda ───────────────────────────────────────────

    def write(self, segments, pos=0):
        """segments: lista/bytearray de bytes ya codificados (bit0=a..bit6=g,
        bit7 del byte en índice 1 = colón). pos: posición inicial (0-3)."""
        for i, seg in enumerate(segments):
            if 0 <= pos + i < 4:
                self._segments[pos + i] = seg & 0xFF
        self._send()

    # ── Codificación de caracteres/strings ───────────────────────

    def encode_digit(self, digit):
        return _DIGIT_SEGMENTS[digit % 10]

    def encode_char(self, char):
        if "0" <= char <= "9":
            return _DIGIT_SEGMENTS[ord(char) - ord("0")]
        return _CHAR_SEGMENTS.get(char.upper(), 0x00)

    def encode_string(self, string):
        return bytearray(self.encode_char(c) for c in string[:4])

    # ── Métodos de alto nivel (igual API que la librería real) ──

    def show(self, string, colon=False):
        segments = self.encode_string(string)
        while len(segments) < 4:
            segments.append(0x00)
        if colon and len(segments) > 1:
            segments[1] |= 0x80
        self.write(segments)

    def numbers(self, num1, num2, colon=True):
        num1 = max(-9, min(int(num1), 99))
        num2 = max(-9, min(int(num2), 99))
        string = "%2d%2d" % (num1, num2)
        segments = self.encode_string(string)
        if colon:
            segments[1] |= 0x80
        self.write(segments)

    def number(self, num):
        num = max(-999, min(int(num), 9999))
        self.write(self.encode_string("%4d" % num))

    def temperature(self, num):
        if num < -9:
            self.show("Lo")
            return
        if num > 99:
            self.show("Hi")
            return
        segments = self.encode_string("%2d" % int(num))
        segments.append(_CHAR_SEGMENTS["°"])
        segments.append(_CHAR_SEGMENTS["C"])
        self.write(segments)

    def scroll(self, string, delay=250):
        padded  = "    " + string + "    "
        encoded = bytearray(self.encode_char(c) for c in padded)
        for i in range(len(padded) - 4 + 1):
            self.write(encoded[i:i + 4])
            sleep_ms(delay)

    # ── Envío al simulador ────────────────────────────────────────

    def _send(self):
        sys.stdout.write("TM1637:%02x%02x%02x%02x\n" % tuple(self._segments))


class _Tm1637Module:
    TM1637 = TM1637


sys.modules["tm1637"] = _Tm1637Module()