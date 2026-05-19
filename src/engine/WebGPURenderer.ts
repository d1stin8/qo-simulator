/**
 * WebGPURenderer.ts
 * High-performance WebGPU renderer for the Screen component's interference pattern.
 * Compiles a custom WGSL shader to compute and draw the fringes in parallel on the GPU.
 * Falls back to 2D canvas if WebGPU is unavailable.
 */

const WGSL_CODE = `
struct VertexOutput {
  @builtin(position) Position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  var pos = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0)
  );
  var uv = array<vec2f, 4>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0)
  );
  var output : VertexOutput;
  output.Position = vec4f(pos[VertexIndex], 0.0, 1.0);
  output.uv = uv[VertexIndex];
  return output;
}

struct ScreenParams {
  wavelength: f32,
  max_intensity: f32,
  resolution: f32,
  padding: f32,
  intensities: array<vec4f, 64>, // 64 vec4f = 256 floats
};

@group(0) @binding(0) var<uniform> params : ScreenParams;

fn get_intensity(idx: u32) -> f32 {
  let vec_idx = idx / 4u;
  let component = idx % 4u;
  let v = params.intensities[vec_idx];
  if (component == 0u) { return v.x; }
  if (component == 1u) { return v.y; }
  if (component == 2u) { return v.z; }
  return v.w;
}

fn wavelength_to_rgb(wl: f32) -> vec3f {
  var r = 0.0;
  var g = 0.0;
  var b = 0.0;
  
  if (wl >= 380.0 && wl <= 440.0) {
    r = -(wl - 440.0) / (440.0 - 380.0);
    b = 1.0;
  } else if (wl > 440.0 && wl <= 490.0) {
    g = (wl - 440.0) / (490.0 - 440.0);
    b = 1.0;
  } else if (wl > 490.0 && wl <= 510.0) {
    g = 1.0;
    b = -(wl - 510.0) / (510.0 - 490.0);
  } else if (wl > 510.0 && wl <= 580.0) {
    r = (wl - 510.0) / (580.0 - 510.0);
    g = 1.0;
  } else if (wl > 580.0 && wl <= 645.0) {
    r = 1.0;
    g = -(wl - 645.0) / (645.0 - 580.0);
  } else if (wl > 645.0 && wl <= 780.0) {
    r = 1.0;
  } else {
    r = 0.8;
    g = 0.3;
    b = 1.0;
  }
  
  var fac = 1.0;
  if (wl < 420.0) {
    fac = 0.3 + 0.7 * (wl - 380.0) / 40.0;
  } else if (wl > 700.0) {
    fac = 0.3 + 0.7 * (780.0 - wl) / 80.0;
  }
  
  return vec3f(r * fac, g * fac, b * fac);
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4f {
  let x = input.uv.x;
  let y = input.uv.y;
  
  let res = params.resolution;
  let idx_float = x * (res - 1.0);
  let idx_lower = u32(clamp(floor(idx_float), 0.0, res - 1.0));
  let idx_upper = u32(clamp(ceil(idx_float), 0.0, res - 1.0));
  let t = fract(idx_float);
  
  let val_lower = get_intensity(idx_lower);
  let val_upper = get_intensity(idx_upper);
  let val = mix(val_lower, val_upper, t);
  
  if (params.max_intensity <= 0.0) {
    return vec4f(0.02, 0.02, 0.08, 1.0);
  }
  
  let norm = pow(clamp(val / params.max_intensity, 0.0, 1.0), 0.5);
  let rgb = wavelength_to_rgb(params.wavelength);
  
  // Vertical beam envelope
  let v_profile = smoothstep(0.0, 0.15, y) * smoothstep(1.0, 0.85, y);
  let final_color = rgb * norm * v_profile;
  
  let bg = vec3f(0.02, 0.02, 0.08);
  return vec4f(mix(bg, final_color, norm * v_profile), 1.0);
}
`;

export class WebGPUScreenRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private context: GPUCanvasContext;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    const context = canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Could not get WebGPU context");
    }
    this.context = context as unknown as GPUCanvasContext;

    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'opaque'
    });

    const shaderModule = device.createShaderModule({
      code: WGSL_CODE
    });

    // 1040 bytes uniform buffer: 4 floats header, 256 floats intensities
    this.uniformBuffer = device.createBuffer({
      size: 1040,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" }
        }
      ]
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        }
      ]
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main"
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat()
          }
        ]
      },
      primitive: {
        topology: "triangle-strip"
      }
    });
  }

  render(intensities: Float32Array, wavelength: number) {
    let maxI = 0.0;
    for (let i = 0; i < intensities.length; i++) {
      if (intensities[i] > maxI) {
        maxI = intensities[i];
      }
    }

    const arrayBuffer = new ArrayBuffer(1040);
    const floatView = new Float32Array(arrayBuffer);
    floatView[0] = wavelength;
    floatView[1] = maxI;
    floatView[2] = intensities.length;
    floatView[3] = 0.0; // padding

    for (let i = 0; i < intensities.length; i++) {
      floatView[4 + i] = intensities[i];
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, arrayBuffer);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.02, g: 0.02, b: 0.08, a: 1.0 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(4);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
