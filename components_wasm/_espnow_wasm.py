# =============================================================
# PitSimulator — ESP-NOW + WiFi simulados para el runtime WASM
#
# Módulo falso "network" -- WLAN.config('mac') (ESP-NOW, ver más
# abajo) Y WLAN.connect()/isconnected()/ifconfig()/status() (WiFi,
# ver plan multi-ESP32/ESP-NOW→WiFi→BLE, Fase WiFi: conexión 100%
# simulada -- siempre "funciona", no hay ningún punto de acceso real
# que buscar -- pero las requests HTTP que el alumno haga DESPUÉS de
# "conectarse" SÍ son reales, ver _requests_wasm.py) y "espnow"
# (clase ESPNow) -- API confirmada contra la documentación oficial de
# MicroPython antes de escribir esto (ver decisión de diseño #4 del
# plan ESP-NOW):
#   https://docs.micropython.org/en/v1.25.0/library/espnow.html
#   https://docs.micropython.org/en/v1.28.0/library/network.WLAN.html
#
# Protocolo con JS (WasmBridge.js <-> EspNowBus.js):
#   ESPNOW_TX:<mac hex SIN ":", 12 chars>:<payload en hex>
#     -- lo manda ESPNow.send() de acá abajo. WasmBridge.js lo parsea
#     y se lo pasa a Simulator.espNowBus.send(), que decide a qué
#     otro(s) ESP32 del lienzo les llega según su MAC.
#   ESPNOW_RX:<mac hex del QUE MANDÓ>:<payload en hex>
#     -- lo manda EspNowBus.js de vuelta, por el mismo mecanismo
#     process_line()/register_line_handler() que ya usan GPIO/I2C/etc
#     (ver _base_wasm.py) -- SÍ puede llegar en vivo mientras un
#     while True: con sleep() sigue corriendo, igual que cualquier
#     otro protocolo simulador→firmware ya soportado.
#
# Formato sin ":" en el hex (a diferencia de "AA:BB:CC:DD:EE:FF", el
# formato que usa esp32_wroom.behavior.js para mostrar la MAC) a
# propósito: el protocolo de texto de este simulador ya usa ":" como
# separador de campos (ver _tryParseProtocolLine en WasmBridge.js) --
# una MAC con ":" adentro rompería ese split.
#
# La MAC propia de ESTE ESP32 llega como variable global
# "_pit_esp32_mac_hex" (string hex de 12 chars, sin ":"), inyectada
# por wasmWorker.js vía mp.globals.set() ANTES de correr este archivo
# (ver su mensaje "init" -- toma esp32Component.properties.macAddress,
# generada una vez por esp32_wroom.behavior.js al agregar el
# componente al lienzo).
# =============================================================

import sys
import time


def _hex_to_bytes(h):
    return bytes(int(h[i:i + 2], 16) for i in range(0, len(h), 2))


def _bytes_to_hex(b):
    return "".join("%02x" % x for x in b)


_own_mac_hex = globals().get("_pit_esp32_mac_hex") or "000000000000"
_own_mac = _hex_to_bytes(_own_mac_hex)


# ====================================================
# network (solo lo que un script de ESP-NOW necesita)
# ====================================================

# IP simulada, DERIVADA de la propia MAC (no de un módulo random --
# ver decisión de no depender de "urandom"/"random" sin confirmar
# antes si este build los tiene compilados, mismo criterio cauteloso
# que ya se usó con "socket"/"ubinascii" en esta fase): determinística
# por dispositivo, así el mismo ESP32 siempre "recibe" la misma IP
# dentro de una sesión del navegador, sin depender de nada más.
_fake_ip = "192.168.1.%d" % (_own_mac[-1] if _own_mac[-1] not in (0, 255) else 100)

