# =============================================================
# PitSimulator — HAL Potenciómetro Deslizante 10K
#
# ── CAMBIO ───────────────────────────────────────────────────
# Este archivo YA NO necesita su propia clase "ADC" -- ese
# reemplazo ahora vive en _adc_bus.py, que se inyecta SIEMPRE
# (junto con _base_hal.py / _i2c_bus.py), tengas o no un
# componente analógico puesto en el canvas. Antes, si escribías
# código que usaba ADC(pin) SIN tener un joystick/adkey/pot_slider
# en el circuito, "machine.ADC" seguía siendo el driver real --
# que confirmamos que crashea esta build apenas se ejecuta de
# verdad (ver la ronda de PROBE_ADC). _adc_bus.py resuelve eso de
# raíz: se parchea una sola vez, siempre, sin depender de qué
# componentes haya en el canvas.
#
# El protocolo "ADC:<gpio>:<valor_u16>" que manda
# SignalEngine.setSliderPosition() no cambió en nada -- lo sigue
# recibiendo el mismo register_line_handler("ADC:", ...) de
# _adc_bus.py, ahora en un único lugar en vez de una copia por
# componente (mismo criterio que ya aplicamos con register_i2c_device()
# para LCD/teclado/OLED en _i2c_bus.py).
#
# Este archivo queda vacío a propósito -- no hace falta borrar la
# entrada de pot_slider del manifest ni de ReplPanel: un hal.py
# vacío (o inexistente) simplemente no aporta nada al paste, sin
# generar ningún error.
# =============================================================