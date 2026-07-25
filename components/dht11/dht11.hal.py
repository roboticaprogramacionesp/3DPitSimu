# =============================================================
# PitSimulator — HAL DHT11
#
# Intercepta la librería dht de MicroPython.
# Protocolo de entrada: TEMP:<gpio>:<celsius>:<humedad>
#   ejemplo: TEMP:4:28.5:65.0
#
# Uso en código del usuario (igual que MicroPython real):
#   import dht
#   from machine import Pin
#
#   sensor = dht.DHT11(Pin(4))
#   sensor.measure()
#   print(sensor.temperature())
#   print(sensor.humidity())
# =============================================================

import sys as _sys

# Tabla: gpio → (temp_celsius, humidity_pct)
_dht_states = {}

def _on_temp_line(parts):
    # Formato: TEMP:<gpio>:<temp>[:<hum>]
    if len(parts) >= 3:
        try:
            gpio = int(parts[1])
            temp = float(parts[2])
            hum  = float(parts[3]) if len(parts) >= 4 else _dht_states.get(gpio, (25.0, 50.0))[1]
            _dht_states[gpio] = (temp, hum)
        except ValueError:
            pass

# Usa el único lector de stdin que ya corre en _base_hal.py,
# en vez de abrir un hilo propio (mismo antipatrón que tenía
# ky_001.hal.py -- dos/tres hilos leyendo sys.stdin al mismo
# tiempo se roban caracteres entre sí y ninguno arma la línea
# completa). Además, register_line_handler ya soporta más de un
# callback por prefijo, así que esto convive bien con un KY-001
# que también use "TEMP:" en el mismo canvas.
register_line_handler("TEMP:", _on_temp_line)

# ── Módulo dht simulado ───────────────────────────────────────────────────

class _DHT11:
    def __init__(self, pin):
        self._gpio = getattr(pin, "_pin_num", 0)
        self._temp = 25.0
        self._hum  = 50.0

    def measure(self):
        # Ver el mismo fix en ky_001.hal.py/read_temp(): sin esto,
        # si el código del usuario no toca ningún Pin/ADC/I2C en su
        # loop, poll_input() nunca se llama desde ningún lado y el
        # "TEMP:<gpio>:<celsius>[:<hum>]" que manda el slider del
        # panel se queda sin leer -- measure() siempre ve el default.
        poll_input()
        state      = _dht_states.get(self._gpio, (25.0, 50.0))
        self._temp = state[0]
        self._hum  = state[1]

    def temperature(self):
        return int(self._temp)   # DHT11 devuelve enteros

    def humidity(self):
        return int(self._hum)


class _DHT22:
    """También disponible para quien use DHT22 en el código."""
    def __init__(self, pin):
        self._gpio = getattr(pin, "_pin_num", 0)
        self._temp = 25.0
        self._hum  = 50.0

    def measure(self):
        # Ver el mismo fix en _DHT11.measure() más arriba.
        poll_input()
        state      = _dht_states.get(self._gpio, (25.0, 50.0))
        self._temp = state[0]
        self._hum  = state[1]

    def temperature(self):
        return round(self._temp, 1)   # DHT22 devuelve float

    def humidity(self):
        return round(self._hum, 1)


class _DhtModule:
    DHT11 = _DHT11
    DHT22 = _DHT22

_sys.modules["dht"] = _DhtModule()