import { randomUUID } from 'node:crypto';

export const SEATS = ['bottom', 'left', 'top', 'right'];
export const seatsFor = room => room.seatIds || SEATS;
export const seatAngle = (room, seat) => Math.PI / 2 + seatsFor(room).indexOf(seat) * 2 * Math.PI / seatsFor(room).length;
export function snapshot(room) {
  const { undoHistory, processed, revision, ...state } = room;
  return {...structuredClone(state), restoreRevision: revision};
}
export function rememberAction(room, before) {
  room.undoHistory = [...(room.undoHistory || []), before].slice(-2);
}
export function createRoom(code, hostToken) {
  return { code, hostToken, name: 'The home game', hand: 1, startingStack: 600, playerCount: 6, seatIds: Array.from({length:6}, (_,i) => `seat-${i}`), setupComplete: false, undoHistory: [], smallBlind: 1, bigBlind: 2, betting: {phase:'waiting', street:'preflop', actorId:null},
    players: [], history: [], lastEvent: null, processed: [], createdAt: Date.now(), revision: 0 };
}
export function potsFor(room) {
  const levels = [...new Set(room.players.map(p => p.contribution).filter(n => n > 0))].sort((a,b) => a-b);
  let previous = 0;
  const pots = [];
  for (const level of levels) {
    const contributors = room.players.filter(p => p.contribution >= level);
    const eligible = contributors.filter(p => p.inHand).map(p => p.id);
    const amount = (level - previous) * contributors.length;
    const refund = contributors.length === 1 ? contributors[0].id : null;
    const last = pots.at(-1);
    // Folded contributions add chips without creating a different set of winners.
    // Uncalled chips remain a separate refund even if their owner is also eligible.
    if (last && !last.refund && !refund && last.eligible.length === eligible.length && last.eligible.every((id,i) => id === eligible[i])) {
      last.amount += amount;
      last.cap = level;
    } else {
      pots.push({id:`pot-${pots.length}`,amount,eligible,refund,cap:level});
    }
    previous = level;
  }
  return pots;
}
export function log(room, message, kind = 'info', event = {}) {
  const entry = { id: randomUUID(), message, kind, time: Date.now(), ...event };
  room.history.unshift(entry);
  room.history = room.history.slice(0, 60);
  room.lastEvent = entry;
  room.revision++;
}
function integer(value, min = 1, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Enter a whole number from ${min} to ${max.toLocaleString()}.`);
  return value;
}
export function joinRoom(room, { name, seat }, token = randomUUID()) {
  name = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  if (!name) throw new Error('Enter your name to take a seat.');
  if (room.players.length >= seatsFor(room).length) throw new Error('Every seat at this table is taken.');
  if (!seatsFor(room).includes(seat) || room.players.some(p => p.seat === seat)) throw new Error('That seat has just been taken. Choose another.');
  if ((room.betting && room.betting.phase !== 'waiting') || room.players.some(p => p.contribution > 0)) throw new Error('Wait for the next hand before joining.');
  const player = { id: randomUUID(), token, name, seat, balance: room.startingStack, debt: 0, contribution: 0, roundContribution: 0, inHand: true };
  room.players.push(player);
  log(room, `${name} joined the table`, 'join', { playerId: player.id });
  return player;
}
// Transfer chips after the caller has validated the turn and betting rules.
export function bet(room, player, amount, isCall = false, chipValues, chipCounts) {
  if (!player.inHand) throw new Error('You are out of this hand. Wait for the next one.');
  if (isCall) amount = Math.min(player.balance, Math.max(...room.players.map(p => p.contribution), 0) - player.contribution);
  integer(amount);
  if (amount > player.balance) throw new Error('You do not have enough chips.');
  if (chipValues !== undefined && (!Array.isArray(chipValues) || chipValues.length>250 || chipValues.some(v=>![1,5,25,100].includes(v)) || chipValues.reduce((n,v)=>n+v,0)!==amount)) throw new Error('The selected chips do not match the amount.');
  if(chipCounts!==undefined){
    const values=[1,5,25,100];
    if(!chipCounts || typeof chipCounts!=='object' || Array.isArray(chipCounts) || Object.keys(chipCounts).some(v=>!values.includes(Number(v))) || values.some(v=>!Number.isSafeInteger(chipCounts[v]) || chipCounts[v]<0) || values.reduce((sum,v)=>sum+v*chipCounts[v],0)!==amount)throw new Error('The selected chips do not match the amount.');
  }
  player.balance -= amount;
  player.contribution += amount;
  log(room, `${player.name} ${isCall ? 'called' : 'threw'} ${amount.toLocaleString()}${player.balance === 0 ? ' · all in' : ''}`, 'bet', { playerId: player.id, seat: player.seat, angle: seatAngle(room, player.seat), amount, ...(chipValues?{chipValues}:{}), ...(chipCounts?{chipCounts}:{}) });
}
function orderedPlayers(room) {
  return [...room.players].sort((a,b) => seatsFor(room).indexOf(a.seat) - seatsFor(room).indexOf(b.seat));
}
function afterSeat(room, seat, players) {
  const ids = seatsFor(room), index = ids.indexOf(seat);
  return [...players].sort((a,b) => ((ids.indexOf(a.seat)-index-1+ids.length)%ids.length) - ((ids.indexOf(b.seat)-index-1+ids.length)%ids.length))[0];
}
export function nextButton(room) {
  const funded = orderedPlayers(room).filter(p => p.balance > 0);
  return room.buttonSeat === undefined ? funded[0] : afterSeat(room, room.buttonSeat, funded);
}
export function bettingOptions(room, player) {
  const b = room.betting;
  const canAct = b?.phase === 'betting' && b.actorId === player.id && player.inHand && player.balance > 0;
  const owed = Math.max(0, (b?.currentBet || 0) - (player.roundContribution || 0));
  const acted = b?.actedAt?.[player.id];
  const canRaise = canAct && (acted === undefined || b.currentBet - acted >= b.minRaise) && room.players.some(p => p.id !== player.id && p.inHand && p.balance > 0);
  const minimumTotal = (b?.currentBet || 0) + (b?.minRaise || room.bigBlind);
  return {canAct, callAmount:Math.min(player.balance,owed), canCheck:canAct && owed === 0, canRaise,
    minimumTotal, minimumAmount:Math.max(0,minimumTotal-(player.roundContribution || 0))};
}
function finishBettingRound(room) {
  const b = room.betting;
  b.actorId = null; b.turnId = null; b.pending = [];
  b.phase = b.street === 'river' ? 'showdown' : 'between';
  room.players.forEach(p => {p.roundContribution = 0;});
}
function advanceAction(room, previousSeat) {
  const b = room.betting;
  const contenders = room.players.filter(p => p.inHand);
  if (contenders.length === 1) {
    b.phase = 'showdown'; b.actorId = null; b.turnId = null;
    const winners = Object.fromEntries(potsFor(room).map(pot => [pot.id,[contenders[0].id]]));
    hostAction(room,'award',{winners});
    return;
  }
  const active = contenders.filter(p => p.balance > 0);
  // With no opponent able to bet, only an outstanding call or fold remains.
  if (active.length <= 1) {
    const lone = active[0];
    const opponentBet = Math.max(0,...contenders.filter(p => p !== lone).map(p => p.roundContribution || 0));
    if (!lone || lone.roundContribution >= opponentBet) { finishBettingRound(room); return; }
    b.currentBet = opponentBet;
  }
  b.pending = b.pending.filter(id => active.some(p => p.id === id));
  const next = afterSeat(room, previousSeat, active.filter(p => b.pending.includes(p.id)));
  if (!next) { finishBettingRound(room); return; }
  b.actorId = next.id; b.turnId = randomUUID();
}
export function startHand(room, data = {}) {
  if (room.setupComplete === false) throw new Error('Finish setting up the table first.');
  if (room.betting?.phase !== 'waiting' || room.players.some(p => p.contribution > 0)) throw new Error('Finish this hand first.');
  const funded = orderedPlayers(room).filter(p => p.balance > 0);
  if (funded.length < 2) throw new Error('At least two players need chips to start a hand.');
  const button = data.buttonId ? funded.find(p => p.id === data.buttonId) : nextButton(room);
  if (!button) throw new Error('Choose a player with chips for the button.');
  const small = funded.length === 2 ? button : afterSeat(room, button.seat, funded);
  const big = afterSeat(room, small.seat, funded);
  room.buttonSeat = button.seat;
  room.players.forEach(p => {p.inHand = p.balance > 0; p.contribution = 0; p.roundContribution = 0;});
  room.betting = {phase:'betting',street:'preflop',buttonId:button.id,smallBlindId:small.id,bigBlindId:big.id,
    currentBet:room.bigBlind,minRaise:room.bigBlind,actedAt:{},pending:funded.map(p => p.id),actorId:null,turnId:null};
  for (const [player, blind, label] of [[small,room.smallBlind,'small blind'],[big,room.bigBlind,'big blind']]) {
    const amount = Math.min(player.balance,blind);
    bet(room,player,amount); player.roundContribution = amount;
    room.lastEvent.message = `${player.name} posted ${label} · ${amount}`;
  }
  advanceAction(room,big.seat);
  log(room, `Hand ${room.hand} · ${button.name} has the button · blinds ${room.smallBlind}/${room.bigBlind}`, 'hand');
}
export function nextStreet(room) {
  const b = room.betting;
  if (b?.phase !== 'between') throw new Error('Finish the current betting round first.');
  const streets = ['preflop','flop','turn','river'];
  b.street = streets[streets.indexOf(b.street)+1]; b.phase = 'betting';
  b.currentBet = 0; b.minRaise = room.bigBlind; b.actedAt = {};
  b.pending = room.players.filter(p => p.inHand && p.balance > 0).map(p => p.id);
  room.players.forEach(p => {p.roundContribution = 0;});
  advanceAction(room,room.buttonSeat);
  log(room, `${b.street[0].toUpperCase()+b.street.slice(1)} dealt`, 'street');
}
export function playerAction(room, player, action, data = {}) {
  const b = room.betting, options = bettingOptions(room,player);
  if (!options.canAct) throw new Error('Wait for your turn.');
  if (data.turnId !== b.turnId) throw new Error('The turn changed. Review the table before acting.');
  if (action === 'fold') {
    player.inHand = false;
    log(room, `${player.name} folded`, 'fold', {playerId:player.id});
  } else if (action === 'check') {
    if (!options.canCheck) throw new Error('Call the bet or fold. You cannot check.');
    b.actedAt[player.id] = 0;
    log(room, `${player.name} checked`, 'check', {playerId:player.id});
  } else {
    const amount = action === 'call' ? options.callAmount : action === 'all-in' ? player.balance : data.amount;
    integer(amount);
    if (amount > player.balance) throw new Error('You do not have enough chips.');
    const total = player.roundContribution + amount;
    if (total < b.currentBet && amount !== player.balance) throw new Error(`Call ${options.callAmount} or go all in.`);
    if (total > b.currentBet) {
      if (!options.canRaise) throw new Error('Betting has not reopened. You can only call or fold.');
      if (total < options.minimumTotal && amount !== player.balance) throw new Error(`The minimum bet or raise is ${options.minimumAmount}.`);
    }
    // Validate and transfer chips before changing the turn or any raise state.
    bet(room,player,amount,false,data.chipValues,data.chipCounts);
    if (action === 'call') room.lastEvent.message = `${player.name} called ${amount}${player.balance === 0 ? ' · all in' : ''}`;
    const previousBet = b.currentBet;
    player.roundContribution = total;
    if (total > previousBet) {
      const fullRaise = total >= options.minimumTotal;
      if (fullRaise) {
        b.minRaise = total - previousBet;
        b.pending = room.players.filter(p => p.inHand && p.balance > 0 && p.id !== player.id).map(p => p.id);
      } else {
        b.pending = [...new Set([...b.pending,...room.players.filter(p => p.inHand && p.balance > 0 && p.roundContribution < total).map(p => p.id)])];
      }
      b.currentBet = total;
    }
    b.actedAt[player.id] = b.currentBet;
  }
  b.pending = b.pending.filter(id => id !== player.id);
  advanceAction(room,player.seat);
}
export function hostAction(room, action, data) {
  const player = room.players.find(p => p.id === data.playerId);
  switch (action) {
    case 'start-hand': startHand(room,data); break;
    case 'next-street': nextStreet(room); break;
    case 'undo': {
      const before = room.undoHistory?.pop();
      if (!before) throw new Error('There are no actions left to undo.');
      const revision = room.revision, undoVersion = room.undoVersion || 0;
      for (const key of Object.keys(room)) if (!['undoHistory','processed','revision'].includes(key)) delete room[key];
      Object.assign(room, structuredClone(before));
      room.revision = revision;
      room.undoVersion = undoVersion + 1;
      const restoreRevision = room.restoreRevision;
      delete room.restoreRevision;
      log(room, 'Last action undone', 'undo', {restoreRevision});
      break;
    }
    case 'loan': {
      if (!player) throw new Error('Choose a player.');
      const amount = integer(data.amount);
      if (room.betting?.phase !== 'waiting') throw new Error('The bank can move chips after this hand.');
      if (player.balance === 0 && player.contribution > 0) throw new Error('An all-in player can receive a loan after this hand.');
      if (player.balance + amount > 1000000) throw new Error('A stack cannot exceed 1,000,000 chips.');
      player.balance += amount; player.debt += amount;
      log(room, `Bank lent ${player.name} ${amount.toLocaleString()}`, 'loan', { playerId: player.id, amount });
      break;
    }
    case 'repay': {
      if (room.betting?.phase !== 'waiting') throw new Error('The bank can move chips after this hand.');
      if (!player) throw new Error('Choose a player.');
      const amount = integer(data.amount);
      if (amount > player.debt || amount > player.balance) throw new Error('Repayment cannot exceed the loan or available chips.');
      player.balance -= amount; player.debt -= amount;
      log(room, `${player.name} repaid ${amount.toLocaleString()}`, 'loan');
      break;
    }
    case 'inHand': {
      if (room.betting?.phase !== 'waiting') throw new Error('Players fold on their own turn. Use Undo to correct a fold.');
      if (!player) throw new Error('Choose a player.');
      player.inHand = Boolean(data.value);
      log(room, `${player.name} ${player.inHand ? 'is back in the hand' : 'is out of the hand'}`);
      break;
    }
    case 'award': {
      if (room.betting && !['showdown','waiting'].includes(room.betting.phase)) throw new Error('Finish betting before awarding the pot.');
      const pots = potsFor(room);
      if (!pots.length) throw new Error('There are no chips in the pot yet.');
      if (data.expectedPots && JSON.stringify(data.expectedPots) !== JSON.stringify(pots)) throw new Error('The pots changed while you were choosing winners. Review them again.');
      const payouts = new Map();
      const messages = [];
      // Validate every pot before changing any balance.
      for (const [index, pot] of pots.entries()) {
        const winners = pot.refund ? [pot.refund] : data.winners?.[pot.id];
        if (!Array.isArray(winners) || !winners.length || new Set(winners).size !== winners.length || winners.some(id => !pot.refund && !pot.eligible.includes(id))) throw new Error('Choose an eligible winner for every pot.');
        const sorted = room.players.filter(p => winners.includes(p.id)).sort((a,b) => seatsFor(room).indexOf(a.seat) - seatsFor(room).indexOf(b.seat));
        if (sorted.length !== winners.length) throw new Error('A selected player is no longer at the table.');
        sorted.forEach((p, i) => {
          const amount = Math.floor(pot.amount / sorted.length) + (i < pot.amount % sorted.length ? 1 : 0);
          payouts.set(p.id, (payouts.get(p.id) || 0) + amount);
        });
        messages.push(pot.refund ? `${sorted[0].name} receives ${pot.amount} uncalled chips` : `${sorted.map(p => p.name).join(' & ')} ${sorted.length > 1 ? 'split' : 'wins'} ${index === 0 ? 'the main pot' : `side pot ${index}`} · ${pot.amount.toLocaleString()}`);
      }
      room.players.forEach(p => { p.balance += payouts.get(p.id) || 0; p.contribution = 0; p.roundContribution = 0; p.inHand = true; });
      room.hand++;
      room.betting = {phase:'waiting',street:'preflop',actorId:null};
      log(room, messages.join(' / '), 'award', { payouts: Object.fromEntries(payouts) });
      break;
    }
    case 'settings': {
      const smallBlind = data.smallBlind === undefined ? room.smallBlind : integer(data.smallBlind,1,100000);
      const bigBlind = data.bigBlind === undefined ? room.bigBlind : integer(data.bigBlind,1,100000);
      if (smallBlind > bigBlind) throw new Error('The big blind must be at least the small blind.');
      if (room.betting?.phase !== 'waiting' && (smallBlind !== room.smallBlind || bigBlind !== room.bigBlind)) throw new Error('Change the blinds between hands.');
      const startingStack = data.startingStack === undefined ? room.startingStack : integer(data.startingStack, 1, 100000);
      const playerCount = data.playerCount === undefined ? seatsFor(room).length : integer(data.playerCount, 2, 20);
      if (playerCount !== seatsFor(room).length && room.players.length) throw new Error('Choose the player count before players join.');
      if (typeof data.name === 'string' && data.name.trim()) room.name = data.name.trim().slice(0, 32);
      room.startingStack = startingStack; room.smallBlind = smallBlind; room.bigBlind = bigBlind;
      if (playerCount !== seatsFor(room).length) room.seatIds = Array.from({length:playerCount}, (_,i) => `seat-${i}`);
      room.playerCount = playerCount;
      room.setupComplete = true;
      log(room, 'Table settings updated');
      break;
    }
    case 'remove': {
      if (!player) throw new Error('Choose a player.');
      if (room.betting?.phase !== 'waiting' || room.players.some(p => p.contribution > 0)) throw new Error('Finish this hand before removing a player.');
      room.players = room.players.filter(p => p.id !== player.id);
      log(room, `${player.name} left the table`);
      break;
    }
    case 'demo': {
      if (room.players.length) throw new Error('Use a new empty table for a practice game.');
      seatsFor(room).forEach((seat, i) => joinRoom(room, {name: ['Alex','Jamie','Sam','Charlie','Robin','Taylor','Morgan','Casey'][i] || `Player ${i + 1}`, seat}));
      room.setupComplete = true;
      room.demo = true;
      startHand(room);
      log(room, 'Practice table ready · try a player’s chip surface');
      break;
    }
    default: throw new Error('Unknown table action.');
  }
}
