/* RJ.Tape - saturacao de fita (AudioWorklet)
 *
 * Uma "mesa" generica: entra um sinal, sai o mesmo sinal com cara de fita.
 * Nao sabe nada de quem usa (RJ-42 hoje, a mesa do Studio depois).
 *
 *   const t = new RJ.Tape(ctx);       // passa direto ate o worklet carregar
 *   fonte.connect(t.input); t.output.connect(destino);
 *   t.setDrive(0.4);                  // 0 a 1; 0 = sai igual ao que entra
 *
 * Cadeia (por canal), escrita do zero a partir da literatura:
 *   pre-enfase (shelf de agudos, +6 dB no maximo) -> ganho -> tanh com ADAA de
 *   1a ordem (Parker, Zavalishin e Le Bivic, "Reducing the aliasing of nonlinear
 *   waveshaping using continuous-time convolution", DAFx 2016) -> de-enfase
 *   (inverso exato da pre-enfase) -> perda de agudos (um polo) -> mistura com o
 *   seco -> wow/flutter (atraso modulado, comum aos canais).
 * A pre/de-enfase faz a fita comprimir mais os agudos que os graves, como na
 * gravacao de verdade. Tudo cresce junto com o Drive: perto de 0 a cadeia some,
 * e em 0 exato o processador copia a entrada (bit a bit).
 *
 * ADAA de 1a ordem: y[n] = (F(u[n]) - F(u[n-1])) / (u[n] - u[n-1]), com
 * F(u) = ln cosh(u), a antiderivada de tanh. Quando u[n] ~ u[n-1], a divisao
 * fica mal condicionada e o valor certo e o limite: tanh((u[n] + u[n-1]) / 2).
 * O custo e meio sample de atraso e um leve passa-baixa, que entram como parte
 * da perda de agudos da fita.
 */
window.RJ = window.RJ || {};

