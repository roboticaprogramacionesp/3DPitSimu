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
# ACTUALIZADO -- el modelo de ejecución sigue siendo "Worker +
# terminate()" (no hay Ctrl+C real como en QEMU), PERO time.sleep()
# ahora SÍ le devuelve el control a JS mientras espera (ver
# mphalport.c del build de micropython.mjs: mp_hal_delay_ms() usa
# emscripten_sleep() con Asyncify, no el busy-wait original). Eso
# significa que _pin_input_states (y process_line() en general, ver
# wasmWorker.js) SÍ se puede actualizar EN VIVO mientras un script ya
# está corriendo -- confirmado con clics reales actualizando un ADC
# leído dentro de un while True: con sleep() activo. La única
# condición real: tiene que haber al menos un sleep() en el bucle
# para que el Worker tenga una ventana donde atender el mensaje
# nuevo -- un bucle sin ningún sleep() (ocupando el hilo 100% del
# tiempo, sin ceder nunca) sigue sin poder recibir nada hasta que
# termine o se interrumpa, igual que antes.
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
    # Sigue siendo un no-op -- NO hace falta ningún canal activo acá:
    # ver el comentario ACTUALIZADO más arriba, _pin_input_states ya
    # se actualiza solo (de afuera, vía process_line()) durante
    # cualquier yield de Asyncify (adentro de un sleep() del propio
    # script). Esta función no necesita "ir a buscar" nada -- lo único
    # que hace falta es que Pin.value()/etc. lean el dict en el
    # momento en que se llaman, que ya hacen. Se mantiene como no-op
    # para que el resto de los .hal.py que la llaman (ej. en un loop
    # de lectura) no rompan por AttributeError.
    pass


def _settle():
    # En el modelo QEMU esto esperaba un "SYNC:\n" async (GDB detecta
    # el registro real, manda confirmación por WS). Acá no hay ningún
    # registro real ni round-trip que esperar -- print() ya mandó el
    # dato en el momento exacto en que se llama, así que no hace falta
    # esperar nada. Se mantiene como no-op por compatibilidad de contrato.
    pass


# ─────────────────────────────────────────────────────────────
# Pin.irq() emulado -- BUG REAL reportado en vivo con RotaryIRQ
# (rotary_irq_esp.py, KY-040): "AttributeError: type object 'Pin' has
# no attribute 'IRQ_RISING'". Pin no tenía las constantes IRQ_* y,
# aunque las tuviera, irq() solo guardaba el handler -- nada lo
# llamaba nunca (a diferencia de _base.hal.py, acá no había ningún
# _maybe_fire_irq()).
#
# Cómo llegan los flancos: Pin.value() lee "_pit_gpio_in_<n>" (global
# escrita por setGlobal, ver WasmBridge.sendData) -- eso solo guarda
# el ÚLTIMO valor, así que un encoder (4 fases cada 4ms) perdería las
# intermedias si solo se mirara el valor actual. Por eso wasmWorker.js
# además va anotando CADA cambio, en orden, en "_pit_gpio_events"
# ("<gpio>:<valor>,..."), y _pit_dispatch_irqs() los reproduce uno por
# uno. Mientras reproduce, Pin.value() devuelve el estado "de ese
# momento" (_irq_replay), no el último -- rotary.py lee CLK y DT
# adentro del handler y necesita ver la combinación de esa fase.
#
# Cuándo se reproducen: en cada time.sleep*() (ver _PitTimeModule más
# abajo) -- es el único momento en que el Worker atiende mensajes
# nuevos de todas formas (yield de Asyncify), igual que en QEMU el
# patrón típico "irq() + while True: sleep()".
# ─────────────────────────────────────────────────────────────
_irq_last = {}
_irq_replay = {}
_irq_replay_active = [False]


def _pit_dispatch_irqs():
    g = globals()
    events = g.get("_pit_gpio_events")
    if not events:
        return
    g["_pit_gpio_events"] = ""
    if not _irq_handlers:
        return

    _irq_replay.clear()
    _irq_replay.update(_irq_last)
    _irq_replay_active[0] = True
    try:
        for item in events.split(","):
            if not item:
                continue
            gpio, _, value = item.partition(":")
            try:
                gpio = int(gpio)
                value = 1 if int(value) else 0
            except ValueError:
                continue
            _irq_replay[gpio] = value

            entry = _irq_handlers.get(gpio)
            if entry is None:
                continue
            old = _irq_last.get(gpio)
            _irq_last[gpio] = value
            if old is None or old == value:
                continue

            trigger = entry["trigger"]
            if (value and trigger & Pin.IRQ_RISING) or (not value and trigger & Pin.IRQ_FALLING):
                try:
                    entry["handler"](entry["pin"])
                except Exception as e:
                    # A diferencia de _base.hal.py (que lo traga), acá
                    # se muestra: un error en el handler del alumno es
                    # justo lo que tiene que poder ver para corregirlo.
                    sys.print_exception(e)
    finally:
        _irq_replay_active[0] = False
        _irq_replay.clear()


