import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { CameraManager } from "../managers/CameraManager";
import { ResourceManager } from "../managers/ResourceManager";
import { mat4 } from "../utils/MatrixMath";

import visibilityCullWGSL from "../shaders/compute/visibility-cull.comp.wgsl";

/**
 * VisibilityCullCompute manages the GPU compute pass that performs frustum culling
 * on particles. It determines which particles are visible and writes their indices
 * to a compact buffer for efficient indexed rendering.
 */
export class VisibilityCullCompute {
	private readonly device: GPUDevice;

	private readonly galaxy: () => Galaxy;
	private readonly camera: () => CameraManager;
	private readonly resources: () => ResourceManager;

	// Compute pipeline for visibility culling
	private computePipeline: GPUComputePipeline | null = null;

	// Bind group for compute resources
	private computeBindGroup: GPUBindGroup | null = null;

	// Bind group layout
	private computeBindGroupLayout: GPUBindGroupLayout | null = null;

	// Uniform buffer for culling parameters
	private cullUniformBuffer: GPUBuffer | null = null;

	// Track last particle count for bind group recreation
	private lastParticleCount = 0;
	private lastParticleStorageBuffer: GPUBuffer | null = null;

	// Uniform data size (must match shader struct)
	// mat4x4 (64) + 7 floats + 1 u32 + 5 padding = 64 + 48 = 112 bytes, aligned to 16 = 112
	private static readonly UNIFORM_SIZE = 112;

	// Cached ArrayBuffer for staging uniform data
	private readonly uniformDataArray = new ArrayBuffer(VisibilityCullCompute.UNIFORM_SIZE);
	private readonly uniformDataView = new DataView(this.uniformDataArray);
	private readonly uniformF32Array = new Float32Array(this.uniformDataArray);

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.galaxy = () => {
			if (!simulator.galaxy) throw new Error("Galaxy must be initialized before VisibilityCullCompute");
			return simulator.galaxy;
		};
		this.camera = () => {
			if (!simulator.camera) throw new Error("CameraManager must be initialized before VisibilityCullCompute");
			return simulator.camera;
		};
		this.resources = () => {
			if (!simulator.resources) throw new Error("ResourceManager must be initialized before VisibilityCullCompute");
			return simulator.resources;
		};
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getCullUniformBuffer = () => this.cullUniformBuffer ?? this.createCullUniformBuffer();

