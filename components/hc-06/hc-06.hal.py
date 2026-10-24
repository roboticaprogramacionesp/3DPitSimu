# =============================================================
# PitSimulator — HAL HC-06 (Bluetooth clásico/SPP, por UART)
# No necesita su propia clase "UART" -- ese reemplazo vive siempre
# en _uart_bus.py/_uart_bus_wasm.py (se inyecta siempre, tengas o no
# un componente UART en el canvas -- mismo criterio que
# _adc_bus.py/_i2c_bus.py). El protocolo "UART:<id>:<texto>" (teléfono
# -> ESP32) y "UARTTX:<id>:<hex>" (ESP32 -> teléfono) que usa
# SignalEngine._resolveHc06Uart()/sendHc06Text()/handleUartTx() ya lo
# resuelve ese mismo _uart_bus.
# Este archivo existe solo como marcador, igual que gps.hal.py/led.hal.py.
# =============================================================
