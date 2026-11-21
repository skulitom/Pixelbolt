import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { goldens } from '../scripts/goldens.mjs';
import { cliReply } from './fixtures/cli-reply.js';
import { renderProject } from '../src/core.js';
import { readFile } from 'node:fs/promises';
import { compileStack, prepareStack, stackSide } from '../src/stack.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { createSceneBundle } from '../src/scene-export.js';
import { stackPaths } from '../src/stack-paths.js';
import { cosDeg, sinDeg } from '../src/craft.js';

const golden = goldens(new URL('./goldens/stack.json', import.meta.url));
const block = {
  format: 'pixelforge-stack', version: 1, name: 'block', palette: { k: '#111', s: '#fff' },
  slices: [['kkk', 'kkk', 'kkk'], ['kkk', 'kkk', 'kkk']], headings: [0, 90, 180, 270]
};
test('a tip frame carries a rigid crystal and its seam while a sibling stays put', () => {
  const path = (at,end) => ({colors:'k',nodes:[
    {name:'base',at,radius:1},{name:'tip',at:end,radius:.5}
  ]});
  const source = {...block, paths:{
    nail:{...path([0,0,0],[0,0,2]),attach:'index',colors:'g'},
    index:path([0,0,0],[0,0,3]), other:path([3,0,0],[3,0,3])
  }, palette:{...block.palette,g:'#8ef8'}, poses:{open:{},hook:{index:{base:90,tip:90}}},
    poseKeys:[{heading:0,pose:'open'},{heading:180,pose:'hook'}]};
  const rig=stackPaths(source,new Map(),0);
  const open=rig.mesh(rig.anglesAt(0)), hook=rig.mesh(rig.anglesAt(180));
  for (const angle of [0,30,90,150,180]) {
    const {posed,facets}=rig.mesh(rig.anglesAt(angle)), tip=posed.get('index').centres[1];
    const nail=posed.get('nail');
    assert.deepEqual(nail.centres[0],tip);
    assert.deepEqual(posed.get('other'),open.posed.get('other'));
    const expected=open.facets.filter(f=>f.ink===103), moved=facets.filter(f=>f.ink===103);
    for (let i=0;i<expected.length;i++) for (let j=0;j<expected[i].points.length;j++) {
      const xyz=expected[i].points[j].xyz.map((v,k)=>v-open.posed.get('nail').centres[0][k]);
      const [x,y,z]=xyz, c=cosDeg(angle), s=sinDeg(angle);
      const rotated=[x,y*c-z*s,y*s+z*c];
      for (let k=0;k<3;k++) assert.ok(Math.abs(tip[k]+rotated[k]-moved[i].points[j].xyz[k])<1e-5);
    }
  }
  assert.ok(Math.abs(hook.posed.get('nail').centres[1][2]+2)<1e-6);
  assert.equal(rig.anglesAt(90).get('index.tip'),45);
  const edited=structuredClone(source);
  edited.paths.index.nodes[1].at=[3,0,0];
  const reshaped=stackPaths(edited,new Map(),0).mesh(new Map());
  assert.deepEqual(reshaped.posed.get('nail').centres,[[3,0,0],[5,0,0]]);
  const prepared=prepareStack(source), original=prepared.recipe();
  const request={poses:['hook','open'],headings:[21,74,122],focus:'index',size:64};
  const sheet=prepared.poseStudy(request);
  assert.deepEqual(prepared.recipe(),original);
  assert.deepEqual(sheet,prepared.poseStudy(request));
  assert.equal(sheet.frames.length,6);
  assert.throws(()=>prepared.poseStudy({...request,headings:[21,21]}),/headings/);
  assert.throws(()=>prepared.poseStudy({...request,focus:'missing'}),/focus/);
  assert.throws(()=>prepareStack({...source,paths:{index:{...source.paths.index,attach:'nail'},nail:source.paths.nail}}),/cycle/);
  assert.throws(()=>prepareStack({...source,poses:{bad:{index:{typo:20}}}}),/unknown joint/);
  assert.throws(()=>prepareStack({...source,paths:{index:path([0,0,0],[0,0,0])}}),/successive centres/);
});

