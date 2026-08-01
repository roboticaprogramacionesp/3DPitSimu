# =============================================================
# PitSimulator — HAL KY-018 Fotorresistor (LDR)
# No necesita su propia clase "ADC" -- ese reemplazo vive siempre
# en _adc_bus.py (se inyecta siempre, tengas o no un componente
# analógico en el canvas -- ver la nota igual en pot_rotary.hal.py/
# pot_slider.hal.py). El protocolo "ADC:<gpio>:<valor_u16>" que manda
# SignalEngine.setKy018LightLevel() ya lo recibe ese mismo
# register_line_handler("ADC:", ...) de _adc_bus.py.
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
