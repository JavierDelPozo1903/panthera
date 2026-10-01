import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import lionData from '../../data/lion.json';
import { events } from '../../core/events';
import { input } from '../../core/input';
import { damp, moveTowardsAngle, saturate, wrapAngle } from '../../core/math';
import { useGame, useWorld } from '../../core/store';
import { adultsFeasting } from '../../ai/director';
import { distXZ } from '../../ai/steering';
import { tumbleSibling } from '../../ai/siblingBrain';
import { availableInteraction } from '../../systems/interactions';
import { journal, recordMilestone } from '../../systems/journal';
import { canRoar, GROWTH_STEP_YEARS, physicalMaturity } from '../../systems/lifeStage';
import { needsSpeedFactor } from '../../systems/needs';
import { takedown, tryStartTakedown, updateTakedown } from '../../systems/takedown';
import { topSpeedMs, updateStamina } from '../../systems/stamina';
import { visibility } from '../../systems/stealth';
import { eatFrom, nearestCarcass } from '../carcass/carcassState';
import { mother, siblings } from '../npc/npcState';
import { sharedUniforms } from '../../world/atmosphereState';
import type { LionClipName } from '../lion/lionAnimations';
import { LionActor } from '../lion/LionActor';
import { player, type PlayerGait } from './playerState';

type RapierWorld = ReturnType<typeof useRapier>['world'];
type Collider = ReturnType<RapierWorld['createCollider']>;
type CharacterController = ReturnType<RapierWorld['createCharacterController']>;

/** Colisionador del jugador, expuesto para que la cámara lo excluya de sus raycasts. */
export const playerPhysics: { collider: Collider | null } = { collider: null };

const L = lionData.locomotion;
const GRAVITY = 20;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * L.jumpHeightM);
const ROAR_SECONDS = 3.4;
const WORLD_MARGIN = 12;

const GAIT_OF_CLIP: Record<LionClipName, PlayerGait> = {
  idle: 'idle',
  walk: 'walk',
  trot: 'trot',
  run: 'run',
  stalkIdle: 'stalk',
  stalkWalk: 'stalk',
  rest: 'rest',
  roar: 'roar',
  jump: 'jump',
  swim: 'swim',
  drink: 'drink',
  eat: 'eat',
  nurse: 'nurse',
  die: 'dead',
  swipe: 'fight',
  bite: 'fight',
  snarl: 'fight',
  mark: 'mark',
};

