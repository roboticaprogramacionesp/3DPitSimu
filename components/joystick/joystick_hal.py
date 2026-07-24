# =============================================================
# PitSimulator — HAL Joystick KY-023 (X/Y analógico + botón SW)
#
# El botón SW no necesita nada especial acá: se puentea a GND al
# hacer click en el simulador (ver Renderer.bindPressButton /
# SignalEngine.setPressed), que ya manda "IN:<gpio>:<valor>" por
# stdin -- el mismo mecanismo genérico que usa cualquier otro botón
# de este proyecto (ky_004, etc.), cubierto por el Pin de
# _base_hal.py. Nada que agregar para eso.
#
# Lo que SÍ hace falta acá es simular machine.ADC -- un joystick
# analógico manda valores continuos (VRx/VRy), no solo 0/1, y
# _base_hal.py solo parchea machine.Pin (entradas/salidas
# digitales). Esta es la primera vez que este proyecto necesita
# ADC, así que se agrega acá en vez de en _base_hal.py -- si más
# adelante otro componente analógico (un potenciómetro, un sensor
# de luz LDR, etc.) también necesita ADC, esta misma clase debería
# alcanzar sin cambios (no hay nada específico del joystick en la
# implementación de ADC en sí).
#
# ── Protocolo "ADC:" ─────────────────────────────────────────
# El simulador manda "ADC:<gpio>:<valor_u16>\n" por stdin cada vez
# que el usuario arrastra el stick en el canvas (ver
# SignalEngine.setJoystickPosition / Renderer.bindJoystick). El
# valor SIEMPRE viaja en escala u16 (0..65535, centro=32768) sea
# cual sea el método que después llame el firmware -- read()/
# read_u16() son solo distintas "vistas" de ese mismo valor.
#
# Mismo criterio que los pines digitales de _base_hal.py: "última
# muestra gana", y el valor solo se refresca cuando el firmware
# hace polling (ADC.read()/read_u16() llaman a poll_input() antes
# de devolver nada) -- no hay ningún thread de fondo leyendo stdin
# en paralelo (ver la nota larga en _base_hal.py sobre por qué eso
# rompía el REPL).
#
# Si nunca se arrastró el stick (o el joystick no está cableado a
# ningún GPIO todavía), read_u16() devuelve 32768 -- el centro de
# la escala, que es lo que un joystick real reporta en reposo
# (spring-return), no 0.
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
    de MicroPython para lo que este HAL cubre:
        ADC(pin)
        .read()      -> 0..4095  (12 bits, igual que ADC.read() en
                        el ESP32 real)
        .read_u16()  -> 0..65535 (16 bits, estándar en todos los
                        puertos de MicroPython)
        .atten(x)    -> no-op (acá no hay atenuación de voltaje real
                        que simular, la señal ya viene en su rango
                        completo desde el simulador)
        .width(x)    -> no-op (mismo motivo, y además deprecado en
                        el port real)

    Las constantes ATTN_*/WIDTH_* quedan como atributos de clase
    solo para que "ADC.ATTN_11DB" & compañía no exploten con
    AttributeError si el código del usuario las usa -- acá no
    cambian nada, ver arriba.
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
        # `pin` puede venir como objeto Pin (con _pin_num, ver
        # _base_hal.Pin) o como número crudo -- igual que otros HAL
        # de este proyecto aceptan ambas formas.
        self._pin_num = getattr(pin, "_pin_num", pin)

    def atten(self, *args, **kwargs):
        pass

    def width(self, *args, **kwargs):
        pass

    def read_u16(self):
        poll_input()
        return _adc_input_states.get(self._pin_num, 32768)

    def read(self):
        return self.read_u16() >> 4


import machine as _machine_module
_machine_module.ADC = ADC
