/*
  Hjerterfri v1.2.1
  - Online rum (Socket.IO)
  - Fulde grundregler for Hjerterfri (tricks/point/2♣ starter/hearts broken)
  - Passerunde (3 kort) med cyklus: venstre, højre, overfor, ingen (repeat)
  - Simpel CPU-AI
  - Rundt bord UI + kort-animationer til midten
*/

const socket = io();

// -------- UI refs --------
const elConn = document.getElementById('conn');
const elLobby = document.getElementById('lobby');
const elGame = document.getElementById('game');
const elLobbyMsg = document.getElementById('lobbyMsg');
const elGameMsg = document.getElementById('gameMsg');
const elStatus = document.getElementById('status');
const elRoomLabel = document.getElementById('roomLabel');
const elBtnCreate = document.getElementById('btnCreate');
const elBtnJoin = document.getElementById('btnJoin');
const elBtnLeave = document.getElementById('btnLeave');
const elSuitPanel = document.getElementById('suitCounter');
const elSuitRows = document.getElementById('suitCounterRows');
const elTrick = document.getElementById('trick');
const elHand = document.getElementById('hand');
const elPassPanel = document.getElementById('passPanel');
// HTML uses id="btnPass"
const elPassBtn = document.getElementById('btnPass');
// HTML uses id="scoreRows"
const elScores = document.getElementById('scoreRows');

// -------- Local state --------
let myRoom = null;
let mySeatIndex = null;
let isHost = false;
let publicState = null; // room public state
let privateState = null; // per-player state (hand, legal moves, etc.)

let selectedPass = new Set();

// -------- Helpers --------
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function msg(el, text, kind = '') {
  el.innerHTML = text ? `<div class="${kind}">${escapeHtml(text)}</div>` : '';
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

function passDirLabel(passDir){
  switch(passDir){
    case 'left': return 'Venstre';
    case 'right': return 'Højre';
    case 'across': return 'Overfor';
    case 'none': return 'Ingen';
    default: return '—';
  }
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
  const map = {
    0: { x: 210, y: 150 }, // bottom
    1: { x: 332, y: 86  }, // right
    2: { x: 210, y: 22  }, // top
    3: { x: 88,  y: 86  }  // left
  };
  return map[seatIndex] || map[0];
}

function animateCardPlay(seatIndex, card, keepOnTable = true){
  const from = seatPos(seatIndex);
  const to = { x: 210, y: 86 };

  const el = document.createElement('div');
  el.className = 'playCard';
  el.dataset.seat = String(seatIndex);
  el.innerHTML = `<div class="val">${escapeHtml(card.value)}</div><div class="suit">${escapeHtml(card.suit)}</div>`;
  el.style.left = `${from.x}px`;
  el.style.top = `${from.y}px`;
  elTrick.appendChild(el);

  void el.offsetWidth;
  el.classList.add('fly');

  requestAnimationFrame(() => {
    el.style.left = `${to.x}px`;
    el.style.top = `${to.y}px`;
  });

  if (!keepOnTable) {
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 1100);
  }
}

function clearTrick(){
  // fade out old trick cards
  const cards = [...elTrick.querySelectorAll('.playCard')];
  cards.forEach(c => c.classList.add('fadeOut'));
  setTimeout(() => {
    cards.forEach(c => c.remove());
  }, 260);
}

