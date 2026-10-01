/**
 * Síntesis procedural de los sonidos provisionales (sin ficheros externos).
 * Cada sonido se renderiza una vez con un OfflineAudioContext y se codifica a WAV para
 * Howler. Cuando haya grabaciones reales (CC0) basta con sustituir la URL del sonido.
 */

const SR = 22050;

type Build = (ctx: OfflineAudioContext, out: AudioNode, seconds: number) => void;

async function render(seconds: number, build: Build): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  build(ctx, master, seconds);
  return ctx.startRendering();
}

function noise(ctx: BaseAudioContext, seconds: number, color: 'white' | 'brown' | 'pink' = 'white'): AudioBufferSourceNode {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** Envolvente por tramos lineales: [tiempo, valor][]. */
function envelope(ctx: BaseAudioContext, points: [number, number][]): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(points[0][1], points[0][0]);
  for (let i = 1; i < points.length; i++) g.gain.linearRampToValueAtTime(points[i][1], points[i][0]);
  return g;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function softClip(ctx: BaseAudioContext, amount = 2.5): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  shaper.curve = curve;
  return shaper;
}

function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Respuesta impulsional sintética para una reverberación de sabana abierta. */
function reverb(ctx: BaseAudioContext, seconds = 2.2): ConvolverNode {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const ir = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = ir.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const c = ctx.createConvolver();
  c.buffer = ir;
  return c;
}

// --- Sonidos -------------------------------------------------------------------------------

/** Rugido: un largo gemido grave seguido de gruñidos cada vez más cortos. */
const roar: Build = (ctx, out) => {
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = o2.type = 'sawtooth';
  o1.frequency.setValueAtTime(92, 0);
  o1.frequency.linearRampToValueAtTime(122, 0.55);
  o1.frequency.exponentialRampToValueAtTime(70, 2.0);
  o2.frequency.setValueAtTime(99, 0);
  o2.frequency.linearRampToValueAtTime(128, 0.55);
  o2.frequency.exponentialRampToValueAtTime(74, 2.0);
  const n = noise(ctx, 3.4, 'brown');
  const nf = filter(ctx, 'bandpass', 380, 0.8);
  const mix = ctx.createGain();
  o1.connect(mix);
  o2.connect(mix);
  chain(n, nf, mix);
  const env = envelope(ctx, [
    [0, 0],
    [0.35, 1],
    [1.4, 0.9],
    [1.95, 0.05],
    [2.05, 0.75],
    [2.3, 0.05],
    [2.4, 0.6],
    [2.62, 0.05],
    [2.72, 0.45],
    [2.92, 0.03],
    [3.0, 0.3],
    [3.3, 0],
  ]);
  chain(mix, softClip(ctx, 3), filter(ctx, 'lowpass', 1000), filter(ctx, 'peaking', 260, 1), env, out);
  (out as GainNode).gain.value = 0.55;
  for (const s of [o1, o2, n]) {
    s.start(0);
    s.stop(3.4);
  }
};

/** Maullido agudo de cachorro. */
const cubCall: Build = (ctx, out) => {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(700, 0);
  o.frequency.linearRampToValueAtTime(1080, 0.12);
  o.frequency.exponentialRampToValueAtTime(620, 0.5);
  const vib = ctx.createOscillator();
  const vibDepth = ctx.createGain();
  vib.frequency.value = 13;
  vibDepth.gain.value = 30;
  chain(vib, vibDepth);
  vibDepth.connect(o.frequency);
  chain(o, filter(ctx, 'bandpass', 1300, 1.1), envelope(ctx, [[0, 0], [0.05, 0.9], [0.3, 0.6], [0.55, 0]]), out);
  o.start(0);
  vib.start(0);
  o.stop(0.6);
  vib.stop(0.6);
};

/** Gruñido grave de advertencia. */
const growl: Build = (ctx, out) => {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 62;
  const n = noise(ctx, 1.7, 'brown');
  const trem = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 23;
  lfoDepth.gain.value = 0.45;
  trem.gain.value = 0.55;
  chain(lfo, lfoDepth);
  lfoDepth.connect(trem.gain);
  const mix = ctx.createGain();
  o.connect(mix);
  n.connect(mix);
  chain(mix, trem, softClip(ctx, 2), filter(ctx, 'lowpass', 520), envelope(ctx, [[0, 0], [0.2, 1], [1.2, 0.8], [1.65, 0]]), out);
  for (const s of [o, n, lfo]) {
    s.start(0);
    s.stop(1.7);
  }
};

/** Aullido ascendente ("whoop") del clan de hienas. */
const hyenaWhoop: Build = (ctx, out) => {
  const o = ctx.createOscillator();
  const h = ctx.createOscillator();
  o.type = 'sine';
  h.type = 'triangle';
  o.frequency.setValueAtTime(290, 0);
  o.frequency.exponentialRampToValueAtTime(1000, 1.2);
  h.frequency.setValueAtTime(580, 0);
  h.frequency.exponentialRampToValueAtTime(2000, 1.2);
  const hg = ctx.createGain();
  hg.gain.value = 0.15;
  chain(h, hg);
  const mix = ctx.createGain();
  o.connect(mix);
  hg.connect(mix);
  chain(mix, envelope(ctx, [[0, 0], [0.1, 0.8], [1.1, 0.8], [1.5, 0]]), out);
  for (const s of [o, h]) {
    s.start(0);
    s.stop(1.5);
  }
};

