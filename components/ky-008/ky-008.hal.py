# =============================================================
# PitSimulator — HAL KY-008 (módulo láser)
# Puramente DIGITAL, sin protocolo propio -- mismo criterio que
# led.hal.py (no existe, un LED tampoco necesita HAL): el firmware
# solo hace Pin(gpio, Pin.OUT).value(1)/.on() sobre "S", y
# _base_hal.py ya avisa ese cambio por "GPIO:<pin>:<valor>" (vía el
# breakpoint de gpio_set_level(), no algo que este archivo tenga que
# hacer). Este archivo existe solo como marcador.
# =============================================================
