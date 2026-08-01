# =============================================================
# PitSimulator — HAL Clavija 127V
# No necesita ninguna lógica: es una fuente de alimentación
# puramente pasiva, nunca cableada a ningún GPIO del ESP32 (solo a
# pines de otros componentes, ej. COM de un relevador). El firmware
# nunca la ve ni le manda ni le lee nada -- si hay continuidad real
# de alimentación se resuelve enteramente del lado del navegador
# (ver SignalEngine.isKeyConnectedToPower()/isKeyConnectedToGnd()).
# Este archivo existe solo como marcador, igual que
# battery_18650.hal.py/led.hal.py -- sin él, ReplPanel._loadHal()
# igual hace el fetch de "clavija_127v.hal.py" y el 404 queda
# logueado por el navegador (no se puede suprimir desde JS, ver el
# mismo motivo documentado para ComponentBehaviorRegistry con
# .behavior.js).
# =============================================================
