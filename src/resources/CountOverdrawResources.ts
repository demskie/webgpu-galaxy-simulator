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
		// Skip setup entirely when overdraw is globally disabled via sentinel
		if (this.galaxy().maxOverdraw >= 4096) return;

		const [width, height] = [this.canvas.width, this.canvas.height];
		const dimsChanged = width !== this.lastDims.width || height !== this.lastDims.height;

		// (Re)create buffers when dimensions change or resources are missing
		if (dimsChanged || !!!this.overdrawCountBuffer) {
			this.createOverdrawCountBuffer(width, height);
		}

		// Ensure pipeline exists
		if (!!!this.clearOverdrawPipeline) this.createClearOverdrawPipeline();

		// Create or update dimensions uniform buffer
		if (!!!this.clearOverdrawDimensionsBuffer) {
			this.createClearOverdrawDimensionsBuffer(width, height);
		} else if (dimsChanged) {
			this.updateClearOverdrawDimensionsBuffer(width, height);
		}

		// Ensure bind group references current buffers
		if (!!!this.clearOverdrawBindGroup || dimsChanged) {
			this.createClearOverdrawBindGroup(width, height);
		}

		this.lastDims = { width, height };
	}

	getOverdrawCountBuffer = () => this.overdrawCountBuffer ?? this.createOverdrawCountBuffer(this.canvas.width, this.canvas.height); // prettier-ignore
	getClearOverdrawPipeline = () => this.clearOverdrawPipeline ?? this.createClearOverdrawPipeline();
	getClearOverdrawDimensionsBuffer = () => this.clearOverdrawDimensionsBuffer ?? this.createClearOverdrawDimensionsBuffer(this.canvas.width, this.canvas.height); // prettier-ignore
	getClearOverdrawBindGroup = () => this.clearOverdrawBindGroup ?? this.createClearOverdrawBindGroup(this.canvas.width, this.canvas.height); // prettier-ignore

	createOverdrawCountBuffer(width: number, height: number): GPUBuffer {
		const requiredSize = width * height * 4; // 4 bytes per u32
		this.overdrawCountBuffer?.destroy();
		console.log(`🔴 Creating overdraw count buffer (EXPENSIVE!) - Size: ${requiredSize} bytes`);
		this.overdrawCountBuffer = this.device.createBuffer({
			size: requiredSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		return this.overdrawCountBuffer;
	}

	createClearOverdrawPipeline(): GPUComputePipeline {
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
		return this.clearOverdrawPipeline;
	}

	createClearOverdrawDimensionsBuffer(width: number, height: number): GPUBuffer {
		this.clearOverdrawDimensionsBuffer = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateClearOverdrawDimensionsBuffer(width, height);
		return this.clearOverdrawDimensionsBuffer;
	}

	updateClearOverdrawDimensionsBuffer(width: number, height: number) {
		if (!!!this.clearOverdrawDimensionsBuffer) {
			this.createClearOverdrawDimensionsBuffer(width, height);
			return;
		}
		this.device.queue.writeBuffer(this.clearOverdrawDimensionsBuffer!, 0, new Float32Array([width, height, 0, 0]));
	}

	createClearOverdrawBindGroup(width: number, height: number): GPUBindGroup {
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
		return this.clearOverdrawBindGroup;
	}

	clear(commandEncoder: GPUCommandEncoder, width: number, height: number) {
		// Skip when overdraw is globally disabled via sentinel
		if (this.galaxy().maxOverdraw >= 4096) return;
		if (!!!this.clearOverdrawPipeline) this.createClearOverdrawPipeline();
		if (!!!this.clearOverdrawBindGroup) this.createClearOverdrawBindGroup(width, height);
		// Always update dimensions buffer to match provided size
		this.updateClearOverdrawDimensionsBuffer(width, height);
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
