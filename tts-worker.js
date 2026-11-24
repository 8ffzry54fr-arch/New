// Gera a voz num processo separado, para a tela do app não travar enquanto o áudio é preparado.

// Dentro de um worker de módulo não existe importScripts; a biblioteca de fonemas usa isso só para
// descobrir que está num worker, então basta existir.
if (typeof self.importScripts !== 'function') self.importScripts = () => { throw new Error('importScripts indisponível'); };

const LIB = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/';
const ORT_MOD = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js';

let tts = null, session = null, voiceId = null;

// O import map da página não vale dentro do worker: reescreve os imports da biblioteca para endereços completos
async function loadLib(){
  if (tts) return tts;
  const r = await fetch(LIB + 'piper-tts-web.js');
  if (!r.ok) throw new Error('não consegui baixar a biblioteca de voz (' + r.status + ')');
  let src = await r.text();
  src = src
    .replace(/(["'])\.\/([\w.-]+\.js)\1/g, (m, q, f) => q + LIB + f + q)
    .replace(/(["'])onnxruntime-web\/wasm\1/g, (m, q) => q + ORT_MOD + q)
    // menos memória: sem pré-reserva de memória do ONNX e com 1 thread (o iPhone fecha o app se passar do limite)
    .replace('{ executionProviders: ["wasm"] }', '{ executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false }')
    .replace('ort.env.wasm.numThreads = navigator.hardwareConcurrency;', 'ort.env.wasm.numThreads = 1;');
  tts = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  return tts;
}

// Corta o silêncio do começo e do fim do trecho, deixando só uma pausa curta e natural
function trimWav(buf){
  try{
    const v = new DataView(buf);
    if (v.getUint32(0, true) !== 1179011410 || v.getUint16(34, true) !== 16) return buf;
    const sr = v.getUint32(24, true);
    const n = (buf.byteLength - 44) >> 1;
    const pcm = new Int16Array(buf, 44, n);
    const th = 350;
    let a = 0; while (a < n && Math.abs(pcm[a]) < th) a++;
    let b = n - 1; while (b > a && Math.abs(pcm[b]) < th) b--;
    a = Math.max(0, a - Math.round(sr * 0.02));
    b = Math.min(n - 1, b + Math.round(sr * 0.16));
    if (b - a < sr * 0.15) return buf;
    const len = b - a + 1;
    const out = new ArrayBuffer(44 + len * 2);
    new Uint8Array(out, 0, 44).set(new Uint8Array(buf, 0, 44));
    const ov = new DataView(out);
    ov.setUint32(4, out.byteLength - 8, true);
    ov.setUint32(40, len * 2, true);
    new Int16Array(out, 44, len).set(pcm.subarray(a, b + 1));
    return out;
  }catch(e){ return buf; }
}

self.onmessage = async e => {
  const { id, type } = e.data;
  try{
    if (type === 'init'){
      const t = await loadLib();
      let stored = [];
      try{ stored = await t.stored(); }catch(err){}
      const first = !stored.includes(e.data.voiceId);
      self.postMessage({ id, type: 'status', first });
      session = await t.TtsSession.create({
        voiceId: e.data.voiceId,
        wasmPaths: e.data.wasmPaths,
        progress: p => {
          if (p.url === t.INFERENCE_PROGRESS_URL || !p.total) return;
          self.postMessage({ id, type: 'progress', loaded: p.loaded, total: p.total });
        }
      });
      voiceId = e.data.voiceId;
      self.postMessage({ id, type: 'done' });
    } else if (type === 'predict'){
      if (!session) throw new Error('voz ainda não carregada');
      const blob = await session.predict(e.data.text);
      const buf = trimWav(await blob.arrayBuffer());
      self.postMessage({ id, type: 'done', buf }, [buf]);
    }
  }catch(err){
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
