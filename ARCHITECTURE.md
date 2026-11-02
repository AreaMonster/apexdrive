# Apex Drive – architecture

Browser 3D driving game. Three.js renders, Rapier (WASM, `rapier3d-compat`) handles rigid
bodies and collisions, and a custom raycast-vehicle model on top of Rapier produces the
handling. Vanilla ES modules, bundled by Vite. No external assets: geometry, textures and
audio are generated in code.

## Runtime flow

```
main.js ── WebGL check ── initPhysics() ── new Game() ── Menu (garage backdrop: Showroom)
Menu → Game.startEvent(cfg) → build map + player car → new Mode(cfg).start()
Game.frame (rAF), state 'driving'
  ├─ Input.poll()                  keyboard / gamepad → controls + one-shot actions
  ├─ fixed 120 Hz loop
  │    Mode.preStep()              AI drivers set their cars' controls
  │    Vehicle.preStep() × N       raycast suspension, tyre + drivetrain + aero forces → impulses
  │    PhysicsWorld.step()         Rapier integrates bodies, resolves collisions (car vs car too)
  │    Vehicle.postStep() × N      store state for interpolation, impact detection
  ├─ Mode.update()                 timing, positions, scoring; sets done when the session ends
  ├─ interpolate render transforms (smooth on any refresh rate)
  ├─ Environment, CameraRig, map visuals, HUD
  ├─ Effects (marks, smoke), Soundscape (listener on the camera, voices to the nearest cars)
  ├─ ReplayRecorder samples every car at 20 Hz
  └─ Renderer.render()   (+ dynamic resolution check)
Mode.finish() → result → Profile (credits, career points)
  → state 'replay': results over the looping replay (session kept alive)
      ReplayProxy.sample(t) → car models, Effects, Soundscape, ReplayCamera
  → leaving the results tears the session down → menus
```

