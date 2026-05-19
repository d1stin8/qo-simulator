import { type OpticalNode } from "../RayTracer";

interface Complex {
    re: number;
    im: number;
}

function cAdd(a: Complex, b: Complex): Complex {
    return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
    return { re: a.re - b.re, im: a.im - b.im };
}

function cMul(a: Complex, b: Complex): Complex {
    return {
        re: a.re * b.re - a.im * b.im,
        im: a.re * b.im + a.im * b.re
    };
}

function cScale(a: Complex, s: number): Complex {
    return { re: a.re * s, im: a.im * s };
}

function cMagSq(a: Complex): number {
    return a.re * a.re + a.im * a.im;
}

interface JonesVector {
    h: Complex;
    v: Complex;
}

interface BeamState {
    power: number;
    jones: JonesVector;
}

export interface DetectorStats {
    power: number;
    s0: number;
    s1: number;
    s2: number;
    s3: number;
}

// Complex arithmetic helpers
const I: Complex = { re: 0, im: 1 };

function cMulI(a: Complex): Complex {
    return { re: -a.im, im: a.re }; // a * i
}

function getEField(b: BeamState): JonesVector {
    const amp = Math.sqrt(b.power);
    return {
        h: cScale(b.jones.h, amp),
        v: cScale(b.jones.v, amp)
    };
}

function fromEField(e: JonesVector): BeamState {
    const power = cMagSq(e.h) + cMagSq(e.v);
    if (power <= 0) return { power: 0, jones: { h: { re: 0, im: 0 }, v: { re: 0, im: 0 } } };
    const amp = Math.sqrt(power);
    return {
        power,
        jones: {
            h: cScale(e.h, 1 / amp),
            v: cScale(e.v, 1 / amp)
        }
    };
}

