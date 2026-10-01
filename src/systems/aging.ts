import { clock } from '../core/clock';
import { events } from '../core/events';
import { useGame } from '../core/store';
import { player } from '../entities/player/playerState';
import { recordMilestone } from './journal';
import { GROWTH_STEP_YEARS, nextStage, stageAt, stageTitle } from './lifeStage';

/**
 * Envejecimiento del jugador: avanza la edad con el calendario de juego y publica en el
 * estado global los cambios de escalón de crecimiento y de etapa vital.
 */
export function advanceAge(deltaGameDays: number): void {
  if (deltaGameDays <= 0) return;
  player.ageYears += deltaGameDays / clock.daysPerYear;
  syncLifeState(true);
}

export function setAge(ageYears: number, announce = false): void {
  player.ageYears = ageYears;
  syncLifeState(announce);
}

/** Modo "saltar etapa": avanza la edad hasta el comienzo de la siguiente etapa vital. */
export function skipToNextStage(): void {
  const next = nextStage(stageAt(player.ageYears));
  if (next) setAge(next.fromYears + 0.01, true);
}

export function syncLifeState(announce: boolean): void {
  const step = Math.floor(player.ageYears / GROWTH_STEP_YEARS);
  const stage = stageAt(player.ageYears).id;
  const state = useGame.getState();
  if (step === state.growthStep && stage === state.lifeStage) return;
  if (announce && stage !== state.lifeStage) {
    const title = stageTitle(stage, state.sex);
    events.emit('subtitle', { text: `Has crecido: ahora eres ${title.toLowerCase()}`, seconds: 5 });
    recordMilestone(`stage:${stage}`, `Nueva etapa: ${title}`);
  }
  useGame.setState({ growthStep: step, lifeStage: stage });
}
