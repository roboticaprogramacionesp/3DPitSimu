# PitSimulator

PitSimulator es un prototipo de simulador visual de componentes electrónicos para experimentar con conexiones, pines y lógica básica sin necesidad de hardware físico.

## Estructura general

- [index.html](index.html): punto de entrada de la interfaz.
- [js/simulator](js/simulator): lógica principal del motor de simulación, renderizado, gestión de componentes y cables.
- [css](css): estilos del tablero, cuadrícula, paneles y componentes.
- [components](components): definiciones de componentes en formato JSON y archivos auxiliares de hardware.

## Recomendaciones de mantenimiento

- Mantener la lógica de simulación separada de la UI para que agregar nuevas piezas no requiera tocar múltiples capas.
- Conviene que cada componente nuevo tenga su propio JSON y, si aplica, su propio archivo de renderizado o lógica asociada.
- Los cables deberían seguir un patrón de routing ortogonal y reutilizable para evitar que cada mejora introduzca inconsistencias visuales.

## Próximos pasos sugeridos

1. Centralizar el estado de los componentes en un modelo único y claro.
2. Añadir pruebas básicas para el renderizado y el manejo de conexiones.
3. Introducir una capa de estilos por tema para facilitar la evolución visual del proyecto.


# Tests de la lógica pura del simulador

Cubre las partes de `SignalEngine`, `Utils` y `Component` que **no dependen del
DOM, del navegador ni de QEMU** — se pueden correr con Node solo, sin abrir
`index.html` ni levantar `server.js`.

## Cómo correrlos

```bash
npm test
```

(usa `node --test`, incluido en Node ≥ 18 — no hace falta instalar Jest,
Mocha ni nada más)

## Qué cubre hoy

- **`tests/signalEngine.test.js`** — `getNet` (BFS sobre cables + botones
  presionados), `isKeyConnectedToHighDriver`, `isKeyConnectedToGnd`,
  `isComponentPowered`, `evaluateLed`. Incluye un test que **documenta a
  propósito** un comportamiento no definido: dos drivers en conflicto sobre
  la misma net (cortocircuito real) hoy no se detecta. No es un bug — es una
  decisión de diseño pendiente, dejada visible para que no se cuele por
  sorpresa en un refactor futuro.
- **`tests/utils.test.js`** — `snapToGrid` (incluye test de regresión del
  bug de división por cero con `gridSize=0` que ya está resuelto en el
  código real, para que no vuelva), `computeElbow`, `normalizeHex`,
  `lightenColor`, `clamp`, `generateId`.
- **`tests/component.test.js`** — `getPinPosition` con rotación, flip, y
  ambos combinados (es la matemática más fácil de romper sin darse cuenta
  en un refactor de `Component.js`, y no tenía ningún test). Incluye test
  de regresión del bug `x=0` (`||` vs `??`) ya corregido en el código real.

## `lib/SignalEngineCore.js` — por qué existe

Es una copia **textual** (sin reescribir ni una línea) de los métodos de
`SignalEngine.js` que no tocan `renderer`/DOM. Se separó así por dos
motivos:

1. Para poder testear el algoritmo de resolución de red (`getNet`) con
   Node puro, sin mockear todo un navegador.
2. Porque separar el motor de señales del renderizado es, de todas formas,
   uno de los refactors sugeridos para cuando el proyecto crezca (ver
   `ComponentBehaviorRegistry` en la conversación de diseño) — este archivo
   es, en chiquito, la prueba de que esa separación es viable sin romper
   nada: los 15 tests de `signalEngine.test.js` pasan exactamente igual
   con la lógica aislada del resto.

**Importante**: si `SignalEngine.js` cambia alguno de estos métodos en el
código real, `lib/SignalEngineCore.js` hay que actualizarlo a mano para que
siga siendo un espejo fiel — no está importado automáticamente del archivo
real (para no arrastrar sus dependencias de `window`/DOM). El paso
siguiente natural es que estos métodos vivan en su propio archivo sin
mezcla de DOM en el proyecto real, y ahí `lib/SignalEngineCore.js` deja de
hacer falta: se importa directo.

## Qué falta cubrir (siguiente prioridad sugerida)

- `evaluateL298n` / `_computeL298nMotorState` (lógica de puente H, tiene
  varias combinaciones IN1/IN2/enable que se prestan a tests de tabla).
- `isWiredToDeclaredPins` (la validación de PININFO contra el cableado
  real).
- `WireManager.movePointWithConstraint` / `Utils.buildOrthogonalPoints`
  (geometría de ruteo de cables).
