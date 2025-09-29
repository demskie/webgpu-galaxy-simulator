export type Mat4 = Float32Array;
export type Vec3 = Float32Array;

export class mat4 {
	static create(): Mat4 {
		const out = new Float32Array(16);
		out[0] = 1;
		out[5] = 1;
		out[10] = 1;
		out[15] = 1;
		return out;
	}

	static copy(out: Mat4, a: Mat4): Mat4 {
		out[0] = a[0];
		out[1] = a[1];
		out[2] = a[2];
		out[3] = a[3];
		out[4] = a[4];
		out[5] = a[5];
		out[6] = a[6];
		out[7] = a[7];
		out[8] = a[8];
		out[9] = a[9];
		out[10] = a[10];
		out[11] = a[11];
		out[12] = a[12];
		out[13] = a[13];
		out[14] = a[14];
		out[15] = a[15];
		return out;
	}

	static ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
		const lr = 1 / (left - right);
		const bt = 1 / (bottom - top);
		const nf = 1 / (near - far);

		out[0] = -2 * lr;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		out[4] = 0;
		out[5] = -2 * bt;
		out[6] = 0;
		out[7] = 0;
		out[8] = 0;
		out[9] = 0;
		out[10] = 2 * nf;
		out[11] = 0;
		out[12] = (left + right) * lr;
		out[13] = (top + bottom) * bt;
		out[14] = (far + near) * nf;
		out[15] = 1;
		return out;
	}

	static lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
		const eyex = eye[0];
		const eyey = eye[1];
		const eyez = eye[2];
		const upx = up[0];
		const upy = up[1];
		const upz = up[2];
		const centerx = center[0];
		const centery = center[1];
		const centerz = center[2];

		// if eye and center are the same, return identity matrix
		if (
			Math.abs(eyex - centerx) < 0.000001 &&
			Math.abs(eyey - centery) < 0.000001 &&
			Math.abs(eyez - centerz) < 0.000001
		) {
			out[0] = 1;
			out[1] = 0;
			out[2] = 0;
			out[3] = 0;
			out[4] = 0;
			out[5] = 1;
			out[6] = 0;
			out[7] = 0;
			out[8] = 0;
			out[9] = 0;
			out[10] = 1;
			out[11] = 0;
			out[12] = 0;
			out[13] = 0;
			out[14] = 0;
			out[15] = 1;
			return out;
		}

		let z0 = eyex - centerx;
		let z1 = eyey - centery;
		let z2 = eyez - centerz;

		let len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
		z0 *= len;
		z1 *= len;
		z2 *= len;

		let x0 = upy * z2 - upz * z1;
		let x1 = upz * z0 - upx * z2;
		let x2 = upx * z1 - upy * z0;
		len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
		if (!len) {
			x0 = 0;
			x1 = 0;
			x2 = 0;
		} else {
			len = 1 / len;
			x0 *= len;
			x1 *= len;
			x2 *= len;
		}

		let y0 = z1 * x2 - z2 * x1;
		let y1 = z2 * x0 - z0 * x2;
		let y2 = z0 * x1 - z1 * x0;

		len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
		if (!len) {
			y0 = 0;
			y1 = 0;
			y2 = 0;
		} else {
			len = 1 / len;
			y0 *= len;
			y1 *= len;
			y2 *= len;
		}

		out[0] = x0;
		out[1] = y0;
		out[2] = z0;
		out[3] = 0;
		out[4] = x1;
		out[5] = y1;
		out[6] = z1;
		out[7] = 0;
		out[8] = x2;
		out[9] = y2;
		out[10] = z2;
		out[11] = 0;
		out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
		out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
		out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
		out[15] = 1;

		return out;
	}
}

export class vec3 {
	static create(): Vec3 {
		return new Float32Array(3);
	}

	static fromValues(x: number, y: number, z: number): Vec3 {
		const out = new Float32Array(3);
		out[0] = x;
		out[1] = y;
		out[2] = z;
		return out;
	}

	static set(out: Vec3, x: number, y: number, z: number): Vec3 {
		out[0] = x;
		out[1] = y;
		out[2] = z;
		return out;
	}
}
