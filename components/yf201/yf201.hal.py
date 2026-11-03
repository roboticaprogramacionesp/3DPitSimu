# =============================================================
# PitSimulator — HAL YF-S201 (sensor de flujo de agua)
# No necesita ninguna clase/módulo propio -- el código del alumno
# cuenta pulsos con machine.Pin(...).irq(...) directo (Pin.IRQ ya
# existe en _base_wasm.py, es el mismo mecanismo que usa un botón o
# un encoder rotativo), nada que reemplazar acá.
#
# Los pulsos en sí los genera SignalEngine._restartYf201Pulse()
# (arranca/para sola según component.properties.flujo_lmin -- el
# slider "Caudal simulado" del panel de propiedades, ver
# yf201.behavior.js), con la fórmula real del datasheet:
#   frecuencia (Hz) = 7.5 × caudal (L/min)
# mandados como "IN:<gpio>:1"/"IN:<gpio>:0" alternados -- mismo
# protocolo que ya usa cualquier botón (ver WasmBridge.GPIO_IN_RE),
# nada nuevo del lado del firmware.
#
# Este archivo existe solo como marcador, igual que gps.hal.py/
# led.hal.py.
# =============================================================
