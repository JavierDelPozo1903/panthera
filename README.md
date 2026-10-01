# PANTHERA — La vida del león

Simulador 3D de vida en navegador: controlas a un león africano desde cachorro, junto a su madre,
hasta convertirte en **rey de la manada** (o **matriarca**, si eliges leona), en una sabana
procedural de 4×4 km con ciclo día/noche, estaciones y mecánicas basadas en la biología real.

## Ejecutar

Requiere Node 18+ (probado con Node 24).

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Otros scripts:

| Script              | Qué hace                                  |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Servidor de desarrollo con recarga (HMR)  |
| `npm run build`     | Comprobación de tipos + build de producción en `dist/` |
| `npm run preview`   | Sirve el build de producción              |
| `npm run typecheck` | Solo TypeScript                           |

## Controles

| Teclado / ratón | Mando (Gamepad API) | Acción                              |
| --------------- | ------------------- | ----------------------------------- |
| WASD / flechas  | Stick izquierdo     | Moverse (relativo a la cámara)      |
| Ratón (clic para capturar) o arrastrar | Stick derecho | Cámara                 |
| Rueda           | —                   | Zoom                                |
| Shift           | RT / L3             | Sprint (se agota en 8–12 s)         |
| C               | B                   | Agacharse / acechar                 |
| X               | LB                  | Alternar paso / trote               |
| Espacio         | A                   | Saltar                              |
| E               | X                   | Mamar / beber / comer (contextual)  |
| R               | Y                   | Rugir · de cachorro, llamar a mamá  |
| Z               | Cruceta abajo       | Tumbarse a descansar                |
| J               | Cruceta arriba      | Diario de campo                     |
| M               | —                   | Mapa del territorio                 |
| V               | RB                  | Cámara documental                   |
| T (mantener)    | LT                  | Acelerar el tiempo ×120             |
| Q / E           | —                   | Girar la cámara                     |
| Esc / P         | Start               | Pausa (ajustes, saltar etapa, salir)|
| H               | Select              | Mostrar/ocultar ayuda               |

## Estructura

```
src/
  core/      bucle del juego, simulación, reloj, entrada, eventos, guardado, calidad, estado
             global, flujo de partida (intro, muerte, legado) y audio (Howler + síntesis)
  world/     generación procedural (Web Worker), terreno con LOD, hierba, vegetación, agua,
             cielo propio con nubes, atmósfera, polvo, colisiones de obstáculos, madrigueras
  entities/  esqueleto estándar de cuadrúpedo, león, hiena, presas abatidas, jugador, cámara,
             agentes NPC (madre, hermanos, hienas) y su render
  ai/        madre, hermanos, clan de hienas, locomoción común y director de eventos
  systems/   necesidades, sigilo, interacciones, objetivos, diario de campo, etapas de vida
  ui/        HUD, minimapa, diario, intro, pantalla de muerte, menús
  data/      lion.json (constantes biológicas) y world.json (mundo y tiempo)
```

### La primera hora de vida (Fase 2)

Empiezas como cachorro de 10 semanas con tu madre y dos hermanos con nombre. Una cadena de
objetivos enseña las mecánicas mientras un **director de eventos** marca el ritmo:

1. Primeros pasos, mamar (E), emboscar a un hermano (C + Espacio) y siesta en familia (Z).
2. **La madre sale a cazar** y te deja escondido. Llega un **clan de hienas** que rastrea la
   madriguera: quédate quieto entre las rocas o la hierba alta; si te persiguen, llama a tu madre
   (R) y volverá a la carrera.
3. Vuelve con un impala: comes carne por primera vez.
4. **Traslado de la camada** a una nueva madriguera junto a una poza, donde bebes por primera vez.

### Juvenil y primera caza (Fase 3)

- **Presas** (`data/prey.json`): impala, cebra, ñu y facóquero, con modelos propios sobre el mismo
  esqueleto. Viven en 16 manadas que se simulan siempre (fuera de pantalla solo el centro de la
  manada) y se instancian al acercarte, con dos niveles de detalle de render.
- **Percepción de las presas**: vigilancia por turnos, campo visual con ángulo muerto, olfato según
  el **viento** (que rola a lo largo del día), luz y fase lunar. Alerta contagiosa y estampida con
  quiebros. Un león al descubierto es visto a 50–80 m; agachado en la hierba, con el viento de cara,
  puede llegar a 20–25 m.
- **Caza del jugador**: carga (Shift) desde muy cerca y, al alcanzar a la presa, **QTE de sujeción**
  (pulsar E). El peso que puedes derribar depende de tu madurez y de las leonas que te ayuden.
- **Manada**: dos tías y el macho residente (descansa aparte, ruge al anochecer y patrulla). De
  juvenil acompañas las **cacerías cooperativas** (centro y alas, acecho que se congela cuando las
  presas miran, carga de intercepción). Los adultos comen primero.
- **Mapa completo (M)** con niebla de guerra, avistamientos de manadas y hienas, y viento.

`npm test` ejecuta simulaciones sin navegador (Vitest) que comprueban la detección de las presas y
el éxito de la caza cooperativa: ≈33 % de día y ≈65 % de noche sin luna con tres leonas.

Si mueres (hienas, hambre o sed) verás el epílogo de tu vida y podrás **continuar como un hermano
superviviente** (modo legado). En desarrollo, `window.__panthera` expone utilidades de depuración
(`startHunt()`, `hyenas3()`, `milestone(id)`, estado del jugador y de la IA).

Decisiones de arquitectura relevantes:

- **Una sola fuente de verdad del terreno** (`WorldData`): el worker genera un heightmap de
  1025² muestras (4 m) + mapa de suelo/hierba + biomas. La CPU interpola con la misma
  triangulación que la malla (el león pisa exactamente lo que se ve) y los shaders de hierba
  y agua leen las mismas alturas desde una textura.
- **Estado de alta frecuencia fuera de React**: jugador, reloj, madre y cámara son objetos
  mutables; React (Zustand) solo gestiona fase, ajustes, etapa vital y escalón de crecimiento.
- **Terreno sin colisionador físico**: el suelo se resuelve analíticamente; Rapier se usa con
  un *character controller* contra troncos, rocas y chozas, que se crean y destruyen en
  streaming (3×3 chunks alrededor del jugador).
- **Modelo del león placeholder con contrato de sustitución**: esqueleto estándar de 23 huesos
  (`lionRig.ts`), torso con piel ponderada y animaciones horneadas como `AnimationClip`
  normales desde funciones de pose con IK de patas. Un `.glb` real con esos nombres de hueso
  puede sustituir la malla sin tocar la lógica.

## Rendimiento

Selector de calidad **Bajo / Medio / Alto / Ultra** (menú principal y pausa): controla DPR,
sombras (radio y resolución), número de briznas, distancias de LOD del terreno y la
vegetación, niebla, postprocesado, MSAA, polvo y estrellas. En desarrollo aparece un monitor
de FPS, draw calls y triángulos (esquina superior derecha).
