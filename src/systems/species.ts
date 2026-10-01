import type { Attribute } from './progression';
import type { Traits } from './genetics';

/**
 * Especies (subespecies y variantes) de león que se pueden elegir al nacer. Cada una cambia
 * los atributos de partida, tiene una ventaja pasiva y un aspecto propio. La taxonomía está
 * simplificada para el juego.
 */
export type SpeciesId = 'masai' | 'kalahari' | 'asiatic' | 'congo' | 'barbary' | 'white';
export type Temperament = 'brave' | 'curious' | 'patient';
export type Coat = 'normal' | 'white';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  origin: string;
  description: string;
  passiveName: string;
  passiveText: string;
  attributes: Partial<Record<Attribute, number>>;
  /** Rasgos de aspecto por defecto (el jugador puede retocar pelaje y melena). */
  traits: Partial<Traits>;
  coat: Coat;
  /** Si existe, la especie está bloqueada hasta cumplir esta condición. */
  unlockText?: string;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  masai: {
    id: 'masai',
    name: 'León masái',
    origin: 'Serengeti y Masái Mara',
    description: 'El león de la sabana del este de África: equilibrado y rápido.',
    passiveName: 'Zancada del Mara',
    passiveText: '+8 % de velocidad máxima en carrera.',
    attributes: { agilidad: 3 },
    traits: { maneDarkness: 0.5, size: 1, furTint: 0.1 },
    coat: 'normal',
  },
  kalahari: {
    id: 'kalahari',
    name: 'León del Kalahari',
    origin: 'Desierto del Kalahari',
    description: 'Grande, de melena negra, hecho para la sed y el calor.',
    passiveName: 'Sed de hierro',
    passiveText: 'La sed avanza un 35 % más despacio.',
    attributes: { fuerza: 3, resistencia: 2, agilidad: -1 },
    traits: { maneDarkness: 0.85, size: 1.06, furTint: 0.35 },
    coat: 'normal',
  },
  asiatic: {
    id: 'asiatic',
    name: 'León asiático',
    origin: 'Bosque de Gir, India',
    description: 'Más pequeño y de melena corta, con un pliegue en el vientre. Un acechador.',
    passiveName: 'Paso de sombra',
    passiveText: 'Un 20 % menos visible para presas y enemigos.',
    attributes: { instinto: 4, fuerza: -2 },
    traits: { maneDarkness: 0.35, size: 0.93, furTint: -0.2 },
    coat: 'normal',
  },
  congo: {
    id: 'congo',
    name: 'León del Congo',
    origin: 'Sabanas del noreste del Congo',
    description: 'Ágil y resistente a las enfermedades de la selva.',
    passiveName: 'Sangre de selva',
    passiveText: 'Las heridas se infectan un 60 % menos.',
    attributes: { agilidad: 2, resistencia: 1 },
    traits: { maneDarkness: 0.55, size: 0.98, furTint: -0.05 },
    coat: 'normal',
  },
  barbary: {
    id: 'barbary',
    name: 'León del Atlas',
    origin: 'Montes del Atlas (extinto en libertad)',
    description: 'El mayor de todos, con una melena oscura que le cubre medio cuerpo.',
    passiveName: 'Mole del Atlas',
    passiveText: '+15 % de vida máxima.',
    attributes: { resistencia: 4, fuerza: 3, agilidad: -3 },
    traits: { maneDarkness: 0.95, size: 1.1, furTint: 0.2 },
    coat: 'normal',
    unlockText: 'Vence a La Matriarca en cualquier vida',
  },
  white: {
    id: 'white',
    name: 'León blanco',
    origin: 'Timbavati (variante rarísima)',
    description: 'Un pelaje claro que nadie olvida. Imponente, pero se ve de lejos.',
    passiveName: 'Presencia blanca',
    passiveText: 'El rugido aturde un 30 % más; un 15 % más visible.',
    attributes: { ferocidad: 4, instinto: -2 },
    traits: { maneDarkness: 0.15, size: 1.02, furTint: -0.6 },
    coat: 'white',
    unlockText: 'Alcanza el nivel 10 en cualquier vida',
  },
};

export const SPECIES_ORDER: SpeciesId[] = ['masai', 'kalahari', 'asiatic', 'congo', 'barbary', 'white'];

export const TEMPERAMENTS: Record<Temperament, { name: string; text: string }> = {
  brave: { name: 'Valiente', text: 'Bloquear gasta un 15 % menos de aguante.' },
  curious: { name: 'Curioso', text: '+15 % de esencia por los hitos del diario.' },
  patient: { name: 'Paciente', text: 'Agachado eres un 10 % menos visible.' },
};

/** Perfil elegido al nacer. */
export const playerProfile = {
  name: 'Mbogo',
  species: 'masai' as SpeciesId,
  temperament: 'curious' as Temperament,
  coat: 'normal' as Coat,
};

export function resetProfile(data?: Partial<typeof playerProfile>): void {
  playerProfile.name = 'Mbogo';
  playerProfile.species = 'masai';
  playerProfile.temperament = 'curious';
  playerProfile.coat = 'normal';
  if (data) Object.assign(playerProfile, data);
}

export const hasSpecies = (id: SpeciesId): boolean => playerProfile.species === id;
export const hasTemperament = (t: Temperament): boolean => playerProfile.temperament === t;

// ---- Desbloqueos permanentes (entre vidas, guardados en el navegador) ----

const UNLOCK_KEY = 'panthera:unlocks:v1';
const unlocked = new Set<SpeciesId>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = globalThis.localStorage?.getItem(UNLOCK_KEY);
    if (raw) for (const id of JSON.parse(raw) as SpeciesId[]) unlocked.add(id);
  } catch {
    /* sin almacenamiento: nada desbloqueado */
  }
}

export function isUnlocked(id: SpeciesId): boolean {
  if (!SPECIES[id].unlockText) return true;
  load();
  return unlocked.has(id);
}

/** Desbloquea una especie para las vidas futuras. Devuelve true si es nueva. */
export function unlockSpecies(id: SpeciesId): boolean {
  load();
  if (unlocked.has(id)) return false;
  unlocked.add(id);
  try {
    globalThis.localStorage?.setItem(UNLOCK_KEY, JSON.stringify([...unlocked]));
  } catch {
    /* sin almacenamiento */
  }
  return true;
}
