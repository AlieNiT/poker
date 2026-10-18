import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,hostAction,playerAction,bettingOptions,startHand,nextStreet,potsFor,snapshot,rememberAction} from '../game.mjs';

function table(count=4, balances=[]) {
  const room=createRoom('TURN','host');hostAction(room,'settings',{playerCount:Math.max(2,count)});
  for(let i=0;i<count;i++){
    const player=joinRoom(room,{name:`Player ${i}`,seat:room.seatIds[i]});
    player.balance=balances[i] ?? 600;
  }
  startHand(room);return room;
}
function move(room,action,amount){
  const player=room.players.find(p=>p.id===room.betting.actorId);
  playerAction(room,player,action,{amount,turnId:room.betting.turnId});
}
function endRound(room){
  let limit=100;
  while(room.betting.phase==='betting'){
    if(--limit===0)throw new Error('Betting did not finish');
    const player=room.players.find(p=>p.id===room.betting.actorId);
    move(room,bettingOptions(room,player).canCheck?'check':'call');
  }
}
const actor=room=>room.players.findIndex(p=>p.id===room.betting.actorId);
const total=room=>room.players.reduce((sum,p)=>sum+p.balance+p.contribution,0);

test('5/10 blinds, initial action, big blind option, and postflop order',()=>{
  const room=table();assert.deepEqual(room.players.map(p=>p.roundContribution),[0,5,10,0]);
  assert.equal(actor(room),3);assert.equal(room.betting.buttonId,room.players[0].id);
  move(room,'call');assert.equal(actor(room),0);move(room,'call');assert.equal(actor(room),1);move(room,'call');
  assert.equal(actor(room),2);assert.equal(room.betting.phase,'betting');assert.ok(bettingOptions(room,room.players[2]).canCheck);
  move(room,'check');assert.equal(room.betting.phase,'between');assert.ok(room.players.every(p=>p.roundContribution===0));
  assert.equal(total(room),2400);assert.equal(potsFor(room)[0].amount,40);
  nextStreet(room);assert.equal(room.betting.street,'flop');assert.equal(actor(room),1);
  endRound(room);nextStreet(room);assert.equal(room.betting.street,'turn');endRound(room);
  nextStreet(room);assert.equal(room.betting.street,'river');endRound(room);assert.equal(room.betting.phase,'showdown');
});

test('heads-up button posts small blind and acts first preflop, last postflop',()=>{
  const room=table(2);assert.deepEqual(room.players.map(p=>p.roundContribution),[5,10]);assert.equal(actor(room),0);
  endRound(room);nextStreet(room);assert.equal(actor(room),1);move(room,'check');assert.equal(actor(room),0);
});

test('out-of-turn, stale turns, undercalls and illegal checks are atomic',()=>{
  const room=table(), player=room.players[3], before=JSON.stringify(room);
  for(const [p,action,data] of [
    [room.players[0],'fold',{turnId:room.betting.turnId}],
    [player,'call',{turnId:'old-turn'}],
    [player,'check',{turnId:room.betting.turnId}],
    [player,'bet',{amount:5,turnId:room.betting.turnId}],
    [player,'bet',{amount:20,turnId:room.betting.turnId,chipCounts:{5:3,10:0,25:0,50:0,100:0}}]
  ]){assert.throws(()=>playerAction(room,p,action,data));assert.equal(JSON.stringify(room),before);}
});

test('any increase reopens betting, even below the previous raise size',()=>{
  const room=table();move(room,'bet',50);assert.equal(actor(room),0);
  assert.equal(bettingOptions(room,room.players[0]).minimumTotal,55);
  move(room,'bet',55);assert.equal(room.betting.currentBet,55);
  move(room,'bet',55); // Small blind raises its total to 60 by adding 55.
  assert.equal(room.betting.currentBet,60);
  endRound(room);assert.equal(room.betting.phase,'between');assert.ok(room.players.every(p=>p.contribution===60));
});

test('a small all-in increase lets earlier callers raise again',()=>{
  const room=table(3,[600,15,600]);
  move(room,'call');move(room,'all-in');
  assert.equal(actor(room),2);move(room,'call');assert.equal(actor(room),0);
  assert.equal(bettingOptions(room,room.players[0]).canRaise,true);
  move(room,'bet',10);assert.equal(room.betting.currentBet,20);
  endRound(room);assert.equal(room.betting.phase,'between');assert.equal(total(room),1215);
});

test('cumulative short all-ins reopen a raise for a player who previously called',()=>{
  const room=table(5,[20,600,600,600,15]);
  move(room,'call'); // Player 3 has acted at the 10 blind.
  move(room,'all-in');move(room,'all-in');move(room,'call');move(room,'call');
  assert.equal(actor(room),3);assert.equal(bettingOptions(room,room.players[3]).canRaise,true);
  move(room,'bet',20);assert.equal(room.betting.currentBet,30);
  endRound(room);assert.equal(room.betting.phase,'between');
});

