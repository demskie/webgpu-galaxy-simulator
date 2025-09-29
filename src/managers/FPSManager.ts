import { GalaxySimulator } from "../GalaxySimulator";

const FPS_UPDATE_INTERVAL = 1_000; // Update FPS every second

export class FPSManager {
	// FPS tracking variables for calculating frames per second over intervals.
	private lastFrameTime = performance.now();
	private frameCount = 0;
	private fps = 0;

	// Frame rate limiting variables to control rendering frequency.
	private lastRenderTime = 0;
	private targetFrameTime = 1000 / 60; // Default to 60 FPS

	// Constructor initializes the profiler with required WebGPU objects and resources.
	constructor(simulator: GalaxySimulator) {}

	// Updates the FPS calculation based on the current time, accumulating frames over intervals.
	public updateFps(currentTime: number) {
		this.frameCount++;

		if (currentTime - this.lastFrameTime >= FPS_UPDATE_INTERVAL) {
			this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFrameTime));
			this.frameCount = 0;
			this.lastFrameTime = currentTime;
		}
	}

	// Returns the current calculated FPS value.
	public getFps(): number {
		return this.fps;
	}

	// Determines if a new frame should be rendered based on the target frame rate,
	// handling unlocked mode and delta time capping to prevent animation issues.
	public shouldRenderFrame(currentTime: number, maxFrameRate: number): { shouldRender: boolean; deltaTime: number } {
		let deltaTime = currentTime - this.lastRenderTime;

		// Handle first frame by initializing lastRenderTime
		if (this.lastRenderTime === 0) {
			this.lastRenderTime = currentTime;
			deltaTime = 16.67; // Default to 60 FPS for first frame (1000ms / 60fps)
		}

		// Check if frame rate limiting is disabled (unlocked at 120 FPS)
		const isUnlocked = maxFrameRate >= 120;

		// Update target frame time based on maxFrameRate setting (only if not unlocked)
		if (!isUnlocked) {
			this.targetFrameTime = 1000 / Math.max(1, Math.min(119, maxFrameRate));
		}

		// Cap deltaTime to prevent large jumps, but allow it to be at least 2x the target frame time
		// This prevents animation freezing at low frame rates while still capping excessive jumps
		const maxDeltaTime = isUnlocked ? 100 : Math.max(100, this.targetFrameTime * 2);
		deltaTime = Math.min(deltaTime, maxDeltaTime);

		// Only render if enough time has passed (or if unlocked)
		const shouldRender = isUnlocked || deltaTime >= this.targetFrameTime;

		if (shouldRender) {
			this.lastRenderTime = currentTime;
		}

		return { shouldRender, deltaTime };
	}
}
