import * as THREE from 'three';
import { smoothstep } from '../core/math';

/**
 * Paleta de luz de la sabana en función de la elevación del sol (seno del ángulo).
 * Cada fila es un "fotograma" de color: la interpolación entre ellos produce los
 * degradados de la hora azul, el orto/ocaso y la hora dorada.
 */
interface LightKey {
  e: number;
  zenith: number;
  horizon: number;
  /** Halo y banda del horizonte en dirección al sol. */
  glow: number;
  sun: number;
  sunIntensity: number;
  /** Tinte de la luz ambiente (cielo) y del rebote del suelo. */
  ambient: number;
  ground: number;
  ambientIntensity: number;
  fog: number;
}

const KEYS: LightKey[] = [
  // Noche cerrada (luz ambiente alta: los leones ven muy bien de noche y el juego debe ser legible)
  { e: -0.35, zenith: 0x040a1a, horizon: 0x16223c, glow: 0x121c30, sun: 0x000000, sunIntensity: 0, ambient: 0x8a96b4, ground: 0x2c2c30, ambientIntensity: 2.4, fog: 0x1c2638 },
  // Hora azul: el cielo aún ilumina el suelo (sin este relleno la sabana se queda en negro
  // entre la puesta de sol y la noche cerrada).
  { e: -0.12, zenith: 0x0b1733, horizon: 0x3b3456, glow: 0x9a4a46, sun: 0x000000, sunIntensity: 0, ambient: 0x8e94bc, ground: 0x3a3230, ambientIntensity: 2.6, fog: 0x3c3a56 },
  // Crepúsculo: el horizonte arde y el cielo entero rellena las sombras
  { e: -0.03, zenith: 0x1d3160, horizon: 0xd96a4a, glow: 0xff5a28, sun: 0xff4a1a, sunIntensity: 0.0, ambient: 0xa898b4, ground: 0x4a3a30, ambientIntensity: 2.6, fog: 0x8a6468 },
  // Orto / ocaso
  { e: 0.02, zenith: 0x2f5189, horizon: 0xff9a5c, glow: 0xff7a30, sun: 0xff8a48, sunIntensity: 1.9, ambient: 0x9a96b4, ground: 0x5e4432, ambientIntensity: 1.7, fog: 0xc0907e },
  // Hora dorada
  { e: 0.14, zenith: 0x3d6db2, horizon: 0xffc88e, glow: 0xffb060, sun: 0xffb878, sunIntensity: 2.7, ambient: 0xb8bfcc, ground: 0x8e6c42, ambientIntensity: 1.05, fog: 0xd6b89a },
  // Media mañana
  { e: 0.35, zenith: 0x2f6cc0, horizon: 0xbad3ea, glow: 0xfff0d8, sun: 0xfff0dc, sunIntensity: 3.0, ambient: 0xbcc8d8, ground: 0x9c8058, ambientIntensity: 1.05, fog: 0xc4d0d8 },
  // Mediodía
  { e: 1.0, zenith: 0x2462b8, horizon: 0xaecbe6, glow: 0xffffff, sun: 0xfff6ea, sunIntensity: 3.2, ambient: 0xbecadc, ground: 0xa08660, ambientIntensity: 1.1, fog: 0xbccad6 },
];

const toLinear = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
const LINEAR_KEYS = KEYS.map((k) => ({
  e: k.e,
  zenith: toLinear(k.zenith),
  horizon: toLinear(k.horizon),
  glow: toLinear(k.glow),
  sun: toLinear(k.sun),
  sunIntensity: k.sunIntensity,
  ambient: toLinear(k.ambient),
  ground: toLinear(k.ground),
  ambientIntensity: k.ambientIntensity,
  fog: toLinear(k.fog),
}));

// Luz de luna poco saturada: de noche el ojo ve casi en gris (aspecto documental).
const MOON_LIGHT = toLinear(0xb2bcd6);
const MOON_SKY = toLinear(0x16284e);

/** Compensación de exposición para el tone mapping AgX (más oscuro en medios tonos que ACES). */
const EXPOSURE = 1.3;

/** Inclinación de la eclíptica: el sol culmina ligeramente hacia el norte (−Z). */
const SUN_TILT = 0.3;

/**
 * Estado de iluminación calculado a partir del reloj. Los shaders propios (cielo, hierba,
 * agua) referencian directamente estos objetos, así que se actualizan sin copiar uniforms.
 */
export const atmosphere = {
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, -1, 0),
  sunColor: new THREE.Color(),
  sunIntensity: 0,
  moonIntensity: 0,
  /** Luz principal que proyecta sombras: el sol de día y la luna de noche. */
  keyDir: new THREE.Vector3(0, 1, 0),
  keyColor: new THREE.Color(),
  keyIntensity: 0,
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  glow: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 1,
  fogColor: new THREE.Color(),
  /** Color que refleja el agua. */
  skyReflection: new THREE.Color(),
  ambient: new THREE.Color(),
  day: 1,
  night: 0,
  /** Intensidad de la luz rasante (orto/ocaso) [0, 1]. */
  golden: 0,
  moonIllumination: 0,
  moonPhase: 0,
  moonUp: 0,
  /** Cobertura de nubes [0, 1]. */
  cloudCover: 0.45,
};

