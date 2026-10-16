import {mountHost3D,mountPhone3D,movePhone3D} from './table3d.js';
import {playChipSound,unlockChipSound} from './chip-sound.js';
import {denominations,makeWallet,validWallet,chipCounts,walletValue,spend,exchanges,exchange,rollover} from './wallet.js';
import {fetchJSON,submitAction} from './requests.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const seats = () => state.seatIds;
const seatAngle = seat => Math.PI / 2 + seats().indexOf(seat) * Math.PI * 2 / seats().length;
const fmt = n => Number(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7M4 12h12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-10 4a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',
  bank: '<path d="m3 8 9-5 9 5H3m2 2v8m7-8v8m7-8v8M3 21h18M2 18h20"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4V5m4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 4H2v6h3l6 4V5m5 4 5 6m0-6-5 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  gear: '<path d="m9 3-1 3-3 1v4l-2 1 2 1v4l3 1 1 3h6l1-3 3-1v-4l2-1-2-1V7l-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  cup: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3m0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 14v7m-5 0h10"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  history: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-5v6l4 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>',
  back: '<path d="m10 5-7 7 7 7m-7-7h18"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
const chip = (value, extra = '') => `<span class="chip chip-${value} ${extra}"><span>${value}</span></span>`;
let session, state, eventSource, network, online = true, busy = false, previewId = null;
let selected = [], wallet = {}, walletBalance = -1, positions = {}, lastEventId = null, muted = false;
let modalKind, focusReturn, toastTimer, gesture, controlsOpen = false, nextChipId = 0;
let walletOwner, pendingAction, walletUndoVersion = 0;
const touches = new Map();

function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function stored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function rememberTable() {
  if (!session?.host || !state) return;
  const tables = stored('clubhouse-tables') || {};
  tables[session.code] = {...session, name:state.name};
  save('clubhouse-tables',tables);
}
function toast(message, error = false) {
  if (!error) return;
  const node = $('#toast'); node.textContent = message; node.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.className = '', 3800);
}
async function api(path, options = {}) {
  return fetchJSON(path, {...options, headers:apiHeaders(options.headers)});
}
function apiHeaders(extra) { return {'Content-Type':'application/json', ...(session?.token ? {Authorization:`Bearer ${session.token}`} : {}), ...extra}; }
function pendingKey() { return `clubhouse-pending-${session.code}-${previewId || session.playerId || 'host'}`; }
function acceptState(next) {
  if (state?.code === next.code && next.revision < state.revision) return;
  if (walletOwner && currentPlayer() && state?.code === next.code) {
    const trail = stored(`${walletOwner}-history`) || {};
    trail[state.revision] = chipCounts(wallet, selected);
    const revisions = Object.keys(trail).map(Number).sort((a,b) => b-a);
    save(`${walletOwner}-history`, Object.fromEntries(revisions.slice(0,60).map(r => [r, trail[r]])));
  }
  state=next; rememberTable(); render();
}
function saveWallet() {
  if(walletOwner)save(walletOwner,chipCounts(wallet,selected));
}
function sound(count = 1, shuffle = false, kind = shuffle ? 'handle' : 'lay') {
  if (!muted) playChipSound({kind, count, intensity: shuffle ? .75 : 1});
}
function brand() { return `<a class="brand" href="/" aria-label="Clubhouse home"><span class="brand-mark">♠</span><span>clubhouse<span class="brand-dot">.</span></span></a>`; }
function connection() {
  return `<span class="connection ${online ? '' : 'offline'}" role="status" aria-label="${online ? 'Connected' : 'Reconnecting'}"><i></i></span>`;
}
function setConnection(value) {
  online = value;
  document.querySelectorAll('.connection').forEach(node => {
    node.classList.toggle('offline', !value);
    node.setAttribute('aria-label', value ? 'Connected' : 'Reconnecting');
  });
  updateSelection();
}
async function boot() {
  try {
    network = await api('/api/network');
    if (location.pathname === '/join') {
      const code = (new URLSearchParams(location.search).get('table') || '').toUpperCase();
      if (code && !new URLSearchParams(location.search).has('new') && stored(`clubhouse-player-${code}`)) {
        session = stored(`clubhouse-player-${code}`);
        try { const restored = await api(`/api/rooms/${code}`); session.playerId = restored.playerId; state = restored.state; connect(); return; } catch { session = null; }
      }
      renderJoin(code); return;
    }
    session = stored('clubhouse-host');
    if (session) {
      try { const restored = await api(`/api/rooms/${session.code}`); if (!restored.host) throw new Error(); state = restored.state; }
      catch { session = null; }
    }
    if (!session) await newTable();
    connect();
  } catch (e) { app.innerHTML = `<div class="loading">${brand()}<h2>The table isn’t connected</h2><p>${esc(e.message)}</p><button class="button primary" data-action="reload">Try again</button></div>`; }
}
async function newTable() {
  rememberTable();
  eventSource?.close();
  const created = await api('/api/rooms', {method:'POST'});
  session = {code:created.code, token:created.token, host:true}; state = created.state;
  save('clubhouse-host', session); previewId = null; lastEventId = null; selected = []; walletBalance = -1;
  rememberTable();
}
function connect() {
  rememberTable();
  lastEventId = state.lastEvent?.id;
  render();
  if (session.host && state.setupComplete === false) showModal('setup');
  eventSource?.close();
  eventSource = new EventSource(`/api/rooms/${session.code}/events?token=${encodeURIComponent(session.token)}`);
  eventSource.onopen = () => {
    setConnection(true);
    if(pendingAction && !busy)void action(pendingAction.action);
  };
  eventSource.onerror = () => setConnection(false);
  eventSource.onmessage = e => {
    const next = JSON.parse(e.data), event = next.lastEvent;
    const fresh = event && event.id !== lastEventId;
    if(next.revision < state.revision)return;
    setConnection(true); acceptState(next);
    if (fresh) {
      lastEventId = event.id;
      if (event.kind === 'bet') { animateThrow(event.seat, event.amount); }
      
      
    }
  };
  pendingAction=stored(pendingKey());
  if(pendingAction)void action(pendingAction.action);
}
function currentPlayer() { return state?.players.find(p => p.id === (previewId || session?.playerId)); }
function render() { if (session.host && !previewId) renderHost(); else renderPlayer(); }
function totalPot() { return state.players.reduce((sum,p) => sum+p.contribution,0); }
function joinUrl() {
  const base = ['localhost','127.0.0.1'].includes(location.hostname) ? network.localUrls[0] || location.origin : location.origin;
  return `${base}/join?table=${session.code}`;
}
function playerSeat(seat) {
  const p = state.players.find(p => p.seat === seat);
  const angle = seatAngle(seat);
  const style = `left:${50 + Math.cos(angle)*39}%;top:${50 + Math.sin(angle)*36}%;`;
  if (!p) return `<button style="${style}" class="seat ring-seat empty-seat" data-action="invite" aria-label="Invite a player to seat ${seats().indexOf(seat)+1}"><span class="empty-avatar">${icon('plus')}</span></button>`;
  const b = state.betting;
  const markers = [[b.buttonId,'D','Dealer button'],[b.smallBlindId,'SB','Small blind'],[b.bigBlindId,'BB','Big blind']].filter(([id]) => id === p.id).map(([,label,title]) => `<span class="position-marker" title="${title}" aria-label="${title}">${label}</span>`).join('');
  const wager = b.phase === 'betting' && p.roundContribution > 0 ? `<span class="round-bet" data-player-id="${p.id}" style="left:${50+Math.cos(angle)*27}%;top:${50+Math.sin(angle)*24}%;" aria-label="${esc(p.name)} bet ${fmt(p.roundContribution)} this round">${fmt(p.roundContribution)}</span>` : '';
  return `<button style="${style}" class="seat ring-seat occupied ${b.actorId===p.id?'acting':''} ${!p.inHand ? 'out' : ''}" data-action="player" data-id="${p.id}" aria-label="Manage ${esc(p.name)}"><span class="avatar avatar-${seat}">${esc(p.name.slice(0,1).toUpperCase())}<i class="presence ${p.connected || state.demo ? 'on' : ''}"></i></span><span class="seat-name">${esc(p.name)}</span><span class="seat-stack">${fmt(p.balance)}</span><span class="position-markers">${markers}</span></button>${wager}`;
}
function potChips() {
  const total = totalPot(); if(!total) return '';
  return `<div class="pot-chips" aria-hidden="true">${[100,25,5,100,25,1,5,25].slice(0,Math.min(8,Math.ceil(total/30)+2)).map((v,i)=>`<div class="pot-stack ps-${i}">${Array.from({length:2+i%4},()=>chip(v)).join('')}</div>`).join('')}</div>`;
}
function renderHost() {
  document.body.classList.remove('player-body');
  document.body.classList.add('table-body');
  const pot = totalPot(), b = state.betting;
  const actor = state.players.find(p => p.id === b.actorId);
  const streetNames = {preflop:'Preflop',flop:'Flop',turn:'Turn',river:'River'};
  const nextNames = {preflop:'Deal flop',flop:'Deal turn',turn:'Deal river'};
  const status = b.phase === 'waiting' ? 'Ready for the next hand' : b.phase === 'between' ? `${streetNames[b.street]} · Betting complete` : b.phase === 'showdown' ? 'Showdown · Choose the winners' : `${streetNames[b.street]} · ${esc(actor?.name || '')} to act`;
  const control = (action, glyph, label, extra = '') => `<button class="icon-button" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(glyph)}</button>`;
  app.innerHTML = `<div class="host-shell immersive" aria-label="${esc(state.name)}">
    <main class="table-stage">
      <div class="poker-table"><div class="felt"><div class="table-stitch"></div><div class="pot-center"><div class="pot-number" aria-label="Pot: ${fmt(pot)}">${fmt(pot)}</div>${potChips()}</div></div></div>
      ${seats().map(playerSeat).join('')}<div class="flight-layer"></div>
    </main>
    <div class="hand-controls"><span class="hand-status" role="status">${status}</span>${b.phase==='waiting'?`<button class="button primary hand-button" data-action="start-hand" ${state.players.filter(p=>p.balance>0).length<2?'disabled':''}>Start hand</button>`:b.phase==='between'?`<button class="button primary hand-button" data-action="next-street">${nextNames[b.street]}</button>`:''}</div>
    <nav class="table-controls" aria-label="Table controls">
      ${connection()}
      <button class="icon-button controls-toggle" data-action="controls" aria-label="Table controls" aria-expanded="${controlsOpen}" title="Table controls">${icon(controlsOpen?'close':'gear')}</button>
      <div class="controls-drawer" ${controlsOpen?'':'hidden'}>
        <button class="icon-button undo-button" data-action="undo" aria-label="Undo last action" title="Undo last action" ${state.undoCount?'':'disabled'}>${icon('history')}<small>${state.undoCount || 0}</small></button>
        ${control('invite','users','Invite players')}
        ${control('bank','bank','Open bank and manage loans')}
        ${control('settings','gear','Table settings')}
        ${control('fullscreen','expand','Toggle fullscreen')}
        ${!state.players.length?control('demo','phone','Practice table'):state.demo?control('preview','phone','Player preview',`data-id="${b.actorId || state.players[0].id}"`):''}
      </div>
    </nav>
    <button class="icon-button table-award" data-action="award" aria-label="Award the pot" title="Award the pot" ${pot && b.phase==='showdown'?'':'disabled'}>${icon('cup')}</button>
  </div>`;
  mountHost3D($('.table-stage'),pot,state.lastEvent,session.code);
}
function animateThrow(seat, amount) {
  const layer = $('.flight-layer');
  if (!layer) return;
  const pile = document.createElement('div'); pile.className = `flying-chips from-${seat}`;
  const angle = seatAngle(seat);
  pile.style.setProperty('--from-x', `${Math.cos(angle)*innerWidth/2}px`);
  pile.style.setProperty('--from-y', `${Math.sin(angle)*innerHeight/2}px`);
  pile.innerHTML = [25,5,100,25,1].map((v,i)=>`<span style="--i:${i}">${chip(v)}</span>`).join('') + `<b>+${fmt(amount)}</b>`;
  layer.append(pile); setTimeout(()=>pile.remove(),1200);
}

