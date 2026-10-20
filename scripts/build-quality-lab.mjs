/** Original, deliberately small art study. Fixed authored contours; no random texture or tweened poses. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compilePoses, renderProject, inspectProject, createOverlay, applyOverlay, prepareScene, renderScene, encodePNG, scalePixels } from '../src/index.js';

const root = fileURLToPath(new URL('../', import.meta.url)), files = new Map();
const palette = { k:'#0b1020', v:'#182239', b:'#26354c', s:'#3d5364', t:'#477975', g:'#72967d', h:'#afc4a0', y:'#e7ce89', w:'#f7edc4', a:'#cc8762', r:'#8d5260', p:'#573b57', c:'#75bfbc', d:'#3a8eaa' };
const rows = lines => { const width = Math.max(...lines.map(line => line.length)); return lines.map(line => line.padEnd(width, '.')); };
const grid = (lines, x=0, y=0) => ({ op:'grid', x, y, rows:rows(lines) });
const project = (name,width,height,frames,animations) => ({ version:1,name,width,height,palette,frames,...(animations && {animations}) });
const json = (file,value) => files.set(file, Buffer.from(JSON.stringify(value,null,2)+'\n'));
const png = (file,image,scale=1) => files.set(file, encodePNG(scalePixels(image.data,image.width,image.height,scale),image.width*scale,image.height*scale));
const stroke = (points,color) => points.slice(1).map((p,i)=>({op:'line',x:points[i][0],y:points[i][1],x2:p[0],y2:p[1],color}));
// Authored polygon contours lowered to horizontal runs, each still editable in the saved recipe.
function shape(points,color) {
  const ops=[];
  for(let y=Math.min(...points.map(p=>p[1]));y<Math.max(...points.map(p=>p[1]));y++){
    const xs=[];
    for(let i=0;i<points.length;i++){const [x1,y1]=points[i],[x2,y2]=points[(i+1)%points.length];if((y1<=y+.5&&y2>y+.5)||(y2<=y+.5&&y1>y+.5))xs.push(x1+(y+.5-y1)*(x2-x1)/(y2-y1));}
    xs.sort((a,b)=>a-b);for(let i=0;i<xs.length;i+=2){const x=Math.ceil(xs[i]-.5),right=Math.ceil(xs[i+1]-.5);if(right>x)ops.push({op:'rect',x,y,w:right-x,h:1,color});}
  }return ops;
}

const fernLines=[
'...............h', '..............hg', '.............hgg', '.............gt', '....g.......ggt', '....hgg....ggt', '.....hggg..gt', '......ggg.ggt', '.......ggggt', '.........gt',
'..........gt...gggh', '...gg......gtggggh', '....hggg...ggggh', '.....hggggggt', '.......ggggt', '.........gt', '.........gt', '.....g...gt', '.....ggg.gt', '......hgggt', '.......gggt', '.........gt', '.........gt', '........ggt', '......gggt', '.....ggt'
];
const fernBase=project('reed-fern-blockout',24,32,[{name:'still',ops:[{op:'line',x:11,y:3,x2:11,y2:29,color:'g'},...[6,12,18,24].flatMap(y=>[{op:'line',x:11,y,x2:4,y2:y-3,color:'g'},{op:'line',x:11,y,x2:18,y2:y-3,color:'g'}])]}]);
const fern=project('reed-fern',24,32,[{name:'still',ops:[grid(fernLines,2,3)]},{name:'lean',ops:[grid(fernLines.map((line,i)=>i<12?'.'+line:line),2,3)]}],{breathe:{frames:['still','lean'],direction:'pingpong'}});
fern.frames[0].duration=720;fern.frames[1].duration=480;
const fernCorrection=createOverlay(fern,[{grid:'frames[still]',selection:'tip',value:{rows:['..h','..h','.hg']}}],{tip:{space:'canvas',x:14,y:2,w:3,h:3}});
const correctedFern=applyOverlay(fern,fernCorrection).recipe;

const rock=project('split-shale',24,16,[{name:'still',ops:[grid([
'.........sssss', '......ssshhhhsbb', '....sshhsssstssbbb', '...shhsssssttssbbbb', '..shhsssssttsssbbbbb', '.shsssstttssssbbbbbb', '.sssstttssssbbbbbbbb', 'sssttssssbbbbbbbvbbbb', 'sstssbbbbbbbbbvvbbbbbb', 'stssbbbbbbbbbvvbbbbbbb', 'ssbbbbbbbbbbvvbbvvvvv', '.bbbbbbbbbvvvbbvvv', '..bbvvvvvvvvvvv', '....vvvvvvvv'
],1,1)]}]);
const soil=project('root-bank',32,24,[{name:'a',ops:[grid([
'ggttgggttttggtttttgggttttggttggg','thggtgggggthggttggggtggghgggttgt','ttggtttttggggttttttggtttgggttttt','bbttttbbtttgtbbbtbbttttbbttttbbb','bbbbbbbbbbtgtbbbbbbbbbttbbbbbbbb','bbvvbbbbbbtgttbbbbbbbbbttbbvvbbb','bbbbbbvvbbbtgtbbbbbvvbbbtbbbbbbb','bbbbbbvvbbbtgtbbbbbbbbbtbbbbbbbb','vbbbbbbbbbbtgttbbbbbbbtbbbbbbvvb','vvbbbbbbbbbbtgtbbbbbbbttbbbbbvvb','vvvbbbbbbbbbttgtbbbbbbtbbbbbbvvv','vvvvbbbbbbbvbttgtbbbbttbbbbbvvvv','vvvvvvbbvvvvbbttgtbbttbbbbbvvvvv','vvvvvvvvvvvvvbbttgtttbbbbbvvvvvv','vvvvvvvvvvvvvvbbtggtbbbvvvvvvvvv','vvvvvvvvvvvvvvvvbttbbvvvvvvvvvvv','vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'
],0,0)]}]);

const parts={
  body:{rows:rows(['...aayyyya','..ayyyaaaaa','aayaaaaaaarr','aaaaaaaarrrr','rraaaarrrrrp','.rrrrrppppp','..pppppppp']),anchor:[7,5],points:{neck:[10,1],grip:[10,4],hip:[4,5],tail:[0,4]}},
  compressed:{rows:rows(['...aayyyya','aayyaaaaaaaa','aaaaaaaaarrrr','rraaaarrrrrpp','.rrrrrpppppp']),anchor:[7,3],points:{neck:[10,0],grip:[11,3],hip:[4,3],tail:[0,3]}},
  head:{rows:rows(['..y...y','..ay.ya','...ayaa','..yaaaa','..aaawaa','..aaakyaa','...aarr','....rr']),anchor:[2,5],points:{mouth:[7,5]}},
  blink:{rows:rows(['..y...y','..ay.ya','...ayaa','..yaaaa','..aaaaaa','..aaakyaa','...aarr','....rr']),anchor:[2,5],points:{mouth:[7,5]}},
  crest:{rows:rows(['y.....y','ay...ya','.ayaaay','..yaaa','..aaawaa','..aaakyaa','...aarr','....rr']),anchor:[2,5],points:{mouth:[7,5]}},
  tail:{rows:rows(['......rr','....rrpp','..rrpp','.rpp','rp','r']),anchor:[7,0]},
  tailUp:{rows:rows(['r','rp','.rpp','..rrpp','....rrpp','......rr']),anchor:[7,5]},
  stand:{rows:rows(['..rr...rr','..rp...rp','..rp...rp','.rrp..rrp']),anchor:[3,0],points:{foot:[2,3]}},
  contactA:{rows:rows(['...rr...rr','..rr.....rr','.rr.......rr','rpp.......rpp']),anchor:[4,0],points:{foot:[10,3]}},
  downA:{rows:rows(['..rr...rr','.rrp....rr','..rp....rp','..rpp..rpp']),anchor:[3,0],points:{foot:[7,3]}},
  passA:{rows:rows(['..rr...rr','..rp..rr','..rp..ppp','.rpp']),anchor:[3,0],points:{foot:[1,3]}},
  contactB:{rows:rows(['...rr...rr','....rr..rr','.....rrrr','....rpp.rpp']),anchor:[4,0],points:{foot:[8,3]}},
  downB:{rows:rows(['..rr...rr','...rr.rr','....rprp','...rpp.rpp']),anchor:[3,0],points:{foot:[7,3]}},
  passB:{rows:rows(['..rr...rr','..rr...rp','.ppp...rp','......rpp']),anchor:[3,0],points:{foot:[6,3]}},
  charm:{rows:rows(['y','a','yay','ywy','yay','.a']),anchor:[0,0],points:{light:[1,3]}}
};
const pose=(name,duration,body='body',legs='stand',head='head',dy=0,tail='tail')=>({name,duration,origin:[14,15+dy],parts:[{name:'tail',part:tail,attach:undefined},{name:'body',part:body},{name:'feet',part:legs,attach:{part:'body',point:'hip'}},{name:'head',part:head,attach:{part:'body',point:'neck'}},{name:'charm',part:'charm',attach:{part:'body',point:'grip'},at:[0,0]}].map((p,i)=>i===0?{name:'tail',part:tail,at:[-7,0]}:p),markers:[{name:name.startsWith('contact')?'foot-contact':name==='release'?'spell-release':'pose',part:name==='release'?'head':'feet',point:name==='release'?'mouth':'foot'}]});
const poses={format:'pixelforge-poses',version:1,name:'lantern-skink',width:32,height:26,palette,parts,poses:[pose('idle',880),pose('blink',100,'body','stand','blink'),pose('contact-a',90,'body','contactA'),pose('down-a',80,'compressed','downA','head',1),pose('passing-a',80,'body','passA','head',-1,'tailUp'),pose('contact-b',90,'body','contactB'),pose('down-b',80,'compressed','downB','head',1),pose('passing-b',80,'body','passB','head',-1),pose('gather',220,'compressed','downA','crest',1,'tailUp'),pose('release',80,'body','contactA','crest',-1,'tailUp'),pose('recoil',120,'compressed','downB','blink',1),pose('recover',180)],animations:{idle:{frames:['idle','blink','idle']},run:{frames:['contact-a','down-a','passing-a','contact-b','down-b','passing-b']},cast:{frames:['gather','release','recoil','recover'],loop:false}}};
const character=compilePoses(poses);

const lampLines=[
'.........yy', '........yhhy', '.......yhsshy', '......yhs..shy', '......ys....sy', '......ys....sy', '......ys....sy', '.....yyssssssyy', '.....yhaaaaashy', '......yaaaaay', '......yarrray', '......yarrpay', '.......yrrpy', '........ypy', '.........y', '.........s', '........sss', '.......sstss', '.......sttts', '......sstttss', '.....sstttttss', '....ssstttttsss', '...sssstttttssss', '..ssssstttttsssss'
];
const lamp=project('listening-lantern',24,32,[{name:'warm',duration:450,ops:[grid(lampLines,1,4)]},{name:'bright',duration:160,ops:[grid(lampLines,1,4),grid(['.yw.','ywwy','.wy.'],8,13)]}],{glow:{frames:['warm','bright']}});
const normal={...lamp,name:'lantern-normal',palette:{...palette},frames:lamp.frames.map(f=>({name:f.name,duration:f.duration,ops:f.ops.map(op=>({...op,rows:op.rows.map(row=>[...row].map(c=>c==='.'?'.':c==='y'||c==='h'?'L':c==='s'?'R':'F').join(''))}))}))};
normal.palette={L:'#35a5e0',R:'#d5a5e0',F:'#8080ff'};
const emissive={...lamp,name:'lantern-emission',frames:lamp.frames.map(f=>({name:f.name,duration:f.duration,ops:[grid(f.name==='bright'?['.aa.','aywa','aywa','.aa.']:['....','.aa.','.ya.','....'],8,13)]}))};
const crystal=project('hush-crystal',16,24,[
  {name:'whole',duration:700,ops:[grid(['......h','.....hcc','....hccdd','....hccdd','...hccddd','...hcdddd','..hccdddd','..hcddddb','..cddddbb','..cdddbb','...ddbb','....bb'],2,7)]},
  {name:'impact',duration:65,ops:[grid(['....w....','...www...','...w.w...','.wwwww.w.','www.w.www','.wwwww.w.','...w.w...','...www...','....w....'],3,7)]},
  {name:'split',duration:100,ops:[grid(['....c.....h','...cc.....cd','...cd.....dd','..cd......db','..dd......bb','...b','.......c','.......db','......cdb'],1,7)]},
  {name:'fallen',duration:150,ops:[grid(['..hc......','..cdb.....','...b..cc..','......dbb.','.hcdb.bbb.','..bbb.....'],3,13)]}
],{break:{frames:['impact','split','fallen'],loop:false}});

const backdropOps=[{op:'rect',w:224,h:128,color:'k'},
  ...shape([[18,8],[71,3],[101,19],[138,11],[189,17],[218,9],[224,89],[199,105],[30,111],[0,76]],'v'),
  ...shape([[46,27],[82,17],[115,31],[137,23],[165,27],[191,44],[203,91],[178,112],[44,100]],'b'),
  ...shape([[72,37],[89,32],[112,42],[151,29],[177,42],[176,76],[158,107],[66,103]],'v'),
  // Narrow buried door; interrupted masonry keeps the silhouette from becoming a uniform arch.
  ...shape([[165,26],[185,18],[204,26],[212,42],[212,91],[195,100],[171,90]],'s'),
  ...shape([[175,31],[187,25],[199,32],[203,43],[203,93],[176,93]],'t'),
  ...shape([[180,39],[187,32],[195,39],[197,48],[197,92],[180,92]],'k'),
  ...stroke([[169,40],[175,31],[184,25]],'g'),...stroke([[204,32],[208,42],[208,62]],'b'),
  ...stroke([[168,46],[177,46]],'b'),...stroke([[167,59],[177,59]],'b'),...stroke([[168,72],[177,72]],'b'),...stroke([[199,53],[210,54]],'b'),...stroke([[199,77],[210,77]],'b'),
  // The cold spring is a directional material; broken vertical ribbons, not palette-swapped flame geometry.
  ...shape([[127,27],[133,27],[132,78],[130,100],[127,101]],'t'),...stroke([[128,31],[128,57],[129,69],[128,93]],'c'),
  ...stroke([[132,42],[131,73],[132,84]],'s'),...stroke([[126,101],[132,102],[144,103]],'t'),
  // Hanging roots enter from offscreen, branch, and reconnect to rock faces.
  ...stroke([[25,0],[27,13],[23,27],[29,38],[27,56],[34,63]],'s'),...stroke([[35,0],[36,20],[29,38]],'b'),...stroke([[27,13],[18,22],[13,23]],'s'),
  ...stroke([[58,0],[53,14],[55,26],[50,40],[54,49]],'b'),...stroke([[57,6],[68,17],[69,31]],'s'),
  ...stroke([[218,0],[211,14],[216,28],[210,41],[217,64]],'b'),
  // A few large mineral planes, with highlights restricted to their exposed upper edges.
  ...shape([[2,51],[18,41],[34,47],[44,64],[34,76],[2,80]],'b'),...stroke([[4,52],[18,45],[29,49]],'s'),
  ...shape([[42,63],[59,55],[74,61],[68,75],[49,81]],'b'),...stroke([[45,64],[59,59],[67,63]],'s'),
  ...shape([[1,0],[224,0],[224,10],[203,14],[190,11],[176,18],[157,12],[143,16],[122,9],[102,14],[85,10],[72,16],[59,10],[45,13],[30,8],[19,14],[0,9]],'k'),
  ...stroke([[12,13],[28,9],[36,13],[46,14]],'t'),...stroke([[57,11],[68,15],[77,11]],'b'),...stroke([[151,14],[160,17],[171,15]],'t'),
  // Waterline and submerged ledges.
  ...shape([[70,105],[174,105],[184,113],[164,128],[53,128]],'v'),
  ...stroke([[77,109],[106,109]],'t'),...stroke([[116,110],[154,110]],'d'),...stroke([[160,113],[177,113]],'t'),
  ...stroke([[89,115],[102,115]],'s'),...stroke([[120,118],[145,118]],'t'),...stroke([[113,123],[128,123]],'b'),
  ...stroke([[128,112],[133,112]],'c'),...stroke([[126,116],[138,116]],'s'),
];
const backdrop=project('hollow-background',224,128,[{name:'still',ops:backdropOps}]);
const bank=project('hollow-bank',224,128,[{name:'still',ops:[
  ...shape([[0,84],[16,82],[25,87],[55,86],[72,90],[87,90],[101,94],[109,107],[83,111],[69,128],[0,128]],'k'),
  ...shape([[0,85],[18,85],[25,90],[58,88],[69,94],[89,93],[99,98],[91,101],[67,100],[54,104],[0,98]],'b'),
  ...stroke([[0,84],[17,83],[25,88],[54,87],[69,92],[86,91],[99,96]],'g'),
  ...stroke([[1,86],[16,85],[26,90],[43,89]],'t'),...stroke([[61,90],[69,94],[88,94]],'t'),
  ...stroke([[15,94],[22,100],[19,110],[25,119]],'b'),...stroke([[31,93],[39,102],[37,113]],'s'),...stroke([[38,99],[47,101],[51,107]],'b'),
  ...shape([[155,102],[167,97],[185,97],[196,93],[224,91],[224,128],[177,128],[169,112]],'k'),
  ...shape([[161,102],[172,98],[187,100],[201,94],[224,94],[224,104],[200,103],[186,107]],'b'),
  ...stroke([[157,102],[170,98],[184,99],[198,94],[222,92]],'g'),...stroke([[173,102],[190,104],[204,99]],'t'),
  ...stroke([[202,107],[205,112],[199,121]],'s'),...stroke([[209,108],[211,118],[218,125]],'b')
]}]);
const scene={format:'pixelforge-scene',version:1,name:'the-listening-hollow',width:224,height:128,duration:4000,background:palette.k,assets:{backdrop,bank,fern:correctedFern,shale:rock,skink:character.recipe,lantern:{recipe:lamp,normal,emissive},crystal},instances:[
{name:'cavern',asset:'backdrop',at:[0,0]},
{name:'far-fern',asset:'fern',at:[141,63],frame:'still'},
{name:'banks',asset:'bank',at:[0,0]},
{name:'left-shale',asset:'shale',at:[31,76]},
{name:'lantern',asset:'lantern',at:[185,65],animation:'glow'},
{name:'traveller',asset:'skink',at:[75,74],animation:'idle',sequence:[{time:1100,animation:'cast'},{time:1700,animation:'idle'}]},
{name:'crystal',asset:'crystal',at:[107,80],frame:'whole',sequence:[{time:1400,animation:'break'},{time:1900,frame:'fallen'}]},
{name:'left-fern',asset:'fern',at:[4,58],animation:'breathe'},
{name:'right-fern',asset:'fern',at:[205,64],frame:'lean'}
],lighting:{ambient:.55,bands:5,lights:[{at:[176,60],height:28,radius:72,color:'#ffe3a6'}]}};

const blockoutScene=structuredClone(scene);
// Second review: replace blank planes with structural ledges and leaf masses. Detail follows form.
backdrop.frames[0].ops.push(
 ...shape([[36,30],[42,27],[53,29],[54,34],[63,37],[59,41],[47,36]],'s'),
 ...shape([[42,30],[48,30],[49,33],[57,36],[52,36]],'b'),
 ...shape([[74,15],[87,14],[96,20],[89,23],[83,20],[74,22]],'s'),
 ...shape([[75,16],[83,16],[85,18],[78,19]],'t'),
 ...stroke([[40,46],[53,48],[60,45],[75,50]],'b'),...stroke([[54,35],[60,43],[64,42]],'s'),
 ...shape([[139,29],[148,22],[155,25],[161,34],[155,38],[148,33]],'s'),
 ...stroke([[139,30],[148,25],[153,28]],'t'),
 ...shape([[106,17],[115,16],[123,22],[120,29],[115,27]],'s'),
 ...stroke([[108,19],[114,20],[117,25]],'b'),
 ...shape([[81,57],[85,51],[90,54],[93,72],[92,84],[85,81]],'b'),
 ...stroke([[86,56],[88,63],[87,79]],'s'),...stroke([[87,79],[94,85],[106,87]],'b'),
 ...shape([[93,65],[103,58],[116,59],[121,65],[116,81],[103,88],[94,83]],'b'),
 ...stroke([[96,65],[104,62],[112,62]],'s'),...stroke([[103,64],[109,66],[119,65]],'v'),
 ...stroke([[98,78],[106,75],[115,77]],'v'),...stroke([[106,84],[113,80]],'s'),
 ...shape([[39,70],[46,68],[55,72],[52,78],[45,77]],'s'),
 ...stroke([[41,70],[46,70],[51,72]],'t'),
 ...stroke([[151,47],[161,49],[166,53]],'b'),...stroke([[151,59],[155,57],[167,61]],'s'),
 ...stroke([[147,78],[153,72],[162,71]],'s'),...stroke([[148,79],[157,76],[161,80]],'b'),
 // Age follows the doorway's joints and load-bearing planes.
 ...stroke([[173,34],[178,30],[183,28]],'h'),...stroke([[199,34],[203,42]],'g'),
 ...stroke([[170,49],[171,56]],'g'),...stroke([[170,63],[171,67]],'g'),...stroke([[201,59],[202,73]],'s'),
 ...stroke([[180,95],[185,96],[192,93]],'g'),
 ...stroke([[175,35],[173,39],[175,44],[173,48]],'v'),
 ...stroke([[206,77],[204,82],[206,88]],'v'),
 // Mineral crust at the source of the spring.
 ...shape([[121,23],[128,21],[136,23],[139,28],[132,31],[125,29]],'s'),
 ...stroke([[124,24],[129,23],[134,25]],'g'),
 ...stroke([[131,96],[139,98],[142,101]],'c'),
 ...stroke([[116,107],[120,105],[133,105]],'t'),
 // Pale cave fungi have upward-facing caps and very short stalks.
 grid(['.ttttt.....','thhggtt....','.ttgt......','...gt..ttt.','...gt.thgt.','....t..tt..'],62,69),
 grid(['..sss.......','.shhgss.....','..sttt....ss','...st...shgs','...st....tt.','....t....t..'],147,52)
);
bank.frames[0].ops.push(
 ...shape([[2,91],[11,88],[17,90],[16,94],[9,94]],'t'),
 ...shape([[45,91],[51,90],[57,93],[54,96],[47,95]],'s'),
 ...stroke([[48,92],[52,92]],'g'),...stroke([[56,97],[63,96],[70,98]],'s'),
 ...stroke([[23,95],[27,99],[27,108],[32,111]],'t'),
 ...stroke([[27,100],[31,105],[40,108]],'b'),
 ...shape([[75,99],[88,97],[94,101],[87,105],[77,104]],'b'),...stroke([[78,99],[85,99]],'s'),
 ...stroke([[79,102],[85,103],[89,101]],'v'),
 ...stroke([[64,105],[59,111],[51,114]],'b'),
 ...stroke([[182,108],[185,114],[185,123]],'b'),...stroke([[185,114],[177,117],[175,125]],'t'),
 ...shape([[200,99],[205,96],[212,97],[211,101],[204,103]],'s'),...stroke([[203,98],[207,97],[210,98]],'g'),
 ...stroke([[207,104],[213,106],[221,103]],'b'),
 grid(['.gg.ttg..','ghttggt..','.ggggtt..','..gttt...','...tt....'],63,87),
 grid(['.....h...','....gg...','.ggggt...','hggtt...','.gtt....','..t.....'],179,94)
);
const plume=project('copper-sedge',32,36,[{name:'still',ops:[grid([
'...............hgg', '............hggggt', '.........hgggggtt', '..........hggttt', '...........ggtt', '...ggg......gtt', '...hgggg....gtt', '....hggggg..gtt', '.....hggggg.gtt', '.......hgggggtt', '.........ggggtt', '............gtt',
'............gtt......hgg', '............gtt....hgggt', '............gtt..hgggtt', '.....gg.....gtthggggtt', '.....hggg...gthgggtt', '......hgggg.ggtttt', '.......hgggggtt', '.........ggggtt', '............gtt',
'.....hgg....gtt', '......hggg..gtt', '.......hgggggtt', '.........ggggtt', '............gtt', '...........ggtt', '.........ggttt', '.......ggtt', '......gtt'
],1,3)]}]);
const distantPlume=structuredClone(plume);distantPlume.name='distant-sedge';distantPlume.palette={...palette,h:palette.t,g:palette.s,t:palette.b};
scene.assets.plume=plume;scene.assets.distantPlume=distantPlume;
scene.instances.splice(1,0,{name:'far-sedge',asset:'distantPlume',at:[29,50]},{name:'door-sedge',asset:'distantPlume',at:[190,50]});
scene.instances.push({name:'foreground-sedge',asset:'plume',at:[1,53]});
scene.instances.find(instance=>instance.name==='far-fern').at=[146,72];
// An asymmetrical canopy frames the room without obscuring the action lane.
const canopy=project('hanging-moss',96,40,[{name:'still',ops:[
 ...stroke([[0,4],[22,12],[34,10],[48,17],[62,14],[80,19],[95,17]],'b'),
 grid(['.ggggtt','ghggggtt','..gggttt','....gtt','.....tt','......t'],2,5),
 grid(['..ggttt','hggggtt','..gggtt','...gtt','....tt','.....t'],17,10),
 grid(['ggggtt','.hgggtt','...ggtt','....gtt','.....tt','.....tt','......t','......t'],31,9),
 grid(['..ggttt','hgggggtt','.hggggtt','...ggttt','....gtt','.....tt','.....tt','......t','......t','......t'],45,15),
 grid(['gggtt','.hgggtt','...ggtt','....gtt','.....tt','......t'],59,13),
 grid(['.gggtt','hggggtt','..hgggtt','....ggtt','.....gtt','......tt','.......t'],77,17)
]}]);
scene.assets.canopy=canopy;scene.instances.push({asset:'canopy',at:[-4,0]});
// Falling streaks alternate long connected ribbons with separated drops; impact stays at the spring.
const spring=project('spring-ribbons',12,78,[0,1,2,3].map(i=>({name:`flow-${i}`,duration:140,ops:[
 {op:'rect',x:5,y:0,w:2,h:72,color:'t'},
 ...stroke([[5,2],[5,17+i*2]],'c'),...stroke([[5,23+i*2],[5,39+i*2]],'c'),...stroke([[5,48+i*2],[5,66]],'c'),
 ...stroke([[8,9+i*3],[8,19+i*3]],'s'),...stroke([[7,38+i*3],[7,50+i*3]],'s'),
 {op:'pixel',x:3,y:67+i*2,color:'c'}, {op:'pixel',x:9,y:64+i*2,color:'t'},
 ...stroke([[1,75],[4+i%2,74],[8,75],[11,75]],i%2?'s':'c')
]})),{flow:{frames:['flow-0','flow-1','flow-2','flow-3']}});
scene.assets.spring=spring;scene.instances.splice(1,0,{asset:'spring',at:[123,28],animation:'flow'});
// Contact review: put intact crystal and debris on the same ledge; connect the release cue to impact.
const crystalLedge=project('spring-ledge',18,7,[{name:'still',ops:[grid(['...gghhggg.....','..ssstttssss...','.ssssbbbbbssss.','..bbbbbbbbbbbb.','...bbbvvvvbbb..','....vvvvvvvv...'])]}]);
scene.assets.ledge=crystalLedge;
const crystalIndex=scene.instances.findIndex(instance=>instance.name==='crystal');
scene.instances[crystalIndex].at=[107,85];
scene.instances.splice(crystalIndex,0,{asset:'ledge',at:[110,104],frame:'still'});
const spell=project('spoken-spark',8,8,[{name:'empty',duration:100},{name:'crescent',duration:40,ops:[grid(['...y...','..yay..','.ya.y..','..yw...','...y...'],0,1)]},{name:'turn',duration:40,ops:[grid(['...y...','..wy...','.ya.y..','..yay..','...y...'],0,1)]}],{flight:{frames:['crescent','turn'],loop:false}});
scene.assets.spell=spell;
scene.instances.push({name:'spoken-spark',asset:'spell',at:[97,84],anchor:[3,3],frame:'empty',sequence:[{time:1320,animation:'flight'},{time:1400,frame:'empty'}],trajectory:[{time:0,at:[97,84]},{time:1320,at:[97,84]},{time:1400,at:[115,96]}]});

json('examples/quality/fern-before.json',fernBase);json('examples/quality/fern-base.json',fern);json('examples/quality/fern-correction.json',fernCorrection);json('examples/quality/fern.json',correctedFern);
json('examples/quality/stride.scene.json',{format:'pixelforge-scene',version:1,name:'skink-stride-study',width:192,height:72,duration:3000,background:palette.v,assets:{skink:character.recipe,ground:soil},instances:[{asset:'ground',at:[0,48],frame:'a',repeat:[6,1]},{asset:'skink',at:[20,30],animation:'run',trajectory:[{time:0,at:[20,30]},{time:3000,at:[116,30]}]}]});
json('examples/quality/shale.json',rock);json('examples/quality/root-bank.json',soil);json('examples/quality/skink.poses.json',poses);json('examples/quality/skink.json',character.recipe);json('examples/quality/skink.meta.json',character.metadata);json('examples/quality/lantern.json',lamp);json('examples/quality/lantern-normal.json',normal);json('examples/quality/lantern-emissive.json',emissive);json('examples/quality/crystal.json',crystal);json('examples/quality/hollow.scene.json',scene);json('examples/quality/hollow-before.scene.json',blockoutScene);json('examples/quality/sedge.json',plume);
const compiledScene=prepareScene(scene), sceneImage=renderScene(compiledScene);
png('docs/images/quality/hollow.png',sceneImage,3);png('docs/images/quality/hollow-native.png',sceneImage);png('docs/images/quality/aftermath.png',renderScene(compiledScene,{time:2000}),3);
png('docs/images/quality/hollow-before.png',renderScene(prepareScene(blockoutScene)),3);
for(const [name,recipe] of [['fern-before',fernBase],['fern-after',correctedFern],['skink',character.recipe],['crystal',crystal]]){
 const rendered=renderProject(recipe); if(rendered.warnings.length)throw new Error(`${name}: ${rendered.warnings.join(' ')}`);
 const view=inspectProject(rendered,{scale:name==='skink'?4:6});png(`docs/images/quality/${name}.png`,view.sheet);
 if(name==='skink')png('docs/images/quality/skink-silhouette.png',inspectProject(rendered,{animation:'run',view:'silhouette',scale:4}).sheet);
}
const lampScene={...scene,name:'lantern-light-study',width:40,height:40,assets:{lantern:scene.assets.lantern},instances:[{asset:'lantern',at:[8,4],animation:'glow'}]};
for(const [name,x] of [['left',-10],['right',50]]){const light=structuredClone(lampScene);light.lighting.lights[0].at=[x,12];png(`docs/images/quality/lantern-${name}.png`,renderScene(prepareScene(light)),4);}
// A small replayable scene bundle is generated under output only on request; tracked art stays text-first.
const check=process.argv.includes('--check'),force=process.argv.includes('--force');
if(check){for(const [file,bytes] of files){if(!bytes.equals(await readFile(path.join(root,file))))throw new Error(`Generated asset differs: ${file}`);}console.log(`Verified ${files.size} deterministic quality-lab files.`);}
else{
 if(!force)for(const file of files.keys()){try{await access(path.join(root,file));}catch(e){if(e.code==='ENOENT')continue;throw e;}throw new Error(`Refusing to replace ${file}; use --force for an intentional rebuild.`);}
 for(const [file,bytes] of files){const target=path.join(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:force?'w':'wx'});}console.log(`Wrote ${files.size} quality-lab files.`);
}