/** Uniforms compartidos por todos los materiales animados. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
  uWindStrength: { value: 1 },
  uSunDir: { value: atmosphere.sunDir },
  uMoonDir: { value: atmosphere.moonDir },
  uKeyDir: { value: atmosphere.keyDir },
  uKeyLight: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
  uZenith: { value: atmosphere.zenith },
  uHorizon: { value: atmosphere.horizon },
  uGlow: { value: atmosphere.glow },
  uSkyColor: { value: atmosphere.skyReflection },
  uAmbient: { value: atmosphere.ambient },
  uNight: { value: 0 },
  uGolden: { value: 0 },
  uMoonGlow: { value: 0 },
  uCloudCover: { value: 0.45 },
  /** xyz = posición del jugador, w = radio con el que aplasta la hierba. */
  uPlayer: { value: new THREE.Vector4(0, -1000, 0, 1) },
};

const tmpA = new THREE.Color();

function sampleKeys(e: number) {
  let i = 0;
  while (i < LINEAR_KEYS.length - 2 && e > LINEAR_KEYS[i + 1].e) i++;
  const a = LINEAR_KEYS[i];
  const b = LINEAR_KEYS[i + 1];
  const t = smoothstep(a.e, b.e, e);
  return { a, b, t };
}

export function computeAtmosphere(
  timeOfDay: number,
  moonPhase: number,
  moonIllumination: number,
  cloudCover: number,
): void {
  const at = atmosphere;
  const theta = ((timeOfDay - 6) / 12) * Math.PI;
  at.sunDir.set(Math.cos(theta), Math.sin(theta) * Math.cos(SUN_TILT), -Math.sin(theta) * Math.sin(SUN_TILT));
  const moonTheta = theta - moonPhase * Math.PI * 2;
  at.moonDir
    .set(Math.cos(moonTheta), Math.sin(moonTheta) * Math.cos(SUN_TILT), -Math.sin(moonTheta) * Math.sin(SUN_TILT))
    .normalize();

  const e = at.sunDir.y;
  at.day = smoothstep(-0.1, 0.12, e);
  at.golden = (1 - smoothstep(0.04, 0.3, e)) * smoothstep(-0.16, -0.02, e);
  at.night = 1 - smoothstep(-0.22, -0.04, e);
  at.moonPhase = moonPhase;
  at.moonIllumination = moonIllumination;
  at.moonUp = smoothstep(-0.02, 0.15, at.moonDir.y);
  at.cloudCover = cloudCover;

  const { a, b, t } = sampleKeys(e);
  at.zenith.lerpColors(a.zenith, b.zenith, t);
  at.horizon.lerpColors(a.horizon, b.horizon, t);
  at.glow.lerpColors(a.glow, b.glow, t);
  at.sunColor.lerpColors(a.sun, b.sun, t);
  at.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  at.hemiSky.lerpColors(a.ambient, b.ambient, t);
  at.hemiGround.lerpColors(a.ground, b.ground, t);
  at.hemiIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
  at.fogColor.lerpColors(a.fog, b.fog, t);

  // Luz de luna: tiñe de azul la noche y permite ver con luna llena.
  const moonGlow = moonIllumination * at.moonUp * at.night;
  at.moonIntensity = 0.6 * (0.2 + 0.8 * moonIllumination) * at.moonUp * at.night;
  at.zenith.lerp(tmpA.copy(MOON_SKY), moonGlow * 0.35);
  at.hemiSky.lerp(MOON_LIGHT, moonGlow * 0.4);
  at.hemiIntensity += 0.25 * moonGlow;
  at.fogColor.lerp(tmpA.copy(MOON_SKY).multiplyScalar(1.4), moonGlow * 0.4);
  // Las nubes densas apagan el sol y aplanan la luz.
  const overcast = smoothstep(0.55, 0.95, cloudCover);
  at.sunIntensity *= (1 - 0.55 * overcast) * EXPOSURE;
  at.hemiIntensity *= EXPOSURE;
  at.moonIntensity *= EXPOSURE;

  if (at.sunIntensity >= at.moonIntensity) {
    at.keyDir.copy(at.sunDir);
    at.keyColor.copy(at.sunColor);
    at.keyIntensity = at.sunIntensity;
  } else {
    at.keyDir.copy(at.moonDir);
    at.keyColor.copy(MOON_LIGHT);
    at.keyIntensity = at.moonIntensity;
  }
  // Evita que la luz clave roce el horizonte (sombras infinitas y acné).
  if (at.keyDir.y < 0.06) {
    at.keyDir.y = 0.06;
    at.keyDir.normalize();
  }

  at.skyReflection.copy(at.horizon).lerp(at.zenith, 0.35);
  at.ambient.copy(at.hemiSky).multiplyScalar(at.hemiIntensity * 0.5);

  sharedUniforms.uKeyLight.value.copy(at.keyColor).multiplyScalar(at.keyIntensity);
  sharedUniforms.uSunColor.value.copy(at.sunColor);
  sharedUniforms.uNight.value = at.night;
  sharedUniforms.uGolden.value = at.golden;
  sharedUniforms.uMoonGlow.value = moonGlow;
  sharedUniforms.uCloudCover.value = cloudCover;
}