function toCall(p) { return p.actions.callAmount; }
function renderPlayer() {
  const p = currentPlayer();
  document.body.classList.remove('table-body');
  document.body.classList.add('player-body');
  if (!p) { app.innerHTML = `<div class="loading"><a class="button primary" href="/join?table=${session.code}">Rejoin</a></div>`; return; }
  const owner=`clubhouse-wallet-${session.code}-${p.id}`;
  if (walletOwner === owner && walletUndoVersion !== (state.undoVersion || 0)) {
    resetGesture();
    const trail = stored(`${owner}-history`) || {};
    const revision = Object.keys(trail).map(Number).filter(r => r <= state.lastEvent?.restoreRevision).sort((a,b) => b-a)[0];
    const restored = trail[revision];
    wallet = validWallet(restored, p.balance) ? rollover(restored) : makeWallet(p.balance);
    selected = []; walletBalance = p.balance;
  }
  walletUndoVersion = state.undoVersion || 0;
  if(walletOwner!==owner || walletBalance<0){
    resetGesture(); walletOwner=owner;
    const saved=stored(owner);
    wallet=validWallet(saved,p.balance)?rollover(saved):makeWallet(p.balance);selected=[];walletBalance=p.balance;
  }else if(walletBalance!==p.balance){
    const change=p.balance-walletBalance;
    if(change<0){
      resetGesture();
      const all=chipCounts(wallet,selected), sent=pendingAction?.chipCounts;
      if(sent && walletValue(sent)===-change && denominations.every(v=>all[v]>=sent[v]))wallet=Object.fromEntries(denominations.map(v=>[v,all[v]-sent[v]]));
      else wallet=spend(all,-change);
      selected=[];
    }else{
      const added=makeWallet(change);denominations.forEach(v=>wallet[v]+=added[v]);
    }
    walletBalance=p.balance;saveWallet();
  }
  if ($('.player-shell')?.dataset.id === p.id) {
    $('.player-balance').textContent=fmt(p.balance);updateSelection(); return;
  }
  app.innerHTML = `<div class="player-shell minimal-phone" data-id="${p.id}">
    <header class="player-top">${previewId?`<button class="icon-button" data-action="exit-preview" aria-label="Return to the laptop table">${icon('back')}</button>`:'<span></span>'}<div>${connection()}</div></header>
    <div class="phone-pot" id="throw-zone" aria-label="Pot edge"></div>
    <div class="player-intro"><div class="player-balance" aria-label="Your chips">${fmt(p.balance)}</div></div>
    <div class="turn-status" role="status"></div>
    <div class="chip-mat" aria-label="Chip surface">
      ${denominations.map((v,i)=>`<div class="wallet-stack" data-value="${v}" style="left:${[5,28,51,74][i]}%;top:85%" tabindex="0" role="button" aria-label="Select one ${v} chip"><div class="stack-visual">${Array.from({length:Math.max(1,Math.min(6,wallet[v]))},(_,j)=>chip(v,`layer-${j}`)).join('')}</div><span class="stack-count">${wallet[v]} × ${v}</span></div>`).join('')}
      <div id="selected-tray" class="selected-tray" aria-label="Selected chips"></div>
      <span id="selection-value"></span>
    </div>
    <button class="button exchange-button" data-action="exchange" id="exchange-button" hidden>Exchange</button><div class="phone-actions"><button class="button call-button" data-action="check" id="call-button">Check</button><button class="button fold-button" data-action="fold" id="fold-button">Fold</button></div>
  </div>`;
  updateSelection();
}
function updateSelection() {
  const p = currentPlayer(); if (!p || !$('.player-shell')) return;
  if (!gesture) wallet = rollover(wallet);
  const amount = selected.reduce((s,c)=>s+c.value,0);
  $('#selection-value').textContent=amount?fmt(amount):'';
  const signature=selected.map(c=>c.id).join(',');
  const tray=$('#selected-tray');
  if(tray.dataset.chips!==signature){
    tray.innerHTML=selected.map((c,i)=>`<button class="loose-chip${c.picked?' dragging':''}" data-id="${c.id}" style="left:${c.x}%;top:${c.y}%;z-index:${i+3}" aria-label="Move ${c.value} chip">${chip(c.value)}</button>`).join('');
    tray.dataset.chips=signature;
  }
  selected.forEach(c=>{
    const el=$(`.loose-chip[data-id="${c.id}"]`);if(el){el.style.left=`${c.x}%`;el.style.top=`${c.y}%`;el.classList.toggle('dragging',!!c.picked);}
  });
  const callAmount = Math.min(p.balance,toCall(p));
  $('#call-button').textContent = callAmount?`Call ${fmt(callAmount)}`:'Check';
  $('#call-button').dataset.action = callAmount?'call':'check';
  const blocked = !p.actions.canAct || busy || selected.length > 0 || !!gesture;
  $('#call-button').disabled = blocked;
  $('#fold-button').disabled = blocked;
  const b = state.betting, actor = state.players.find(pl => pl.id === b.actorId);
  const status = b.phase === 'waiting' ? 'Waiting for the host to start the hand' : !p.inHand ? 'You folded · Waiting for the next hand' : b.phase === 'between' ? 'Betting complete · Waiting for the next cards' : b.phase === 'showdown' ? 'Showdown · Waiting for the winners' : p.balance === 0 ? 'All in' : p.actions.canAct ? (selected.length ? `Your turn · ${fmt(amount)} selected` : 'Your turn') : `Waiting for ${actor?.name || 'the next turn'}`;
  $('.turn-status').textContent = status;
  $('.turn-status').classList.toggle('your-turn',p.actions.canAct);
  document.querySelectorAll('.wallet-stack').forEach(node => node.setAttribute('aria-disabled',String(!p.actions.canAct || busy)));

  $('#exchange-button').hidden = !exchanges(wallet).length;
  $('#exchange-button').disabled = busy || !!gesture;
  denominations.forEach(v=>{
    const el=$(`.wallet-stack[data-value="${v}"]`);
    if(el) { el.classList.toggle('depleted',!wallet[v]); $('.stack-count',el).textContent=`${wallet[v]} × ${v}`; }
  });
  mountPhone3D($('.player-shell'),wallet,selected);
  saveWallet();
}
function selectChip(value, position, picked=false) {
  if (!wallet[value] || busy || !currentPlayer()?.actions.canAct) return null;
  const index=selected.length;
  const chosen={id:`chip-${nextChipId++}`,value,picked,x:position?.x??[50,60,40,70,30][index%5],y:position?.y??Math.min(62,42+Math.floor(index/5)*6)};
  wallet[value]--;selected.push(chosen);navigator.vibrate?.(8);updateSelection();return chosen;
}
function returnChip(id) {
  const chosen=selected.find(c=>c.id===id);if(!chosen)return;
  wallet[chosen.value]++;selected=selected.filter(c=>c.id!==id);sound(1,false,'stack');updateSelection();
}
function clearSelection() { const count=selected.length;selected.forEach(c=>wallet[c.value]++); selected=[]; sound(count,false,'stack'); updateSelection(); }
function moveLooseChips() {
  selected.forEach(c=>{const el=$(`.loose-chip[data-id="${c.id}"]`);if(el){el.style.left=`${c.x}%`;el.style.top=`${c.y}%`;}});
  movePhone3D();
}
async function action(name, extra = {}) {
  if (busy) return false;
  const recovering=!!pendingAction;
  if (!recovering && ['bet','all-in','call','check','fold'].includes(name)) {
    if (!currentPlayer()?.actions.canAct) {toast('Wait for your turn.',true);return false;}
    if (['call','check','fold'].includes(name) && selected.length) return false;
  }
  const counts=name==='bet'?chipCounts({1:0,5:0,25:0,100:0},selected):name==='all-in'?chipCounts(wallet,selected):undefined;
  pendingAction ||= {action:name,turnId:state.betting?.turnId,requestId:crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, ...(counts?{chipCounts:counts}:{}), ...(previewId?{playerId:previewId}:{}),...extra};
  save(pendingKey(),pendingAction);
  busy=true;
  try {
    updateSelection();
    const result=await submitAction(`/api/rooms/${session.code}/action`,pendingAction,apiHeaders());
    setConnection(true);acceptState(result.state);
    pendingAction=null;localStorage.removeItem(pendingKey());
    if(recovering)toast('Previous move recovered.',true);
    return true;
  } catch(e) {
    if(e.status){pendingAction=null;localStorage.removeItem(pendingKey());}
    toast(e.message,true);return false;
  }
  finally { busy=false; updateSelection(); }
}

