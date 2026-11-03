# =============================================================
# PitSimulator — ir_tx FALSO para el runtime WASM (navegador)
#
# La librería real (components_wasm/libs/bundle.json, clave "ir_tx",
# de Peter Hinch) genera la portadora de 38KHz de verdad usando
# esp32.RMT (el periférico Remote Control Module) -- "from esp32
# import RMT" en el import de nivel de módulo, condicionado a que
# sys.platform sea "esp32". Este build de MicroPython-WASM no
# reporta esa plataforma (ni "rp2"), así que cae al branch de
# Pyboard ("from pyb import Pin, Timer") -- BUG REAL confirmado en
# vivo: "from ir_tx import NEC" tiraba
# "ImportError: no module named 'pyb'" apenas se importaba, con
# cualquier módulo KY-005 en el lienzo.
#
# Mismo criterio que _ir_rx_wasm.py (incluso el motivo: reproducir
# el protocolo NEC real pulso a pulso con microsegundos de precisión
# es inviable con la latencia de este simulador): reemplaza "ir_tx"
# ENTERO por una versión que expone la MISMA API pública
# (NEC(pin, freq=, verbose=), .transmit(addr, data, toggle=0,
# validate=False)) pero que, en vez de generar pulsos reales, avisa
# por protocolo "IRTX:<addr>:<data>" -- WasmBridge.js lo recibe y
# llama SignalEngine.broadcastIrCode(addr, data), el MISMO camino
# que ya usa el control remoto virtual (IrRemotePanel.js) para
# avisarle a cualquier KY-022 bien cableado y alimentado del lienzo.
# Un control remoto real es broadcast -- no hay "emparejamiento" con
# un receptor puntual, así que no hace falta resolver a qué GPIO
# está cableado el KY-005 para nada de esto.
# =============================================================

import sys


class NEC:
    def __init__(self, pin, freq=38000, verbose=False):
        pass

    def transmit(self, addr, data, toggle=0, validate=False):
        sys.stdout.write("IRTX:%d:%d\n" % (addr, data))

    def repeat(self):
        pass

    def busy(self):
        return False


class _FakeIrTxModule:
    pass


# Mismo motivo que _ir_rx_wasm.py/_bluetooth_wasm.py -- type(sys)("ir_tx")
# (el truco estándar de CPython para fabricar un módulo) tira
# "TypeError: can't create 'module' instances" en este build.
_fake_ir_tx = _FakeIrTxModule()
_fake_ir_tx.NEC = NEC
sys.modules["ir_tx"] = _fake_ir_tx
