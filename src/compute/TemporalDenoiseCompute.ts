import { GalaxySimulator } from "../GalaxySimulator";
import temporalDenoiseCompWGSL from "../shaders/compute/temporal-denoise.comp.wgsl";

export class TemporalDenoiseCompute {
	private readonly device: GPUDevice;
	private readonly simulator: () => GalaxySimulator;

	private computePipeline: GPUComputePipeline | null = null;
	private computeBindGroup: GPUBindGroup | null = null;
	private computeBindGroupLayout: GPUBindGroupLayout | null = null;
	private paramsBuffer: GPUBuffer | null = null;
	// Params layout (12 floats):
	// [0]=sigmaSpatial, [1]=sigmaColor, [2]=temporalAlpha, [3]=pad,
	// [4]=prevPanX, [5]=prevPanY, [6]=currPanX, [7]=currPanY,
	// [8]=prevDolly, [9]=currDolly, [10]=pad, [11]=pad
	private paramsScratch: Float32Array = new Float32Array(12);

	// When > 0, use full current frame (no history blending) to avoid ghosting
	private resetFramesRemaining: number = 0;

	// Camera history for reprojection
	private prevCameraPanX: number = 0.0;
	private prevCameraPanY: number = 0.0;
	private prevCameraDolly: number = 1.0;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.simulator = () => simulator;
	}

	setup() {
		// Initialize camera history so first frame doesn't "jump"
		const camera = this.simulator().camera;
		this.prevCameraPanX = camera.panX;
		this.prevCameraPanY = camera.panY;
		this.prevCameraDolly = camera.dolly;
		// Avoid blending with uninitialized history right after setup/resize
		this.resetFramesRemaining = 2;

		// Create params buffer (12 floats: denoise params + pan/dolly reprojection)
		this.paramsBuffer = this.device.createBuffer({
			label: "temporalDenoiseParamsBuffer",
			size: 48, // 12 floats
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this.updateParams();
	}

	destroy() {
		this.paramsBuffer?.destroy();
		this.paramsBuffer = null;
		this.computePipeline = null;
		this.computeBindGroup = null;
		this.computeBindGroupLayout = null;
	}

	updateParams() {
		if (!this.paramsBuffer) return;
		const galaxy = this.simulator().galaxy;
		const camera = this.simulator().camera;

		this.paramsScratch[0] = galaxy.denoiseSpatial;
		this.paramsScratch[1] = galaxy.denoiseColor;

		// During reset frames, use 100% current frame to avoid ghosting
		if (this.resetFramesRemaining > 0) {
			this.paramsScratch[2] = 1.0; // Full current frame, no history
			this.resetFramesRemaining--;
		} else {
			this.paramsScratch[2] = galaxy.denoiseTemporalAlpha;
		}

		this.paramsScratch[3] = 0; // padding

		// Camera pan reprojection params (prev -> curr)
		this.paramsScratch[4] = this.prevCameraPanX;
		this.paramsScratch[5] = this.prevCameraPanY;
		this.paramsScratch[6] = camera.panX;
		this.paramsScratch[7] = camera.panY;

		// Camera dolly reprojection params
		this.paramsScratch[8] = this.prevCameraDolly;
		this.paramsScratch[9] = camera.dolly;
		this.paramsScratch[10] = 0.0; // padding
		this.paramsScratch[11] = 0.0; // padding

		this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsScratch.buffer, 0, this.paramsScratch.byteLength);
	}

	/**
	 * Reset temporal accumulation to avoid ghosting when camera moves.
	 * This causes the denoiser to use 100% current frame for a few frames.
	 */
	resetTemporalAccumulation() {
		this.resetFramesRemaining = 2; // Skip history blending for 2 frames
	}

	getParamsBuffer(): GPUBuffer {
		return this.paramsBuffer!;
	}

	invalidateBindGroups() {
		// Called when textures are recreated (e.g., on resize)
		this.computeBindGroup = null;
	}

	private getComputeBindGroupLayout(): GPUBindGroupLayout {
		if (this.computeBindGroupLayout) return this.computeBindGroupLayout;
		this.computeBindGroupLayout = this.device.createBindGroupLayout({
			label: "temporalDenoiseComputeBindGroupLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float" }, // current raw
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float" }, // history
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					sampler: {}, // history sampler (linear clamp)
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					storageTexture: { access: "write-only", format: "rgba16float" }, // output
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" },
				},
			],
		});
		return this.computeBindGroupLayout;
	}

	private getComputePipeline(): GPUComputePipeline {
		if (this.computePipeline) return this.computePipeline;
		const pipelineLayout = this.device.createPipelineLayout({
			label: "temporalDenoiseComputePipelineLayout",
			bindGroupLayouts: [this.getComputeBindGroupLayout()],
		});
		this.computePipeline = this.device.createComputePipeline({
			label: "temporalDenoiseComputePipeline",
			layout: pipelineLayout,
			compute: {
				module: this.device.createShaderModule({
					code: temporalDenoiseCompWGSL,
				}),
				entryPoint: "main",
			},
		});
		return this.computePipeline;
	}

	private createComputeBindGroup(): GPUBindGroup {
		const resources = this.simulator().resources;
		// Current raw frame from particle rendering
		const currentView = resources.getCurrentFrameView();
		// History = denoised output from previous frame
		const historyView = resources.getHistoryView();
		const historySampler = resources.getSampler();
		// Output = denoised texture (will also be copied to history for next frame)
		const outputView = resources.getDenoisedView();

		return this.device.createBindGroup({
			label: "temporalDenoiseComputeBindGroup",
			layout: this.getComputePipeline().getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: currentView },
				{ binding: 1, resource: historyView },
				{ binding: 2, resource: historySampler },
				{ binding: 3, resource: outputView },
				{ binding: 4, resource: { buffer: this.paramsBuffer! } },
			],
		});
	}

	private getBindGroup(): GPUBindGroup {
		if (!this.computeBindGroup) {
			this.computeBindGroup = this.createComputeBindGroup();
		}
		return this.computeBindGroup;
	}

	dispatch(commandEncoder: GPUCommandEncoder) {
		const pass = commandEncoder.beginComputePass({
			label: "Temporal Denoise Pass",
		});
		pass.setPipeline(this.getComputePipeline());
		pass.setBindGroup(0, this.getBindGroup());

		const width = this.simulator().canvas.width;
		const height = this.simulator().canvas.height;
		const wgX = Math.ceil(width / 8);
		const wgY = Math.ceil(height / 8);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		// Advance camera history once we've scheduled this frame's denoise
		const camera = this.simulator().camera;
		this.prevCameraPanX = camera.panX;
		this.prevCameraPanY = camera.panY;
		this.prevCameraDolly = camera.dolly;
	}
}