test('a bent rib stays on the membrane boundary and its vein paints either side', () => {
  const rib=x=>({colors:'k',nodes:[{name:'root',at:[x,0,0],radius:0},{name:'end',at:[x,0,5],radius:0}]});
  const membrane={ribs:['a','b'],colors:'s',sag:-1,scallop:1,veins:[{color:'v',points:[[0,.5,.2],[1,.5,.2]]}]};
  const source={...block,slices:[['.']],paths:{a:rib(0),b:rib(6)},palette:{...block.palette,v:'#ff0000'},
    membranes:[membrane],poses:{open:{},fold:{b:{root:35}}}};
  const rig=stackPaths(source,new Map(),0), mesh=rig.mesh(rig.poses.get('fold'));
  const bands=mesh.facets.filter(f=>f.ink==='s'.charCodeAt(0));
  assert.equal(bands.length,4);
  assert.ok(bands[1].points[2].xyz[1]<0,'a one-colour membrane sags between its ribs');
  assert.deepEqual(bands[0].points[3].xyz,mesh.posed.get('a').centres[1]);
  assert.deepEqual(bands.at(-1).points[2].xyz,mesh.posed.get('b').centres[1]);
  assert.deepEqual(bands[0].points[2],bands[1].points[3]);
  const sheet=renderProject(prepareStack(source).poseStudy({poses:['open','fold'],headings:[0,180]}));
  for (const frame of sheet.frames) assert.ok(frame.data.some((v,i)=>i%4===0&&v===255&&frame.data[i+1]===0));
  assert.throws(()=>prepareStack({...source,membranes:[{...membrane,ribs:['a','absent']}]}),/ribs/);
});

const grid = (source, heading) => compileStack(source).recipe.frames.find(f => f.name === `heading-${heading}`).ops[0].rows;

test('each painted side is visible from its own heading and fully hidden edge-on and behind', () => {
  for (const [face, angle] of [['south', 0], ['east', 90], ['north', 180], ['west', 270]]) {
    const source = { ...block, paint: [{ face, rows: ['sss', 'sss'] }] };
    assert.deepEqual(stackSide(source, face), ['sss', 'sss']);
    for (const frame of compileStack(source).recipe.frames) {
      const silver = frame.ops[0].rows.join('').split('s').length - 1;
      assert.equal(silver, frame.name === `heading-${angle}` ? 96 : 0, `${face}, ${frame.name}`);
    }
  }
});

test('paint depth colours connected solid cells and stops at air', () => {
  const marker = { face: 'west', rows: ['s'], depth: 6 };
  const model = { ...block, slices: [['kk.kk']], paint: [marker] };
  assert.deepEqual(stackSide(model, 'south'), ['ss.kk']);
  assert.deepEqual(stackSide(model, 'east'), ['k']);
  assert.deepEqual(stackSide({ ...model, paint: [{ ...marker, depth: 0 }] }, 'south'), ['kk.kk']);
  assert.deepEqual(stackSide({ ...model, paint: [marker, { face:'west', rows:['k'] }] }, 'west'), ['k']);
});

test('named decals mirror independently and erasing peels one stroke per cell', () => {
  const source = { ...block, decals: { rim: ['s..', '.s.'] }, paint: [
    { face: 'north', decal: 'rim' }, { face: 'south', decal: 'rim', flipX: true, flipY: true }
  ] };
  assert.deepEqual(stackSide(source, 'north'), ['skk','ksk']);
  assert.deepEqual(stackSide(source, 'south'), ['ksk','kks']);
  source.paint.push({ face:'south', at:[1,0], rows:['kk'], depth:3 }, { face:'south', at:[1,0], erase:['x.'] });
  assert.deepEqual(stackSide(source, 'south'), ['ksk','kks']);
  source.paint.push({ face:'south', at:[1,0], erase:['x.'] });
  assert.deepEqual(stackSide(source, 'south'), ['kkk','kks']);
  assert.deepEqual(stackSide(source, 'north'), ['skk','ksk']);
  assert.deepEqual(source.decals.rim, ['s..','.s.']);
  const deep = { ...block, slices:[['kkk']], paint:[{ face:'west', rows:['s'], depth:3 }, { face:'west', erase:['x'] }] };
  assert.deepEqual(stackSide(deep,'south'), ['kkk']);
  for (const place of [{ decal:'missing' }, { rows:['s'], decal:'rim' }, { erase:['s'] },
    { erase:['x'], depth:1 }, { rows:['s'], flipX:false }, { decal:'rim', flipY:2 }, { decal:'rim', flipX:null }]) {
    assert.throws(() => compileStack({ ...source, paint:[{ face:'south', ...place }] }), /stack.paint/);
  }
});

