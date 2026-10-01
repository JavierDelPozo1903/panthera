/** Bus de eventos tipado. Desacopla la simulación de la interfaz y del audio. */

export type SoundName =
  | 'roar'
  | 'cubCall'
  | 'growl'
  | 'hyenaWhoop'
  | 'hyenaGiggle'
  | 'bite'
  | 'lap'
  | 'chew'
  | 'pounce'
  | 'milestone';

export interface GameEvents {
  /** Rugido del jugador (las manadas IA reaccionarán en la Fase 3). */
  'player:roar': { x: number; z: number };
  /** Llamada de auxilio del cachorro: la madre acude. */
  'player:call': { x: number; z: number };
  'player:died': { cause: string };
  /** Rugido de un león IA. */
  'npc:roar': { x: number; z: number; name: string };
  /** Efecto de sonido, posicional si lleva coordenadas. */
  sfx: { sound: SoundName; x?: number; y?: number; z?: number; volume?: number };
  /** Subtítulo de sonido o aviso breve (accesibilidad). */
  subtitle: { text: string; seconds?: number };
  /** Hito del diario de campo. */
  milestone: { id: string; text: string };
}

type Handler<T> = (payload: T) => void;

class EventBus<E> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) (handler as Handler<E[K]>)(payload);
  }
}

export const events = new EventBus<GameEvents>();
