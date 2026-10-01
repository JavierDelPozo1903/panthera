import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useThree } from '@react-three/fiber';
import { useQuality } from '../core/store';

/**
 * Postprocesado cinematográfico: bloom del sol y las nubes encendidas, tone mapping AgX
 * (degradados de ocaso sin quemar a rojo) y una gradación de color con algo más de
 * saturación y contraste, al estilo de un documental de naturaleza.
 */
export function PostFX() {
  const quality = useQuality();
  // El MSAA pedido no puede superar el máximo de la GPU (si lo hace, el lienzo no arranca).
  const maxSamples = useThree((s) => s.gl.capabilities.maxSamples);
  const samples = Math.min(quality.multisampling, maxSamples);
  if (!quality.postprocessing) return null;

  if (quality.bloom) {
    return (
      <EffectComposer multisampling={samples}>
        <Bloom intensity={0.45} luminanceThreshold={0.95} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <HueSaturation saturation={0.12} />
        <BrightnessContrast contrast={0.1} />
        <Vignette offset={0.3} darkness={0.55} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={samples}>
      <ToneMapping mode={ToneMappingMode.AGX} />
      <HueSaturation saturation={0.12} />
      <BrightnessContrast contrast={0.1} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}
