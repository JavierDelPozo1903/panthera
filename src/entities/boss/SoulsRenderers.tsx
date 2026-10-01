import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { bosses, type BossDef, type BossInstance, type ModelKind } from '../../ai/bossEngine';
import { clock } from '../../core/clock';
import { useGame, useWorld } from '../../core/store';
import { combat, lockedPosition } from '../../systems/combat';
import { progression } from '../../systems/progression';
import { sharedUniforms } from '../../world/atmosphereState';
import { isRegionOpen, regions } from '../../world/regions';
import { AnimalActor, furMaterial } from '../animal/AnimalActor';
import { HyenaActor } from '../hyena/HyenaActor';
import { LionActor } from '../lion/LionActor';
import { syncActor } from '../npc/NpcRenderers';
import { player } from '../player/playerState';
import { PreyActor } from '../prey/PreyActor';
import { createCrocMesh } from './crocRig';

const paused = () => useGame.getState().phase === 'paused';

/** Ojos que brillan, pegados al hueso de la cabeza. */
function addGlowingEyes(actor: AnimalActor, color: THREE.ColorRepresentation, size = 0.028): void {
  const head = actor.mesh.skeleton.getBoneByName('head');
  if (!head) return;
  const geo = new THREE.SphereGeometry(size, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo, mat);
    eye.position.set(side * 0.07, 0.06, 0.14);
    head.add(eye);
  }
}

interface ModelOpts {
  scale: number;
  female?: boolean;
  mane?: number;
  seed: number;
}

/** Crea el actor de un jefe o de una invocación según su modelo. */
function makeActor(model: ModelKind, o: ModelOpts): AnimalActor {
  switch (model) {
    case 'hyena':
      return new HyenaActor(o.seed, o.scale);
    case 'lion':
    case 'leopard': {
      const a = new LionActor({
        sex: o.female || model === 'leopard' ? 'female' : 'male',
        ageYears: 7,
        maneDarkness: o.mane ?? 0.6,
        pattern: model === 'leopard' ? 'rosettes' : undefined,
      });
      a.body.scale.multiplyScalar(o.scale * (model === 'leopard' ? 0.85 : 1));
      return a;
    }
    case 'buffalo': {
      const a = new PreyActor('wildebeest', o.seed);
      a.body.scale.multiplyScalar(o.scale * 0.9);
      return a;
    }
    case 'croc': {
      const material = furMaterial();
      const { mesh } = createCrocMesh(material);
      const a = new AnimalActor(mesh, material, 1, false);
      // Aplastado en vertical y alargado: cuerpo pegado al suelo.
      a.body.scale.set(o.scale * 1.05, o.scale * 0.42, o.scale * 1.2);
      return a;
    }
  }
}

function styleBoss(actor: AnimalActor, def: BossDef): void {
  const mat = actor.mesh.material as THREE.MeshStandardMaterial;
  mat.color = new THREE.Color(def.tint).lerp(new THREE.Color('#ffffff'), 0.35);
  mat.emissive = new THREE.Color(def.glow);
  mat.emissiveIntensity = 0.5;
  addGlowingEyes(actor, def.eyes, def.model === 'croc' ? 0.04 : 0.028);
}

function makeSpectral(actor: AnimalActor, color: string): void {
  const mat = actor.mesh.material as THREE.MeshStandardMaterial;
  mat.transparent = true;
  mat.opacity = 0.5;
  mat.depthWrite = false;
  mat.emissive = new THREE.Color(color);
  mat.emissiveIntensity = 0.9;
  mat.color.setRGB(0.5, 0.5, 0.7);
}

