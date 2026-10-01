import { AnimalActor, furMaterial } from '../animal/AnimalActor';
import { createLionMesh, lionScale, type LionAppearance } from './lionRig';

/** León animado: jugador, madre, hermanos y (en fases posteriores) leones IA. */
export class LionActor extends AnimalActor {
  readonly appearance: LionAppearance;

  constructor(appearance: LionAppearance) {
    const material = furMaterial();
    const { mesh } = createLionMesh(appearance, material);
    super(mesh, material, lionScale(appearance));
    this.appearance = appearance;
    this.object.name = 'lion-actor';
  }
}
