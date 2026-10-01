import { clock } from '../core/clock';
import { events } from '../core/events';
import { player } from '../entities/player/playerState';
import { formatAge } from './lifeStage';

/**
 * Diario de campo: registro automático de hitos con fecha de juego, al estilo del cuaderno
 * de un investigador, y estadísticas de la vida en curso.
 */
export interface JournalEntry {
  id: string;
  text: string;
  day: number;
  time: string;
  age: string;
}

export interface LifeStats {
  distance: number;
  nursed: number;
  pounces: number;
  hyenaEncounters: number;
  meals: number;
  drinks: number;
  denMoves: number;
  roars: number;
  kills: number;
  huntsWatched: number;
  fightsWon: number;
  territories: number;
  cubsBorn: number;
}

const emptyStats = (): LifeStats => ({
  distance: 0,
  nursed: 0,
  pounces: 0,
  hyenaEncounters: 0,
  meals: 0,
  drinks: 0,
  denMoves: 0,
  roars: 0,
  kills: 0,
  huntsWatched: 0,
  fightsWon: 0,
  territories: 0,
  cubsBorn: 0,
});

export const journal = {
  entries: [] as JournalEntry[],
  stats: emptyStats(),
};

const done = new Set<string>();

/** Registra un hito una sola vez. Devuelve true si es nuevo. */
export function recordMilestone(id: string, text: string, silent = false): boolean {
  if (done.has(id)) return false;
  done.add(id);
  journal.entries.push({
    id,
    text,
    day: clock.day + 1,
    time: clock.formatTime(),
    age: formatAge(player.ageYears),
  });
  if (!silent) {
    events.emit('milestone', { id, text });
    events.emit('sfx', { sound: 'milestone', volume: 0.5 });
  }
  return true;
}

export const hasMilestone = (id: string): boolean => done.has(id);

export function resetJournal(entries: JournalEntry[] = [], stats?: LifeStats): void {
  journal.entries = [...entries];
  journal.stats = stats ? { ...emptyStats(), ...stats } : emptyStats();
  done.clear();
  for (const e of entries) done.add(e.id);
}
