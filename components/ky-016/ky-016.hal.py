# =============================================================
# PitSimulator — HAL KY-016 LED RGB (orificio pasante) — machine.PWM
#
# Idéntico a ky-009.hal.py (mismo módulo eléctrico, solo cambia el
# empaquetado físico SMD vs domo 5mm) -- ver ese archivo para el
# detalle completo de por qué machine.PWM se reemplaza entero y por
# qué se reusa el protocolo genérico "PWM:<gpio>:<freq>:<duty>".
#
# Uso típico en código del usuario (idéntico a MicroPython real):
#   from machine import Pin, PWM
#   red   = PWM(Pin(25), freq=1000, duty=512)   # ~50% brillo
#   green = PWM(Pin(26), freq=1000, duty=1023)  # 100% brillo
#   blue  = PWM(Pin(27), freq=1000, duty=0)     # apagado
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
