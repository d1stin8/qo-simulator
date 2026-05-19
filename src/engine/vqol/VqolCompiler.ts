import { type VqolNode } from "../RayTracer";

// Compiles a dynamic WGSL shader from a directed acyclic graph of optical nodes.
export class VqolCompiler {
  static compile(graph: VqolNode[]): { code: string, bindings: { numDetectors: number, detectorMap: Map<string, number> } } {
    let detectorIdx = 0;
    
    // We maintain a mapping of Detector component ID -> Output array index
    const detectorIndices = new Map<string, number>();

    let kernelBody = ``;

    for (const node of graph) {
      const cId = node.componentId.replace(/-/g, '_');
      if (node.type === "PUMP_LASER") {
        // Source
        const outBeam = node.outputs[0];
        
        let power = parseFloat(node.params.power || "10");
        if (power <= 0) power = 0.0001; 
        let alphaStr = Math.sqrt(power).toFixed(6);
        
        let polType = node.params.polarizationType || "H";
        let polAngle = parseFloat(node.params.polarizationAngle || "0");
        
        // Define Jones Vector components (complex numbers)
        let jh_re = "1.0", jh_im = "0.0";
        let jv_re = "0.0", jv_im = "0.0";
        let randomPol = false;

        if (polType === "H") { jh_re = "1.0"; jv_re = "0.0"; }
        else if (polType === "V") { jh_re = "0.0"; jv_re = "1.0"; }
        else if (polType === "D") { jh_re = "0.707107"; jv_re = "0.707107"; }
        else if (polType === "A") { jh_re = "0.707107"; jv_re = "-0.707107"; }
        else if (polType === "R") { jh_re = "0.707107"; jv_im = "0.0"; jv_re = "0.0"; jv_im = "-0.707107"; }
        else if (polType === "L") { jh_re = "0.707107"; jv_im = "0.0"; jv_re = "0.0"; jv_im = "0.707107"; }
        else if (polType === "Custom") {
            jh_re = Math.cos(polAngle).toFixed(6);
            jv_re = Math.sin(polAngle).toFixed(6);
        }
        else if (polType === "Random") {
            randomPol = true;
        }

        kernelBody += `
        // --- Source: ${node.componentId} ---
        let ${outBeam}_zH = rand_complex_gaussian(&seed);
        let ${outBeam}_zV = rand_complex_gaussian(&seed);
        `;

        if (randomPol) {
            kernelBody += `
            let ${cId}_rand_angle = rand_float(&seed) * 3.14159265;
            let ${cId}_rand_phase = rand_float(&seed) * 6.2831853;
            let ${cId}_jh = vec2<f32>(cos(${cId}_rand_angle), 0.0);
            let ${cId}_jv = vec2<f32>(sin(${cId}_rand_angle) * cos(${cId}_rand_phase), sin(${cId}_rand_angle) * sin(${cId}_rand_phase));
            let ${outBeam}_H = vec2<f32>(${alphaStr}, 0.0) * ${cId}_jh + sigma0 * ${outBeam}_zH;
            let ${outBeam}_V = c_mul(vec2<f32>(${alphaStr}, 0.0), ${cId}_jv) + sigma0 * ${outBeam}_zV;
            `;
        } else {
            kernelBody += `
            let ${cId}_jh = vec2<f32>(${jh_re}, ${jh_im});
            let ${cId}_jv = vec2<f32>(${jv_re}, ${jv_im});
            let ${outBeam}_H = c_mul(vec2<f32>(${alphaStr}, 0.0), ${cId}_jh) + sigma0 * ${outBeam}_zH;
            let ${outBeam}_V = c_mul(vec2<f32>(${alphaStr}, 0.0), ${cId}_jv) + sigma0 * ${outBeam}_zV;
            `;
        }
      } 
      else if (node.type === "WAVEPLATE") {
        const inBeam = node.inputs[0];
        const outBeam = node.outputs[0];
        if (!inBeam) continue;

        let theta = parseFloat(node.params.fastAxisAngle || "0");
        let wpType = node.params.type || "HWP";
        
        let j11 = { re: 1, im: 0 }, j12 = { re: 0, im: 0 }, j21 = { re: 0, im: 0 }, j22 = { re: 1, im: 0 };
        if (wpType === "HWP") {
            j11 = { re: Math.cos(2*theta), im: 0 };
            j12 = { re: Math.sin(2*theta), im: 0 };
            j21 = { re: Math.sin(2*theta), im: 0 };
            j22 = { re: -Math.cos(2*theta), im: 0 };
        } else if (wpType === "QWP") {
            let c = Math.cos(theta), s = Math.sin(theta);
            j11 = { re: c*c, im: s*s };
            j12 = { re: c*s, im: -c*s };
            j21 = { re: c*s, im: -c*s };
            j22 = { re: s*s, im: c*c };
        }

        kernelBody += `
        // --- Waveplate: ${node.componentId} ---
        let ${cId}_J11 = vec2<f32>(${j11.re.toFixed(6)}, ${j11.im.toFixed(6)});
        let ${cId}_J12 = vec2<f32>(${j12.re.toFixed(6)}, ${j12.im.toFixed(6)});
        let ${cId}_J21 = vec2<f32>(${j21.re.toFixed(6)}, ${j21.im.toFixed(6)});
        let ${cId}_J22 = vec2<f32>(${j22.re.toFixed(6)}, ${j22.im.toFixed(6)});

        let ${outBeam}_H = c_mul(${cId}_J11, ${inBeam}_H) + c_mul(${cId}_J12, ${inBeam}_V);
        let ${outBeam}_V = c_mul(${cId}_J21, ${inBeam}_H) + c_mul(${cId}_J22, ${inBeam}_V);
        `;
      }
      else if (node.type === "MIRROR") {
        const inBeam = node.inputs[0];
        const outBeam = node.outputs[0];
        if (!inBeam) continue;
        let R = parseFloat(node.params.reflectivity ?? "1.0");
        let r_amp = Math.sqrt(R).toFixed(6);

        kernelBody += `
        // --- Mirror: ${node.componentId} ---
        let ${outBeam}_H = ${inBeam}_H * ${r_amp};
        let ${outBeam}_V = ${inBeam}_V * ${r_amp};
        `;
      }
      else if (node.type === "BEAM_SPLITTER") {
        const inBeam1 = node.inputs[0];
        const inBeam2 = node.inputs[1];
        const tBeam = node.outputs[0]; // Out 1
        const rBeam = node.outputs[1]; // Out 2
        if (!inBeam1 && !inBeam2) continue;
        
        let port1H = inBeam1 ? `${inBeam1}_H` : `(${cId}_vac_H)`;
        let port1V = inBeam1 ? `${inBeam1}_V` : `(${cId}_vac_V)`;
        
        let port2H = inBeam2 ? `${inBeam2}_H` : `(${cId}_vac_H)`;
        let port2V = inBeam2 ? `${inBeam2}_V` : `(${cId}_vac_V)`;
        
        let R = parseFloat(node.params.reflectivity ?? "0.5");
        let r_amp = Math.sqrt(R).toFixed(6);
        let t_amp = Math.sqrt(1 - R).toFixed(6);

        kernelBody += `
        // --- Beam Splitter: ${node.componentId} ---
        let ${cId}_vac_zH = rand_complex_gaussian(&seed);
        let ${cId}_vac_zV = rand_complex_gaussian(&seed);
        let ${cId}_vac_H = sigma0 * ${cId}_vac_zH;
        let ${cId}_vac_V = sigma0 * ${cId}_vac_zV;

        let ${tBeam}_H = (${port1H} * ${t_amp} + ${port2H} * ${r_amp});
        let ${tBeam}_V = (${port1V} * ${t_amp} + ${port2V} * ${r_amp});
        
        let ${rBeam}_H = (${port1H} * ${r_amp} - ${port2H} * ${t_amp});
        let ${rBeam}_V = (${port1V} * ${r_amp} - ${port2V} * ${t_amp});
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
        // --- Detector: ${node.componentId} (Power + Polarization) ---
        let ${cId}_pH = ${inBeam}_H.x * ${inBeam}_H.x + ${inBeam}_H.y * ${inBeam}_H.y;
        let ${cId}_pV = ${inBeam}_V.x * ${inBeam}_V.x + ${inBeam}_V.y * ${inBeam}_V.y;

        let ${cId}_S0 = ${cId}_pH + ${cId}_pV;
        let ${cId}_S1 = ${cId}_pH - ${cId}_pV;
        let ${cId}_S2 = 2.0 * (${inBeam}_H.x * ${inBeam}_V.x + ${inBeam}_H.y * ${inBeam}_V.y);
        let ${cId}_S3 = 2.0 * (${inBeam}_H.x * ${inBeam}_V.y - ${inBeam}_H.y * ${inBeam}_V.x);

        // Fixed-point accumulation: scale by POWER_SCALE. Add STOKES_OFFSET to allow negative accumulation.
        atomicAdd(&detector_results[${dIndex}u * 4u],     u32(clamp(${cId}_S0 * POWER_SCALE, 0.0, 4294900000.0)));
        atomicAdd(&detector_results[${dIndex}u * 4u + 1u], u32(clamp((${cId}_S1 * POWER_SCALE) + STOKES_OFFSET, 0.0, 4294900000.0)));
        atomicAdd(&detector_results[${dIndex}u * 4u + 2u], u32(clamp((${cId}_S2 * POWER_SCALE) + STOKES_OFFSET, 0.0, 4294900000.0)));
        atomicAdd(&detector_results[${dIndex}u * 4u + 3u], u32(clamp((${cId}_S3 * POWER_SCALE) + STOKES_OFFSET, 0.0, 4294900000.0)));
        `;
      }
    }

    const wgsl = `
    // Fixed-point scale: accumulate float power as u32 (divide by POWER_SCALE on readback)
    const POWER_SCALE: f32 = 100.0;
    const STOKES_OFFSET: f32 = 2000.0; // Avoid negative atomicAdd overflow
    const SIGMA_0_SQ: f32 = 0.5;

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

    fn c_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
        return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
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

  static async compileAndRun(device: GPUDevice, graph: VqolNode[], numSamples: number = 1000000): Promise<Record<string, { s0: number, s1: number, s2: number, s3: number }>> {
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

      const resultBytes = bindings.numDetectors * 4 * 4;
      const resultBuffer = device.createBuffer({
        size: resultBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(resultBuffer, 0, new Uint32Array(bindings.numDetectors * 4));

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
      
      const componentResults: Record<string, { s0: number, s1: number, s2: number, s3: number }> = {};
      const POWER_SCALE = 100.0; // must match the WGSL constant
      const STOKES_OFFSET = 2000.0;
      for (const [compId, index] of bindings.detectorMap.entries()) {
          // Convert fixed-point sums back to mean power (watts-equivalent), removing the STOKES_OFFSET per sample for S1-S3
          componentResults[compId] = {
              s0:  output[index * 4]     / (numSamples * POWER_SCALE),
              s1: (output[index * 4 + 1] - numSamples * STOKES_OFFSET) / (numSamples * POWER_SCALE),
              s2: (output[index * 4 + 2] - numSamples * STOKES_OFFSET) / (numSamples * POWER_SCALE),
              s3: (output[index * 4 + 3] - numSamples * STOKES_OFFSET) / (numSamples * POWER_SCALE),
          };
      }

      readbackBuffer.unmap();

      return componentResults;
  }
}

function outBeamBackup() {
    return 'unconnected_out';
}
