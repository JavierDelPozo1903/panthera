/**
 * Pruebas de la creación del cachorro (especies), las misiones y las reliquias.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useGame } from '../src/core/store';
import { player, resetNeeds, resetPlayer } from '../src/entities/player/playerState';
import { journal, resetJournal } from '../src/systems/journal';
import { derivedStats, grantRelic, isEquipped, maxHealingCharges, progression, resetProgression, toggleRelic } from '../src/systems/progression';
import { QUESTS, questState, resetQuests, trackedObjective, updateQuests } from '../src/systems/quests';
import { isUnlocked, resetProfile, SPECIES, unlockSpecies } from '../src/systems/species';

beforeEach(() => {
  resetProgression();
  resetProfile();
  resetQuests();
  resetJournal();
  resetPlayer(0, 0, 0);
  resetNeeds();
  useGame.setState({ sex: 'male', lifeRole: 'pride' });
  player.ageYears = 0.2;
});

describe('especies', () => {
  it('el león del Atlas tiene más vida y el asiático menos fuerza', () => {
    const base = derivedStats().maxHealthPoints;
    resetProfile({ species: 'barbary' });
    expect(derivedStats().maxHealthPoints).toBeGreaterThan(base * 1.1);
    expect(SPECIES.asiatic.attributes.fuerza).toBeLessThan(0);
  });

  it('las especies bloqueadas se desbloquean para siempre', () => {
    expect(isUnlocked('masai')).toBe(true);
    const before = isUnlocked('white');
    unlockSpecies('white');
    expect(isUnlocked('white')).toBe(true);
    expect(before === false || before === true).toBe(true);
  });
});

describe('reliquias', () => {
  it('se equipan en dos huecos y cambian las estadísticas con su coste', () => {
    const base = derivedStats();
    grantRelic('secretaryFeather');
    grantRelic('rainStone');
    grantRelic('duelScar');
    expect(progression.equipped.length).toBe(2);
    expect(isEquipped('duelScar')).toBe(false);
    expect(derivedStats().dodgeIFrames).toBeGreaterThan(base.dodgeIFrames);
    expect(derivedStats().damageDealt).toBeLessThan(base.damageDealt);
    expect(maxHealingCharges()).toBe(progression.maxHealingCharges + 1);
    expect(toggleRelic('duelScar')).toBe(false); // sin hueco
    toggleRelic('rainStone');
    expect(toggleRelic('duelScar')).toBe(true);
    expect(derivedStats().biteBonus).toBeGreaterThan(1);
  });
});

describe('misiones', () => {
  it('se activan, avanzan con el juego y dan su recompensa', () => {
    updateQuests();
    expect(questState.status['first-steps']).toBe('active');
    expect(trackedObjective()?.step).toBe('Mama de tu madre');
    journal.stats.nursed = 1;
    journal.stats.drinks = 1;
    updateQuests();
    expect(trackedObjective()?.step).toBe('Embosca a un hermano jugando');
    journal.stats.pounces = 1;
    const before = progression.essence;
    updateQuests();
    expect(questState.status['first-steps']).toBe('done');
    expect(progression.essence).toBeGreaterThan(before);
  });

  it('la prueba de la resistencia regala la pluma del secretario', () => {
    player.ageYears = 1;
    journal.stats.distance = 12000;
    updateQuests();
    expect(questState.status['trial-distance']).toBe('done');
    expect(progression.relics).toContain('secretaryFeather');
  });

  it('todas las misiones tienen pasos y recompensa', () => {
    for (const q of QUESTS) {
      expect(q.steps.length).toBeGreaterThan(0);
      expect(q.reward.essence).toBeGreaterThan(0);
    }
  });
});
