import {test,expect} from '@playwright/test';

test('a large throw arrives in batches and its rendered pile stops moving',async({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});await page.goto('/join');
  await page.evaluate(async()=>{
    const {ChipPhysics}=await import('/chip-physics.js');
    const create=ChipPhysics.prototype.create;
    ChipPhysics.prototype.create=function(...args){window.throwWorld=this;return create.apply(this,args);};
    const {mountHost3D}=await import('/table3d.js');
    let seed=42;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    document.body.className='table-body';
    document.querySelector('#app').innerHTML='<div class="host-shell immersive"><main class="table-stage"></main></div>';
    const stage=document.querySelector('.table-stage');
    mountHost3D(stage,0,null,'large-throw');
    mountHost3D(stage,600,{id:'many-chips',kind:'bet',angle:Math.PI,amount:600,chipCounts:{5:120,10:0,25:0,50:0,100:0}},'large-throw');
  });
  await expect(page.locator('.table-stage.has-3d canvas')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.throwWorld?.chips.size || 0),{timeout:20000}).toBe(120);
  try {await expect.poll(()=>page.evaluate(()=>!throwWorld.active),{timeout:45000}).toBe(true);}
  catch(error){throw new Error(`${error.message}\n${JSON.stringify(await page.evaluate(()=>({time:throwWorld.world.time,awake:[...throwWorld.chips].filter(body=>body.sleepState!==2).map(body=>({y:body.position.y,speed:body.velocity.length(),spin:body.angularVelocity.length(),rest:body.restPose?throwWorld.world.time-body.restPose.since:null}))})))}`);}
  const before=await page.evaluate(()=>[...throwWorld.chips].map(body=>[...body.position.toArray(),...body.quaternion.toArray()]));
  await page.waitForTimeout(600);
  expect(await page.evaluate(()=>[...throwWorld.chips].map(body=>[...body.position.toArray(),...body.quaternion.toArray()]))).toEqual(before);
  expect(errors).toEqual([]);
});
