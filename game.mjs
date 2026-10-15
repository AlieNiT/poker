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
  return { code, hostToken, name: 'The home game', hand: 1, startingStack: 600, playerCount: 6, seatIds: Array.from({length:6}, (_,i) => `seat-${i}`), setupComplete: false, undoHistory: [],
    players: [], history: [], lastEvent: null, processed: [], createdAt: Date.now(), revision: 0 };
}
export function potsFor(room) {
  const levels = [...new Set(room.players.map(p => p.contribution).filter(n => n > 0))].sort((a,b) => a-b);
  let previous = 0;
  return levels.map((level, index) => {
    const contributors = room.players.filter(p => p.contribution >= level);
    const result = { id: `pot-${index}`, amount: (level - previous) * contributors.length,
      eligible: contributors.filter(p => p.inHand).map(p => p.id),
      refund: contributors.length === 1 ? contributors[0].id : null, cap: level };
    previous = level;
    return result;
  });
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
  if (room.players.some(p => p.contribution > 0)) throw new Error('Wait for the next hand before joining.');
  const player = { id: randomUUID(), token, name, seat, balance: room.startingStack, debt: 0, contribution: 0, inHand: true };
  room.players.push(player);
  log(room, `${name} joined the table`, 'join', { playerId: player.id });
  return player;
}
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
export function hostAction(room, action, data) {
  const player = room.players.find(p => p.id === data.playerId);
  switch (action) {
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
      if (player.balance === 0 && player.contribution > 0) throw new Error('An all-in player can receive a loan after this hand.');
      if (player.balance + amount > 1000000) throw new Error('A stack cannot exceed 1,000,000 chips.');
      player.balance += amount; player.debt += amount;
      log(room, `Bank lent ${player.name} ${amount.toLocaleString()}`, 'loan', { playerId: player.id, amount });
      break;
    }
    case 'repay': {
      if (!player) throw new Error('Choose a player.');
      const amount = integer(data.amount);
      if (amount > player.debt || amount > player.balance) throw new Error('Repayment cannot exceed the loan or available chips.');
      player.balance -= amount; player.debt -= amount;
      log(room, `${player.name} repaid ${amount.toLocaleString()}`, 'loan');
      break;
    }
    case 'inHand': {
      if (!player) throw new Error('Choose a player.');
      player.inHand = Boolean(data.value);
      log(room, `${player.name} ${player.inHand ? 'is back in the hand' : 'is out of the hand'}`);
      break;
    }
    case 'award': {
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
      room.players.forEach(p => { p.balance += payouts.get(p.id) || 0; p.contribution = 0; p.inHand = true; });
      room.hand++;
      log(room, messages.join(' / '), 'award', { payouts: Object.fromEntries(payouts) });
      break;
    }
    case 'settings': {
      const startingStack = data.startingStack === undefined ? room.startingStack : integer(data.startingStack, 1, 100000);
      const playerCount = data.playerCount === undefined ? seatsFor(room).length : integer(data.playerCount, 2, 20);
      if (playerCount !== seatsFor(room).length && room.players.length) throw new Error('Choose the player count before players join.');
      if (typeof data.name === 'string' && data.name.trim()) room.name = data.name.trim().slice(0, 32);
      room.startingStack = startingStack;
      if (playerCount !== seatsFor(room).length) room.seatIds = Array.from({length:playerCount}, (_,i) => `seat-${i}`);
      room.playerCount = playerCount;
      room.setupComplete = true;
      log(room, 'Table settings updated');
      break;
    }
    case 'remove': {
      if (!player) throw new Error('Choose a player.');
      if (room.players.some(p => p.contribution > 0)) throw new Error('Finish this hand before removing a player.');
      room.players = room.players.filter(p => p.id !== player.id);
      log(room, `${player.name} left the table`);
      break;
    }
    case 'demo': {
      if (room.players.length) throw new Error('Use a new empty table for a practice game.');
      seatsFor(room).forEach((seat, i) => joinRoom(room, {name: ['Alex','Jamie','Sam','Charlie','Robin','Taylor','Morgan','Casey'][i] || `Player ${i + 1}`, seat}));
      room.setupComplete = true;
      room.players.forEach((player, i) => bet(room, player, Math.min(player.balance, i === 2 ? 75 : 125)));
      room.demo = true;
      log(room, 'Practice table ready · try a player’s chip surface');
      break;
    }
    default: throw new Error('Unknown table action.');
  }
}
