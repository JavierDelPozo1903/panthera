export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface GrassLayerPreset {
  /** Número de briznas instanciadas. */
  count: number;
  /** Lado de la baldosa que sigue a la cámara (m). */
  tile: number;
}

export interface QualityPreset {
  label: string;
  hint: string;
  /** Límite superior de device pixel ratio. */
  maxDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Radio (m) alrededor del jugador con sombras. */
  shadowRadius: number;
  grassNear: GrassLayerPreset;
  grassFar: GrassLayerPreset | null;
  /** Distancias (m) a las que el terreno pasa a LOD 1, 2 y 3. */
  terrainLod: [number, number, number];
  treeLodDistance: number;
  treeViewDistance: number;
  bushViewDistance: number;
  fogFar: number;
  postprocessing: boolean;
  bloom: boolean;
  multisampling: number;
  dust: boolean;
  stars: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Bajo',
    hint: 'Gráfica integrada antigua',
    maxDpr: 0.8,
    shadows: false,
    shadowMapSize: 1024,
    shadowRadius: 40,
    grassNear: { count: 34_000, tile: 56 },
    grassFar: null,
    terrainLod: [220, 480, 900],
    treeLodDistance: 110,
    treeViewDistance: 650,
    bushViewDistance: 180,
    fogFar: 1000,
    postprocessing: false,
    bloom: false,
    multisampling: 0,
    dust: false,
    stars: 900,
  },
  medium: {
    label: 'Medio',
    hint: 'Portátil medio',
    maxDpr: 1,
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 45,
    grassNear: { count: 90_000, tile: 70 },
    grassFar: { count: 22_000, tile: 230 },
    terrainLod: [320, 680, 1250],
    treeLodDistance: 190,
    treeViewDistance: 950,
    bushViewDistance: 300,
    fogFar: 1500,
    postprocessing: true,
    bloom: true,
    multisampling: 0,
    dust: true,
    stars: 1600,
  },
  high: {
    label: 'Alto',
    hint: 'Gráfica dedicada',
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 60,
    grassNear: { count: 160_000, tile: 84 },
    grassFar: { count: 45_000, tile: 270 },
    terrainLod: [420, 850, 1550],
    treeLodDistance: 300,
    treeViewDistance: 1400,
    bushViewDistance: 450,
    fogFar: 2100,
    postprocessing: true,
    bloom: true,
    multisampling: 4,
    dust: true,
    stars: 2400,
  },
  ultra: {
    label: 'Ultra',
    hint: 'Gráfica de gama alta',
    maxDpr: 2,
    shadows: true,
    shadowMapSize: 4096,
    shadowRadius: 85,
    grassNear: { count: 260_000, tile: 96 },
    grassFar: { count: 80_000, tile: 320 },
    terrainLod: [560, 1150, 2100],
    treeLodDistance: 460,
    treeViewDistance: 2200,
    bushViewDistance: 650,
    fogFar: 2800,
    postprocessing: true,
    bloom: true,
    multisampling: 8,
    dust: true,
    stars: 3500,
  },
};

export const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
