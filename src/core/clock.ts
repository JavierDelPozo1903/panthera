import worldConfig from '../data/world.json';
import { fract } from './math';

export type Season = 'dry' | 'wet';

export interface ClockSnapshot {
  timeOfDay: number;
  day: number;
}

const T = worldConfig.time;

/**
 * Reloj de simulación. Estado mutable fuera de React: se lee cada frame desde el bucle
 * del juego y la interfaz lo consulta a baja frecuencia.
 *
 * Dos escalas conviven: el ciclo día/noche (20 min reales por defecto) y el calendario
 * vital (1 año ≈ 2 h reales → 6 ciclos día/noche por año).
 */
class SimClock {
  /** Hora del día en horas [0, 24). */
  timeOfDay = T.startHour;
  /** Días de juego completos transcurridos. */
  day = 0;
  /** Minutos reales que dura un día de juego. */
  dayLengthMinutes = T.dayLengthMinutes;
  /** Multiplicador temporal (avance rápido). */
  timeScale = 1;

  readonly daysPerYear = (T.yearLengthHours * 60) / T.dayLengthMinutes;
  readonly lunarCycleDays = T.lunarCycleDays;

  advance(dtRealSeconds: number): void {
    const hours = (dtRealSeconds * 24 * this.timeScale) / (this.dayLengthMinutes * 60);
    this.timeOfDay += hours;
    while (this.timeOfDay >= 24) {
      this.timeOfDay -= 24;
      this.day += 1;
    }
  }

  /** Días de juego con parte fraccionaria. */
  get totalDays(): number {
    return this.day + this.timeOfDay / 24;
  }

  get year(): number {
    return Math.floor(this.totalDays / this.daysPerYear);
  }

  get yearFraction(): number {
    return fract(this.totalDays / this.daysPerYear);
  }

  /** La partida empieza al inicio de la estación seca. */
  get season(): Season {
    return this.yearFraction < 0.5 ? 'dry' : 'wet';
  }

  /** Fase lunar: 0 = nueva, 0.5 = llena. */
  get moonPhase(): number {
    return fract(this.totalDays / this.lunarCycleDays + 0.35);
  }

  /** Fracción iluminada del disco lunar [0, 1]. */
  get moonIllumination(): number {
    return (1 - Math.cos(this.moonPhase * Math.PI * 2)) / 2;
  }

  get isNight(): boolean {
    return this.timeOfDay < 5.6 || this.timeOfDay > 18.4;
  }

  formatTime(): string {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  snapshot(): ClockSnapshot {
    return { timeOfDay: this.timeOfDay, day: this.day };
  }

  restore(s: ClockSnapshot): void {
    this.timeOfDay = s.timeOfDay;
    this.day = s.day;
  }

  reset(): void {
    this.timeOfDay = T.startHour;
    this.day = 0;
    this.timeScale = 1;
  }
}

export const clock = new SimClock();

export const FAST_FORWARD_MULTIPLIER = T.fastForwardMultiplier;

const MOON_NAMES = [
  'Luna nueva',
  'Creciente',
  'Cuarto creciente',
  'Gibosa creciente',
  'Luna llena',
  'Gibosa menguante',
  'Cuarto menguante',
  'Menguante',
];

export function moonPhaseName(phase: number): string {
  return MOON_NAMES[Math.round(phase * 8) % 8];
}
