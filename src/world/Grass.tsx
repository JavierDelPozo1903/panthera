import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { useQuality, useWorld } from '../core/store';
import { sharedUniforms } from './atmosphereState';
import { TERRAIN_GLSL } from './WorldData';

interface GrassLayerProps {
  count: number;
  /** Lado (m) de la baldosa toroidal que sigue a la cámara. */
  tile: number;
  bladeWidth: number;
  heightScale: number;
  segments: 1 | 3;
  seed: number;
  /** Baldosa de la capa cercana: esta capa se desvanece dentro de ella para no duplicarla. */
  innerTile?: number;
}

/** Adelanto de la baldosa en la dirección de la mirada (fracción del lado). */
const CENTER_LEAD = 0.26;

/** Hierba de la sabana: una capa cercana densa y una lejana de matas anchas. */
export function Grass() {
  const quality = useQuality();
  const { grassNear, grassFar } = quality;
  return (
    <>
      <GrassLayer
        key={`near-${grassNear.count}-${grassNear.tile}`}
        count={grassNear.count}
        tile={grassNear.tile}
        bladeWidth={0.065}
        heightScale={1}
        segments={3}
        seed={11}
      />
      {grassFar && (
        <GrassLayer
          key={`far-${grassFar.count}-${grassFar.tile}`}
          count={grassFar.count}
          tile={grassFar.tile}
          bladeWidth={0.3}
          heightScale={0.85}
          segments={1}
          seed={23}
          innerTile={grassNear.tile}
        />
      )}
    </>
  );
}

