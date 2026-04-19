import { type VqolNode } from "../RayTracer";

// Compiles a dynamic WGSL shader from a directed acyclic graph of optical nodes.
export class VqolCompiler {
  static compile(graph: VqolNode[]): { code: string, bindings: { numDetectors: number, detectorMap: Map<string, number> } } {
    let detectorIdx = 0;
    
    // We maintain a mapping of Detector component ID -> Output array index
    const detectorIndices = new Map<string, number>();

    let kernelBody = ``;

    for (const node of graph) {
      if (node.type === "PUMP_LASER") {
        // Source
        const outBeam = node.outputs[0];
        
        let power = parseFloat(node.params.power || "10");
        if (power <= 0) power = 0.0001; 
        // Convert to WGSL amplitude coefficient
        let alphaStr = `sqrt(${power})`;
        
        let polAngle = parseFloat(node.params.polarizationAngle || "0");
        let aH = `${alphaStr} * cos(${polAngle})`;
        let aV = `${alphaStr} * sin(${polAngle})`;
        
        // Based on VQOL theory, a coherent state is alpha + vacuum noise
        kernelBody += `
        // --- Source: ${node.componentId} ---
        let ${outBeam}_zH = rand_complex_gaussian(&seed);
        let ${outBeam}_zV = rand_complex_gaussian(&seed);
        
        // Coherent State formula
        let ${outBeam}_H = vec2<f32>(${aH}, 0.0) + sigma0 * ${outBeam}_zH;
        let ${outBeam}_V = vec2<f32>(${aV}, 0.0) + sigma0 * ${outBeam}_zV;
        `;
      } 
      else if (node.type === "WAVEPLATE") {
        const inBeam = node.inputs[0];
        const outBeam = node.outputs[0];
        if (!inBeam) continue; // Unconnected
        // Simple transmission with no phase shift for testing purposes, or apply math
        kernelBody += `
        // --- Waveplate: ${node.componentId} ---
        let ${outBeam}_H = ${inBeam}_H;
        let ${outBeam}_V = ${inBeam}_V;
        `;
      }
      else if (node.type === "MIRROR") {
        const inBeam = node.inputs[0];
        const outBeam = node.outputs[0];
        if (!inBeam) continue;
        kernelBody += `
        // --- Mirror: ${node.componentId} ---
        let ${outBeam}_H = ${inBeam}_H;
        let ${outBeam}_V = ${inBeam}_V;
        `;
      }
      else if (node.type === "BEAM_SPLITTER") {
        const inBeam1 = node.inputs[0];
        const inBeam2 = node.inputs[1];
        const tBeam = node.outputs[0]; // Out 1
        const rBeam = node.outputs[1]; // Out 2
        if (!inBeam1 && !inBeam2) continue;
        
        // VQOL 50/50 Beam Splitter Operator Matrix:
        // if only 1 input, the second port is raw vacuum
        let port1H = inBeam1 ? `${inBeam1}_H` : `(${node.componentId}_vac_H)`;
        let port1V = inBeam1 ? `${inBeam1}_V` : `(${node.componentId}_vac_V)`;
        
        let port2H = inBeam2 ? `${inBeam2}_H` : `(${node.componentId}_vac_H)`;
        let port2V = inBeam2 ? `${inBeam2}_V` : `(${node.componentId}_vac_V)`;
        
        kernelBody += `
        // --- Beam Splitter: ${node.componentId} ---
        let ${node.componentId}_vac_zH = rand_complex_gaussian(&seed);
        let ${node.componentId}_vac_zV = rand_complex_gaussian(&seed);
        let ${node.componentId}_vac_H = sigma0 * ${node.componentId}_vac_zH;
        let ${node.componentId}_vac_V = sigma0 * ${node.componentId}_vac_zV;

        let ${tBeam}_H = (${port1H} + ${port2H}) * 0.70710678;
        let ${tBeam}_V = (${port1V} + ${port2V}) * 0.70710678;
        
        let ${rBeam}_H = (${port1H} - ${port2H}) * 0.70710678;
        let ${rBeam}_V = (${port1V} - ${port2V}) * 0.70710678;
        `;
      }
      else if (node.type === "PBS") {
        const inBeam = node.inputs[0];
        const tBeam = node.outputs[0]; // (e.g. H passes)
        const rBeam = node.outputs[1] || outBeamBackup(); // (e.g. V reflects)
        if (!inBeam) continue;

        kernelBody += `
        // --- PBS: ${node.componentId} ---
        let ${tBeam}_H = ${inBeam}_H;
        let ${tBeam}_V = vec2<f32>(0.0, 0.0);
        `;
        if (node.outputs.length > 1) {
          kernelBody += `
          let ${rBeam}_H = vec2<f32>(0.0, 0.0);
          let ${rBeam}_V = ${inBeam}_V;
          `;
        }
      }
      else if (node.type === "SPAD_DETECTOR" || node.type === "COINCIDENCE_UNIT") {
        const inBeam = node.inputs[0];
        if (!inBeam) continue;
        const dIndex = detectorIdx++;
        detectorIndices.set(node.componentId, dIndex);

        kernelBody += `
        // --- Detector: ${node.componentId} ---
        let ${node.componentId}_magH = ${inBeam}_H.x * ${inBeam}_H.x + ${inBeam}_H.y * ${inBeam}_H.y;
        let ${node.componentId}_magV = ${inBeam}_V.x * ${inBeam}_V.x + ${inBeam}_V.y * ${inBeam}_V.y;
        
        if (${node.componentId}_magH > GAMMA_SQ || ${node.componentId}_magV > GAMMA_SQ) {
            atomicAdd(&detector_results[${dIndex}], 1u);
        }
        `;
      }
    }

    const wgsl = `
    const SIGMA_0_SQ: f32 = 0.5;
    const GAMMA_SQ: f32 = 3.8025; // 1.95^2

    @group(0) @binding(0) var<uniform> config: vec4<f32>; // [numSamples, seed, 0, 0]
    @group(0) @binding(1) var<storage, read_write> detector_results: array<atomic<u32>>;

    fn pcg_hash(input: u32) -> u32 {
        var state: u32 = input * 747796405u + 2891336453u;
        var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
        return (word >> 22u) ^ word;
    }

    fn rand_float(seed: ptr<function, u32>) -> f32 {
        *seed = pcg_hash(*seed);
        return f32(*seed) / 4294967296.0;
    }

    fn rand_complex_gaussian(seed: ptr<function, u32>) -> vec2<f32> {
        let u1 = max(rand_float(seed), 0.0000001);
        let u2 = rand_float(seed);
        let r = sqrt(-log(u1));
        let theta = 6.28318530718 * u2;
        return vec2<f32>(r * cos(theta), r * sin(theta));
    }

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        if (global_id.x >= u32(config.x)) {
            return;
        }

        var seed = global_id.x + u32(config.y);
        let sigma0 = sqrt(SIGMA_0_SQ);

        ${kernelBody}
    }
    `;

    return { code: wgsl, bindings: { numDetectors: detectorIdx, detectorMap: detectorIndices } };
  }

