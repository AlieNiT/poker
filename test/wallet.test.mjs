import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWallet,walletValue,validWallet,spend,exchanges,exchange,chipCounts,rollover} from '../public/wallet.js';

test('change and spending conserve value across small, mixed, and large wallets',()=>{
  for(const balance of [0,1,4,5,24,25,26,99,100,999,1000,1000000]){
    const wallet=makeWallet(balance);assert.ok(validWallet(wallet,balance));
    for(const amount of [0,Math.floor(balance/3),balance])assert.ok(validWallet(spend(wallet,amount),balance-amount));
  }
  assert.deepEqual(spend({1:0,5:0,25:0,100:1},26),{1:4,5:4,25:2,100:0});
  assert.throws(()=>spend(makeWallet(25),26));
});
test('exchange breaks or combines chips at equal value and only offers missing denominations',()=>{
  const hundreds={1:0,5:0,25:0,100:3};
  for(const option of exchanges(hundreds)){
    assert.ok(validWallet(option.wallet,300));
    assert.equal(walletValue(option.give),walletValue(option.receive));
    assert.ok(option.wallet[option.target]>0);
  }
  assert.deepEqual(exchange(hundreds,25).wallet,{1:0,5:0,25:4,100:2});
  assert.deepEqual(exchange({1:5,5:0,25:0,100:0},5).wallet,{1:0,5:1,25:0,100:0});
  assert.equal(exchange(hundreds,100),null);
  assert.deepEqual(exchanges(makeWallet(0)),[]);
  assert.equal(exchange({1:4,5:0,25:0,100:0},5),null);
});
test('staged chips remain part of the wallet, including when restoring a phone',()=>{
  const wallet={1:0,5:2,25:0,100:1};
  const combined=chipCounts(wallet,[{value:25},{value:25}]);
  assert.ok(validWallet(combined,160));
  const swapped=exchange(wallet,25).wallet;
  assert.equal(walletValue(chipCounts(swapped,[{value:25},{value:25}])),160);
});

test('600 starts with the requested chip counts',()=>{
  assert.deepEqual(makeWallet(600),{1:10,5:8,25:6,100:4});
});
test('rollover cascades upward, preserves value and leaves at most ten lower chips',()=>{
  assert.deepEqual(rollover({1:50,5:8,25:0,100:0}),{1:10,5:6,25:2,100:0});
  const threshold={1:10,5:10,25:10,100:20};assert.deepEqual(rollover(threshold),threshold);
  for(const ones of [0,9,10,11,49,50,10000]){
    const original={1:ones,5:51,25:32,100:42},next=rollover(original);
    assert.equal(walletValue(next),walletValue(original));
    assert.ok([1,5,25].every(v=>next[v]>=0 && next[v]<=10));
    assert.deepEqual(rollover(next),next);assert.equal(original[1],ones);
  }
  assert.deepEqual(rollover({1:0,5:0,25:11,100:3}),{1:0,5:0,25:7,100:4});
});
