/**
 * Entrada unificada: teclado, ratón (pointer lock o arrastre) y mando (Gamepad API).
 * Se sondea una vez por frame desde el bucle del juego.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'jump'
  | 'roar'
  | 'rest'
  | 'walk'
  | 'camLeft'
  | 'camRight'
  | 'documentary'
  | 'timeFast'
  | 'pause'
  | 'hints'
  | 'interact'
  | 'journal'
  | 'map'
  | 'social'
  | 'attack'
  | 'heavy'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ability4'
  | 'lockOn'
  | 'dodge'
  | 'guard'
  | 'heal'
  | 'quests';

export const KEY_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC'],
  jump: ['Space'],
  roar: ['KeyR'],
  rest: ['KeyZ'],
  walk: ['KeyX'],
  // Q y E quedan para habilidades e interacción: la cámara se gira con el ratón.
  camLeft: [],
  camRight: [],
  documentary: ['KeyV'],
  timeFast: ['KeyT'],
  pause: ['Escape', 'KeyP'],
  hints: ['KeyH'],
  interact: ['KeyE'],
  journal: ['KeyJ'],
  map: ['KeyM'],
  social: ['KeyY'],
  // Combate souls (los botones del ratón llegan como Mouse0/1/2 con el puntero capturado).
  attack: ['Mouse0'],
  heavy: ['Mouse2', 'KeyB'],
  ability1: ['KeyQ'],
  ability2: ['KeyR'],
  ability3: ['KeyF'],
  ability4: ['KeyG'],
  lockOn: ['Tab', 'Mouse1'],
  dodge: ['Space'],
  guard: ['ShiftLeft', 'ShiftRight'],
  heal: ['Digit1'],
  quests: ['KeyK'],
};

/** Botones del mapeo estándar de la Gamepad API. */
const PAD_BINDINGS: Partial<Record<Action, number[]>> = {
  jump: [0], // A / Cruz
  crouch: [1], // B / Círculo
  interact: [2], // X / Cuadrado
  rest: [13], // Cruceta abajo
  journal: [12], // Cruceta arriba
  roar: [3], // Y / Triángulo
  walk: [4], // LB
  documentary: [5], // RB
  timeFast: [6], // LT
  sprint: [7, 10], // RT / L3
  pause: [9], // Start
  hints: [8], // Select
  social: [11], // R3
};

/**
 * Capa de combate del mando (al estilo souls): mientras hay pelea, los gatillos y la cruceta
 * pasan a atacar, bloquear y lanzar habilidades. Sustituye a la capa normal salvo en pausa.
 */
const PAD_COMBAT: Partial<Record<Action, number[]>> = {
  attack: [5], // RB
  heavy: [7], // RT
  guard: [4], // LB
  dodge: [1], // B / Círculo
  jump: [0], // A / Cruz
  heal: [2], // X / Cuadrado
  lockOn: [11], // R3
  ability1: [14], // Cruceta izquierda
  ability2: [12], // Cruceta arriba
  ability3: [15], // Cruceta derecha
  ability4: [13], // Cruceta abajo
  sprint: [10], // L3
  pause: [9],
  hints: [8],
};

/** Etiqueta del botón de mando de cada acción de combate (para la barra de habilidades). */
export const PAD_LABELS: Partial<Record<Action, string>> = {
  attack: 'RB',
  heavy: 'RT',
  guard: 'LB',
  dodge: 'B',
  heal: 'X',
  lockOn: 'R3',
  ability1: '◀',
  ability2: '▲',
  ability3: '▶',
  ability4: '▼',
};

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
const STICK_DEADZONE = 0.18;

const codeToActions = new Map<string, Action[]>();
for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
  for (const code of codes) {
    const list = codeToActions.get(code) ?? [];
    list.push(action);
    codeToActions.set(code, list);
  }
}

const deadzone = (v: number): number =>
  Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);

