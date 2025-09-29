import type { Galaxy } from "../entities/Galaxy";

export const GALAXY_UNIFORM_FLOATS = 56;
export const GALAXY_UNIFORM_BYTES = GALAXY_UNIFORM_FLOATS * 4;

export function packGalaxyToArray(galaxy: Galaxy, out?: Float32Array): Float32Array {
	const arr = out && out.length === GALAXY_UNIFORM_FLOATS ? out : new Float32Array(GALAXY_UNIFORM_FLOATS);

	arr[0] = galaxy.time;
	arr[1] = galaxy.galaxyRadius;
	arr[2] = galaxy.spiralPeakPosition;
	arr[3] = galaxy.spiralIntensity;
	arr[4] = galaxy.spiralTightness;
	arr[5] = galaxy.brightStarSize;
	arr[6] = galaxy.dustParticleSize;
	arr[7] = galaxy.totalStarCount;
	arr[8] = galaxy.spiralArmWaves;
	arr[9] = galaxy.spiralWaveStrength;
	arr[10] = galaxy.baseTemperature;
	arr[11] = galaxy.brightStarCount;
	arr[12] = galaxy.centralBulgeDensity;
	arr[13] = galaxy.diskStarDensity;
	arr[14] = galaxy.backgroundStarDensity;
	arr[15] = galaxy.densityFalloff;
	arr[16] = galaxy.rotationSpeed;
	arr[17] = galaxy.minimumBrightness;
	arr[18] = galaxy.brightnessVariation;
	arr[19] = galaxy.brightStarMinTemperature;
	arr[20] = galaxy.brightStarMaxTemperature;
	arr[21] = galaxy.temperatureRadiusFactor;
	arr[22] = galaxy.spiralWidthBase;
	arr[23] = galaxy.spiralWidthScale;
	arr[24] = galaxy.spiralEccentricityScale;
	arr[25] = galaxy.maxRotationVelocity;
	arr[26] = galaxy.rotationVelocityScale;
	arr[27] = galaxy.minColorTemperature;
	arr[28] = galaxy.maxColorTemperature;
	arr[29] = galaxy.galaxyEdgeFadeStart;
	arr[30] = galaxy.brightStarBaseMagnitude;
	arr[31] = galaxy.starEdgeSoftness;
	arr[32] = galaxy.brightStarRadiusFactor;
	arr[33] = galaxy.coreBrightStarSuppressionMag;
	arr[34] = galaxy.coreBrightStarSuppressionExtent;
	arr[35] = galaxy.radialExposureFalloff;
	arr[36] = galaxy.exposure;
	arr[37] = galaxy.saturation;
	arr[38] = galaxy.bloomIntensity;
	arr[39] = galaxy.bloomThreshold;
	arr[40] = galaxy.overdrawDebug ? 1.0 : 0.0;
	arr[41] = galaxy.overdrawIntensity;
	arr[42] = galaxy.shadowLift;
	arr[43] = galaxy.minLiftThreshold;
	arr[44] = galaxy.particleSizeVariation;
	arr[45] = galaxy.toneMapToe;
	arr[46] = galaxy.toneMapHighlights;
	arr[47] = galaxy.toneMapMidtones;
	arr[48] = galaxy.toneMapShoulder;
	arr[49] = galaxy.temporalAccumulation;
	arr[50] = galaxy.temporalFrame;
	arr[51] = galaxy.brightStarBrightness;
	arr[52] = galaxy.maxOverdraw;
	arr[53] = 0.0; // padding1
	arr[54] = 0.0; // padding2
	arr[55] = 0.0; // padding3

	return arr;
}

export function writeGalaxyToDataView(
	galaxy: Galaxy,
	dataView: DataView,
	byteOffset: number,
	opts?: { temporalAccumulation?: number; maxOverdrawOverride?: number }
): void {
	// Pack to a temporary array (caller can pass their own out array if needed)
	const tmp = packGalaxyToArray(galaxy);
	if (opts && opts.temporalAccumulation !== undefined) tmp[49] = opts.temporalAccumulation;
	if (opts && opts.maxOverdrawOverride !== undefined) tmp[52] = opts.maxOverdrawOverride;
	for (let i = 0; i < GALAXY_UNIFORM_FLOATS; i++) {
		dataView.setFloat32(byteOffset + i * 4, tmp[i], true);
	}
}
