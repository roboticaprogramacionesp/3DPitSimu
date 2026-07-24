# =============================================================
# PitSimulator — HAL Teclado analógico ADKEY (5 botones, 1 pin ADC)
#
# Este módulo NO tiene un pin por botón -- las 5 teclas (D-pad +
# SEL) comparten una única salida analógica ("OUT") armada con un
# divisor resistivo: cada tecla, al apretarse, deja pasar un nivel
# de voltaje distinto por ese mismo pin. Por eso acá no hay nada
# análogo al "IN:" de los botones comunes -- todo pasa por el mismo
# protocolo "ADC:" que ya usa el joystick (ver más abajo).
#
# ── machine.ADC ──────────────────────────────────────────────
# Esta clase es UNA COPIA de la que trae joystick_hal.py -- a
# propósito, no por descuido. Cada HAL de este proyecto es
# autocontenido (no hay manera de que un _hal.py "importe" a otro,
# ver tft_st7789_hal.py/joystick_hal.py, que tampoco dependen entre
# sí), así que si el ADKEY se usa SIN joystick en el mismo circuito,
# igual necesita su propia definición de machine.ADC.
#
# Si en algún momento este proyecto suma un tercer componente
# analógico, lo más prolijo sería mover esta clase a un archivo
# compartido de verdad (si el mecanismo de inyección de HALs llega
# a soportar eso) en vez de seguir copiándola -- por ahora, con
# solo 2 usos, la duplicación es más simple que inventar ese
# mecanismo. Si joystick_hal.py y este archivo conviven en el mismo
# circuito, no pasa nada: las dos clases son idénticas, la segunda
# en cargar simplemente vuelve a pisar "machine.ADC" con una copia
# equivalente.
#
# ── Protocolo "ADC:" ─────────────────────────────────────────
# El simulador manda "ADC:<gpio>:<valor_u16>\n" por stdin cada vez
# que se aprieta/suelta una tecla (ver SignalEngine.setAdKeyState /
# Renderer.bindAdKey). Sin ninguna tecla apretada, el valor es
# 65535 (máxima escala) -- igual que un divisor resistivo en reposo,
# tirado a VCC por la resistencia de pull-up del propio módulo.
# =============================================================

_adc_input_states = {}


def _on_adc_line(parts):
    # parts = ["ADC", "<gpio>", "<valor_u16>"]
    if len(parts) < 3:
        return
    try:
        gpio  = int(parts[1])
        value = int(parts[2])
    except ValueError:
        return
    if value < 0:
        value = 0
    elif value > 65535:
        value = 65535
    _adc_input_states[gpio] = value


# register_line_handler/poll_input los define _base_hal.py como
# funciones de módulo (no de clase) -- se inyecta siempre antes que
# este archivo, así que ya están disponibles acá como globals.
register_line_handler("ADC:", _on_adc_line)


class ADC:
    """
    Reemplaza a machine.ADC -- misma API pública que el puerto ESP32
    de MicroPython para lo que este HAL cubre (ver joystick_hal.py,
    de donde se copió esta clase):
        ADC(pin)
        .read()      -> 0..4095  (12 bits)
        .read_u16()  -> 0..65535 (16 bits)
        .atten(x)    -> no-op
        .width(x)    -> no-op
    """

    ATTN_0DB   = 0
    ATTN_2_5DB = 1
    ATTN_6DB   = 2
    ATTN_11DB  = 3

    WIDTH_9BIT  = 0
    WIDTH_10BIT = 1
    WIDTH_11BIT = 2
    WIDTH_12BIT = 3

    def __init__(self, pin, *args, **kwargs):
        self._pin_num = getattr(pin, "_pin_num", pin)

    def atten(self, *args, **kwargs):
        pass

    def width(self, *args, **kwargs):
        pass

    def read_u16(self):
        poll_input()
        return _adc_input_states.get(self._pin_num, 65535)

    def read(self):
        return self.read_u16() >> 4


import machine as _machine_module
_machine_module.ADC = ADC
