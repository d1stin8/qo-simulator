// src/components/LabCanvas.tsx
import { onMount, onCleanup, createEffect, createSignal } from "solid-js";
import { Application, Container, Graphics, Rectangle, Assets, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { useLab, type OpticalComponent, type ComponentType } from "../store/LabStore";
import pumpLaserSvg from "../assets/components/pump_laser.svg";
import beamSplitterSvg from "../assets/components/beam_splitter.svg";
import waveplateSvg from "../assets/components/waveplate.svg";
import mirrorSvg from "../assets/components/mirror.svg";
import detectorSvg from "../assets/components/detector.svg";
import screenSvg from "../assets/components/screen.svg";
import defaultSvg from "../assets/components/default.svg";
import { calculateBeams, type BeamSegment } from "../engine/RayTracer";
import { wavelengthToColor } from "../engine/math";
import { OpticalSolver } from "../engine/solver/OpticalSolver";
import { computeScreenField } from "../engine/WaveEngine";

interface LabCanvasProps {
  onDropComponent: (comp: Omit<OpticalComponent, "id">) => string;
  onOpenModal: (id: string) => void;
}

export const LabCanvas = (props: LabCanvasProps) => {
  let canvasParent!: HTMLDivElement;
  const app = new Application();
  const { state, updateComponentPosition, updateSimulationStats } = useLab();

  // Per-screen fringe data, updated every tick, consumed by the HUD in the JSX return
  type FringeEntry = { intensities: Float32Array; wavelength: number; label: string };
  const [screenFringeData, setScreenFringeData] = createSignal<Record<string, FringeEntry>>({});

  // Scale: 40px = 25mm (Standard hole spacing)
  const MAJOR_STEP = 40;
  const MINOR_STEP = 8;

  // Real-world table dimensions: ~2.4m x 1.2m
  const TABLE_W = (2400 / 25) * MAJOR_STEP; // 3840 pixels
  const TABLE_H = (1200 / 25) * MAJOR_STEP; // 1920 pixels

  const pixiComponents = new Map<string, Sprite>();

  onMount(async () => {
    // 0. Initialize WebGPU Device for VQOL
    let gpuDevice: GPUDevice | null = null;
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (adapter) gpuDevice = await adapter.requestDevice();
    } catch (e) {
      console.warn("WebGPU not supported. Math Simulation disabled.");
    }

    await app.init({
      resizeTo: canvasParent,
      backgroundColor: 0x0a0a0c, // Dark room background
      antialias: true
    });
    
    await Assets.load([
      pumpLaserSvg,
      beamSplitterSvg,
      waveplateSvg,
      mirrorSvg,
      detectorSvg,
      screenSvg,
      defaultSvg
    ]);
    
    canvasParent.appendChild(app.canvas);

    const world = new Container();
    app.stage.addChild(world);
    world.x = app.screen.width / 2;
    world.y = app.screen.height / 2;

    // --- 1. FINITE OPTICAL TABLE ---
    const tableGraphics = new Graphics();
    tableGraphics.eventMode = 'static'; // Allow table to be clicked for panning
    tableGraphics.label = 'table';
    world.addChild(tableGraphics);

    const drawTable = () => {
      tableGraphics.clear();

      // Draw Table Base
      const halfW = TABLE_W / 2;
      const halfH = TABLE_H / 2;

      tableGraphics.rect(-halfW, -halfH, TABLE_W, TABLE_H).fill(0x020202).stroke({ width: 4, color: 0x111111 });

      const scale = world.scale.x;

      // Draw Grid (Only inside table bounds)
      if (scale > 0.5) {
        for (let x = -halfW; x <= halfW; x += MINOR_STEP) {
          tableGraphics.moveTo(x, -halfH).lineTo(x, halfH).stroke({ width: 1 / scale, color: 0x111111 });
        }
        for (let y = -halfH; y <= halfH; y += MINOR_STEP) {
          tableGraphics.moveTo(-halfW, y).lineTo(halfW, y).stroke({ width: 1 / scale, color: 0x111111 });
        }
      }

      for (let x = -halfW; x <= halfW; x += MAJOR_STEP) {
        tableGraphics.moveTo(x, -halfH).lineTo(x, halfH).stroke({ width: 1.5 / scale, color: 0x222222 });
        for (let y = -halfH; y <= halfH; y += MAJOR_STEP) {
          tableGraphics.circle(x, y, 2 / scale).fill({ color: 0x111111 });
        }
      }
      for (let y = -halfH; y <= halfH; y += MAJOR_STEP) {
        tableGraphics.moveTo(-halfW, y).lineTo(halfW, y).stroke({ width: 1.5 / scale, color: 0x222222 });
      }

      // Center Origin
      tableGraphics.moveTo(-halfW, 0).lineTo(halfW, 0).stroke({ width: 2 / scale, color: 0xaa3333, alpha: 0.6 });
      tableGraphics.moveTo(0, -halfH).lineTo(0, halfH).stroke({ width: 2 / scale, color: 0x33aa33, alpha: 0.6 });
    };

    let activeBeams: BeamSegment[] = [];

    const statLayer = new Container();
    world.addChild(statLayer);
    
    // Create a pool of Text objects to avoid memory thrashing ComponentID -> Text
    const statLabels = new Map<string, Text>();
    const statStyle = new TextStyle({
        fontFamily: 'monospace',
        fontSize: 16,
        fill: '#f0f0f0',
        stroke: { color: '#0a0a0c', width: 4 },
        fontWeight: 'bold',
        align: 'center'
    });

    // Draw once (since it's finite, we don't need to redraw on ticker, saving massive performance)
    drawTable();
    app.ticker.add(() => {
      // Just update line thickness based on zoom, instead of full redraw
      if (world.scale.x !== tableGraphics.scale.x) drawTable();
      
      const fpsEl = document.getElementById('fps-counter');
      if (fpsEl) fpsEl.innerText = Math.round(app.ticker.FPS).toString();

      if (state.isRunning) {
        // Core Game Loop: Math Update Step
        const rayResult = calculateBeams(state.sessions[state.activeSessionId]?.components as OpticalComponent[] || []);
        activeBeams = rayResult.segments;

        const { detectorStats, beamPowers } = OpticalSolver.solve(rayResult.opticalGraph);
        updateSimulationStats(detectorStats);

        // Compute fringe patterns for each screen and push to HUD signal
        const allComponents = state.sessions[state.activeSessionId]?.components || [];
        const screenComponents = allComponents.filter(c => c.type === "SCREEN");
        const newFringeData: Record<string, FringeEntry> = {};
        for (const sc of screenComponents) {
          const screenWidth = (sc as any).props?.width ?? 120;
          const angleRad = (sc.rotation * Math.PI) / 180;
          const { intensities, wavelength } = computeScreenField(
            activeBeams, sc.x, sc.y, angleRad, screenWidth
          );
          newFringeData[sc.id] = { intensities, wavelength, label: `SCR ${sc.id.slice(-4)}` };
        }
        setScreenFringeData(newFringeData);

        // Core Game Loop: Render Phase
        beamLayer.clear();
        const time = performance.now() / 1000; // seconds
        const speed = 250; // pixels per second
        const pulseLength = 10;
        const gap = 35;

        for (const beam of activeBeams) {
          // Skip beams carrying negligible power (e.g. the missing PBS arm)
          const solvedPower = beamPowers[beam.beamId];
          if (solvedPower !== undefined && solvedPower < 0.001) continue;
          const dx = beam.endX - beam.startX;
          const dy = beam.endY - beam.startY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const color = wavelengthToColor(beam.wavelength);
          
          let startOffset = (time * speed) % gap;

          for (let d = startOffset; d < dist; d += gap) {
            const pStart = d;
            const pEnd = Math.min(dist, d + pulseLength);
            if (pStart >= dist) break;

            const sx = beam.startX + (dx / dist) * pStart;
            const sy = beam.startY + (dy / dist) * pStart;
            const ex = beam.startX + (dx / dist) * pEnd;
            const ey = beam.startY + (dy / dist) * pEnd;

            // Outer glow body based on physics property
            beamLayer.moveTo(sx, sy).lineTo(ex, ey).stroke({ 
              width: 8, 
              color,
              alpha: Math.max(0.1, beam.power),
              cap: "round"
            });
            // Tight brilliant core
            beamLayer.moveTo(sx, sy).lineTo(ex, ey).stroke({ 
              width: 3, 
              color: 0xffffff,
              alpha: Math.max(0.2, beam.power),
              cap: "round"
            });
          }
        }

        // Draw Simulation Stats
        const activeComponents = state.sessions[state.activeSessionId]?.components || [];
        for (const comp of activeComponents) {
           const val = state.simulationStats?.[comp.id];
           if (comp.type === "SPAD_DETECTOR" || comp.type === "COINCIDENCE_UNIT") {
               let label = statLabels.get(comp.id);
               if (!label) {
                   label = new Text({ text: '', style: statStyle });
                   label.anchor.set(0.5, 1);
                   statLayer.addChild(label);
                   statLabels.set(comp.id, label);
               }
               label.x = comp.x;
               label.y = comp.y - 25; // Floating above the component
               
               let power = 0;
               if (val !== undefined) power = Math.max(0, val.power ?? 0);
               
               if (power < 0.01) {
                   label.text = "0.00 mW";
               } else {
                   label.text = `${power.toFixed(2)} mW`;
               }
               
               label.visible = true;
           } else {
               const label = statLabels.get(comp.id);
               if (label) label.visible = false;
           }
        }
      } else {
        beamLayer.clear();
        for (const label of statLabels.values()) {
            label.visible = false;
        }
      }
    });


    // --- 2. HUD (External) ---
    // The HUD is now rendered in the HTML footer via IDs 'coords-hud' and 'fps-counter'.

    // --- 3. INTERACTION LOGIC (The Fix) ---
    let isPanning = false;
    let draggedComponentId: string | null = null;
    let dragStart = { x: 0, y: 0 };
    let worldStart = { x: 0, y: 0 };

    canvasParent.addEventListener('contextmenu', e => e.preventDefault());
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-100000, -100000, 200000, 200000);

    app.stage.on('pointerdown', (e) => {
      // THE BULLETPROOF FIX: If the target has the 'component' label, completely ignore this event.
      if (e.target && e.target.label === 'component') return;

      if (e.button === 0 || e.button === 1 || e.button === 2) {
        isPanning = true;
        dragStart = { x: e.global.x, y: e.global.y };
        worldStart = { x: world.x, y: world.y };
        canvasParent.style.cursor = 'grabbing';
      }
    });

    app.stage.on('pointermove', (e) => {
      const worldX = (e.global.x - world.x) / world.scale.x;
      const worldY = -(e.global.y - world.y) / world.scale.y;
      const coordsEl = document.getElementById('coords-hud');
      if (coordsEl) coordsEl.innerText = `X: ${(worldX / MAJOR_STEP * 25).toFixed(1)}mm | Y: ${(worldY / MAJOR_STEP * 25).toFixed(1)}mm`;

      // Drag Component
      if (draggedComponentId) {
        // Enforce Table Boundaries
        let newWorldX = (e.global.x - world.x) / world.scale.x;
        let newWorldY = (e.global.y - world.y) / world.scale.y;

        newWorldX = Math.max(-TABLE_W / 2, Math.min(TABLE_W / 2, newWorldX));
        newWorldY = Math.max(-TABLE_H / 2, Math.min(TABLE_H / 2, newWorldY));

        const snappedX = Math.round(newWorldX / MAJOR_STEP) * MAJOR_STEP;
        const snappedY = Math.round(newWorldY / MAJOR_STEP) * MAJOR_STEP;

        updateComponentPosition(draggedComponentId, snappedX, snappedY);
        return;
      }

      // Pan Table
      if (isPanning) {
        world.x = worldStart.x + (e.global.x - dragStart.x);
        world.y = worldStart.y + (e.global.y - dragStart.y);
      }
    });

    const stopInteraction = () => {
      isPanning = false;
      draggedComponentId = null;
      canvasParent.style.cursor = 'default';
    };
    app.stage.on('pointerup', stopInteraction);
    app.stage.on('pointerupoutside', stopInteraction);

    canvasParent.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.pow(1.05, -e.deltaY / 100);
      const mouseWorldPos = {
        x: (e.clientX - canvasParent.getBoundingClientRect().left - world.x) / world.scale.x,
        y: (e.clientY - canvasParent.getBoundingClientRect().top - world.y) / world.scale.y
      };
      const newScale = Math.min(Math.max(world.scale.x * factor, 0.05), 3);
      world.scale.set(newScale);
      world.x = (e.clientX - canvasParent.getBoundingClientRect().left) - mouseWorldPos.x * newScale;
      world.y = (e.clientY - canvasParent.getBoundingClientRect().top) - mouseWorldPos.y * newScale;
    }, { passive: false });

    // --- 4. HTML DROP HANDLING ---
    // Layer order: table → statLayer → beamLayer → componentLayer
    const beamLayer = new Graphics();
    world.addChild(beamLayer);
    
    const componentLayer = new Container();
    world.addChild(componentLayer);

    canvasParent.addEventListener("dragover", (e) => e.preventDefault());

    canvasParent.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer?.getData("componentType") as ComponentType;
      if (!type) return;

      const rect = canvasParent.getBoundingClientRect();
      let dropWorldX = (e.clientX - rect.left - world.x) / world.scale.x;
      let dropWorldY = (e.clientY - rect.top - world.y) / world.scale.y;

      // Ensure dropped component stays within table boundaries
      dropWorldX = Math.max(-TABLE_W / 2, Math.min(TABLE_W / 2, dropWorldX));
      dropWorldY = Math.max(-TABLE_H / 2, Math.min(TABLE_H / 2, dropWorldY));

      let defaultProps: any = {};
      if (type === "PUMP_LASER") defaultProps = { wavelength: 405, power: 10, polarizationType: "H", polarizationAngle: 0, coherenceLength: 10 };
      if (type === "WAVEPLATE") defaultProps = { type: "HWP", fastAxisAngle: 0, retardance: Math.PI };
      if (type === "SPAD_DETECTOR") defaultProps = {};
      if (type === "BEAM_SPLITTER") defaultProps = { reflectivity: 0.5, phaseShiftReflect: Math.PI };
      if (type === "MIRROR") defaultProps = { reflectivity: 1.0 };
      if (type === "SCREEN") defaultProps = { width: 120 };

      const snappedX = Math.round(dropWorldX / MAJOR_STEP) * MAJOR_STEP;
      const snappedY = Math.round(dropWorldY / MAJOR_STEP) * MAJOR_STEP;

      const newId = props.onDropComponent({ type: type as any, x: snappedX, y: snappedY, rotation: 0, props: defaultProps });
      props.onOpenModal(newId);
    });

    // --- 5. RENDER COMPONENTS ---
    createEffect(() => {
      const activeComponents = state.sessions[state.activeSessionId]?.components || [];
      activeComponents.forEach((compData) => {
        let pixiObj = pixiComponents.get(compData.id);

        if (!pixiObj) {
          let texUrl = defaultSvg;
          if (compData.type === "PUMP_LASER") texUrl = pumpLaserSvg;
          if (compData.type === "BEAM_SPLITTER" || compData.type === "PBS") texUrl = beamSplitterSvg;
          if (compData.type === "WAVEPLATE") texUrl = waveplateSvg;
          if (compData.type === "MIRROR") texUrl = mirrorSvg;
          if (compData.type === "SPAD_DETECTOR" || compData.type === "COINCIDENCE_UNIT") texUrl = detectorSvg;
          if (compData.type === "SCREEN") texUrl = screenSvg;

          pixiObj = Sprite.from(texUrl);
          pixiObj.label = 'component'; // CRITICAL: This label stops the table from panning!
          pixiObj.anchor.set(0.5); // Center the sprite exactly
          // The SVGs are 100x100, we want them scaled to the grid sizing
          pixiObj.width = MAJOR_STEP;
          pixiObj.height = MAJOR_STEP;

          pixiObj.eventMode = 'static';

          pixiObj.on('pointerdown', (e) => {
            if (e.button !== 0) return;
            draggedComponentId = compData.id;
            canvasParent.style.cursor = 'grabbing';
          });

          let lastClick = 0;
          pixiObj.on('click', () => {
            const now = Date.now();
            if (now - lastClick < 300) props.onOpenModal(compData.id);
            lastClick = now;
          });

          componentLayer.addChild(pixiObj);
          pixiComponents.set(compData.id, pixiObj);
        }

        pixiObj.x = compData.x;
        pixiObj.y = compData.y;
        pixiObj.rotation = (compData.rotation * Math.PI) / 180;
      });

      for (const [id, pixiObj] of pixiComponents.entries()) {
        if (!activeComponents.find(c => c.id === id)) {
          pixiObj.destroy();
          pixiComponents.delete(id);
        }
      }
    });
  });

  onCleanup(() => app.destroy(true));

  // Draw fringe pattern onto a canvas element reactively
  const drawFringeCanvas = (canvas: HTMLCanvasElement, intensities: Float32Array, wavelength: number) => {
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#05051a';
    ctx.fillRect(0, 0, W, H);

    let maxI = 0;
    for (let i = 0; i < intensities.length; i++) if (intensities[i] > maxI) maxI = intensities[i];
    if (maxI === 0) return;

    // Wavelength → RGB tint
    const wl = wavelength;
    let r = 0, g = 0, b = 0;
    if      (wl >= 380 && wl <= 440) { r = -(wl-440)/(440-380); b = 1; }
    else if (wl >  440 && wl <= 490) { g = (wl-440)/(490-440); b = 1; }
    else if (wl >  490 && wl <= 510) { g = 1; b = -(wl-510)/(510-490); }
    else if (wl >  510 && wl <= 580) { r = (wl-510)/(580-510); g = 1; }
    else if (wl >  580 && wl <= 645) { r = 1; g = -(wl-645)/(645-580); }
    else if (wl >  645 && wl <= 780) { r = 1; }
    else { r = 0.8; g = 0.3; b = 1; } // UV / default

    const n = intensities.length;
    const barW = W / n;
    for (let i = 0; i < n; i++) {
      const norm = Math.pow(intensities[i] / maxI, 0.5);
      if (norm < 0.01) continue;
      const ri = Math.round(r * norm * 255);
      const gi = Math.round(g * norm * 255);
      const bi = Math.round(b * norm * 255);
      // vertical gradient: bright at centre, fades to edge (simulate finite aperture)
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0,   `rgba(${ri},${gi},${bi},0)`);
      grad.addColorStop(0.2, `rgba(${ri},${gi},${bi},${norm.toFixed(2)})`);
      grad.addColorStop(0.8, `rgba(${ri},${gi},${bi},${norm.toFixed(2)})`);
      grad.addColorStop(1,   `rgba(${ri},${gi},${bi},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW, 0, barW + 0.5, H);
    }
  };

  return (
    <>
      <div ref={canvasParent} style={{ width: "100%", height: "100%", overflow: "hidden" }} />

      {/* Screen HUD: one panel per SCREEN component */}
      {Object.keys(screenFringeData()).length > 0 && (
        <div style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
          "z-index": 10,
          "pointer-events": "none",
          "max-height": "80vh",
          "overflow-y": "auto"
        }}>
          {Object.entries(screenFringeData()).map(([id, entry]) => (
            <div style={{
              background: "rgba(5, 5, 26, 0.85)",
              "backdrop-filter": "blur(10px)",
              "border-radius": "8px",
              border: "1px solid rgba(99, 102, 241, 0.35)",
              padding: "10px 12px",
              "box-shadow": "0 4px 20px rgba(0,0,0,0.7)",
              "min-width": "260px"
            }}>
              <div style={{
                "margin-bottom": "6px",
                "padding-bottom": "4px",
                "border-bottom": "1px solid rgba(99,102,241,0.25)",
                "font-family": "var(--font-mono)",
                "font-size": "11px",
                "font-weight": "bold",
                color: "#a5b4fc",
                display: "flex",
                "align-items": "center",
                gap: "6px"
              }}>
                <span style={{ display: "inline-block", width: "8px", height: "8px", "border-radius": "50%", background: "#6366f1" }} />
                {entry.label} — Interference Pattern
              </div>
              <canvas
                width={256}
                height={80}
                style={{ width: "100%", height: "80px", "border-radius": "4px", display: "block" }}
                ref={(el) => {
                  // Reactively redraw whenever fringe data changes
                  createEffect(() => {
                    const d = screenFringeData()[id];
                    if (d && el) drawFringeCanvas(el, d.intensities, d.wavelength);
                  });
                }}
              />
              <div style={{
                "margin-top": "4px",
                "font-family": "var(--font-mono)",
                "font-size": "10px",
                color: "rgba(165,180,252,0.5)",
                "text-align": "center"
              }}>
                λ = {entry.wavelength} nm
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
