import { getGalaxyPreset, getDefaultGalaxyPreset, Galaxy, GalaxyCallbacks } from "./entities/Galaxy";

import { ResourceManager } from "./managers/ResourceManager";
import { RenderingManager } from "./managers/RenderingManager";
import { FPSManager } from "./managers/FPSManager";
import { AccumulationManager } from "./managers/AccumulationManager";
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
	readonly accumulator: AccumulationManager;
	readonly ui: UIManager;
	readonly particles: Particles;

	constructor(
		canvas: HTMLCanvasElement,
		device: GPUDevice,
		context: GPUCanvasContext,
		presentationFormat: GPUTextureFormat
	) {
		this.canvas = canvas;
		this.device = device;
		this.context = context;
		this.presentationFormat = presentationFormat;

		// Initialize galaxy with callbacks to handle UI value changes
		this.galaxy = getDefaultGalaxyPreset(this.getGalaxyCallbacks());

		// Initialize managers and renderers
		this.camera = new CameraManager(this);
		this.camera.setCameraOrientation(vec3.fromValues(0, 1, 0));

		// Initialize particle renderer and accumulation manager before we create particle resources
		this.particleRenderer = new ParticleRenderer(this);
		this.accumulator = new AccumulationManager(this);

		// Initialize particle resources
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
		this.renderer = new RenderingManager(this);
		this.ui = new UIManager(this);

		this.updateUniformData();
		this.particles.update();

		window.requestAnimationFrame(() => this.mainLoop());
	}

	static async start(canvasId: string): Promise<GalaxySimulator> {
		if (!!!navigator.gpu) throw new Error("WebGPU not supported on this browser.");

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

		const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device: device,
			format: presentationFormat,
			alphaMode: "premultiplied",
		});

		return new GalaxySimulator(canvas, device, context, presentationFormat);
	}

	selectPreset(name: string) {
		const preset = getGalaxyPreset(name);
		this.galaxy.updateFromPreset(preset);

		// Immediately clear accumulation buffers to prevent showing remnants of previous preset
		this.galaxy.temporalFrame = 0;
		this.resources.accumulationResources.requestForceClear();
		this.resources.accumulationResources.setup(); // Force clear on preset change occurs internally

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
		this.particles.updateComputeUniforms();
	}

	private getGalaxyCallbacks(): GalaxyCallbacks {
		return {
			onToneParametersChanged: () => this.requestToneParameterUpdate(),
			onBloomParametersChanged: () => this.requestBloomParameterUpdate(),
			onUniformDataChanged: () => this.requestUniformDataUpdate(),
			onOverdrawDebugChanged: () => this.handleOverdrawDebugChange(),
			onParticleSizeChanged: () => this.handleParticleSizeChange(),
			onAdvancedOptionsChanged: () => this.handleAdvancedOptionsChange(),
		};
	}

	private updateToneParameters() {
		this.resources.toneMapResources.setup();
	}

	private updateBloomParameters() {
		this.resources.bloomResources.setup();
	}

	private handleOverdrawDebugChange() {
		this.resetAccumulationBuffers(false);
		this.resources.setup();
	}

	private handleParticleSizeChange() {
		this.resetAccumulationBuffers();
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
		this.resetAccumulationBuffers();
		this.updateToneParameters();
	}

	private requestBloomParameterUpdate() {
		this.resetAccumulationBuffers();
		this.updateBloomParameters();
	}

	private requestUniformDataUpdate() {
		this.resetAccumulationBuffers();
		this.updateUniformData();
	}

	private resetAccumulationBuffers(immediate: boolean = true) {
		this.accumulator.requestFullRenderNextFrame();
		this.resources.accumulationResources.requestForceClear();
		if (immediate) {
			this.resources.accumulationResources.setup();
		}
	}

	private update(deltaTime: number) {
		this.galaxy.advanceTime(deltaTime);
		this.accumulator.update();
		this.updateUniformData();
	}

	private render() {
		const particleUpdateNeeded = this.galaxy.totalStarCount !== this.particles.getLastParticleCount();
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
	}

	immediateRender() {
		// Perform an immediate render cycle bypassing frame rate limiting
		const currentTime = performance.now();
		const deltaTime = 16.67; // Use a default delta time for immediate renders
		this.performanceProfiler.startCpuFrameTiming();
		this.fps.updateFps(currentTime);
		const overrideActive = this.accumulator.beginOneFrameOverrideIfRequested();
		this.update(deltaTime);
		this.render();
		if (overrideActive) this.accumulator.endOneFrameOverride();
		this.performanceProfiler.endCpuFrameTiming();
	}

	mainLoop() {
		this.performanceProfiler.startCpuFrameTiming();
		const currentTime = performance.now();
		const { shouldRender, deltaTime } = this.fps.shouldRenderFrame(currentTime, this.galaxy.maxFrameRate);
		if (shouldRender) {
			this.fps.updateFps(currentTime);
			const overrideActive = this.accumulator.beginOneFrameOverrideIfRequested();
			this.update(deltaTime);
			this.render();
			if (overrideActive) this.accumulator.endOneFrameOverride();
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
		this.accumulator.requestFullRenderNextFrame();
		this.updateUniformData();
	}
}
