import framebuf
from random import choice

class ezFBmarquee:
  def __init__(self, display, font, x=0, y=0, width=None, mode='marquee',
             pad=0.33, pause=0, hgap=0, fg=1, bg=0, cswap=False,
             verbose=False, change_color=False, move='left', color_list=None):
    self._device = display
    self._font = font
    self._x = x
    self._y = y
    self._mode = self._checkmode(mode)
    self._pad = max(pad, 0)
    self._dpause = self._pause = max(-1, int(pause))
    self._hgap = int(hgap)
    self._fg = fg
    self._bg = bg
    self._move = move
    self._cswap = cswap
    self._verbose = verbose
    self.change_color = change_color
    self.color_list = color_list or [0x4208, 0x001f, 0x0400, 0x0410, 0x041f, 0x07e0, 0x07ff, 0x8000, 0x8010]
    self.name = f'marquee_{self._font.__name__}'
    self.string = None
    self._font_format = framebuf.MONO_HLSB
    self._font_colors = 2
    self._palette_format = framebuf.RGB565
    self._palette_buf = bytearray(self._font_colors * 2)
    self._palette = framebuf.FrameBuffer(self._palette_buf, self._font_colors, 1, self._palette_format)
    self._height = self._font.height()+2
    if width is None:
      self._width = self._device.width - self._x
    else:
      self._width = width
    outbytes = ((self._width - 1) // 8) + 1
    self._outbuf = bytearray(outbytes * self._height)
    self._outframe = framebuf.FrameBuffer(self._outbuf, self._width, self._height, self._font_format)
    if self._verbose:
      print(f"{self.name}: init()")
      print(f"  x: {self._x}, y: {self._y}, height: {self._height}, width: {self._width}")
      print(f"  pad: {self._pad}, default pause: {self._dpause}, hgap: {self._hgap}")
      print(f"  fg: {self._fg}, bg: {self._bg}")

  def _checkmode(self, mode):
    if mode not in ('marquee', 'scroller'):
      raise ValueError(f"{self.name}: unknown mode '{mode}'")
    return mode

  def _line_size(self, string, hgap):
    width = 0
    self._missing = []
    for char in string:
      glyph, _, char_width = self._font.get_ch(char)
      if glyph is None:
        self._missing.append(char)
      else:
        width += char_width + hgap
    return width - hgap if width > 0 else 0

  def _put_char(self, char, x, y, hgap):
    glyph, char_height, char_width = self._font.get_ch(char)
    
    if glyph is None:
      return 0

    buf = bytearray(glyph)
    charbuf = framebuf.FrameBuffer(buf, char_width, char_height, self._font_format)

    self._scrollframe.blit(charbuf, x, y, 0)

    if self._move in ('up', 'down'):
      return char_height + hgap
    else:
      return char_width + hgap

  def _prepare_scroll_frame(self, string, hgap, pad, move, mode):
    self._stringwidth = max(self._line_size(string, hgap), 1)
    if move in ('left', 'right'):
      self._padding = int(self._width * pad)
      self._sbwide = self._stringwidth + self._padding + self._width
      self._sheight = self._height
    elif move in ('up', 'down'):
      self._padding = int(self._height * pad)
      self._sbwide = self._width
      self._sheight = (self._height + hgap) * len(string)
    sbbytes = ((self._sbwide - 1) // 8) + 1
    self._scrollbuf = bytearray(sbbytes * self._sheight)
    self._scrollframe = framebuf.FrameBuffer(self._scrollbuf, self._sbwide, self._sheight, self._font_format)
    xpos, ypos = 0, 0
    for c in string:
      if self.change_color:
        self.change_fg(choice(self.color_list))
      if move in ('left', 'right'):
        xpos += self._put_char(c, xpos, 0, hgap)
      else:
        ypos += self._put_char(c, 0, ypos, hgap)
    
    if move in ('left', 'right'):
      self._start = 0
      self._end = xpos
    else:
      self._start = -self._height
      self._end = ypos
      
    self._stepping = True


  def start(self, string, mode=None, pause=None, pad=None, hgap=None, fg=None, bg=None, move=None):
    if self.string is not None:
      self.stop()
    if self._width == 4:
      string = '   ' + string + '  '
    else:
      string = '  ' + string + '  '
    self._mode = self._checkmode(mode or self._mode)
    self._pause = self._dpause if pause is None else max(-1, int(pause))
    self._pad = self._pad if pad is None else max(pad, 0)
    self._hgap = self._hgap if hgap is None else int(hgap)
    self._fg = self._fg if fg is None else fg
    self._bg = self._bg if bg is None else bg
    self._move = self._move if move is None else move
    self._palette.pixel(0, 0, self.swap_bytes(self._bg))
    self._palette.pixel(self._font_colors - 1, 0, self.swap_bytes(self._fg))
    self._prepare_scroll_frame(string, self._hgap, self._pad, self._move, self._mode)
    
    self.string = string
    self._count = self._start
    self.step(1)
    if self._verbose:
      print(f"{self.name}: start()")
      print(f"  string width: {self._stringwidth}px")
      if self._missing:
        print(f"  Missing glyphs: {sorted(set(self._missing))}")

  def step(self, steps=1):
    if self.string is None:
      return False
    #print('step')

    steps = max(0, min(steps, max(self._width, self._height)))
    res = False
    if self._pause == 0 and steps > 0:
      self._count += steps
      if self._count > self._end:
        self._count = self._start
        res = True
      if self._stepping:
        if self._move == 'left':
          self._outframe.blit(self._scrollframe, -self._count, 0)
        elif self._move == 'right':
          self._outframe.blit(self._scrollframe, -self._end + self._count, 0)
        elif self._move == 'up':
          self._outframe.blit(self._scrollframe, 0, -self._count)
        elif self._move == 'down':

          self._outframe.blit(self._scrollframe, 0, self._count - self._end)

    self._device.blit(self._outframe, self._x, self._y, -1, self._palette)
    self._pause = -1 if self._pause == -1 else max(0, self._pause - 1)
    return res

  def stop(self):
    self.string = None
    self._count = 0
    self._stepping = False
    del self._scrollframe, self._scrollbuf
    self._outframe.fill(0)
    self._device.rect(self._x, self._y, self._width, self._height, self._bg, True)
    if self._verbose:
      print(f"{self.name}: stop()")

  def pause(self, pause):
    self._pause = max(-1, int(pause))

  def active(self):
    return self.string is not None

  def change_fg(self, fg):
    self._palette.pixel(0, 0, self.swap_bytes(self._bg))
    self._palette.pixel(self._font_colors - 1, 0, self.swap_bytes(fg))

  def swap_bytes(self, color):
    return ((color & 0xFF) << 8) + (color >> 8) if self._cswap else color

