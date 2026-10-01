import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { director } from '../../ai/director';
import { atmosphere } from '../../world/atmosphereState';
import { useGame } from '../store';
import { audio } from './audioEngine';

/** Sincroniza el oyente con la cámara y la mezcla de ambiente con la hora y el peligro. */
export function AudioDriver() {
  const forward = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, dt) => {
    if (!audio.ready) return;
    camera.getWorldDirection(forward);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, forward.x, forward.y, forward.z);
    const { phase, settings } = useGame.getState();
    audio.updateMix(
      {
        day: atmosphere.day,
        night: atmosphere.night,
        golden: atmosphere.golden,
        danger: phase === 'playing' ? director.danger : 0,
        paused: phase === 'paused',
        inMenu: phase === 'menu' || phase === 'intro' || phase === 'dead',
        masterVolume: settings.masterVolume,
        musicVolume: settings.musicVolume,
        sfxVolume: settings.sfxVolume,
      },
      Math.min(dt, 0.1),
    );
  });
  return null;
}
