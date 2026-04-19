export type ComponentType = 'LASER' | 'BEAM_SPLITTER' | 'WAVEPLATE' | 'DETECTOR';

export interface OpticalComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  rotation: number;
  properties: Record<string, any>;
}

export interface LabState {
  components: OpticalComponent[];
}
