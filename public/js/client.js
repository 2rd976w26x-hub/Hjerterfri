/* Hjerterfri v1.1.2 - Online rum (Socket.IO)
   NOTE: Dette er en "spilbar demo" med rum + CPU-sæder + bord-animation.
   Selve Hjerterfri-reglerne (lovlige træk, runder, point osv.) er ikke implementeret endnu.
*/

const socket = io();

// UI refs
const elConn = document.getElementById('conn');
const elLobby = document.getElementById('lobby');
const elGame = document.getElementById('game');
const elLobbyMsg = document.getElementById('lobbyMsg');
const elGameMsg = document.getElementById('gameMsg');
const elStatus = document.getElementById('status');
const elRoomLabel = document.getElementById('roomLabel');
const elBtnCreate = document.getElementById('btnCreate');
const elBtnJoin = document.getElementById('btnJoin');
const elBtnPlay = document.getElementById('btnPlay');
const elBtnLeave = document.getElementById('btnLeave');
const elSuitPanel = document.getElementById('suitCounter');
const elSuitRows = document.getElementById('suitCounterRows');
const elTrick = document.getElementById('trick');

let myRoom = null;
let mySeatIndex = null;
let isHost = false;
let lastRoomState = null;

// Helpers
function msg(el, text, kind = '') {
  el.innerHTML = text ? `<div class="${kind}">${escapeHtml(text)}</div>` : '';
}
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function setView(view){
  if (view === 'lobby') {
    elLobby.classList.remove('hidden');
    elGame.classList.add('hidden');
  } else {
    elLobby.classList.add('hidden');
    elGame.classList.remove('hidden');
  }
}

function randomCard(){
  const suits = ['♣','♦','♥','♠'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return {
    suit: suits[Math.floor(Math.random()*suits.length)],
    value: values[Math.floor(Math.random()*values.length)]
  };
}

function updateSuitCounter(playedSuitCounts, show){
  if (!show) {
    elSuitPanel.classList.add('hidden');
    return;
  }
  elSuitPanel.classList.remove('hidden');
  const suitNames = { '♠':'Spar', '♥':'Hjerter', '♦':'Ruder', '♣':'Klør' };
  elSuitRows.innerHTML = ['♣','♦','♥','♠'].map(s =>
    `<div class="counterRow"><div>${s} ${suitNames[s]}</div><div class="badge">${playedSuitCounts[s] ?? 0}/13</div></div>`
  ).join('');
}

function setTurnGlow(turnIndex){
  for (let i=0;i<4;i++) {
    const seatEl = document.getElementById(`seat${i}`);
    seatEl.classList.toggle('turnGlow', i === turnIndex);
  }
}

function seatPos(seatIndex){
  // positions relative to trick box
  // bottom=0 right=1 top=2 left=3 (matches DOM)
  const map = {
    0: { x: 210, y: 140 }, // near bottom
    1: { x: 320, y: 80  }, // near right
    2: { x: 210, y: 20  }, // near top
    3: { x: 100, y: 80  }  // near left
  };
  return map[seatIndex] || map[0];
}

function animateCardPlay(seatIndex, card){
  const from = seatPos(seatIndex);
  const to = { x: 210, y: 80 }; // center

  const el = document.createElement('div');
  el.className = 'playCard';
  el.innerHTML = `<div class="val">${escapeHtml(card.value)}</div><div class="suit">${escapeHtml(card.suit)}</div>`;
  el.style.left = `${from.x}px`;
  el.style.top = `${from.y}px`;
  elTrick.appendChild(el);

  // force layout
  void el.offsetWidth;
  el.classList.add('fly');
  el.style.transform = `translate(-50%,-50%) scale(1.0)`;

  // fly to center
  requestAnimationFrame(() => {
    el.style.left = `${to.x}px`;
    el.style.top = `${to.y}px`;
  });

  // cleanup after a while to avoid clutter
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%,-50%) scale(0.95)';
    setTimeout(() => el.remove(), 260);
  }, 2200);
}

