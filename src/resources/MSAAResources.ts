import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

export class MSAAResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	private msaaTexture: GPUTexture | null = null;
	private msaaTextureView: GPUTextureView | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getMSAATexture = (width: number, height: number) =>
		!!!this.msaaTexture || this.lastMSAATextureDims.width !== width || this.lastMSAATextureDims.height !== height
			? this.createMSAATexture(width, height)
			: this.msaaTexture;

	private createMSAATexture(width: number, height: number): GPUTexture {
		console.log(`🔴 Creating MSAA texture ${width}x${height}`);
		this.msaaTexture?.destroy();
		this.msaaTexture = this.device.createTexture({
			label: `MSAA texture (${width}x${height})`,
			size: { width, height },
			sampleCount: 4,
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.lastMSAATextureDims = { width, height };
		return this.msaaTexture;
	}

	private lastMSAATextureDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	getMSAATextureView = (width: number, height: number) =>
		!!!this.msaaTextureView ||
		this.lastMSAATextureViewDims.width !== width ||
		this.lastMSAATextureViewDims.height !== height
			? this.createMSAATextureView(width, height)
			: this.msaaTextureView;

	private createMSAATextureView(width: number, height: number): GPUTextureView {
		console.log(`🔴 Creating MSAA texture view ${width}x${height}`);
		this.msaaTextureView = this.getMSAATexture(width, height).createView({
			label: `MSAA texture view (${width}x${height})`,
		});
		this.lastMSAATextureViewDims = { width, height };
		return this.msaaTextureView;
	}

	private lastMSAATextureViewDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying MSAA resources");
		this.msaaTexture?.destroy();
		this.msaaTexture = null;
		this.msaaTextureView = null;
	}
}