function renderScores(ps){
  if (!ps?.game) return;
  const s = ps.seats;
  const total = ps.game.totalScores;
  const roundPts = ps.game.roundPoints;
  const rows = s.map((seat, i) => {
    const you = (i === mySeatIndex) ? ' (dig)' : '';
    return `<tr><td>${escapeHtml(seat.name)}${you}</td><td>${roundPts?.[i] ?? 0}</td><td>${total?.[i] ?? 0}</td></tr>`;
  }).join('');
  elScores.innerHTML = `
    <table class="scoreTable">
      <thead><tr><th>Spiller</th><th>Runde</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderHand(){
  elHand.innerHTML = '';
  selectedPass = selectedPass; // keep
  if (!privateState?.hand) return;

  const phase = publicState?.game?.phase;
  const legal = new Set((privateState.legalMoves || []).map(c => `${c.suit}${c.value}`));

  privateState.hand.forEach((card) => {
    const key = `${card.suit}${card.value}`;
    const btn = document.createElement('button');
    btn.className = 'handCard';
    btn.innerHTML = `<div class="val">${escapeHtml(card.value)}</div><div class="suit">${escapeHtml(card.suit)}</div>`;

    const isLegal = legal.has(key);
    const isSelected = selectedPass.has(key);

    if (phase === 'passing') {
      btn.classList.toggle('selected', isSelected);
      btn.disabled = false;
      btn.addEventListener('click', () => {
        if (selectedPass.has(key)) selectedPass.delete(key);
        else {
          if (selectedPass.size >= 3) return;
          selectedPass.add(key);
        }
        renderHand();
        updatePassPanel();
      });
    } else {
      btn.disabled = !isLegal;
      btn.classList.toggle('illegal', !isLegal);
      btn.addEventListener('click', () => {
        if (!isLegal) return;
        socket.emit('game:playCard', { code: myRoom, card });
      });
    }

    elHand.appendChild(btn);
  });
}

function updatePassPanel(){
  const phase = publicState?.game?.phase;
  const passDir = publicState?.game?.passDir;
  const need = privateState?.pass?.needCount ?? 3;
  const sent = privateState?.pass?.sent ?? false;

  if (phase !== 'passing' || passDir === 'none') {
    elPassPanel.classList.add('hidden');
    return;
  }
  elPassPanel.classList.remove('hidden');

  const picked = selectedPass.size;
  const label = sent ? 'Kort sendt ✅' : `Vælg ${need} kort og send (${picked}/${need}) — passer ${passDirLabel(passDir)}`;
  // HTML uses id="passInfo"
  const passInfoEl = document.getElementById('passInfo');
  if (passInfoEl) passInfoEl.textContent = label;
  elPassBtn.disabled = sent || picked !== need;
}

function renderPublic(ps){
  publicState = ps;
  elRoomLabel.textContent = ps.code;
  renderScores(ps);

  // seats
  ps.seats.forEach((s, i) => {
    const seatEl = document.getElementById(`seat${i}`);
    seatEl.querySelector('.seatName').textContent = s.name;
    const meta = s.kind === 'cpu' ? '🤖 CPU' : (s.socketId ? '🧑 Human' : '⏳ Venter');
    const count = ps.game?.handCounts?.[i];
    seatEl.querySelector('.seatMeta').textContent = (count != null && ps.started) ? `${meta} • ${count} kort` : meta;
  });

  setTurnGlow(ps.started ? ps.currentTurn : -1);

  const starterIsMe = (ps.startingSeatIndex === mySeatIndex);
  updateSuitCounter(ps.playedSuitCounts, ps.started && starterIsMe);

  // status
  if (!ps.started) {
    const humans = ps.seats.filter(s => s.kind === 'human' && s.socketId).length;
    elStatus.textContent = `Venter på spillere… (${humans} human / ${ps.seats.filter(s=>s.kind==='cpu').length} CPU)`;
    return;
  }

  const phase = ps.game?.phase;
  const round = ps.game?.round ?? 1;
  const trickNo = (ps.game?.trickIndex ?? 0) + 1;
  const heartsBroken = !!ps.game?.heartsBroken;

  if (phase === 'passing') {
    elStatus.textContent = `Runde ${round}: Passerunde (${passDirLabel(ps.game.passDir)}).`;
  } else if (phase === 'playing') {
    const myTurn = ps.currentTurn === mySeatIndex;
    const turnName = ps.seats[ps.currentTurn]?.name || '—';
    elStatus.textContent = `${myTurn ? 'Din tur' : `Tur: ${turnName}`} • Stik ${trickNo}/13 • Hjerter brudt: ${heartsBroken ? 'ja' : 'nej'}`;
  } else if (phase === 'roundEnd') {
    elStatus.textContent = `Runde ${round} slut. Point er opdateret. Ny runde starter automatisk.`;
  } else if (phase === 'gameOver') {
    const winner = ps.game?.winnerName || '—';
    elStatus.textContent = `Spillet er slut! Vinder: ${winner}`;
  }
}

function applyPublicTrick(ps){
  // redraw trick from server state (authoritative)
  const t = ps.game?.trick || [];
  // Remove trick cards that aren't in server trick
  const existing = new Map([...elTrick.querySelectorAll('.playCard')].map(el => [Number(el.dataset.seat), el]));
  const inServer = new Set(t.map(x => x.seatIndex));
  existing.forEach((el, seatIndex) => { if (!inServer.has(seatIndex)) el.remove(); });

  for (const play of t) {
    if (!existing.has(play.seatIndex)) {
      animateCardPlay(play.seatIndex, play.card, true);
    }
  }
}

// -------- Socket events --------
socket.on('connect', () => { elConn.textContent = 'Forbundet'; });
socket.on('disconnect', () => { elConn.textContent = 'Ingen forbindelse'; });

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
  selectedPass = new Set();
  setView('game');
  elRoomLabel.textContent = myRoom;
});

socket.on('room:update', (room) => {
  if (!myRoom || room.code !== myRoom) return;
  renderPublic(room);
  applyPublicTrick(room);
  updatePassPanel();
});

socket.on('game:private', (ps) => {
  if (!myRoom || ps.code !== myRoom) return;
  privateState = ps;
  renderHand();
  updatePassPanel();
});

socket.on('game:trickCleared', () => {
  clearTrick();
});

socket.on('game:info', (e) => {
  msg(elGameMsg, e?.message || '');
});

// -------- UI actions --------
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

elBtnLeave.addEventListener('click', () => {
  if (myRoom) socket.emit('room:leave', { code: myRoom });
  myRoom = null;
  mySeatIndex = null;
  isHost = false;
  publicState = null;
  privateState = null;
  selectedPass = new Set();
  elTrick.innerHTML = '';
  elHand.innerHTML = '';
  elScores.innerHTML = '';
  setView('lobby');
});

elPassBtn.addEventListener('click', () => {
  if (!myRoom) return;
  const cards = [...selectedPass].map(k => ({ suit: k[0], value: k.slice(1) }));
  socket.emit('game:pass', { code: myRoom, cards });
});

// Start in lobby
setView('lobby');