function renderRoom(room){
  lastRoomState = room;
  elRoomLabel.textContent = room.code;

  // Render seats
  room.seats.forEach((s, i) => {
    const seatEl = document.getElementById(`seat${i}`);
    seatEl.querySelector('.seatName').textContent = s.name;
    const meta = s.kind === 'cpu' ? '🤖 CPU' : (s.socketId ? '🧑 Human' : '⏳ Venter');
    seatEl.querySelector('.seatMeta').textContent = meta;
  });

  setTurnGlow(room.started ? room.currentTurn : -1);

  const starterIsMe = (room.startingSeatIndex === mySeatIndex);
  updateSuitCounter(room.playedSuitCounts, room.started && starterIsMe);

  // Status + play button
  if (!room.started) {
    const humans = room.seats.filter(s => s.kind === 'human' && s.socketId).length;
    elStatus.textContent = `Venter på spillere… (${humans} human / ${room.seats.filter(s=>s.kind==='cpu').length} CPU)`;
    elBtnPlay.disabled = true;
  } else {
    const myTurn = room.currentTurn === mySeatIndex;
    elStatus.textContent = myTurn ? 'Det er din tur (demo): spil et tilfældigt kort.' : `Det er ${room.seats[room.currentTurn].name}s tur.`;
    elBtnPlay.disabled = !myTurn;
  }
}

// Socket events
socket.on('connect', () => {
  elConn.textContent = 'Forbundet';
});

socket.on('disconnect', () => {
  elConn.textContent = 'Ingen forbindelse';
});

socket.on('room:error', (e) => {
  msg(elLobbyMsg, e?.message || 'Der skete en fejl.');
  msg(elGameMsg, e?.message || 'Der skete en fejl.');
});

socket.on('room:joined', ({ code, seatIndex, isHost: hostFlag }) => {
  myRoom = code;
  mySeatIndex = seatIndex;
  isHost = !!hostFlag;
  msg(elLobbyMsg, '');
  msg(elGameMsg, '');
  setView('game');
  elRoomLabel.textContent = myRoom;
});

socket.on('room:update', (room) => {
  if (!myRoom || room.code !== myRoom) return;
  renderRoom(room);
});

socket.on('game:started', ({ startingSeatIndex }) => {
  if (!lastRoomState) return;
  msg(elGameMsg, `Spillet er startet! Starter: ${lastRoomState.seats[startingSeatIndex]?.name || '—'}`);
});

socket.on('game:cardPlayed', ({ seatIndex, card, playedSuitCounts }) => {
  if (!myRoom) return;
  animateCardPlay(seatIndex, card);
  // Update suit counter locally (server also sends via room:update)
  if (lastRoomState) {
    lastRoomState.playedSuitCounts = playedSuitCounts;
    const starterIsMe = (lastRoomState.startingSeatIndex === mySeatIndex);
    updateSuitCounter(playedSuitCounts, lastRoomState.started && starterIsMe);
  }
});

// UI actions
elBtnCreate.addEventListener('click', () => {
  const name = document.getElementById('nameCreate').value.trim() || 'Host';
  const cpuCount = Number(document.getElementById('cpuCount').value);
  socket.emit('room:create', { name, cpuCount });
});

elBtnJoin.addEventListener('click', () => {
  const name = document.getElementById('nameJoin').value.trim() || 'Spiller';
  const code = document.getElementById('roomCode').value.trim();
  socket.emit('room:join', { name, code });
});

elBtnPlay.addEventListener('click', () => {
  if (!myRoom) return;
  socket.emit('game:playCard', { code: myRoom, card: randomCard() });
});

elBtnLeave.addEventListener('click', () => {
  if (myRoom) socket.emit('room:leave', { code: myRoom });
  myRoom = null;
  mySeatIndex = null;
  isHost = false;
  lastRoomState = null;
  elTrick.innerHTML = '';
  setView('lobby');
});

// Start in lobby
setView('lobby');
