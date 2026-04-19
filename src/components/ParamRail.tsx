import { createMemo, Show } from "solid-js";
import { useLab } from "../store/LabStore";

interface Props {
  componentId: string | null;
  onClose: () => void;
}

export const ParamRail = (props: Props) => {
  const { state, updateComponentProperties, updateComponentRotation, removeComponent } = useLab();

  // Find the current component data
  const component = createMemo(() => {
    const session = state.sessions[state.activeSessionId];
    return session ? session.components.find((c) => c.id === props.componentId) : undefined;
  });

  const handlePropertyChange = (key: string, value: any, isNumeric = true) => {
    if (!props.componentId) return;
    const finalValue = isNumeric ? parseFloat(value) : value;
    if (isNumeric && isNaN(finalValue)) return; // Basic validation

    updateComponentProperties(props.componentId, { [key]: finalValue });
  };

  const handleDelete = () => {
    if (!props.componentId) return;
    removeComponent(props.componentId);
    props.onClose();
  };

  return (
    <div style={{
      width: "300px",
      background: "rgba(18, 20, 24, 0.8)",
      "backdrop-filter": "blur(12px)",
      "border": "1px solid rgba(255,255,255,0.08)",
      "border-radius": "8px",
      "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      "overflow-y": "auto",
      padding: "20px"
    }}>
      <Show when={component()} fallback={
        <div style={{ color: "var(--text-secondary)", "text-align": "center", "margin-top": "40px", "font-size": "13px" }}>
          Select a component on the canvas to edit its parameters.
        </div>
      }>
        {(comp) => (
          <>
            <header style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "24px", "align-items": "center" }}>
              <h2 style={{ margin: 0, "font-size": "16px", "font-weight": 600 }}>{comp().type.replace("_", " ")}</h2>
              <button onClick={props.onClose} style={{ 
                background: "none", 
                border: "none", 
                color: "var(--text-secondary)", 
                cursor: "pointer", 
                "font-size": "18px",
                "line-height": 1
              }}>&times;</button>
            </header>

            <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
              {/* Common Property: Rotation */}
              <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px", color: "var(--text-primary)" }}>
                <span style={{color: "var(--text-secondary)", "font-weight": 500}}>ROTATION (deg)</span>
                <input type="number" value={comp().rotation}
                  onInput={(e) => updateComponentRotation(comp().id, parseFloat(e.currentTarget.value))}
                  style={{ 
                    padding: "6px 8px", 
                    background: "#ffffff", 
                    border: "1px solid var(--border-color)", 
                    "border-radius": "4px",
                    "font-family": "var(--font-mono)",
                    "font-size": "13px"
                  }} />
              </label>

              <hr style={{ border: "0", "border-top": "1px solid var(--border-color)", margin: "8px 0" }} />

              <Show when={comp().type === "PUMP_LASER"}>
                <PropertyInput label="WAVELENGTH (nm)" value={(comp() as any).props.wavelength}
                  onUpdate={(v) => handlePropertyChange("wavelength", v)} />
                <PropertyInput label="POWER (mW)" value={(comp() as any).props.power}
                  onUpdate={(v) => handlePropertyChange("power", v)} />
              </Show>

              <Show when={comp().type === "WAVEPLATE"}>
                <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
                  <span style={{color: "var(--text-secondary)", "font-weight": 500}}>WP TYPE</span>
                  <select value={(comp() as any).props.type} onChange={(e) => handlePropertyChange("type", e.currentTarget.value, false)}
                    style={{ 
                      padding: "6px 8px", 
                      background: "#ffffff", 
                      border: "1px solid var(--border-color)", 
                      "border-radius": "4px",
                      "font-family": "var(--font-mono)",
                      "font-size": "13px"
                    }}>
                    <option value="HWP">HWP</option>
                    <option value="QWP">QWP</option>
                  </select>
                </label>
                <PropertyInput label="FAST AXIS (rad)" value={(comp() as any).props.fastAxisAngle}
                  onUpdate={(v) => handlePropertyChange("fastAxisAngle", v)} />
              </Show>
              
              <Show when={comp().type === "SPDC_CRYSTAL"}>
                <PropertyInput label="EFFICIENCY" value={(comp() as any).props.efficiency || 0}
                  onUpdate={(v) => handlePropertyChange("efficiency", v)} />
              </Show>

              <Show when={comp().type === "SPAD_DETECTOR"}>
                <PropertyInput label="EFFICIENCY" value={(comp() as any).props.quantumEfficiency || 0}
                  onUpdate={(v) => handlePropertyChange("quantumEfficiency", v)} />
                <PropertyInput label="DARK COUNT (Hz)" value={(comp() as any).props.darkCountRate || 0}
                  onUpdate={(v) => handlePropertyChange("darkCountRate", v)} />
              </Show>
            </div>

            <div style={{ "margin-top": "auto", "padding-top": "24px" }}>
              <button onClick={handleDelete} style={{ 
                width: "100%", 
                padding: "8px", 
                background: "#fff", 
                color: "#e53e3e", 
                border: "1px solid #fc8181", 
                "border-radius": "4px", 
                cursor: "pointer",
                "font-weight": 500,
                transition: "background 0.1s"
              }} onMouseEnter={(e) => e.currentTarget.style.background = "#fff5f5"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}>
                Remove Component
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

const PropertyInput = (props: { label: string; value: number; onUpdate: (value: string) => void }) => (
  <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
    <span style={{color: "var(--text-secondary)", "font-weight": 500}}>{props.label}</span>
    <input type="number" step="any" value={props.value}
      onInput={(e) => props.onUpdate(e.currentTarget.value)}
      style={{ 
        padding: "6px 8px", 
        background: "#ffffff", 
        border: "1px solid var(--border-color)", 
        "border-radius": "4px",
        "font-family": "var(--font-mono)",
        "font-size": "13px"
      }} />
  </label>
);
