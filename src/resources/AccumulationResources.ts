import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { AccumulationManager } from "../managers/AccumulationManager";
import { ResourceManager } from "../managers/ResourceManager";
import { snapToPowerOfTwo } from "../utils/Powers";

import fullscreenVertWGSL from "../shaders/postprocessing/fullscreen.vert.wgsl";
import accumAverageFragWGSL from "../shaders/postprocessing/accum.average.frag.wgsl";

export class AccumulationResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	accumulator: () => AccumulationManager;
	resources: () => ResourceManager;

	// Texture array for temporal accumulation (multiple frames for averaging).
	accumTextureArray: GPUTexture | null = null;

	// Array of views for individual layers in the accumulation texture array.
	accumLayerViews: GPUTextureView[] | null = null;

	// View of the entire accumulation texture array for sampling.
	accumArrayView: GPUTextureView | null = null;

	// Current write index in the accumulation ring buffer.
	accumWriteIndex = 0;

	// Render pipeline for averaging accumulated frames.
	accumAveragePipeline: GPURenderPipeline | null = null;

	// Buffer holding weights for averaging accumulated frames (16 floats).
	accumWeightsBuffer: GPUBuffer | null = null;

	// Bind group for accumulation averaging.
	accumAverageBindGroup: GPUBindGroup | null = null;

	// track last dimensions for reuse optimization
	private lastDims = { width: -1, height: -1 };

	// flag to force clearing accumulation layers on next setup
	private forceClearRequested = false;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.accumulator = () => simulator.accumulator;
		this.resources = () => simulator.resources;
	}

	setup() {
		const width = this.canvas.width;
		const height = this.canvas.height;
		const dimsChanged = this.lastDims.width !== width || this.lastDims.height !== height;
		if (!!!this.accumTextureArray || !!!this.accumLayerViews || !!!this.accumArrayView || dimsChanged) {
			this.createAccumTextureArray(width, height);
			this.createAccumLayerViews(width, height);
			this.createAccumArrayView(width, height);
		}

		const n = snapToPowerOfTwo(this.galaxy().temporalAccumulation);
		const lastTemporalAccumulation = this.accumulator().getLastTemporalAccumulation();

		// Update accumulation count and clear accumulation layers if changed or forced
		if (n !== lastTemporalAccumulation || this.forceClearRequested) {
			// Reset write index when accumulation changes or when force clearing
			this.accumWriteIndex = 0;

			// Clear all accumulation layers when changing accumulation or force clearing to prevent ghosting
			this.clearAccumulationLayers(width, height);

			// Notify accumulator that buffers were cleared
			this.accumulator().resetFramesSinceBufferClear();

			if (n !== lastTemporalAccumulation) {
				// Update AccumulationManager with the new value
				this.accumulator().updateLastTemporalAccumulation(n);
				// Force recreation of bind groups after pipeline change
				this.resources().setup();
			}

			// Clear the force flag once applied
			this.forceClearRequested = false;
		}

		if (!!!this.accumAveragePipeline) this.createAccumulationAveragingPipeline();
		if (!!!this.accumWeightsBuffer) this.createAccumWeightsBuffer();
		if (!!!this.accumAverageBindGroup || dimsChanged) this.createAccumAverageBindGroup(width, height);

		this.lastDims = { width, height };
	}

	requestForceClear() {
		this.forceClearRequested = true;
	}

	createAccumTextureArray(width: number, height: number) {
		console.log("🔴 Creating accumulation texture array (EXPENSIVE!)");
		this.accumTextureArray?.destroy();
		this.accumTextureArray = this.device.createTexture({
			size: { width, height, depthOrArrayLayers: 16 },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
	}

	createAccumLayerViews(width: number, height: number) {
		if (!!!this.accumTextureArray) this.createAccumTextureArray(width, height);
		this.accumLayerViews = [];
		for (let i = 0; i < 16; i++) {
			this.accumLayerViews.push(
				this.accumTextureArray!.createView({
					dimension: "2d",
					baseArrayLayer: i,
					arrayLayerCount: 1,
				})
			);
		}
	}

	createAccumArrayView(width: number, height: number) {
		if (!!!this.accumTextureArray) this.createAccumTextureArray(width, height);
		this.accumArrayView = this.accumTextureArray!.createView({
			dimension: "2d-array",
			baseArrayLayer: 0,
			arrayLayerCount: 16,
		});
	}

	createAccumAveragePipeline() {
		console.log("🔴 Creating accumulation averaging pipeline (EXPENSIVE!)");
		const bindGroupLayoutEntries: GPUBindGroupLayoutEntry[] = [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float", viewDimension: "2d-array" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		];
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: bindGroupLayoutEntries,
		});
		this.accumAveragePipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: {
				module: this.device.createShaderModule({ code: fullscreenVertWGSL }),
				entryPoint: "main",
			},
			fragment: {
				module: this.device.createShaderModule({ code: accumAverageFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	createAccumWeightsBuffer() {
		this.accumWeightsBuffer?.destroy();
		this.accumWeightsBuffer = this.device.createBuffer({
			size: 64, // 16 * 4 bytes
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	createAccumAverageBindGroup(width: number, height: number) {
		if (!!!this.resources().toneMapResources.toneMapSampler)
			return console.error("Tone map sampler not ready for accumulation average bind group creation.");
		if (!!!this.accumAveragePipeline) this.createAccumAveragePipeline();
		if (!!!this.accumArrayView) this.createAccumArrayView(width, height);
		if (!!!this.accumWeightsBuffer) this.createAccumWeightsBuffer();
		this.accumAverageBindGroup = this.device.createBindGroup({
			layout: this.accumAveragePipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.resources().toneMapResources.toneMapSampler! },
				{ binding: 1, resource: this.accumArrayView! },
				{ binding: 2, resource: { buffer: this.accumWeightsBuffer! } },
			],
		});
	}

	clearAccumulationLayers(width: number, height: number) {
		if (!!!this.accumLayerViews) this.createAccumLayerViews(width, height);
		const clearEncoder = this.device.createCommandEncoder();
		for (let i = 0; i < 16; i++) {
			const clearPass = clearEncoder.beginRenderPass({
				colorAttachments: [
					{
						view: this.accumLayerViews![i],
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			clearPass.end();
		}
		this.device.queue.submit([clearEncoder.finish()]);
	}

	createAccumulationAveragingPipeline() {
		console.log("🔴 Creating accumulation averaging pipeline");
		const bindGroupLayoutEntries: GPUBindGroupLayoutEntry[] = [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float", viewDimension: "2d-array" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		];
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: bindGroupLayoutEntries,
		});
		this.accumAveragePipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: {
				module: this.device.createShaderModule({ code: fullscreenVertWGSL }),
				entryPoint: "main",
			},
			fragment: {
				module: this.device.createShaderModule({ code: accumAverageFragWGSL }),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	destroy() {
		console.log("🔴 Destroying accumulation resources");
		this.accumTextureArray?.destroy();
		this.accumArrayView = null;
		this.accumWeightsBuffer?.destroy();
		this.accumAveragePipeline = null;
		this.accumAverageBindGroup = null;
		this.accumLayerViews = null;
		this.accumWriteIndex = 0;
	}
}
