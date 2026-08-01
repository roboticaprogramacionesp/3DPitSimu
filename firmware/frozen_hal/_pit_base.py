# =============================================================
# PitSimulator — HAL Base (VARIANTE CONGELADA)
#
# Copia BIT A BIT del components/_base/_base.hal.py del repo del
# simulador (browser), pensada para congelarse en el firmware real
# (freeze) e importarse desde boot.py -- ver boot_snippet.py en esta
# misma carpeta -- en vez de pegarse por paste-mode en cada sesión
# de QEMU. Sin cambios funcionales respecto al original: mismo
# contenido, la ÚNICA diferencia entre ambos archivos es este
# encabezado.
#
# NO EDITAR ESTE ARCHIVO SIN EDITAR TAMBIÉN
# components/_base/_base.hal.py EN EL REPO DEL SIMULADOR (y viceversa)
# -- son dos copias del mismo comportamiento, una para transmisión
# (paste-mode, firmware viejo sin este freeze) y otra para arranque
# congelado (firmware nuevo). Si divergen, un firmware viejo y uno
# nuevo se van a comportar distinto ante el mismo .hal.py de
# componente.
#
# Se inyecta SIEMPRE antes del código del usuario.
# Proporciona:
#   - class Pin  con salida GPIO:N:V y lectura de IN:N:V
#   - poll_input(): drenado no-bloqueante de stdin (ver más abajo)
#   - register_line_handler(prefix, callback): para que otros
#     HAL (ky_001, dht11, hcsr04, etc.) reaccionen a su propio
#     prefijo (ej. "TEMP:") sin abrir su propio lector.
#
# ── REDISEÑO (v2): sin thread de fondo ──────────────────────────
#
# ANTES (v1): un solo _thread.start_new_thread(...) hacía
# sys.stdin.read(1) en loop infinito, 24/7, en paralelo al REPL
# nativo de MicroPython. El problema: el REPL nativo TAMBIÉN lee
# sys.stdin para tus comandos tipeados -- dos lectores reales,
# concurrentes (en el otro núcleo), sobre el mismo UART físico, se
# robaban caracteres entre sí sin ningún orden. Eso causaba el bug
# de "hay que reenviar el comando 2-3 veces". Se probó separar el
# thread a un UART1 dedicado (ver historial) pero terminó peor
# (texto scrambleado de punta a punta) porque el "-machine esp32"
# de este QEMU no lo aisló como se esperaba.
#
# AHORA (v2): NO hay ningún thread ni lector en background. En vez
# de eso, poll_input() se llama SINCRÓNICAMENTE desde Pin.value()
# (cuando tu código lee un pin de entrada) usando select.poll(...,
# timeout=0) -- una revisión no-bloqueante de "¿hay bytes esperando
# ahora mismo?". Como esto corre en el MISMO hilo que tu código de
# usuario (no hay segundo núcleo compitiendo), nunca hay dos
# lectores de stdin activos al mismo tiempo: mientras tu script
# corre, el REPL nativo no está leyendo nada (está "pausado"
# esperando a que tu script termine o se interrumpa); y mientras
# el REPL nativo SÍ está leyendo (esperando el próximo comando en
# el prompt ">>>"), nuestro código no toca stdin para nada, porque
# no hay ningún script corriendo que llame a Pin.value().
#
# Costo del cambio: los valores inyectados (IN:, TEMP:, etc.) ya
# no se procesan "en cuanto llegan" -- se procesan la próxima vez
# que tu código llama a algo que dispare poll_input() (típicamente
# pin.value() dentro de tu propio while True:). Para el patrón
# normal de código embebido (polling en loop) esto es imperceptible
# -- como mucho un ciclo de loop de diferencia.
#
# Si escribís un HAL nuevo (sensor, etc.) que reciba datos por su
# propio prefijo via register_line_handler(), llamá a poll_input()
# al principio de tu propio método de lectura (read_temp(),
# is_pressed(), etc.) para refrescar el valor antes de devolverlo
# -- mismo mecanismo que ya usa Pin.value() acá abajo.
# =============================================================

import sys
import select
import time
import machine
from machine import Pin as _RealPin

# Estado de pines de entrada recibidos desde el simulador
_pin_input_states = {}
_stdin_buf = ""

