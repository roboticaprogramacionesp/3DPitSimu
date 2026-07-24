# =============================================================
# PitSimulator — HAL Teclado matricial 4x4 sobre I2C (PCF8574)
#
# A diferencia del LCD/OLED, este SÍ depende de que
# i2c.writeto()/readfrom() funcionen de verdad: keypad4_i2c.py no
# tiene protocolo propio por print(), todo pasa por el objeto i2c.
#
# ── CAMBIO respecto a la versión anterior ───────────────────────
# Este archivo YA NO trae su propia clase "I2C" -- ese bus
# compartido (con su registro, writeto/readfrom, _settle(), scan())
# ahora vive en _i2c_bus.py, inyectado una sola vez antes que
# cualquier hal.py de componente (ver el docstring de ese archivo).
# Acá solo nos registramos contra él con register_i2c_device() para
# la dirección de este teclado -- nada de "machine.I2C = I2C"
# compitiendo con LCD/OLED.
#
# Uso en código del usuario (idéntico a como ya lo tenías):
#   from machine import Pin, I2C
#   from keypad4_i2c import Keypad4x4_I2C
#
#   i2c = I2C(0, scl=Pin(22), sda=Pin(21))
#   keypad = Keypad4x4_I2C(i2c, address=0x20)
#
#   while True:
#       key = keypad.get_key()
#       if key:
#           print(key)
#
# El "I2CW:"/"I2CR:" del lado del navegador (QemuBridge.js,
# SignalEngine.evaluateKeypadI2c()) no cambia en nada -- ese
# protocolo lo sigue manejando _i2c_bus.py, solo que ahora en un
# único lugar en vez de una copia por componente.
# =============================================================

# NO se importa "register_i2c_device" de ningún lado -- ver la nota
# equivalente en lcd_16x2_i2c.hal.py: _i2c_bus.py no es un módulo
# real, es otro fragmento pegado por paste mode antes que este (ver
# ALWAYS_HAL_TYPES en ReplPanel.js), así que su función ya está
# disponible acá como global, sin ningún import.

# Nada más que hacer acá: keypad4_i2c.py (el módulo real, sin
# tocar) construye su propio "I2C(...)" -- que ya es la clase
# compartida de _i2c_bus.py vía "machine.I2C" -- y llama a
# writeto()/readfrom() con la dirección que el usuario le pase
# (típicamente 0x20, la del .json de este componente). No hace
# falta que ESTE archivo registre una dirección fija de antemano:
# a diferencia del LCD (que declara su address al construirse),
# el teclado no tiene un objeto propio acá que sepamos de qué
# dirección es hasta que el usuario construye su Keypad4x4_I2C --
# y ese registro para scan()/known_addrs no es indispensable para
# que el teclado funcione (writeto/readfrom ya andan por dirección
# sin necesidad de estar "declarados" de antemano).
#
# Si en el futuro hace falta que el teclado aparezca en scan()
# ANTES de que el usuario construya el objeto (ej. para mostrarlo
# en algún diagnóstico de "qué hay conectado"), acá es donde se
# agregaría, con la dirección que venga del .json del componente:
#
#   register_i2c_device(0x20)