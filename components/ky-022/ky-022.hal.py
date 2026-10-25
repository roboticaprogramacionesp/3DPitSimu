# =============================================================
# PitSimulator — HAL KY-022 (receptor infrarrojo, protocolo NEC)
# No necesita ninguna clase propia -- el reemplazo de "ir_rx" (NEC_8/
# NEC_16) vive siempre en _ir_rx_wasm.py (se inyecta siempre, tengas o
# no un componente KY-022 en el canvas -- mismo criterio que
# _adc_bus.py/_i2c_bus.py/_uart_bus.py). El protocolo
# "IRRX:<gpio>:<addr>:<cmd>" que manda IrRemotePanel.js/
# SignalEngine.sendIrCode() ya lo recibe ese mismo register_line_handler.
# Este archivo existe solo como marcador, igual que gps.hal.py/hc-06.hal.py.
# =============================================================
