# =============================================================
# PitSimulator — HAL OLED (SSD1306 I2C)
#
# Reemplaza el módulo "ssd1306" real de MicroPython por uno que
# usa el "framebuf" real del firmware (sí existe en MicroPython
# genuino dentro de QEMU) para las primitivas de dibujo, y que
# en show() manda el framebuffer COMPLETO al simulador.
#
# Protocolo de salida: OLED:<ancho>x<alto>:<framebuffer en hex>
#   ejemplo: OLED:128x64:0000ff00...   (1024 bytes → 2048 chars hex)
#
# Uso en código del usuario (idéntico a MicroPython real):
#   from machine import Pin, I2C
#   import ssd1306
#
#   i2c = I2C(0, scl=Pin(22), sda=Pin(21))
#   oled = ssd1306.SSD1306_I2C(128, 64, i2c)
#
#   oled.fill(0)
#   oled.text("Hola mundo", 0, 0)
#   oled.show()
#
# ── I2C dummy ──────────────────────────────────────────────────
# El SSD1306 de este HAL no manda transacciones I2C reales por sí
# mismo (todo el dibujo pasa por framebuf + print, no por
# i2c.writeto()), pero la clase I2C de acá abajo SÍ hace un trabajo
# real: guarda un registro compartido (en sys.modules) de qué se
# escribió/qué hay que leer por dirección, para que otros
# componentes I2C del mismo circuito que SÍ dependan de eso (ej. un
# teclado I2C -- ver keypad4x4_i2c_hal.py) sigan funcionando sin
# importar qué HAL terminó parcheando machine.I2C al final. Ver el
# docstring de la clase I2C más abajo para el detalle.
# =============================================================

import sys as _sys
import framebuf


# Ver el comentario largo equivalente en lcd_16x2_i2c_hal.py -- el
# bus I2C de este proyecto es UNO SOLO compartido entre todos los
# HAL, así que sda/scl solo hace falta declararlos una vez, sin
# importar cuál HAL terminó ganando la carrera de "machine.I2C".

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


_i2c_pins_declared = False


def _declare_i2c_pins(kwargs):
    global _i2c_pins_declared
    if _i2c_pins_declared:
        return
    sda_num = _gpio_num(kwargs.get("sda"))
    scl_num = _gpio_num(kwargs.get("scl"))
    if sda_num is not None and scl_num is not None:
        _i2c_pins_declared = True
        _sys.stdout.write("PININFO:i2c:sda=%d,scl=%d\n" % (sda_num, scl_num))


class I2C:
    """
    I2C dummy COMPARTIDO por todos los HAL de este proyecto que
    necesitan un machine.I2C (OLED, LCD, teclados I2C, etc). No hay
    un bus físico real detrás, pero -- a diferencia de la versión
    anterior de este dummy acá (que era un no-op puro) -- ahora SÍ
    lleva un registro de "qué se escribió último por dirección" y
    "qué hay que devolver al leer por dirección", guardado en
    sys.modules (mismo truco de "estado persistente entre
    re-pasteos" que ya usa _base_hal.py para el poller) en vez de en
    el propio `self` de la instancia.

    Por qué esto importa: varios componentes I2C de este proyecto
    (OLED, LCD, teclados I2C) cada uno trae SU PROPIA copia de esta
    misma clase, y todos hacen "machine.I2C = I2C" al cargar -- el
    que se inyecta último "gana" esa asignación. Si el estado
    viviera en el `self` de cada instancia, el componente cuyo HAL
    perdió la carrera quedaría con una clase que nunca actualiza
    nada. Guardando el registro en sys.modules (compartido entre
    TODAS las instancias de TODOS los HAL, gane quien gane la
    carrera), cualquier dispositivo I2C del circuito sigue
    funcionando igual.

    Este OLED en particular NO usa writeto()/readfrom() para nada
    real -- manda su protocolo propio directo por print() (ver
    show() más abajo), así que este cambio no le afecta en nada a
    ÉL. El motivo de traer la versión "inteligente" acá también (y
    no dejar la tonta de antes) es que, si en el mismo circuito
    también hay un componente que SÍ depende de I2C de verdad (ej.
    un teclado I2C -- ver keypad4x4_i2c_hal.py), y ESTE HAL es el
    que termina ganando la carrera de "machine.I2C", el otro
    componente necesita que la clase que quedó activa sepa hacer su
    trabajo -- no alcanza con que sea inofensiva para el OLED.
    """

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        _declare_i2c_pins(kwargs)

    def _registry(self):
        state = _sys.modules.setdefault("_pit_state", {})
        return state.setdefault("i2c_registry", {"out": {}, "in": {}})

    def writeto(self, addr, buf, stop=True):
        if not buf:
            return
        value = buf[0]
        reg = self._registry()
        if reg["out"].get(addr) != value:
            reg["out"][addr] = value
            _sys.stdout.write("I2CW:%d:%d\n" % (addr, value))
            # Ver la nota equivalente en keypad4x4_i2c_hal.py /
            # lcd_16x2_i2c_hal.py: esta clase I2C también puede
            # terminar siendo la que gana la carrera de
            # "machine.I2C" (ver el docstring de arriba) -- si un
            # teclado I2C del mismo proyecto termina dependiendo de
            # ESTA copia (por orden de inyección), necesita el mismo
            # _settle() para no leer en carrera contra su propia
            # escritura, aunque el OLED en sí nunca llame a
            # writeto()/readfrom().
            _settle()

    def readfrom(self, addr, nbytes, stop=True):
        poll_input()
        reg = self._registry()
        value = reg["in"].get(addr, 0xFF)
        return bytes([value] * nbytes)

    def scan(self):
        reg = self._registry()
        return sorted(set(reg["out"].keys()) | set(reg["in"].keys()))


