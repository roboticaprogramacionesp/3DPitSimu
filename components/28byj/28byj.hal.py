# =============================================================
# PitSimulator — HAL 28BYJ-48 + ULN2003 (motor paso a paso)
#
# Sin protocolo propio: el firmware controla IN1-IN4 con
#   Pin(gpio, Pin.OUT).value(x)
# (bit-banging manual de la secuencia de pasos, como hace
# prácticamente todo el código educativo para este driver -- no
# existe una librería "oficial" única como con los sensores I2C).
# El mecanismo YA existente de detección de GPIO de salida (ver
# _base_hal.py / el breakpoint en gpio_set_level(), documentado en
# QemuBridge.js) reporta estos cambios de pin solo; ver
# components/28byj/28byj.behavior.js para cómo se leen esos 4
# estados y se traduce a un ángulo de rotación visual. Este archivo
# queda como marcador vacío, mismo criterio que switch.hal.py/
# motor.hal.py.
# =============================================================
