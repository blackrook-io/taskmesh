import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const dest = join(root, "public/excalidraw-assets/fonts");

if (!existsSync(src)) {
  console.warn("Excalidraw fonts not found; skip copy:", src);
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("Copied Excalidraw fonts → public/excalidraw-assets/fonts");
