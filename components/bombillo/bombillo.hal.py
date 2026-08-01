# =============================================================
# PitSimulator — HAL Bombillo (foco genérico)
# No necesita ninguna lógica: es una carga puramente pasiva, el
# firmware nunca la ve ni le manda ni le lee nada -- si prende o no
# se resuelve enteramente del lado del navegador (ver
# SignalEngine.isKeyConnectedToPower()/isKeyConnectedToGnd(), y
# bombillo.behavior.js).
# Este archivo existe solo como marcador, igual que
# battery_18650.hal.py/led.hal.py -- sin él, ReplPanel._loadHal()
# igual hace el fetch de "bombillo.hal.py" y el 404 queda logueado
# por el navegador (no se puede suprimir desde JS).
# =============================================================
