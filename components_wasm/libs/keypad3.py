from machine import Pin
from time import ticks_ms, ticks_diff, sleep_ms

class Keypad:
    def __init__(self, keymap=None, row_pins=None, column_pins=None, num_rows=4, num_cols=3):
        """
        Inicializa el teclado matricial 4x3.
        """
        self._keymap = keymap or ['1', '2', '3',
                                  '4', '5', '6',
                                  '7', '8', '9',
                                  '*', '0', '#']

        self._row_pins = [Pin(pin, Pin.IN, Pin.PULL_UP) for pin in (row_pins or [26, 25, 17, 16])]
        self._column_pins = [Pin(pin, Pin.OUT) for pin in (column_pins or [27, 14, 12])]

        self._num_rows = num_rows
        self._num_cols = num_cols

        self._prev_key = None
        self._debounce_time = 400
        self._prev_time = 0

        # Inicializa columnas en alto
        for col_pin in self._column_pins:
            col_pin.value(1)

    def get_key(self):
        """
        Escanea el teclado y devuelve la tecla presionada si hay una.
        """
        for col_index, col_pin in enumerate(self._column_pins):
            col_pin.value(0)

            # Ver el mismo comentario en keypad4.py (libs/keypad4.py)
            # -- sin este sleep_ms(), el Worker nunca tiene ventana
            # para aplicarle a row_pin el valor ya actualizado antes
            # de leerlo, y la tecla nunca se detecta. 20ms confirmado
            # en vivo como el mínimo que no queda a destiempo con la
            # columna siguiente.
            sleep_ms(20)

            for row_index, row_pin in enumerate(self._row_pins):
                if not row_pin.value():
                    key = self._keymap[row_index * self._num_cols + col_index]

                    current_time = ticks_ms()
                    if self._prev_key != key or ticks_diff(current_time, self._prev_time) > self._debounce_time:
                        self._prev_key = key
                        self._prev_time = current_time
                        col_pin.value(1)
                        return key

            col_pin.value(1)

        return None

    def set_debounce_time(self, time_ms):
        """
        Cambia el tiempo de rebote.
        """
        self._debounce_time = time_ms

    def reset(self):
        """
        Reinicia el estado del teclado.
        """
        self._prev_key = None
        self._prev_time = 0