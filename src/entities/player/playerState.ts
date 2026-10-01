import * as THREE from 'three';
import { Biome, type BiomeId } from '../../world/biomes';

export type PlayerGait =
  | 'idle'
  | 'walk'
  | 'trot'
  | 'run'
  | 'stalk'
  | 'rest'
  | 'swim'
  | 'jump'
  | 'roar'
  | 'nurse'
  | 'drink'
  | 'eat'
  | 'dead'
  | 'fight'
  | 'mark';

/** Acción sostenida que el jugador realiza con la tecla de interacción (E). */
export type PlayerAction = 'nurse' | 'drink' | 'eat';

export type DeathCause = 'hyenas' | 'starvation' | 'thirst' | 'prey' | 'lions' | 'wounds';

/** Necesidades vitales [0, 1] (1 = plenamente satisfecha). */
export interface Needs {
  satiety: number;
  hydration: number;
  energy: number;
  health: number;
  /** Vínculo social con la madre y la camada. */
  bond: number;
}

export const DEFAULT_NEEDS: Needs = { satiety: 0.7, hydration: 0.8, energy: 0.9, health: 1, bond: 0.9 };

/**
 * Estado mutable del león del jugador. Lo escribe el controlador cada frame y lo leen
 * la cámara, la IA, la hierba (para aplastarla), el minimapa y el HUD sin pasar por React.
 */
export const player = {
  position: new THREE.Vector3(),
  /** Rumbo en radianes: 0 = mirando a +Z (sur en el mapa). */
  heading: 0,
  /** Velocidad horizontal en m/s. */
  speed: 0,
  verticalVelocity: 0,
  grounded: true,
  gait: 'idle' as PlayerGait,
  crouching: false,
  resting: false,
  walkMode: false,
  swimming: false,
  /** Energía de sprint [0, 1]. */
  stamina: 1,
  exhausted: false,
  /** Cobertura de la hierba respecto a la altura del cuerpo [0, 1]. */
  cover: 0,
  /** Lo fácil que es verte [0, 1] (postura, cobertura, movimiento). */
  visibility: 1,
  biome: Biome.Grassland as BiomeId,
  /** Escala del modelo (sexo/edad) para la cámara. */
  scale: 1,
  /** Guiñada de la cámara; el control es relativo a ella. */
  cameraYaw: 0,
  /** Edad en años de juego. */
  ageYears: 0.2,
  needs: { ...DEFAULT_NEEDS } as Needs,
  alive: true,
  action: null as PlayerAction | null,
  causeOfDeath: null as DeathCause | null,
  /** Último daño recibido (para la causa de muerte y el HUD). */
  lastDamage: null as DeathCause | null,
  /** Segundos desde el último daño (viñeta roja). */
  hurtTimer: 99,
};

export function resetPlayer(x: number, y: number, z: number, heading = 0): void {
  player.position.set(x, y, z);
  player.heading = heading;
  player.speed = 0;
  player.verticalVelocity = 0;
  player.grounded = true;
  player.gait = 'idle';
  player.crouching = false;
  player.resting = false;
  player.walkMode = false;
  player.swimming = false;
  player.stamina = 1;
  player.exhausted = false;
  player.cameraYaw = heading;
  player.alive = true;
  player.action = null;
  player.causeOfDeath = null;
  player.lastDamage = null;
  player.hurtTimer = 99;
}

export function resetNeeds(needs: Needs = DEFAULT_NEEDS): void {
  Object.assign(player.needs, needs);
}

/** Aplica daño al jugador (0..1 de salud). */
export function damagePlayer(amount: number, cause: DeathCause): void {
  if (!player.alive) return;
  player.needs.health = Math.max(0, player.needs.health - amount);
  player.lastDamage = cause;
  player.hurtTimer = 0;
  player.resting = false;
  player.action = null;
}
