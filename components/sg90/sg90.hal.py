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
# Esta clase reemplaza machine.PWM completa (no solo la envuelve)
# para que tu código pueda usar el PWM real tal cual lo harías en
# hardware de verdad -- simplemente además, cada vez que cambia
# el duty, calculamos el ángulo equivalente y lo mandamos afuera.
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
import machine as _machine_module

_SERVO_DUTY_MIN = 26    # duty aprox. para 0°
_SERVO_DUTY_MAX = 123   # duty aprox. para 180°

_RealPWM = _machine_module.PWM


def _duty_to_angle(duty_value):
    d = max(_SERVO_DUTY_MIN, min(_SERVO_DUTY_MAX, duty_value))
    pct = (d - _SERVO_DUTY_MIN) / (_SERVO_DUTY_MAX - _SERVO_DUTY_MIN)
    return round(pct * 180, 1)


class PWM(_RealPWM):

    def __init__(self, pin, freq=50, **kw):
        # Igual que la clase Pin de _base_hal.py: guardamos el
        # número de GPIO para poder identificar, en el mensaje de
        # salida, a qué pin físico corresponde este PWM.
        self._pin_num = getattr(pin, "_pin_num", None)
        super().__init__(pin, freq=freq, **kw)

    def duty(self, value=None):
        if value is None:
            return super().duty()
        super().duty(value)
        self._report_angle(_duty_to_angle(value))
        return None

    def duty_u16(self, value=None):
        # Variante 16 bits (0-65535) que también existe en
        # MicroPython moderno -- la traducimos a la escala 0-1023
        # antes de calcular el ángulo, para reusar la misma
        # calibración.
        if value is None:
            return super().duty_u16()
        super().duty_u16(value)
        duty_10bit = value / 65535 * 1023
        self._report_angle(_duty_to_angle(duty_10bit))
        return None

    def _report_angle(self, angle):
        if self._pin_num is None:
            return
        _sys.stdout.write("SERVOOUT:{}:{}\n".format(self._pin_num, angle))


# Parchear el módulo machine para que cualquier "from machine
# import PWM" (tuyo o de otro HAL) traiga esta clase. Igual
# criterio que con Pin en _base_hal.py: esto va DESPUÉS de que la
# clase esté completamente definida.
_machine_module.PWM = PWM