test('a five-chip opening is allowed and reopens betting after a check',()=>{
  const room=table(3,[600,600,15]);endRound(room);nextStreet(room);
  move(room,'check');move(room,'all-in');
  assert.equal(room.betting.currentBet,5);assert.equal(actor(room),0);
  assert.equal(bettingOptions(room,room.players[0]).minimumTotal,10);
  move(room,'bet',10);assert.equal(room.betting.currentBet,10);
  assert.equal(actor(room),1);assert.equal(bettingOptions(room,room.players[1]).canRaise,true);
  move(room,'bet',15);endRound(room);assert.equal(room.betting.phase,'between');
});

test('folds skip players and award the pot automatically to the last player',()=>{
  const room=table(3);const before=total(room);move(room,'fold');assert.equal(actor(room),1);
  move(room,'fold');assert.equal(room.betting.phase,'waiting');assert.equal(room.hand,2);
  assert.deepEqual(room.players.map(p=>p.balance),[600,595,605]);assert.equal(total(room),before);
});

test('an all-in caller is skipped on later streets and no one bets against only all-in players',()=>{
  const room=table(3,[600,15,600]);move(room,'bet',50);move(room,'all-in');move(room,'call');
  assert.equal(room.betting.phase,'between');assert.equal(room.players[1].balance,0);
  nextStreet(room);assert.equal(actor(room),2);move(room,'check');assert.equal(actor(room),0);move(room,'check');
  nextStreet(room);move(room,'all-in');move(room,'all-in');assert.equal(room.betting.phase,'between');
  nextStreet(room);assert.equal(room.betting.phase,'showdown');assert.equal(room.betting.actorId,null);
  assert.equal(total(room),1215);
});

test('short blind heads-up closes immediately when the other blind already covers it',()=>{
  const room=table(2,[600,5]);assert.equal(room.betting.phase,'between');assert.equal(room.betting.actorId,null);
  nextStreet(room);nextStreet(room);nextStreet(room);assert.equal(room.betting.phase,'showdown');
  hostAction(room,'award',{winners:{'pot-0':[room.players[0].id]}});assert.equal(total(room),605);
});

test('button rotates clockwise, skipping empty and broke seats',()=>{
  const room=table(4);move(room,'fold');move(room,'fold');move(room,'fold');
  room.players[1].balance=0;room.players=room.players.filter((p,i)=>i!==2);
  startHand(room);assert.equal(room.betting.buttonId,room.players[2].id);
  assert.deepEqual(room.players.filter(p=>p.inHand).length,2);
});

test('undo restores a turn, round contributions, fold eligibility, and automatic payout',()=>{
  const room=table(2);const before=snapshot(room);move(room,'fold');rememberAction(room,before);
  assert.equal(room.hand,2);hostAction(room,'undo',{});assert.equal(room.hand,1);assert.equal(actor(room),0);
  assert.deepEqual(room.players,before.players);assert.deepEqual(room.betting,before.betting);
  move(room,'call');const boundary=snapshot(room);move(room,'check');rememberAction(room,boundary);
  assert.equal(room.betting.phase,'between');hostAction(room,'undo',{});
  assert.equal(room.betting.phase,'betting');assert.equal(actor(room),1);assert.deepEqual(room.players.map(p=>p.roundContribution),[10,10]);
});

test('bank, joining, payouts and host fold overrides cannot change an active hand',()=>{
  const room=table();const before=JSON.stringify(room),id=room.players[0].id;
  for(const fn of [()=>hostAction(room,'loan',{playerId:id,amount:10}),()=>hostAction(room,'repay',{playerId:id,amount:1}),()=>joinRoom(room,{name:'Late',seat:'seat-4'}),()=>hostAction(room,'inHand',{playerId:id,value:false}),()=>hostAction(room,'award',{}),()=>nextStreet(room),()=>startHand(room)]){
    assert.throws(fn);assert.equal(JSON.stringify(room),before);
  }
});

test('a folded blind does not split equally matched players into main and side pots',()=>{
  const room=table(3);
  move(room,'call'); // Button matches the 10 big blind.
  move(room,'fold'); // Small blind leaves 5 chips in the pot.
  move(room,'check');
  for(let i=0;i<3;i++){nextStreet(room);endRound(room);}
  assert.equal(room.betting.phase,'showdown');
  assert.deepEqual(room.players.map(p=>p.contribution),[10,5,10]);
  assert.deepEqual(potsFor(room),[{
    id:'pot-0',amount:25,eligible:[room.players[0].id,room.players[2].id],refund:null,cap:10
  }]);
  hostAction(room,'award',{winners:{'pot-0':[room.players[0].id]}});
  assert.deepEqual(room.players.map(p=>p.balance),[615,595,590]);
  assert.equal(total(room),1800);
});
