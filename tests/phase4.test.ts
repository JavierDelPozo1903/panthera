/**
 * Pruebas de la Fase 4 sin navegador: genética, heridas, reproducción, territorios,
 * combate entre leones y ciclo de vida del macho (expulsión → nómada → rey).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateWildLions, resetWildBrain } from '../src/ai/wildLionBrain';
import { clock } from '../src/core/clock';
import { mulberry32 } from '../src/core/math';
import { useGame } from '../src/core/store';
import { createWildLion, playerCubs, wildLions } from '../src/entities/npc/wildLions';
import { player, resetNeeds, resetPlayer } from '../src/entities/player/playerState';
import { combat, playerCombatMove, resetCombat, startCombat, updateCombat } from '../src/systems/combat';
import { resetDefense, updateDefense } from '../src/systems/playerDefense';
import { inherit, randomTraits, setPlayerTraits } from '../src/systems/genetics';
import { resetLifeRole, updateLifeRole } from '../src/systems/lifeRole';
import { availableMate, bioDays, playerRepro, resetReproduction, updateReproduction } from '../src/systems/reproduction';
import { addWound, playerBody, resetBody, updateWounds, woundSpeedFactor } from '../src/systems/wounds';
import { initTerritories, residentsOf, territories } from '../src/world/territories';
import { generateWorld, type WorldConfig } from '../src/world/worldgen';
import { WorldData } from '../src/world/WorldData';

const CONFIG: WorldConfig = { seed: 20260930, size: 4096, cells: 256, chunkCells: 64, waterLevel: 0, maxGrassHeight: 1.6 };
const DT = 0.05;
let world: WorldData;

beforeAll(() => {
  world = new WorldData(CONFIG, generateWorld(CONFIG));
});

beforeEach(() => {
  initTerritories(world, 0, 0, 7);
  resetWildBrain();
  resetCombat();
  resetDefense();
  resetBody(playerBody);
  resetReproduction();
  resetPlayer(0, world.heightAt(0, 0), 0);
  resetNeeds();
  setPlayerTraits(randomTraits(mulberry32(3)));
});

describe('genética', () => {
  it('los cachorros heredan rasgos entre los de sus padres (con poca mutación)', () => {
    const rng = mulberry32(11);
    const dark = { maneDarkness: 0.95, size: 1.1, aggression: 0.9, furTint: 0.8 };
    const light = { maneDarkness: 0.15, size: 0.9, aggression: 0.1, furTint: -0.8 };
    for (let i = 0; i < 200; i++) {
      const t = inherit(dark, light, rng);
      expect(t.maneDarkness).toBeGreaterThanOrEqual(0.05);
      expect(t.maneDarkness).toBeLessThanOrEqual(1);
      expect(t.size).toBeGreaterThanOrEqual(0.88);
      expect(t.size).toBeLessThanOrEqual(1.12);
    }
  });
});

describe('heridas', () => {
  it('sangran, se curan con el descanso y las graves dejan cicatriz', () => {
    const rng = mulberry32(5);
    addWound(playerBody, 'face', 0.5);
    const first = updateWounds(playerBody, 1, true, rng);
    expect(first.healthDelta).toBeLessThan(0);
    let scarred = false;
    for (let h = 0; h < 200 && playerBody.wounds.length > 0; h++) {
      const tick = updateWounds(playerBody, 1, true, rng);
      if (tick.newScars.includes('face')) scarred = true;
    }
    expect(playerBody.wounds).toHaveLength(0);
    expect(scarred).toBe(true);
    expect(playerBody.scars).toContain('face');
  });

  it('una pata herida ralentiza', () => {
    addWound(playerBody, 'hindleg', 0.8);
    expect(woundSpeedFactor(playerBody)).toBeLessThan(0.8);
  });
});

describe('territorios', () => {
  it('hay manadas rivales con machos residentes y nómadas', () => {
    expect(territories.filter((t) => t.owner === 'rival').length).toBeGreaterThanOrEqual(1);
    for (const t of territories.filter((x) => x.owner === 'rival')) expect(residentsOf(t.id).length).toBeGreaterThan(0);
    expect(wildLions.some((l) => l.role === 'nomad')).toBe(true);
  });

  it('un macho adulto que entra en un territorio rival acaba peleando con el residente', () => {
    useGame.setState({ sex: 'male', lifeRole: 'nomad' });
    player.ageYears = 4;
    const t = territories.find((x) => x.owner === 'rival')!;
    resetPlayer(t.center.x, world.heightAt(t.center.x, t.center.z), t.center.z);
    const rng = mulberry32(9);
    for (let i = 0; i < 20 * 60 && !combat.active; i++) updateWildLions(world, DT, rng);
    expect(combat.active).toBe(true);
    expect(combat.reason).toBe('territory');
  });
});

describe('combate', () => {
  it('un macho adulto fuerte gana a un nómada joven y el rival huye', () => {
    useGame.setState({ sex: 'male', lifeRole: 'nomad' });
    player.ageYears = 6;
    setPlayerTraits({ maneDarkness: 0.9, size: 1.1, aggression: 0.7, furTint: 0 });
    const rival = createWildLion('nomad', 'Rival', 'male', 2.6, { maneDarkness: 0.2, size: 0.92, aggression: 0.5, furTint: 0 }, 2, 0, 0);
    rival.position.y = world.heightAt(2, 0);
    wildLions.push(rival);
    startCombat([rival], 'nomad', null);
    const rng = mulberry32(21);
    let result: string | null = null;
    for (let i = 0; i < 60 * 60 && combat.active; i++) {
      // El jugador alterna zarpazos y mordiscos de cara al rival.
      playerCombatMove(i % 3 === 0 ? 'bite' : 'swipe');
      updateCombat(world, DT, rng);
      updateDefense(DT);
      result = combat.result;
    }
    expect(result).toBe('win');
    expect(rival.state === 'flee' || !rival.alive).toBe(true);
    expect(rival.body.wounds.length + rival.body.scars.length).toBeGreaterThan(0);
  });
});

describe('ciclo de vida del macho', () => {
  it('a la edad de dispersión es expulsado y pasa a ser nómada al salir del territorio natal', () => {
    useGame.setState({ sex: 'male', lifeRole: 'pride' });
    resetLifeRole(mulberry32(1));
    player.ageYears = 4.5;
    const rng = mulberry32(2);
    updateLifeRole(world, DT, rng);
    const home = territories[0];
    resetPlayer(home.center.x + home.radius + 20, 0, home.center.z);
    updateLifeRole(world, DT, rng);
    expect(useGame.getState().lifeRole).toBe('nomad');
  });

  it('un nómada adulto reclama una manada sin machos y se convierte en rey', () => {
    useGame.setState({ sex: 'male', lifeRole: 'nomad' });
    player.ageYears = 5;
    const t = territories.find((x) => x.owner === 'rival')!;
    for (const r of residentsOf(t.id)) r.alive = false;
    resetPlayer(t.center.x, 0, t.center.z);
    updateLifeRole(world, DT, mulberry32(4));
    expect(useGame.getState().lifeRole).toBe('king');
    expect(t.owner).toBe('player');
  });
});

describe('reproducción', () => {
  it('la gestación dura ~110 días biológicos en el calendario comprimido', () => {
    expect(bioDays(365)).toBeCloseTo(clock.daysPerYear);
    expect(bioDays(110)).toBeCloseTo((110 / 365) * clock.daysPerYear);
  });

  it('una leona en celo se aparea con el residente y pare una camada de 1–4 que hereda rasgos', () => {
    useGame.setState({ sex: 'female', lifeRole: 'pride' });
    player.ageYears = 5;
    // Nuevos machos en la manada natal.
    const male = createWildLion('resident', 'Mbogo', 'male', 6, { maneDarkness: 0.9, size: 1.05, aggression: 0.5, furTint: 0 }, 1, 0, 1);
    male.territoryId = 0;
    wildLions.push(male);
    const rng = mulberry32(8);
    playerRepro.nextEstrus = 0.01;
    updateReproduction(world, 0.02, DT, rng);
    expect(playerRepro.state).toBe('estrus');
    const mate = availableMate();
    expect(mate).not.toBeNull();
    mate!.run();
    expect(playerRepro.state).toBe('pregnant');
    const before = playerCubs().length;
    updateReproduction(world, bioDays(111), DT, rng);
    const cubs = playerCubs();
    expect(cubs.length - before).toBeGreaterThanOrEqual(1);
    expect(cubs.length - before).toBeLessThanOrEqual(4);
    for (const c of cubs) {
      expect(c.motherId).toBe('player');
      expect(c.traits.maneDarkness).toBeGreaterThanOrEqual(0);
    }
  });

  it('las leonas del rey entran en celo y paren hijos suyos', () => {
    useGame.setState({ sex: 'male', lifeRole: 'king' });
    player.ageYears = 6;
    const t = territories.find((x) => x.owner === 'rival')!;
    t.owner = 'player';
    const females = wildLions.filter((l) => l.role === 'female' && l.territoryId === t.id);
    for (const f of females) {
      f.ageYears = 5;
      f.nextEstrus = 0.1;
    }
    const rng = mulberry32(12);
    updateReproduction(world, 0.05, DT, rng);
    const inHeat = females.filter((f) => f.reproState === 'estrus');
    expect(inHeat.length).toBeGreaterThan(0);
    const f = inHeat[0];
    resetPlayer(f.position.x + 1, 0, f.position.z);
    const mate = availableMate();
    expect(mate?.label).toContain(f.name);
    mate!.run();
    expect(f.reproState).toBe('pregnant');
    updateReproduction(world, bioDays(111), DT, rng);
    expect(playerCubs().some((c) => c.motherId === f.id)).toBe(true);
  });
});
