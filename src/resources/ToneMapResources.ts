import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";
import { HDRResources } from "./HDRResources";
import { BloomResources } from "./BloomResources";

import tonemapFragWGSL from "../shaders/postprocessing/tonemap.frag.wgsl";
import fullscreenVertWGSL from "../shaders/postprocessing/fullscreen.vert.wgsl";

export class ToneMapResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	presentationFormat: GPUTextureFormat;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	toneMapPipeline: GPURenderPipeline | null = null;
	toneParamBuffer: GPUBuffer | null = null;
	toneMapSampler: GPUSampler | null = null;
	toneMapBindGroup: GPUBindGroup | null = null;

	private lastDims = { width: -1, height: -1 };
	private readonly cachedToneParams = new Float32Array(9);
	private readonly lastToneParams = new Float32Array(9);
	private toneParamsInitialized = false;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.presentationFormat = simulator.presentationFormat;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {
		const [width, height] = [this.canvas.width, this.canvas.height];
		if (!!!this.toneMapPipeline) this.createToneMapPipeline();
		if (!!!this.toneParamBuffer) this.createToneParamBuffer();
		if (!!!this.toneMapSampler) this.createToneMapSampler();
		if (!!!this.toneMapBindGroup || width != this.lastDims.width || height != this.lastDims.height) {
			this.createToneMapBindGroup(this.resources().hdrResources, this.resources().bloomResources, width, height);
		}

		this.updateToneParamBuffer();
		this.lastDims = { width, height };
	}

	getToneMapPipeline = () => this.toneMapPipeline ?? this.createToneMapPipeline();
	getToneParamBuffer = () => this.toneParamBuffer ?? this.createToneParamBuffer();
	getToneMapSampler = () => this.toneMapSampler ?? this.createToneMapSampler();
	getToneMapBindGroup = () => this.toneMapBindGroup ?? this.createToneMapBindGroup(this.resources().hdrResources, this.resources().bloomResources, this.canvas.width, this.canvas.height); // prettier-ignore

	createToneMapPipeline(): GPURenderPipeline {
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
			],
		});
		this.toneMapPipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: { module: this.device.createShaderModule({ code: fullscreenVertWGSL }), entryPoint: "main" },
			fragment: {
				module: this.device.createShaderModule({ code: tonemapFragWGSL }),
				entryPoint: "main",
				targets: [{ format: this.presentationFormat }],
			},
			primitive: { topology: "triangle-list" },
		});
		return this.toneMapPipeline;
	}

	createToneParamBuffer(): GPUBuffer {
		this.toneParamBuffer = this.device.createBuffer({
			size: 36, // 9 floats
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.toneParamsInitialized = false;
		this.updateToneParamBuffer();
		return this.toneParamBuffer;
	}

	updateToneParamBuffer(): GPUBuffer {
		if (!!!this.toneParamBuffer) this.createToneParamBuffer();
		this.populateToneParams(this.cachedToneParams);
		if (!this.toneParamsInitialized || this.toneParamsChanged()) {
			this.device.queue.writeBuffer(this.toneParamBuffer!, 0, this.cachedToneParams);
			this.lastToneParams.set(this.cachedToneParams);
			this.toneParamsInitialized = true;
		}
		return this.toneParamBuffer!;
	}

	createToneMapSampler(): GPUSampler {
		this.toneMapSampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
		return this.toneMapSampler;
	}

	createToneMapBindGroup(
		hdrResources: HDRResources,
		bloomResources: BloomResources,
		width: number,
		height: number
	): GPUBindGroup {
		if (!!!this.toneMapPipeline) this.createToneMapPipeline();
		if (!!!this.toneMapSampler) this.createToneMapSampler();
		if (!!!this.toneParamBuffer) this.createToneParamBuffer();
		if (!!!hdrResources.hdrTextureView) hdrResources.createHDRTextureView(width, height);
		if (!!!bloomResources.bloomTextureView1) bloomResources.createBloomTextures(width, height);
		this.toneMapBindGroup = this.device.createBindGroup({
			layout: this.toneMapPipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.toneMapSampler! },
				{ binding: 1, resource: hdrResources.hdrTextureView! },
				{ binding: 2, resource: { buffer: this.toneParamBuffer! } },
				{ binding: 3, resource: bloomResources.bloomTextureView1! },
			],
		});
		return this.toneMapBindGroup!;
	}

	private populateToneParams(target: Float32Array) {
		target[0] = this.galaxy().exposure;
		target[1] = this.galaxy().saturation;
		target[2] = this.galaxy().bloomIntensity;
		target[3] = this.galaxy().shadowLift;
		target[4] = this.galaxy().minLiftThreshold;
		target[5] = this.galaxy().toneMapToe;
		target[6] = this.galaxy().toneMapHighlights;
		target[7] = this.galaxy().toneMapMidtones;
		target[8] = this.galaxy().toneMapShoulder;
	}

	private toneParamsChanged(): boolean {
		if (!this.toneParamsInitialized) return true;
		for (let i = 0; i < this.cachedToneParams.length; i++) {
			if (this.cachedToneParams[i] !== this.lastToneParams[i]) return true;
		}
		return false;
	}

	destroy() {
		console.log("🔴 Destroying tone map resources");
		this.toneParamBuffer?.destroy();
		this.toneParamBuffer = null;
		this.toneMapPipeline = null;
		this.toneMapBindGroup = null;
		this.toneMapSampler = null;
	}
}
