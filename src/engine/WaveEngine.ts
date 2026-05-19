/**
 * WaveEngine.ts
 * Classical wave-optics engine: computes 2D interference patterns via plane-wave
 * superposition of all active beam segments.
 *
 * The effective wavelength is scaled up to be visually meaningful on the canvas
 * (real wavelength ~405nm is sub-pixel at optical table scale). The geometry of
 * interference — path-length differences encoded in the ABCD matrix — is exact.
 */
import { type BeamSegment } from './RayTracer';

export interface WaveField {
  pixels: Uint8ClampedArray; // RGBA, row-major
  width: number;             // grid cols
  height: number;            // grid rows
  worldX: number;            // world-space top-left X
  worldY: number;            // world-space top-left Y
  cellSize: number;          // world-pixels per grid cell
}

/** Convert wavelength (nm) to linear [r,g,b] in [0,1]. */
function wavelengthToRGB(wl: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl <= 440)      { r = -(wl-440)/(440-380); b = 1; }
  else if (wl > 440 && wl <= 490)  { g = (wl-440)/(490-440); b = 1; }
  else if (wl > 490 && wl <= 510)  { g = 1; b = -(wl-510)/(510-490); }
  else if (wl > 510 && wl <= 580)  { r = (wl-510)/(580-510); g = 1; }
  else if (wl > 580 && wl <= 645)  { r = 1; g = -(wl-645)/(645-580); }
  else if (wl > 645 && wl <= 780)  { r = 1; }
  else if (wl < 380)               return [0.6, 0.1, 0.9]; // UV
  else                             return [0.5, 0.0, 0.0]; // IR
  const fac = (wl < 420) ? 0.3 + 0.7*(wl-380)/40 : (wl > 700) ? 0.3 + 0.7*(780-wl)/80 : 1;
  return [r*fac, g*fac, b*fac];
}

/**
 * Compute the 2D wave-interference intensity field over a rectangular world region.
 *
 * @param segments   Active beam segments from the ray tracer
 * @param worldX     Left edge of the computation region (world px)
 * @param worldY     Top edge of the computation region (world px)
 * @param worldW     Width of the computation region (world px)
 * @param worldH     Height of the computation region (world px)
 * @param cellSize   World pixels per grid cell (trade-off: quality vs speed)
 */
export function computeWaveField(
  segments: BeamSegment[],
  worldX: number,
  worldY: number,
  worldW: number,
  worldH: number,
  cellSize = 6
): WaveField {
  const gridW = Math.ceil(worldW / cellSize);
  const gridH = Math.ceil(worldH / cellSize);
  const N = gridW * gridH;
  const pixels = new Uint8ClampedArray(N * 4);

  if (segments.length === 0) {
    return { pixels, width: gridW, height: gridH, worldX, worldY, cellSize };
  }

  // Real + imaginary accumulators for total field (E_x = horizontal-ish combined)
  const E_re = new Float32Array(N);
  const E_im = new Float32Array(N);

  // Beam soft-width (Gaussian sigma, world px).  Controls how wide each beam
  // appears in the interference texture.  ~2× the visual ray width looks good.
  const BEAM_SIGMA = 18;
  const TWO_SIGMA_SQ = 2 * BEAM_SIGMA * BEAM_SIGMA;

  for (const seg of segments) {
    const dx = seg.endX - seg.startX;
    const dy = seg.endY - seg.startY;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 1) continue;

    const cosA = dx / segLen;
    const sinA = dy / segLen;
    const amplitude = Math.sqrt(Math.max(0, seg.power));

    // Effective wavelength — scale the real wavelength so fringes are visible.
    // Reference: 532 nm → 50 world-px. Longer λ → wider fringes (physically correct ratio).
    const lambdaEff = 50 * (seg.wavelength / 532.0);
    const kEff = (2 * Math.PI) / lambdaEff;

    // Optical path length at the START of this segment.
    // seg.abcd[0][1] is accumulated path length at the END (after multiplyABCD with freeSpaceMatrix).
    const startPath = seg.abcd[0][1] - segLen;

    // Bounding box culling: find grid cells potentially influenced by this segment
    const margin = BEAM_SIGMA * 3;
    const minGX = Math.max(0, Math.floor((Math.min(seg.startX, seg.endX) - margin - worldX) / cellSize));
    const maxGX = Math.min(gridW - 1, Math.ceil((Math.max(seg.startX, seg.endX) + margin - worldX) / cellSize));
    const minGY = Math.max(0, Math.floor((Math.min(seg.startY, seg.endY) - margin - worldY) / cellSize));
    const maxGY = Math.min(gridH - 1, Math.ceil((Math.max(seg.startY, seg.endY) + margin - worldY) / cellSize));

    for (let gy = minGY; gy <= maxGY; gy++) {
      const wy = worldY + gy * cellSize;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const wx = worldX + gx * cellSize;

        const relX = wx - seg.startX;
        const relY = wy - seg.startY;

        // Project onto beam direction
        const t    =  relX * cosA + relY * sinA; // along-beam
        const perp = -relX * sinA + relY * cosA; // perpendicular

        // Only contribute if the projected point is within the segment (with margin)
        if (t < -margin || t > segLen + margin) continue;

        const w = amplitude * Math.exp(-(perp * perp) / TWO_SIGMA_SQ);
        if (w < 1e-4) continue;

        const tClamped = Math.max(0, Math.min(segLen, t));
        const phase = kEff * (startPath + tClamped);

        const idx = gy * gridW + gx;
        E_re[idx] += w * Math.cos(phase);
        E_im[idx] += w * Math.sin(phase);
      }
    }
  }

  // Find peak intensity for normalisation
  let maxI = 0;
  for (let i = 0; i < N; i++) {
    const I = E_re[i] * E_re[i] + E_im[i] * E_im[i];
    if (I > maxI) maxI = I;
  }
  if (maxI === 0) return { pixels, width: gridW, height: gridH, worldX, worldY, cellSize };

  // Dominant wavelength for colour tint (use first non-trivial segment)
  const refWl = segments[0]?.wavelength ?? 532;
  const [cr, cg, cb] = wavelengthToRGB(refWl);

  const invMax = 1.0 / maxI;
  for (let i = 0; i < N; i++) {
    const I = E_re[i] * E_re[i] + E_im[i] * E_im[i];
    if (I < 1e-8) continue;
    // Gamma-compressed brightness for better dynamic range
    const norm = Math.pow(I * invMax, 0.45);
    pixels[i * 4]     = Math.round(cr * norm * 255);
    pixels[i * 4 + 1] = Math.round(cg * norm * 255);
    pixels[i * 4 + 2] = Math.round(cb * norm * 255);
    pixels[i * 4 + 3] = Math.round(norm * 210); // semi-transparent overlay
  }

  return { pixels, width: gridW, height: gridH, worldX, worldY, cellSize };
}

