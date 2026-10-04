# =============================================================
# PitSimulator — BLE simulado para el runtime WASM (plan
# ESP-NOW→WiFi→BLE, última fase)
#
# API confirmada contra el ejemplo OFICIAL de MicroPython (no
# inventada) antes de escribir esto:
#   https://github.com/micropython/micropython/blob/v1.28.0/examples/bluetooth/ble_simple_peripheral.py
#   https://github.com/micropython/micropython/blob/v1.28.0/examples/bluetooth/ble_advertising.py
# Ese segundo archivo (el helper advertising_payload()/decode_name()
# que casi todo tutorial de BLE importa con
# "from ble_advertising import advertising_payload") viene agregado
# TAL CUAL a components_wasm/libs/bundle.json -- no es parte de este
# módulo, el alumno lo importa igual que en un ESP32 real.
#
# A diferencia de WiFi (Fase anterior, con internet real de por
# medio), acá NO hay ningún navegador/teléfono real con el que
# emparejarse -- Bluetooth de verdad no es algo a lo que una pestaña
# de navegador pueda conectarse (no hay radio). El "teléfono virtual"
# (ver js/ui/BlePanel.js) es un panel DENTRO de la propia app, con
# pinta de Serial Bluetooth Terminal, que actúa de "central" simulado
# -- useEffect 100% dentro del navegador, igual que ESP-NOW entre dos
# ESP32.
#
# Alcance de esta fase: solo el patrón "UART por BLE" (Nordic UART
# Service, NUS) -- es el mismo que usa CASI todo tutorial de ESP32+BLE
# (incluido el ejemplo oficial de arriba) y es lo único que Serial
# Bluetooth Terminal autodetecta de verdad (así es como esa app
# decide "este dispositivo tiene una consola por BLE"). Otros
# servicios GATT custom se registran igual (gatts_register_services
# no los rechaza), pero el panel del teléfono virtual solo "ve" los
# que matchean el UUID de NUS.
#
# Protocolo con JS (WasmBridge.js):
#   BLE_ADV:<nombre hex>
#     -- lo manda gap_advertise() cuando el payload incluye el UUID
#     de NUS (ahí es cuando Serial Bluetooth Terminal "lo vería").
#   BLE_NOTIFY:<hex>
#     -- lo manda gatts_notify() cuando el handle es el de TX de NUS.
#   BLE_CONNECT: / BLE_DISCONNECT: / BLE_WRITE:<hex>
#     -- los manda BlePanel.js de vuelta (el alumno tocó "Conectar"/
#     "Desconectar"/"Enviar" en el teléfono virtual), por el mismo
#     mecanismo process_line()/register_line_handler() que ya usa
#     ESPNOW_RX -- bajo volumen (acciones puntuales del usuario, no
#     un sondeo en loop como HTTP), mismo patrón ya probado seguro.
# =============================================================

import sys


def _hex_to_bytes(h):
    return bytes(int(h[i:i + 2], 16) for i in range(0, len(h), 2))


# BUG REAL encontrado en vivo probando BLEUART (ver
# components_wasm/libs/bundle.json): gatts_notify()/gatts_write() en
# hardware real aceptan tanto str como bytes para el payload (la capa
# C lo codifica solo) -- bytes(un_str) de MicroPython, a diferencia de
# eso, EXIGE un encoding explícito y revienta con "TypeError: string
# argument without an encoding" apenas alguien manda write("texto")
# en vez de write(b"texto") (un error de tipeo MUY común, el propio
# ejemplo oficial lo hace bien pero cualquier código de alumno puede
# no hacerlo). Esto replica la tolerancia del hardware real en vez de
# la estrictez de bytes() a secas.
def _to_bytes(data):
    if isinstance(data, str):
        return data.encode("utf-8")
    return bytes(data)


def _bytes_to_hex(b):
    return "".join("%02x" % x for x in b)


# ====================================================
# UUID -- no necesita ser byte-exacta a como lo haría un stack BLE
# real (acá no hay ningún stack real del otro lado leyéndola) --
# alcanza con algo determinístico, comparable, y único por valor.
# ====================================================

