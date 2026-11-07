/* RJ-42 - looper de rack que fica embaixo do RJ-950
 *
 * Aparelho que nao existiu: tira loops de 1, 2, 4 ou 8 compassos de uma musica,
 * no BPM que voce quer. Visual de rack da epoca (LED vermelho de 7 segmentos,
 * como o Lexicon PCM42) e ideias do JamMan (tap no tempo forte), do Boss SP-202
 * (cortar no BPM) e do Electrix Repeater (cada loop com o seu tempo).
 *
 * Como funciona:
 * - Solta-se a musica no disquete. O BPM dela (Source) e o primeiro tempo forte
 *   sao achados sozinhos; o Tap Tempo e o arrastar no display corrigem.
 * - O inicio do loop (In) anda pelo jog Search, pelo Nudge (um tempo) e pelo
 *   Set In (tocando no tempo forte enquanto ouve). O fim vem do BPM e dos compassos.
 * - Target Tempo: o tempo que o loop vai ter. Vari-speed muda o tom junto (como
 *   o 45 RPM), Stretch mantem o tom, Off deixa no tempo da musica.
 * - Store guarda o loop em 8 memorias. Send manda para um pad do RJ-2000, para o
 *   RJ-950 ou para um arquivo WAV ou MP3.
 * A musica nao fica salva (e grande demais); as 8 memorias ficam no navegador.
 */
