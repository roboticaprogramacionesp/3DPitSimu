# =============================================================
# PitSimulator — HAL "sg90" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/sg90/sg90.hal.py -- NO EDITAR A MANO. Cualquier
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
# PitSimulator — HAL SG90 (servo por PWM)
#
# A diferencia de KY-001/DHT11/HC-SR04 (sensores: el navegador
# le manda datos al firmware), un servo es un ACTUADOR: es el
# firmware el que decide el ángulo con machine.PWM, y el
# simulador solo necesita enterarse para animar el cuerno del
# servo. Mismo patrón que Pin.on()/off() (que avisan GPIO:<n>:v
# hacia afuera) pero para PWM.
#
# FIX real: esta clase antes heredaba de machine.PWM real
# (class PWM(_RealPWM)) y llamaba a super().__init__(pin, ...),
# confiando en el PWM/LEDC de verdad de QEMU. Confirmado en la
# práctica: esa build tira "ValueError: invalid pin" para GPIO26
# (un pin común para un servo) -- el hardware/emulación de PWM real
# de este QEMU tiene restricciones de pin que no nos interesan acá
# (no hay señal eléctrica real que generar, solo necesitamos el
# ÁNGULO equivalente). Mismo diagnóstico y mismo arreglo que ya se
# había hecho para buzzer.hal.py (ver ese archivo, "Primer HAL de
# este proyecto que simula machine.PWM"): reemplazar machine.PWM
# por una clase 100% sintética que NUNCA toca el PWM/LEDC real,
# en vez de envolverlo. Cualquier pin GPIO válido funciona ahora,
# sin las restricciones de canal/pin del periférico real.
#
# Protocolo de salida: SERVOOUT:<gpio>:<angulo>
#   ejemplo: SERVOOUT:13:90.0
#
# Uso en código del usuario (idéntico a MicroPython real):
#   from machine import Pin, PWM
#
#   servo = PWM(Pin(13), freq=50)
#   servo.duty(77)          # ~90° en un SG90 típico
#
# Calibración: un SG90 espera un pulso de 0.5ms (0°) a 2.5ms
# (180°) sobre un período de 20ms (50Hz). Con machine.PWM.duty()
# de 10 bits (0-1023) sobre ESP32, eso corresponde aproximadamente
# a duty 26 (0°) .. duty 123 (180°) -- son los valores que se ven
# en casi todos los tutoriales de SG90 + ESP32 + MicroPython.
# Si tu calibración real difiere, ajustá _SERVO_DUTY_MIN/MAX acá.
# =============================================================

import sys as _sys

_SERVO_DUTY_MIN = 26    # duty aprox. para 0°
_SERVO_DUTY_MAX = 123   # duty aprox. para 180°


def _duty_to_angle(duty_value):
    d = max(_SERVO_DUTY_MIN, min(_SERVO_DUTY_MAX, duty_value))
    pct = (d - _SERVO_DUTY_MIN) / (_SERVO_DUTY_MAX - _SERVO_DUTY_MIN)
    return round(pct * 180, 1)


class PWM:
    """
    Reemplaza a machine.PWM -- cubre la API que necesita el patrón
    típico de un servo (idéntica firma/comportamiento a la real,
    ver docstring de buzzer.hal.py para el mismo criterio):

        PWM(pin, freq=50)   -- freq por default 50Hz (estándar servo)
        .duty([value])      -- 0..1023, get/set
        .duty_u16([value])  -- 0..65535, get/set
        .duty_ns([value])   -- no-op de compatibilidad
        .freq([hz])         -- get/set (no afecta el ángulo reportado)
        .init(freq=, duty=) -- re-arranca con nuevos valores
        .deinit()           -- no-op (no hay "apagar" un ángulo)
    """

    def __init__(self, pin, freq=50, duty=None, duty_u16=None, duty_ns=None, **kw):
        self._pin_num = getattr(pin, "_pin_num", None)
        self._freq = freq
        self._duty = 0

        if duty is not None:
            self.duty(duty)
        elif duty_u16 is not None:
            self.duty_u16(duty_u16)

    def freq(self, hz=None):
        if hz is None:
            return self._freq
        self._freq = hz

    def duty(self, value=None):
        if value is None:
            return self._duty
        self._duty = value
        self._report_angle(_duty_to_angle(value))
        return None

    def duty_u16(self, value=None):
        # Variante 16 bits (0-65535) que también existe en
        # MicroPython moderno -- la traducimos a la escala 0-1023
        # antes de calcular el ángulo, para reusar la misma
        # calibración.
        if value is None:
            return self._duty * 64
        self._duty = value // 64
        duty_10bit = value / 65535 * 1023
        self._report_angle(_duty_to_angle(duty_10bit))
        return None

    def duty_ns(self, value=None):
        # No-op -- no hace falta simular nanosegundos de ancho de
        # pulso, el ángulo ya se calcula a partir de duty()/duty_u16().
        pass

    def init(self, freq=None, duty=None):
        if freq is not None:
            self._freq = freq
        if duty is not None:
            self.duty(duty)

    def deinit(self):
        # No-op -- a diferencia de un tono (buzzer, que sí "se
        # apaga"), un servo simplemente se queda en su último
        # ángulo cuando se corta la señal PWM en la vida real.
        pass

    def _report_angle(self, angle):
        if self._pin_num is None:
            return
        _sys.stdout.write("SERVOOUT:{}:{}\n".format(self._pin_num, angle))


# Parchear el módulo machine para que cualquier "from machine
# import PWM" (tuyo o de otro HAL) traiga esta clase. Igual
# criterio que con Pin en _base_hal.py: esto va DESPUÉS de que la
# clase esté completamente definida.
import machine as _machine_module
_machine_module.PWM = PWM
