import galaxyPresetsData from "../galaxy-presets.json";
import { packGalaxyToArray } from "../utils/GalaxyUniformPacker";

const LOCAL_STORAGE_KEY = "galaxy-presets";

export interface GalaxyCallbacks {
	onToneParametersChanged?: () => void;
	onBloomParametersChanged?: () => void;
	onUniformDataChanged?: () => void;
	onOverdrawDebugChanged?: () => void;
	onParticleSizeChanged?: () => void;
	onAdvancedOptionsChanged?: () => void;
	onDenoiseParametersChanged?: () => void;
}

export class Galaxy {
	time: number = 0;
	galaxyRadius: number = 0;
	spiralPeakPosition: number = 0;
	spiralIntensity: number = 0;
	spiralTightness: number = 0;
	brightStarSize: number = 0;
	dustParticleSize: number = 0;
	totalStarCount: number = 0;
	spiralArmWaves: number = 0;
	spiralWaveStrength: number = 0;
	baseTemperature: number = 0;
	brightStarCount: number = 0;
	centralBulgeDensity: number = 0;
	diskStarDensity: number = 0;
	backgroundStarDensity: number = 0;
	densityFalloff: number = 0;
	rotationSpeed: number = 0;
	minimumBrightness: number = 0;
	brightnessVariation: number = 0;
	brightStarMinTemperature: number = 0;
	brightStarMaxTemperature: number = 0;
	temperatureRadiusFactor: number = 0;
	spiralWidthBase: number = 0;
	spiralWidthScale: number = 0;
	spiralEccentricityScale: number = 0;
	maxRotationVelocity: number = 0;
	rotationVelocityScale: number = 0;
	minColorTemperature: number = 0;
	maxColorTemperature: number = 0;
	galaxyEdgeFadeStart: number = 0;
	brightStarBaseMagnitude: number = 0;
	starEdgeSoftness: number = 0;
	brightStarRadiusFactor: number = 0;
	coreBrightStarSuppressionMag: number = 0;
	coreBrightStarSuppressionExtent: number = 0;
	radialExposureFalloff: number = 0;
	exposure: number = 0;
	saturation: number = 0;
	bloomIntensity: number = 0;
	bloomThreshold: number = 0;
	overdrawDebug: boolean = false;
	overdrawIntensity: number = 0;
	shadowLift: number = 0;
	minLiftThreshold: number = 0;
	particleSizeVariation: number = 0;
	minSizeVariation: number = 0.05;
	toneMapToe: number = 0;
	toneMapHighlights: number = 0;
	toneMapMidtones: number = 0;
	toneMapShoulder: number = 0;
	// Temporal denoising parameters
	denoiseSpatial: number = 0;
	denoiseColor: number = 0;
	denoiseTemporalAlpha: number = 0;
	brightStarBrightness: number = 0;
	maxFrameRate: number = 0;
	maxOverdraw: number = 0;
	// HDR Display Settings
	hdrMode: GPUCanvasToneMappingMode = "standard";
	hdrBrightness: number = 1.0;

	private callbacks: GalaxyCallbacks;

	// Cached array to avoid allocations in toGpuArray()
	private cachedGpuArray: Float32Array = new Float32Array(56); // 56 floats as per the comment in GalaxySimulator.ts

	constructor(props: Partial<Galaxy> = {}, callbacks: GalaxyCallbacks = {}) {
		Object.assign(this, DEFAULT_GALAXY_VALUES, props);
		this.callbacks = callbacks;
	}

	advanceTime(deltaTime: number) {
		const timeScale = 0.06;
		this.time += deltaTime * timeScale;
	}

