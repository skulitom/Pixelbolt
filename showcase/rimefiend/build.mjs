// Sculpt the body into palette-painted slices. Named paths bend each finger and its
// crystal nail together. Both wing webs follow the posed ribs at the shoulder sockets.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sinDeg, cosDeg } from '../../src/craft.js';
import { pathFrames } from '../../src/stack-paths.js';
import { formatJSON } from '../../src/export.js';

const palette = {
  '0':'#221b31','1':'#30233f','2':'#413151','3':'#533c66','4':'#654c79',
  '5':'#795a8b','6':'#9272a1','7':'#b092b3','8':'#d3afc5',
  K:'#393452', L:'#544767', M:'#726287', N:'#8b7b9b',
  k:'#201726', b:'#4a2438', r:'#652a40', o:'#843247', v:'#a14552', p:'#753044',
  d:'#31242f', e:'#503447', f:'#6e4854', l:'#ab7180',
  t:'#473238', g:'#87583e', a:'#be8655', y:'#efbd75', w:'#ffdfac',
  m:'#260f20', j:'#6e3344', i:'#b45d6c', E:'#ffae36', Q:'#fff3af',
  A:'#24598a97',B:'#366c9aab',C:'#419ba99a',D:'#65c9c780',
  F:'#9ce4d78b',G:'#ccfbe4ce',H:'#8cb8e3aa',I:'#5c80b687'
};
const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(p,k)=>p.map(v=>v*k), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=([x,y,z],[u,v,w])=>[y*w-z*v,z*u-x*w,x*v-y*u];
const unit=p=>scale(p,1/Math.sqrt(dot(p,p)));
const mix=(a,b,t)=>add(scale(a,1-t),scale(b,t));
const average=pts=>scale(pts.reduce(add,[0,0,0]),1/pts.length);
const round=p=>p.map(n=>+n.toFixed(3));
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
const light=unit([-.57,.54,.76]);
const width=52, depth=30, height=51, origin=[25.5,9.5,0];
const facets=[], contours={}, lofts=[];
const wings={}, paths={}, membranes=[];
const poses={open:{},half:{},curled:{},folded:{}};
function face(points,color,socket='body',twoSided=false) {
  facets.push({socket,color,points:points.map(round),...(twoSided && {twoSided})});
}
function shade(normal,ramp) {
  return ramp[clamp(Math.floor((dot(normal,light)*.48+.52)*ramp.length),0,ramp.length-1)];
}
function skin(points,inside,material,socket) {
  let normal=cross(sub(points[1],points[0]),sub(points[2],points[0]));
  if (dot(normal,normal)<.000001) return;
  if (dot(normal,sub(average(points),inside))<0) { points=[...points].reverse(); normal=scale(normal,-1); }
  face(points,material.length===1?material:shade(unit(normal),material),socket);
}
// Use a continuous ring along a curved tendon, wing bone or crystal. The facet bands
// on a crystal run from root to point and stay attached when the light side turns away.
function sweep(nodes,material,{sides=7,socket='body',phase=0,glass=false}={}) {
  const axis=unit(sub(nodes.at(-1).slice(0,3),nodes[0].slice(0,3)));
  const ref=Math.abs(axis[0])<.8?[1,0,0]:[0,1,0];
  const rings=nodes.map((node,k)=>{
    const tangent=unit(sub(nodes[Math.min(k+1,nodes.length-1)].slice(0,3),nodes[Math.max(0,k-1)].slice(0,3)));
    const u=unit(sub(ref,scale(tangent,dot(ref,tangent)))),v=cross(tangent,u);
    return Array.from({length:sides},(_,i)=>add(node.slice(0,3),add(scale(u,node[3]*cosDeg(phase+360*i/sides)),scale(v,(node[4]??node[3])*sinDeg(phase+360*i/sides)))));
  });
  skin(rings[0],nodes[1].slice(0,3),material,socket);
  for(let k=1;k<nodes.length;k++) {
    const centre=mix(nodes[k-1].slice(0,3),nodes[k].slice(0,3),.5);
    for(let i=0;i<sides;i++) {
      const j=(i+1)%sides;
      skin([rings[k-1][i],rings[k-1][j],rings[k][j],rings[k][i]],centre,glass?material[i%material.length]:material,socket);
    }
  }
  if(nodes.at(-1)[3]>.05) skin(rings.at(-1),nodes.at(-2).slice(0,3),material,socket);
}
const crystal=(nodes,opts={})=>sweep(nodes,'CGFDABI',{sides:7,glass:true,...opts});

