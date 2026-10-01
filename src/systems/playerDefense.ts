import { events } from '../core/events';
import { addWound, playerBody, randomPart } from './wounds';
import { damagePlayer, player, type DeathCause } from '../entities/player/playerState';
import { derivedStats } from './progression';
import { hasTemperament } from './species';

/**
 * Defensa del jugador en combate: esquiva con invulnerabilidad, bloqueo (con contragolpe
 * perfecto si se bloquea justo antes del golpe) y aguante de combate. Todo golpe que reciba
 * el jugador —leones, hienas, jefes— pasa por `hitPlayer`.
 */
export const defense = {
  /** Reloj interno (s). */
  time: 0,
  /** Segundos que quedan de esquiva (movimiento) e invulnerabilidad. */
  dodge: 0,
  iframes: 0,
  dodgeDirX: 0,
  dodgeDirZ: 0,
  guarding: false,
  guardStart: -99,
  /** Aguante de combate [0, maxStamina]. */
  stamina: 1,
  /** Pausa tras gastar aguante antes de recuperarlo. */
  staminaDelay: 0,
  /** El jugador está aturdido (no puede actuar). */
  stagger: 0,
};

export type HitResult = 'dodged' | 'parried' | 'blocked' | 'hit';

export interface HitOptions {
  /** No se puede bloquear (sí esquivar). */
  unblockable?: boolean;
  /** Aguante que gasta bloquear el golpe. */
  guardCost?: number;
  /** Aturde al jugador si le alcanza. */
  stagger?: number;
}

export function resetDefense(): void {
  defense.dodge = 0;
  defense.iframes = 0;
  defense.guarding = false;
  defense.guardStart = -99;
  defense.stamina = derivedStats().maxStamina;
  defense.staminaDelay = 0;
  defense.stagger = 0;
}

export function updateDefense(dt: number, regenMult = 1): void {
  defense.time += dt;
  defense.dodge = Math.max(0, defense.dodge - dt);
  defense.iframes = Math.max(0, defense.iframes - dt);
  defense.stagger = Math.max(0, defense.stagger - dt);
  defense.staminaDelay = Math.max(0, defense.staminaDelay - dt);
  const s = derivedStats();
  if (defense.staminaDelay <= 0) {
    const rate = (defense.guarding ? 0.12 : 0.34) * s.staminaRegen * regenMult;
    defense.stamina = Math.min(s.maxStamina, defense.stamina + rate * dt);
  }
}

/** Gasta aguante; devuelve false si no hay suficiente. */
export function spendStamina(cost: number): boolean {
  if (defense.stamina < cost * 0.5) {
    events.emit('subtitle', { text: 'Sin aliento', seconds: 1 });
    return false;
  }
  defense.stamina = Math.max(0, defense.stamina - cost);
  defense.staminaDelay = 0.6;
  return true;
}

/** Inicia una esquiva en la dirección indicada (normalizada en XZ). */
export function startDodge(dirX: number, dirZ: number): boolean {
  if (defense.dodge > 0 || defense.stagger > 0 || !spendStamina(0.2)) return false;
  defense.dodge = 0.42;
  defense.iframes = derivedStats().dodgeIFrames;
  defense.dodgeDirX = dirX;
  defense.dodgeDirZ = dirZ;
  return true;
}

export function setGuard(on: boolean): void {
  if (on && !defense.guarding) defense.guardStart = defense.time;
  defense.guarding = on && defense.stagger <= 0;
}

/**
 * Aplica un golpe al jugador. Devuelve cómo terminó: esquivado (invulnerable), parado
 * (bloqueo perfecto: el atacante queda expuesto), bloqueado (daño reducido) o recibido.
 */
export function hitPlayer(amount: number, cause: DeathCause, opts: HitOptions = {}): HitResult {
  if (!player.alive) return 'hit';
  if (defense.iframes > 0) {
    events.emit('combat:feat', { text: 'Esquivado', kind: 'dodge' });
    return 'dodged';
  }
  const s = derivedStats();
  if (defense.guarding && !opts.unblockable) {
    const perfect = defense.time - defense.guardStart <= s.parryWindow;
    if (perfect) {
      events.emit('combat:feat', { text: '¡Contragolpe perfecto!', kind: 'parry' });
      events.emit('sfx', { sound: 'growl', x: player.position.x, y: player.position.y + 0.8, z: player.position.z, volume: 0.9 });
      return 'parried';
    }
    const cost = (opts.guardCost ?? 0.18 + amount * 2) * (hasTemperament('brave') ? 0.85 : 1);
    defense.stamina -= cost;
    defense.staminaDelay = 0.8;
    if (defense.stamina > 0) {
      damagePlayer(amount * 0.2 * s.damageTaken, cause);
      return 'blocked';
    }
    // Guardia rota: se recibe el golpe entero y se queda aturdido.
    defense.stamina = 0;
    defense.guarding = false;
    defense.stagger = 1.1;
    events.emit('subtitle', { text: 'Tu guardia se rompe', seconds: 1.4 });
  }
  const dmg = amount * s.damageTaken;
  damagePlayer(dmg, cause);
  if (dmg > 0.03) addWound(playerBody, randomPart(Math.random), dmg * 1.8);
  if (opts.stagger) defense.stagger = Math.max(defense.stagger, opts.stagger);
  return 'hit';
}