# Último valor CONFIRMADO de cada pin de entrada (separado de
# _pin_input_states porque ese es "el valor actual", mientras que
# este es "el valor anterior", usado SOLO para detectar flancos
# rising/falling en _maybe_fire_irq() -- ver más abajo).
_pin_prev_states = {}

# Handlers de Pin.irq() registrados por pin: { gpio: {"trigger":.., "handler":.., "pin":..}, ... }
# Real machine.Pin.irq() también permite un solo handler activo por
# pin (llamar .irq() de nuevo reemplaza al anterior) -- mismo
# criterio acá.
_irq_handlers = {}

# Handlers registrados por otros HAL: { "TEMP:": [callback1, callback2, ...], ... }
# Puede haber más de un callback para el mismo prefijo (ej. un
# KY-001 y un DHT11 en el mismo canvas, ambos usan "TEMP:") --
# se llaman TODOS los que matcheen, no solo el primero.
_line_handlers = {}


def register_line_handler(prefix, callback):
    """
    Registra una función para un prefijo de línea que mande el
    simulador (ej. "TEMP:19:25.5" -> prefix="TEMP:").
    callback recibe parts = line.split(":")

    Si dos HAL distintos registran el mismo prefix (ej. KY-001 y
    DHT11 comparten "TEMP:"), ambos callbacks se guardan y se
    llaman los dos -- ninguno pisa al otro. Cada callback es
    responsable de chequear si el gpio del mensaje (parts[1]) le
    corresponde a él.
    """
    _line_handlers.setdefault(prefix, []).append(callback)


# sys.modules como "estado persistente" entre re-pasteos de este
# mismo archivo (ver la nota larga más abajo, junto al poller) --
# reutilizamos el mismo truco que ya existía en la v1 para el
# guard del thread, ahora para no re-registrar el poller.
if "_pit_state" not in sys.modules:
    sys.modules["_pit_state"] = {}

_pit_state = sys.modules["_pit_state"]


def _get_poller():
    """
    select.poll() registrado sobre sys.stdin, creado una sola vez
    y reutilizado -- registrar el mismo stream dos veces en un
    poller nuevo es inofensivo, pero evitamos crear un poller
    nuevo en cada re-paste por prolijidad (y por si el poller real
    de este puerto no tolerase doble-registro).
    """
    poller = _pit_state.get("poller")
    if poller is None:
        poller = select.poll()
        poller.register(sys.stdin, select.POLLIN)
        _pit_state["poller"] = poller
    return poller


# ── REDISEÑO (v3): handshake real en vez de tiempo fijo ─────────
#
# ANTES (v2): después de CADA escritura de un pin de salida,
# _settle() dormía _SETTLE_MS=75 milisegundos fijos (ajustados a
# mano) antes de devolver el control al código de usuario. Le daba
# tiempo al viaje de ida y vuelta GPIO: -> SignalEngine -> IN: para
# completarse ANTES de que el firmware siguiera con la siguiente
# instrucción (típicamente, leer un pin de entrada relacionado --
# el caso del teclado matricial: baja columna, lee filas). El
# problema: 75ms es una ADIVINANZA -- en una máquina rápida sobra
# (todo mueve en <10ms y el firmware espera de más en cada columna
# escaneada), y en una máquina lenta/con la pestaña en background
# puede no alcanzar (mismo bug de "fila lee 0 fantasma" que este
# mecanismo existe para evitar).
#
# AHORA (v3): en vez de adivinar un tiempo, pedimos confirmación.
# Cada vez que el simulador (SignalEngine, del lado JS) termina de
# recalcular todo lo que dependía de la última escritura de pin
# (filas de teclado, etc.) y ya mandó los "IN:" que correspondan,
# manda un "SYNC:\n" por el mismo canal que ya usa para IN:/TEMP:/
# I2CR: (stdin del firmware, no stdout -- ver QemuBridge.js:
# parseLine, rama "GPIO:"). _settle() ya no cuenta milisegundos:
# cuenta cuántos "SYNC:" vio poll_input() y espera a que llegue
# el que le corresponde a ESTA escritura puntual.
#
# Por qué un contador y no un simple booleano: si el firmware hace
# varias escrituras seguidas muy rápido (recorrido de columnas del
# teclado) antes de que el navegador llegue a confirmar la primera,
# un booleano se pisaría entre escrituras. Con un contador
# incremental, cada _settle() sabe exactamente cuál "SYNC:" es el
# suyo (el próximo en llegar), sin importar si ya había alguno
# pendiente de una escritura anterior.
#
# _SYNC_TIMEOUT_MS es un tope de seguridad, no el mecanismo
# principal: si por algún motivo el SYNC nunca llega (el navegador
# se desconectó a mitad de una corrida, por ejemplo), no nos
# colgamos para siempre esperando -- seguimos de largo después de
# ese tope, mismo comportamiento de "peor caso" que ya tenía la v2.
_SYNC_TIMEOUT_MS = 1500

