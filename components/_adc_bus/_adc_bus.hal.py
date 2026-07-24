# =============================================================
# PitSimulator — Bus ADC compartido (dummy)
#
# Se inyecta UNA sola vez, junto con _base_hal.py / _i2c_bus.py,
# siempre ANTES que cualquier hal.py de componente analógico
# (potenciómetro, joystick, ADKEY, lo que venga).
#
# ── Por qué NO usamos el mismo camino que GPIO/I2C ──────────────
# Con gpio_set_level() e i2c/*_transfer() alcanzaba con un
# breakpoint de GDB: el código real de ESP-IDF, aunque imperfecto,
# no explotaba al ejecutarse -- solo hacía falta observar la
# llamada (o, en el caso de I2C, dejarla correr tranquila).
#
# Con ADC probamos lo mismo y confirmamos con datos reales que NO
# funciona acá: el driver real de ADC de este build crashea QEMU
# entero ("Cache disabled but cached memory region accessed") apenas
# se ejecuta de verdad -- y el plan de "interceptar el retorno antes
# de que corra el cuerpo real" tampoco es viable, porque hasta la
# función pública madc_read_uv() terminó totalmente inlineada dentro
# de su llamador (sin un punto de retorno limpio en el medio para
# que GDB pueda forzar nada).
#
# La solución robusta: NUNCA dejar que el código real de ADC se
# ejecute. Reemplazamos machine.ADC completo por esta clase --
# mismo criterio que ya usan machine.Pin (_base_hal.py) y
# machine.I2C (_i2c_bus.py). El valor que devuelve read_u16()/
# read_uv() viene de un registro compartido en sys.modules,
# poblado por líneas "ADC:<pin>:<valor_u16>\n" que manda
# SignalEngine.js (mismo patrón que "IN:" para pines digitales).
# =============================================================

import sys as _sys

# Última posición conocida de cada pin analógico (0-65535, escala
# de 16 bits) recibida desde el simulador. Vive en sys.modules por
# el mismo motivo que _pin_input_states en _base_hal.py: sobrevive
# a re-pasteos de este archivo dentro de la misma sesión de QEMU.
def _adc_registry():
    state = _sys.modules.setdefault("_pit_state", {})
    return state.setdefault("adc_registry", {})


def _gpio_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    # "_pin_num" es el atributo REAL que usa la Pin de _base_hal.py
    # (ver su __init__) -- faltaba en esta lista, así que _gpio_num()
    # de un Pin(N) real de este proyecto SIEMPRE devolvía None (caía
    # al fallback int(pin_obj), que tampoco funciona -- Pin no es
    # convertible a int). Bug real: dejaba _adc_defaults/el registro
    # de pin desalineados (clave None en vez del GPIO real), así que
    # read()/read_u16() nunca encontraban el valor correcto que sí
    # había llegado por "ADC:<gpio>:<valor>".
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None


def _on_adc_line(parts):
    # parts = ["ADC", "<pin>", "<valor_u16 0-65535>"]
    if len(parts) < 3:
        return
    try:
        pin   = int(parts[1])
        value = int(parts[2])
    except ValueError:
        return
    reg = _adc_registry()
    reg[pin] = max(0, min(65535, value))


# register_line_handler/poll_input los define _base_hal.py como
# funciones de módulo -- se inyecta siempre antes que este archivo.
register_line_handler("ADC:", _on_adc_line)


# Voltaje máximo aproximado según atenuación -- mismos valores de
# referencia que documenta MicroPython para el ESP32 (no exactos a
# los reales de fábrica, pero suficiente para simulación: la
# atenuación real varía por chip, y acá no hay chip real detrás).
_ATTEN_MAX_MV = {0: 950, 1: 1250, 2: 1750, 3: 2450}

# Default "antes de la primera interacción", por pin -- distintos
# componentes analógicos tienen distinto reposo real (joystick/
# pot_slider: 32768, mitad de escala; un ADKEY con pull-up: 65535,
# ninguna tecla apretada). register_adc_default() lo declara desde
# el propio código del usuario, justo después de construir el
# ADC(pin) -- ese es el único momento en que se sabe a qué pin
# corresponde (el hal.py de un componente no puede adivinarlo de
# antemano: el usuario elige el pin en su propio código, no el HAL).
_adc_defaults = {}


def register_adc_default(pin, value):
    """
    Declara qué devolver read_u16()/read_uv() para "pin" ANTES de
    que llegue la primera actualización real desde el canvas.
    32768 (mitad de escala) ya es el default general razonable
    (joystick con resorte, potenciómetro deslizante) -- solo hace
    falta llamar a esto para componentes con un reposo distinto,
    como un ADKEY con pull-up (65535).
    """
    _adc_defaults[pin] = value


class ADC:
    """
    Reemplazo completo de machine.ADC -- NUNCA toca el driver real
    (a diferencia de Pin/I2C, acá no hay ningún "super().__init__()"
    que delegue a la clase real: construir un ADC de verdad es
    justamente lo que crashea este build).
    """

    ATTN_0DB    = 0
    ATTN_2_5DB  = 1
    ATTN_6DB    = 2
    ATTN_11DB   = 3

    # En este firmware las constantes de ancho SON directamente la
    # cantidad de bits (9-12), no 0-3 como en el ESP32 "de fábrica"
    # -- confirmado por el usuario. Como acá reemplazamos machine.ADC
    # por completo, lo que importa es que .width() y estas
    # constantes sean consistentes ENTRE SÍ (ver read() más abajo,
    # que usa self._width directo como cantidad de bits).
    WIDTH_9BIT  = 9
    WIDTH_10BIT = 10
    WIDTH_11BIT = 11
    WIDTH_12BIT = 12

    def __init__(self, pin, atten=0, width=WIDTH_12BIT):
        self._pin   = _gpio_num(pin)
        self._atten = atten
        self._width = width

    def atten(self, value):
        self._atten = value

    def width(self, value):
        self._width = value

    def read_u16(self):
        """
        0-65535, escala de 16 bits -- igual que la API real,
        SIEMPRE en esta escala sin importar width() (así lo
        documenta MicroPython: read_u16() es independiente de la
        resolución configurada, para que el mismo código funcione
        igual en cualquier puerto/placa).
        """
        poll_input()
        return _adc_registry().get(self._pin, _adc_defaults.get(self._pin, 32768))

    def read_uv(self):
        """Microvolts -- escala read_u16() según la atenuación configurada."""
        raw    = self.read_u16()
        max_mv = _ATTEN_MAX_MV.get(self._atten, 3300)
        return int(raw * max_mv * 1000 / 65535)

    def read(self):
        """
        API vieja -- ACÁ SÍ importa width(): devuelve el valor
        escalado a la resolución configurada (2**width - 1 como
        máximo), no siempre 12 bits como antes. width=9 -> 0..511,
        width=12 (default) -> 0..4095.
        """
        return self.read_u16() >> (16 - self._width)


import machine as _machine_module
_machine_module.ADC = ADC