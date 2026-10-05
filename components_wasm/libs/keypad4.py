from machine import Pin
from time import ticks_ms, ticks_diff, sleep_ms


class Keypad:
    def __init__(self, keymap=None, row_pins=None, column_pins=None, num_rows=4, num_cols=4):
        """
        Inicializa el teclado matricial.
        """
        self._keymap = keymap or [
            '1', '2', '3', 'A',
            '4', '5', '6', 'B',
            '7', '8', '9', 'C',
            '*', '0', '#', 'D'
        ]

        self._row_pins = [
            Pin(pin, Pin.IN, Pin.PULL_UP)
            for pin in (row_pins or [26, 25, 17, 16])
        ]

        self._column_pins = [
            Pin(pin, Pin.OUT)
            for pin in (column_pins or [27, 14, 12, 13])
        ]

        self._num_rows = num_rows
        self._num_cols = num_cols

        self._prev_key = None
        self._debounce_time = 400  # ms
        self._prev_time = 0

        # Inicializa columnas en alto
        for col_pin in self._column_pins:
            col_pin.value(1)

    def get_key(self):
        """
        Escanea el teclado y devuelve la tecla presionada si hay una.
        Aplica debounce.
        """
        for col_index, col_pin in enumerate(self._column_pins):
            col_pin.value(0)  # Activa columna

            # BUG REAL (reportado en vivo: el teclado nunca detectaba
            # ninguna tecla) -- en el runtime WASM del simulador, un
            # cambio de GPIO manejado por el simulador (acá: la fila
            # que depende de esta columna) sólo puede llegar a este
            # script durante un yield de Asyncify (adentro de un
            # sleep()), nunca en medio de código síncrono -- ver
            # components_wasm/_base_wasm.py y WasmBridge.js. Sin este
            # sleep_ms(), row_pin.value() de abajo siempre leía el
            # estado de ANTES de poner esta columna en bajo -- la
            # tecla nunca se detectaba. 20ms sigue siendo imperceptible
            # para quien aprieta una tecla, pero le da margen real al
            # viaje de ida y vuelta por postMessage entre el Worker y
            # el hilo principal (confirmado en vivo: con 1ms el valor
            # de la fila llegaba tarde, a destiempo con la SIGUIENTE
            # columna, leyendo la tecla de al lado).
            sleep_ms(20)

            for row_index, row_pin in enumerate(self._row_pins):
                if not row_pin.value():  # Activo en bajo
                    key = self._keymap[row_index * self._num_cols + col_index]

                    current_time = ticks_ms()

                    if (
                        self._prev_key != key or
                        ticks_diff(current_time, self._prev_time) > self._debounce_time
                    ):
                        self._prev_key = key
                        self._prev_time = current_time
                        col_pin.value(1)
                        return key

            col_pin.value(1)  # Desactiva columna

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