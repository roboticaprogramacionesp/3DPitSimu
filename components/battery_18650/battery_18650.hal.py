# =============================================================
# PitSimulator — HAL Batería 18650
# No necesita ninguna lógica: es una fuente de alimentación
# puramente pasiva, nunca cableada a ningún GPIO del ESP32 (solo
# a pines +/- de otros componentes, ej. el +12V/GND de un L298N).
# El firmware nunca la ve ni le manda ni le lee nada -- si hay
# continuidad real de alimentación se resuelve enteramente del
# lado del navegador (ver SignalEngine.isKeyConnectedToPower()/
# isKeyConnectedToGnd()).
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