/** Geometría de una brizna: tira que se estrecha hasta la punta. x ∈ [-0.5, 0.5], y ∈ [0, 1]. */
function createBladeGeometry(segments: 1 | 3): { positions: number[]; indices: number[] } {
  if (segments === 1) {
    return { positions: [-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  }
  const levels = [0, 0.38, 0.72];
  const widths = [1, 0.8, 0.48];
  const positions: number[] = [];
  const indices: number[] = [];
  levels.forEach((y, i) => positions.push(-0.5 * widths[i], y, 0, 0.5 * widths[i], y, 0));
  positions.push(0, 1, 0);
  for (let i = 0; i < levels.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const top = levels.length * 2;
  indices.push(top - 2, top - 1, top);
  return { positions, indices };
}

function GrassLayer({ count, tile, bladeWidth, heightScale, segments, seed, innerTile = 0 }: GrassLayerProps) {
  const world = useWorld();

  const layerUniforms = useMemo(
    () => ({
      uCenter: { value: new THREE.Vector2() },
      uInnerCenter: { value: new THREE.Vector2() },
      uCameraPos: { value: new THREE.Vector3() },
      uTile: { value: tile },
      uFadeStart: { value: tile * 0.28 },
      uFadeEnd: { value: tile * 0.48 },
      uInnerFade: {
        value: innerTile > 0 ? new THREE.Vector2(innerTile * 0.3, innerTile * 0.46) : new THREE.Vector2(-2, -1),
      },
      uBladeWidth: { value: bladeWidth },
      uHeightScale: { value: heightScale },
      uDryTip: { value: new THREE.Color().setRGB(0.8, 0.68, 0.38, THREE.SRGBColorSpace) },
    }),
    [tile, bladeWidth, heightScale, innerTile],
  );

  const mesh = useMemo(() => {
    const blade = createBladeGeometry(segments);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(blade.positions, 3));
    geometry.setIndex(blade.indices);
    const rng = mulberry32(seed);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rng() * tile;
      seeds[i * 4 + 1] = rng() * tile;
      seeds[i * 4 + 2] = rng();
      seeds[i * 4 + 3] = rng();
    }
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, world.uniforms, layerUniforms, {
        uTime: sharedUniforms.uTime,
        uWindDir: sharedUniforms.uWindDir,
        uWindStrength: sharedUniforms.uWindStrength,
        uPlayer: sharedUniforms.uPlayer,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', GRASS_VERTEX_MAIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vGrassColor, opacity );')
        .replace(
          '#include <normal_fragment_begin>',
          // Sin inversión de normal en la cara trasera: ambas caras se iluminan igual.
          'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;',
        );
    };

    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false; // las posiciones se calculan en el shader
    m.receiveShadow = true;
    m.name = 'grass';
    return m;
  }, [world, count, tile, segments, seed, layerUniforms]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  const forward = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    layerUniforms.uCameraPos.value.copy(camera.position);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();
    // La baldosa se adelanta en la dirección de la mirada: menos briznas detrás de la cámara.
    layerUniforms.uCenter.value.set(
      camera.position.x + forward.x * tile * CENTER_LEAD,
      camera.position.z + forward.z * tile * CENTER_LEAD,
    );
    layerUniforms.uInnerCenter.value.set(
      camera.position.x + forward.x * innerTile * CENTER_LEAD,
      camera.position.z + forward.z * innerTile * CENTER_LEAD,
    );
  });

  return <primitive object={mesh} />;
}

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec4 uPlayer;
uniform vec2 uCenter;
uniform vec2 uInnerCenter;
uniform vec3 uCameraPos;
uniform float uTile;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform vec2 uInnerFade;
uniform float uBladeWidth;
uniform float uHeightScale;
uniform vec3 uDryTip;
varying vec3 vGrassColor;
${TERRAIN_GLSL}
`;

const GRASS_VERTEX_MAIN = /* glsl */ `
  // Posición toroidal: la brizna reaparece al otro lado de la baldosa al moverse la cámara.
  vec2 gWorld = mod(aSeed.xy - uCenter + 0.5 * uTile, uTile) - 0.5 * uTile + uCenter;
  float gCenterDist = distance(gWorld, uCenter);
  float gFade = (1.0 - smoothstep(uFadeStart, uFadeEnd, gCenterDist))
    * smoothstep(uInnerFade.x, uInnerFade.y, distance(gWorld, uInnerCenter));
  vec4 gGround = terrainGround(gWorld);
  float gGrassH = gGround.a * uMaxGrassHeight;
  float gR1 = aSeed.z;
  float gR2 = aSeed.w;
  float gH = gGrassH * (0.55 + 0.9 * gR1) * gFade * uHeightScale * step(0.05, gGrassH);

  float gAng = gR2 * 6.2831853;
  vec2 gAcross = vec2(cos(gAng), sin(gAng));
  vec2 gLean = vec2(-gAcross.y, gAcross.x);
  float gY = position.y;
  vec3 gPos = vec3(gWorld.x, terrainHeight(gWorld), gWorld.y);
  // Las briznas pegadas a la cámara se ocultan para que no tapen la vista.
  gH *= smoothstep(0.8, 3.2, distance(gPos + vec3(0.0, gGrassH * 0.5, 0.0), uCameraPos));
  // Pasillo de visión: se aparta la hierba entre la cámara y el león (vital con un cachorro).
  vec2 gSeg = uPlayer.xz - uCameraPos.xz;
  float gT = clamp(dot(gWorld - uCameraPos.xz, gSeg) / max(dot(gSeg, gSeg), 1e-3), 0.0, 1.0);
  float gSegDist = distance(gWorld, uCameraPos.xz + gSeg * gT);
  float gLane = 0.3 + 0.6 * uPlayer.w;
  float gKeep = 1.0 - (0.3 + 0.4 * uPlayer.w) / max(length(gSeg), 0.001);
  gH *= mix(1.0, smoothstep(gLane * 0.5, gLane, gSegDist), step(gT, gKeep) * step(0.02, gT) * step(length(gSeg), 16.0));
  gPos.xz += gAcross * position.x * uBladeWidth * (0.7 + 0.6 * gR1) * (0.55 + 0.45 * gFade);

  // Viento: rachas que recorren la sabana + aleteo individual.
  float gPhase = dot(gWorld, uWindDir) * 0.07 - uTime * 1.3;
  float gGust = sin(gPhase) * 0.5 + 0.5;
  gGust *= gGust;
  float gFlutter = sin(uTime * 2.7 + gR1 * 20.0 + gWorld.x * 0.3) * 0.08;
  vec2 gBend = gLean * (0.1 + 0.25 * gR2) + uWindDir * (0.08 + 0.35 * gGust + gFlutter) * uWindStrength;

  // El león aparta la hierba a su paso.
  vec2 gToP = gWorld - uPlayer.xz;
  float gPd = length(gToP);
  float gPush = (1.0 - smoothstep(uPlayer.w * 0.45, uPlayer.w * 1.5, gPd)) * step(abs(uPlayer.y - gPos.y), 2.5);
  gBend += (gToP / max(gPd, 0.001)) * gPush * 1.2;

  float gBendAmt = min(dot(gBend, gBend), 1.0);
  gPos.xz += gBend * gY * gY * gH;
  gPos.y += gY * gH * (1.0 - 0.35 * gBendAmt);

  // Normal inclinada según la cara de la brizna: mezcla cielo y rebote cálido del suelo en
  // la luz hemisférica y da variación de sombreado entre briznas.
  vec3 objectNormal = normalize(vec3(gLean.x * 0.3 + gBend.x * 0.3, 1.0, gLean.y * 0.3 + gBend.y * 0.3));

  float gShade = 0.78 + 0.42 * gR1;
  vec3 gBase = gGround.rgb * 0.5;
  vec3 gTip = mix(gGround.rgb * 1.25, uDryTip, 0.35);
  vGrassColor = mix(gBase, gTip, gY) * gShade;
`;
