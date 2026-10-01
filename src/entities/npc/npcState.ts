import * as THREE from 'three';
import type { LionClipName } from '../lion/lionAnimations';

export type Sex = 'male' | 'female';

export type MotherState =
  | 'rest'
  | 'idle'
  | 'wander'
  | 'follow'
  | 'fetch'
  | 'nurse'
  | 'huntLeave'
  | 'away'
  | 'huntReturn'
  | 'eat'
  | 'relocate'
  | 'defend'
  | 'groupHunt';

export type PrideState = 'rest' | 'idle' | 'follow' | 'patrol' | 'hunt' | 'eat' | 'roar' | 'evict' | 'fight' | 'flee' | 'leave';

/** Resto de la manada: tías (leonas adultas) y el macho residente. */
export interface PrideLion extends Agent<PrideState> {
  role: 'aunt' | 'father';
  /** Puesto preferido en la caza cooperativa. */
  huntRole: 'wing' | 'center';
  /** Lado del ala (−1 izquierda, 1 derecha). */
  side: 1 | -1;
}

export type SiblingState = 'follow' | 'play' | 'rest' | 'hide' | 'flee' | 'nurse' | 'eat' | 'tumble' | 'dead';

export type HyenaState = 'roam' | 'investigate' | 'chase' | 'attack' | 'flee' | 'leave';

/**
 * Agente de simulación. Vive fuera de React: la IA lo actualiza, los componentes de render
 * solo leen `position`, `heading` y `clip`.
 */
export interface Agent<S extends string = string> {
  id: string;
  name: string;
  sex: Sex;
  ageYears: number;
  position: THREE.Vector3;
  heading: number;
  speed: number;
  state: S;
  timer: number;
  target: THREE.Vector3;
  alive: boolean;
  /** Salud [0, 1]. */
  health: number;
  /** Animación pedida por la IA. */
  clip: LionClipName;
  /** Cambia para reiniciar un clip de un solo uso (golpes seguidos). */
  clipNonce?: number;
}

export function createAgent<S extends string>(id: string, name: string, sex: Sex, ageYears: number, state: S): Agent<S> {
  return {
    id,
    name,
    sex,
    ageYears,
    position: new THREE.Vector3(),
    heading: 0,
    speed: 0,
    state,
    timer: 0,
    target: new THREE.Vector3(),
    alive: true,
    health: 1,
    clip: 'idle',
  };
}

export interface MotherAgent extends Agent<MotherState> {
  /** Madriguera actual: centro de su zona de campeo mientras cría. */
  home: THREE.Vector3;
  /** Próxima madriguera durante un traslado. */
  nextHome: THREE.Vector3;
  active: boolean;
  /** Lleva una presa en la boca (vuelta de caza). */
  carrying: boolean;
}

export interface HyenaAgent extends Agent<HyenaState> {
  /** Id del objetivo perseguido ('player' o id de hermano). */
  targetId: string | null;
  /** Segundos que el objetivo lleva fuera de su vista. */
  lostTime: number;
  biteCooldown: number;
  seed: number;
}

const motherBase = createAgent<MotherState>('mother', 'Amara', 'female', 7, 'rest');

/** Madre del jugador. */
export const mother: MotherAgent = {
  ...motherBase,
  home: new THREE.Vector3(),
  nextHome: new THREE.Vector3(),
  active: true,
  carrying: false,
};

/** Hermanos de camada del jugador. */
export const siblings: Agent<SiblingState>[] = [];

/** Clan de hienas activo (vacío si no hay ninguno cerca). */
export const hyenas: HyenaAgent[] = [];

/** Tías y padre. */
export const pride: PrideLion[] = [];

const AUNT_NAMES = ['Imara', 'Zuri', 'Asha', 'Wanjiru', 'Nyota', 'Malkia', 'Penda'];
const FATHER_NAMES = ['Bakari', 'Jelani', 'Kibo', 'Ndugu', 'Tumaini'];

