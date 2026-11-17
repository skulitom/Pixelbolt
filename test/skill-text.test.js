import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The skill, the craft notes and the READMEs are read by agents and people who can't ask which line is right, so the
// places that say the same thing must agree (P-165).
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test("the skill's craft sections are the craft notes' own headings", () => {
  const listed = /`help craft "<section>"`: one short checklist\. Sections: ([^\n]*)/.exec(read('skills/pixel-art/SKILL.md'));
  assert.ok(listed, 'SKILL.md lists the craft sections');
  const names = [...listed[1].replace(/\([^)]*\)/g, '').matchAll(/`([^`]+)`/g)].map(match => match[1]);
  const headings = [...read('docs/agent-craft.md').matchAll(/^## (.+)$/gm)].map(match => match[1].trim());
  assert.deepEqual(names, headings);
});

test('what Pixelbolt is not for leaves room for redrawing a logo as pixel art', () => {
  assert.match(read('skills/pixel-art/SKILL.md'), /^description: [^\n]*can redraw a logo or icon as pixel art/m);
  const texts = ['skills/pixel-art/SKILL.md', 'docs/agent-craft.md', 'docs/agent-quick-start.md', 'docs/agent-guide.md', 'README.md', 'llms.txt']
    .concat(readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js')).map(name => `src/${name}`));
  for (const name of texts) assert.doesNotMatch(read(name), /not for (?:vector or )?SVG logos/i, name);
});

const WORDS = Object.fromEntries(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'].map((word, i) => [word, i])
  .concat(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].map((word, i) => [word, 20 + i * 10])));
const count = text => /^\d+$/.test(text) ? Number(text) : text.toLowerCase().split('-').reduce((sum, word) => {
  assert.ok(word in WORDS, `"${text}" is a number`);
  return sum + WORDS[word];
}, 0);

// Each kind's presets are every examples/*.<kind>.json file (src/presets.js), so a count of them is that many files.
const presetsOf = kind => readdirSync(new URL('../examples/', import.meta.url))
  .filter(name => name.endsWith(`.${kind}.json`)).map(name => name.slice(0, -`.${kind}.json`.length));

test('every count of a kind of preset is the number of its files in examples/', () => {
  const claims = [
    ['README.md', /The ([a-z-]+) presets are in \[examples\/\]\(examples\/\) \(`\*\.([a-z]+)\.json`\)/g],
    ['README.md', /\b(\d+) (fluid) presets\b/g],
    ['README.md', /\b([a-z-]+) rigid-body scenes\b/g, 'bodies'],
    ['README.md', /\b([a-z-]+) crystal growths\b/g, 'crystal'],
    ['docs/art-workflow.md', /\[examples\/\]\(\.\.\/examples\/\) holds ([a-z-]+) presets/g, 'fluid'],
    ['aseprite/README.md', /\b(\d+) (fluid) presets\b/g],
  ];
  const seen = new Set();
  for (const [name, pattern, fixed] of claims) for (const match of read(name).matchAll(pattern)) {
    const kind = fixed ?? match[2];
    seen.add(kind);
    assert.equal(count(match[1]), presetsOf(kind).length, `${name}: "${match[0]}"`);
  }
  for (const kind of ['fluid', 'bodies', 'crystal', 'powder']) assert.ok(seen.has(kind), `the README counts the ${kind} presets`);
});

test("llms.txt's rigid-body line names every bodies preset", () => {
  const line = read('llms.txt').split('\n').find(text => text.startsWith('Rigid bodies:'));
  const named = /; presets ([^.]+)\./.exec(line)[1].split(/, | and /);
  assert.deepEqual([...named].sort(), presetsOf('bodies').sort());
});