// Implicit ellipsoids are blended into a single silhouette. Each muscle has its own
// longitudinal axis; the shared density gradient gives connected clusters of flesh tones.
const masses=[];
function mass(center,axes,radii) {
  const ext=[0,1,2].map(i=>Math.sqrt(axes.reduce((s,a,k)=>s+(a[i]*radii[k])**2,0))+3);
  masses.push({center,axes,radii,ext});
}
function oval(x,y,z,rx,ry,rz,tilt=0) {
  mass([x,y,z],[[cosDeg(tilt),0,sinDeg(tilt)],[0,1,0],[-sinDeg(tilt),0,cosDeg(tilt)]],[rx,ry,rz]);
}
function muscle(a,b,rx,ry,extend=.8) {
  const d=sub(b,a),axis=unit(d), ref=Math.abs(axis[0])<.84?[1,0,0]:[0,1,0];
  const u=unit(sub(ref,scale(axis,dot(ref,axis))));
  mass(mix(a,b,.5),[u,cross(axis,u),axis],[rx,ry,Math.sqrt(dot(d,d))/2+extend]);
}
// Pelvis, flared rib cage, projecting pectorals and a recessed line between the rectus muscles.
oval(0,-.6,22,6.8,4.0,4.4); oval(0,-.8,28,5.7,3.9,7.7);
oval(0,-1.4,35.8,9.6,4.7,7.7); oval(0,-.9,39.1,10.7,4.7,4);
oval(0,2,42.7,4.1,3.5,4.1);
for(const s of [-1,1]) {
  oval(s*5,3.0,38.4,5.8,3.4,3.45,s*13);
  muscle([s*3.9,-.1,43.7],[s*11,-1,40.6],2.75,3.25,1.2);
  muscle([s*8.7,-2.9,38.5],[s*4.2,-2.6,28.4],3.0,2.7);
  muscle([s*9.2,-3.7,41],[s*3.15,-5,34.4],2.8,1.6);
  muscle([s*7.3,1.5,34.2],[s*4.6,2.7,27.5],2.0,1.45);
  for(const [z,w,ry] of [[33.9,2.46,1.9],[30.75,2.3,1.76],[27.85,2.0,1.56]]) oval(s*(w-.18),3.5,z,w,ry,1.9,s*9);
  muscle([s*1.55,-4.27,37.5],[s*1.65,-3.65,24],1.2,1.03);
}
// Staggered digitigrade legs. Set the weight over the forward foot; let the back hock sweep away.
const feet=[];
for(const s of [-1,1]) {
  const step=s===1?3:-2, hip=[s*4.2,-.6,22], knee=[s*7,2.8+step,13],
    hock=[s*8.2,-3.6+step,6.05], ankle=[s*9.2,.35+step,2.45];
  muscle(hip,knee,3.85,3.65,1.8); muscle([s*5.7,1.16,21.4],knee,2.55,2.45);
  oval(...knee,2.85,2.85,2.95); muscle(knee,hock,2.45,2.55,1.35);
  muscle(hock,ankle,1.68,1.65,1); oval(ankle[0],ankle[1]+1.2,1.65,2.95,3.6,1.6);
  feet.push([ankle[0],ankle[1]+2.4,1.6]);
}
// The arms have different rhythms: the closed hand drops below the belt, the open hand reaches out.
for(const s of [-1,1]) {
  const reach=s===1, shoulder=[s*11.1,-.25,40.9], elbow=[s*(reach?16.3:18.5),reach?1.5:1.3,reach?33.7:31.5],
    wrist=[s*(reach?19:20.1),reach?12.1:6.5,reach?33.3:23.2];
  oval(...shoulder,4.7,4.6,5,s*-20); muscle(shoulder,elbow,3.55,3.7,1.3);
  muscle([s*12.3,1.1,40.7],[elbow[0]-.25*s,elbow[1]+1.5,elbow[2]+1.25],2.6,2.75);
  oval(...elbow,2.85,2.7,2.9); muscle(elbow,wrist,2.95,2.8,1.25);
  muscle([elbow[0]+s,elbow[1],elbow[2]+.9],[wrist[0]+s*.8,wrist[1],wrist[2]],1.55,1.72);
  oval(...wrist,2.05,2.15,2.35);
}

