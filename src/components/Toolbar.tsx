import { type ComponentType } from "../store/LabStore";

interface ToolbarProps {
  onDragStart: (e: DragEvent, type: ComponentType) => void;
}

export function Toolbar(props: ToolbarProps) {
  const tools: { type: ComponentType; name: string; color: string; short: string }[] = [
    { type: "PUMP_LASER", name: "Laser", color: "var(--color-photon-cyan)", short: "LSR" },
    { type: "BEAM_SPLITTER", name: "Splitter", color: "#77ddd0", short: "BS" },
    { type: "PBS", name: "Polarizing BS", color: "#aaddff", short: "PBS" },
    { type: "WAVEPLATE", name: "Waveplate", color: "#3388ff", short: "WP" },
    { type: "MIRROR", name: "Mirror", color: "#cceeee", short: "MIR" },
    { type: "SPAD_DETECTOR", name: "Detector", color: "#ff8811", short: "DET" },
    { type: "SPDC_CRYSTAL", name: "SPDC Crystal", color: "var(--color-quantum-violet)", short: "NLO" },
  ];

  return (
    <div style={{
      width: "56px",
      background: "rgba(18, 20, 24, 0.8)",
      "backdrop-filter": "blur(12px)",
      border: "1px solid rgba(255,255,255,0.08)",
      "border-radius": "8px",
      "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      padding: "16px 0",
      gap: "12px",
      "overflow-y": "auto"
    }}>
      {tools.map((tool) => (
        <div
          draggable={true}
          onDragStart={(e) => props.onDragStart(e, tool.type)}
          title={tool.name}
          style={{
            width: "40px",
            height: "40px",
            cursor: "grab",
            "user-select": "none",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            "border-radius": "6px",
            "font-size": "11px",
            "font-weight": 600,
            color: tool.color,
            transition: "background 0.2s, transform 0.1s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          {tool.short}
        </div>
      ))}
    </div>
  );
}
