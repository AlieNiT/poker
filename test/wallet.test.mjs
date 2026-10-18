import test from 'node:test';
import assert from 'node:assert/strict';
import {denominations,makeWallet,walletValue,validWallet,spend,exchanges,exchange,chipCounts,rollover} from '../public/wallet.js';

const wallet = counts => ({5:0,10:0,25:0,50:0,100:0,...counts});

test('change and spending conserve value across small, mixed, and large wallets',()=>{
  for(const balance of [0,5,10,20,25,30,95,100,995,1000,1000000]){
    const chips=makeWallet(balance);assert.ok(validWallet(chips,balance));
    for(const amount of [0,Math.floor(balance/15)*5,balance])assert.ok(validWallet(spend(chips,amount),balance-amount));
  }
  assert.ok(validWallet(spend(wallet({100:1}),30),70));
  assert.throws(()=>spend(makeWallet(25),30));
  assert.throws(()=>spend(makeWallet(25),1));
  assert.throws(()=>makeWallet(26));
});
test('exchange breaks or combines chips at equal value and only offers missing denominations',()=>{
  const hundreds=wallet({100:3});
  for(const option of exchanges(hundreds)){
    assert.ok(validWallet(option.wallet,300));
    assert.equal(walletValue(option.give),walletValue(option.receive));
    assert.ok(option.wallet[option.target]>0);
  }
  assert.deepEqual(exchange(hundreds,25).wallet,wallet({25:4,100:2}));
  assert.deepEqual(exchange(wallet({25:1}),10).wallet,wallet({5:1,10:2}));
  assert.deepEqual(exchange(wallet({10:3}),25).wallet,wallet({5:1,25:1}));
  assert.equal(exchange(hundreds,100),null);
  assert.deepEqual(exchanges(makeWallet(0)),[]);
  assert.equal(exchange(wallet({5:1}),10),null);
});
test('staged chips remain part of the wallet, including when restoring a phone',()=>{
  const chips=wallet({5:2,100:1});
  const combined=chipCounts(chips,[{value:25},{value:25}]);
  assert.ok(validWallet(combined,160));
  const swapped=exchange(chips,25).wallet;
  assert.equal(walletValue(chipCounts(swapped,[{value:25},{value:25}])),160);
});
test('600 starts with the requested chip counts and denominations',()=>{
  assert.deepEqual(denominations,[5,10,25,50,100]);
  assert.deepEqual(makeWallet(600),{5:5,10:5,25:5,50:4,100:2});
});
test('rollover cascades upward with whole chip counts and preserves value',()=>{
  const threshold=wallet({5:10,10:10,25:10,50:10,100:20});assert.deepEqual(rollover(threshold),threshold);
  for(const tens of [0,9,10,11,49,50,10000]){
    const original=wallet({5:51,10:tens,25:32,50:21,100:42}),next=rollover(original);
    assert.ok(validWallet(next,walletValue(original)));
    assert.ok([5,10,25,50].every(v=>next[v]<=10));
    assert.deepEqual(rollover(next),next);assert.equal(original[10],tens);
  }
  assert.deepEqual(rollover(wallet({10:11})),wallet({10:6,25:2}));
});
test('spending and exchanges preserve value for every small mixed wallet',()=>{
  for(let fives=0;fives<4;fives++)for(let tens=0;tens<4;tens++)for(let quarters=0;quarters<4;quarters++){
    const chips=wallet({5:fives,10:tens,25:quarters,50:1}),balance=walletValue(chips);
    for(let amount=0;amount<=balance;amount+=5)assert.ok(validWallet(spend(chips,amount),balance-amount));
    for(const option of exchanges(chips))assert.ok(validWallet(option.wallet,balance));
  }
});
