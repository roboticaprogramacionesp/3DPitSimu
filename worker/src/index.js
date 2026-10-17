/*
==========================================================
 PitSimulator — worker/src/index.js
 Backend chiquito para links CORTOS de verdad (botón 🔗, ver
 js/ui/ShareProject.js), mismo mecanismo que usa MakeCode/micro:bit
 para "Compartir": NO es un acortador de URLs (Bitly/TinyURL) -- es
 un guardado propio (key -> blob) con un ID random corto. MakeCode
 llama a esto su "pxt-cloud"; este archivo es el equivalente mínimo
 para PitSimulator, corriendo gratis en Cloudflare Workers + KV.

 Rutas:
   POST /share        body = el string comprimido -> { id }
   GET  /share/:id     -> el string comprimido guardado (o 404)

 Seguridad -- qué protege esto y qué NO:

 - RATE LIMIT por IP en POST (ver checkRateLimit): esto SÍ frena abuso
   real -- un script mandando miles de POST llenaría las 1,000
   escrituras/día gratis de KV en minutos, dejando a cualquier alumno
   sin poder compartir ese día. Nota la limitación: el contador vive
   en el mismo KV (lectura+escritura no atómica) -- alguien mandando
   pedidos en paralelo muy rápido podría colarse un poco por encima
   del límite. Suficiente para frenar abuso casual, no a un atacante
   decidido (para eso existe Cloudflare Turnstile, ver README.md).

 - VALIDACIÓN del contenido en POST (ver isValidProjectBlob): sin
   esto, cualquiera podía usar este endpoint como hosting gratis de
   CUALQUIER blob random (nada que ver con PitSimulator) -- ahora
   solo se guarda si descomprime (DEFLATE) y da un JSON con la forma
   de un proyecto real (mismo chequeo que ProjectManager.deserialize()
   del lado del navegador: version "1.0" + arrays de components/wires).

 - CORS con comodín ("*") a propósito, y NO es un error de seguridad:
   el comodín en Access-Control-Allow-Origin solo controla si el
   JAVASCRIPT de una página puede LEER la respuesta -- no evita que
   el POST se reciba y se guarde (eso ya lo frenan el rate limit y la
   validación de arriba). Restringir el origen acá daría una falsa
   sensación de seguridad sin frenar nada real, por eso no se hace.
   El contenido en sí es público para quien tenga el ID por diseño --
   mismo modelo que un link de MakeCode o Pastebin, es EL feature.

 Ver worker/README.md para los pasos de deploy (cuenta de Cloudflare,
 namespace de KV, wrangler deploy) -- eso Claude no lo puede hacer
 por vos (hace falta login interactivo), así que queda documentado
 paso a paso ahí.
==========================================================
*/

// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) -- un ID que alguien
// tiene que poder leer/tipear a mano alguna vez (aunque el camino
// normal sea copiar/pegar o escanear el QR) no debería tener esa
// trampa.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ID_LENGTH = 8;

// Tope de tamaño del blob guardado (en bytes, el string comprimido
// que manda el navegador) -- generoso para cualquier proyecto real
// (ver las pruebas en ShareProject.js: hasta un proyecto sintético
// de 16 ESP32 con código largo comprimía a ~2KB), pero evita que
// alguien use este endpoint para guardar basura gigante gratis.
const MAX_BODY_SIZE = 200_000;

// 180 días -- un proyecto compartido para una clase no necesita
// vivir para siempre; esto evita que el KV (gratis hasta 1GB) crezca
// sin límite con links que nadie va a volver a abrir. Reabrir un
// link vencido simplemente no encuentra el id (igual que borrado).
const TTL_SECONDS = 60 * 60 * 24 * 180;

// Rate limit por IP: 20 proyectos compartidos por hora alcanza de
// sobra para cualquier uso real de un salón (ni un docente armando
// 20 ejemplos seguidos llega a este número) y deja bastante margen
// contra un script tonto en loop, sin acercarse al límite diario
// gratis de KV (1,000 escrituras/día -- 20/hora son como mucho 480/día
// por IP, y haría falta MUCHAS IPs distintas para siquiera rozar el
// límite real).
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

const CORS_HEADERS = {
    // Ver el comentario grande arriba del archivo -- el comodín acá
    // no es la protección real, son checkRateLimit() e
    // isValidProjectBlob() de abajo.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
}

