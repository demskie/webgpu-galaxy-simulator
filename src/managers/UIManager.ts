import { GalaxySimulator } from "../GalaxySimulator";
import {
	getGalaxyPresetNames,
	exportGalaxyPresets,
	renamePreset,
	saveGalaxyPreset,
	deleteGalaxyPreset,
} from "../entities/Galaxy";
import { PerformanceProfiler } from "../profilers/PerformanceProfiler";

export class UIManager {
	private simulator: GalaxySimulator;
	private isModified = false;
	private originalPresetName: string | null = null;
	private originalGalaxy: any = null;

	private readonly shapeParameters = new Set([
		"galaxyRadius",
		"spiralPeakPosition",
		"spiralIntensity",
		"spiralTightness",
		"spiralArmWaves",
		"spiralWaveStrength",
		"densityFalloff",
		"spiralEccentricityScale",
		"spiralWidthBase",
		"galaxyEdgeFadeStart",
		"brightStarCount",
		"centralBulgeDensity",
		"diskStarDensity",
		"backgroundStarDensity",
		"minimumBrightness",
		"brightnessVariation",
		"brightStarMinTemperature",
		"brightStarMaxTemperature",
		"temperatureRadiusFactor",
		"maxRotationVelocity",
		"rotationVelocityScale",
		"brightStarRadiusFactor",
		"coreBrightStarSuppressionMag",
		"coreBrightStarSuppressionExtent",
		"totalStarCount",
		"dustParticleSize",
		"brightStarSize",
		"starEdgeSoftness",
		"particleSizeVariation",
		"baseTemperature",
		"rotationSpeed",
		"brightStarBrightness",
	]);

	constructor(simulator: GalaxySimulator) {
		// This UIManager class is heavily dependent on the simulator class.
		// So unlike the other managers we aren't creating specific getters for the child classes.
		// Probably best to instantiate this class after all the other managers are instantiated.
		this.simulator = simulator;

		try {
			this.populatePresetSelect(this.simulator);
			this.updateHTML(this.simulator);

			this.setupResponsiveCanvas(this.simulator);
			this.setupPixelColorDisplay();
			this.setupAdvancedOptionsToggle();

			const select = document.getElementById("cbPreset") as HTMLSelectElement;
			if (select) {
				select.addEventListener("change", this.onSelectPreset.bind(this));
			}
			const saveBtn = document.getElementById("saveSelectedBtn") as HTMLButtonElement;
			if (saveBtn) {
				saveBtn.addEventListener("click", this.onSaveSelected.bind(this));
			}
			const resetBtn = document.getElementById("resetSelectedBtn") as HTMLButtonElement;
			if (resetBtn) {
				resetBtn.addEventListener("click", this.onResetSelected.bind(this));
			}
			const createBtn = document.getElementById("createPresetBtn") as HTMLButtonElement;
			if (createBtn) {
				createBtn.addEventListener("click", this.onCreatePreset.bind(this));
			}
			const renameBtn = document.getElementById("renamePresetBtn") as HTMLButtonElement;
			if (renameBtn) {
				renameBtn.addEventListener("click", this.onRenamePreset.bind(this));
			}
			const deleteBtn = document.getElementById("deletePresetBtn") as HTMLButtonElement;
			if (deleteBtn) {
				deleteBtn.addEventListener("click", this.onDeletePreset.bind(this));
			}
			const exportBtn = document.getElementById("exportPresetBtn") as HTMLButtonElement;
			if (exportBtn) {
				exportBtn.addEventListener("click", this.onExportPreset.bind(this));
			}
		} catch (error: any) {
			alert(error.message);
		}
	}

	private populatePresetSelect(simulator: GalaxySimulator) {
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select) return;

		// Clear existing options
		select.innerHTML = "";

		// Get preset names from the simulator
		const presetNames = getGalaxyPresetNames();

		// Add options for each preset
		presetNames.forEach((name, index) => {
			const option = document.createElement("option");
			option.value = name;
			option.textContent = name;
			if (index === 0) option.selected = true; // Select first option by default
			select.appendChild(option);
		});