window.RJ = window.RJ || {};

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = n => String(Math.max(0, n | 0)).padStart(2, "0");
  const fit = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
  const esc = c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const COLS = 40;
  const SLOTS = 8;
  const STORE_KEY = "autosave42";
  const AUDIO_RE = /\.(wav|wave|aif|aiff|aifc|mp3|ogg|oga|flac|m4a|aac|opus)$/i;
  const MIN_BPM = 40, MAX_BPM = 250;
  const MODES = ["vari", "stretch", "off"];
  const MODE_NAMES = { vari: "VARI-SPEED", stretch: "STRETCH", off: "OFF" };
  const PEAK_HOP = 256;            // resolucao da forma de onda no LCD
  const LAME_URL = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";

  const cleanName = n => (n || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 #\-_.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 12) || "SONG";
  const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(2).padStart(5, "0"); };

  /* ------------------------------------------------------------ 7 segmentos */

  const SEG = {
    a: "4,2 18,2 15,5 7,5", b: "19,3 19,18 16,16 16,6", c: "19,20 19,35 16,32 16,22", d: "4,36 18,36 15,33 7,33",
    e: "3,20 6,22 6,32 3,35", f: "3,3 6,6 6,16 3,18", g: "4,19 7,17 15,17 18,19 15,21 7,21",
  };
  const DIG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc",
    "8": "abcdefg", "9": "abcfgd", "-": "g", " ": "", E: "afged", r: "eg", n: "ceg", o: "cdeg" };

  /** Texto -> digitos de LED; o ponto acende o do digito anterior. */
  function segHTML(txt) {
    const chars = [];
    for (const ch of txt) { if (ch === "." && chars.length) chars[chars.length - 1].dp = true; else chars.push({ ch, dp: false }); }
    return chars.map(({ ch, dp }) => {
      const on = DIG[ch] || "";
      const polys = Object.keys(SEG).map(k => `<polygon class="r42-seg${on.includes(k) ? " on" : ""}" points="${SEG[k]}"/>`).join("");
      return `<svg viewBox="0 0 24 40" aria-hidden="true">${polys}<circle class="r42-seg${dp ? " on" : ""}" cx="22" cy="36" r="1.8"/></svg>`;
    }).join("");
  }
  const bpmText = b => (b == null ? "---.-" : b >= 100 ? b.toFixed(1) : " " + b.toFixed(1));

  /* ------------------------------------------------------------ analise */

  /* Deteccao de tempo e batidas. Aqui o RJ-42 trapaceia: a carcaca e dos anos 80,
   * mas a conta e recente. Fluxo espectral (forca de ataque), ACF generalizada e
   * trem de pulsos (Percival e Tzanetakis, 2014) para o tempo; programacao
   * dinamica (Ellis, 2007) para achar cada batida, porque disco tocado ao vivo
   * acelera e freia e o loop tem de fechar no tempo daquele trecho. */

  const FFT_N = 512;
  const TW = (() => {
    const c = new Float32Array(FFT_N / 2), s = new Float32Array(FFT_N / 2);
    for (let i = 0; i < FFT_N / 2; i++) { c[i] = Math.cos(-2 * Math.PI * i / FFT_N); s[i] = Math.sin(-2 * Math.PI * i / FFT_N); }
    return { c, s };
  })();

  /** FFT complexa no lugar (radix 2). Tamanho FFT_N usa a tabela pronta. */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const tab = n === FFT_N;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, stride = FFT_N / len;
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          if (tab) { cr = TW.c[k * stride]; ci = TW.s[k * stride]; }
          const a = i + k, b = a + half;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          if (!tab) { const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; }
        }
      }
    }
  }

  /** Forca de ataque: fluxo espectral com compressao log, a ~11 kHz, um valor a cada ~5,8 ms. */
  function flux(raw, rate) {
    const f = Math.max(1, Math.round(rate / 11025));
    const sr = rate / f, n = Math.floor(raw.length / f), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += raw[i * f + k]; y[i] = s / f; }
    const N = FFT_N, H = Math.round(sr / 172);
    const frames = Math.max(0, Math.floor((y.length - N) / H));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const prev = new Float32Array(N / 2), re = new Float32Array(N), im = new Float32Array(N);
    const oss = new Float32Array(frames);
    const kmax = Math.floor(N / 2 * Math.min(1, 5000 / (sr / 2)));
    for (let t = 0; t < frames; t++) {
      const o = t * H;
      for (let i = 0; i < N; i++) { re[i] = y[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let s = 0;
      for (let k = 1; k < kmax; k++) {
        const m = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        const d = m - prev[k];
        if (d > 0) s += d;
        prev[k] = m;
      }
      oss[t] = s;
    }
    // tira a tendencia (~0,25 s) e fica so com o que sobe
    const out = new Float32Array(frames), w = 43;
    let acc = 0;
    for (let i = 0; i < frames; i++) {
      acc += oss[i] - (i >= w ? oss[i - w] : 0);
      out[i] = Math.max(0, oss[i] - acc / Math.min(i + 1, w));
    }
    return { oss: out, fps: sr / H, hop: H * f };
  }

  /** ACF generalizada (|X| elevado a 0,5): picos mais nitidos que a autocorrelacao comum. */
  function gacf(x, maxLag) {
    let n = 1; while (n < 2 * x.length) n <<= 1;
    const re = new Float32Array(n), im = new Float32Array(n);
    let mean = 0; for (let i = 0; i < x.length; i++) mean += x[i]; mean /= x.length || 1;
    for (let i = 0; i < x.length; i++) re[i] = x[i] - mean;
    fft(re, im);
    for (let i = 0; i < n; i++) { re[i] = Math.pow(re[i] * re[i] + im[i] * im[i], 0.25); im[i] = 0; }
    fft(re, im);
    const r = new Float32Array(maxLag + 2);
    for (let i = 0; i <= maxLag + 1; i++) r[i] = re[i] / n;
    return r;
  }

  /** Trem de pulsos de periodo P (frames) na melhor fase: media da forca de ataque nos pulsos. */
  function comb(oss, P, a = 0, b = oss.length) {
    let best = -1, bestPh = 0;
    const step = Math.max(0.25, P / 64);
    for (let ph = 0; ph < P; ph += step) {
      let s = 0, n = 0;
      for (let t = a + ph; t < b - 1; t += P) { const i = Math.floor(t), f = t - i; s += oss[i] * (1 - f) + oss[i + 1] * f; n++; }
      s = n ? s / n : 0;
      if (s > best) { best = s; bestPh = ph; }
    }
    return { score: best, phase: bestPh };
  }

  /**
   * Tempo da musica. Medido com 51 samples com BPM conhecido: 35 certos e 8 no dobro
   * ou na metade (o detector antigo acertava 19). center: preferencia de oitava.
   */
  function detectTempo(raw, rate, center = 100) {
    const { oss, fps, hop } = flux(raw, rate);
    if (oss.length < fps * 4) return null;
    const lagOf = bpm => 60 * fps / bpm;
    const lo = Math.floor(lagOf(220)), hi = Math.ceil(lagOf(45));
    const r = gacf(oss, 4 * hi + 4);
    const at = L => { const i = Math.floor(L), f = L - i; return r[i] * (1 - f) + r[i + 1] * f; };
    // o periodo certo soma com os multiplos dele
    const e = new Float32Array(hi + 2);
    for (let L = lo; L <= hi + 1; L++) e[L] = r[L] + at(2 * L) * 0.5 + at(4 * L) * 0.25;
    const cands = [];
    for (let L = lo + 1; L <= hi; L++) if (e[L] > e[L - 1] && e[L] >= e[L + 1] && e[L] > 0) {
      const y0 = e[L - 1], y1 = e[L], y2 = e[L + 1], dd = y0 - 2 * y1 + y2;
      cands.push({ L: L + (dd ? clamp(0.5 * (y0 - y2) / dd, -0.5, 0.5) : 0), v: y1 });
    }
    cands.sort((a, b) => b.v - a.v);
    const top = cands.slice(0, 10);
    if (!top.length) return null;
    // trem de pulsos: o candidato que melhor bate com os ataques
    let best = null;
    for (const c of top) {
      const sc = comb(oss, c.L).score * c.v / top[0].v;
      if (!best || sc > best.sc) best = { L: c.L, sc };
    }
    let bpm = 60 * fps / best.L;
    // oitava: metade, ele ou o dobro, com preferencia leve pelo meio
    const prior = b => Math.exp(-0.5 * Math.pow(Math.log2(b / center) / 0.75, 2));
    let pick = bpm, pv = -1;
    for (const k of [0.5, 1, 2]) {
      const b = bpm * k;
      if (b < 50 || b > 210) continue;
      const v = comb(oss, lagOf(b)).score * prior(b);
      if (v > pv) { pv = v; pick = b; }
    }
    bpm = refine(oss, fps, pick, 0.02);
    return { bpm, oss, fps, hop };
  }

  /** Varre +-span em passos finos: na musica inteira o desvio acumula e entrega o tempo exato. */
  function refine(oss, fps, bpm, span, a, b) {
    let rb = bpm, rv = -1;
    for (let x = bpm * (1 - span); x <= bpm * (1 + span); x += bpm * 0.0005) {
      const v = comb(oss, 60 * fps / x, a, b).score;
      if (v > rv) { rv = v; rb = x; }
    }
    return Math.round(rb * 100) / 100;
  }

  /**
   * Cada batida, por programacao dinamica (Ellis 2007): a batida cai num ataque forte
   * e a distancia entre batidas fica perto do periodo P, mas pode ir mudando.
   * Devolve as batidas em frames, com fracao (pico do ataque).
   */
  function trackBeats(oss, P, tight = 100) {
    const n = oss.length;
    let mx = 0; for (let i = 0; i < n; i++) if (oss[i] > mx) mx = oss[i];
    const C = new Float32Array(n), back = new Int32Array(n).fill(-1);
    const lo = Math.max(1, Math.round(P / 2)), hi = Math.round(P * 2);
    const pen = new Float32Array(hi + 1);
    for (let d = lo; d <= hi; d++) { const l = Math.log(d / P); pen[d] = -tight * l * l; }
    for (let t = 0; t < n; t++) {
      let best = 0, bi = -1;
      for (let d = lo; d <= hi && t - d >= 0; d++) { const v = C[t - d] + pen[d]; if (bi < 0 || v > best) { best = v; bi = t - d; } }
      const ok = bi >= 0 && best > 0;
      C[t] = oss[t] / (mx || 1) + (ok ? best : 0);
      back[t] = ok ? bi : -1;
    }
    let end = n - 1, bv = -Infinity;
    for (let t = Math.max(0, n - Math.round(P)); t < n; t++) if (C[t] > bv) { bv = C[t]; end = t; }
    const out = [];
    for (let t = end; t >= 0; t = back[t]) out.push(t);
    out.reverse();
    return out.map(t => {
      if (t <= 0 || t >= n - 1) return t;
      const y0 = oss[t - 1], y1 = oss[t], y2 = oss[t + 1], dd = y0 - 2 * y1 + y2;
      return y1 >= y0 && y1 >= y2 && dd ? t + clamp(0.5 * (y0 - y2) / dd, -0.5, 0.5) : t;
    });
  }

  /**
   * Time stretch sem mudar o tom (WSOLA): pedacos de ~43 ms sobrepostos, cada um
   * escolhido perto da posicao certa onde ele melhor continua o anterior.
   * speed > 1 encurta (mais rapido).
   */
  function stretch(x, rate, speed) {
    if (Math.abs(speed - 1) < 1e-4) return new Float32Array(x);
    const N = Math.round(rate * 0.043) & ~1, Hs = N >> 1, tol = Math.round(rate * 0.009);
    const L = Math.floor(x.length / speed);
    const out = new Float32Array(L + N), norm = new Float32Array(L + N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    let prev = 0;
    for (let k = 0, o = 0; o < L; k++, o += Hs) {
      const nom = Math.round(o * speed);
      let pos = nom;
      if (k > 0) {
        // o pedaco que continuaria o anterior naturalmente
        const tpl = prev + Hs;
        let bestC = -Infinity;
        for (let dlt = -tol; dlt <= tol; dlt += 2) {
          const p = nom + dlt;
          if (p < 0 || p + N > x.length) continue;
          let c = 0;
          for (let i = 0; i < N; i += 8) c += x[p + i] * (x[tpl + i] || 0);
          if (c > bestC) { bestC = c; pos = p; }
        }
      }
      pos = clamp(pos, 0, Math.max(0, x.length - N));
      for (let i = 0; i < N; i++) { const v = x[pos + i] || 0; out[o + i] += v * win[i]; norm[o + i] += win[i]; }
      prev = pos;
    }
    const y = new Float32Array(L);
    for (let i = 0; i < L; i++) y[i] = norm[i] > 1e-3 ? out[i] / norm[i] : out[i];
    return y;
  }

  /** Muda a velocidade e o tom juntos (como acelerar o disco). */
  function varispeed(x, rate, speed) {
    if (Math.abs(speed - 1) < 1e-4) return new Float32Array(x);
    return RJ.dsp.resample(x, rate * speed, rate);
  }

  function fadeEdges(y, rate, sec) {
    const n = Math.min(Math.floor(y.length / 2), Math.floor(sec * rate));
    for (let i = 0; i < n; i++) { const g = i / n; y[i] *= g; y[y.length - 1 - i] *= g; }
  }

  let lamePromise = null;
  function loadLame() {
    if (window.lamejs) return Promise.resolve(window.lamejs);
    if (!lamePromise) lamePromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LAME_URL; s.async = true;
      s.onload = () => (window.lamejs ? res(window.lamejs) : rej(new Error("lamejs")));
      s.onerror = () => { lamePromise = null; rej(new Error("Sem internet para o MP3")); };
      document.head.appendChild(s);
    });
    return lamePromise;
  }

  async function encodeMp3(pcm, rate) {
    const lame = await loadLame();
    let src = pcm, r = rate;
    if (![32000, 44100, 48000].includes(r)) { src = RJ.dsp.resample(pcm, rate, 44100); r = 44100; }
    const enc = new lame.Mp3Encoder(1, r, 192);
    const i16 = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) { const v = clamp(src[i], -1, 1); i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    const parts = [];
    for (let i = 0; i < i16.length; i += 1152) { const b = enc.encodeBuffer(i16.subarray(i, i + 1152)); if (b.length) parts.push(new Uint8Array(b)); }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: "audio/mpeg" });
  }

  function newState() {
    return { format: "rj42", version: 1, target: 90, mode: "vari", bars: 4, fade: 0.25, out: 0.8, sel: -1, slots: new Array(SLOTS).fill(null) };
  }

  /* ============================================================ aparelho */

  class R42 {
    constructor(app) {
      this.app = app;
      this.engine = app.engine;
      this.st = newState();
      this.on = false;
      this.loaded = false;
      this.song = null;            // { name, raw, rate, buf, peaks, env, hop, len }
      this.glob = null;            // BPM medio da musica
      this.manual = null;          // BPM posto a mao no display (desliga as batidas)
      this.bt = null;              // batidas da musica (amostras), achadas uma a uma
      this.inPos = 0;              // inicio do loop (amostras da musica)
      this.play = null;            // { kind: "loop" | "cue" | "slot", node, t0, ... }
      this.taps = [];
      this.prompt = null;          // { kind: "disk", fmt }
      this.flashUntil = 0;
      this.raf = 0;
      this.fine = false;           // Fine: Search de 1 ms e LCD com zoom no inicio
    }

    /* ------------------------------------------------------- montagem */

    build() {
      const root = $("#r42");
      if (!root) return;
      this.el = {
        root, l1: $("#r42-l1"), l2: $("#r42-l2"), lcd: $("#r42-lcd"), src: $("#r42-src"), tgt: $("#r42-tgt"),
        pos: $("#r42-pos"), num: $("#r42-num"), busy: $("#r42-busy"), drive: $("#r42-drive"), file: $("#r42-file"),
        slots: $("#r42-slots"), playLed: $("#r42-play-led"),
      };
      this.el.slots.innerHTML = Array.from({ length: SLOTS }, (_, i) =>
        `<button class="r42-slot" type="button" data-r42slot="${i}" aria-label="Memoria ${i + 1}"><i class="led r9-led"></i><span>${i + 1}</span></button>`).join("");

      const press = (el, down, up) => {
        el.addEventListener("pointerdown", e => {
          e.preventDefault();
          if (!this.app.on) return;
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          el.classList.add("down");
          down(e);
        });
        const end = () => { if (!el.classList.contains("down")) return; el.classList.remove("down"); if (up) up(); };
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        el.addEventListener("contextmenu", e => e.preventDefault());
      };
      const learn = (id, el, name, down, kind = "button", h = {}) =>
        this.app.learn.add(id, el, name, kind, Object.assign({ down: () => { if (this.app.on) down(); } }, h));
      const KEY_NAMES = { "nudge-": "Nudge -", "nudge+": "Nudge +", tap: "Tap Tempo", setin: "Set In", play: "Play Loop", store: "Store" };

      $$("[data-r42key]", root).forEach(b => {
        const k = b.dataset.r42key;
        let t1 = 0, t2 = 0;
        press(b, () => {
          this.key(k);
          if (k === "nudge-" || k === "nudge+") t1 = setTimeout(() => { t2 = setInterval(() => this.key(k), 140); }, 450);
        }, () => { clearTimeout(t1); clearInterval(t2); });
        learn("r42key:" + k, b, "42 " + KEY_NAMES[k], () => this.key(k));
      });
      $$("[data-r42bars]", root).forEach(b => {
        const n = +b.dataset.r42bars;
        press(b, () => this.setBars(n));
        learn("r42bars:" + n, b, "42 " + n + " Bar" + (n > 1 ? "s" : ""), () => this.setBars(n));
      });
      $$("[data-r42send]", root).forEach(b => {
        const k = b.dataset.r42send;
        press(b, () => this.send(k));
        learn("r42send:" + k, b, "42 Send " + { sp: "RJ-2000", s950: "RJ-950", disk: "Disk" }[k], () => this.send(k));
      });
      $$("[data-r42mode]", root).forEach(b => press(b, () => this.setMode(b.dataset.r42mode)));
      learn("r42:mode", $("#r42-modes"), "42 Tempo Mode", () => this.setMode(MODES[(MODES.indexOf(this.st.mode) + 1) % MODES.length]));
      $$("[data-r42slot]", root).forEach(b => {
        const i = +b.dataset.r42slot;
        press(b, () => this.selectSlot(i));
        learn("r42slot:" + i, b, "42 Memory " + (i + 1), () => this.selectSlot(i));
      });
      const fineBtn = $("[data-r42fine]", root);
      press(fineBtn, () => this.toggleFine());
      learn("r42:fine", fineBtn, "42 Fine", () => this.toggleFine());
      const power = () => (this.on ? this.powerOff() : this.boot());
      press($("#r42-power"), power);
      learn("r42:power", $("#r42-power"), "42 Power", power);

      this.bindEncoder($("#r42-jog"), (d, sp) => this.search(d, sp), "r42:search", "42 Search", 7);
      this.bindEncoder($("#r42-target"), (d, sp) => this.turnTarget(d, sp), "r42:target", "42 Target Tempo", 0, true);
      this.bindEncoder(this.el.src, (d, sp) => this.turnSource(d, sp), "r42:source", "42 Source BPM", -1);
      this.bindKnob($("#r42-fade"), () => this.st.fade, v => { this.st.fade = v; this.flash(this.fadeText(), "", 900); this.dirty(); }, "r42:fade", "42 Fade");
      this.bindKnob($("#r42-out"), () => this.st.out, v => { this.st.out = v; this.applyOut(); this.dirty(); }, "r42:out", "42 Output");

      // clicar na forma de onda poe o inicio do loop ali
      this.el.l2.addEventListener("pointerdown", e => {
        if (!this.on || !this.song || this.app.learn.learning) return;
        const r = this.el.l2.getBoundingClientRect();
        const c = clamp(Math.floor((e.clientX - r.left) / r.width * COLS), 0, COLS - 1);
        const w = this.view();
        // no Fine, vai exatamente para o comeco da celula (sem puxar para o ataque)
        if (this.fine) this.setIn(w.a + c * w.cell); else this.setIn(w.a + (c + 0.5) * w.cell, true);
      });

      const drive = this.el.drive;
      drive.addEventListener("click", () => { if (this.on) this.pick(); });
      drive.addEventListener("dragenter", e => { e.preventDefault(); if (this.on) drive.classList.add("drop"); });
      drive.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = this.on ? "copy" : "none"; });
      drive.addEventListener("dragleave", () => drive.classList.remove("drop"));
      drive.addEventListener("drop", e => {
        e.preventDefault(); e.stopPropagation();
        drive.classList.remove("drop");
        const f = (e.dataTransfer.files || [])[0];
        if (f && this.on) this.loadSong(f);
      });
      this.el.file.addEventListener("change", e => {
        const f = (e.target.files || [])[0];
        e.target.value = "";
        if (f) this.loadSong(f);
      });
      this.renderAll();
    }

    pick() {
      const inp = this.el.file;
      inp.accept = "audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac,.m4a";
      const ua = navigator.userActivation;
      if (ua && !ua.isActive) window.addEventListener("pointerup", () => inp.click(), { once: true });
      else inp.click();
    }

    bindKnob(el, get, set, id, name) {
      const draw = () => { el.querySelector("i").style.transform = `rotate(${-135 + get() * 270}deg)`; };
      el.rjDraw = draw;
      if (id) this.app.learn.add(id, el, name, "value", { get, set: v => { if (this.app.on && this.on) { set(v); draw(); } } });
      let y0 = 0, v0 = 0;
      el.addEventListener("pointerdown", e => { e.preventDefault(); if (!this.on) return; el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); el.dataset.drag = "1"; });
      el.addEventListener("pointermove", e => { if (!el.dataset.drag) return; set(clamp(v0 + (y0 - e.clientY) / 160, 0, 1)); draw(); });
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { delete el.dataset.drag; }));
      el.addEventListener("wheel", e => { e.preventDefault(); if (!this.on) return; set(clamp(get() - Math.sign(e.deltaY) * 0.03, 0, 1)); draw(); }, { passive: false });
      draw();
    }

    /**
     * Encoder sem fim (jog, Target Tempo, display do Source). Girar rapido acelera.
     * spin: graus por passo no indicador (0 = knob com ponteiro de 270 graus).
     */
    bindEncoder(el, fn, id, name, spin, pointer) {
      let y = 0, acc = 0, angle = 0, last = 0, speed = 1, wheel = 0;
      const ind = el.querySelector("i");
      const step = dir => {
        if (!this.on) return;
        const now = performance.now(), dt = now - last;
        last = now;
        speed = dt < 35 ? Math.min(speed * 1.25, 400) : dt < 90 ? clamp(speed * 1.05, 1, 40) : 1;
        if (ind && spin > 0) { angle += dir * spin; ind.style.transform = `rotate(${angle}deg)`; }
        fn(dir, Math.round(speed));
        if (ind && pointer) this.drawTarget();
      };
      this.app.learn.add(id, el, name, "encoder", {
        step: d => { if (!this.app.on) return; for (let i = 0; i < Math.min(Math.abs(d), 24); i++) step(Math.sign(d)); },
      });
      el.addEventListener("pointerdown", e => { e.preventDefault(); if (!this.on) return; el.setPointerCapture(e.pointerId); y = e.clientY; acc = 0; el.dataset.drag = "1"; });
      el.addEventListener("pointermove", e => {
        if (!el.dataset.drag) return;
        acc += y - e.clientY; y = e.clientY;
        while (acc >= 5) { step(1); acc -= 5; }
        while (acc <= -5) { step(-1); acc += 5; }
      });
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { delete el.dataset.drag; }));
      el.addEventListener("wheel", e => {
        e.preventDefault();
        wheel += e.deltaY;
        while (wheel <= -20) { step(1); wheel += 20; }
        while (wheel >= 20) { step(-1); wheel -= 20; }
      }, { passive: false });
      el.addEventListener("keydown", e => {
        const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
        if (d == null) return;
        e.preventDefault(); e.stopPropagation(); step(d);
      });
    }

    drawTarget() {
      const el = $("#r42-target i");
      if (el) el.style.transform = `rotate(${-135 + (this.st.target - 60) / 120 * 270}deg)`;
    }

    /* ------------------------------------------------------- liga/desliga */

    async boot() {
      if (this.on || !this.app.on) return;
      this.on = true;
      this.el.root.classList.add("on");
      this.applyOut();
      this.lcd(["RJ-42  LOOP PHRASE RECORDER", "LOADING..."]);
      if (!this.loaded) {
        this.loaded = true;
        try {
          const saved = await RJ.store.get(STORE_KEY);
          if (saved) this.st = this.deserialize(saved);
        } catch (e) { console.warn("Memoria do RJ-42 de outra versao", e); }
        $$(".knob", this.el.root).forEach(k => k.rjDraw && k.rjDraw());
      }
      await wait(500);
      if (!this.on) return;
      this.renderAll();
    }

    powerOff() {
      this.stop();
      this.saveNow();
      this.on = false;
      this.prompt = null;
      this.el.root.classList.remove("on");
      this.applyOut();
      this.renderAll();
    }

    /* ------------------------------------------------------- som */

    ensureOut() {
      const ctx = this.engine.ensure();
      if (!this.outNode || this.outNode.context !== ctx) {
        this.outNode = ctx.createGain();
        this.outNode.gain.value = 0;
        this.outNode.connect(this.engine.graph.limiter);
        this.applyOut();
      }
      return this.outNode;
    }

    applyOut() {
      if (!this.outNode) return;
      this.outNode.gain.setTargetAtTime(this.on ? Math.pow(this.st.out, 2) * 1.2 : 0, this.outNode.context.currentTime, 0.01);
    }

    /* ------------------------------------------------------- musica */

    async loadSong(file) {
      if (!file || !this.on) return;
      if (!(/^audio\//.test(file.type) || AUDIO_RE.test(file.name))) { this.flash("NOT AN AUDIO FILE", "USE WAV, AIFF, MP3, OGG, FLAC..."); return; }
      this.stop();
      const name = cleanName(file.name.replace(/\.[^.]+$/, ""));
      this.busy(true);
      this.flash("LOADING " + name + "...", "PLEASE WAIT", 60000);
      let dec;
      try { dec = await RJ.decodeAudio(this.engine.ensure(), await file.arrayBuffer()); }
      catch (e) { console.warn(e); this.busy(false); this.flash("LOAD ERROR: " + name, "UNKNOWN FILE FORMAT"); return; }
      this.flash("LOADED " + name, "FINDING THE TEMPO...", 60000);
      await wait(30);
      const { raw, rate } = dec;
      const ctx = this.engine.ensure();
      const buf = ctx.createBuffer(1, raw.length, rate);
      buf.getChannelData(0).set(raw);
      const peaks = new Float32Array(Math.ceil(raw.length / PEAK_HOP));
      for (let i = 0; i < peaks.length; i++) {
        let m = 0;
        for (let k = i * PEAK_HOP, e = Math.min(raw.length, k + PEAK_HOP); k < e; k++) { const v = Math.abs(raw[k]); if (v > m) m = v; }
        peaks[i] = m;
      }
      let norm = 0;
      for (let i = 0; i < peaks.length; i++) if (peaks[i] > norm) norm = peaks[i];
      const t = detectTempo(raw, rate);
      this.song = { name, raw, rate, buf, peaks, norm: norm || 1, env: t ? t.oss : null, hop: t ? t.hop : 256, fps: t ? t.fps : 0, len: raw.length };
      this.manual = null;
      this.glob = t ? t.bpm : 90;
      this.track();
      if (!this.st.targetSet) this.st.target = Math.round(this.glob);
      // comeca na primeira batida depois do primeiro som de verdade
      const first = this.firstSound();
      this.inPos = 0;
      if (this.bt) { const k = this.bt.findIndex(b => b >= first - 0.03 * rate); this.inPos = Math.round(this.bt[Math.max(0, k)]); }
      else this.inPos = first;
      this.inPos = clamp(this.inPos, 0, Math.max(0, raw.length - 1));
      this.busy(false);
      this.drawTarget();
      this.flash("LOADED " + name + "  " + mmss(raw.length / rate), t ? "TEMPO " + this.glob.toFixed(1) + " BPM - WRONG? TAP TEMPO" : "TEMPO NOT FOUND - USE TAP TEMPO", 3000);
      this.renderAll();
    }

    firstSound() {
      const p = this.song.peaks, thr = this.song.norm * 0.12;
      for (let i = 0; i < p.length; i++) if (p[i] > thr) return i * PEAK_HOP;
      return 0;
    }

    /** Acha as batidas com o tempo medio (ou o do Tap) como guia. */
    track(bpm) {
      const s = this.song;
      this.bt = null;
      if (!s || !s.env) return;
      const b = trackBeats(s.env, 60 * s.fps / (bpm || this.glob));
      if (b.length < 8) return;
      this.bt = Float64Array.from(b, f => f * s.hop);
    }

    /** Batida mais perto de pos. */
    beatIdx(pos) {
      const b = this.bt;
      let lo = 0, hi = b.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= pos) lo = m; else hi = m; }
      return pos - b[lo] <= b[hi] - pos ? lo : hi;
    }

    /**
     * Tamanho do loop medido nas batidas daquele trecho (media de tres medidas vizinhas,
     * para uma batida torta nao estragar). Sem batidas, ou com BPM manual, pela conta.
     */
    loopLen() {
      const s = this.song;
      if (!s) return 0;
      const N = 4 * this.st.bars, b = this.bt;
      if (b && this.manual == null) {
        const k = this.beatIdx(this.inPos);
        const ms = [];
        for (const d of [-1, 0, 1]) { const i = k + d; if (i >= 0 && i + N < b.length) ms.push(b[i + N] - b[i]); }
        if (ms.length) return Math.round(ms.reduce((x, y) => x + y, 0) / ms.length);
      }
      return Math.round(60 / (this.manual || this.glob) * s.rate * N);
    }

    /** Tempo da musica no trecho do loop: e o que aparece no Source BPM. */
    get src() { return this.song ? 60 * 4 * this.st.bars * this.song.rate / Math.max(1, this.loopLen()) : null; }
    beatLen() { return this.song ? this.loopLen() / (4 * this.st.bars) : 0; }
    outBpm() { return this.st.mode === "off" ? this.src : this.st.target; }
    speed() { return this.st.mode === "off" || !this.src ? 1 : this.st.target / this.src; }

    /** Inicio do loop, sem passar do fim da musica. snap: puxa para o ataque mais perto (±35 ms). */
    setIn(pos, snap) {
      if (!this.song) return;
      let p = Math.round(pos);
      if (snap) p = this.snap(p);
      this.inPos = clamp(p, 0, Math.max(0, this.song.len - Math.min(this.loopLen(), this.song.len)));
      this.changed();
    }

    snap(p) {
      const s = this.song;
      if (!s.env) return p;
      const c = Math.round(p / s.hop), w = Math.round(0.035 * s.rate / s.hop);
      let best = c, bv = -1;
      for (let i = Math.max(0, c - w); i <= Math.min(s.env.length - 1, c + w); i++) if (s.env[i] > bv) { bv = s.env[i]; best = i; }
      return bv > 0 ? best * s.hop : p;
    }

    /** O que mudou no loop marcado: atualiza o som que esta tocando e a tela. */
    changed() {
      const pl = this.play;
      if (pl && pl.kind === "loop") {
        if (this.st.mode === "stretch") { clearTimeout(this.restartT); this.restartT = setTimeout(() => this.startLoop(), 220); }
        else {
          const r = this.song.rate;
          pl.node.playbackRate.setValueAtTime(this.speed(), pl.node.context.currentTime);
          pl.node.loopStart = this.inPos / r;
          pl.node.loopEnd = (this.inPos + this.loopLen()) / r;
        }
      }
      this.renderAll();
    }

    /* ------------------------------------------------------- controles */

    key(k) {
      if (!this.on) return;
      if (k !== "setin" && this.prompt && k !== "nudge-" && k !== "nudge+") this.prompt = null;
      if (this.prompt && (k === "nudge-" || k === "nudge+")) { this.prompt.fmt = this.prompt.fmt === "wav" ? "mp3" : "wav"; this.flashUntil = 0; this.renderLCD(); return; }
      if (k === "tap") return this.tap();
      if (!this.song) { this.flash("NO SONG", "DROP A SONG ON THE DRIVE FIRST"); return; }
      switch (k) {
        case "nudge-": case "nudge+": {
          const dir = k === "nudge+" ? 1 : -1;
          // anda uma batida de verdade, guardando o ajuste fino que ja havia
          if (this.bt && this.manual == null) {
            const i = this.beatIdx(this.inPos), j = clamp(i + dir, 0, this.bt.length - 1);
            this.setIn(this.bt[j] + (this.inPos - this.bt[i]));
          } else this.setIn(this.inPos + dir * this.beatLen());
          return;
        }
        case "setin": return this.setInKey();
        case "play": return this.play ? this.stop() : this.startLoop();
        case "store": return this.store();
      }
    }

    tap() {
      const now = performance.now();
      if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
      this.taps.push(now);
      if (this.taps.length > 8) this.taps.shift();
      if (this.taps.length < 2) { this.flash("TAP TEMPO", "KEEP TAPPING ON THE BEAT...", 2000); return; }
      const dt = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      const bpm = clamp(Math.round(60000 / dt * 10) / 10, MIN_BPM, MAX_BPM);
      if (this.song) {
        // o Tap e o guia: acha o tempo exato perto dele e refaz as batidas
        this.manual = null;
        this.glob = this.song.env && this.taps.length >= 4 ? refine(this.song.env, this.song.fps, bpm, 0.04) : bpm;
        this.track(this.glob);
        this.changed();
      }
      else { this.st.target = Math.round(bpm * 10) / 10; this.st.targetSet = true; this.drawTarget(); this.dirty(); }
      this.flash("TAP TEMPO  " + bpm.toFixed(1) + " BPM", this.song ? (this.taps.length >= 4 ? "LOCKED ON " + this.glob.toFixed(2) + " BPM" : "KEEP TAPPING TO LOCK") : "TARGET TEMPO SET", 1500);
    }

    /**
     * Set In, como no JamMan: parado, toca a musica a partir do inicio atual (cue);
     * tocando, o inicio vai para onde a musica esta (puxado para o ataque mais
     * perto) e o loop comeca a repetir dali.
     */
    setInKey() {
      const pl = this.play;
      if (!pl || pl.kind === "slot") { this.startCue(); return; }
      this.setIn(this.playPos(), true);
      this.startLoop();
      this.flash("IN SET  BAR " + this.barBeat(), "LOOP PLAYING FROM HERE", 1200);
    }

    setBars(n) {
      if (!this.on) return;
      this.st.bars = n;
      if (this.song) this.setIn(this.inPos); else this.renderAll();
      this.dirty();
    }

    setMode(m) {
      if (!this.on || !MODES.includes(m)) return;
      this.st.mode = m;
      this.flash("TEMPO MODE: " + MODE_NAMES[m], { vari: "SPEED AND PITCH CHANGE TOGETHER", stretch: "PITCH STAYS, TEMPO CHANGES", off: "LOOP KEEPS THE SONG TEMPO" }[m], 1500);
      if (this.play && this.play.kind === "loop") this.startLoop();
      this.dirty();
      this.renderAll();
    }

    search(dir, sp) {
      if (!this.song) return;
      // passos de 2 ms, acelerando ate ~1 s por passo; no Fine, 1 ms sempre
      const step = this.fine ? Math.round(this.song.rate * 0.001) : Math.round(this.song.rate * 0.002 * Math.min(sp, 400));
      this.setIn(this.inPos + dir * step);
      if (!this.play) this.scrub();
    }

    toggleFine() {
      if (!this.on) return;
      this.fine = !this.fine;
      this.flash(this.fine ? "FINE ON: SEARCH MOVES 1 MS PER STEP" : "FINE OFF", this.fine ? "LCD ZOOMED: EACH CHARACTER = 10 MS" : "", 1500);
      this.renderAll();
    }

    turnTarget(dir, sp) {
      const d = sp > 20 ? 1 : sp > 6 ? 0.5 : 0.1;
      this.st.target = clamp(Math.round((this.st.target + dir * d) * 10) / 10, 60, 180);
      this.st.targetSet = true;
      this.changed();
      this.dirty();
    }

    turnSource(dir, sp) {
      if (!this.song) return;
      const d = sp > 20 ? 1 : sp > 6 ? 0.5 : 0.1;
      // a mao, o tempo fica fixo (sem seguir as batidas) ate o proximo Tap
      this.manual = clamp(Math.round(((this.manual || this.src) + dir * d) * 10) / 10, MIN_BPM, MAX_BPM);
      this.changed();
    }

    fadeText() { return "FADE " + Math.round(this.st.fade * 40) + " MS AT EACH END"; }

    /* ------------------------------------------------------- tocar */

    stop() {
      const pl = this.play;
      this.play = null;
      clearTimeout(this.restartT);
      if (pl) {
        try {
          const t = pl.node.context.currentTime;
          pl.g.gain.setTargetAtTime(0, t, 0.006);
          pl.node.stop(t + 0.05);
        } catch (e) { /* ja parou */ }
      }
      this.renderAll();
    }

    voice(buf, opts) {
      const ctx = this.engine.ensure();
      const out = this.ensureOut();
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const g = ctx.createGain();
      const t = ctx.currentTime + 0.01;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.004);
      node.connect(g); g.connect(out);
      return { node, g, t };
    }

    startLoop() {
      if (!this.song) return;
      const old = this.play;
      this.play = null;
      if (old) { try { old.g.gain.setTargetAtTime(0, old.node.context.currentTime, 0.006); old.node.stop(old.node.context.currentTime + 0.05); } catch (e) {} }
      const s = this.song, r = s.rate;
      let v;
      if (this.st.mode === "stretch") {
        const y = this.render();
        const ctx = this.engine.ensure();
        const b = ctx.createBuffer(1, y.length, r);
        b.getChannelData(0).set(y);
        v = this.voice(b);
        v.node.loop = true;
        v.node.start(v.t);
        this.play = Object.assign(v, { kind: "loop", from: 0, rate: 1, len: y.length, stretched: true, sr: r });
      } else {
        v = this.voice(s.buf);
        v.node.loop = true;
        v.node.loopStart = this.inPos / r;
        v.node.loopEnd = (this.inPos + this.loopLen()) / r;
        v.node.playbackRate.value = this.speed();
        v.node.start(v.t, this.inPos / r);
        this.play = Object.assign(v, { kind: "loop", sr: r });
      }
      v.node.onended = () => { if (this.play && this.play.node === v.node) { this.play = null; this.renderAll(); } };
      this.tick();
      this.renderAll();
    }

    /** Toca a musica a partir do inicio atual, sem repetir, para tocar Set In no tempo forte. */
    startCue() {
      this.stop();
      const s = this.song, v = this.voice(s.buf);
      v.node.playbackRate.value = 1;
      v.node.start(v.t, this.inPos / s.rate);
      this.play = Object.assign(v, { kind: "cue", from: this.inPos, sr: s.rate });
      v.node.onended = () => { if (this.play && this.play.node === v.node) { this.play = null; this.renderAll(); } };
      this.flash("CUE: LISTENING FROM BAR " + this.barBeat(), "PRESS SET IN ON THE DOWNBEAT", 2500);
      this.tick();
      this.renderAll();
    }

    /** Um pedacinho no ponto de inicio, ao girar o Search parado (como o cue de um CD). */
    scrub() {
      const now = performance.now();
      if (now - (this.lastScrub || 0) < 70) return;
      this.lastScrub = now;
      const s = this.song, ctx = this.engine.ensure(), out = this.ensureOut();
      const node = ctx.createBufferSource(), g = ctx.createGain();
      node.buffer = s.buf;
      const t = ctx.currentTime + 0.005;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.07, 0.01);
      node.connect(g); g.connect(out);
      node.start(t, this.inPos / s.rate, 0.12);
    }

    /** Onde a musica esta tocando agora (amostras da musica). */
    playPos() {
      const pl = this.play;
      if (!pl) return this.inPos;
      const r = pl.sr, el = Math.max(0, pl.node.context.currentTime - pl.t);
      if (pl.kind === "cue") return pl.from + el * r;
      const L = this.loopLen();
      if (pl.stretched) { const k = (el * r) % pl.len; return this.inPos + k * this.speed(); }
      return this.inPos + ((el * r * this.speed()) % L);
    }

    tick() {
      cancelAnimationFrame(this.raf);
      const go = () => {
        if (!this.play || this.play.kind === "slot") return;
        this.renderLCD();
        this.renderPos();
        this.raf = requestAnimationFrame(go);
      };
      this.raf = requestAnimationFrame(go);
    }

    /** O loop marcado, pronto: no tempo alvo e com o fade nas pontas. */
    render() {
      const s = this.song, L = this.loopLen();
      const seg = new Float32Array(L);
      seg.set(s.raw.subarray(this.inPos, Math.min(s.len, this.inPos + L)));
      const sp = this.speed();
      const y = this.st.mode === "stretch" ? stretch(seg, s.rate, sp) : varispeed(seg, s.rate, sp);
      fadeEdges(y, s.rate, this.st.fade * 0.04);
      return y;
    }

    /* ------------------------------------------------------- memorias */

    store() {
      const st = this.st;
      let i = st.sel >= 0 ? st.sel : st.slots.findIndex(x => !x);
      if (i < 0) i = 0;
      this.busy(true);
      const pcm = this.render();
      this.busy(false);
      st.slots[i] = { name: cleanName(this.song.name.slice(0, 7).trim() + " L" + (i + 1)), rate: this.song.rate, pcm, bpm: Math.round(this.outBpm() * 10) / 10, bars: st.bars, song: this.song.name };
      st.sel = i;
      // a proxima vai para a proxima livre
      this.flash("STORED IN LOOP " + pad2(i + 1) + "  " + (pcm.length / this.song.rate).toFixed(2) + "s", st.bars + " BARS AT " + this.outBpm().toFixed(1) + " BPM - SEND IT!", 2500);
      this.dirty();
      this.renderAll();
    }

    selectSlot(i) {
      if (!this.on) return;
      const st = this.st, x = st.slots[i];
      if (this.play && this.play.kind === "slot" && st.sel === i) { this.stop(); return; }
      st.sel = st.sel === i && !x ? -1 : i;
      this.prompt = null;
      if (x) {
        this.stop();
        const ctx = this.engine.ensure();
        const b = ctx.createBuffer(1, x.pcm.length, x.rate);
        b.getChannelData(0).set(x.pcm);
        const v = this.voice(b);
        v.node.start(v.t);
        this.play = Object.assign(v, { kind: "slot" });
        v.node.onended = () => { if (this.play && this.play.node === v.node) { this.play = null; this.renderAll(); } };
        this.flash("LOOP " + pad2(i + 1) + "  " + x.name, x.bars + " BARS  " + x.bpm.toFixed(1) + " BPM  " + (x.pcm.length / x.rate).toFixed(2) + "s", 2000);
      } else this.flash("LOOP " + pad2(i + 1) + " EMPTY", st.sel === i ? "STORE PUTS THE NEXT LOOP HERE" : "", 1500);
      this.dirty();
      this.renderAll();
    }

    /** O loop para mandar: a memoria escolhida ou, sem ela, o que esta marcado. */
    current() {
      const x = this.st.slots[this.st.sel];
      if (x) return x;
      if (!this.song) return null;
      return { name: cleanName(this.song.name.slice(0, 5).trim() + " LOOP"), rate: this.song.rate, pcm: this.render(), bpm: this.outBpm(), bars: this.st.bars };
    }

    wavFile(x) {
      const ab = RJ.dsp.encodeWav([x.pcm], x.rate);
      return new File([ab], x.name + ".wav", { type: "audio/wav" });
    }

    send(k) {
      if (!this.on) return;
      if (k === "disk" && this.prompt) { this.saveDisk(this.prompt.fmt); this.prompt = null; return; }
      this.prompt = null;
      const x = this.current();
      if (!x) { this.flash("NOTHING TO SEND", "DROP A SONG OR CHOOSE A STORED LOOP"); return; }
      this.blinkSend(k);
      if (k === "sp") {
        // o SP pede o pad e depois pergunta do 45 RPM, como no SAMPLE 8
        const app = this.app, f = this.wavFile(x);
        app.openPage(app.selectSound("Loop To Pad", s => { app.exitPage(true); app.loadAudioFiles([f], s); }, "Hit a Pad"), "sample");
        this.flash("SEND " + x.name + " TO THE RJ-2000", "HIT A PAD ON THE RJ-2000", 3000);
      } else if (k === "s950") {
        const s9 = this.app.s950;
        if (!s9.on) { this.flash("RJ-950 IS OFF", "TURN IT ON FIRST"); return; }
        s9.loadFile(this.wavFile(x));
        this.flash("SENT " + x.name + " TO THE RJ-950", "LOOK AT THE RJ-950 DISPLAY", 2500);
      } else if (k === "disk") {
        this.prompt = { kind: "disk", fmt: "wav" };
        this.flashUntil = 0;
        this.renderLCD();
      }
    }

    async saveDisk(fmt) {
      const x = this.st.slots[this.st.sel] || (this.song ? this.current() : null);
      if (!x) return;
      const base = x.name.toLowerCase().replace(/\s+/g, "-") + "-" + Math.round(x.bpm) + "bpm";
      if (fmt === "wav") {
        RJ.dsp.downloadBlob(new Blob([RJ.dsp.encodeWav([x.pcm], x.rate)], { type: "audio/wav" }), base + ".wav");
        this.flash("SAVED " + base.toUpperCase().slice(0, 30), "FORMAT WAV", 2500);
        return;
      }
      this.busy(true);
      this.flash("ENCODING MP3...", "PLEASE WAIT", 60000);
      try {
        const blob = await encodeMp3(x.pcm, x.rate);
        RJ.dsp.downloadBlob(blob, base + ".mp3");
        this.flash("SAVED " + base.toUpperCase().slice(0, 30), "FORMAT MP3 192K", 2500);
      } catch (e) {
        console.warn(e);
        this.flash("MP3 ERROR", "NO INTERNET FOR THE ENCODER - USE WAV", 3000);
      }
      this.busy(false);
    }

    blinkSend(k) {
      const led = $(`[data-r42sendled="${k}"]`, this.el.root);
      if (!led) return;
      led.classList.add("on");
      setTimeout(() => led.classList.remove("on"), 400);
    }

    /* ------------------------------------------------------- salvar */

    dirty() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.saveNow(), 1500); }

    saveNow() {
      clearTimeout(this.saveT);
      if (!this.loaded) return;
      try { RJ.store.put(STORE_KEY, this.serialize()); } catch (e) { console.warn(e); }
    }

    serialize() {
      const st = this.st;
      return JSON.stringify(Object.assign({}, st, {
        slots: st.slots.map(x => {
          if (!x) return null;
          if (!x.b64) Object.defineProperty(x, "b64", { value: RJ.dsp.floatToB64(x.pcm), enumerable: false, writable: true });
          return { name: x.name, rate: x.rate, bpm: x.bpm, bars: x.bars, song: x.song, pcm: x.b64 };
        }),
      }));
    }

    deserialize(json) {
      const d = typeof json === "string" ? JSON.parse(json) : json;
      if (!d || d.format !== "rj42") throw new Error("Nao e uma memoria do RJ-42");
      const st = newState();
      ["target", "targetSet", "bars", "fade", "out", "sel"].forEach(k => { if (d[k] !== undefined) st[k] = d[k]; });
      if (MODES.includes(d.mode)) st.mode = d.mode;
      if (![1, 2, 4, 8].includes(st.bars)) st.bars = 4;
      st.target = clamp(+st.target || 90, 60, 180);
      st.sel = clamp(st.sel | 0, -1, SLOTS - 1);
      st.slots = new Array(SLOTS).fill(null).map((_, i) => {
        const x = d.slots && d.slots[i];
        if (!x || !x.pcm) return null;
        const pcm = RJ.dsp.b64ToFloat(x.pcm);
        const o = { name: cleanName(x.name), rate: x.rate, bpm: +x.bpm || 0, bars: x.bars | 0, song: x.song || "", pcm };
        Object.defineProperty(o, "b64", { value: x.pcm, enumerable: false, writable: true });
        return o;
      });
      return st;
    }

    /* ------------------------------------------------------- tela */

    busy(b) { if (this.el.busy) this.el.busy.classList.toggle("on", b); }

    barBeat() {
      if (!this.song) return "---.-";
      const b = this.bt ? this.beatIdx(this.inPos) : Math.floor(this.inPos / this.beatLen() + 1e-3);
      const bar = Math.floor(b / 4) + 1, beat = ((b % 4) + 4) % 4 + 1;
      return String(clamp(bar, 0, 999)).padStart(3, "0") + "." + beat;
    }

    /** Janela da forma de onda: o loop ocupa as celulas 4 a 35. */
    view() {
      const L = Math.max(1, this.loopLen());
      // no Fine, 10 ms por celula e o inicio na celula 8
      if (this.fine && this.song) { const cell = this.song.rate * 0.01; return { a: this.inPos - 8 * cell, cell, L, first: 8, last: COLS }; }
      const cell = L / 32;
      return { a: this.inPos - 4 * cell, cell, L, first: 4, last: 36 };
    }

    lcd(rows) {
      rows.forEach((row, r) => {
        const el = r ? this.el.l2 : this.el.l1;
        const cells = typeof row === "string" ? Array.from(fit(row, COLS)).map(ch => ({ ch })) : row;
        let html = "";
        for (let i = 0; i < COLS; i++) {
          const c = cells[i] || { ch: " " };
          const cls = [c.h != null ? "bar" : "", c.cls || ""].join(" ").trim();
          if (c.h != null) html += `<span class="${cls}" style="--h:${c.h}"></span>`;
          else html += `<span${cls ? ` class="${cls}"` : ""}>${c.ch === " " || !c.ch ? "&nbsp;" : esc(c.ch)}</span>`;
        }
        el.innerHTML = html;
      });
    }

    flash(a, b, ms = 1800) {
      if (!this.el) return;
      this.flashUntil = performance.now() + ms;
      this.lcd([a, b || ""]);
      clearTimeout(this.flashT);
      this.flashT = setTimeout(() => { this.flashUntil = 0; this.renderLCD(); }, ms);
    }

    renderLCD() {
      if (!this.el) return;
      if (!this.on) { this.lcd(["", ""]); return; }
      if (performance.now() < this.flashUntil) return;
      const st = this.st;
      if (this.prompt) {
        const x = st.slots[st.sel] || null, f = this.prompt.fmt;
        this.lcd(["SAVE " + (x ? "LOOP " + pad2(st.sel + 1) + " " + x.name : "MARKED LOOP") + " TO DISK",
          "FORMAT  " + (f === "wav" ? "[WAV]  MP3 " : " WAV  [MP3]") + "  NUDGE=CHANGE DISK=OK"]);
        return;
      }
      const s = this.song;
      if (!s) {
        this.lcd(["RJ-42  LOOP PHRASE RECORDER    NO SONG", "DROP A SONG ON THE DRIVE OR CLICK IT"]);
        return;
      }
      const secs = this.loopLen() / s.rate / this.speed();
      const ms3 = t => { const m = Math.floor(t / 60); return m + ":" + (t - m * 60).toFixed(3).padStart(6, "0"); };
      const l1 = this.fine
        ? fit(s.name, 10) + " IN " + fit(ms3(this.inPos / s.rate), 9) + "  FINE 1MS/STEP"
        : fit(s.name, 12) + " IN " + fit(mmss(this.inPos / s.rate), 8) + " " + st.bars + "BAR " + secs.toFixed(1).padStart(4) + "s";
      // forma de onda: o loop no meio, marcas de compasso (de tempo, com 1 compasso)
      const w = this.view(), ph = this.play && this.play.kind !== "slot" ? this.playPos() : -1;
      const tickEvery = st.bars > 1 ? 4 * this.beatLen() : this.beatLen();
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        const a = w.a + c * w.cell, b = a + w.cell;
        let m = 0;
        if (this.fine) { for (let k = Math.max(0, Math.floor(a)); k < Math.min(s.len, Math.ceil(b)); k++) { const v = Math.abs(s.raw[k]); if (v > m) m = v; } }
        else for (let k = Math.max(0, Math.floor(a / PEAK_HOP)); k < Math.min(s.peaks.length, Math.ceil(b / PEAK_HOP)); k++) if (s.peaks[k] > m) m = s.peaks[k];
        const inLoop = c >= w.first && c < w.last;
        const cls = [];
        if (inLoop) cls.push("lp"); else cls.push("dim");
        if (c === w.first) cls.push("mk-l");
        if (c === w.last - 1 && !this.fine) cls.push("mk-r");
        if (inLoop && !this.fine) {
          const rel = a - this.inPos, k = Math.ceil(rel / tickEvery - 1e-6) * tickEvery;
          if (k > 0 && k < rel + w.cell && rel + w.cell <= w.L) cls.push("tick");
        }
        if (ph >= 0 && ph >= a && ph < b) cls.push("ph");
        cells.push({ h: a < 0 || a >= s.len ? 0 : Math.round(Math.min(1, m / s.norm) * 100), cls: cls.join(" ") });
      }
      this.lcd([l1, cells]);
    }

    renderPos() { if (this.el) this.el.pos.innerHTML = segHTML(this.on && this.song ? this.barBeat() : "---.-"); }

    renderAll() {
      if (!this.el) return;
      const st = this.st, on = this.on;
      this.el.src.innerHTML = segHTML(bpmText(on && this.song ? this.src : null));
      this.el.tgt.innerHTML = segHTML(on ? bpmText(st.mode === "off" && this.song ? this.src : st.target) : bpmText(null));
      this.renderPos();
      this.el.num.innerHTML = segHTML(on ? (st.sel >= 0 ? pad2(st.sel + 1) : "--") : "--");
      $$("[data-r42mode]", this.el.root).forEach(b => b.querySelector(".led").classList.toggle("on", on && b.dataset.r42mode === st.mode));
      $$("[data-r42barled]", this.el.root).forEach(l => l.classList.toggle("on", on && +l.dataset.r42barled === st.bars));
      $$("[data-r42slot]", this.el.root).forEach(b => {
        const i = +b.dataset.r42slot;
        b.querySelector(".led").classList.toggle("on", on && !!st.slots[i]);
        b.classList.toggle("sel", on && st.sel === i);
      });
      const pl = this.play;
      this.el.playLed.classList.toggle("on", on && !!pl && pl.kind === "loop");
      $("#r42-fine-led").classList.toggle("on", on && this.fine);
      this.el.playLed.classList.toggle("blink", on && !!pl && pl.kind === "cue");
      this.renderLCD();
    }
  }

  RJ.R42 = R42;
  RJ.R42.detectTempo = detectTempo;
  RJ.R42.stretch = stretch;
  RJ.R42.trackBeats = trackBeats;
  RJ.R42.flux = flux;
})();
