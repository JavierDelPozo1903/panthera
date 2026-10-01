import lionData from '../data/lion.json';
import { clamp } from '../core/math';
import type { Sex } from '../core/store';

const L = lionData.locomotion;

/** Velocidad punta en m/s según sexo (las leonas son algo más rápidas y ligeras). */
export function topSpeedMs(sex: Sex): number {
  return L.topSpeedKmh[sex] / 3.6;
}

interface StaminaState {
  stamina: number;
  exhausted: boolean;
}

/**
 * Energía de sprint: el león alcanza 50–60 km/h pero solo durante 8–12 s.
 * Al agotarse queda "exhausto" hasta recuperar un umbral mínimo.
 */
export function updateStamina(
  state: StaminaState,
  sprinting: boolean,
  resting: boolean,
  sex: Sex,
  dt: number,
  /** Resistencia relativa (los cachorros se agotan antes). */
  endurance = 1,
): void {
  if (sprinting) {
    state.stamina -= dt / (L.sprintDurationSec[sex] * endurance);
  } else {
    state.stamina += dt / (resting ? L.sprintRecoveryRestingSec : L.sprintRecoverySec);
  }
  state.stamina = clamp(state.stamina, 0, 1);
  if (state.stamina <= 0) state.exhausted = true;
  if (state.exhausted && state.stamina >= L.sprintExhaustedThreshold) state.exhausted = false;
}
