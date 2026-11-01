// Generates PWA icons with sharp from an inline SVG. Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
await mkdir(out, { recursive: true });

// Mark is drawn in a 100x100 box. scale = fraction of the 512 canvas it occupies.
function svg({ maskable = false, scale = 0.62 } = {}) {
  const size = 512;
  const m = size * scale;
  const off = (size - m) / 2;
  const bg = maskable
    ? `<rect width="512" height="512" fill="url(#bg)"/>`
    : `<rect width="512" height="512" rx="112" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F1A3A"/><stop offset="1" stop-color="#070B1A"/></linearGradient>
<linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2D8CFF"/><stop offset="1" stop-color="#9B5CFF"/></linearGradient>
</defs>
${bg}
<g transform="translate(${off} ${off}) scale(${m / 100})">
<path d="M6 46 L94 8 L72 92 L50 64 Z" fill="url(#g)"/>
<path d="M50 64 L94 8 L38 54 Z" fill="#0B1226" fill-opacity="0.35"/>
<path d="M50 64 L50 84 L62 72 Z" fill="url(#g)" fill-opacity="0.75"/>
<circle cx="79" cy="26" r="5" fill="#0B1226"/>
</g>
</svg>`;
}

const targets = [
  ["icon-192.png", 192, svg()],
  ["icon-512.png", 512, svg()],
  ["maskable-192.png", 192, svg({ maskable: true, scale: 0.56 })],
  ["maskable-512.png", 512, svg({ maskable: true, scale: 0.56 })],
  ["apple-touch-icon.png", 180, svg({ maskable: true, scale: 0.66 })],
  ["favicon-32.png", 32, svg({ scale: 0.78 })],
];
for (const [name, size, s] of targets) {
  await sharp(Buffer.from(s)).resize(size, size).png().toFile(path.join(out, name));
  console.log("wrote", name, size);
}
await writeFile(path.join(out, "icon.svg"), svg());
console.log("wrote icon.svg");
