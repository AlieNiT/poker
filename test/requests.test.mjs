import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchJSON,submitAction} from '../public/requests.js';

test('a stalled request times out and retries the identical action ID',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(path,options)=>{
    calls.push(JSON.parse(options.body));
    if(calls.length===1)await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    return Response.json({state:{revision:2}});
  };
  try{
    const payload={action:'bet',amount:25,requestId:'one-charge'};
    assert.equal((await submitAction('/action',payload,{},20)).state.revision,2);
    assert.deepEqual(calls,[payload,payload]);
  }finally{globalThis.fetch=original;}
});
test('validation errors are surfaced without retrying, and every response body is timed out',async()=>{
  const original=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;return Response.json({error:'Not enough chips.'},{status:400});};
  try{
    await assert.rejects(submitAction('/action',{requestId:'invalid'},{},20),error=>error.status===400 && error.message==='Not enough chips.');
    assert.equal(count,1);
    globalThis.fetch=async(path,options)=>({ok:true,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
    await assert.rejects(fetchJSON('/state',{},20),/did not respond/);
  }finally{globalThis.fetch=original;}
});