const field=new Float32Array(width*depth*height).fill(5);
const at=(x,y,z)=>(z*depth+y)*width+x;
for(const {center,axes,radii,ext} of masses) {
  const c=add(center,origin), low=c.map((n,i)=>Math.max(0,Math.floor(n-ext[i]-.5))), dims=[width,depth,height];
  const high=c.map((n,i)=>Math.min(dims[i]-1,Math.ceil(n+ext[i]-.5)));
  for(let z=low[2];z<=high[2];z++) for(let y=low[1];y<=high[1];y++) for(let x=low[0];x<=high[0];x++) {
    const dx=x+.5-c[0],dy=y+.5-c[1],dz=z+.5-c[2];
    const q=axes.map((a,k)=>(a[0]*dx+a[1]*dy+a[2]*dz)/radii[k]);
    const distance=(Math.sqrt(dot(q,q))-1)*Math.min(...radii), index=at(x,y,z), prev=field[index];
    const blend=Math.max(.82-Math.abs(distance-prev),0);
    field[index]=Math.min(distance,prev)-blend*blend/(4*.82);
  }
}
const sample=(x,y,z)=>x<0||x>=width||y<0||y>=depth||z<0||z>=height?4:field[at(x,y,z)];
const slices=Array.from({length:height},(_,z)=>Array.from({length:depth},(_,y)=>{
  let row='';
  for(let x=0;x<width;x++) {
    if(sample(x,y,z)>0) { row+='.'; continue; }
    const gradient=[sample(x+1,y,z)-sample(x-1,y,z),sample(x,y+1,z)-sample(x,y-1,z),sample(x,y,z+1)-sample(x,y,z-1)];
    const norm=Math.sqrt(dot(gradient,gradient))||1;
    const occlusion=(sample(x-2,y+2,z+3)<0?.14:0)+(sample(x-4,y+4,z+6)<0?.1:0);
    const direct=dot(gradient,light)/norm;
    const bounce=dot(gradient,[.46,-.86,.2])/norm;
    const lit=.47+.43*direct-occlusion*.76;
    const dorsalLight=clamp((bounce-.22)*1.15,0,1);
    const fill=clamp(.24+.32*dorsalLight+.1*gradient[2]/norm-occlusion*.25,0,1);
    row+=fill>lit&&dorsalLight>.1
      ? '01K2L3M4N'[clamp(Math.floor(fill*9),0,8)]
      : '012345678'[clamp(Math.floor(lit*9),0,8)];
  }
  return row;
}));

// A horizontal head section has a broad facial plane, tucked temples, and a deeper cranium.
const skull=[[41.8,2.4,8.5,3.5],[43.5,3.9,10.0,2.5],[46.2,5.35,10.2,1.7],
  [48.65,5.65,9.65,1.4],[51.2,4.85,8.25,1.6],[53.05,3.05,6.88,2.25],[53.6,1.2,5.6,3.58]];
