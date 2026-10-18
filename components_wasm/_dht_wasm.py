# =============================================================
# PitSimulator — HAL DHT11/DHT22 para el runtime WASM (navegador)
#
# Port directo de components/dht11/dht11.hal.py (ver ese archivo
# para el historial/diseño completo) -- el único cambio real acá es
# que NO HABÍA ningún _dht_wasm.py: el bloque "DHT" de Blockly genera
# "import dht", pero nadie inyectaba nunca sys.modules["dht"] en modo
# navegador (a diferencia de machine/neopixel/network/etc., que sí
# tienen su _xxx_wasm.py, ver wasmWorker.js) -- "ImportError: no
# module named 'dht'" en cualquier proyecto que lo usara en modo
# navegador, el default desde que WASM dejó de ser opcional.
#
# Por qué el archivo original ya es 100% portable tal cual, sin
# tocarle una línea: solo depende de sys, register_line_handler() y
# poll_input() -- las tres ya viven en _base_wasm.py con el MISMO
# contrato público que _base.hal.py (confirmado leyendo ese archivo
# antes de escribir esto, no supuesto). El protocolo de entrada
# ("TEMP:<gpio>:<celsius>[:<humedad>]") también es el mismo: WasmBridge
# ya lo recibe por el camino genérico de SignalEngine._notifyTempToFirmware
# (bridge.sendData(...), ver el fix de ese archivo en el mismo commit
# que agrega este shim) → wasmWorker.js (mp.globals.set +
# process_line()) → register_line_handler("TEMP:", ...) de abajo,
# igual que cualquier otro protocolo "simulador→firmware" en WASM.
#
# poll_input() es un no-op en _base_wasm.py a propósito (ver el
# comentario grande ahí) -- measure() lo sigue llamando solo para no
# tener que tocar este archivo línea por línea, no porque haga falta
# de verdad: _dht_states ya se actualiza solo vía process_line()
# durante cualquier yield de Asyncify (un sleep() en el loop del
# alumno), igual que _pin_input_states para Pin/ADC.
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

register_line_handler("TEMP:", _on_temp_line)

# ── Módulo dht simulado ───────────────────────────────────────────────────

class _DHT11:
    def __init__(self, pin):
        self._gpio = getattr(pin, "_pin_num", 0)
        self._temp = 25.0
        self._hum  = 50.0

    def measure(self):
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
