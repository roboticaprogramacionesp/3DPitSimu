# =============================================================
# PitSimulator — HAL Base
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
    global _stdin_buf, _pin_input_states, _sync_pending

    poller = _get_poller()

    try:
        # poll(0) = no bloquear, solo preguntar "¿hay algo YA
        # disponible?". Si hay varios bytes en cola, este while los
        # va drenando de a uno hasta que no quede nada listo.
        while poller.poll(0):

            ch = sys.stdin.read(1)
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
                        # OJO: comparar y disparar el IRQ ANTES de
                        # pisar _pin_input_states, y hacerlo ACÁ
                        # ADENTRO del for de líneas (no una sola vez
                        # al final de poll_input()) -- si llegaron
                        # varias líneas "IN:" juntas para el mismo
                        # gpio (ej. los 3 pasos de cuadratura de un
                        # encoder mandados casi seguidos), cada
                        # transición individual dispara su propio
                        # IRQ, no solo la última.
                        _maybe_fire_irq(gpio, _pin_input_states.get(gpio), value)
                        _pin_input_states[gpio] = value
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
            _settle()

    def off(self):
        super().off()
        if self._last_val != 0:
            self._last_val = 0
            # Ver nota en on() -- mismo motivo, no imprimir "GPIO:{}:0\n" acá.
            _settle()

    def value(self, v=None):
        if v is None:
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