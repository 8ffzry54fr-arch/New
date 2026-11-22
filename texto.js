// Divisão em capítulos, trechos para leitura e resumo automático (sem internet).

const HEAD = /^(cap[íi]tulo|chapter|parte|livro|pr[óo]logo|ep[íi]logo|introdu[çc][ãa]o|conclus[ãa]o|pref[áa]cio|apresenta[çc][ãa]o|pref[áa]cio|posf[áa]cio)\b[^.!?]{0,70}$/i;
const CHUNK = 320;

// Capítulos a partir do texto puro (PDF, Word, txt)
export function deriveSections(text){
  const lines = text.split('\n');
  const secs = [];
  let cur = { title: '', lines: [] };
  const flush = () => {
    const body = cur.lines.join('\n').trim();
    if (body) secs.push({ title: cur.title, text: body });
  };
  for (const ln of lines){
    const t = ln.trim();
    if (t.length > 0 && t.length <= 80 && HEAD.test(t)){
      if (cur.lines.join('').trim()) { flush(); cur = { title: t, lines: [] }; }
      else cur.title = cur.title ? cur.title + ' · ' + t : t;   // título em duas linhas
    } else if (cur.title && !cur.lines.join('').trim() && t && t.length <= 60 && !/[.!?…:;,]$/.test(t)) {
      cur.title += ': ' + t;                                   // subtítulo logo abaixo do capítulo
    } else cur.lines.push(ln);
  }
  flush();
  if (secs.length >= 2) return secs;

  // Sem capítulos reconhecíveis: blocos de ~2.500 palavras
  const paras = text.split(/\n\s*\n/);
  const out = []; let buf = [], wc = 0, n = 1;
  for (const p of paras){
    buf.push(p); wc += p.split(/\s+/).length;
    if (wc >= 2500){ out.push({ title: `Trecho ${n++}`, text: buf.join('\n\n'), synthetic: true }); buf = []; wc = 0; }
  }
  if (buf.join('').trim()) out.push({ title: `Trecho ${n}`, text: buf.join('\n\n'), synthetic: true });
  if (out.length === 1) out[0].title = '';
  return out;
}

// Trechos curtos (o que a voz lê de cada vez)
export function buildChunks(secs, { showSynthetic = false } = {}){
  const out = []; let p = 0;
  secs.forEach((s, si) => {
    if (s.title && secs.length > 1 && (!s.synthetic || showSynthetic)) out.push({ t: s.title, p: p++, h: true, s: si });
    const paras = s.text.split(/\n\s*\n|\n(?=[A-ZÀ-Ú“"—–-])/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    paras.forEach(para => {
      const sents = para.match(/[^.!?…]+(?:[.!?…]+["”»')\]]*|$)\s*/g) || [para];
      let buf = '';
      const push = () => { if (buf.trim()) out.push({ t: buf.trim(), p, s: si }); buf = ''; };
      for (const s of sents){
        if ((buf + s).length > CHUNK && buf) push();
        if (s.length > CHUNK * 1.4){
          s.split(/(?<=[,;:])\s+/).forEach(piece => { if ((buf + piece).length > CHUNK && buf) push(); buf += piece + ' '; });
        } else buf += s;
      }
      push(); p++;
    });
  });
  return out.filter(c => /[\p{L}\p{N}]/u.test(c.t));
}

// ---------------- Resumo automático ----------------
const STOP = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre entre ' +
  'até após e ou mas porém que se como quando onde quem qual quais cujo cuja não sim já ainda também só mais menos muito muita ' +
  'muitos muitas pouco pouca tudo todo toda todos todas nada algo alguém ninguém este esta estes estas esse essa esses essas aquele ' +
  'aquela aqueles aquelas isto isso aquilo eu tu ele ela nós vós eles elas você vocês me te lhe nos vos lhes meu minha meus minhas seu sua seus ' +
  'suas nosso nossa nossos nossas ao aos à às num numa é são era eram foi foram ser sido sendo estar está estão estava estavam esteve ' +
  'ter tem têm tinha tinham teve há havia haver pode podem podia poderia fazer faz fez feito vai vão ia então assim aqui ali lá ' +
  'porque pois quanto quanta tão tanto tanta cada outro outra outros outras mesmo mesma mesmos mesmas depois antes agora sempre ' +
  'nunca bem mal onde enquanto embora apenas sobre quase toda dele dela deles delas nele nela disse diz ainda vez vezes coisa coisas').split(/\s+/));

const words = s => (s.toLowerCase().match(/\p{L}{3,}/gu) || []).filter(w => !STOP.has(w)).map(w => w.slice(0, 7));
const sentencesOf = text => text.split(/\n\s*\n/).flatMap(par =>
  (par.replace(/\s+/g, ' ').match(/[^.!?…]+(?:[.!?…]+["”»')\]]*|$)\s*/g) || [])
    .map(s => s.trim()).filter(s => s.split(' ').length >= 5));

export const keywords = s => [...new Set(words(s))];

export const RATIOS = { c: 0.04, m: 0.08, l: 0.15 };

export function summarize(sections, ratio){
  const secs = sections.map(s => ({ title: s.title, synthetic: s.synthetic, sents: sentencesOf(s.text) }));
  // em quantas frases do livro cada palavra aparece (para saber o que é comum demais)
  const df = new Map(); let N = 0;
  secs.forEach(s => s.sents.forEach(x => { N++; for (const w of new Set(words(x))) df.set(w, (df.get(w) || 0) + 1); }));
  const idf = w => Math.log((N + 1) / ((df.get(w) || 0) + 1));

  const out = [];
  secs.forEach(s => {
    const total = s.sents.reduce((a, x) => a + x.split(' ').length, 0);
    if (total < 80) return;                                  // capa, sumário, direitos autorais etc.
    const tf = new Map();
    s.sents.forEach(x => words(x).forEach(w => tf.set(w, (tf.get(w) || 0) + 1)));
    const weight = new Map();
    for (const [w, c] of tf) if (c >= 2) weight.set(w, c * idf(w));   // palavras centrais do capítulo

    const scored = s.sents.map((x, i) => {
      const ws = new Set(words(x));
      const len = x.split(' ').length;
      let sc = 0; for (const w of ws) sc += weight.get(w) || 0;
      sc /= Math.pow(Math.max(len, 1), 0.6);
      if (i === 0) sc *= 1.25;
      if (len < 8 || len > 55) sc *= 0.5;
      if (/^["“—–-]/.test(x)) sc *= 0.7;                     // falas soltas resumem mal
      return { i, x, sc, ws };
    });
    const k = Math.max(1, Math.round(s.sents.length * ratio));
    const chosen = [];
    for (const c of [...scored].sort((a, b) => b.sc - a.sc)){
      if (chosen.length >= k) break;
      const dup = chosen.some(o => {
        let inter = 0; for (const w of c.ws) if (o.ws.has(w)) inter++;
        return inter / Math.max(1, Math.min(c.ws.size, o.ws.size)) > 0.6;
      });
      if (!dup) chosen.push(c);
    }
    chosen.sort((a, b) => a.i - b.i);
    const paras = [];
    for (let i = 0; i < chosen.length; i += 3) paras.push(chosen.slice(i, i + 3).map(c => c.x).join(' '));
    out.push({ title: s.title, text: paras.join('\n\n'), synthetic: s.synthetic });
  });
  return out;
}
