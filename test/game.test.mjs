import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,bet,hostAction,potsFor,snapshot,rememberAction} from '../game.mjs';

function table(count=4){const r=createRoom('ABCD','host');r.seatIds=['bottom','left','top','right'];r.startingStack=1000;['bottom','left','top','right'].slice(0,count).forEach((seat,i)=>joinRoom(r,{name:`Player ${i+1}`,seat}));return r;}
function total(r){return r.players.reduce((n,p)=>n+p.balance+p.contribution,0);}
test('four unique seats; joining during a hand is rejected',()=>{
  const r=table();assert.throws(()=>joinRoom(r,{name:'Fifth',seat:'bottom'}),/taken/);
  const two=table(2);assert.throws(()=>joinRoom(two,{name:'Duplicate',seat:'bottom'}),/taken/);
  bet(two,two.players[0],5);assert.throws(()=>joinRoom(two,{name:'Late',seat:'top'}),/next hand/);
});
test('calling matches total contributions without tracking streets and is capped at the stack',()=>{
  const r=table(2);bet(r,r.players[0],80);bet(r,r.players[1],20);bet(r,r.players[1],undefined,true);
  assert.equal(r.players[1].contribution,80);assert.equal(total(r),2000);
  bet(r,r.players[0],50);bet(r,r.players[1],undefined,true);assert.equal(r.players[1].contribution,130);
  r.players[1].balance=10;bet(r,r.players[0],50);bet(r,r.players[1],undefined,true);assert.equal(r.players[1].balance,0);
});
test('layered side pots, folded contributions, and uncalled chips preserve all chips',()=>{
  const r=table();[100,300,300,500].forEach((n,i)=>bet(r,r.players[i],n));
  hostAction(r,'inHand',{playerId:r.players[2].id,value:false});
  const pots=potsFor(r);assert.deepEqual(pots.map(p=>p.amount),[400,600,200]);
  assert.deepEqual(pots[1].eligible,[r.players[1].id,r.players[3].id]);assert.equal(pots[2].refund,r.players[3].id);
  const winners={'pot-0':[r.players[0].id],'pot-1':[r.players[1].id]};
  hostAction(r,'award',{winners});assert.deepEqual(r.players.map(p=>p.balance),[1300,1300,700,700]);
  assert.equal(total(r),4000);assert.equal(r.hand,2);assert.ok(r.players.every(p=>p.inHand));
});
test('invalid award is atomic, and ineligible players cannot win a side pot',()=>{
  const r=table(3);[50,100,100].forEach((n,i)=>bet(r,r.players[i],n));const before=JSON.stringify(r);
  assert.throws(()=>hostAction(r,'award',{winners:{'pot-0':[r.players[0].id],'pot-1':[r.players[0].id]}}),/eligible/);
  assert.equal(JSON.stringify(r),before);
  assert.throws(()=>hostAction(r,'award',{winners:{'pot-0':[r.players[0].id]}}),/eligible/);
});
test('split pot odd chips go in clockwise seat order',()=>{
  const r=table(3);r.players.forEach(p=>bet(r,p,5));
  hostAction(r,'award',{winners:{'pot-0':[r.players[1].id,r.players[0].id]}});
  assert.deepEqual(r.players.map(p=>p.balance),[1005,1000,995]);assert.equal(total(r),3000);
});
test('loan and repayment are bounded; all-in loans wait until the next hand',()=>{
  const r=table(2),p=r.players[0];hostAction(r,'loan',{playerId:p.id,amount:500});assert.equal(p.debt,500);assert.equal(p.balance,1500);
  assert.throws(()=>hostAction(r,'repay',{playerId:p.id,amount:505}),/exceed/);
  hostAction(r,'repay',{playerId:p.id,amount:200});assert.equal(p.debt,300);assert.equal(p.balance,1300);
  bet(r,p,1300);assert.throws(()=>hostAction(r,'loan',{playerId:p.id,amount:500}),/after this hand/);
});
test('bets must be positive whole chips and cannot exceed the balance',()=>{
  const r=table(2),p=r.players[0];for(const n of [-1,0,.5,1,6,NaN,1001])assert.throws(()=>bet(r,p,n));
  assert.equal(p.balance,1000);assert.equal(p.contribution,0);
  hostAction(r,'inHand',{playerId:p.id,value:false});assert.throws(()=>bet(r,p,5),/out of this hand/);
});
test('a payout preview cannot silently award changed pots',()=>{
  const r=table(2);r.players.forEach(p=>bet(r,p,25));const expectedPots=potsFor(r);
  bet(r,r.players[0],5);const before=JSON.stringify(r);
  assert.throws(()=>hostAction(r,'award',{expectedPots,winners:{'pot-0':[r.players[0].id]}}),/pots changed/);
  assert.equal(JSON.stringify(r),before);
});
test('compact chip counts accept large selections and reject mismatched exchanges atomically',()=>{
  const room=table(2),player=room.players[0],before=JSON.stringify(room);
  for(const counts of [{5:300,10:0,25:0,50:0,100:0},{5:-1,10:0,25:0,50:0,100:1},{5:0,10:0,25:0,50:0,100:1.5},{1:0,5:0,10:0,25:0,50:0,100:1}]){
    assert.throws(()=>bet(room,player,100,false,undefined,counts),/match/);
    assert.equal(JSON.stringify(room),before);
  }
  bet(room,player,300,false,undefined,{5:60,10:0,25:0,50:0,100:0});
  assert.equal(player.balance,700);assert.equal(room.lastEvent.chipCounts[5],60);
  assert.equal(total(room),2000);
});