_sync_pending = 0  # cuántas líneas "SYNC:" confirmadas por el simulador ya vio poll_input(), en total, desde que arrancó el firmware

# Guarda contra reentrancia -- BUG REAL encontrado con el encoder
# KY-040 (rotary_irq_esp.py): Pin.value() llama a poll_input() cada
# vez que se LEE un pin de entrada. Pero un handler de Pin.irq()
# registrado por el usuario (ver _maybe_fire_irq más abajo) puede
# llamar a pin.value() DESDE ADENTRO de su propio callback -- y ese
# callback se dispara DESDE ADENTRO del for de líneas de ESTE MISMO
# poll_input(), que en ese momento está a mitad de camino iterando su
# propia lista local `lines`. Sin este guard, esa lectura reentrante
# vuelve a entrar a poll_input() mientras la llamada de afuera sigue
# en curso -- confirmado como la causa real de que rotary_irq_esp.py
# (que registra el MISMO callback en CLK y en DT, y lee ambos pines
# sincrónicamente en cada flanco) nunca actualizara su valor: la
# re-entrada competía por drenar el mismo stdin/buffer global a mitad
# de la iteración de la llamada de afuera. No hace falta que la
# llamada de adentro haga nada -- el valor que pin.value() necesita
# YA está actualizado en _pin_input_states (se escribe ANTES de
# disparar el IRQ, ver el comentario grande más abajo), así que
# no-opear la reentrada no pierde ningún dato: la llamada de AFUERA
# sigue drenando el resto del stdin normalmente.
_polling_active = False


def _settle():
    global _sync_pending
    target = _sync_pending + 1
    start = time.ticks_ms()
    while _sync_pending < target:
        poll_input()
        if time.ticks_diff(time.ticks_ms(), start) > _SYNC_TIMEOUT_MS:
            break


