import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import particleVertShader from "../shaders/core/particle.vert.wgsl";
import overdrawFragShader from "../shaders/debug/overdraw.frag.wgsl";

export class DrawOverdrawResources {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	galaxy: () => Galaxy;
	resources: () => ResourceManager;

	private overdrawPipeline: GPURenderPipeline | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.galaxy = () => simulator.galaxy;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getOverdrawPipeline = () => this.overdrawPipeline ?? this.createOverdrawPipeline();

	private createOverdrawPipeline(): GPURenderPipeline {
		console.log("🔴 Creating overdraw pipeline");
		this.overdrawPipeline = this.device.createRenderPipeline({
			label: "overdrawPipeline",
			layout: this.resources().particleResources.getParticlePipelineLayout(),
			vertex: {
				module: this.device.createShaderModule({ code: particleVertShader }),
				entryPoint: "main",
				buffers: [
					{
						arrayStride: 2 * 4,
						attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
					},
				],
			},
			fragment: {
				module: this.device.createShaderModule({ code: overdrawFragShader }),
				entryPoint: "main",
				targets: [
					{
						format: "rgba16float",
						blend: {
							color: { srcFactor: "one", dstFactor: "one", operation: "add" },
							alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
						},
					},
				],
			},
			primitive: { topology: "triangle-list" },
			multisample: { count: 4 },
		});
		return this.overdrawPipeline;
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying draw overdraw resources");
		this.overdrawPipeline = null;
	}
}