function text(body, status = 200, contentType = "text/plain; charset=utf-8") {
    return new Response(body, { status, headers: { ...CORS_HEADERS, "Content-Type": contentType } });
}

function randomId() {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) {
        id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    }
    return id;
}

export default {

    async fetch(request, env) {

        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        if (request.method === "POST" && url.pathname === "/share") {
            return handleShare(request, env);
        }

        const match = url.pathname.match(/^\/share\/([A-Za-z0-9]{4,16})$/);
        if (request.method === "GET" && match) {
            return handleResolve(match[1], env);
        }

        return text("not found", 404);

    },

};

async function handleShare(request, env) {

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await checkRateLimit(ip, env))) {
        return json({ error: "demasiados proyectos compartidos desde esta conexión -- probá de nuevo en un rato" }, 429);
    }

    const body = await request.text();

    if (!body) {
        return json({ error: "cuerpo vacío" }, 400);
    }

    if (body.length > MAX_BODY_SIZE) {
        return json({ error: "proyecto demasiado grande" }, 413);
    }

    if (!(await isValidProjectBlob(body))) {
        return json({ error: "el contenido no es un proyecto de PitSimulator válido" }, 400);
    }

    // Colisión de ID: astronómicamente improbable (58^8 combinaciones)
    // pero se chequea igual -- un GET previo (en vez de un put()
    // ciego) para no llegar a pisar el proyecto de otra persona si
    // alguna vez pasara. Unos pocos reintentos alcanzan de sobra.
    let id;
    for (let attempt = 0; attempt < 5; attempt++) {
        id = randomId();
        const existing = await env.PROJECTS.get(id);
        if (existing === null) break;
    }

    await env.PROJECTS.put(id, body, { expirationTtl: TTL_SECONDS });

    return json({ id });

}

async function handleResolve(id, env) {

    const data = await env.PROJECTS.get(id);

    if (data === null) {
        return json({ error: "link no encontrado o vencido" }, 404);
    }

    return text(data, 200, "text/plain; charset=utf-8");

}

// Ventana fija por hora (Date.now() / ventana, redondeado) -- más
// simple que una ventana deslizante de verdad, a costa de permitir
// hasta 2x el límite pegado al borde entre dos horas (ej. 19 pedidos
// a las 10:59 + 19 más a las 11:00). Aceptable para lo que esto
// necesita frenar (abuso casual/script en loop, no un atacante fino
// optimizando el timing). get()+put() no es atómico en KV -- bajo
// carga muy concurrente alguien podría colarse unos pocos pedidos de
// más; de nuevo, suficiente para este caso de uso, no a prueba de
// atacante dedicado.
async function checkRateLimit(ip, env) {

    const bucket = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
    const key = `rl:${ip}:${bucket}`;

    const current = parseInt((await env.PROJECTS.get(key)) || "0", 10);
    if (current >= RATE_LIMIT_MAX) return false;

    // TTL con margen (+60s) sobre el tamaño de la ventana -- si
    // expirara justo en el límite exacto, el contador podría seguir
    // vivo un instante de más en el peor caso de reloj; no afecta la
    // corrección (el bucket siguiente usa una key distinta de
    // cualquier forma), solo evita dejar basura vieja en KV un rato.
    await env.PROJECTS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 60 });

    return true;

}

// Mismo formato que arma/lee ShareProject.js del lado del navegador
// (DEFLATE raw + base64url) -- se intenta descomprimir y parsear acá
// ANTES de guardar nada, y se chequea que tenga pinta de proyecto real
// (mismo chequeo mínimo que ProjectManager.deserialize()). Cualquier
// cosa que no sea esto se rechaza con 400 -- ver el comentario grande
// arriba del archivo para el porqué (este endpoint no es hosting
// genérico de blobs).
async function isValidProjectBlob(base64url) {

    try {

        const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
        const binary = atob(base64 + pad);

        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const buf = await new Response(stream).arrayBuffer();
        const json = new TextDecoder().decode(buf);

        const data = JSON.parse(json);

        return !!data && data.version === "1.0" && Array.isArray(data.components) && Array.isArray(data.wires);

    } catch {

        return false;

    }

}