	setExposure(val: number) {
		this.exposure = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setSaturation(val: number) {
		this.saturation = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setShadowLift(val: number) {
		this.shadowLift = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setMinLiftThreshold(val: number) {
		this.minLiftThreshold = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setToneMapToe(val: number) {
		this.toneMapToe = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setToneMapHighlights(val: number) {
		this.toneMapHighlights = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setToneMapMidtones(val: number) {
		this.toneMapMidtones = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setToneMapShoulder(val: number) {
		this.toneMapShoulder = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setBloomIntensity(val: number) {
		this.bloomIntensity = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setBloomThreshold(val: number) {
		this.bloomThreshold = val;
		this.callbacks.onBloomParametersChanged?.();
	}

	setOverdrawDebug(enabled: boolean) {
		if (this.overdrawDebug !== enabled) {
			this.overdrawDebug = enabled;
			this.callbacks.onOverdrawDebugChanged?.();
		}
	}

	setMaxFrameRate(val: number) {
		this.maxFrameRate = Math.max(1, Math.min(120, val));
	}

	setMaxOverdraw(val: number) {
		this.maxOverdraw = Math.max(1, Math.min(4096, val));
	}

	setHdrBrightness(val: number) {
		this.hdrBrightness = val;
		this.callbacks.onToneParametersChanged?.();
	}

	setParticleSizeVariation(val: number) {
		this.particleSizeVariation = val;
		this.callbacks.onParticleSizeChanged?.();
	}

	setMinSizeVariation(val: number) {
		this.minSizeVariation = val;
		this.callbacks.onParticleSizeChanged?.();
	}

	setRadialExposureFalloff(val: number) {
		this.radialExposureFalloff = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setRotationSpeed(val: number) {
		this.rotationSpeed = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarBrightness(val: number) {
		this.brightStarBrightness = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setDustParticleSize(val: number) {
		this.dustParticleSize = val;
		this.callbacks.onParticleSizeChanged?.();
	}

	setBrightStarSize(val: number) {
		this.brightStarSize = val;
		this.callbacks.onParticleSizeChanged?.();
	}

	setTotalStarCount(val: number) {
		this.totalStarCount = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setGalaxyRadius(val: number) {
		this.galaxyRadius = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralPeakPosition(val: number) {
		this.spiralPeakPosition = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralIntensity(val: number) {
		this.spiralIntensity = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralTightness(val: number) {
		this.spiralTightness = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralArmWaves(val: number) {
		this.spiralArmWaves = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralWaveStrength(val: number) {
		this.spiralWaveStrength = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBaseTemperature(val: number) {
		this.baseTemperature = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarCount(val: number) {
		this.brightStarCount = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setCentralBulgeDensity(val: number) {
		this.centralBulgeDensity = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setDiskStarDensity(val: number) {
		this.diskStarDensity = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBackgroundStarDensity(val: number) {
		this.backgroundStarDensity = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setDensityFalloff(val: number) {
		this.densityFalloff = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setMinimumBrightness(val: number) {
		this.minimumBrightness = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightnessVariation(val: number) {
		this.brightnessVariation = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarMinTemperature(val: number) {
		this.brightStarMinTemperature = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarMaxTemperature(val: number) {
		this.brightStarMaxTemperature = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setTemperatureRadiusFactor(val: number) {
		this.temperatureRadiusFactor = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralWidthBase(val: number) {
		this.spiralWidthBase = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralWidthScale(val: number) {
		this.spiralWidthScale = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setSpiralEccentricityScale(val: number) {
		this.spiralEccentricityScale = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setMaxRotationVelocity(val: number) {
		this.maxRotationVelocity = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setRotationVelocityScale(val: number) {
		this.rotationVelocityScale = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarRadiusFactor(val: number) {
		this.brightStarRadiusFactor = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setCoreBrightStarSuppressionMag(val: number) {
		this.coreBrightStarSuppressionMag = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setCoreBrightStarSuppressionExtent(val: number) {
		this.coreBrightStarSuppressionExtent = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setMinColorTemperature(val: number) {
		this.minColorTemperature = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setMaxColorTemperature(val: number) {
		this.maxColorTemperature = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setGalaxyEdgeFadeStart(val: number) {
		this.galaxyEdgeFadeStart = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setBrightStarBaseMagnitude(val: number) {
		this.brightStarBaseMagnitude = val;
		this.callbacks.onUniformDataChanged?.();
	}

	setStarEdgeSoftness(val: number) {
		this.starEdgeSoftness = val;
		this.callbacks.onParticleSizeChanged?.();
	}

	signalAdvancedOptionsMutation() {
		this.callbacks.onAdvancedOptionsChanged?.();
	}

	setDenoiseSpatial(val: number) {
		this.denoiseSpatial = val;
		this.callbacks.onDenoiseParametersChanged?.();
	}

	setDenoiseColor(val: number) {
		this.denoiseColor = val;
		this.callbacks.onDenoiseParametersChanged?.();
	}

	setDenoiseTemporalAlpha(val: number) {
		this.denoiseTemporalAlpha = val;
		this.callbacks.onDenoiseParametersChanged?.();
	}

	toGpuArray(): Float32Array {
		// Ensure cached array exists (it might be overwritten by preset data)
		if (!!!this.cachedGpuArray || this.cachedGpuArray.length !== 56) {
			this.cachedGpuArray = new Float32Array(56);
		}
		// Use centralized packer to populate the array
		packGalaxyToArray(this, this.cachedGpuArray);
		return this.cachedGpuArray;
	}

	getToneParametersArray(): Float32Array {
		return new Float32Array([
			this.exposure,
			this.saturation,
			this.bloomIntensity,
			this.shadowLift,
			this.minLiftThreshold,
			this.toneMapToe,
			this.toneMapHighlights,
			this.toneMapMidtones,
			this.toneMapShoulder,
		]);
	}

	updateFromPreset(preset: Partial<Galaxy>) {
		// Save callbacks and cached array before assignment to prevent them from being overwritten
		const savedCallbacks = this.callbacks;
		const savedCachedGpuArray = this.cachedGpuArray;
		Object.assign(this, preset);
		// Restore callbacks and cached array
		this.callbacks = savedCallbacks;
		this.cachedGpuArray = savedCachedGpuArray;
		this.callbacks.onUniformDataChanged?.();
		this.callbacks.onToneParametersChanged?.();
		this.callbacks.onBloomParametersChanged?.();
		this.callbacks.onDenoiseParametersChanged?.();
	}

	toPreset(): Partial<Galaxy> {
		const { time, callbacks, cachedGpuArray, ...preset } = this as any;
		return { ...preset, time: 0 };
	}
}

const DEFAULT_GALAXY_VALUES = {
	time: 0,
	galaxyRadius: 16000,
	spiralPeakPosition: 0.32,
	spiralIntensity: 0,
	spiralTightness: 0.00027,
	brightStarSize: 278,
	dustParticleSize: 105,
	totalStarCount: 1017000,
	spiralArmWaves: 2,
	spiralWaveStrength: 66.62,
	baseTemperature: 4680,
	brightStarCount: 1745,
	centralBulgeDensity: 19,
	diskStarDensity: 100,
	backgroundStarDensity: 25,
	densityFalloff: 0.3,
	rotationSpeed: 5000,
	minimumBrightness: 0.0307,
	brightnessVariation: 0,
	brightStarMinTemperature: 5400,
	brightStarMaxTemperature: 8600,
	temperatureRadiusFactor: 5.1,
	spiralWidthBase: 0.1,
	spiralWidthScale: 0.5,
	spiralEccentricityScale: 0.58,
	maxRotationVelocity: 800,
	rotationVelocityScale: 4000,
	minColorTemperature: 1000,
	maxColorTemperature: 10000,
	galaxyEdgeFadeStart: 1.0,
	brightStarBaseMagnitude: 0.3,
	starEdgeSoftness: 0.34,
	brightStarRadiusFactor: 1.02,
	coreBrightStarSuppressionMag: 0.2,
	coreBrightStarSuppressionExtent: 0.5,
	radialExposureFalloff: 0.77,
	exposure: 2.1,
	saturation: 4.98,
	bloomIntensity: 1.89,
	bloomThreshold: 0.033,
	overdrawDebug: false,
	overdrawIntensity: 0.05,
	shadowLift: 0,
	minLiftThreshold: 0,
	particleSizeVariation: 0.97,
	minSizeVariation: 0.05,
	toneMapToe: 0,
	toneMapHighlights: 1,
	toneMapMidtones: 1,
	toneMapShoulder: 1,
	denoiseSpatial: 1.0,
	denoiseColor: 0.5,
	denoiseTemporalAlpha: 0.1,
	brightStarBrightness: 1,
	maxFrameRate: 30,
	maxOverdraw: 4096,
};

export type GalaxyPresets = Record<string, Partial<Galaxy>>;

function loadPresetsFromLocalStorage(): GalaxyPresets | null {
	try {
		const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (!!!stored) return null;
		const parsed = JSON.parse(stored);
		if (typeof parsed === "object" && parsed !== null && !!!Array.isArray(parsed)) {
			return parsed as GalaxyPresets;
		}
		return null;
	} catch (error) {
		console.warn("Failed to load presets from localStorage:", error);
		return null;
	}
}

function savePresetsToLocalStorage(presets: GalaxyPresets) {
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(presets, null, 2));
	} catch (error) {
		console.error("Failed to save presets to localStorage:", error);
	}
}

function getDefaultPresetsFromJson(): GalaxyPresets {
	const defaultPresets: GalaxyPresets = {};
	for (const [name, preset] of Object.entries(galaxyPresetsData)) {
		defaultPresets[name] = {
			...DEFAULT_GALAXY_VALUES,
			...preset,
		};
	}
	return defaultPresets;
}

function getAllPresets(): GalaxyPresets {
	let presets = loadPresetsFromLocalStorage();
	if (!!!presets) {
		presets = getDefaultPresetsFromJson();
	}
	savePresetsToLocalStorage(presets);
	return presets;
}

export function getGalaxyPresetNames(): string[] {
	return Object.keys(getAllPresets());
}

export function getGalaxyPreset(name: string): Partial<Galaxy> {
	const presets = getAllPresets();
	const galaxy = presets[name];
	if (!!!galaxy) throw new Error(`Galaxy preset "${name}" not found`);
	return galaxy;
}

export function getDefaultGalaxyPreset(callbacks: GalaxyCallbacks = {}): Galaxy {
	const presetNames = getGalaxyPresetNames();
	if (presetNames.length === 0) throw new Error("No galaxy presets available");
	return new Galaxy(getGalaxyPreset(presetNames[0]), callbacks);
}

export function saveGalaxyPreset(name: string, galaxy: Galaxy | Partial<Galaxy>) {
	const presets = getAllPresets();
	if (galaxy instanceof Galaxy) {
		presets[name] = galaxy.toPreset();
	} else {
		const { time, ...presetData } = galaxy as any;
		presets[name] = { ...presetData, time: 0 };
	}
	savePresetsToLocalStorage(presets);
}

export function renamePreset(oldName: string, newName: string): boolean {
	try {
		saveGalaxyPreset(newName, getGalaxyPreset(oldName));
		return deleteGalaxyPreset(oldName);
	} catch (error) {
		console.error("Failed to rename preset:", error);
		return false;
	}
}

export function deleteGalaxyPreset(name: string): boolean {
	const presets = getAllPresets();
	if (!!!(name in presets)) return false;
	delete presets[name];
	savePresetsToLocalStorage(presets);
	return true;
}

export function exportGalaxyPresets(): string {
	const presets = getAllPresets();
	return JSON.stringify(presets, null, 2);
}

export function importGalaxyPresets(jsonString: string): { success: boolean; error?: string; imported?: number } {
	try {
		const parsed = JSON.parse(jsonString);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { success: false, error: "Invalid JSON format: expected object with preset names as keys" };
		}
		for (const [name, preset] of Object.entries(parsed)) {
			if (typeof name !== "string" || typeof preset !== "object" || preset === null) {
				return { success: false, error: `Invalid preset format for "${name}"` };
			}
		}
		const currentPresets = getAllPresets();
		const mergedPresets = { ...currentPresets, ...(parsed as GalaxyPresets) };
		savePresetsToLocalStorage(mergedPresets);
		return { success: true, imported: Object.keys(parsed).length };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
	}
}

export function resetPresetsToDefault() {
	const defaultPresets = getDefaultPresetsFromJson();
	savePresetsToLocalStorage(defaultPresets);
}
