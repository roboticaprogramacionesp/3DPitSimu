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
    # Timer/WDT (ver sección grande al final del archivo) se
    # definen DESPUÉS en este mismo módulo -- está bien, acá solo se
    # los LLAMA (no se ejecutan hasta el primer sleep() real del
    # código del alumno, momento en el que ya están definidos).
    # Mismo criterio que _irq_handlers: si no hay ningún Timer activo
    # ni WDT armado, no hace falta trocear el sleep en pasos de 10ms.
    if not _irq_handlers and not _pit_timers and _pit_wdt_active[0] is None:
        _pit_real_time.sleep_ms(ms)
        _pit_dispatch_irqs()
        _pit_dispatch_timers()
        return
    # Contra un deadline real (no "restar el paso"): cada sleep_ms()
    # corto duerme algo más de lo pedido (setTimeout), y sumado en un
    # sleep(1) troceado se notaba (~1.3s).
    deadline = _pit_real_time.ticks_add(_pit_real_time.ticks_ms(), ms)
    while True:
        _pit_dispatch_irqs()
        _pit_dispatch_timers()
        _pit_check_wdt()
        remaining = _pit_real_time.ticks_diff(deadline, _pit_real_time.ticks_ms())
        if remaining <= 0:
            return
        _pit_real_time.sleep_ms(_SLEEP_POLL_CHUNK_MS if remaining > _SLEEP_POLL_CHUNK_MS else remaining)


def _pit_sleep(seconds):
    _pit_sleep_ms(seconds * 1000)


def _pit_sleep_us(us):
    _pit_real_time.sleep_us(us)
    _pit_dispatch_irqs()
    _pit_dispatch_timers()
    _pit_check_wdt()


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


# ─────────────────────────────────────────────────────────────
# machine.Timer/WDT/RTC/deepsleep/reset_cause + machine.CAN --
# faltaban ENTEROS en este runtime (BUG REAL encontrado en vivo
# revisando qué bloques de Blockly rompían: wdt_init/wdt_feed,
# timer_init/timer_stop, rtc_init/rtc_set_datetime/rtc_get_datetime,
# machine_deepsleep/machine_reset_cause y can_init/can_send están
# TODOS en el toolbox -- cualquier alumno los puede arrastrar sin
# escribir una línea de código y le tiraba ImportError de una,
# mismo motivo exacto que machine.UART antes de _uart_bus_wasm.py).
#
# _pit_sleep_ms()/_pit_sleep_us() (arriba) ya llaman a
# _pit_dispatch_timers()/_pit_check_wdt() en cada yield de Asyncify
# -- mismo mecanismo "se actualiza durante el sleep() del script"
# que ya usan los IRQ de Pin. Igual que los IRQ: un bucle que JAMÁS
# llama a sleep() no puede recibir ningún tick de Timer ni disparar
# el WDT -- limitación conocida y documentada, no algo nuevo de acá.
# ─────────────────────────────────────────────────────────────

_pit_timers = {}          # id -> {period, mode, callback, next_due}
_pit_wdt_active = [None]  # [WDT] o [None] -- como lista para mutar sin "global"


def _pit_dispatch_timers():
    if not _pit_timers:
        return
    now = _pit_real_time.ticks_ms()
    # list(...) -- un callback puede deinit() OTRO timer (o el propio)
    # desde adentro; iterar sobre una copia evita
    # "RuntimeError: dictionary changed size during iteration".
    for tid, t in list(_pit_timers.items()):
        if _pit_real_time.ticks_diff(now, t["next_due"]) < 0:
            continue
        if t["mode"] == Timer.PERIODIC:
            t["next_due"] = _pit_real_time.ticks_add(t["next_due"], t["period"])
        else:
            _pit_timers.pop(tid, None)
        cb = t["callback"]
        if cb is None:
            continue
        try:
            cb(t["obj"])
        except Exception as e:
            # Igual que _pit_dispatch_irqs() -- un error en el
            # callback del alumno tiene que verse para poder
            # corregirlo, no tragarse en silencio.
            sys.print_exception(e)


class Timer:
    ONE_SHOT = 0
    PERIODIC = 1

    def __init__(self, id=-1, *a, **kw):
        self._id = id
        if a or kw:
            self.init(*a, **kw)

    def init(self, period=1000, mode=PERIODIC, callback=None, *a, **kw):
        _pit_timers[self._id] = {
            "period": period,
            "mode": mode,
            "callback": callback,
            "obj": self,
            "next_due": _pit_real_time.ticks_add(_pit_real_time.ticks_ms(), period),
        }

    def deinit(self):
        _pit_timers.pop(self._id, None)


machine.Timer = Timer


# ── WDT ──────────────────────────────────────────────────────
# Alcance a propósito más chico que un WDT real: en vez de
# simular un reinicio completo de la placa (reabrir el Worker,
# reimportar todo, reimprimir el banner -- una reestructuración
# bastante más grande, fuera de alcance de este cambio), levanta
# una excepción clara cuando no se lo alimenta a tiempo. Desde la
# perspectiva del alumno el efecto pedagógico es el mismo que
# busca el bloque (el programa se corta y avisa "te olvidaste de
# alimentar el WDT"), sin la complejidad de reiniciar el intérprete
# entero.
class WDT:
    def __init__(self, id=0, timeout=5000):
        self._timeout = timeout
        self._last_feed = _pit_real_time.ticks_ms()
        _pit_wdt_active[0] = self

    def feed(self):
        self._last_feed = _pit_real_time.ticks_ms()


