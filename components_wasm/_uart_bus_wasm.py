# =============================================================
# PitSimulator — Bus UART compartido para el runtime WASM (navegador)
#
# Port directo de components/_uart_bus/_uart_bus.hal.py (ver ese
# archivo para el historial completo del protocolo "UART:"/
# "UARTTX:") -- FALTABA ENTERO en este runtime: wasmWorker.js solo
# cargaba _base_wasm.py/_i2c_bus_wasm.py/_adc_bus_wasm.py al arrancar
# el Worker, nunca un equivalente de este archivo. BUG REAL
# encontrado en vivo armando el HC-06 (Bluetooth clásico/SPP, ver
# BlePanel.js): "from machine import UART" tiraba
# "ImportError: can't import name UART" apenas se lo probaba de
# punta a punta -- machine.UART JAMÁS se reemplazaba en modo
# navegador (el único runtime real de este proyecto, ver CLAUDE.md/
# memoria: "WASM por defecto"), así que el GPS tampoco podía haber
# funcionado nunca con código de usuario real (solo se había probado
# empujando propiedades desde el panel, nunca corriendo
# machine.UART(...) de verdad en WASM).
#
# Se inyecta UNA sola vez al iniciar el Worker, junto con
# _base_wasm.py/_i2c_bus_wasm.py/_adc_bus_wasm.py, siempre ANTES que
# cualquier código de usuario que dependa de machine.UART (GPS, o
# ahora HC-06).
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
    # si el texto tuviera algún ":" suelto.
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


# register_line_handler/poll_input los define _base_wasm.py como
# funciones de módulo -- se inyecta siempre antes que este archivo.
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
    # "_pin_num" es el atributo REAL que usa la Pin de _base_wasm.py
    # (mismo criterio que _adc_bus_wasm.py -- ver el comentario ahí).
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
    hacia el teléfono virtual).
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
        # Ver _adc_bus_wasm.py/_pit_uart_bus.py para el mismo bug real
        # de MicroPython (del sobre slice de bytearray no soportado) --
        # asignación de slice sí, mismo fix.
        buf[:] = buf[n:]
        return data

    def readline(self):
        poll_input()
        buf = _uart_buf(self._id)
        idx = buf.find(b"\n")
        if idx == -1:
            return None
        data = bytes(buf[: idx + 1])
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