function seatPicker(table) {
  const ids = table?.seatIds || [];
  const point = (angle, rx, ry) => `${180 + Math.cos(angle)*rx},${140 + Math.sin(angle)*ry}`;
  const arcs = ids.map((seat, i) => {
    const angle = Math.PI/2 + i*Math.PI*2/ids.length;
    const half = Math.PI/ids.length - .025;
    const start = angle-half, end = angle+half;
    const taken = table.seats.find(p => p.seat === seat);
    const path = `M ${point(start,168,116)} A 168 116 0 0 1 ${point(end,168,116)} L ${point(end,120,72)} A 120 72 0 0 0 ${point(start,120,72)} Z`;
    return `<g class="seat-arc" data-pick-seat="${seat}" role="radio" aria-checked="false" aria-disabled="${!!taken}" tabindex="${taken?-1:0}" aria-label="Seat ${i+1}${taken?`: ${esc(taken.name)}, taken`:''}"><path d="${path}"/><text x="${180+Math.cos(angle)*144}" y="${140+Math.sin(angle)*94}" text-anchor="middle" dominant-baseline="central">${i+1}</text><title>${taken?esc(taken.name):`Seat ${i+1}`}</title></g>`;
  }).join('');
  return `<input type="hidden" name="seat"><svg class="oval-seat-picker" viewBox="0 0 360 280" role="radiogroup" aria-label="Choose your seat around the table"><ellipse cx="180" cy="140" rx="110" ry="62" class="picker-felt"/><text x="180" y="135" text-anchor="middle" class="picker-title">TABLE</text><text x="180" y="153" text-anchor="middle" class="picker-note">Choose your seat</text>${arcs}<text x="180" y="274" text-anchor="middle" class="picker-note">Laptop on this side</text></svg>`;
}

