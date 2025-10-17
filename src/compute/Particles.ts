import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ParticleRenderer } from "../renderers/ParticleRenderer";
import { ResourceManager } from "../managers/ResourceManager";
import particleCompWGSL from "../shaders/compute/particle.comp.wgsl";
import { GALAXY_UNIFORM_BYTES } from "../utils/GalaxyUniformPacker";

export interface Particle {
	theta0: number; // initial angular position on the ellipse
	velTheta: number; // angular velocity
	tiltAngle: number; // tilt angle of the ellipse
	a: number; // kleine halbachse
	b: number; // große halbachse
	temp: number; // star temperature
	mag: number; // brightness
	type: ParticleType; // star or dust
	red: number;
	green: number;
	blue: number;
	alpha: number;
}

export enum ParticleType {
	Star = 0,
	Dust = 1,
}

export class Particles {
	private readonly device: GPUDevice;

	private readonly galaxy: () => Galaxy;
	private readonly particleRenderer: () => ParticleRenderer;
	private readonly resources: () => ResourceManager;

	// Compute pipeline for particle simulation.
	private computePipeline: GPUComputePipeline | null = null;

	// Bind group for compute resources.
	private computeBindGroup: GPUBindGroup | null = null;

	// Uniform buffer for galaxy parameters in compute shader.
	private computeGalaxyUniformBuffer: GPUBuffer | null = null;

	// Bind group layout for compute resources.
	private computeBindGroupLayout: GPUBindGroupLayout | null = null;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.galaxy = () => {
			if (!!!simulator.galaxy) throw new Error("Galaxy must be initialized before Particles");
			return simulator.galaxy;
		};
		this.particleRenderer = () => {
			if (!!!simulator.particleRenderer) throw new Error("ParticleRenderer must be initialized before Particles");
			return simulator.particleRenderer;
		};
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("Resources must be initialized before Particles");
			return simulator.resources;
		};
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getComputeGalaxyUniformBuffer = () => this.computeGalaxyUniformBuffer ?? this.createComputeGalaxyUniformBuffer();

	private createComputeGalaxyUniformBuffer(): GPUBuffer {
		console.log("🔴 Creating compute galaxy uniform buffer");
		this.computeGalaxyUniformBuffer?.destroy();
		this.computeGalaxyUniformBuffer = this.device.createBuffer({
			label: "computeGalaxyUniformBuffer",
			size: GALAXY_UNIFORM_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		return this.computeGalaxyUniformBuffer;
	}

	updateComputeGalaxyUniformBuffer() {
		const galaxyArray = this.galaxy().toGpuArray();
		if (!galaxyArray || !galaxyArray.buffer) {
			throw new Error("toGpuArray returned null or invalid array");
		}
		this.device.queue.writeBuffer(this.getComputeGalaxyUniformBuffer(), 0, galaxyArray.buffer);
	}

	////////////////////////////////////////////////////////////

	getComputePipeline = () => this.computePipeline ?? this.createComputePipeline();

	private createComputePipeline(): GPUComputePipeline {
		console.log("🔴 Creating compute pipeline");
		const pipelineLayout = this.device.createPipelineLayout({
			label: "computePipelineLayout",
			bindGroupLayouts: [this.getComputeBindGroupLayout()],
		});
		this.computePipeline = this.device.createComputePipeline({
			label: "particleComputePipeline",
			layout: pipelineLayout,
			compute: {
				module: this.device.createShaderModule({ code: particleCompWGSL }),
				entryPoint: "main",
			},
		});
		return this.computePipeline;
	}

	////////////////////////////////////////////////////////////

	getComputeBindGroupLayout = () => this.computeBindGroupLayout ?? this.createComputeBindGroupLayout();

	private createComputeBindGroupLayout(): GPUBindGroupLayout {
		console.log("🔴 Creating compute bind group layout");
		this.computeBindGroupLayout = this.device.createBindGroupLayout({
			label: "computeBindGroupLayout",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
			],
		});
		return this.computeBindGroupLayout;
	}

	////////////////////////////////////////////////////////////

	getComputeBindGroup = () => this.computeBindGroup ?? this.createComputeBindGroup();

	private createComputeBindGroup(): GPUBindGroup {
		console.log("🔴 Creating compute bind group");
		if (!!!this.computePipeline || !!!this.computeGalaxyUniformBuffer) {
			throw new Error("Compute resources not ready for bind group creation");
		}
		this.computeBindGroup = this.device.createBindGroup({
			label: "computeBindGroup",
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.getComputeGalaxyUniformBuffer() } },
				{ binding: 1, resource: { buffer: this.resources().particleResources.getParticleStorageBuffer() } },
			],
		});
		return this.computeBindGroup;
	}

	////////////////////////////////////////////////////////////

	update(commandEncoder?: GPUCommandEncoder) {
		// Allocate empty buffer sized for particles
		const bufferRecreated = this.particleRenderer().allocateEmptyBuffer(this.galaxy().totalStarCount);

		// Ensure uniforms are up to date for this dispatch
		this.updateComputeGalaxyUniformBuffer();

		// recreate compute bind group if necessary
		if (bufferRecreated) this.computeBindGroup = null; // Force recreation

		// Dispatch compute to fill particle buffer
		// If a command encoder is provided, use it for batching; otherwise create our own
		const shouldSubmit = !commandEncoder;
		const encoder = commandEncoder || this.device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.getComputePipeline());
		pass.setBindGroup(0, this.getComputeBindGroup());
		const workgroupSize = 256;
		const numGroups = Math.ceil(this.galaxy().totalStarCount / workgroupSize);
		pass.dispatchWorkgroups(numGroups);
		pass.end();

		// Only submit if we created our own encoder
		if (shouldSubmit) this.device.queue.submit([encoder.finish()]);

		// Ensure bind groups reference the current storage buffer; ParticleResources tracks changes internally
		this.resources().particleResources.setup();
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying Particles compute resources");
		this.computeGalaxyUniformBuffer?.destroy();
		this.computePipeline = null;
		this.computeBindGroup = null;
		this.computeBindGroupLayout = null;
		this.computeGalaxyUniformBuffer = null;
	}
}
