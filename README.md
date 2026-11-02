# Apex Drive

A browser 3D driving game: Three.js rendering, Rapier physics, a custom raycast-vehicle
handling model. Everything (cars, textures, track dressing, sound) is generated in code; there
are no downloaded assets.

**Status: complete (phases a–f).** 12 cars in 4 classes, 10 maps plus a test field with time of
day and weather, AI opponents on 3 difficulty levels, five game modes, a career with
championships, and an economy for buying and upgrading cars. On top of that: synthesised engine,
tyre and ambient sound, replays with TV-style cameras, tyre smoke and skid marks, touch controls,
and dynamic resolution. Every car and map is generated from a data file.

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Game modes

The game opens on a garage with your car on a turntable (drag to turn it). From there:

| Mode | What it is |
| --- | --- |
| Career | Five championships of 4–5 events each, with points (10-8-6-5-4-3-2-1), standings and a champion's prize. Finish a championship in the top 3 to unlock the next ones. Some events force night or weather. |
| Quick Race | Pick a map, laps, 1–7 opponents, AI difficulty, optional catch-up, time and weather. You start at the back. |
| Time Trial | Alone with the ghost of your personal best and a live delta. |
| Drift Challenge | 90 s to score (stages: one run). Points flow while sliding ≥ 12° above 30 km/h on the road; linked slides build a multiplier up to ×5; crashing or leaving the road loses the chain. |
| Free Roam | No clock. Isla Verano is built for it; [ / ] swaps between your own cars. |

Esc opens the pause menu (resume, restart, settings, retire). A results screen follows every
session with times or scores and the credits earned.

## AI opponents

* **Racing line:** computed per track by relaxing the centreline toward the straightest path
  within the road edges. AI cars swing wide on entry, clip the apex and run out wide.
* **Speed profile:** each car computes its own from its tyre grip on every surface (and in the
  current weather), with a braking curve limited by what its brakes can actually deliver.
* **Steering:** pure pursuit toward a point further ahead the faster it goes, plus a
  cross-track correction back to the line. That correction catches the slow drift wide in
  long, fast corners.
* **Throttle:** fed in on corner exit according to how much grip cornering is still using, and
  cut back when the car is already sliding.
* **Racecraft:** they follow slower cars, overtake when a car's width of road is free beside
  them, and give room to cars alongside. They also defend: with a faster car close behind
  before a corner, a driver may make one move to cover the inside, then return to the line
  before braking.
* **Personalities:** every driver name carries fixed traits, so a rival behaves the same way
  through a whole championship:
  * aggression (how readily they commit to a pass)
  * caution (how much grip they keep in hand when the weather takes it away)
  * consistency (mistake rate)
  * defending
* **Weather and roads:** in the wet or snow, drivers keep grip in reserve according to their
  caution, and make more mistakes. On narrow roads and loose surfaces everyone leaves extra
  margin. Changing the weather mid-session rebuilds their speed targets.
* **Damage:** with full damage on, a damaged AI car backs off by up to 18%.
* **Mistakes:** braking late, running wide or lifting, more often on lower difficulties and
  for inconsistent drivers.
* **Recovery:** they reset themselves when stuck, lost or facing the wrong way. After the
  finish they cruise, and stop before the end of a point-to-point stage.
* **Difficulty:**

  | Level | Grip used | Mistake chance per corner | AI car upgrades (career) |
  | --- | --- | --- | --- |
  | Easy | 84% | 12% | none |
  | Medium | 92% | 5% | level 1 |
  | Hard | 98.5% | 1.8% | level 2 |

* **Catch-up (off by default):** at most ±3.5% pace depending on the gap to you.

## Credits, cars and upgrades

You start with 20,000 credits and the Auren Pip. Races pay by distance, difficulty and finishing
position (career events pay more); drift runs pay by score; time trials pay per valid lap plus a
personal-best bonus.

In the garage you can buy any car, repaint the ones you own, and upgrade four parts three levels
each: engine, tyres, brakes, weight reduction. Prices scale with the car's class. The stat bars
show the real effect of upgrades on top speed and 0-100.

Quick Race opponents are cars of your class with a similar 0-100 time, upgraded to your car's
average level.

## Maps

All place names are fictional. Stages are point-to-point (one timed run); circuits are lapped.

