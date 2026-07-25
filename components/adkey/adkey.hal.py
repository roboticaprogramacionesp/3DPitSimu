# =============================================================
# PitSimulator — HAL Teclado analógico ADKEY (5 botones, 1 pin ADC)
#
# ── CAMBIO ───────────────────────────────────────────────────
# Antes, este archivo definía su propia clase "ADC" completa
# (copiada de joystick.hal.py) -- width()/atten() eran no-ops
# reales, así que read() quedaba SIEMPRE en 12 bits fijos (>> 4)
# sin importar qué resolución configurara el código del usuario.
# Como este archivo se carga DESPUÉS de _adc_bus.py (que sí
# respeta width() correctamente, ver ese archivo), la clase propia
# pisaba a la buena con la rota -- bug real reportado con datos
# concretos (ADC.width(WIDTH_9BIT/10BIT/11BIT) sin ningún efecto
# en la lectura).
#
# Ahora ya NO se redefine ADC -- se USA la clase compartida de
# _adc_bus.py (siempre inyectada antes, junto con _base_hal.py/
# _i2c_bus.py) tal cual, extendiéndola solo para lo que sí es
# específico del ADKEY: su reposo (ninguna tecla apretada) es
# 65535 -- pull-up a VCC -- a diferencia del default genérico de
# _adc_bus.py (32768, pensado para joystick/potenciómetro
# centrados). register_adc_default() es exactamente el mecanismo
# que _adc_bus.py expone para declarar eso (ver su docstring, que
# menciona "un ADKEY con pull-up" como ejemplo motivador).
#
# ── Protocolo "ADC:" ─────────────────────────────────────────
# Sigue siendo el mismo "ADC:<gpio>:<valor_u16>\n" que ya maneja
# _adc_bus.py -- no hace falta ningún register_line_handler acá.
# =============================================================

import machine as _machine_module

_SharedADC = _machine_module.ADC  # la clase real de _adc_bus.py


class ADC(_SharedADC):

    def __init__(self, pin, *args, **kwargs):
        super().__init__(pin, *args, **kwargs)
        register_adc_default(self._pin, 65535)


_machine_module.ADC = ADC
