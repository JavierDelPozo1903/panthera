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
  /** Esencia del linaje ganada. */
  essence: { amount: number; reason: string };
  /** Golpe importante en combate (para el HUD): parada, rotura de postura, crítico. */
  'combat:feat': { text: string; kind: 'parry' | 'break' | 'critical' | 'combo' | 'dodge' };
  /** Aviso de un ataque fuerte de un jefe (texto a mano en las primeras veces). */
  'boss:telegraph': { text: string };
  /** Gran rótulo central: «LEYENDA ABATIDA», «HAS CAÍDO». */
  banner: { text: string; tone: 'victory' | 'death' | 'info'; seconds?: number };
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
