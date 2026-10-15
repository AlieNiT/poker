import {test,expect} from '@playwright/test';

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

test('full-screen pot and private phones support individual moves, group return, throw, call, bank, and payout',async({browser,page})=>{
  // Several 3D clients share Chrome's software renderer in this test.
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await expect(page.locator('.table-stage.has-3d canvas')).toBeVisible();
  const stage=await page.locator('.table-stage').boundingBox();expect(stage).toEqual({x:0,y:0,width:1440,height:900});
  await expect(page.locator('.host-shell')).toHaveText('0');
  const code=await invitation(page);await page.getByRole('button',{name:'Table controls',exact:true}).click();
  await page.screenshot({path:'/tmp/clubhouse-empty.png'});
  const phones=[];const remotePlayers=[];
  for(const [i,seat]of ['bottom','left'].entries()){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto(`/join?table=${code}`);await phone.getByLabel('Your name').fill(`Friend ${i+1}`);
    await phone.locator(`input[name="seat"][value="${seat}"]`).check({force:true});
    await phone.getByRole('button',{name:'Join',exact:true}).click();await expect(phone.locator('.player-shell.has-3d canvas')).toBeVisible();
    await expect(phone.locator('.player-shell')).not.toContainText(`Friend ${i+1}`);
    await expect(phone.locator('#player-pot,[data-action="sound"],.throw-guide,.mat-hint,.player-name')).toHaveCount(0);
    await expect(phone.getByRole('button',{name:'Put selected chips back'})).toHaveCount(0);
    await expect(phone.getByRole('button',{name:'Throw chips'})).toHaveCount(0);
    phones.push({phone,context});
  }
  for(const [i,seat]of ['top','right'].entries()){
    const joined=await page.request.post(`/api/rooms/${code}/join`,{data:{name:`Friend ${i+3}`,seat}});
    expect(joined.ok()).toBeTruthy();remotePlayers.push(await joined.json());
  }
  await expect(page.locator('.occupied')).toHaveCount(4);
  const first=phones[0].phone;await first.bringToFront();
  await first.locator('.wallet-stack[data-value="25"]').tap();await first.locator('.wallet-stack[data-value="25"]').tap();
  await expect(first.locator('#selection-value')).toHaveText('50');
  const loose=first.locator('.loose-chip').last();const box=await loose.boundingBox();
  await first.mouse.move(box.x+box.width/2,box.y+box.height/2);await first.mouse.down();
  await first.mouse.move(box.x-55,box.y+box.height/2,{steps:5});await first.mouse.up();
  await expect(first.locator('#selection-value')).toHaveText('50');await expect(page.locator('.pot-number')).toHaveText('0');
  await push(first,phones[0].context,'down');await expect(first.locator('.loose-chip')).toHaveCount(0);
  await expect(first.locator('.player-balance')).toHaveText('1,000');await expect(page.locator('.pot-number')).toHaveText('0');
  await first.locator('.wallet-stack[data-value="25"]').tap();await first.locator('.wallet-stack[data-value="25"]').tap();
  await push(first,phones[0].context,'up');await expect(page.locator('.pot-number')).toHaveText('50');
  await expect(first.locator('.player-balance')).toHaveText('950');
  await expect(phones[1].phone.locator('#call-button')).toHaveText('Call 50');await phones[1].phone.locator('#call-button').click();
  for(const [i,player]of remotePlayers.entries()){
    const response=await page.request.post(`/api/rooms/${code}/action`,{headers:{Authorization:`Bearer ${player.token}`},data:{action:'call',amount:50,requestId:`browser-call-${i}`}});
    expect(response.ok()).toBeTruthy();
  }
  await expect(page.locator('.pot-number')).toHaveText('200');
  await first.locator('.wallet-stack[data-value="25"]').tap();await push(first,phones[0].context,'up');
  await expect(page.locator('.pot-number')).toHaveText('225');await expect(phones[1].phone.locator('#call-button')).toHaveText('Call 25');
  await page.bringToFront();await controls(page);await page.getByRole('button',{name:'Open bank and manage loans'}).click();
  await page.locator('#bank-form input[name="amount"]').fill('100');await page.getByRole('button',{name:'Move chips'}).click();
  await expect(first.locator('.player-balance')).toHaveText('1,025');
  await page.getByRole('button',{name:'Award the pot'}).click();await page.locator('.winner-options label').first().click();
  await page.getByRole('button',{name:'Award 225',exact:true}).click();
  await expect(page.locator('.pot-number')).toHaveText('0');await expect(first.locator('.player-balance')).toHaveText('1,250');
  await first.reload();await expect(first.locator('.player-balance')).toHaveText('1,250');
  await expect(page.locator('.round-tabs,.next-round,.hand-tag')).toHaveCount(0);
  expect(await first.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:'/tmp/clubhouse-table.png'});await first.screenshot({path:'/tmp/clubhouse-phone.png'});
  for(const {context}of phones)await context.close();
});

test('hidden controls retain QR, side pots, settings, preview and saved tables',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  const code=await invitation(page);await page.getByRole('button',{name:'Practice table',exact:true}).click();
  await expect(page.locator('.pot-number')).toHaveText('450');await page.screenshot({path:'/tmp/clubhouse-practice.png'});
  await page.getByRole('button',{name:'Award the pot'}).click();await expect(page.locator('.award-pot')).toHaveCount(2);
  for(const pot of await page.locator('.award-pot').all())await pot.locator('.winner-options label').first().click();
  await page.getByRole('button',{name:'Award 450',exact:true}).click();await expect(page.locator('.pot-number')).toHaveText('0');
  await controls(page);await page.getByRole('button',{name:'Table settings',exact:true}).click();
  await page.getByLabel('Table name').fill('Friday with friends');await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.host-shell')).toHaveAttribute('aria-label','Friday with friends');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.screenshot({path:'/tmp/clubhouse-host-mobile.png'});
  await page.getByRole('button',{name:'Player preview',exact:true}).click();await expect(page.locator('.player-shell')).toBeVisible();
  await page.screenshot({path:'/tmp/clubhouse-phone-practice.png'});
  await page.getByRole('button',{name:'Return to the laptop table'}).click();
  await page.getByRole('button',{name:'Table settings',exact:true}).click();await page.getByRole('button',{name:'New table',exact:true}).click();
  await page.getByRole('button',{name:'New table',exact:true}).click();
  await controls(page);await page.getByRole('button',{name:'Table settings',exact:true}).click();
  await page.getByRole('button',{name:`Friday with friends · ${code}`}).click();await expect(page.locator('.occupied')).toHaveCount(4);
});
