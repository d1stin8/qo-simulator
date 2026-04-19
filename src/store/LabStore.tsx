import { createContext, useContext, createEffect, type JSX } from "solid-js";
import { createStore } from "solid-js/store";

// Types
export type ComponentType =
  'PUMP_LASER' |
  'BEAM_SPLITTER' |
  'SPDC_CRYSTAL' |
  'PBS' |
  'WAVEPLATE' |
  'PHASE_SHIFTER' |
  'MIRROR' |
  'SPAD_DETECTOR' |
  'COINCIDENCE_UNIT';

// Physics properites interfaces
export interface PumpLaserProps {
  wavelength: number; // e.g. 405 nm
  power: number; // mW
  polarizationAngle: number; // radians (relative to horizontal)
  coherenceLength: number; // mm
}

export interface SPDCCrystalProps {
  material: "BBO" | "PPKTP";
  type: 1 | 2;              // Type-I (same polarization) or Type-II (orthogonal)
  pumpWavelength: number;
  signalWavelength: number;
  idlerWavelength: number;
  efficiency: number;       // Pairs generated per pump photon
}

export interface BeamSplitterProps {
  reflectivity: number;     // 0.0 to 1.0 (e.g., 0.5 for a 50:50 BS)
  phaseShiftReflect: number;// usually PI or PI/2 depending on the dielectric coating
}

export interface WaveplateProps {
  type: "HWP" | "QWP";      // Half-wave or Quarter-wave
  retardance: number;       // PI for HWP, PI/2 for QWP
  fastAxisAngle: number;    // radians, theta in the Jones Matrix
}

export interface PhaseShifterProps {
  phaseDelay: number;       // radians (simulating path length difference Delta x)
}

export interface SPADDetectorProps {
  quantumEfficiency: number;// 0.0 to 1.0 (e.g., 0.6 for 60%)
  darkCountRate: number;    // Hz
  deadTime: number;         // nanoseconds
}

export interface CoincidenceUnitProps {
  timeWindow: number;       // nanoseconds (resolving time for coincidences)
}

// Base component interface
export type ComponentProperties =
  | { type: "PUMP_LASER"; props: PumpLaserProps }
  | { type: "SPDC_CRYSTAL"; props: SPDCCrystalProps }
  | { type: "BEAM_SPLITTER"; props: BeamSplitterProps }
  | { type: "PBS"; props: {} } // Ideal PBS assumes 100% T for H, 100% R for V
  | { type: "WAVEPLATE"; props: WaveplateProps }
  | { type: "PHASE_SHIFTER"; props: PhaseShifterProps }
  | { type: "MIRROR"; props: { reflectivity: number } }
  | { type: "SPAD_DETECTOR"; props: SPADDetectorProps }
  | { type: "COINCIDENCE_UNIT"; props: CoincidenceUnitProps };

export type OpticalComponent = {
  id: string;
  x: number;
  y: number;
  rotation: number // physical rotation on the optical table (degrees)
} & ComponentProperties;

// Store & Context setup

export interface ExperimentSession {
  id: string;
  name: string;
  components: OpticalComponent[];
}

interface LabState {
  sessions: Record<string, ExperimentSession>;
  activeSessionId: string;
  isRunning: boolean;
  simulationStats: Record<string, number>;
}

// Store Actions
interface LabContextValue {
  state: LabState;
  addComponent: (comp: Omit<OpticalComponent, "id">) => string;
  updateComponentPosition: (id: string, x: number, y: number) => void;
  updateComponentRotation: (id: string, rotation: number) => void;
  updateComponentProperties: (id: string, newProps: any) => void;
  removeComponent: (id: string) => void;
  loadState: (components: OpticalComponent[]) => void;
  setSimulationState: (isRunning: boolean) => void;
  addSession: (name?: string) => void;
  switchSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  updateSimulationStats: (stats: Record<string, number>) => void;
}

// context
const LabContext = createContext<LabContextValue>();

export function LabProvider(props: { children: JSX.Element }) {
  const defaultSessionId = `mod-${Date.now()}`;
  const STORAGE_KEY = "qo_workspace_v1";

  // Attempt to load from persistent storage
  const savedStateStr = localStorage.getItem(STORAGE_KEY);
  let initialState: LabState;

  if (savedStateStr) {
    try {
      const parsed = JSON.parse(savedStateStr);
      initialState = { ...parsed, isRunning: false, simulationStats: {} }; // always start paused
    } catch {
      initialState = {
        sessions: { [defaultSessionId]: { id: defaultSessionId, name: "Unnamed (1)", components: [] } },
        activeSessionId: defaultSessionId,
        isRunning: false,
        simulationStats: {}
      };
    }
  } else {
    initialState = {
      sessions: { [defaultSessionId]: { id: defaultSessionId, name: "Unnamed (1)", components: [] } },
      activeSessionId: defaultSessionId,
      isRunning: false,
      simulationStats: {}
    };
  }

  const [state, setState] = createStore<LabState>(initialState);

  // Auto-sync entire state (excluding transient things) to localStorage
  createEffect(() => {
    // Stringify triggers tracking on whatever gets serialized.
    // By saving the whole block, any component changes cause a sync!
    const stateSnapshot = {
      sessions: state.sessions,
      activeSessionId: state.activeSessionId
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSnapshot));
  });

  const labActions: LabContextValue = {
    state,
    addComponent: (comp) => {
      const id = `comp-${Date.now()}`;
      setState("sessions", state.activeSessionId, "components", (prev) => [...prev, { ...comp, id } as OpticalComponent]);
      return id;
    },
    updateComponentPosition: (id, x, y) => {
      setState("sessions", state.activeSessionId, "components", (c) => c.id === id, (c) => ({ ...c, x, y }));
    },
    updateComponentRotation: (id, rotation) => {
      setState("sessions", state.activeSessionId, "components", (c) => c.id === id, "rotation", rotation);
    },
    updateComponentProperties: (id, newProps) => {
      // Allows updating specific physics parameters from the UI later
      setState("sessions", state.activeSessionId, "components", (c) => c.id === id, "props", (p) => ({ ...p, ...newProps }));
    },
    removeComponent: (id) => {
      setState("sessions", state.activeSessionId, "components", (prev) => prev.filter((c) => c.id !== id));
    },
    loadState: (newComponents) => {
      setState("sessions", state.activeSessionId, "components", newComponents);
    },
    setSimulationState: (isRunning) => {
      setState("isRunning", isRunning);
    },
    addSession: (name) => {
      const id = `mod-${Date.now()}`;
      setState("sessions", id, { id, name: name || `Unnamed (${Object.keys(state.sessions).length + 1})`, components: [] });
      setState("activeSessionId", id);
    },
    switchSession: (id) => {
      if (state.sessions[id]) {
        setState("activeSessionId", id);
      }
    },
    renameSession: (id, name) => {
      if (state.sessions[id]) {
        setState("sessions", id, "name", name);
      }
    },
    updateSimulationStats: (stats) => {
      setState("simulationStats", stats);
    }
  };

  return <LabContext.Provider value={labActions}>{props.children}</LabContext.Provider>;
}

export function useLab() {
  const context = useContext(LabContext);
  if (!context) throw new Error("useLab must be used within a LabProvider");
  return context;
}