/**
 * Compute a 1D interference fringe intensity array along a screen.
 * The screen is perpendicular to (screenAngleRad) — i.e. it faces the beam.
 *
 * @param segments     Active beam segments from the ray tracer
 * @param cx           Screen center X (world px)
 * @param cy           Screen center Y (world px)
 * @param screenAngle  Rotation of the screen component (radians). The screen 
 *                     surface is perpendicular to this angle.
 * @param screenWidth  Width of the screen (world px)
 * @param resolution   Number of sample pixels across the screen width
 */
export function computeScreenField(
  segments: BeamSegment[],
  cx: number,
  cy: number,
  screenAngle: number,
  screenWidth: number,
  resolution = 256
): { intensities: Float32Array; wavelength: number } {
  // The screen surface runs perpendicular to screenAngle.
  // A point at position t along the screen (t in [-w/2, w/2]) is at world coords:
  //   px = cx + t * cos(screenAngle + PI/2)
  //   py = cy + t * sin(screenAngle + PI/2)
  const surfAngle = screenAngle + Math.PI / 2;
  const cosSurf = Math.cos(surfAngle);
  const sinSurf = Math.sin(surfAngle);

  const E_re = new Float32Array(resolution);
  const E_im = new Float32Array(resolution);

  const BEAM_SIGMA = 24; // beam width sigma (world px)
  const TWO_SIGMA_SQ = 2 * BEAM_SIGMA * BEAM_SIGMA;

  for (const seg of segments) {
    const dx = seg.endX - seg.startX;
    const dy = seg.endY - seg.startY;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 1) continue;

    const cosA = dx / segLen;
    const sinA = dy / segLen;
    const amplitude = Math.sqrt(Math.max(0, seg.power));
    const lambdaEff = 50 * (seg.wavelength / 532.0);
    const kEff = (2 * Math.PI) / lambdaEff;
    const startPath = seg.abcd[0][1] - segLen;

    for (let i = 0; i < resolution; i++) {
      // Position along screen surface
      const t = (i / (resolution - 1) - 0.5) * screenWidth;
      const wx = cx + t * cosSurf;
      const wy = cy + t * sinSurf;

      const relX = wx - seg.startX;
      const relY = wy - seg.startY;

      // Project onto beam direction
      const along = relX * cosA + relY * sinA;
      const perp  = -relX * sinA + relY * cosA;

      // Gaussian envelope — beam must actually illuminate this point
      const w = amplitude * Math.exp(-(perp * perp) / TWO_SIGMA_SQ);
      if (w < 1e-5) continue;

      const tClamped = Math.max(0, Math.min(segLen, along));
      const phase = kEff * (startPath + tClamped);

      E_re[i] += w * Math.cos(phase);
      E_im[i] += w * Math.sin(phase);
    }
  }

  const intensities = new Float32Array(resolution);
  for (let i = 0; i < resolution; i++) {
    intensities[i] = E_re[i] * E_re[i] + E_im[i] * E_im[i];
  }

  return { intensities, wavelength: segments[0]?.wavelength ?? 532 };
}

