# Pruebas de estrés del puente (QEMU real)

Estas pruebas **no** corren con `npm test` -- a diferencia de
`tests/*.test.js` (lógica pura, sin QEMU, ver la descripción de
`package.json`), estas necesitan los binarios vendorizados reales
(`desktop/vendor/`) y el firmware compilado (`server/micropython.elf`,
`server/flash_image.bin`). Están pensadas para correrse **a mano,
antes de cortar un build nuevo para distribuir** (`3DPitSimu.exe` /
`3DPitSimu-Puente.exe`), no como parte del CI.

Nacieron de debuggear fallas reales reportadas por un docente usando
la app (2026-10-01): el botón "Simular"/"Detener" clickeado rápido
podía corromper un envío en curso y dejar la app sin aceptar
comandos; cargar un proyecto real a veces disparaba un repasteo
completo de HAL por un sondeo corrompido. Antes de esa sesión, cada
reproducción se armaba a mano de nuevo -- esto evita repetir ese
trabajo la próxima vez que algo similar se sospeche.

## Uso

```
node tests/stress/reconnect-race.js
```

El script arranca su propio `server.js` + QEMU + GDB (usando los
binarios de `desktop/vendor/`, igual que `bridge_core.py`), corre la
ráfaga de reconexiones, y lo apaga todo solo al terminar -- no hace
falta tener la app abierta primero. Si el puerto 8787/1234 ya está
ocupado por otra instancia (la app de escritorio corriendo, u otra
corrida de esta prueba que quedó colgada), el script lo va a decir
claramente en vez de fallar en silencio.

Tarda unos 30-40 segundos (incluye el boot real de QEMU + MicroPython).
Imprime un resumen al final: `RESULTADO: OK` o `RESULTADO: FALLÓ` con
el detalle de qué se detectó.

## Qué revisa

`reconnect-race.js` simula un usuario clickeando "Simular"/"Detener"
muy rápido y repetido (más agresivo que lo que un click humano real
logra) -- el escenario que **antes** de los fixes de 2026-10-01 podía:

1. Corromper bytes de un mensaje en tránsito (Ctrl+C directo pisando
   un trozo de un pegado en curso -- ver `rawStdinWrite()` en
   `server/server.js`).
2. Hacer que QEMU se cayera del todo bajo la carga (confirmado en la
   práctica: reproducible con el `server.js` de antes del fix, nunca
   con el actual).
3. Disparar un repasteo completo de HAL innecesario por un sondeo que
   no llegó a tiempo (ver `_probeWarmBoot()` en `js/ui/ReplPanel.js`).

El script falla (exit code 1) si detecta: el proceso de QEMU/Node
muriendo durante la prueba, un sondeo con el texto corrompido (pierde
caracteres de `_PIT_WARM_`), o un repasteo de HAL completo disparado
sin que debiera (el firmware ya lo tiene congelado).

## Qué NO cubre (limitaciones conocidas)

- **Pérdida de bytes de la UART emulada bajo carga real de la
  máquina** (confirmado en producción, no reproducido todavía de
  forma confiable en un script): la UART de QEMU no tiene control de
  flujo real y puede perder bytes si la máquina está ocupada (otras
  apps, OneDrive sincronizando, etc.) -- el pacing actual
  (`SEND_CHUNK_SIZE`/`SEND_CHUNK_DELAY_MS` en `server.js`) lo mitiga,
  no lo elimina. El reintento del sondeo (`_probeWarmBoot`, ver el fix
  de 2026-10-01) reduce el IMPACTO de esto (ya no dispara un repasteo
  caro por una pérdida chica), pero no evita la pérdida en sí. Si
  se vuelve a ver corrupción en el HAL/código del usuario (no en el
  sondeo), este es el sospechoso número uno.
- **Por qué el bridge QEMU a veces muere solo** en uso real y
  prolongado (confirmado en un log real: 2 caídas en 20 minutos de uso
  normal, sin ninguna ráfaga de clicks) -- se recupera solo gracias al
  watcher de `bridge_core.py`, pero la causa de fondo no se investigó
  a fondo todavía.
- **YA SE PROBÓ Y NO FUNCIONÓ**: envolver el repasteo grande de HAL
  "siempre presente" (`_base`/`_i2c_bus`/`_adc_bus`/`_uart_bus`) con el
  mismo checksum que protege el HAL por componente -- ver el
  comentario "REVERTIDO" en `ReplPanel._buildPendingHal()`. Empeoró
  las cosas (payload ~33% más grande por el base64, los 4 bloques
  fallando juntos). No repetir ese experimento sin una razón nueva.