def poll_input():
    """
    Revisa, SIN BLOQUEAR, si hay bytes esperando en stdin y los
    procesa todos (puede haber más de una línea acumulada si pasó
    un rato desde el último poll_input()). Reemplaza al thread de
    la v1 -- hay que llamarlo desde código que corre sincrónicamente
    con el resto (ver Pin.value() más abajo), nunca desde un thread
    aparte, o volvemos al mismo problema de origen.
    """
    global _stdin_buf, _pin_input_states, _sync_pending, _polling_active

    # Ver el comentario grande junto a _polling_active más arriba --
    # una llamada reentrante (disparada por un Pin.irq() leyendo
    # pin.value() desde su propio handler) no-opea acá; la llamada de
    # AFUERA sigue drenando el resto normalmente.
    if _polling_active:
        return
    _polling_active = True

    poller = _get_poller()

    # BUG REAL encontrado (reportado por el usuario, traceback real):
    # un Ctrl+C que llega justo DENTRO de este bucle (típicamente
    # mientras _settle() espera el "SYNC:\n" de una escritura I2C/GPIO
    # real) puede dejar bytes de protocolo YA ESCRITOS por el
    # simulador pero TODAVÍA sin leer -- KeyboardInterrupt no es un
    # Exception normal (no lo agarra el "except Exception:" de más
    # abajo), así que corta el drenado a mitad de camino y esos bytes
    # quedan crudos en el pty. El intérprete vuelve a su prompt
    # ">>> " normal, que lee ese sobrante como si el usuario lo
    # hubiera tipeado (ej. "SYNC:" solo -> SyntaxError). Acá se
    # atrapa el KeyboardInterrupt PUNTUALMENTE alrededor de la
    # lectura, se sigue drenando/procesando todo lo que ya esté
    # disponible en el poller (para no perder ninguna línea completa
    # que ya haya llegado), y RECIÉN AL FINAL se relanza -- así
    # Ctrl+C sigue interrumpiendo exactamente igual que antes (mismo
    # comportamiento hacia quien llama a poll_input()/_settle()),
    # solo que sin dejar basura sin consumir en el canal.
    _pending_interrupt = None

    try:
        # poll(0) = no bloquear, solo preguntar "¿hay algo YA
        # disponible?". Si hay varios bytes en cola, este while los
        # va drenando de a uno hasta que no quede nada listo.
        while poller.poll(0):

            try:
                ch = sys.stdin.read(1)
            except KeyboardInterrupt as _e:
                _pending_interrupt = _e
                continue

            if not ch:
                break

            _stdin_buf += ch

            if "\n" not in _stdin_buf:
                continue

            lines      = _stdin_buf.split("\n")
            _stdin_buf = lines[-1]

            for line in lines[:-1]:
                line = line.strip()
                if not line:
                    continue

                if line == "SYNC:":
                    # Confirmación del simulador: ya terminó de
                    # recalcular todo lo que dependía de la última
                    # escritura de pin (y ya mandó los IN:/etc que
                    # correspondan). Ver _settle() más abajo.
                    _sync_pending += 1
                    continue

                if line.startswith("IN:"):
                    parts = line.split(":")
                    if len(parts) >= 3:
                        try:
                            gpio = int(parts[1])
                            value = int(parts[2])
                        except ValueError:
                            continue
                        # OJO: actualizar _pin_input_states ANTES de
                        # disparar el IRQ (no después) -- igual que en
                        # hardware real, para cuando el handler llegue
                        # a correr la transición eléctrica YA pasó, así
                        # que si el handler lee pin.value() (propio o
                        # de otro pin, patrón típico de un decoder de
                        # cuadratura que lee CLK+DT juntos al firmarse
                        # cualquiera de los dos) tiene que ver el valor
                        # NUEVO, no el viejo que motivó el flanco.
                        # Hacerlo ACÁ ADENTRO del for de líneas (no una
                        # sola vez al final de poll_input()) importa
                        # igual: si llegaron varias líneas "IN:" juntas
                        # para el mismo gpio (ej. los 3 pasos de
                        # cuadratura de un encoder mandados casi
                        # seguidos), cada transición individual dispara
                        # su propio IRQ, no solo la última.
                        old_value = _pin_input_states.get(gpio)
                        _pin_input_states[gpio] = value
                        _maybe_fire_irq(gpio, old_value, value)
                    continue

                for prefix, callbacks in _line_handlers.items():
                    if line.startswith(prefix):
                        for callback in callbacks:
                            try:
                                callback(line.split(":"))
                            except Exception:
                                pass
                        # OJO: sin "break" -- si dos prefijos
                        # distintos matchearan la misma línea (no
                        # debería pasar con los prefijos actuales,
                        # pero por las dudas) también se despachan
                        # todos, no solo el primero.

    except Exception:
        pass
    finally:
        _polling_active = False

    if _pending_interrupt is not None:
        raise _pending_interrupt


# ── Soporte de Pin.irq() (interrupciones "emuladas") ────────────
#
# NO hay ninguna transición eléctrica de verdad detrás de un "IN:"
# (ver la nota grande de arriba: este simulador es 100% de polleo,
# nunca tocamos el GPIO real de QEMU para pines de entrada). Lo que
# hacemos acá es más humilde pero alcanza para la mayoría del
# código real que usa Pin.irq(): cuando poll_input() procesa una
# línea "IN:" y ve que el valor de ESE pin cambió respecto al
# anterior, y hay un handler registrado para ese pin que pida ese
# tipo de flanco (RISING/FALLING), lo llamamos ahí mismo,
# sincrónicamente, con el mismo Pin que se lo registró (como pide
# la firma real: handler(pin)).
#
# LIMITACIÓN: como esto se dispara desde DENTRO de poll_input(), y
# poll_input() solo corre cuando ALGO en el hilo de tu firmware lo
# llama (Pin.value(), o ahora también time.sleep()/sleep_ms(), ver
# el parcheo más abajo), un handler de irq() nunca va a disparar
# "instantáneamente" como en hardware real -- dispara la PRÓXIMA
# vez que tu propio código le da una oportunidad. Para el patrón
# típico (setup con irq() + loop principal con time.sleep_ms() para
# no consumir 100% CPU) esto es indistinguible de una interrupción
# real. Para un loop sin NINGÚN sleep/poll (busy loop puro sin
# llamar nada que dispare poll_input()) los irq no van a disparar
# hasta la próxima vez que se llame a algo que sí lo haga.
def _maybe_fire_irq(gpio, old_value, new_value):
    if old_value is None or old_value == new_value:
        # Sin valor previo (primera muestra de este pin) no hay
        # flanco que detectar -- o no cambió, tampoco hay flanco.
        return

    entry = _irq_handlers.get(gpio)
    if not entry:
        return

    trigger = entry["trigger"]
    rising = new_value == 1 and old_value == 0
    falling = new_value == 0 and old_value == 1

    fires = (rising and (trigger & _RealPin.IRQ_RISING)) or (
        falling and (trigger & _RealPin.IRQ_FALLING)
    )
    if not fires:
        return

    try:
        entry["handler"](entry["pin"])
    except Exception:
        # Mismo criterio que el resto de poll_input(): un error en
        # el handler del usuario no puede tirar abajo el polleo de
        # todo lo demás.
        pass


