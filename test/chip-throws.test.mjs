import test from 'node:test';
import assert from 'node:assert/strict';
import {planChipThrow} from '../public/chip-throws.js';
import {ChipPhysics} from '../public/chip-physics.js';

function seeded(seed=42) {
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
}

test('large throws use bounded launch lanes and short batches instead of a tall column',()=>{
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI/3]){
    const plan=planChipThrow({count:120,width:14.9,depth:9.5,angle,random:seeded()});
    assert.equal(plan.length,120);assert.equal(plan[0].delay,0);assert.ok(plan.at(-1).delay<1.3);
    for(const {delay,options} of plan){
      assert.ok(delay>=0 && options.y<1);
      assert.ok(Math.abs(options.x)<14.9/2-.47 && Math.abs(options.z)<9.5/2-.47);
      assert.ok(options.velocity.every(Number.isFinite));
    }
    assert.ok(new Set(plan.slice(0,5).map(p=>`${p.options.x},${p.options.z}`)).size>=4);
  }
});

test('a slow display emits the same batches at the same physics times as a fast display',()=>{
  function emissions(frameStep,frames){
    const physics=new ChipPhysics(),plan=planChipThrow({count:120,width:14.9,depth:9.5,angle:Math.PI,random:seeded()});
    let emitted=0;const times=[];
    for(let frame=0;frame<frames;frame++)physics.step(frameStep,()=>{
      while(emitted<plan.length && plan[emitted].delay<=physics.world.time){times.push(physics.world.time);emitted++;}
    });
    return times;
  }
  const fast=emissions(1/120,240),slow=emissions(1/20,40);
  assert.equal(fast.length,120);assert.deepEqual(slow,fast);
  assert.ok(Math.max(...fast.map(time=>fast.filter(other=>other===time).length))<=5);
});

test('120 incoming chips settle completely and stay still after a crowded throw',()=>{
  for(const angle of [Math.PI,Math.PI/3]){
    const physics=new ChipPhysics(.17);physics.bounds(14.9,9.5);
    const plan=planChipThrow({count:120,width:14.9,depth:9.5,angle,random:seeded()});
    let emitted=0,maxLaunch=0;
    for(let frame=0;frame<1440;frame++){
      physics.step(1/120,()=>{
        while(emitted<plan.length && plan[emitted].delay<=physics.world.time){
          const body=physics.create(plan[emitted++].options);maxLaunch=Math.max(maxLaunch,body.position.y);
        }
      });
    }
    assert.equal(emitted,120);assert.equal(physics.chips.size,120);
    assert.ok(maxLaunch<3.5,`Launch clearance built a ${maxLaunch}-unit tower.`);
    assert.equal(physics.active,false,`Chips thrown at ${angle} must settle completely.`);
    const poses=[...physics.chips].map(body=>({position:body.position.clone(),rotation:body.quaternion.clone()}));
    for(let frame=0;frame<240;frame++)physics.step(1/120);
    [...physics.chips].forEach((body,i)=>{
      assert.ok(body.position.y>.17);assert.ok(Math.abs(body.position.x)<14.9/2 && Math.abs(body.position.z)<9.5/2);
      assert.equal(body.position.distanceTo(poses[i].position),0);assert.deepEqual(body.quaternion,poses[i].rotation);
    });
  }
});
