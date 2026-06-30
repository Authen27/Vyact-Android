// Rasterizes the Play Store marketing SVGs into the exact PNG dimensions Google
// Play requires. Run in CI (sharp installed there).  Output -> play-assets/.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('play-assets', { recursive: true });

const jobs = [
  ['assets-src/play-icon.svg',            'play-assets/icon-512.png',        512, 512],
  ['assets-src/play-feature-graphic.svg', 'play-assets/feature-graphic.png', 1024, 500],
];

for (const [src, out, w, h] of jobs) {
  await sharp(src, { density: 384 }).resize(w, h).png().toFile(out);
  console.log(`rasterized ${src} -> ${out} (${w}x${h})`);
}
