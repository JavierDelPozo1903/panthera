/**
 * Pruebas del núcleo souls: progresión, defensa del jugador (esquiva, bloqueo, contragolpe),
 * postura y golpe de gracia, combos, habilidades y el jefe La Matriarca.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initMatriarch, matriarch, updateMatriarch } from '../src/ai/matriarchBrain';
import { mulberry32 } from '../src/core/math';
import { useGame } from '../src/core/store';
import { createWildLion, wildLions } from '../src/entities/npc/wildLions';
import { player, resetNeeds, resetPlayer } from '../src/entities/player/playerState';
import {
  abilities,
  castAbility,
  combat,
  damageFighter,
  playerCombatMove,
  resetCombat,
  startCombat,
  updateCombat,
  type Fighter,
} from '../src/systems/combat';
import { setPlayerTraits } from '../src/systems/genetics';
import { defense, hitPlayer, resetDefense, setGuard, startDodge, updateDefense } from '../src/systems/playerDefense';
import {
  canRankUp,
  dropEssence,
  gainEssence,
  levelCost,
  levelUp,
  progression,
  rankUp,
  resetProgression,
  spendAttribute,
  tryRecoverEssence,
} from '../src/systems/progression';
import { playerBody, resetBody } from '../src/systems/wounds';
import { resetDens } from '../src/systems/dens';
import { generateWorld, type WorldConfig } from '../src/world/worldgen';
import { WorldData } from '../src/world/WorldData';

const CONFIG: WorldConfig = { seed: 20260930, size: 4096, cells: 256, chunkCells: 64, waterLevel: 0, maxGrassHeight: 1.6 };
const DT = 1 / 30;
let world: WorldData;

beforeAll(() => {
  world = new WorldData(CONFIG, generateWorld(CONFIG));
});

beforeEach(() => {
  resetCombat();
  resetProgression();
  resetDefense();
  resetBody(playerBody);
  resetPlayer(0, world.heightAt(0, 0), 0);
  resetNeeds();
  wildLions.length = 0;
  useGame.setState({ sex: 'male', lifeRole: 'nomad' });
  player.ageYears = 5;
  setPlayerTraits({ maneDarkness: 0.7, size: 1.05, aggression: 0.6, furTint: 0 });
});

function spawnRival(x = 2, z = 0, age = 5): Fighter {
  const rival = createWildLion('nomad', 'Rival', 'male', age, { maneDarkness: 0.5, size: 1, aggression: 0.5, furTint: 0 }, x, world.heightAt(x, z), z);
  wildLions.push(rival);
  startCombat([rival], 'nomad', null);
  return combat.fighters.find((f) => f.agent === rival)!;
}

describe('progresión', () => {
  it('la esencia sube de nivel en la guarida y da puntos de atributo y de habilidad', () => {
    expect(levelCost(2)).toBeGreaterThan(levelCost(1));
    gainEssence(levelCost(1) + 10);
    expect(levelUp()).toBe(true);
    expect(progression.level).toBe(2);
    expect(progression.attributePoints).toBe(2);
    expect(progression.skillPoints).toBe(2);
    expect(spendAttribute('fuerza')).toBe(true);
    expect(progression.attributes.fuerza).toBe(11);
  });

  it('las habilidades tienen nivel mínimo', () => {
    progression.skillPoints = 5;
    expect(canRankUp('roar')).toBe(false); // requiere nivel 3
    progression.level = 3;
    expect(rankUp('roar')).toBe(true);
    expect(progression.ranks.roar).toBe(1);
  });

  it('al morir la esencia queda en el suelo y se recupera al volver', () => {
    gainEssence(500);
    const held = progression.essence;
    dropEssence(10, 10);
    expect(progression.essence).toBe(0);
    expect(tryRecoverEssence(50, 50)).toBe(0);
    expect(tryRecoverEssence(10.5, 10)).toBe(held);
    expect(progression.essence).toBe(held);
  });
});

describe('defensa del jugador', () => {
  it('la esquiva hace invulnerable', () => {
    expect(startDodge(1, 0)).toBe(true);
    expect(hitPlayer(0.2, 'lions')).toBe('dodged');
    expect(player.needs.health).toBe(1);
  });

  it('bloquear justo antes del golpe es un contragolpe; tarde, solo reduce el daño', () => {
    setGuard(true);
    expect(hitPlayer(0.2, 'lions')).toBe('parried');
    expect(player.needs.health).toBe(1);
    for (let i = 0; i < 20; i++) updateDefense(DT);
    expect(hitPlayer(0.2, 'lions')).toBe('blocked');
    expect(player.needs.health).toBeGreaterThan(0.94);
    expect(player.needs.health).toBeLessThan(1);
  });

  it('sin aguante la guardia se rompe', () => {
    setGuard(true);
    for (let i = 0; i < 20; i++) updateDefense(DT);
    defense.stamina = 0.05;
    expect(hitPlayer(0.15, 'lions')).toBe('hit');
    expect(defense.stagger).toBeGreaterThan(0);
  });
});

describe('postura, combos y habilidades', () => {
  it('un mordisco a un rival con la postura rota es un golpe de gracia', () => {
    const rng = mulberry32(3);
    const normal = spawnRival();
    const before = normal.agent!.health;
    playerCombatMove('bite');
    for (let i = 0; i < 30 && normal.agent!.health === before; i++) updateCombat(world, DT, rng);
    const plain = before - normal.agent!.health;
    resetCombat();
    resetDefense();
    const broken = spawnRival();
    broken.posture = 1;
    broken.stagger = 2;
    const b2 = broken.agent!.health;
    playerCombatMove('bite');
    for (let i = 0; i < 30 && broken.agent!.health === b2; i++) updateCombat(world, DT, rng);
    expect(b2 - broken.agent!.health).toBeGreaterThan(plain * 2);
  });

  it('zarpazo, zarpazo, mordisco: desgarro del cuello con sangrado', () => {
    const rng = mulberry32(5);
    const rival = spawnRival();
    for (const move of ['swipe', 'swipe', 'bite'] as const) {
      defense.stamina = 1;
      playerCombatMove(move);
      for (let i = 0; i < 40 && combat.fighters.find((f) => f.isPlayer)!.action; i++) updateCombat(world, DT, rng);
      for (let i = 0; i < 4; i++) updateCombat(world, DT, rng);
    }
    expect(rival.bleed).toBeGreaterThan(0);
  });

  it('el rugido aturde a los rivales cercanos y entra en recarga', () => {
    progression.ranks.roar = 1;
    const rival = spawnRival(3, 0);
    expect(castAbility('roar')).toBe(true);
    expect(rival.stagger).toBeGreaterThan(0);
    expect(abilities.cooldowns.roar).toBeGreaterThan(0);
    expect(castAbility('roar')).toBe(false);
  });

  it('la furia del rey solo se lanza con la carga llena', () => {
    progression.ranks.fury = 1;
    spawnRival();
    expect(castAbility('fury')).toBe(false);
    abilities.furyGauge = 1;
    expect(castAbility('fury')).toBe(true);
    expect(abilities.furyTime).toBeGreaterThan(0);
  });
});

describe('jefe: La Matriarca', () => {
  beforeEach(() => {
    resetDens([{ id: 'natal', name: 'Guarida de la Acacia', x: 0, z: 0, claimed: true }]);
    initMatriarch(world, 0, 0);
  });

  it('un cachorro no puede desafiarla; un adulto sí', () => {
    player.ageYears = 0.8;
    resetPlayer(matriarch.arena.x + 5, matriarch.arena.y, matriarch.arena.z);
    updateMatriarch(world, DT);
    expect(combat.active).toBe(false);
    player.ageYears = 3;
    updateMatriarch(world, DT);
    expect(combat.active).toBe(true);
    expect(combat.reason).toBe('boss');
  });

  it('invoca hienas espectrales, cambia de fase y al caer deja reliquia, esencia y guarida', () => {
    const rng = mulberry32(9);
    resetPlayer(matriarch.arena.x + 5, matriarch.arena.y, matriarch.arena.z);
    updateMatriarch(world, DT);
    const boss = combat.fighters.find((f) => f.isBoss)!;
    damageFighter(boss, 0.6, 0, rng, 'Prueba', true);
    updateMatriarch(world, DT);
    expect(matriarch.minions.length).toBe(2);
    damageFighter(boss, 0.5, 0, rng, 'Prueba', true);
    updateMatriarch(world, DT);
    expect(matriarch.phase).toBe(2);
    // Acaba con las invocadas y con ella.
    for (const f of combat.fighters) if (f.side === 'enemy' && f.agent) f.agent.health = 0;
    updateCombat(world, DT, rng);
    expect(matriarch.state).toBe('defeated');
    expect(progression.relics).toContain('Diente de la Matriarca');
    expect(progression.essence).toBeGreaterThanOrEqual(2500);
  });

  it('sus ataques hieren a quien no se defiende y fallan contra la esquiva', () => {
    const rng = mulberry32(2);
    resetPlayer(matriarch.arena.x + 3, matriarch.arena.y, matriarch.arena.z);
    updateMatriarch(world, DT);
    for (let i = 0; i < 30 * 12 && player.needs.health > 0.6; i++) {
      updateCombat(world, DT, rng);
      updateMatriarch(world, DT);
      updateDefense(DT);
    }
    expect(player.needs.health).toBeLessThan(0.95);
    // Ahora con invulnerabilidad permanente: no recibe daño.
    player.needs.health = 1;
    for (let i = 0; i < 30 * 8; i++) {
      defense.iframes = 1;
      updateCombat(world, DT, rng);
      updateMatriarch(world, DT);
    }
    expect(player.needs.health).toBe(1);
  });
});
