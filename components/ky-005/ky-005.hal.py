# =============================================================
# PitSimulator — HAL KY-005 (LED infrarrojo, transmisor NEC)
# No necesita nada propio acá -- el reemplazo de la librería real
# "ir_tx" (que en este build de MicroPython-WASM no podía ni
# importarse: necesita esp32.RMT, que no existe, y cae a un
# "ImportError: no module named 'pyb'") ya vive siempre en
# _ir_tx_wasm.py, igual criterio que _ir_rx_wasm.py/_uart_bus_wasm.py
# (se inyecta siempre, tengas o no un KY-005 en el lienzo).
# NEC.transmit(addr, cmd) manda "IRTX:<addr>:<cmd>" -- WasmBridge.js
# lo recibe y llama SignalEngine.broadcastIrCode(), el mismo camino
# que ya usa el control remoto virtual (IrRemotePanel.js) para
# avisarle a cualquier KY-022 del lienzo.
# Este archivo existe solo como marcador, igual que gps.hal.py/
# hc-06.hal.py.
# =============================================================
