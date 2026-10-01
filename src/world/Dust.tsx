import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { sharedUniforms } from './atmosphereState';

const BOX = new THREE.Vector3(46, 10, 46);

/**
 * Polvo y polen en suspensión alrededor de la cámara. Brilla a contraluz,
 * sobre todo en la hora dorada: da volumen a los rayos del sol rasante.
 */
export function Dust({ count = 700 }: { count?: number }) {
  const points = useMemo(() => {
    const rng = mulberry32(5150);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rng() * BOX.x;
      seeds[i * 4 + 1] = rng() * BOX.y;
      seeds[i * 4 + 2] = rng() * BOX.z;
      seeds[i * 4 + 3] = rng();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(seeds.slice(0, count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uSunDir: sharedUniforms.uSunDir,
        uSunColor: sharedUniforms.uSunColor,
        uGolden: sharedUniforms.uGolden,
        uNight: sharedUniforms.uNight,
        uWindDir: sharedUniforms.uWindDir,
        uBox: { value: BOX },
        uOrigin: { value: new THREE.Vector3() },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uBox;
        uniform vec3 uOrigin;
        uniform vec2 uWindDir;
        uniform float uPixelRatio;
        varying float vSeed;
        varying vec3 vWorld;
        void main() {
          vec3 p = aSeed.xyz;
          p.xz += uWindDir * uTime * (0.35 + aSeed.w * 0.5);
          p.y += sin(uTime * 0.3 + aSeed.w * 30.0) * 0.6;
          p.x += sin(uTime * 0.21 + aSeed.w * 12.0) * 0.8;
          vec3 local = mod(p - uOrigin + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec3 world = uOrigin + local;
          vWorld = world;
          vSeed = aSeed.w;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.9 + aSeed.w * 1.6) * uPixelRatio * 9.0 / max(-mv.z, 0.5);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uGolden;
        uniform float uNight;
        varying float vSeed;
        varying vec3 vWorld;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c);
          if (r > 0.25) discard;
          float soft = 1.0 - r * 4.0;
          vec3 view = normalize(vWorld - cameraPosition);
          float forward = pow(max(dot(view, uSunDir), 0.0), 5.0);
          float strength = (0.03 + uGolden * 0.15 + forward * (0.25 + 0.6 * uGolden)) * (1.0 - uNight);
          gl_FragColor = vec4(uSunColor * soft * strength * (0.5 + vSeed), 1.0);
        }
      `,
    });
    const p = new THREE.Points(geometry, material);
    p.frustumCulled = false;
    p.name = 'dust';
    return p;
  }, [count]);

  useEffect(
    () => () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    },
    [points],
  );

  useFrame(({ camera, gl }) => {
    const mat = points.material as THREE.ShaderMaterial;
    mat.uniforms.uOrigin.value.copy(camera.position);
    mat.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <primitive object={points} />;
}
