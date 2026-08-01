# =============================================================
# PitSimulator — HAL "adkey_real" (VARIANTE CONGELADA, generada)
#
# Generado por firmware/frozen_hal/build_components.js a partir de
# components/adkey_real/adkey_real.hal.py -- NO EDITAR A MANO. Cualquier
# cambio real va en el .hal.py original; después correr
# "node firmware/frozen_hal/build_components.js" de nuevo y
# recompilar el firmware (ver firmware/frozen_hal/README.md).
#
# Único agregado real respecto al original: el/los import(s) de
# abajo -- ver el comentario grande en build_components.js sobre
# por qué hacen falta (namespace propio de módulo vs. exec() en
# el namespace global del REPL, que es como corre hoy pasteado).
# =============================================================

from _pit_adc_bus import register_adc_default

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
