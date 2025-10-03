import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

export class MSAAResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	msaaTexture: GPUTexture | null = null;
	msaaTextureView: GPUTextureView | null = null;

	private lastDims = { width: -1, height: -1 };

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {
		const [width, height] = [this.canvas.width, this.canvas.height];
		if (
			width != this.lastDims.width ||
			height != this.lastDims.height ||
			!!!this.msaaTexture ||
			!!!this.msaaTextureView
		) {
			this.createMSAATexture(width, height);
			this.createMSAATextureView(width, height);
		}
		this.lastDims = { width, height };
	}

	getMSAATexture = () => this.msaaTexture ?? this.createMSAATexture(this.canvas.width, this.canvas.height);
	getMSAATextureView = () => this.msaaTextureView ?? this.createMSAATextureView(this.canvas.width, this.canvas.height);

	createMSAATexture(width: number, height: number): GPUTexture {
		if (this.msaaTexture && this.lastDims.width === width && this.lastDims.height === height) return this.msaaTexture;
		console.log("🔴 Creating MSAA texture (EXPENSIVE!)");
		this.msaaTexture?.destroy();
		this.msaaTexture = this.device.createTexture({
			size: { width, height },
			sampleCount: 4,
			format: "rgba16float",
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return this.msaaTexture;
	}

	createMSAATextureView(width: number, height: number): GPUTextureView {
		if (this.msaaTextureView && this.lastDims.width === width && this.lastDims.height === height)
			return this.msaaTextureView;
		if (!!!this.msaaTexture) this.createMSAATexture(width, height);
		this.msaaTextureView = this.msaaTexture!.createView();
		return this.msaaTextureView;
	}

	destroy() {
		console.log("🔴 Destroying MSAA resources");
		this.msaaTexture?.destroy();
		this.msaaTexture = null;
		this.msaaTextureView = null;
	}
}
