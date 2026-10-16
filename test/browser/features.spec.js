import {test,expect} from '@playwright/test';
import {send,stateFor} from './helpers.js';

test('eight seats, exact starting chips, live undo and consumed history work together',async({page,browser})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await expect(page.getByRole('heading',{name:'Set up your table'})).toBeVisible();
  await page.getByLabel('Player count').fill('8');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.ring-seat')).toHaveCount(8);
  const host=await page.evaluate(()=>JSON.parse(localStorage.getItem('clubhouse-host')));
  const route=`/api/rooms/${host.code}`;
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
  await phone.goto(`/join?table=${host.code}`);
  await expect(phone.getByRole('radio')).toHaveCount(8);
  const picker=await phone.locator('.oval-seat-picker').boundingBox();
  expect(picker.width).toBeGreaterThan(300);expect(picker.height).toBeGreaterThan(230);
  await phone.screenshot({path:'/tmp/clubhouse-eight-seat-picker.png'});
  await phone.getByLabel('Your name').fill('Alex');await phone.getByRole('radio',{name:'Seat 1',exact:true}).click();
  await phone.getByRole('button',{name:'Join',exact:true}).click();
  await expect(phone.locator('.player-balance')).toHaveText('600');
  for(const [value,count] of [[1,10],[5,8],[25,6],[100,4]])await expect(phone.locator(`[data-value="${value}"] .stack-count`)).toHaveText(`${count} × ${value}`);
  const guests=[];
  for(let i=1;i<8;i++){
    const joined=await page.request.post(route+'/join',{data:{name:`Guest ${i+1}`,seat:`seat-${i}`}});expect(joined.ok()).toBeTruthy();guests.push(await joined.json());
  }
  await expect(page.locator('.occupied')).toHaveCount(8);
  await page.screenshot({path:'/tmp/clubhouse-eight-player-table.png'});
  const player=await phone.evaluate(code=>JSON.parse(localStorage.getItem(`clubhouse-player-${code}`)),host.code);
  const loan=await page.request.post(route+'/action',{headers:{Authorization:`Bearer ${host.token}`},data:{action:'loan',playerId:player.playerId,amount:150,requestId:'rollover-loan'}});
  expect(loan.ok()).toBeTruthy();await expect(phone.locator('.player-balance')).toHaveText('750');
  // The loan adds enough small chips to cascade through ones, fives and 25s.
  for(const value of [1,5,25]){
    const text=await phone.locator(`[data-value="${value}"] .stack-count`).textContent();
    expect(Number(text.split(' × ')[0])).toBeLessThanOrEqual(10);
  }
  await send(page,host,host.token,'undo');await expect(phone.locator('.player-balance')).toHaveText('600');
  let state=await stateFor(page,host);
  await send(page,host,host.token,'start-hand',{buttonId:state.players[5].id});
  await expect(phone.locator('.turn-status')).toHaveText('Your turn');
  await send(page,host,player.token,'bet',{amount:25});await expect(phone.locator('.player-balance')).toHaveText('575');
  await send(page,host,guests[0].token,'call');await expect(page.locator('.pot-number')).toHaveText('53');
  await page.getByRole('button',{name:'Table controls',exact:true}).click();
  const undo=page.getByRole('button',{name:'Undo last action',exact:true});
  await undo.click();await expect(page.locator('.pot-number')).toHaveText('28');
  await expect(phone.locator('.player-balance')).toHaveText('575');
  await undo.click();await expect(page.locator('.pot-number')).toHaveText('3');
  await expect(phone.locator('.player-balance')).toHaveText('600');await expect(undo).toBeDisabled();
  for(const [value,count] of [[1,10],[5,8],[25,6],[100,4]])await expect(phone.locator(`[data-value="${value}"] .stack-count`)).toHaveText(`${count} × ${value}`);
  await send(page,host,player.token,'bet',{amount:2});await expect(undo).toBeEnabled();await expect(undo.locator('small')).toHaveText('1');
  await undo.click();await expect(undo).toBeDisabled();await expect(phone.locator('.player-balance')).toHaveText('600');
  await phone.reload();await expect(phone.locator('.player-balance')).toHaveText('600');
  expect(errors).toEqual([]);await context.close();
});