async function renderJoin(code = '') {
  document.body.classList.add('player-body');
  let table;
  if(code) { try { table = await api(`/api/rooms/${encodeURIComponent(code)}/preview`); } catch(e) { toast(e.message,true); } }
  app.innerHTML=`<div class="join-shell"><h1>Join table</h1><form id="join-form"><label>Table code<input name="code" value="${esc(code)}" maxlength="4" required autocapitalize="characters" autocomplete="off" pattern="[a-zA-Z0-9]{4}"></label><label>Your name<input name="name" maxlength="20" required autocomplete="given-name"></label><fieldset><legend>Seat</legend>${seatPicker(table)}</fieldset><button class="button primary join-submit" type="submit" ${table?.handInProgress || !table?.ready?'disabled':''}>${!table?.ready?'Waiting for table setup':table?.handInProgress?'Hand in progress':'Join'} ${icon('arrow')}</button></form></div>`;
  document.querySelectorAll('[data-pick-seat]').forEach(button => {
    const pick = () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      $('input[name="seat"]').value = button.dataset.pickSeat;
      document.querySelectorAll('[data-pick-seat]').forEach(node => node.setAttribute('aria-checked', String(node === button)));
    };
    button.addEventListener('click', pick);
    button.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } });
  });
  $('#join-form').addEventListener('submit',async e=>{
    e.preventDefault(); const form=new FormData(e.target); const code=String(form.get('code')).trim().toUpperCase();
    if (!form.get('seat')) { toast('Choose your seat around the table.',true); return; }
    const button=$('.join-submit'); button.disabled=true; button.textContent='…';
    try {
      const result=await api(`/api/rooms/${code}/join`,{method:'POST',body:JSON.stringify({name:form.get('name'),seat:form.get('seat')})});
      session={code,token:result.token,playerId:result.playerId,host:false}; save(`clubhouse-player-${code}`,session); state=result.state;
      history.replaceState(null,'',`/join?table=${code}`); connect();
    } catch(err) { toast(err.message,true); button.disabled=false; button.innerHTML=`Join ${icon('arrow')}`; }
  });
  const codeInput=$('input[name="code"]');
  codeInput.addEventListener('change',async()=>{
    const input=codeInput.value.trim().toUpperCase(); if(input.length!==4)return;
    const name=$('input[name="name"]').value; await renderJoin(input); $('input[name="name"]').value=name;
  });
}

