import { useEffect, useRef, useState } from 'react';
import { clock, moonPhaseName } from '../core/clock';
import { events } from '../core/events';
import { input } from '../core/input';
import { perfStats } from '../core/perfStats';
import { useGame } from '../core/store';
import { player, type PlayerGait } from '../entities/player/playerState';
import { saturate } from '../core/math';
import {
  formatAge,
  lifePath,
  lifePathIndex,
  nextStage,
  stageAt,
  stageTitle,
} from '../systems/lifeStage';
import { useWorld } from '../core/store';
import { availableInteraction } from '../systems/interactions';
import { BIOMES } from '../world/biomes';
import { DangerVignette } from './hud/DangerVignette';
import { NeedsPanel } from './hud/NeedsPanel';
import { ObjectiveBanner } from './hud/ObjectiveBanner';
import { TakedownBar } from './hud/TakedownBar';
import { Toasts } from './hud/Toasts';
import { Minimap } from './Minimap';
import { useTicker } from './useTicker';

const GAIT_LABEL: Record<PlayerGait, string> = {
  idle: 'Quieto',
  walk: 'Al paso',
  trot: 'Al trote',
  run: 'A la carrera',
  stalk: 'Acechando',
  rest: 'Descansando',
  swim: 'Nadando',
  jump: 'Saltando',
  roar: 'Rugiendo',
  nurse: 'Mamando',
  drink: 'Bebiendo',
  eat: 'Comiendo',
  dead: 'Sin vida',
  fight: 'Peleando',
  mark: 'Marcando territorio',
};

/** Segundos sin actividad tras los que el HUD se atenúa. */
const IDLE_FADE_SECONDS = 7;

function readHud() {
  return {
    time: clock.formatTime(),
    day: clock.day + 1,
    year: clock.year + 1,
    season: clock.season,
    moonPhase: clock.moonPhase,
    night: clock.isNight,
    stamina: player.stamina,
    exhausted: player.exhausted,
    gait: player.gait,
    cover: player.cover,
    visibility: player.visibility,
    crouching: player.crouching,
    biome: player.biome,
    speedKmh: player.speed * 3.6,
    walkMode: player.walkMode,
    timeScale: clock.timeScale,
    ageYears: player.ageYears,
  };
}

export function HUD() {
  const documentary = useGame((s) => s.documentary);
  const showHints = useGame((s) => s.settings.showHints);
  const hud = useTicker(readHud, 10);
  const active = useActivity();

  if (documentary) return <DocumentaryOverlay />;

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-bone">
      <DangerVignette />
      <div className="absolute left-5 top-5 w-[20rem] space-y-2">
        <div className={`space-y-2 transition-opacity duration-1000 ${active ? 'opacity-100' : 'opacity-40'}`}>
          <ClockCard hud={hud} />
          <LifeCard ageYears={hud.ageYears} />
        </div>
        <ObjectiveBanner />
      </div>
      <div className={`transition-opacity duration-1000 ${active ? 'opacity-100' : 'opacity-40'}`}>
        <div className="absolute bottom-5 left-5 flex items-end gap-4">
          <Minimap />
          <div className="mb-1 w-52 space-y-1.5">
            <p className="font-serif text-lg italic leading-none text-sand">{BIOMES[hud.biome].label}</p>
            <p className="text-[11px] uppercase tracking-[0.2em] text-bone/70">
              {GAIT_LABEL[hud.gait]}
              {hud.speedKmh > 1 && <span className="ml-2 tabular-nums text-bone/50">{hud.speedKmh.toFixed(0)} km/h</span>}
            </p>
            <VisibilityMeter visibility={hud.visibility} crouching={hud.crouching} />
            <StaminaBar stamina={hud.stamina} exhausted={hud.exhausted} />
          </div>
        </div>
      </div>
      {hud.timeScale > 1 && (
        <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-umber/70 px-4 py-1 text-xs uppercase tracking-[0.25em] text-sand backdrop-blur">
          ▸▸ Tiempo acelerado ×{hud.timeScale}
        </div>
      )}
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
        <InteractionPrompt />
        <NeedsPanel />
      </div>
      <Toasts />
      <TakedownBar />
      {showHints && <ControlsHint />}
      <Subtitles />
      {import.meta.env.DEV && <FpsMonitor />}
    </div>
  );
}

