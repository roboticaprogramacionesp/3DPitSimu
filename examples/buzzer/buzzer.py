from machine import Pin, PWM
from time import sleep
import rtttl, songs
pwm4 = PWM(Pin(4), freq=31, duty=512)
sleep(1)
pwm4.deinit()
play = rtttl.play(Pin(4, Pin.OUT), songs.find('Super Mario - Main Theme'))