const sections=skull.map(([z,r,front,back])=>[[-.54,1],[.54,1],[.89,.82],[1,.48],[.84,.17],[.45,0],[-.45,0],[-.84,.17],[-1,.48],[-.89,.82]].map(([x,y])=>[x*r,back+(front-back)*y,z]));
for(let k=1;k<sections.length;k++) {
  const lo=sections[k-1],hi=sections[k],center=mix(average(lo),average(hi),.5);
  for(let i=0;i<lo.length;i++) { const j=(i+1)%lo.length;skin([lo[i],lo[j],hi[j],hi[i]],center,'1234567'); }
}
skin(sections.at(-1),average(sections.at(-2)),'6');
function relief(outline,apex,ramp) {
  for(let i=0;i<outline.length;i++) skin([outline[i],outline[(i+1)%outline.length],apex],[apex[0],apex[1]-5,apex[2]],ramp);
}
function mark(points,color) { face(points,color,'body',true); }
for(const s of [-1,1]) {
  const side=p=>p.map(([x,y,z])=>[s*x,y,z]);
  relief(side([[3.95,5.35,49.65],[8.2,2.5,51.3],[6.95,3.8,47.9],[4.43,5.95,46.85]]),[s*5.7,6.05,48.9],'12456');
  mark(side([[5.12,6.1,49.25],[7.4,3.48,50.52],[5.93,5.65,48.3]]),'2');
  // Crown ridges run inwards from the horn sockets and converge on the scowl.
  relief(side([[.12,6.39,53.43],[2.22,5.66,53.48],[3.74,5.82,52.47],[3.04,8.07,51.34],[.44,9.18,50.42]]),[s*1.7,8.52,52.44],'23456');
  mark(side([[.34,7.48,53.13],[1.12,8.14,52.49],[.9,8.78,51.76],[.4,9.08,51.1],[.75,8.23,52.3]]),'3');
  mark(side([[1.52,8.29,52.79],[2.75,7.45,52.87],[2.24,8.19,52.4]]),'7');
  relief(side([[3.38,4.15,51.28],[4.31,3.62,52.54],[5.42,4.42,52.78],[4.34,6.32,51.84],[3.42,7.42,51.15]]),[s*4.25,5.61,52.65],'23456');
  relief(side([[3.9,8.7,46.63],[5.08,7.2,46.88],[5.01,6.23,44.62],[3.37,8.94,43.04],[2.15,10.04,42.94],[3.0,10.16,44.37]]),[s*4.25,9.18,45.21],'123456');
  // A brow ledge casts a painted dark underside onto an inset, amber eye.
  // The lateral end turns back along the temple instead of ending on the front plane.
  const draw=(points,c)=>mark(side(points),c);
  const raised=(points,peak,ramp)=>relief(side(points),[s*peak[0],peak[1],peak[2]],ramp);
  raised([[.46,10.25,48.77],[1.06,9.6,50.44],[3.46,8.02,51.01],[5.12,6.21,50.55],[5.52,6.87,49.5],[4.32,9.1,49.35],[1.23,11.15,48.51]],
         [2.41,11.45,50.1],'2345678');
  // Zygomatic arch sweeps outward and back to the hinge of the jaw.
  raised([[1.65,10.34,47.69],[3.65,9.78,48.32],[5.32,7.15,49.03],[5.73,5.7,48.25],[5.76,6.33,46.6],[4.29,9.46,45.77],[3.34,10.62,45.97]],
         [4.38,10.85,47.51],'1234567');
  raised([[3.78,9.89,46.54],[5.58,7.45,47.41],[5.36,6.84,45.41],[4.5,7.97,43.7],[3.94,9.84,43.43],[3.89,10.65,44.77]],
         [4.83,9.63,45.42],'12345');
  // The rim, concha and tragus form a folded ear with thickness in profile.
  raised([[4.08,5.11,48.73],[5.63,3.95,50.12],[8.37,.18,50.78],[7.76,.77,48.91],[6.48,2.38,47.35],[5.16,4.51,46.67]],
         [6.76,3.84,49.01],'345667');
  draw([[5.37,4.88,48.95],[6.42,3.89,49.52],[8.04,.87,50.25],[7.03,2.66,48.43],[5.82,4.53,47.51]],'2');
  draw([[5.42,4.93,48.85],[6.49,4.03,49.32],[7.5,2.11,49.7],[6.27,4.14,48.91]],'6');
  raised([[5.72,4.75,48.62],[6.37,4.25,48.58],[5.88,4.72,47.57],[5.38,4.94,47.17]],
         [6.08,5.35,48.18],'33456');
  // Far end of the jaw has a masseter muscle under the cheekbone.
  raised([[5.12,7.65,47.1],[5.63,6.04,47.29],[5.54,4.64,46.35],[4.83,4.85,43.02],[4.05,7.11,42],[4.36,9.17,43.85]],
         [5.72,6.57,44.81],'223456');
  draw([[5.62,6.15,46.62],[5.89,6.57,45.91],[5.48,7.42,44.38],[5.61,6.89,45.65]],'3');
  // Flaring nostril wings sit forward of the cheek; the black opening is on
  // the front/side plane and the warm lip catches a two-pixel highlight.
  raised([[.32,12.04,47.53],[1.1,11.48,48.03],[1.96,10.67,47.62],[2.31,10.77,46.75],[1.78,11.83,46.44],[.67,12.49,46.55]],
         [1.45,13.02,47.2],'234567');
  draw([[.79,12.74,46.92],[1.45,13.06,47.15],[1.98,12.25,47.13],[1.72,12.45,46.62],[1.09,12.75,46.55]],'k');
  draw([[0,12.3,43.01],[1.61,12.12,43.17],[2.34,11.96,43.48],[.54,11.92,43.62],[0,11.95,43.48]],'i');
  // A round base and hooked tip let the canine read against the lips even edge-on.
  const tooth=(x,y,z,length,radius)=>{
    const tip=[s*(x-.28),y+.35,z-length];
    const vertices=Array.from({length:5},(_,i)=>[s*(x+radius*cosDeg(i*72)),y+.83*radius*sinDeg(i*72),z]);
    for(let i=0;i<5;i++) mark([vertices[i],vertices[(i+1)%5],tip],['y','w','w','a','g'][s>0?i:4-i]);
  };
  tooth(2.7,12.38,46.03,2.52,.65);
  tooth(1.39,12.69,45.8,.76,.37);
  tooth(.45,12.62,45.82,.64,.39);
  tooth(3.62,11.55,46.03,.76,.38);
  // A curled lower lip leaves a dark break above the angular chin pad.
  draw([[.12,12.52,42.68],[1.24,12.59,42.81],[2.38,12.17,43.19],[2.13,12.38,42.75],[.73,12.71,42.41]],'l');
  raised([[.13,12.42,42.19],[1.73,12.14,42.44],[2.72,11.24,42.11],[1.62,11.82,40.69],[.19,12.05,40.67]],
         [1.09,13,41.59],'234566');
  draw([[.04,12.56,41.97],[.29,12.75,41.71],[.17,12.42,41.03]],'2');
  tooth(3.15,11.49,43.61,-1.56,.50);
  tooth(1.55,12.13,43.05,-.64,.34);
}
relief([[-.48,10.34,49.62],[.48,10.34,49.62],[1.16,11.85,47.59],[.68,13.11,46.89],[-.67,13.09,46.89],[-1.16,11.85,47.59]],
       [0,13.5,47.46],'234568');

