import { Particles } from "../compute/Particles";
import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "../managers/ResourceManager";
import { ParticleRenderer } from "../renderers/ParticleRenderer";
import { UNIFORM_LAYOUT } from "../constants/uniformLayout";
import { GALAXY_UNIFORM_BYTES } from "../utils/GalaxyUniformPacker";

export interface VRAMUsage {
	total: number;
	textures: number;
	buffers: number;
}

export class MemoryProfiler {
	device: GPUDevice;
	canvas: HTMLCanvasElement;
	resources: () => ResourceManager;
	particleRenderer: () => ParticleRenderer;
	particles: () => Particles;

	constructor(simulator: GalaxySimulator) {
		this.device = simulator.device;
		this.canvas = simulator.canvas;
		this.resources = () => {
			if (!!!simulator.resources) throw new Error("ResourceManager must be initialized before PerformanceProfiler");
			return simulator.resources;
		};
		this.particleRenderer = () => {
			if (!!!simulator.particleRenderer)
				throw new Error("ParticleRenderer must be initialized before PerformanceProfiler");
			return simulator.particleRenderer;
		};
		this.particles = () => {
			if (!!!simulator.particles) throw new Error("Particles must be initialized before PerformanceProfiler");
			return simulator.particles;
		};
	}

	// calculate current VRAM usage by summing texture and buffer sizes.
	getVRAMUsage(galaxy: Galaxy): VRAMUsage {
		let textureMemory = 0;
		let bufferMemory = 0;

		// Calculate texture memory usage
		const width = this.canvas.width;
		const height = this.canvas.height;
		const bytesPerPixel = 8; // rgba16float = 4 channels * 2 bytes each

		// MSAA texture (4x samples)
		if (this.resources().msaaResources.getMSAATexture(width, height)) {
			textureMemory += width * height * bytesPerPixel * 4;
		}

		// HDR texture
		if (this.resources().hdrResources.getHDRTexture(width, height)) {
			textureMemory += width * height * bytesPerPixel;
		}

		// Temporal denoise textures (current frame, denoised, history = 3 textures)
		// These are created in DenoiseResources
		textureMemory += width * height * bytesPerPixel * 3;

		// Bloom textures (half resolution)
		const bloomWidth = Math.floor(width / 2);
		const bloomHeight = Math.floor(height / 2);
		textureMemory += 2 * bloomWidth * bloomHeight * bytesPerPixel;

		// Particle storage buffer (48 bytes per particle)
		if (this.resources().particleResources.getParticleStorageBuffer()) {
			bufferMemory += galaxy.totalStarCount * 48;
		}

		// Uniform buffer
		if (this.resources().particleResources.getUniformBuffer()) {
			bufferMemory += UNIFORM_LAYOUT.totalSize;
		}

		// Compute galaxy uniform buffer
		if (this.particles().getComputeGalaxyUniformBuffer()) {
			bufferMemory += GALAXY_UNIFORM_BYTES;
		}

		// Overdraw count buffer (4 bytes per pixel) - now managed by ParticleRenderer
		// We can't directly access it, so we estimate based on canvas size
		bufferMemory += width * height * 4;

		// Quad vertex buffer
		if (this.resources().particleResources.getQuadVertexBuffer()) {
			bufferMemory += 48; // 12 vertices * 4 bytes
		}

		// Various small uniform buffers
		if (this.resources().toneMapResources.getToneParamBuffer()) bufferMemory += 36;
		if (this.resources().bloomResources.getBloomParamsBuffer()) bufferMemory += 16;
		if (this.resources().bloomResources.getBloomBlurHParamsBuffer()) bufferMemory += 16;
		if (this.resources().bloomResources.getBloomBlurVParamsBuffer()) bufferMemory += 16;
		// Temporal denoise params buffer (8 floats = 32 bytes)
		bufferMemory += 32;

		// GPU timing buffers
		if (this.resources().performanceProfiler().queryBuffer) bufferMemory += 24; // 3 queries * 8 bytes
		if (this.resources().performanceProfiler().resultBuffer) bufferMemory += 24;

		return {
			textures: textureMemory,
			buffers: bufferMemory,
			total: textureMemory + bufferMemory,
		};
	}
}