/** Acción disponible con la tecla E. */
function InteractionPrompt() {
  const world = useWorld();
  const prompt = useTicker(() => {
    if (player.action) return { key: 'E', label: 'Parar', active: true };
    const i = availableInteraction(world);
    return i ? { key: 'E', label: i.label, active: false } : null;
  }, 8);
  if (!prompt) return <div className="h-7" />;
  return (
    <div className="flex h-7 items-center gap-2 rounded-full bg-black/55 px-3 text-sm text-bone backdrop-blur-sm animate-fadeIn">
      <kbd className="rounded bg-sand px-1.5 text-xs font-bold text-umber">{prompt.key}</kbd>
      {prompt.label}
    </div>
  );
}

/** Detecta actividad del jugador para desvanecer el HUD cuando no se usa. */
function useActivity(): boolean {
  const [active, setActive] = useState(true);
  const lastActive = useRef(performance.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      const busy =
        input.moveMagnitude > 0.1 || player.stamina < 0.999 || player.gait === 'roar' || clock.timeScale > 1;
      if (busy) lastActive.current = performance.now();
      setActive(performance.now() - lastActive.current < IDLE_FADE_SECONDS * 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  return active;
}

/** Etapa vital, edad y objetivo: el hilo del "camino al trono". */
function LifeCard({ ageYears }: { ageYears: number }) {
  const sex = useGame((s) => s.sex);
  const stageId = useGame((s) => s.lifeStage);
  const stage = stageAt(ageYears);
  const next = nextStage(stage);
  const progress = next ? saturate((ageYears - stage.fromYears) / (stage.toYears - stage.fromYears)) : 1;
  const path = lifePath(sex);
  const reached = lifePathIndex(stageId);

  return (
    <div className="rounded-lg bg-gradient-to-br from-umber/75 to-umber/40 px-4 py-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-xl leading-none">{stageTitle(stageId, sex)}</span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-bone/60">{formatAge(ageYears)}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-bone/10">
        <div className="h-full bg-gradient-to-r from-ochre to-sand" style={{ width: `${progress * 100}%` }} />
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] uppercase tracking-[0.12em]">
        {path.map((label, i) => (
          <li key={label} className="flex items-center gap-1 whitespace-nowrap">
            {i > 0 && <span className={`h-px w-2 ${i <= reached ? 'bg-ochre' : 'bg-bone/20'}`} />}
            <span className={i === reached ? 'text-sand' : i < reached ? 'text-ochre/80' : 'text-bone/35'}>
              {i === path.length - 1 && '♛ '}
              {label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ClockCard({ hud }: { hud: ReturnType<typeof readHud> }) {
  return (
    <div className="rounded-lg bg-gradient-to-br from-umber/75 to-umber/40 px-4 py-3 shadow-lg backdrop-blur-sm">
      <p className="font-serif text-[11px] uppercase tracking-title text-ochre">Panthera</p>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="font-serif text-3xl leading-none tabular-nums">{hud.time}</span>
        <span className="text-xs uppercase tracking-[0.18em] text-bone/70">Día {hud.day}</span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-bone/65">
        <span>{hud.season === 'dry' ? 'Estación seca' : 'Estación húmeda'}</span>
        <span className="h-3 w-px bg-bone/25" />
        <span className="flex items-center gap-1.5">
          <MoonIcon phase={hud.moonPhase} />
          {moonPhaseName(hud.moonPhase)}
        </span>
      </div>
    </div>
  );
}

/** Icono de fase lunar dibujado con SVG (terminador elíptico). */
function MoonIcon({ phase }: { phase: number }) {
  const r = 6;
  // k: posición del terminador de -1 (nueva) a 1 (llena).
  const k = Math.cos(phase * Math.PI * 2);
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const lit = '#f3ead7';
  const dark = '#3b2c20';
  // Semicírculo iluminado (derecha si crece, izquierda si mengua) cerrado por la elipse
  // del terminador, que resta luz en fase creciente/menguante y la suma en gibosa.
  const sweepHalf = waxing ? 1 : 0;
  const crescent = k > 0;
  const sweepTerminator = waxing === crescent ? 0 : 1;
  const d = `M ${r} 0 A ${r} ${r} 0 0 ${sweepHalf} ${r} ${2 * r} A ${rx} ${r} 0 0 ${sweepTerminator} ${r} 0 Z`;
  return (
    <svg width={2 * r} height={2 * r} viewBox={`0 0 ${2 * r} ${2 * r}`} aria-hidden>
      <circle cx={r} cy={r} r={r} fill={dark} />
      <path d={d} fill={lit} />
    </svg>
  );
}

/** Lo visible que eres para depredadores y presas (hierba, postura, movimiento). */
function VisibilityMeter({ visibility, crouching }: { visibility: number; crouching: boolean }) {
  const hidden = 1 - visibility;
  const label = visibility < 0.25 ? 'Oculto' : visibility < 0.6 ? 'Poco visible' : 'Expuesto';
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-bone/60">
      <div className="flex gap-0.5">
        {[0.15, 0.4, 0.6, 0.8].map((t) => (
          <span key={t} className={`h-2.5 w-1.5 rounded-sm ${hidden >= t ? 'bg-acacia' : 'bg-bone/15'}`} />
        ))}
      </div>
      <span>
        {label}
        {crouching && ' · agachado'}
      </span>
    </div>
  );
}

function StaminaBar({ stamina, exhausted }: { stamina: number; exhausted: boolean }) {
  const visible = stamina < 0.995;
  return (
    <div className={`pt-1 transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.2em] text-bone/70">
        <span>{exhausted ? 'Agotado' : 'Energía de sprint'}</span>
        <span className="tabular-nums">{Math.round(stamina * 100)} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-umber/70">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${exhausted ? 'bg-clay' : 'bg-gradient-to-r from-ochre to-sand'}`}
          style={{ width: `${stamina * 100}%` }}
        />
      </div>
    </div>
  );
}

const HINTS: [string, string][] = [
  ['WASD', 'Moverse'],
  ['Ratón', 'Cámara · rueda: zoom'],
  ['Shift', 'Sprint'],
  ['C', 'Agacharse / acechar'],
  ['X', 'Paso / trote'],
  ['Espacio', 'Saltar'],
  ['E', 'Mamar / beber / comer'],
  ['R', 'Rugir · de cachorro: llamar a mamá'],
  ['Z', 'Tumbarse a descansar'],
  ['J', 'Diario de campo'],
  ['M', 'Mapa del territorio'],
  ['V', 'Cámara documental'],
  ['T', 'Acelerar tiempo'],
  ['Esc', 'Pausa'],
  ['H', 'Ocultar ayuda'],
];

function ControlsHint() {
  return (
    <div className="absolute bottom-5 right-5 rounded-lg bg-umber/55 px-4 py-3 text-[11px] backdrop-blur-sm">
      <ul className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {HINTS.map(([key, label]) => (
          <li key={key} className="contents">
            <kbd className="rounded bg-bone/10 px-1.5 py-px text-center font-sans text-[10px] font-semibold text-sand">
              {key}
            </kbd>
            <span className="text-bone/75">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Subtitles() {
  const enabled = useGame((s) => s.settings.subtitles);
  const [line, setLine] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const off = events.on('subtitle', ({ text, seconds = 3 }) => {
      setLine({ text, id: performance.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLine(null), seconds * 1000);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  if (!enabled || !line) return null;
  return (
    <div
      key={line.id}
      className="absolute bottom-28 left-1/2 -translate-x-1/2 animate-fadeIn rounded bg-black/55 px-4 py-1.5 font-serif text-lg italic text-bone"
      role="status"
    >
      {line.text}
    </div>
  );
}

function FpsMonitor() {
  const stats = useTicker(() => ({ ...perfStats }), 2);
  const color = stats.fps >= 55 ? 'text-acacia' : stats.fps >= 30 ? 'text-ochre' : 'text-clay';
  return (
    <div className="absolute right-3 top-3 rounded bg-black/55 px-2 py-1 font-mono text-[10px] leading-tight text-bone/80">
      <span className={`font-semibold ${color}`}>{stats.fps.toFixed(0)} FPS</span> · {stats.frameMs.toFixed(1)} ms
      <br />
      {stats.drawCalls} draws · {(stats.triangles / 1000).toFixed(0)}k tris
    </div>
  );
}

function DocumentaryOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="absolute inset-x-0 top-0 h-[9vh] bg-black" />
      <div className="absolute inset-x-0 bottom-0 flex h-[9vh] items-center justify-center bg-black">
        <p className="font-serif text-sm italic tracking-wide text-bone/50">Modo documental · pulsa V para volver</p>
      </div>
    </div>
  );
}
