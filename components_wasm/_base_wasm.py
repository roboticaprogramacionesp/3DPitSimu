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


# BUG REAL (reportado en vivo): tipear una línea suelta con el NOMBRE
# de una variable (ej. "a" después de "a = 'Hola'") en el input de una
# línea del panel REPL no mostraba nada -- a diferencia de un REPL de
# verdad (CPython, o el propio REPL interactivo de MicroPython en
# hardware), donde escribir una expresión suelta la muestra sola, sin
# necesitar print(). mp.runPython(code) (lo que usa sendData() siempre
# que no sea "▶ Ejecutar") corre el código como si fuera un script
# (equivalente a exec()) -- SIEMPRE descarta el valor de una expresión
# suelta, nunca iba a mostrar nada, sea cual sea el motivo.
#
# Mismo truco de siempre para imitar el REPL real sin tener que tocar
# el intérprete: probar primero si la línea es una EXPRESIÓN (eval);
# si lo es, mostrar su repr (como hace sys.displayhook en cualquier
# REPL de Python) salvo que sea None (igual que el REPL real no
# imprime nada para una línea que no devuelve nada). Si eval() tira
# SyntaxError (porque es una ASIGNACIÓN u otra sentencia, no una
# expresión -- eval() nunca acepta sentencias), cae a exec() normal.
# WasmBridge.js SOLO manda replEcho=True para esta línea suelta del
# input de abajo -- nunca para "▶ Ejecutar" (ahí sí se quiere la
# semántica de script normal, sin imprimir de más).
def _pit_repl_eval(_pit_src):
    try:
        _pit_val = eval(_pit_src, globals())
    except SyntaxError:
        exec(_pit_src, globals())
        return
    if _pit_val is not None:
        print(repr(_pit_val))


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


# PWM genérico -- mismo protocolo "PWM:<gpio>:<freq>:<duty>\n" que ya
# usa components/_base/_base.hal.py (ver ese archivo para el
# historial completo: primero solo buzzer.hal.py/sg90.hal.py lo
# tenían, después se generalizó acá también porque el PWM real de
# QEMU tiraba "ValueError: invalid pin"). Acá no hay NINGÚN PWM real
# de por medio (no existe tampoco en este puerto), así que esta
# versión sintética es la ÚNICA que puede haber -- sin la sorpresa de
# "el último componente que se carga pisa al anterior" que sí pasa en
# QEMU (buzzer/sg90 cargan su propia clase PWM más específica encima).
class PWM:

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
        sys.stdout.write("PWM:%d:%d:%d\n" % (self._pin_num, sent_freq, self._duty))

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
        sys.stdout.write("PWM:%d:0:%d\n" % (self._pin_num, self._duty))


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
machine.PWM = PWM
sys.modules["machine"] = machine
