import * as THREE from 'three';
import type { Traits } from '../../systems/genetics';
import type { Body } from '../../systems/wounds';
import { createAgent, type Agent, type Sex } from './npcState';

/**
 * Leones ajenos a la familia natal: machos residentes y leonas de las manadas rivales,
 * nómadas, aliados de la coalición del jugador y sus propios cachorros.
 */
export type WildRole = 'resident' | 'female' | 'nomad' | 'ally' | 'cub';

export type WildState =
  | 'rest'
  | 'idle'
  | 'wander'
  | 'patrol'
  | 'follow'
  | 'confront'
  | 'fight'
  | 'flee'
  | 'leave'
  | 'eat'
  | 'court'
  | 'dead';

export type ReproState = 'none' | 'estrus' | 'pregnant';

export interface WildLion extends Agent<WildState> {
  role: WildRole;
  /** Territorio al que pertenece (residentes, hembras, cachorros) o null. */
  territoryId: number | null;
  /** Grupo de nómadas o camada. */
  groupId: number;
  traits: Traits;
  body: Body;
  morale: number;
  stamina: number;
  /** Hermano del jugador (se une a la coalición sin dudar). */
  kin: boolean;
  /** Actitud hacia el jugador [-1, 1]. */
  relation: number;
  home: THREE.Vector3;
  reproState: ReproState;
  /** Días de juego restantes del celo o la gestación. */
  reproTimer: number;
  /** Días de juego hasta el próximo celo. */
  nextEstrus: number;
  /** Id de la madre ('player' si es hija del jugador). */
  motherId: string | null;
  /** Hijo del jugador (candidato al modo legado). */
  playerChild: boolean;
}

export const wildLions: WildLion[] = [];
let nextId = 1;

export function createWildLion(
  role: WildRole,
  name: string,
  sex: Sex,
  ageYears: number,
  traits: Traits,
  x: number,
  y: number,
  z: number,
): WildLion {
  const lion: WildLion = {
    ...createAgent<WildState>(`wild-${nextId++}`, name, sex, ageYears, role === 'cub' ? 'follow' : 'rest'),
    role,
    territoryId: null,
    groupId: 0,
    traits: { ...traits },
    body: { wounds: [], scars: [] },
    morale: 1,
    stamina: 1,
    kin: false,
    relation: 0,
    home: new THREE.Vector3(x, y, z),
    reproState: 'none',
    reproTimer: 0,
    nextEstrus: 5 + Math.random() * 40,
    motherId: null,
    playerChild: false,
  };
  lion.position.set(x, y, z);
  lion.clip = role === 'cub' ? 'idle' : 'rest';
  return lion;
}

export function clearWildLions(): void {
  wildLions.length = 0;
}

export const allies = (): WildLion[] => wildLions.filter((l) => l.role === 'ally' && l.alive);
export const playerCubs = (): WildLion[] => wildLions.filter((l) => l.playerChild && l.alive);

export const MALE_NAMES = ['Mbogo', 'Jengo', 'Mosi', 'Duma', 'Zawadi', 'Bahati', 'Faraji', 'Hodari', 'Jasiri', 'Shujaa', 'Tatu', 'Kamau', 'Lekan', 'Ojore'];
export const FEMALE_NAMES = ['Ama', 'Dalia', 'Eshe', 'Furaha', 'Hasina', 'Jamila', 'Kamaria', 'Lulu', 'Makena', 'Nafula', 'Pendo', 'Rehema', 'Subira', 'Wema'];
