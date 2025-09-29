import { GalaxySimulator } from "../GalaxySimulator";
import { mat4 } from "../utils/MatrixMath";
import { Galaxy } from "../entities/Galaxy";
import { CameraManager } from "../managers/CameraManager";
import { ResourceManager } from "../managers/ResourceManager";
import { writeGalaxyToDataView } from "../utils/GalaxyUniformPacker";

import { UNIFORM_LAYOUT } from "../constants/uniformLayout";

export class ParticleRenderer {
	private readonly device: GPUDevice;
	private readonly canvas: HTMLCanvasElement;

	private readonly camera: () => CameraManager;
	private readonly galaxy: () => Galaxy;
	private readonly resources: () => ResourceManager;

	// Temporary ArrayBuffer for staging uniform data before GPU upload.
	private readonly uniformDataArray = new ArrayBuffer(UNIFORM_LAYOUT.totalSize);

	// Cached DataView to avoid allocations in updateUniforms()
	private readonly cachedUniformDataView = new DataView(this.uniformDataArray);

	// Cached Float32Array view to avoid allocations in updateUniforms()
	private readonly cachedUniformF32Array = new Float32Array(this.uniformDataArray);

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.camera = () => {
			if (!!!simulator.camera) throw new Error("Camera must be initialized before ParticleRenderer");
			return simulator.camera;
		};
		this.galaxy = () => {
			if (!!!simulator.galaxy) throw new Error("Galaxy must be initialized before ParticleRenderer");
			return simulator.galaxy;
		};
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("ResourceManager must be initialized before ParticleRenderer");
			return simulator.resources;
		};
	}

	// Updates the uniform buffer with current view/projection matrices, galaxy parameters,
	// and canvas dimensions. Stages data in a temporary buffer before queuing the GPU write.
	updateUniforms() {
		const dataF32 = this.cachedUniformF32Array;

		mat4.copy(dataF32.subarray(0, 16), this.camera().matView);
		mat4.copy(dataF32.subarray(16, 32), this.camera().matProjection);

		const dataView = this.cachedUniformDataView;

		// Override-aware accumulation for this frame and overdraw sentinel handling
		let effectiveAccum = this.galaxy().temporalAccumulation;
		try {
			effectiveAccum = this.resources().accumulator().getEffectiveTemporalAccumulation();
		} catch {}
		const isOverdrawDisabled = this.galaxy().maxOverdraw >= 4096;
		const maxOverdrawOverride = isOverdrawDisabled ? 1e12 : undefined;

		writeGalaxyToDataView(this.galaxy(), dataView, UNIFORM_LAYOUT.galaxyOffset, {
			temporalAccumulation: effectiveAccum,
			maxOverdrawOverride,
		});

		// Write features field at offset 352
		dataView.setUint32(UNIFORM_LAYOUT.featuresOffset, 0, true); // features = 0

		// Write canvas dimensions at offset 356
		dataView.setFloat32(UNIFORM_LAYOUT.canvasOffset, this.canvas.width, true); // canvasWidth
		dataView.setFloat32(UNIFORM_LAYOUT.canvasOffset + 4, this.canvas.height, true); // canvasHeight
		dataView.setFloat32(UNIFORM_LAYOUT.canvasOffset + 8, 0.0, true); // padding1
		dataView.setFloat32(UNIFORM_LAYOUT.canvasOffset + 12, 0.0, true); // padding2

		this.resources().particleResources.setup();
		this.device.queue.writeBuffer(this.resources().particleResources.uniformBuffer!, 0, this.uniformDataArray);
	}

	// Allocates or resizes the particle storage buffer for the given star count.
	// Returns true if the buffer was recreated (size changed).
	allocateEmptyBuffer(count: number): boolean {
		const particleDataStride = 48;
		const size = count * particleDataStride;
		let recreated = false;
		if (
			!!!this.resources().particleResources.particleStorageBuffer ||
			this.resources().particleResources.particleStorageBuffer!.size < size
		) {
			this.resources().particleResources.particleStorageBuffer?.destroy();
			console.log(`🔴 Creating particle storage buffer (EXPENSIVE!) - Size: ${size} bytes`);
			this.resources().particleResources.particleStorageBuffer = this.device.createBuffer({
				label: "particleStorageBuffer",
				size,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			});
			recreated = true;
			console.log(`Particle storage buffer (empty) created. Size: ${size}`);
		}
		return recreated;
	}

	clearOverdrawBuffer(commandEncoder: GPUCommandEncoder) {
		if (this.galaxy().maxOverdraw >= 4096) return;
		this.resources().countOverdrawResources.setup();
		this.resources().countOverdrawResources.clear(commandEncoder, this.canvas.width, this.canvas.height);
	}

	// Renders particles to the provided render pass
	public render(passEncoder: GPURenderPassEncoder, starCount: number) {
		this.resources().particleResources.setup();
		const overdrawDisabled = this.galaxy().maxOverdraw >= 4096;
		const pipeline = (() => {
			if (this.galaxy().overdrawDebug && !overdrawDisabled)
				return this.resources().drawOverdrawResources.overdrawPipeline;
			if (overdrawDisabled) return this.resources().particleResources.particlePipelineNoOverdraw;
			return this.resources().particleResources.particlePipeline;
		})();

		passEncoder.setPipeline(pipeline!);

		const bg = overdrawDisabled
			? this.resources().particleResources.particleBindGroupNoOverdraw
			: this.resources().particleResources.particleBindGroup;
		if (!bg) {
			console.warn("Particle bind group not ready");
			return;
		}
		passEncoder.setBindGroup(0, bg);
		passEncoder.setVertexBuffer(0, this.resources().particleResources.quadVertexBuffer!);
		passEncoder.draw(6, starCount);
	}

	// Destroys all managed GPU buffers to free resources.
	destroy() {
		this.resources().particleResources.destroy();
	}
}
