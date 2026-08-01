# =============================================================
# PitSimulator — HAL Teclado analógico ADKEY (5 botones, 1 pin ADC)
# Idéntico circuito/protocolo que components/adkey/adkey.hal.py (el
# tipo "adkey" original, ahora oculto) -- este componente ("adkey_real")
# solo cambia el aspecto visual (asset Fritzing real del módulo AD
# Keyboard en vez del dibujo a mano), la electrónica es la misma.
# Ver ese archivo para la explicación completa del fix de ADC.width().
# =============================================================

import machine as _machine_module

_SharedADC = _machine_module.ADC  # la clase real de _adc_bus.py


class ADC(_SharedADC):

    def __init__(self, pin, *args, **kwargs):
        super().__init__(pin, *args, **kwargs)
        register_adc_default(self._pin, 65535)


_machine_module.ADC = ADC
