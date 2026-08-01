# =============================================================
# PitSimulator — HAL Resistencia
# No necesita ninguna lógica: es un componente puramente pasivo,
# igual que switch.hal.py -- limita corriente pero no se simula
# eléctricamente en este proyecto (no hay caída de tensión real).
# Sus dos terminales quedan siempre puenteados entre sí (ver
# resistencia.behavior.js / SignalEngine.getNet, alwaysBridgePins),
# así que cualquier LED/sensor cableado "a través" de una
# resistencia sigue viendo la señal del otro lado con normalidad.
# El firmware nunca lo ve ni le manda ni le lee nada.
# Este archivo existe solo como marcador, igual que switch.hal.py.
# =============================================================
