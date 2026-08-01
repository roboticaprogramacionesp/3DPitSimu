# =============================================================
# PitSimulator — HAL "ky_001" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/ky_001/ky_001.hal.py -- NO EDITAR A MANO. Cualquier
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
from _pit_base import Pin, poll_input, register_line_handler
from _pit_i2c_bus import I2C

# =============================================================
# PitSimulator — HAL KY-001 (Dallas DS18B20 / OneWire)
#
# Protocolo entrada: TEMP:<gpio>:<celsius>  ej: TEMP:4:25.5
#
# Uso en código del usuario (igual que MicroPython real):
#   import onewire, ds18x20
#   from machine import Pin
#   ow   = onewire.OneWire(Pin(4))
#   ds   = ds18x20.DS18X20(ow)
#   roms = ds.scan()
#   ds.convert_temp()
#   temp = ds.read_temp(roms[0])
#   print(temp)
# =============================================================

import sys as _sys

_temp_states = {}

def _on_temp_line(parts):
    # parts = ["TEMP", "<gpio>", "<celsius>"]
    if len(parts) >= 3:
        try:
            _temp_states[int(parts[1])] = float(parts[2])
        except ValueError:
            pass

# Usa el único lector de stdin que ya corre en _base_hal.py,
# en vez de abrir un hilo propio (eso era lo que competía por
# los mismos bytes de stdin y perdía mensajes TEMP:).
register_line_handler("TEMP:", _on_temp_line)


class _FakeOneWire:
    def __init__(self, pin):
        self._gpio = getattr(pin, "_pin_num", 0)
    def reset(self):
        return True
    def scan(self):
        return [b"\x28\x01\x02\x03\x04\x05\x06\xAA"]

class _FakeDS18X20:
    def __init__(self, onewire_bus):
        self._ow = onewire_bus
    def scan(self):
        return self._ow.scan()
    def convert_temp(self):
        pass
    def read_temp(self, rom):
        # A diferencia de ADC.read_u16()/Pin.value() (que sí lo
        # hacían), esto se olvidaba de drenar stdin antes de leer
        # _temp_states -- si el código del usuario nunca toca ningún
        # Pin/ADC/I2C en su loop (típico acá: solo convert_temp() +
        # read_temp() + sleep()), poll_input() nunca se llamaba desde
        # NINGÚN lado, así que el "TEMP:<gpio>:<celsius>" que manda
        # el slider del panel se quedaba sin leer en el buffer de
        # stdin para siempre -- read_temp() devolvía siempre el
        # default (25.0), sin importar cuánto moviera el usuario el
        # control. Bug real reportado: "cambio el valor y ese no se
        # actualiza".
        poll_input()
        return _temp_states.get(self._ow._gpio, 25.0)

class _OneWireModule:
    OneWire = _FakeOneWire

class _DS18X20Module:
    DS18X20 = _FakeDS18X20

_sys.modules["onewire"] = _OneWireModule()
_sys.modules["ds18x20"] = _DS18X20Module()