  // Caches pipelines internally
  private static pipelineCache = new Map<string, GPUComputePipeline>();

  static async compileAndRun(device: GPUDevice, graph: VqolNode[], numSamples: number = 1000000): Promise<Record<string, number>> {
      if (graph.length === 0) return {};

      // 1. Generate Shader using compiler
      const { code, bindings } = this.compile(graph);
      if (bindings.numDetectors === 0) return {}; // Nothing to read back

      // Hash code to avoid recompiling exactly identical DAGs
      // Very basic hash, could be improved, but code string comparison is fine since WebGPU device dedupes internally too.
      let computePipeline = this.pipelineCache.get(code);
      if (!computePipeline) {
         const shaderModule = device.createShaderModule({ code });
         computePipeline = await device.createComputePipelineAsync({
           layout: 'auto',
           compute: { module: shaderModule, entryPoint: 'main' }
         });
         this.pipelineCache.set(code, computePipeline);
      }

      // 2. Setup Buffers
      const configArray = new Float32Array([numSamples, Math.abs(Math.random() * 100000), 0, 0]);
      const configBuffer = device.createBuffer({
        size: configArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(configBuffer, 0, configArray);

      const resultBytes = bindings.numDetectors * 4;
      const resultBuffer = device.createBuffer({
        size: resultBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(resultBuffer, 0, new Uint32Array(bindings.numDetectors));

      const readbackBuffer = device.createBuffer({
        size: resultBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: configBuffer } },
          { binding: 1, resource: { buffer: resultBuffer } },
        ],
      });

      // 3. Dispatch
      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(computePipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.dispatchWorkgroups(Math.ceil(numSamples / 64));
      passEncoder.end();

      commandEncoder.copyBufferToBuffer(resultBuffer, 0, readbackBuffer, 0, resultBytes);
      device.queue.submit([commandEncoder.finish()]);

      // 4. Readback and Map Results
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const output = new Uint32Array(readbackBuffer.getMappedRange());
      
      const componentResults: Record<string, number> = {};
      for (const [compId, index] of bindings.detectorMap.entries()) {
          componentResults[compId] = output[index];
      }

      readbackBuffer.unmap();

      return componentResults;
  }
}

function outBeamBackup() {
    return 'unconnected_out';
}
