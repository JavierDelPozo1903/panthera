import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense } from 'react';
import * as THREE from 'three';
import { AudioDriver } from './core/audio/AudioDriver';
import { GameLoop } from './core/GameLoop';
import { useGame, useQuality } from './core/store';
import { Simulation } from './core/Simulation';
import { Carcasses } from './entities/carcass/Carcasses';
import { Hyenas, MotherLion, PrideLions, Siblings, WildLions } from './entities/npc/NpcRenderers';
import { PreyRenderer } from './entities/prey/PreyRenderer';
import { CameraRig } from './entities/player/CameraRig';
import { Player } from './entities/player/Player';
import { Atmosphere } from './world/Atmosphere';
import { Grass } from './world/Grass';
import { ObstacleColliders } from './world/ObstacleColliders';
import { PostFX } from './world/PostFX';
import { Terrain } from './world/Terrain';
import { Vegetation } from './world/Vegetation';
import { Water } from './world/Water';

/**
 * Lienzo 3D. Se vuelve a montar al cambiar el nivel de calidad (sombras, MSAA y
 * postprocesado requieren recrear el contexto o recompilar todos los materiales).
 */
export function GameCanvas() {
  const qualityLevel = useGame((s) => s.settings.quality);
  const quality = useQuality();
  const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);

  return (
    <Canvas
      key={qualityLevel}
      className="!absolute inset-0"
      dpr={dpr}
      shadows={quality.shadows ? 'soft' : false}
      camera={{ fov: 55, near: 0.3, far: 9000, position: [0, 50, 0] }}
      gl={{
        antialias: !quality.postprocessing,
        powerPreference: 'high-performance',
        stencil: false,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = 1;
      }}
    >
      <GameLoop />
      <AudioDriver />
      <Suspense fallback={null}>
        <Atmosphere />
        <Terrain />
        <Water />
        <Vegetation />
        <Grass />
      </Suspense>
      {/* La física (WASM de Rapier) carga de forma asíncrona: su propio Suspense evita bloquear el resto. */}
      <Suspense fallback={null}>
        <Physics timeStep="vary" gravity={[0, -9.81, 0]}>
          <ObstacleColliders />
          <Player />
          <Simulation />
          <MotherLion />
          <Siblings />
          <PrideLions />
          <WildLions />
          <PreyRenderer />
          <Hyenas />
          <Carcasses />
          <CameraRig />
        </Physics>
      </Suspense>
      <Suspense fallback={null}>
        <PostFX />
      </Suspense>
    </Canvas>
  );
}
