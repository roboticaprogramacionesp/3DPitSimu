# =============================================================
# PitSimulator — HAL L298N (puente H)
# No necesita ninguna lógica propia: IN1-IN4 son pines de salida
# digitales comunes (Pin.on()/off() del HAL base ya emiten
# GPIO:N:V) y ENA/ENB son PWM comunes (machine.PWM del HAL base
# ya emite PWM:N:F:D) -- toda la lógica de qué sentido/velocidad
# resulta de esas señales vive del lado del navegador
# (l298n.behavior.js / SignalEngine._computeL298nMotorState()).
# Este archivo existe solo como marcador, igual que led.hal.py.
# =============================================================
