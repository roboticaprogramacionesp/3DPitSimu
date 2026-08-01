# =============================================================
# PitSimulator — HAL Switch (interruptor ON/OFF)
# No necesita ninguna lógica: es un componente puramente pasivo,
# nunca cableado a ningún GPIO del ESP32 (su función es
# interrumpir o no la continuidad entre otros dos componentes,
# ej. una batería y el +12V de un L298N). El firmware nunca lo
# ve ni le manda ni le lee nada -- el estado abierto/cerrado se
# resuelve enteramente del lado del navegador (ver
# switch.behavior.js / SignalEngine.getNet()).
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