def _on_i2c_read_line(parts):
    # parts = ["I2CR", "<addr>", "<byte>"]
    if len(parts) < 3:
        return
    try:
        addr  = int(parts[1])
        value = int(parts[2])
    except ValueError:
        return
    state = _sys.modules.setdefault("_pit_state", {})
    reg = state.setdefault("i2c_registry", {"out": {}, "in": {}})
    reg["in"][addr] = value & 0xFF


# register_line_handler/poll_input los define _base_hal.py como
# funciones de módulo (no de clase) -- se inyecta siempre antes que
# este archivo, así que ya están disponibles acá como globals.
register_line_handler("I2CR:", _on_i2c_read_line)


import machine as _machine_module
_machine_module.I2C = I2C


class SSD1306:

    def __init__(self, width, height, external_vcc=False):

        self.width = width
        self.height = height
        self.external_vcc = external_vcc

        self.pages = self.height // 8
        self.buffer = bytearray(self.pages * self.width)

        # MONO_VLSB: igual formato que usa el driver real, cada byte
        # representa 8 pixeles verticales de una columna (bit0 = arriba)
        self.framebuf = framebuf.FrameBuffer(
            self.buffer, self.width, self.height, framebuf.MONO_VLSB
        )

        self.fill(0)
        self.show()

    # ── Primitivas de dibujo (delegadas al framebuf real) ────────────────

    def fill(self, col):
        self.framebuf.fill(col)

    def pixel(self, x, y, col=1):
        self.framebuf.pixel(x, y, col)

    def hline(self, x, y, w, col=1):
        self.framebuf.hline(x, y, w, col)

    def vline(self, x, y, h, col=1):
        self.framebuf.vline(x, y, h, col)

    def line(self, x1, y1, x2, y2, col=1):
        self.framebuf.line(x1, y1, x2, y2, col)

    def rect(self, x, y, w, h, col=1):
        self.framebuf.rect(x, y, w, h, col)

    def fill_rect(self, x, y, w, h, col=1):
        self.framebuf.fill_rect(x, y, w, h, col)

    def text(self, string, x, y, col=1):
        self.framebuf.text(string, x, y, col)

    def scroll(self, dx, dy):
        self.framebuf.scroll(dx, dy)

    def blit(self, fbuf, x, y, key=-1, palette=None):
        self.framebuf.blit(fbuf, x, y, key, palette)

    # ── Comandos "de hardware" ────────────────────────────────────────────

    # Contraste real del SSD1306 (0-255) -- afecta el brillo de los
    # píxeles PRENDIDOS del panel (ver Renderer.drawOledFramebuffer/
    # setOledContrast). Los demás comandos de abajo siguen sin efecto
    # real en la simulación.
    def contrast(self, contrast):
        print("OLEDC:%d" % contrast)

    def invert(self, invert):
        pass

    def poweroff(self):
        pass

    def poweron(self):
        pass

    def rotate(self, rotate):
        pass

    # ── Envío al simulador ───────────────────────────────────────────────

    def show(self):
        hexdata = "".join("%02x" % b for b in self.buffer)
        print("OLED:%dx%d:%s" % (self.width, self.height, hexdata))


class SSD1306_I2C(SSD1306):
    def __init__(self, width, height, i2c, addr=0x3c, external_vcc=False):
        self.i2c = i2c
        self.addr = addr
        super().__init__(width, height, external_vcc)


class SSD1306_SPI(SSD1306):

    def __init__(self, width, height, spi, dc, res=None, cs=None, external_vcc=False):

        self.spi = spi
        self.dc = dc
        self.res = res
        self.cs = cs

        super().__init__(width, height, external_vcc)


class _Ssd1306Module:
    SSD1306     = SSD1306
    SSD1306_I2C = SSD1306_I2C
    SSD1306_SPI = SSD1306_SPI


_sys.modules["ssd1306"] = _Ssd1306Module()