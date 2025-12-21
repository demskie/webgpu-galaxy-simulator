import { GalaxySimulator } from "../GalaxySimulator";

// Manages textures for temporal denoising:
// - currentFrameTexture: raw particle render output
// - denoisedTexture: output of temporal denoise pass
// - historyTexture: stores previous frame's denoised result for temporal blending
export class DenoiseResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;

	private currentFrameTexture: GPUTexture | null = null;
	private currentFrameView: GPUTextureView | null = null;
	private denoisedTexture: GPUTexture | null = null;
	private denoisedView: GPUTextureView | null = null;
	private historyTexture: GPUTexture | null = null;
	private historyView: GPUTextureView | null = null;
	private sampler: GPUSampler | null = null;

	private lastDims = { width: -1, height: -1 };

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
	}

	setup() {
		// Sampler is created once and reused
		if (!this.sampler) {
			this.sampler = this.device.createSampler({
				label: "denoiseSampler",
				minFilter: "linear",
				magFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge",
			});
		}
	}

	private ensureTextures(width: number, height: number) {
		if (this.lastDims.width === width && this.lastDims.height === height) {
			return; // Already have correct size
		}

		console.log(`🔴 Creating denoise textures ${width}x${height}`);

		// Destroy old textures
		this.currentFrameTexture?.destroy();
		this.denoisedTexture?.destroy();
		this.historyTexture?.destroy();

		// Create current frame texture (render target from particle pass)
		this.currentFrameTexture = this.device.createTexture({
			label: "currentFrameTexture",
			size: [width, height],
			format: "rgba16float",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.COPY_SRC,
		});
		this.currentFrameView = this.currentFrameTexture.createView({
			label: "currentFrameView",
		});

		// Create denoised texture (output of denoise compute pass)
		this.denoisedTexture = this.device.createTexture({
			label: "denoisedTexture",
			size: [width, height],
			format: "rgba16float",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.STORAGE_BINDING |
				GPUTextureUsage.COPY_SRC,
		});
		this.denoisedView = this.denoisedTexture.createView({
			label: "denoisedView",
		});

		// Create history texture (previous frame's denoised result)
		this.historyTexture = this.device.createTexture({
			label: "historyTexture",
			size: [width, height],
			format: "rgba16float",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST,
		});
		this.historyView = this.historyTexture.createView({
			label: "historyView",
		});

		this.lastDims = { width, height };
	}

	getCurrentFrameView(width: number, height: number): GPUTextureView {
		this.ensureTextures(width, height);
		return this.currentFrameView!;
	}

	getDenoisedView(width: number, height: number): GPUTextureView {
		this.ensureTextures(width, height);
		return this.denoisedView!;
	}

	getDenoisedTexture(width: number, height: number): GPUTexture {
		this.ensureTextures(width, height);
		return this.denoisedTexture!;
	}

	getHistoryView(width: number, height: number): GPUTextureView {
		this.ensureTextures(width, height);
		return this.historyView!;
	}

	getHistoryTexture(width: number, height: number): GPUTexture {
		this.ensureTextures(width, height);
		return this.historyTexture!;
	}

	getSampler(): GPUSampler {
		return this.sampler!;
	}

	destroy() {
		console.log("🔴 Destroying denoise resources");
		this.currentFrameTexture?.destroy();
		this.currentFrameTexture = null;
		this.currentFrameView = null;
		this.denoisedTexture?.destroy();
		this.denoisedTexture = null;
		this.denoisedView = null;
		this.historyTexture?.destroy();
		this.historyTexture = null;
		this.historyView = null;
		this.sampler = null;
		this.lastDims = { width: -1, height: -1 };
	}
}