Live cars and replay frames share one interface. A `ReplayProxy` looks like a `Vehicle` to
everything that only reads car state (pos, quat, vel, speed, drivetrain rpm / throttle / gear,
wheels' compression / steer / rotation / skid / surface / contact). Car models, audio voices,
tyre effects and camera rigs therefore work on replays unchanged.

## Audio (src/audio)

* `AudioEngine` owns the context, created on the first user gesture. It has a compressor on
  the master output and buses for engine, effects, ambient and UI. It also provides shared
  noise buffers and one-shots (crash, gear clunk, beeps, filtered bursts), and suspends when
  the tab is hidden.
* `CarVoice` is one car. A PeriodicWave oscillator runs at the firing frequency (harmonics per
  layout), plus a sub-harmonic oscillator. Both go through a soft clipper (driven by load) and
  a low-pass that opens with revs and load. Exhaust rasp is band-passed noise,
  amplitude-modulated by the firing oscillator. Turbo and gearbox whine are separate
  oscillators. Tyres and road are filtered white and brown noise per surface, with a square-wave
  chopper for kerbs. Two equal-power PannerNodes place it in 3D, and pitch gets a manual
  Doppler factor.
* `Soundscape` is a pool of four voices: the focus car plus the three nearest. Voices stay on
  cars that remain near, so they don't need retuning. It also handles wind on the focus car's
  speed and rain ambience, and drives the Web Audio listener from the camera.

## Replays, effects, touch

* `core/Replay.js`: `ReplayRecorder` stores 36 floats per car per frame in growable
  Float32Arrays (about 1.7 MB for a 2-minute, 5-car race). `ReplayProxy` interpolates position,
  slerps rotation and snaps discrete values (gear, surface).
* `core/ReplayCamera.js` places trackside camera spots every 110 m on the outside of bends.
  They are ray-cast against the physics world for ground height and line of sight, and pan
  and zoom (FOV from distance) to follow the car. Also a helicopter orbit, the `CameraRig`
  views, and a director.
* `fx/Effects.js` has two ring buffers, so cost is fixed however long the session. Skid marks
  are a dynamic mesh with vertex RGBA, uploading only the changed range. Particles are a
  `Points` ShaderMaterial (soft round puffs with fog support) for smoke, surface dust, snow
  and spray.
* `ui/TouchControls.js` uses multi-touch pointer events and feeds `Input.touch` and
  `Input.trigger()`. `ui/ReplayBar.js` is the replay transport bar.

## Vehicle model (src/physics)

* **Chassis**: one Rapier dynamic body with explicit mass, centre of mass and inertia
  (convex-hull collider with zero density). Weight transfer is not faked: it comes from the
  CoM height acting through four independent springs.
* **Suspension**: one ray per wheel. Spring rate is derived from a target natural frequency,
  dampers from a damping ratio (separate bump/rebound), anti-roll bars couple each axle.
* **Tyres**: lateral force from slip angle on a peak-then-fall curve (the drop after the
  peak is what lets a slide turn into a holdable drift). Longitudinal force from engine,
  brakes and rolling resistance. Both share one friction circle per wheel, with longitudinal
  priority, so wheelspin steals cornering grip (power oversteer on RWD, understeer on FWD).
  Grip = tyre μ × surface μ × tyre-compound modifier × weather × load sensitivity.
* **Drivetrain**: torque curve, gearbox, simulated clutch slip at launch, rev limiter,
  engine braking, auto/manual shifting, FWD/RWD/AWD torque split.
* **Calibration**: car data states *top speed* and *0-100 km/h*. `Calibration.js` derives
  the gear ratios, peak torque and drag coefficient that hit those numbers using a 1-D
  simulation that shares the same Drivetrain code. Upgrades are applied on top and the
  displayed stats are re-measured, so the garage numbers are always truthful.
* **Assists** (toggleable): ABS, traction control, counter-steer assist, speed-sensitive
  steering lock.

## Files

```
index.html
src/main.js                 bootstrap, WebGL / failure screens
src/styles.css
src/core/Game.js            state machine (menu / loading / driving / replay), fixed-step loop, events, cars
src/core/Profile.js         credits, owned cars, upgrades, paint, career progress (localStorage)
src/core/Renderer.js        WebGLRenderer, lights, sky (with clouds), quality presets, dynamic resolution
src/core/PostFX.js          HDR composer: highlight clamp, bloom, colour grade / vignette / grain, ACES output
src/core/CameraRig.js       chase / far / hood / bumper cameras, impact shake + surface rumble
src/core/Input.js           keyboard + gamepad + touch, rebindable bindings
src/core/Replay.js          replay recorder (20 Hz, all cars) + Vehicle-shaped playback proxy
src/core/ReplayCamera.js    trackside / helicopter / onboard replay cameras and director
src/core/Settings.js        localStorage persistence
src/core/Telemetry.js       0-100, braking distance, top-speed measurement
src/core/LapTimer.js        progress, checkpoints, sectors, wrong way, lap events
src/core/Ghost.js           ghost recording, delta-encoded storage, playback, live delta
src/core/Records.js         best laps + ghosts in localStorage (evicts old ghosts when full)
src/core/Environment.js     time of day + weather -> sky, sun/moon, fog, exposure, reflections
src/core/Precipitation.js   GPU rain streaks / snowflakes that follow the camera
src/physics/PhysicsWorld.js Rapier world, raycasts, static colliders, surface lookup
src/physics/Vehicle.js      raycast vehicle (suspension, tyres, aero, assists)
src/physics/Drivetrain.js   engine + gearbox
src/physics/TireModel.js    tyre force curves
src/physics/Calibration.js  stats → torque / drag / gearing; performance measurement
src/cars/CarSpec.js         car data + upgrades → physics spec
src/cars/bodyShape.js       body style presets shared by model and collider
src/cars/CarModel.js        procedural low-poly car mesh
src/data/cars.js            car definitions (data only)
src/data/surfaces.js        surface + tyre compound tables
src/data/maps/              one data file per map + index.js registry
src/data/maps/shapes.js     turtle(), roundedLoop(), islandHeight(), containerRing()
src/data/weather.js         weather presets (grip per surface, fog, particles) + time presets
src/data/career.js          championships (class, difficulty, events, prize, unlock rules)
src/data/economy.js         starting credits, prize formulas, upgrade prices, points
src/data/ai.js              AI difficulty presets, driver names
src/ai/RacingLine.js        racing line by relaxation + grip/brake-limited speed profile
src/ai/AIDriver.js          pure-pursuit steering, pedals, overtaking, mistakes, rubber-band, recovery
src/modes/Mode.js           base: countdown, extra cars, lifecycle
src/modes/RaceMode.js       AI field, positions, finish order + estimates, prizes, career points
src/modes/TimeTrialMode.js  laps against the personal-best ghost, records
src/modes/DriftMode.js      drift scoring (angle × speed, chains, multiplier)
src/modes/FreeRoamMode.js   no rules
src/maps/TrackSpline.js     centreline: arc-length samples, curvature, banking, nearest point
src/maps/TrackBuilder.js    layout (kerbs, gravel, barriers, pit) + road/apron/wall/terrain meshes and colliders
src/maps/Scenery.js         trees (tiered / clustered, per-instance tint), rocks, grandstands, pit building, gantry, billboards, horizon
src/maps/Nature.js          terrain shader, road wear shader, ground variation, wind sway, instanced grass, water
src/maps/Trackside.js       venue dressing: braking boards, tyre walls, marshals, catch fence, chevrons, delineators, poles, bales, spectators
src/maps/Landmarks.js       per-map set pieces (turbines, chapel, airliner, rock arch, cabins, gate, boats …)
src/maps/TrackMap.js        spline map: surfaceAt, reset pose, grid
src/maps/TestMap.js         flat proving ground with surface zones, ramps, cones
src/maps/textures.js        procedural canvas textures
src/maps/noise.js           seeded value noise / fbm
src/maps/dispose.js         frees a map's GPU resources
src/maps/Cones.js           knock-over traffic cones (dynamic bodies, instanced mesh)
src/ui/Hud.js               race panel, delta, banners, countdown, speedo/tacho, damage, debug
src/ui/Minimap.js           heading-up minimap (Path2D in world units), opponent dots
src/ui/Menu.js              main, garage, setup, career, settings (rebinding), pause, results
src/ui/Showroom.js          3D turntable scene behind the menus
src/ui/menu.css             menu styles
src/ui/TouchControls.js     on-screen steering, pedals, buttons for touch screens
src/ui/ReplayBar.js         replay transport bar (play, seek, speed, camera, car, photo)
src/ui/PhotoMode.js         free orbit camera, FOV / exposure / roll, PNG export
src/ui/theme.css            visual identity: condensed type, ink panels, signal-orange accent (loaded last)
src/audio/AudioEngine.js    Web Audio context, buses, compressor, one-shot sounds
src/audio/CarVoice.js       per-car engine / turbo / gearbox / tyre / road synthesis, 3D + Doppler
src/audio/Soundscape.js     voice pool for the nearest cars, listener, wind, rain
src/fx/Effects.js           skid marks / ruts and smoke / dust / spray particles
tools/physics-test.mjs      headless Node test: 0-100, top speed, braking, skidpad, rollover
tools/track-check.mjs       track geometry check
tools/browser-helpers.js    dev-only: start events with an AI driving the player, read status
```

## Environment (src/core)

`Environment` turns the map's settings plus the player's choices into a lighting state:

* **Sun:** rises at 6:00, peaks at the map's `maxElevation` at noon, and sets at 18:00, on the
  map's `azimuth`.
* **Sky, light, fog and exposure:** colours are keyframed by sun elevation (night, twilight,
  golden hour, day) and interpolated.
* **Night:** the key light swings to a dim blue moon, and the sky shader adds stars.
* **Weather:** greys the sky, dims the key light, pulls the fog in, adds rain or snow particles,
  and hands the vehicle a per-surface grip table.

The reflection map (PMREM) is rebuilt from the sky whenever conditions change, plus any props a
map adds (the neon city adds coloured panels). Maps expose `setWeather` (wet or snowy materials)
and `update(dt, night)` (windows, neon, street lamps).

## Tracks (src/maps)

A track is a list of control points:

* **`TrackSpline`** fits a centripetal Catmull-Rom curve and samples it about every 2 m. Each
  sample stores the horizontal tangent, the signed curvature (−d yaw / ds), the banking
  (curvature × gain, smoothed and clamped) and the half-width.
* **Nearest-point lookup:** a spatial hash gives `nearest(x, z)`. Passing the previous index
  as a hint keeps the lookup local, so a car is never snapped to a different part of the track
  that happens to be close by.
* **`TrackBuilder`** derives a per-sample layout, then builds every surface with one
  `ribbon()` helper. Physics uses the same triangles as the renderer:
  * the road (asphalt collider)
  * run-off aprons from the road edge to past the barrier, with surface `auto`, which
    `surfaceAt` resolves to grass or gravel
  * raised kerb strips with their own `kerb` collider
  * the walls, pit lane and pit wall
  * the terrain: a grid of 6 m or coarser (capped near 90k vertices), flat under the aprons
    (sunk 25 cm) and blending into the map's landform (fractal hills, canyon walls, cliffs, island)

## Build phases

a) driving feel on a flat test map ✓
b) one full spline-generated map + HUD + laps/checkpoints ✓ (plus ghost and collision damage)
c) all 12 cars ✓ (4 classes, calibrated and stability-tested)
d) all 10 maps, weather, day/night ✓
e) AI + game modes + career/economy ✓
f) audio, replays, effects, touch controls, dynamic resolution ✓
g) AI racecraft and personalities, post-processing, map art pass, trackside dressing,
   landmarks, photo mode, UI redesign ✓
