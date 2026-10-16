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
    await request(route+'/action',host,{action:'settings',playerCount:4,requestId:'setup'});
    const a=(await request(route+'/join',null,{name:'Alice',seat:'seat-0'})).data;
    const b=(await request(route+'/join',null,{name:'Bob',seat:'seat-2'})).data;
    const tokens=new Map([[a.playerId,a.token],[b.playerId,b.token]]);
    let current;
    let serial=0;
    async function act(token,action,data={}){
      const result=await request(route+'/action',token,{action,requestId:`action-${++serial}`,turnId:current?.betting.turnId,...data});
      assert.equal(result.status,200,result.data.error);current=result.data.state;return result;
    }
    async function showdown(){
      for(let limit=0;current.betting.phase!=='showdown';limit++){
        assert.ok(limit<30);
        if(current.betting.phase==='between')await act(host,'next-street');
        else{
          const p=current.players.find(p=>p.id===current.betting.actorId);
          await act(tokens.get(p.id),p.actions.canCheck?'check':'call');
        }
      }
    }
    await act(host,'start-hand');
    assert.deepEqual(current.players.map(p=>p.balance),[599,598]);
    const savedTurn=structuredClone(current.betting);
    await stop();await start();current=(await request(route,host)).data.state;
    assert.deepEqual(current.betting,savedTurn);
    const publicJson=JSON.stringify(current);assert.ok(!publicJson.includes(host));assert.ok(!publicJson.includes(a.token));assert.ok(!('undoHistory' in current));
    assert.equal((await request(route+'/action',b.token,{action:'fold',turnId:current.betting.turnId,requestId:'out-of-turn'})).status,400);
    assert.equal((await request(route+'/action',a.token,{action:'loan',playerId:a.playerId,amount:500,requestId:'unauthorized'})).status,403);
    assert.equal((await request(route+'/action',host,{action:'bet',playerId:a.playerId,amount:10,requestId:'host-bet'})).status,403);
    const wager={action:'bet',amount:25,turnId:current.betting.turnId,requestId:'same-bet'};
    await act(a.token,'bet',wager);assert.equal(current.players[0].balance,574);
    const revision=current.revision;
    const duplicate=await request(route+'/action',a.token,wager);assert.equal(duplicate.data.state.revision,revision);
    assert.equal(duplicate.data.state.players[0].balance,574);
    await act(b.token,'call');assert.equal(current.betting.phase,'between');
    await showdown();await act(host,'award',{winners:{'pot-0':[a.playerId]}});
    assert.deepEqual(current.players.map(p=>p.balance),[626,574]);
    await act(host,'loan',{playerId:a.playerId,amount:100});
    await stop();await start();
    const restored=await request(route,a.token);assert.equal(restored.status,200);assert.equal(restored.data.playerId,a.playerId);
    current=restored.data.state;assert.equal(current.players[0].balance,726);assert.equal(current.players[0].debt,100);
    await act(host,'start-hand');assert.equal(current.betting.buttonId,b.playerId);
    const allIn={action:'all-in',requestId:'bob-all-in',turnId:current.betting.turnId};
    await act(b.token,'all-in',allIn);assert.equal(current.players[1].balance,0);
    assert.equal((await request(route+'/action',b.token,allIn)).data.state.players[1].contribution,574);
    const callTurn=current.betting.turnId;
    await act(a.token,'call',{requestId:'alice-call'});
    assert.equal(current.betting.phase,'between');assert.deepEqual(current.pots.map(p=>p.amount),[1148]);
    await showdown();await act(host,'award',{winners:{'pot-0':[b.playerId]}});
    assert.deepEqual(current.players.map(p=>p.balance),[152,1148]);
    assert.equal((await request(route+'/action',a.token,{action:'undo',requestId:'player-undo'})).status,403);
    await act(host,'undo',{requestId:'undo-award'});assert.equal(current.betting.phase,'showdown');assert.equal(current.hand,2);
    const undoRevision=current.revision;
    const retry=await request(route+'/action',host,{action:'undo',requestId:'undo-award'});assert.equal(retry.data.state.revision,undoRevision);
    // Deal-river is the second saved action; undo consumes it without creating redo history.
    await act(host,'undo');assert.equal(current.betting.phase,'between');assert.equal(current.undoCount,0);
    assert.equal((await request(route+'/action',host,{action:'undo',requestId:'third-undo'})).status,400);
    const oldCall=await request(route+'/action',a.token,{action:'call',requestId:'alice-call',turnId:callTurn});assert.equal(oldCall.data.state.undoCount,0);
    await act(host,'next-street');assert.equal(current.undoCount,1);
    await stop();await start();
    current=(await request(route,host)).data.state;assert.equal(current.undoCount,1);assert.equal(current.betting.phase,'showdown');
    await act(host,'undo');assert.equal(current.betting.phase,'between');assert.equal(current.undoCount,0);
    assert.equal(current.players.reduce((sum,p)=>sum+p.balance+p.contribution,0),1300);
  }finally{if(child?.exitCode===null)await stop();}
});
