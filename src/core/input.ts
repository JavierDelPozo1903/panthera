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
  | 'swipe'
  | 'bite'
  | 'threat'
  | 'social';

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
  camLeft: ['KeyQ'],
  camRight: ['KeyE'],
  documentary: ['KeyV'],
  timeFast: ['KeyT'],
  pause: ['Escape', 'KeyP'],
  hints: ['KeyH'],
  interact: ['KeyE'],
  journal: ['KeyJ'],
  map: ['KeyM'],
  swipe: ['KeyG'],
  bite: ['KeyB'],
  threat: ['KeyF'],
  social: ['KeyY'],
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
  // En combate los botones frontales cambian de función (el controlador ignora los demás).
  swipe: [2], // X / Cuadrado
  bite: [1], // B / Círculo
  threat: [3], // Y / Triángulo
  social: [11], // R3
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
      if (!e.repeat) for (const a of codeToActions.get(e.code) ?? []) this.pressed.add(a);
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => {
      this.keys.clear();
      this.dragging = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    };
    const onMouseUp = () => {
      this.dragging = false;
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
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
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