// Matching landmarks travel from the centreline to the mouth corner. The gum
// and the adjoining front wall of the muzzle share the same upper lip.
contours.snout=[[0,12.05,46.87],[1.18,11.88,46.76],[2.37,11.43,46.68],[3.46,10.68,46.69],[4.32,9.4,46.92],[4.95,7.81,46.98]];
contours.upperLip=[[0,13.03,46.14],[1.17,13.12,46.09],[2.36,12.76,46.27],[3.48,12.03,46.29],[4.6,10.39,46.59],[5.24,7.8,46.8]];
contours.gum=contours.upperLip.map(([x,y,z],i)=>[x,y-.12,z-[.34,.39,.53,.49,.34,.12][i]]);
contours.lowerLip=[[0,12.36,42.7],[1.18,12.42,42.84],[2.42,11.97,43.26],[3.59,11.08,43.75],[4.65,9.9,44.77],[5.24,7.8,46.52]];
contours.throat=contours.lowerLip.map(([x,y,z],i)=>[x,y-[1.29,1.29,1.17,.93,.52,.12][i],z+[1.02,.98,.86,.66,.42,.12][i]]);
contours.jawRidge=[[0,12.32,41.73],[1.23,12.17,41.78],[2.55,11.49,42.04],[3.72,10.44,42.71],[4.85,8.62,43.87],[5.1,6.37,45.64]];
contours.jawBase=[[0,10.83,40.32],[1.19,10.83,40.49],[2.42,10.38,40.88],[3.61,9.34,41.78],[4.48,7.64,43.54],[4.64,6.05,45.31]];
contours.underChin=[[0,8.45,41.72],[1.2,8.4,41.61],[2.4,8.06,41.94],[3.47,7.18,42.76],[4.2,6.17,44],[4.4,5.17,45.4]];
lofts.push({socket:'body',mirror:'x',twoSided:true,
  contours:['snout','upperLip','gum','throat','lowerLip','jawRidge','jawBase','underChin'],
  bands:['66554','jijj2','m','jjmm1','55543','34332','22111']});

// Stations run from the tear duct around the eye to the temple. The outer
// rim projects sideways. Both rims sit proud of the amber iris.
const orbit=[
  [.82,10.85,48.18,.12,0],[1.48,10.97,48.33,.44,10],[2.26,10.85,48.48,.55,16],
  [2.53,10.83,48.63,.66,22],[3.30,10.43,48.79,.76,28],[3.97,10.17,48.91,.69,38],
  [4.87,9.46,48.91,.58,52],[5.64,8.13,48.96,.50,70],[5.93,6.97,49.04,.34,83],[6.1,5.97,49.16,0,90]
];
function lidContour(height,offset,lift) {
  return orbit.map(([x,y,z,half,angle])=>{
    const taper=Math.min(1,half/.52);
    return round([x+taper*offset*sinDeg(angle),y+taper*offset*cosDeg(angle),z+height*half+taper*lift]);
  });
}
contours.browFold=lidContour(1,-.27,.95);
contours.upperLid=lidContour(1,.44,.32);
contours.upperLash=lidContour(1,.38,-.07);
contours.irisTop=lidContour(1,.03,-.12);
contours.irisMiddle=lidContour(0,.09,.06);
contours.irisBottom=lidContour(-1,0,.08);
contours.lidWaterline=lidContour(-1,.25,-.04);
contours.lowerLid=lidContour(-1,.40,-.27);
contours.cheekFold=lidContour(-1,-.27,-.75);
lofts.push({socket:'body',mirror:'x',twoSided:true,
  contours:['browFold','upperLid','upperLash','irisTop','irisMiddle','irisBottom','lidWaterline','lowerLid','cheekFold'],
  bands:['567766544','332222323','k','aEQkEEya3','aEEkEEag2','211212323','455676554','334443332']});