/** "Risa" nerviosa de hiena: pulsos agudos entrecortados. */
const hyenaGiggle: Build = (ctx, out) => {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const gate = ctx.createGain();
  gate.gain.value = 0;
  for (let i = 0; i < 9; i++) {
    const t = 0.05 + i * 0.13;
    o.frequency.setValueAtTime(470 + Math.random() * 180, t);
    o.frequency.linearRampToValueAtTime(420 + Math.random() * 100, t + 0.08);
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(0.7 - i * 0.05, t + 0.015);
    gate.gain.linearRampToValueAtTime(0, t + 0.09);
  }
  chain(o, gate, filter(ctx, 'bandpass', 1200, 2), out);
  o.start(0);
  o.stop(1.3);
};

const bite: Build = (ctx, out) => {
  const n = noise(ctx, 0.3);
  chain(n, filter(ctx, 'highpass', 1400), envelope(ctx, [[0, 1], [0.12, 0]]), out);
  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(140, 0);
  thump.frequency.exponentialRampToValueAtTime(60, 0.12);
  chain(thump, envelope(ctx, [[0, 0.8], [0.15, 0]]), out);
  n.start(0);
  thump.start(0);
  thump.stop(0.3);
};

const lap: Build = (ctx, out) => {
  const n = noise(ctx, 0.55);
  const gate = ctx.createGain();
  gate.gain.value = 0;
  for (const t of [0, 0.17, 0.34]) {
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(0.8, t + 0.015);
    gate.gain.linearRampToValueAtTime(0, t + 0.07);
  }
  chain(n, filter(ctx, 'bandpass', 2400, 3), gate, out);
  n.start(0);
};

const chew: Build = (ctx, out) => {
  const n = noise(ctx, 0.65, 'brown');
  const gate = ctx.createGain();
  gate.gain.value = 0;
  for (const t of [0, 0.22, 0.44]) {
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(1, t + 0.03);
    gate.gain.linearRampToValueAtTime(0, t + 0.15);
  }
  chain(n, filter(ctx, 'lowpass', 900), gate, out);
  n.start(0);
};

const pounce: Build = (ctx, out) => {
  const n = noise(ctx, 0.45, 'pink');
  const f = filter(ctx, 'bandpass', 400, 1.5);
  f.frequency.exponentialRampToValueAtTime(2200, 0.3);
  chain(n, f, envelope(ctx, [[0, 0], [0.2, 0.7], [0.4, 0]]), out);
  n.start(0);
};

/** Campanilla suave de hito conseguido (tipo kalimba). */
const milestone: Build = (ctx, out) => {
  const verb = reverb(ctx, 1.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  chain(verb, wet, out);
  [880, 1318.5, 1760].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const env = envelope(ctx, [[0, 0], [0.01 + i * 0.09, 0], [0.02 + i * 0.09, 0.35], [1.1, 0]]);
    chain(o, env, out);
    env.connect(verb);
    o.start(0);
    o.stop(1.3);
  });
};

// --- Bucles de ambiente y música --------------------------------------------------------------

/** Viento: ruido marrón filtrado con rachas periódicas (el bucle encaja sin cortes). */
const wind: Build = (ctx, out, seconds) => {
  const n = noise(ctx, seconds, 'brown');
  const hiss = noise(ctx, seconds, 'pink');
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.12;
  const gust = ctx.createGain();
  const curve = new Float32Array(256);
  for (let i = 0; i < curve.length; i++) {
    const p = i / (curve.length - 1);
    curve[i] = 0.55 + 0.3 * Math.sin(p * Math.PI * 2) + 0.15 * Math.sin(p * Math.PI * 6 + 1);
  }
  gust.gain.setValueCurveAtTime(curve, 0, seconds);
  const mix = ctx.createGain();
  chain(n, filter(ctx, 'lowpass', 380), mix);
  chain(hiss, filter(ctx, 'highpass', 2500), hissGain, mix);
  chain(mix, gust, out);
  n.start(0);
  hiss.start(0);
};

/** Pájaros al amanecer: trinos y silbidos aleatorios. */
const birds: Build = (ctx, out, seconds) => {
  const verb = reverb(ctx, 1.5);
  const wet = ctx.createGain();
  wet.gain.value = 0.25;
  chain(verb, wet, out);
  for (let i = 0; i < 26; i++) {
    const t = Math.random() * (seconds - 0.5);
    const o = ctx.createOscillator();
    const base = 2200 + Math.random() * 2400;
    const dur = 0.06 + Math.random() * 0.18;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.7), t + dur);
    if (Math.random() < 0.4) {
      const trill = ctx.createOscillator();
      const depth = ctx.createGain();
      trill.frequency.value = 25 + Math.random() * 20;
      depth.gain.value = 300;
      chain(trill, depth);
      depth.connect(o.frequency);
      trill.start(t);
      trill.stop(t + dur + 0.05);
    }
    const env = envelope(ctx, [[0, 0], [t, 0], [t + 0.01, 0.15 + Math.random() * 0.2], [t + dur, 0]]);
    chain(o, env, out);
    env.connect(verb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
};

