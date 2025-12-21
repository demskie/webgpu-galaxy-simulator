import { getGalaxyPreset, getDefaultGalaxyPreset, Galaxy, GalaxyCallbacks } from "./entities/Galaxy";

import { ResourceManager } from "./managers/ResourceManager";
import { RenderingManager } from "./managers/RenderingManager";
import { FPSManager } from "./managers/FPSManager";
import { UIManager } from "./managers/UIManager";
import { CameraManager } from "./managers/CameraManager";
import { Particles } from "./compute/Particles";
import { ParticleRenderer } from "./renderers/ParticleRenderer";
import { PerformanceProfiler } from "./profilers/PerformanceProfiler";
import { MemoryProfiler } from "./profilers/MemoryProfiler";
import { vec3 } from "./utils/MatrixMath";

export class GalaxySimulator {
	readonly canvas: HTMLCanvasElement;
	readonly device: GPUDevice;
	readonly context: GPUCanvasContext;
	readonly presentationFormat: GPUTextureFormat;

	readonly galaxy: Galaxy;
	readonly camera: CameraManager;
	readonly particleRenderer: ParticleRenderer;
	readonly resources: ResourceManager;
	readonly renderer: RenderingManager;
	readonly fps: FPSManager;
	readonly performanceProfiler: PerformanceProfiler;
	readonly memoryProfiler: MemoryProfiler;
	readonly ui: UIManager;
	readonly particles: Particles;

	// Track particle count changes for efficient updates
	private lastParticleCount = 0;

	// Visible particle count from frustum culling (updated asynchronously)
	private _visibleParticleCount = 0;

	constructor(
		canvas: HTMLCanvasElement,
		device: GPUDevice,
		context: GPUCanvasContext,
		presentationFormat: GPUTextureFormat,
		initialHDRMode: GPUCanvasToneMappingMode = "standard",
		initialHDRBrightness: number = 1.0
	) {
		this.canvas = canvas;
		this.device = device;
		this.context = context;
		this.presentationFormat = presentationFormat;

		// Initialize galaxy with callbacks to handle UI value changes
		this.galaxy = getDefaultGalaxyPreset(this.getGalaxyCallbacks());

		// Set HDR params before UI is created so it picks up the correct values
		this.galaxy.hdrMode = initialHDRMode;
		this.galaxy.hdrBrightness = initialHDRBrightness;

		// Initialize particle count tracking
		this.lastParticleCount = this.galaxy.totalStarCount;

		// Initialize managers and renderers
		this.camera = new CameraManager(this);
		this.camera.setCameraOrientation(vec3.fromValues(0, 1, 0));

		// Initialize particle renderer before we create particle resources
		this.particleRenderer = new ParticleRenderer(this);

		// Initialize resources (includes temporal denoising setup)
		this.resources = new ResourceManager(this);
		this.resources.setup();

		// Initialize performance profiler with advanced options enabled/disabled
		this.performanceProfiler = new PerformanceProfiler(this);
		if (PerformanceProfiler.getAdvancedOptionsEnabled()) {
			this.performanceProfiler.create();
		}

		// Initialize everything else
		this.fps = new FPSManager(this);
		this.memoryProfiler = new MemoryProfiler(this);
		this.particles = new Particles(this);
		this.particles.setup();
		this.renderer = new RenderingManager(this);
		this.ui = new UIManager(this);

		this.updateUniformData();
		this.particles.update();

		window.requestAnimationFrame(() => this.mainLoop());
	}

	static async start(canvasId: string): Promise<GalaxySimulator> {
		if (!!!navigator.gpu)
			throw new Error("WebGPU not supported on this browser. The latest version of Chrome is recommended.");

		const adapter = await navigator.gpu.requestAdapter();
		if (!!!adapter) throw new Error("No appropriate GPUAdapter found.");

		let device: GPUDevice;
		try {
			device = await adapter.requestDevice({
				requiredFeatures: ["timestamp-query"],
			});
		} catch {
			console.warn("timestamp-query feature not supported, GPU timing will be unavailable");
			device = await adapter.requestDevice();
		}
		if (!!!device) throw new Error("Failed to get GPUDevice.");

		const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
		if (!!!canvas) throw Error(`Failed to get canvas object with id "${canvasId}"`);

		const context = canvas.getContext("webgpu");
		if (!!!context) throw new Error("Failed to get GPUCanvasContext.");

		// Check if HDR display is available - enable extended mode by default if so
		const isHDRAvailable = GalaxySimulator.isHDRDisplaySupported();
		const initialHDRMode: GPUCanvasToneMappingMode = isHDRAvailable ? "extended" : "standard";

		// Use rgba16float for HDR support - allows colors brighter than white
		const presentationFormat: GPUTextureFormat = "rgba16float";
		context.configure({
			device: device,
			format: presentationFormat,
			alphaMode: "premultiplied",
			toneMapping: { mode: initialHDRMode },
		});

		// Set HDR defaults based on availability
		const initialBrightness = isHDRAvailable ? 2.3 : 1.0;

		return new GalaxySimulator(canvas, device, context, presentationFormat, initialHDRMode, initialBrightness);
	}

	/**
	 * Reconfigure the canvas context for HDR mode changes.
	 * This allows toggling between standard (SDR) and extended (HDR) tone mapping.
	 * In extended mode, colors can be brighter than white (#FFFFFF) on HDR displays.
	 */
	configureHDR() {
		this.context.configure({
			device: this.device,
			format: this.presentationFormat,
			alphaMode: "premultiplied",
			toneMapping: { mode: this.galaxy.hdrMode },
		});
	}