function fogShader(color: string, top: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: sharedUniforms.uTime, uOpacity: { value: 0 }, uA: { value: new THREE.Color(color) }, uB: { value: new THREE.Color(top) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uA;
      uniform vec3 uB;
      varying vec2 vUv;
      void main() {
        float wave = 0.5 + 0.5 * sin(vUv.x * 90.0 + uTime * 0.7 + vUv.y * 6.0);
        float a = (1.0 - vUv.y) * (0.35 + 0.25 * wave) * uOpacity;
        gl_FragColor = vec4(mix(uA, uB, vUv.y), a);
      }
    `,
  });
}

interface BossView {
  boss: BossInstance;
  actor: AnimalActor;
  light: THREE.PointLight;
  fog: THREE.Mesh;
  minions: Map<string, AnimalActor>;
}

/**
 * Jefes y sus invocaciones, muros de niebla de los claros y de las fronteras de región, la
 * esencia caída y la marca del objetivo fijado.
 */
export function SoulsRenderers() {
  const world = useWorld();
  const root = useMemo(() => new THREE.Group(), []);
  const views = useMemo(() => new Map<BossInstance, BossView>(), []);
  const borders = useMemo(() => new Map<string, THREE.Mesh>(), []);

  const essence = useMemo(() => {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.6, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#f2c46b', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.y = 3.5;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffe2a0', toneMapped: false }));
    core.position.y = 0.6;
    g.add(beam, core, new THREE.PointLight('#f2c46b', 2.5, 10, 2));
    return g;
  }, []);

  const lockMark = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 24),
      new THREE.MeshBasicMaterial({ color: '#f3ead7', transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }),
    );
    m.renderOrder = 10;
    return m;
  }, []);

  useEffect(
    () => () => {
      for (const v of views.values()) {
        v.actor.dispose();
        for (const m of v.minions.values()) m.dispose();
      }
      views.clear();
      borders.clear();
    },
    [views, borders],
  );

  useFrame(({ camera }, rawDt) => {
    if (paused()) return;
    const dt = Math.min(rawDt, 0.05);
    const pulse = 0.5 + 0.5 * Math.sin(sharedUniforms.uTime.value * 2.4);

    // Crea las vistas de los jefes nuevos y descarta las de partidas anteriores.
    for (const b of bosses) {
      if (views.has(b) || !b.initialized) continue;
      const actor = makeActor(b.def.model, { scale: b.def.scale, female: b.def.female, mane: b.def.mane, seed: 77 });
      styleBoss(actor, b.def);
      const light = new THREE.PointLight(b.def.glow, 0, 16, 2);
      const fog = new THREE.Mesh(new THREE.CylinderGeometry(b.def.arenaRadius, b.def.arenaRadius, 9, 64, 1, true), fogShader('#6b558f', '#c0b4dd'));
      fog.renderOrder = 5;
      root.add(actor.object, light, fog);
      views.set(b, { boss: b, actor, light, fog, minions: new Map() });
    }
    for (const [b, v] of views) {
      if (bosses.includes(b)) continue;
      root.remove(v.actor.object, v.light, v.fog);
      v.actor.dispose();
      views.delete(b);
    }

    for (const v of views.values()) {
      const b = v.boss;
      const a = b.agent;
      const absent = b.def.nightOnly && !clock.isNight && b.state === 'dormant';
      const near = a.position.distanceTo(camera.position) < 450;
      v.actor.object.visible = near && b.vanish <= 0 && !absent;
      if (v.actor.object.visible) syncActor(v.actor, a, world, dt);
      const mat = v.actor.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = b.state === 'defeated' ? 0.05 : (b.phase === 2 ? 0.9 : 0.45) + 0.3 * pulse;
      v.light.position.set(a.position.x, a.position.y + 2, a.position.z);
      v.light.intensity = b.state === 'defeated' || absent || !near ? 0 : b.state === 'fight' ? 6 + 4 * pulse : 2.5;

      // Invocaciones
      const alive = new Set<string>();
      for (const m of b.minions) {
        alive.add(m.agent.id);
        let actor = v.minions.get(m.agent.id);
        if (!actor) {
          actor = makeActor(m.model, { scale: 1, female: m.agent.name.startsWith('Leona'), mane: 0.8, seed: Number(m.agent.id.replace(/\D/g, '')) || 3 });
          if (m.spectral) makeSpectral(actor, m.model === 'buffalo' ? '#7d9bb8' : '#5d49c9');
          addGlowingEyes(actor, '#9fd4ff');
          v.minions.set(m.agent.id, actor);
          root.add(actor.object);
        }
        if (!m.agent.alive) m.agent.clip = 'die';
        syncActor(actor, m.agent, world, dt);
        const mm = actor.mesh.material as THREE.MeshStandardMaterial;
        if (m.spectral) mm.opacity = m.agent.alive ? 0.5 : Math.max(0, mm.opacity - dt * 0.4);
      }
      for (const [id, actor] of v.minions) {
        if (alive.has(id)) continue;
        root.remove(actor.object);
        actor.dispose();
        v.minions.delete(id);
      }

      // Muro de niebla del claro
      const fm = v.fog.material as THREE.ShaderMaterial;
      const target = b.state === 'fight' && combat.active ? 1 : 0;
      fm.uniforms.uOpacity.value += (target - fm.uniforms.uOpacity.value) * Math.min(1, dt * 2);
      v.fog.visible = fm.uniforms.uOpacity.value > 0.01;
      v.fog.position.set(b.arena.x, b.arena.y + 3.5, b.arena.z);
    }

    // Nieblas de frontera de las regiones cerradas (solo cerca del jugador).
    for (const r of regions) {
      if (r.radius <= 0) continue;
      let mesh = borders.get(r.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.radius + 4, r.radius + 4, 40, 128, 1, true), fogShader(r.tint, '#e8e1d2'));
        mesh.renderOrder = 4;
        mesh.position.set(r.center.x, r.center.y + 10, r.center.z);
        borders.set(r.id, mesh);
        root.add(mesh);
      }
      const d = Math.abs(Math.hypot(player.position.x - r.center.x, player.position.z - r.center.z) - r.radius);
      const want = !isRegionOpen(r) && d < 220 ? 0.9 : 0;
      const m = mesh.material as THREE.ShaderMaterial;
      m.uniforms.uOpacity.value += (want - m.uniforms.uOpacity.value) * Math.min(1, dt * 1.5);
      mesh.visible = m.uniforms.uOpacity.value > 0.01;
    }

    const dr = progression.dropped;
    essence.visible = !!dr;
    if (dr) essence.position.set(dr.x, world.heightAt(dr.x, dr.z), dr.z);

    const lp = lockedPosition();
    lockMark.visible = !!lp;
    if (lp) {
      const t = combat.lockTarget;
      const h = t?.isBoss ? 1.6 : 1.1;
      lockMark.position.set(lp.x, lp.y + h, lp.z);
      lockMark.quaternion.copy(camera.quaternion);
    }
  }, -34);

  return (
    <>
      <primitive object={root} />
      <primitive object={essence} />
      <primitive object={lockMark} />
    </>
  );
}