class UUID:

    def __init__(self, value):
        if isinstance(value, int):
            self._key = "0x%04X" % value
        elif isinstance(value, (bytes, bytearray)):
            self._key = "".join("%02X" % b for b in value)
        else:
            self._key = str(value).upper()

    def __eq__(self, other):
        return isinstance(other, UUID) and self._key == other._key

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash(self._key)

    # BUG REAL encontrado en vivo: a diferencia de CPython,
    # bytes(obj) en MicroPython NO respeta __bytes__ -- necesita que
    # obj sea ITERABLE de enteros (como una lista o un bytes ya
    # existente). ble_advertising.advertising_payload() (ver
    # components_wasm/libs/bundle.json) hace bytes(uuid) para armar
    # el payload de anuncio -- sin esto tira "TypeError: 'UUID'
    # object isn't iterable" apenas el alumno llama gap_advertise()
    # con servicios.
    def __iter__(self):
        return iter(self._key.encode())

    def __repr__(self):
        return "UUID('%s')" % self._key


FLAG_READ = 0x0002
FLAG_WRITE_NO_RESPONSE = 0x0004
FLAG_WRITE = 0x0008
FLAG_NOTIFY = 0x0010
FLAG_INDICATE = 0x0020

# Nordic UART Service -- mismos UUIDs que el ejemplo oficial (ver
# comentario grande arriba). Serial Bluetooth Terminal (y cualquier
# app similar) los reconoce EXACTO así, por eso el panel del teléfono
# virtual también los busca tal cual.
_NUS_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
_NUS_RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
_NUS_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"


_handle_counter = 0
_gatts_values = {}  # handle -> bytes
_ble_singleton = None


class BLE:

    # Singleton real -- bluetooth.BLE() en hardware real también
    # devuelve siempre la misma instancia subyacente del radio.
    def __new__(cls):
        global _ble_singleton
        if _ble_singleton is None:
            self = super().__new__(cls)
            self._active = False
            self._irq_handler = None
            self._connections = set()
            self._char_meta = {}  # handle -> (service_uuid, char_uuid, flags)
            self._nus_rx_handle = None
            self._nus_tx_handle = None
            _ble_singleton = self
        return _ble_singleton

    def active(self, flag=None):
        if flag is None:
            return self._active
        self._active = bool(flag)

    def irq(self, handler):
        self._irq_handler = handler

    def config(self, *args, **kwargs):
        if args and args[0] == "mac":
            return _hex_to_bytes(globals().get("_pit_esp32_mac_hex") or "000000000000")
        return None

    def gatts_register_services(self, services):
        global _handle_counter

        result = []
        for service_uuid, chars in services:
            char_handles = []
            for char_uuid, flags in chars:
                _handle_counter += 1
                handle = _handle_counter
                _gatts_values[handle] = b""
                self._char_meta[handle] = (service_uuid, char_uuid, flags)

                # Autodetección de NUS (ver comentario grande arriba) --
                # mismo criterio que usa Serial Bluetooth Terminal de
                # verdad para decidir "este dispositivo tiene consola".
                if service_uuid == UUID(_NUS_SERVICE_UUID):
                    if char_uuid == UUID(_NUS_RX_UUID):
                        self._nus_rx_handle = handle
                    elif char_uuid == UUID(_NUS_TX_UUID):
                        self._nus_tx_handle = handle

                char_handles.append(handle)
            result.append(tuple(char_handles))

        return tuple(result)

    def gatts_read(self, handle):
        return _gatts_values.get(handle, b"")

    def gatts_write(self, handle, data):
        _gatts_values[handle] = _to_bytes(data)

    # Real: fija el tamaño máximo del buffer de un characteristic y si
    # los writes se ACUMULAN (append=True) o reemplazan -- acá no hay
    # ningún límite real de memoria que imponer (un bytearray de
    # Python crece solo), así que es un no-op a propósito. Varias
    # librerías de alto nivel sobre "bluetooth" (ej. BLEUART del
    # ejemplo oficial, ver components_wasm/libs/bundle.json) lo llaman
    # siempre en su __init__ -- sin este método, ni arrancan
    # (AttributeError).
    def gatts_set_buffer(self, handle, length, append=False):
        pass

    def gatts_notify(self, conn_handle, handle, data=None):
        if data is None:
            data = _gatts_values.get(handle, b"")
        else:
            data = _to_bytes(data)
            _gatts_values[handle] = data

        # Solo el TX de NUS llega al teléfono virtual -- ver
        # "Alcance de esta fase" arriba.
        if handle == self._nus_tx_handle:
            sys.stdout.write("BLE_NOTIFY:%s\n" % _bytes_to_hex(data))

    def gap_advertise(self, interval_us, adv_data=None, resp_data=None, connectable=True):
        if adv_data and self._nus_tx_handle is not None and self._nus_rx_handle is not None:
            # decode_name() viene del MISMO ble_advertising.py real
            # que el alumno ya importó para construir adv_data -- ver
            # components_wasm/libs/bundle.json.
            try:
                from ble_advertising import decode_name
                name = decode_name(adv_data) or "ESP32"
            except Exception:
                name = "ESP32"
            sys.stdout.write("BLE_ADV:%s\n" % _bytes_to_hex(name.encode("utf-8")))

    def gap_disconnect(self, conn_handle):
        if conn_handle in self._connections:
            self._connections.discard(conn_handle)
            if self._irq_handler:
                self._irq_handler(2, (conn_handle, 0, b""))  # _IRQ_CENTRAL_DISCONNECT
        return True


