import {expect} from '@playwright/test';

export async function setupHost(page,count=4){
  await page.goto('/');await page.getByLabel('Player count').fill(String(count));
  await page.getByRole('button',{name:'Save',exact:true}).click();
  return page.evaluate(()=>JSON.parse(localStorage.getItem('clubhouse-host')));
}
export async function stateFor(page,host){
  const response=await page.request.get(`/api/rooms/${host.code}`,{headers:{Authorization:`Bearer ${host.token}`}});
  expect(response.ok()).toBeTruthy();return (await response.json()).state;
}
export async function send(page,host,token,action,data={}){
  const state=await stateFor(page,host);
  const response=await page.request.post(`/api/rooms/${host.code}/action`,{headers:{Authorization:`Bearer ${token}`},data:{action,turnId:state.betting.turnId,requestId:crypto.randomUUID(),...data}});
  expect(response.ok(),JSON.stringify(await response.json())).toBeTruthy();return stateFor(page,host);
}
export async function startHand(page){
  await page.getByRole('button',{name:'Start hand',exact:true}).click();
  await page.getByRole('button',{name:'Post blinds & start',exact:true}).click();
}
