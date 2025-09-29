// Snaps a given value to the nearest lower power of two.
// Supports values up to 16, returning 16 for any larger input to cap accumulation.
export function snapToPowerOfTwo(value: number): number {
	if (value <= 1) return 1;
	if (value <= 2) return 2;
	if (value <= 4) return 4;
	if (value <= 8) return 8;
	return 16;
}

// Returns the next higher power of two from the current value.
// Used during ramp-up to jump to valid slice counts without intermediate values.
export function getNextPowerOfTwo(current: number): number {
	if (current < 1) return 1;
	if (current < 2) return 2;
	if (current < 4) return 4;
	if (current < 8) return 8;
	if (current < 16) return 16;
	return 16;
}