	private createCullUniformBuffer(): GPUBuffer {
		console.log("🔴 Creating visibility cull uniform buffer");
		this.cullUniformBuffer?.destroy();
		this.cullUniformBuffer = this.device.createBuffer({
			label: "cullUniformBuffer",
			size: VisibilityCullCompute.UNIFORM_SIZE,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		return this.cullUniformBuffer;
	}

	////////////////////////////////////////////////////////////

	updateUniforms() {
		const galaxy = this.galaxy();
		const camera = this.camera();

		// Compute view-projection matrix inline (P * V)
		const viewProjMat = mat4.create();
		this.multiplyMatrices(viewProjMat, camera.matProjection, camera.matView);

		// Write view-projection matrix (offset 0, 64 bytes)
		mat4.copy(this.uniformF32Array.subarray(0, 16), viewProjMat);

		// Write scalar uniforms using DataView for precise control
		const dv = this.uniformDataView;
		let offset = 64;

		dv.setFloat32(offset, galaxy.time, true); offset += 4;                      // time
		dv.setFloat32(offset, galaxy.rotationSpeed, true); offset += 4;             // rotationSpeed
		dv.setFloat32(offset, galaxy.spiralArmWaves, true); offset += 4;            // spiralArmWaves
		dv.setFloat32(offset, galaxy.spiralWaveStrength, true); offset += 4;        // spiralWaveStrength
		dv.setUint32(offset, galaxy.totalStarCount, true); offset += 4;             // totalStarCount
		dv.setFloat32(offset, galaxy.brightStarSize, true); offset += 4;            // brightStarSize
		dv.setFloat32(offset, galaxy.dustParticleSize, true); offset += 4;          // dustParticleSize
		// 5 padding floats
		dv.setFloat32(offset, 0.0, true); offset += 4;
		dv.setFloat32(offset, 0.0, true); offset += 4;
		dv.setFloat32(offset, 0.0, true); offset += 4;
		dv.setFloat32(offset, 0.0, true); offset += 4;
		dv.setFloat32(offset, 0.0, true);

		this.device.queue.writeBuffer(this.getCullUniformBuffer(), 0, this.uniformDataArray);
	}

	// Multiply two 4x4 matrices: out = a * b
	private multiplyMatrices(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
		out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

		b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
		out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

		b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
		out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

		b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
		out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

		return out;
	}

	////////////////////////////////////////////////////////////

	getComputePipeline = () => this.computePipeline ?? this.createComputePipeline();

	private createComputePipeline(): GPUComputePipeline {
		console.log("🔴 Creating visibility cull compute pipeline");
		const pipelineLayout = this.device.createPipelineLayout({
			label: "visibilityCullPipelineLayout",
			bindGroupLayouts: [this.getComputeBindGroupLayout()],
		});
		this.computePipeline = this.device.createComputePipeline({
			label: "visibilityCullPipeline",
			layout: pipelineLayout,
			compute: {
				module: this.device.createShaderModule({ code: visibilityCullWGSL }),
				entryPoint: "main",
			},
		});
		return this.computePipeline;
	}

	////////////////////////////////////////////////////////////

	getComputeBindGroupLayout = () => this.computeBindGroupLayout ?? this.createComputeBindGroupLayout();

	private createComputeBindGroupLayout(): GPUBindGroupLayout {
		console.log("🔴 Creating visibility cull bind group layout");
		this.computeBindGroupLayout = this.device.createBindGroupLayout({
			label: "visibilityCullBindGroupLayout",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
			],
		});
		return this.computeBindGroupLayout;
	}

	////////////////////////////////////////////////////////////

	getComputeBindGroup = (particleCount: number) => {
		const currentBuffer = this.resources().particleResources.getParticleStorageBuffer();
		if (!this.computeBindGroup || 
			this.lastParticleCount !== particleCount ||
			this.lastParticleStorageBuffer !== currentBuffer) {
			return this.createComputeBindGroup(particleCount);
		}
		return this.computeBindGroup;
	};

	private createComputeBindGroup(particleCount: number): GPUBindGroup {
		console.log("🔴 Creating visibility cull bind group");
		this.computeBindGroup = this.device.createBindGroup({
			label: "visibilityCullBindGroup",
			layout: this.getComputeBindGroupLayout(),
			entries: [
				{ binding: 0, resource: { buffer: this.getCullUniformBuffer() } },
				{ binding: 1, resource: { buffer: this.resources().particleResources.getParticleStorageBuffer() } },
				{ binding: 2, resource: { buffer: this.resources().visibilityResources.getVisibleIndexBuffer(particleCount) } },
			],
		});
		this.lastParticleCount = particleCount;
		this.lastParticleStorageBuffer = this.resources().particleResources.getParticleStorageBuffer();
		return this.computeBindGroup;
	}

	////////////////////////////////////////////////////////////

	/**
	 * Dispatch the visibility culling compute pass.
	 * This should be called after particle generation and before rendering.
	 */
	dispatch(commandEncoder: GPUCommandEncoder) {
		const galaxy = this.galaxy();
		const particleCount = galaxy.totalStarCount;

		// Update uniforms for this frame
		this.updateUniforms();

		// Clear the visible count before culling
		this.resources().visibilityResources.clearVisibleCount(commandEncoder, particleCount);

		// Dispatch compute shader
		const pass = commandEncoder.beginComputePass();
		pass.setPipeline(this.getComputePipeline());
		pass.setBindGroup(0, this.getComputeBindGroup(particleCount));

		const workgroupSize = 256;
		const numGroups = Math.ceil(particleCount / workgroupSize);
		pass.dispatchWorkgroups(numGroups);
		pass.end();

		// Schedule copy of visible count for CPU readback
		this.resources().visibilityResources.copyVisibleCountForReadback(commandEncoder, particleCount);
	}

	////////////////////////////////////////////////////////////

	/**
	 * Invalidate bind groups (e.g., when particle buffer changes)
	 */
	invalidateBindGroups() {
		this.computeBindGroup = null;
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying visibility cull compute resources");
		this.cullUniformBuffer?.destroy();
		this.computePipeline = null;
		this.computeBindGroup = null;
		this.computeBindGroupLayout = null;
		this.cullUniformBuffer = null;
	}
}