class Pin(_RealPin):

    def __init__(self, pin, mode=-1, pull=-1, **kw):
        super().__init__(pin, mode, pull, **kw)
        self._pin_num  = pin
        self._last_val = None
        self._pull     = pull
        self._mode     = mode
        if mode == _RealPin.OUT and "value" in kw:
            self._last_val = 1 if kw["value"] else 0
            # FIX real (reportado por el usuario, traceback real: un
            # "SYNC:" suelto aparecía como comando tipeado y tiraba
            # SyntaxError después de Pin(N, Pin.OUT, value=1)). El
            # super().__init__(**kw) de arriba YA hizo la escritura
            # real del pin (gpio_set_level() de verdad, vía el kwarg
            # "value" que machine.Pin real soporta nativamente) -- pero
            # eso pasa por FUERA de on()/off(), que son los únicos que
            # hoy llaman a _settle() para esperar el "SYNC:\n" de
            # confirmación antes de devolver el control al usuario.
            # Sin este _settle() acá, el REPL volvía al prompt ">>>"
            # ANTES de que llegara esa confirmación -- y cuando por fin
            # llegaba (async), el prompt idle la leía como si el
            # usuario la hubiera tipeado. Mismo bug de fondo que
            # KeyboardInterrupt/SYNC (ver el comentario grande de
            # poll_input() más abajo), disparado por un camino distinto.
            _settle()

    def on(self):
        super().on()
        if self._last_val != 1:
            self._last_val = 1
            # NO escribimos "GPIO:{}:1\n" acá -- server.js ya detecta esta
            # misma transición vía el breakpoint de GDB en gpio_set_level()
            # (ver runGpioEventBridge en server.js) y la reenvía al navegador
            # por su cuenta. Si además la imprimíamos acá, proc.stdout.on("data")
            # la reenviaba TAMBIÉN, y el navegador terminaba mandando DOS
            # "SYNC:\n" por cada escritura real -- _sync_pending se adelantaba
            # de a 1 en cada write y _settle() dejaba de esperar el round-trip
            # de verdad (volvía al bug de "fila lee 0 fantasma" que el
            # handshake SYNC existe para evitar). Igual llamamos a _settle():
            # sigue esperando la ÚNICA confirmación que ahora sí llega, la
            # del bridge de GDB.
            #
            # (Se probó reemplazar el bridge de GDB por un auto-reporte acá
            # -- _GPIO_SELF_REPORT -- para evitar el round-trip de GDB. Sin
            # beneficio medido: el cuello de botella real resultó ser la
            # espera de "SYNC:\n" de _settle(), que igual pasa por el mismo
            # trozeado/pausa de server.js. Revertido.)
            _settle()

    def off(self):
        super().off()
        if self._last_val != 0:
            self._last_val = 0
            # Ver nota en on() -- mismo motivo, no imprimir "GPIO:{}:0\n" acá.
            _settle()

    def value(self, v=None):
        if v is None:
            # FIX real: un pin configurado como SALIDA (Pin.OUT) tiene
            # que devolver acá el ÚLTIMO valor que el propio firmware
            # escribió (self._last_val), no leer una entrada. Antes
            # esta rama SIEMPRE hacía poll_input()/_pin_input_states
            # sin importar el modo del pin -- pero _pin_input_states
            # solo se llena con "IN:" del simulador, algo que NUNCA
            # llega para un pin que el firmware maneja como salida
            # (nadie del lado JS le está inyectando un valor de
            # entrada). Resultado: led.value() en un Pin.OUT daba
            # SIEMPRE el "default" (0), así que
            # "led.value(not led.value())" quedaba pegado en 1 para
            # siempre después del primer toggle real -- reportado como
            # "solo on()/off() funcionan, value() no".
            if self._mode == _RealPin.OUT:
                return self._last_val if self._last_val is not None else 0
            # Pin de entrada: refrescar desde stdin (no-bloqueante)
            # y devolver el estado inyectado por el simulador.
            #
            # Default cuando TODAVÍA no llegó ningún "IN:" para este
            # pin (recién creado, o la respuesta del simulador está
            # en camino y no llegó a tiempo para este poll_input()):
            # antes esto era siempre 0, lo cual es correcto para
            # PULL_DOWN/sin pull pero FALSO para PULL_UP -- un pin
            # con pull-up en reposo (nada tirándolo a tierra) tiene
            # que leer 1, no 0. Con el default viejo, cualquier
            # sensor/teclado con filas PULL_UP leía "activo" (0)
            # hasta que el primer IN: confirmado llegara, generando
            # falsos positivos justo en la ventana de la carrera
            # entre escribir GPIO:/leer value() (ver keypad4.py:
            # baja columna -> lee filas en el mismo tick -> nunca da
            # tiempo al round-trip -> fila lee 0 "fantasma").
            poll_input()
            default = 1 if self._pull == _RealPin.PULL_UP else 0
            return _pin_input_states.get(self._pin_num, default)
        # Pin de salida: escribir
        if v:
            self.on()
        else:
            self.off()

    def irq(self, handler=None, trigger=(_RealPin.IRQ_RISING | _RealPin.IRQ_FALLING), *a, **kw):
        # FIX real: toda la infraestructura para esto (_irq_handlers,
        # _maybe_fire_irq, ver los comentarios grandes más arriba) ya
        # existía, pero nada la conectaba -- Pin.irq() nunca estaba
        # sobreescrito, así que caía en el _RealPin.irq() real (que
        # espera un flanco eléctrico de hardware que este simulador
        # nunca produce para pines de entrada). Resultado: _irq_handlers
        # quedaba siempre vacío y _maybe_fire_irq no disparaba nunca.
        # Confirmado con RotaryIRQ (rotary_irq_esp, que registra su
        # propio handler acá adentro) leyendo siempre 0.
        #
        # NO llamamos a super().irq(...) -- no hace falta ni conviene
        # engancharse al IRQ de hardware real (nunca va a dispararse
        # para un pin de entrada simulado, y podría fallar/no tener
        # sentido en este build de QEMU).
        if handler is None:
            _irq_handlers.pop(self._pin_num, None)
        else:
            _irq_handlers[self._pin_num] = {"handler": handler, "trigger": trigger, "pin": self}


