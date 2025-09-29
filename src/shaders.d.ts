declare module "*.glsl" {
	const value: string;
	export default value;
}

declare module "*.wgsl" {
	const content: string;
	export default content;
}
