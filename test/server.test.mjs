import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('server enforces roles, deduplicates bets, hides credentials and restores tables',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'clubhouse-api-'));
  const port=3299,base=`http://127.0.0.1:${port}`;
  let child;
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server did not start')),5000);
      child.stdout.on('data',chunk=>{if(chunk.toString().includes('Laptop:')){clearTimeout(timer);resolve();}});
      child.on('error',e=>{clearTimeout(timer);reject(e);});
      child.on('exit',code=>{clearTimeout(timer);if(code)reject(new Error(`Server exited with ${code}`));});
    });
  }
  async function stop(){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
  async function request(url,token,data){
    const response=await fetch(base+url,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
    return {status:response.status,data:await response.json()};
  }
  try{
    await start();
    const created=await request('/api/rooms',null,{});assert.equal(created.status,201);
    const {code,token:host}=created.data;const route=`/api/rooms/${code}`;
    assert.equal((await request(route)).status,401);
    const a=(await request(route+'/join',null,{name:'Alice',seat:'bottom'})).data;
    const b=(await request(route+'/join',null,{name:'Bob',seat:'top'})).data;
    const publicJson=JSON.stringify(a.state);assert.ok(!publicJson.includes(host));assert.ok(!publicJson.includes(a.token));
    assert.equal((await request(route+'/action',a.token,{action:'loan',playerId:a.playerId,amount:500,requestId:'unauthorized'})).status,403);
    assert.equal((await request(route+'/action',host,{action:'bet',playerId:a.playerId,amount:10,requestId:'host-bet'})).status,403);
    const wager={action:'bet',amount:25,requestId:'same-bet'};
    assert.equal((await request(route+'/action',a.token,wager)).status,200);
    const duplicate=await request(route+'/action',a.token,wager);assert.equal(duplicate.data.state.players[0].balance,975);
    assert.equal((await request(route+'/action',b.token,{action:'bet',amount:-10,requestId:'invalid'})).status,400);
    await request(route+'/action',b.token,{action:'bet',amount:10,requestId:'bob-bet'});
    const award=await request(route+'/action',host,{action:'award',winners:{'pot-0':[a.playerId]},requestId:'award'});
    assert.equal(award.status,200);assert.deepEqual(award.data.state.players.map(p=>p.balance),[1010,990]);
    await request(route+'/action',host,{action:'loan',playerId:a.playerId,amount:100,requestId:'loan'});
    await stop();await start();
    const restored=await request(route,a.token);assert.equal(restored.status,200);assert.equal(restored.data.playerId,a.playerId);
    assert.equal(restored.data.state.players[0].balance,1110);assert.equal(restored.data.state.players[0].debt,100);assert.equal(restored.data.state.hand,2);
    const allIn={action:'all-in',requestId:'alice-all-in',chipCounts:{1:10,5:0,25:0,100:11}};
    const shoved=await request(route+'/action',a.token,allIn);assert.equal(shoved.status,200);
    assert.equal(shoved.data.state.players[0].balance,0);
    assert.equal((await request(route+'/action',a.token,allIn)).data.state.players[0].contribution,1110);
    const called=await request(route+'/action',b.token,{action:'call',requestId:'bob-short-call'});
    assert.deepEqual(called.data.state.pots.map(p=>p.amount),[1980,120]);
    assert.deepEqual(called.data.state.pots[0].eligible,[a.playerId,b.playerId]);
    assert.equal(called.data.state.pots[1].refund,a.playerId);
    const paid=await request(route+'/action',host,{action:'award',winners:{'pot-0':[b.playerId]},requestId:'side-pot-award'});
    assert.deepEqual(paid.data.state.players.map(p=>p.balance),[120,1980]);
  }finally{if(child?.exitCode===null)await stop();}
});
