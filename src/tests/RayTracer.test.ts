import { describe, it, expect } from "vitest";
import { calculateBeams } from "../engine/RayTracer";
import type { OpticalComponent } from "../store/LabStore";

describe("RayTracer Engine", () => {

  it("should spawn a beam from a pump laser running to infinity", () => {
    const components: OpticalComponent[] = [
      {
        id: "laser1",
        type: "PUMP_LASER",
        x: 0,
        y: 0,
        rotation: 0,
        props: { wavelength: 405, power: 10, polarizationAngle: 0, coherenceLength: 10 }
      }
    ];

    const { segments: beams } = calculateBeams(components);
    
    // One solid beam going to infinity basically
    expect(beams.length).toBe(1);
    expect(beams[0].startX).toBe(0);
    expect(beams[0].startY).toBe(0);
    // Should be propagating horizontally right (rotation 0)
    expect(beams[0].endX).toBeGreaterThan(1000);
    expect(Math.abs(beams[0].endY)).toBeLessThan(0.01);
    
    // Check ABCD matrix (free space)
    // A = 1, B = distance > 1000, C = 0, D = 1
    expect(beams[0].abcd[0][0]).toBe(1);
    expect(beams[0].abcd[0][1]).toBeGreaterThan(1000);
    expect(beams[0].abcd[1][0]).toBe(0);
    expect(beams[0].abcd[1][1]).toBe(1);
  });

  it("should split a beam into two when hitting a beam splitter", () => {
    const components: OpticalComponent[] = [
      {
        id: "laser1",
        type: "PUMP_LASER",
        x: -100,
        y: 0,
        rotation: 0,
        props: { wavelength: 405, power: 10, polarizationAngle: 0, coherenceLength: 10 }
      },
      {
        id: "bs1",
        type: "BEAM_SPLITTER",
        x: 0,
        y: 0,
        // rotation 45 degrees
        rotation: 45,
        props: { reflectivity: 0.5, phaseShiftReflect: Math.PI }
      }
    ];

    const { segments: beams } = calculateBeams(components);
    
    // Beam 1: Laser to BS
    // Beam 2: BS to Infinity (Transmitted)
    // Beam 3: BS to Infinity (Reflected)
    expect(beams.length).toBe(3);

    const firstSegment = beams[0];
    expect(Math.round(firstSegment.endX)).toBe(0);
    expect(Math.round(firstSegment.endY)).toBe(0);
    
    // Transmitted ray continues at rotation 0
    const transmitted = beams.find(b => b.startX === 0 && b.startY === 0 && Math.abs(b.angle) < 0.01);
    expect(transmitted).toBeDefined();
    expect(transmitted?.power).toBeCloseTo(0.5);

    // Reflected ray goes up or down depending on normal 
    // at 45 degree rotation, reflection of a 0 degree beam is 90 degrees (+PI/2)
    const reflected = beams.find(b => b.startX === 0 && b.startY === 0 && Math.abs(b.angle) > 0.1);
    expect(reflected).toBeDefined();
    expect(reflected?.power).toBeCloseTo(0.5);
    
    const refAngleDeg = reflected!.angle * 180 / Math.PI;
    expect(Math.abs(Math.round(refAngleDeg))).toBe(90);
  });

  it("should terminate a beam when it hits a detector", () => {
    const components: OpticalComponent[] = [
      {
        id: "laser1",
        type: "PUMP_LASER",
        x: 0,
        y: 0,
        rotation: 0,
        props: { wavelength: 405, power: 10, polarizationAngle: 0, coherenceLength: 10 }
      },
      {
        id: "det1",
        type: "SPAD_DETECTOR",
        x: 100,
        y: 0,
        // rotation 0 means its face is straight on
        rotation: 0,
        props: { quantumEfficiency: 0.6, darkCountRate: 100, deadTime: 20 }
      }
    ];

    const { segments: beams } = calculateBeams(components);
    
    // Beam starts at laser, stops at detector
    expect(beams.length).toBe(1);
    expect(Math.round(beams[0].endX)).toBe(100);
    expect(Math.round(beams[0].endY)).toBe(0);
  });

});
