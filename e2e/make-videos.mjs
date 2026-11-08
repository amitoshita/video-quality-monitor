// Writes the synthetic camera feeds Chrome plays as its fake webcam (raw Y4M, 640×480, 30 fps):
// solid black, solid white, and random noise (strong motion). Generated, not committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "videos");
const W = 640;
const H = 480;
const FRAMES = 30;
mkdirSync(dir, { recursive: true });

function y4m(name, lumaForFrame) {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const chroma = Buffer.alloc((W * H) / 2, 128); // neutral colour
  const parts = [header];
  for (let i = 0; i < FRAMES; i++) parts.push(Buffer.from("FRAME\n"), lumaForFrame(i), chroma);
  writeFileSync(join(dir, name), Buffer.concat(parts));
}

// Y4M luma uses the 16–235 range: 16 is black, 235 is white.
y4m("black.y4m", () => Buffer.alloc(W * H, 16));
y4m("white.y4m", () => Buffer.alloc(W * H, 235));
let seed = 1;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
const noise = Array.from({ length: 4 }, () => Buffer.from(Array.from({ length: W * H }, () => Math.floor(random() * 256))));
y4m("noise.y4m", (i) => noise[i % 4]);
console.log(`fake camera videos written to ${dir}`);
