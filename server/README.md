# PitSimulator — Puente QEMU

Lanza QEMU (`qemu-system-xtensa`, fork de Espressif) con el firmware
MicroPython ya flasheado, lo conecta a GDB para inspeccionar cambios de
GPIO/I2C/ADC en tiempo real, y expone eso por WebSocket a
`js/simulator/QemuBridge.js` (el frontend, un nivel arriba).

Antes vivía en una carpeta separada; se trajo a este repo para poder
versionar cliente y servidor juntos.

## Requisitos

- Node.js (usa `ws` — ver `package.json`).
- `qemu-system-xtensa` (fork Espressif) en el PATH, o `QEMU_BIN`
  apuntando al binario.
- `xtensa-esp-elf-gdb` (el que instala ESP-IDF) en el PATH, o
  `GDB_BIN` apuntando al binario.
- `ESP32_GENERIC.bin`, `flash_image.bin`, `micropython.elf` en esta
  carpeta (no están versionados por tamaño — ver `.gitignore` en la
  raíz del repo — hay que copiarlos a mano si se clona el repo de
  cero).

## Uso

```bash
npm install
node server.js
```

Variables de entorno relevantes (todas opcionales, ver `CONFIG` al
principio de `server.js` para el detalle completo):

- `QEMU_BIN` / `GDB_BIN` — rutas a los binarios si no están en el PATH.
- `FLASH_IMAGE` — imagen de flash a usar (default `./flash_image.bin`).
- `MP_ELF` — ruta al `.elf` con símbolos de debug; sin esto, el bridge
  cae a polling de registros GPIO (no funciona en builds recientes de
  QEMU — ver el comentario grande en `server.js`).
- `VERBOSE=1` — logging detallado del polling.
- `DEBUG_BREAKPOINT=1` — modo diagnóstico (requiere `MP_ELF`).
- `PROBE_I2C=1` / `PROBE_ADC=1` — breakpoints de prueba para I2C/ADC.

## Seguridad

El WebSocket (puerto 8787 por default) le da a quien se conecte
control directo del stdin de QEMU — equivalente a ejecutar código en
la VM. Por eso:

- Escucha **solo en 127.0.0.1**, nunca en todas las interfaces de red.
- Valida el header `Origin` de cada conexión entrante — solo acepta
  `http://localhost:*` / `http://127.0.0.1:*`. Cualquier otro origen
  (una pestaña de otro sitio, un dispositivo en la misma red) se
  rechaza con 403.

Si alguna vez hace falta relajar esto (ej. acceder desde otra
máquina), hacerlo a propósito y explícitamente — no borrar estas
protecciones para "que ande más fácil".
