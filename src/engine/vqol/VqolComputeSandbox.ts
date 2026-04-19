// VQOL WebGPU Engine Sandbox
// Simulates Monte Carlo propagation of true zero-point fluctuating fields.

export async function runVqolTest(numSamples: number = 1000000) {
  if (!navigator.gpu) {
    console.error("WebGPU is not supported in this browser.");
    return false;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error("Failed to acquire WebGPU adapter.");
    return false;
  }
  const device = await adapter.requestDevice();

  // Theoretical Constants from the VQOL Paper
  const SIGMA_0_SQ = 0.5; // Variance of vacuum field
  const GAMMA = 1.95;     // Threshold for Geiger Detections resolving to DCR=0.001

  const wgslCode = `
    // Configuration Buffer
    // 0: numSamples, 1: gamma, 2: sigma0_sq, 3: seed
    @group(0) @binding(0) var<uniform> config: vec4<f32>;
    
    // Output Counter: sum of clicks
    @group(0) @binding(1) var<storage, read_write> results: atomic<u32>;

    // PCG Hash for uniform random number generation
    fn pcg_hash(input: u32) -> u32 {
        var state: u32 = input * 747796405u + 2891336453u;
        var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
        return (word >> 22u) ^ word;
    }

    // Convert random u32 to uniform float (0.0, 1.0]
    fn rand_float(seed: ptr<function, u32>) -> f32 {
        *seed = pcg_hash(*seed);
        // Divide by max u32
        return f32(*seed) / 4294967296.0;
    }

    // Box-Muller transform modified for Standard Complex Gaussian (Variance of magnitude = 1)
    // Classical Box-Muller uses r = sqrt(-2.0 * log(u1)) giving variance 2 for complex fields.
    fn rand_complex_gaussian(seed: ptr<function, u32>) -> vec2<f32> {
        let u1 = max(rand_float(seed), 0.0000001); // Prevent log(0)
        let u2 = rand_float(seed);
        
        // r = sqrt(-ln(u1))  -> E[r^2] = 1
        let r = sqrt(-log(u1));
        // theta = 2 pi u2
        let theta = 6.28318530718 * u2;
        
        return vec2<f32>(r * cos(theta), r * sin(theta));
    }

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        if (global_id.x >= u32(config.x)) {
            return;
        }

        // Initialize unique seed per thread
        var seed = global_id.x + u32(config.w);

        // --- VQOL VACUUM FIELD GENERATION ---
        // VQOL represents H and V polarization as complex numbers (real, imag)
        // We need E[|z|^2] = 1 according to the paper.
        let z_H = rand_complex_gaussian(&seed); // complex H mode
        let z_V = rand_complex_gaussian(&seed); // complex V mode

        // Scale by sigma_0
        let sigma0 = sqrt(config.z);
        let a_H = sigma0 * z_H;
        let a_V = sigma0 * z_V;

        // --- CALCULATION (DARK COUNT SCENARIO) ---
        // In this simple test, we don't add laser power, we just measure 
        // the straight zero-point field crossing the threshold (gamma).
        
        // Intensity/magnitude squared for each mode
        let mag_sq_H = a_H.x * a_H.x + a_H.y * a_H.y;
        let mag_sq_V = a_V.x * a_V.x + a_V.y * a_V.y;

        let gamma_sq = config.y * config.y;

        // VQOL Threshold detector logic (Eqn 8)
        if (mag_sq_H > gamma_sq || mag_sq_V > gamma_sq) {
            atomicAdd(&results, 1u);
        }
    }
  `;

  const shaderModule = device.createShaderModule({ code: wgslCode });

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  });

  // Config buffer: [numSamples, gamma, sigma_0^2, seed]
  const configArray = new Float32Array([numSamples, GAMMA, SIGMA_0_SQ, Math.abs(Math.random() * 100000)]);
  const configBuffer = device.createBuffer({
    size: configArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(configBuffer, 0, configArray);

  // Result buffer: [count]
  const resultBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // zero out result just in case
  device.queue.writeBuffer(resultBuffer, 0, new Uint32Array([0]));

  // Staging buffer to read back
  const readBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: configBuffer } },
      { binding: 1, resource: { buffer: resultBuffer } },
    ],
  });

  // Encode
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(computePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  // workgroup size is 64
  passEncoder.dispatchWorkgroups(Math.ceil(numSamples / 64));
  passEncoder.end();

  // Copy result
  commandEncoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, 4);

  console.log(`[VQOL Math] Firing ${numSamples.toLocaleString()} uniform WebGPU quantum trajectories...`);
  const startTime = performance.now();
  device.queue.submit([commandEncoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const endTime = performance.now();
  
  const output = new Uint32Array(readBuffer.getMappedRange());
  const clicks = output[0];
  readBuffer.unmap();

  // --- ANALYTICAL VALIDATION ---
  // According to Eqn. 12 & 14 in the paper, dark count probability parameter delta:
  const gamma_sq = GAMMA * GAMMA;
  const term = Math.exp(-gamma_sq / SIGMA_0_SQ);  // e^(-gamma^2 / sigma0^2)
  const exact_delta = 1.0 - Math.pow(1.0 - term, 2);

  const empirical_delta = clicks / numSamples;
  const timeMs = (endTime - startTime).toFixed(2);

  console.log(`[VQOL Math] Complete in ${timeMs}ms.`);
  console.log(`[VQOL Math] WebGPU Clicks: ${clicks}`);
  console.log(`[VQOL Math] Empiric Prob:  ${empirical_delta.toFixed(6)}`);
  console.log(`[VQOL Math] Exact Formula: ${exact_delta.toFixed(6)} (VQOL Paper Eqn 14)`);
  
  const errorMargin = Math.abs(empirical_delta - exact_delta) / exact_delta * 100;
  console.log(`[VQOL Math] Margin of Error: ${errorMargin.toFixed(3)}%`);

  if (errorMargin < 2.0) {
      console.log(`✅ VERIFIED: WebGPU Monte Carlo pipeline correctly reproduces VQOL Quantum Math!`);
  }

  return true;
}
