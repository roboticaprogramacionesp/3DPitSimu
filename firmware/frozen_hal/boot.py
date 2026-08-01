# =============================================================
# PitSimulator — boot.py CONGELADO (no una copia para pastear a mano)
#
# A diferencia de boot_snippet.py (misma carpeta, esa sí es solo una
# referencia para copiar a un boot.py de filesystem) -- este archivo
# se congela DIRECTO junto con _pit_base.py/_pit_i2c_bus.py/etc. (está
# en la misma carpeta que ya apunta el freeze() del manifest). Motivo:
# escribir un boot.py al filesystem de QEMU en caliente por paste-mode
# resultó frágil (corrupción de transmisión reproducible en pruebas
# reales, mismo problema documentado en ReplPanel.js para pastes
# largos) -- MicroPython corre automáticamente un "boot.py" CONGELADO
# como fallback cuando el filesystem no tiene uno propio
# (pyexec_frozen_module en main.c de la mayoría de los puertos,
# incluido esp32), así que congelándolo directo se evita la escritura
# en caliente por completo.
#
# Mismo contenido/lógica que boot_snippet.py -- ver ese archivo para
# la explicación completa de por qué se importan estos 5 módulos y se
# reexportan esos 5 nombres como globals. Si el filesystem de flash
# ALGUNA VEZ tiene su propio boot.py real, ese gana (el fallback
# frozen solo aplica cuando no hay ninguno en el filesystem) -- no
# hace falta ninguna lógica especial acá para ese caso.
# =============================================================

import _pit_base
import _pit_i2c_bus
import _pit_adc_bus
import _pit_uart_bus
import _pit_frozen_components

register_line_handler = _pit_base.register_line_handler
poll_input            = _pit_base.poll_input
_settle                = _pit_base._settle
register_i2c_device    = _pit_i2c_bus.register_i2c_device
register_adc_default   = _pit_adc_bus.register_adc_default
