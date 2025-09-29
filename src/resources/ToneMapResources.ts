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

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.presentationFormat = simulator.presentationFormat;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {
		const [width, height] = [this.canvas.width, this.canvas.height];
		if (
			width != this.lastDims.width ||
			height != this.lastDims.height ||
			!!!this.toneMapPipeline ||
			!!!this.toneParamBuffer ||
			!!!this.toneMapSampler ||
			!!!this.toneMapBindGroup
		) {
			this.createToneMapPipeline();
			this.createToneParamBuffer();
			this.createToneMapSampler();
			this.createToneMapBindGroup(this.resources().hdrResources, this.resources().bloomResources, width, height);
		}
		this.lastDims = { width, height };
	}

	createToneMapPipeline() {
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
	}

	createToneParamBuffer() {
		this.toneParamBuffer = this.device.createBuffer({
			size: 36, // 9 floats
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateToneParamBuffer();
	}

	updateToneParamBuffer() {
		if (!!!this.toneParamBuffer) this.createToneParamBuffer();
		this.device.queue.writeBuffer(
			this.toneParamBuffer!,
			0,
			new Float32Array([
				this.galaxy().exposure,
				this.galaxy().saturation,
				this.galaxy().bloomIntensity,
				this.galaxy().shadowLift,
				this.galaxy().minLiftThreshold,
				this.galaxy().toneMapToe,
				this.galaxy().toneMapHighlights,
				this.galaxy().toneMapMidtones,
				this.galaxy().toneMapShoulder,
			])
		);
	}

	createToneMapSampler() {
		this.toneMapSampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
	}

	createToneMapBindGroup(hdrResources: HDRResources, bloomResources: BloomResources, width: number, height: number) {
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
