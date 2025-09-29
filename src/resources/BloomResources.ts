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
	bloomExtractPipeline: GPURenderPipeline | null = null;
	bloomBlurPipeline: GPURenderPipeline | null = null;

	// Textures and views (half resolution)
	bloomTexture1: GPUTexture | null = null;
	bloomTexture2: GPUTexture | null = null;
	bloomTextureView1: GPUTextureView | null = null;
	bloomTextureView2: GPUTextureView | null = null;

	// Uniform buffers
	bloomParamsBuffer: GPUBuffer | null = null; // threshold
	bloomBlurHParamsBuffer: GPUBuffer | null = null; // horizontal flag
	bloomBlurVParamsBuffer: GPUBuffer | null = null; // vertical flag

	// Bind groups
	bloomExtractBindGroup: GPUBindGroup | null = null;
	bloomBlurHBindGroup: GPUBindGroup | null = null;
	bloomBlurVBindGroup: GPUBindGroup | null = null;

	// track last dimensions for reuse optimization
	private lastDims = { width: -1, height: -1 };

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {
		const width = Math.floor(this.canvas.width / 2);
		const height = Math.floor(this.canvas.height / 2);
		const dimsChanged = width != this.lastDims.width || height != this.lastDims.height;
		if (
			width != this.lastDims.width ||
			height != this.lastDims.height ||
			!!!this.bloomTexture1 ||
			!!!this.bloomTexture2 ||
			!!!this.bloomTextureView1 ||
			!!!this.bloomTextureView2
		)
			this.createBloomTextures(width, height);

		if (!!!this.bloomParamsBuffer) this.createBloomParamsBuffer();
		this.updateBloomParamsBuffer(this.galaxy().bloomThreshold);

		if (!!!this.bloomBlurHParamsBuffer) this.createBloomBlurHParamsBuffer();
		if (!!!this.bloomBlurVParamsBuffer) this.createBloomBlurVParamsBuffer();
		if (!!!this.bloomExtractPipeline) this.createBloomExtractPipeline();
		if (!!!this.bloomBlurPipeline) this.createBloomBlurPipeline();

		// Ensure bind groups that reference textures/samplers are created or refreshed
		const toneMapResources = this.resources().toneMapResources;
		const hdrResources = this.resources().hdrResources;
		if (!!!this.bloomExtractBindGroup || dimsChanged) {
			this.createBloomExtractBindGroup(toneMapResources, hdrResources, this.canvas.width, this.canvas.height);
		}
		if (!!!this.bloomBlurHBindGroup || !!!this.bloomBlurVBindGroup || dimsChanged) {
			this.createBloomBlurBindGroups(toneMapResources, width, height);
		}

		this.lastDims = { width, height };
	}

	createBloomExtractPipeline() {
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});
		this.bloomExtractPipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: { module: this.device.createShaderModule({ code: fullscreenVertWGSL }), entryPoint: "main" },
			fragment: {
				module: this.device.createShaderModule({ code: bloomExtractFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	createBloomBlurPipeline() {
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});
		this.bloomBlurPipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: { module: this.device.createShaderModule({ code: fullscreenVertWGSL }), entryPoint: "main" },
			fragment: {
				module: this.device.createShaderModule({ code: bloomBlurFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	createBloomTextures(width: number, height: number) {
		console.log("🔴 Creating bloom textures (EXPENSIVE!)");
		this.bloomTexture1?.destroy();
		this.bloomTexture1 = this.device.createTexture({
			size: { width, height },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.bloomTextureView1 = this.bloomTexture1.createView();
		this.bloomTexture2?.destroy();
		this.bloomTexture2 = this.device.createTexture({
			size: { width, height },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.bloomTextureView2 = this.bloomTexture2.createView();
	}

	createBloomParamsBuffer() {
		this.bloomParamsBuffer = this.device.createBuffer({
			size: 16, // vec4<f32>
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateBloomParamsBuffer(this.galaxy().bloomThreshold);
	}

	updateBloomParamsBuffer(bloomThreshold: number) {
		if (!!!this.bloomParamsBuffer) return this.createBloomParamsBuffer();
		this.device.queue.writeBuffer(this.bloomParamsBuffer!, 0, new Float32Array([bloomThreshold, 0, 0, 0]));
	}

	createBloomBlurHParamsBuffer() {
		this.bloomBlurHParamsBuffer = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.device.queue.writeBuffer(this.bloomBlurHParamsBuffer, 0, new Float32Array([1, 0, 0, 0]));
	}

	createBloomBlurVParamsBuffer() {
		this.bloomBlurVParamsBuffer = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.device.queue.writeBuffer(this.bloomBlurVParamsBuffer, 0, new Float32Array([0, 0, 0, 0]));
	}

	createBloomExtractBindGroup(
		toneMapResources: ToneMapResources,
		hdrResources: HDRResources,
		width: number,
		height: number
	) {
		if (!!!this.bloomExtractPipeline) this.createBloomExtractPipeline();
		if (!!!this.bloomParamsBuffer) this.createBloomParamsBuffer();
		if (!!!toneMapResources.toneMapSampler) toneMapResources.createToneMapSampler();
		if (!!!hdrResources.hdrTextureView) hdrResources.createHDRTextureView(width, height);
		this.bloomExtractBindGroup = this.device.createBindGroup({
			layout: this.bloomExtractPipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: toneMapResources.toneMapSampler! },
				{ binding: 1, resource: hdrResources.hdrTextureView! },
				{ binding: 2, resource: { buffer: this.bloomParamsBuffer! } },
			],
		});
	}

	createBloomBlurBindGroups(toneMapResources: ToneMapResources, width: number, height: number) {
		if (!!!this.bloomBlurPipeline) this.createBloomBlurPipeline();
		if (!!!this.bloomBlurHParamsBuffer) this.createBloomBlurHParamsBuffer();
		if (!!!this.bloomBlurVParamsBuffer) this.createBloomBlurVParamsBuffer();
		if (!!!this.bloomTextureView1) this.createBloomTextures(width, height);
		if (!!!this.bloomTextureView2) this.createBloomTextures(width, height);
		if (!!!toneMapResources.toneMapSampler) toneMapResources.createToneMapSampler();
		this.bloomBlurHBindGroup = this.device.createBindGroup({
			layout: this.bloomBlurPipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: toneMapResources.toneMapSampler! },
				{ binding: 1, resource: this.bloomTextureView1! },
				{ binding: 2, resource: { buffer: this.bloomBlurHParamsBuffer! } },
			],
		});
		this.bloomBlurVBindGroup = this.device.createBindGroup({
			layout: this.bloomBlurPipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: toneMapResources.toneMapSampler! },
				{ binding: 1, resource: this.bloomTextureView2! },
				{ binding: 2, resource: { buffer: this.bloomBlurVParamsBuffer! } },
			],
		});
	}

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
