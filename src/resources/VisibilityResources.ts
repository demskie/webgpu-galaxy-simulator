import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";

import prepareIndirectWGSL from "../shaders/compute/prepare-indirect.comp.wgsl";

/**
 * VisibilityResources manages GPU buffers for frustum culling:
 * - Visible index buffer: stores indices of visible particles
 * - Indirect draw buffer: for drawIndexedIndirect command
 * - Count readback buffer: for reading visible count back to CPU
 */
export class VisibilityResources {
	private readonly device: GPUDevice;
	private readonly resources: () => ResourceManager;

	// Buffer containing visible particle indices (filled by compute shader)
	private visibleIndexBuffer: GPUBuffer | null = null;
	private lastVisibleIndexBufferSize = 0;

	// Indirect draw buffer for drawIndexedIndirect
	// Layout: indexCount (u32), instanceCount (u32), firstIndex (u32), baseVertex (i32), firstInstance (u32)
	private indirectDrawBuffer: GPUBuffer | null = null;

	// Staging buffer for reading visible count back to CPU
	private countReadbackBuffer: GPUBuffer | null = null;

	// Index buffer for indexed drawing (simple 0, 1, 2, 3, 4, 5 per quad)
	private quadIndexBuffer: GPUBuffer | null = null;

	// Cached visible count from last readback
	private _lastVisibleCount = 0;

