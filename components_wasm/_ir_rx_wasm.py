# =============================================================
# PitSimulator — ir_rx FALSO para el runtime WASM (navegador)
#
# El protocolo IR real (NEC) se decodifica a partir de los tiempos
# EXACTOS entre flancos (microsegundos) -- ver la librería real
# (components_wasm/libs/bundle.json, clave "ir_rx", de Peter Hinch):
# Pin.irq() + un machine.Timer registran cada flanco con ticks_us() y
# arman el dato a partir de esos intervalos. Reproducir eso de verdad
# acá implicaría mandar 68 eventos de GPIO con una precisión de
# microsegundos real entre cada uno -- inviable con la latencia de
# postMessage()/Asyncify de este simulador (ver _pit_dispatch_irqs()
# en _base_wasm.py: el replay de eventos no preserva tiempo real
# entre ellos, están pensados para flancos sueltos tipo botón/
# encoder, no para timing de protocolo).
#
# En vez de simular los pulsos, este módulo reemplaza ir_rx ENTERO
# (igual criterio que _dht_wasm.py/_neopixel_wasm.py con sus
# librerías reales) con una versión que expone la MISMA API pública
# (IR_RX/NEC_8/NEC_16, mismo constructor (pin, callback, *args),
# mismo callback(data, addr, ctrl)) pero that el "control remoto
# virtual" (ver IrRemotePanel.js) dispara directo por protocolo
# "IRRX:<gpio>:<addr>:<cmd>\n" -- el código del alumno que ya usa
# ir_rx normal no necesita cambiar nada.
# =============================================================

import sys

_ir_receivers = {}  # gpio_num (int) -> instancia NEC_8/NEC_16


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


class IR_RX:
    # Mismos códigos de error que la librería real (ver bundle.json) --
    # ninguno se usa hoy (el control virtual siempre manda un botón
    # válido), pero quedan expuestos por si algún código de alumno los
    # importa/compara.
    REPEAT = -1
    BADSTART = -2
    BADBLOCK = -3
    BADREP = -4
    OVERRUN = -5
    BADDATA = -6
    BADADDR = -7

    def __init__(self, pin, callback, *args):
        self._gpio = _gpio_num(pin)
        self.callback = callback
        self.args = args
        if self._gpio is not None:
            _ir_receivers[self._gpio] = self

    def close(self):
        if self._gpio is not None:
            _ir_receivers.pop(self._gpio, None)


# NEC_8/NEC_16 (direccion de 8 o 16 bits) -- en esta version simulada
# no hay ninguna diferencia real entre las dos (el "control remoto
# virtual" ya manda addr/cmd como enteros, sin reconstruirlos a partir
# de bits), se mantienen como clases separadas solo para que
# "from ir_rx import NEC_8, NEC_16" (lo que genera el bloque de
# Blockly) siga funcionando tal cual.
class NEC_8(IR_RX):
    pass


class NEC_16(IR_RX):
    pass


def _on_irrx_line(parts):
    # parts = ["IRRX", "<gpio>", "<addr>", "<cmd>"]
    if len(parts) < 4:
        return
    try:
        gpio = int(parts[1])
        addr = int(parts[2])
        cmd = int(parts[3])
    except ValueError:
        return
    recv = _ir_receivers.get(gpio)
    if recv is None:
        return
    try:
        recv.callback(cmd, addr, 0, *recv.args)
    except Exception as e:
        sys.print_exception(e)


register_line_handler("IRRX:", _on_irrx_line)

class _FakeIrRxModule:
    pass


# BUG REAL encontrado en vivo: type(sys)("ir_rx") (el truco estándar
# de CPython para crear un módulo nuevo) tira "TypeError: can't
# create 'module' instances" en este build de MicroPython -- mismo
# motivo por el que _bluetooth_wasm.py ya usa una clase vacía en vez
# de eso para fabricar "bluetooth"/"ubluetooth".
_fake_ir_rx = _FakeIrRxModule()
_fake_ir_rx.IR_RX = IR_RX
_fake_ir_rx.NEC_8 = NEC_8
_fake_ir_rx.NEC_16 = NEC_16
sys.modules["ir_rx"] = _fake_ir_rx
