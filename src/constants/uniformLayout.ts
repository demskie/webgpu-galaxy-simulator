// Shared uniform buffer layout for particle renderer/resources
// Offsets in bytes. Total size is padded to multiple of 16 for alignment.
export const UNIFORM_LAYOUT = {
	viewOffset: 0,
	projOffset: 64,
	galaxyOffset: 128, // Galaxy struct = 224 bytes (56 × 4)
	featuresOffset: 352, // 128 + 224
	canvasOffset: 356, // 352 + 4
	totalSize: 384, // 356 + 16 (canvasWidth, canvasHeight, padding1, padding2)
} as const;
