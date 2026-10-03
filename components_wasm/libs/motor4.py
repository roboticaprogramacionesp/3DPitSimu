from machine import Pin, PWM, Timer

def map(x, in_min=0, in_max=100, out_min=0, out_max=1023):
  return int((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min)
  
class Motor():
  def __init__(self, in1=12, in2=14, in3=18, in4=19, inb1=27, inb2=26, inb3=17, inb4=5):
    self.in1 = PWM(Pin(in1), freq=2000, duty=0)
    self.in2 = PWM(Pin(in2), freq=2000, duty=0)
    self.in3 = PWM(Pin(in3), freq=2000, duty=0)
    self.in4 = PWM(Pin(in4), freq=2000, duty=0)
    self.inb1 = PWM(Pin(inb1), freq=2000, duty=0)
    self.inb2 = PWM(Pin(inb2), freq=2000, duty=0)
    self.inb3 = PWM(Pin(inb3), freq=2000, duty=0)
    self.inb4 = PWM(Pin(inb4), freq=2000, duty=0)
    self.speed = 100
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

  def set_speed_sown(self):
    self.speed -= 10
    print(self.speed)
    if self.speed < 50:
      self.speed = 50

  
  def move_motor(self, sp1=0, sp2=0, sp3=0, sp4=0, spb1=0, spb2=0, spb3=0, spb4=0):
    self.in1.duty(map(sp1))
    self.in2.duty(map(sp2))
    self.in3.duty(map(sp3))
    self.in4.duty(map(sp4))
    self.inb1.duty(map(spb1))
    self.inb2.duty(map(spb2))
    self.inb3.duty(map(spb3))
    self.inb4.duty(map(spb4))
  
  def down(self):
    self.move_motor(self.speed, 0, self.speed, 0, 0, self.speed, 0, self.speed)
    self.start()
  
  def up(self):
    self.move_motor(0, self.speed, 0, self.speed, self.speed, 0, self.speed, 0)
    self.start()
    
  def left(self):
    self.move_motor(self.speed, 0, 0, self.speed, 0, self.speed, self.speed, 0)
    self.start() 

  def right(self):
    self.move_motor(0, self.speed, self.speed, 0, self.speed, 0, 0, self.speed)
    self.start()
  
  def circle(self):
    pass
  
  def timer_callback(self, timer):
    self.move_motor()
  
  def start(self):
    """Start the timer."""
    self.timer.init(period=2000, mode=Timer.ONE_SHOT, callback=self.timer_callback)
  