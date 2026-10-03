from machine import Pin, PWM, Timer
from time import sleep

def map(x, in_min=0, in_max=100, out_min=350, out_max=1023):
  return int((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)
  
class Motor():
  def __init__(self, in1=27, in2=26, in3=17, in4=5):
    self.in1 = PWM(Pin(in1), freq=2000, duty=0)
    self.in2 = PWM(Pin(in2), freq=2000, duty=0)
    self.in3 = PWM(Pin(in3), freq=2000, duty=0)
    self.in4 = PWM(Pin(in4), freq=2000, duty=0)
    sleep(2)
    self.speed = 100
    self.t = 2000
    self.timer = Timer(0)
    self.timer.deinit()
  
  def set_speed(self, speed=50):
    print(speed)
    self.speed = speed
  
  def set_speed_up(self):
    self.speed += 10
    print(self.speed)
    if self.speed > 100:
      self.speed = 100

  def set_speed_down(self):
    self.speed -= 10
    print(self.speed)
    if self.speed < 40:
      self.speed = 40
  
  def move_motor(self, sp1=0, sp2=0, sp3=0, sp4=0):
    if sp1 < 0: sp1 = 0
    if sp2 < 0: sp2 = 0
    if sp3 < 0: sp3 = 0
    if sp4 < 0: sp4 = 0
    if sp1 > 100: sp1 = 100
    if sp2 > 100: sp2 = 100
    if sp3 > 100: sp3 = 100
    if sp4 > 100: sp4 = 100
    
    self.in1.duty(map(sp1))
    self.in2.duty(map(sp2))
    self.in3.duty(map(sp3))
    self.in4.duty(map(sp4))
  
  def up(self):
    self.move_motor(self.speed, 0, 0, self.speed)
    self.start()

  def up_s(self, s1=60, s2=60):
    self.move_motor(s1, 0, 0, s2)
    self.start()


  def down(self):
    self.move_motor(0, self.speed, self.speed, 0)
    self.start()


  def left(self):
    self.move_motor(0, 0, 0, self.speed)
    self.start()


  def right(self):
    self.move_motor(self.speed, 0, 0, 0)
    self.start()


  def timer_callback(self, timer):
    self.move_motor()
  
  
  def start(self):
    """Start the timer."""
    self.timer.init(period=self.t, mode=Timer.ONE_SHOT, callback=self.timer_callback)
  
  


