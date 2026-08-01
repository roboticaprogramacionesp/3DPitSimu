# =============================================================
# PitSimulator — HAL GPS NEO-6M (UART)
# No necesita su propia clase "UART" -- ese reemplazo vive siempre
# en _uart_bus.py (se inyecta siempre, tengas o no un componente UART
# en el canvas -- mismo criterio que _adc_bus.py/_i2c_bus.py). El
# protocolo "UART:<id>:<texto>" que manda
# SignalEngine._notifyGpsToFirmware() ya lo recibe ese mismo
# register_line_handler("UART:", ...) de _uart_bus.py.
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
