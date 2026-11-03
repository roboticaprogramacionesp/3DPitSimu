# =============================================================
# PitSimulator — HAL Sensor de Huella FPM383C (SFM-V1.7, protocolo
# AS608 por UART)
# No necesita su propia clase "UART" -- igual que hc-06.hal.py/
# gps.hal.py/dfplayer.hal.py, ese reemplazo ya vive siempre en
# _uart_bus_wasm.py (se inyecta siempre). La simulación del
# protocolo AS608 (comandos que entiende, respuestas que arma) vive
# en SignalEngine._handleFpmCommand() -- SignalEngine.handleUartTx()
# la llama apenas ve un "UARTTX:" que resuelve a un componente de
# tipo "fingerprint" (ver _findFpmByUartTx()), y la respuesta se
# manda de vuelta con el protocolo binario nuevo "UARTRX:<id>:<hex>"
# (ver _on_uartrx_line() de _uart_bus_wasm.py -- a diferencia de
# "UART:", que es para texto, ese es crudo, sin tocar los bytes).
# "Poner el dedo" (botón del panel, ver fingerprint.behavior.js) usa
# SignalEngine.setFpmFingerPresent() para que gen_img()/wait_finger()/
# search() tengan algo que detectar mientras el programa corre.
# Este archivo existe solo como marcador, igual que bocina.hal.py.
# =============================================================
