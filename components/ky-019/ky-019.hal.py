# =============================================================
# PitSimulator — HAL KY-019 (relevador 5V)
# No necesita ninguna lógica propia: "S" es una entrada digital
# común y corriente, ya cubierta por el Pin genérico de
# _base.hal.py (Pin(x, Pin.OUT)/Pin(x, Pin.IN)) -- este componente
# no tiene protocolo propio con el firmware. El lado NC/COM/NO es
# continuidad real resuelta enteramente del lado del navegador (ver
# SignalEngine.getNet()/isKeyConnectedToPower()/isKeyConnectedToGnd(),
# y ky-019.behavior.js).
# Este archivo existe solo como marcador, igual que
# battery_18650.hal.py/led.hal.py -- sin él, ReplPanel._loadHal()
# igual hace el fetch de "ky-019.hal.py" y el 404 queda logueado por
# el navegador (no se puede suprimir desde JS).
# =============================================================
