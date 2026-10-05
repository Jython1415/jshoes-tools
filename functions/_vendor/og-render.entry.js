// Entry for the vendored renderer: satori (layout to SVG) + resvg (SVG to PNG).
// The two .wasm files are passed in as compiled modules because Workers
// cannot compile WebAssembly from bytes at runtime.
import satori, { init as initSatori } from "satori/wasm";
import initYoga from "yoga-wasm-web";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

let ready = null;
export function setup(yogaModule, resvgModule) {
  if (!ready) ready = (async () => {
    initSatori(await initYoga(yogaModule));
    await initWasm(resvgModule);
  })();
  return ready;
}
export async function renderPng(element, { width, height, fonts, loadAdditionalAsset }) {
  const svg = await satori(element, { width, height, fonts, loadAdditionalAsset });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return png;
}
