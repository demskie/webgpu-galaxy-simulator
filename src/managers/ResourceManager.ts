import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ParticleRenderer } from "../renderers/ParticleRenderer";
import { AccumulationManager } from "./AccumulationManager";
import { AccumulationResources } from "../resources/AccumulationResources";
import { PerformanceProfiler } from "../profilers/PerformanceProfiler";
import { ParticleResources } from "../resources/ParticleResources";
import { BloomResources } from "../resources/BloomResources";
import { ToneMapResources } from "../resources/ToneMapResources";
import { HDRResources } from "../resources/HDRResources";
import { MSAAResources } from "../resources/MSAAResources";
import { CountOverdrawResources } from "../resources/CountOverdrawResources";
import { DrawOverdrawResources } from "../resources/DrawOverdrawResources";

// The ResourceManager class is responsible for managing all WebGPU resources
// required for rendering and simulating galaxies. This includes creating and
// maintaining pipelines, buffers, textures, bind groups, and other GPU objects.
// It handles resource creation, updates, and cleanup, ensuring efficient GPU
// usage. The class provides methods to create and recreate these resources as needed,
// such as when the canvas size changes or parameters are updated.
export class ResourceManager {
	canvas: HTMLCanvasElement;
	device: GPUDevice;
	context: GPUCanvasContext;
	presentationFormat: GPUTextureFormat;
	galaxy: () => Galaxy;
	particleRenderer: () => ParticleRenderer;
	performanceProfiler: () => PerformanceProfiler;
	accumulator: () => AccumulationManager;
	accumulationResources: AccumulationResources;
	particleResources: ParticleResources;
	countOverdrawResources: CountOverdrawResources;
	drawOverdrawResources: DrawOverdrawResources;
	bloomResources: BloomResources;
	toneMapResources: ToneMapResources;
	hdrResources: HDRResources;
	msaaResources: MSAAResources;

	// Constructor initializes the ResourceManager with required WebGPU objects
	// and external resources. It sets up the canvas dimensions based on device
	// pixel ratio for high-DPI rendering, creates rendering pipelines, and
	// initializes post-processing resources.
	constructor(simulator: GalaxySimulator) {
		this.canvas = simulator.canvas;
		this.device = simulator.device;
		this.context = simulator.context;
		this.presentationFormat = simulator.presentationFormat;

		this.galaxy = () => {
			if (!!!simulator.galaxy) throw new Error("Galaxy must be initialized before ResourceManager");
			return simulator.galaxy;
		};
		this.particleRenderer = () => {
			if (!!!simulator.particleRenderer) throw new Error("ParticleRenderer must be initialized before ResourceManager");
			return simulator.particleRenderer;
		};
		this.performanceProfiler = () => {
			if (!!!simulator.performanceProfiler)
				throw new Error("PerformanceProfiler must be initialized before ResourceManager");
			return simulator.performanceProfiler;
		};
		this.accumulator = () => {
			if (!!!simulator.accumulator) throw new Error("Accumulator must be initialized before ResourceManager");
			return simulator.accumulator;
		};
		this.accumulationResources = new AccumulationResources(simulator);
		this.particleResources = new ParticleResources(simulator);
		this.countOverdrawResources = new CountOverdrawResources(simulator);
		this.drawOverdrawResources = new DrawOverdrawResources(simulator);
		this.bloomResources = new BloomResources(simulator);
		this.toneMapResources = new ToneMapResources(simulator);
		this.hdrResources = new HDRResources(simulator);
		this.msaaResources = new MSAAResources(simulator);

		// Calculate initial canvas buffer size accounting for device pixel ratio
		// to ensure sharp rendering on high-DPI displays. The CSS size is the
		// visible size, while the buffer size is scaled by devicePixelRatio.
		const [ccw, cch] = [this.canvas.clientWidth, this.canvas.clientHeight];
		const [cw, ch] = [this.canvas.width, this.canvas.height];
		const idpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.floor(ccw * idpr));
		this.canvas.height = Math.max(1, Math.floor(cch * idpr));
		console.log(`Initial Canvas Size Set - CSS: ${ccw}x${cch}, Buffer: ${cw}x${ch} (DPR: ${idpr})`);
	}

	// Public method to create or recreate post-processing resources. This includes
	// MSAA textures, HDR textures, bloom textures, tone mapping resources, and
	// temporal accumulation resources. It is called when the canvas size changes
	// or when parameters affecting resource dimensions are updated.
	setup() {
		console.log("🔴 Creating post processing resources");
		this.particleResources.setup();
		this.drawOverdrawResources.setup();
		this.msaaResources.setup();
		this.hdrResources.setup();
		this.countOverdrawResources.setup();
		this.drawOverdrawResources.setup();
		this.bloomResources.setup();
		this.toneMapResources.setup();
		this.accumulationResources.updateWeightsBuffer();
	}

	// Public method to clean up all GPU resources. This should be called when
	// shutting down the application or when needing to completely reset resources.
	destroy() {
		console.log("Destroying ResourceManager GPU resources");
		this.accumulationResources.destroy();
		this.bloomResources.destroy();
		this.toneMapResources.destroy();
		this.hdrResources.destroy();
		this.msaaResources.destroy();
		this.countOverdrawResources.destroy();
		this.drawOverdrawResources.destroy();
	}

	// Toggle handler destroy or recreate overdraw resources based on maxOverdraw
	handleMaxOverdrawChange() {
		if (this.galaxy().maxOverdraw >= 4096) {
			// Destroy and null out overdraw resources
			this.countOverdrawResources.destroy();
			this.drawOverdrawResources.destroy();
		} else {
			// Recreate as needed
			this.countOverdrawResources.setup();
			this.drawOverdrawResources.setup();
		}
		// Ensure particle storage buffer exists before creating bind group
		this.particleRenderer().allocateEmptyBuffer(this.galaxy().totalStarCount);
		// Recreate particle bind group to reflect layout (with/without overdraw buffer)
		this.particleResources.setup();
		this.accumulationResources.updateWeightsBuffer();
	}
}
