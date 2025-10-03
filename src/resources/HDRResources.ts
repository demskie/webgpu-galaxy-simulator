import { GalaxySimulator } from "../GalaxySimulator";

// Manages the HDR render target (texture and view)
export class HDRResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;

	hdrTexture: GPUTexture | null = null;
	hdrTextureView: GPUTextureView | null = null;

	private lastDims = { width: -1, height: -1 };

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
	}

	setup() {
		const [width, height] = [this.canvas.width, this.canvas.height];
		if (
			width != this.lastDims.width ||
			height != this.lastDims.height ||
			!!!this.hdrTexture ||
			!!!this.hdrTextureView
		) {
			this.createHDRTexture(width, height);
			this.createHDRTextureView(width, height);
		}
		this.lastDims = { width, height };
	}

	getHDRTexture = () => this.hdrTexture ?? this.createHDRTexture(this.canvas.width, this.canvas.height);
	getHDRTextureView = () => this.hdrTextureView ?? this.createHDRTextureView(this.canvas.width, this.canvas.height);

	createHDRTexture(width: number, height: number): GPUTexture {
		if (this.hdrTexture && this.lastDims.width === width && this.lastDims.height === height) {
			return this.hdrTexture;
		}
		console.log("🔴 Creating HDR texture (EXPENSIVE!)");
		this.hdrTexture?.destroy();
		this.hdrTexture = this.device.createTexture({
			size: { width, height },
			sampleCount: 1,
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		return this.hdrTexture;
	}

	createHDRTextureView(width: number, height: number): GPUTextureView {
		if (this.hdrTextureView && this.lastDims.width === width && this.lastDims.height === height) {
			return this.hdrTextureView;
		}
		if (!!!this.hdrTexture) this.createHDRTexture(width, height);
		this.hdrTextureView = this.hdrTexture!.createView();
		return this.hdrTextureView;
	}

	destroy() {
		console.log("🔴 Destroying HDR resources");
		this.hdrTexture?.destroy();
		this.hdrTexture = null;
		this.hdrTextureView = null;
	}
}