	/**
	 * Check if the display supports HDR.
	 */
	static isHDRDisplaySupported(): boolean {
		return window.matchMedia("(dynamic-range: high)").matches;
	}

	selectPreset(name: string) {
		const preset = getGalaxyPreset(name);
		this.galaxy.updateFromPreset(preset);

		// Update particle count tracking for the new preset
		this.lastParticleCount = this.galaxy.totalStarCount;

		// Reset temporal denoising to avoid ghosting from previous preset
		this.resources.temporalDenoiseCompute.resetTemporalAccumulation();

		// Update particles to match the new preset
		this.updateParticles();

		// Trigger an immediate render bypassing the normal frame loop
		this.immediateRender();
	}

	private updateUniformData() {
		this.particleRenderer.updateUniforms();

		// Update compute uniforms via Particles API
		// Check if particles class is initialized
		if (!!!this.particles) {
			console.warn("Particles not initialized yet, skipping compute uniform update");
			return;
		}
		this.particles.updateComputeGalaxyUniformBuffer();
	}

	private getGalaxyCallbacks(): GalaxyCallbacks {
		return {
			onToneParametersChanged: () => this.requestToneParameterUpdate(),
			onBloomParametersChanged: () => this.requestBloomParameterUpdate(),
			onUniformDataChanged: () => this.requestUniformDataUpdate(),
			onOverdrawDebugChanged: () => this.handleOverdrawDebugChange(),
			onParticleSizeChanged: () => this.handleParticleSizeChange(),
			onAdvancedOptionsChanged: () => this.handleAdvancedOptionsChange(),
			onDenoiseParametersChanged: () => this.updateDenoiseParameters(),
		};
	}

	private updateToneParameters() {
		this.resources.toneMapResources.setup();
	}

	private updateBloomParameters() {
		this.resources.bloomResources.setup();
	}

	private handleOverdrawDebugChange() {
		this.resources.temporalDenoiseCompute.resetTemporalAccumulation();
		this.resources.setup();
	}

	private updateDenoiseParameters() {
		this.resources.temporalDenoiseCompute.updateParams();
	}

	private handleParticleSizeChange() {
		this.updateUniformData();
		this.particles.update();
	}

	private handleAdvancedOptionsChange() {
		if (PerformanceProfiler.getAdvancedOptionsEnabled()) {
			this.performanceProfiler.create();
		} else {
			this.performanceProfiler.destroy();
		}
	}

	private requestToneParameterUpdate() {
		this.updateToneParameters();
	}

	private requestBloomParameterUpdate() {
		this.updateBloomParameters();
	}

	private requestUniformDataUpdate() {
		this.updateUniformData();
	}

	private update(deltaTime: number) {
		this.galaxy.advanceTime(deltaTime);
		this.updateUniformData();
	}

	private render() {
		const particleUpdateNeeded = this.galaxy.totalStarCount !== this.lastParticleCount;
		if (particleUpdateNeeded) {
			this.updateUniformData();
		}
		const success = this.renderer.render(
			this.galaxy,
			this.performanceProfiler.isReadingResults(),
			particleUpdateNeeded
		);
		if (this.performanceProfiler.shouldReadTimingResults(success)) this.performanceProfiler.readTimingResults();
	}

	updateParticles() {
		this.updateUniformData();
		this.particles.update();
		// Update particle count tracking after particles are updated
		this.lastParticleCount = this.galaxy.totalStarCount;
	}

	/**
	 * Get the number of visible particles from the last frame's frustum culling.
	 * This value is updated asynchronously and may be 1-2 frames behind.
	 */
	get visibleParticleCount(): number {
		return this._visibleParticleCount;
	}

	/**
	 * Update the visible particle count from GPU readback.
	 * Called periodically to get the latest visibility culling results.
	 */
	async updateVisibleParticleCount(): Promise<void> {
		try {
			this._visibleParticleCount = await this.resources.visibilityResources.readVisibleCount();
		} catch {
			// Ignore errors - buffer might be busy
		}
	}

	immediateRender() {
		// Perform an immediate render cycle bypassing frame rate limiting
		const currentTime = performance.now();
		const deltaTime = 16.67; // Use a default delta time for immediate renders
		this.performanceProfiler.startCpuFrameTiming();
		this.fps.updateFps(currentTime);
		this.update(deltaTime);
		this.render();
		this.performanceProfiler.endCpuFrameTiming();
	}

	mainLoop() {
		this.performanceProfiler.startCpuFrameTiming();
		const currentTime = performance.now();
		const { shouldRender, deltaTime } = this.fps.shouldRenderFrame(currentTime, this.galaxy.maxFrameRate);
		if (shouldRender) {
			this.fps.updateFps(currentTime);
			this.update(deltaTime);
			this.render();
			this.performanceProfiler.endCpuFrameTiming();
		}
		window.requestAnimationFrame(() => this.mainLoop());
	}

	resize(width: number, height: number) {
		console.log(`🟠 GalaxySimulator.resize called with ${width}x${height}`);
		this.canvas.width = width;
		this.canvas.height = height;
		this.resources.setup();
		this.camera.adjustCamera();
		// Reset temporal denoising on resize to avoid ghosting
		this.resources.temporalDenoiseCompute.invalidateBindGroups();
		this.resources.temporalDenoiseCompute.resetTemporalAccumulation();
		this.updateUniformData();
	}
}
