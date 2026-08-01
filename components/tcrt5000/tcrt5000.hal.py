# =============================================================
# PitSimulator — HAL TCRT5000 (sensor infrarrojo de línea/obstáculo)
# Idéntico criterio que fc-51.hal.py: sensor puramente DIGITAL, sin
# protocolo propio -- el firmware solo hace Pin(gpio, Pin.IN).value()
# sobre "Do", y _base_hal.py ya entrega lo que el navegador mande por
# "IN:<gpio>:<valor>" (ver SignalEngine.setTcrt5000Detected()/
# _notifyDigitalToFirmware()). Este archivo queda como marcador
# vacío, no hace falta ninguna lógica nueva acá.
# =============================================================
