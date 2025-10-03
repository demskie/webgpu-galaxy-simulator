import { Galaxy } from "../entities/Galaxy"
import { GalaxySimulator } from "../GalaxySimulator"
import { AccumulationManager } from "../managers/AccumulationManager"
import { ResourceManager } from "../managers/ResourceManager"
import { snapToPowerOfTwo } from "../utils/Powers"

import fullscreenVertWGSL from "../shaders/postprocessing/fullscreen.vert.wgsl"
import accumAverageFragWGSL from "../shaders/postprocessing/accum.average.frag.wgsl"

export class AccumulationResources {
	device: GPUDevice
	canvas: HTMLCanvasElement
	galaxy: () => Galaxy
	accumulator: () => AccumulationManager
	resources: () => ResourceManager

	// Texture array for temporal accumulation (multiple frames for averaging).
	accumTextureArray: GPUTexture | null = null

	// Array of views for individual layers in the accumulation texture array.
	accumLayerViews: GPUTextureView[] | null = null

	// View of the entire accumulation texture array for sampling.
	accumArrayView: GPUTextureView | null = null

	// Current write index in the accumulation ring buffer.
	accumWriteIndex = 0

	// Render pipeline for averaging accumulated frames.
	accumAveragePipeline: GPURenderPipeline | null = null

	// Buffer holding weights for averaging accumulated frames (16 floats).
	accumWeightsBuffer: GPUBuffer | null = null

	// Bind group for accumulation averaging.
	accumAverageBindGroup: GPUBindGroup | null = null

	// track last dimensions for reuse optimization
	private lastDims = { width: -1, height: -1 }