for(const s of [-1,1]) {
  const side=nodes=>nodes.map(([x,y,z,...rest])=>[s*x,y,z,...rest]);
  sweep(side([[3.14,4.72,50.65,2.64],[4.48,4.25,52.4,2.22]]),'23456',{sides:8});
  crystal(side([[3.92,4.52,51.5,2.48],[5.98,3.94,53.2,2.34],[7.74,2.48,55.26,1.96],[8.32,.36,57.66,1.52],[7.77,-1.22,59.68,1.04],[5.7,-2.48,61.12,.015]]),{phase:17});
  crystal(side([[4.25,2.7,49.6,1.52],[6.5,1.25,50.53,1.3],[8.55,-.1,52.03,.82],[9.7,-1.7,54.05,.02]]),{phase:3});
}

// At the outer corner the two lids meet. A short raised fold runs back into
// the temple, giving the hood a readable end in both side views.
contours.templeFold=[[5.86,7.59,49.54],[6.1,6.47,49.57],[6.20,5.49,49.5],[5.98,4.75,49.49]];
contours.templeRidge=[[6.04,7.53,49.29],[6.22,6.48,49.34],[6.35,5.49,49.32],[5.98,4.75,49.49]];
contours.templeCrease=[[6.01,7.50,49.09],[6.18,6.46,49.09],[6.31,5.47,49.14],[5.98,4.75,49.49]];
lofts.push({socket:'body',mirror:'x',twoSided:true,contours:['templeFold','templeRidge','templeCrease'],bands:['655','232']});

// Five separate rays of the outstretched hand, with softer flesh up to the nail bed.
function talon(name, finger, nail, radius) {
  const centres=finger.map(p=>p.slice(0,3)), tip=centres.at(-1), tipAxes=pathFrames(centres).at(-1);
  paths[name]={socket:'body',colors:'4566542',sides:7,nodes:finger.map(([x,y,z,r],i)=>({
    name:['knuckle','middle','tip'][i],at:[x,y,z],radius:r,axis:[1,0,.57]
  }))};
  paths[name+'-nail']={attach:name,colors:name==='index'?'CGFDCHB':'CGFDABI',sides:7,roll:name==='index'?145:22,nodes:[
    {name:'bed',at:[0,0,0],radius},
    ...nail.map(([x,y,z,r],i)=>({name:'facet-'+i,at:tipAxes.map(axis=>dot(sub([x,y,z],tip),axis)),radius:r}))
  ]};
}
poses.half.index={knuckle:-20,middle:-29,tip:-15};
poses.curled.index={knuckle:-41,middle:-72,tip:-54};
sweep([[19,12,33,2.1,1.75],[20.2,13.3,34.3,2.9,1.8],[21,14.65,36.1,3.65,1.65],[21.1,15.4,36.95,3.3,1.18]],'1234567',{sides:9});
talon('index',[[18.52,15.2,36.55,1.1],[16.74,16.15,39.2,1.1],[14.94,17.65,41.63,.91]],[[13.57,18.55,43.47,1.0],[12.23,19.4,44.61,.62],[10.95,20.8,44.02,.02]],1.11);
talon('middle',[[20.1,15.6,36.85,1.19],[20.02,16.81,40.15,1.14],[19.56,18.49,43.22,.96]],[[19.6,19.71,45.53,1.04],[19.3,20.65,47.13,.61],[18.64,22.58,46.96,.02]],1.19);
talon('ring',[[22.37,15.48,36.7,1.12],[23.63,16.6,39.59,1.09],[25.04,17.92,41.9,.92]],[[26.7,18.83,43.53,1],[28.16,19.65,44.45,.61],[29.12,21.1,44.02,.02]],1.13);
talon('little',[[24.12,14.65,36.5,.99],[26.5,15.18,38.16,1.0],[28.57,16.47,39.24,.78]],[[30.37,17.47,40.28,.84],[31.68,18.8,40.46,.55],[32.39,20.31,39.66,.02]],.99);
talon('thumb',[[18.95,13.8,34.85,1.4],[16.8,14.85,33.98,1.26],[15.1,16.45,33.4,1.0]],[[13.66,17.15,33.22,.98],[12.6,18.56,33.65,.66],[12.18,20.25,34.84,.02]],1.17);