# ─────────────────────────────────────────────────────────────
# Parcheo de time.sleep()/time.sleep_ms(): el patrón típico de
# código que usa Pin.irq() es "setup con irq() + loop principal con
# sleep_ms()/sleep() nada más" (sin ningún pin.value() en el medio,
# ver el ejemplo real que motivó este fix: RotaryIRQ + while True:
# print(encoder.value()); sleep(1) -- encoder.value() es un contador
# propio de la librería, no un Pin.value() nuestro). Sin este parche,
# poll_input() nunca se llama en ese patrón -- ni las líneas "IN:"
# se procesan, ni ningún IRQ emulado dispara jamás, sin importar que
# Pin.irq() ya esté bien conectado arriba.
#
# Se trocea el sleep pedido en pasos chicos, sondeando poll_input()
# entre cada uno, en vez de dormir de un saque y sondear una sola vez
# al final -- así, un sleep(1) todavía alcanza a ver (y a disparar
# IRQ para) varias transiciones que lleguen escalonadas durante ese
# segundo (ej. las 4 fases de cuadratura de un encoder, mandadas cada
# 4ms -- ver SignalEngine.setEncoderStep), no solo la última.
# ─────────────────────────────────────────────────────────────
# OJO -- confirmado en la práctica, dos veces: esta build de firmware
# ("3DPit-Blockly v1.0") NO tiene time.sleep_ms() (primer intento) NI
# time.sleep() (segundo intento, mismo AttributeError sobre "sleep" a
# secas) -- a diferencia de time.ticks_ms()/ticks_diff(), que sí
# existen y ya se usaban sin problema en _settle() más arriba. Nada de
# acceso directo a NINGUNA de las dos: getattr() con default None para
# ambas, y como último recurso (si ninguna existe) un busy-wait armado
# a mano sobre ticks_ms()/ticks_diff(), que son los únicos que esta
# build garantiza tener.
_orig_sleep = getattr(time, "sleep", None)
_orig_sleep_ms = getattr(time, "sleep_ms", None)
_SLEEP_POLL_CHUNK_MS = 10


