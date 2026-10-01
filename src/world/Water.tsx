import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useWorld } from '../core/store';
import { sharedUniforms } from './atmosphereState';
import { TERRAIN_GLSL, type WorldData } from './WorldData';

/**
 * Agua del río, el pantano y las pozas. La profundidad se calcula en el shader leyendo el
 * mapa de alturas, lo que permite orillas húmedas y transparencia sin depth texture.
 */
export function Water() {
  const world = useWorld();

  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    // Lámina global a cota 0: cubre río y pantano (el terreno oculta el resto por z-buffer).
    const riverGeo = new THREE.PlaneGeometry(world.size, world.size, 1, 1).rotateX(-Math.PI / 2);
    const river = new THREE.Mesh(riverGeo, createWaterMaterial(world, world.waterLevel));
    river.position.y = world.waterLevel;
    list.push(river);

    for (const w of world.features.waterholes) {
      const geo = new THREE.CircleGeometry(w.radius * 2.4, 40).rotateX(-Math.PI / 2);
      const pool = new THREE.Mesh(geo, createWaterMaterial(world, w.level));
      pool.position.set(w.x, w.level, w.z);
      list.push(pool);
    }
    for (const m of list) {
      m.renderOrder = 1;
      m.name = 'water';
    }
    return list;
  }, [world]);

  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
}

function createWaterMaterial(world: WorldData, level: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...world.uniforms,
      uTime: sharedUniforms.uTime,
      uKeyDir: sharedUniforms.uKeyDir,
      uKeyLight: sharedUniforms.uKeyLight,
      uSkyColor: sharedUniforms.uSkyColor,
      uAmbient: sharedUniforms.uAmbient,
      uWindDir: sharedUniforms.uWindDir,
      uLevel: { value: level },
      uShallow: { value: new THREE.Color().setRGB(0.36, 0.34, 0.22, THREE.SRGBColorSpace) },
      uDeep: { value: new THREE.Color().setRGB(0.12, 0.16, 0.12, THREE.SRGBColorSpace) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${TERRAIN_GLSL}
      uniform float uTime;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyLight;
      uniform vec3 uSkyColor;
      uniform vec3 uAmbient;
      uniform vec2 uWindDir;
      uniform float uLevel;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec3 vWorldPos;

      // Oleaje procedural: suma de ondas direccionales (derivadas analíticas).
      vec2 waveSlope(vec2 p) {
        vec2 s = vec2(0.0);
        vec2 dirs[4];
        dirs[0] = uWindDir;
        dirs[1] = normalize(uWindDir + vec2(0.6, -0.3));
        dirs[2] = normalize(vec2(-uWindDir.y, uWindDir.x) + uWindDir * 0.4);
        dirs[3] = normalize(uWindDir - vec2(0.2, 0.7));
        float freqs[4];
        freqs[0] = 0.55; freqs[1] = 1.1; freqs[2] = 2.3; freqs[3] = 4.1;
        for (int i = 0; i < 4; i++) {
          float f = freqs[i];
          float a = 0.05 / f;
          float ph = dot(dirs[i], p) * f + uTime * (1.2 + f * 0.6);
          s += dirs[i] * cos(ph) * a * f;
        }
        return s;
      }

      void main() {
        float depth = uLevel - terrainHeight(vWorldPos.xz);
        if (depth < -0.02) discard;

        vec2 slope = waveSlope(vWorldPos.xz);
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 v = normalize(cameraPosition - vWorldPos);
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 2.4, depth));
        body *= uAmbient + uKeyLight * max(uKeyDir.y, 0.0) * 0.35;

        vec3 r = reflect(-v, n);
        vec3 refl = uSkyColor * (0.85 + 0.3 * r.y);
        float spec = pow(max(dot(r, uKeyDir), 0.0), 180.0);

        vec3 col = mix(body, refl, fresnel) + uKeyLight * spec * 1.4;

        // Orilla: línea húmeda y transparencia creciente con la profundidad.
        float shore = 1.0 - smoothstep(0.0, 0.12, depth);
        col = mix(col, col * 0.75 + vec3(0.05), shore * 0.6);
        float alpha = mix(0.35, 0.93, smoothstep(0.0, 1.4, depth));
        alpha = clamp(alpha + fresnel * 0.4, 0.0, 1.0) * smoothstep(-0.02, 0.05, depth);

        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}
