/*
  Hjerterfri v1.3.6
  - Online rum (Socket.IO)
  - Fulde grundregler for Hjerterfri (tricks/point/2♣ starter/hearts broken)
  - Passerunde (3 kort) med cyklus: venstre, højre, overfor, ingen (repeat)
  - Simpel CPU-AI
  - Piratwhist-kortlayout (SVG pips + rigtige farver) + bordlayout (4 faste slots) + rolig flyve/collect animation
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

let collectingUntil = 0;

// -------- Helpers --------
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function isRedSuit(suit){
  return suit === '♥' || suit === '♦';
}

// --- Playing card renderer (copied from Piratwhist) ---
function renderCardFace(card){
  const red = isRedSuit(card.suit);
  const wrap = document.createElement('div');
  wrap.className = 'playingcard' + (red ? ' red' : '');

  const c1 = document.createElement('div');
  c1.className = 'corner tl';
  c1.innerHTML = `<div class="rk">${escapeHtml(card.value)}</div><div class="st">${escapeHtml(card.suit)}</div>`;

  const c2 = document.createElement('div');
  c2.className = 'corner br';
  c2.innerHTML = `<div class="rk">${escapeHtml(card.value)}</div><div class="st">${escapeHtml(card.suit)}</div>`;

  wrap.appendChild(c1);
  wrap.appendChild(buildCardSVG(card));
  wrap.appendChild(c2);
  return wrap;
}

function buildCardSVG(card){
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 140');
  svg.setAttribute('class', 'cardface-svg');

  const suit = card.suit;
  const rank = String(card.value);

  function pip(x, y, size, rotate){
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', String(size));
    t.setAttribute('class', 'pip');
    t.textContent = suit;
    if (rotate){
      t.setAttribute('transform', `rotate(${rotate} ${x} ${y})`);
    }
    svg.appendChild(t);
  }

  const isFace = (rank === 'J' || rank === 'Q' || rank === 'K');
  const isAce  = (rank === 'A');

  if (isFace){
    const frame = document.createElementNS(NS, 'rect');
    frame.setAttribute('x','18'); frame.setAttribute('y','28');
    frame.setAttribute('width','64'); frame.setAttribute('height','84');
    frame.setAttribute('rx','10');
    frame.setAttribute('class','face-bg');
    svg.appendChild(frame);

    const head = document.createElementNS(NS, 'circle');
    head.setAttribute('cx','50'); head.setAttribute('cy','60');
    head.setAttribute('r','10');
    head.setAttribute('class','face-fill');
    svg.appendChild(head);

    const body = document.createElementNS(NS, 'path');
    body.setAttribute('d','M34 108 Q50 86 66 108 L66 112 Q50 124 34 112 Z');
    body.setAttribute('class','face-fill');
    svg.appendChild(body);

    const hat = document.createElementNS(NS, 'path');
    if (rank === 'K'){
      hat.setAttribute('d','M34 56 L38 46 L44 58 L50 44 L56 58 L62 46 L66 56 L66 62 L34 62 Z');
    } else if (rank === 'Q'){
      hat.setAttribute('d','M34 58 Q50 40 66 58 L62 50 Q50 46 38 50 Z');
    } else {
      hat.setAttribute('d','M34 56 Q50 48 66 56 L66 66 Q50 70 34 66 Z');
    }
    hat.setAttribute('class','face-line');
    svg.appendChild(hat);

    pip(50, 84, 38, 0);

    const banner = document.createElementNS(NS, 'rect');
    banner.setAttribute('x','30'); banner.setAttribute('y','94');
    banner.setAttribute('width','40'); banner.setAttribute('height','18');
    banner.setAttribute('rx','6');
    banner.setAttribute('class','face-banner');
    svg.appendChild(banner);

    const rt = document.createElementNS(NS, 'text');
    rt.setAttribute('x','50'); rt.setAttribute('y','103');
    rt.setAttribute('text-anchor','middle');
    rt.setAttribute('dominant-baseline','middle');
    rt.setAttribute('class','face-rank');
    rt.textContent = rank;
    svg.appendChild(rt);
    return svg;
  }

  if (isAce){
    pip(50, 74, 64, 0);
    pip(26, 46, 18, 0);
    pip(74, 102, 18, 180);
    return svg;
  }

  const n = parseInt(rank, 10);
  const layouts = {
    2:  [[50, 44],[50, 104]],
    3:  [[50, 38],[50, 74],[50, 110]],
    4:  [[34, 44],[66, 44],[34, 104],[66, 104]],
    5:  [[34, 44],[66, 44],[50, 74],[34, 104],[66, 104]],
    6:  [[34, 40],[66, 40],[34, 74],[66, 74],[34, 108],[66, 108]],
    7:  [[34, 38],[66, 38],[34, 68],[66, 68],[50, 74],[34, 108],[66, 108]],
    8:  [[34, 36],[66, 36],[34, 62],[66, 62],[34, 86],[66, 86],[34, 112],[66, 112]],
    9:  [[34, 34],[66, 34],[34, 58],[66, 58],[50, 74],[34, 92],[66, 92],[34, 116],[66, 116]],
    10: [[30, 34],[70, 34],[34, 56],[66, 56],[30, 78],[70, 78],[34, 100],[66, 100],[30, 122],[70, 122]],
  };
  const pts = layouts[n] || [[50, 74]];
  for (const [x,y] of pts){
    const rot = (y > 74) ? 180 : 0;
    const size = (n >= 8) ? 20 : 22;
    pip(x, y, size, rot);
  }
  return svg;
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

function _fallbackPos(seatIndex){
  // Fallback positions relative to trick box (if DOM is missing for some reason)
  const map = {
    0: { x: 150, y: 240 }, // bottom
    1: { x: 240, y: 150 }, // right
    2: { x: 150, y: 60  }, // top
    3: { x: 60,  y: 150 }  // left
  };
  return map[seatIndex] || map[0];
}

function centerInTrick(el){
  try {
    const tr = elTrick.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: ((r.left + r.right) / 2) - tr.left,
      y: ((r.top + r.bottom) / 2) - tr.top,
    };
  } catch {
    return null;
  }
}

function slotPos(seatIndex){
  const slot = document.getElementById(`slot${seatIndex}`);
  const p = slot ? centerInTrick(slot) : null;
  return p || _fallbackPos(seatIndex);
}

function seatOriginPos(seatIndex){
  const seat = document.getElementById(`seat${seatIndex}`);
  const p = seat ? centerInTrick(seat) : null;
  return p || _fallbackPos(seatIndex);
}

function makePlayCardEl(card){
  const el = document.createElement('div');
  el.className = 'playCard';

  const card3d = document.createElement('div');
  card3d.className = 'card3d';

  const back = document.createElement('div');
  back.className = 'face back';

  const front = document.createElement('div');
  front.className = 'face front';
  front.appendChild(renderCardFace(card));

  card3d.appendChild(back);
  card3d.appendChild(front);
  el.appendChild(card3d);
  return el;
}

function animateCardPlay(seatIndex, card, opts = {}){
  const { startFaceUp = true } = opts;
  const from = seatOriginPos(seatIndex);
  const to = slotPos(seatIndex);

  const el = makePlayCardEl(card);
  el.dataset.seat = String(seatIndex);
  if (startFaceUp) el.classList.add('faceUp');

  el.style.left = `${from.x}px`;
  el.style.top = `${from.y}px`;
  el.style.transform = 'translate(-50%,-50%) scale(0.92)';
  elTrick.appendChild(el);

  // Force layout
  void el.offsetWidth;
  el.classList.add('fly');

  requestAnimationFrame(() => {
    el.style.left = `${to.x}px`;
    el.style.top = `${to.y}px`;
    el.style.transform = 'translate(-50%,-50%) scale(1)';
  });

  return el;
}

function flipCardUp(el){
  if (!el) return;
  el.classList.add('faceUp');
}

function collectTrickToWinner(winnerSeat){
  const cards = [...elTrick.querySelectorAll('.playCard')];
  if (cards.length === 0) return;
  const to = seatOriginPos(winnerSeat);
  cards.forEach(c => {
    c.classList.add('collect');
    c.style.left = `${to.x}px`;
    c.style.top = `${to.y}px`;
    c.style.transform = 'translate(-50%,-50%) scale(0.65)';
  });
  setTimeout(() => {
    cards.forEach(c => {
      c.style.opacity = '0';
    });
    setTimeout(() => cards.forEach(c => c.remove()), 260);
  }, 560);
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
  const total = ps.game.totalPoints || ps.game.totalScores;
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

  // Sort hand by suit then value (tidy hand).
  // Suit order: ♣ ♦ ♥ ♠
  const suitOrder = { '♣': 0, '♦': 1, '♥': 2, '♠': 3 };
  const rankOrder = {
    '2': 2,  '3': 3,  '4': 4,  '5': 5,  '6': 6,  '7': 7,
    '8': 8,  '9': 9,  '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  const sortedHand = [...privateState.hand].sort((a,b) => {
    const sa = suitOrder[a.suit] ?? 99;
    const sb = suitOrder[b.suit] ?? 99;
    if (sa !== sb) return sa - sb;
    const ra = rankOrder[a.value] ?? 99;
    const rb = rankOrder[b.value] ?? 99;
    return ra - rb;
  });

  // Desktop hand should NOT be compact/overlapping.
  // Instead, scale card size + gap so ALL cards fit across the available width.
  // This matches the "fills the full width" feel from Piratwhist.
  try {
    const n = privateState.hand.length;
    const wrap = elHand.closest('.handWrap');
    const containerW = (wrap?.clientWidth || elHand.clientWidth || 0);

    // Reasonable desktop bounds
    const maxW = 86;
    const minW = 44;
    const aspect = 108 / 78; // keep look consistent

    const maxGap = 14;
    const minGap = 6;
    const preferredGap = 10;

    if (n <= 0 || containerW <= 0) {
      // fall back to CSS defaults
    } else if (n === 1) {
      elHand.style.setProperty('--hand-card-w', `${maxW}px`);
      elHand.style.setProperty('--hand-card-h', `${Math.round(maxW * aspect)}px`);
      elHand.style.setProperty('--hand-gap', `0px`);
    } else {
      // Available width for cards + gaps inside the wrap. Leave a little breathing room.
      const padding = 8; // approximate inner padding
      const avail = Math.max(0, containerW - padding * 2);

      // First compute width from preferred gap.
      let w = Math.floor((avail - preferredGap * (n - 1)) / n);
      w = Math.max(minW, Math.min(maxW, w));

      // Then compute the gap that uses the space nicely.
      let gap = Math.floor((avail - w * n) / (n - 1));
      gap = Math.max(minGap, Math.min(maxGap, gap));

      // If gap clamping caused overflow, shrink cards a bit more.
      const needed = w * n + gap * (n - 1);
      if (needed > avail) {
        const w2 = Math.floor((avail - gap * (n - 1)) / n);
        w = Math.max(minW, Math.min(w, w2));
      }

      elHand.style.setProperty('--hand-card-w', `${w}px`);
      elHand.style.setProperty('--hand-card-h', `${Math.round(w * aspect)}px`);
      elHand.style.setProperty('--hand-gap', `${gap}px`);
    }
  } catch (e) {
    // fall back to CSS defaults
  }

  const phase = publicState?.game?.phase;
  const legal = new Set((privateState.legalMoves || []).map(c => `${c.suit}${c.value}`));

  sortedHand.forEach((card) => {
    const key = `${card.suit}${card.value}`;
    const btn = document.createElement('button');
    btn.className = 'handCard';
    // Piratwhist-style playing card face
    btn.innerHTML = '';
    btn.appendChild(renderCardFace(card));

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

  setTurnGlow(ps.started ? (ps.game?.currentTurn ?? -1) : -1);

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
  const trickNo = (ps.game?.trick?.trickNo ?? 0) + 1;
  const heartsBroken = !!ps.game?.heartsBroken;

  if (phase === 'passing') {
    elStatus.textContent = `Runde ${round}: Passerunde (${passDirLabel(ps.game.passDir)}).`;
  } else if (phase === 'playing') {
    const myTurn = ps.game.currentTurn === mySeatIndex;
    const turnName = ps.seats[ps.game.currentTurn]?.name || '—';
    elStatus.textContent = `${myTurn ? 'Din tur' : `Tur: ${turnName}`} • Stik ${trickNo}/13 • Hjerter brudt: ${heartsBroken ? 'ja' : 'nej'}`;
  } else if (phase === 'roundEnd') {
    elStatus.textContent = `Runde ${round} slut. Point er opdateret. Ny runde starter automatisk.`;
  } else if (phase === 'gameOver') {
    const winner = ps.game?.winnerName || '—';
    elStatus.textContent = `Spillet er slut! Vinder: ${winner}`;
  }
}

function applyPublicTrick(ps){
  if (Date.now() < collectingUntil) return;
  // Redraw trick from room public state (fallback). Real-time updates usually come via game:cardPlayed.
  const trickObj = ps.game?.trick;
  if (!trickObj) return;
  const raw = trickObj.cards;
  const plays = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object')
      ? Object.values(raw)
      : [];

  const existing = new Map([...elTrick.querySelectorAll('.playCard')].map(el => [Number(el.dataset.seat), el]));
  const inServer = new Set(plays.map(x => Number(x.seatIndex)));

  // remove stale
  existing.forEach((el, seatIndex) => { if (!inServer.has(seatIndex)) el.remove(); });

  // add missing
  for (const play of plays) {
    const seat = Number(play.seatIndex);
    if (!Number.isFinite(seat) || !play.card) continue;
    if (!existing.has(seat)) {
      const el = animateCardPlay(seat, play.card, { startFaceUp: true });
      // no flight when syncing; snap directly into the correct slot
      const p = slotPos(seat);
      el.classList.remove('fly');
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%,-50%) scale(1)';
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

// Real-time card animations (server authoritative)
socket.on('game:cardPlayed', (e) => {
  if (!myRoom || e?.code && e.code !== myRoom) {
    // some server builds may include code; ignore if not matching
  }
  const seatIndex = Number(e.seatIndex);
  if (!Number.isFinite(seatIndex) || !e.card) return;

  // CPU plays start face-down and flip when the card reaches the center.
  const startFaceUp = (seatIndex === mySeatIndex) || !e.fromCpu;
  const el = animateCardPlay(seatIndex, e.card, { startFaceUp });
  if (!startFaceUp) {
    setTimeout(() => flipCardUp(el), 520);
  }

  // Keep suit counter fresh for starter
  if (e.playedSuitCounts && publicState && publicState.started) {
    const starterIsMe = (publicState.startingSeatIndex === mySeatIndex);
    updateSuitCounter(e.playedSuitCounts, starterIsMe);
  }
});

socket.on('game:trickEnd', (e) => {
  const winner = Number(e.winner);
  if (!Number.isFinite(winner)) {
    clearTrick();
    return;
  }
  // Collect cards to winner seat, then clear.
  collectingUntil = Date.now() + 900;
  collectTrickToWinner(winner);
});

// Server emits per-player state as 'game:privateState'
socket.on('game:privateState', (ps) => {
  if (!myRoom || ps.code !== myRoom) return;

  // Normalize server payload into the shape the UI expects.
  // Server provides: { hand, legalCardKeys, passPickKeys, mustPickPass }
  const hand = ps.hand || [];
  const legalKeys = new Set(ps.legalCardKeys || []);
  const legalMoves = hand.filter(c => legalKeys.has(`${c.suit}${c.value}`));

  privateState = {
    code: ps.code,
    seatIndex: ps.seatIndex,
    hand,
    legalMoves,
    legalCardKeys: [...legalKeys],
    pass: {
      needCount: 3,
      // Consider "sent" when 3 cards are already picked during passing.
      sent: Array.isArray(ps.passPickKeys) && ps.passPickKeys.length === 3,
      pickKeys: ps.passPickKeys || []
    }
  };

  // Restore selected cards (so UI highlights what you already chose)
  if (publicState?.game?.phase === 'passing') {
    selectedPass = new Set(privateState.pass.pickKeys);
  }

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
  const picks = [...selectedPass].map(k => ({ suit: k[0], value: k.slice(1) }));
  socket.emit('game:passSelect', { code: myRoom, picks });
});

// Keep the hand nicely spread across the full width on desktop when the window is resized.
let _handResizeTimer = null;
window.addEventListener('resize', () => {
  if (!privateState?.hand) return;
  clearTimeout(_handResizeTimer);
  _handResizeTimer = setTimeout(() => {
    renderHand();
  }, 80);
});

// Start in lobby
setView('lobby');