def _real_sleep_ms(ms):
    if _orig_sleep_ms is not None:
        _orig_sleep_ms(ms)
    elif _orig_sleep is not None:
        _orig_sleep(ms / 1000)
    else:
        start = time.ticks_ms()
        while time.ticks_diff(time.ticks_ms(), start) < ms:
            pass


def _patched_sleep_ms(ms):
    remaining = ms
    while remaining > 0:
        poll_input()
        step = _SLEEP_POLL_CHUNK_MS if remaining > _SLEEP_POLL_CHUNK_MS else remaining
        _real_sleep_ms(step)
        remaining -= step
    poll_input()


def _patched_sleep(seconds):
    _patched_sleep_ms(int(seconds * 1000))


# CONFIRMADO EN LA PRÁCTICA -- esto es lo que de verdad rompía todo:
# en esta build, "time.sleep" SE PUEDE LEER (from time import sleep
# tipeado a mano en el REPL anduvo bien) pero NO SE PUEDE REASIGNAR --
# "time.sleep = X" tira AttributeError igual, como si no existiera.
# Sin este try/except, esa excepción no la capturaba nadie y cortaba
# en seco el resto del paste -- machine.Pin, I2C y ADC (que van
# DESPUÉS en este mismo archivo) nunca llegaban a instalarse, ni
# mensaje de error claro más que un traceback en medio del pegado.
# Con esto, si la asignación no se puede en esta build, seguimos de
# largo (ver el intento con machine.Timer más abajo, que no depende
# de poder tocar el módulo "time" para nada).
try:
    time.sleep = _patched_sleep
except Exception:
    pass
try:
    time.sleep_ms = _patched_sleep_ms
except Exception:
    pass


# ─────────────────────────────────────────────────────────────
# Alternativa que NO depende de poder reasignar nada en el módulo
# "time" (confirmado que en esta build no se puede): un
# machine.Timer de hardware que llama a poll_input() cada
# _SLEEP_POLL_CHUNK_MS, sin importar qué haga el código del usuario
# (sleep(), busy-loop, lo que sea).
#
# OJO -- los callbacks de Timer en MicroPython corren típicamente en
# contexto de ISR "hard" (sin poder asignar memoria, ver
# https://docs.micropython.org/en/latest/reference/isr_rules.html),
# y poll_input() SÍ asigna memoria (concatena strings, arma dicts) --
# llamarlo directo desde el callback del Timer probablemente tire
# MemoryError o similar. micropython.schedule() difiere la llamada
# real a un contexto seguro (fuera del ISR) -- se usa por eso.
#
# CAMBIO -- confirmado en la práctica: con micropython.schedule() de
# por medio, el Timer se arma sin error (ya no sale HAL_WARN) pero
# encoder.value() sigue en 0 pase lo que pase. No hay forma de saber
# desde acá si eso es porque schedule() nunca llega a drenarse en esta
# build custom (nada garantiza CUÁNDO corre, solo que se encola) o por
# otra causa -- así que sacamos esa capa de indirección y llamamos
# poll_input() DIRECTO desde el callback del Timer. Más arriesgado en
# teoría (podría tirar MemoryError por asignar memoria en ISR), pero
# si esta build no respeta schedule() como se espera, es la única
# forma de confirmarlo con evidencia real en vez de seguir a ciegas.
# Sigue con try/except: si esto rompe, HAL_WARN avisa y quedamos igual
# que antes (nada peor que ya no tener el Timer).
#
# Todo esto entero en un try/except: si "machine.Timer" no existe en
# esta build o el modo de callback no es compatible, preferible
# quedarnos sin esta mejora (mismo comportamiento que antes: hace
# falta que el código del usuario llame pin.value() en algún momento)
# a que cualquiera de estos problemas tire abajo el resto del HAL de
# nuevo.
try:
    import machine as _machine_timer_mod

    def _timer_poll_cb(_t):
        try:
            poll_input()
        except Exception:
            pass

    # CONFIRMADO EN LA PRÁCTICA: Timer(-1) ("timer virtual", válido en
    # el ESP32 real) tira ValueError('invalid Timer number') en esta
    # build -- probamos varios IDs de timer de HARDWARE (0-3, los que
    # trae un ESP32 real) en vez de asumir cuál anda, y nos quedamos
    # con el primero que no tire excepción.
    _poll_timer = None
    _last_timer_err = None
    for _timer_id in (-1, 0, 1, 2, 3):
        try:
            _poll_timer = _machine_timer_mod.Timer(_timer_id)
            _poll_timer.init(
                period=_SLEEP_POLL_CHUNK_MS,
                mode=_machine_timer_mod.Timer.PERIODIC,
                callback=_timer_poll_cb,
            )
            break
        except Exception as _e:
            _last_timer_err = _e
            _poll_timer = None

    if _poll_timer is None:
        raise _last_timer_err
