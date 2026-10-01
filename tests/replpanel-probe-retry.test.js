// ==========================================================
// PitSimulator - tests/replpanel-probe-retry.test.js
//
// Regresión para ReplPanel._probeWarmBoot()/_probeWarmBootOnce()
// (ver js/ui/ReplPanel.js) -- el sondeo de "¿ya arrancó en caliente?"
// que se manda apenas conecta el WebSocket. BUG REAL que esto cubre
// (2026-10-01): la UART emulada de QEMU puede perder bytes bajo carga
// real, y si le toca justo a ESTE mensaje chico, el sistema concluía
// "arranque frío" por error y disparaba un repasteo COMPLETO de HAL
// (cientos de líneas) -- mucho más caro y con mucha más superficie
// para que la misma corrupción vuelva a pegar, en cascada. El fix fue
// reintentar el sondeo mismo (barato) antes de resignarse a pagar el
// repasteo (caro). Este test NO necesita QEMU/navegador -- simula
// _warmProbe() a mano, igual patrón que tests/simulator-utils.test.js
// (cargar el .js real con vm, sin pelearse con imports de módulo).
//
// Para el escenario con QEMU/bridge real (reconexiones rápidas,
// corrupción de bytes de verdad) ver tests/stress/README.md -- ese no
// corre acá porque necesita los binarios vendorizados.
// ==========================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReplPanel() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'ReplPanel.js'), 'utf8');
    const context = { console, setTimeout, clearTimeout };
    context.global = context;
    vm.createContext(context);
    vm.runInContext(code + '\nthis.ReplPanel = ReplPanel;', context);
    return context.ReplPanel;
}

function makeCtx(ReplPanel, onSend) {
    const ctx = Object.create(ReplPanel.prototype);
    // Acelerado -- el valor real (2500ms) haría este test lento sin
    // aportar nada; lo que se prueba es la LÓGICA de reintento, no el
    // tiempo real de espera.
    ReplPanel.PROBE_TIMEOUT_MS = 50;
    ctx._sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    ctx.simulator = {
        qemuBridge: { interrupt: () => {} },
        eventBus: {
            on: () => {},
            off: () => {},
            emit: (event, data) => { if (event === 'qemu:send') onSend(data); },
        },
    };
    return ctx;
}

test('_probeWarmBoot responde de una si el primer intento llega bien', async () => {

    const ReplPanel = loadReplPanel();
    let sendCount = 0;
    const ctx = makeCtx(ReplPanel, () => {
        sendCount++;
        setTimeout(() => ctx._warmProbe && ctx._warmProbe(true), 5);
    });

    const result = await ctx._probeWarmBoot();

    assert.equal(result, true);
    assert.equal(sendCount, 1, 'no debería haber reintentado si el primer intento respondió');

});

test('_probeWarmBoot reintenta si un intento se pierde (corrupción transitoria) y se recupera solo', async () => {

    const ReplPanel = loadReplPanel();
    let sendCount = 0;
    const ctx = makeCtx(ReplPanel, () => {
        sendCount++;
        // Los primeros 2 intentos "se pierden" (como si la UART se
        // hubiera comido el mensaje) -- nadie llama a _warmProbe, así
        // que _probeWarmBootOnce() agota el timeout. El 3ro responde
        // bien.
        if (sendCount === 3) {
            setTimeout(() => ctx._warmProbe && ctx._warmProbe(true), 5);
        }
    });

    const result = await ctx._probeWarmBoot();

    assert.equal(result, true);
    assert.equal(sendCount, 3, 'debería haber reintentado 2 veces antes de la respuesta exitosa');

});

test('_probeWarmBoot asume arranque frío sin colgarse si TODOS los intentos se pierden', async () => {

    const ReplPanel = loadReplPanel();
    let sendCount = 0;
    const ctx = makeCtx(ReplPanel, () => { sendCount++; });

    const result = await ctx._probeWarmBoot();

    assert.equal(result, false);
    assert.equal(sendCount, ReplPanel.PROBE_ATTEMPTS, 'debería agotar exactamente PROBE_ATTEMPTS intentos, nunca más ni menos');

});

test('_probeWarmBoot respeta una respuesta "frío" real sin reintentar (no es lo mismo que "sin respuesta")', async () => {

    const ReplPanel = loadReplPanel();
    let sendCount = 0;
    const ctx = makeCtx(ReplPanel, () => {
        sendCount++;
        // Respuesta real y explícita de "no, no está caliente" --
        // distinto de un timeout/pérdida. No debería reintentar: ya
        // tiene una respuesta de verdad.
        setTimeout(() => ctx._warmProbe && ctx._warmProbe(false), 5);
    });

    const result = await ctx._probeWarmBoot();

    assert.equal(result, false);
    assert.equal(sendCount, 1, 'una respuesta real "frío" no debería disparar reintentos');

});