	// Compute pipeline for preparing indirect draw buffer
	private prepareIndirectPipeline: GPUComputePipeline | null = null;
	private prepareIndirectBindGroupLayout: GPUBindGroupLayout | null = null;
	private prepareIndirectBindGroup: GPUBindGroup | null = null;
	private lastPrepareIndirectParticleCount = 0;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.resources = () => simulator.resources;
	}

	setup() {}

	////////////////////////////////////////////////////////////

	getPrepareIndirectPipeline = () => this.prepareIndirectPipeline ?? this.createPrepareIndirectPipeline();

	private createPrepareIndirectPipeline(): GPUComputePipeline {
		console.log("🔴 Creating prepare indirect pipeline");
		const layout = this.getPrepareIndirectBindGroupLayout();
		this.prepareIndirectPipeline = this.device.createComputePipeline({
			label: "prepareIndirectPipeline",
			layout: this.device.createPipelineLayout({
				label: "prepareIndirectPipelineLayout",
				bindGroupLayouts: [layout],
			}),
			compute: {
				module: this.device.createShaderModule({ code: prepareIndirectWGSL }),
				entryPoint: "main",
			},
		});
		return this.prepareIndirectPipeline;
	}

	////////////////////////////////////////////////////////////

	getPrepareIndirectBindGroupLayout = () => 
		this.prepareIndirectBindGroupLayout ?? this.createPrepareIndirectBindGroupLayout();

	private createPrepareIndirectBindGroupLayout(): GPUBindGroupLayout {
		console.log("🔴 Creating prepare indirect bind group layout");
		this.prepareIndirectBindGroupLayout = this.device.createBindGroupLayout({
			label: "prepareIndirectBindGroupLayout",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
			],
		});
		return this.prepareIndirectBindGroupLayout;
	}

	////////////////////////////////////////////////////////////

	getPrepareIndirectBindGroup = (maxParticles: number) => {
		if (!this.prepareIndirectBindGroup || this.lastPrepareIndirectParticleCount !== maxParticles) {
			return this.createPrepareIndirectBindGroup(maxParticles);
		}
		return this.prepareIndirectBindGroup;
	};

	private createPrepareIndirectBindGroup(maxParticles: number): GPUBindGroup {
		console.log("🔴 Creating prepare indirect bind group");
		this.prepareIndirectBindGroup = this.device.createBindGroup({
			label: "prepareIndirectBindGroup",
			layout: this.getPrepareIndirectBindGroupLayout(),
			entries: [
				{ binding: 0, resource: { buffer: this.getVisibleIndexBuffer(maxParticles) } },
				{ binding: 1, resource: { buffer: this.getIndirectDrawBuffer() } },
			],
		});
		this.lastPrepareIndirectParticleCount = maxParticles;
		return this.prepareIndirectBindGroup;
	}

	////////////////////////////////////////////////////////////

	/**
	 * Dispatch the prepare indirect compute pass
	 * This should be called after visibility culling and before rendering
	 */
	dispatchPrepareIndirect(commandEncoder: GPUCommandEncoder, maxParticles: number) {
		const pass = commandEncoder.beginComputePass();
		pass.setPipeline(this.getPrepareIndirectPipeline());
		pass.setBindGroup(0, this.getPrepareIndirectBindGroup(maxParticles));
		pass.dispatchWorkgroups(1); // Only need 1 workgroup of 1 thread
		pass.end();
	}

	////////////////////////////////////////////////////////////

	/**
	 * Get visible count from last readback (may be 1-2 frames behind)
	 */
	get lastVisibleCount(): number {
		return this._lastVisibleCount;
	}

	////////////////////////////////////////////////////////////

	getVisibleIndexBuffer = (maxParticles: number) => {
		// Buffer needs: 4 bytes for atomic count + 12 bytes padding + 4 bytes per index
		const requiredSize = 16 + maxParticles * 4;
		if (!this.visibleIndexBuffer || this.lastVisibleIndexBufferSize < requiredSize) {
			return this.createVisibleIndexBuffer(requiredSize);
		}
		return this.visibleIndexBuffer;
	};

	private createVisibleIndexBuffer(size: number): GPUBuffer {
		console.log(`🔴 Creating visible index buffer - Size: ${size} bytes`);
		this.visibleIndexBuffer?.destroy();
		this.visibleIndexBuffer = this.device.createBuffer({
			label: "visibleIndexBuffer",
			size: size,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});
		this.lastVisibleIndexBufferSize = size;
		return this.visibleIndexBuffer;
	}

	////////////////////////////////////////////////////////////

	getIndirectDrawBuffer = () => this.indirectDrawBuffer ?? this.createIndirectDrawBuffer();

	private createIndirectDrawBuffer(): GPUBuffer {
		console.log("🔴 Creating indirect draw buffer");
		this.indirectDrawBuffer?.destroy();
		// drawIndexedIndirect needs 5 u32 values (20 bytes), align to 256
		this.indirectDrawBuffer = this.device.createBuffer({
			label: "indirectDrawBuffer",
			size: 256,
			usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		return this.indirectDrawBuffer;
	}

	////////////////////////////////////////////////////////////

	getCountReadbackBuffer = () => this.countReadbackBuffer ?? this.createCountReadbackBuffer();

	private createCountReadbackBuffer(): GPUBuffer {
		console.log("🔴 Creating count readback buffer");
		this.countReadbackBuffer?.destroy();
		this.countReadbackBuffer = this.device.createBuffer({
			label: "countReadbackBuffer",
			size: 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		return this.countReadbackBuffer;
	}

	////////////////////////////////////////////////////////////

	getQuadIndexBuffer = () => this.quadIndexBuffer ?? this.createQuadIndexBuffer();

	private createQuadIndexBuffer(): GPUBuffer {
		console.log("🔴 Creating quad index buffer");
		this.quadIndexBuffer?.destroy();
		// 6 indices per quad (2 triangles)
		const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
		this.quadIndexBuffer = this.device.createBuffer({
			label: "quadIndexBuffer",
			size: indices.byteLength,
			usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Uint32Array(this.quadIndexBuffer.getMappedRange()).set(indices);
		this.quadIndexBuffer.unmap();
		return this.quadIndexBuffer;
	}

	////////////////////////////////////////////////////////////

	/**
	 * Clear the visible count at the start of each frame
	 */
	clearVisibleCount(commandEncoder: GPUCommandEncoder, maxParticles: number) {
		const buffer = this.getVisibleIndexBuffer(maxParticles);
		// Clear just the atomic count (first 4 bytes)
		commandEncoder.clearBuffer(buffer, 0, 4);
	}

	////////////////////////////////////////////////////////////

	/**
	 * Async read of visible count - should be called after GPU work completes
	 * Returns a promise that resolves to the visible count
	 */
	async readVisibleCount(): Promise<number> {
		const buffer = this.getCountReadbackBuffer();
		
		try {
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new Uint32Array(buffer.getMappedRange());
			this._lastVisibleCount = data[0];
			buffer.unmap();
		} catch {
			// Buffer might be busy, return cached value
		}
		
		return this._lastVisibleCount;
	}

	/**
	 * Schedule a copy of the visible count for later readback
	 */
	copyVisibleCountForReadback(commandEncoder: GPUCommandEncoder, maxParticles: number) {
		const visibleBuffer = this.getVisibleIndexBuffer(maxParticles);
		const readbackBuffer = this.getCountReadbackBuffer();
		
		// Only copy if readback buffer isn't currently mapped
		if (readbackBuffer.mapState === "unmapped") {
			commandEncoder.copyBufferToBuffer(visibleBuffer, 0, readbackBuffer, 0, 4);
		}
	}

	////////////////////////////////////////////////////////////

	destroy() {
		console.log("🔴 Destroying visibility resources");
		this.visibleIndexBuffer?.destroy();
		this.indirectDrawBuffer?.destroy();
		this.countReadbackBuffer?.destroy();
		this.quadIndexBuffer?.destroy();
		this.visibleIndexBuffer = null;
		this.indirectDrawBuffer = null;
		this.countReadbackBuffer = null;
		this.quadIndexBuffer = null;
	}
}

