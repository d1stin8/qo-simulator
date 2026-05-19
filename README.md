# Quantum Optics Simulator

Reference: [Virtual Quantum Optics Laboratory](https://arxiv.org/pdf/2105.07300)

## Goal:
To create a virtual quantum optics laboratory, taking inspiration from the above paper to simulate or perform the experiments before doing them on the physical hardware as it is expensive to do so and takes too much time to do setups. If it is possible to simulate and reduce the time of doing the actual physical experiment and also for teaching purposes.


TODO:
1. I want to get all the optical equipments (as many as possible) to do simulations on them - So they can be objects with variable properites using the
   properties then it's easy to perform calculations
2. I'll also have to make it kind of like a game - I suppose its state changes according to what you put on the screen and then according to that state
   the calculations will be done and whatever is there is simulated
3. Next TODOS I will put once I'm done with these ones. But at the moment should I do it visually, or I suppose it's better to just use boxes and just names inside of them

# Design docs

## Vision

A precision scientific simulator for quantum and wave optical phenomena — built for researchers and advanced students. The interface draws from Palantir's data-dense surfaces, Apple's spatial refinement, and scientific instrumentation software. Nothing decorative competes with the simulation output.

---

## Design Principles

- **Physics first.** Parameters in SI units, visualisations matching physical conventions.
- **Immediate feedback.** No "Run" button — every control change propagates in real time.
- **Credible, not educational.** The UI should feel native to a researcher, not a student.
- **Dark canvas, light chrome.** Simulation viewport is always dark; surrounding UI is light and minimal.

---

## Visual Identity

| Token | Value |
|---|---|
| Display font | Syne (headings & data labels) |
| Mono font | DM Mono (parameters, units, code) |
| Body font | Inter Light |
| Primary accent | `#00C8D4` — Photon Cyan |
| Secondary accent | `#E8A020` — Amber |
| Tertiary accent | `#7C5CFC` — Quantum Violet |
| Canvas background | `#0A0A0F` |
| Surface background | `#F4F3EF` |

---

## Layout

```
┌─────────────────────────────────────────────┐
│  Titlebar  — module selector · export       │
├──────────────────────────────────┬──────────┤
│  Toolbar   — view modes · tools  │          │
├──────────────────────────────────┤  Param   │
│                                  │  Rail    │
│       Simulation Canvas          │          │
│         (WebGL2 / dark)          │  sliders │
│                                  │  fields  │
├──────────────────────────────────┤  toggles │
│  Status bar — λ · coords · fps   │          │
└──────────────────────────────────┴──────────┘
```

- Canvas is resizable; parameter rail collapses to icon strip.
- Hover anywhere on canvas → SI readout overlay (field, phase, intensity).
- Persistent measurement probes can be pinned to the canvas.

---

## Simulation Modules

| ID | Module | Tag |
|---|---|---|
| MOD-01 | Double Slit & N-Slit Interference | Core |
| MOD-02 | Gaussian Beam Propagation (ABCD) | Core |
| MOD-03 | Fabry-Pérot & Optical Cavities | Core |
| MOD-04 | Quantum State Visualiser (Wigner, Bloch) | Extended |
| MOD-05 | Polarisation & Jones / Mueller Calculus | Extended |
| MOD-06 | Cavity QED & Jaynes-Cummings | Research |
| MOD-07 | Hong-Ou-Mandel Two-Photon Interference | Research |
| MOD-08 | Diffraction Gratings (blazed, holographic) | Core |
| MOD-09 | Laser Rate Equations | Extended |
| MOD-10 | Thin Film Optics (transfer matrix) | Core |
| MOD-11 | Optical Tweezers | Research |
| MOD-12 | Spatial Mode Decomposition (HG, LG) | Extended |

---

## Physics Engine

**Wave layer** — Split-step Fourier (SSFM) for propagating fields; Crank-Nicholson FD for confined geometries.

**Quantum layer** — Schrödinger equation via 4th-order Runge-Kutta (closed systems); Lindblad master equation via vectorised superoperator (open systems). Optional quantum trajectory unravelling.

**Rendering** — WebGL2 fragment shaders (60 fps, GPU); WASM fallback (~15 fps, CPU); headless high-res pass for figure export (PNG, SVG) and data export (HDF5, NumPy).

---

## Key Interactions

- **Sliders** — logarithmic or linear scale, switchable; scroll-wheel fine-tuning.
- **Canvas gestures** — pan, zoom, rotate (3D modules); pinch on trackpad.
- **Scene graph** — drag-and-drop optical elements; import from Zemax / Oslo (planned).
- **Presets** — curated parameter sets for canonical textbook experiments, loadable in one click.
- **Export** — full-resolution figure + raw field data bundled as `.photon` project file.

---

## Performance Targets

| Metric | Target |
|---|---|
| Simulation frame rate | 60 fps (GPU) / 15 fps (CPU fallback) |
| UI input latency | ≤ 4 ms |
| Cold start to first frame | ≤ 1.5 s |
| Max Hilbert space dimension | 256 × 256 (density matrix) |

---

## Roadmap

1. **v1.0** — MOD-01 through MOD-05, WebGL2 renderer, parameter rail, export.
2. **v1.5** — Quantum modules (MOD-06, 07, 11), Bloch/Wigner visualisers, scene graph.
3. **v2.0** — Collaborative sessions, Python scripting API, Zemax import, mobile layout.