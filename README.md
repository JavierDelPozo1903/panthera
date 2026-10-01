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
| Y               | R3                  | Aliarse / aparearse / marcar territorio (contextual) |
| Clic / Clic D (o B) | —               | En pelea: zarpazo (encadena 4) / mordisco |
| Q · R · F · G   | —                   | En pelea: embestida · rugido aturdidor · desgarro · furia del rey |
| Tab / rueda     | —                   | Fijar objetivo                      |
| Espacio / Shift | —                   | En pelea: esquivar / bloquear (justo a tiempo: contragolpe) |
| 1               | —                   | Hojas medicinales                   |
| Z junto a una guarida | —             | Descansar: curarse y subir de nivel |
| Z               | Cruceta abajo       | Tumbarse a descansar                |
| J               | Cruceta arriba      | Diario de campo                     |
| M               | —                   | Mapa del territorio                 |
| V               | RB                  | Cámara documental                   |
| T (mantener)    | LT                  | Acelerar el tiempo ×120             |
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

### Territorios, peleas y descendencia (Fase 4)

- **Territorios**: tu manada natal y dos manadas rivales (1–2 machos residentes y 3 leonas cada
  una), más grupos de machos nómadas. Se dibujan en el minimapa y en el mapa completo (los rivales,
  cuando exploras su centro) junto a las marcas de olor.
- **Ciclo de vida del macho**: entre los 2 y los 4 años el padre te expulsa; al salir del territorio
  natal eres **nómada** y tus hermanos varones forman coalición contigo. Puedes proponer alianzas a
  otros nómadas (Y). Si entras en un territorio rival, el residente te advierte y, si no te vas,
  pelea. Vencer a todos los residentes con 3,5 años o más te convierte en **rey**; desde entonces
  llegan coaliciones nómadas a desafiarte. Los rugidos se cuentan: si sois más, la manada calla.
- **Combate por posturas** (G zarpazo, B mordisco, F amenaza): salud, aliento y moral para cada
  luchador; un zarpazo durante la preparación de un mordisco lo interrumpe. Huye alejándote.
- **Heridas localizadas** (cara, cuello, lomo, patas) que sangran, se curan más rápido descansando,
  pueden infectarse y, si fueron graves, dejan **cicatriz**. Las de las patas te ralentizan.
- **Reproducción**: celo, apareamiento (Y), gestación de ~110 días biológicos (menos de dos días de
  juego) y camadas de 1–4 cachorros que **heredan los rasgos** de sus padres (melena, tamaño,
  agresividad, pelaje). Como hembra, te apareas con los machos de tu manada; como rey, con tus leonas.
- **Legado**: al morir puedes continuar como un hermano superviviente o como un hijo o hija de dos
  años o más, que conserva sus rasgos heredados.

### Núcleo souls

- **Combate**: fijar objetivo, esquiva con invulnerabilidad, bloqueo con contragolpe perfecto, aguante,
  postura que se rompe y golpe de gracia, cadena de zarpazos y combos (zarpazo, zarpazo, mordisco:
  desgarro del cuello). Barra de habilidades estilo MOBA con recargas visibles.
- **Progresión**: la esencia del linaje se gana cazando, peleando, con hitos y jefes; se gasta en las
  guaridas para subir de nivel (atributos y habilidades con rangos I–III).
- **Muerte**: al caer se despierta en la última guarida y la esencia queda en el rastro; morir de viejo
  sigue llevando al modo legado.
- **Primer jefe**: La Matriarca, reina espectral de un clan de hienas, en un claro de la sabana (a partir
  de los 2 años). Dos fases, hienas espectrales, embestida, aullido del eclipse y paso de sombra.

`npm test` ejecuta simulaciones sin navegador (Vitest): detección de las presas y éxito de la caza
cooperativa (≈33 % de día y ≈65 % de noche sin luna con tres leonas), y la Fase 4 (herencia, heridas
y cicatrices, intrusión territorial, peleas, expulsión, conquista y camadas).

En desarrollo, `window.__panthera` expone utilidades de depuración (`startHunt()`, `hyenas3()`,
`fight(edad)`, `setAge(años)`, `toBoss()`, `milestone(id)`, territorios, leones ajenos y estado del jugador).

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
