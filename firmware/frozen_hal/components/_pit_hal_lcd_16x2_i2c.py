# =============================================================
# PitSimulator — HAL "lcd_16x2_i2c" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/lcd_16x2_i2c/lcd_16x2_i2c.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

from _pit_base import poll_input, register_line_handler
from _pit_i2c_bus import register_i2c_device

# =============================================================
# PitSimulator — HAL LCD 16x2 I2C (HD44780 + PCF8574 via I2cLcd)
#
# Reemplaza el módulo "i2c_lcd" real (que arma el HD44780 vía un
# expansor PCF8574 sobre I2C físico) por uno que REUSA tu propia
# lcd_api.LcdApi tal cual está (es lógica pura -- cursor, entry
# mode, wrap de línea, etc. -- sin ningún acceso a hardware, así
# que no hace falta tocarla ni mockearla) y solo reemplaza las 3
# funciones de bajo nivel que sí tocan "hardware":
#   hal_write_command / hal_write_data / hal_backlight_on/off
#
# En vez de mandar nibbles por I2C de verdad, estas llevan una
# grilla de texto en memoria (num_lines x num_columns) y mandan su
# contenido completo al simulador cada vez que cambia.
#
# Protocolo de salida:
#   LCD:<cols>x<rows>:<backlight 0|1>:<display_on 0|1>:<cursor_on 0|1>:
#       <blink_on 0|1>:<cursor_col>:<cursor_row>:<fila0 hex>:<fila1 hex>...
#
# ── CAMBIO respecto a la versión anterior ───────────────────────
# Este archivo YA NO trae su propia clase "I2C" ni hace
# "machine.I2C = I2C" -- ese bus compartido ahora vive en
# _i2c_bus.py, que se inyecta una sola vez antes que cualquier
# hal.py de componente (ver el docstring de ese archivo para el
# motivo). Este LCD no usa writeto()/readfrom() para nada real de
# todas formas (todo pasa por print(), ver _emit() más abajo), así
# que ni siquiera necesita on_write/on_read -- solo se registra
# para que scan() lo vea en la lista de direcciones conocidas.
#
# Uso en código del usuario (idéntico a como ya lo tenías):
#   from i2c_lcd import I2cLcd
#   lcd = I2cLcd(id=1, sda=21, scl=22, i2c_addr=0x27, num_lines=2, num_columns=16)
#   lcd.putstr("Hola mundo")
#   lcd.move_to(0, 1)
#   lcd.clear()
# =============================================================

import sys as _sys
from machine import I2C
from lcd_api import LcdApi

# NO se importa "register_i2c_device" de ningún lado -- _i2c_bus.py
# no es un módulo real (no existe como archivo en el flash emulado),
# es otro fragmento pegado por paste mode ANTES que este (ver
# ALWAYS_HAL_TYPES en ReplPanel.js). Como todo se pega en el mismo
# namespace de nivel superior, la función ya está disponible acá
# como global, igual que register_line_handler/poll_input vienen de
# _base_hal.py sin ningún import.


