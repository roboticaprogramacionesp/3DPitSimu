from hcsr04 import HCSR04
from time import sleep
ultrasonico = HCSR04(trigger_pin=12, echo_pin=13)
while True:
  print(ultrasonico.distance_cm())
  sleep(1)