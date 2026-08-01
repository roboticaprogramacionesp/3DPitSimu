from machine import Pin, PWM
def map_servo(x, in_min=0, in_max=180, out_min=21, out_max=132):
    return int((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)
servo_26 = PWM(Pin(26), freq=50)
servo_26.duty(map_servo(90))