class I2cLcd(LcdApi):
    """
    Reemplaza al I2cLcd real (i2c_lcd.py real) -- misma firma de
    constructor que ya usás, pero en vez de mandar nibbles por I2C
    de verdad, lleva una grilla de texto en memoria y la manda al
    simulador cada vez que algo cambia.
    """

    def __init__(self, id=1, sda=21, scl=22, i2c_addr=0x27, num_lines=2, num_columns=16):

        # I2C acá ya es la clase compartida de _i2c_bus.py (via
        # "machine.I2C" parchado) -- construirla igual que antes
        # sigue declarando sda/scl para el PININFO de validación de
        # cableado, sin que este archivo tenga que saber nada de eso.
        self.i2c = I2C(id, sda=sda, scl=scl)
        self.i2c_addr = i2c_addr

        # Registrar esta dirección contra el bus compartido -- este
        # LCD no necesita on_write/on_read (su protocolo real es
        # "LCD:" por print(), no writeto/readfrom), así que alcanza
        # con anunciar la dirección para que scan() la vea.
        register_i2c_device(i2c_addr)

        # True mientras estamos "cargando" un carácter custom (8
        # bytes de bitmap vía hal_write_data después de un
        # hal_write_command de dirección CGRAM) -- esos bytes NO son
        # texto de pantalla, hay que ignorarlos en vez de que se
        # cuelen en la grilla.
        self._cgram_mode = False

        # Estado de display/cursor -- todo llega por el mismo comando
        # "display control" (0x08 | bits), lo decodificamos una sola
        # vez en hal_write_command y lo mandamos en cada _emit().
        # Arrancan en los valores que deja LcdApi.__init__() al final
        # (hide_cursor() + display_on()), así el primer _emit() ya
        # sale consistente con lo que hizo el firmware.
        self._display_on = True
        self._cursor_on = False
        self._blink_on = False

        self._grid = [[" "] * num_columns for _ in range(num_lines)]

        # LcdApi.__init__ ya llama a display_off(), backlight_on(),
        # clear(), etc. -- todos terminan pegándole a los hal_*
        # de acá abajo, así que la grilla queda consistente desde
        # el arranque sin código extra de nuestra parte.
        LcdApi.__init__(self, num_lines, num_columns)

    # ── HAL requerido por LcdApi ─────────────────────────────────

    def hal_backlight_on(self):
        self._emit()

    def hal_backlight_off(self):
        self._emit()

    def hal_write_command(self, cmd):

        if cmd == self.LCD_CLR:
            self._grid = [[" "] * self.num_columns for _ in range(self.num_lines)]
            self._emit()
            return

        if 0x08 <= cmd < 0x10:
            # "Display control": display_on()/display_off(),
            # show_cursor()/hide_cursor() y blink_cursor_on/off() son
            # todos este mismo comando con distintos bits prendidos
            # (ver lcd_api.py: LCD_ON_CTRL=0x08 | LCD_ON_DISPLAY=0x04
            # | LCD_ON_CURSOR=0x02 | LCD_ON_BLINK=0x01) -- no hay
            # forma de distinguir "cuál" de esos métodos se llamó, ni
            # falta hace: alcanza con quedarnos con el estado final.
            self._display_on = bool(cmd & 0x04)
            self._cursor_on  = bool(cmd & 0x02)
            self._blink_on   = bool(cmd & 0x01)
            self._emit()
            return

        if 0x40 <= cmd < 0x80:
            # Set CGRAM address: arranca la carga de un carácter
            # custom. Todavía no sabemos mostrar glifos custom en el
            # overlay, así que por ahora solo evitamos que sus bytes
            # se cuelen como texto normal (ver hal_write_data).
            self._cgram_mode = True
            return

        if cmd >= 0x80:
            # Set DDRAM address (posición de cursor) -- LcdApi ya
            # actualiza self.cursor_x/self.cursor_y por su cuenta
            # antes de llamar acá, así que no hace falta decodificar
            # la dirección nosotros mismos. Emitimos igual: move_to()
            # sin ninguna escritura de texto después (ej. solo mover
            # el cursor y dejarlo parpadeando ahí) tiene que
            # reflejarse en el simulador aunque la grilla no cambie.
            self._cgram_mode = False
            self._emit()
            return

        # Cualquier otro comando (entry mode, etc.) no cambia lo que
        # se ve en la grilla de texto -- no hacemos nada.

    def hal_write_data(self, data):

        if self._cgram_mode:
            # Byte de un carácter custom, no es texto de pantalla.
            return

        row = self.cursor_y
        col = self.cursor_x

        if 0 <= row < self.num_lines and 0 <= col < self.num_columns:
            self._grid[row][col] = chr(data)

        self._emit()

    # ── Envío al simulador ────────────────────────────────────────

    def _emit(self):

        rows_hex = []
        for row in self._grid:
            row_text = "".join(row)
            rows_hex.append("".join("%02x" % ord(c) for c in row_text))

        backlight  = "1" if self.backlight else "0"
        display_on = "1" if self._display_on else "0"
        cursor_on  = "1" if self._cursor_on else "0"
        blink_on   = "1" if self._blink_on else "0"

        print("LCD:%dx%d:%s:%s:%s:%s:%d:%d:%s" % (
            self.num_columns, self.num_lines,
            backlight, display_on, cursor_on, blink_on,
            self.cursor_x, self.cursor_y,
            ":".join(rows_hex),
        ))


class _I2cLcdModule:
    I2cLcd = I2cLcd


_sys.modules["i2c_lcd"] = _I2cLcdModule()