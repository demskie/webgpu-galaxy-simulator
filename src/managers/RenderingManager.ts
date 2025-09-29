import { Galaxy } from "../entities/Galaxy";
import { ResourceManager } from "./ResourceManager";
import { ParticleRenderer } from "../renderers/ParticleRenderer";
import { GalaxySimulator } from "../GalaxySimulator";
import { AccumulationManager } from "./AccumulationManager";
import { Particles } from "../compute/Particles";

// The Renderer class handles all GPU rendering operations for the galaxy simulation.
// It encapsulates the render pipeline execution, including star rendering, post-processing
// effects (bloom, tone mapping), temporal accumulation, and GPU timing. This separation
// allows the GalaxySimulator to focus on simulation logic while the Renderer manages
// the complex GPU command encoding and submission process.
export class RenderingManager {
	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly resources: () => ResourceManager;
	private readonly particleRenderer: () => ParticleRenderer;
	private readonly accumulator: () => AccumulationManager;
	private readonly particles: () => Particles;

	private frameCount = 0;

	// Temporary array for accumulation weights calculation.
	private readonly tmpWeights = new Float32Array(16);

	// Cached array for packed weights to avoid allocations in updateAccumulationWeights()
	private readonly cachedPackedWeights = new Float32Array(16);

	// Constructor initializes the renderer with required WebGPU objects and resources.
	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.context = simulator.context;
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("Resources must be initialized before RenderingManager");
			return simulator.resources;
		};
		this.particleRenderer = () => {
			if (!!!simulator.particleRenderer)
				throw new Error("ParticleRenderer must be initialized before RenderingManager");
			return simulator.particleRenderer;
		};
		this.accumulator = () => {
			if (!!!simulator.accumulator) throw new Error("Accumulator must be initialized before RenderingManager");
			return simulator.accumulator;
		};
		this.particles = () => {
			if (!!!simulator.particles) throw new Error("Particles must be initialized before RenderingManager");
			return simulator.particles;
		};
	}

	// Returns the number of frames rendered
	public getFrameCount(): number {
		return this.frameCount;
	}

	// Main render method that executes the complete rendering pipeline for one frame.
	// This includes star rendering, post-processing effects, and final presentation.
	// Returns true if rendering was successful, false if resources weren't ready.
	public render(galaxy: Galaxy, isReadingTimingResults: boolean, particleUpdateNeeded: boolean = false): boolean {
		if (
			!!!this.device ||
			!!!this.context ||
			!!!this.particleRenderer ||
			!!!this.resources().msaaResources.msaaTextureView ||
			!!!this.resources().accumulationResources.accumTextureArray ||
			!!!this.resources().accumulationResources.accumLayerViews
		) {
			console.error("WebGPU resources not ready for rendering:", {
				device: !!this.device,
				context: !!this.context,
				particleRenderer: !!this.particleRenderer,
				msaaTextureView: !!this.resources().msaaResources.msaaTextureView,
				accumTextureArray: !!this.resources().accumulationResources.accumTextureArray,
				accumLayerViews: !!this.resources().accumulationResources.accumLayerViews,
			});
			return false;
		}

		// Check that particle data is available.
		const particleStorageBuffer = this.resources().particleResources.particleStorageBuffer;
		const starCount = galaxy.totalStarCount;
		if (!!!particleStorageBuffer || starCount === 0) {
			return false;
		}

		// Update accumulation weights for temporal averaging before encoding commands.
		this.updateAccumulationWeights();

		// Create command encoder for recording GPU commands.
		const commandEncoder = this.device.createCommandEncoder();
		const canvasTextureView = this.context.getCurrentTexture().createView();

		// Update particles if needed (batched with render commands)
		if (particleUpdateNeeded) {
			this.particles().update(commandEncoder);
		}

		// Clear overdraw count buffer before rendering to reset per-pixel overdraw counts.
		this.particleRenderer().clearOverdrawBuffer(commandEncoder);

		// Render stars to the current accumulation texture layer.
		this.renderStars(commandEncoder, starCount);

		// Average all accumulation textures into HDR texture for temporal smoothing.
		this.averageAccumulationTextures(commandEncoder);

		// Apply post-processing effects: bloom extraction, blur, and tone mapping.
		this.applyPostProcessing(commandEncoder, canvasTextureView);

		// Resolve GPU timing queries if available and not currently being read.
		this.resolveTimingQueries(commandEncoder, isReadingTimingResults);

		// Submit all recorded commands to the GPU for execution.
		this.device.queue.submit([commandEncoder.finish()]);

		this.frameCount++;

		return true;
	}

	// Render stars to the current accumulation texture layer. This is the main
	// rendering pass that draws all star particles using instanced rendering.
	// Supports both normal rendering and overdraw debug visualization.
	private renderStars(commandEncoder: GPUCommandEncoder, starCount: number) {
		if (!!!this.resources().accumulationResources.accumLayerViews) {
			const [width, height] = [this.resources().canvas.width, this.resources().canvas.height];
			this.resources().accumulationResources.createAccumLayerViews(width, height);
		}

		const index = this.resources().accumulationResources.accumWriteIndex;
		const currentAccumView = this.resources().accumulationResources.accumLayerViews![index];
		if (!!!currentAccumView) return console.error(`No accumulation view at index ${index}`);

		// Configure render pass with MSAA texture and accumulation layer as resolve target.
		const renderPassDescriptor: GPURenderPassDescriptor = {
			colorAttachments: [
				{
					view: this.resources().msaaResources.msaaTextureView!,
					resolveTarget: currentAccumView,
					clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
					loadOp: "clear", // Always clear the current slice
					storeOp: "store",
				},
			],
			timestampWrites: this.isAdvancedOptionsEnabled()
				? this.resources().performanceProfiler().getRenderPassTimestampWrites()
				: undefined,
		};

		const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

		// Delegate rendering to the particle renderer
		this.particleRenderer().render(passEncoder, starCount);

		passEncoder.end();

		// Advance ring buffer index for next frame.
		this.resources().accumulationResources.accumWriteIndex =
			(this.resources().accumulationResources.accumWriteIndex + 1) % 16;
	}

	// Average all active accumulation texture layers into the HDR texture.
	// This implements temporal accumulation by blending multiple frames together
	// with appropriate weights to reduce noise and create motion blur effects.
	private averageAccumulationTextures(commandEncoder: GPUCommandEncoder) {
		if (
			!!this.resources().accumulationResources.accumAveragePipeline &&
			!!this.resources().accumulationResources.accumAverageBindGroup &&
			!!this.resources().hdrResources.hdrTextureView
		) {
			const averagePass = commandEncoder.beginRenderPass({
				colorAttachments: [
					{
						view: this.resources().hdrResources.hdrTextureView!,
						clearValue: { r: 0, g: 0, b: 0, a: 1 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			averagePass.setPipeline(this.resources().accumulationResources.accumAveragePipeline!);
			averagePass.setBindGroup(0, this.resources().accumulationResources.accumAverageBindGroup);
			averagePass.draw(3, 1, 0, 0); // Fullscreen triangle
			averagePass.end();
		}
	}

	// Apply post-processing effects including bloom and tone mapping.
	// This is a multi-pass process: extract bright areas, blur horizontally,
	// blur vertically, then combine with tone mapping for final output.
	private applyPostProcessing(commandEncoder: GPUCommandEncoder, canvasTextureView: GPUTextureView) {
		// Bloom extraction pass - isolate bright areas above threshold.
		if (
			!!this.resources().bloomResources.bloomExtractPipeline &&
			!!this.resources().bloomResources.bloomExtractBindGroup &&
			!!this.resources().bloomResources.bloomTextureView1
		) {
			const bloomExtractPass = commandEncoder.beginRenderPass({
				colorAttachments: [
					{
						view: this.resources().bloomResources.bloomTextureView1!,
						clearValue: { r: 0, g: 0, b: 0, a: 1 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			bloomExtractPass.setPipeline(this.resources().bloomResources.bloomExtractPipeline!);
			bloomExtractPass.setBindGroup(0, this.resources().bloomResources.bloomExtractBindGroup);
			bloomExtractPass.draw(3, 1, 0, 0);
			bloomExtractPass.end();

			// Horizontal blur pass - blur extracted bright areas horizontally.
			if (
				!!this.resources().bloomResources.bloomBlurPipeline &&
				!!this.resources().bloomResources.bloomBlurHBindGroup &&
				!!this.resources().bloomResources.bloomTextureView2
			) {
				const blurHPass = commandEncoder.beginRenderPass({
					colorAttachments: [
						{
							view: this.resources().bloomResources.bloomTextureView2!,
							clearValue: { r: 0, g: 0, b: 0, a: 1 },
							loadOp: "clear",
							storeOp: "store",
						},
					],
				});
				blurHPass.setPipeline(this.resources().bloomResources.bloomBlurPipeline!);
				blurHPass.setBindGroup(0, this.resources().bloomResources.bloomBlurHBindGroup);
				blurHPass.draw(3, 1, 0, 0);
				blurHPass.end();

				// Vertical blur pass - complete the separable blur.
				if (!!this.resources().bloomResources.bloomBlurVBindGroup) {
					const blurVPass = commandEncoder.beginRenderPass({
						colorAttachments: [
							{
								view: this.resources().bloomResources.bloomTextureView1!,
								clearValue: { r: 0, g: 0, b: 0, a: 1 },
								loadOp: "clear",
								storeOp: "store",
							},
						],
					});
					blurVPass.setPipeline(this.resources().bloomResources.bloomBlurPipeline!);
					blurVPass.setBindGroup(0, this.resources().bloomResources.bloomBlurVBindGroup);
					blurVPass.draw(3, 1, 0, 0);
					blurVPass.end();
				}
			}

			// Tone mapping pass - combine HDR image with bloom and map to LDR for display.
			if (
				!!this.resources().toneMapResources.toneMapPipeline &&
				!!this.resources().toneMapResources.toneMapBindGroup
			) {
				const tonePassDesc: GPURenderPassDescriptor = {
					colorAttachments: [
						{
							view: canvasTextureView,
							clearValue: { r: 0, g: 0, b: 0, a: 1 },
							loadOp: "clear",
							storeOp: "store",
						},
					],
					timestampWrites: this.isAdvancedOptionsEnabled()
						? this.resources().performanceProfiler().getToneMappingTimestampWrites()
						: undefined,
				};

				const tonePass = commandEncoder.beginRenderPass(tonePassDesc);
				tonePass.setPipeline(this.resources().toneMapResources.toneMapPipeline!);
				tonePass.setBindGroup(0, this.resources().toneMapResources.toneMapBindGroup);
				tonePass.draw(3, 1, 0, 0);
				tonePass.end();
			}
		}
	}

	// Resolve GPU timing queries to measure performance. Only resolves if timing
	// is available and results aren't currently being read to avoid conflicts.
	private resolveTimingQueries(commandEncoder: GPUCommandEncoder, isReadingTimingResults: boolean) {
		// Skip GPU timing resolves if advanced options are disabled
		if (!!!this.isAdvancedOptionsEnabled()) return;
		const p = this.resources().performanceProfiler();
		if (!!p.querySet && !!p.queryBuffer && !isReadingTimingResults) {
			commandEncoder.resolveQuerySet(p.querySet!, 0, 3, p.queryBuffer!, 0);
			if (!!p.resultBuffer) {
				commandEncoder.copyBufferToBuffer(
					p.queryBuffer!,
					0,
					p.resultBuffer!,
					0,
					3 * 8 // 3 timestamps * 8 bytes each
				);
			}
		}
	}

	private isAdvancedOptionsEnabled(): boolean {
		try {
			const val = localStorage.getItem("showAdvancedOptions");
			return val === "true"; // UI defaults to true, user can toggle
		} catch {
			return true;
		}
	}

	// Update the weights used for temporal accumulation averaging. This calculates
	// how much each accumulated frame contributes to the final image based on the
	// current temporal accumulation setting. Uses equal weighting for simplicity.
	private updateAccumulationWeights() {
		if (!!!this.resources().accumulationResources.accumWeightsBuffer) return;

		// Clear weights array.
		this.tmpWeights.fill(0);

		const n = this.accumulator().getEffectiveTemporalAccumulation();
		const framesSinceBufferClear = this.accumulator().getFramesSinceBufferClear();

		if (n >= 1) {
			// Only weight frames that have been rendered since buffer clear
			// This prevents averaging with empty black frames after preset switches
			const validFrames = Math.min(n, framesSinceBufferClear);

			if (validFrames > 0) {
				// Each valid frame gets weight 16/validFrames
				// This ensures total weight is always 16 for consistent brightness
				const sliceWeight = 16 / validFrames;
				for (let i = 0; i < validFrames; i++) {
					const idx = (this.resources().accumulationResources.accumWriteIndex - i + 16) & 15;
					this.tmpWeights[idx] = sliceWeight;
				}
			}
		}

		// Pack 16 floats into cached buffer for proper uniform buffer alignment.
		for (let i = 0; i < 16; i++) {
			this.cachedPackedWeights[i] = this.tmpWeights[i];
		}
		if (!!!this.resources().accumulationResources.accumWeightsBuffer) {
			throw new Error("accumWeightsBuffer is null in updateAccumulationWeights");
		}
		if (!!!this.cachedPackedWeights || !this.cachedPackedWeights.buffer) {
			throw new Error("cachedPackedWeights is null or invalid in updateAccumulationWeights");
		}
		this.device.queue.writeBuffer(
			this.resources().accumulationResources.accumWeightsBuffer!,
			0,
			this.cachedPackedWeights.buffer
		);
	}
}
