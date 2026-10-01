import { AnimalActor, furMaterial } from '../animal/AnimalActor';
import { createHyenaMesh, HYENA_SCALE } from './hyenaRig';

export class HyenaActor extends AnimalActor {
  constructor(seed: number, scaleMultiplier = 1) {
    const material = furMaterial();
    const { mesh } = createHyenaMesh(material, seed);
    super(mesh, material, HYENA_SCALE * (0.92 + ((seed * 7) % 10) * 0.016) * scaleMultiplier);
    this.object.name = 'hyena-actor';
  }
}