# ====================================================
# Simulación de acciones del teléfono virtual -- ver register_line_handler
# más abajo. conn_handle fijo en 1 (un solo "teléfono" conectado a la
# vez, alcanza para la demo).
# ====================================================

def _on_ble_connect_line(parts):
    ble = _ble_singleton
    if ble is None or not ble._active:
        return
    ble._connections.add(1)
    if ble._irq_handler:
        ble._irq_handler(1, (1, 0, b""))  # _IRQ_CENTRAL_CONNECT


def _on_ble_disconnect_line(parts):
    ble = _ble_singleton
    if ble is None:
        return
    ble._connections.discard(1)
    if ble._irq_handler:
        ble._irq_handler(2, (1, 0, b""))  # _IRQ_CENTRAL_DISCONNECT


def _on_ble_write_line(parts):
    # parts = ["BLE_WRITE", "<hex>"]
    ble = _ble_singleton
    if ble is None or ble._nus_rx_handle is None or len(parts) < 2:
        return
    try:
        data = _hex_to_bytes(parts[1])
    except ValueError:
        return
    _gatts_values[ble._nus_rx_handle] = data
    if ble._irq_handler:
        ble._irq_handler(3, (1, ble._nus_rx_handle))  # _IRQ_GATTS_WRITE


register_line_handler("BLE_CONNECT:", _on_ble_connect_line)
register_line_handler("BLE_DISCONNECT:", _on_ble_disconnect_line)
register_line_handler("BLE_WRITE:", _on_ble_write_line)


class _FakeBluetoothModule:
    pass


if "bluetooth" not in sys.modules:
    sys.modules["bluetooth"] = _FakeBluetoothModule()

bluetooth = sys.modules["bluetooth"]
bluetooth.BLE = BLE
bluetooth.UUID = UUID
bluetooth.FLAG_READ = FLAG_READ
bluetooth.FLAG_WRITE_NO_RESPONSE = FLAG_WRITE_NO_RESPONSE
bluetooth.FLAG_WRITE = FLAG_WRITE
bluetooth.FLAG_NOTIFY = FLAG_NOTIFY
bluetooth.FLAG_INDICATE = FLAG_INDICATE

# "ubluetooth" (nombre viejo, todavía circula en tutoriales) -- mismo
# criterio que "urequests"/"requests" en _requests_wasm.py.
sys.modules["ubluetooth"] = bluetooth