| # | Map | Type | Length | Default conditions | Highlights |
| --- | --- | --- | --- | --- | --- |
| 1 | Col du Grisard | Alpine stage | 3.0 km | Clear, 11:30 | Stacked hairpins, 156 m climb, rock tunnel, snow patches on the road |
| 2 | Costa Brava Run | Coastal stage | 3.5 km | Clear, sunset | Cliff-top highway, sea below, rock gallery, armco |
| 3 | Neon Kowloon Loop | Street circuit | 2.7 km | Rain, 23:00 | 90° corners between walls, lit city blocks, neon reflections on wet roads |
| 4 | Red Mesa Stage | Desert rally stage | 2.7 km | Clear, 15:12 | Dirt between canyon walls, six jump crests, solid rocks |
| 5 | Kaldmark Forest | Forest rally stage | 2.5 km | Fog, 08:12 | 6.5 m gravel, mud patches, trees right at the edge (they're solid) |
| 6 | Harrow Park Circuit | Race circuit | 2.7 km | Clear, 15:00 | Kerbs, gravel traps, pit lane, grandstands, banked carousel |
| 7 | Dock 9 Drift Yard | Drift arena | 1.2 km | Clear, dusk | Painted course on open concrete, knock-over cones, container walls, hangars |
| 8 | Kagero Descent | Downhill touge | 2.1 km | Clear, 22:11 | 7 m road, 138 m descent, 16 m hairpins, guardrails, street lamps |
| 9 | Isla Verano | Open-world island | 5.6 km ring | Clear, 12:30 | Free roam anywhere, ramps, village, lighthouse, sea all round |
| 10 | Lake Vintermark | Ice circuit | 1.5 km | Clear, low winter sun | Groomed lake ice between snowbanks |
| – | Proving Ground | Test field | – | Clear, 13:00 | Every surface type, skidpad, jumps |

## Weather and time of day

* **L** cycles the time: map default, dawn, midday, sunset, night, or a full day/night cycle
  (24 h in 6 minutes).
* **O** cycles the weather: map default, clear, rain, fog, snow.

Lighting follows the sun's real position, so dawn and sunset get long shadows and orange light.
At night the moon takes over, stars come out, and lit windows, neon and street lamps switch on.
Car headlights come on at dusk and in heavy weather; brake lights glow when you brake.

Weather changes grip as well as looks. Rain makes asphalt slippery (74%) but barely affects
gravel; snow buries asphalt (58%); fog pulls visibility in to under 200 m. Wet roads go dark
and glossy, and snow whitens the ground and trees.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run preview    # serve the build
npm run test:physics   # headless handling test (0-100, top speed, braking, stability)
npm run test:tracks    # track geometry check (length, tightest corner, banking, self-proximity)
```

Needs a browser with WebGL 2 (current Chrome, Edge, Firefox, Safari 15+).

## Sound

All sound is synthesised live with the Web Audio API. It starts on your first click, key or tap,
because browsers block audio until then.

* **Engines.** The pitch is the firing frequency (rpm / 60 × cylinders / 2), so it follows the
  revs exactly. Each layout has its own harmonic recipe: a sub-harmonic burble for cross-plane
  V8s and the triple, a smooth upper series for the V12, a pulsing knock for the diesel. Load
  (throttle) drives a soft clipper and opens a filter, so a car sounds harsh on throttle and
  soft when coasting. You also get the rev-limiter stutter, turbo whistle and blow-off valve,
  overrun crackle, flat-shift cracks and gearbox whine (loud in reverse).
* **Tyres and road.** Squeal on tarmac when sliding, crunch on gravel and dirt, swish on grass,
  rumble strips on kerbs, road roar that rises with speed, and hiss on wet roads.
* **World.** Wind rises with speed. Rain adds ambience. Crashes scale with severity. The start
  lights beep.
* The camera is the listener. Your car and the three nearest cars are placed in 3D with
  Doppler shift, which makes trackside replay shots sound right.
* Settings → Sound has master, engine, effects and ambience volumes. Pausing mutes the cars.

## Replays

Every race, time trial and drift session is recorded at 20 Hz: every car's position, engine
and wheel state. The results screen sits over the replay, which plays on a loop behind it.
**Watch replay** opens it full screen:

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 5 s |
| C | Camera: director, trackside, helicopter, chase, hood, bumper |
| [ / ] | Follow another car |
| Esc | Back to the results |

The bar at the bottom also has restart, a seek slider and playback speed (¼× to 2×). The trackside
cameras are placed around each circuit on the outside of the bends. They are checked with ray
casts so they can see the road, and they zoom to keep the car the same size in frame. The director
mostly uses trackside shots and mixes in chase, helicopter and bumper shots.

## Mobile / touch

On phones and tablets (or once you touch a touch-screen laptop) on-screen controls appear while
driving:

* Drag sideways anywhere on the left half of the screen to steer. This is analogue, and centres
  on where your thumb lands.
* Gas and brake pedals on the right. Slide a thumb between them to switch. Handbrake above.
* Reset, camera and pause buttons sit under the minimap.

The HUD rearranges around them. Settings → Display → Touch controls forces them on or off.
Phones are best held in landscape.

## Graphics

* **Post-processing** (Medium and High): HDR rendering with MSAA, bloom on lamps, neon and
  headlights, and a colour grade with cool shadows, warm highlights, a vignette and fine grain.
  Extreme highlights (a spot light on a wet road) are clamped before the bloom.
* **Sky:** drifting procedural clouds, thicker when overcast and grey-blue at night. Cars
  reflect them.
* **Terrain:** the map palette is broken up with:
  * large-scale lighter, darker and dry patches
  * two scales of ground detail
  * rock on steep ground, textured from all three axes so cliffs don't stretch
  * a worn, ragged verge along the road
  * wet sand and lapping foam at the shoreline
* **Grass and flowers:** instanced tufts near the road on grass maps, swaying in the wind and
  shrinking away with distance (Medium and High). Dry tufts in the desert.
* **Trees:** tiered conifers, snow-capped pines, clustered broadleaf crowns, birches and
  bushes, palms with drooping fronds. Every tree is a slightly different green and sways in
  the wind. Rocks are lumpy, textured boulders.
* **Roads:**
  * wheel-track wear on roads, a rubbered-in line on circuits
  * repaired patches and tar-sealed cracks
  * a dusty edge on country roads
  * puddles that turn glossy in the rain
* **Water:** a glossy sea with three layers of drifting ripples, deeper in colour looking down
  and paler at a low angle.
* **Night:** the player's car has a real spot light. AI cars throw a pool of headlight on the
  road ahead.
* **Photo mode** (pause menu, or Photo in the replay viewer):
  * drag to orbit the car, wheel to zoom
  * field of view, exposure and roll
  * Save image downloads a PNG

## Trackside and landmarks

Dressing is chosen from the kind of venue, and everything is instanced:

* **Circuits:**
  * 300 / 200 / 100 m braking boards before the big stops
  * tyre walls on the outside of slow corners
  * orange marshal posts with flags
  * catch fencing along the walls
  * groups of spectators
* **Roads:**
  * reflector posts where there's no guardrail
  * yellow chevron boards on tight bends, pointing into the bend
  * telegraph poles with sagging wires
* **Rally stages:** chevrons, hay bales on the outside of corners, and spectators at the
  corners.

Each map also has its own set pieces:

| Map | Set pieces |
| --- | --- |
| Costa Brava Run | wind turbines on the hills (their rotors turn), fishing boats on the sea |
| Col du Grisard | a chapel on the pass, a radio mast |
| Dock 9 Drift Yard | two parked airliners, a radio mast |
| Red Mesa Stage | a natural rock arch, mesas on the horizon |
| Kaldmark Forest | log cabins and log piles |
| Kagero Descent | a red timber gate and stone lanterns |
| Isla Verano | beach umbrellas and bobbing boats |
| Lake Vintermark | cabins and a radio mast |

## Performance

* Three quality presets (G, or Settings): pixel ratio, shadows, fog distance, particles, grass,
  post-processing (off on Low).
* **Dynamic resolution** (on by default): if the frame rate stays under 50 fps, the render
  resolution drops in steps, down to 55%. It creeps back up once the frame rate is steady
  again. It resets when you leave a session.
* The expensive noise in the terrain, road and ground shaders is computed per vertex. Only
  fine detail is per pixel.
* Measured on the development machine with 8 cars, night, rain, effects and audio running:

  | Quality | Full frame (incl. GPU) | Resolution |
  | --- | --- | --- |
  | Low | 1.4 ms | 585×609 |
  | Medium | 4.4 ms | 781×813 |
  | High | 11.9 ms | 1562×1626 |

  Physics takes about 0.5 ms. High is meant for discrete GPUs. On a mid-range laptop use
  Medium; dynamic resolution handles the rest.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake; hold at a standstill to reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| Q / E | Shift down / up (manual gearbox) |
| T | Toggle automatic / manual |
| R | Reset onto the track (invalidates the current lap) |
| Backspace | Restart the session from the grid (repairs the car) |
| C | Camera: chase, far chase, hood, bumper |
| [ / ] | Previous / next of your cars (Free Roam) |
| V | Next paint colour |
| U / Y / I | Toggle ABS / traction control / steering assist |
| K | Damage: full / visual only / off |
| J | Ghost car on / off |
| L | Time of day / day-night cycle |
| O | Weather |
| G | Graphics quality (low / medium / high) |
| F3 or ` | Telemetry overlay (per-wheel load, slip, surface; live 0-100 and 100-0 timing) |
| H | Show / hide help |
| Esc / P | Pause menu |

In a replay: Space, ← →, C, [ ] and Esc (see Replays).

All driving keys can be rebound in Settings → Controls.

Gamepad (standard mapping): left stick steers, RT throttle, LT brake, A/B handbrake,
LB/RB shift, Y camera, X gearbox mode, View/Back reset, D-pad up restart, Start pause.
In menus: D-pad or stick to move, left/right to change a value, A to select, B to go back.
With a keyboard: arrows, Enter, Esc.

Settings, your profile (credits, cars, upgrades, career), best laps and ghosts persist in
`localStorage`. Settings → Progress resets the profile.

## HUD

The HUD shows:

* lap and position, current lap time, last and best lap
* colour-coded sector splits (green = faster than your best lap's sector)
* a live delta to your best lap (top centre)
* a heading-up minimap with the ghost
* speedometer, tachometer and gear
* a damage diagram (front / rear / left / right) and assist indicators

F3 adds physics telemetry.

Tyres leave skid marks on tarmac when they slide, and ruts on loose ground. They throw up smoke,
dust coloured by the surface, snow, or spray off a wet road. The camera shakes on impacts and
rumbles over rough ground.

## Cars

All brands and models are fictional. These figures are the stated stats; the measured
results from `npm run test:physics` land within ±3% (the Sandstorm's 0-100 within 5%).

| Class | Car | Drive | kW | kg | 0-100 km/h | Top km/h | Engine |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hatchback | Auren Pip | FWD | 55 | 960 | 11.8 s | 168 | I3 |
| Hatchback | Halden Kestrel S | FWD | 89 | 1120 | 8.6 s | 198 | I4 |
| Hatchback | Vireo Hex R | AWD | 192 | 1450 | 5.3 s | 245 | I4 turbo |
| Sports | Calder Lumen | RWD | 133 | 1020 | 6.1 s | 228 | I4, 8000 rpm, open roadster |
| Sports | Vantor Strada GT | RWD | 211 | 1380 | 5.2 s | 262 | flat-6 |
| Sports | Kyrin Aero GT | AWD | 305 | 1590 | 3.9 s | 290 | V6 twin-turbo, 7-speed |
| Muscle / Super | Brannock Hammer V8 | RWD | 229 | 1620 | 6.0 s | 235 | V8, 4-speed |
| Muscle / Super | Solvane Strix | RWD | 291 | 1420 | 4.0 s | 318 | V10, mid-engine |
| Muscle / Super | Vantor Ferox | AWD | 449 | 1640 | 2.9 s | 350 | V12 |
| Off-road / Rally | Korsa Ridgeback R | AWD | 188 | 1290 | 4.6 s | 205 | I4 turbo, gravel tyres |
| Off-road / Rally | Tessar Bison | AWD | 168 | 2180 | 8.6 s | 178 | I6 diesel |
| Off-road / Rally | Kyrin Sandstorm | RWD | 219 | 1780 | 6.2 s | 195 | V8, 44 cm travel |

Each car has its own body style and parts, rims, paint finish, 4 colours, a price (used by
the career mode in phase (e)) and engine-sound data (used by the audio in phase (f)).

## Adding a car

Append an object to `src/data/cars.js`. You state the performance; the game derives the
physics:

```js
{
  id: 'my_car', brand: 'Fictional', name: 'Model', class: 'sports',
  stats: { topSpeed: 240, zeroTo100: 5.8, mass: 1400, drivetrain: 'RWD', handling: 7, braking: 7 },
  layout: { length: 4.4, width: 1.85, wheelbase: 2.6, track: 1.58, wheelRadius: 0.33,
            wheelWidth: 0.24, cgHeight: 0.48, frontWeight: 0.52 },
  engine: { idleRpm: 900, redline: 7000, gears: 6, shiftTime: 0.15,
            curve: [[1000, 0.5], [3000, 0.85], [5000, 1.0], [7000, 0.85]] },
  suspension: { freqFront: 2.0, freqRear: 2.1, damping: 0.42, travel: 0.18,
                antiRollFront: 0.5, antiRollRear: 0.45 },
  tires: { type: 'sport' },            // road | sport | offroad
  aero: { downforce: 0.3 },
  body: { style: 'coupe', extras: ['spoiler'] },   // see cars/bodyShape.js and CarModel.js
  colors: ['#c0392b', '#ecf0f1', '#2c3e50'],
}
```

`CarSpec.js` calibrates gear ratios, peak torque and drag so the car hits `topSpeed` and
`zeroTo100` (it warns in the console if a 0-100 time is impossible for the car's traction).
Run `npm run test:physics` to see the measured numbers for every car. Optional knobs:
`layout.maxSteer` (degrees), `layout.frontOverhang`, `suspension.balance` (understeer bias,
default 1), `engine.awdFront` (AWD front torque share), `body.shape` (override any style value).

The visual model is generated from `body`:

* **`style`**: `hatch`, `sedan`, `coupe`, `muscle`, `super`, `rally`, `suv`, `roadster`
  (open top) or `pickup` (cab and bed). Presets live in `src/cars/bodyShape.js`.
* **`extras`**: `spoiler`, `wing`, `ducktail`, `roofSpoiler`, `splitter`, `diffuser`,
  `flares`, `sideIntakes`, `engineCover`, `scoop`, `roofScoop`, `roofVent`, `stripes`,
  `chromeBumpers`, `roundLights`, `rallyLights`, `lightBar`, `mudflaps`, `bullbar`,
  `roofRack`, `spare`, `bed`, `cage`, `sideExhaust`, `quadExhaust`.
* **`rims`**: `{ spokes, color, size }`, where `spokes: 0` gives a steel wheel with a hubcap.
* **`finish`**: `metallic`, `gloss` or `satin`.

Off-road tyres get knobbly tread automatically. Also give the car:

* `sound`: `{ layout, cylinders, turbo, rasp }`
* `price`
* `class`: one of the ids in `CLASSES`

Some 0-100 targets are physically impossible: a RWD car can't launch harder than its rear
tyres allow. In that case the calibration warns in the console and uses the quickest
achievable time instead.

## Adding a map

Each map is one file in `src/data/maps/`, registered in `src/data/maps/index.js` (which
documents every field). The centreline can be written three ways:

* **Raw points:** `[x, z, elevation, { width?, bank? }]` in driving order.
* **Turtle commands** (`turtle()` in `shapes.js`), best for stages:

  ```js
  const path = turtle({ x: 0, z: 0, y: 40, heading: 0 }, [
    ['s', 200, 9],            // straight 200 m, climbing 9 m
    ['r', 175, 24, 4],        // 175° right-hand hairpin, 24 m radius, climbing 4 m
    ['crest', 36, 3, 0],      // 36 m jump crest, 3 m high
    ['mark', 'tunnelIn'],     // remember this distance for tunnels / patches
    ['s', 240, 14],
  ]);
  ```

* **Corner polygons** (`roundedLoop()`), best for street circuits and arenas.

The main fields:

| Field | What it controls |
| --- | --- |
| `track.closed` | `false` makes a point-to-point stage; start and finish lines are placed automatically |
| `track.barrier` | `concrete`, `armco`, `snowbank` or `none` (or `{ L, R }` per side) |
| `track.surface`, `runoffSurface` | road and run-off surfaces (asphalt, dirt, gravel, mud, snow, lakeice …) |
| `track.patches` | surface patches on the road, e.g. `{ from, to, surface: 'snow', lat: [-1, 0.2] }` |
| `track.tunnels` | `[{ from, to }]`: tube, rock mass and portals are built automatically |
| `track.lines` | `edge`, `highway`, `centre` or `none` |
| `ground` | `{ type: 'flat', … }` for cities and arenas instead of generated terrain |
| `terrain` | `base` (`idw` follows the road's heights, `island`, `mean`), `palette`, `sides` (canyon walls / cliffs), `sea`, `snowLine` |
| `scenery` | trees (kinds: pine, snowpine, cedar, broad, birch, bush, palm, cactus, dead), rocks, `grass` (density, colour, flowers, dry), lamps, city blocks with neon, cones, grandstands, billboards |
| `landmarks` | set pieces placed along the track: `{ type, at (0..1 along the track), side, offset, count, spread }`. Types are turbine, chapel, plane, arch, mesa, cabin, logs, gate, lantern, umbrella, boat and radiomast |
| `trackside` | override the venue dressing: `{ kind: 'circuit' \| 'road' \| 'rally', poles, fence, spectators }` |
| `props` | placed objects: containers, hangars, tower, houses, lighthouse, ramps, huts, light masts |
| `environment` | `time`, sun `azimuth` and `maxElevation`, default `weather`, `fog`, `haze` |
| `maxOffTrack` | metres from the road before an automatic reset (rally stages) |

Then run `npm run test:tracks` (`--plot` draws ASCII layouts). It reports the tightest corner,
the elevation and grade range, and the closest approach between distant parts of the track.
It fails if barriers would overlap.

## Lap rules

* Progress is the along-track distance driven, and all 12 checkpoints must be passed in order.
* Stages are one timed run from the start gantry to the finish gantry; the HUD shows % complete.
* On rally stages, straying more than `maxOffTrack` from the road resets you after 1.5 s; on
  sea maps, driving into the water resets you after 1 s.
* Driving backwards subtracts progress and shows a WRONG WAY warning.
* Resetting onto the track (R) invalidates the lap: it still counts, but can't become a best lap.
* A new valid personal best replaces the stored ghost for that map and car.

## Damage

Impacts are measured from the horizontal velocity change the collision solver applies to the
car, so hard landings never count as crashes. Damage builds up per zone (front, rear, left,
right) and dents the body:

* Front damage costs engine power and adds drag.
* Side damage pulls the steering toward that side and reduces grip on that side.

Restart (Backspace) repairs the car. K switches between full damage, visual only, and off.

## Handling notes

* Weight transfer is physical: the centre of mass sits above four independent springs.
* Each tyre has a friction circle with longitudinal priority, so wheelspin and locked wheels
  cost cornering grip. That gives power oversteer on RWD, understeer on FWD, and handbrake
  turns.
* The front tyres are slightly more compliant than the rears (`suspension.balance`). Without
  that, identical tyres make every car exactly neutral-steer, and load transfer tips it into a
  spin on lift-off.
* Assists: ABS, traction control (keeps lateral headroom), steering assist (speed-sensitive
  lock, counter-steer, and unwinding input when the rear lets go). Turn traction control and the
  steering assist off for big drifts.

## Known limitations

* **Audio is synthesised, not sampled.** The engines are recognisably different and track the
  revs, but they sound electronic next to recordings. Laptop speakers lose most of the low V8
  and diesel burble.
* Only the four nearest cars have engine sound. There is no continuous scraping sound when
  sliding along a wall, only the impact thump.
* No music.
* Replays are kept only until you leave the results screen. They can't be saved, and free roam
  isn't recorded (it can run for hours and swaps cars mid-session). Recording stops after 20
  minutes.
* Replay skid marks and smoke are regenerated during playback. Seeking backwards leaves the
  marks from later in the replay on the ground.
* Trackside cameras can be blocked briefly by scenery without colliders, such as foliage, and
  on the tunnel sections of the mountain pass. On open stages the director favours chase and
  helicopter shots near the ends of the stage.
* Touch controls are digital pedals (no pressure). The menus work with taps but were designed
  for keyboard, mouse and gamepad first. Small portrait phones get a cramped HUD.
* Dynamic resolution reacts to the frame rate, so a 30 Hz display, or a browser capping
  background tabs, will drive it to its minimum.
* The AI follows precomputed racing lines. It is clean on circuits and asphalt roads. On
  Kaldmark Forest (a 6.5 m gravel road with solid trees at the edge) it still runs wide and
  hits trees several times per race.
* Grass, flowers and trackside dressing are visual only (no collision), except trees on the
  forest stage and the larger landmarks.
* At very low sun the bloom and grade can make headlights look strong in fog.
* Physics runs at a fixed 120 Hz. On very slow machines it drops simulation time rather than
  spiralling, so the game runs in slow motion instead of freezing.
* Requires WebGL 2. Gamepads use the browser's standard mapping only, and unusual pads may need
  remapping at the OS level.
