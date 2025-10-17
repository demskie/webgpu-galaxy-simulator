import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";
import { ToneMapResources } from "./ToneMapResources";
import { HDRResources } from "./HDRResources";

import bloomExtractFragWGSL from "../shaders/postprocessing/bloom.extract.frag.wgsl";
import bloomBlurFragWGSL from "../shaders/postprocessing/bloom.blur.frag.wgsl";
import fullscreenVertWGSL from "../shaders/postprocessing/fullscreen.vert.wgsl";

export class BloomResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	// Pipelines
	private bloomExtractPipeline: GPURenderPipeline | null = null;
	private bloomBlurPipeline: GPURenderPipeline | null = null;

	// Textures and views (half resolution)
	private bloomTexture1: GPUTexture | null = null;
	private bloomTexture2: GPUTexture | null = null;
	private bloomTextureView1: GPUTextureView | null = null;
	private bloomTextureView2: GPUTextureView | null = null;

	// Uniform buffers
	private bloomParamsBuffer: GPUBuffer | null = null; // threshold
	private bloomBlurHParamsBuffer: GPUBuffer | null = null; // horizontal flag
	private bloomBlurVParamsBuffer: GPUBuffer | null = null; // vertical flag

	// Bind groups
	private bloomExtractBindGroup: GPUBindGroup | null = null;
	private bloomBlurHBindGroup: GPUBindGroup | null = null;
	private bloomBlurVBindGroup: GPUBindGroup | null = null;

	// track last dimensions for reuse optimization
	private readonly cachedBloomParams = new Float32Array(4);
	private bloomParamsInitialized = false;
	private lastBloomThreshold = Number.NaN;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getBloomExtractPipeline = () => this.bloomExtractPipeline ?? this.createBloomExtractPipeline();

	private createBloomExtractPipeline(): GPURenderPipeline {
		console.log("🔴 Creating bloom extract pipeline");
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});
		this.bloomExtractPipeline = this.device.createRenderPipeline({
			label: `bloom extract pipeline`,
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: { module: this.device.createShaderModule({ code: fullscreenVertWGSL }), entryPoint: "main" },
			fragment: {
				module: this.device.createShaderModule({ code: bloomExtractFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
		return this.bloomExtractPipeline;
	}

	////////////////////////////////////////////////////////////

	getBloomBlurPipeline = () => this.bloomBlurPipeline ?? this.createBloomBlurPipeline();

	private createBloomBlurPipeline(): GPURenderPipeline {
		console.log("🔴 Creating bloom blur pipeline");
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});
		this.bloomBlurPipeline = this.device.createRenderPipeline({
			label: `bloom blur pipeline`,
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: { module: this.device.createShaderModule({ code: fullscreenVertWGSL }), entryPoint: "main" },
			fragment: {
				module: this.device.createShaderModule({ code: bloomBlurFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
		return this.bloomBlurPipeline;
	}

	////////////////////////////////////////////////////////////

	getBloomTextures = (width: number, height: number) =>
		Math.floor(width / 2) == this.lastBloomTexturesDims.width &&
		Math.floor(height / 2) == this.lastBloomTexturesDims.height &&
		!!this.bloomTexture1 &&
		!!this.bloomTexture2 &&
		!!this.bloomTextureView1 &&
		!!this.bloomTextureView2
			? {
					bloomTexture1: this.bloomTexture1,
					bloomTexture2: this.bloomTexture2,
					bloomTextureView1: this.bloomTextureView1,
					bloomTextureView2: this.bloomTextureView2,
			  }
			: this.createBloomTextures(Math.floor(width / 2), Math.floor(height / 2));

	private createBloomTextures(
		width: number,
		height: number
	): {
		bloomTexture1: GPUTexture;
		bloomTexture2: GPUTexture;
		bloomTextureView1: GPUTextureView;
		bloomTextureView2: GPUTextureView;
	} {
		console.log(`🔴 Creating bloom textures ${width}x${height}`);
		this.bloomTexture1?.destroy();
		this.bloomTexture1 = this.device.createTexture({
			label: "bloom texture 1",
			size: { width, height },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.bloomTextureView1 = this.bloomTexture1.createView();
		this.bloomTexture2?.destroy();
		this.bloomTexture2 = this.device.createTexture({
			label: "bloom texture 2",
			size: { width, height },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.bloomTextureView2 = this.bloomTexture2.createView();
		this.bloomExtractBindGroup = null;
		this.bloomBlurHBindGroup = null;
		this.bloomBlurVBindGroup = null;
		try {
			this.resources().toneMapResources.markBloomTexturesDirty();
		} catch (error) {
			console.warn("Failed to notify tone map resources about bloom texture recreation", error);
		}
		this.lastBloomTexturesDims = { width, height };
		return {
			bloomTexture1: this.bloomTexture1,
			bloomTexture2: this.bloomTexture2,
			bloomTextureView1: this.bloomTextureView1,
			bloomTextureView2: this.bloomTextureView2,
		};
	}

	private lastBloomTexturesDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getBloomParamsBuffer = () => this.bloomParamsBuffer ?? this.createBloomParamsBuffer();

	private createBloomParamsBuffer(): GPUBuffer {
		console.log("🔴 Creating bloom params buffer");
		this.bloomParamsBuffer?.destroy();
		this.bloomParamsBuffer = this.device.createBuffer({
			label: `bloom params buffer`,
			size: 16, // vec4<f32>
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.bloomParamsInitialized = false;
		this.lastBloomThreshold = Number.NaN;
		this.updateBloomParamsBuffer();
		return this.bloomParamsBuffer;
	}

	updateBloomParamsBuffer(bloomThreshold?: number) {
		const threshold = bloomThreshold ?? this.galaxy().bloomThreshold;
		if (!this.bloomParamsInitialized || threshold !== this.lastBloomThreshold) {
			this.cachedBloomParams[0] = threshold;
			this.cachedBloomParams[1] = 0;
			this.cachedBloomParams[2] = 0;
			this.cachedBloomParams[3] = 0;
			this.device.queue.writeBuffer(this.getBloomParamsBuffer(), 0, this.cachedBloomParams);
			this.lastBloomThreshold = threshold;
			this.bloomParamsInitialized = true;
		}
	}

	////////////////////////////////////////////////////////////

	getBloomBlurHParamsBuffer = () => this.bloomBlurHParamsBuffer ?? this.createBloomBlurHParamsBuffer();

	private createBloomBlurHParamsBuffer(): GPUBuffer {
		console.log("🔴 Creating bloom blur h params buffer");
		this.bloomBlurHParamsBuffer?.destroy();
		this.bloomBlurHParamsBuffer = this.device.createBuffer({
			label: `bloom blur h params buffer`,
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.device.queue.writeBuffer(this.getBloomBlurHParamsBuffer(), 0, new Float32Array([1, 0, 0, 0]));
		return this.bloomBlurHParamsBuffer;
	}

	////////////////////////////////////////////////////////////

	getBloomBlurVParamsBuffer = () => this.bloomBlurVParamsBuffer ?? this.createBloomBlurVParamsBuffer();

	private createBloomBlurVParamsBuffer(): GPUBuffer {
		console.log("🔴 Creating bloom blur v params buffer");
		this.bloomBlurVParamsBuffer?.destroy();
		this.bloomBlurVParamsBuffer = this.device.createBuffer({
			label: "bloom blur v params buffer",
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.device.queue.writeBuffer(this.getBloomBlurVParamsBuffer(), 0, new Float32Array([0, 0, 0, 0]));
		return this.bloomBlurVParamsBuffer;
	}
	////////////////////////////////////////////////////////////

	getBloomExtractBindGroup = (width: number, height: number) =>
		!!!this.bloomExtractBindGroup ||
		this.lastBloomExtractBindGroupDims.width !== width ||
		this.lastBloomExtractBindGroupDims.height !== height
			? this.createBloomExtractBindGroup(width, height)
			: this.bloomExtractBindGroup;

	private createBloomExtractBindGroup(width: number, height: number): GPUBindGroup {
		console.log("🔴 Creating bloom extract bind group");
		this.bloomExtractBindGroup = this.device.createBindGroup({
			label: "bloom extract bind group",
			layout: this.getBloomExtractPipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.resources().toneMapResources.getToneMapSampler() },
				{ binding: 1, resource: this.resources().hdrResources.getHDRTextureView(width, height) },
				{ binding: 2, resource: { buffer: this.getBloomParamsBuffer() } },
			],
		});
		this.lastBloomExtractBindGroupDims = { width, height };
		return this.bloomExtractBindGroup;
	}

	private lastBloomExtractBindGroupDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getBloomBlurBindGroups = (width: number, height: number) =>
		width == this.lastBloomBlurBindGroupsDims.width &&
		height == this.lastBloomBlurBindGroupsDims.height &&
		!!this.bloomBlurHBindGroup &&
		!!this.bloomBlurVBindGroup
			? { bloomBlurHBindGroup: this.bloomBlurHBindGroup, bloomBlurVBindGroup: this.bloomBlurVBindGroup }
			: this.createBloomBlurBindGroups(width, height);

	private createBloomBlurBindGroups(
		width: number,
		height: number
	): { bloomBlurHBindGroup: GPUBindGroup; bloomBlurVBindGroup: GPUBindGroup } {
		console.log("🔴 Creating bloom blur bind groups");
		this.bloomBlurHBindGroup = this.device.createBindGroup({
			label: "bloom blur h bind group",
			layout: this.getBloomBlurPipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.resources().toneMapResources.getToneMapSampler() },
				{ binding: 1, resource: this.getBloomTextures(width, height).bloomTextureView1 },
				{ binding: 2, resource: { buffer: this.getBloomBlurHParamsBuffer() } },
			],
		});
		this.bloomBlurVBindGroup = this.device.createBindGroup({
			label: "bloom blur v bind group",
			layout: this.getBloomBlurPipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.resources().toneMapResources.getToneMapSampler() },
				{ binding: 1, resource: this.getBloomTextures(width, height).bloomTextureView2 },
				{ binding: 2, resource: { buffer: this.getBloomBlurVParamsBuffer() } },
			],
		});
		this.lastBloomBlurBindGroupsDims = { width, height };
		return { bloomBlurHBindGroup: this.bloomBlurHBindGroup, bloomBlurVBindGroup: this.bloomBlurVBindGroup };
	}

	private lastBloomBlurBindGroupsDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying bloom resources");
		this.bloomTexture1?.destroy();
		this.bloomTexture2?.destroy();
		this.bloomParamsBuffer?.destroy();
		this.bloomBlurHParamsBuffer?.destroy();
		this.bloomBlurVParamsBuffer?.destroy();
		this.bloomTexture1 = null;
		this.bloomTexture2 = null;
		this.bloomTextureView1 = null;
		this.bloomTextureView2 = null;
		this.bloomParamsBuffer = null;
		this.bloomBlurHParamsBuffer = null;
		this.bloomBlurVParamsBuffer = null;
		this.bloomExtractPipeline = null;
		this.bloomBlurPipeline = null;
		this.bloomExtractBindGroup = null;
		this.bloomBlurHBindGroup = null;
		this.bloomBlurVBindGroup = null;
	}
}
