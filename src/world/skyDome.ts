import * as THREE from 'three';
import { sharedUniforms } from './atmosphereState';

export const SKY_RADIUS = 4500;

/**
 * Cúpula celeste propia: degradado cenit-horizonte por elevación solar, halo de Mie,
 * banda incandescente del horizonte al orto/ocaso, disco solar y capa de nubes procedural
 * iluminada por el sol (las nubes se encienden de naranja y rosa al atardecer).
 */
export function createSkyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSunDir: sharedUniforms.uSunDir,
      uSunColor: sharedUniforms.uSunColor,
      uZenith: sharedUniforms.uZenith,
      uHorizon: sharedUniforms.uHorizon,
      uGlow: sharedUniforms.uGlow,
      uGolden: sharedUniforms.uGolden,
      uNight: sharedUniforms.uNight,
      uMoonGlow: sharedUniforms.uMoonGlow,
      uCloudCover: sharedUniforms.uCloudCover,
      uWindDir: sharedUniforms.uWindDir,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform float uGolden;
      uniform float uNight;
      uniform float uMoonGlow;
      uniform float uCloudCover;
      uniform vec2 uWindDir;
      varying vec3 vDir;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
                   mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * vnoise(p);
          p = p * 2.03 + vec2(17.1, 9.2);
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float hc = max(h, 0.0);

        float cs = dot(d, uSunDir);
        float csp = max(cs, 0.0);
        vec2 dh = normalize(d.xz + 1e-5);
        vec2 sh = normalize(uSunDir.xz + 1e-5);
        float az = dot(dh, sh) * 0.5 + 0.5;

        // Horizonte: incandescente del lado del sol y malva-azulado del lado opuesto al ocaso.
        float lum = dot(uHorizon, vec3(0.3, 0.5, 0.2));
        vec3 antiHorizon = mix(uZenith * 1.8 + vec3(0.06, 0.03, 0.06), vec3(lum) * vec3(0.8, 0.78, 0.95), 0.45);
        vec3 horizon = mix(uHorizon, mix(antiHorizon, uHorizon, pow(az, 1.6)), uGolden);

        // Degradado base: cenit → horizonte.
        float horizonPow = mix(6.0, 4.0, uGolden);
        vec3 sky = mix(uZenith, horizon, pow(1.0 - hc, horizonPow));
        sky = mix(sky, horizon * 0.55, smoothstep(0.0, -0.3, h));
        float band = exp(-abs(h - 0.015) * 7.0) * pow(az, 2.2) * uGolden;
        sky += uGlow * band * 1.9;
        // Contraluz rosado en el lado opuesto (cinturón de Venus).
        float antiBand = exp(-abs(h - 0.08) * 10.0) * pow(1.0 - az, 3.0) * uGolden;
        sky += vec3(0.55, 0.32, 0.42) * antiBand * 0.35;
        float dayish = 1.0 - uNight;
        sky += uGlow * (pow(csp, 5.0) * 0.28 + pow(csp, 40.0) * 0.7 + pow(csp, 400.0) * 2.0) * (0.35 + uGolden) * dayish;

        // Disco solar (enrojece junto al horizonte).
        float disc = smoothstep(0.99962, 0.9998, cs) * smoothstep(-0.03, 0.0, uSunDir.y);
        vec3 discColor = mix(uGlow * vec3(1.4, 0.8, 0.5), vec3(1.0, 0.97, 0.9), smoothstep(0.0, 0.35, uSunDir.y)) * 18.0;

        // Nubes: capa proyectada sobre un plano alto, deriva con el viento.
        float cloud = 0.0;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.1) * 1.4 + uWindDir * uTime * 0.006;
          float n = fbm(uv * 0.8);
          float n2 = fbm(uv * 3.3 + 7.3);
          float shape = n * 0.72 + n2 * 0.38;
          float threshold = mix(0.78, 0.36, uCloudCover);
          cloud = smoothstep(threshold, threshold + 0.22, shape) * smoothstep(0.0, 0.14, h);

          float toward = pow(csp, 3.0);
          vec3 shadowCol = mix(uZenith, horizon, 0.55) * mix(0.9, 0.55, uCloudCover);
          vec3 litCol = uGlow * (0.8 + 1.6 * toward) + vec3(0.12, 0.14, 0.2) * uMoonGlow;
          float litAmt = clamp(1.0 - cloud * 0.5 + 0.35 * toward - (n2 - 0.5) * 0.6, 0.0, 1.0);
          vec3 cloudCol = mix(shadowCol, litCol, litAmt * dayish + uMoonGlow * 0.3);
          // Ribete plateado alrededor del sol.
          cloudCol += uGlow * pow(csp, 10.0) * (1.0 - cloud) * 2.5 * dayish;
          sky = mix(sky, cloudCol, cloud * 0.94);
        }
        sky += disc * discColor * (1.0 - cloud * 0.95);

        // Tramado para evitar bandas en los degradados.
        sky += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(max(sky * 1.25, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}
