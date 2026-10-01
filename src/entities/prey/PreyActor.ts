import preyData from '../../data/prey.json';
import { AnimalActor, furMaterial } from '../animal/AnimalActor';
import { createPreyMesh, type PreySpecies } from './preyRig';

export class PreyActor extends AnimalActor {
  readonly species: PreySpecies;

  constructor(species: PreySpecies, seed: number) {
    const material = furMaterial();
    const { mesh } = createPreyMesh(species, material, seed);
    const base = preyData.species[species].scale;
    // La geometría es compartida por especie y variante: el actor no la libera.
    super(mesh, material, base * (0.9 + ((seed * 13) % 10) * 0.02), false);
    this.species = species;
    this.object.name = `${species}-actor`;
  }
}
