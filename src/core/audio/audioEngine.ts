import { Howl, Howler } from 'howler';
import { events, type SoundName } from '../events';
import { LOOP_BUILDERS, SOUND_BUILDERS, synthesize, type LoopName } from './synth';

interface SoundSpec {
  volume: number;
  /** Distancia de referencia del atenuador espacial (m): cuanto mayor, más lejos se oye. */
  refDistance: number;
}

/** Volumen base y alcance de cada efecto. El rugido se oye a kilómetros. */
const SPECS: Record<SoundName, SoundSpec> = {
  roar: { volume: 1, refDistance: 45 },
  cubCall: { volume: 0.7, refDistance: 6 },
  growl: { volume: 0.8, refDistance: 12 },
  hyenaWhoop: { volume: 0.8, refDistance: 60 },
  hyenaGiggle: { volume: 0.8, refDistance: 18 },
  bite: { volume: 0.7, refDistance: 4 },
  lap: { volume: 0.35, refDistance: 3 },
  chew: { volume: 0.4, refDistance: 3 },
  pounce: { volume: 0.5, refDistance: 4 },
  milestone: { volume: 0.4, refDistance: 1 },
};

const MUSIC: ReadonlySet<LoopName> = new Set(['musicCalm', 'musicDanger']);

export interface AmbienceMix {
  day: number;
  night: number;
  golden: number;
  danger: number;
  paused: boolean;
  inMenu: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

/**
 * Motor de audio sobre Howler.js: efectos posicionales (HRTF), ambiente que cambia con la
 * hora (aves al amanecer, insectos de noche, viento) y música adaptativa que se tensa con
 * el peligro. Los sonidos se sintetizan al iniciar (tras el primer gesto del usuario).
 */
class AudioEngine {
  private sounds = new Map<SoundName, Howl>();
  private loops = new Map<LoopName, { howl: Howl; id: number; volume: number }>();
  private initPromise: Promise<void> | null = null;
  private sfxVolume = 0.9;
  ready = false;

  /** Debe llamarse desde un gesto del usuario (clic/tecla) por la política de autoplay. */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  private async load(): Promise<void> {
    try {
      Howler.ctx?.resume?.();
      for (const [name, [seconds, build]] of Object.entries(SOUND_BUILDERS) as [SoundName, (typeof SOUND_BUILDERS)[SoundName]][]) {
        const src = await synthesize(seconds, build);
        this.sounds.set(name, new Howl({ src: [src], format: ['wav'], volume: SPECS[name].volume }));
      }
      for (const [name, [seconds, build]] of Object.entries(LOOP_BUILDERS) as [LoopName, (typeof LOOP_BUILDERS)[LoopName]][]) {
        const src = await synthesize(seconds, build);
        const howl = new Howl({ src: [src], format: ['wav'], loop: true, volume: 0 });
        const id = howl.play();
        this.loops.set(name, { howl, id, volume: 0 });
      }
      events.on('sfx', ({ sound, x, y, z, volume }) => this.play(sound, x, y, z, volume));
      events.on('npc:roar', ({ x, z }) => this.play('roar', x, undefined, z, 0.9));
      this.ready = true;
    } catch (error) {
      // Sin audio (navegador sin Web Audio): el juego sigue siendo jugable con subtítulos.
      console.warn('Audio no disponible', error);
    }
  }

  play(name: SoundName, x?: number, y?: number, z?: number, volume = 1): void {
    const howl = this.sounds.get(name);
    if (!howl) return;
    const id = howl.play();
    howl.volume(SPECS[name].volume * volume * this.sfxVolume, id);
    howl.rate(0.94 + Math.random() * 0.12, id);
    if (x !== undefined && z !== undefined) {
      howl.pos(x, y ?? 0, z, id);
      howl.pannerAttr(
        {
          panningModel: 'HRTF',
          distanceModel: 'inverse',
          refDistance: SPECS[name].refDistance,
          rolloffFactor: 1,
          maxDistance: 4000,
        },
        id,
      );
    }
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    if (!this.ready) return;
    Howler.pos(x, y, z);
    Howler.orientation(fx, fy, fz, 0, 1, 0);
  }

  /** Mezcla continua del ambiente y la música. */
  updateMix(mix: AmbienceMix, dt: number): void {
    if (!this.ready) return;
    Howler.volume(mix.masterVolume);
    this.sfxVolume = mix.sfxVolume;
    const duck = mix.paused ? 0.35 : 1;
    const targets: Record<LoopName, number> = {
      wind: (0.22 + 0.1 * mix.night) * mix.sfxVolume,
      birds: (mix.day * 0.12 + mix.golden * 0.35) * mix.sfxVolume,
      insects: mix.night * 0.3 * mix.sfxVolume,
      musicCalm: (mix.inMenu ? 0.55 : 0.32) * (1 - 0.7 * mix.danger) * mix.musicVolume,
      musicDanger: mix.danger * 0.65 * mix.musicVolume,
    };
    const k = 1 - Math.exp(-dt * 1.5);
    for (const [name, loop] of this.loops) {
      const target = targets[name] * (MUSIC.has(name) ? duck : Math.max(duck, 0.6));
      loop.volume += (target - loop.volume) * k;
      loop.howl.volume(loop.volume, loop.id);
    }
  }
}

export const audio = new AudioEngine();
