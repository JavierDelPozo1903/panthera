import { QUALITY_ORDER, QUALITY_PRESETS } from '../core/quality';
import { useGame } from '../core/store';

/** Ajustes compartidos por el menú principal y la pausa. */
export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const settings = useGame((s) => s.settings);
  const update = useGame((s) => s.updateSettings);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-[11px] uppercase tracking-[0.22em] text-sand/80">Calidad gráfica</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {QUALITY_ORDER.map((level) => {
            const preset = QUALITY_PRESETS[level];
            const selected = settings.quality === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => update({ quality: level })}
                className={`rounded-md border px-2 py-2 text-left transition ${
                  selected ? 'border-ochre bg-ochre/20 text-bone' : 'border-bone/15 bg-black/20 text-bone/70 hover:border-bone/40'
                }`}
                aria-pressed={selected}
              >
                <span className="block text-sm font-semibold">{preset.label}</span>
                {!compact && <span className="block text-[10px] leading-tight text-bone/50">{preset.hint}</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      {!compact && (
        <>
          <Slider
            label="Duración del día"
            value={settings.dayLengthMinutes}
            min={5}
            max={60}
            step={1}
            format={(v) => `${v} min reales`}
            onChange={(v) => update({ dayLengthMinutes: v })}
          />
          <div className="grid grid-cols-3 gap-4">
            <Slider
              label="Volumen"
              value={settings.masterVolume}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => update({ masterVolume: v })}
            />
            <Slider
              label="Música"
              value={settings.musicVolume}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => update({ musicVolume: v })}
            />
            <Slider
              label="Efectos"
              value={settings.sfxVolume}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => update({ sfxVolume: v })}
            />
          </div>
          <Slider
            label="Sensibilidad del ratón"
            value={settings.mouseSensitivity}
            min={0.3}
            max={2.5}
            step={0.05}
            format={(v) => `×${v.toFixed(2)}`}
            onChange={(v) => update({ mouseSensitivity: v })}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle label="Subtítulos de sonidos" checked={settings.subtitles} onChange={(v) => update({ subtitles: v })} />
            <Toggle label="Ayuda de controles" checked={settings.showHints} onChange={(v) => update({ showHints: v })} />
          </div>
        </>
      )}
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-[11px] uppercase tracking-[0.22em] text-sand/80">
        {props.label}
        <span className="normal-case tracking-normal text-bone/60">{props.format(props.value)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-ochre"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-bone/80">
      <input
        type="checkbox"
        className="h-4 w-4 accent-ochre"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}