test('new tables default to 600 and support a host-selected table with more than four players',()=>{
  const room=createRoom('MANY','host');
  assert.equal(room.startingStack,600);
  hostAction(room,'settings',{playerCount:9});
  room.seatIds.forEach((seat,i)=>joinRoom(room,{name:`Guest ${i}`,seat}));
  assert.equal(room.players.length,9);
  assert.ok(room.players.every(p=>p.balance===600));
  assert.throws(()=>joinRoom(room,{name:'Extra',seat:'seat-9'}),/taken/);
  assert.throws(()=>hostAction(room,'settings',{playerCount:8}),/before players join/);
  const before=JSON.stringify(room);
  assert.throws(()=>hostAction(room,'settings',{name:'Changed',startingStack:700,playerCount:1}));
  assert.equal(JSON.stringify(room),before);
});

test('undo consumes at most two snapshots and a new action creates only one new undo',()=>{
  const room=createRoom('UNDO','host');hostAction(room,'settings',{playerCount:6});
  const player=joinRoom(room,{name:'Alex',seat:room.seatIds[0]});
  const act=(fn)=>{const before=snapshot(room);fn();rememberAction(room,before);};
  act(()=>bet(room,room.players[0],25));
  act(()=>hostAction(room,'loan',{playerId:player.id,amount:100}));
  act(()=>hostAction(room,'inHand',{playerId:player.id,value:false}));
  assert.equal(room.undoHistory.length,2);
  const revision=room.revision;
  hostAction(room,'undo',{});assert.equal(room.players[0].inHand,true);
  hostAction(room,'undo',{});assert.equal(room.players[0].balance,575);assert.equal(room.players[0].debt,0);
  assert.equal(room.undoHistory.length,0);assert.equal(room.undoVersion,2);assert.ok(room.revision>revision);
  assert.throws(()=>hostAction(room,'undo',{}),/no actions/);
  act(()=>bet(room,room.players[0],5));assert.equal(room.undoHistory.length,1);
  hostAction(room,'undo',{});assert.equal(room.players[0].balance,575);assert.equal(room.undoVersion,3);
  assert.throws(()=>hostAction(room,'undo',{}),/no actions/);
});

test('undo restores a paid hand including contributions, folds, side pots and hand number',()=>{
  const room=table(3);[100,200,300].forEach((amount,i)=>bet(room,room.players[i],amount));
  hostAction(room,'inHand',{playerId:room.players[1].id,value:false});
  const before=snapshot(room),pots=potsFor(room);
  hostAction(room,'award',{winners:{'pot-0':[room.players[0].id],'pot-1':[room.players[2].id]}});
  rememberAction(room,before);hostAction(room,'undo',{});
  assert.equal(room.hand,1);assert.deepEqual(potsFor(room),pots);
  assert.deepEqual(room.players,before.players);
});

test('folded tiers merge without losing a genuine side pot or uncalled refund',()=>{
  const room=table();
  [100,300,500,200].forEach((amount,i)=>bet(room,room.players[i],amount));
  hostAction(room,'inHand',{playerId:room.players[3].id,value:false});
  const pots=potsFor(room);
  assert.deepEqual(pots,[
    {id:'pot-0',amount:400,eligible:room.players.slice(0,3).map(p=>p.id),refund:null,cap:100},
    {id:'pot-1',amount:500,eligible:room.players.slice(1,3).map(p=>p.id),refund:null,cap:300},
    {id:'pot-2',amount:200,eligible:[room.players[2].id],refund:room.players[2].id,cap:500}
  ]);
  hostAction(room,'award',{winners:{'pot-0':[room.players[0].id],'pot-1':[room.players[1].id]}});
  assert.deepEqual(room.players.map(p=>p.balance),[1300,1200,700,800]);
  assert.equal(total(room),4000);
});

test('folded tiers merge for split payouts while an unmatched excess stays a refund',()=>{
  const room=table(3);
  [5,20,15].forEach((amount,i)=>bet(room,room.players[i],amount));
  hostAction(room,'inHand',{playerId:room.players[0].id,value:false});
  const pots=potsFor(room);
  assert.deepEqual(pots.map(p=>({id:p.id,amount:p.amount,eligible:p.eligible,refund:p.refund})),[
    {id:'pot-0',amount:35,eligible:room.players.slice(1).map(p=>p.id),refund:null},
    {id:'pot-1',amount:5,eligible:[room.players[1].id],refund:room.players[1].id}
  ]);
  hostAction(room,'award',{winners:{'pot-0':room.players.slice(1).map(p=>p.id)}});
  assert.deepEqual(room.players.map(p=>p.balance),[995,1005,1000]);
  assert.equal(total(room),3000);
});

test('new chip values are accepted and monetary settings reject amounts outside multiples of five',()=>{
  const room=table(2),player=room.players[0];
  bet(room,player,60,false,[50,10]);
  assert.equal(player.balance,940);
  const before=JSON.stringify(room);
  assert.throws(()=>bet(room,player,5,false,[1,1,1,1,1]),/match/);
  for(const data of [{startingStack:601},{smallBlind:1},{bigBlind:12}])assert.throws(()=>hostAction(room,'settings',data));
  assert.equal(JSON.stringify(room),before);
});
