// Copies MediaPipe's wasm runtime from node_modules into public/, so it is served from our own
// origin (no runtime dependency on a third-party CDN) and always matches the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const target = join(root, "public/mediapipe/wasm");

mkdirSync(target, { recursive: true });
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  copyFileSync(join(source, file), join(target, file));
}
console.log(`MediaPipe wasm copied to ${target}`);
