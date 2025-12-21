import { GalaxySimulator } from "../GalaxySimulator";

// Manages the HDR render target (texture and view)
export class HDRResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;

	private hdrTexture: GPUTexture | null = null;
	private hdrTextureView: GPUTextureView | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getHDRTexture = (width: number, height: number) =>
		!!!this.hdrTexture || this.lastHDRTextureDims.width !== width || this.lastHDRTextureDims.height !== height
			? this.createHDRTexture(width, height)
			: this.hdrTexture;

	private createHDRTexture(width: number, height: number): GPUTexture {
		console.log(`🔴 Creating HDR texture ${width}x${height}`);
		this.hdrTexture?.destroy();
		this.hdrTexture = this.device.createTexture({
			label: "HDR texture",
			size: { width, height },
			sampleCount: 1,
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		this.lastHDRTextureDims = { width, height };
		// Invalidate view when texture is recreated
		this.hdrTextureView = null;
		return this.hdrTexture;
	}

	private lastHDRTextureDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getHDRTextureView = (width: number, height: number) =>
		!!!this.hdrTextureView ||
		this.lastHDRTextureViewDims.width !== width ||
		this.lastHDRTextureViewDims.height !== height
			? this.createHDRTextureView(width, height)
			: this.hdrTextureView;

	private createHDRTextureView(width: number, height: number): GPUTextureView {
		console.log(`🔴 Creating HDR texture view ${width}x${height}`);
		this.hdrTextureView = this.getHDRTexture(width, height).createView({
			label: "HDR texture view",
		});
		this.lastHDRTextureViewDims = { width, height };
		return this.hdrTextureView;
	}

	private lastHDRTextureViewDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying HDR resources");
		this.hdrTexture?.destroy();
		this.hdrTexture = null;
		this.hdrTextureView = null;
	}
}
