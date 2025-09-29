import { GalaxySimulator } from "../GalaxySimulator";
import { RenderingManager } from "../managers/RenderingManager";
import { ResourceManager } from "../managers/ResourceManager";

// The number of frames to skip before writing a timestamp to the GPU.
const GPU_TIMING_RESOLUTION = 59;

// Interface defining GPU timing measurements in milliseconds for different rendering stages.
export interface GPUTimes {
	frame: number;
	stars: number;
	post: number;
}

// This allows measuring the duration of GPU operations for performance analysis.
export class PerformanceProfiler {
	device: GPUDevice;
	renderingManager: () => RenderingManager;
	resources: () => ResourceManager;

	// Query set for GPU timestamp queries to measure performance.
	querySet: GPUQuerySet | null = null;

	// Buffer to resolve query results into.
	queryBuffer: GPUBuffer | null = null;

	// Buffer to copy query results for CPU reading.
	resultBuffer: GPUBuffer | null = null;

	// GPU timing storage for frame, stars, and post-processing durations.
	private gpuTimes: GPUTimes = {
		frame: 0,
		stars: 0,
		post: 0,
	};

	// CPU frame time tracking.
	private cpuFrameTime = 0;
	private lastCpuFrameStart = 0;

	// Flags for managing asynchronous GPU timing reads.
	private isReadingTimingResults = false;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.renderingManager = () => {
			if (!!!simulator.renderer) throw new Error("RenderingManager must be initialized before PerformanceProfiler");
			return simulator.renderer;
		};
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("ResourceManager must be initialized before PerformanceProfiler");
			return simulator.resources;
		};
	}

	// Create resources for GPU timing using timestamp queries.
	create() {
		if (!!!this.device) return console.error("Device not ready for timing resources creation.");
		if (!!!this.device.features.has("timestamp-query")) {
			console.log("GPU timing not available (timestamp-query not supported)");
			return;
		}
		console.log("🔴 Creating Performance Profiler");
		try {
			// Create query set for 3 timestamps: frame start, stars end, frame end.
			this.querySet = this.device.createQuerySet({
				type: "timestamp",
				count: 3,
			});
			// Create buffer to hold resolved query results.
			this.queryBuffer = this.device.createBuffer({
				size: 3 * 8, // 3 * u64 (8 bytes each)
				usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
			});
			// Create mappable buffer for CPU reading of results.
			this.resultBuffer = this.device.createBuffer({
				size: 3 * 8,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			});
		} catch (error) {
			console.warn("Failed to create timing resources:", error);
			this.querySet = null;
			this.queryBuffer = null;
			this.resultBuffer = null;
		}
	}

	// Reads the advanced options toggle from localStorage (defaults to true)
	static getAdvancedOptionsEnabled(): boolean {
		try {
			const val = localStorage.getItem("showAdvancedOptions");
			return val === null ? true : val === "true";
		} catch {
			return true;
		}
	}

	private isActiveFrame(): boolean {
		return this.renderingManager().getFrameCount() % GPU_TIMING_RESOLUTION === 0;
	}

	// Get the timestamp writes for the render pass.
	// This is used to measure the duration of the render pass.
	getRenderPassTimestampWrites(): GPURenderPassTimestampWrites | undefined {
		if (!!!this.querySet) return undefined;
		return this.isActiveFrame()
			? {
					querySet: this.querySet,
					beginningOfPassWriteIndex: 0, // Start of frame
					endOfPassWriteIndex: 1, // End of stars rendering
			  }
			: undefined;
	}

	// Get the timestamp writes for the tone mapping pass.
	getToneMappingTimestampWrites(): GPURenderPassTimestampWrites | undefined {
		if (!!!this.querySet) return undefined;
		return this.isActiveFrame()
			? {
					querySet: this.querySet,
					beginningOfPassWriteIndex: 1, // Start of tone mapping
					endOfPassWriteIndex: 2, // End of tone mapping
			  }
			: undefined;
	}

	// Marks the start of CPU frame timing measurement.
	startCpuFrameTiming() {
		this.lastCpuFrameStart = performance.now();
	}

	// Calculates and stores the CPU frame time after rendering completes.
	endCpuFrameTiming() {
		this.cpuFrameTime = performance.now() - this.lastCpuFrameStart;
	}

	// Returns the last measured CPU frame time in milliseconds.
	getCpuFrameTime(): number {
		return this.cpuFrameTime;
	}

	// Checks if GPU timing results should be read this frame, throttling to every 10th successful render.
	shouldReadTimingResults(renderSuccess: boolean): boolean {
		if (renderSuccess) {
			return this.isActiveFrame() && !this.isReadingTimingResults;
		}
		return false;
	}

	// Asynchronously reads GPU timing results from the query buffer, converting to milliseconds.
	// Handles mapping, reading, and unmapping the buffer safely with error handling.
	async readTimingResults(): Promise<GPUTimes | null> {
		const resultBuffer = this.resources().performanceProfiler().resultBuffer;
		if (!!!resultBuffer || this.isReadingTimingResults) return null;
		this.isReadingTimingResults = true;
		try {
			await resultBuffer.mapAsync(GPUMapMode.READ);
			const arrayBuffer = resultBuffer.getMappedRange();
			const timingData = new BigUint64Array(arrayBuffer);
			const nsToMs = (ns: bigint) => Number(ns) / 1_000_000;
			if (timingData.length >= 3) {
				this.gpuTimes.stars = nsToMs(timingData[1] - timingData[0]);
				this.gpuTimes.post = nsToMs(timingData[2] - timingData[1]);
				this.gpuTimes.frame = nsToMs(timingData[2] - timingData[0]);
			}
			resultBuffer.unmap();
			return { ...this.gpuTimes };
		} catch (error) {
			console.warn("GPU timing read failed:", error);
		} finally {
			this.isReadingTimingResults = false;
		}
		return null;
	}

	// Returns a copy of the current GPU timing measurements.
	getGpuTimes(): GPUTimes {
		return { ...this.gpuTimes };
	}

	// Checks if GPU timing queries are available in the current setup.
	hasGpuTiming(): boolean {
		return this.resources().performanceProfiler().querySet !== null;
	}

	// Returns whether timing results are currently being read asynchronously.
	isReadingResults(): boolean {
		return this.isReadingTimingResults;
	}

	destroy() {
		console.log("🔴 Destroying Performance Profiler");
		this.querySet?.destroy();
		this.queryBuffer?.destroy();
		this.resultBuffer?.destroy();
		this.querySet = null;
		this.queryBuffer = null;
		this.resultBuffer = null;
	}
}
