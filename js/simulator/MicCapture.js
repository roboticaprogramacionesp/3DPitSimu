/*
==========================================================
 PitSimulator — MicCapture.js

 Captura audio REAL del micrófono de la PC del alumno (getUserMedia +
 AudioContext) y lo manda al SignalEngine como PCM16 mono en hex, para
 que inmp441.hal.py lo entregue vía I2S.readinto() -- ver el
 comentario grande en SignalEngine.js junto a requestMicCapture().

 UN SOLO micrófono compartido para todo el proyecto (no uno por
 componente INMP441) -- se arranca perezosamente la PRIMERA vez que
 algún firmware construye I2S(mode=I2S.RX, ...), nunca antes (pedir
 permiso de micrófono apenas se abre la página, sin que el alumno
 haya corrido nada, sería una sorpresa desagradable).

 ScriptProcessorNode (no AudioWorklet): está deprecado pero sigue
 andando en todos los navegadores relevantes y no requiere publicar
 un archivo de worklet aparte ni awaitear audioWorklet.addModule() --
 alcanza y sobra para esto.
==========================================================
*/

class MicCapture {

    constructor(simulator) {
        this.simulator = simulator;
        this.stream = null;
        this.audioCtx = null;
        this.source = null;
        this.processor = null;
        this.silentGain = null;
        this._starting = false;
    }

    get active() {
        return !!this.audioCtx;
    }

    async start(rate) {

        if (this.audioCtx || this._starting) return;
        this._starting = true;

        try {

            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            // El navegador puede no respetar el sampleRate pedido (algunos
            // dispositivos de entrada solo soportan 44100/48000) -- no
            // hace falta que coincida con el "rate" que pidió el
            // firmware, inmp441.hal.py ya trabaja con lo que le llegue.
            this.audioCtx = new AudioCtx({ sampleRate: rate || 16000 });

            this.source = this.audioCtx.createMediaStreamSource(this.stream);

            // BUG REAL encontrado en vivo: con buffers de 2048 (audio
            // real llega ~7-8 veces por segundo, sin parar, incluso con
            // el script ya terminado) el Worker terminaba crasheando
            // ("Aborted ... proxy_c_to_js_store_attr is running
            // asynchronously") -- confirmado que NO es un choque con el
            // mp.runPython() del script (pasaba igual con el script ya
            // terminado, Worker idle) sino la frecuencia misma de
            // mp.globals.set() en wasmWorker.js. 8192 manda chunks ~4x
            // menos seguido (más latencia -- ~0.5s a 16kHz en vez de
            // ~0.13s -- pero sigue siendo útil para "¿hay ruido o no?").
            const BUFFER_SIZE = 8192;
            this.processor = this.audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0); // Float32, -1..1
                const pcm16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    const s = Math.max(-1, Math.min(1, input[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }
                const bytes = new Uint8Array(pcm16.buffer);
                let hex = "";
                for (let i = 0; i < bytes.length; i++) {
                    hex += bytes[i].toString(16).padStart(2, "0");
                }
                this.simulator.signalEngine.broadcastMicChunk(hex);
            };

            // ScriptProcessorNode solo dispara onaudioprocess mientras
            // esté conectado a algún destino -- un GainNode en 0 lo deja
            // "tirando" de la señal sin que el alumno se escuche a sí
            // mismo por los parlantes (evita feedback/eco real).
            this.silentGain = this.audioCtx.createGain();
            this.silentGain.gain.value = 0;

            this.source.connect(this.processor);
            this.processor.connect(this.silentGain);
            this.silentGain.connect(this.audioCtx.destination);

        } catch (err) {

            this.audioCtx = null;
            this.simulator.eventBus.emit(
                "qemu:output",
                "\n⚠️ No se pudo acceder al micrófono: " + err.message + "\n" +
                "El INMP441 necesita permiso de micrófono del navegador -- fijate si\n" +
                "apareció un cartel pidiéndolo y aceptalo, o revisá la configuración\n" +
                "del sitio (🔒 junto a la dirección) si lo rechazaste antes.\n",
            );

        } finally {
            this._starting = false;
        }

    }

    stop() {
        if (this.processor) { this.processor.disconnect(); this.processor.onaudioprocess = null; }
        if (this.source) this.source.disconnect();
        if (this.silentGain) this.silentGain.disconnect();
        if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
        if (this.audioCtx) this.audioCtx.close();
        this.stream = null;
        this.audioCtx = null;
        this.source = null;
        this.processor = null;
        this.silentGain = null;
    }

}
