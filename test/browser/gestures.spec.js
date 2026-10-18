import {test,expect} from '@playwright/test';
import {send,startHand} from './helpers.js';

async function dragGroup(phone,cdp,start,end){
  const mat=await phone.locator('.chip-mat').boundingBox(),x=mat.x+mat.width/2;
  const points=y=>[{id:1,x:x-18,y},{id:2,x:x+18,y}];
  const from=mat.y+mat.height*start,to=mat.y+mat.height*end;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(from)});
  await phone.waitForTimeout(40);
  for(let i=1;i<=5;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(from+(to-from)*i/5)});
    await phone.waitForTimeout(40);
  }
}
async function endDrag(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}

test('stack returns, change, cancelled all-in, repeated throws and all-in side pots work without reloading',async({page,browser})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const host=await page.evaluate(()=>JSON.parse(localStorage.getItem('clubhouse-host')));
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(`/join?table=${host.code}`);
  await phone.getByLabel('Your name').fill('Guest');await phone.locator('[data-pick-seat="seat-0"]').click();
  await phone.evaluate(async()=>{
    const {ChipPhysics}=await import('/chip-physics.js'),create=ChipPhysics.prototype.create;
    ChipPhysics.prototype.create=function(...args){window.chipWorld=this;return create.apply(this,args);};
  });
  await phone.getByRole('button',{name:'Join',exact:true}).click();
  await expect(phone.locator('.player-shell.has-3d')).toBeVisible();
  await page.request.post(`/api/rooms/${host.code}/action`,{headers:{Authorization:`Bearer ${host.token}`},data:{action:'settings',startingStack:400,requestId:'short-stack-setting'}});
  const second=(await (await page.request.post(`/api/rooms/${host.code}/join`,{data:{name:'Short stack',seat:'seat-2'}})).json());
  await startHand(page);await expect(phone.locator('.turn-status')).toHaveText('Your turn');
  const player=await phone.evaluate(()=>JSON.parse(localStorage.getItem(`clubhouse-player-${new URLSearchParams(location.search).get('table')}`)));
  const cdp=await context.newCDPSession(phone);
  await expect(phone.locator('#exchange-button')).toBeHidden();
  // Empty a denomination, exchange another chip, and return the staged group.
  for(let i=0;i<5;i++)await phone.locator('.wallet-stack[data-value="25"]').tap();
  await expect(phone.locator('#selection-value')).toHaveText('125');
  await phone.getByRole('button',{name:'Exchange',exact:true}).click();
  await phone.getByRole('button',{name:'Exchange for 25 chips',exact:true}).click();
  await expect(phone.locator('.wallet-stack[data-value="25"] .stack-count')).toHaveText('2 × 25');
  await dragGroup(phone,cdp,.42,.9);await endDrag(cdp);
  await expect(phone.locator('.loose-chip')).toHaveCount(0);
  await expect(phone.locator('.wallet-stack[data-value="25"] .stack-count')).toHaveText('7 × 25');
  // A single chip goes back when its finger reaches the stack area.
  await phone.locator('.wallet-stack[data-value="25"]').tap();
  const chip=await phone.locator('.loose-chip').boundingBox(),mat=await phone.locator('.chip-mat').boundingBox();
  await phone.mouse.move(chip.x+chip.width/2,chip.y+chip.height/2);await phone.mouse.down();
  await phone.mouse.move(mat.x+mat.width*.3,mat.y+mat.height*.85,{steps:4});await phone.mouse.up();
  await expect(phone.locator('.loose-chip')).toHaveCount(0);
  await expect.poll(()=>phone.evaluate(()=>!chipWorld.active),{timeout:20000}).toBe(true);
  const poses=await phone.evaluate(()=>[...chipWorld.chips].map(b=>[b.position.x,b.position.y,b.position.z]));
  await dragGroup(phone,cdp,.85,.45);
  expect(await phone.evaluate(()=>[...chipWorld.chips].every(b=>!!b.holdTarget && b.collisionFilterMask===0))).toBe(true);
  await endDrag(cdp);
  expect(await phone.evaluate(()=>[...chipWorld.chips].some(b=>b.holdTarget))).toBe(false);
  expect(await phone.evaluate(()=>[...chipWorld.chips].map(b=>[b.position.x,b.position.y,b.position.z]))).toEqual(poses);
  await expect(page.locator('.pot-number')).toHaveText('15');
  // Widely separated chips can still be thrown, even if the SSE status drops.
  for(const y of [.68,.26]){
    await phone.locator('.wallet-stack[data-value="25"]').tap();
    const box=await phone.locator('.loose-chip').last().boundingBox();
    await phone.mouse.move(box.x+box.width/2,box.y+box.height/2);await phone.mouse.down();
    await phone.mouse.move(mat.x+mat.width*.5,mat.y+mat.height*y,{steps:3});await phone.mouse.up();
  }
  await phone.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await dragGroup(phone,cdp,.45,.04);await endDrag(cdp);
  await expect(phone.locator('.player-balance')).toHaveText('545');
  await expect(page.locator('.pot-number')).toHaveText('65');
  await send(page,host,second.token,'call');await send(page,host,host.token,'next-street');await send(page,host,second.token,'check');
  await expect(phone.locator('.turn-status')).toHaveText('Your turn');
  await phone.locator('.wallet-stack[data-value="25"]').tap();
  // Commit the first request but lose its HTTP response. Its retry must not double-bet.
  let requests=0;
  await phone.route(`**/api/rooms/${host.code}/action`,async route=>{
    requests++;
    if(requests===1){await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await dragGroup(phone,cdp,.42,.04);await endDrag(cdp);
  await expect(phone.locator('.player-balance')).toHaveText('520');
  await expect(page.locator('.pot-number')).toHaveText('135');expect(requests).toBe(2);
  await phone.unroute(`**/api/rooms/${host.code}/action`);
  await send(page,host,second.token,'call');await send(page,host,host.token,'next-street');await send(page,host,second.token,'check');
  await expect(phone.locator('.turn-status')).toHaveText('Your turn');
  // A cancelled browser touch must release every carried chip and allow another bet.
  await dragGroup(phone,cdp,.85,.5);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  expect(await phone.evaluate(()=>[...chipWorld.chips].some(b=>b.holdTarget))).toBe(false);
  await phone.reload();
  await expect(phone.locator('.wallet-stack[data-value="25"] .stack-count')).toHaveText('4 × 25');
  await phone.locator('.wallet-stack[data-value="25"]').tap();
  await dragGroup(phone,cdp,.85,.04);await endDrag(cdp);
  await expect(phone.locator('.player-balance')).toHaveText('0');
  await expect(page.locator('.pot-number')).toHaveText('680');
  // The other player's shorter all-in still creates the normal main pot/refund.
  await send(page,host,second.token,'all-in');
  await send(page,host,host.token,'next-street');
  const final=(await (await page.request.get(`/api/rooms/${host.code}`,{headers:{Authorization:`Bearer ${host.token}`}})).json()).state;
  expect(final.pots.map(p=>p.amount)).toEqual([800,200]);
  expect(final.pots[0].eligible).toEqual([player.playerId,second.playerId]);
  expect(final.pots[1].refund).toBe(player.playerId);
  await page.getByRole('button',{name:'Award the pot',exact:true}).click();
  await expect(page.locator('.award-pot')).toHaveCount(2);
  expect(errors).toEqual([]);
  await cdp.detach();await context.close();
});