test('an isolated heading and pinned detail match the full turn, including occlusion and padding', () => {
  for (const projection of ['iso','oblique']) {
    const model = prepareStack({ ...block, projection, pivot:[0,2], spacing:2, headings:[359,0,1,90,135],
      paint:[{ face:'south', at:[0,1], rows:['sss'] }] });
    const first = model.recipe(3), full = model.recipe();
    assert.deepEqual(first.anchor, full.anchor);
    assert.deepEqual(first.frames, [full.frames[3]]);
    assert.equal(model.detail('south', [0,2], 0), null);
    for (const [i, heading] of model.metadata.headings.entries()) for (const face of ['north','south','west','east']) {
      const { left, top, rows } = model.detail(face,[0,1],heading,17);
      const whole = full.frames[i].ops[0].rows;
      rows.forEach((row,y) => assert.equal(row,
        Array.from({length:17}, (_,x) => whole[top+y]?.[left+x] ?? '.').join(''), `${projection} ${face} ${heading}°`));
    }
  }
});

test('4× is the native projection default; iso zero follows the 2:1 diagonal', () => {
  const source = { ...block, headings: [0], projection: 'iso' };
  const iso = compileStack(source).recipe, rows = iso.frames[0].ops[0].rows;
  assert.deepEqual(rows, grid({ ...block, headings: [45], squash: .5, resolution: 4 }, 45));
  assert.deepEqual(iso, compileStack({ ...source, resolution: 4 }).recipe);
  // Distinct boundaries within four output scanlines cannot come from repeating low-res pixels.
  assert.ok(new Set(rows.slice(0, 4)).size > 1);
  assert.ok(iso.width > compileStack({ ...source, resolution: 1 }).recipe.width * 2);
  const colours = new Set(rows.join(''));
  assert.deepEqual(colours, new Set(['.', 'k']));
});

test('CLI inspection of a pinned stack cell renders intermediate headings and reports an empty pin', () => {
  const inspect = pin => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url)),
      'inspect', '-', '--pin', pin, '--grid'], { input:JSON.stringify(block), encoding:'utf8' });
    return JSON.parse(result.stdout || result.stderr);
  };
  const review = inspect('south,1,0,0');
  assert.equal(review.ok, true);
  assert.deepEqual([review.width, review.height, review.frames], [36,36,5]);
  assert.deepEqual(review.grids.map(grid => grid.frame), ['heading-358','heading-359','heading-0','heading-1','heading-2']);
  assert.match(inspect('south,100,0,0').error, /solid cell/);
});

test('a camera lock matches the authored pose plus one local rotation, including a vertex on a second socket', () => {
  // Compare in ground coordinates, including every nonblank pixel. A fitted turntable and a
  // full-revolution inspection may have different margins but must agree on the image inside.
  function pixels(recipe) {
    const { data } = renderProject(recipe).frames[0], out = [];
    for (let i = 0; i < data.length; i += 4) if (data[i+3]) {
      out.push([i/4 % recipe.width - recipe.anchor[0], Math.floor(i/4/recipe.width) - recipe.anchor[1], ...data.subarray(i,i+4)]);
    }
    return out;
  }
  const heading = 37;
  for (const axis of ['x','y','z']) {
    const source = { ...block, headings:[0,90], projection:'iso', palette:{...block.palette, g:'#75baa080'},
      sockets:{bit:{at:[1,2,2], axis, keys:[{heading:0,angle:-40},{heading:90,angle:5,offset:[3,1,2]}]},
        cab:{at:[-1,0,1], keys:[{heading:0},{heading:90, angle:80,offset:[1,0,0]}]}, spare:{at:[0,0,0]}},
      facets:[{color:'g',socket:'bit',twoSided:true,points:[[0,1,1],[2,9,5],[5,8,4]]},
        {color:'s',socket:'bit',twoSided:true,points:[[0,2,0],[1,2,0],{socket:'cab',at:[0,0,2]}]}] };
    const model = prepareStack(source), original = structuredClone(model.recipe()), study = model.rotationStudy(heading,'bit');
    assert.deepEqual(model.rotationSockets, ['bit','cab']);
    const start = study.recipe(0);
    for (const rotation of [0,57.25,180,270,360]) {
      const actual = study.recipe(rotation), bit = source.sockets.bit;
      const baked = prepareStack({ ...source, headings:[heading], sockets:{...source.sockets,bit:{...bit,
        keys:bit.keys.map(key => ({...key,angle:key.angle + rotation % 360}))}} }).recipe();
      assert.deepEqual(pixels(actual), pixels(baked), axis + ' at ' + rotation);
      assert.deepEqual([actual.width,actual.height,actual.anchor,actual.frames[0].points],
        [start.width,start.height,start.anchor,start.frames[0].points]);
    }
    assert.deepEqual(study.recipe(360), start);
    assert.deepEqual(model.recipe(), original);
    assert.throws(() => study.recipe(-2), /rotation.offset/);
    assert.throws(() => model.rotationStudy(0,'spare'), /rotation.socket/);
  }
});

