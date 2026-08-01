# =============================================================
# PitSimulator — HAL KY-023 (X/Y analógico + botón SW)
#
# Mismo motivo que joystick/joystick.hal.py (que este componente
# reemplaza visualmente, sin borrarlo): el ADC ya es genérico vía
# _adc_bus.py (inyectado siempre), y el botón SW se puentea a GND
# con el mismo mecanismo genérico de botón momentáneo (ver
# Renderer.bindPressButton / SignalEngine.setPressed). Este archivo
# queda vacío a propósito -- no hace falta ninguna lógica nueva acá.
# =============================================================
