import { GalaxySimulator } from "../GalaxySimulator";
import { Galaxy } from "../entities/Galaxy";
import { mat4, vec3, Vec3 } from "../utils/MatrixMath";

export class CameraManager {
	private readonly galaxy: () => Galaxy;

	readonly matProjection = mat4.create();
	readonly matView = mat4.create();
	readonly camPos = vec3.create();
	readonly camLookAt = vec3.create();
	readonly camOrient = vec3.create();

	constructor(simulator: GalaxySimulator) {
		this.galaxy = () => {
			if (!!!simulator.galaxy) throw new Error("Galaxy must be initialized before CameraManager");
			return simulator.galaxy;
		};
	}

	setCameraOrientation(orient: Vec3) {
		vec3.set(this.camOrient, orient[0], orient[1], orient[2]);
		this.adjustCamera();
	}

	adjustCamera() {
		const l = (3 * this.galaxy().galaxyRadius * 0.9) / 2.0;
		const aspect = 1.0; // The UI always makes the canvas square
		mat4.ortho(this.matProjection, -l * aspect, l * aspect, -l, l, -l, l);
		vec3.set(this.camPos, 0, 0, 1); // Looking down Z
		vec3.set(this.camLookAt, 0, 0, 0);
		mat4.lookAt(this.matView, this.camPos, this.camLookAt, this.camOrient);
	}
}