	// flag to force clearing accumulation layers on next setup
	private forceClearRequested = false
	private weightsInitialized = false
	private readonly cachedWeights = new Float32Array(16)
	private readonly lastWeights = new Float32Array(16)
	private clearedSinceUpdate = true

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device
		this.canvas = simulator.canvas
		this.galaxy = () => simulator.galaxy
		this.accumulator = () => simulator.accumulator
		this.resources = () => simulator.resources
	}

	setup() {
		const width = this.canvas.width
		const height = this.canvas.height
		const dimsChanged = this.lastDims.width !== width || this.lastDims.height !== height
		if (!!!this.accumTextureArray || !!!this.accumLayerViews || !!!this.accumArrayView || dimsChanged) {
			this.createAccumTextureArray(width, height)
			this.createAccumLayerViews(width, height)
			this.createAccumArrayView(width, height)
		}

		const n = snapToPowerOfTwo(this.galaxy().temporalAccumulation)
		const lastTemporalAccumulation = this.accumulator().getLastTemporalAccumulation()

		// Update accumulation count and clear accumulation layers if changed or forced
		if (n !== lastTemporalAccumulation || this.forceClearRequested) {
			// Reset write index when accumulation changes or when force clearing
			this.accumWriteIndex = 0

			// Clear all accumulation layers when changing accumulation or force clearing to prevent ghosting
			this.clearAccumulationLayers(width, height)

			// Notify accumulator that buffers were cleared
			this.accumulator().resetFramesSinceBufferClear()

			if (n !== lastTemporalAccumulation) {
				// Update AccumulationManager with the new value
				this.accumulator().updateLastTemporalAccumulation(n)
				// Recreate local bind groups that depend on accumulation state
				this.createAccumAverageBindGroup(width, height)
			}

			// Clear the force flag once applied
			this.forceClearRequested = false
			this.clearedSinceUpdate = true
		}

		if (!!!this.accumAveragePipeline) this.createAccumulationAveragingPipeline()
		if (!!!this.accumWeightsBuffer) this.createAccumWeightsBuffer()
		if (!!!this.accumAverageBindGroup || dimsChanged) this.createAccumAverageBindGroup(width, height)

		this.updateWeightsBuffer()

		this.lastDims = { width, height }
	}

	getAccumTextureArray = () => this.accumTextureArray ?? this.createAccumTextureArray(this.canvas.width, this.canvas.height); // prettier-ignore
	getAccumLayerViews = () => this.accumLayerViews ?? this.createAccumLayerViews(this.canvas.width, this.canvas.height)
	getAccumArrayView = () => this.accumArrayView ?? this.createAccumArrayView(this.canvas.width, this.canvas.height)
	getAccumAveragePipeline = () => this.accumAveragePipeline ?? this.createAccumulationAveragingPipeline()
	getAccumWeightsBuffer = () => this.accumWeightsBuffer ?? this.createAccumWeightsBuffer()
	getAccumAverageBindGroup = () => this.accumAverageBindGroup ?? this.createAccumAverageBindGroup(this.canvas.width, this.canvas.height); // prettier-ignore

	requestForceClear() {
		this.forceClearRequested = true
		this.clearedSinceUpdate = true
	}

	createAccumTextureArray(width: number, height: number): GPUTexture {
		console.log("🔴 Creating accumulation texture array (EXPENSIVE!)")
		this.accumTextureArray?.destroy()
		this.accumTextureArray = this.device.createTexture({
			size: { width, height, depthOrArrayLayers: 16 },
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		})
		return this.accumTextureArray
	}

	createAccumLayerViews(width: number, height: number): GPUTextureView[] {
		if (!!!this.accumTextureArray) this.createAccumTextureArray(width, height)
		this.accumLayerViews = []
		for (let i = 0; i < 16; i++) {
			this.accumLayerViews.push(
				this.accumTextureArray!.createView({
					dimension: "2d",
					baseArrayLayer: i,
					arrayLayerCount: 1,
				})
			)
		}
		return this.accumLayerViews
	}

	createAccumArrayView(width: number, height: number): GPUTextureView {
		if (!!!this.accumTextureArray) this.createAccumTextureArray(width, height)
		this.accumArrayView = this.accumTextureArray!.createView({
			dimension: "2d-array",
			baseArrayLayer: 0,
			arrayLayerCount: 16,
		})
		return this.accumArrayView
	}

	createAccumAveragePipeline(): GPURenderPipeline {
		console.log("🔴 Creating accumulation averaging pipeline (EXPENSIVE!)")
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
		]
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: bindGroupLayoutEntries,
		})
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
		})
		return this.accumAveragePipeline
	}

	createAccumWeightsBuffer(): GPUBuffer {
		this.accumWeightsBuffer?.destroy()
		this.accumWeightsBuffer = this.device.createBuffer({
			size: 64, // 16 * 4 bytes
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.weightsInitialized = false
		this.updateWeightsBuffer()
		return this.accumWeightsBuffer
	}

	createAccumAverageBindGroup(width: number, height: number): GPUBindGroup {
		const tone = this.resources().toneMapResources
		if (!!!tone.toneMapSampler) tone.createToneMapSampler()
		if (!!!this.accumAveragePipeline) this.createAccumAveragePipeline()
		if (!!!this.accumArrayView) this.createAccumArrayView(width, height)
		if (!!!this.accumWeightsBuffer) this.createAccumWeightsBuffer()
		this.accumAverageBindGroup = this.device.createBindGroup({
			layout: this.accumAveragePipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: tone.toneMapSampler! },
				{ binding: 1, resource: this.accumArrayView! },
				{ binding: 2, resource: { buffer: this.accumWeightsBuffer! } },
			],
		})
		return this.accumAverageBindGroup
	}

	updateWeightsBuffer(): GPUBuffer {
		if (!!!this.accumWeightsBuffer) return this.createAccumWeightsBuffer()
		this.populateWeights(this.cachedWeights)
		if (!this.weightsInitialized || this.weightsChanged()) {
			this.device.queue.writeBuffer(this.accumWeightsBuffer!, 0, this.cachedWeights)
			this.lastWeights.set(this.cachedWeights)
			this.weightsInitialized = true
		}
		this.clearedSinceUpdate = false
		this.accumulator().updateLastTemporalAccumulation(this.accumulator().getEffectiveTemporalAccumulation())
		return this.accumWeightsBuffer
	}

	private populateWeights(target: Float32Array) {
		target.fill(0)
		const n = this.accumulator().getEffectiveTemporalAccumulation()
		const framesSinceBufferClear = this.accumulator().getFramesSinceBufferClear()
		const validFrameBudget = this.clearedSinceUpdate ? Math.min(1, framesSinceBufferClear) : framesSinceBufferClear
		if (n >= 1) {
			const validFrames = Math.min(n, validFrameBudget)
			if (validFrames > 0) {
				const sliceWeight = 16 / validFrames
				for (let i = 0; i < validFrames; i++) {
					const idx = (this.accumWriteIndex - i + 16) & 15
					target[idx] = sliceWeight
				}
			}
		}
	}

	private weightsChanged(): boolean {
		if (!this.weightsInitialized) return true
		for (let i = 0; i < this.cachedWeights.length; i++) {
			if (this.cachedWeights[i] !== this.lastWeights[i]) return true
		}
		return false
	}

	clearAccumulationLayers(width: number, height: number) {
		if (!!!this.accumLayerViews) this.createAccumLayerViews(width, height)
		const clearEncoder = this.device.createCommandEncoder()
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
			})
			clearPass.end()
		}
		this.device.queue.submit([clearEncoder.finish()])
	}

	createAccumulationAveragingPipeline(): GPURenderPipeline {
		console.log("🔴 Creating accumulation averaging pipeline")
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
		]
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: bindGroupLayoutEntries,
		})
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
		})
		return this.accumAveragePipeline
	}

	destroy() {
		console.log("🔴 Destroying accumulation resources")
		this.accumTextureArray?.destroy()
		this.accumArrayView = null
		this.accumWeightsBuffer?.destroy()
		this.accumAveragePipeline = null
		this.accumAverageBindGroup = null
		this.accumLayerViews = null
		this.accumWriteIndex = 0
	}
}
