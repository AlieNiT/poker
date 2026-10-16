import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const base=process.env.DEMO_ORIGIN || 'http://127.0.0.1:3000';
const output=path.resolve('docs/images');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await context.newPage();await page.goto(base);
  await page.waitForSelector('[data-hosting-action="create"],#settings-form');
  const create=page.getByRole('button',{name:'Create a table',exact:true});if(await create.isVisible())await create.click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const host=await page.evaluate(()=>JSON.parse(localStorage.getItem('clubhouse-host')));
  const route=`${base}/api/rooms/${host.code}`;
  async function state(){return (await (await page.request.get(route,{headers:{Authorization:`Bearer ${host.token}`}})).json()).state;}
  async function act(action,extra={}){
    const before=await state();
    const response=await page.request.post(route+'/action',{headers:{Authorization:`Bearer ${host.token}`},data:{action,turnId:before.betting.turnId,requestId:crypto.randomUUID(),...extra}});
    if(!response.ok())throw new Error(`Screenshot setup failed: ${response.status()}`);
  }
  await act('demo');
  let current=await state();await act('bet',{playerId:current.betting.actorId,amount:25});
  for(let i=0;i<3;i++){current=await state();await act('call',{playerId:current.betting.actorId});}
  await page.waitForTimeout(5000);
  await page.screenshot({path:path.join(output,'laptop-game.png')});
  current=await state();
  await page.getByRole('button',{name:`Manage ${current.players.find(player=>player.id===current.betting.actorId).name}`,exact:true}).click();
  await page.getByRole('button',{name:/Preview .* phone/}).click();
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(output,'mobile-game.png')});
  console.log('Saved laptop-game.png and mobile-game.png to docs/images.');
}finally{await browser.close();}
