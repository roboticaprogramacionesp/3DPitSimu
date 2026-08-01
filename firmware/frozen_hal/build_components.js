// =============================================================
// PitSimulator — firmware/frozen_hal/build_components.js
//
// Genera, a partir de cada components/<type>/<type>.hal.py que tenga
// código real (no los "marcadores" solo-comentario, ver hasRealCode()
// -- mismo criterio que ya usa ReplPanel._buildPendingHal()), una
// copia congelable en firmware/frozen_hal/components/_pit_hal_<type>.py
// -- idéntica al original salvo por los imports explícitos que
// necesite (ver el comentario grande más abajo, mismo patrón ya
// probado en _pit_i2c_bus.py/_pit_base.py).
//
// También escribe firmware/frozen_hal/_pit_frozen_components.py con
// la lista de qué tipos se generaron (FROZEN_TYPES) -- lo lee
// ReplPanel.js en runtime (un probe de una línea al conectar) para
// saber, tipo por tipo, si el firmware conectado tiene ese HAL
// congelado (manda "import _pit_hal_<tipo>", rápido) o no (sigue
// pasteando el .hal.py completo, como siempre).
//
// Uso: node firmware/frozen_hal/build_components.js
// Reproducible: correr de nuevo después de cualquier cambio a un
// .hal.py y volver a compilar el firmware (ver README.md de esta
// carpeta) -- este script NUNCA se edita a mano su salida.
//
// Por qué hacen falta imports explícitos: pasteado por paste-mode
// (como hoy), un .hal.py se ejecuta con exec(codigo, globals()) DENTRO
// del namespace global del REPL, donde register_i2c_device/Pin/etc.
// ya están disponibles porque _base/_i2c_bus/_adc_bus/_uart_bus se
// cargaron antes en ESE MISMO namespace. Congelado como módulo real
// (import normal), en cambio, el archivo tiene su PROPIO namespace --
// sin el import explícito, cualquier nombre "prestado" del HAL
// compartido tira NameError apenas se importe.
// =============================================================

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COMPONENTS_DIR = path.join(REPO_ROOT, "components");
const OUT_DIR = path.join(__dirname, "components");
const MANIFEST_OUT = path.join(__dirname, "_pit_frozen_components.py");

// _base/_i2c_bus/_adc_bus/_uart_bus ya se congelan aparte (a mano,
// _pit_base.py etc. en esta misma carpeta) -- nunca pasan por acá.
const ALWAYS_FROZEN = new Set(["_base", "_i2c_bus", "_adc_bus", "_uart_bus"]);

// Nombre "prestado" -> de qué módulo congelado importarlo. Los
// primeros 5 son los que boot_snippet.py ya expone como globals del
// REPL en el camino pasteado (register_line_handler/poll_input/
// _settle/register_i2c_device/register_adc_default) -- los últimos 4
// son las CLASES que esos mismos archivos parchean sobre `machine`
// (Pin/I2C/ADC/UART), que un .hal.py puede usar sueltas sin
// importarlas él mismo (caso real encontrado: hcsr04.hal.py usa
// Pin(...) adentro de un método, confiando en que para cuando se
// LLAMA ese método -- recién cuando el código del alumno instancia
// HCSR04(...) -- su propio "from machine import Pin" ya corrió en el
// mismo namespace del REPL; congelado como módulo aparte esa
// casualidad de orden desaparece).
const NAME_SOURCES = {
    register_line_handler: "_pit_base",
    poll_input: "_pit_base",
    _settle: "_pit_base",
    Pin: "_pit_base",
    register_i2c_device: "_pit_i2c_bus",
    I2C: "_pit_i2c_bus",
    register_adc_default: "_pit_adc_bus",
    ADC: "_pit_adc_bus",
    UART: "_pit_uart_bus",
};

function hasRealCode(text) {
    return text.split("\n").some((line) => {
        const t = line.trim();
        return t && !t.startsWith("#");
    });
}

// ¿El archivo usa NAME como identificador suelto en algún lado? Regex
// simple a propósito (ver el comentario del plan) -- un falso
// positivo (ej. "ADC" mencionado en un comentario) en el peor caso
// agrega un import de más, sin uso, inofensivo. Lo que hay que evitar
// es el falso NEGATIVO (un NameError real al frozen).
function usesBareName(text, name) {
    const re = new RegExp(`(?<![\\w.])${name}\\b`);
    return re.test(text);
}

// ¿El archivo ya define o importa este nombre por su cuenta? Si es
// así, no hace falta (ni conviene) agregarle un import nuestro encima
// -- cubre las 5 clases/funciones que SON _base/_i2c_bus/_adc_bus
// (ej. no queremos agregarle "from _pit_i2c_bus import register_i2c_device"
// al propio _pit_i2c_bus.py si algún día este script se corriera
// sobre esa carpeta por error).
function alreadyProvides(text, name) {
    const patterns = [
        new RegExp(`^\\s*def\\s+${name}\\b`, "m"),
        new RegExp(`^\\s*class\\s+${name}\\b`, "m"),
        new RegExp(`^\\s*import\\s+${name}\\b`, "m"),
        new RegExp(`^\\s*from\\s+\\S+\\s+import\\s+.*\\b${name}\\b`, "m"),
        new RegExp(`^\\s*${name}\\s*=`, "m"),
    ];
    return patterns.some((re) => re.test(text));
}

