# Crear tutoriales para tus alumnos

Un tutorial es un archivo `.json` con pasos. El simulador lo muestra igual que sus tutoriales propios: resalta lo que hay que tocar y marca ✓ cuando el alumno completa el paso.

## Cómo empezar

1. En el simulador abre 🎓 → **📥 Importar tutorial de un docente…** → **⬇ Descargar plantilla**.
2. Abre el archivo con cualquier editor de texto (Bloc de notas, VS Code…) y cambia textos, componentes y pines.
3. Pruébalo: 🎓 → Importar → **📂 Elegir archivo .json**. Si algo está mal, el simulador te dice qué campo y por qué.
4. Compártelo con tus alumnos:
   - **Archivo**: botón ⬇ junto al tutorial en el menú 🎓, y envía el `.json`.
   - **Link**: botón 🔗; quien lo abra verá primero qué contiene y decidirá si lo agrega.

Los tutoriales importados se guardan solo en el navegador de cada alumno. 🗑 los quita.

## Estructura

```json
{
  "format": "pitsim-tutorial",
  "formatVersion": 1,
  "id": "mi-tutorial",
  "title": "Mi tutorial",
  "author": "Prof. Ana López",
  "icon": "🔘",
  "description": "Qué van a aprender.",
  "steps": [ ... ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `id` | sí | minúsculas, números, `-` y `_` (máx. 40). Si importas otro con el mismo `id`, lo reemplaza. |
| `title` | sí | máx. 80 caracteres |
| `author`, `icon`, `description` | no | |
| `demoImage` | no | imagen PNG, GIF, JPEG o WEBP **embebida** (`data:image/gif;base64,...`), máx. ~1.5 MB. Se muestra como "🎬 Esto es lo que vas a lograr". |
| `demoCaption` | no | texto bajo la imagen |
| `steps` | sí | de 1 a 100 pasos |

## Pasos

```json
{
  "title": "Conecta el GND",
  "text": "Traza un cable desde un GND de la ESP32 hasta el GND del botón.",
  "highlight": { ... },
  "check": { ... },
  "actions": [ ... ]
}
```

El simulador numera los pasos solo ("Paso 3 — …").

### Pasos listos (`preset`)

`{ "preset": "newProject" }`, `"save"`, `"simulate"` o `"code"` arman los pasos de siempre (nuevo proyecto, guardar, simular, escribir código). Puedes cambiarles `title`, `text` o agregar `actions`.

### Cuándo se marca ✓ (`check`)

| `check` | Se cumple cuando… |
|---|---|
| `{ "type": "emptyCanvas" }` | el lienzo está vacío |
| `{ "type": "component", "component": "ky_004" }` | hay un KY-004 (`"count": 2` para pedir dos) |
| `{ "type": "wire", "from": {…}, "to": {…} }` | hay un cable entre esos dos pines |
| `{ "type": "running" }` | la simulación está corriendo |
| `{ "type": "saved" }` | el proyecto está guardado |
| `{ "type": "code" }` | hay código en el editor |

Un **pin** se describe con cualquiera de estos campos:

- `component`: tipo de componente (`esp32_wroom`, `ky_004`, `sg90`…).
- `pin`: id del pin (`gnd`, `vcc`, `senal`, `3v3`, `io12`…).
- `pinType`: `ground`, `power`, `gpio`, `signal`, `input` u `output`.
- `"gpioOutput": true`: cualquier GPIO de salida (excluye los de solo entrada y los de UART).

Ejemplo: `{ "component": "esp32_wroom", "pinType": "ground" }` es "cualquier GND de la ESP32".

### Qué se resalta (`highlight`)

- `{ "type": "component", "component": "sg90" }`: la tarjeta del panel y el componente en el lienzo.
- `{ "type": "pins", "pins": [ {…}, {…} ] }`: esos pines; cada uno necesita `component`.
- `{ "type": "ui", "target": "simulate" }`: un botón de la interfaz. Opciones: `newProject`, `save`, `simulate`, `editor`, `deviceSelect`, `blocks`, `phone`, `workspace`, `toolbox`.

### Botones del paso (`actions`, hasta 3)

- `{ "type": "insertCode", "code": "print('hola')" }`: pone ese código en el editor.
- `{ "type": "openBlocks", "xml": "<xml>…</xml>" }`: abre un programa en el editor de bloques. Para obtener el `xml`, arma el programa en 🧩 y guárdalo; luego pega el contenido del archivo.

Opcional: `"label"` para el texto del botón.

`"open": "projectMenu"` o `"open": "editor"` abre el menú Archivo o el editor al entrar al paso.

## Seguridad

- Un tutorial **solo contiene datos**: textos y opciones de las listas de arriba. No puede ejecutar nada en el navegador. Cualquier campo que no esté en esta guía hace que el archivo se rechace.
- El código de `insertCode` y `openBlocks` **nunca se ejecuta solo**: el alumno tiene que presionar ▶ Ejecutar, y corre dentro del simulador.
- No se aceptan imágenes externas ni SVG, para que nadie pueda rastrear a los alumnos ni esconder código en una imagen.
- Antes de agregar un tutorial, el simulador muestra quién lo creó y qué trae. Pide a tus alumnos que solo agreguen tutoriales de personas que conocen.

Ejemplos: [plantilla_boton.json](plantilla_boton.json) (usa todas las opciones), [servo_barrido.json](servo_barrido.json), [led_parpadeo.json](led_parpadeo.json).
