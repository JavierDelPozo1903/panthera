import { useEffect, useState } from 'react';
import { audio } from './core/audio/audioEngine';
import { prepareMenu } from './core/gameFlow';
import { loadGame, loadSettings, saveSettings } from './core/save';
import { DEFAULT_SETTINGS, useGame } from './core/store';
import { GameCanvas } from './GameCanvas';
import { DeathScreen } from './ui/DeathScreen';
import { FullMap } from './ui/FullMap';
import { HUD } from './ui/HUD';
import { IntroOverlay } from './ui/IntroOverlay';
import { JournalPanel } from './ui/JournalPanel';
import { LoadingScreen } from './ui/LoadingScreen';
import { MainMenu } from './ui/MainMenu';
import { PauseMenu } from './ui/PauseMenu';
import { generateWorldAsync, WORLD_CONFIG } from './world/generateWorldAsync';

export default function App() {
  const phase = useGame((s) => s.phase);
  const world = useGame((s) => s.world);
  const [error, setError] = useState<string | null>(null);

  // Arranque: ajustes guardados → generación del mundo en el worker → menú.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSettings();
      if (stored) useGame.getState().updateSettings({ ...DEFAULT_SETTINGS, ...stored });
      try {
        const generated = await generateWorldAsync((f) => useGame.getState().setLoadingProgress(f));
        if (cancelled) return;
        useGame.getState().setWorld(generated);
        useGame.getState().setHasSave((await loadGame(WORLD_CONFIG.seed)) !== null);
        prepareMenu();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // El audio solo puede arrancar tras un gesto del usuario (política de autoplay).
  useEffect(() => {
    const unlock = () => void audio.init();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Persistencia de ajustes.
  useEffect(() => useGame.subscribe((s, prev) => s.settings !== prev.settings && void saveSettings(s.settings)), []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-night">
      {world && <GameCanvas />}
      {phase === 'loading' && <LoadingScreen error={error} />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'intro' && <IntroOverlay />}
      {(phase === 'playing' || phase === 'paused') && <HUD />}
      {phase === 'playing' && <JournalPanel />}
      {phase === 'playing' && <FullMap />}
      {phase === 'paused' && <PauseMenu />}
      {phase === 'dead' && <DeathScreen />}
    </div>
  );
}