/** Controlador del león del jugador: locomoción, física, orientación al terreno y animación. */
export function Player() {
  const world = useWorld();
  const sex = useGame((s) => s.sex);
  const growthStep = useGame((s) => s.growthStep);
  const { world: physics, rapier } = useRapier();

  // El modelo se reconstruye en cada escalón de crecimiento: tamaño, manchas y melena.
  const actor = useMemo(
    () => new LionActor({ sex, ageYears: Math.max(player.ageYears, growthStep * GROWTH_STEP_YEARS), maneDarkness: 0.55 }),
    [sex, growthStep],
  );
  useEffect(() => {
    player.scale = actor.scale;
    return () => actor.dispose();
  }, [actor]);

  const phys = useMemo<{ collider: Collider | null; controller: CharacterController | null }>(
    () => ({ collider: null, controller: null }),
    [],
  );
  useEffect(() => {
    const s = actor.scale;
    const collider = physics.createCollider(
      rapier.ColliderDesc.capsule(0.2 * s, 0.45 * s).setTranslation(
        player.position.x,
        player.position.y + 0.75 * s,
        player.position.z,
      ),
    );
    const controller = physics.createCharacterController(0.04);
    controller.setSlideEnabled(true);
    phys.collider = collider;
    phys.controller = controller;
    playerPhysics.collider = collider;
    return () => {
      physics.removeCharacterController(controller);
      physics.removeCollider(collider, false);
      phys.collider = null;
      phys.controller = null;
      playerPhysics.collider = null;
    };
  }, [physics, rapier, actor, phys]);

  const st = useMemo(() => ({ roarTimer: 0, pitch: 0, roll: 0, cover: 0, ambush: false, actionSfx: 0 }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = player;
    const s = actor.scale;
    const phase = useGame.getState().phase;

    if (phase !== 'playing' || !p.alive) {
      if (phase === 'menu' || phase === 'intro') {
        actor.play('rest', 0.6);
        actor.update(dt);
      } else if (!p.alive && phase !== 'paused') {
        actor.play('die', 0.3);
        actor.update(dt);
      }
      syncTransform();
      return;
    }

    // --- Derribo en curso: el jugador sujeta a la presa -------------------------------------
    if (takedown.active && takedown.prey) {
      let presses = 0;
      while (input.consume('interact') || input.consume('jump')) presses++;
      updateTakedown(dt, presses);
      const prey = takedown.prey;
      if (takedown.active && prey) {
        // Pegado al costado de la presa, mordiendo el cuello.
        const side = prey.heading + Math.PI / 2;
        p.position.set(prey.position.x + Math.sin(side) * 0.7 * s, prey.position.y, prey.position.z + Math.cos(side) * 0.7 * s);
        p.heading = prey.heading - Math.PI / 2;
        p.speed = 0;
      }
      phys.collider?.setTranslation({ x: p.position.x, y: p.position.y + 0.75 * s, z: p.position.z });
      actor.play('eat', 0.15);
      actor.update(dt);
      p.gait = 'eat';
      syncTransform();
      return;
    }
    updateTakedown(dt, 0);

    // --- Acciones discretas ------------------------------------------------------------
    if (input.consume('crouch')) {
      p.crouching = !p.crouching;
      p.resting = false;
      p.action = null;
    }
    if (input.consume('walk')) p.walkMode = !p.walkMode;
    if (input.consume('rest') && p.grounded && !p.swimming) {
      p.resting = !p.resting;
      p.crouching = false;
      p.action = null;
    }
    if (input.consume('roar') && p.grounded && !p.swimming && st.roarTimer <= 0) {
      p.resting = false;
      p.action = null;
      if (canRoar(p.ageYears)) {
        st.roarTimer = ROAR_SECONDS;
        journal.stats.roars++;
        events.emit('player:roar', { x: p.position.x, z: p.position.z });
        events.emit('sfx', { sound: 'roar', x: p.position.x, y: p.position.y + s, z: p.position.z });
        events.emit('subtitle', { text: sex === 'male' ? '[Rugido del león]' : '[Rugido de la leona]', seconds: 3.5 });
      } else {
        // Los cachorros solo maúllan: es su llamada de auxilio y la madre acude.
        st.roarTimer = 1.2;
        events.emit('player:call', { x: p.position.x, z: p.position.z });
        events.emit('sfx', { sound: 'cubCall', x: p.position.x, y: p.position.y + 0.4, z: p.position.z });
        events.emit('subtitle', { text: '[Maullido agudo de cachorro: llamas a tu madre]', seconds: 2.5 });
      }
    }
    const jumpPressed = input.consume('jump');

    // --- Interacción contextual (E): mamar, beber, comer ---------------------------------
    if (input.consume('interact')) {
      if (p.action) p.action = null;
      else {
        const interaction = availableInteraction(world);
        if (interaction?.action === 'eat' && adultsFeasting()) {
          // Jerarquía en la presa: un juvenil espera a que los adultos se sacien.
          events.emit('sfx', { sound: 'growl', x: p.position.x, y: p.position.y + 0.8, z: p.position.z, volume: 0.8 });
          events.emit('subtitle', { text: 'Una leona adulta te gruñe: los adultos comen primero', seconds: 3 });
          p.speed = 0;
        } else if (interaction) {
          p.action = interaction.action;
          if (interaction.action === 'nurse') journal.stats.nursed++;
          else if (interaction.action === 'drink') journal.stats.drinks++;
          else journal.stats.meals++;
          p.resting = false;
          p.crouching = false;
          faceInteractionTarget(interaction.action);
        }
      }
    }
    if (p.action) {
      const still = availableInteraction(world);
      const n = p.needs;
      const full =
        (p.action === 'nurse' && n.satiety > 0.99) ||
        (p.action === 'drink' && n.hydration > 0.99) ||
        (p.action === 'eat' && n.satiety > 0.99);
      if (input.moveMagnitude > 0.1 || !still || still.action !== p.action || full) {
        if (full) events.emit('subtitle', { text: p.action === 'drink' ? 'Has saciado la sed' : 'Estás saciado', seconds: 2 });
        p.action = null;
      } else {
        st.actionSfx -= dt;
        if (p.action === 'eat') {
          const c = nearestCarcass(p.position.x, p.position.z, 2.4);
          if (c) eatFrom(c, 0.03 * dt);
        }
        if (st.actionSfx <= 0 && p.action !== 'nurse') {
          st.actionSfx = p.action === 'drink' ? 0.7 : 1.1;
          events.emit('sfx', { sound: p.action === 'drink' ? 'lap' : 'chew', x: p.position.x, y: p.position.y, z: p.position.z, volume: 0.5 });
        }
      }
    }

    // --- Dirección deseada relativa a la cámara ------------------------------------------
    const moving = input.moveMagnitude > 0.1 && st.roarTimer <= 0 && !p.action;
    if (moving && p.resting) p.resting = false;
    // Capacidades según la edad: un cachorro corre a menos de la mitad y se agota antes.
    const maturity = physicalMaturity(p.ageYears);
    const ability = (0.42 + 0.58 * maturity) * needsSpeedFactor();
    const top = topSpeedMs(sex) * ability;
    let turnPenalty = 1;
    if (moving) {
      const yaw = p.cameraYaw;
      const dx = Math.sin(yaw) * input.moveZ - Math.cos(yaw) * input.moveX;
      const dz = Math.cos(yaw) * input.moveZ + Math.sin(yaw) * input.moveX;
      const desired = Math.atan2(dx, dz);
      const turnRate = 6.5 - 4.3 * saturate(p.speed / top);
      if (p.grounded) p.heading = moveTowardsAngle(p.heading, desired, turnRate * dt);
      const diff = Math.abs(wrapAngle(desired - p.heading));
      turnPenalty = Math.max(0.15, Math.cos(Math.min(diff, Math.PI / 2)));
    }

    // --- Velocidad objetivo según marcha --------------------------------------------------
    const wantsSprint = input.isDown('sprint') && !p.exhausted && !p.crouching && !p.swimming && p.needs.energy > 0.08;
    let target = 0;
    if (moving && p.grounded) {
      if (p.swimming) target = L.swimSpeedMs * ability;
      else if (p.crouching) target = L.stalkSpeedMs * ability;
      else if (wantsSprint) target = top;
      else if (p.walkMode || (input.analog && input.moveMagnitude < 0.6)) target = L.walkSpeedMs * ability;
      else target = L.trotSpeedMs * ability;
      target *= turnPenalty;
    }
    const groundY = world.heightAt(p.position.x, p.position.z);
    const waterY = world.waterLevelAt(p.position.x, p.position.z);
    const depth = waterY !== null ? waterY - groundY : 0;
    if (!p.swimming && depth > 0.3 * s) target = Math.min(target, L.trotSpeedMs * 0.55); // vadeando

    if (p.grounded) {
      const accel = target > p.speed ? (target > L.trotSpeedMs ? 9 : 6) : 11;
      p.speed += Math.sign(target - p.speed) * Math.min(Math.abs(target - p.speed), accel * dt);
    }

    const sprinting = wantsSprint && moving && p.speed > L.trotSpeedMs * ability * 1.2;
    updateStamina(p, sprinting, p.resting, sex, dt, 0.5 + 0.5 * maturity);

    // --- Movimiento horizontal con colisiones (Rapier) -------------------------------------
    let mx = Math.sin(p.heading) * p.speed * dt;
    let mz = Math.cos(p.heading) * p.speed * dt;
    const { collider, controller } = phys;
    if (collider && controller && (mx !== 0 || mz !== 0)) {
      collider.setTranslation({ x: p.position.x, y: p.position.y + 0.75 * s, z: p.position.z });
      controller.computeColliderMovement(collider, { x: mx, y: 0, z: mz });
      const m = controller.computedMovement();
      // Si choca de frente contra un tronco o roca, pierde velocidad.
      const wanted = Math.hypot(mx, mz);
      const got = Math.hypot(m.x, m.z);
      if (wanted > 1e-4 && got < wanted * 0.5) p.speed *= 0.85;
      mx = m.x;
      mz = m.z;
    }
    const lim = world.half - WORLD_MARGIN;
    p.position.x = Math.max(-lim, Math.min(lim, p.position.x + mx));
    p.position.z = Math.max(-lim, Math.min(lim, p.position.z + mz));
    journal.stats.distance += Math.hypot(mx, mz);

    // --- Vertical: terreno, agua y salto ----------------------------------------------------
    const ground = world.heightAt(p.position.x, p.position.z);
    const water = world.waterLevelAt(p.position.x, p.position.z);
    const swimDepth = 0.95 * s;
    p.swimming = water !== null && water - ground > swimDepth;
    const floor = p.swimming && water !== null ? water - swimDepth : ground;

    if (jumpPressed && p.grounded && !p.swimming && !p.resting && !p.action) {
      p.verticalVelocity = JUMP_SPEED * (0.55 + 0.45 * maturity);
      p.grounded = false;
      st.ambush = p.crouching;
      p.crouching = false;
      p.needs.energy = Math.max(0, p.needs.energy - 0.01);
    }
    if (!p.grounded) {
      p.verticalVelocity -= GRAVITY * dt;
      p.position.y += p.verticalVelocity * dt;
      if (p.position.y <= floor) {
        p.position.y = floor;
        p.verticalVelocity = 0;
        p.grounded = true;
        landPounce();
        tryStartTakedown();
      }
    } else if (floor < p.position.y - 0.6) {
      // Se precipita desde un desnivel (borde de un kopje).
      p.grounded = false;
      p.verticalVelocity = 0;
    } else {
      p.position.y = floor;
    }
    collider?.setTranslation({ x: p.position.x, y: p.position.y + 0.75 * s, z: p.position.z });

    // Alcanzar a una presa en carrera inicia el derribo.
    if (p.speed > 4) tryStartTakedown();

    // --- Orientación al terreno ------------------------------------------------------------
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const reach = 0.8 * s;
    let pitch = 0;
    let roll = 0;
    if (p.grounded && !p.swimming) {
      const hF = world.heightAt(p.position.x + fx * reach, p.position.z + fz * reach);
      const hB = world.heightAt(p.position.x - fx * reach, p.position.z - fz * reach);
      const hL = world.heightAt(p.position.x + fz * 0.35 * s, p.position.z - fx * 0.35 * s);
      const hR = world.heightAt(p.position.x - fz * 0.35 * s, p.position.z + fx * 0.35 * s);
      pitch = Math.atan2(hF - hB, 2 * reach);
      roll = Math.atan2(hL - hR, 0.7 * s) * 0.6;
    } else if (!p.grounded) {
      pitch = Math.max(-0.35, Math.min(0.35, p.verticalVelocity * 0.04));
    }
    st.pitch = damp(st.pitch, pitch, 10, dt);
    st.roll = damp(st.roll, roll, 10, dt);

    // --- Cobertura (base del acecho en la Fase 2) ---------------------------------------------
    const bodyHeight = (p.resting ? 0.55 : p.crouching ? 0.65 : 1.15) * s;
    st.cover = damp(st.cover, saturate(world.grassHeightAt(p.position.x, p.position.z) / bodyHeight), 4, dt);
    p.cover = st.cover;
    p.visibility = visibility({
      cover: p.cover,
      lowPosture: p.crouching || p.resting || p.action === 'nurse',
      speed: p.speed,
      small: p.ageYears < 1,
    });
    // Refugio de la madriguera: entre rocas y matorral un cachorro quieto es casi invisible.
    if (mother.active && distXZ(p.position, mother.home) < 6) {
      p.visibility *= p.crouching || p.resting ? 0.3 : 0.7;
    }
    p.biome = world.biomeAt(p.position.x, p.position.z);
    p.hurtTimer += dt;

    // --- Animación ---------------------------------------------------------------------------
    st.roarTimer = Math.max(0, st.roarTimer - dt);
    let clip: LionClipName;
    if (!p.grounded) clip = 'jump';
    else if (st.roarTimer > 0) clip = 'roar';
    else if (p.action) clip = p.action;
    else if (p.swimming) clip = 'swim';
    else if (p.resting) clip = 'rest';
    else if (p.speed < 0.2) clip = p.crouching ? 'stalkIdle' : 'idle';
    else if (p.crouching) clip = 'stalkWalk';
    else if (p.speed < 2.3 * ability) clip = 'walk';
    else if (p.speed < 7 * ability) clip = 'trot';
    else clip = 'run';

    const prev = actor.currentClip;
    const fade = clip === 'rest' || prev === 'rest' ? 0.9 : clip === 'jump' || prev === 'jump' ? 0.12 : 0.28;
    actor.play(clip, fade);
    actor.matchSpeed(clip === 'swim' ? Math.max(p.speed, 0.8) : p.speed);
    actor.update(dt);
    p.gait = GAIT_OF_CLIP[clip];

    syncTransform();
  }, -40);

  /** Al caer de un salto sobre un hermano: emboscada de juego (entrena la caza). */
  function landPounce() {
    const target = siblings.find((sib) => sib.alive && sib.state !== 'tumble' && distXZ(sib.position, player.position) < 1.7);
    if (!target) return;
    tumbleSibling(target);
    journal.stats.pounces++;
    const perfect = st.ambush;
    events.emit('subtitle', { text: perfect ? `¡Emboscada perfecta a ${target.name}!` : `¡Saltas sobre ${target.name}!`, seconds: 2.5 });
    recordMilestone('first-pounce', `Primera emboscada de juego sobre ${target.name}`);
    if (perfect) recordMilestone('perfect-ambush', 'Emboscada perfecta: agachado, sin ser visto');
    player.needs.bond = Math.min(1, player.needs.bond + 0.1);
  }

  /** Orienta al cachorro hacia la madre, la presa o el agua al iniciar la acción. */
  function faceInteractionTarget(action: string) {
    let tx: number | null = null;
    let tz = 0;
    if (action === 'nurse') {
      tx = mother.position.x;
      tz = mother.position.z;
    } else if (action === 'eat') {
      const c = nearestCarcass(player.position.x, player.position.z, 2.4);
      if (c) {
        tx = c.position.x;
        tz = c.position.z;
      }
    }
    if (tx !== null) player.heading = Math.atan2(tx - player.position.x, tz - player.position.z);
  }

  function syncTransform() {
    actor.object.position.copy(player.position);
    actor.object.rotation.y = player.heading;
    actor.body.rotation.x = -st.pitch;
    actor.body.rotation.z = st.roll;
    sharedUniforms.uPlayer.value.set(player.position.x, player.position.y, player.position.z, 0.95 * actor.scale);
  }

  return <primitive object={actor.object} />;
}
