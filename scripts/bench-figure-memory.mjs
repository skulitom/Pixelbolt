// Run in a fresh process with --max-old-space-size=48 --max-semi-space-size=4.
// The configured total V8 heap limit is an upper bound on peak JS heap, including compilation temporaries.
import { getHeapStatistics } from 'node:v8';
import { bossRig } from './figure-rigs.mjs';
import { compilePoses } from '../src/authoring.js';

const limit = getHeapStatistics().heap_size_limit;
if (limit > 64 * 1048576) throw new Error('Run with --max-old-space-size=48 --max-semi-space-size=4 to bound the whole heap below 64 MiB.');
const before = process.memoryUsage().heapUsed, source = bossRig(), compiled = compilePoses(source);
if (compiled.recipe.frames.length !== 96 || compiled.metadata.warnings) throw new Error('R3 did not compile completely and cleanly.');
console.log(JSON.stringify({ peakHeapUpperBoundBytes: limit, beforeBytes: before, afterBytes: process.memoryUsage().heapUsed, frames: compiled.recipe.frames.length, note: 'Whole-process V8 heap ceiling, including fixture construction; typed-array backing stores are external memory, not JS heap.' }));
