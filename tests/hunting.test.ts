/**
 * Pruebas de simulación sin navegador: comportamiento de las presas y caza cooperativa.
 * Usan el mismo generador de mundo que el juego (a menor resolución) y avanzan la IA a
 * pasos fijos, como haría el bucle del juego.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { groupHunt, resetGroupHunt, startGroupHunt, updateGroupHunt } from '../src/ai/huntBrain';
import { initHerds, updatePrey } from '../src/ai/preyBrain';
import { mulberry32 } from '../src/core/math';
import { carcasses, clearCarcasses } from '../src/entities/carcass/carcassState';
import { mother, prideAunts, resetFamily, resetMother } from '../src/entities/npc/npcState';
import { herds, type Herd } from '../src/entities/prey/preyState';
import { player, resetPlayer } from '../src/entities/player/playerState';
import { wind } from '../src/systems/wind';
import { atmosphere } from '../src/world/atmosphereState';
import { generateWorld, type WorldConfig } from '../src/world/worldgen';
import { WorldData } from '../src/world/WorldData';

const CONFIG: WorldConfig = { seed: 20260930, size: 4096, cells: 256, chunkCells: 64, waterLevel: 0, maxGrassHeight: 1.6 };
const DT = 0.05;
let world: WorldData;

beforeAll(() => {
  world = new WorldData(CONFIG, generateWorld(CONFIG));
});

/** Coloca al jugador a `distance` m de la manada, con el viento soplando de la manada hacia él. */
function placeNear(herd: Herd, distance: number, angle: number): void {
  const x = herd.center.x + Math.cos(angle) * distance;
  const z = herd.center.z + Math.sin(angle) * distance;
  resetPlayer(x, world.heightAt(x, z), z, Math.atan2(herd.center.x - x, herd.center.z - z));
  // Viento de cara: el olor del jugador se aleja de las presas.
  wind.dir.set(Math.cos(angle), Math.sin(angle));
}

/**
 * Aproxima al jugador en línea recta a la manada. Devuelve la distancia a la que huyen
 * (y anota en `alertAt` la distancia a la que se pusieron alerta por primera vez).
 */
let alertAt = -1;
function approach(herd: Herd, speed: number, visibility: number, rng: () => number): number {
  let t = 0;
  alertAt = -1;
  for (let i = 0; i < 4000; i++) {
    t += DT;
    const dx = herd.center.x - player.position.x;
    const dz = herd.center.z - player.position.z;
    const d = Math.hypot(dx, dz);
    if (alertAt < 0 && herd.mode !== 'graze') alertAt = d;
    if (herd.mode === 'flee') return d;
    if (d < 3) return d;
    player.position.x += (dx / d) * speed * DT;
    player.position.z += (dz / d) * speed * DT;
    player.speed = speed;
    player.visibility = visibility;
    updatePrey(world, DT, rng, t);
  }
  return 0;
}

describe('presas', () => {
  it('a un león al descubierto lo ven de lejos y nunca llega a distancia de carga', () => {
    const rng = mulberry32(1);
    initHerds(world, 7);
    const results: { flee: number; alert: number }[] = [];
    for (const herd of herds.filter((h) => h.species === 'zebra' || h.species === 'wildebeest').slice(0, 4)) {
      placeNear(herd, 220, rng() * Math.PI * 2);
      updatePrey(world, DT, rng, 0);
      const flee = approach(herd, 3.6, 1, rng);
      results.push({ flee, alert: alertAt });
    }
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.alert).toBeGreaterThan(50);
      expect(r.flee).toBeGreaterThan(25);
    }
  });

  it('un león agachado y oculto, con el viento de cara, llega a distancia de carga', () => {
    const rng = mulberry32(2);
    initHerds(world, 11);
    const results: number[] = [];
    for (const herd of herds.slice(0, 8)) {
      if (herd.size === 0) continue;
      placeNear(herd, 150, rng() * Math.PI * 2);
      updatePrey(world, DT, rng, 0);
      results.push(approach(herd, 0.9, 0.12, rng));
    }
    const close = results.filter((d) => d < 25).length;
    // La mayoría de los acechos bien hechos deben llegar a 20–25 m.
    expect(close / results.length).toBeGreaterThanOrEqual(0.5);
  });
});

describe('caza cooperativa', () => {
  it('de día, las leonas cazan con un éxito realista (15–60 %)', () => {
    const rate = runHunts(30, false);
    expect(rate).toBeGreaterThanOrEqual(0.15);
    expect(rate).toBeLessThanOrEqual(0.6);
    expect(mother.state).not.toBe('groupHunt');
  });

  it('de noche y sin luna, cazan mejor que de día', () => {
    const day = runHunts(30, false);
    const night = runHunts(30, true);
    expect(night).toBeGreaterThanOrEqual(day);
  });
});

function runHunts(count: number, night: boolean): number {
  atmosphere.night = night ? 1 : 0;
  atmosphere.moonIllumination = 0;
  atmosphere.moonUp = 0;
  {
    let successes = 0;
    const outcomes: string[] = [];
    let trials = 0;
    for (let seed = 0; seed < count; seed++) {
      const rng = mulberry32(100 + seed);
      initHerds(world, 200 + seed);
      clearCarcasses();
      resetGroupHunt();
      const herd = herds.filter((h) => h.size > 0 && h.species !== 'warthog')[seed % 6];
      if (!herd) continue;
      // Leonas a 260 m; el jugador mira desde atrás, escondido e inmóvil.
      const a = rng() * Math.PI * 2;
      const lx = herd.center.x + Math.cos(a) * 260;
      const lz = herd.center.z + Math.sin(a) * 260;
      resetMother(lx, world.heightAt(lx, lz), lz, 0);
      resetFamily(rng, lx, lz, (x, z) => world.heightAt(x, z), 1);
      placeNear(herd, 330, a);
      player.visibility = 0.1;
      player.speed = 0;
      updatePrey(world, DT, rng, 0);

      startGroupHunt(herd);
      expect(prideAunts().length).toBe(2);
      let t = 0;
      let lastPhase: string = groupHunt.phase;
      let chargeDist = -1;
      while (groupHunt.active && t < 300) {
        t += DT;
        updatePrey(world, DT, rng, t);
        updateGroupHunt(world, DT);
        if (groupHunt.phase === 'charge' && lastPhase !== 'charge' && groupHunt.target) {
          chargeDist = Math.hypot(mother.position.x - groupHunt.target.position.x, mother.position.z - groupHunt.target.position.z);
        }
        if (groupHunt.active) lastPhase = groupHunt.phase;
      }
      outcomes.push(`${herd.species}: ${groupHunt.lastResult} en ${lastPhase} (carga a ${chargeDist.toFixed(0)} m)`);
      trials++;
      if (groupHunt.lastResult === 'success') {
        successes++;
        expect(carcasses.length).toBeGreaterThan(0);
      }
    }
    const rate = successes / trials;
    const fails = outcomes.filter((o) => o.includes('fail'));
    const stalls = fails.filter((o) => o.includes('stalk')).length;
    console.log(
      `Caza cooperativa ${night ? 'de noche' : 'de día'}: ${(rate * 100).toFixed(0)} % (${successes}/${trials}); ` +
        `fallos en acecho ${stalls}, en carrera/lucha ${fails.length - stalls}`,
    );
    atmosphere.night = 0;
    return rate;
  }
}
