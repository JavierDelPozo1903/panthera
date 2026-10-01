import { events } from '../core/events';
import { clamp } from '../core/math';

/**
 * Progresión estilo souls: la «esencia del linaje» se gana cazando, peleando, explorando y
 * venciendo jefes. Se gasta en las guaridas para subir de nivel (2 puntos de atributo y 1
 * de habilidad por nivel). Al morir en combate, la esencia sin gastar queda en el lugar de
 * la muerte y se recupera volviendo allí sin morir antes.
 */

export const ATTRIBUTES = ['fuerza', 'agilidad', 'resistencia', 'instinto', 'ferocidad'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_LABEL: Record<Attribute, string> = {
  fuerza: 'Fuerza',
  agilidad: 'Agilidad',
  resistencia: 'Resistencia',
  instinto: 'Instinto',
  ferocidad: 'Ferocidad',
};

export const ATTRIBUTE_HINT: Record<Attribute, string> = {
  fuerza: 'Daño de zarpazos y mordiscos',
  agilidad: 'Esquiva más larga y aguante que se recupera antes',
  resistencia: 'Vida, defensa y aguante máximo',
  instinto: 'Ventana de contragolpe, sigilo y esencia ganada',
  ferocidad: 'Daño a la postura y carga de la furia',
};

export type AbilityId = 'charge' | 'roar' | 'tear' | 'fury';

export interface AbilityDef {
  id: AbilityId;
  key: string;
  name: string;
  description: string;
  /** Segundos de recarga en el rango I (la definitiva se carga golpeando). */
  cooldown: number;
  /** Nivel mínimo para aprenderla. */
  unlockLevel: number;
  ultimate?: boolean;
  /** Rama del árbol. */
  branch: 'Cazador' | 'Guerrero' | 'Rey';
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  charge: {
    id: 'charge',
    key: 'Q',
    name: 'Embestida',
    description: 'Carrera corta que golpea y rompe la postura del objetivo.',
    cooldown: 8,
    unlockLevel: 1,
    branch: 'Cazador',
  },
  roar: {
    id: 'roar',
    key: 'R',
    name: 'Rugido aturdidor',
    description: 'Onda alrededor: interrumpe ataques y aturde a los enemigos cercanos.',
    cooldown: 14,
    unlockLevel: 3,
    branch: 'Rey',
  },
  tear: {
    id: 'tear',
    key: 'F',
    name: 'Desgarro',
    description: 'Tres zarpazos rápidos que causan sangrado.',
    cooldown: 10,
    unlockLevel: 5,
    branch: 'Guerrero',
  },
  fury: {
    id: 'fury',
    key: 'G',
    name: 'Furia del rey',
    description: 'Definitiva. Se carga golpeando: 12 s de daño y aguante aumentados.',
    cooldown: 0,
    unlockLevel: 8,
    ultimate: true,
    branch: 'Rey',
  },
};

export const ABILITY_ORDER: AbilityId[] = ['charge', 'roar', 'tear', 'fury'];
export const MAX_RANK = 3;
export const MAX_LEVEL = 60;

export interface DroppedEssence {
  x: number;
  z: number;
  amount: number;
}

export const progression = {
  level: 1,
  /** Esencia sin gastar. */
  essence: 0,
  /** Esencia ganada en toda la vida (estadística). */
  lifetimeEssence: 0,
  attributes: { fuerza: 10, agilidad: 10, resistencia: 10, instinto: 10, ferocidad: 10 } as Record<Attribute, number>,
  attributePoints: 0,
  skillPoints: 1,
  ranks: { charge: 1, roar: 0, tear: 0, fury: 0 } as Record<AbilityId, number>,
  /** Cargas de hojas medicinales (se rellenan en la guarida). */
  healingCharges: 3,
  maxHealingCharges: 3,
  dropped: null as DroppedEssence | null,
  /** Reliquias obtenidas. */
  relics: [] as string[],
  /** Jefes vencidos. */
  bossesDefeated: [] as string[],
};

export type ProgressionSave = Omit<typeof progression, never>;

export function resetProgression(data?: Partial<ProgressionSave>): void {
  progression.level = 1;
  progression.essence = 0;
  progression.lifetimeEssence = 0;
  progression.attributes = { fuerza: 10, agilidad: 10, resistencia: 10, instinto: 10, ferocidad: 10 };
  progression.attributePoints = 0;
  progression.skillPoints = 1;
  progression.ranks = { charge: 1, roar: 0, tear: 0, fury: 0 };
  progression.healingCharges = 3;
  progression.maxHealingCharges = 3;
  progression.dropped = null;
  progression.relics = [];
  progression.bossesDefeated = [];
  if (data) {
    Object.assign(progression, {
      ...data,
      attributes: { ...progression.attributes, ...data.attributes },
      ranks: { ...progression.ranks, ...data.ranks },
      relics: [...(data.relics ?? [])],
      bossesDefeated: [...(data.bossesDefeated ?? [])],
      dropped: data.dropped ? { ...data.dropped } : null,
    });
  }
}

export function snapshotProgression(): ProgressionSave {
  return {
    ...progression,
    attributes: { ...progression.attributes },
    ranks: { ...progression.ranks },
    relics: [...progression.relics],
    bossesDefeated: [...progression.bossesDefeated],
    dropped: progression.dropped ? { ...progression.dropped } : null,
  };
}

/** Esencia necesaria para pasar del nivel `level` al siguiente. */
export function levelCost(level: number): number {
  return Math.round(320 * Math.pow(level, 1.38) + 180);
}

export const canLevelUp = (): boolean => progression.level < MAX_LEVEL && progression.essence >= levelCost(progression.level);

/** Gasta esencia para subir un nivel (solo en una guarida). */
export function levelUp(): boolean {
  if (!canLevelUp()) return false;
  progression.essence -= levelCost(progression.level);
  progression.level++;
  progression.attributePoints += 2;
  progression.skillPoints += 1;
  events.emit('subtitle', { text: `Nivel ${progression.level}: 2 puntos de atributo y 1 de habilidad`, seconds: 3 });
  return true;
}

export function spendAttribute(attr: Attribute): boolean {
  if (progression.attributePoints <= 0 || progression.attributes[attr] >= 99) return false;
  progression.attributes[attr]++;
  progression.attributePoints--;
  return true;
}

export function canRankUp(id: AbilityId): boolean {
  const def = ABILITIES[id];
  return progression.skillPoints > 0 && progression.ranks[id] < MAX_RANK && progression.level >= def.unlockLevel + progression.ranks[id] * 4;
}

export function rankUp(id: AbilityId): boolean {
  if (!canRankUp(id)) return false;
  progression.ranks[id]++;
  progression.skillPoints--;
  return true;
}

/** Nivel requerido para el siguiente rango de una habilidad. */
export const nextRankLevel = (id: AbilityId): number => ABILITIES[id].unlockLevel + progression.ranks[id] * 4;

/** Suma esencia (el instinto la multiplica un poco). */
export function gainEssence(amount: number, reason?: string): number {
  const gained = Math.round(amount * (1 + (progression.attributes.instinto - 10) * 0.01));
  if (gained <= 0) return 0;
  progression.essence += gained;
  progression.lifetimeEssence += gained;
  events.emit('essence', { amount: gained, reason: reason ?? '' });
  return gained;
}

/** Al morir: la esencia sin gastar queda en el suelo (la anterior se pierde). */
export function dropEssence(x: number, z: number): void {
  progression.dropped = progression.essence > 0 ? { x, z, amount: progression.essence } : null;
  progression.essence = 0;
}

/** Recupera la esencia caída si el jugador pasa por encima. */
export function tryRecoverEssence(x: number, z: number): number {
  const d = progression.dropped;
  if (!d || Math.hypot(d.x - x, d.z - z) > 3) return 0;
  progression.dropped = null;
  progression.essence += d.amount;
  events.emit('subtitle', { text: `Recuperas tu esencia: ${d.amount}`, seconds: 3 });
  return d.amount;
}

const attr = (a: Attribute) => progression.attributes[a] - 10;

/** Estadísticas derivadas de los atributos (1 = valor base). */
export function derivedStats() {
  return {
    /** Vida máxima en puntos (la salud del juego es una fracción de esta). */
    maxHealthPoints: 1000 + 30 * attr('resistencia'),
    /** Multiplicador del daño recibido. */
    damageTaken: 1 / (1 + 0.025 * attr('resistencia')),
    /** Multiplicador del daño causado. */
    damageDealt: 1 + 0.035 * attr('fuerza'),
    /** Daño a la postura del rival. */
    postureDealt: 1 + 0.04 * attr('ferocidad'),
    /** Aguante máximo de combate. */
    maxStamina: 1 + 0.02 * attr('resistencia'),
    staminaRegen: 1 + 0.025 * attr('agilidad'),
    /** Segundos de invulnerabilidad de la esquiva. */
    dodgeIFrames: clamp(0.26 + 0.004 * attr('agilidad'), 0.2, 0.5),
    /** Ventana (s) para un bloqueo perfecto. */
    parryWindow: clamp(0.16 + 0.004 * attr('instinto'), 0.1, 0.32),
    furyGain: 1 + 0.03 * attr('ferocidad'),
  };
}

/** Recarga efectiva de una habilidad según su rango. */
export function abilityCooldown(id: AbilityId): number {
  const rank = Math.max(1, progression.ranks[id]);
  return ABILITIES[id].cooldown * (1 - 0.12 * (rank - 1));
}

/** Potencia de una habilidad según su rango (1, 1,3, 1,6). */
export const abilityPower = (id: AbilityId): number => 1 + 0.3 * (Math.max(1, progression.ranks[id]) - 1);