export class OpticalSolver {
    static solve(graph: OpticalNode[]): { detectorStats: Record<string, DetectorStats>; beamPowers: Record<string, number> } {
        const beams = new Map<string, BeamState>();
        const detectorStats: Record<string, DetectorStats> = {};

        // Helper to get beam state or vacuum
        const getBeam = (id: string | undefined): BeamState => {
            if (id && beams.has(id)) return beams.get(id)!;
            return { power: 0, jones: { h: { re: 0, im: 0 }, v: { re: 0, im: 0 } } };
        };

        for (const node of graph) {
            if (node.type === "PUMP_LASER") {
                const outId = node.outputs[0];
                if (!outId) continue;

                const power = Number(node.params.power ?? 10);
                const polType = node.params.polarizationType || "H";
                const polAngle = Number(node.params.polarizationAngle || 0);

                let jh = { re: 1, im: 0 };
                let jv = { re: 0, im: 0 };

                if (polType === "H") { jh = { re: 1, im: 0 }; jv = { re: 0, im: 0 }; }
                else if (polType === "V") { jh = { re: 0, im: 0 }; jv = { re: 1, im: 0 }; }
                else if (polType === "D") { jh = { re: 0.707106, im: 0 }; jv = { re: 0.707106, im: 0 }; }
                else if (polType === "A") { jh = { re: 0.707106, im: 0 }; jv = { re: -0.707106, im: 0 }; }
                else if (polType === "R") { jh = { re: 0.707106, im: 0 }; jv = { re: 0, im: -0.707106 }; }
                else if (polType === "L") { jh = { re: 0.707106, im: 0 }; jv = { re: 0, im: 0.707106 }; }
                else if (polType === "Custom") {
                    jh = { re: Math.cos(polAngle), im: 0 };
                    jv = { re: Math.sin(polAngle), im: 0 };
                }
                else if (polType === "Unpolarized") {
                    // Equal H and V amplitudes — when sent through a PBS,
                    // H transmits and V reflects, splitting power 50/50.
                    jh = { re: 0.707106, im: 0 };
                    jv = { re: 0.707106, im: 0 };
                }

                beams.set(outId, { power, jones: { h: jh, v: jv } });
            } 
            else if (node.type === "WAVEPLATE") {
                const inId = node.inputs[0];
                const outId = node.outputs[0];
                if (!inId || !outId) continue;

                const inBeam = getBeam(inId);
                const theta = Number(node.params.fastAxisAngle || 0);
                const wpType = node.params.type || "HWP";

                let j11 = { re: 1, im: 0 }, j12 = { re: 0, im: 0 }, j21 = { re: 0, im: 0 }, j22 = { re: 1, im: 0 };
                
                if (wpType === "HWP") {
                    j11 = { re: Math.cos(2 * theta), im: 0 };
                    j12 = { re: Math.sin(2 * theta), im: 0 };
                    j21 = { re: Math.sin(2 * theta), im: 0 };
                    j22 = { re: -Math.cos(2 * theta), im: 0 };
                } else if (wpType === "QWP") {
                    const c = Math.cos(theta), s = Math.sin(theta);
                    j11 = { re: c * c, im: s * s };
                    j12 = { re: c * s, im: -c * s };
                    j21 = { re: c * s, im: -c * s };
                    j22 = { re: s * s, im: c * c };
                }

                const outH = cAdd(cMul(j11, inBeam.jones.h), cMul(j12, inBeam.jones.v));
                const outV = cAdd(cMul(j21, inBeam.jones.h), cMul(j22, inBeam.jones.v));

                beams.set(outId, { power: inBeam.power, jones: { h: outH, v: outV } });
            }
            else if (node.type === "MIRROR") {
                const inId = node.inputs[0];
                const outId = node.outputs[0];
                if (!inId || !outId) continue;

                const inBeam = getBeam(inId);
                const R = Number(node.params.reflectivity ?? 1.0);

                beams.set(outId, { power: inBeam.power * R, jones: inBeam.jones });
            }
            else if (node.type === "BEAM_SPLITTER") {
                const inId1 = node.inputs[0];
                const inId2 = node.inputs[1];
                const tOut = node.outputs[0]; // Transmitted (Port 1)
                const rOut = node.outputs[1]; // Reflected (Port 2)
                if (!tOut || !rOut) continue;

                const b1 = getBeam(inId1);
                const b2 = getBeam(inId2);
                const R = Number(node.params.reflectivity ?? 0.5);
                const T = 1.0 - R;

                const tAmp = Math.sqrt(T);
                const rAmp = Math.sqrt(R);

                const E1 = getEField(b1);
                const E2 = getEField(b2);

                // Symmetric lossless beam splitter matrix:
                // E_out1 = t * E1 + i * r * E2
                // E_out2 = i * r * E1 + t * E2
                
                const tH = cAdd(cScale(E1.h, tAmp), cScale(cMulI(E2.h), rAmp));
                const tV = cAdd(cScale(E1.v, tAmp), cScale(cMulI(E2.v), rAmp));
                
                const rH = cAdd(cScale(cMulI(E1.h), rAmp), cScale(E2.h, tAmp));
                const rV = cAdd(cScale(cMulI(E1.v), rAmp), cScale(E2.v, tAmp));

                beams.set(tOut, fromEField({ h: tH, v: tV }));
                beams.set(rOut, fromEField({ h: rH, v: rV }));
            }
            else if (node.type === "PBS") {
                const inId = node.inputs[0];
                const tOut = node.outputs[0];
                const rOut = node.outputs[1] || "unconnected_out";
                if (!inId || !tOut) continue;

                const inBeam = getBeam(inId);
                const E = getEField(inBeam);
                
                // H transmits perfectly, V reflects perfectly (with an i phase shift conventionally)
                const Et = { h: E.h, v: { re: 0, im: 0 } };
                const Er = { h: { re: 0, im: 0 }, v: cMulI(E.v) };

                beams.set(tOut, fromEField(Et));
                beams.set(rOut, fromEField(Er));
            }
            else if (node.type === "SPAD_DETECTOR" || node.type === "COINCIDENCE_UNIT") {
                const inId = node.inputs[0];
                if (!inId) continue;
                
                const inBeam = getBeam(inId);
                const eff = Number(node.params.quantumEfficiency ?? 1.0); // Wait, user added quantumEfficiency prop

                const jh = inBeam.jones.h;
                const jv = inBeam.jones.v;

                // Calculate Stokes parameters directly from the Jones vector
                const magH = cMagSq(jh);
                const magV = cMagSq(jv);
                
                const S0 = magH + magV;
                // If S0 is zero, the state is fully dark, S1=S2=S3=0
                const normH = S0 > 0 ? cScale(jh, 1/Math.sqrt(S0)) : jh;
                const normV = S0 > 0 ? cScale(jv, 1/Math.sqrt(S0)) : jv;

                // Normalized stokes parameters (-1 to 1) representing just the polarization state
                const s1 = cMagSq(normH) - cMagSq(normV);
                const s2 = 2 * (normH.re * normV.re + normH.im * normV.im);
                const s3 = 2 * (normH.re * normV.im - normH.im * normV.re);

                // Final reported power is linear
                const finalPower = inBeam.power * eff;

                detectorStats[node.componentId] = {
                    power: finalPower,
                    s0: 1.0,
                    s1: s1,
                    s2: s2,
                    s3: s3
                };
            }
        }

        // Build a flat beam power map for the renderer to use
        const beamPowers: Record<string, number> = {};
        for (const [id, state] of beams.entries()) {
            beamPowers[id] = state.power;
        }

        return { detectorStats, beamPowers };
    }
}
