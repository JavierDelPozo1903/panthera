import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGame, useWorld } from '../../core/store';
import { MAX_PINGS, MAX_PUFFS, pings, puffs, senses, type ScentKind } from '../../systems/senses';

/** Colores del olfato: presa cálida, hiena verdosa, león rojo, jefe violeta sobrenatural. */
const KIND_COLOR: Record<ScentKind, THREE.Color> = {
  prey: new THREE.Color(1.0, 0.55, 0.12),
  hyena: new THREE.Color(0.45, 0.85, 0.25),
  lion: new THREE.Color(0.95, 0.18, 0.12),
  boss: new THREE.Color(0.65, 0.3, 1.0),
};

const puffMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uLevel: { value: 0 }, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uScale * (0.6 + 0.9 * (1.0 - aAlpha)) / -mv.z, 2.0, 48.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * vAlpha * uLevel;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });

const ringMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: { uLevel: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = vAlpha * uLevel;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });

/**
 * Lo que «ve» el león con el modo sensorial: nubes de olor sobre el suelo y ondas de sonido
 * que se abren desde los animales que corren.
 */
export function SenseRenderer() {
  const world = useWorld();
  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage));
    const p = new THREE.Points(geo, puffMaterial());
    p.frustumCulled = false;
    p.renderOrder = 6;
    return p;
  }, []);
  const rings = useMemo(() => {
    const geo = new THREE.RingGeometry(0.92, 1, 48);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINGS), 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.InstancedMesh(geo, ringMaterial(), MAX_PINGS);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINGS * 3), 3);
    m.frustumCulled = false;
    m.renderOrder = 6;
    m.count = 0;
    return m;
  }, []);

  useEffect(
    () => () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
      rings.geometry.dispose();
      (rings.material as THREE.Material).dispose();
    },
    [points, rings],
  );

  const tmp = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (useGame.getState().phase === 'paused') return;
    const level = senses.level;
    points.visible = rings.visible = level > 0.01;
    if (!points.visible) return;
    (points.material as THREE.ShaderMaterial).uniforms.uLevel.value = level;
    (rings.material as THREE.ShaderMaterial).uniforms.uLevel.value = level;

    const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const alpha = points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    const n = Math.min(puffs.length, MAX_PUFFS);
    for (let i = 0; i < n; i++) {
      const p = puffs[i];
      const t = p.age / p.life;
      // El olor sube un poco y se abre al envejecer.
      pos.setXYZ(i, p.x, world.heightAt(p.x, p.z) + 0.35 + t * 0.8, p.z);
      const c = KIND_COLOR[p.kind];
      col.setXYZ(i, c.r, c.g, c.b);
      alpha.setX(i, Math.min(1, p.age * 3) * (1 - t) * 0.55);
    }
    points.geometry.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = alpha.needsUpdate = true;

    const ra = rings.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const m = Math.min(pings.length, MAX_PINGS);
    for (let i = 0; i < m; i++) {
      const p = pings[i];
      const t = p.age / p.life;
      tmp.position.set(p.x, world.heightAt(p.x, p.z) + 0.3, p.z);
      tmp.scale.setScalar(1 + t * (10 + 14 * p.strength));
      tmp.updateMatrix();
      rings.setMatrixAt(i, tmp.matrix);
      rings.setColorAt(i, KIND_COLOR[p.kind]);
      ra.setX(i, (1 - t) * (0.4 + 0.5 * p.strength));
    }
    rings.count = m;
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    ra.needsUpdate = true;
  });

  return (
    <>
      <primitive object={points} />
      <primitive object={rings} />
    </>
  );
}