function closeModal() { $('#modal-root').innerHTML=''; modalKind=null; document.body.classList.remove('modal-open'); focusReturn?.focus(); }
function showModal(kind, id) {
  modalKind=kind; focusReturn=document.activeElement;
  const expectedPots = structuredClone(state.pots);
  const p=state.players.find(p=>p.id===id);
  let title, content;
  if(kind==='start-hand') {
    title='Start hand';
    content=`<form id="start-hand-form"><label>Button<select name="buttonId">${state.players.filter(p=>p.balance>0).map(p=>`<option value="${p.id}" ${p.id===state.nextButtonId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="blind-summary">Small blind ${fmt(state.smallBlind)} · Big blind ${fmt(state.bigBlind)}</p><button class="button primary modal-submit" type="submit">Post blinds &amp; start</button></form>`;
  } else if(kind==='invite') {
    title='Invite players';
    content=`<div class="invite-modal-qr"><img class="qr" width="220" height="220" src="/api/rooms/${session.code}/qr?token=${encodeURIComponent(session.token)}" alt="QR code to join this table"></div><div class="invite-code"><strong class="room-code">${session.code}</strong></div><div class="copy-field"><input aria-label="Invitation URL" value="${esc(joinUrl())}" readonly><button class="button primary" data-action="copy" aria-label="Copy invitation link">${icon('copy')}</button></div>`;
  } else if(kind==='award') {
    if(!totalPot() || state.betting.phase !== 'showdown')return;
    title='Winners';
    content=`<form id="award-form">${state.pots.map((pot,i)=>`<section class="award-pot"><div><h3>${pot.refund?'Return':i?`Side pot ${i}`:'Main pot'}</h3><strong>${fmt(pot.amount)}</strong></div>${pot.refund?`<span class="refund-name">${esc(state.players.find(p=>p.id===pot.refund).name)}</span>`:`<div class="winner-options">${pot.eligible.length?state.players.filter(p=>pot.eligible.includes(p.id)).map(p=>`<label><input type="checkbox" name="${pot.id}" value="${p.id}"><span><span class="small-avatar avatar-${p.seat}">${esc(p.name[0])}</span>${esc(p.name)}${icon('check')}</span></label>`).join(''):'<span class="form-warning">No eligible player</span>'}</div>`}</section>`).join('')}<button class="button primary modal-submit" type="submit">${icon('cup')} Award ${fmt(totalPot())} ${icon('arrow')}</button></form>`;
  } else if(kind==='bank'||kind==='player') {
    title=p?p.name:'Bank';
    content=`<div class="bank-players">${(p?[p]:state.players).map(p=>`<div class="bank-player"><span class="small-avatar avatar-${p.seat}">${esc(p.name[0])}</span><div><strong>${esc(p.name)}</strong><span>${fmt(p.balance)} · Loan ${fmt(p.debt)}</span></div>${state.demo?`<button class="icon-button" data-action="preview" data-id="${p.id}" aria-label="Preview ${esc(p.name)}’s phone">${icon('phone')}</button>`:''}</div>`).join('')}</div>${state.betting.phase !== 'waiting'?'<p class="blind-summary">The bank opens after this hand.</p>':state.players.length?`<form id="bank-form"><label>Player<select name="playerId">${state.players.map(pl=>`<option value="${pl.id}" ${pl.id===id?'selected':''}>${esc(pl.name)}</option>`).join('')}</select></label><div class="form-columns"><label>Action<select name="action"><option value="loan">Loan</option><option value="repay">Repayment</option></select></label><label>Amount<input type="number" name="amount" min="1" max="1000000" step="1" value="500" required></label></div><div class="amount-presets">${[100,500,1000].map(n=>`<button type="button" data-action="amount" data-amount="${n}">${fmt(n)}</button>`).join('')}</div><button class="button primary modal-submit" type="submit">${icon('bank')} Move chips</button></form>`:''}${p?`<div class="player-manage"><button class="danger-link" data-action="remove" data-id="${p.id}" ${state.betting.phase!=='waiting'?'disabled':''}>Release seat</button></div>`:''}`;
  } else if(kind==='settings'||kind==='setup') {
    title=kind === 'setup'?'Set up your table':'Table settings';
    const savedTables=Object.values(stored('clubhouse-tables')||{}).filter(t=>t.code!==session.code);
    content=`<form id="settings-form"><label>Table name<input name="name" value="${esc(state.name)}" maxlength="32" required></label><label>Player count<input name="playerCount" type="number" min="2" max="20" step="1" value="${state.playerCount}" ${state.players.length?'disabled':''} required></label><label>Starting chips<input type="number" name="startingStack" value="${state.startingStack}" min="1" max="100000" required></label><div class="form-columns"><label>Small blind<input type="number" name="smallBlind" value="${state.smallBlind}" min="1" max="100000" step="1" ${state.betting.phase!=='waiting'?'disabled':''} required></label><label>Big blind<input type="number" name="bigBlind" value="${state.bigBlind}" min="1" max="100000" step="1" ${state.betting.phase!=='waiting'?'disabled':''} required></label></div><button class="button primary modal-submit" type="submit">Save ${icon('check')}</button></form>${savedTables.length?`<div class="new-table-area"><h3>Saved tables</h3><div class="saved-tables">${savedTables.map(t=>`<button class="subtle-button" data-action="resume-table" data-code="${t.code}">${esc(t.name)} · ${t.code} ${icon('arrow')}</button>`).join('')}</div></div>`:''}<div class="new-table-area"><button class="button secondary" data-action="new-confirm">New table ${icon('arrow')}</button></div>`;
  } else if(kind==='exchange') {
    title='Exchange';
    const chips=counts=>Object.entries(counts).map(([value,count])=>`<span class="exchange-chips">${chip(value)}<b>× ${count}</b></span>`).join('');
    content=`<div class="exchange-options">${exchanges(wallet).map(option=>`<button class="exchange-option" data-action="exchange-chip" data-value="${option.target}" aria-label="Exchange for ${option.target} chips"><span>${chips(option.give)}</span>${icon('arrow')}<span>${chips(option.receive)}</span></button>`).join('')}</div>`;
  } else if(kind==='new-confirm') {
    title='New table?';
    content=`<button class="button primary modal-submit" data-action="new-table">New table ${icon('arrow')}</button>`;
  }
  if(!title)return;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button modal-close" data-action="close" aria-label="Close dialog">${icon('close')}</button><h2 id="modal-title">${esc(title)}</h2>${content}</section></div>`;
  document.body.classList.add('modal-open'); $('.modal-close').focus();
  $('#start-hand-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const data=Object.fromEntries(new FormData(e.target));
    if(await action('start-hand',{buttonId:data.buttonId}))closeModal();
  });
  $('#award-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=new FormData(e.target);const winners={};state.pots.forEach(p=>{winners[p.id]=form.getAll(p.id);});
    if(await action('award',{winners,expectedPots})) {closeModal();toast('Pot awarded. A fresh hand is ready.');}
    else if(totalPot()) showModal('award');
  });
  $('#bank-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const data=Object.fromEntries(new FormData(e.target));
    if(await action(data.action,{playerId:data.playerId,amount:Number(data.amount)})){closeModal();toast(data.action==='loan'?'Loan added to the player’s chips.':'Loan repayment received.');}
  });
  $('#settings-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const data=Object.fromEntries(new FormData(e.target));
    if(await action('settings',{name:data.name,startingStack:Number(data.startingStack),playerCount:Number(data.playerCount || state.playerCount),smallBlind:Number(data.smallBlind || state.smallBlind),bigBlind:Number(data.bigBlind || state.bigBlind)})){closeModal();toast('Your table is ready.');}
  });
}

