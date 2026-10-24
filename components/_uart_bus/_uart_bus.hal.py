# =============================================================
# PitSimulator — Bus UART compartido (dummy)
#
# Se inyecta UNA sola vez (junto con _base_hal.py/_i2c_bus.py/
# _adc_bus.py, ver ReplPanel.ALWAYS_HAL_TYPES), siempre ANTES que
# cualquier hal.py de componente que dependa de machine.UART (por
# ahora, GPS -- primer periférico UART de este proyecto).
#
# ── Por qué existe este archivo ─────────────────────────────────
# Mismo criterio que _i2c_bus.py/_adc_bus.py: UN solo reemplazo de
# machine.UART, sin importar cuántos componentes UART haya en el
# canvas.
#
# ── Direccionamiento: PININFO, no topología de cables ───────────
# A diferencia de I2C (que se resuelve por DIRECCIÓN) o GPIO (que se
# resuelve por NÚMERO DE PIN), acá el "id" de UART (UART(1)/UART(2))
# es una elección de SOFTWARE del código del usuario -- no hay forma
# de saber de antemano qué id le va a tocar a qué GPIO con solo mirar
# el cableado del canvas. Por eso, igual que ya hace
# _declare_i2c_pins() en _i2c_bus.py, el constructor manda
# "PININFO:uart:<id>:rx=<gpio>,tx=<gpio>\n" UNA vez por id -- el lado
# JS (SignalEngine._findGpsUartId) cruza esto con el cable real
# dibujado desde el TX del GPS hasta encontrar a qué id corresponde
# antes de mandar cualquier "UART:<id>:...".
#
# ── Protocolo "UART:" (navegador -> firmware) ────────────────────
# El navegador manda "UART:<id>:<texto SIN saltos de línea>\n" (ej.
# una oración NMEA completa, sin su propio \r\n -- lo agrega este
# archivo al guardarla en el buffer de entrada) -- ver
# gps.hal.py/SignalEngine._notifyGpsToFirmware. Se acumula en un
# buffer de bytes por id, que any()/read()/readline() drenan.
#
# ── Protocolo "UARTTX:" (firmware -> navegador) ──────────────────
# Agregado para el HC-06 (Bluetooth clásico/SPP, ver hc-06.behavior.js
# y SignalEngine._findHc06ByUartTx): a diferencia del GPS (que solo
# TRANSMITE hacia el ESP32), un módulo Bluetooth clásico es
# bidireccional -- lo que el firmware escribe con uart.write() tiene
# que llegarle al "teléfono virtual" (ver BlePanel.js, que ahora
# también atiende HC-06 además de BLE). write() manda
# "UARTTX:<id>:<hex>\n" -- mismo criterio de codificación hex que
# BLE_NOTIFY (ver components_wasm/_bluetooth_wasm.py) para no
# depender de que el payload sea texto válido.
# =============================================================

import sys as _sys

_uart_buffers = {}          # uart_id (int) -> bytearray
_uart_pininfo_declared = set()


def _uart_to_bytes(data):
    if isinstance(data, str):
        return data.encode("utf-8")
    return bytes(data)


def _uart_bytes_to_hex(b):
    return "".join("%02x" % x for x in b)


def _uart_buf(uart_id):
    return _uart_buffers.setdefault(uart_id, bytearray())


def _on_uart_line(parts):
    # parts = ["UART", "<id>", "<texto...>"] -- se re-une con ":" por
    # si el texto tuviera algún ":" suelto (NMEA no debería, pero no
    # cuesta nada ser robusto acá igual que en otros protocolos de
    # este proyecto).
    if len(parts) < 3:
        return
    try:
        uart_id = int(parts[1])
    except ValueError:
        return
    text = ":".join(parts[2:])
    buf = _uart_buf(uart_id)
    buf.extend(text.encode("utf-8"))
    buf.extend(b"\r\n")


register_line_handler("UART:", _on_uart_line)


def _declare_uart_pins(uart_id, tx_num, rx_num):
    if uart_id in _uart_pininfo_declared:
        return
    _uart_pininfo_declared.add(uart_id)
    parts = []
    if rx_num is not None:
        parts.append("rx=%d" % rx_num)
    if tx_num is not None:
        parts.append("tx=%d" % tx_num)
    if parts:
        _sys.stdout.write("PININFO:uart:%d:%s\n" % (uart_id, ",".join(parts)))


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


class UART:
    """
    Reemplazo sintético de machine.UART -- read()/readline()/any()
    devuelven lo que haya en el buffer de entrada (navegador ->
    firmware, ej. NMEA del GPS); write() manda lo escrito hacia el
    navegador (firmware -> navegador, ej. respuestas de un HC-06
    hacia el teléfono virtual) -- ver docstring del módulo.
    """

    def __init__(self, id, baudrate=9600, tx=None, rx=None, *a, **kw):
        try:
            self._id = int(id)
        except (TypeError, ValueError):
            self._id = 0
        _declare_uart_pins(self._id, _gpio_num(tx), _gpio_num(rx))

    def init(self, baudrate=9600, *a, **kw):
        pass

    def deinit(self):
        pass

    def any(self):
        poll_input()
        return len(_uart_buf(self._id))

    def read(self, nbytes=None):
        poll_input()
        buf = _uart_buf(self._id)
        if not buf:
            return None
        n = len(buf) if nbytes is None else min(nbytes, len(buf))
        data = bytes(buf[:n])
        # BUG REAL (reportado con el GPS/micropyGPS.py: "TypeError:
        # 'bytearray' object doesn't support item deletion"): a
        # diferencia de CPython, esta build de MicroPython no
        # implementa "del buf[:n]" (borrado de slice) sobre
        # bytearray. Asignación de slice ("buf[:] = ...") sí está
        # soportada -- reemplaza el contenido completo del MISMO
        # objeto (no crea uno nuevo), así que sigue siendo el mismo
        # bytearray que _uart_buffers[id] tiene guardado.
        buf[:] = buf[n:]
        return data

    def readline(self):
        poll_input()
        buf = _uart_buf(self._id)
        idx = buf.find(b"\n")
        if idx == -1:
            return None
        data = bytes(buf[: idx + 1])
        # Ver la nota en read() -- mismo motivo, misma solución.
        buf[:] = buf[idx + 1:]
        return data

    def readinto(self, b, nbytes=None):
        data = self.read(len(b) if nbytes is None else nbytes)
        if data is None:
            return None
        for i in range(len(data)):
            b[i] = data[i]
        return len(data)

    def write(self, buf):
        if not buf:
            return 0
        data = _uart_to_bytes(buf)
        _sys.stdout.write("UARTTX:%d:%s\n" % (self._id, _uart_bytes_to_hex(data)))
        return len(data)


import machine as _machine_module
_machine_module.UART = UART