except Exception as _timer_setup_err:
    # OJO -- antes esto era un except mudo. Después de varias rondas
    # perdidas sin saber si este Timer siquiera se llegaba a armar,
    # mejor un aviso visible (no HAL_ERROR: eso reintenta todo el
    # HAL de nuevo, y esto no amerita eso) que seguir a ciegas.
    print("HAL_WARN:_base: no se pudo armar el Timer de polleo (probé -1,0,1,2,3): " + repr(_timer_setup_err))


# ─────────────────────────────────────────────────────────────
# CLAVE: reemplazar el atributo real del módulo "machine".
#
# Sin esto, la clase de arriba solo shadowea el nombre "Pin" en
# el namespace de ESTE archivo/REPL -- pero si el código del
# usuario (o cualquier librería de terceros) hace de nuevo
# "from machine import Pin", vuelve a traer el Pin ORIGINAL sin
# _settle(), y entonces:
#   1. Los cambios de pin SÍ llegan a QEMU (gpio_set_level real),
#      así que el LED prende/apaga igual -- por eso "parece" que
#      anda.
#   2. Pero nada espera el "SYNC:" de confirmación -- la REPL
#      nativa vuelve al prompt antes de que llegue, y cuando por
#      fin llega (async, por WebSocket), la REPL lo interpreta
#      como un comando tipeado -> SyntaxError.
#
# Reasignando "machine.Pin" ACÁ, antes de que corra cualquier
# código del usuario, cualquier "from machine import Pin"
# posterior (sin importar cuántas veces, ni si lo hace un HAL de
# componente, ni si lo hace el usuario) siempre trae ESTA clase.
# ─────────────────────────────────────────────────────────────
machine.Pin = Pin


# ─────────────────────────────────────────────────────────────
# machine.PWM genérico -- MISMO MOTIVO que machine.Pin arriba, pero
# para PWM: antes, machine.PWM solo se reemplazaba por una clase
# sintética cuando el HAL de un componente PWM-consciente (buzzer o
# sg90) se cargaba -- si el circuito no tenía ninguno de los dos
# (ej. código propio del usuario haciendo PWM(Pin(N), freq=..., ...)
# para atenuar un LED, sin ningún buzzer/servo en el canvas),
# machine.PWM seguía siendo el PWM/LEDC REAL de QEMU.
#
# CONFIRMADO EN LA PRÁCTICA (2026-08-01, reportado por el usuario):
# esa build real tira "ValueError: invalid pin" para GPIO2 y GPIO4
# (no son casos aislados como se pensaba con GPIO26 -- ver el mismo
# diagnóstico en sg90.hal.py -- es la clase de PWM real la que está
# rota en esta build, no un pin puntual).
#
# Mismo protocolo "PWM:<gpio>:<freq>:<duty>\n" que ya usaba
# buzzer.hal.py -- si no hay ningún componente que lo consuma
# (SignalEngine.setPwmState/evaluateAll), es un no-op silencioso del
# lado del navegador, exactamente como un PWM real sin nada
# físicamente conectado. Si buzzer.hal.py o sg90.hal.py se cargan
# DESPUÉS (on-demand, según el canvas), su propio "machine.PWM = PWM"
# pisa esta versión genérica con la suya más específica -- mismo
# criterio de "el último HAL que se carga gana" ya documentado para
# PWM (ver el comentario grande en buzzer.hal.py).
# ─────────────────────────────────────────────────────────────
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


machine.PWM = PWM