// Dropped hand: knuckles first, then the finger pads fold back towards the palm.
sweep([[-20.15,6.2,23.58,2.05,1.65],[-20.85,7.2,21.33,2.72,1.7],[-21.48,7.96,19.27,2.4,1.25]],'1234567',{sides:8});
for(const [i,dx] of [-1.91,-.65,.65,1.87].entries()) {
  const x=-21.4+dx,z=18.96+Math.abs(dx)*.2;
  talon('hanging-'+i,[[x,7.8,z+.65,.84],[x-.55,8.82,z-.92,.82],[x-.4,9.34,z-2.15+(i===0?.7:0),.63]],
    [[x-.04,9.96,z-2.62,.54],[x+.56,10.36,z-1.48,.02]],.73);
}
talon('hanging-thumb',[[-18.8,7.48,21.2,1.1],[-18.15,9.05,19.95,.93],[-18.24,10.25,18.94,.68]],[[-18.63,11.25,18.49,.59],[-19.53,11.48,19.11,.02]],.79);
for(const [x,y,z] of feet) for(const off of [-1.63,0,1.63]) {
  const middle=off===0?.72:0;
  talon('toe-'+(x<0?'left':'right')+'-'+(off<0?'inner':off>0?'outer':'middle'),[[x+off*.73,y-.76,z+.18,1.26],[x+off,y+.79,z-.02,1.14],[x+off*1.42,y+2.03+middle,z-.19,.83]],
    [[x+off*1.57,y+3.12+middle,z-.33,.68],[x+off*1.75,y+4.28+middle,.38,.018]],.88);
}

// Each membrane hangs between two curved ribs. The high midpoint of its free
// edge gives the trailing silhouette a scallop; the interior folds back in depth.
for(const s of [-1,1]) {
  const socket=s===1?'wing-right':'wing-left',root=[s*5.6,-4.0,36.1];
  wings[socket]={at:add(origin,root),axis:'y',keys:[[0,0],[90,s*6],[180,0],[270,-s*6],[360,0]].map(([heading,angle])=>({heading,angle}))};
  const loc=([x,y,z,...r])=>[s*x-root[0],y-root[1],z-root[2],...r];
  const wrist=[19,-8.2,54.5];
  const ribs=[
    [wrist,[25.8,-8.9,55.9],[31.2,-9.35,53.3],[36.7,-9.1,48.4]],
    [wrist,[24.1,-11.7,50.5],[28.75,-14.4,43.6],[32.7,-15.65,36.25]],
    [wrist,[21.9,-12.2,47.9],[23.4,-15.9,39.45],[24.5,-17.15,30.75]],
    [wrist,[17.65,-12.9,47.35],[16.85,-15.7,38.3],[15.25,-16.1,29.45]],
    [wrist,[13.6,-9.45,47.1],[9.4,-7.35,41.25],[5.6,-4.0,36.1]]];
  const names=ribs.map((rib,i)=>{
    const name=socket+'-rib-'+i;
    const radii=i===0?[1.43,1.04,.69,.10]:i===4?[1.5,1.75,2.03,2.17]:[.94,.68,.48,.10];
    paths[name]={socket,sides:5,colors:i===0||i===4?'34543':'broor',
      nodes:rib.map((p,k)=>({name:['wrist','joint','bend','end'][k],at:loc(p),radius:radii[k],axis:[0,s,0]}))};
    if(i<4) poses.folded[name]={wrist:[26,17,8,3][i],joint:[15,11,6,2][i]};
    return name;
  });
  for(let i=1;i<names.length;i++) membranes.push({
    ribs:[names[i-1],names[i]],colors:'roorb',sag:-1.45,scallop:4.35,
    veins:[{color:'p',points:[[.35,.04,.012],[.53,.19,.022],[.70,.32,.012],[.85,.39,.002]]},
      {color:'p',points:[[.58,.22,.01],[.71,.28,.014],[.85,.29,.002]]}]
  });
  // A skin cuff and a crystalline wing thumb share the same wrist pivot.
  sweep([[18.4,-8.15,53.5,1.74],[19.1,-8.0,54.8,1.35]].map(loc),'23456',{sides:7,socket});
  crystal([[19.0,-8.05,54.4,1.28],[19.45,-7.75,55.83,1.04],[20.33,-7.02,57.12,.66],[21.55,-6.4,57.6,.02]].map(loc),{socket,phase:11});
}

