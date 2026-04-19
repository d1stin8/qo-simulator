import { createSignal } from "solid-js";
import { LabCanvas } from "./components/LabCanvas";
import { useLab, type ComponentType } from "./store/LabStore";
import { Toolbar } from "./components/Toolbar";
import { ParamRail } from "./components/ParamRail";
import { runVqolTest } from "./engine/vqol/VqolComputeSandbox";

// Expose the WebGPU VQOL validation suite to the browser console globally
(window as any).runVqolTest = runVqolTest;

function App() {
  const { addComponent, state, loadState, setSimulationState, addSession, switchSession, renameSession } = useLab();
  const [editingComponentId, setEditingComponentId] = createSignal<string | null>(null);
  const [experimentName, setExperimentName] = createSignal("");

  const handleExport = () => {
    const activeComponents = state.sessions[state.activeSessionId].components;
    const dataStr = JSON.stringify(activeComponents, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    let name = experimentName().trim();
    if (!name) {
      const now = new Date();
      const datePart = now.toISOString().split('T')[0];
      const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '-').slice(0, 5); 
      name = `untitled_${datePart}_${timePart}`;
    }
    
    link.download = `${name}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const contents = e.target?.result as string;
        const components = JSON.parse(contents);
        if (Array.isArray(components)) {
          loadState(components);
        }
      } catch (err) {
        console.error("Failed to parse experiment file", err);
        alert("Invalid experiment file format.");
      }
    };
    reader.readAsText(file);
    target.value = '';
  };

  const handleDragStart = (e: DragEvent, type: ComponentType) => {
    e.dataTransfer?.setData("componentType", type);
  };

  return (
    <div style={{
      position: "relative",
      height: "100vh",
      width: "100vw",
      background: "var(--bg-canvas)",
      overflow: "hidden"
    }}>
      {/* Absolute Optical Canvas Layer */}
      <main style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, "z-index": 0 }}>
        <LabCanvas
          onDropComponent={addComponent}
          onOpenModal={setEditingComponentId}
        />
      </main>

      {/* Floating HUD: Header */}
      <header style={{
        position: "absolute",
        top: 0, left: 0, right: 0,
        height: "48px",
        background: "rgba(10, 10, 12, 0.7)",
        "backdrop-filter": "blur(8px)",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "0 16px",
        "border-bottom": "1px solid rgba(255,255,255,0.05)",
        "z-index": 10
      }}>
        <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
          <div style={{
            width: "24px",
            height: "24px",
            background: "var(--color-photon-cyan)",
            "border-radius": "2px"
          }} />
          <h1 style={{ "font-family": "var(--font-display)", "font-size": "16px", "font-weight": 600, color: "var(--text-primary)", "letter-spacing": "0.5px" }}>
            Quantum Optics Simulator
          </h1>
          <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)", margin: "0 8px" }} />
          <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
            <select 
              value={state.activeSessionId}
              onChange={(e) => switchSession(e.currentTarget.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                "font-family": "var(--font-mono)",
                "font-size": "13px",
                color: "var(--text-secondary)",
                cursor: "pointer"
              }}
            >
              {Object.values(state.sessions).map(session => (
                <option value={session.id}>{session.name}</option>
              ))}
            </select>
            <button 
              title="Rename Session"
              onClick={() => {
                const currentName = state.sessions[state.activeSessionId]?.name || "";
                const name = window.prompt("Rename Experiment:", currentName);
                if (name && name.trim()) {
                  renameSession(state.activeSessionId, name.trim());
                }
              }}
              style={{
                background: "transparent", 
                border: "none", 
                cursor: "pointer", 
                color: "var(--text-secondary)",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "margin-left": "4px",
                "margin-right": "8px"
              }}
            >
              ✎
            </button>
            <button 
              title="New Session"
              onClick={() => {
                const name = window.prompt("Enter Experiment Name", `Unnamed (${Object.keys(state.sessions).length + 1})`);
                if (name) addSession(name);
              }}
              style={{
                background: "transparent", 
                border: "1px solid rgba(255,255,255,0.1)", 
                "border-radius": "3px", 
                cursor: "pointer", 
                color: "var(--text-secondary)",
                width: "20px",
                height: "20px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "14px"
              }}
            >
              +
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <button style={{
            background: state.isRunning ? "#aa3333" : "var(--color-photon-cyan)",
            color: state.isRunning ? "#fff" : "var(--bg-surface)",
            border: "none",
            "border-radius": "4px",
            padding: "6px 20px",
            "font-family": "var(--font-body)",
            "font-weight": 600,
            "font-size": "13px",
            cursor: "pointer",
            transition: "opacity 0.1s"
          }} 
          onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"} 
          onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
          onClick={() => setSimulationState(!state.isRunning)}>
            {state.isRunning ? "Stop" : "Play"}
          </button>
          
          <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

          <input 
            type="text" 
            placeholder="Experiment Name..." 
            value={experimentName()}
            onInput={(e) => setExperimentName(e.currentTarget.value)}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              "border-radius": "4px",
              padding: "6px 12px",
              color: "var(--text-primary)",
              "font-family": "var(--font-body)",
              "font-size": "13px",
              width: "160px"
            }}
          />
          <label style={{
            background: "transparent",
            color: "var(--text-primary)",
            border: "1px solid rgba(255,255,255,0.1)",
            "border-radius": "4px",
            padding: "6px 16px",
            "font-family": "var(--font-body)",
            "font-weight": 500,
            "font-size": "13px",
            cursor: "pointer",
            transition: "background 0.1s"
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"} 
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            Import
            <input type="file" accept=".photon,.json" style={{ display: "none" }} onChange={handleImport} />
          </label>
          <button style={{
            background: "var(--text-primary)",
            color: "var(--bg-surface)",
            border: "none",
            "border-radius": "4px",
            padding: "6px 16px",
            "font-family": "var(--font-body)",
            "font-weight": 500,
            "font-size": "13px",
            cursor: "pointer",
            transition: "opacity 0.1s"
          }} onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"} onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
          onClick={handleExport}>
            Export
          </button>
          <button style={{
            background: "var(--color-quantum-violet)",
            color: "#ffffff",
            border: "none",
            "border-radius": "4px",
            padding: "6px 16px",
            "font-family": "var(--font-body)",
            "font-weight": 500,
            "font-size": "13px",
            cursor: "pointer",
            transition: "opacity 0.1s",
            "margin-left": "4px"
          }} onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"} onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
          onClick={() => {
            runVqolTest().then((res) => {
               if (res) alert("WebGPU Test complete! Check your developer console for the results.");
            }).catch(e => {
               alert("Error running WebGPU test. Open console for details.");
               console.error(e);
            });
          }}>
            Test Engine
          </button>
        </div>
      </header>

      {/* Floating HUD: Toolbar */}
      <div style={{ position: "absolute", top: "64px", left: "16px", "z-index": 10 }}>
        <Toolbar onDragStart={handleDragStart} />
      </div>

      {/* Floating HUD: Status Bar */}
      <footer id="status-bar" style={{
        position: "absolute",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(10, 10, 12, 0.8)",
        "backdrop-filter": "blur(8px)",
        "border-radius": "8px",
        border: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        "align-items": "center",
        padding: "8px 24px",
        "font-family": "var(--font-mono)",
        "font-size": "12px",
        color: "var(--text-secondary)",
        gap: "32px",
        "z-index": 10,
        "box-shadow": "0 4px 12px rgba(0,0,0,0.5)"
      }}>
        {(() => {
           const activeComps = state.sessions[state.activeSessionId]?.components || [];
           const laser = activeComps.find(c => c.type === "PUMP_LASER");
           return <span>λ: {(laser as any)?.props?.wavelength || 405}nm</span>;
        })()}
        <span>FPS: <span id="fps-counter" style={{ color: "var(--color-amber)" }}>--</span></span>
        <span id="coords-hud">X: 0.0mm | Y: 0.0mm</span>
      </footer>

      {/* Floating HUD: Live Multi-Detector Console */}
      <div style={{
        position: "absolute",
        bottom: "16px",
        right: "16px",
        background: "rgba(10, 10, 12, 0.8)",
        "backdrop-filter": "blur(8px)",
        "border-radius": "8px",
        border: "1px solid rgba(34, 211, 238, 0.2)",
        padding: "12px",
        "font-family": "var(--font-mono)",
        "font-size": "12px",
        color: "var(--color-photon-cyan)",
        "z-index": 10,
        "box-shadow": "0 4px 16px rgba(0,0,0,0.6)",
        "pointer-events": "none",
        "min-width": "160px"
      }}>
        <div style={{ "margin-bottom": "8px", "border-bottom": "1px solid rgba(34, 211, 238, 0.2)", "padding-bottom": "4px", "font-weight": "bold" }}>VQOL Analysis</div>
        {(() => {
           const activeComps = state.sessions[state.activeSessionId]?.components || [];
           const detectors = activeComps.filter(c => c.type === "SPAD_DETECTOR");
           if (detectors.length === 0) return <div style={{ color: "var(--text-secondary)" }}>0 detectors</div>;
           
           return detectors.map((d, i) => (
               <div style={{ display: "flex", "justify-content": "space-between", margin: "4px 0" }}>
                   <span style={{ color: "var(--text-secondary)" }}>D{i + 1} ({d.id.slice(-4)})</span>
                   <span>
                        {state.simulationStats?.[d.id] 
                            ? (state.simulationStats[d.id] > 99999 ? "∞ (Clamped)" : `${state.simulationStats[d.id].toLocaleString(undefined, {maximumFractionDigits: 0})} Hz`) 
                            : "0 Hz"}
                   </span>
               </div>
           ));
        })()}
      </div>

      {/* Floating HUD: Param Rail Modal */}
      <div style={{ position: "absolute", top: "64px", right: "16px", "z-index": 10, "max-height": "calc(100vh - 100px)", display: "flex" }}>
        <ParamRail componentId={editingComponentId()} onClose={() => setEditingComponentId(null)} />
      </div>
    </div>
  );
}

export default App;
