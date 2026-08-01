# =============================================================
# PitSimulator — HAL Motor DC (reductora)
# No necesita ninguna lógica propia: un motor DC simple se
# maneja siempre a través de un puente H (L298N, etc.) -- el
# firmware solo prende/apaga (o hace PWM sobre) los pines del
# puente H, y Pin.on()/off()/machine.PWM del HAL base ya emiten
# GPIO:N:V / PWM:N:F:D sin necesitar código específico acá.
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
