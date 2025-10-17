import { Galaxy } from "../entities/Galaxy";
import { ResourceManager } from "./ResourceManager";
import { ParticleRenderer } from "../renderers/ParticleRenderer";
import { GalaxySimulator } from "../GalaxySimulator";
import { Particles } from "../compute/Particles";

// The Renderer class handles all GPU rendering operations for the galaxy simulation.
// It encapsulates the render pipeline execution, including star rendering, post-processing
// effects (bloom, tone mapping), temporal accumulation, and GPU timing. This separation
// allows the GalaxySimulator to focus on simulation logic while the Renderer manages
// the complex GPU command encoding and submission process.
export class RenderingManager {
	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly canvas: HTMLCanvasElement;
	private readonly resources: () => ResourceManager;
	private readonly particleRenderer: () => ParticleRenderer;
	private readonly particles: () => Particles;

	private frameCount = 0;

	// Constructor initializes the renderer with required WebGPU objects and resources.
	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.context = simulator.context;
		this.canvas = simulator.canvas;
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("Resources must be initialized before RenderingManager");
			return simulator.resources;
		};
		this.particleRenderer = () => {
			if (!!!simulator.particleRenderer)
				throw new Error("ParticleRenderer must be initialized before RenderingManager");
			return simulator.particleRenderer;
		};
		this.particles = () => {
			if (!!!simulator.particles) throw new Error("Particles must be initialized before RenderingManager");
			return simulator.particles;
		};
	}

	// Returns the number of frames rendered
	getFrameCount(): number {
		return this.frameCount;
	}

	// Main render method that executes the complete rendering pipeline for one frame.
	// This includes star rendering, post-processing effects, and final presentation.
	// Returns true if rendering was successful, false if resources weren't ready.
	render(galaxy: Galaxy, isReadingTimingResults: boolean, particleUpdateNeeded: boolean = false): boolean {
		if (!!!this.device || !!!this.context) {
			console.error("WebGPU resources not ready for rendering:", {
				device: !!this.device,
				context: !!this.context,
			});
			return false;
		}

		// Check that particle data is available.
		const particleStorageBuffer = this.resources().particleResources.getParticleStorageBuffer();
		const starCount = galaxy.totalStarCount;
		if (!!!particleStorageBuffer || starCount === 0) {
			return false;
		}

		// Update accumulation weights for temporal averaging before encoding commands.
		this.resources().accumulationResources.updateWeightsBuffer();

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
		const [width, height] = [this.canvas.width, this.canvas.height];
		const currentAccumView = this.resources().accumulationResources.getCurrentAccumLayerView(width, height);
		const msaaView = this.resources().msaaResources.getMSAATextureView(width, height);

		// Configure render pass with MSAA texture and accumulation layer as resolve target.
		const renderPassDescriptor: GPURenderPassDescriptor = {
			colorAttachments: [
				{
					view: msaaView,
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
		this.resources().accumulationResources.advanceAccumWriteIndex();
	}

	// Average all active accumulation texture layers into the HDR texture.
	// This implements temporal accumulation by blending multiple frames together
	// with appropriate weights to reduce noise and create motion blur effects.
	private averageAccumulationTextures(commandEncoder: GPUCommandEncoder) {
		const averagePass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.resources().hdrResources.getHDRTextureView(this.canvas.width, this.canvas.height),
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		averagePass.setPipeline(this.resources().accumulationResources.getAccumAveragePipeline());
		averagePass.setBindGroup(
			0,
			this.resources().accumulationResources.getAccumAverageBindGroup(this.canvas.width, this.canvas.height)
		);
		averagePass.draw(3, 1, 0, 0); // Fullscreen triangle
		averagePass.end();
	}

	// Apply post-processing effects including bloom and tone mapping.
	// This is a multi-pass process: extract bright areas, blur horizontally,
	// blur vertically, then combine with tone mapping for final output.
	private applyPostProcessing(commandEncoder: GPUCommandEncoder, canvasTextureView: GPUTextureView) {
		// Bloom extraction pass - isolate bright areas above threshold.
		const bloomTextures = this.resources().bloomResources.getBloomTextures(this.canvas.width, this.canvas.height);
		const bloomExtractPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: bloomTextures.bloomTextureView1,
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		bloomExtractPass.setPipeline(this.resources().bloomResources.getBloomExtractPipeline());
		bloomExtractPass.setBindGroup(
			0,
			this.resources().bloomResources.getBloomExtractBindGroup(this.canvas.width, this.canvas.height)
		);
		bloomExtractPass.draw(3, 1, 0, 0);
		bloomExtractPass.end();

		// Horizontal blur pass - blur extracted bright areas horizontally.
		const blurHPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: bloomTextures.bloomTextureView2,
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		blurHPass.setPipeline(this.resources().bloomResources.getBloomBlurPipeline());
		blurHPass.setBindGroup(
			0,
			this.resources().bloomResources.getBloomBlurBindGroups(
				this.resources().canvas.width,
				this.resources().canvas.height
			).bloomBlurHBindGroup
		);
		blurHPass.draw(3, 1, 0, 0);
		blurHPass.end();

		// Vertical blur pass - complete the separable blur.
		const blurVPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: bloomTextures.bloomTextureView1,
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		blurVPass.setPipeline(this.resources().bloomResources.getBloomBlurPipeline());
		blurVPass.setBindGroup(
			0,
			this.resources().bloomResources.getBloomBlurBindGroups(
				this.resources().canvas.width,
				this.resources().canvas.height
			).bloomBlurVBindGroup
		);
		blurVPass.draw(3, 1, 0, 0);
		blurVPass.end();

		// Tone mapping pass - combine HDR image with bloom and map to LDR for display.
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
		tonePass.setPipeline(this.resources().toneMapResources.getToneMapPipeline());
		tonePass.setBindGroup(
			0,
			this.resources().toneMapResources.getToneMapBindGroup(
				this.resources().canvas.width,
				this.resources().canvas.height
			)
		);
		tonePass.draw(3, 1, 0, 0);
		tonePass.end();
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
}
