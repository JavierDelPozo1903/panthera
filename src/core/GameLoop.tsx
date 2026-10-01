import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { player } from '../entities/player/playerState';
import { director } from '../ai/director';
import { advanceAge } from '../systems/aging';
import { sharedUniforms } from '../world/atmosphereState';
import { clock, FAST_FORWARD_MULTIPLIER } from './clock';
import { finishIntro, pauseGame, registerCanvas, requestPointerLock, resumeGame, saveNow } from './gameFlow';
import { installDebugHooks } from './debug';
import { input } from './input';
import { perfStats } from './perfStats';
import { useGame } from './store';
import { combat } from '../systems/combat';

const AUTOSAVE_SECONDS = 30;

/**
 * Primer paso de cada frame: entrada, reloj de simulación, atajos globales y autoguardado.
 * Prioridad −50: se ejecuta antes que jugador (−40), cámara (−30) y atmósfera (−20).
 */
export function GameLoop() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const state = useMemo(() => ({ autosave: AUTOSAVE_SECONDS, perfTimer: 0, frames: 0, wasLocked: false }), []);

  useEffect(() => {
    // Se reinicia manualmente al inicio de cada frame para contar también los pases de postprocesado.
    gl.info.autoReset = false;
    installDebugHooks(get);
  }, [gl, get]);

  useEffect(() => {
    const el = gl.domElement;
    const detach = input.attach(el);
    registerCanvas(el);
    const onPointerDown = () => {
      if (useGame.getState().phase === 'playing') requestPointerLock();
    };
    // Si el navegador libera el puntero (Esc), se pausa la partida.
    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      if (state.wasLocked && !locked) pauseGame();
      state.wasLocked = locked;
    };
    el.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      detach();
      registerCanvas(null);
      el.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, [gl, state]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    input.update();
    sharedUniforms.uTime.value += dt;

    const game = useGame.getState();
    if (game.phase === 'playing') {
      if (input.consume('pause')) {
        if (game.mapOpen) useGame.setState({ mapOpen: false });
        else if (game.journalOpen) useGame.setState({ journalOpen: false });
        else pauseGame();
      }
      if (input.consume('documentary')) game.toggleDocumentary();
      if (input.consume('hints')) game.updateSettings({ showHints: !game.settings.showHints });
      if (input.consume('journal')) useGame.setState({ journalOpen: !game.journalOpen, mapOpen: false });
      if (input.consume('map')) useGame.setState({ mapOpen: !game.mapOpen, journalOpen: false });
      clock.dayLengthMinutes = game.settings.dayLengthMinutes;
      // El tiempo acelerado se corta si hay peligro.
      clock.timeScale = input.isDown('timeFast') && director.danger < 0.4 && !combat.active && player.alive ? FAST_FORWARD_MULTIPLIER : 1;
      const before = clock.totalDays;
      clock.advance(dt);
      advanceAge(clock.totalDays - before);

      state.autosave -= dt;
      if (state.autosave <= 0) {
        state.autosave = AUTOSAVE_SECONDS;
        void saveNow();
      }
    } else if (game.phase === 'paused') {
      if (input.consume('pause')) resumeGame();
    } else if (game.phase === 'intro') {
      clock.timeScale = 1;
      clock.advance(dt);
      if (input.consume('pause') || input.consume('jump') || input.consume('interact')) finishIntro();
    } else if (game.phase === 'menu') {
      // El amanecer del menú avanza muy despacio.
      clock.timeScale = 1;
      clock.advance(dt * 0.15);
    }

    // Estadísticas de rendimiento (monitor de FPS) del frame anterior completo.
    state.frames++;
    state.perfTimer += rawDt;
    if (state.perfTimer >= 0.5) {
      perfStats.fps = state.frames / state.perfTimer;
      perfStats.frameMs = (state.perfTimer / state.frames) * 1000;
      perfStats.drawCalls = gl.info.render.calls;
      perfStats.triangles = gl.info.render.triangles;
      state.frames = 0;
      state.perfTimer = 0;
    }
    gl.info.reset();
  }, -50);

  return null;
}
