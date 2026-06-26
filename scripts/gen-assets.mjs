// Rasterizes the pip SVG sources (assets-src/) into the PNGs that
// @capacitor/assets consumes (assets/). Run in CI before `@capacitor/assets
// generate`. Keeps the committed source as crisp vector art.

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('assets', { recursive: true });

const jobs = [
  ['assets-src/icon-foreground.svg', 'assets/icon-foreground.png', 1024],
  ['assets-src/icon-background.svg', 'assets/icon-background.png', 1024],
  ['assets-src/splash.svg',          'assets/splash.png',          2732],
  ['assets-src/splash-dark.svg',     'assets/splash-dark.png',     2732],
];

for (const [src, out, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
  console.log(`rasterized ${src} -> ${out} (${size}px)`);
}
