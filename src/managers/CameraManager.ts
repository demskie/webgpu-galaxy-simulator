import { GalaxySimulator } from "../GalaxySimulator";
import { Galaxy } from "../entities/Galaxy";
import { mat4, vec3, Vec3 } from "../utils/MatrixMath";

export interface CameraCallbacks {
	onCameraChanged?: () => void;
}

export class CameraManager {
	private readonly galaxy: () => Galaxy;
	private callbacks: CameraCallbacks = {};

	readonly matProjection = mat4.create();
	readonly matView = mat4.create();
	readonly camPos = vec3.create();
	readonly camLookAt = vec3.create();
	readonly camOrient = vec3.create();

	// Camera control state
	panX: number = 0.0;
	panY: number = 0.0;
	dolly: number = 1.0; // 1.0 = default distance, <1 = closer, >1 = further back

	constructor(simulator: GalaxySimulator) {
		this.galaxy = () => {
			if (!!!simulator.galaxy) throw new Error("Galaxy must be initialized before CameraManager");
			return simulator.galaxy;
		};
	}

	setCallbacks(callbacks: CameraCallbacks) {
		this.callbacks = callbacks;
	}

	setCameraOrientation(orient: Vec3) {
		vec3.set(this.camOrient, orient[0], orient[1], orient[2]);
		this.adjustCamera();
	}

	setPanX(val: number) {
		this.panX = val;
		this.adjustCamera();
		this.callbacks.onCameraChanged?.();
	}

	setPanY(val: number) {
		this.panY = val;
		this.adjustCamera();
		this.callbacks.onCameraChanged?.();
	}

	setDolly(val: number) {
		this.dolly = Math.max(0.1, Math.min(10.0, val)); // Clamp between 0.1x and 10x distance
		this.adjustCamera();
		this.callbacks.onCameraChanged?.();
	}

	resetCamera() {
		this.panX = 0.0;
		this.panY = 0.0;
		this.dolly = 1.0;
		this.adjustCamera();
		this.callbacks.onCameraChanged?.();
	}

	adjustCamera() {
		const galaxyRadius = this.galaxy().galaxyRadius;
		const aspect = 1.0; // The UI always makes the canvas square
		const fovY = Math.PI / 4; // 45 degrees field of view
		const near = galaxyRadius * 0.01;
		const far = galaxyRadius * 20;

		// Base camera distance to see the whole galaxy
		const baseCameraDistance = galaxyRadius * 2.5;
		const cameraDistance = baseCameraDistance * this.dolly;

		// Pan is scaled relative to galaxy size
		const panScale = galaxyRadius * 2.0;

		mat4.perspective(this.matProjection, fovY, aspect, near, far);
		vec3.set(
			this.camPos,
			this.panX * panScale,
			this.panY * panScale,
			cameraDistance
		);
		vec3.set(this.camLookAt, this.panX * panScale, this.panY * panScale, 0);
		mat4.lookAt(this.matView, this.camPos, this.camLookAt, this.camOrient);
	}
}
