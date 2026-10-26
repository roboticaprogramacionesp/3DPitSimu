# =============================================================
# PitSimulator — HAL INMP441 (Micrófono digital I2S)
#
# Implementa machine.I2S en modo LECTURA (RX) -- el audio real viene
# del micrófono físico de la PC del alumno (ver MicCapture.js), NO de
# un valor sintético como el slider del KY-001. Protocolo:
#
#   SALIDA (firmware→navegador), una sola vez al construir I2S(...)
#   en modo RX:
#     MICREQ:<gpio del pin "sd">:<rate>
#   -- dispara que MicCapture.js pida permiso de micrófono y empiece
#   a mandar audio real para ESE gpio.
#
#   ENTRADA (navegador→firmware), repetida mientras el micrófono está
#   activo:
#     MIC:<gpio>:<PCM16 mono en hex, little-endian>
#   -- se acumula en un buffer circular por gpio; readinto() drena de
#   ahí.
#
# Uso en código del usuario (idéntico a MicroPython real):
#   from machine import I2S, Pin
#   audio_in = I2S(0, sck=Pin(14), ws=Pin(15), sd=Pin(32),
#                  mode=I2S.RX, bits=16, format=I2S.MONO,
#                  rate=16000, ibuf=20000)
#   buf = bytearray(1024)
#   n = audio_in.readinto(buf)
#
# OJO -- no hay forma de "bloquear de verdad" acá (ver la limitación
# documentada en _base_wasm.py: nada puede ceder el control a mitad
# de una llamada síncrona, solo adentro de sleep()). Mientras el
# micrófono real todavía no mandó suficientes bytes para esta
# readinto(), se rellena el resto con silencio (ceros) en vez de
# colgar el intérprete -- igual que una DMA real que no llegó a
# tiempo, pero sin trabar nada.
#
# BUG REAL encontrado probando esto en vivo: el "MIC:" de arriba
# arrancó mandándose por register_line_handler()/process_line() (el
# camino genérico simulador→firmware que SÍ usan GPIO/TEMP/etc.) --
# pero eso dispara un mp.runPython() nuevo por CADA chunk (ver
# wasmWorker.js, mensaje "processLine"), y un chunk de audio llega
# varias veces por segundo (mucho más seguido que un click de botón
# ocasional) -- choca con el mp.runPython() del script principal
# mientras está suspendido en su propio sleep(), con
# "RuntimeError: ... We cannot start an async operation when one is
# already in flight" y el Worker quedando roto después. Mismo bug
# exacto ya documentado para IN:/el teclado matricial (ver
# WasmBridge.GPIO_IN_RE) y para WiFi/requests.get() -- mismo fix:
# "MIC:" ahora viaja por "setGlobal" (WasmBridge.MIC_DATA_RE), que
# solo escribe una variable global sin ejecutar nada nuevo. Acá
# directamente se lee esa cola ("_pit_mic_events") del namespace
# global en vez de depender de ningún callback.
# =============================================================

import sys

_mic_buffers = {}  # gpio (int) -> bytearray acumulado


def _gpio_num(pin_obj):
    if pin_obj is None:
        return None
    if isinstance(pin_obj, int):
        return pin_obj
    for attr in ("_pin_num", "id", "_id", "pin", "_pin", "num", "_num", "gpio", "_gpio"):
        val = getattr(pin_obj, attr, None)
        if isinstance(val, int):
            return val
    try:
        return int(pin_obj)
    except Exception:
        return None


def _pit_drain_mic_events():
    # Formato de "_pit_mic_events" (ver wasmWorker.js, mensaje
    # "setGlobal"): "<gpio>:<hex>|<gpio>:<hex>|..." -- "|" (no "," como
    # la cola de GPIO) porque un hex de audio es mucho más largo y
    # queda más claro separar chunks completos con un carácter propio.
    g = globals()
    events = g.get("_pit_mic_events")
    if not events:
        return
    g["_pit_mic_events"] = ""
    for item in events.split("|"):
        if not item:
            continue
        gpio_str, _, hexchunk = item.partition(":")
        try:
            gpio = int(gpio_str)
            chunk = bytes.fromhex(hexchunk)
        except ValueError:
            continue
        buf = _mic_buffers.get(gpio)
        if buf is None:
            continue
        buf.extend(chunk)
        # Tope -- si el firmware no lee tan rápido como llega el audio
        # real (ej. el alumno hace algo lento entre lecturas), no hace
        # falta acumular para siempre: nos quedamos con lo más
        # reciente, igual criterio que _appendPendingVisibleOutput en
        # WasmBridge.js. "del buf[:n]" (recortar en el lugar) tira
        # TypeError en este build de MicroPython ("bytearray doesn't
        # support item deletion") -- reasignamos la entrada del dict
        # con un bytearray nuevo en vez de mutar en el lugar.
        MAX_BUF = 65536
        if len(buf) > MAX_BUF:
            _mic_buffers[gpio] = bytearray(buf[len(buf) - MAX_BUF:])


class I2S:

    RX = 0
    TX = 1
    MONO = 0
    STEREO = 1

    def __init__(self, id=0, sck=None, ws=None, sd=None, mck=None,
                 mode=0, bits=16, format=0, rate=16000, ibuf=20000):

        self.id = id
        self.mode = mode
        self.bits = bits
        self.format = format
        self.rate = rate

        self._gpio = _gpio_num(sd)

        if mode == I2S.RX and self._gpio is not None:
            _mic_buffers.setdefault(self._gpio, bytearray())
            # Dispara la captura real del micrófono en el navegador --
            # ver WasmBridge._tryParseProtocolLine() rama "MICREQ:".
            print("MICREQ:%d:%d" % (self._gpio, rate))

    def readinto(self, buf):
        n = len(buf)

        _pit_drain_mic_events()

        src = _mic_buffers.get(self._gpio)
        if src is None:
            for i in range(n):
                buf[i] = 0
            return n

        have = min(n, len(src))
        for i in range(have):
            buf[i] = src[i]
        if have:
            # Mismo motivo que en _pit_drain_mic_events: nada de
            # "del src[:have]" en el lugar, reasignamos la entrada del dict.
            _mic_buffers[self._gpio] = bytearray(src[have:])
        # Sin suficiente audio real acumulado todavía (recién arrancó
        # la captura, o el micrófono no mandó a tiempo) -- silencio en
        # vez de colgar esperando, ver el comentario grande del header.
        for i in range(have, n):
            buf[i] = 0

        return n

    def write(self, buf):
        # TX (parlante/DAC por I2S): fuera de alcance -- no hay ningún
        # componente de salida de audio en el catálogo todavía (mismo
        # criterio que machine.DAC: no rompe, pero tampoco tiene
        # efecto visible). Devuelve len(buf) como un write() real.
        return len(buf)

    def deinit(self):
        if self._gpio is not None:
            _mic_buffers.pop(self._gpio, None)


# Mismo motivo que ir_rx/bluetooth: type(sys)("machine") no se puede acá.
# "machine" como módulo YA existe (lo crea _base_wasm.py) -- a
# diferencia de ir_rx/bluetooth (módulos enteros nuevos), acá solo
# hace falta COLGARLE el atributo I2S encima del módulo real que ya
# está en sys.modules, sin pisar Pin/PWM/DAC/Timer/etc. que ya tiene.
_machine = sys.modules.get("machine")
if _machine is not None:
    _machine.I2S = I2S
