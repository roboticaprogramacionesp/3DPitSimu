# Backend de links cortos (botón 🔗 Compartir proyecto)

Backend mínimo para que el botón 🔗 de PitSimulator genere links REALMENTE
cortos (`.../3DPitSimu/#p=Ab3x9k2P`) en vez del link largo autocontenido
(`#compartir=...`) que usaba antes. Mismo mecanismo que usa MakeCode/micro:bit
para "Compartir": no es un acortador de URLs, es un guardado propio
(id corto → proyecto comprimido) en [Cloudflare Workers](https://workers.cloudflare.com/)
+ [KV](https://developers.cloudflare.com/kv/), gratis para esta escala
(100,000 lecturas/día, 1,000 escrituras/día, 1GB de storage en el plan free).

El frontend (`js/ui/ShareProject.js`) ya está preparado para usar esto --
**si no se despliega nada**, el botón sigue funcionando exactamente como
antes (link largo autocontenido + QR), porque `ShareProject.js` cae a ese
camino automáticamente si `WORKER_ENDPOINT` está vacío o el backend no
responde. Desplegar esto es opcional, no rompe nada si se salta.

## Qué NO puede hacer un asistente de IA por vos acá

Crear la cuenta de Cloudflare y loguearte (`wrangler login`) son pasos
interactivos (abren el navegador, pywebview/OAuth) -- nadie más que vos
puede hacerlos. Todo lo demás (el código del Worker, el `wrangler.toml`)
ya está escrito; estos son los únicos pasos manuales que faltan.

## Pasos

1. **Cuenta de Cloudflare** (gratis, sin tarjeta para este plan):
   https://dash.cloudflare.com/sign-up

2. **Instalar dependencias y loguearte** (desde esta carpeta, `worker/`):

   ```
   npm install
   npx wrangler login
   ```

   Esto abre el navegador para loguearte -- una sola vez por máquina.

3. **Crear el namespace de KV** (el "guardado" donde viven los proyectos
   compartidos):

   ```
   npx wrangler kv namespace create pitsimulator_share
   ```

   Esto imprime algo como:

   ```
   [[kv_namespaces]]
   binding = "PROJECTS"
   id = "a1b2c3d4e5f6..."
   ```

   Copiá ese `id` real y pegalo en `wrangler.toml` (reemplazando
   `"REEMPLAZAR_CON_EL_ID_REAL"`).

4. **Desplegar**:

   ```
   npx wrangler deploy
   ```

   Al final imprime la URL del Worker, algo como:

   ```
   https://pitsimulator-share.TU-SUBDOMINIO.workers.dev
   ```

5. **Conectar el frontend**: abrir `js/ui/ShareProject.js` y poner esa URL
   en la constante `WORKER_ENDPOINT` (al principio de la clase, está
   vacía -- `""` -- por default). Después, `git add` / commit / push
   como siempre para que quede en GitHub Pages.

## Costos y límites a tener en cuenta

- **Gratis** dentro de los límites del plan free de Cloudflare (ver
  arriba) -- de sobra para un salón de clase.
- Cada link compartido vence a los **180 días** (`TTL_SECONDS` en
  `src/index.js`) -- después de eso, ese link específico deja de
  funcionar (igual que si nunca hubiera existido). Pensado para no
  dejar crecer el storage para siempre con links que nadie vuelve a
  abrir; se puede estirar ese número si hace falta.
- **Rate limit: 20 `POST /share` por IP por hora** (`RATE_LIMIT_MAX` en
  `src/index.js`) -- de sobra para cualquier uso real de un salón, pero
  frena un script en loop antes de que llegue a gastar las 1,000
  escrituras/día gratis de KV. Contador por IP guardado en el mismo KV
  (ventana fija de 1 hora) -- frena abuso casual, no a un atacante
  dedicado con muchas IPs (para eso existe
  [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/),
  no implementado todavía, mejora futura si hace falta).
- **Validación de contenido en `POST /share`**: se rechaza (400) todo lo
  que no descomprima a un proyecto de PitSimulator real (mismo formato
  que `ProjectManager.serialize()`) -- así este endpoint no sirve como
  hosting gratis de cualquier otra cosa.
- El contenido guardado **es público para quien tenga el ID/link** --
  mismo modelo que un link de MakeCode o Pastebin. No hay autenticación
  ni borrado manual todavía (si hace falta borrar algo puntual, se puede
  hacer a mano con `npx wrangler kv key delete --binding=PROJECTS <id>`).
- El comodín en `Access-Control-Allow-Origin` (`*`) es intencional, no
  un descuido -- ver el comentario grande al principio de
  `src/index.js` para el porqué (CORS no es lo que frena el abuso acá).
