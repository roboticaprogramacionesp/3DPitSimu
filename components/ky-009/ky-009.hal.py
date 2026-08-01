# =============================================================
# PitSimulator — HAL KY-009 LED RGB (SMD) — machine.PWM
#
# Mismo criterio y misma clase que buzzer.hal.py/sg90.hal.py: no hay
# hardware de PWM real detrás (ver el docstring de buzzer.hal.py
# sobre por qué el driver real de PWM/LEDC de este build de QEMU no
# es viable acá tampoco), así que reemplazamos machine.PWM entero por
# una clase 100% sintética. A diferencia del buzzer (que reporta
# FRECUENCIA para reproducir un tono) o el servo (que reporta un
# ÁNGULO), acá lo único que le importa al simulador es el DUTY de
# cada canal R/G/B por separado -- el brillo de cada color. Reusamos
# el mismo protocolo "PWM:<gpio>:<freq>:<duty>" que ya entiende
# QemuBridge.parseLine()/SignalEngine.setPwmState() de forma
# genérica (no es exclusivo del buzzer): ky-009.behavior.js lee
# engine.pwmStates de cada pin R/G/B para pintar el color combinado.
#
# Uso típico en código del usuario (idéntico a MicroPython real):
#   from machine import Pin, PWM
#   red   = PWM(Pin(25), freq=1000, duty=512)   # ~50% brillo
#   green = PWM(Pin(26), freq=1000, duty=1023)  # 100% brillo
#   blue  = PWM(Pin(27), freq=1000, duty=0)     # apagado
#
# También funciona con Pin(25, Pin.OUT).value(1)/.on() para
# encendido 100% digital (sin PWM) -- eso ya lo cubre _base_hal.py
# de forma genérica (GPIO:<n>:<v> -> driverStates), no hace falta
# nada especial acá para ese caso.
# =============================================================

import sys as _sys


class PWM:
    """
    Reemplazo sintético de machine.PWM -- misma API que
    buzzer.hal.py/sg90.hal.py (freq/duty/duty_u16/duty_ns/init/
    deinit), pero acá el consumidor del otro lado (ky-009.behavior.js)
    solo mira el duty para calcular brillo, no la frecuencia.
    """

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