def _pit_check_wdt():
    wdt = _pit_wdt_active[0]
    if wdt is None:
        return
    elapsed = _pit_real_time.ticks_diff(_pit_real_time.ticks_ms(), wdt._last_feed)
    if elapsed < wdt._timeout:
        return
    _pit_wdt_active[0] = None
    raise RuntimeError(
        "Reinicio simulado: el Watchdog Timer (WDT) no fue alimentado a tiempo "
        "(sin feed() por mas de %dms) -- en un ESP32 real esto reinicia la placa. "
        "Llama a wdt.feed() mas seguido dentro de tu bucle." % wdt._timeout
    )


machine.WDT = WDT


# ── RTC (reloj interno del ESP32, sin pila -- a diferencia del
# DS3231 EXTERNO, acá no hay ningún componente ni cableado de por
# medio: es puro estado de este módulo, el propio código del alumno
# lo lee/escribe directo). Sin backup de batería real, así que
# arranca en una fecha fija "sin configurar" (mismo criterio y mismo
# valor que _DS_DEFAULT_EPOCH en ds3231.hal.py: 2025-01-01) en vez de
# la hora real de la compu -- a propósito: un ESP32 real NO sabe qué
# hora es al arrancar, ese es justamente el motivo por el que los
# tutoriales enseñan a sincronizar por WiFi/NTP o por un RTC externo.
#
# Días-desde-civil / civil-desde-días: algoritmo estándar de Howard
# Hinnant (http://howardhinnant.github.io/date_algorithms.html),
# válido para cualquier año del calendario gregoriano proléptico --
# evita tener que traer una librería de calendario completa solo
# para sumarle unos segundos a una fecha.
def _pit_days_from_civil(y, m, d):
    y = y - 1 if m <= 2 else y
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _pit_civil_from_days(z):
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    y = y + 1 if m <= 2 else y
    return y, m, d


_PIT_RTC_DEFAULT_EPOCH = 1735689600  # 2025-01-01T00:00:00Z, igual que ds3231.hal.py


def _pit_dt_to_epoch(y, mo, d, h, mi, s):
    return _pit_days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s


def _pit_epoch_to_dt(epoch):
    days, rem = divmod(epoch, 86400)
    y, mo, d = _pit_civil_from_days(days)
    h, rem = divmod(rem, 3600)
    mi, s = divmod(rem, 60)
    return y, mo, d, h, mi, s


_pit_rtc_anchor_epoch = [_PIT_RTC_DEFAULT_EPOCH]
_pit_rtc_anchor_ms = [_pit_real_time.ticks_ms()]


class RTC:
    def __init__(self, id=0):
        pass

    def datetime(self, dt=None):
        if dt is None:
            elapsed_s = _pit_real_time.ticks_diff(_pit_real_time.ticks_ms(), _pit_rtc_anchor_ms[0]) // 1000
            y, mo, d, h, mi, s = _pit_epoch_to_dt(_pit_rtc_anchor_epoch[0] + elapsed_s)
            # weekday 0=lunes..6=domingo (mismo orden que machine.RTC
            # real) -- 1970-01-01 (día 0 desde civil) fue jueves (3).
            weekday = (_pit_days_from_civil(y, mo, d) + 3) % 7
            return (y, mo, d, weekday, h, mi, s, 0)
        y, mo, d = dt[0], dt[1], dt[2]
        h, mi, s = dt[4], dt[5], dt[6]
        _pit_rtc_anchor_epoch[0] = _pit_dt_to_epoch(y, mo, d, h, mi, s)
        _pit_rtc_anchor_ms[0] = _pit_real_time.ticks_ms()


machine.RTC = RTC


# ── deepsleep()/reset_cause() -- alcance reducido a propósito (ver
# nota grande de WDT arriba, mismo motivo): NO reinicia de verdad el
# intérprete ni vuelve a correr el script desde el principio, así que
# reset_cause() nunca va a devolver DEEPSLEEP_RESET en este runtime
# (sería mentir -- el script nunca "reinició" de verdad). Se
# simula como un sleep largo (en pasos de a 1s, mismo
# _pit_sleep_ms() de siempre) para que al menos no rompa ni se
# cuelgue -- el patrón típico de tutorial "if reset_cause() ==
# DEEPSLEEP_RESET" simplemente nunca entra a esa rama, igual que en
# un ESP32 recién encendido por primera vez.
machine.POWERON_RESET = 1
machine.HARD_RESET = 2
machine.WDT_RESET = 3
machine.DEEPSLEEP_RESET = 4
machine.SOFT_RESET = 5


def _pit_reset_cause():
    return machine.POWERON_RESET


def _pit_deepsleep(ms=0):
    if ms:
        _pit_sleep_ms(ms)
    else:
        while True:
            _pit_sleep_ms(1000)


machine.reset_cause = _pit_reset_cause
machine.deepsleep = _pit_deepsleep


# ── CAN -- stub seguro (no-op), no roto. No hay ningún bus CAN
# compartido simulado en este proyecto (haría falta otro ESP32 "del
# otro lado" escuchando, y no hay ninguna noción de eso todavía) --
# a diferencia de ESP-NOW/BLE, que sí tienen a quién entregarle el
# mensaje. send()/recv() no rompen, pero tampoco entregan nada: mismo
# criterio que ble.gatts_set_buffer() (no-op documentado) en vez de
# simular una mitad de la conversación que nunca se puede completar.
class CAN:
    NORMAL = 0
    LOOPBACK = 1
    SILENT = 2
    SILENT_LOOPBACK = 3

    def __init__(self, bus=0, *a, **kw):
        self._bus = bus

    def send(self, data, id, *a, **kw):
        return None

    def recv(self, *a, **kw):
        raise OSError(116, "ETIMEDOUT")  # no hay nada que leer -- mismo que un bus real sin tráfico

    def any(self):
        return False

    def deinit(self):
        pass


machine.CAN = CAN