		// Initialize modification tracking for the first preset
		if (presetNames.length > 0) {
			this.originalPresetName = presetNames[0];
			this.originalGalaxy = JSON.parse(JSON.stringify(simulator.galaxy));
			this.setModificationState(false);
		}
	}

	private setupResponsiveCanvas(simulator: GalaxySimulator) {
		const canvas = document.getElementById("cvGalaxy") as HTMLCanvasElement;
		if (!canvas) return;

		let currentSize = 0;
		let resizeAnimationId: number | null = null;

		const resizeCanvas = () => {
			const canvas = document.getElementById("cvGalaxy") as HTMLCanvasElement;
			if (!canvas) return;

			const canvasContainer = canvas.parentElement;
			if (!canvasContainer) return;

			// Force a reflow to ensure we get the latest computed styles
			canvasContainer.offsetHeight;

			// Set canvas to fill its container
			const containerSize = Math.min(canvasContainer.clientWidth, canvasContainer.clientHeight);
			const size = Math.floor(containerSize);

			// Only resize if the size actually changed by more than 1 pixel
			if (Math.abs(size - currentSize) <= 1) {
				return;
			}

			currentSize = size;

			// Set canvas display size (CSS)
			canvas.style.width = size + "px";
			canvas.style.height = size + "px";

			// Apply device pixel ratio to buffer size for sharp rendering on high-DPI displays
			const devicePixelRatio = window.devicePixelRatio || 1;
			const bufferWidth = Math.max(1, Math.floor(size * devicePixelRatio));
			const bufferHeight = Math.max(1, Math.floor(size * devicePixelRatio));

			// Only update canvas resolution if the simulator is ready
			// This prevents multiple resize calls during initialization
			if (simulator && typeof simulator.resize === "function" && size > 0) {
				// Pass the buffer size (with devicePixelRatio applied) to the simulator
				simulator.resize(bufferWidth, bufferHeight);
			}
		};

		const debouncedResize = () => {
			if (resizeAnimationId) {
				cancelAnimationFrame(resizeAnimationId);
			}
			resizeAnimationId = requestAnimationFrame(resizeCanvas);
		};

		// Initial resize - wait for next frame to ensure DOM is ready
		requestAnimationFrame(resizeCanvas);

		// Handle window resize with debouncing
		window.addEventListener("resize", debouncedResize);

		// Also handle when the container size changes with debouncing
		if (window.ResizeObserver) {
			const resizeObserver = new ResizeObserver(debouncedResize);
			const container = canvas.parentElement;
			if (container) {
				resizeObserver.observe(container);
			}
		}

		// Also add a mutation observer to watch for layout changes
		if (window.MutationObserver) {
			const mutationObserver = new MutationObserver(() => {
				setTimeout(debouncedResize, 50);
			});
			mutationObserver.observe(document.body, {
				attributes: true,
				attributeFilter: ["style", "class"],
				subtree: true,
			});
		}
	}

	private setupPixelColorDisplay() {
		const canvas = document.getElementById("cvGalaxy") as HTMLCanvasElement;
		const colorDisplay = document.getElementById("pixelColorDisplay");
		if (!colorDisplay) return;

		const colorSwatch = colorDisplay.querySelector(".color-swatch") as HTMLElement;
		const colorText = colorDisplay.querySelector(".color-text") as HTMLElement;
		const fpsText = colorDisplay.querySelector(".fps-text") as HTMLElement;

		if (!canvas || !colorDisplay) return;

		// Create an offscreen canvas for reading pixel data
		const offscreenCanvas = document.createElement("canvas");
		const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
		if (!offscreenCtx) return;

		// Update offscreen canvas size when main canvas resizes
		const updateOffscreenCanvas = () => {
			offscreenCanvas.width = canvas.width;
			offscreenCanvas.height = canvas.height;
		};

		// Initial size
		updateOffscreenCanvas();

		// Watch for canvas size changes
		const resizeObserver = new ResizeObserver(updateOffscreenCanvas);
		resizeObserver.observe(canvas);

		let animationFrameId: number | null = null;

		const getPixelColor = () => {
			// Draw the WebGL canvas to the 2D canvas
			offscreenCtx.drawImage(canvas, 0, 0);

			// Read pixels after drawing
			return (x: number, y: number) => {
				const pixelData = offscreenCtx.getImageData(x, y, 1, 1).data;
				return {
					r: pixelData[0],
					g: pixelData[1],
					b: pixelData[2],
					a: pixelData[3],
				};
			};
		};

		const updatePixelColor = (event: MouseEvent) => {
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
			}

			animationFrameId = requestAnimationFrame(() => {
				const rect = canvas.getBoundingClientRect();
				const scaleX = canvas.width / rect.width;
				const scaleY = canvas.height / rect.height;

				const x = Math.floor((event.clientX - rect.left) * scaleX);
				const y = Math.floor((event.clientY - rect.top) * scaleY);

				if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
					const getPixel = getPixelColor();
					const color = getPixel(x, y);
					colorSwatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
					colorText.textContent = `RGB(${color.r}, ${color.g}, ${color.b})`;
				}
			});
		};

		canvas.addEventListener("mousemove", updatePixelColor);
		canvas.addEventListener("mouseenter", updatePixelColor);
		canvas.addEventListener("mouseleave", () => {
			colorSwatch.style.backgroundColor = "#000";
			colorText.textContent = "Move mouse over canvas";
		});

		const updatePerformanceDisplay = () => {
			if (!!this.simulator && fpsText) {
				const fps = this.simulator.fps.getFps();
				fpsText.textContent = `FPS: ${fps}`;
			}

			// Update temporal accumulation slider state periodically
			// This handles dynamic state changes in the simulator
			if (!!this.simulator) {
				this.updateTemporalAccumulationSliderUI();
			}

			// Keep Max Overdraw UI consistent (label + overdraw checkbox state)
			const moSlider = document.getElementById("slMaxOverdraw") as HTMLInputElement | null;
			const moLabel = document.getElementById("labelMaxOverdraw") as HTMLElement | null;
			const overdrawCheckbox = document.getElementById("cbOverdrawDebug") as HTMLInputElement | null;
			const overdrawIntensityContainer = document.getElementById(
				"overdrawIntensitySliderContainer"
			) as HTMLElement | null;
			if (moSlider && moLabel) {
				const isDisabled = moSlider.value === "4096" || (!!this.simulator && this.simulator.galaxy.maxOverdraw >= 4096);
				moLabel.innerHTML = isDisabled ? "disabled" : moSlider.value;
				if (overdrawCheckbox && overdrawIntensityContainer) {
					overdrawCheckbox.disabled = isDisabled;
					if (isDisabled) {
						overdrawCheckbox.checked = false;
						overdrawIntensityContainer.style.display = "none";
					} else {
						overdrawIntensityContainer.style.display = overdrawCheckbox.checked ? "block" : "none";
					}
				}
			}

			const timingDisplay = document.getElementById("timingDisplay");

			if (!!this.simulator && timingDisplay) {
				const vramUsage = this.simulator.memoryProfiler.getVRAMUsage(this.simulator.galaxy);
				const cpuTime = this.simulator.performanceProfiler.getCpuFrameTime();
				const gpuTimes = this.simulator.performanceProfiler.getGpuTimes();
				const hasGpuTiming = this.simulator.performanceProfiler.hasGpuTiming();

				const vramElement = timingDisplay.querySelector(".vram-time");
				const cpuElement = timingDisplay.querySelector(".cpu-time");
				const gpuElement = timingDisplay.querySelector(".gpu-time");
				const starsElement = timingDisplay.querySelector(".stars-time");
				const postElement = timingDisplay.querySelector(".post-time");

				// Display VRAM usage in MB
				if (vramElement) {
					const vramMB = (vramUsage.total / (1024 * 1024)).toFixed(0);
					vramElement.textContent = `VRAM: ${vramMB} MB`;
					(vramElement as HTMLElement).title = `Textures: ${(vramUsage.textures / (1024 * 1024)).toFixed(
						0
					)} MB, Buffers: ${(vramUsage.buffers / (1024 * 1024)).toFixed(1)} MB`;
				}

				if (cpuElement) cpuElement.textContent = `CPU: ${cpuTime.toFixed(1)} ms`;

				if (hasGpuTiming) {
					if (gpuElement) gpuElement.textContent = `GPU: ${gpuTimes.frame.toFixed(1)} ms`;
					if (starsElement) starsElement.textContent = `Stars: ${gpuTimes.stars.toFixed(1)} ms`;
					if (postElement) postElement.textContent = `Post: ${gpuTimes.post.toFixed(1)} ms`;
				} else {
					if (gpuElement) gpuElement.textContent = `GPU: N/A`;
					if (starsElement) starsElement.textContent = `Stars: N/A`;
					if (postElement) postElement.textContent = `Post: N/A`;
				}
			}
		};

		setInterval(updatePerformanceDisplay, 100);
	}

	private setupAdvancedOptionsToggle() {
		const checkbox = document.getElementById("cbAdvancedOptions") as HTMLInputElement;

		if (!checkbox) return;

		// Load saved state from localStorage
		const advancedOptionsEnabled = PerformanceProfiler.getAdvancedOptionsEnabled();
		checkbox.checked = advancedOptionsEnabled;
		this.updateAdvancedOptionsVisibility(advancedOptionsEnabled);

		checkbox.addEventListener("change", () => {
			const isChecked = checkbox.checked;
			this.updateAdvancedOptionsVisibility(isChecked);
			localStorage.setItem("showAdvancedOptions", isChecked.toString());
			this.simulator.galaxy.signalAdvancedOptionsMutation();
		});
	}

	private updateAdvancedOptionsVisibility(show: boolean) {
		const advancedOptions = document.querySelectorAll(".advanced-option");
		advancedOptions.forEach((option) => {
			if (show) {
				option.classList.remove("hidden");
			} else {
				option.classList.add("hidden");
			}
		});
	}

	private updateHTML(currentsimulator: GalaxySimulator) {
		this.simulator = currentsimulator;
		this.initilializeEditModeSlider("slDustParticleSize", "labelDustParticleSize", "dustParticleSize");
		this.initilializeEditModeSlider("slBrightStarSize", "labelBrightStarSize", "brightStarSize");
		this.initilializeEditModeSlider("slTotalStarCount", "labelTotalStarCount", "totalStarCount");
		this.initilializeEditModeSlider("slSpiralPeakPosition", "labelSpiralPeakPosition", "spiralPeakPosition");
		this.initilializeEditModeSlider("slGalaxyRadius", "labelGalaxyRadius", "galaxyRadius");
		this.initilializeEditModeSlider("slSpiralTightness", "labelSpiralTightness", "spiralTightness");
		this.initilializeEditModeSlider("slSpiralIntensity", "labelSpiralIntensity", "spiralIntensity");
		this.initilializeEditModeSlider("slSpiralArmWaves", "labelSpiralArmWaves", "spiralArmWaves");
		this.initilializeEditModeSlider("slSpiralWaveStrength", "labelSpiralWaveStrength", "spiralWaveStrength");
		this.initilializeEditModeSlider("slBaseTemperature", "labelBaseTemperature", "baseTemperature");
		this.initilializeEditModeSlider("slBrightStarCount", "labelBrightStarCount", "brightStarCount");
		this.initilializeEditModeSlider("slCentralBulgeDensity", "labelCentralBulgeDensity", "centralBulgeDensity");
		this.initilializeEditModeSlider("slDiskStarDensity", "labelDiskStarDensity", "diskStarDensity");
		this.initilializeEditModeSlider("slBackgroundStarDensity", "labelBackgroundStarDensity", "backgroundStarDensity");
		this.initilializeEditModeSlider("slDensityFalloff", "labelDensityFalloff", "densityFalloff");
		this.initializeRotationSpeedSlider("slRotationSpeed", "labelRotationSpeed");
		this.initilializeEditModeSlider("slMinimumBrightness", "labelMinimumBrightness", "minimumBrightness");
		this.initilializeEditModeSlider("slBrightnessVariation", "labelBrightnessVariation", "brightnessVariation");
		this.initilializeEditModeSlider(
			"slBrightStarMinTemperature",
			"labelBrightStarMinTemperature",
			"brightStarMinTemperature"
		);
		this.initilializeEditModeSlider(
			"slBrightStarMaxTemperature",
			"labelBrightStarMaxTemperature",
			"brightStarMaxTemperature"
		);
		this.initilializeEditModeSlider(
			"slTemperatureRadiusFactor",
			"labelTemperatureRadiusFactor",
			"temperatureRadiusFactor"
		);
		this.initilializeEditModeSlider("slMaxRotationVelocity", "labelMaxRotationVelocity", "maxRotationVelocity");
		this.initilializeEditModeSlider(
			"slSpiralEccentricityScale",
			"labelSpiralEccentricityScale",
			"spiralEccentricityScale"
		);
		this.initilializeEditModeSlider("slSpiralWidthBase", "labelSpiralWidthBase", "spiralWidthBase");
		this.initilializeEditModeSlider("slGalaxyEdgeFadeStart", "labelGalaxyEdgeFadeStart", "galaxyEdgeFadeStart");
		this.initilializeEditModeSlider("slStarEdgeSoftness", "labelStarEdgeSoftness", "starEdgeSoftness");
		this.initilializeEditModeSlider(
			"slBrightStarRadiusFactor",
			"labelBrightStarRadiusFactor",
			"brightStarRadiusFactor"
		);
		this.initilializeEditModeSlider("slBrightStarBrightness", "labelBrightStarBrightness", "brightStarBrightness");
		this.initilializeEditModeSlider(
			"slCoreBrightStarSuppressionMag",
			"labelCoreBrightStarSuppressionMag",
			"coreBrightStarSuppressionMag"
		);
		this.initilializeEditModeSlider(
			"slCoreBrightStarSuppressionExtent",
			"labelCoreBrightStarSuppressionExtent",
			"coreBrightStarSuppressionExtent"
		);
		this.initializeParticleSizeVariationSlider("slParticleSizeVariation", "labelParticleSizeVariation");
		this.initializeExposureSlider("slExposure", "labelExposure");
		this.initializeSaturationSlider("slSaturation", "labelSaturation");
		this.initializeBloomIntensitySlider("slBloomIntensity", "labelBloomIntensity");
		this.initializeBloomThresholdSlider("slBloomThreshold", "labelBloomThreshold");
		this.initializeShadowLiftSlider("slShadowLift", "labelShadowLift");
		this.initializeMinLiftThresholdSlider("slMinLiftThreshold", "labelMinLiftThreshold");
		this.initializeToneMapToeSlider("slToneMapToe", "labelToneMapToe");
		this.initializeToneMapHighlightsSlider("slToneMapHighlights", "labelToneMapHighlights");
		this.initializeToneMapMidtonesSlider("slToneMapMidtones", "labelToneMapMidtones");
		this.initializeToneMapShoulderSlider("slToneMapShoulder", "labelToneMapShoulder");
		this.initializeRadialExposureFalloffSlider("slRadialExposureFalloff", "labelRadialExposureFalloff");
		this.initializeTemporalAccumulationSlider("slTemporalAccumulation", "labelTemporalAccumulation");
		this.initializeMaxFrameRateSlider("slMaxFrameRate", "labelMaxFrameRate");
		this.initializeOverdrawControls(
			"cbOverdrawDebug",
			"slOverdrawIntensity",
			"labelOverdrawIntensity",
			"overdrawIntensitySliderContainer"
		);
		this.initializeMaxOverdrawSlider("slMaxOverdraw", "labelMaxOverdraw");
	}

	// Event handlers that need to be accessible from HTML
	onSelectPreset() {
		if (!!!this.simulator) return;
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		const presetName = select.value;
		this.simulator.selectPreset(presetName);
		this.updateHTML(this.simulator);
		this.originalPresetName = presetName;
		this.originalGalaxy = JSON.parse(JSON.stringify(this.simulator.galaxy));
		this.setModificationState(false);
	}

	checkForModifications() {
		if (!!!this.simulator || !!!this.originalGalaxy) return;
		const currentGalaxy = this.simulator.galaxy;
		const hasChanges = JSON.stringify(currentGalaxy) !== JSON.stringify(this.originalGalaxy);
		if (hasChanges !== this.isModified) {
			this.setModificationState(hasChanges);
		}
	}

	private setModificationState(modified: boolean) {
		this.isModified = modified;
		this.updateDropdownText();
		this.updateSaveButtonState();
	}

	private updateDropdownText() {
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select || !this.originalPresetName) return;
		const selectedOption = select.querySelector(`option[value="${this.originalPresetName}"]`) as HTMLOptionElement;
		if (selectedOption) {
			if (this.isModified) {
				if (!selectedOption.textContent?.includes("(modified)")) {
					selectedOption.textContent = `${this.originalPresetName} (modified)`;
				}
			} else {
				selectedOption.textContent = this.originalPresetName;
			}
		}
	}

	private updateSaveButtonState() {
		const saveButton = document.getElementById("saveSelectedBtn") as HTMLButtonElement;
		const resetButton = document.getElementById("resetSelectedBtn") as HTMLButtonElement;
		if (saveButton) {
			saveButton.disabled = !this.isModified;
			if (this.isModified) {
				saveButton.style.opacity = "1";
				saveButton.style.cursor = "pointer";
			} else {
				saveButton.style.opacity = "0.5";
				saveButton.style.cursor = "not-allowed";
			}
		}
		if (resetButton) {
			resetButton.disabled = !this.isModified;
			if (this.isModified) {
				resetButton.style.opacity = "1";
				resetButton.style.cursor = "pointer";
			} else {
				resetButton.style.opacity = "0.5";
				resetButton.style.cursor = "not-allowed";
			}
		}
	}

	onSaveSelected() {
		if (!!!this.simulator) return;
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select) return;
		const presetName = select.value;
		if (!presetName) return alert("No preset selected to save to.");
		if (!this.isModified) return alert("No changes to save.");
		if (!confirm(`Save current galaxy settings to "${presetName}"?\n\nThis will overwrite the existing preset.`))
			return;
		try {
			saveGalaxyPreset(presetName, this.simulator.galaxy);
			this.originalGalaxy = JSON.parse(JSON.stringify(this.simulator.galaxy));
			this.setModificationState(false);
		} catch (error: any) {
			alert(`Failed to save to preset: ${error.message}`);
		}
	}

	onResetSelected() {
		if (!!!this.simulator) return;
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select) return;
		const presetName = select.value;
		if (!presetName) return alert("No preset selected to reset.");
		if (!this.isModified) return alert("No changes to reset.");
		if (
			!confirm(
				`Reset current galaxy settings back to "${presetName}"` + `preset?\n\nThis will discard all unsaved changes.`
			)
		)
			return;
		try {
			if (this.originalGalaxy) {
				for (const key in this.originalGalaxy) {
					if (key in this.simulator!.galaxy && key !== "time") {
						(this.simulator!.galaxy as any)[key] = this.originalGalaxy[key];
					}
				}
				this.simulator.updateParticles();
				this.updateHTML(this.simulator);
				this.setModificationState(false);
				console.log(`Galaxy settings reset to "${presetName}" preset successfully!`);
			}
		} catch (error: any) {
			alert(`Failed to reset to preset: ${error.message}`);
		}
	}

	onCreatePreset() {
		if (!!!this.simulator) return;
		const presetName = prompt("Enter a name for the new preset:");
		if (!presetName || !presetName.trim()) return;
		const trimmedName = presetName.trim();
		const existingNames = getGalaxyPresetNames();
		if (
			existingNames.includes(trimmedName) &&
			!confirm(`Preset "${trimmedName}" already exists. Do you want to overwrite it?`)
		)
			return;
		try {
			saveGalaxyPreset(trimmedName, this.simulator.galaxy);
			this.populatePresetSelect(this.simulator);
			const select = document.getElementById("cbPreset") as HTMLSelectElement;
			select.value = trimmedName;
			this.originalPresetName = trimmedName;
			this.originalGalaxy = JSON.parse(JSON.stringify(this.simulator.galaxy));
			this.setModificationState(false);
		} catch (error: any) {
			alert(`Failed to create preset: ${error.message}`);
		}
	}

	onRenamePreset() {
		if (!!!this.simulator) return;
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select) return;
		const currentName = select.value;
		if (!currentName) return alert("No preset selected to rename.");
		const newName = prompt(`Enter a new name for "${currentName}":`, currentName);
		if (!newName || !newName.trim()) return;
		const trimmedNewName = newName.trim();
		if (trimmedNewName === currentName) return;
		const existingNames = getGalaxyPresetNames();
		if (
			existingNames.includes(trimmedNewName) &&
			!confirm(`Preset "${trimmedNewName}" already exists. Do you want to overwrite it?`)
		)
			return;
		try {
			const renamed = renamePreset(currentName, trimmedNewName);
			if (!renamed) return alert(`Failed to rename preset "${currentName}".`);
			this.populatePresetSelect(this.simulator);
			const selectElement = document.getElementById("cbPreset") as HTMLSelectElement;
			selectElement.value = trimmedNewName;
			this.originalPresetName = trimmedNewName;
			this.originalGalaxy = JSON.parse(JSON.stringify(this.simulator.galaxy));
			this.setModificationState(false);
		} catch (error: any) {
			alert(`Failed to rename preset: ${error.message}`);
		}
	}

	onDeletePreset() {
		if (!!!this.simulator) return;
		const select = document.getElementById("cbPreset") as HTMLSelectElement;
		if (!select) return;
		const presetName = select.value;
		if (!presetName) return alert("No preset selected.");
		if (!confirm(`Are you sure you want to delete the preset "${presetName}"?`)) return;
		try {
			const deleted = deleteGalaxyPreset(presetName);
			if (!deleted) return alert(`Failed to delete preset "${presetName}".`);
			this.populatePresetSelect(this.simulator);
			const remainingNames = getGalaxyPresetNames();
			if (remainingNames.length > 0) {
				select.value = remainingNames[0];
				this.onSelectPreset();
			}
		} catch (error: any) {
			alert(`Failed to delete preset: ${error.message}`);
		}
	}

	onExportPreset() {
		if (!!!this.simulator) return;
		try {
			const allPresetsJson = exportGalaxyPresets();
			const blob = new Blob([allPresetsJson], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "galaxy-presets.json";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error: any) {
			alert(`Failed to export presets: ${error.message}`);
		}
	}

	private updateTemporalAccumulationSliderUI() {
		if (!!!this.simulator) return;

		const slider = document.getElementById("slTemporalAccumulation") as HTMLInputElement;
		const label = document.getElementById("labelTemporalAccumulation") as HTMLElement;

		if (slider && label) {
			// Show normal value and enable slider
			slider.disabled = false;
			const currentAccum = this.simulator.galaxy.temporalAccumulation;
			const sliderIndex = Math.log2(currentAccum);
			slider.value = sliderIndex.toString();
			label.innerHTML = currentAccum.toString();
			slider.style.opacity = "1";
		}
	}

	// Parameter update method
	updateKey(key: string, value: number) {
		if (!!!this.simulator) return;

		const galaxy = this.simulator.galaxy;
		if (!(key in galaxy)) throw Error(`UIManager.updateKey(): key ${key} is not a property of the galaxy object`);

		// Handle temporal accumulation parameter specifically
		if (key === "temporalAccumulation") {
			// Force accumulation resources to be recreated
			(galaxy as any)[key] = value;
			galaxy.temporalFrame = 0;
			return;
		}

		// Use the appropriate setter method based on the key
		const setterName = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
		const setter = (galaxy as any)[setterName];

		if (typeof setter === "function") {
			// Use the setter method which will trigger the appropriate callbacks
			setter.call(galaxy, value);
		} else {
			// Fallback for properties without setters
			console.warn(`No setter found for property ${key}, setting directly`);
			(galaxy as any)[key] = value;
		}
	}

	// Slider initialization methods
	initilializeEditModeSlider(id: string, idLabel: string, prop: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		slider.value = (this.simulator.galaxy as any)[prop];
		const label = document.getElementById(idLabel) as HTMLElement;
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.updateKey(prop, parseFloat(slider.value));

			// Only regenerate particles for shape parameters that affect particle distribution
			if (this.shapeParameters.has(prop)) {
				this.simulator!.updateParticles();
			}

			// Check for modifications
			this.checkForModifications();
		};
	}

	initializeExposureSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.exposure.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setExposure(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeSaturationSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.saturation.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setSaturation(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeBloomIntensitySlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.bloomIntensity.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setBloomIntensity(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeBloomThresholdSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.bloomThreshold.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setBloomThreshold(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeOverdrawControls(checkboxId: string, sliderId: string, sliderLabelId: string, sliderContainerId: string) {
		if (!!!this.simulator) return;

		const checkbox = document.getElementById(checkboxId) as HTMLInputElement;
		const slider = document.getElementById(sliderId) as HTMLInputElement;
		const label = document.getElementById(sliderLabelId) as HTMLElement;
		const container = document.getElementById(sliderContainerId) as HTMLElement;

		// Set initial checkbox state
		checkbox.checked = this.simulator.galaxy.overdrawDebug;

		// Set initial slider state by converting intensity back to N
		const initialN = Math.round(1.0 / this.simulator.galaxy.overdrawIntensity);
		slider.value = initialN.toString();
		label.innerHTML = slider.value;

		// Determine if overdraw is globally disabled via maxOverdraw sentinel
		const overdrawDisabled = this.simulator.galaxy.maxOverdraw >= 4096;

		// Show/hide slider based on checkbox and disable state
		container.style.display = !overdrawDisabled && checkbox.checked ? "block" : "none";
		checkbox.disabled = overdrawDisabled;
		if (overdrawDisabled) {
			checkbox.checked = false;
		}

		// Checkbox event listener
		checkbox.onchange = () => {
			const enabled = checkbox.checked;
			this.simulator!.galaxy.setOverdrawDebug(enabled);
			container.style.display = enabled ? "block" : "none";
			this.checkForModifications();
		};

		// Slider event listener
		slider.oninput = () => {
			const value = parseInt(slider.value);
			label.innerHTML = value.toString();
			this.simulator!.galaxy.overdrawIntensity = 1.0 / value;
			this.checkForModifications();
		};
	}

	initializeShadowLiftSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.shadowLift.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setShadowLift(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeMinLiftThresholdSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;
		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.minLiftThreshold.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setMinLiftThreshold(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeParticleSizeVariationSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.particleSizeVariation.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setParticleSizeVariation(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeToneMapToeSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.toneMapToe.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setToneMapToe(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeToneMapHighlightsSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.toneMapHighlights.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setToneMapHighlights(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeToneMapMidtonesSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.toneMapMidtones.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setToneMapMidtones(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeToneMapShoulderSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.toneMapShoulder.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setToneMapShoulder(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeRadialExposureFalloffSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.radialExposureFalloff.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setRadialExposureFalloff(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeRotationSpeedSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.rotationSpeed.toString();
		label.innerHTML = slider.value;
		slider.oninput = () => {
			label.innerHTML = slider.value;
			this.simulator!.galaxy.setRotationSpeed(parseFloat(slider.value));
			this.checkForModifications();
		};
	}

	initializeTemporalAccumulationSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;

		// Update initial slider state
		this.updateTemporalAccumulationSliderUI();

		slider.oninput = () => {
			// Convert slider value (0-4) to power of 2 (1, 2, 4, 8, 16)
			const accumValue = Math.pow(2, parseInt(slider.value));
			label.innerHTML = accumValue.toString();
			this.updateKey("temporalAccumulation", accumValue);
			this.checkForModifications();
		};
	}

	initializeMaxFrameRateSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.maxFrameRate.toString();
		label.innerHTML = slider.value === "120" ? "unlocked" : slider.value + " FPS";
		slider.oninput = () => {
			label.innerHTML = slider.value === "120" ? "unlocked" : slider.value + " FPS";
			this.simulator!.galaxy.setMaxFrameRate(parseFloat(slider.value));

			// Update temporal accumulation slider state when frame rate changes
			// This handles the case where low FPS forces temporal accumulation to 1
			this.updateTemporalAccumulationSliderUI();

			this.checkForModifications();
		};
	}

	initializeMaxOverdrawSlider(id: string, labelId: string) {
		if (!!!this.simulator) return;

		const slider = document.getElementById(id) as HTMLInputElement;
		const label = document.getElementById(labelId) as HTMLElement;
		slider.value = this.simulator.galaxy.maxOverdraw.toString();
		label.innerHTML = slider.value === "4096" ? "disabled" : slider.value;

		const applyOverdrawDisabledUI = () => {
			const numericValue = parseFloat(slider.value);
			const isDisabled = slider.value === "4096";
			label.innerHTML = isDisabled ? "disabled" : slider.value;
			this.simulator!.galaxy.setMaxOverdraw(numericValue);
			// Recreate/destroy overdraw resources based on sentinel value
			this.simulator!.resources.handleMaxOverdrawChange();
			const checkbox = document.getElementById("cbOverdrawDebug") as HTMLInputElement | null;
			const intensityContainer = document.getElementById("overdrawIntensitySliderContainer") as HTMLElement | null;
			if (checkbox && intensityContainer) {
				if (isDisabled) {
					checkbox.checked = false;
					checkbox.disabled = true;
					intensityContainer.style.display = "none";
					this.simulator!.galaxy.setOverdrawDebug(false);
				} else {
					checkbox.disabled = false;
					intensityContainer.style.display = checkbox.checked ? "block" : "none";
				}
			}
			this.checkForModifications();
		};

		slider.oninput = applyOverdrawDisabledUI;
		slider.onchange = applyOverdrawDisabledUI;

		// Apply initial UI state on initialization
		applyOverdrawDisabledUI();
	}
}
