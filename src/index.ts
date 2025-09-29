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
