# =============================================================
# PitSimulator — HAL Base para el runtime WASM (navegador)
#
# Equivalente a components/_base/_base.hal.py, pero para el puerto
# "webassembly" de MicroPython (ver ~/projects/micropython-v1.28/ports/webassembly
# en el checkout de build) en vez del puerto "esp32" corriendo bajo
# QEMU. Diferencia de fondo: acá NO existe ningún módulo "machine"
# real -- Pin no puede heredar de machine.Pin (no existe), así que
# esta es una implementación 100% propia, no un wrapper.
#
# Mismo contrato público que _base.hal.py (Pin, poll_input,
# register_line_handler, _settle) para que los .hal.py de componente
# que solo dependen de esos nombres no necesiten reescribirse -- ver
# el plan en curso, Fase 1.
#
# Protocolo: igual convención de texto por stdout que ya usa
# _base.hal.py ("GPIO:<n>:<v>\n") -- WasmBridge.js reusa casi tal
# cual el parseo de QemuBridge.js para estas líneas.
#
# LIMITACIÓN CONOCIDA (ver plan, Fase 0): el modelo de ejecución acá
# es "Worker + terminate()", no QEMU con Ctrl+C real -- mientras un
# script está corriendo (ej. un while True:), NADA puede inyectarse
# desde afuera (confirmado empíricamente, ver el spike de la Fase 0:
# time.sleep() no le devuelve el control a JS en ningún momento). Por
# eso _pin_input_states acá se llena SOLO antes de que un run
# arranque (no hay "poll_input mid-loop" real todavía como en QEMU) --
# poll_input() igual existe para mantener el mismo contrato y por si
# más adelante se logra inyección real (ver nota en el plan sobre
# registerJsModule async + Asyncify, no implementado por ahora).
# =============================================================

import sys

_line_handlers = {}
_pin_input_states = {}
_irq_handlers = {}


def register_line_handler(prefix, callback):
    _line_handlers.setdefault(prefix, []).append(callback)


def process_line(line):
    # Mismo dispatch que el bloque IN:/_line_handlers dentro de
    # poll_input() en _base.hal.py -- WasmBridge.js llama a esto
    # (vía mp.globals.set + mp.runPython("process_line(_incoming_line)"))
    # para cualquier mensaje simulador→firmware (IN:, BH1750:, etc.)
    # en vez de "correrlo como código". Ver la LIMITACIÓN CONOCIDA
    # arriba: esto actualiza el estado para la PRÓXIMA vez que el
    # script llame a Pin.value()/I2C.readfrom()/etc., no en vivo si
    # ya hay un script corriendo.
    if line.startswith("IN:"):
        parts = line.split(":")
        if len(parts) >= 3:
            try:
                gpio = int(parts[1])
                value = int(parts[2])
            except ValueError:
                return
            _pin_input_states[gpio] = value
        return

    for prefix, callbacks in _line_handlers.items():
        if line.startswith(prefix):
            for callback in callbacks:
                callback(line.split(":"))
            return


def poll_input():
    # Ver LIMITACIÓN CONOCIDA arriba -- por ahora es un no-op real
    # (no hay ningún canal síncrono para leer del lado JS mid-ejecución
    # sin SharedArrayBuffer, descartado por los headers que GitHub
    # Pages no permite configurar). Se mantiene la función para que
    # el resto de los .hal.py que la llaman (ej. en un loop de
    # lectura) no rompan por AttributeError.
    pass


def _settle():
    # En el modelo QEMU esto esperaba un "SYNC:\n" async (GDB detecta
    # el registro real, manda confirmación por WS). Acá no hay ningún
    # registro real ni round-trip que esperar -- print() ya mandó el
    # dato en el momento exacto en que se llama, así que no hace falta
    # esperar nada. Se mantiene como no-op por compatibilidad de contrato.
    pass


class Pin:
    IN = 0
    OUT = 1
    PULL_UP = 1
    PULL_DOWN = 2

    def __init__(self, pin, mode=-1, pull=-1, **kw):
        self._pin_num = pin
        self._mode = mode
        self._pull = pull
        self._last_val = None

        if mode == Pin.OUT and "value" in kw:
            initial = 1 if kw["value"] else 0
            self._last_val = initial
            sys.stdout.write("GPIO:%d:%d\n" % (self._pin_num, initial))

    def on(self):
        if self._last_val != 1:
            self._last_val = 1
            sys.stdout.write("GPIO:%d:1\n" % self._pin_num)

    def off(self):
        if self._last_val != 0:
            self._last_val = 0
            sys.stdout.write("GPIO:%d:0\n" % self._pin_num)

    def value(self, v=None):
        if v is None:
            if self._mode == Pin.OUT:
                return self._last_val or 0
            return _pin_input_states.get(self._pin_num, 0)
        if v:
            self.on()
        else:
            self.off()

    def irq(self, handler=None, trigger=None, *args, **kw):
        if handler is None:
            _irq_handlers.pop(self._pin_num, None)
        else:
            _irq_handlers[self._pin_num] = {"handler": handler, "trigger": trigger, "pin": self}


# ─────────────────────────────────────────────────────────────
# Módulo "machine" FALSO -- el puerto webassembly no trae ningún
# módulo "machine" real (es específico de puertos con hardware de
# verdad, como "esp32"), así que "from machine import Pin" del
# código del alumno (el patrón real que enseñan los tutoriales)
# tira ImportError sin esto. Mismo truco estándar de MicroPython
# para crear un módulo sintético: un objeto cualquiera + registrarlo
# en sys.modules -- el import machinery de Python no distingue un
# módulo "de verdad" de esto.
#
# _i2c_bus_wasm.py (cargado DESPUÉS) le agrega I2C/SoftI2C al MISMO
# objeto -- no crea uno nuevo -- mismo criterio que
# "_machine_module.I2C = I2C" en _i2c_bus.hal.py real.
# ─────────────────────────────────────────────────────────────
class _FakeMachineModule:
    pass


machine = _FakeMachineModule()
machine.Pin = Pin
sys.modules["machine"] = machine
