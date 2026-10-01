import * as THREE from 'three';
import { CLIP_NOMINAL_SPEED, getLionClips, type LionClipName } from '../lion/lionAnimations';

/** Clips cíclicos de locomoción: al cambiar entre ellos se conserva la fase de la zancada. */
const GAIT_CLIPS = new Set<LionClipName>(['walk', 'trot', 'run', 'stalkWalk', 'swim']);
const ONE_SHOT = new Set<LionClipName>(['roar', 'die', 'swipe', 'bite', 'mark']);

/**
 * Animal animado (malla + esqueleto estándar + mezclador). Es imperativo y reutilizable:
 * jugador, madre, hermanos e hienas comparten esta clase y los mismos clips procedurales.
 */
export class AnimalActor {
  /** Nodo raíz: posición y rumbo en el mundo. */
  readonly object = new THREE.Group();
  /** Nodo intermedio para inclinar el cuerpo según la pendiente. */
  readonly body = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly scale: number;

  private readonly material: THREE.Material;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<LionClipName, THREE.AnimationAction>;
  private current: LionClipName = 'idle';

  private readonly ownsGeometry: boolean;

  constructor(mesh: THREE.SkinnedMesh, material: THREE.Material, scale: number, ownsGeometry = true) {
    this.ownsGeometry = ownsGeometry;
    this.mesh = mesh;
    this.material = material;
    this.scale = scale;
    this.body.scale.setScalar(scale);
    this.body.rotation.order = 'YXZ';
    this.body.add(mesh);
    this.object.add(this.body);
    this.object.name = 'animal-actor';

    this.mixer = new THREE.AnimationMixer(mesh);
    const clips = getLionClips();
    this.actions = {} as Record<LionClipName, THREE.AnimationAction>;
    for (const name of Object.keys(clips) as LionClipName[]) {
      const action = this.mixer.clipAction(clips[name]);
      if (ONE_SHOT.has(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
    this.actions.idle.play();
  }

  get currentClip(): LionClipName {
    return this.current;
  }

  /** Cambia de animación con fundido cruzado. */
  play(name: LionClipName, fade = 0.25): void {
    if (name === this.current) return;
    const prev = this.actions[this.current];
    const next = this.actions[name];
    next.reset();
    if (GAIT_CLIPS.has(name) && GAIT_CLIPS.has(this.current)) {
      // Sincroniza la fase para que las patas no "salten" entre marchas.
      const phase = (prev.time % prev.getClip().duration) / prev.getClip().duration;
      next.time = phase * next.getClip().duration;
    }
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    prev.fadeOut(fade);
    this.current = name;
  }

  /** Ajusta la velocidad de reproducción del clip de locomoción a la velocidad real (m/s). */
  matchSpeed(speed: number): void {
    const nominal = CLIP_NOMINAL_SPEED[this.current];
    if (!nominal) return;
    const worldNominal = nominal * this.scale;
    this.actions[this.current].setEffectiveTimeScale(Math.min(1.8, Math.max(0.5, speed / worldNominal)));
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
    if (this.ownsGeometry) this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.material.dispose();
  }
}

export function furMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
}