async function copyLink() {
  try { await navigator.clipboard.writeText(joinUrl()); toast('Table link copied. Send it to your friends.'); }
  catch { showModal('invite'); const input=$('.copy-field input'); input.focus(); input.select(); try { document.execCommand('copy');toast('Table link copied.'); } catch { toast('Select and copy the invitation link.'); } }
}
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button || button.disabled)return;
  const name=button.dataset.action;
  if(['invite','award','bank','settings','new-confirm','exchange','start-hand'].includes(name))return showModal(name);
  if(name==='exchange-chip'){
    if(busy || gesture)return;
    const option=exchange(wallet,Number(button.dataset.value));
    if(option){wallet=option.wallet;closeModal();sound(2,false,'stack');updateSelection();}
    else showModal('exchange');
    return;
  }
  if(name==='player')return showModal('player',button.dataset.id);
  if(name==='close')return closeModal();
  if(name==='copy')return copyLink();
  if(name==='reload')return location.reload();
  if(name==='sound'){muted=!muted;localStorage.setItem('clubhouse-muted',String(muted));if(!muted)sound(2);document.querySelectorAll('[data-action="sound"]').forEach(b=>{b.innerHTML=icon(muted?'muted':'sound');b.setAttribute('aria-label',`${muted?'Enable':'Mute'} chip sounds`);});return;}
  if(name==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.',true);}return;}
  if(name==='undo'){await action('undo');return;}
  if(['call','check','fold','next-street'].includes(name)){await action(name);return;}
  if(name==='demo'){controlsOpen=false;await action('demo');return;}
  if(name==='controls'){controlsOpen=!controlsOpen;const drawer=$('.controls-drawer');drawer.hidden=!controlsOpen;button.setAttribute('aria-expanded',String(controlsOpen));button.innerHTML=icon(controlsOpen?'close':'gear');return;}
  if(name==='preview'){closeModal();previewId=button.dataset.id;walletBalance=-1;positions={};render();return;}
  if(name==='exit-preview'){previewId=null;walletBalance=-1;render();return;}
  if(name==='inHand'){const kind=modalKind,id=button.dataset.id;if(await action('inHand',{playerId:id,value:button.dataset.value==='true'}))showModal(kind,kind==='player'?id:undefined);return;}
  if(name==='remove'){if(await action('remove',{playerId:button.dataset.id})){closeModal();toast('Seat released.');}return;}
  if(name==='amount'){const input=$('#bank-form input[name="amount"]');if(input)input.value=button.dataset.amount;return;}
  if(name==='new-table'){closeModal();await newTable();connect();toast('A fresh table. Invite your friends.');}
  if(name==='resume-table'){
    const restoredSession=(stored('clubhouse-tables')||{})[button.dataset.code];if(!restoredSession)return;
    rememberTable();const previous=session;session=restoredSession;
    try{const result=await api(`/api/rooms/${session.code}`);eventSource?.close();state=result.state;previewId=null;walletBalance=-1;save('clubhouse-host',session);closeModal();connect();toast('Welcome back to your table.');}
    catch(err){session=previous;toast(err.message,true);}
  }
});
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(modalKind)closeModal();else if(controlsOpen){controlsOpen=false;renderHost();}}
  if(modalKind && e.key==='Tab') {
    const nodes=[...$('.modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select,a[href]')];
    if(e.shiftKey && document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}
    else if(!e.shiftKey && document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
  }
  const stack=e.target.closest('.wallet-stack');if(stack && ['Enter',' '].includes(e.key)){e.preventDefault();selectChip(Number(stack.dataset.value));}
});
function centroid() {
  const points=[...touches.values()];
  return {x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length};
}
function matPosition(x,y) {
  const rect=$('.chip-mat').getBoundingClientRect();
  return {x:Math.max(8,Math.min(92,(x-rect.left)/rect.width*100)),y:Math.max(5,Math.min(94,(y-rect.top)/rect.height*100))};
}
function inStacks(point, rect=$('.chip-mat')?.getBoundingClientRect()) {
  return rect && point.x>=rect.left-20 && point.x<=rect.right+20 && point.y>=rect.top+rect.height*.74 && point.y<=rect.bottom+24;
}
function resetGesture() {
  const mat=$('.chip-mat');
  gesture=null;touches.clear();
  selected.forEach(c=>c.picked=false);
  document.querySelectorAll('.loose-chip.dragging').forEach(el=>el.classList.remove('dragging'));
  mat?.classList.remove('pushing','return-active','all-in-carry');
  mat?.style.removeProperty('--stack-dx');mat?.style.removeProperty('--stack-dy');
  $('#throw-zone')?.classList.remove('target-active');
  movePhone3D();
  updateSelection();
}
function groupIntent(g,rect) {
  const point=centroid();
  // Finger intent remains usable even when a wide chip group reaches its bounds.
  const groupY=g.origins.length?g.origins.reduce((n,c)=>n+c.y,0)/g.origins.length+g.dy/rect.height*100:85;
  return {throw:g.dy < -45 && (point.y <= rect.top+rect.height*(g.mode==='all-in'?.08:.15) || (g.mode==='group' && groupY<=15)),
    back:g.dy>45 && (inStacks(point,rect) || groupY>=74)};
}
document.addEventListener('pointerdown',e=>{
  unlockChipSound();
  const mat=e.target.closest('.chip-mat');
  if(!mat || e.button!==0 || busy || !currentPlayer()?.inHand || !currentPlayer()?.balance)return;
  mat.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touches.size===1){
    const loose=e.target.closest('.loose-chip'),stack=e.target.closest('.wallet-stack');
    gesture={mode:loose?'single':stack?'stack':'idle',id:loose?.dataset.id,value:Number(stack?.dataset.value),startX:e.clientX,startY:e.clientY,moved:false,fromStack:inStacks({x:e.clientX,y:e.clientY})};
    if(loose){const c=selected.find(c=>c.id===loose.dataset.id);if(!c){resetGesture();return;}gesture.origin={x:c.x,y:c.y};c.picked=true;loose.classList.add('dragging');movePhone3D();}
  }else if(gesture && !['group','all-in'].includes(gesture.mode)){
    const allIn=gesture.fromStack && inStacks({x:e.clientX,y:e.clientY});
    if(allIn && gesture.newId){
      const chip=selected.find(c=>c.id===gesture.newId);
      if(chip){wallet[chip.value]++;selected=selected.filter(c=>c!==chip);updateSelection();}
    }
    if(allIn || selected.length){
      gesture={mode:allIn?'all-in':'group',center:centroid(),origins:selected.map(c=>({...c})),dx:0,dy:0};
      mat.classList.add('pushing');
      if(allIn)mat.classList.add('all-in-carry');
      movePhone3D();
    }
  }else if(gesture){
    const point=centroid();gesture.center={x:point.x-gesture.dx,y:point.y-gesture.dy};
  }
  updateSelection();
});
document.addEventListener('pointermove',e=>{
  if(!touches.has(e.pointerId)||!gesture)return;
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const mat=$('.chip-mat');if(!mat){resetGesture();return;}
  const rect=mat.getBoundingClientRect();
  if(['group','all-in'].includes(gesture.mode)){
    const now=centroid();gesture.dx=now.x-gesture.center.x;gesture.dy=now.y-gesture.center.y;
    const rawX=gesture.dx/rect.width*100,rawY=gesture.dy/rect.height*100;
    if(gesture.mode==='all-in'){
      mat.style.setProperty('--stack-dx',`${gesture.dx}px`);mat.style.setProperty('--stack-dy',`${gesture.dy}px`);
    }
    if(gesture.origins.length){
      const minX=Math.min(...gesture.origins.map(c=>c.x)),maxX=Math.max(...gesture.origins.map(c=>c.x));
      const minY=Math.min(...gesture.origins.map(c=>c.y)),maxY=Math.max(...gesture.origins.map(c=>c.y));
      const dx=Math.max(8-minX,Math.min(92-maxX,rawX)),dy=Math.max(3-minY,Math.min(94-maxY,rawY));
      gesture.origins.forEach(origin=>{const c=selected.find(c=>c.id===origin.id);if(c){c.x=origin.x+dx;c.y=origin.y+dy;}});
    }
    const intent=groupIntent(gesture,rect);
    $('#throw-zone').classList.toggle('target-active',intent.throw);
    mat.classList.toggle('return-active',gesture.mode==='group' && intent.back);
    moveLooseChips();return;
  }
  if(gesture.mode==='idle')return;
  const dx=e.clientX-gesture.startX,dy=e.clientY-gesture.startY;
  if(Math.abs(dx)+Math.abs(dy)>8)gesture.moved=true;
  if(!gesture.moved)return;
  if(gesture.mode==='stack'){
    const c=selectChip(gesture.value,matPosition(e.clientX,e.clientY),true);
    if(!c){gesture.mode='idle';return;}
    gesture.mode='single';gesture.id=c.id;gesture.newId=c.id;gesture.origin={x:c.x,y:c.y};gesture.startX=e.clientX;gesture.startY=e.clientY;
  }
  const c=selected.find(c=>c.id===gesture.id);if(!c)return;
  c.x=Math.max(8,Math.min(92,gesture.origin.x+(e.clientX-gesture.startX)/rect.width*100));
  c.y=Math.max(5,Math.min(94,gesture.origin.y+(e.clientY-gesture.startY)/rect.height*100));
  $(`.loose-chip[data-id="${c.id}"]`)?.classList.add('dragging');
  moveLooseChips();
});
document.addEventListener('pointerup',async e=>{
  if(!touches.has(e.pointerId)||!gesture)return;
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const g=gesture,rect=$('.chip-mat').getBoundingClientRect();
  const intent=['group','all-in'].includes(g.mode)?groupIntent(g,rect):null;
  // Clear every pointer before awaiting the server, including the remaining fingers.
  if(g.mode==='all-in' && !intent.throw){
    for(const origin of g.origins){const c=selected.find(c=>c.id===origin.id);if(c){c.x=origin.x;c.y=origin.y;}}
  }
  resetGesture();
  if(g.mode==='all-in'){
    if(intent.throw)await action('all-in');
    else moveLooseChips();
  }else if(g.mode==='group'){
    if(intent.throw){const amount=selected.reduce((sum,c)=>sum+c.value,0);if(amount)await action('bet',{amount});}
    else if(intent.back)clearSelection();
    else moveLooseChips();
  }else if(g.mode==='stack'&&!g.moved)selectChip(g.value);
  else if(g.mode==='single' && g.moved && inStacks({x:e.clientX,y:e.clientY},rect))returnChip(g.id);
  updateSelection();
});
document.addEventListener('pointercancel',resetGesture);
document.addEventListener('lostpointercapture',e=>{if(touches.has(e.pointerId))resetGesture();});
window.addEventListener('blur',resetGesture);
document.addEventListener('visibilitychange',()=>{if(document.hidden)resetGesture();else if(session)void refreshConnection();});
async function refreshConnection() {
  try{const result=await api(`/api/rooms/${session.code}`);setConnection(true);acceptState(result.state);if(!busy && stored(pendingKey())){pendingAction=stored(pendingKey());await action(pendingAction.action);}}
  catch{setConnection(false);}
}
window.addEventListener('online',()=>{if(session)void refreshConnection();});
window.addEventListener('offline',()=>setConnection(false));
boot();
