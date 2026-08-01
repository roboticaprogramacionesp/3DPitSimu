# =============================================================
# PitSimulator — HAL "ky-011" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/ky-011/ky-011.hal.py -- NO EDITAR A MANO. Cualquier
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

# =============================================================
# PitSimulator — HAL KY-011 LED bicolor — machine.PWM
# Idéntico criterio que ky-009.hal.py/ky-016.hal.py: reemplaza
# machine.PWM entero por una clase sintética (no hay hardware de PWM
# real detrás en este build de QEMU, ver el docstring de
# buzzer.hal.py) para que cada canal (R/G) pueda variar de brillo.
# También funciona con Pin.on()/off() digital simple (sin PWM), eso
# ya lo cubre _base_hal.py de forma genérica.
#
# Uso en código del usuario (idéntico a MicroPython real):
#   from machine import Pin, PWM
#   red   = PWM(Pin(25), freq=1000, duty=512)   # ~50% brillo
#   green = PWM(Pin(26), freq=1000, duty=1023)  # 100% brillo
# =============================================================

import sys as _sys


class PWM:

    def __init__(self, pin, freq=1000, duty=None, duty_u16=None, duty_ns=None, **kw):
        self._pin_num = getattr(pin, "_pin_num", None)
        self._freq = freq
        self._duty = 0
        self._active = False

        if duty is not None:
            self._duty = duty
            self._active = True
        elif duty_u16 is not None:
            self._duty = duty_u16 // 64
            self._active = True

        self._emit()

    def _emit(self):
        if self._pin_num is None:
            return
        sent_freq = self._freq if self._active else 0
        _sys.stdout.write("PWM:%d:%d:%d\n" % (self._pin_num, sent_freq, self._duty))

    def freq(self, hz=None):
        if hz is None:
            return self._freq
        self._freq = hz
        self._emit()

    def duty(self, value=None):
        if value is None:
            return self._duty
        self._duty = value
        self._active = True
        self._emit()

    def duty_u16(self, value=None):
        if value is None:
            return self._duty * 64
        self._duty = value // 64
        self._active = True
        self._emit()

    def duty_ns(self, value=None):
        pass

    def init(self, freq=None, duty=None):
        if freq is not None:
            self._freq = freq
        if duty is not None:
            self._duty = duty
        self._active = True
        self._emit()

    def deinit(self):
        self._active = False
        if self._pin_num is not None:
            _sys.stdout.write("PWM:%d:0:%d\n" % (self._pin_num, self._duty))


import machine as _machine_module
_machine_module.PWM = PWM
