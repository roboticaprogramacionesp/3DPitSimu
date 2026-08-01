# =============================================================
# PitSimulator — HAL PIR HC-SR501 (sensor de movimiento)
# Mismo criterio que fc-51.hal.py/tcrt5000.hal.py: sensor puramente
# DIGITAL, sin protocolo propio -- el firmware solo hace
# Pin(gpio, Pin.IN).value() sobre "OUT", y _base_hal.py ya entrega lo
# que el navegador mande por "IN:<gpio>:<valor>" (ver
# SignalEngine.setPirDetected()/_notifyDigitalToFirmware()). Este
# archivo queda como marcador vacío.
#
# A diferencia de FC-51/TCRT5000 (activos en BAJO), el HC-SR501 real
# es activo en ALTO -- OUT=1 mientras detecta movimiento, OUT=0 en
# reposo -- ver setPirDetected() para el sentido correcto.
# =============================================================
