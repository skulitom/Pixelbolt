import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../playground/', import.meta.url));
const argument = process.argv[2];
if (!argument || process.argv.length !== 3) {
  console.error('Usage: node scripts/deploy-playground.mjs <out>');
  process.exitCode = 1;
} else {
  const out = path.resolve(argument), changed = [];
  const read = async file => {
    try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const put = async (file, content) => {
    const bytes = Buffer.from(content), previous = await read(file);
    if (previous?.equals(bytes)) return;
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
    changed.push(path.relative(out, file));
  };
  const copy = async (folder, relative = '') => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name === 'DEPLOY.md') continue;
      const next = path.join(relative, entry.name), file = path.join(folder, entry.name);
      if (entry.isDirectory()) await copy(file, next);
      else if (entry.isFile()) await put(path.join(out, 'playground', next), await readFile(file));
    }
  };
  try {
    // Never recurse through a destination inside the source tree.
    const relative = path.relative(source, out);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Choose an output folder outside playground/.');
    await copy(source);
    const sitemapPath = path.join(out, 'sitemap.xml'), sitemap = (await read(sitemapPath))?.toString('utf8');
    if (sitemap !== undefined) {
      let next = sitemap;
      // The playground and its live fluid toy, each listed once.
      for (const url of ['https://skulitom.github.io/Pixelbolt/playground/', 'https://skulitom.github.io/Pixelbolt/playground/fluids/']) {
        if (next.includes(`<loc>${url}</loc>`)) continue;
        if (!next.includes('</urlset>')) throw new Error('sitemap.xml has no closing urlset tag.');
        const newline = next.includes('\r\n') ? '\r\n' : '\n';
        next = next.replace('</urlset>', `  <url><loc>${url}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>${newline}</urlset>`);
      }
      await put(sitemapPath, next);
    }
    const indexPath = path.join(out, 'index.html'), index = (await read(indexPath))?.toString('utf8');
    if (index !== undefined) {
      let next = index;
      if (!/href\s*=\s*["'][^"']*\bplayground\/["'#?]/i.test(next)) {
        const paragraphs = [...next.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)];
        const sourceParagraph = paragraphs.find(match => /href\s*=\s*["']https:\/\/github\.com\/skulitom\/Pixelbolt(?:[\/"'#?])/i.test(match[0]));
        if (!sourceParagraph) throw new Error('index.html has no paragraph containing the GitHub source link.');
        const at = sourceParagraph.index + sourceParagraph[0].length, newline = next.includes('\r\n') ? '\r\n' : '\n';
        const paragraph = '<p>Try Pixelbolt in your browser: <a href="playground/">the playground</a> renders, exports and shares recipes with nothing installed.</p>';
        next = next.slice(0, at) + newline + paragraph + next.slice(at);
      }
      // The live fluid toy goes right after the paragraph that links the playground.
      if (!/href\s*=\s*["'][^"']*\bplayground\/fluids\/["'#?]/i.test(next)) {
        const playgroundParagraph = [...next.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].find(match => /href\s*=\s*["'][^"']*\bplayground\/["'#?]/i.test(match[0]));
        if (!playgroundParagraph) throw new Error('index.html has no paragraph linking the playground.');
        const at = playgroundParagraph.index + playgroundParagraph[0].length, newline = next.includes('\r\n') ? '\r\n' : '\n';
        const paragraph = '<p>Poke live pixel fluids: <a href="playground/fluids/">blow on a campfire, pour honey and slime</a>, then save a GIF or share a link that replays what you did.</p>';
        next = next.slice(0, at) + newline + paragraph + next.slice(at);
      }
      // The site's footer promises pages without scripts; the playground is the one page that has them.
      next = next.replace('Plain static pages: no scripts, trackers or cookies.', 'Plain static pages with no trackers or cookies; only the playground runs scripts, in your browser.');
      await put(indexPath, next);
    }
    console.log(changed.length ? `Changed:\n${changed.map(file => `  ${file}`).join('\n')}` : 'No files changed.');
    const quoted = `'${out.replace(/'/g, "''")}'`;
    console.log(`Next, review the files and run:\ngit -C ${quoted} add -A playground sitemap.xml index.html\ngit -C ${quoted} commit -m "Add the browser playground"\ngit -C ${quoted} push origin gh-pages`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
