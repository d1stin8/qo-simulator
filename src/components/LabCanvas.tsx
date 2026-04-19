// src/components/LabCanvas.tsx
import { onMount, onCleanup, createEffect } from "solid-js";
import { Application, Container, Graphics, Rectangle, Assets, Sprite, Text, TextStyle } from "pixi.js";
import { useLab, type OpticalComponent, type ComponentType } from "../store/LabStore";
import pumpLaserSvg from "../assets/components/pump_laser.svg";
import beamSplitterSvg from "../assets/components/beam_splitter.svg";
import waveplateSvg from "../assets/components/waveplate.svg";
import mirrorSvg from "../assets/components/mirror.svg";
import detectorSvg from "../assets/components/detector.svg";
import defaultSvg from "../assets/components/default.svg";
import { calculateBeams, type BeamSegment } from "../engine/RayTracer";
import { wavelengthToColor } from "../engine/math";
import { VqolCompiler } from "../engine/vqol/VqolCompiler";

interface LabCanvasProps {
  onDropComponent: (comp: Omit<OpticalComponent, "id">) => string;
  onOpenModal: (id: string) => void;
}

export const LabCanvas = (props: LabCanvasProps) => {
  let canvasParent!: HTMLDivElement;
  const app = new Application();
  const { state, updateComponentPosition, updateSimulationStats } = useLab();

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
        // The rayResult.vqolGraph is passed to the WebGPU compiler.

        // Core Game Loop: Render Phase
        beamLayer.clear();
        const time = performance.now() / 1000; // seconds
        const speed = 250; // pixels per second
        const pulseLength = 10;
        const gap = 35;

        for (const beam of activeBeams) {
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
           if (val !== undefined && (comp.type === "SPAD_DETECTOR" || comp.type === "COINCIDENCE_UNIT")) {
               let label = statLabels.get(comp.id);
               if (!label) {
                   label = new Text({ text: '', style: statStyle });
                   label.anchor.set(0.5, 1);
                   statLayer.addChild(label);
                   statLabels.set(comp.id, label);
               }
               label.x = comp.x;
               label.y = comp.y - 25; // Floating above the component
               label.text = `${val.toLocaleString(undefined, {maximumFractionDigits: 0})} Hz`;
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

    // --- 1.5 ASYNC GPU SIMULATION LOOP ---
    let gpuProcessing = false;
    const SAMPLES_PER_TICK = 500000;
    
    const runGPU = async () => {
      if (!gpuDevice || !state.isRunning || gpuProcessing) {
        setTimeout(runGPU, 100);
        return;
      }
      
      gpuProcessing = true;
      try {
        const components = state.sessions[state.activeSessionId]?.components || [];
        const { vqolGraph } = calculateBeams(components as OpticalComponent[]);
        
        const runtimeStats = await VqolCompiler.compileAndRun(gpuDevice, vqolGraph, SAMPLES_PER_TICK);
        
        // Convert raw clicks into Clicks Per Second equivalent
        // 1 sample = 1 microsecond (per paper), so Clicks * (1,000,000 / SAMPLES_PER_TICK) = CPS
        const cpsMultiplier = 1000000 / SAMPLES_PER_TICK;
        const normalizedStats: Record<string, number> = {};
        for (const [id, clicks] of Object.entries(runtimeStats)) {
           normalizedStats[id] = clicks * cpsMultiplier;
        }
        
        updateSimulationStats(normalizedStats);
      } catch (e) {
        console.error("VQOL Processing Error:", e);
      }
      gpuProcessing = false;
      setTimeout(runGPU, 25);
    };
    
    // Start background GPU daemon
    runGPU();

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
      if (type === "PUMP_LASER") defaultProps = { wavelength: 405, power: 10, polarizationAngle: 0, coherenceLength: 10 };
      if (type === "WAVEPLATE") defaultProps = { type: "HWP", fastAxisAngle: 0, retardance: Math.PI };
      if (type === "SPAD_DETECTOR") defaultProps = { quantumEfficiency: 0.6, darkCountRate: 100, deadTime: 20 };

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
  return <div ref={canvasParent} style={{ width: "100%", height: "100%", overflow: "hidden" }} />;
};
