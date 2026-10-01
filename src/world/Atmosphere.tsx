import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clock } from '../core/clock';
import { mulberry32, saturate } from '../core/math';
import { useQuality } from '../core/store';
import { player } from '../entities/player/playerState';
import { updateWind } from '../systems/wind';
import { atmosphere, computeAtmosphere } from './atmosphereState';
import { Dust } from './Dust';
import { createSkyDome, SKY_RADIUS } from './skyDome';

/**
 * Nubosidad del día: escasa en la estación seca, cargada en la húmeda, y variable de un
 * día a otro con una suma de senos (determinista, sin saltos).
 */
function cloudCoverFor(totalDays: number, season: 'dry' | 'wet'): number {
  const base = season === 'dry' ? 0.32 : 0.62;
  const variation = 0.16 * Math.sin(totalDays * 2.1) + 0.1 * Math.sin(totalDays * 5.3 + 1.7);
  return saturate(base + variation);
}

/** Cielo, sol y luna dinámicos, luz hemisférica, niebla, estrellas y polvo en suspensión. */
export function Atmosphere() {
  const quality = useQuality();
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const fog = useRef<THREE.Fog>(null);
  const celestial = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Mesh>(null);

  const sky = useMemo(createSkyDome, []);
  const stars = useMemo(() => createStarField(quality.stars), [quality.stars]);
  const moonMaterial = useMemo(createMoonMaterial, []);
  useEffect(
    () => () => {
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
    },
    [sky],
  );
  useEffect(() => () => stars.geometry.dispose(), [stars]);
  useEffect(() => () => moonMaterial.dispose(), [moonMaterial]);

  // Configuración de la cámara de sombras según calidad.
  useEffect(() => {
    const light = keyLight.current;
    if (!light) return;
    const cam = light.shadow.camera;
    const r = quality.shadowRadius;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    light.shadow.map?.dispose();
    light.shadow.map = null;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.35;
  }, [quality.shadowRadius, quality.shadowMapSize]);

  const tmp = useMemo(
    () => ({ right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), center: new THREE.Vector3() }),
    [],
  );

  useFrame(({ camera }) => {
    computeAtmosphere(
      clock.timeOfDay,
      clock.moonPhase,
      clock.moonIllumination,
      cloudCoverFor(clock.totalDays, clock.season),
    );
    const a = atmosphere;
    updateWind(clock.totalDays);

    const light = keyLight.current;
    if (light) {
      // Cámara de sombras centrada en el jugador y ajustada a la rejilla de texels
      // (evita el parpadeo de las sombras al moverse).
      const r = quality.shadowRadius;
      const texel = (2 * r) / quality.shadowMapSize;
      tmp.fwd.copy(a.keyDir).negate();
      tmp.right.set(0, 1, 0).cross(tmp.fwd).normalize();
      tmp.up.copy(tmp.fwd).cross(tmp.right).normalize();
      tmp.center.copy(player.position);
      const cr = tmp.center.dot(tmp.right);
      const cu = tmp.center.dot(tmp.up);
      tmp.center
        .addScaledVector(tmp.right, Math.round(cr / texel) * texel - cr)
        .addScaledVector(tmp.up, Math.round(cu / texel) * texel - cu);
      light.target.position.copy(tmp.center);
      light.target.updateMatrixWorld();
      light.position.copy(tmp.center).addScaledVector(a.keyDir, 300);
      light.color.copy(a.keyColor);
      light.intensity = a.keyIntensity;
    }

    if (hemi.current) {
      hemi.current.color.copy(a.hemiSky);
      hemi.current.groundColor.copy(a.hemiGround);
      hemi.current.intensity = a.hemiIntensity;
    }

    if (fog.current) {
      fog.current.color.copy(a.fogColor);
      // Calima baja al amanecer y al atardecer; más visibilidad a mediodía.
      fog.current.near = 40 + 110 * a.day * (1 - a.golden * 0.6);
      fog.current.far = quality.fogFar * (0.55 + 0.45 * a.day) * (1 - 0.35 * a.golden);
    }

    sky.position.copy(camera.position);
    if (celestial.current) celestial.current.position.copy(camera.position);
    const starMat = stars.material as THREE.PointsMaterial;
    starMat.opacity = a.night * (1 - 0.55 * a.moonIllumination * a.moonUp) * (1 - 0.8 * a.cloudCover);
    stars.visible = starMat.opacity > 0.01;
    stars.rotation.y = clock.totalDays * 0.4;

    if (moon.current) {
      moon.current.position.copy(a.moonDir).multiplyScalar(SKY_RADIUS * 0.85);
      moon.current.lookAt(camera.position);
      moon.current.visible = a.moonDir.y > -0.1;
      moonMaterial.uniforms.uPhase.value = a.moonPhase;
      moonMaterial.uniforms.uVisibility.value = 0.3 + 0.7 * a.night;
    }
  }, -20);

  return (
    <>
      <primitive object={sky} />
      <directionalLight ref={keyLight} castShadow={quality.shadows} />
      <hemisphereLight ref={hemi} />
      <fog ref={fog} attach="fog" args={['#c9c2b6', 150, quality.fogFar]} />
      <group ref={celestial}>
        <primitive object={stars} />
        <mesh ref={moon} material={moonMaterial} scale={400} renderOrder={-1}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>
      {quality.dust && <Dust />}
    </>
  );
}

function createStarField(count: number): THREE.Points {
  const rng = mulberry32(99);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  const radius = SKY_RADIUS * 0.9;
  for (let i = 0; i < count; i++) {
    const y = Math.pow(rng(), 0.8) * 1.1 - 0.1;
    const phi = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(phi) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(phi) * r * radius;
    const warmth = rng();
    const brightness = 0.35 + Math.pow(rng(), 3) * 0.9;
    c.setRGB(0.8 + warmth * 0.2, 0.82 + 0.1 * rng(), 1.0 - warmth * 0.25).multiplyScalar(brightness);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.8,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}

/** Disco lunar con fase (terminador calculado en el shader) y mares procedurales. */
function createMoonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uPhase: { value: 0.5 }, uVisibility: { value: 1 } },
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPhase;
      uniform float uVisibility;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 p = (vUv * 2.0 - 1.0) * 1.8;
        float r2 = dot(p, p);
        // Halo tenue alrededor del disco.
        float halo = exp(-max(r2 - 0.2, 0.0) * 3.0) * 0.06 * uVisibility;
        if (r2 > 1.0) { gl_FragColor = vec4(vec3(0.6, 0.7, 0.9) * halo * step(r2, 4.0), 1.0); return; }
        vec3 n = vec3(p, sqrt(1.0 - r2));
        float a = uPhase * 6.2831853;
        vec3 l = normalize(vec3(sin(a), 0.0, -cos(a)));
        float lit = smoothstep(-0.03, 0.08, dot(n, l));
        float maria = vnoise(p * 3.1 + 1.7) * 0.6 + vnoise(p * 7.0) * 0.4;
        vec3 albedo = mix(vec3(0.95, 0.93, 0.86), vec3(0.62, 0.62, 0.6), smoothstep(0.45, 0.75, maria));
        float edge = smoothstep(1.0, 0.94, r2);
        vec3 col = albedo * (lit * 1.6 + 0.015) * edge * uVisibility;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
