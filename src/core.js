// Browser-compatible, deterministic recipe rasterizer, atlas packer, inspector and revision comparator.
// No I/O and no dependencies. Re-exports the public surface of src/recipe.js and src/inspect.js so every
// caller keeps one entry point while validation/rendering and inspection/comparison live in separate modules.
export {
  PixelError, MAX_REQUEST_BYTES, fail, joinErrors, errorReply, isObject, meant, portableName,
  layerOffset, paletteOverride, parseColor, rampShifter, blend, sameWidth, readRows,
  CANVAS_SIDE, FRAME_PIXELS, STILL_SIDE, FRAME_AREA, POSE_SIDE,
  frameFits, FRAME_LIMIT, frameAreaProblem, frameTotalProblem, sheetColumns, largestScale,
  inlineSharedPalette, renderProject, describeStampRecipe,
  isStills, namesAnimations, stillsHaveNoAnimation, stillTileSet, exportsStill, exportAtlas,
  columnsOfCall, scalePixels, readGuides, drawGuides, buildAtlas, frameTag
} from './recipe.js';
export {
  tileRepeat, tileReport, wildcard, partColors, pictureSheet, paletteUse,
  stackViews, inspectProject,
  animationPosition, animationFps, animationNeighbors, reviewPixels, onionPixels,
  analyzeProject, DIAGNOSTIC_ROWS, briefDiagnostics, briefCells, briefComparison, compareProjects
} from './inspect.js';
