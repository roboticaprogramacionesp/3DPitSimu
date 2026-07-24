# ==========================================================
#  PitSimulator — micropython_patch.py
#
#  Pega este código en el REPL de MicroPython una vez,
#  o inclúyelo en tu boot.py / main.py para que se aplique
#  automáticamente al arrancar.
#
#  Después de aplicarlo, cualquier llamada a:
#    led.on()          → emite  GPIO:2:1
#    led.off()         → emite  GPIO:2:0
#    led.value(1)      → emite  GPIO:2:1
#    led.value(0)      → emite  GPIO:2:0
#
#  El simulador detecta estas líneas y enciende/apaga
#  el LED visual automáticamente.
# ==========================================================

import sys
from machine import Pin as _RealPin

class Pin(_RealPin):
    """
    Subclase de machine.Pin que notifica al simulador
    PitSimulator cada vez que se cambia el estado de un GPIO.
    """

    def __init__(self, pin, mode=-1, pull=-1, **kwargs):
        super().__init__(pin, mode, pull, **kwargs)
        self._pin_num = pin

    def _notify(self, val):
        # Emitir el protocolo que lee QemuBridge.js
        sys.stdout.write("GPIO:{}:{}\n".format(self._pin_num, val))

    def on(self):
        super().on()
        self._notify(1)

    def off(self):
        super().off()
        self._notify(0)

    def value(self, val=None):
        if val is None:
            return super().value()
        super().value(val)
        self._notify(int(bool(val)))
        return None

    def toggle(self):
        # Leer el estado actual y notificar el nuevo
        current = super().value()
        new_val = 0 if current else 1
        super().value(new_val)
        self._notify(new_val)


# Ejemplo de uso después de pegar este código:
#
#   from machine import Pin   ← este Pin ya NO tiene el parche
#   led = Pin(2, Pin.OUT)     ← usar el Pin del parche:
#
#   led = Pin(2, Pin.OUT)     ← con la clase Pin de arriba
#   led.on()                  → enciende LED en simulador
#   led.off()                 → apaga  LED en simulador