// A folded oxblood tabard hangs through the belt in front and at the back.
for(const dir of [-1,1]) {
  const strips=[-1,-.53,0,.49,1], shadeRow=dir===1?['f','e','d','e']:['e','d','e','f'];
  const cloth=(row,i)=>{
    const t=strips[i], x=t*[4.3,3.85,3.23][row]-[0,.28,.65][row];
    const z=[23.72,18.45,[13.3,11.5,12.15,10.78,13.65][i]][row];
    const y=dir*([4.68,5.18,5.61][row]-.66*t*t+[.05,.35,.42][row]*(i%2))-.4;
    return [x,y,z+(dir<0&&row===2?1.4:0)];
  };
  for(let row=0;row<2;row++) for(let i=0;i<4;i++) mark([cloth(row,i),cloth(row,i+1),cloth(row+1,i+1),cloth(row+1,i)],shadeRow[i]);
}
const beltPoint=(k,z,rx,ry)=>[rx*cosDeg(k*22.5),-.35+ry*sinDeg(k*22.5),z-.75*sinDeg(k*22.5)];
for(let i=0;i<16;i++) {
  const next=i+1;
  for(const [lo,hi,rx,ry,colors] of [[23.33,23.75,6.95,4.97,'gatt'],[23.75,25.05,6.91,4.9,'edef'],[25.05,25.48,6.93,4.95,'aggt']]) {
    const p=[beltPoint(i,lo,rx,ry),beltPoint(next,lo,rx,ry),beltPoint(next,hi,rx,ry),beltPoint(i,hi,rx,ry)];
    skin(p,[0,-.35,(lo+hi)/2],colors);
  }
}
relief([[-1.98,4.57,24.27],[-1.17,4.86,25.05],[1.21,4.86,25.05],[2,4.57,24.27],[1.3,4.79,23.26],[0,4.99,22.54],[-1.37,4.77,23.25]],[0,5.52,24.13],'tgayw');
mark([[-.58,5.39,24.29],[0,5.58,24.55],[.57,5.39,24.29],[0,5.57,23.73]],'t');

// The metal embroidery and the small folds follow the cloth from waist to hem.
for(const s of [-1,1]) {
  mark([[s*3.81,4.03,22.54],[s*3.59,4.27,22.48],[s*2.81-.45,4.96,14.27],[s*3.02-.45,4.84,14.64]],'g');
  mark([[s*2.31,4.75,20.81],[s*.98-.22,5.29,19.82],[-.22,5.28,20.04],[s*.79-.22,5.35,19.1]],'a');
  mark([[s*1.72-.26,4.99,18.92],[s*.85-.28,5.38,18.37],[-.32,5.37,18.66],[s*.63-.32,5.41,17.85]],'g');
}

// Trace scars and the vertebral ridge on the actual voxel surface so the marks
// follow the skin as it turns. Sample only the local muscle to keep the wing roots free.
function surfaceY(x,z,dir) {
  const gx=Math.round(x+origin[0]-.5), gz=Math.floor(z);
  for(let n=0;n<depth;n++) {
    const iy=dir===1?depth-1-n:n;
    if(sample(gx,iy,gz)<=0) return iy+(dir===1?1:0)-origin[1]+dir*.14;
  }
  throw Error('Surface mark outside sculpt');
}
function skinStripe(path,dir,color) {
  for(let i=1;i<path.length;i++) {
    const panel=[path[i-1],path[i]].flatMap(([x,z,w],k)=>[k===0?-1:1,k===0?1:-1].map(s=>{
      const y=surfaceY(x+s*w,z,dir);
      return [x+s*w,y,z];
    }));
    mark(panel,color);
  }
}
for(const [dx,dz] of [[0,0],[1.53,-.36]]) {
  skinStripe([[-11.66+dx,44.12+dz,.08],[-12.33+dx,43.35+dz,.31],[-12.87+dx,42.18+dz,.23],[-13.86+dx,40.74+dz,.02]],1,'5');
  skinStripe([[-11.68+dx,44.12+dz,.04],[-12.5+dx,43.35+dz,.10],[-13.02+dx,42.18+dz,.11],[-13.88+dx,40.74+dz,.02]],1,'7');
}
for(const z of [42,39.45,36.9,34.35,31.8,29.25,26.85]) {
  const top=surfaceY(0,z,-1), below=surfaceY(0,z-1.4,-1), w=(z>34?1.13:.87);
  const shoulder=[0,top-.67,z-.28];
  const edge=[[-w,top+.1,z-.52],[-.55*w,top+.1,z+.48],[.55*w,top+.1,z+.48],[w,top+.1,z-.52],[0,below-.06,z-1.54]];
  for(let i=0;i<edge.length;i++) mark([edge[i],edge[(i+1)%edge.length],shoulder],['3','M','L','2','K'][i]);
}

const source={format:'pixelforge-stack',version:1,name:'rimefiend',projection:'iso',resolution:3,
  pivot:[25,9],headings:Array.from({length:60},(_,i)=>(297+6*i)%360),duration:70,palette,slices,
  sockets:{body:{at:origin},...wings},facets,contours,lofts,paths,membranes,poses,
  poseKeys:[[0,'curled'],[60,'half'],[120,'open'],[180,'folded'],[240,'open'],[297,'open'],[330,'half'],[360,'curled']]
    .map(([heading,pose])=>({heading,pose}))};
if (!process.argv[2]) throw Error('Supply a new .stack.json filename.');
await mkdir(dirname(process.argv[2]),{recursive:true});
await writeFile(process.argv[2],formatJSON(source,160),{flag:'wx'});
