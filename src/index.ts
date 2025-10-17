import { GalaxySimulator } from "./GalaxySimulator";

async function main() {
	try {
		await GalaxySimulator.start("cvGalaxy");
	} catch (err: any) {
		displayError(err);
	}
}

function displayError(err: any) {
	const errorElement = document.createElement("pre");
	errorElement.style.color = "red";
	errorElement.style.backgroundColor = "#330000";
	errorElement.style.border = "2px solid red";
	errorElement.style.padding = "20px";
	errorElement.style.margin = "50px 20px 20px 20px"; // Top margin to clear GitHub badge
	errorElement.style.fontSize = "14pt";
	errorElement.style.fontFamily = "monospace";
	errorElement.style.zIndex = "999";
	errorElement.style.position = "relative";
	errorElement.textContent = err.message ? `Error: ${err.message}` : "An unknown error occurred";
	const container = document.body;
	if (!!container) {
		container.insertBefore(errorElement, container.firstChild);
	} else {
		alert(err.message ? `Error: ${err.message}` : "An unknown error occurred");
	}
	console.error(err);
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", main) : main();
