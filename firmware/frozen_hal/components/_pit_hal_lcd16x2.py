# =============================================================
# PitSimulator — HAL "lcd16x2" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/lcd16x2/lcd16x2.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

from _pit_base import Pin
from _pit_i2c_bus import I2C

# =============================================================
# PitSimulator — HAL LCD 16x2 paralelo (HD44780 directo por GPIO)
#
# Reemplaza el módulo "lcd" real (lcd.py, clase CharLCD que maneja
# rs/en/d4-d7 a mano en modo 4-bit) por uno que NO reutiliza nada
# del original -- a diferencia del I2C (que sí pudo reusar
# lcd_api.LcdApi tal cual), acá la lógica de comandos HD44780 y el
# toggle de pines están mezclados en una sola clase monolítica, sin
# una capa hal_* separable. Así que en vez de parchear 3 métodos,
# reemplazamos la clase CharLCD entera: misma firma pública (los
# mismos métodos que ya usás), pero en vez de mandar pulsos reales
# por rs/en/d4-d7, lleva una grilla de texto en memoria y manda su
# contenido completo al simulador cada vez que cambia -- mismo
# patrón y mismo protocolo "LCD:" que ya usa lcd_16x2_i2c_hal.py
# (Renderer.js/SignalEngine.js ya lo soportan para este tipo de
# componente sin necesitar ningún cambio adicional).
#
# Diferencia importante con el I2C: este LCD no tiene ningún pin de
# datos para controlar el backlight por software (A/K son directo
# power/GND en el conector, "hardwireados") -- por eso no hay
# backlight_on()/off() en la API real, y acá mandamos "backlight=1"
# fijo en el protocolo (el panel simulado siempre se ve iluminado,
# como el hardware real).
#
# Uso en código del usuario (idéntico a como ya lo tenías):
#   from machine import Pin
#   from lcd import CharLCD
#   lcd = CharLCD(rs=12, en=13, d4=5, d5=23, d6=19, d7=18, cols=16, rows=2)
#   lcd.message("Hola mundo")
#   lcd.set_cursor(0, 1)
#   lcd.clear()
#
# No parcheamos machine.Pin ni creamos Pin() reales acá: esta clase
# no necesita tocar hardware para nada (todo pasa por la grilla +
# print), así que ni siquiera hace falta el patrón "dummy I2C" que
# usan el OLED y el LCD I2C -- simplemente no instanciamos ningún
# Pin.
# =============================================================

import sys as _sys


class CharLCD:
    """
    Reemplaza a la CharLCD real (lcd.py real) -- misma firma de
    constructor y mismos métodos públicos que ya usás, pero en vez
    de generar pulsos en rs/en/d4-d7, lleva una grilla de texto en
    memoria y la manda al simulador cada vez que algo cambia.
    """

    def __init__(self, rs=12, en=13, d4=5, d5=23, d6=19, d7=18, cols=16, rows=2):

        self.cols = cols
        self.rows = rows

        # Guardamos los números de pin solo por si el usuario los
        # inspecciona -- no se usan para nada, no hay hardware real
        # detrás.
        self.rs_pin, self.en_pin = rs, en
        self.d4_pin, self.d5_pin, self.d6_pin, self.d7_pin = d4, d5, d6, d7

        self._grid = [[" "] * cols for _ in range(rows)]
        self._cursor_x = 0
        self._cursor_y = 0

        # Estado de display control -- mismos tres flags que ya
        # maneja lcd_16x2_i2c_hal.py, para reusar el mismo protocolo
        # "LCD:" tal cual. El HD44780 real arranca con display on,
        # cursor y blink apagados (ver lcd.py real: 0x0C en el
        # init), lo replicamos como default.
        self._display_on = True
        self._cursor_on = False
        self._blink_on = False

        self._emit()

    # ── API pública (misma firma que lcd.py real) ────────────────

    def clear(self):
        """Clear and home LCD display."""
        self._grid = [[" "] * self.cols for _ in range(self.rows)]
        self._cursor_x = 0
        self._cursor_y = 0
        self._emit()

    def home(self):
        """Return cursor to home position."""
        self._cursor_x = 0
        self._cursor_y = 0
        self._emit()

    def set_cursor(self, col, row):
        """Move the cursor to an explicit column and row position."""

        # Mismo comportamiento que el original (incluyendo su bug: 
        # solo clampea si row > self.rows, NO si row == self.rows,
        # así que un row igual a self.rows queda "fuera de rango" 
        # tal cual pasaba con el hardware real -- lo replicamos para
        # no cambiar el comportamiento que ya conocías). Si querés
        # el comportamiento "corregido", validá vos antes de llamar.
        if row > self.rows:
            row = self.rows - 1

        self._cursor_x = col
        self._cursor_y = row
        self._emit()

    def set_line(self, num):
        """Set cursor to specified line at column zero."""
        self._cursor_x = 0
        self._cursor_y = num
        self._emit()

    def message(self, message, align=0):
        """Display text on LCD display."""

        if align == 1:
            message = "{0:<{1}}".format(message, self.cols)
        elif align == 2:
            message = "{0:^{1}}".format(message, self.cols)
        elif align == 3:
            message = "{0:>{1}}".format(message, self.cols)

        for ch in message:
            self._putchar(ch)

        self._emit()

    def _putchar(self, ch):

        if 0 <= self._cursor_y < self.rows and 0 <= self._cursor_x < self.cols:
            self._grid[self._cursor_y][self._cursor_x] = ch

        self._cursor_x += 1

        if self._cursor_x >= self.cols:
            self._cursor_x = 0
            self._cursor_y += 1

        if self._cursor_y >= self.rows:
            self._cursor_y = 0

    def move_left(self):
        """Move display left one position (desplaza el contenido,
        no el cursor -- igual que LCD_CURSORSHIFT|LCD_DISPLAYMOVE
        del HD44780 real)."""
        for row in self._grid:
            row.append(row.pop(0))
        self._emit()

    def move_right(self):
        """Move display right one position."""
        for row in self._grid:
            row.insert(0, row.pop())
        self._emit()

    def enable(self, enable=True):
        """Enable or disable display (blanquea/des-blanquea los
        caracteres, el panel sigue tan iluminado como estaba --
        acá no hay control de backlight por software)."""
        self._display_on = bool(enable)
        self._emit()

    def show_blink(self, show=True):
        """Enable or disable blinking cursor (el recuadro completo
        del carácter parpadeando, ver Renderer.js)."""
        self._blink_on = bool(show)
        self._emit()

    def show_underline(self, show=True):
        """Enable or disable underline cursor (rayita fija debajo
        del carácter)."""
        self._cursor_on = bool(show)
        self._emit()

    def create_char(self, location, pattern):
        """Todavía no sabemos mostrar glifos custom en el overlay
        (ver la misma limitación en lcd_16x2_i2c_hal.py) -- no-op,
        solo para no romper la firma si tu código lo llama."""
        pass

    # ── Envío al simulador ────────────────────────────────────────

    def _emit(self):

        rows_hex = []
        for row in self._grid:
            rows_hex.append("".join("%02x" % ord(c) for c in row))

        print("LCD:%dx%d:1:%s:%s:%s:%d:%d:%s" % (
            self.cols, self.rows,
            "1" if self._display_on else "0",
            "1" if self._cursor_on else "0",
            "1" if self._blink_on else "0",
            self._cursor_x, self._cursor_y,
            ":".join(rows_hex),
        ))


class _LcdModule:
    CharLCD = CharLCD


_sys.modules["lcd"] = _LcdModule()
