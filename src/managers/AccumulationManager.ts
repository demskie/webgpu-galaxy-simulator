import { Galaxy } from "../entities/Galaxy";
import { GalaxySimulator } from "../GalaxySimulator";
import { ResourceManager } from "./ResourceManager";
import { snapToPowerOfTwo } from "../utils/Powers";

// The AccumulationManager handles temporal accumulation for the galaxy rendering pipeline.
// It manages accumulation layers and ensures power-of-two slice counts. This separation
// allows the main simulator to focus on core logic while accumulation is handled independently.

export class AccumulationManager {
	private readonly resources: () => ResourceManager;
	private readonly galaxy: () => Galaxy;

	// Last used temporal accumulation count (number of frames averaged).
	private lastTemporalAccumulation = 1;

	// Track how many frames have been rendered since last buffer clear
	private framesSinceBufferClear = 16;

	// One-frame override control to force full rendering with accumulation=1
	private oneFrameOverrideRequested = false;
	private oneFrameOverrideActive = false;

	getLastTemporalAccumulation(): number {
		return this.lastTemporalAccumulation;
	}

	getFramesSinceBufferClear(): number {
		return this.framesSinceBufferClear;
	}

	constructor(simulator: GalaxySimulator) {
		this.resources = () => {
			if (!simulator.resources) throw new Error("Resources must be initialized before AccumulationManager");
			return simulator.resources;
		};
		this.galaxy = () => {
			if (!simulator.galaxy) throw new Error("Galaxy must be initialized before AccumulationManager");
			return simulator.galaxy;
		};
		this.lastTemporalAccumulation = simulator.galaxy.temporalAccumulation;
	}

	// Called by ResourceManager after creating accumulation resources to update the actual value
	updateLastTemporalAccumulation(value: number) {
		// Only update if ResourceManager actually changed the value (e.g., snapped to power of 2)
		// This prevents circular updates
		if (this.lastTemporalAccumulation !== value) {
			this.lastTemporalAccumulation = value;
		}
	}

	// Main update method: Simplified orchestrator that delegates to helper methods.
	update() {
		// Handle immediate accumulation value changes
		this.handleAccumulationChange();

		// Advance the temporal frame counter
		this.advanceTemporalFrame();

		// Track frames since last buffer clear for weighting
		this.incrementFramesSinceClear();

		return { shouldRegen: true };
	}

	// Request that the next rendered frame uses temporalAccumulation=1 (full render)
	requestFullRenderNextFrame() {
		this.oneFrameOverrideRequested = true;
	}

	// Activate the one-frame override at frame start if requested
	beginOneFrameOverrideIfRequested(): boolean {
		if (this.oneFrameOverrideRequested && !this.oneFrameOverrideActive) {
			this.oneFrameOverrideActive = true;
			this.oneFrameOverrideRequested = false;
			return true;
		}
		return false;
	}

	// Deactivate the override after the frame completes
	endOneFrameOverride() {
		this.oneFrameOverrideActive = false;
	}

	// Effective accumulation value to use this frame (override-aware)
	getEffectiveTemporalAccumulation(): number {
		return this.oneFrameOverrideActive ? 1 : this.lastTemporalAccumulation;
	}

	// Handles immediate accumulation value changes.
	// Simply applies the new value without any ramping.
	private handleAccumulationChange() {
		const currentAcc = this.lastTemporalAccumulation;

		// Check if galaxy value has changed externally (e.g., from UI)
		const galaxyValue = this.galaxy().temporalAccumulation;
		const galaxySnapped = snapToPowerOfTwo(galaxyValue);

		// If the galaxy value has not changed, do nothing
		if (galaxySnapped === currentAcc) return;

		// Apply the change immediately
		this.updateResourcesIfChanged(galaxySnapped);

		// Reset temporal frame if needed
		if (this.galaxy().temporalFrame >= galaxySnapped) {
			this.galaxy().temporalFrame = 0;
		}
	}

	// Advances the temporal frame counter, wrapping within current accumulation.
	private advanceTemporalFrame() {
		this.galaxy().temporalFrame = (this.galaxy().temporalFrame + 1) % this.lastTemporalAccumulation;
	}

	// Increments the frames-since-clear counter (capped at 16).
	private incrementFramesSinceClear() {
		if (this.framesSinceBufferClear < 16) {
			this.framesSinceBufferClear++;
		}
	}

	// Helper to update resources and state if the accumulation value changes.
	// Calls ResourceManager and updates local state/galaxy.
	private updateResourcesIfChanged(newAcc: number) {
		console.log("🟠 AccumulationManager.updateResourcesIfChanged called");
		if (newAcc === this.lastTemporalAccumulation) return;

		// Update galaxy first
		this.galaxy().temporalAccumulation = newAcc;

		// Update our internal state BEFORE calling ResourceManager
		this.lastTemporalAccumulation = newAcc;

		// Now create resources
		this.resources().accumulationResources.setup();
	}

	// Called when accumulation buffers are cleared (e.g., from ResourceManager)
	resetFramesSinceBufferClear() {
		this.framesSinceBufferClear = 0;
	}
}