# Constantes de estado -- mismos nombres que la API real (ver
# docs.micropython.org/en/v1.28.0/library/network.WLAN.html, sección
# "Constants"), aunque acá solo se usan dos de los seis (conexión
# 100% simulada: SIEMPRE "funciona", no hay AP real que pueda
# rechazar la contraseña o no contestar -- los demás quedan
# declarados para que una comparación como
# "wlan.status() == network.STAT_WRONG_PASSWORD" no reviente con
# AttributeError, simplemente nunca va a dar True).
STAT_IDLE = 0
STAT_CONNECTING = 1
STAT_WRONG_PASSWORD = -3
STAT_NO_AP_FOUND = -2
STAT_CONNECT_FAIL = -1
STAT_GOT_IP = 3


class WLAN:

    IF_STA = 0
    IF_AP = 1

    def __init__(self, interface_id=IF_STA):
        self._active = False
        self._connected = False
        self._ssid = None
        self._ifconfig = ("0.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0")

    def active(self, is_active=None):
        if is_active is None:
            return self._active
        self._active = bool(is_active)

    def config(self, *args, **kwargs):
        # Real: config('mac') devuelve bytes, config(param=value, ...)
        # para setear -- acá solo se necesita leer la MAC propia, el
        # resto de parámetros (ssid/channel/etc.) no aplica a este
        # modo (no hay radio Wi-Fi real que configurar).
        if args and args[0] == "mac":
            return _own_mac
        return None

    # ---- WiFi (ver plan ESP-NOW→WiFi→BLE, Fase WiFi) ----
    #
    # connect() SIEMPRE "funciona" de una -- no hay ningún punto de
    # acceso real que buscar, así que no tiene sentido simular fallos
    # de contraseña/señal (el objetivo de esta fase es poder probar
    # requests HTTP reales desde el código del alumno, no un algoritmo
    # de asociación WiFi). Un while not wlan.isconnected(): sleep()
    # típico de los tutoriales simplemente nunca da una vuelta -- sigue
    # siendo código válido, solo que no hace falta esperar nada acá.

    def connect(self, ssid=None, key=None, *, bssid=None):
        self._ssid = ssid
        self._connected = True
        self._ifconfig = (_fake_ip, "255.255.255.0", "192.168.1.1", "8.8.8.8")

    def disconnect(self):
        self._connected = False

    def isconnected(self):
        return self._connected

    def status(self, param=None):
        if param is not None:
            # Real: status('rssi') -- señal simulada fija, no hay
            # radio real cuya potencia varíe.
            if param == "rssi":
                return -42
            return None
        return STAT_GOT_IP if self._connected else STAT_IDLE

    def ifconfig(self, config=None):
        if config is not None:
            self._ifconfig = tuple(config)
            return None
        return self._ifconfig


class _FakeNetworkModule:
    pass


# Mismo truco que _base_wasm.py usa para "machine" (ver su comentario
# grande junto a _FakeMachineModule): un objeto cualquiera registrado
# en sys.modules -- el import machinery de Python no distingue esto
# de un módulo real.
if "network" not in sys.modules:
    sys.modules["network"] = _FakeNetworkModule()

network = sys.modules["network"]
network.WLAN = WLAN
network.STA_IF = WLAN.IF_STA
network.AP_IF = WLAN.IF_AP
network.STAT_IDLE = STAT_IDLE
network.STAT_CONNECTING = STAT_CONNECTING
network.STAT_WRONG_PASSWORD = STAT_WRONG_PASSWORD
network.STAT_NO_AP_FOUND = STAT_NO_AP_FOUND
network.STAT_CONNECT_FAIL = STAT_CONNECT_FAIL
network.STAT_GOT_IP = STAT_GOT_IP


# ====================================================
# espnow
# ====================================================

_espnow_rx_queue = []
_espnow_irq_callback = None
_espnow_singleton = None


def _on_espnow_rx_line(parts):
    # parts = ["ESPNOW_RX", "<mac hex>", "<payload hex>"]
    if len(parts) < 3:
        return
    try:
        mac = _hex_to_bytes(parts[1])
        msg = _hex_to_bytes(parts[2])
    except ValueError:
        return
    _espnow_rx_queue.append((mac, msg))
    if _espnow_irq_callback is not None and _espnow_singleton is not None:
        try:
            _espnow_irq_callback(_espnow_singleton)
        except Exception as err:
            sys.stdout.write("\n" + str(err) + "\n")


