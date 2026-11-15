// Checks where the liquid is in Pixelbolt's dam-break preset, from the recipe and metadata that
// `pixelbolt compile` wrote. Reads only the files named on the command line.
//
// usage: node pixelbolt_dambreak.mjs <dam-break.recipe.json> <dam-break.meta.json> <result.json>
//
// In each frame the liquid is a `grid` op (one character per pixel, "." = no liquid) and the obstacles
// are `stamp` ops of the recipe's symbols. A solid cell is any non-"." character of a stamped symbol.
import fs from "node:fs";

const [recipePath, metaPath, outPath] = process.argv.slice(2);
if (!recipePath || !metaPath || !outPath) {
  console.error("usage: node pixelbolt_dambreak.mjs <recipe.json> <meta.json> <result.json>");
  process.exit(2);
}
const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")).effects["dam-break"];
const W = recipe.width, H = recipe.height;

function frameCells(frame) {
  const liquid = new Set(), solid = new Map(); // key "x,y" -> symbol name
  for (const op of frame.ops) {
    if (op.op === "grid") {
      op.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") liquid.add(`${op.x + i},${op.y + j}`); }));
    } else if (op.op === "stamp") {
      recipe.symbols[op.symbol].forEach((row, j) => [...row].forEach((ch, i) => {
        const x = op.x + i, y = op.y + j;
        if (ch !== "." && x >= 0 && y >= 0 && x < W && y < H) solid.set(`${x},${y}`, op.symbol);
      }));
    } else if (op.op === "copy") {
      // part of a symbol: rows sy..sy+h-1, columns sx..sx+w-1, drawn at (x, y)
      const rows = recipe.symbols[op.symbol];
      for (let j = 0; j < op.h; j++)
        for (let i = 0; i < op.w; i++) {
          const ch = rows[op.sy + j][op.sx + i], x = op.x + i, y = op.y + j;
          if (ch !== "." && x >= 0 && y >= 0 && x < W && y < H) solid.set(`${x},${y}`, op.symbol);
        }
    } else throw new Error("unexpected op " + op.op);
  }
  return { liquid, solid };
}

const perFrame = recipe.frames.map((f, n) => {
  const { liquid, solid } = frameCells(f);
  let inside = 0;
  for (const k of liquid) if (solid.has(k)) inside++;
  return { frame: n, liquid: liquid.size, liquidInsideSolid: inside, stamps: [...new Set(solid.values())] };
});

const last = frameCells(recipe.frames[recipe.frames.length - 1]);
const has = (x, y) => last.liquid.has(`${x},${y}`);
const rockCells = [...last.solid.entries()].filter(([, s]) => s === "rock").map(([k]) => k.split(",").map(Number));
const basinTop = Math.min(...[...last.solid.entries()].filter(([, s]) => s === "basin").map(([k]) => Number(k.split(",")[1])));
const touch = { left: 0, right: 0, above: 0 };
for (const [x, y] of rockCells) {
  if (!last.solid.has(`${x - 1},${y}`) && has(x - 1, y)) touch.left++;
  if (!last.solid.has(`${x + 1},${y}`) && has(x + 1, y)) touch.right++;
  if (!last.solid.has(`${x},${y - 1}`) && has(x, y - 1)) touch.above++;
}
const rockXs = rockCells.map(([x]) => x);
const rockX0 = Math.min(...rockXs), rockX1 = Math.max(...rockXs);
let onFloor = 0, floorFree = 0;
for (let x = 0; x < W; x++) {
  if (last.solid.has(`${x},${basinTop - 1}`)) continue;
  floorFree++;
  if (has(x, basinTop - 1)) onFloor++;
}
const columnsWithLiquid = new Set([...last.liquid].map((k) => Number(k.split(",")[0])));
const result = {
  recipe: { width: W, height: H, frames: recipe.frames.length },
  metadata: { particles: meta.particles, steps: meta.steps, liquidPixelsFirst: meta.pixels[0], liquidPixelsLast: meta.pixels.at(-1),
    liquidPixelsMin: Math.min(...meta.pixels), liquidPixelsMax: Math.max(...meta.pixels),
    boxFirst: meta.figures.box[0], boxLast: meta.figures.box.at(-1) },
  allFrames: {
    framesChecked: perFrame.length,
    liquidCellsInsideSolidMax: Math.max(...perFrame.map((p) => p.liquidInsideSolid)),
    liquidCellsMin: Math.min(...perFrame.map((p) => p.liquid)), liquidCellsMax: Math.max(...perFrame.map((p) => p.liquid)),
    stampsSeen: [...new Set(perFrame.flatMap((p) => p.stamps))],
  },
  lastFrame: {
    liquidCells: last.liquid.size,
    liquidCellsInsideSolid: perFrame.at(-1).liquidInsideSolid,
    rock: { solidCells: rockCells.length, x0: rockX0, x1: rockX1, liquidTouching: touch,
      liquidColumnsLeftOfRock: [...columnsWithLiquid].filter((x) => x < rockX0).length,
      liquidColumnsRightOfRock: [...columnsWithLiquid].filter((x) => x > rockX1).length },
    basinTopRow: basinTop,
    rowAboveBasin: { freeCells: floorFree, liquidCells: onFloor },
    columnsWithLiquid: columnsWithLiquid.size,
  },
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result));
