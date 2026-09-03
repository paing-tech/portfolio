// Composites the cropped zen.png onto a transparent canvas the same size as
// hero.webp, so the character aligns pixel-for-pixel when both are rendered
// with `object-cover object-center`. Output: src/app/assets/zen-full.webp
//
// Run:  node scripts/gen-zen-full.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/app/assets");

// Frame size (matches hero.webp).
const FRAME_W = 3840;
const FRAME_H = 2675;

// Where the character sits in the frame (tuned against hero-bg.webp).
const CHAR_CENTER_X = 1903; // horizontal centre of the character
const CHAR_TOP_Y = 812; // top of the zen.png bitmap once placed

const zen = sharp(path.join(dir, "zen.png"));
const { width } = await zen.metadata();

await sharp({
  create: {
    width: FRAME_W,
    height: FRAME_H,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: await zen.toBuffer(),
      left: Math.round(CHAR_CENTER_X - width / 2),
      top: CHAR_TOP_Y,
    },
  ])
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(path.join(dir, "zen-full.webp"));

console.log("wrote src/app/assets/zen-full.webp");
