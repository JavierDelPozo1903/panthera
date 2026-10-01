import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boneIndex, JOINTS, PARENTS, QUAD_BONES, type QuadBone, type V3 } from './skeleton';

/**
 * Herramientas para construir animales placeholder: piezas rígidas (elipsoides, segmentos de
 * extremidad) unidas a un hueso, torsos con piel ponderada y el ensamblado del SkinnedMesh.
 */

export type ColorFn = (normal: THREE.Vector3, position: THREE.Vector3) => THREE.Color;
export type Paint = THREE.Color | ColorFn;

export const srgb = (hex: number): THREE.Color => new THREE.Color(hex).convertSRGBToLinear();
export const mirror = (v: V3): V3 => [-v[0], v[1], v[2]];

function writeColors(g: THREE.BufferGeometry, color: Paint): void {
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const c =
      typeof color === 'function'
        ? color(n.fromBufferAttribute(g.attributes.normal, i), p.fromBufferAttribute(g.attributes.position, i))
        : color;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Pieza rígida: todos sus vértices siguen a un único hueso. */
export function rigidPart(geo: THREE.BufferGeometry, bone: QuadBone, color: Paint): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  writeColors(g, color);
  const count = g.attributes.position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const bi = boneIndex(bone);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = bi;
    skinWeight[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  return g;
}

export function ellipsoid(center: V3, radii: V3, bone: QuadBone, color: Paint, detail = 2, pitch = 0) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.scale(radii[0], radii[1], radii[2]);
  if (pitch) geo.rotateX(pitch);
  geo.translate(center[0], center[1], center[2]);
  return rigidPart(geo, bone, color);
}

/** Segmento de extremidad: cilindro troncocónico con casquetes esféricos. */
export function limb(a: V3, b: V3, ra: number, rb: number, bone: QuadBone, color: Paint, heightSegments = 1) {
  return limbSeg(a, b, ra, rb, bone, color, heightSegments);
}

function limbSeg(a: V3, b: V3, ra: number, rb: number, bone: QuadBone, color: Paint, heightSegments: number) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(A, B);
  const len = dir.length();
  // Más segmentos permiten patrones de color a lo largo (rayas de la cebra).
  const cyl = new THREE.CylinderGeometry(ra, rb, len, 10, heightSegments, true);
  cyl.translate(0, len / 2, 0);
  cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  cyl.translate(B.x, B.y, B.z);
  const capA = new THREE.IcosahedronGeometry(ra, 1).translate(A.x, A.y, A.z);
  const capB = new THREE.IcosahedronGeometry(rb, 1).translate(B.x, B.y, B.z);
  return [rigidPart(cyl, bone, color), rigidPart(capA, bone, color), rigidPart(capB, bone, color)];
}

/** Sección del torso: z, semiancho, semialto, altura del centro. */
export type TorsoSection = [z: number, halfWidth: number, halfHeight: number, centerY: number];

