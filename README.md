# Koi Pond

A full-screen, interactive koi pond rendered with **Three.js** and **WebGL**, viewed from above.

![Koi Pond](https://img.shields.io/badge/three.js-r160-0e6d72)

## Features

- **Living water** – a GPU height-field wave simulation drives real screen-space refraction,
  sun glints, sky/leaf reflections, foam rings and chromatic dispersion.
- **Pond bed** – baked sand, river pebbles and moss lit by animated caustics, dappled
  sunlight through leaves, ripple-focused light lines and lily-pad shadows.
- **Procedural 3D koi** – eyes, scales, gill plates, pectoral/pelvic/dorsal fins, barbels
  and a flowing translucent tail. Body, tail and fins are animated together in the vertex
  shader, and every fish is drawn with GPU instancing (one draw call per layer), so dozens of
  koi stay smooth.
- **Four varieties** – Kohaku, Showa, Golden Ogon and Platinum, with procedural patterns
  that are unique for every fish.
- **Behaviour** – each koi picks its own course, pace and depth, steers smoothly away from
  the edges, avoids other fish, darts away from touches and is swept along by the vortex.
- **Release koi** – tap a card to release a koi, or drag the card onto the water to place it
  exactly. The koi falls in with a splash, spray, a dent in the surface and outward ripples,
  then dives below.
- **Interactions** – touch or drag on the water for ripples, plus Rain, a draggable Vortex,
  Calm, Clear pond and Hide UI (for screen recording).
- **Web Audio soundscape** – splashes, soft musical water drops, an ambient water and
  swimming bed, rain and a swirling vortex, all synthesised in the browser. Sound fades in
  and out smoothly and pauses when the tab is hidden.
- **Responsive** – works on desktop and mobile (touch), with adaptive resolution.

## Run locally

It is a static site with no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly from the file system will not work because ES modules
require HTTP.)

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`4` | Release Kohaku / Showa / Golden Ogon / Platinum |
| `R` | Rain |
| `V` | Vortex |
| `C` | Calm |
| `M` | Sound |
| `H` | Hide / show UI (`Esc` also shows it) |

## Structure

```
index.html        markup, UI and import map
css/style.css     glass UI, responsive layout
js/main.js        app setup, render pipeline, interaction and UI wiring
js/water.js       height-field simulation + water surface shader
js/floor.js       pond bed (baked albedo + caustics lighting)
js/koi.js         koi geometry and shaders
js/fish.js        school simulation and instanced rendering
js/effects.js     splash droplets, lily pads and lotus flowers
js/audio.js       Web Audio soundscape
js/glsl.js        shared GLSL noise / caustic helpers
vendor/           three.js r160 (MIT)
```
