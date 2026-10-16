import {planChipThrow} from './chip-throws.js';
import * as THREE from '/vendor/three/three.module.js';
import {ChipPhysics} from './chip-physics.js';
import {playChipSound} from './chip-sound.js';

// All materials are generated locally. The table needs no image downloads or CDN.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const palette = {1:['#e3dcc2','#76694b'],5:['#a74035','#f0dfbf'],25:['#315f81','#e5e6d2'],100:['#252d2b','#e3d3a5']};
const surfaces = new Map();
const chipMaterials = new Map();
// Keep the round mesh inside the flat facets of the 12-sided collider.
// Both the face and its rim need clearance to avoid z-fighting at contact.
const visualRadius=.47*Math.cos(Math.PI/12)-.002;
const sharedGeometry = new THREE.CylinderGeometry(visualRadius,visualRadius,.08,48);
const edgeGeometry = new THREE.TorusGeometry(visualRadius-.012,.0035,6,48);
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0,1,0),0);
const ndc = new THREE.Vector2();
let hostView, phoneView;

function canvasTexture(width,height,paint){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  paint(canvas.getContext('2d'),width,height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;return texture;
}
let seed=98273;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function material(kind){
  if(surfaces.has(kind))return surfaces.get(kind);
  let result;
  if(kind==='felt'){
    const map=canvasTexture(512,512,(ctx,w,h)=>{
      ctx.fillStyle='#214a38';ctx.fillRect(0,0,w,h);
      for(let i=0;i<75000;i++){
        const shade=random()>.5?'#739466':'#092f22';
        ctx.globalAlpha=.025+random()*.035;ctx.fillStyle=shade;
        const x=random()*w,y=random()*h;ctx.fillRect(x,y,random()*2+.5,random()*2+.5);
      }
      ctx.globalAlpha=.015;ctx.strokeStyle='#adc199';
      for(let x=0;x<w;x+=3){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    });
    const bump=canvasTexture(256,256,(ctx,w,h)=>{
      const data=ctx.createImageData(w,h);
      for(let i=0;i<data.data.length;i+=4){const n=90+Math.floor(random()*100);data.data[i]=data.data[i+1]=data.data[i+2]=n;data.data[i+3]=255;}
      ctx.putImageData(data,0,0);
    });
    bump.colorSpace=THREE.NoColorSpace;bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.repeat.set(16,16);
    result=new THREE.MeshStandardMaterial({map,bumpMap:bump,bumpScale:.007,roughness:.98,color:'#e2e8db'});
  }else if(kind==='wood'){
    const map=canvasTexture(1024,512,(ctx,w,h)=>{
      const data=ctx.createImageData(w,h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const bend=Math.sin(x*.009)*8+Math.sin(x*.025+y*.013)*3;
        const grain=Math.sin((y+bend)*.48)*9+Math.sin((y+bend)*2.7)*3;
        const wash=Math.sin(y*.029)*12+Math.sin(x*.005)*5+(random()-.5)*7;
        const i=(y*w+x)*4;data.data[i]=78+grain+wash;data.data[i+1]=49+grain*.65+wash*.7;data.data[i+2]=31+grain*.4+wash*.5;data.data[i+3]=255;
      }
      ctx.putImageData(data,0,0);
    });
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(.22,.28);
    result=new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.008,roughness:.42,metalness:.035});
  }else if(kind==='leather'){
    const bump=canvasTexture(256,256,(ctx,w,h)=>{
      ctx.fillStyle='#777';ctx.fillRect(0,0,w,h);
      for(let i=0;i<16000;i++){ctx.fillStyle=random()>.5?'#555':'#aaa';ctx.beginPath();ctx.arc(random()*w,random()*h,random()*1.1+.3,0,Math.PI*2);ctx.fill();}
    });
    bump.colorSpace=THREE.NoColorSpace;bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.repeat.set(12,12);
    result=new THREE.MeshStandardMaterial({color:'#252923',bumpMap:bump,bumpScale:.028,roughness:.71});
  }else result=new THREE.MeshStandardMaterial({color:'#a49361',metalness:.55,roughness:.43});
  surfaces.set(kind,result);return result;
}
function printedChip(value){
  if(chipMaterials.has(value))return chipMaterials.get(value);
  const [color,ink]=palette[value];
  const top=canvasTexture(256,256,(ctx,w)=>{
    const c=w/2;ctx.fillStyle=color;ctx.fillRect(0,0,w,w);
    ctx.strokeStyle=ink;ctx.lineWidth=2;
    for(const r of [112,89,73]){ctx.globalAlpha=r===73?.28:.8;ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.stroke();}
    ctx.globalAlpha=1;
    for(let i=0;i<8;i++){
      ctx.save();ctx.translate(c,c);ctx.rotate(i*Math.PI/4);ctx.fillStyle=ink;
      ctx.fillRect(-10,-128,20,25);ctx.fillRect(-5,-104,10,8);ctx.restore();
    }
    const text='CLUBHOUSE';
    ctx.font='600 13px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=ink;
    for(let i=0;i<text.length;i++){
      const angle=-.72+i*.18;ctx.save();ctx.translate(c,c);ctx.rotate(angle);ctx.fillText(text[i],0,-81);ctx.restore();
    }
    ctx.font=`600 ${value===100?66:82}px Georgia`;ctx.fillText(String(value),c,c+6);
    ctx.font='18px Georgia';ctx.fillText('♠',c,c+58);
    // Tiny wear marks break up the perfectly clean computer-generated finish.
    for(let i=0;i<2500;i++){ctx.globalAlpha=random()*.065;ctx.fillStyle=random()>.5?'white':'black';ctx.fillRect(random()*w,random()*w,.8,.8);}
    ctx.globalAlpha=1;
  });
  const side=canvasTexture(512,64,(ctx,w,h)=>{
    ctx.fillStyle=color;ctx.fillRect(0,0,w,h);ctx.fillStyle=ink;
    for(let i=0;i<8;i++){ctx.fillRect(i*64+24,0,16,h);ctx.globalAlpha=.7;ctx.fillRect(i*64+20,15,24,7);ctx.fillRect(i*64+20,42,24,7);ctx.globalAlpha=1;}
    ctx.fillStyle='#0000002a';for(let y=3;y<h;y+=6)ctx.fillRect(0,y,w,1);
  });
  const face=new THREE.MeshStandardMaterial({map:top,roughness:.59,metalness:.025});
  const edge=new THREE.MeshStandardMaterial({map:side,roughness:.55});
  const trim=new THREE.MeshStandardMaterial({color,roughness:.48});
  const mats={body:[edge,face,face],trim};chipMaterials.set(value,mats);return mats;
}
function solidChip(value){
  const group=new THREE.Group();const mats=printedChip(value);
  const body=new THREE.Mesh(sharedGeometry,mats.body);body.castShadow=true;body.receiveShadow=true;group.add(body);
  for(const y of [-.036,.036]){
    const edge=new THREE.Mesh(edgeGeometry,mats.trim);edge.rotation.x=Math.PI/2;edge.position.y=y;group.add(edge);
  }
  return group;
}
function stack(value,count){
  const group=new THREE.Group();
  for(let i=0;i<count;i++){
    const chip=solidChip(value);chip.position.set(Math.sin(i*2.3)*.012,.058+i*.091,Math.cos(i*1.7)*.009);
    chip.rotation.y=Math.PI/2+Math.sin(i*3.2)*.22;group.add(chip);
  }
  return group;
}
function ellipseRing(rx,rz,innerX,innerZ,depth,mat,y,bevel=.045){
  const shape=new THREE.Shape();shape.absellipse(0,0,rx,rz,0,Math.PI*2,false);
  const hole=new THREE.Path();hole.absellipse(0,0,innerX,innerZ,0,Math.PI*2,true);shape.holes.push(hole);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:100});
  const mesh=new THREE.Mesh(geometry,mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
function stitchOval(scene,rx,rz,y){
  const points=[];
  for(let i=0;i<170;i++){
    const a=i/170*Math.PI*2,b=a+.017;
    points.push(rx*Math.cos(a),y,rz*Math.sin(a),rx*Math.cos(b),y,rz*Math.sin(b));
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  scene.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#aa9f70',transparent:true,opacity:.52})));
}
class Surface {
  constructor(mode){
    this.mode=mode;this.scene=new THREE.Scene();this.models=new Map();this.pendingThrows=[];this.geometrySignature='';
    this.physics=new ChipPhysics(mode==='host'?.17:-.016,impact=>playChipSound({kind:'collide',intensity:Math.min(1,.25+impact/5)}));
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0,0);
    this.renderer.shadowMap.enabled=mode==='host';this.renderer.shadowMap.type=THREE.VSMShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.domElement.className='surface-canvas';this.renderer.domElement.setAttribute('aria-hidden','true');
    this.camera=new THREE.OrthographicCamera(-8,8,4,-4,.1,100);
    this.camera.position.set(0,20,mode==='host'?12:9);this.camera.lookAt(0,0,0);
    this.camera.updateMatrixWorld();
    const ambient=new THREE.HemisphereLight('#fff2df','#223c2e',1.8);this.scene.add(ambient);
    const light=new THREE.DirectionalLight('#fff1d7',2.4);light.position.set(-5,11,6);light.castShadow=mode==='host';
    light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-12;light.shadow.camera.right=12;light.shadow.camera.top=12;light.shadow.camera.bottom=-12;light.shadow.normalBias=.025;light.shadow.bias=-.00015;light.shadow.radius=4;light.shadow.blurSamples=8;
    this.scene.add(light);
    const fill=new THREE.DirectionalLight('#bfd7e2',.65);fill.position.set(7,5,-7);this.scene.add(fill);
    this.dynamic=new THREE.Group();this.scene.add(this.dynamic);
    if(mode==='host')this.makeTable();else this.makePhone();
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.syncPositions();this.draw();});
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.parent?.classList.remove('has-3d');});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.parent?.classList.add('has-3d');this.draw();});
  }
  makeTable(){
    this.scene.background=new THREE.Color('#183f2d');
    this.tableBody=new THREE.Group();this.scene.add(this.tableBody);
    this.tableFelt=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material('felt'));
    this.tableFelt.rotation.x=-Math.PI/2;this.tableFelt.receiveShadow=true;this.tableFelt.position.y=.17;this.tableBody.add(this.tableFelt);
    this.rails=[];
    for(const axis of ['x','z'])for(const sign of [-1,1]){
      const wood=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material('wood'));
      const leather=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material('leather'));
      wood.castShadow=leather.castShadow=true;wood.receiveShadow=leather.receiveShadow=true;
      this.tableBody.add(wood,leather);this.rails.push({axis,sign,wood,leather});
    }
    this.stitches=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#a79d76',transparent:true,opacity:.4}));
    this.tableBody.add(this.stitches);
  }
  makePhone(){
    const felt=material('felt').clone();felt.map=felt.map.clone();felt.map.wrapS=felt.map.wrapT=THREE.RepeatWrapping;felt.map.repeat.set(2,12);felt.bumpMap=felt.bumpMap.clone();felt.bumpMap.repeat.set(10,64);
    const board=new THREE.Mesh(new THREE.PlaneGeometry(8,50),felt);board.rotation.x=-Math.PI/2;board.position.y=-.016;board.receiveShadow=true;this.scene.add(board);
    for(const x of [-3.2,3.2]){
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.14,.25,50),material('wood'));rail.position.set(x,.04,0);rail.castShadow=true;rail.receiveShadow=true;this.scene.add(rail);
      const seam=new THREE.Mesh(new THREE.BoxGeometry(.018,.01,50),material('metal'));seam.position.set(x-(Math.sign(x)*.12),.008,0);this.scene.add(seam);
    }
  }
  attach(parent){
    if(this.parent!==parent){
      this.resizeObserver.disconnect();this.parent=parent;parent.prepend(this.renderer.domElement);parent.classList.add('has-3d');this.resizeObserver.observe(parent);this.resize();
    }
  }
  resize(){
    if(!this.parent)return;
    const w=this.parent.clientWidth,h=this.parent.clientHeight;if(!w||!h)return;
    this.renderer.setSize(w,h,false);
    const width=this.mode==='host'?(w/h>1.3?15.5:10.9):6.4;
    const height=width*h/w;
    this.camera.left=-width/2;this.camera.right=width/2;this.camera.top=height/2;this.camera.bottom=-height/2;this.camera.updateProjectionMatrix();
    if(this.mode==='host'){
      const depth=height/.8575+.15;this.boundWidth=width-.6;this.boundDepth=depth-.6;this.physics.bounds(this.boundWidth,this.boundDepth);
      this.tableFelt.scale.set(width+.1,depth,1);
      for(const {axis,sign,wood,leather}of this.rails){
        if(axis==='x'){
          wood.scale.set(.25,.34,depth);wood.position.set(sign*(width/2-.08),.16,0);
          leather.scale.set(.18,.14,depth);leather.position.set(sign*(width/2-.28),.23,0);
        }else{
          wood.scale.set(width,.34,.25);wood.position.set(0,.16,sign*(depth/2-.08));
          leather.scale.set(width-.5,.14,.18);leather.position.set(0,.23,sign*(depth/2-.28));
        }
      }
      const points=[],sx=width/2-.54,sz=depth/2-.54;
      for(let x=-sx;x<sx;x+=.13)for(const z of [-sz,sz])points.push(x,.178,z,Math.min(x+.055,sx),.178,z);
      for(let z=-sz;z<sz;z+=.13)for(const x of [-sx,sx])points.push(x,.178,z,x,.178,Math.min(z+.055,sz));
      this.stitches.geometry.dispose();this.stitches.geometry=new THREE.BufferGeometry();
      this.stitches.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    }else this.physics.bounds(6.05,height/.912+.1);
  }
  point(x,y,height=0){
    const rect=this.renderer.domElement.getBoundingClientRect();
    ndc.set((x-rect.left)/rect.width*2-1,-((y-rect.top)/rect.height)*2+1);raycaster.setFromCamera(ndc,this.camera);
    ground.constant=-height;
    const point=new THREE.Vector3();raycaster.ray.intersectPlane(ground,point);return point;
  }
  target(element,offsetY=0,height=0){
    const rect=element.getBoundingClientRect();return this.point(rect.left+rect.width/2,rect.top+rect.height/2+offsetY,height);
  }
  syncPositions(){
    if(this.mode!=='phone'||!this.parent)return;
    const pushing=!!this.parent.querySelector('.chip-mat.pushing');
    const carryingBank=!!this.parent.querySelector('.chip-mat.all-in-carry');
    const picked=new Set();
    for(const [key,record]of this.models)if(record.kind==='loose' && (pushing || this.parent.querySelector(`.loose-chip[data-id="${key}"]`)?.classList.contains('dragging')))picked.add(key);
    let top=this.physics.floor.position.y;
    for(const [key,record]of this.models)if(!picked.has(key) && !(carryingBank && record.kind==='bank'))top=Math.max(top,record.body.position.y+this.physics.verticalExtent(record.body));
    for(const [key,record]of this.models){
      const bank=record.kind==='bank';
      const el=bank?this.parent.querySelector(`.wallet-stack[data-value="${record.value}"] .stack-visual`):this.parent.querySelector(`.loose-chip[data-id="${key}"]`);
      if(!el)continue;
      const held=picked.has(key);
      if(held && !record.held)record.liftHeight=Math.max(.3,top+this.physics.verticalExtent(record.body)+.12);
      const point=this.target(el,bank?13:0,held?record.liftHeight:0);
      if(!record.placed){record.body.position.x=point.x;record.body.position.z=point.z;record.placed=true;record.anchor=point.clone();if(bank)record.body.sleep();}
      if(bank){
        if(carryingBank){
          if(!record.bankHome){record.bankHome={position:record.body.position.clone(),quaternion:record.body.quaternion.clone()};record.bankLift=Math.max(.35,top+.12);}
          const carried=this.target(el,13,record.bankLift);
          this.physics.hold(record.body,carried.x,record.bankHome.position.y+record.bankLift,carried.z);
          continue;
        }
        if(record.bankHome){
          this.physics.release(record.body);
          record.body.position.copy(record.bankHome.position);record.body.quaternion.copy(record.bankHome.quaternion);
          record.body.aabbNeedsUpdate=true;record.body.sleep();delete record.bankHome;delete record.bankLift;
        }
        const dx=point.x-record.anchor.x,dz=point.z-record.anchor.z;
        if(Math.abs(dx)+Math.abs(dz)>.005){record.body.position.x+=dx;record.body.position.z+=dz;record.body.wakeUp();record.anchor.copy(point);}
      }else{
        if(held)this.physics.hold(record.body,point.x,record.liftHeight,point.z);
        else{this.physics.release(record.body);delete record.liftHeight;}
        record.held=held;
      }
    }
    this.animate();
  }
  addChip(key,value,options,metadata={}){
    const mesh=solidChip(value),body=this.physics.create(options);
    this.dynamic.add(mesh);const record={mesh,body,value,...metadata};this.models.set(key,record);return record;
  }
  removeChip(key){const r=this.models.get(key);if(r){this.physics.remove(r.body);this.dynamic.remove(r.mesh);this.models.delete(key);}}
  clearChips(){this.pendingThrows=[];this.physics.clear();this.models.clear();this.dynamic.clear();}
  updatePhone(wallet,selected){
    this.selected=selected;
    const wanted=new Set();
    for(const value of [1,5,25,100])for(let i=0;i<Math.min(12,wallet[value]);i++)wanted.add(`bank-${value}-${i}`);
    for(const c of selected)wanted.add(c.id);
    for(const key of [...this.models.keys()])if(!wanted.has(key))this.removeChip(key);
    for(const value of [1,5,25,100])for(let i=0;i<Math.min(12,wallet[value]);i++){
      const key=`bank-${value}-${i}`;
      if(!this.models.has(key)){
        const point=this.target(this.parent.querySelector(`.wallet-stack[data-value="${value}"] .stack-visual`),13);
        this.addChip(key,value,{x:point.x,y:.027+i*.087,z:point.z,rotation:Math.PI/2+Math.sin(i*3.2)*.06},{kind:'bank',slot:i});
      }
    }
    for(const c of selected){
      if(!this.models.has(c.id)){
        const point=this.target(this.parent.querySelector(`.loose-chip[data-id="${c.id}"]`));
        this.addChip(c.id,c.value,{x:point.x,y:.4,z:point.z,rotation:Math.PI/2},{kind:'loose'});
      }
    }
    this.syncPositions();this.draw();
  }
  updatePot(amount,event,room){
    if(this.room!==room){this.clearChips();this.room=room;this.geometrySignature='';this.lastBet=null;}
    if(this.geometrySignature===String(amount)){this.draw();return;}
    const before=Number(this.geometrySignature)||0;
    const wasRestored=this.geometrySignature==='';
    this.geometrySignature=String(amount);
    if(!amount){this.clearChips();this.draw();return;}
    if(amount<before)this.clearChips();
    const incoming=!wasRestored && event?.kind==='bet' && event.id!==this.lastBet && amount>before;
    let remaining=incoming?amount-before:amount;
    if(!incoming)this.clearChips();
    const values=[];
    if(incoming && event.chipCounts){
      for(const value of [100,25,5,1])for(let i=0;i<event.chipCounts[value] && values.length<120;i++)values.push(value);
      remaining=0;
    }
    if(incoming && Array.isArray(event.chipValues) && event.chipValues.reduce((n,v)=>n+v,0)===remaining){values.push(...event.chipValues.slice(0,120));remaining=0;}
    for(const value of [100,25,5,1])while(remaining>=value && values.length<120){values.push(value);remaining-=value;}
    const available=Math.max(0,120-this.models.size-this.pendingThrows.length);
    const visible=values.slice(0,available);
    if(incoming){
      const angles={bottom:Math.PI/2,left:Math.PI,top:-Math.PI/2,right:0};
      const plan=planChipThrow({count:visible.length,width:this.boundWidth,depth:this.boundDepth,angle:Number.isFinite(event.angle)?event.angle:angles[event.seat]??-Math.PI/2});
      visible.forEach((value,i)=>this.pendingThrows.push({key:`pot-${event.id}-${i}`,value,at:this.physics.world.time+plan[i].delay,options:plan[i].options}));
    }else visible.forEach((value,i)=>{
      // Restoring a pot uses the same wider landing area as live throws.
      this.addChip(`pot-rest-${i}`,value,{x:(Math.random()-.5)*4,y:.7+Math.floor(i/8)*.1,z:(Math.random()-.5)*2.4+.45,flat:true,rotation:Math.PI/2+(Math.random()-.5)*.1},{kind:'pot'});
    });
    this.lastBet=event?.id;this.animate();this.draw();
  }
  projectLooseChips(){
    if(this.mode!=='phone'||!this.selected)return;
    const mat=this.parent.querySelector('.chip-mat');if(!mat)return;
    const rect=mat.getBoundingClientRect(),canvas=this.renderer.domElement.getBoundingClientRect();
    for(const c of this.selected){
      const record=this.models.get(c.id);if(!record||record.held)continue;
      const projected=record.mesh.position.clone().project(this.camera);
      const x=canvas.left+(projected.x+1)*canvas.width/2,y=canvas.top+(1-projected.y)*canvas.height/2;
      c.x=(x-rect.left)/rect.width*100;c.y=(y-rect.top)/rect.height*100;
      const el=this.parent.querySelector(`.loose-chip[data-id="${c.id}"]`);
      if(el){el.style.left=`${c.x}%`;el.style.top=`${c.y}%`;}
    }
  }
  animate(){
    if(this.frame)return;
    this.previousTime=performance.now();
    const tick=now=>{
      this.frame=null;
      if(!this.parent?.isConnected)return;
      this.physics.step((now-this.previousTime)/1000,()=>{
        if(!this.pendingThrows.length)return;
        const ready=this.pendingThrows.filter(chip=>chip.at<=this.physics.world.time);
        this.pendingThrows=this.pendingThrows.filter(chip=>chip.at>this.physics.world.time);
        for(const chip of ready)this.addChip(chip.key,chip.value,chip.options,{kind:'pot'});
      });
      this.previousTime=now;
      this.draw();
      if(this.physics.active || this.pendingThrows.length)this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  draw(){
    if(!this.parent?.isConnected)return;
    for(const record of this.models.values()){record.mesh.position.copy(record.body.position);record.mesh.quaternion.copy(record.body.quaternion);}
    this.renderer.render(this.scene,this.camera);this.projectLooseChips();
  }

}

export function mountHost3D(element,amount,event,room){
  try{hostView ||= new Surface('host');hostView.attach(element);hostView.updatePot(amount,event,room);return true;}
  catch(error){console.warn('3D table unavailable; using the physical CSS table.',error.message);return false;}
}
export function mountPhone3D(element,wallet,selected){
  try{phoneView ||= new Surface('phone');phoneView.attach(element);phoneView.updatePhone(wallet,selected);return true;}
  catch(error){console.warn('3D chips unavailable; using the physical CSS chips.',error.message);return false;}
}
export function movePhone3D(){phoneView?.syncPositions();phoneView?.draw();}
