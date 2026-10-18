import {test,expect} from '@playwright/test';
import {setupHost,startHand,send,stateFor} from './helpers.js';

async function controls(page){
  const toggle=page.getByRole('button',{name:'Table controls',exact:true});
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
}
async function invitation(page){
  await controls(page);await page.getByRole('button',{name:'Invite players',exact:true}).click();
  const code=await page.locator('.room-code').textContent();
  const qr=page.locator('.qr');await expect(qr).toBeVisible();
  await expect.poll(()=>qr.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'Close dialog'}).click();return code;
}
async function push(phone,context,direction){
  await phone.bringToFront();
  const mat=await phone.locator('.chip-mat').boundingBox();
  const x=mat.x+mat.width/2,y=mat.y+mat.height*.42;
  const target=mat.y+mat.height*(direction==='up'?.04:.9);
  const cdp=await context.newCDPSession(phone);
  const points=value=>[{id:1,x:x-18,y:value},{id:2,x:x+18,y:value}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(y)});
  await phone.waitForTimeout(30);
  for(let i=1;i<=4;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(y+(target-y)*i/4)});
    // Chrome coalesces back-to-back synthetic touches. Give each movement a
    // display frame, as a real finger gesture would, before lifting both.
    await phone.waitForTimeout(30);
  }
  await phone.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}

test('turns gate phone gestures and equal-size call/fold buttons, show round bets, then clear them',async({browser,page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const host=await setupHost(page,4);
  await page.setViewportSize({width:1440,height:900});
  const phones=[];
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto(`/join?table=${host.code}`);await phone.getByLabel('Your name').fill(`Friend ${i+1}`);
    await phone.locator(`[data-pick-seat="seat-${i}"]`).click();await phone.getByRole('button',{name:'Join',exact:true}).click();
    await expect(phone.locator('.player-shell.has-3d canvas')).toBeVisible();phones.push({phone,context});
  }
  const remote=[];
  for(let i=2;i<4;i++){
    const response=await page.request.post(`/api/rooms/${host.code}/join`,{data:{name:`Friend ${i+1}`,seat:`seat-${i}`}});
    expect(response.ok()).toBeTruthy();remote.push(await response.json());
  }
  const code=await invitation(page);expect(code).toBe(host.code);
  await startHand(page);await expect(page.locator('.round-bet')).toHaveCount(2);
  const first=phones[0].phone,second=phones[1].phone;
  await expect(first.locator('#call-button')).toBeDisabled();await expect(first.locator('#fold-button')).toBeDisabled();
  await send(page,host,remote[1].token,'call');await expect(first.locator('.turn-status')).toHaveText('Your turn');
  await expect(first.locator('#call-button')).toHaveText('Call 10');await expect(first.locator('#call-button')).toBeEnabled();
  const left=await first.locator('#call-button').boundingBox(),right=await first.locator('#fold-button').boundingBox();
  expect(left.width).toBeCloseTo(right.width,0);expect(left.height).toBe(right.height);
  await first.locator('.wallet-stack[data-value="25"]').tap();
  await expect(first.locator('#call-button')).toBeDisabled();await expect(first.locator('#fold-button')).toBeDisabled();
  await push(first,phones[0].context,'down');await expect(first.locator('.loose-chip')).toHaveCount(0);
  await expect(first.locator('#call-button')).toBeEnabled();await expect(first.locator('#fold-button')).toBeEnabled();
  await first.locator('.wallet-stack[data-value="25"]').tap();await push(first,phones[0].context,'up');
  await expect(page.locator('.pot-number')).toHaveText('50');await expect(page.locator('.round-bet')).toHaveCount(4);
  await expect(first.locator('#call-button')).toBeDisabled();await expect(second.locator('#call-button')).toHaveText('Call 20');
  await second.locator('#call-button').click();await send(page,host,remote[0].token,'call');await send(page,host,remote[1].token,'call');
  await expect(page.locator('.pot-number')).toHaveText('100');await expect(page.locator('.round-bet')).toHaveCount(0);
  await page.getByRole('button',{name:'Deal flop',exact:true}).click();
  await expect(second.locator('#call-button')).toHaveText('Check');await expect(second.locator('#call-button')).toBeEnabled();
  await second.locator('#call-button').click();await send(page,host,remote[0].token,'check');await send(page,host,remote[1].token,'check');
  await expect(first.locator('#call-button')).toHaveText('Check');await first.locator('#call-button').click();
  await page.getByRole('button',{name:'Deal turn',exact:true}).click();
  await second.locator('#fold-button').click();await send(page,host,remote[0].token,'fold');await send(page,host,remote[1].token,'fold');
  await expect(page.locator('.pot-number')).toHaveText('0');await expect(first.locator('.player-balance')).toHaveText('675');
  await expect(page.getByRole('button',{name:'Start hand',exact:true})).toBeEnabled();
  await controls(page);await page.getByRole('button',{name:'Open bank and manage loans'}).click();
  await page.locator('#bank-form input[name="amount"]').fill('75');await page.getByRole('button',{name:'Move chips'}).click();
  await expect(first.locator('.player-balance')).toHaveText('750');
  await startHand(page);const state=await stateFor(page,host);expect(state.betting.buttonId).toBe(state.players[1].id);
  await page.screenshot({path:'/tmp/clubhouse-turns-table.png'});await first.screenshot({path:'/tmp/clubhouse-turns-phone.png'});
  expect(await first.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);expect(errors).toEqual([]);
  for(const {context}of phones)await context.close();
});

test('practice, showdown payout, settings, preview and saved tables retain turn state',async({page})=>{
  const host=await setupHost(page,4);
  await controls(page);await page.getByRole('button',{name:'Practice table',exact:true}).click();
  await expect(page.locator('.pot-number')).toHaveText('15');
  await expect(page.getByRole('button',{name:'Award the pot'})).toBeDisabled();
  let state=await stateFor(page,host);
  for(let i=0;state.betting.phase!=='showdown';i++){
    expect(i).toBeLessThan(30);
    if(state.betting.phase==='between')state=await send(page,host,host.token,'next-street');
    else{
      const p=state.players.find(p=>p.id===state.betting.actorId);
      state=await send(page,host,host.token,p.actions.canCheck?'check':'call',{playerId:p.id});
    }
  }
  await page.getByRole('button',{name:'Award the pot'}).click();await expect(page.locator('.award-pot')).toHaveCount(1);
  await page.locator('.winner-options label').first().click();await page.getByRole('button',{name:'Award 40',exact:true}).click();
  await expect(page.locator('.pot-number')).toHaveText('0');await controls(page);
  await page.getByRole('button',{name:'Table settings',exact:true}).click();
  await page.getByLabel('Table name').fill('Friday with friends');await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.host-shell')).toHaveAttribute('aria-label','Friday with friends');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.getByRole('button',{name:'Player preview',exact:true}).click();await expect(page.locator('.player-shell')).toBeVisible();
  await page.getByRole('button',{name:'Return to the laptop table'}).click();
  await page.getByRole('button',{name:'Table settings',exact:true}).click();await page.getByRole('button',{name:'New table',exact:true}).click();await page.getByRole('button',{name:'New table',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await controls(page);await page.getByRole('button',{name:'Table settings',exact:true}).click();
  await page.getByRole('button',{name:`Friday with friends · ${host.code}`}).click();await expect(page.locator('.occupied')).toHaveCount(4);
});