test('inspect --rotate selects a single fixed-camera pose and validates its socket, heading and rotation', () => {
  const source = {...block,sockets:{bit:{at:[1,1,1]}},facets:[{socket:'bit',color:'s',points:[[0,0,0],[4,0,2],[4,2,0]],twoSided:true}]};
  const inspect = (...args) => {
    const result = spawnSync(process.execPath,[fileURLToPath(new URL('../bin/pixelbolt.js',import.meta.url)),
      'inspect','-','--rotate',...args],{input:JSON.stringify(source),encoding:'utf8'});
    return cliReply(result, result.status === 0 ? 'stdout' : 'stderr');
  };
  assert.equal(inspect('bit,0,22.5').frames, 1);
  assert.match(inspect('missing,0,0').error, /socket/);
  assert.match(inspect('bit,360,90').error, /heading/);
  assert.match(inspect('bit,0,361').error, /offset/);
  assert.match(inspect('bit,0,').error, /expects/);
  assert.match(inspect('bit,0,90','--pin','south,0,0,0').error, /--pin/);
});

test('glass voxels tint once per contiguous run and reveal the first opaque surface', () => {
  const make = row => ({...block, resolution:4, headings:[0], squash:.25,
    palette:{g:'#a040f080',k:'#183050'}, slices:Array.from({length:4},()=>[...row].map(key=>key.repeat(3)))});
  for(const [row,expected] of [['ggg',[160,64,240,128]],['g.g',[160,64,240,192]],['kgg',[92,56,160,255]]]) {
    const image=renderProject(compileStack(make(row)).recipe);
    const data=image.frames[0].data, i=(Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4;
    assert.deepEqual([...data.slice(i,i+4)],expected,row);
  }
});

test('clear face paint exposes the voxel and clear depth paint opens a gap', () => {
  const source = { ...block, palette: { ...block.palette, a:'#0000' }, slices:[['ksk']] };
  const cover = { face:'west', rows:['s'] }, clear = { face:'west', rows:['a'] };
  assert.deepEqual(stackSide({ ...source, paint:[cover, clear] }, 'west'), ['k']);
  assert.deepEqual(stackSide({ ...source, paint:[{ ...clear, depth:1 }] }, 'west'), ['s']);
  assert.deepEqual(stackSide({ ...source, paint:[{ ...clear, depth:3 }] }, 'south'), ['...']);
});

test('socket-mounted faces have crisp shared edges, true alpha and stable projection', () => {
  const face={color:'g',socket:'lift',points:[[0,0,0],[3,0,0],[3,3,0],[0,3,0]]};
  const source={...block,headings:[0,90,180],slices:Array.from({length:4},()=>['...','...','...']),palette:{g:'#dd55aa80'},
    sockets:{lift:{at:[0,0,1],keys:[{heading:0},{heading:180,offset:[0,0,2]}]}},facets:[face]};
  const model=prepareStack(source), full=model.recipe(), rendered=renderProject(full);
  for(const f of rendered.frames) {
    const alpha=new Set(f.data.filter((_,i)=>i%4===3));
    assert.deepEqual(alpha,new Set([0,128]));
  }
  assert.deepEqual(model.recipe(1).frames,[full.frames[1]]);
  const middle=model.attachments(90).lift;
  const baked=prepareStack({...source,sockets:{lift:{at:[0,0,2]}}});
  assert.deepEqual(model.frame(1).ops,baked.frame(1).ops);
  assert.deepEqual(full.frames[1].points.lift,middle);
  const glassOnMetal={...source,slices:[['kkk','kkk','kkk']],palette:{...source.palette,k:'#182838'}};
  const solid=renderProject(compileStack(glassOnMetal).recipe);
  assert.ok(solid.frames[0].data.some((x,i)=>i%4===0 && x===123),'glass mixes with metal beneath');
  const bad=[{facets:[{...face,socket:'absent'}]},{facets:[{...face,color:'missing'}]},
    {sockets:{lift:{at:[0,1],keys:[]}}},{sockets:{lift:{at:[0,0,0],keys:[{heading:30},{heading:10}]}}}];
  for(const patch of bad) assert.throws(()=>prepareStack({...source,...patch}),/stack\./);
});

test('two crossing faces swap visibility with depth and a triangulated glass square owns its diagonal once', () => {
  const panel=[[0,1,0],[4,1,0],[4,1,4],[0,1,4]];
  const base={...block,palette:{g:'#bb66dd80',m:'#184866'},slices:[['....','....','....']],
    squash:.5,headings:[0,180],facets:[
      {color:'g',twoSided:true,points:panel},
      {color:'m',twoSided:true,points:[[0,.2,0],[4,1.8,0],[4,1.8,4],[0,.2,4]]}]};
  const recipe=compileStack(base).recipe, project=renderProject(recipe);
  for(const frame of project.frames) {
    const y=recipe.anchor[1]-8, pixels=x=>[...frame.data.slice((y*project.width+x)*4,(y*project.width+x+1)*4)];
    const pair=[pixels(recipe.anchor[0]-3),pixels(recipe.anchor[0]+3)];
    assert.ok(pair.some(p=>p.join() === '24,72,102,255'),frame.name);
    assert.ok(pair.some(p=>p.join() === '106,87,162,255'),frame.name);
  }
  const single=renderProject(compileStack({...base,facets:[base.facets[0]]}).recipe);
  for(const frame of single.frames) assert.equal(frame.data.filter((v,i)=>i%4===3&&v===128).length,16*16);
});

test('lofts paint matching spans and mirror the same diagonal on a moving socket', () => {
  const a = [[0,0,0], [2,1,1], [4,-1,2]], b = [[0,0,4], [2,2,3], [4,1,5]];
  const c = a.map(([x,y,z]) => [x, y + 1, z + 6]);
  const base = { ...block, headings: [0,31,90,180,225,315], resolution: 3,
    palette: { ...block.palette, g: '#98bfdf80' },
    sockets: { head: { at: [1,1,3], axis: 'y', keys: [{heading:0},{heading:180,angle:30}] } } };
  for (const mirror of ['x','y','z']) {
    const axis = 'xyz'.indexOf(mirror);
    const reflect = p => p.map((v, i) => i === axis ? -v : v);
    const facets = [];
    const expected = (p, q, r, s, color) => {
      facets.push({ socket: 'head', color, points: [p,q,r,s] });
      facets.push({ socket: 'head', color, points: [p,s,r,q].map(reflect) });
    };
    expected(a[0],a[1],b[1],b[0],'g');
    expected(a[1],a[2],b[2],b[1],'k');
    expected(a[2],a[0],b[0],b[2],'s');
    expected(b[0],b[1],c[1],c[0],'s');
    expected(b[1],b[2],c[2],c[1],'s');
    expected(b[2],b[0],c[0],c[2],'s');
    const lofts = [{ socket:'head', contours:['a','b','c'], bands:['gks','s'], closed:true, mirror }];
    assert.deepEqual(compileStack({ ...base, contours:{a,b,c}, lofts }).recipe,
      compileStack({ ...base, facets }).recipe);
  }
  // A translucent panel lying entirely on its mirror plane must be emitted once.
  const source = { ...base, contours:{ a:[[0,-2,0],[0,1,0]], b:[[0,-2,3],[0,1,3]] } };
  const panel = { socket:'head', contours:['a','b'], bands:['g'], twoSided:true };
  assert.deepEqual(compileStack({ ...source, lofts:[{...panel, mirror:'x'}] }).recipe,
    compileStack({ ...source, lofts:[panel] }).recipe);
});

test('lofts reject unmatched landmarks, invalid bands and excess geometry at the source field', () => {
  const a = [[0,0,0],[1,1,1]], b = [[0,0,2],[1,1,2]];
  const contours = { a, b, long: [...a,[2,0,1]] };
  const loft = { contours:['a','b'], bands:['k'] };
  for (const [edit,field] of [
    [{contours:['a','missing']}, 'contours'], [{contours:['a','long']}, 'contours'],
    [{contours:['a','a']}, 'contours'], [{closed:true}, 'closed contour'],
    [{bands:[]}, 'bands'], [{bands:['z']}, 'bands'], [{bands:['kk']}, 'bands'],
    [{mirror:'w'}, 'mirror'], [{socket:'typo'}, 'socket'], [{twoSided:3}, 'twoSided']
  ]) assert.throws(() => prepareStack({ ...block, contours, lofts:[{...loft,...edit}] }), new RegExp(field));
  assert.throws(() => prepareStack({ ...block, contours:{ a:[[0,0,0]] } }), /contours.a/);
  const faces = Array(2048).fill({ color:'s', points:[[0,0,0],[1,1,1],[2,0,1]] });
  assert.throws(() => prepareStack({ ...block, contours, lofts:[loft], facets:faces }), /2,048/);
});

test('Rimefiend keeps both outer lids and the mouth visible from profile to profile', async () => {
  const source = JSON.parse(await readFile(new URL('../showcase/rimefiend/rimefiend.stack.json',import.meta.url)));
  const [mouth, eye] = source.lofts;
  // Mark only the outer four eye spans. A visible inner corner cannot mask a lost outer rim.
  Object.assign(source.palette, { U:'#ff00ff', V:'#00ff00', W:'#00ffff', X:'#ffff00' });
  eye.bands[1] = eye.bands[1].slice(0,-4) + 'UUUU';
  eye.bands[6] = eye.bands[6].slice(0,-4) + 'VVVV';
  mouth.bands[2] = 'W'; // recessed opening between the gum and the throat
  mouth.bands[4] = 'X'; // lower lip to jaw ridge
  source.headings = Array.from({length:31}, (_, i) => (225 + i * 6) % 360);
  const colors = [0xff00ff, 0x00ff00, 0x00ffff, 0xffff00];
  for (const {name, data} of renderProject(compileStack(source).recipe).frames) {
    const counts = [0,0,0,0];
    for (let i=0; i<data.length; i+=4) {
      const index = colors.indexOf((data[i] << 16) | (data[i+1] << 8) | data[i+2]);
      if (index >= 0 && data[i+3] === 255) counts[index]++;
    }
    assert.ok(counts.every(n => n >= 5), name + ' visible feature pixels: ' + counts);
  }
});

test('invalid sources and excessive projections are refused before drawing', () => {
  for (const [change, field] of [
    [{ resolution: 1.5 }, 'resolution'], [{ projection: 'iso', squash: 1 }, 'squash'],
    [{ headings: [0, 0] }, 'headings'], [{ pivot: [3,0] }, 'pivot'],
    [{ palette: { k: '#xx17' } }, 'palette'], [{ slices: [['k'], ['kk']] }, 'slices'], [{ decals:null }, 'decals'],
    [{ paint: [{ face:'north', at:[1,1], rows:['sss'] }] }, 'paint'],
    [{ resolution:8, slices:[Array(128).fill('k'.repeat(128))] }, 'resolution'],
    [{ name:'CON' }, 'name']
  ]) assert.throws(() => compileStack({ ...block, ...change }), new RegExp(field));
  assert.throws(() => compileStack(block, { maxPixels: 10 }), /scene asset pixel budget/);
});

// Count contiguous silver regions in the actual exported wheel artwork. Measure area as well:
// a detached fleck or a missing section on a grazing sidewall would pass a frame-count check.
function silverAreas(rows) {
  const width = rows[0].length, cells = Uint8Array.from(rows.join(''), key => Number('mcl'.includes(key)));
  const sizes = [];
  for (let at = 0; at < cells.length; at++) {
    if (!cells[at]) continue;
    let area = 0;
    const pending = [at]; cells[at] = 0;
    while (pending.length) {
      const i = pending.pop(); area++;
      const adjacent = [i - width, i + width];
      if (i % width) adjacent.push(i - 1);
      if (i % width < width - 1) adjacent.push(i + 1);
      for (const j of adjacent) if (cells[j]) { cells[j] = 0; pending.push(j); }
    }
    sizes.push(area);
  }
  return sizes;
}

golden.test('Copper Rally keeps two connected silver rims throughout the turn, with neither visible end-on', async () => {
  const car = JSON.parse(await readFile(new URL('../examples/copper-rally.stack.json', import.meta.url), 'utf8'));
  assert.equal(car.paint.filter(place => place.decal === 'hub').length, 4);
  const { recipe } = compileStack(car);
  assert.deepEqual([recipe.width, recipe.height, recipe.frames.length], [250,210,60]);
  const pixels = createHash('sha256');
  for (const frame of renderProject(recipe).frames) pixels.update(frame.data);
  golden.equal('copper-rally', pixels.digest('hex'), { recipe });
  const areas = new Map(recipe.frames.map(frame => [Number(frame.name.slice(8)), silverAreas(frame.ops[0].rows)]));
  const side = areas.get(0)[0];
  assert.ok(side > 400);
  for (const [angle, sizes] of areas) {
    if (angle === 90 || angle === 270) { assert.deepEqual(sizes, []); continue; }
    assert.equal(sizes.length, 2, `rim fragments at ${angle}°: ${sizes}`);
    const projected = side * Math.abs(cosDeg(angle));
    for (const size of sizes) assert.ok(Math.abs(size - projected) <= 24, `${angle}°: ${size} vs ${projected}`);
  }
});

golden.test('Rimefiend keeps the crystal nail and painted wing webs registered through a pose study', async () => {
  const source=JSON.parse(await readFile(new URL('../showcase/rimefiend/rimefiend.stack.json',import.meta.url)));
  const hand=JSON.parse(await readFile(new URL('../showcase/rimefiend/index-study.json',import.meta.url)));
  const model=prepareStack(source);
  for(const [name,request] of [['index',hand],['wings',{poses:['open','folded'],headings:[315,153]}],
    ['face',{poses:['open'],headings:[225,315,45]}]]) {
    const recipe=model.poseStudy(request), pixels=createHash('sha256');
    for (const frame of renderProject(recipe).frames) pixels.update(frame.data);
    golden.equal('rimefiend-'+name,pixels.digest('hex'),{recipe});
  }
});

golden.test('the faceted crane keeps transmissive glass and a shared ground pivot through every pose', async () => {
  const source=JSON.parse(await readFile(new URL('../examples/lodekeeper-faceted.stack.json',import.meta.url),'utf8'));
  const model=prepareStack(source), recipe=model.recipe(), {frames}=renderProject(recipe);
  const pixels=createHash('sha256');
  assert.equal(frames.length,72);
  for(const frame of frames) {
    pixels.update(frame.data);
    assert.ok(frame.data.some((v,i)=>i%4===3 && v>0 && v<255),frame.name);
  }
  golden.equal('lodekeeper-faceted',pixels.digest('hex'),{recipe});
});

test('scene placements share the pivot, occlude as whole sprites, and retain the editable source on export', async () => {
  const scene = { format: 'pixelforge-scene', version:1, name:'overlap', width:48, height:48,
    assets:{ front:{ recipe:{ ...block, projection:'iso' } }, other:block },
    instances:[{ name:'first', asset:'front', at:[24,24], frame:'heading-90' }, { name:'second', asset:'other', at:[24,22] }] };
  for (const y of [22,26]) {
    scene.instances[1].at[1] = y;
    const prepared = prepareScene(scene), { depth } = renderScene(prepared, { depth:true });
    assert.deepEqual(prepared.instances.map(i => [i.anchor,i.sort]), [['frame','ground'],['frame','ground']]);
    assert.equal(depth.overlaps.length, 1);
    assert.equal(depth.overlaps[0].front, y > 24 ? 'second' : 'first');
    assert.ok(depth.overlaps[0].pixels > 0);
    assert.deepEqual(prepared.source, scene);
  }
  const { files } = await createSceneBundle(scene);
  assert.deepEqual(JSON.parse(files.get('scene.json')), scene);
  assert.ok(files.has('scene.tmx') && files.has('scene.tscn') && files.has('assets/0/color.png'));
});
