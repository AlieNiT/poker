import {test, expect} from '@playwright/test';

async function observePhysics(page) {
  await page.evaluate(async () => {
    const {ChipPhysics} = await import('/chip-physics.js');
    const check = window.physicsCheck = {world: null, impacts: 0, sounds: 0, maxSpeed: 0};
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {check.sounds++; return start.apply(this,args);};
    const create = ChipPhysics.prototype.create, step = ChipPhysics.prototype.step;
    ChipPhysics.prototype.create = function (...args) {
      if (!check.world) {
        check.world = this;
        const impact = this.onImpact;
        this.onImpact = value => {check.impacts++; impact(value);};
      }
      return create.apply(this, args);
    };
    ChipPhysics.prototype.step = function (...args) {
      step.apply(this, args);
      for (const body of this.chips) check.maxSpeed = Math.max(check.maxSpeed, body.velocity.length());
    };
  });
}

test('picked chips follow the finger silently, drop on release, and still throw into the pot', async ({page, browser}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.table-stage.has-3d canvas')).toBeVisible();
  await observePhysics(page);
  const code = await page.evaluate(() => JSON.parse(localStorage.getItem('clubhouse-host')).code);
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  const phone = await context.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`/join?table=${code}`);
  await phone.getByLabel('Your name').fill('Guest');
  await phone.locator('[data-pick-seat="seat-0"]').click();
  await observePhysics(phone);
  await phone.getByRole('button', {name: 'Join', exact: true}).click();
  await expect(phone.locator('.player-shell.has-3d canvas')).toBeVisible();
  await phone.evaluate(()=>physicsCheck.bankIds=new Set([...physicsCheck.world.chips].map(b=>b.id)));
  for (let i = 0; i < 4; i++) await phone.locator('.wallet-stack[data-value="25"]').tap();
  await expect(phone.locator('#selection-value')).toHaveText('100');
  await expect.poll(() => phone.evaluate(() => !physicsCheck.world.active), {timeout: 15000}).toBe(true);
  const quiet = await phone.evaluate(() => physicsCheck.impacts);
  await phone.waitForTimeout(600);
  expect(await phone.evaluate(() => physicsCheck.impacts)).toBe(quiet);
  const topIndex=await phone.evaluate(()=>{
    const chips=[...physicsCheck.world.chips].filter(b=>!physicsCheck.bankIds.has(b.id));
    return chips.indexOf(chips.reduce((a,b)=>a.position.y>b.position.y?a:b));
  });
  const chip = await phone.locator('.loose-chip').nth(topIndex).boundingBox();
  const mat = await phone.locator('.chip-mat').boundingBox();
  const beforePickup=await phone.evaluate(()=>({sounds:physicsCheck.sounds,impacts:physicsCheck.impacts}));
  await phone.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await phone.mouse.down();
  const pickup=await phone.evaluate(()=>{
    const bodies=[...physicsCheck.world.chips],held=bodies.find(b=>b.holdTarget);
    return {mask:held.collisionFilterMask,height:held.position.y,top:Math.max(...bodies.filter(b=>b!==held).map(b=>b.position.y+physicsCheck.world.verticalExtent(b)))};
  });
  expect(pickup.mask).toBe(0);expect(pickup.height).toBeGreaterThan(pickup.top);
  await phone.mouse.move(mat.x + mat.width * .8, mat.y + mat.height * .45, {steps: 4});
  await phone.waitForTimeout(300);
  expect(await phone.evaluate(()=>({sounds:physicsCheck.sounds,impacts:physicsCheck.impacts}))).toEqual(beforePickup);
  await phone.mouse.up();
  await expect.poll(() => phone.evaluate(() => !physicsCheck.world.active), {timeout: 15000}).toBe(true);
  expect(await phone.evaluate(() => physicsCheck.maxSpeed)).toBeLessThan(8);
  expect(await phone.evaluate(()=>physicsCheck.sounds)).toBeGreaterThan(beforePickup.sounds);
  expect(await phone.evaluate(()=>[...physicsCheck.world.chips].some(b=>b.holdTarget))).toBe(false);
  const cdp = await context.newCDPSession(phone);
  const first=await phone.locator('.loose-chip').first().boundingBox();
  const middleX=first.x+first.width/2,middleY=first.y+first.height/2;
  const middlePoints=value=>[{id:1,x:middleX-18,y:value},{id:2,x:middleX+18,y:value}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:middlePoints(middleY)});
  await phone.waitForTimeout(30);
  expect(await phone.evaluate(()=>[...physicsCheck.world.chips].filter(b=>b.holdTarget).length)).toBe(4);
  const groupSounds=await phone.evaluate(()=>physicsCheck.sounds);
  for(let i=1;i<=3;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:middlePoints(middleY+mat.height*.06*i/3)});
    await phone.waitForTimeout(30);
  }
  expect(await phone.evaluate(()=>physicsCheck.sounds)).toBe(groupSounds);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await phone.evaluate(()=>[...physicsCheck.world.chips].some(b=>b.holdTarget))).toBe(false);
  await expect.poll(()=>phone.evaluate(()=>!physicsCheck.world.active),{timeout:15000}).toBe(true);
  await expect(phone.locator('#selection-value')).toHaveText('100');
  const x = mat.x + mat.width / 2, y = mat.y + mat.height * .6;
  const points = value => [{id: 1, x: x - 18, y: value}, {id: 2, x: x + 18, y: value}];
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: points(y)});
  await phone.waitForTimeout(30);
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: points(y - mat.height * .59 * i / 5)});
    await phone.waitForTimeout(30);
  }
  await phone.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
  await expect(page.locator('.pot-number')).toHaveText('100');
  await page.bringToFront();
  try{
    await expect.poll(() => page.evaluate(() => physicsCheck.world && !physicsCheck.world.active), {timeout: 20000}).toBe(true);
  }catch(error){
    const details=await page.evaluate(()=>({time:physicsCheck.world.world.time,bodies:[...physicsCheck.world.chips].map(b=>({y:b.position.y,sleep:b.sleepState,speed:b.velocity.length(),spin:b.angularVelocity.length(),held:!!b.holdTarget}))}));
    throw new Error(`${error.message}\nPhysics state: ${JSON.stringify(details)}`);
  }
  const impacts = await page.evaluate(() => physicsCheck.impacts);
  expect(impacts).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => physicsCheck.impacts)).toBe(impacts);
  expect(errors).toEqual([]);
  await context.close();
});