class Pin:
    IN = 0
    OUT = 1
    OPEN_DRAIN = 2
    PULL_UP = 1
    PULL_DOWN = 2
    # Mismos valores que machine.Pin del puerto esp32 real.
    IRQ_RISING = 1
    IRQ_FALLING = 2

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
            # BUG REAL (reportado en vivo: "RuntimeError: ... We
            # cannot start an async operation when one is already in
            # flight" escaneando un teclado matricial) -- WasmBridge.js
            # ahora manda "IN:<gpio>:<valor>" por setGlobal (variable
            # global directa, sin mp.runPython()) en vez de por
            # processLine/process_line() de más arriba -- mismo fix ya
            # probado para WiFi/HTTP, ver ese comentario en
            # wasmWorker.js. _pin_input_states (poblado por
            # process_line(), que SÍ sigue andando para quien lo use)
            # queda como fallback, nunca se deja de escribir.
            if _irq_replay_active[0] and self._pin_num in _irq_replay:
                return _irq_replay[self._pin_num]
            g = globals()
            key = "_pit_gpio_in_%d" % self._pin_num
            if key in g:
                return g[key]
            return _pin_input_states.get(self._pin_num, 0)
        if v:
            self.on()
        else:
            self.off()

    def irq(self, handler=None, trigger=IRQ_RISING | IRQ_FALLING, *args, **kw):
        if handler is None:
            _irq_handlers.pop(self._pin_num, None)
            _irq_last.pop(self._pin_num, None)
            return
        # Reproducir primero lo pendiente para los handlers que ya
        # existían -- si no, esos eventos viejos se tomarían como
        # flancos de este pin recién registrado.
        _pit_dispatch_irqs()
        if trigger is None:
            trigger = Pin.IRQ_RISING | Pin.IRQ_FALLING
        _irq_handlers[self._pin_num] = {"handler": handler, "trigger": trigger, "pin": self}
        _irq_last[self._pin_num] = self.value()


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


# ─────────────────────────────────────────────────────────────
# Módulo "time" envuelto -- para que time.sleep*() reproduzca los
# flancos pendientes (ver _pit_dispatch_irqs arriba). Confirmado: en
# este puerto "time.sleep = X" tira AttributeError (módulo builtin de
# solo lectura), así que en vez de parchearlo se registra un módulo
# propio en sys.modules -- el import de MicroPython mira sys.modules
# antes que los builtins, mismo truco que "machine" de arriba. Todo lo
# que no sea sleep*() se delega tal cual al módulo real.
#
# Con algún irq() activo, el sleep se trocea en pasos de 10ms (como el
# _patched_sleep_ms de _base.hal.py) para que el handler corra cerca
# del momento del flanco y no recién al final de un sleep(1).
# ─────────────────────────────────────────────────────────────
import time as _pit_real_time

_SLEEP_POLL_CHUNK_MS = 10


def _pit_sleep_ms(ms):
    ms = int(ms)
    if not _irq_handlers:
        _pit_real_time.sleep_ms(ms)
        _pit_dispatch_irqs()
        return
    # Contra un deadline real (no "restar el paso"): cada sleep_ms()
    # corto duerme algo más de lo pedido (setTimeout), y sumado en un
    # sleep(1) troceado se notaba (~1.3s).
    deadline = _pit_real_time.ticks_add(_pit_real_time.ticks_ms(), ms)
    while True:
        _pit_dispatch_irqs()
        remaining = _pit_real_time.ticks_diff(deadline, _pit_real_time.ticks_ms())
        if remaining <= 0:
            return
        _pit_real_time.sleep_ms(_SLEEP_POLL_CHUNK_MS if remaining > _SLEEP_POLL_CHUNK_MS else remaining)


def _pit_sleep(seconds):
    _pit_sleep_ms(seconds * 1000)


def _pit_sleep_us(us):
    _pit_real_time.sleep_us(us)
    _pit_dispatch_irqs()


class _PitTimeModule:
    __name__ = "time"

    def __getattr__(self, name):
        return getattr(_pit_real_time, name)


_pit_time = _PitTimeModule()
_pit_time.sleep = _pit_sleep
_pit_time.sleep_ms = _pit_sleep_ms
_pit_time.sleep_us = _pit_sleep_us
sys.modules["time"] = _pit_time
sys.modules["utime"] = _pit_time
