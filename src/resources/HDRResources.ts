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

	createHDRTexture(width: number, height: number) {
		console.log("🔴 Creating HDR texture (EXPENSIVE!)");
		this.hdrTexture?.destroy();
		this.hdrTexture = this.device.createTexture({
			size: { width, height },
			sampleCount: 1,
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
	}

	createHDRTextureView(width: number, height: number) {
		if (!!!this.hdrTexture) this.createHDRTexture(width, height);
		this.hdrTextureView = this.hdrTexture!.createView();
	}

	destroy() {
		console.log("🔴 Destroying HDR resources");
		this.hdrTexture?.destroy();
		this.hdrTexture = null;
		this.hdrTextureView = null;
	}
}
