# =============================================================
# PitSimulator — HAL FC-51 (sensor infrarrojo de obstáculos)
#
# Sensor puramente DIGITAL (sin protocolo propio, sin I2C ni
# registros que emular): el firmware solo hace
#   Pin(gpio, Pin.IN).value()
# y _base_hal.py YA sabe entregar lo que el navegador mande por
# "IN:<gpio>:<valor>" (mismo mecanismo que un botón) -- ver
# SignalEngine.setFc51Detected()/_notifyDigitalToFirmware(). Este
# archivo queda como marcador vacío (no hace falta ninguna lógica
# nueva acá), mismo criterio que switch.hal.py/motor.hal.py.
# =============================================================
