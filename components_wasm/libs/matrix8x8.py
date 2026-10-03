from machine import Pin, SPI
from max import Max7219
import framebuf, array, math
from icons import vacio

class Max8x8():
  def __init__(self, sck=2, mosi=13, cs=14, w=8, h=8, s=False):
    self.init(sck=sck, mosi=mosi, cs=cs, w=w, h=h, s=s)
    
  def init(self, sck=2, mosi=13, cs=15, w=8, h=8, s=False):
    self.spi = SPI(1,
      baudrate=10000000,
      polarity=1,
      phase=0,
      sck=Pin(sck),
      mosi=Pin(mosi))
    self.cs = Pin(cs, Pin.OUT)
    self.display = Max7219(w, h, self.spi, self.cs, s)
  
  def scroll_text(self, str):
    self.display.marquee(str)
  
  def clear(self, s=0):
    self.display.fill(s)
    self.show()
  
  def show(self):
    self.display.show()

  def text(self, c, x=0, y=0, s=1):
    self.display.text(c, x, y, s)
    self.show()
  
  def brightness(self, v):
    self.display.brightness(v)
  
  def hline(self, x, y, w, s=1):
    self.display.hline(x, y, w, s)
    self.show()
  
  def line(self, x, y, x1, y1, s=1):
    self.display.line(x, y, x1, y1, s)
    self.show()
  
  def rect(self, x, y, w, h, s=1):
    self.display.rect(x, y, w, h, s)
    self.show()
  
  def fill_rect(self, x, y, w, h, s=1):
    self.display.fill_rect(x, y, w, h, s)
    self.show()
  
  def scroll(self, dx, dy):
    self.display.scroll(dx, dy)
    self.show()
  
  def icon(self, img, x=0, y=0, w=8, h=8, s=1):
    buffer = bytearray(img) #bytearray(img) globals()[img]
    fb = framebuf.FrameBuffer(buffer, w, h, framebuf.MONO_HLSB)
    if s == 0:
      fb.fill(0)
    self.display.blit(fb, x, y)
    self.show()
  
  def poly(self, fig, x, y, s, f):
    vertices = array.array('h', fig) 
    self.display.poly(x, y, vertices, s, f)
    self.display.show()
  
  def circle(self, x, y, r, s, f):
    self.display.ellipse(x+r, y+r, r, r, s)
    self.display.show()
    # Llena la circle
    center_x = x+r
    center_y = y+r
    radius = r
    for y in range(center_y - radius, center_y + radius + 1):
      for x in range(center_x - radius, center_x + radius + 1):
        if math.sqrt((x - center_x)**2 + (y - center_y)**2) <= radius:
          self.display.pixel(x, y, s*f)
    self.display.show()
  
  def invert_circle(self):
    for j in range(8):
      for i in range(8):
        if self.display.pixel(i, j):
          self.display.pixel(i, j, 0)  # Cambia el píxel blanco a negro
        else:
          self.display.pixel(i, j, 1)  # Cambia el píxel negro a blanco"""
    self.display.show()
  
  def read_pixel(self, x, y):
    return self.display.pixel(x, y)
  
  def set_pixel(self, x, y, s):
    self.display.pixel(x, y, s)
    self.show()
  