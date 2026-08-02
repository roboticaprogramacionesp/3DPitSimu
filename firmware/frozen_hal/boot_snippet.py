# =============================================================
# PitSimulator — fragmento para agregar al boot.py del firmware
#
# NO reemplaces tu boot.py entero con esto -- si ya tenés uno (con
# configuración de WebREPL, filesystem, etc.), agregá estas líneas
# AL FINAL del que ya tenés. Si todavía no tenés boot.py, este
# archivo completo puede copiarse tal cual como tu boot.py.
#
# Qué hace: reemplaza el paste-mode de _base/_i2c_bus/_adc_bus/
# _uart_bus (que antes se pegaban por paste-mode en CADA sesión
# nueva de QEMU) por una carga instantánea al arrancar, importando
# las 4 variantes congeladas de esta misma carpeta. El HAL POR
# COMPONENTE (bmp180.hal.py, ds3231.hal.py, etc., pegado por
# ReplPanel.js según qué haya en el canvas) NO se toca -- sigue
# llegando por paste-mode exactamente igual que antes.
#
# Orden de import: IMPORTA -- _pit_base primero (los otros 3
# dependen de sus funciones), después los otros 3 en cualquier
# orden entre sí.
# =============================================================

import _pit_base
import _pit_i2c_bus
import _pit_adc_bus
import _pit_uart_bus
import _pit_frozen_components

# _pit_frozen_components es un módulo INERTE (solo declara
# FROZEN_TYPES = frozenset([...]), ver ese archivo) -- ReplPanel.js lo
# consulta con un probe al conectar para saber qué "import
# _pit_hal_<tipo>" puede pedir en vez de pastear el .hal.py completo.
# A propósito, NINGUNO de los módulos de componente en sí
# (components/_pit_hal_*.py, ver firmware/frozen_hal/README.md) se
# importa acá -- varios comparten dirección I2C por defecto (ej.
# bmp180/bmp280 en 0x77, ds3231/mpu6050 en 0x68): importarlos TODOS
# sin condición haría que el último en cargar le pise la dirección al
# otro, para CUALQUIER proyecto que use uno solo de los dos. Se
# siguen importando on-demand, con la misma selectividad por canvas
# de siempre (_buildPendingHal() en ReplPanel.js).

# El HAL por componente (pegado por paste-mode, sin cambios) asume
# estos 6 nombres como GLOBALS del REPL -- exactamente igual que
# cuando _base/_i2c_bus/_adc_bus se pegaban por exec() antes. boot.py
# corre en el mismo namespace que después usa la REPL interactiva
# (mp_globals_get() de MicroPython), así que estas asignaciones acá
# quedan disponibles como globals para cualquier código pegado
# después, sin necesitar ningún truco extra.
#
# process_line -- a diferencia de los otros 5 (llamados desde código
# de componente ya pegado), a este lo llama DIRECTO el simulador
# (QemuBridge._sendResyncLines()) escribiéndolo como texto crudo en
# el prompt del REPL idle (ej. "process_line('IN:4:1')\n") -- por eso
# tiene que existir como global del REPL, idéntico motivo que los
# otros 5. Ver el comentario grande junto a process_line() en
# _pit_base.py.
register_line_handler = _pit_base.register_line_handler
poll_input            = _pit_base.poll_input
process_line          = _pit_base.process_line
_settle               = _pit_base._settle
register_i2c_device   = _pit_i2c_bus.register_i2c_device
register_adc_default  = _pit_adc_bus.register_adc_default
