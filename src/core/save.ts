import { del, get, set } from 'idb-keyval';
import { mother, pride, siblings, type Sex as NpcSex } from '../entities/npc/npcState';
import { exploration } from '../systems/exploration';
import { player, type Needs } from '../entities/player/playerState';
import { serializeWildLions, type WildLionSave } from '../entities/npc/wildLions';
import { playerTraits, type Traits } from '../systems/genetics';
import { lifeRoleState } from '../systems/lifeRole';
import { playerRepro } from '../systems/reproduction';
import { playerBody, type Body } from '../systems/wounds';
import { territories, type TerritoryOwner } from '../world/territories';
import { denState, dens, type Den } from '../systems/dens';
import { snapshotProgression, type ProgressionSave } from '../systems/progression';
import { journal, type JournalEntry, type LifeStats } from '../systems/journal';
import { clock, type ClockSnapshot } from './clock';
import { useGame, type LifeRole, type Settings, type Sex } from './store';

const SETTINGS_KEY = 'panthera:settings:v1';
const SAVE_KEY = 'panthera:save:v3';

export interface SaveGame {
  version: 3;
  seed: number;
  sex: Sex;
  savedAt: number;
  player: { x: number; y: number; z: number; heading: number; stamina: number; ageYears: number; needs: Needs };
  clock: ClockSnapshot;
  family: {
    motherName: string;
    home: [number, number];
    siblings: { name: string; sex: NpcSex; alive: boolean }[];
    pride?: { name: string; alive: boolean }[];
  };
  journal: { entries: JournalEntry[]; stats: LifeStats };
  explored?: Uint8Array;
  /** Fase 4: genética, heridas, territorios, leones ajenos y reproducción. */
  lions?: {
    traits: Traits;
    body: Body;
    lifeRole: LifeRole;
    lifeRoleState: typeof lifeRoleState;
    repro: typeof playerRepro;
    territoryOwners: Record<number, TerritoryOwner>;
    wild: WildLionSave[];
  };
  /** Progresión souls: nivel, habilidades, reliquias, jefes y guaridas. */
  souls?: { progression: ProgressionSave; dens: Den[]; lastDenId: string };
}

// IndexedDB puede no estar disponible (modo privado, políticas del navegador):
// el juego sigue funcionando, solo que sin persistencia.

export async function loadSettings(): Promise<Partial<Settings> | null> {
  try {
    return (await get<Partial<Settings>>(SETTINGS_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await set(SETTINGS_KEY, settings);
  } catch {
    /* sin persistencia */
  }
}

export async function loadGame(seed: number): Promise<SaveGame | null> {
  try {
    const save = await get<SaveGame>(SAVE_KEY);
    return save && save.version === 3 && save.seed === seed ? save : null;
  } catch {
    return null;
  }
}

export function captureSave(sex: Sex, seed: number): SaveGame {
  return {
    version: 3,
    seed,
    sex,
    savedAt: Date.now(),
    player: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      heading: player.heading,
      stamina: player.stamina,
      ageYears: player.ageYears,
      needs: { ...player.needs },
    },
    clock: clock.snapshot(),
    family: {
      motherName: mother.name,
      home: [mother.home.x, mother.home.z],
      siblings: siblings.map((s) => ({ name: s.name, sex: s.sex, alive: s.alive })),
      pride: pride.map((p) => ({ name: p.name, alive: p.alive })),
    },
    journal: { entries: [...journal.entries], stats: { ...journal.stats } },
    explored: new Uint8Array(exploration.revealed),
    lions: {
      traits: { ...playerTraits },
      body: { wounds: playerBody.wounds.map((w) => ({ ...w })), scars: [...playerBody.scars] },
      lifeRole: useGame.getState().lifeRole,
      lifeRoleState: { ...lifeRoleState },
      repro: { ...playerRepro, mateTraits: playerRepro.mateTraits ? { ...playerRepro.mateTraits } : null },
      territoryOwners: Object.fromEntries(territories.map((t) => [t.id, t.owner])),
      wild: serializeWildLions(),
    },
    souls: { progression: snapshotProgression(), dens: dens.map((d) => ({ ...d })), lastDenId: denState.lastDenId },
  };
}

export async function writeSave(save: SaveGame): Promise<void> {
  try {
    await set(SAVE_KEY, save);
  } catch {
    /* sin persistencia */
  }
}

export async function clearSave(): Promise<void> {
  try {
    await del(SAVE_KEY);
  } catch {
    /* sin persistencia */
  }
}
