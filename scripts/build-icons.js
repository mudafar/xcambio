// Render the PNG app icons from the SVG sources in icons/.
// Usage: node scripts/build-icons.js   (needs Playwright with Chromium installed)
// The SVGs contain no text (letters are outlined paths, see scripts/text-to-path.py),
// so the PNGs look the same wherever they are rendered.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = fileURLToPath(new URL("../icons/", import.meta.url));

// [source, size, output, keepTransparency]
const jobs = [
  ["icon.svg", 192, "icon-192.png", true],
  ["icon.svg", 512, "icon-512.png", true],
  ["icon-maskable.svg", 512, "icon-maskable-512.png", false],
  ["apple-touch-icon.svg", 180, "apple-touch-icon.png", false], // iOS: no transparency, iOS rounds the corners
  ["favicon.svg", 48, "favicon-48.png", true]
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [source, size, output, transparent] of jobs) {
  const svg = readFileSync(dir + source, "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  await page.screenshot({ path: dir + output, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`icons/${output}`);
}
await browser.close();