class InputManager {
  /** Vector de movimiento: x = derecha, z = adelante. Magnitud ≤ 1. */
  moveX = 0;
  moveZ = 0;
  moveMagnitude = 0;
  /** Última fuente de movimiento analógica (para elegir paso/trote). */
  analog = false;
  pointerLocked = false;
  /** Si el mando usa la capa de combate (lo fija el bucle del juego). */
  combatLayer = false;
  /** Último dispositivo usado: la interfaz muestra teclas o botones según este. */
  lastDevice: 'keyboard' | 'pad' = 'keyboard';

  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private padDown = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private padLookX = 0;
  private padLookY = 0;
  private dragging = false;

  /** Conecta los escuchadores al lienzo. Devuelve la función de limpieza. */
  attach(element: HTMLElement): () => void {
    const isFormField = (t: EventTarget | null): boolean =>
      t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormField(e.target)) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) for (const a of codeToActions.get(e.code) ?? []) this.pressed.add(a);
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => {
      this.keys.clear();
      this.dragging = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (this.pointerLocked) {
        // Con el puntero capturado, los botones del ratón son acciones de combate.
        const code = `Mouse${e.button}`;
        if (e.button === 1) e.preventDefault();
        for (const a of codeToActions.get(code) ?? []) this.pressed.add(a);
        this.keys.add(code);
        return;
      }
      if (e.button === 0 || e.button === 2) this.dragging = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      this.dragging = false;
      this.keys.delete(`Mouse${e.button}`);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (this.pointerLocked || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY);
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === element;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mousedown', onMouseDown);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onLockChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mousedown', onMouseDown);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }

  /** Sondea el mando y recalcula el vector de movimiento. Llamar una vez por frame. */
  update(): void {
    let kx = 0;
    let kz = 0;
    if (this.isKeyAction('forward')) kz += 1;
    if (this.isKeyAction('back')) kz -= 1;
    if (this.isKeyAction('right')) kx += 1;
    if (this.isKeyAction('left')) kx -= 1;

    let px = 0;
    let pz = 0;
    this.padLookX = 0;
    this.padLookY = 0;
    const pad = this.firstGamepad();
    const prevPad = new Set(this.padDown);
    this.padDown.clear();
    if (pad) {
      px = deadzone(pad.axes[0] ?? 0);
      pz = -deadzone(pad.axes[1] ?? 0);
      this.padLookX = deadzone(pad.axes[2] ?? 0);
      this.padLookY = deadzone(pad.axes[3] ?? 0);
      if (pad.buttons.some((b) => b.pressed) || Math.hypot(px, pz) > 0.3) this.lastDevice = 'pad';
      const layer = this.combatLayer ? PAD_COMBAT : PAD_BINDINGS;
      for (const [action, buttons] of Object.entries(layer) as [Action, number[]][]) {
        if (buttons.some((b) => pad.buttons[b]?.pressed)) {
          this.padDown.add(action);
          if (!prevPad.has(action)) this.pressed.add(action);
        }
      }
    }

    const keyMag = Math.hypot(kx, kz);
    if (keyMag > 0) {
      this.moveX = kx / keyMag;
      this.moveZ = kz / keyMag;
      this.moveMagnitude = 1;
      this.analog = false;
    } else {
      const mag = Math.min(1, Math.hypot(px, pz));
      this.moveX = mag > 0 ? px / Math.max(mag, 1e-6) : 0;
      this.moveZ = mag > 0 ? pz / Math.max(mag, 1e-6) : 0;
      this.moveMagnitude = mag;
      this.analog = mag > 0;
    }
  }

  isDown(action: Action): boolean {
    return this.isKeyAction(action) || this.padDown.has(action);
  }

  /** Devuelve true una sola vez por pulsación. */
  consume(action: Action): boolean {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** Desplazamiento de mirada acumulado (px de ratón + stick derecho escalado). */
  consumeLook(dt: number): { x: number; y: number } {
    const x = this.lookX + this.padLookX * 900 * dt;
    const y = this.lookY + this.padLookY * 600 * dt;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  /** Descarta pulsaciones pendientes (al cambiar de fase). */
  flush(): void {
    this.pressed.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
  }

  private isKeyAction(action: Action): boolean {
    for (const code of KEY_BINDINGS[action]) if (this.keys.has(code)) return true;
    return false;
  }

  private firstGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
    return null;
  }
}

export const input = new InputManager();
