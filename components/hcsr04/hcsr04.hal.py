# =============================================================
# PitSimulator — HAL HC-SR04 (sensor ultrasónico)
#
# Reemplaza la librería "hcsr04" de MicroPython (la típica de
# micropython-hcsr04 / Rui Santos) por una versión simulada.
#
# Protocolo de entrada: DIST:<gpio_echo>:<distancia_cm>
#   ejemplo: DIST:18:45.2
#
# Se clava por el pin ECHO (no TRIG), porque es el pin que el
# código del usuario realmente consulta para leer la distancia
# -- igual criterio que ky_001.hal.py, que se clava por el gpio
# del OneWire.
#
# Uso en código del usuario (idéntico a la librería real):
#   from hcsr04 import HCSR04
#
#   sensor = HCSR04(trigger_pin=5, echo_pin=18)
#   print(sensor.distance_cm())
#   print(sensor.distance_mm())
# =============================================================

import sys as _sys

# Tabla: gpio_echo → distancia_cm
_dist_states = {}


def _on_dist_line(parts):
    # parts = ["DIST", "<gpio_echo>", "<distancia_cm>"]
    if len(parts) >= 3:
        try:
            _dist_states[int(parts[1])] = float(parts[2])
        except ValueError:
            pass


# Usa el único lector de stdin que ya corre en _base_hal.py --
# NUNCA abrir un hilo propio con sys.stdin.read() acá (ver el
# comentario grande en _base_hal.py sobre por qué eso rompe la
# lectura de líneas completas).
register_line_handler("DIST:", _on_dist_line)


class HCSR04:

    def __init__(self, trigger_pin, echo_pin, echo_timeout_us=500 * 2 * 30):

        # Misma firma que la librería real: trigger_pin/echo_pin
        # son números de GPIO (no objetos Pin).
        self.echo_timeout_us = echo_timeout_us
        self._echo_gpio = echo_pin

        # Creamos los Pin igual que la librería real -- así el
        # TRIG manda GPIO:<n>:0/1 al simulador (se puede ver
        # parpadear en el canvas) aunque acá no midamos un pulso
        # real. Usa la clase Pin parcheada de _base_hal.py.
        self.trigger = Pin(trigger_pin, Pin.OUT)
        self.trigger.value(0)
        self.echo = Pin(echo_pin, Pin.IN)

    def _read_distance_cm(self):
        # Ver el mismo fix en ky_001.hal.py/read_temp() y
        # dht11.hal.py/measure(): en el uso típico esto ya andaba
        # porque cada medición real dispara trigger.value(1)/(0)
        # antes de leer (eso sí llama a poll_input() vía Pin.value()),
        # pero si el código del usuario reusa una lectura vieja sin
        # volver a triggerear, o simplemente por prolijidad/consistencia
        # con el resto de los sensores "de valor empujado desde el
        # panel", más vale no depender de ese efecto colateral.
        poll_input()
        return _dist_states.get(self._echo_gpio, 100.0)

    def distance_cm(self):
        return self._read_distance_cm()

    def distance_mm(self):
        return self._read_distance_cm() * 10


class _Hcsr04Module:
    HCSR04 = HCSR04


_sys.modules["hcsr04"] = _Hcsr04Module()
