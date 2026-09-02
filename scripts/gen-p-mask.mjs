// Regenerates src/lib/pMask.ts from src/app/assets/p.svg
// Run:  node scripts/gen-p-mask.mjs
//
// p.svg is a single path: an outer rectangle followed by the P letterform,
// wound so the letter reads as a hole (nonzero winding). We split the two so
// the overlay can paint a full-canvas plane and punch just the letter.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const svg = readFileSync("src/app/assets/p.svg", "utf8");
const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
const d = svg.match(/ d="([^"]+)"/)?.[1];
if (!vb || !d) throw new Error("Could not parse viewBox / path from p.svg");

const zi = d.indexOf("Z");
if (zi === -1) throw new Error("Expected a closed outer subpath in p.svg");
const plane = d.slice(0, zi + 1).trim();
const letter = d.slice(zi + 1).trim();
if (!letter.startsWith("M")) throw new Error("Could not isolate the letterform subpath");

// Rough bounding box of the letterform from its coordinate pairs.
const nums = letter.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (let i = 0; i + 1 < nums.length; i += 2) {
  minX = Math.min(minX, nums[i]);
  maxX = Math.max(maxX, nums[i]);
  minY = Math.min(minY, nums[i + 1]);
  maxY = Math.max(maxY, nums[i + 1]);
}
const round = (n) => Math.round(n * 100) / 100;

const out = `// AUTO-GENERATED from p.svg — a white plane with a P-shaped hole.
// Regenerate with: node scripts/gen-p-mask.mjs

export interface HoleMask {
  /** viewBox size of the source artwork. */
  width: number;
  height: number;
  /** Outer plane subpath (kept for reference; the overlay fills the canvas directly). */
  plane: string;
  /** The letterform subpath, punched out of the plane (nonzero winding). */
  letter: string;
  /** Bounding box of \`letter\`, used to fit it to the viewport. */
  letterBox: { x: number; y: number; w: number; h: number };
}

export const P_MASK: HoleMask = {
  width: ${vb[2]},
  height: ${vb[3]},
  plane: ${JSON.stringify(plane)},
  letter:
    ${JSON.stringify(letter)},
  letterBox: { x: ${round(minX)}, y: ${round(minY)}, w: ${round(maxX - minX)}, h: ${round(maxY - minY)} },
};
`;

mkdirSync("src/lib", { recursive: true });
writeFileSync("src/lib/pMask.ts", out);
console.log("wrote src/lib/pMask.ts");
console.log("letterBox:", { x: round(minX), y: round(minY), w: round(maxX - minX), h: round(maxY - minY) });
