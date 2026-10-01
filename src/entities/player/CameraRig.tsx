import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { input } from '../../core/input';
import { clamp, damp, saturate, smoothstep } from '../../core/math';
import { INTRO_SECONDS } from '../../ui/IntroOverlay';
import { useGame, useWorld } from '../../core/store';
import { mother } from '../npc/npcState';
import { player } from './playerState';
import { playerPhysics } from './Player';

const BASE_FOV = 55;
const MIN_DIST = 2.8;
const MAX_DIST = 24;
const TERRAIN_CLEARANCE = 0.4;

/** Estado de la cámara (exportado para depuración y para futuras cinemáticas). */
export const cameraState = {
  yaw: 0,
  pitch: 0.3,
  dist: 7.5,
  curDist: 7.5,
  fov: BASE_FOV,
  target: new THREE.Vector3(),
  focus: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  initialized: false,
  menuTime: 0,
  docTime: 0,
  introTime: 0,
};

/**
 * Cámara en tercera persona con colisión (terreno analítico + obstáculos Rapier), zoom,
 * órbita cinemática en el menú y modo "documental" (tele, baja, lenta, sin HUD).
 */
export function CameraRig() {
  const world = useWorld();
  const { world: physics, rapier } = useRapier();
  const st = cameraState;
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const { phase, documentary, settings } = useGame.getState();
    const s = player.scale;

    st.focus.set(player.position.x, player.position.y + 1.05 * s, player.position.z);
    if (!st.initialized || phase === 'loading') {
      st.target.copy(st.focus);
      st.yaw = player.heading;
      st.initialized = true;
    }

    let yaw: number;
    let pitch: number;
    let dist: number;
    let fov: number;
    let follow = 12;

    if (phase === 'menu' || phase === 'loading') {
      // Órbita lenta alrededor del cachorro y su madre al amanecer.
      st.menuTime += dt;
      if (mother.active) {
        st.focus.lerp(mother.position, 0.5);
        st.focus.y += 0.5;
      }
      yaw = player.heading + 2.3 + st.menuTime * 0.045;
      pitch = 0.34 + 0.05 * Math.sin(st.menuTime * 0.1);
      dist = 13;
      fov = 38;
      follow = 30;
      st.yaw = player.heading; // al empezar, la cámara queda detrás del león
      st.introTime = 0;
    } else if (phase === 'intro') {
      // Plano cenital que desciende hasta el cachorro y termina a su espalda.
      st.introTime += dt;
      const k = smoothstep(0, INTRO_SECONDS - 2, st.introTime);
      if (mother.active) {
        st.focus.lerp(mother.position, 0.5 * (1 - k));
        st.focus.y += 0.6 * (1 - k);
      }
      yaw = player.heading + (1 - k) * 2.6;
      pitch = 0.5 - 0.24 * k;
      dist = 42 - 36 * k;
      fov = 34 + 14 * k;
      follow = 30;
      st.yaw = player.heading;
      st.pitch = 0.3;
    } else if (phase === 'dead') {
      // Plano lento de despedida.
      st.docTime += dt;
      yaw = st.yaw + st.docTime * 0.06;
      pitch = 0.35 + st.docTime * 0.01;
      dist = 5 + st.docTime * 0.6;
      fov = 36;
      follow = 2;
    } else if (documentary) {
      st.docTime += dt;
      yaw = player.heading + 1.9 + Math.sin(st.docTime * 0.05) * 0.9;
      pitch = 0.05 + 0.03 * Math.sin(st.docTime * 0.07);
      dist = 10 * s + 3;
      fov = 30;
      follow = 1.6;
    } else {
      st.docTime = 0;
      if (phase === 'playing') {
        const look = input.consumeLook(dt);
        const sens = 0.0022 * settings.mouseSensitivity;
        st.yaw -= look.x * sens;
        st.pitch = clamp(st.pitch + look.y * sens, -0.25, 1.25);
        if (input.isDown('camLeft')) st.yaw += 1.8 * dt;
        if (input.isDown('camRight')) st.yaw -= 1.8 * dt;
        const zoom = input.consumeZoom();
        if (zoom) st.dist = clamp(st.dist * (1 + zoom * 0.12), MIN_DIST, MAX_DIST);
      }
      yaw = st.yaw;
      pitch = st.pitch;
      dist = st.dist * (0.55 + 0.45 * s);
      // Ligero aumento de FOV al esprintar: sensación de velocidad.
      fov = BASE_FOV + 9 * saturate((player.speed - 8) / 7);
    }

    st.target.x = damp(st.target.x, st.focus.x, follow, dt);
    st.target.z = damp(st.target.z, st.focus.z, follow, dt);
    st.target.y = damp(st.target.y, st.focus.y, follow * 0.6, dt);

    const cp = Math.cos(pitch);
    st.dir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);

    // Colisión con el terreno: se acerca si una ladera se interpone.
    let allowed = dist;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * dist;
      const px = st.target.x + st.dir.x * t;
      const py = st.target.y + st.dir.y * t;
      const pz = st.target.z + st.dir.z * t;
      if (py < world.heightAt(px, pz) + TERRAIN_CLEARANCE) {
        allowed = Math.max(1.2, t - 0.5);
        break;
      }
    }
    // Colisión con troncos, rocas y chozas.
    ray.origin = { x: st.target.x, y: st.target.y, z: st.target.z };
    ray.dir = { x: st.dir.x, y: st.dir.y, z: st.dir.z };
    const hit = physics.castRay(ray, allowed, true, undefined, undefined, playerPhysics.collider ?? undefined);
    if (hit && hit.timeOfImpact < allowed) allowed = Math.max(1.2, hit.timeOfImpact - 0.35);

    // Se acerca de golpe y se aleja con suavidad.
    st.curDist = allowed < st.curDist ? allowed : damp(st.curDist, allowed, 2.5, dt);

    cam.position.copy(st.target).addScaledVector(st.dir, st.curDist);
    const floor = world.heightAt(cam.position.x, cam.position.z) + TERRAIN_CLEARANCE;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(st.target.x, st.target.y + 0.2 * s, st.target.z);

    st.fov = damp(st.fov, fov, 3, dt);
    if (Math.abs(cam.fov - st.fov) > 0.01) {
      cam.fov = st.fov;
      cam.updateProjectionMatrix();
    }

    // Los controles del jugador son relativos a la orientación de la cámara.
    player.cameraYaw = yaw;
  }, -30);

  return null;
}