/** Insectos nocturnos: grillos a distintos tonos y un siseo de cigarras. */
const insects: Build = (ctx, out, seconds) => {
  [4300, 4750, 5200].forEach((f, k) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const period = 0.7 + k * 0.23;
    for (let t = (k * 0.31) % period; t < seconds - 0.4; t += period) {
      for (let p = 0; p < 4; p++) {
        const s = t + p * 0.035;
        gate.gain.setValueAtTime(0, s);
        gate.gain.linearRampToValueAtTime(0.12, s + 0.006);
        gate.gain.linearRampToValueAtTime(0, s + 0.025);
      }
    }
    chain(o, gate, out);
    o.start(0);
    o.stop(seconds);
  });
  const hiss = noise(ctx, seconds);
  const am = ctx.createGain();
  am.gain.value = 0.02;
  chain(hiss, filter(ctx, 'bandpass', 6500, 4), am, out);
  hiss.start(0);
};

/** Colchón orquestal tranquilo: dos acordes que se funden (La menor → Fa mayor). */
const musicCalm: Build = (ctx, out, seconds) => {
  const verb = reverb(ctx, 3);
  const bus = ctx.createGain();
  bus.gain.value = 0.18;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  chain(bus, filter(ctx, 'lowpass', 1500), out);
  bus.connect(verb);
  chain(verb, wet, out);
  const chords = [
    [110, 164.8, 220, 261.6, 329.6, 493.9],
    [87.3, 130.8, 220, 261.6, 349.2, 440],
  ];
  const curve1 = new Float32Array(512);
  const curve2 = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const w = 0.5 + 0.5 * Math.cos((i / 511) * Math.PI * 2);
    curve1[i] = w;
    curve2[i] = 1 - w;
  }
  chords.forEach((notes, ci) => {
    const cg = ctx.createGain();
    cg.gain.setValueCurveAtTime(ci === 0 ? curve1 : curve2, 0, seconds);
    cg.connect(bus);
    notes.forEach((f, ni) => {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = ni < 2 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = ni < 2 ? 0.5 : 0.22;
        chain(o, g, cg);
        o.start(0);
        o.stop(seconds);
      }
    });
  });
};

/** Capa de tensión: tambores graves y ostinato de cuerdas (se mezcla con la tranquila). */
const musicDanger: Build = (ctx, out, seconds) => {
  const beat = seconds / 6;
  for (const b of [0, 1, 1.5, 3, 4, 4.5]) {
    const t = b * beat;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    chain(o, envelope(ctx, [[0, 0], [t, 0], [t + 0.01, 0.9], [t + 0.45, 0]]), out);
    o.start(t);
    o.stop(t + 0.5);
  }
  const strings = ctx.createOscillator();
  strings.type = 'sawtooth';
  strings.frequency.value = 55;
  const gate = ctx.createGain();
  gate.gain.value = 0;
  for (let i = 0; i < 12; i++) {
    const t = i * (beat / 2);
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(0.25, t + 0.03);
    gate.gain.linearRampToValueAtTime(0.05, t + beat / 2 - 0.02);
  }
  chain(strings, filter(ctx, 'lowpass', 650), gate, out);
  strings.start(0);
  strings.stop(seconds);
};

export const SOUND_BUILDERS = {
  roar: [3.4, roar],
  cubCall: [0.6, cubCall],
  growl: [1.7, growl],
  hyenaWhoop: [1.5, hyenaWhoop],
  hyenaGiggle: [1.3, hyenaGiggle],
  bite: [0.3, bite],
  lap: [0.55, lap],
  chew: [0.65, chew],
  pounce: [0.45, pounce],
  milestone: [1.3, milestone],
} as const satisfies Record<string, readonly [number, Build]>;

export const LOOP_BUILDERS = {
  wind: [8, wind],
  birds: [10, birds],
  insects: [6, insects],
  musicCalm: [24, musicCalm],
  musicDanger: [4, musicDanger],
} as const satisfies Record<string, readonly [number, Build]>;

export type LoopName = keyof typeof LOOP_BUILDERS;

/** Renderiza un sonido y devuelve una URL de objeto con el WAV. */
export async function synthesize(seconds: number, build: Build): Promise<string> {
  const buffer = await render(seconds, build);
  return URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
}

/** Codifica un AudioBuffer mono a WAV PCM de 16 bits. */
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const data = buffer.getChannelData(0);
  // Normaliza al 90 % para aprovechar el rango sin saturar.
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const bytes = 44 + data.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] * gain));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return view.buffer;
}