/** Interpola el perfil del torso con secciones cada `step` metros (más resolución). */
function resampleProfile(profile: TorsoSection[], step: number): TorsoSection[] {
  const out: TorsoSection[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const n = Math.max(1, Math.ceil((b[0] - a[0]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
    }
  }
  out.push(profile[profile.length - 1]);
  return out;
}

/** Articulaciones del tronco sobre las que se reparte el peso de la piel. */
const TORSO_BONES: [QuadBone, number][] = [
  ['hips', JOINTS.hips[2]],
  ['spine', JOINTS.spine[2]],
  ['chest', JOINTS.chest[2]],
  ['neck', JOINTS.neck[2]],
];

/**
 * Torso continuo generado por barrido de secciones elípticas. Cada vértice reparte su peso
 * entre los dos huesos del tronco más cercanos: al flexionarse la columna la piel se
 * deforma de forma suave, sin las juntas de las piezas rígidas.
 */
export function torsoLoft(profile: TorsoSection[], color: ColorFn, ringStep = 0): THREE.BufferGeometry {
  const radial = ringStep > 0 ? 24 : 18;
  if (ringStep > 0) profile = resampleProfile(profile, ringStep);
  const rings = profile.length;
  const positions: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  for (const [z, hw, hh, cy] of profile) {
    for (let r = 0; r < radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      // Vientre algo más plano y lomo redondeado.
      positions.push(c * hw, cy + (s > 0 ? s : s * 0.9) * hh, z);
      let lower = 0;
      while (lower < TORSO_BONES.length - 2 && z > TORSO_BONES[lower + 1][1]) lower++;
      const [b0, z0] = TORSO_BONES[lower];
      const [b1, z1] = TORSO_BONES[lower + 1];
      const t = Math.min(1, Math.max(0, (z - z0) / (z1 - z0)));
      const w = t * t * (3 - 2 * t);
      skinIndex.push(boneIndex(b0), boneIndex(b1), 0, 0);
      skinWeight.push(1 - w, w, 0, 0);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let r = 0; r < radial; r++) {
      const a = i * radial + r;
      const b = i * radial + ((r + 1) % radial);
      indices.push(a, b, a + radial, b, b + radial, a + radial);
    }
  }
  // Tapas en los extremos (quedan ocultas bajo el cuello y la grupa).
  const capStart = positions.length / 3;
  for (const ringIndex of [0, rings - 1]) {
    const [z, , , cy] = profile[ringIndex];
    positions.push(0, cy, z);
    const bone = ringIndex === 0 ? TORSO_BONES[0][0] : TORSO_BONES[TORSO_BONES.length - 1][0];
    skinIndex.push(boneIndex(bone), 0, 0, 0);
    skinWeight.push(1, 0, 0, 0);
  }
  const last = (rings - 1) * radial;
  for (let r = 0; r < radial; r++) {
    const next = (r + 1) % radial;
    indices.push(capStart, next, r);
    indices.push(capStart + 1, last + r, last + next);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const g = geo.toNonIndexed();
  geo.dispose();
  writeColors(g, color);
  return g;
}

/** Une las piezas en una sola geometría con atributos de piel. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Une las piezas en un SkinnedMesh con el esqueleto estándar. */
export function assembleSkinnedMesh(
  parts: THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
): { mesh: THREE.SkinnedMesh; bones: Record<QuadBone, THREE.Bone> } {
  return skinnedMeshFromGeometry(mergeParts(parts), material, name);
}

/** Crea un SkinnedMesh (con su propio esqueleto) sobre una geometría, que puede compartirse. */
export function skinnedMeshFromGeometry(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): { mesh: THREE.SkinnedMesh; bones: Record<QuadBone, THREE.Bone> } {
  const bones = {} as Record<QuadBone, THREE.Bone>;
  for (const boneName of QUAD_BONES) {
    const bone = new THREE.Bone();
    bone.name = boneName;
    bones[boneName] = bone;
  }
  for (const boneName of QUAD_BONES) {
    const parent = PARENTS[boneName];
    const j = JOINTS[boneName];
    if (parent) {
      const pj = JOINTS[parent];
      bones[boneName].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
      bones[parent].add(bones[boneName]);
    } else {
      bones[boneName].position.set(j[0], j[1], j[2]);
    }
  }

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(QUAD_BONES.map((b) => bones[b])));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = name;
  return { mesh, bones };
}

/** Patas estándar (delanteras y traseras) con los grosores indicados. */
export function standardLegs(
  paint: Paint,
  thickness: { frontUpper: number; frontLower: number; hindUpper: number; hindLower: number; paw: number },
  segments = 1,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const t = thickness;
  const limb = (a: V3, b: V3, ra: number, rb: number, bone: QuadBone, color: Paint) => limbSeg(a, b, ra, rb, bone, color, segments);
  for (const [side, prefix] of [
    [1, 'FL'],
    [-1, 'FR'],
  ] as const) {
    const s = (v: V3): V3 => (side === 1 ? v : mirror(v));
    parts.push(...limb(s(JOINTS.FL_upper), s(JOINTS.FL_lower), t.frontUpper, t.frontUpper * 0.72, `${prefix}_upper`, paint));
    parts.push(...limb(s(JOINTS.FL_lower), s(JOINTS.FL_paw), t.frontLower, t.frontLower * 0.8, `${prefix}_lower`, paint));
    parts.push(...limb(s(JOINTS.FL_paw), s([0.19, 0.06, 0.44]), t.paw * 0.8, t.paw * 0.75, `${prefix}_paw`, paint));
    parts.push(ellipsoid(s([0.19, 0.055, 0.46]), [t.paw, 0.055, t.paw * 1.35], `${prefix}_paw`, paint, 1));
  }
  for (const [side, prefix] of [
    [1, 'BL'],
    [-1, 'BR'],
  ] as const) {
    const s = (v: V3): V3 => (side === 1 ? v : mirror(v));
    parts.push(...limb(s(JOINTS.BL_upper), s(JOINTS.BL_lower), t.hindUpper, t.hindUpper * 0.62, `${prefix}_upper`, paint));
    parts.push(...limb(s(JOINTS.BL_lower), s(JOINTS.BL_paw), t.hindLower, t.hindLower * 0.65, `${prefix}_lower`, paint));
    parts.push(...limb(s(JOINTS.BL_paw), s([0.18, 0.065, -0.72]), t.paw * 0.72, t.paw * 0.66, `${prefix}_paw`, paint));
    parts.push(ellipsoid(s([0.18, 0.052, -0.69]), [t.paw * 0.93, 0.052, t.paw * 1.33], `${prefix}_paw`, paint, 1));
  }
  return parts;
}
