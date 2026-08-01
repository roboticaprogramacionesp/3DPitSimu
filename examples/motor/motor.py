from machine import Pin
from time import sleep
l298n_in1 = Pin(26, Pin.OUT)
l298n_in2 = Pin(25, Pin.OUT)
l298n_in3 = Pin(17, Pin.OUT)
l298n_in4 = Pin(16, Pin.OUT)
while True:
  l298n_in1.on()
  l298n_in2.off()
  sleep(2)
  l298n_in1.off()
  l298n_in2.off()
  sleep(2)
  l298n_in1.off()
  l298n_in2.on()
  sleep(2)
  l298n_in1.off()
  l298n_in2.off()
  sleep(2)