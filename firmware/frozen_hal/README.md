# PitSimulator — HAL congelado en el firmware

Esta carpeta contiene las variantes **congeladas** (compiladas dentro
del firmware MicroPython, en vez de pasteadas por el REPL en cada
sesión de QEMU) de los archivos `.hal.py` que normalmente vive cada
uno en `components/<tipo>/<tipo>.hal.py`.

## Qué se congela y qué no

- **`boot.py`** — SÍ se congela (a diferencia de `boot_snippet.py`,
  que es solo una referencia). MicroPython corre automáticamente un
  `boot.py` congelado como fallback cuando el filesystem de flash no
  tiene uno propio (comportamiento estándar de la mayoría de los
  puertos, incluido esp32) -- esto evita tener que escribirlo al
  filesystem en caliente, algo que resultó frágil en la práctica
  (corrupción de transmisión reproducible en pastes largos, mismo
  problema ya documentado para el HAL por componente). Si alguna vez
  el filesystem de flash SÍ tiene su propio `boot.py` real, ese gana
  -- el fallback congelado solo aplica cuando no hay ninguno.
- **`_pit_base.py`, `_pit_i2c_bus.py`, `_pit_adc_bus.py`,
  `_pit_uart_bus.py`** — los 4 módulos "siempre presentes". Los
  importa **incondicionalmente** `boot.py` (congelado, ver arriba):
  cualquier proyecto los necesita, sin importar qué haya en el canvas.
- **`_pit_frozen_components.py`** — un módulo inerte, solo declara
  `FROZEN_TYPES = frozenset([...])`. También se importa
  incondicionalmente (es solo una lista, cero riesgo). `ReplPanel.js`
  lo consulta al conectar para saber qué HAL de componente puede pedir
  por `import` (rápido) en vez de por paste-mode (lento).
- **`components/_pit_hal_<tipo>.py`** — un archivo por cada
  `components/<tipo>/<tipo>.hal.py` que tiene código real (no los
  "marcadores" solo-comentario, como `led.hal.py`). Estos **NO se
  importan solos en `boot.py`** — se importan on-demand, uno por uno,
  cuando `ReplPanel.js` los pide, exactamente con la misma
  selectividad de hoy (solo lo que está en el canvas de ESTE
  proyecto). Ver el porqué en el comentario grande de
  `boot_snippet.py`: varios componentes comparten dirección I2C por
  defecto (`bmp180`/`bmp280` en `0x77`, `ds3231`/`mpu6050` en `0x68`)
  — importarlos todos sin condición rompería cualquier proyecto que
  use uno solo de los dos.

Todos los archivos de esta carpeta (excepto este README y
`build_components.js`) son **generados o casi-generados** — no editar
`components/_pit_hal_*.py` ni `_pit_frozen_components.py` a mano,
salen de correr:

```bash
node firmware/frozen_hal/build_components.js
```

cada vez que cambie algún `.hal.py` real. `_pit_base.py`/
`_pit_i2c_bus.py`/`_pit_adc_bus.py`/`_pit_uart_bus.py` sí son a mano
(copias curadas, no generadas por este script) — si el `.hal.py`
original de esos 4 cambia, hay que actualizarlos manualmente siguiendo
el mismo patrón (copia íntegra + el import que haga falta).

## Trade-off importante

Una vez congelado, **una edición a `components/<tipo>/<tipo>.hal.py`
no se ve hasta recompilar y reflashear el firmware** (hoy, sin
congelar, es instantáneo — cada "▶ Ejecutar" vuelve a hacer `fetch()`
del archivo real). Mientras se itera sobre un HAL puntual, conviene
forzar el camino dinámico de siempre desde la consola del navegador:

```js
localStorage.setItem("pit_hal_dev_mode", "1"); // fuerza fetch+paste para TODOS los tipos
// localStorage.removeItem("pit_hal_dev_mode"); // para volver al camino rápido
```

## Cómo regenerar y compilar el firmware

El freeze real NO edita `ports/esp32/boards/manifest.py` (eso queda
intacto, para no afectar builds normales de esa board) -- usa un
manifest **separado**, `~/projects/pitsimulator_manifest.py`, que
incluye el manifest normal de la board y le suma el/los `freeze()` de
este simulador, pasado por `make` vía la variable `FROZEN_MANIFEST`:

```bash
# 1. Regenerar los .py a partir de los .hal.py actuales del repo:
node firmware/frozen_hal/build_components.js

# 2. Copiarlos al lado de los que ya tenías congelados:
mkdir -p ~/projects/pitsimulator_frozen_hal/components
cp firmware/frozen_hal/*.py ~/projects/pitsimulator_frozen_hal/
cp firmware/frozen_hal/components/*.py ~/projects/pitsimulator_frozen_hal/components/

# 3. ~/projects/pitsimulator_manifest.py ya tiene la freeze() nueva
#    para components/ (agregada al lado de la que ya tenías para los
#    4 base) -- no hace falta tocar nada más ahí. OJO: la freeze() de
#    la carpeta base usa una LISTA EXPLÍCITA de archivos (no el
#    directorio completo) -- si se deja sin la lista, MicroPython
#    recorre components/ solo y todo se congela DOS VECES (bug real
#    ya encontrado, confirmado con help('modules') mostrando cada
#    tipo duplicado).

# 4. Recompilar -- mismo BOARD/USER_C_MODULES que ya veías usando en
#    tu .bash_history, sumando FROZEN_MANIFEST apuntando al manifest
#    separado (si tu build normal no usa USER_C_MODULES para
#    st7789, omitilo):
cd ~/projects/micropython-v1.28/ports/esp32
make BOARD=ESP32_GENERIC \
     FROZEN_MANIFEST=/home/pitergr/projects/pitsimulator_manifest.py \
     USER_C_MODULES=/home/pitergr/projects/st7789_mpy/st7789/micropython.cmake \
     CFLAGS_EXTRA='-Wno-error' -j4
```

El `.elf`/`.bin` resultante reemplaza a `server/micropython.elf` /
`server/flash_image.bin` (los que usa `server/server.js` hoy, ver
`server/README.md`).

## Casos out-of-scope (ya existían antes de esto, no los crea el freeze)

- `lcd_16x2_i2c.hal.py` hace `from lcd_api import LcdApi` — un archivo
  que el alumno sube por su cuenta, no vive en este repo. Si no está
  disponible, el mismo `ImportError` que hoy pasaría en paste-mode
  pasa igual, solo que ahora lo atrapa el `try/except` del import
  congelado en `ReplPanel._wrapFrozenImport()`.
- Colisión de direcciones I2C (`bmp180`/`bmp280` en `0x77`,
  `ds3231`/`mpu6050` en `0x68`): ya existe HOY en el sistema dinámico
  si un proyecto pone ambos en el mismo canvas (`_i2c_bus.hal.py`
  tiene un solo mapa por dirección, gana el que se registra último).
  Este freeze no lo arregla ni lo empeora — solo evita agravarlo
  manteniendo la carga on-demand por canvas en vez de importar todo
  sin condición al bootear.
