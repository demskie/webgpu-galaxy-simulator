import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import overdrawClearCompShader from "../shaders/compute/overdraw.clear.comp.wgsl";

export class CountOverdrawResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	overdrawCountBuffer: GPUBuffer | null = null;
	clearOverdrawPipeline: GPUComputePipeline | null = null;
	clearOverdrawDimensionsBuffer: GPUBuffer | null = null;
	clearOverdrawBindGroup: GPUBindGroup | null = null;

	private lastDims = { width: -1, height: -1 };

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {
		const [width, height] = [this.canvas.width, this.canvas.height];
		if (width == this.lastDims.width && height == this.lastDims.height) return;
		this.lastDims = { width, height };
		this.createOverdrawCountBuffer(width, height);
		if (!!!this.clearOverdrawPipeline) this.createClearOverdrawPipeline();
		this.createClearOverdrawDimensionsBuffer(width, height);
		this.createClearOverdrawBindGroup(width, height);
	}

	createOverdrawCountBuffer(width: number, height: number) {
		const requiredSize = width * height * 4; // 4 bytes per u32
		this.overdrawCountBuffer?.destroy();
		console.log(`🔴 Creating overdraw count buffer (EXPENSIVE!) - Size: ${requiredSize} bytes`);
		this.overdrawCountBuffer = this.device.createBuffer({
			size: requiredSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
	}

	createClearOverdrawPipeline() {
		console.log("🔴 Creating clear overdraw pipeline");
		const shaderModule = this.device.createShaderModule({ code: overdrawClearCompShader });
		const bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
			],
		});
		const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
		this.clearOverdrawPipeline = this.device.createComputePipeline({
			label: "clearOverdrawPipeline",
			layout: pipelineLayout,
			compute: { module: shaderModule, entryPoint: "main" },
		});
	}

	createClearOverdrawDimensionsBuffer(width: number, height: number) {
		this.clearOverdrawDimensionsBuffer = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateClearOverdrawDimensionsBuffer(width, height);
	}

	updateClearOverdrawDimensionsBuffer(width: number, height: number) {
		if (!!!this.clearOverdrawDimensionsBuffer) return this.createClearOverdrawDimensionsBuffer(width, height);
		this.device.queue.writeBuffer(this.clearOverdrawDimensionsBuffer!, 0, new Float32Array([width, height, 0, 0]));
	}

	createClearOverdrawBindGroup(width: number, height: number) {
		if (!!!this.clearOverdrawPipeline) this.createClearOverdrawPipeline();
		if (!!!this.overdrawCountBuffer) this.createOverdrawCountBuffer(width, height);
		if (!!!this.clearOverdrawDimensionsBuffer) this.createClearOverdrawDimensionsBuffer(width, height);
		this.clearOverdrawBindGroup = this.device.createBindGroup({
			layout: this.clearOverdrawPipeline!.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.overdrawCountBuffer! } },
				{ binding: 1, resource: { buffer: this.clearOverdrawDimensionsBuffer! } },
			],
		});
	}

	clear(commandEncoder: GPUCommandEncoder, width: number, height: number) {
		// Skip when overdraw is globally disabled via sentinel
		if (this.galaxy().maxOverdraw >= 4096) return;
		if (!!!this.clearOverdrawPipeline) this.createClearOverdrawPipeline();
		if (!!!this.clearOverdrawBindGroup) this.createClearOverdrawBindGroup(width, height);
		const computeEncoder = commandEncoder.beginComputePass();
		computeEncoder.setPipeline(this.clearOverdrawPipeline!);
		computeEncoder.setBindGroup(0, this.clearOverdrawBindGroup!);
		const totalPixels = width * height;
		const workgroupSize = 64;
		const workgroupsNeeded = Math.ceil(totalPixels / workgroupSize);
		const maxWorkgroupsPerDim = 65535;
		if (workgroupsNeeded <= maxWorkgroupsPerDim) {
			computeEncoder.dispatchWorkgroups(workgroupsNeeded);
		} else {
			const workgroupsX = Math.min(workgroupsNeeded, maxWorkgroupsPerDim);
			const workgroupsY = Math.ceil(workgroupsNeeded / workgroupsX);
			computeEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
		}
		computeEncoder.end();
	}

	destroy() {
		console.log("🔴 Destroying count overdraw resources");
		this.overdrawCountBuffer?.destroy();
		this.clearOverdrawDimensionsBuffer?.destroy();
		this.overdrawCountBuffer = null;
		this.clearOverdrawDimensionsBuffer = null;
		this.clearOverdrawPipeline = null;
		this.clearOverdrawBindGroup = null;
	}
}