register_line_handler("ESPNOW_RX:", _on_espnow_rx_line)


class ESPNow:

    MAX_DATA_LEN = 250

    # Singleton real -- "ESPNow() es un objeto singleton, toda llamada
    # devuelve una referencia al mismo objeto" (ver docs oficiales).
    def __new__(cls):
        global _espnow_singleton
        if _espnow_singleton is None:
            self = super().__new__(cls)
            self._active = False
            self._peers = set()
            _espnow_singleton = self
        return _espnow_singleton

    def active(self, flag=None):
        if flag is None:
            return self._active
        self._active = bool(flag)

    def add_peer(self, mac, lmk=b"", channel=0, ifidx=0, encrypt=None):
        self._peers.add(bytes(mac))

    def send(self, mac, msg=None, sync=True):
        # Real (solo ESP32): send(msg) sin mac manda a TODOS los peers
        # ya registrados -- se replica ese mismo caso acá.
        if msg is None:
            msg = mac
            targets = list(self._peers)
        else:
            targets = [bytes(mac)]

        if isinstance(msg, str):
            msg = msg.encode()

        for target in targets:
            sys.stdout.write(
                "ESPNOW_TX:%s:%s\n" % (_bytes_to_hex(target), _bytes_to_hex(bytes(msg)))
            )

        return True

    def recv(self, timeout_ms=None):
        # Real: timeout_ms=0 es "sin esperar" (no bloqueante), <0 es
        # "esperar para siempre", >0 es un límite real en ms. Acá se
        # replica con un sondeo simple (en vez de un wait real del
        # sistema) -- cada vuelta hace time.sleep(), que en este
        # puerto SÍ le devuelve el control a JS (ver mphalport.c del
        # build de micropython.mjs), así que un ESPNOW_RX: que llegue
        # mientras se espera acá SÍ se aplica en vivo, igual que
        # cualquier otro protocolo simulador→firmware. timeout_ms=None
        # (el default de acá) se trata igual que "esperar para
        # siempre", el caso más común en los tutoriales (un
        # while True: recibiendo en loop).
        if _espnow_rx_queue:
            return _espnow_rx_queue.pop(0)

        if timeout_ms == 0:
            return (None, None)

        # BUG REAL encontrado en vivo (ver el mismo ajuste en
        # _requests_wasm.py/request(), causa idéntica): con
        # timeout_ms=None (el default, "esperar para siempre") y
        # ningún peer mandando nada todavía, ESTE sondeo es el caso
        # MÁS expuesto a agotar el ASYNCIFY_STACK_SIZE del binario
        # compilado -- un solo recv() sin nada que recibir podía
        # encadenar sleep() tras sleep() sin ningún límite. 100ms sigue
        # sintiéndose instantáneo para una demo/tutorial (muy por
        # debajo de lo que un alumno nota), pero corta la cantidad de
        # sleep() de este sondeo en 5x.
        poll_ms = 100
        waited = 0
        wait_forever = timeout_ms is None or timeout_ms < 0

        while not _espnow_rx_queue:
            time.sleep(poll_ms / 1000)
            waited += poll_ms
            if not wait_forever and waited >= timeout_ms:
                return (None, None)

        return _espnow_rx_queue.pop(0)

    def irq(self, callback):
        global _espnow_irq_callback
        _espnow_irq_callback = callback

    def __iter__(self):
        # Real: "for mac, msg in e:" es equivalente a e.recv() en loop
        # -- alias simple, cubre ese patrón sin reinventar un iterador
        # real.
        while True:
            yield self.recv()


class _FakeEspnowModule:
    pass


if "espnow" not in sys.modules:
    sys.modules["espnow"] = _FakeEspnowModule()

espnow = sys.modules["espnow"]
espnow.ESPNow = ESPNow
