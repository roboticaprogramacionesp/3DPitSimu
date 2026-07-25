# =============================================================
# PitSimulator — HAL Joystick KY-023 (X/Y analógico + botón SW)
#
# ── CAMBIO ───────────────────────────────────────────────────
# Este archivo YA NO necesita su propia clase "ADC" -- ese
# reemplazo ahora vive en _adc_bus.py, que se inyecta SIEMPRE
# (junto con _base_hal.py / _i2c_bus.py), tengas o no un
# componente analógico puesto en el canvas (ver el mismo cambio
# ya aplicado en pot_slider.hal.py).
#
# Antes, esta clase propia (copia de la de adkey_hal.py) tenía
# width()/atten() como no-ops reales -- read() quedaba SIEMPRE en
# 12 bits fijos (>> 4) sin importar qué resolución configurara el
# código del usuario. Como esta clase se cargaba DESPUÉS de
# _adc_bus.py (que sí respeta width() correctamente), pisaba a la
# buena con la rota -- bug real reportado con datos concretos
# (ADC.width(...) sin ningún efecto).
#
# El centro de reposo del joystick (32768, mitad de escala) YA es
# el default genérico de _adc_bus.py (ver su read_u16()) -- no
# hace falta llamar a register_adc_default() para nada especial
# acá, a diferencia de adkey_hal.py (que sí necesita 65535).
#
# El botón SW tampoco necesita nada especial: se puentea a GND al
# hacer click en el simulador (ver Renderer.bindPressButton /
# SignalEngine.setPressed), que ya manda "IN:<gpio>:<valor>" por
# stdin -- el mismo mecanismo genérico que usa cualquier otro botón
# de este proyecto, cubierto por el Pin de _base_hal.py.
#
# Este archivo queda vacío a propósito -- no hace falta borrar la
# entrada de joystick del manifest ni de ReplPanel: un hal.py vacío
# (o inexistente) simplemente no aporta nada al paste, sin generar
# ningún error.
# =============================================================