function detectNeededImports(text) {
    return Object.keys(NAME_SOURCES).filter(
        (name) => usesBareName(text, name) && !alreadyProvides(text, name)
    );
}

function buildImportBlock(names) {
    const bySource = {};
    for (const name of names) {
        const src = NAME_SOURCES[name];
        (bySource[src] = bySource[src] || []).push(name);
    }
    return Object.keys(bySource)
        .sort()
        .map((src) => `from ${src} import ${bySource[src].sort().join(", ")}`)
        .join("\n");
}

// "-" no es válido en un identificador Python (ej. "ky-018") -- el
// prefijo "_pit_hal_" de paso vuelve válido cualquier type que
// empiece con dígito (ej. "28byj" -> "_pit_hal_28byj").
function sanitizeType(type) {
    return type.replace(/-/g, "_");
}

function main() {
    const types = fs
        .readdirSync(COMPONENTS_DIR)
        .filter((name) => fs.statSync(path.join(COMPONENTS_DIR, name)).isDirectory())
        .sort();

    fs.mkdirSync(OUT_DIR, { recursive: true });
    // Limpiar la generación anterior -- si un componente cambió de
    // "marcador" a "con código" (o viceversa, o se borró), no
    // queremos dejar un _pit_hal_<tipo>.py viejo colgado sin nadie
    // que lo referencie en FROZEN_TYPES.
    for (const f of fs.readdirSync(OUT_DIR)) {
        if (f.endsWith(".py")) fs.unlinkSync(path.join(OUT_DIR, f));
    }

    const frozenTypes = [];

    for (const type of types) {
        if (ALWAYS_FROZEN.has(type)) continue;

        const halPath = path.join(COMPONENTS_DIR, type, `${type}.hal.py`);
        if (!fs.existsSync(halPath)) continue; // ej. esp32_wroom -- es el host, no un periférico

        const original = fs.readFileSync(halPath, "utf8");
        if (!hasRealCode(original)) continue; // marcador solo-comentario -- se omite a propósito

        const needed = detectNeededImports(original);
        const importBlock = needed.length ? buildImportBlock(needed) + "\n\n" : "";

        const modName = `_pit_hal_${sanitizeType(type)}`;
        const header =
            `# =============================================================\n` +
            `# PitSimulator — HAL "${type}" (VARIANTE CONGELADA, generada)\n` +
            `#\n` +
            `# Generado por firmware/frozen_hal/build_components.js a partir de\n` +
            `# components/${type}/${type}.hal.py -- NO EDITAR A MANO. Cualquier\n` +
            `# cambio real va en el .hal.py original; después correr\n` +
            `# "node firmware/frozen_hal/build_components.js" de nuevo y\n` +
            `# recompilar el firmware (ver firmware/frozen_hal/README.md).\n` +
            `#\n` +
            `# Único agregado real respecto al original: el/los import(s) de\n` +
            `# abajo -- ver el comentario grande en build_components.js sobre\n` +
            `# por qué hacen falta (namespace propio de módulo vs. exec() en\n` +
            `# el namespace global del REPL, que es como corre hoy pasteado).\n` +
            `# =============================================================\n\n`;

        fs.writeFileSync(path.join(OUT_DIR, `${modName}.py`), header + importBlock + original, "utf8");
        frozenTypes.push(type);
    }

    const manifestText =
        `# =============================================================\n` +
        `# PitSimulator — lista de tipos de componente con HAL congelado.\n` +
        `#\n` +
        `# Generado por build_components.js -- NO EDITAR A MANO. ReplPanel.js\n` +
        `# lo lee vía un probe de una línea al conectar (ver\n` +
        `# _resyncHalAfterBoot()/FROZEN_PROBE_MARK) para saber, tipo por\n` +
        `# tipo, si puede mandar "import _pit_hal_<tipo>" (rápido) en vez de\n` +
        `# pastear el .hal.py completo por paste-mode (lento).\n` +
        `#\n` +
        `# Módulo INERTE a propósito -- solo este frozenset, nada más -- se\n` +
        `# importa incondicionalmente en boot.py (ver boot_snippet.py), sin\n` +
        `# ningún riesgo de colisión. Los módulos de componente en sí\n` +
        `# (components/_pit_hal_*.py) NO se importan acá ni en boot.py --\n` +
        `# varios comparten dirección I2C por defecto (ej. bmp180/bmp280 en\n` +
        `# 0x77, ds3231/mpu6050 en 0x68) y solo tiene sentido cargar el HAL\n` +
        `# de lo que el proyecto ACTUAL tiene realmente en el canvas --\n` +
        `# ReplPanel.js sigue decidiendo eso, igual que en el camino\n` +
        `# pasteado de siempre, con este frozenset solo como "menú" de qué\n` +
        `# puede pedir por import en vez de por paste.\n` +
        `# =============================================================\n\n` +
        `FROZEN_TYPES = frozenset([\n` +
        frozenTypes.map((t) => `    ${JSON.stringify(t)},`).join("\n") +
        `\n])\n`;

    fs.writeFileSync(MANIFEST_OUT, manifestText, "utf8");

    console.log(`Generados ${frozenTypes.length} módulos en ${path.relative(REPO_ROOT, OUT_DIR)}`);
    console.log(frozenTypes.join(", "));
}

main();
