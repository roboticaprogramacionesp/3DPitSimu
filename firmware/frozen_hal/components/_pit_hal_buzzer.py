# =============================================================
# PitSimulator — HAL "buzzer" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/buzzer/buzzer.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

from _pit_adc_bus import ADC
from _pit_base import Pin
from _pit_i2c_bus import I2C

# =============================================================
# PitSimulator — HAL Buzzer Piezo Pasivo (KY-006) — machine.PWM
#
# Primer HAL de este proyecto que simula machine.PWM -- hasta ahora
# solo había machine.Pin (digital), machine.ADC (joystick/ADKEY/
# potenciómetro) y machine.I2C (OLED/LCD/teclado I2C). Un buzzer
# PASIVO como el KY-006 necesita PWM de verdad porque el tono que
# suena depende de la FRECUENCIA (no solo de un 0/1 digital como un
# buzzer activo) -- por eso rtttl.py hace:
#
#   pwm0 = PWM(pin, freq=freqc, duty=512)
#   ...
#   pwm0.deinit()
#
# ── Qué hace este HAL ────────────────────────────────────────────
# No genera ninguna señal PWM real (no hay hardware de verdad atrás)
# -- en cambio, cada vez que se construye/actualiza/apaga un PWM,
# manda su estado al simulador, que reproduce el tono DE VERDAD con
# la Web Audio API del navegador (ver Renderer.playBuzzerTone) --
# esto no es cosmético, realmente vas a escuchar la melodía si tenés
# parlantes.
#
# Uso en código del usuario (idéntico a como ya lo tenés en
# rtttl.py/songs.py, sin cambiar una línea):
#   from machine import Pin, PWM
#   import rtttl, songs
#   pin = Pin(23, Pin.OUT)
#   rtttl.play(pin, songs.find('Super Mario - Main Theme'))
#
# ── Protocolo "PWM:" ─────────────────────────────────────────────
# Firmware → simulador: "PWM:<gpio>:<freq>:<duty>\n" cada vez que
# cambia algo relevante (construcción con freq, .freq(), .duty(),
# .init()). freq=0 significa "apagado" (equivalente a deinit()) --
# el simulador para el tono de ese pin al recibirlo.
#
# No hace falta ningún protocolo en sentido contrario (simulador →
# firmware): a diferencia de ADC/I2C, acá el firmware nunca necesita
# LEER nada de vuelta -- el PWM en la vida real tampoco se lee, solo
# se configura.
#
# ── Por qué el duty cycle no cambia el sonido ──────────────────
# En hardware real, el duty cycle de un buzzer PASIVO sí influye en
# el volumen percibido (más "tiempo encendido" por ciclo = más
# energía transferida al piezo). Acá el tono se reproduce con un
# oscilador de verdad (Web Audio), no con un cuadrado de voltaje
# simulado a nivel de muestra, así que no hay ningún "duty cycle"
# que aplicarle al audio en sí -- el volumen queda fijo en el
# simulador. Se acepta y se guarda el valor de duty (por si el
# código lo vuelve a leer), pero no afecta el sonido.
# =============================================================

import sys as _sys


class PWM:
    """
    Reemplaza a machine.PWM -- cubre la API que necesita
    rtttl.py (y cualquier código similar que solo use
    freq()/duty()/duty_u16()/deinit() para generar tonos):

        PWM(pin, freq=440, duty=512)  -- también freq=/duty= por
                                          separado, o ninguno (pin
                                          "armado" pero apagado
                                          hasta el primer freq())
        .freq([hz])         -- get/set
        .duty([value])      -- 0..1023, get/set
        .duty_u16([value])  -- 0..65535, get/set
        .duty_ns([value])   -- no-op de compatibilidad (algunos
                                puertos de MicroPython lo tienen)
        .init(freq=, duty=) -- re-arranca con nuevos valores
        .deinit()           -- apaga el tono
    """

    def __init__(self, pin, freq=None, duty=None, duty_u16=None, duty_ns=None):
        self._pin_num = getattr(pin, "_pin_num", pin)
        self._freq = 0
        self._duty = 0
        self._active = False

        if duty is not None:
            self._duty = duty
        elif duty_u16 is not None:
            self._duty = duty_u16 // 64

        if freq is not None:
            self._freq = freq
            self._active = True
            self._emit()

    def _emit(self):
        sent_freq = self._freq if self._active else 0
        _sys.stdout.write("PWM:%d:%d:%d\n" % (self._pin_num, sent_freq, self._duty))

    def freq(self, hz=None):
        if hz is None:
            return self._freq
        self._freq = hz
        self._active = True
        self._emit()

    def duty(self, value=None):
        if value is None:
            return self._duty
        self._duty = value
        if self._active:
            self._emit()

    def duty_u16(self, value=None):
        if value is None:
            return self._duty * 64
        self._duty = value // 64
        if self._active:
            self._emit()

    def duty_ns(self, value=None):
        # No-op -- no hay forma (ni falta hace) de simular
        # nanosegundos de ancho de pulso acá, ver docstring del
        # módulo sobre por qué el duty no afecta el sonido.
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
        _sys.stdout.write("PWM:%d:0:%d\n" % (self._pin_num, self._duty))


import machine as _machine_module
_machine_module.PWM = PWM
