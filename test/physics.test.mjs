import test from 'node:test';
import assert from 'node:assert/strict';
import {ChipPhysics} from '../public/chip-physics.js';

test('a solid chip falls under gravity, contacts felt, and settles',()=>{
  let impacts=0;const physics=new ChipPhysics(0,()=>impacts++);
  const chip=physics.create({y:2});
  for(let i=0;i<360;i++)physics.step(1/120);
  assert.ok(chip.position.y>.025 && chip.position.y<.08,`Chip height ${chip.position.y}`);
  assert.ok(impacts>0);assert.ok(Math.abs(chip.velocity.y)<.1);
});
test('chips collide with each other and table boundaries',()=>{
  const physics=new ChipPhysics();physics.bounds(5,5);
  const a=physics.create({x:-.15,y:1,velocity:[1,0,0]});
  const b=physics.create({x:.15,y:1.5,velocity:[-1,0,0]});
  const edge=physics.create({x:2,y:.3,velocity:[5,0,0]});
  for(let i=0;i<480;i++)physics.step(1/120);
  for(const chip of [a,b,edge]){assert.ok(Number.isFinite(chip.position.y));assert.ok(chip.position.y>-.02);assert.ok(Math.abs(chip.position.x)<2.5);}
  const dx=a.position.x-b.position.x,dz=a.position.z-b.position.z;
  assert.ok(Math.sqrt(dx*dx+dz*dz)>.65 || Math.abs(a.position.y-b.position.y)>.06);
});
test('held chips track the finger directly, stay lifted, and drop on release',()=>{
  let impacts=0;const physics=new ChipPhysics(0,()=>impacts++),chip=physics.create({y:.2});
  physics.hold(chip,1,1,0);
  assert.ok(Math.abs(chip.position.x-1)<.02);assert.ok(Math.abs(chip.position.y-1)<.02);
  for(let i=0;i<90;i++)physics.step(1/120);
  assert.equal(chip.position.y,1);assert.equal(impacts,0);
  physics.release(chip);for(let i=0;i<240;i++)physics.step(1/120);
  assert.ok(impacts>0,'The dropped chip must produce a real landing sound.');
  assert.ok(chip.position.y<.1);physics.remove(chip);assert.equal(physics.chips.size,0);
});

test('placing many chips avoids initial intersections, then settles silently',()=>{
  let impacts=0;const physics=new ChipPhysics(0,()=>impacts++);
  for(let i=0;i<16;i++)physics.create({x:(i%4)*.6,y:.4,z:Math.floor(i/4)*.6});
  const heights=[...physics.chips].map(b=>b.position.y);
  assert.ok(Math.max(...heights)>.4,'Overlapping placements must be lifted clear of other chips.');
  for(let i=0;i<1200;i++)physics.step(1/120);
  assert.equal(physics.active,false,'A resting pile must go to sleep.');
  assert.ok(impacts>0,'Actual landings should still sound.');
  const settledImpacts=impacts;
  for(let i=0;i<600;i++)physics.step(1/120);
  assert.equal(impacts,settledImpacts,'Resting chips must stay silent.');
  const added=physics.create({x:0,y:2,z:0});
  for(let i=0;i<720;i++)physics.step(1/120);
  assert.ok(impacts>settledImpacts,'A new chip must still make real impact sounds.');
  assert.ok(added.position.y<1);assert.equal(physics.active,false);
});

test('a held chip passes through neighbours without collisions or sounds',()=>{
  let impacts=0;const physics=new ChipPhysics(0,()=>impacts++);physics.bounds(6,6);
  const stack=[];
  for(let i=0;i<12;i++)stack.push(physics.create({x:0,y:.0435+i*.087,z:0}));
  const held=physics.create({x:-2,y:.0435,z:0});
  for(let i=0;i<240;i++)physics.step(1/120);
  const before=impacts,positions=stack.map(b=>b.position.clone());
  for(let i=0;i<60;i++){
    // Even a finger target intersecting the pile cannot push a carried chip
    // through the solver. The renderer normally lifts it above the pile.
    physics.hold(held,-2+i*4/59,.1,0);physics.step(1/120);
  }
  assert.equal(impacts,before);
  stack.forEach((chip,i)=>assert.ok(chip.position.distanceTo(positions[i])<.0001));
  physics.release(held);
  for(let i=0;i<1200;i++)physics.step(1/120);
  assert.equal(physics.active,false,'The moved stack must settle after release.');
});

test('overlapping carried chips can be released together without explosive intersections',()=>{
  const physics=new ChipPhysics();physics.bounds(6,6);
  const a=physics.create({x:-1,y:.2}),b=physics.create({x:1,y:.2});
  physics.hold(a,0,1,0);physics.hold(b,0,1,0);
  physics.release(a);physics.release(b);
  assert.ok(Math.abs(a.position.y-b.position.y)>=.085);
  let maxSpeed=0;
  for(let i=0;i<600;i++){physics.step(1/120);maxSpeed=Math.max(maxSpeed,a.velocity.length(),b.velocity.length());}
  assert.ok(maxSpeed<6);assert.equal(physics.active,false);
});

test('a carried chip dropped at the edge stays inside the table',()=>{
  const physics=new ChipPhysics();physics.bounds(6,6);
  const chip=physics.create({y:.2});physics.hold(chip,3,1,3);physics.release(chip);
  assert.ok(chip.position.x<2.5 && chip.position.z<2.5);
  for(let i=0;i<600;i++)physics.step(1/120);
  assert.ok(chip.position.x<2.5 && chip.position.z<2.5);assert.equal(physics.active,false);
});

test('felt stops a sliding chip within roughly one chip width',()=>{
  const physics=new ChipPhysics(),chip=physics.create({y:.0435,velocity:[4,0,0]});
  for(let i=0;i<120;i++)physics.step(1/120);
  assert.ok(chip.position.x<.94,`Chip slid ${chip.position.x} units.`);
  assert.ok(chip.velocity.length()<.1,`Chip is still sliding at ${chip.velocity.length()}.`);
  for(let i=0;i<120;i++)physics.step(1/120);
  assert.equal(physics.active,false);
});

test('a crowded pot fully sleeps, including chips with tiny solver jitter',()=>{
  let impacts=0,seed=42;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const physics=new ChipPhysics(.17,()=>impacts++);physics.bounds(8,8);
  for(let i=0;i<80;i++)physics.create({x:(random()-.5)*2,y:.7+Math.floor(i/4)*.12,z:.75+random()*.8,rotation:Math.PI/2+(random()-.5)*.25});
  for(let i=0;i<1440;i++)physics.step(1/120);
  assert.equal(physics.active,false,'A dense pot must stop simulating at rest.');
  const settled=impacts;
  for(let i=0;i<360;i++)physics.step(1/120);
  assert.equal(impacts,settled);
});

test('removing a sleeping support lets the chip above fall and settle again',()=>{
  const physics=new ChipPhysics();
  const bottom=physics.create({y:.0435}),top=physics.create({y:.1305});
  for(let i=0;i<360;i++)physics.step(1/120);
  assert.equal(physics.active,false);
  const height=top.position.y;
  physics.remove(bottom);assert.equal(physics.active,true);
  for(let i=0;i<360;i++)physics.step(1/120);
  assert.ok(top.position.y<height-.05);assert.equal(physics.active,false);
});
