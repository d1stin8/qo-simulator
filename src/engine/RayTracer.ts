import { type OpticalComponent } from "../store/LabStore";
import { degToRad, getReflectedAngle, raySegmentIntersection, multiplyABCD, freeSpaceMatrix, type ABCD, type Vector2D } from "./math";

export interface BeamSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  angle: number; // radians
  power: number; // remaining power fraction
  abcd: ABCD; // accumulated ABCD matrix
  wavelength: number;
  beamId: string;
}

export interface VqolNode {
  componentId: string;
  type: string;
  inputs: string[];
  outputs: string[];
  params: Record<string, any>;
}

interface ActiveRay {
  x: number;
  y: number;
  angle: number;
  power: number;
  abcd: ABCD;
  wavelength: number;
  beamId: string;
}

export function calculateBeams(components: OpticalComponent[]): { segments: BeamSegment[], vqolGraph: VqolNode[] } {
  const segments: BeamSegment[] = [];
  const activeRays: ActiveRay[] = [];
  const vqolNodesMap = new Map<string, VqolNode>();
  
  let beamCounter = 0;
  const generateBeamId = () => `b${beamCounter++}`;

  // Find all Pump Lasers to seed the rays
  for (const comp of components) {
    if (comp.type === "PUMP_LASER") {
      const initialBeamId = generateBeamId();
      
      vqolNodesMap.set(comp.id, {
        componentId: comp.id,
        type: comp.type,
        inputs: [],
        outputs: [initialBeamId],
        params: comp.props
      });

      activeRays.push({
        x: comp.x,
        y: comp.y,
        angle: degToRad(comp.rotation),
        power: 1.0,
        abcd: [[1, 0], [0, 1]], // Identity matrix
        wavelength: (comp as any).props.wavelength || 405,
        beamId: initialBeamId
      });
    }
  }

  const MAX_BOUNCES = 15;
  const COMPONENT_WIDTH = 40; // Collision threshold (e.g. standard 1" optic + mount)

  let i = 0;
  // Breadth-First Ray Tracing
  while (activeRays.length > 0 && i < MAX_BOUNCES * components.length) {
    const ray = activeRays.shift()!;
    i++;

    // Find closest intersection
    let closestComponent: OpticalComponent | null = null;
    let closestDist = Infinity;
    let closestIntersectionPoint: Vector2D | null = null;

    for (const comp of components) {
      // Lasers don't intercept beams
      if (comp.type === "PUMP_LASER") continue;

      const compAngle = degToRad(comp.rotation);

      // Determine the face angle (the physical surface confronting the beam)
      // Usually, if a mirror's rotation is 0, its face is along Y axis (angle 90 deg)
      // Let's assume `rotation` defines the optical face's perpendicular normal?
      // Conventionally `rotation=0` meaning normal is along X axis, so face is Y axis.
      const faceAngle = compAngle + Math.PI / 2;

      const intersection = raySegmentIntersection(
        { x: ray.x, y: ray.y },
        ray.angle,
        { x: comp.x, y: comp.y },
        faceAngle,
        COMPONENT_WIDTH
      );

      if (intersection && intersection.distance < closestDist) {
        closestDist = intersection.distance;
        closestComponent = comp;
        closestIntersectionPoint = intersection.point;
      }
    }

    if (closestComponent && closestIntersectionPoint) {
      // Propagation distance to the component
      const dist = closestDist;
      const fsMatrix = freeSpaceMatrix(dist);
      const newABCD = multiplyABCD(fsMatrix, ray.abcd);

      segments.push({
        startX: ray.x,
        startY: ray.y,
        endX: closestIntersectionPoint.x,
        endY: closestIntersectionPoint.y,
        angle: ray.angle,
        power: ray.power,
        abcd: newABCD,
        wavelength: ray.wavelength,
        beamId: ray.beamId
      });

      // Compute behavior based on comp.type
      const cType = closestComponent.type;
      const cAngle = degToRad(closestComponent.rotation);
      
      // Default normal is along X so face is vertical (+ PI/2)
      let faceAngle = cAngle + Math.PI / 2;
      
      // Splitting/Reflecting optics are natively drawn with a -45 deg diagonal face at 0 rotation 
      // so horizontal light (0 deg) hits it and perfectly reflects UP (-90 deg in graphics space)
      if (cType === "BEAM_SPLITTER" || cType === "MIRROR" || cType === "PBS") {
          faceAngle = cAngle - Math.PI / 4;
      }

      // Extract node to map topology
      let vNode = vqolNodesMap.get(closestComponent.id);
      if (!vNode) {
        vNode = {
          componentId: closestComponent.id,
          type: closestComponent.type,
          inputs: [],
          outputs: [],
          params: closestComponent.props || { angle: closestComponent.rotation }
        };
        vqolNodesMap.set(closestComponent.id, vNode);
      }
      vNode.inputs.push(ray.beamId);

      if (cType === "SPAD_DETECTOR" || cType === "COINCIDENCE_UNIT") {
        // Absorbed completely, ray terminates.
        vNode.params.rotation = closestComponent.rotation;
      } else if (cType === "MIRROR" || cType === "PBS") {
        const outBeam = generateBeamId();
        vNode.outputs.push(outBeam);
        vNode.params.rotation = closestComponent.rotation;
        
        // Simple reflection (assuming PBS reflects all for this simple visualizer)
        const refAngle = getReflectedAngle(ray.angle, faceAngle);
        activeRays.push({
          x: closestIntersectionPoint.x,
          y: closestIntersectionPoint.y,
          angle: refAngle,
          power: ray.power,
          abcd: newABCD,
          wavelength: ray.wavelength,
          beamId: outBeam
        });
      } else if (cType === "BEAM_SPLITTER") {
        const transBeam = generateBeamId();
        const refBeam = generateBeamId();
        vNode.outputs.push(transBeam, refBeam);
        vNode.params.rotation = closestComponent.rotation;

        // Splits: one transmitted, one reflected
        const refAngle = getReflectedAngle(ray.angle, faceAngle);
        // Transmitted (50% power)
        activeRays.push({
          x: closestIntersectionPoint.x,
          y: closestIntersectionPoint.y,
          angle: ray.angle,
          power: ray.power * 0.5,
          abcd: newABCD,
          wavelength: ray.wavelength,
          beamId: transBeam
        });
        // Reflected (50% power)
        activeRays.push({
          x: closestIntersectionPoint.x,
          y: closestIntersectionPoint.y,
          angle: refAngle,
          power: ray.power * 0.5,
          abcd: newABCD,
          wavelength: ray.wavelength,
          beamId: refBeam
        });
      } else {
        const outBeam = generateBeamId();
        vNode.outputs.push(outBeam);
        vNode.params.rotation = closestComponent.rotation;

        // Transmits straight through (Waveplate, SPDC, etc)
        activeRays.push({
          x: closestIntersectionPoint.x,
          y: closestIntersectionPoint.y,
          angle: ray.angle,
          power: ray.power,
          abcd: newABCD,
          wavelength: ray.wavelength,
          beamId: outBeam
        });
      }
    } else {
      // Ray flies out to infinity (or edge of board)
      const distantDist = 5000;
      const newABCD = multiplyABCD(freeSpaceMatrix(distantDist), ray.abcd);
      segments.push({
        startX: ray.x,
        startY: ray.y,
        endX: ray.x + Math.cos(ray.angle) * distantDist,
        endY: ray.y + Math.sin(ray.angle) * distantDist,
        angle: ray.angle,
        power: ray.power,
        abcd: newABCD,
        wavelength: ray.wavelength,
        beamId: ray.beamId
      });
    }
  }

  return { segments, vqolGraph: Array.from(vqolNodesMap.values()) };
}
