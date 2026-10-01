import {
  Bloom,
  BrightnessContrast,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { BlendFunction, Effect, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useGame, useQuality } from '../core/store';
import { player } from '../entities/player/playerState';
import { atmosphere } from './atmosphereState';

/**
 * Gradación «documental de naturaleza»: color fiel algo contenido, sombras ligeramente
 * frías y luces cálidas (split toning), negros apenas levantados como en película y una
 * pizca de desaturación de noche, cuando el ojo ve casi en gris.
 */
class DocumentaryGradeEffect extends Effect {
  constructor() {
    super(
      'DocumentaryGrade',
      /* glsl */ `
        uniform float uSaturation;
        uniform float uSplit;
        uniform vec3 uShadowTint;
        uniform vec3 uHighlightTint;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec3 c = inputColor.rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSaturation);
          float shadows = 1.0 - smoothstep(0.0, 0.42, l);
          float highlights = smoothstep(0.38, 1.0, l);
          c += uSplit * (uShadowTint * shadows + uHighlightTint * highlights);
          // Negros levantados y altas comprimidas: curva suave de película.
          c = c * 0.965 + 0.01;
          outputColor = vec4(max(c, 0.0), inputColor.a);
        }
      `,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ['uSaturation', new THREE.Uniform(0.92)],
          ['uSplit', new THREE.Uniform(1)],
          ['uShadowTint', new THREE.Uniform(new THREE.Vector3(-0.012, 0.004, 0.018))],
          ['uHighlightTint', new THREE.Uniform(new THREE.Vector3(0.024, 0.012, -0.014))],
        ]),
      },
    );
  }
}

/** Altura del punto de enfoque sobre las patas del león (en escalas del modelo). */
const FOCUS_HEIGHT = 0.7;

/**
 * Postprocesado de la dirección «documental naturalista»: oclusión ambiental que asienta
 * animales y hierba en el suelo, profundidad de campo de teleobjetivo enfocada en el león,
 * bloom suave, tone mapping AgX, gradación documental, viñeta y un grano de película fino.
 */
export function PostFX() {
  const quality = useQuality();
  const documentary = useGame((s) => s.documentary);
  // El MSAA pedido no puede superar el máximo de la GPU (si lo hace, el lienzo no arranca).
  const maxSamples = useThree((s) => s.gl.capabilities.maxSamples);
  const samples = Math.min(quality.multisampling, maxSamples);
  const grade = useMemo(() => new DocumentaryGradeEffect(), []);
  const focus = useMemo(() => new THREE.Vector3(), []);
  const dof = useRef<DepthOfFieldEffect>(null);

  useFrame(() => {
    // El foco sigue al león; de noche la imagen pierde color.
    focus.set(player.position.x, player.position.y + FOCUS_HEIGHT * player.scale, player.position.z);
    // R3F copia `target` solo al montar: el foco se actualiza a mano cada frame.
    dof.current?.target?.copy(focus);
    grade.uniforms.get('uSaturation')!.value = 0.93 - 0.25 * atmosphere.night;
  });

  if (!quality.postprocessing) return null;

  const effects: ReactElement[] = [];
  if (quality.ao) {
    effects.push(
      <N8AO key="ao" aoRadius={1.6} distanceFalloff={0.6} intensity={2.4} quality={quality.dof ? 'medium' : 'low'} halfRes color="#1c130b" />,
    );
  }
  if (quality.dof) {
    // En juego, un desenfoque leve del fondo lejano; en la cámara documental (V), teleobjetivo.
    effects.push(
      <DepthOfField
        key="dof"
        ref={dof}
        target={focus}
        worldFocusRange={documentary ? 14 : 70}
        bokehScale={documentary ? 3.2 : 1.4}
        resolutionScale={0.5}
      />,
    );
  }
  if (quality.bloom) effects.push(<Bloom key="bloom" intensity={0.38} luminanceThreshold={0.95} luminanceSmoothing={0.3} mipmapBlur />);
  effects.push(
    <ToneMapping key="tone" mode={ToneMappingMode.AGX} />,
    <HueSaturation key="sat" saturation={0.04} />,
    <BrightnessContrast key="contrast" contrast={0.07} />,
    <primitive key="grade" object={grade} />,
    <Vignette key="vignette" offset={0.32} darkness={documentary ? 0.6 : 0.45} />,
    <Noise key="grain" premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.35} />,
  );

  return (
    <EffectComposer multisampling={samples} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  );
}
