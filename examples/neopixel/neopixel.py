from machine import Pin
from neopixel import NeoPixel
from time import sleep
i = None
np = NeoPixel(Pin(2, Pin.OUT), 8)
while True:
  for i in range(8):
    np[i] = (255,0,0)
    np.write()
    sleep(1)
    np[i] = (0,0,0)
  sleep(1)
