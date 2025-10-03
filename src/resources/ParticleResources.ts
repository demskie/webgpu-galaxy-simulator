import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import particleVertShader from "../shaders/core/particle.vert.wgsl";
import particleFragShader from "../shaders/core/particle.frag.wgsl";
import particleNoOverdrawFragShader from "../shaders/core/particle.nooverdraw.frag.wgsl";
import { CountOverdrawResources } from "./CountOverdrawResources";
import { UNIFORM_LAYOUT } from "../constants/uniformLayout";

// Uses shared UNIFORM_LAYOUT

export class ParticleResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	resources: () => ResourceManager;

	// Uniform buffer containing view/projection matrices and galaxy parameters.
	uniformBuffer: GPUBuffer | null = null;

	// Vertex buffer with quad geometry for particle billboards.
	quadVertexBuffer: GPUBuffer | null = null;

	// Temporary ArrayBuffer for staging uniform data before GPU upload.
	readonly uniformDataArray = new ArrayBuffer(UNIFORM_LAYOUT.totalSize);

	// Cached DataView to avoid allocations in updateUniforms()
	readonly cachedUniformDataView = new DataView(this.uniformDataArray);

	// Cached Float32Array view to avoid allocations in updateUniforms()
	readonly cachedUniformF32Array = new Float32Array(this.uniformDataArray);

	// Storage buffer holding particle positions and attributes.
	particleStorageBuffer: GPUBuffer | null = null;

	// Bind groups and layouts
	particleBindGroupLayout: GPUBindGroupLayout | null = null;
	particleBindGroupLayoutNoOverdraw: GPUBindGroupLayout | null = null;
	particleBindGroup: GPUBindGroup | null = null;
	particleBindGroupNoOverdraw: GPUBindGroup | null = null;

	// Pipeline layouts
	particlePipelineLayout: GPUPipelineLayout | null = null;
	particlePipelineLayoutNoOverdraw: GPUPipelineLayout | null = null;

	// Render pipelines
	particlePipeline: GPURenderPipeline | null = null;
	particlePipelineNoOverdraw: GPURenderPipeline | null = null;

	private lastDims = { width: -1, height: -1 };
	private lastOverdrawDisabled: boolean | null = null;
	private lastParticleStorageBuffer: GPUBuffer | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.resources = () => simulator.resources;
	}

	setup() {
		if (!!!this.uniformBuffer) this.createUniformBuffer();
		if (!!!this.quadVertexBuffer) this.createQuadVertexBuffer();
		if (!!!this.particleStorageBuffer) this.createParticleStorageBuffer();
		if (!!!this.particleBindGroupLayout) this.createParticleBindGroupLayout();
		if (!!!this.particleBindGroupLayoutNoOverdraw) this.createParticleBindGroupLayoutNoOverdraw();
		if (!!!this.particlePipelineLayout) this.createParticlePipelineLayout();
		if (!!!this.particlePipelineLayoutNoOverdraw) this.createParticlePipelineLayoutNoOverdraw();
		if (!!!this.particlePipeline) this.createParticlePipeline();
		if (!!!this.particlePipelineNoOverdraw) this.createParticlePipelineNoOverdraw();

		const [width, height] = [this.canvas.width, this.canvas.height];
		const dimsChanged = width != this.lastDims.width || height != this.lastDims.height;
		const overdrawDisabled = this.resources().galaxy().maxOverdraw >= 4096;
		const overdrawModeChanged = this.lastOverdrawDisabled === null || overdrawDisabled !== this.lastOverdrawDisabled;
		const storageChanged = this.particleStorageBuffer !== this.lastParticleStorageBuffer;

		this.resources().countOverdrawResources.setup();

		if (overdrawDisabled) {
			this.particleBindGroup = null;
			if (overdrawModeChanged || storageChanged || !!!this.particleBindGroupNoOverdraw)
				this.createParticleBindGroupNoOverdraw();
		} else {
			this.particleBindGroupNoOverdraw = null;
			if (overdrawModeChanged || dimsChanged || storageChanged || !!!this.particleBindGroup)
				this.createParticleBindGroup(this.resources().countOverdrawResources, width, height);
		}

		this.lastDims = { width, height };
		this.lastOverdrawDisabled = overdrawDisabled;
		this.lastParticleStorageBuffer = this.particleStorageBuffer;
	}

	getUniformBuffer = () => this.uniformBuffer ?? this.createUniformBuffer();
	getQuadVertexBuffer = () => this.quadVertexBuffer ?? this.createQuadVertexBuffer();
	getParticleStorageBuffer = () => this.particleStorageBuffer ?? this.createParticleStorageBuffer();
	getParticleBindGroupLayout = () => this.particleBindGroupLayout ?? this.createParticleBindGroupLayout();
	getParticleBindGroupLayoutNoOverdraw = () => this.particleBindGroupLayoutNoOverdraw ?? this.createParticleBindGroupLayoutNoOverdraw(); // prettier-ignore
	getParticleBindGroup = () => this.particleBindGroup ?? this.createParticleBindGroup(this.resources().countOverdrawResources, this.canvas.width, this.canvas.height); // prettier-ignore
	getParticleBindGroupNoOverdraw = () => this.particleBindGroupNoOverdraw ?? this.createParticleBindGroupNoOverdraw(); // prettier-ignore
	getParticlePipelineLayout = () => this.particlePipelineLayout ?? this.createParticlePipelineLayout();
	getParticlePipelineLayoutNoOverdraw = () => this.particlePipelineLayoutNoOverdraw ?? this.createParticlePipelineLayoutNoOverdraw(); // prettier-ignore
	getParticlePipeline = () => this.particlePipeline ?? this.createParticlePipeline();
	getParticlePipelineNoOverdraw = () => this.particlePipelineNoOverdraw ?? this.createParticlePipelineNoOverdraw();

	createUniformBuffer(): GPUBuffer {
		this.uniformBuffer?.destroy();
		this.uniformBuffer = this.device.createBuffer({
			size: UNIFORM_LAYOUT.totalSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		return this.uniformBuffer;
	}

	createQuadVertexBuffer(): GPUBuffer {
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

	createParticleStorageBuffer(): GPUBuffer {
		this.particleStorageBuffer?.destroy();
		// Allocate a minimal non-zero buffer to satisfy bind group validation.
		// Will be resized later by ParticleRenderer.allocateEmptyBuffer().
		const minimalStride = 48; // bytes per particle
		this.particleStorageBuffer = this.device.createBuffer({
			size: minimalStride,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
		});
		return this.particleStorageBuffer;
	}

	createParticleBindGroupLayout(): GPUBindGroupLayout {
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

	createParticleBindGroupLayoutNoOverdraw(): GPUBindGroupLayout {
		this.particleBindGroupLayoutNoOverdraw = this.device.createBindGroupLayout({
			label: "particleBindGroupLayoutNoOverdraw",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
				{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
			],
		});
		return this.particleBindGroupLayoutNoOverdraw;
	}

	createParticleBindGroup(countOverdrawResources: CountOverdrawResources, width: number, height: number): GPUBindGroup {
		if (!!!this.particleBindGroupLayout) this.createParticleBindGroupLayout();
		if (!!!this.uniformBuffer) this.createUniformBuffer();
		if (!!!this.particleStorageBuffer) this.createParticleStorageBuffer();
		if (!!!countOverdrawResources.overdrawCountBuffer) countOverdrawResources.createOverdrawCountBuffer(width, height);
		this.particleBindGroup = this.device.createBindGroup({
			label: "particleBindGroup",
			layout: this.particleBindGroupLayout!,
			entries: [
				{ binding: 0, resource: { buffer: this.uniformBuffer! } },
				{ binding: 1, resource: { buffer: this.particleStorageBuffer! } },
				{ binding: 2, resource: { buffer: countOverdrawResources.overdrawCountBuffer! } },
			],
		});
		return this.particleBindGroup;
	}

	createParticleBindGroupNoOverdraw(): GPUBindGroup {
		if (!!!this.particleBindGroupLayoutNoOverdraw) this.createParticleBindGroupLayoutNoOverdraw();
		if (!!!this.uniformBuffer) this.createUniformBuffer();
		if (!!!this.particleStorageBuffer) this.createParticleStorageBuffer();
		this.particleBindGroupNoOverdraw = this.device.createBindGroup({
			label: "particleBindGroupNoOverdraw",
			layout: this.particleBindGroupLayoutNoOverdraw!,
			entries: [
				{ binding: 0, resource: { buffer: this.uniformBuffer! } },
				{ binding: 1, resource: { buffer: this.particleStorageBuffer! } },
			],
		});
		return this.particleBindGroupNoOverdraw;
	}

	createParticlePipelineLayout(): GPUPipelineLayout {
		if (!!!this.particleBindGroupLayout) this.createParticleBindGroupLayout();
		this.particlePipelineLayout = this.device.createPipelineLayout({
			label: "particlePipelineLayout",
			bindGroupLayouts: [this.particleBindGroupLayout!],
		});
		return this.particlePipelineLayout;
	}

	createParticlePipelineLayoutNoOverdraw(): GPUPipelineLayout {
		if (!!!this.particleBindGroupLayoutNoOverdraw) this.createParticleBindGroupLayoutNoOverdraw();
		this.particlePipelineLayoutNoOverdraw = this.device.createPipelineLayout({
			label: "particlePipelineLayoutNoOverdraw",
			bindGroupLayouts: [this.particleBindGroupLayoutNoOverdraw!],
		});
		return this.particlePipelineLayoutNoOverdraw;
	}

	createParticlePipeline(): GPURenderPipeline {
		if (!!!this.particlePipelineLayout) this.createParticlePipelineLayout();
		this.particlePipeline = this.device.createRenderPipeline({
			label: "particlePipeline",
			layout: this.particlePipelineLayout!,
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

	createParticlePipelineNoOverdraw(): GPURenderPipeline {
		if (!!!this.particlePipelineLayoutNoOverdraw) this.createParticlePipelineLayoutNoOverdraw();
		this.particlePipelineNoOverdraw = this.device.createRenderPipeline({
			label: "particlePipelineNoOverdraw",
			layout: this.particlePipelineLayoutNoOverdraw!,
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