(function () {
  "use strict";
  const RJ = window.RJ;

  const WORKLET = `
const LN2 = Math.LN2;
// ln cosh(u) sem estourar: |u| + ln(1 + e^-2|u|) - ln 2
const lncosh = u => { const a = Math.abs(u); return a + Math.log1p(Math.exp(-2 * a)) - LN2; };
const EPS = 1e-5;
const REF = 0.25;            // nivel (-12 dBFS) que passa com o mesmo volume em qualquer Drive
const WOW_HZ = 0.55, FLUT_HZ = 6.3;
const WOW_S = 1.2e-4, FLUT_S = 6e-6;   // profundidade (s) no Drive maximo: ~0,04% e ~0,02% de velocidade
const BUF = 128;              // linha de atraso do wow (potencia de 2)

class RJTape extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "drive", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }
  constructor(opt) {
    super();
    const o = (opt && opt.processorOptions) || {};
    this.adaa = o.adaa !== false;    // false so para medir o aliasing sem ADAA
    this.wow = o.wow !== false;
    this.d = 0;                      // Drive suavizado (por sample)
    this.k = 1 - Math.exp(-1 / (0.025 * sampleRate));   // ~25 ms
    this.ph1 = 0; this.ph2 = Math.random();
    this.ch = [];
    this.on = false;
    this.port.onmessage = e => { if (e.data && "adaa" in e.data) this.adaa = !!e.data.adaa; };
  }
  state(i) {
    return this.ch[i] || (this.ch[i] = { px: 0, py: 0, u1: 0, F1: 0, dx: 0, dy: 0, lp: 0, buf: new Float64Array(BUF), w: 0 });
  }
  reset() {
    for (const s of this.ch) { s.px = s.py = s.u1 = s.F1 = s.dx = s.dy = s.lp = 0; s.buf.fill(0); s.w = 0; }
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    const target = params.drive[0];
    const n = out[0] ? out[0].length : 128;
    // Drive 0 parado: copia exata (ou silencio sem entrada)
    if (target <= 0 && this.d < 1e-5) {
      this.d = 0;
      if (this.on) { this.on = false; this.reset(); }
      for (let c = 0; c < out.length; c++) {
        const x = inp[c] || inp[0];
        if (x) out[c].set(x); else out[c].fill(0);
      }
      return true;
    }
    this.on = true;
    const fs = sampleRate, k = this.k;
    // coeficientes do bloco (mudam devagar; o Drive em si e suavizado por sample)
    const dB = this.d + (target - this.d) * Math.min(1, k * n * 0.5);
    // pre-enfase: 1 + c*HP(3 kHz); de-enfase: o inverso exato
    const p = Math.exp(-2 * Math.PI * 3000 / fs), al = (1 + p) / 2;
    const c = dB * (Math.pow(10, 6 / 20) - 1);
    const b0 = 1 + c * al, b1 = -(p + c * al);          // pre: (b0 + b1 z^-1) / (1 - p z^-1)
    // perda de agudos: um polo de 18 kHz (Drive baixo) a 11 kHz (Drive 1)
    const fc = Math.min(18000 - 7000 * dB, fs * 0.45);
    const a = 1 - Math.exp(-2 * Math.PI * fc / fs);
    const nch = out.length;
    for (let c2 = 0; c2 < nch; c2++) this.state(c2);
    const dW = this.wow ? 2 * Math.PI * WOW_HZ / fs : 0, dF = this.wow ? 2 * Math.PI * FLUT_HZ / fs : 0;
    for (let i = 0; i < n; i++) {
      const d = this.d += (target - this.d) * k;
      const g = Math.pow(10, d * 18 / 20);               // ate +18 dB na entrada
      const mk = REF / Math.tanh(REF * g);               // -12 dBFS sai com o mesmo nivel
      const wet = Math.min(1, d * 2.5);                   // mistura: so seco em 0, so fita a partir de 0,4
      this.ph1 += dW; if (this.ph1 > 2 * Math.PI) this.ph1 -= 2 * Math.PI;
      this.ph2 += dF; if (this.ph2 > 2 * Math.PI) this.ph2 -= 2 * Math.PI;
      const del = this.wow ? d * fs * (WOW_S * (1 + Math.sin(this.ph1)) + FLUT_S * (1 + Math.sin(this.ph2))) : 0;
      for (let ci = 0; ci < nch; ci++) {
        const s = this.ch[ci];
        const xa = inp[ci] || inp[0];
        const x = xa ? xa[i] : 0;
        // pre-enfase
        const e = b0 * x + b1 * s.px + p * s.py; s.px = x; s.py = e;
        // tanh com ADAA de 1a ordem
        const u = g * e;
        let y;
        if (this.adaa) {
          const F = lncosh(u), du = u - s.u1;
          y = Math.abs(du) > EPS ? (F - s.F1) / du : Math.tanh(0.5 * (u + s.u1));
          s.u1 = u; s.F1 = F;
        } else y = Math.tanh(u);
        y *= mk;
        // de-enfase (inverso da pre): (1 - p z^-1) / (b0 + b1 z^-1)
        const z = (y - p * s.dx - b1 * s.dy) / b0; s.dx = y; s.dy = z;
        // perda de agudos
        s.lp += a * (z - s.lp);
        let o = x + wet * (s.lp - x);
        // wow/flutter: atraso modulado (Hermite a partir de 1 sample, linear abaixo)
        s.buf[s.w] = o;
        if (del > 0) {
          const ip = Math.floor(del), f = del - ip, M = BUF - 1, w = s.w;
          const x0 = s.buf[(w - ip) & M], xm = s.buf[(w - ip - 1) & M];
          if (ip < 1) o = x0 + f * (xm - x0);
          else {
            const xp = s.buf[(w - ip + 1) & M], xmm = s.buf[(w - ip - 2) & M];
            // Hermite de 4 pontos entre x0 (atraso ip) e xm (ip + 1)
            const c1 = 0.5 * (xm - xp), c2 = xp - 2.5 * x0 + 2 * xm - 0.5 * xmm, c3 = 0.5 * (xmm - xp) + 1.5 * (x0 - xm);
            o = ((c3 * f + c2) * f + c1) * f + x0;
          }
        }
        s.w = (s.w + 1) & (BUF - 1);
        out[ci][i] = o;
      }
    }
    return true;
  }
}
registerProcessor("rj-tape", RJTape);
`;

  const loaded = new WeakMap();

  /** Carrega o worklet no contexto (uma vez por contexto). Promessa de true/false. */
  function load(ctx) {
    if (loaded.has(ctx)) return loaded.get(ctx);
    let p;
    if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") p = Promise.resolve(false);
    else {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      p = ctx.audioWorklet.addModule(url).then(() => true, e => { console.warn("AudioWorklet da fita nao carregou", e); return false; })
        .finally(() => URL.revokeObjectURL(url));
    }
    loaded.set(ctx, p);
    return p;
  }

  RJ.Tape = class {
    /**
     * ctx: AudioContext ou OfflineAudioContext.
     * opt.drive: Drive inicial (0 a 1). opt.adaa / opt.wow: false desliga (para medir).
     * Ate o worklet carregar, input liga direto no output (som igual ao Drive 0).
     */
    constructor(ctx, opt = {}) {
      this.ctx = ctx;
      this.opt = opt;
      this.drive = Math.max(0, Math.min(1, +opt.drive || 0));
      this.input = ctx.createGain();
      this.output = ctx.createGain();
      this.input.connect(this.output);
      this.node = null;
      this.ready = load(ctx).then(ok => {
        if (!ok) return false;
        const n = new AudioWorkletNode(ctx, "rj-tape", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
          parameterData: { drive: this.drive },
          processorOptions: { adaa: opt.adaa !== false, wow: opt.wow !== false },
        });
        this.input.connect(n);
        n.connect(this.output);
        this.input.disconnect(this.output);
        this.node = n;
        return true;
      });
    }

    /** Drive de 0 a 1. A suavizacao (~25 ms) fica no worklet, entao nao estala. */
    setDrive(v) {
      this.drive = Math.max(0, Math.min(1, +v || 0));
      if (this.node) this.node.parameters.get("drive").setValueAtTime(this.drive, this.ctx.currentTime);
    }

    disconnect() {
      try { this.output.disconnect(); } catch (_) {}
    }
  };

  RJ.Tape.load = load;
})();
