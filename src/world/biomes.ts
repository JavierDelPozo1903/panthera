/** Identificadores de bioma almacenados en el mapa de biomas (un byte por muestra). */
export const Biome = {
  Grassland: 0,
  Woodland: 1,
  Riparian: 2,
  River: 3,
  Kopje: 4,
  Swamp: 5,
  Village: 6,
  Waterhole: 7,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

type RGB = readonly [number, number, number];

export interface BiomeInfo {
  label: string;
  /** Albedo del suelo en sRGB [0..1]. */
  color: RGB;
  /** Altura media de la hierba en metros (cobertura para el acecho). */
  grassHeight: number;
  /** Árboles por hectárea (aprox.). */
  treesPerHa: number;
  /** Arbustos por hectárea (aprox.). */
  bushesPerHa: number;
}

export const BIOMES: Record<BiomeId, BiomeInfo> = {
  [Biome.Grassland]: {
    label: 'Sabana de hierba alta',
    color: [0.74, 0.63, 0.35],
    grassHeight: 1.15,
    treesPerHa: 0.7,
    bushesPerHa: 3,
  },
  [Biome.Woodland]: {
    label: 'Sabana arbolada',
    color: [0.62, 0.58, 0.31],
    grassHeight: 0.7,
    treesPerHa: 11,
    bushesPerHa: 16,
  },
  [Biome.Riparian]: {
    label: 'Bosque ribereño',
    color: [0.33, 0.43, 0.2],
    grassHeight: 0.45,
    treesPerHa: 46,
    bushesPerHa: 30,
  },
  [Biome.River]: {
    label: 'Río',
    color: [0.33, 0.29, 0.21],
    grassHeight: 0,
    treesPerHa: 0,
    bushesPerHa: 0,
  },
  [Biome.Kopje]: {
    label: 'Kopje',
    color: [0.5, 0.45, 0.4],
    grassHeight: 0.12,
    treesPerHa: 3,
    bushesPerHa: 18,
  },
  [Biome.Swamp]: {
    label: 'Pantano',
    color: [0.34, 0.41, 0.21],
    grassHeight: 1.5,
    treesPerHa: 4,
    bushesPerHa: 8,
  },
  [Biome.Village]: {
    label: 'Aldea',
    color: [0.63, 0.49, 0.34],
    grassHeight: 0.06,
    treesPerHa: 0,
    bushesPerHa: 1,
  },
  [Biome.Waterhole]: {
    label: 'Poza',
    color: [0.33, 0.29, 0.21],
    grassHeight: 0,
    treesPerHa: 0,
    bushesPerHa: 0,
  },
};

export const GROUND_COLORS = {
  mud: [0.36, 0.29, 0.2] as RGB,
  riverBed: [0.31, 0.28, 0.2] as RGB,
  bareEarth: [0.68, 0.52, 0.35] as RGB,
};
