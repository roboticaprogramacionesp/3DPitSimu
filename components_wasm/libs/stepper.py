from machine import Pin
import time

class Motor:
    stepms = 10
    maxpos = 0
    states = []
    def __init__(self, p1, p2, p3, p4, stepms=None):
        self.pins = [p1, p2, p3, p4]
        if stepms is not None:
            self.stepms = stepms
        self._state = 0
        self._pos = 0
    @property
    def pos(self):
        return self._pos
    @classmethod
    def frompins(cls, *pins, **kwargs):
        return cls(*[Pin(pin, Pin.OUT) for pin in pins],
                   **kwargs)
    
    def reset(self):
        self._pos = 0
        
    def _step(self, dir):
        state = self.states[self._state]
        for i, val in enumerate(state):
            self.pins[i].value(val)
        self._state = (self._state + dir) % len(self.states)
        self._pos = (self._pos + dir) % self.maxpos

    def step(self, steps):
        dir = 1 if steps >= 0 else -1
        steps = abs(steps)
        for _ in range(steps):
            t_start = time.ticks_ms()
            self._step(dir)
            t_delta = time.ticks_diff(time.ticks_ms(), t_start)
            delay = self.stepms - t_delta
            if delay > 0:
                time.sleep_ms(delay)


    def step_until(self, target, dir=None):
        if target < 0 or target > self.maxpos:
            raise ValueError(target)
        if dir is None:
            dir = 1 if target > self._pos else -1
            if abs(target - self._pos) > self.maxpos / 2:
                dir = -dir
        while self._pos != target:
            self.step(dir)

    def step_until_angle(self, angle, dir=None):
        if angle < 0 or angle > 360:
            raise ValueError(angle)
        target = int(angle / 360 * self.maxpos)
        self.step_until(target, dir)

    def step_degrees(self, degrees):
        if degrees < 0 or degrees > 360:
            raise ValueError("Degrees should be between 0 and 360")
        steps_to_take = int(degrees / 360 * self.maxpos)
        self.reset()
        self.step(steps_to_take)


class FullStepMotor(Motor):
    stepms = 5
    maxpos = 2048
    states = [
        [1,1,0,0],
        [0,1,1,0],
        [0,0,1,1],
        [1,0,0,1],
    ]

class HalfStepMotor(Motor):
    stepms = 3
    maxpos = 4096
    states = [
        [1,0,0,0],
        [1,1,0,0],
        [0,1,0,0],
        [0,1,1,0],
        [0,0,1,0],
        [0,0,1,1],
        [0,0,0,1],
        [1,0,0,1],
    ]