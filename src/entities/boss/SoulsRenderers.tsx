import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { matriarch } from '../../ai/matriarchBrain';
import { useGame, useWorld } from '../../core/store';
import { combat, lockedPosition } from '../../systems/combat';
import { progression } from '../../systems/progression';
import { sharedUniforms } from '../../world/atmosphereState';
import { HyenaActor } from '../hyena/HyenaActor';
import { syncActor } from '../npc/NpcRenderers';

const paused = () => useGame.getState().phase === 'paused';

/** Ojos que brillan en la oscuridad, pegados al hueso de la cabeza. */
function addGlowingEyes(actor: HyenaActor, color: THREE.ColorRepresentation): THREE.Mesh[] {
  const head = actor.mesh.skeleton.getBoneByName('head');
  if (!head) return [];
  const geo = new THREE.SphereGeometry(0.028, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  return [-1, 1].map((side) => {
    const eye = new THREE.Mesh(geo, mat);
    eye.position.set(side * 0.07, 0.06, 0.14);
    head.add(eye);
    return eye;
  });
}

/** Material espectral: translúcido, emisivo y sin escribir profundidad. */
function makeSpectral(actor: HyenaActor): void {
  const mat = actor.mesh.material as THREE.MeshStandardMaterial;
  mat.transparent = true;
  mat.opacity = 0.5;
  mat.depthWrite = false;
  mat.emissive = new THREE.Color('#5d49c9');
  mat.emissiveIntensity = 0.9;
  mat.color.setRGB(0.5, 0.5, 0.7);
}

/**
 * La Matriarca y sus hienas espectrales, el muro de niebla del claro, la esencia caída y la
 * marca del objetivo fijado.
 */
export function SoulsRenderers() {
  const world = useWorld();
  const boss = useMemo(() => {
    const a = new HyenaActor(77, 2.1);
    const mat = a.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setRGB(0.55, 0.5, 0.62);
    mat.emissive = new THREE.Color('#3b1a5c');
    mat.emissiveIntensity = 0.5;
    addGlowingEyes(a, '#c9a4ff');
    return a;
  }, []);
  const light = useMemo(() => new THREE.PointLight('#a37cff', 0, 14, 2), []);
  const minionGroup = useMemo(() => new THREE.Group(), []);
  const minionPool = useMemo(() => new Map<string, HyenaActor>(), []);

  // Muro de niebla: cilindro abierto con un degradado que se desvanece hacia arriba.
  const fog = useMemo(() => {
    const geo = new THREE.CylinderGeometry(30, 30, 9, 64, 1, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: sharedUniforms.uTime, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float wave = 0.5 + 0.5 * sin(vUv.x * 60.0 + uTime * 0.8 + vUv.y * 6.0);
          float a = (1.0 - vUv.y) * (0.35 + 0.25 * wave) * uOpacity;
          gl_FragColor = vec4(mix(vec3(0.42, 0.33, 0.62), vec3(0.75, 0.68, 0.9), vUv.y), a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    return mesh;
  }, []);

  // Esencia caída: columna de luz dorada.
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

  // Marca del objetivo fijado: anillo que mira a la cámara.
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
      boss.dispose();
      for (const a of minionPool.values()) a.dispose();
      minionPool.clear();
    },
    [boss, minionPool],
  );

  useFrame(({ camera }, rawDt) => {
    if (paused()) return;
    const dt = Math.min(rawDt, 0.05);
    const a = matriarch.agent;
    const visible = matriarch.initialized && matriarch.vanish <= 0 && a.position.distanceTo(camera.position) < 400;
    boss.object.visible = visible;
    if (visible) syncActor(boss, a, world, dt);
    const mat = boss.mesh.material as THREE.MeshStandardMaterial;
    const pulse = 0.5 + 0.5 * Math.sin(sharedUniforms.uTime.value * 2.4);
    mat.emissiveIntensity = matriarch.state === 'defeated' ? 0.05 : (matriarch.phase === 2 ? 0.9 : 0.45) + 0.3 * pulse;
    light.position.set(a.position.x, a.position.y + 2, a.position.z);
    light.intensity = matriarch.state === 'defeated' ? 0 : matriarch.state === 'fight' ? 6 + 4 * pulse : 2.5;

    // Hienas espectrales
    const alive = new Set<string>();
    for (const m of matriarch.minions) {
      alive.add(m.id);
      let actor = minionPool.get(m.id);
      if (!actor) {
        actor = new HyenaActor(Number(m.id.replace(/\D/g, '')) || 3);
        makeSpectral(actor);
        addGlowingEyes(actor, '#9fd4ff');
        minionPool.set(m.id, actor);
        minionGroup.add(actor.object);
      }
      if (!m.alive) m.clip = 'die';
      syncActor(actor, m, world, dt);
      // Los caídos se desvanecen.
      const mm = actor.mesh.material as THREE.MeshStandardMaterial;
      mm.opacity = m.alive ? 0.5 : Math.max(0, mm.opacity - dt * 0.4);
    }
    for (const [id, actor] of minionPool) {
      if (alive.has(id)) continue;
      minionGroup.remove(actor.object);
      actor.dispose();
      minionPool.delete(id);
    }

    // Muro de niebla
    const fogMat = fog.material as THREE.ShaderMaterial;
    const target = matriarch.state === 'fight' && combat.active ? 1 : 0;
    fogMat.uniforms.uOpacity.value += (target - fogMat.uniforms.uOpacity.value) * Math.min(1, dt * 2);
    fog.visible = fogMat.uniforms.uOpacity.value > 0.01;
    fog.position.set(matriarch.arena.x, matriarch.arena.y + 3.5, matriarch.arena.z);

    // Esencia caída
    const d = progression.dropped;
    essence.visible = !!d;
    if (d) essence.position.set(d.x, world.heightAt(d.x, d.z), d.z);

    // Objetivo fijado
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
      <primitive object={boss.object} />
      <primitive object={light} />
      <primitive object={minionGroup} />
      <primitive object={fog} />
      <primitive object={essence} />
      <primitive object={lockMark} />
    </>
  );
}
