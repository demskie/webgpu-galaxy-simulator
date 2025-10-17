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
	private accumTextureArray: GPUTexture | null = null;

	// Array of views for individual layers in the accumulation texture array.
	private accumLayerViews: GPUTextureView[] | null = null;

	// View of the entire accumulation texture array for sampling.
	private accumArrayView: GPUTextureView | null = null;

	// Current write index in the accumulation ring buffer.
	private accumWriteIndex = 0;

	// Render pipeline for averaging accumulated frames.
	private accumAveragePipeline: GPURenderPipeline | null = null;

	// Buffer holding weights for averaging accumulated frames (16 floats).
	private accumWeightsBuffer: GPUBuffer | null = null;

	// Bind group for accumulation averaging.
	private accumAverageBindGroup: GPUBindGroup | null = null;

	// flag to force clearing accumulation layers on next setup
	private forceClearRequested = false;
	private weightsInitialized = false;
	private readonly cachedWeights = new Float32Array(16);
	private readonly lastWeights = new Float32Array(16);
	private lastResolvedTemporalAccumulation: number;
	private lastEffectiveAccumulation: number;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.accumulator = () => simulator.accumulator;
		this.resources = () => simulator.resources;
		this.lastResolvedTemporalAccumulation = snapToPowerOfTwo(simulator.galaxy.temporalAccumulation);
		this.lastEffectiveAccumulation = this.accumulator().getEffectiveTemporalAccumulation();
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getAccumTextureArray = (width: number, height: number) =>
		!!!this.accumTextureArray ||
		this.lastAccumTextureArrayDims.width !== width ||
		this.lastAccumTextureArrayDims.height !== height
			? this.createAccumTextureArray(width, height)
			: this.accumTextureArray;

	private createAccumTextureArray(width: number, height: number): GPUTexture {
		console.log("🔴 Creating accumulation texture array");
		this.accumTextureArray?.destroy();
		this.accumTextureArray = this.device.createTexture({
			label: `accumulation texture array (${width}x${height})`,
			size: { width, height, depthOrArrayLayers: 16 },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		this.lastAccumTextureArrayDims = { width, height };
		return this.accumTextureArray;
	}

	private lastAccumTextureArrayDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getAccumLayerViews = (width: number, height: number) =>
		!!!this.accumLayerViews ||
		this.lastAccumLayerViewsDims.width !== width ||
		this.lastAccumLayerViewsDims.height !== height
			? this.createAccumLayerViews(width, height)
			: this.accumLayerViews;

	private createAccumLayerViews(width: number, height: number): GPUTextureView[] {
		console.log("🔴 Creating accumulation layer views");
		this.accumLayerViews = [];
		for (let i = 0; i < 16; i++) {
			this.accumLayerViews.push(
				this.getAccumTextureArray(width, height).createView({
					label: `accumulation layer view ${i} (${width}x${height})`,
					dimension: "2d",
					baseArrayLayer: i,
					arrayLayerCount: 1,
				})
			);
		}
		this.lastAccumLayerViewsDims = { width, height };
		return this.accumLayerViews;
	}

	private lastAccumLayerViewsDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getAccumArrayView = (width: number, height: number) =>
		!!!this.accumArrayView ||
		this.lastAccumArrayViewDims.width !== width ||
		this.lastAccumArrayViewDims.height !== height
			? this.createAccumArrayView(width, height)
			: this.accumArrayView;

	private createAccumArrayView(width: number, height: number): GPUTextureView {
		console.log("🔴 Creating accumulation array view");
		this.accumArrayView = this.getAccumTextureArray(width, height).createView({
			label: `accumulation array view (${width}x${height})`,
			dimension: "2d-array",
			baseArrayLayer: 0,
			arrayLayerCount: 16,
		});
		this.lastAccumArrayViewDims = { width, height };
		return this.accumArrayView;
	}

	private lastAccumArrayViewDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getAccumAveragePipeline = () => this.accumAveragePipeline ?? this.createAccumAveragePipeline();

	private createAccumAveragePipeline(): GPURenderPipeline {
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
			label: `accumulation averaging bind group layout`,
			entries: bindGroupLayoutEntries,
		});
		this.accumAveragePipeline = this.device.createRenderPipeline({
			label: `accumulation averaging pipeline`,
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
		return this.accumAveragePipeline;
	}

	////////////////////////////////////////////////////////////

	getAccumWeightsBuffer = () => this.accumWeightsBuffer ?? this.createAccumWeightsBuffer();

	private createAccumWeightsBuffer(): GPUBuffer {
		console.log("🔴 Creating accumulation weights buffer");
		this.accumWeightsBuffer?.destroy();
		this.accumWeightsBuffer = this.device.createBuffer({
			label: `accumulation weights buffer`,
			size: 64, // 16 * 4 bytes
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.weightsInitialized = false;
		this.updateWeightsBuffer();
		return this.accumWeightsBuffer;
	}

	////////////////////////////////////////////////////////////

	getAccumAverageBindGroup = (width: number, height: number) =>
		!!!this.accumAverageBindGroup ||
		this.lastAccumAverageBindGroupDims.width !== width ||
		this.lastAccumAverageBindGroupDims.height !== height
			? this.createAccumAverageBindGroup(width, height)
			: this.accumAverageBindGroup;

	private createAccumAverageBindGroup(width: number, height: number): GPUBindGroup {
		console.log("🔴 Creating accumulation averaging bind group");
		this.accumAverageBindGroup = this.device.createBindGroup({
			label: `accumulation averaging bind group ${width}x${height}`,
			layout: this.getAccumAveragePipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.resources().toneMapResources.getToneMapSampler() },
				{ binding: 1, resource: this.getAccumArrayView(width, height) },
				{ binding: 2, resource: { buffer: this.getAccumWeightsBuffer() } },
			],
		});
		this.lastAccumAverageBindGroupDims = { width, height };
		return this.accumAverageBindGroup;
	}

	private lastAccumAverageBindGroupDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getCurrentAccumLayerView = (width: number, height: number) =>
		this.getAccumLayerViews(width, height)[this.accumWriteIndex];

	getAccumWriteIndex = () => this.accumWriteIndex;

	advanceAccumWriteIndex = () => (this.accumWriteIndex = (this.accumWriteIndex + 1) % 16);

	private prepareAccumulationState(width: number, height: number) {
		const sizeChanged =
			width !== this.lastAccumTextureArrayDims.width || height !== this.lastAccumTextureArrayDims.height;

		this.getAccumTextureArray(width, height);
		this.getAccumLayerViews(width, height);
		this.getAccumArrayView(width, height);

		const targetAccumulation = snapToPowerOfTwo(this.galaxy().temporalAccumulation);
		const effectiveAccumulation = this.accumulator().getEffectiveTemporalAccumulation();
		let shouldClear = this.forceClearRequested || sizeChanged;

		// Check if target accumulation changed (e.g., user changed the value)
		if (targetAccumulation !== this.lastResolvedTemporalAccumulation) {
			this.lastResolvedTemporalAccumulation = targetAccumulation;
			this.accumWriteIndex = 0;
			shouldClear = true;
			this.accumAverageBindGroup = null;
			this.weightsInitialized = false;
			this.accumulator().updateLastTemporalAccumulation(targetAccumulation);
		}

		// Check if effective accumulation changed (e.g., one-frame override activated/deactivated)
		// This handles transitions between normal accumulation and override mode
		if (effectiveAccumulation !== this.lastEffectiveAccumulation) {
			this.lastEffectiveAccumulation = effectiveAccumulation;
			this.accumWriteIndex = 0;
			this.accumAverageBindGroup = null;
			this.weightsInitialized = false;
			// Don't clear layers for override changes, just reset state
		}

		if (sizeChanged) {
			this.accumWriteIndex = 0;
			this.weightsInitialized = false;
		}

		if (shouldClear) {
			// Reset accumulation state before clearing
			this.weightsInitialized = false;

			// Clear accumulation layers
			this.clearAccumulationLayers(width, height);

			// Reset write index when clearing
			this.accumWriteIndex = 0;

			this.forceClearRequested = false;
		}

		this.getAccumAverageBindGroup(width, height);
	}

	updateWeightsBuffer() {
		const width = this.canvas.width;
		const height = this.canvas.height;

		// Check if effective accumulation changed before preparing state
		const effectiveAccumulation = this.accumulator().getEffectiveTemporalAccumulation();
		const effectiveAccumulationChanged = effectiveAccumulation !== this.lastEffectiveAccumulation;

		// Force weights recalculation if effective accumulation changed
		if (effectiveAccumulationChanged) {
			this.weightsInitialized = false;
		}

		// Prepare accumulation state FIRST (may reset framesSinceBufferClear)
		this.prepareAccumulationState(width, height);

		// Then calculate weights based on current state
		this.populateWeights(this.cachedWeights);
		if (!this.weightsInitialized || this.weightsChanged()) {
			this.device.queue.writeBuffer(this.getAccumWeightsBuffer(), 0, this.cachedWeights);
			this.lastWeights.set(this.cachedWeights);
			this.weightsInitialized = true;
		}

		// Update the accumulator with the target accumulation value, not the effective value
		const targetAccumulation = snapToPowerOfTwo(this.galaxy().temporalAccumulation);
		this.accumulator().updateLastTemporalAccumulation(targetAccumulation);
	}

	requestForceClear() {
		this.forceClearRequested = true;
	}

	private populateWeights(target: Float32Array) {
		target.fill(0);
		const n = this.accumulator().getEffectiveTemporalAccumulation();

		// Distribute weight equally across N most recent frames
		// Total weight = 16 to maintain brightness consistency
		if (n > 0) {
			const sliceWeight = 16 / n;
			for (let i = 0; i < n; i++) {
				const idx = (this.accumWriteIndex - i + 16) & 15;
				target[idx] = sliceWeight;
			}
		}
	}

	private weightsChanged(): boolean {
		if (!this.weightsInitialized) return true;
		for (let i = 0; i < this.cachedWeights.length; i++) {
			if (this.cachedWeights[i] !== this.lastWeights[i]) return true;
		}
		return false;
	}

	clearAccumulationLayers(width: number, height: number) {
		console.log("🔴 Clearing accumulation layers");
		const clearEncoder = this.device.createCommandEncoder();
		for (let i = 0; i < 16; i++) {
			const clearPass = clearEncoder.beginRenderPass({
				label: `accumulation clear pass ${i} (${width}x${height})`,
				colorAttachments: [
					{
						view: this.getAccumLayerViews(width, height)[i],
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

	////////////////////////////////////////////////////////////

	getAccumulationAveragingPipeline = () => this.accumAveragePipeline ?? this.createAccumulationAveragingPipeline();

	private createAccumulationAveragingPipeline(): GPURenderPipeline {
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
			label: `accumulation averaging bind group layout`,
			entries: bindGroupLayoutEntries,
		});
		this.accumAveragePipeline = this.device.createRenderPipeline({
			label: `accumulation averaging pipeline`,
			layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: {
				module: this.device.createShaderModule({
					label: "accumulation averaging vertex shader",
					code: fullscreenVertWGSL,
				}),
				entryPoint: "main",
			},
			fragment: {
				module: this.device.createShaderModule({
					label: "accumulation averaging fragment shader",
					code: accumAverageFragWGSL,
				}),
				entryPoint: "main",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
		return this.accumAveragePipeline;
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying accumulation resources");
		this.accumTextureArray?.destroy();
		this.accumArrayView = null;
		this.accumWeightsBuffer?.destroy();
		this.accumAveragePipeline = null;
		this.accumAverageBindGroup = null;
		this.accumLayerViews = null;
		this.accumWriteIndex = 0;
		this.lastEffectiveAccumulation = 0;
	}
}
