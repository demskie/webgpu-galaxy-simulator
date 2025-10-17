import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import particleVertShader from "../shaders/core/particle.vert.wgsl";
import particleFragShader from "../shaders/core/particle.frag.wgsl";
import particleNoOverdrawFragShader from "../shaders/core/particle.nooverdraw.frag.wgsl";
import { UNIFORM_LAYOUT } from "../constants/uniformLayout";

export class ParticleResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	resources: () => ResourceManager;

	// Uniform buffer containing view/projection matrices and galaxy parameters.
	private uniformBuffer: GPUBuffer | null = null;

	// Vertex buffer with quad geometry for particle billboards.
	private quadVertexBuffer: GPUBuffer | null = null;

	// Storage buffer holding particle positions and attributes.
	private particleStorageBuffer: GPUBuffer | null = null;

	// Bind groups and layouts
	private particleBindGroupLayout: GPUBindGroupLayout | null = null;
	private particleBindGroupLayoutNoOverdraw: GPUBindGroupLayout | null = null;
	private particleBindGroup: GPUBindGroup | null = null;
	private particleBindGroupNoOverdraw: GPUBindGroup | null = null;

	// Pipeline layouts
	private particlePipelineLayout: GPUPipelineLayout | null = null;
	private particlePipelineLayoutNoOverdraw: GPUPipelineLayout | null = null;

	// Render pipelines
	private particlePipeline: GPURenderPipeline | null = null;
	private particlePipelineNoOverdraw: GPURenderPipeline | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getUniformBuffer = () => this.uniformBuffer ?? this.createUniformBuffer();

	private createUniformBuffer(): GPUBuffer {
		console.log("🔴 Creating uniform buffer");
		this.uniformBuffer?.destroy();
		this.uniformBuffer = this.device.createBuffer({
			label: "uniformBuffer",
			size: UNIFORM_LAYOUT.totalSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		return this.uniformBuffer;
	}

	////////////////////////////////////////////////////////////

	getQuadVertexBuffer = () => this.quadVertexBuffer ?? this.createQuadVertexBuffer();

	private createQuadVertexBuffer(): GPUBuffer {
		console.log("🔴 Creating quad vertex buffer");
		this.quadVertexBuffer?.destroy();
		// Precompute offsets for quad vertices (2 triangles -> 6 vertices)
		// (0,0), (1,0), (0,1), (1,0), (1,1), (0,1) -> corresponds to vertex_index 0..5
		const quadVertices = new Float32Array([
			-0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
			//
			0.5, -0.5, -0.5, 0.5, 0.5, 0.5,
		]);
		const quadVertexBuffer = this.device.createBuffer({
			label: "quadVertexBuffer",
			size: quadVertices.byteLength,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Float32Array(quadVertexBuffer.getMappedRange()).set(quadVertices);
		quadVertexBuffer.unmap();
		this.quadVertexBuffer = quadVertexBuffer;
		return quadVertexBuffer;
	}

	////////////////////////////////////////////////////////////

	getParticleStorageBuffer = (size?: number) =>
		!!!this.particleStorageBuffer || (size !== undefined && this.lastParticleStorageBufferSize !== size)
			? this.createParticleStorageBuffer(size)
			: this.particleStorageBuffer;

	private createParticleStorageBuffer(size?: number): GPUBuffer {
		console.log(`🔴 Creating particle storage buffer - Size: ${size ?? this.lastParticleStorageBufferSize} bytes`);
		const previousBuffer = this.particleStorageBuffer;
		this.particleBindGroup = null;
		this.particleBindGroupNoOverdraw = null;
		const minimalStride = 48; // bytes per particle - minimal non-zero buffer to satisfy bind group validation.
		const actualSize = Math.max(size ?? this.lastParticleStorageBufferSize, minimalStride);
		this.particleStorageBuffer = this.device.createBuffer({
			label: "particleStorageBuffer",
			size: actualSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
		});
		this.lastParticleStorageBufferSize = actualSize;
		if (previousBuffer) {
			this.device.queue
				.onSubmittedWorkDone()
				.then(() => previousBuffer.destroy())
				.catch((error) => {
					console.warn("Failed to destroy previous particle storage buffer", error);
				});
		}
		return this.particleStorageBuffer;
	}

	private lastParticleStorageBufferSize = 0;

	////////////////////////////////////////////////////////////

	getParticleBindGroupLayout = () => this.particleBindGroupLayout ?? this.createParticleBindGroupLayout();

	private createParticleBindGroupLayout(): GPUBindGroupLayout {
		console.log("🔴 Creating particle bind group layout");
		this.particleBindGroupLayout = this.device.createBindGroupLayout({
			label: "particleBindGroupLayout",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
				{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "storage" } },
			],
		});
		return this.particleBindGroupLayout;
	}

	////////////////////////////////////////////////////////////

	getParticleBindGroupLayoutNoOverdraw = () =>
		this.particleBindGroupLayoutNoOverdraw ?? this.createParticleBindGroupLayoutNoOverdraw();

	private createParticleBindGroupLayoutNoOverdraw(): GPUBindGroupLayout {
		console.log("🔴 Creating particle bind group layout no overdraw");
		this.particleBindGroupLayoutNoOverdraw = this.device.createBindGroupLayout({
			label: "particleBindGroupLayoutNoOverdraw",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
				{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
			],
		});
		return this.particleBindGroupLayoutNoOverdraw;
	}

	////////////////////////////////////////////////////////////

	getParticleBindGroup = (width: number, height: number) =>
		!!!this.particleBindGroup ||
		this.lastParticleBindGroupDims.width !== width ||
		this.lastParticleBindGroupDims.height !== height
			? this.createParticleBindGroup(width, height)
			: this.particleBindGroup;

	private createParticleBindGroup(width: number, height: number): GPUBindGroup {
		console.log("🔴 Creating particle bind group");
		this.particleBindGroup = this.device.createBindGroup({
			label: "particleBindGroup",
			layout: this.getParticleBindGroupLayout(),
			entries: [
				{ binding: 0, resource: { buffer: this.getUniformBuffer() } },
				{ binding: 1, resource: { buffer: this.getParticleStorageBuffer() } },
				{
					binding: 2,
					resource: { buffer: this.resources().countOverdrawResources.getOverdrawCountBuffer(width, height) },
				},
			],
		});
		this.lastParticleBindGroupDims = { width, height };
		return this.particleBindGroup;
	}

	private lastParticleBindGroupDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getParticleBindGroupNoOverdraw = () => this.particleBindGroupNoOverdraw ?? this.createParticleBindGroupNoOverdraw();

	private createParticleBindGroupNoOverdraw(): GPUBindGroup {
		console.log("🔴 Creating particle bind group no overdraw");
		this.particleBindGroupNoOverdraw = this.device.createBindGroup({
			label: "particleBindGroupNoOverdraw",
			layout: this.getParticleBindGroupLayoutNoOverdraw(),
			entries: [
				{ binding: 0, resource: { buffer: this.getUniformBuffer() } },
				{ binding: 1, resource: { buffer: this.getParticleStorageBuffer() } },
			],
		});
		return this.particleBindGroupNoOverdraw;
	}

	////////////////////////////////////////////////////////////

	getParticlePipelineLayout = () => this.particlePipelineLayout ?? this.createParticlePipelineLayout();

	private createParticlePipelineLayout(): GPUPipelineLayout {
		console.log("🔴 Creating particle pipeline layout");
		this.particlePipelineLayout = this.device.createPipelineLayout({
			label: "particlePipelineLayout",
			bindGroupLayouts: [this.getParticleBindGroupLayout()],
		});
		return this.particlePipelineLayout;
	}

	////////////////////////////////////////////////////////////

	getParticlePipelineLayoutNoOverdraw = () =>
		this.particlePipelineLayoutNoOverdraw ?? this.createParticlePipelineLayoutNoOverdraw();

	private createParticlePipelineLayoutNoOverdraw(): GPUPipelineLayout {
		console.log("🔴 Creating particle pipeline layout no overdraw");
		this.particlePipelineLayoutNoOverdraw = this.device.createPipelineLayout({
			label: "particlePipelineLayoutNoOverdraw",
			bindGroupLayouts: [this.getParticleBindGroupLayoutNoOverdraw()],
		});
		return this.particlePipelineLayoutNoOverdraw;
	}

	////////////////////////////////////////////////////////////

	getParticlePipeline = () => this.particlePipeline ?? this.createParticlePipeline();

	private createParticlePipeline(): GPURenderPipeline {
		console.log("🔴 Creating particle pipeline");
		this.particlePipeline = this.device.createRenderPipeline({
			label: "particlePipeline",
			layout: this.getParticlePipelineLayout(),
			vertex: {
				module: this.device.createShaderModule({ code: particleVertShader }),
				entryPoint: "main",
				buffers: [
					{
						arrayStride: 2 * 4, // 2 floats, 4 bytes each for vertex positions
						attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
					},
				],
			},
			fragment: {
				module: this.device.createShaderModule({ code: particleFragShader }),
				entryPoint: "main",
				targets: [
					{
						format: "rgba16float",
						blend: {
							color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
							alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
						},
					},
				],
			},
			primitive: { topology: "triangle-list" },
			multisample: { count: 4 }, // Enable 4x MSAA
		});
		return this.particlePipeline;
	}

	////////////////////////////////////////////////////////////

	getParticlePipelineNoOverdraw = () => this.particlePipelineNoOverdraw ?? this.createParticlePipelineNoOverdraw();

	private createParticlePipelineNoOverdraw(): GPURenderPipeline {
		console.log("🔴 Creating particle pipeline no overdraw");
		this.particlePipelineNoOverdraw = this.device.createRenderPipeline({
			label: "particlePipelineNoOverdraw",
			layout: this.getParticlePipelineLayoutNoOverdraw(),
			vertex: {
				module: this.device.createShaderModule({ code: particleVertShader }),
				entryPoint: "main",
				buffers: [
					{
						arrayStride: 2 * 4,
						attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
					},
				],
			},
			fragment: {
				module: this.device.createShaderModule({ code: particleNoOverdrawFragShader }),
				entryPoint: "main",
				targets: [
					{
						format: "rgba16float",
						blend: {
							color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
							alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
						},
					},
				],
			},
			primitive: { topology: "triangle-list" },
			multisample: { count: 4 },
		});
		return this.particlePipelineNoOverdraw;
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying particle resources");
		this.uniformBuffer?.destroy();
		this.quadVertexBuffer?.destroy();
		this.particleStorageBuffer?.destroy();
		this.uniformBuffer = null;
		this.quadVertexBuffer = null;
		this.particleStorageBuffer = null;
		this.particlePipeline = null;
		this.particlePipelineNoOverdraw = null;
		this.particlePipelineLayout = null;
		this.particlePipelineLayoutNoOverdraw = null;
		this.particleBindGroup = null;
		this.particleBindGroupNoOverdraw = null;
	}
}
