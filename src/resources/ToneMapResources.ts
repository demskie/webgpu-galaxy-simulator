import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import tonemapFragWGSL from "../shaders/postprocessing/tonemap.frag.wgsl";
import fullscreenVertWGSL from "../shaders/postprocessing/fullscreen.vert.wgsl";

export class ToneMapResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	presentationFormat: GPUTextureFormat;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	private toneMapPipeline: GPURenderPipeline | null = null;
	private toneParamBuffer: GPUBuffer | null = null;
	private toneMapSampler: GPUSampler | null = null;
	private toneMapBindGroup: GPUBindGroup | null = null;

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
		this.updateToneParamBuffer();
	}

	markBloomTexturesDirty() {
		this.toneMapBindGroup = null;
	}

	////////////////////////////////////////////////////////////

	getToneMapPipeline = () => this.toneMapPipeline ?? this.createToneMapPipeline();

	private createToneMapPipeline(): GPURenderPipeline {
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
			],
		});
		this.toneMapPipeline = this.device.createRenderPipeline({
			label: "toneMapPipeline",
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

	////////////////////////////////////////////////////////////

	getToneParamBuffer = () => this.toneParamBuffer ?? this.createToneParamBuffer();

	private createToneParamBuffer(): GPUBuffer {
		this.toneParamBuffer = this.device.createBuffer({
			label: "toneParamBuffer",
			size: 36, // 9 floats
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.toneParamsInitialized = false;
		this.updateToneParamBuffer();
		return this.toneParamBuffer;
	}

	updateToneParamBuffer(): GPUBuffer {
		this.toneParamBuffer = this.getToneParamBuffer();
		this.populateToneParams(this.cachedToneParams);
		if (!this.toneParamsInitialized || this.toneParamsChanged()) {
			this.device.queue.writeBuffer(this.toneParamBuffer, 0, this.cachedToneParams);
			this.lastToneParams.set(this.cachedToneParams);
			this.toneParamsInitialized = true;
		}
		return this.toneParamBuffer;
	}

	////////////////////////////////////////////////////////////

	getToneMapSampler = () => this.toneMapSampler ?? this.createToneMapSampler();

	private createToneMapSampler(): GPUSampler {
		this.toneMapSampler = this.device.createSampler({
			label: "toneMapSampler",
			magFilter: "linear",
			minFilter: "linear",
		});
		return this.toneMapSampler;
	}

	////////////////////////////////////////////////////////////

	getToneMapBindGroup = (width: number, height: number) =>
		!!!this.toneMapBindGroup ||
		this.lastToneMapBindGroupDims.width !== width ||
		this.lastToneMapBindGroupDims.height !== height
			? this.createToneMapBindGroup(width, height)
			: this.toneMapBindGroup;

	private createToneMapBindGroup(width: number, height: number): GPUBindGroup {
		this.toneMapBindGroup = this.device.createBindGroup({
			label: "toneMapBindGroup",
			layout: this.getToneMapPipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.getToneMapSampler() },
				{ binding: 1, resource: this.resources().hdrResources.getHDRTextureView(width, height) },
				{ binding: 2, resource: { buffer: this.getToneParamBuffer() } },
				{ binding: 3, resource: this.resources().bloomResources.getBloomTextures(width, height).bloomTextureView1 },
			],
		});
		return this.toneMapBindGroup;
	}

	private lastToneMapBindGroupDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

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

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying tone map resources");
		this.toneParamBuffer?.destroy();
		this.toneParamBuffer = null;
		this.toneMapPipeline = null;
		this.toneMapBindGroup = null;
		this.toneMapSampler = null;
	}
}
