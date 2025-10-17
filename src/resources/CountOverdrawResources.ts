import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

export class CountOverdrawResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	private overdrawCountBuffer: GPUBuffer | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getOverdrawCountBuffer = (width: number, height: number) =>
		!!!this.overdrawCountBuffer ||
		this.lastOverdrawCountBufferDims.width !== width ||
		this.lastOverdrawCountBufferDims.height !== height
			? this.createOverdrawCountBuffer(width, height)
			: this.overdrawCountBuffer;

	private createOverdrawCountBuffer(width: number, height: number): GPUBuffer {
		const bufferWidth = Math.max(1, Math.floor(width));
		const bufferHeight = Math.max(1, Math.floor(height));
		const requiredSize = bufferWidth * bufferHeight * 4; // 4 bytes per u32
		this.overdrawCountBuffer?.destroy();
		console.log(`🔴 Creating overdraw count buffer - Size: ${requiredSize} bytes`);
		this.overdrawCountBuffer = this.device.createBuffer({
			label: "overdraw count buffer",
			size: requiredSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		this.lastOverdrawCountBufferDims = { width: bufferWidth, height: bufferHeight };
		return this.overdrawCountBuffer;
	}

	private lastOverdrawCountBufferDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	clear(commandEncoder: GPUCommandEncoder, width: number, height: number) {
		// Skip when overdraw is globally disabled via sentinel
		if (this.galaxy().maxOverdraw >= 4096) return;

		const bufferWidth = Math.max(1, Math.floor(width));
		const bufferHeight = Math.max(1, Math.floor(height));
		const dimsChanged =
			this.lastClearedDispatchDims.width !== bufferWidth || this.lastClearedDispatchDims.height !== bufferHeight;
		if (dimsChanged) {
			console.log(`🔴 Clearing overdraw (${bufferWidth}x${bufferHeight})`);
		}
		const buffer = this.getOverdrawCountBuffer(bufferWidth, bufferHeight);
		const requiredSize = bufferWidth * bufferHeight * 4;
		commandEncoder.clearBuffer(buffer, 0, requiredSize);
		this.lastClearedDispatchDims = { width: bufferWidth, height: bufferHeight };
	}

	private lastClearedDispatchDims = { width: -1, height: -1 };

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying count overdraw resources");
		this.overdrawCountBuffer?.destroy();
		this.overdrawCountBuffer = null;
		this.lastOverdrawCountBufferDims = { width: -1, height: -1 };
		this.lastClearedDispatchDims = { width: -1, height: -1 };
	}
}
