// Tradução inglês → português num processo separado, com o modelo OPUS-MT (Universidade de Helsinque, CC BY 4.0)
// rodando no próprio aparelho. Nada do livro sai do celular.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
import { splitSentences } from './texto.js?v=6';

const MODEL = 'OptimaMT/en-pt';
env.allowLocalModels = false;

let translator = null, loading = null;

function load(id){
  if (translator) return Promise.resolve(translator);
  if (loading) return loading;
  const files = new Map();
  loading = pipeline('translation', MODEL, {
    dtype: 'q8',
    session_options: { extra: { session: { disable_quant_qdq: '1' } } },
    progress_callback: p => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let l = 0, t = 0; for (const [a, b] of files.values()){ l += a; t += b; }
      self.postMessage({ id, type: 'progress', loaded: l, total: t });
    }
  }).then(t => { translator = t; return t; }, e => { loading = null; throw e; });
  return loading;
}

self.onmessage = async e => {
  const { id, type } = e.data;
  try{
    if (type === 'init'){
      await load(id);
      self.postMessage({ id, type: 'done' });
    } else if (type === 'translate'){
      const tr = await load(id);
      const outs = [];
      for (const text of e.data.texts){
        const sents = splitSentences(text);
        const res = await tr(sents.map(s => '>>pt_br<< ' + s), { max_new_tokens: 400 });
        const arr = Array.isArray(res) ? res : [res];
        outs.push(arr.map(r => (r.translation_text || '').trim()).join(' ').replace(/\s+/g, ' ').trim());
      }
      self.postMessage({ id, type: 'done', outs });
    }
  }catch(err){
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
