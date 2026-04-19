export type Vector2D = { x: number, y: number };
export type ABCD = [[number, number], [number, number]];

export function multiplyABCD(m1: ABCD, m2: ABCD): ABCD {
  return [
    [m1[0][0]*m2[0][0] + m1[0][1]*m2[1][0], m1[0][0]*m2[0][1] + m1[0][1]*m2[1][1]],
    [m1[1][0]*m2[0][0] + m1[1][1]*m2[1][0], m1[1][0]*m2[0][1] + m1[1][1]*m2[1][1]],
  ];
}

export function freeSpaceMatrix(distance: number): ABCD {
  return [
    [1, distance],
    [0, 1]
  ];
}

export const degToRad = (deg: number) => deg * Math.PI / 180;
export const radToDeg = (rad: number) => rad * 180 / Math.PI;

export const normalizeAngle = (angle: number) => {
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
};

/**
 * Intersects a ray with a line segment.
 * Ray: start + t * direction (t >= 0)
 * Segment: center + u * segmentDirection (u in [-width/2, width/2])
 * segmentAngle is the physical angle of the segment line.
 */
export function raySegmentIntersection(
  rayStart: Vector2D,
  rayAngle: number,
  segmentCenter: Vector2D,
  segmentAngle: number,
  segmentWidth: number
): { point: Vector2D, distance: number } | null {
  const Px = rayStart.x;
  const Py = rayStart.y;
  const Ct = Math.cos(rayAngle);
  const St = Math.sin(rayAngle);
  
  const Sx = segmentCenter.x;
  const Sy = segmentCenter.y;
  const Cp = Math.cos(segmentAngle);
  const Sp = Math.sin(segmentAngle);
  
  const denom = Ct * Sp - St * Cp; // sin(segmentAngle - rayAngle)
  
  if (Math.abs(denom) < 1e-6) {
    return null; // parallel or collinear
  }
  
  const t = ((Sx - Px) * Sp - (Sy - Py) * Cp) / denom;
  const u = ((Sx - Px) * St - (Sy - Py) * Ct) / denom;
  
  // t > 0.1 prevents self-intersecting immediately upon spawning from a component
  if (t > 0.1 && u >= -segmentWidth / 2 && u <= segmentWidth / 2) {
    return {
      point: { x: Px + t * Ct, y: Py + t * St },
      distance: t
    };
  }
  
  return null;
}

/**
 * Given an incoming angle and a surface angle, returns the reflected angle.
 * The surface normal is effectively surfaceAngle + PI/2.
 */
export function getReflectedAngle(inAngle: number, surfaceAngle: number): number {
  const inVec = { x: Math.cos(inAngle), y: Math.sin(inAngle) };
  // Normal vector
  const nx = -Math.sin(surfaceAngle);
  const ny = Math.cos(surfaceAngle);
  
  const dot = inVec.x * nx + inVec.y * ny;
  
  const outVec = {
    x: inVec.x - 2 * dot * nx,
    y: inVec.y - 2 * dot * ny
  };
  
  return Math.atan2(outVec.y, outVec.x);
}

export function wavelengthToColor(wavelength: number): number {
  let r = 0, g = 0, b = 0;

  if (wavelength >= 380 && wavelength <= 440) {
    r = -(wavelength - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (wavelength > 440 && wavelength <= 490) {
    r = 0;
    g = (wavelength - 440) / (490 - 440);
    b = 1;
  } else if (wavelength > 490 && wavelength <= 510) {
    r = 0;
    g = 1;
    b = -(wavelength - 510) / (510 - 490);
  } else if (wavelength > 510 && wavelength <= 580) {
    r = (wavelength - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (wavelength > 580 && wavelength <= 645) {
    r = 1;
    g = -(wavelength - 645) / (645 - 580);
    b = 0;
  } else if (wavelength > 645 && wavelength <= 780) {
    r = 1;
    g = 0;
    b = 0;
  }

  // Fallbacks / non-visible spectrum mapped to subtle representations
  if (wavelength < 380) return 0x9c27b0; // UV 
  if (wavelength > 780) return 0x8b0000; // IR 

  const factor = (wavelength >= 380 && wavelength < 420) ? 0.3 + 0.7*(wavelength - 380)/(420 - 380) :
                 (wavelength >= 420 && wavelength <= 700) ? 1.0 :
                 (wavelength > 700 && wavelength <= 780) ? 0.3 + 0.7*(780 - wavelength)/(780 - 700) : 1;

  const R = Math.round(Math.max(0, Math.min(255, r * factor * 255)));
  const G = Math.round(Math.max(0, Math.min(255, g * factor * 255)));
  const B = Math.round(Math.max(0, Math.min(255, b * factor * 255)));

  return (R << 16) | (G << 8) | B;
}
