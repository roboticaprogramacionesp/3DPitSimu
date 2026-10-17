/*
==========================================================
 PitSimulator — worker/src/index.js
 Backend chiquito para links CORTOS de verdad (botón 🔗, ver
 js/ui/ShareProject.js), mismo mecanismo que usa MakeCode/micro:bit
 para "Compartir": NO es un acortador de URLs (Bitly/TinyURL) -- es
 un guardado propio (key -> blob) con un ID random corto. MakeCode
 llama a esto su "pxt-cloud"; este archivo es el equivalente mínimo
 para PitSimulator, corriendo gratis en Cloudflare Workers + KV.

 Totalmente "tonto" a propósito: no sabe nada de componentes, cables
 ni ESP32 -- guarda y devuelve el string comprimido tal cual lo
 arma/lee ShareProject._compress()/_decompress() (DEFLATE +
 base64url) del lado del navegador. Si ese formato cambia algún día,
 este archivo no necesita tocarse.

 Rutas:
   POST /share        body = el string comprimido -> { id }
   GET  /share/:id     -> el string comprimido guardado (o 404)

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

const CORS_HEADERS = {
    // Comodín a propósito: esto es contenido YA compartido a
    // propósito por quien lo sube (el botón 🔗 es explícitamente
    // "compartir"), no hay sesión/cookie/secreto de por medio -- el
    // mismo modelo de seguridad que un link público de MakeCode o
    // Pastebin (quien tiene el ID puede verlo, ese ES el feature).
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

    const body = await request.text();

    if (!body) {
        return json({ error: "cuerpo vacío" }, 400);
    }

    if (body.length > MAX_BODY_SIZE) {
        return json({ error: "proyecto demasiado grande" }, 413);
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