function resetPride(rng: () => number, denX: number, denZ: number, heightAt: (x: number, z: number) => number): void {
  pride.length = 0;
  const used = new Set([mother.name]);
  for (let i = 0; i < 2; i++) {
    let name = AUNT_NAMES[Math.floor(rng() * AUNT_NAMES.length)];
    while (used.has(name)) name = AUNT_NAMES[Math.floor(rng() * AUNT_NAMES.length)];
    used.add(name);
    const aunt: PrideLion = {
      ...createAgent<PrideState>(`aunt-${i}`, name, 'female', 6 + rng() * 4, 'rest'),
      role: 'aunt',
      huntRole: 'wing',
      side: i === 0 ? 1 : -1,
    };
    const a = rng() * Math.PI * 2;
    const x = denX + Math.cos(a) * (6 + rng() * 6);
    const z = denZ + Math.sin(a) * (6 + rng() * 6);
    aunt.position.set(x, heightAt(x, z), z);
    aunt.heading = rng() * Math.PI * 2;
    aunt.clip = 'rest';
    aunt.timer = 20 + rng() * 40;
    pride.push(aunt);
  }
  const father: PrideLion = {
    ...createAgent<PrideState>('father', FATHER_NAMES[Math.floor(rng() * FATHER_NAMES.length)], 'male', 8, 'rest'),
    role: 'father',
    huntRole: 'center',
    side: 1,
  };
  const x = denX + 28;
  const z = denZ - 10;
  father.position.set(x, heightAt(x, z), z);
  father.clip = 'rest';
  father.timer = 60;
  pride.push(father);
}

export const prideFather = (): PrideLion | undefined => pride.find((p) => p.role === 'father');
export const prideAunts = (): PrideLion[] => pride.filter((p) => p.role === 'aunt' && p.alive);

export function resetMother(x: number, y: number, z: number, heading: number): void {
  mother.position.set(x, y, z);
  mother.home.set(x, y, z);
  mother.nextHome.set(x, y, z);
  mother.target.set(x, y, z);
  mother.heading = heading;
  mother.speed = 0;
  mother.state = 'rest';
  mother.timer = 25;
  mother.carrying = false;
  mother.clip = 'rest';
  mother.alive = true;
}

const CUB_NAMES: Record<Sex, string[]> = {
  male: ['Kito', 'Jabari', 'Tau', 'Baraka', 'Juma', 'Jengo', 'Zawadi', 'Asante'],
  female: ['Nia', 'Zuri', 'Imani', 'Amani', 'Neema', 'Sanaa', 'Kesi', 'Ayo'],
};
const MOTHER_NAMES = ['Amara', 'Nala', 'Shani', 'Kali', 'Malaika', 'Zahra', 'Tamu'];

/** Crea la camada: 2 hermanos con nombre y sexo aleatorios (camadas de 1–4). */
export function resetFamily(
  rng: () => number,
  denX: number,
  denZ: number,
  heightAt: (x: number, z: number) => number,
  ageYears: number,
): void {
  mother.name = MOTHER_NAMES[Math.floor(rng() * MOTHER_NAMES.length)];
  siblings.length = 0;
  const used = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const sex: Sex = rng() < 0.5 ? 'male' : 'female';
    let name = CUB_NAMES[sex][Math.floor(rng() * CUB_NAMES[sex].length)];
    while (used.has(name)) name = CUB_NAMES[sex][Math.floor(rng() * CUB_NAMES[sex].length)];
    used.add(name);
    const cub = createAgent<SiblingState>(`sibling-${i}`, name, sex, ageYears, 'rest');
    const a = rng() * Math.PI * 2;
    const x = denX + Math.cos(a) * 1.8;
    const z = denZ + Math.sin(a) * 1.8;
    cub.position.set(x, heightAt(x, z), z);
    cub.heading = rng() * Math.PI * 2;
    cub.clip = 'rest';
    cub.timer = 5 + rng() * 10;
    siblings.push(cub);
  }
  hyenas.length = 0;
  resetPride(rng, denX, denZ, heightAt);
}

export const aliveSiblings = (): Agent<SiblingState>[] => siblings.filter((s) => s.alive);
