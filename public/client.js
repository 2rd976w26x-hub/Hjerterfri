/* Hjerterfri Online v1.3.16 - client */

const VERSION = '1.3.15';

const socket = io();

let mySeat = null;
let roomId = null;
let state = null;
let selectedPass = new Set();
let lastTrickPlays = [null, null, null, null];

const el = (id) => document.getElementById(id);

const nameInput = el('nameInput');
const roomInput = el('roomInput');
const createBtn = el('createBtn');
const joinBtn = el('joinBtn');
const startBtn = el('startBtn');
const send3Btn = el('send3Btn');
const handCards = el('handCards');
const statusEl = el('status');
const scoresEl = el('scores');
const logEl = el('log');
const toastEl = el('toast');
const turnHint = el('turnHint');
const suitCountPanel = el('suitCount');
const suitCountBody = el('suitCountBody');

const logToggleBtn = el('logToggleBtn');

function setLogVisible(vis){
  document.body.classList.toggle('logHidden', !vis);
  if (logToggleBtn) logToggleBtn.textContent = vis ? 'Skjul status' : 'Vis status';
  try{ localStorage.setItem('hf_log_visible', vis ? '1' : '0'); }catch(e){}
}

(function initLogToggle(){
  let vis = false;
  try{ vis = localStorage.getItem('hf_log_visible') === '1'; }catch(e){}
  setLogVisible(vis);
  if (logToggleBtn){
    logToggleBtn.addEventListener('click', ()=>{
      const nowVis = !document.body.classList.contains('logHidden');
      setLogVisible(!nowVis);
    });
  }
})();

const slotEls = {
  0: el('slotBottom'),
  1: el('slotLeft'),
  2: el('slotTop'),
  3: el('slotRight')
};

const playerTagEls = {
  0: el('pBottom'),
  1: el('pLeft'),
  2: el('pTop'),
  3: el('pRight')
};

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), 2000);
}

function suitSymbol(s) {
  return s === 'C' ? '♣' : s === 'D' ? '♦' : s === 'S' ? '♠' : '♥';
}

function isRedSuit(s) {
  return s === 'H' || s === 'D';
}

function parseCard(id) {
  if (!id || id === 'BACK') return null;
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { id, suit, rank };
}

function orderA2(rank) {
  if (rank === 'A') return 0;
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  return 1 + ranks.indexOf(rank);
}

function sortHand(hand) {
  const suitOrder = { C: 0, D: 1, S: 2, H: 3 };
  return hand.slice().sort((a, b) => {
    const ca = parseCard(a);
    const cb = parseCard(b);
    if (!ca || !cb) return 0;
    if (suitOrder[ca.suit] !== suitOrder[cb.suit]) return suitOrder[ca.suit] - suitOrder[cb.suit];
    return orderA2(ca.rank) - orderA2(cb.rank);
  });
}

function makeCardEl(cardId, faceUp = true) {
  const d = document.createElement('div');
  d.className = 'card';
  if (!faceUp) d.classList.add('back');
  if (cardId === 'BACK') {
    d.classList.add('back');
    d.dataset.card = 'BACK';
    return d;
  }
  const c = parseCard(cardId);
  d.dataset.card = cardId;

  const tl = document.createElement('div');
  tl.className = 'corner tl';
  const br = document.createElement('div');
  br.className = 'corner br';

  const rank = document.createElement('div');
  rank.className = 'rank';
  rank.textContent = c.rank;

  const suit = document.createElement('div');
  suit.className = 'suit';
  suit.textContent = suitSymbol(c.suit);

  tl.append(rank.cloneNode(true), suit.cloneNode(true));
  br.append(rank, suit);

  const pip = document.createElement('div');
  pip.className = 'pip';
  pip.textContent = suitSymbol(c.suit);

  if (isRedSuit(c.suit)) d.classList.add('red');

  d.append(tl, pip, br);
  return d;
}

function clearSlots() {
  for (const k of Object.keys(slotEls)) slotEls[k].innerHTML = '';
}

function renderSlots() {
  if (!state) return;

  // Place cards for each seat. CPU cards are BACK for players not you.
  for (let seat = 0; seat < 4; seat++) {
    const id = state.trick.plays[seat];
    const slot = slotEls[seat];
    slot.innerHTML = '';
    if (!id) continue;

    const isMine = seat === mySeat;
    const isHidden = !isMine && id === 'BACK';
    const cardEl = makeCardEl(id, !isHidden);
    slot.append(cardEl);
  }
}

function renderPlayers() {
  if (!state) return;
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const name = p ? p.name : '—';
    playerTagEls[i].textContent = `${name} (${state.scores[i] ?? 0})`;
    playerTagEls[i].classList.toggle('active', state.phase === 'playing' && state.trick.turn === i);
  }

  const me = state.players[mySeat];
  const showSuitCount = !!(me && /jim/i.test(me.name || ''));
  suitCountPanel.hidden = !showSuitCount;
}

function renderScores() {
  if (!state) return;
  scoresEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'scoreRow';
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const item = document.createElement('div');
    item.className = 'scoreItem';
    item.textContent = `${p ? p.name : '—'}: ${state.scores[i]}`;
    wrap.append(item);
  }
  scoresEl.append(wrap);
}

function renderLog() {
  if (!state) return;
  logEl.innerHTML = '';
  for (const line of state.log || []) {
    const d = document.createElement('div');
    d.className = 'logLine';
    d.textContent = line;
    logEl.append(d);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function renderSuitCount() {
  if (!state) return;
  // We can only count visible played cards (the trick shows actual for us; other hands hidden doesn't matter)
  // We'll count taken cards indirectly isn't available to client, so we count trick cards seen in log/trick.
  // Minimal but functional: count cards played in current trick by suit.
  const counts = { C: 0, D: 0, S: 0, H: 0 };
  for (const id of state.trick.plays) {
    const c = parseCard(id);
    if (!c || id === 'BACK') continue;
    counts[c.suit] += 1;
  }
  suitCountBody.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'suitRow';
  for (const s of ['C','D','S','H']) {
    const chip = document.createElement('div');
    chip.className = 'suitChip';
    chip.textContent = `${suitSymbol(s)} ${counts[s]}`;
    row.append(chip);
  }
  suitCountBody.append(row);
}

function canPlayCard(cardId) {
  // Client does NOT decide legality; but we can gate UI a bit.
  if (!state) return false;
  if (state.phase !== 'playing') return false;
  if (state.trick.turn !== mySeat) return false;
  return true;
}

function renderHand() {
  if (!state || mySeat === null) return;
  handCards.innerHTML = '';

  const hand = sortHand(state.hands[mySeat] || []);
  const isPassing = state.phase === 'passing' && state.passRotation !== 'none';

  for (const id of hand) {
    const cardEl = makeCardEl(id, true);
    cardEl.classList.toggle('selectable', isPassing || canPlayCard(id));

    if (isPassing) {
      if (selectedPass.has(id)) cardEl.classList.add('selected');
      cardEl.addEventListener('click', () => {
        if (selectedPass.has(id)) selectedPass.delete(id);
        else {
          if (selectedPass.size >= 3) return;
          selectedPass.add(id);
        }
        renderHand();
        updateSend3Btn();
      });
    } else {
      cardEl.addEventListener('click', () => {
        if (!canPlayCard(id)) return;
        animateCardToSlot(cardEl, mySeat);
        socket.emit('play', { roomId, seat: mySeat, card: id });
      });
    }

    handCards.append(cardEl);
  }

  updateSend3Btn();
}

function updateSend3Btn() {
  const isPassing = state && state.phase === 'passing' && state.passRotation !== 'none';
  send3Btn.disabled = !isPassing || selectedPass.size !== 3;
}

function animateCardToSlot(cardEl, seat) {
  // Simple fly animation: clone card and move to slot.
  const slot = slotEls[seat];
  if (!slot) return;
  const from = cardEl.getBoundingClientRect();
  const to = slot.getBoundingClientRect();

  const clone = cardEl.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  clone.style.zIndex = 9999;
  clone.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
  document.body.append(clone);

  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.98)`;
  });

  setTimeout(() => {
    clone.remove();
  }, 500);
}

function updateUI() {
  if (!state) return;

  startBtn.disabled = !roomId || (state.phase !== 'lobby' && state.phase !== 'scoring');

  if (state.phase === 'lobby') {
    statusEl.textContent = `Lobby – Room: ${roomId} (klar til start)`;
    turnHint.textContent = '';
  } else if (state.phase === 'passing') {
    statusEl.textContent = `Passing (${state.passRotation}) – vælg 3 kort`;
    turnHint.textContent = selectedPass.size ? `${selectedPass.size}/3 valgt` : '';
  } else if (state.phase === 'playing') {
    const turnName = state.players[state.trick.turn]?.name || '—';
    statusEl.textContent = `Stik ${state.trickNo} – Tur: ${turnName} – Hearts broken: ${state.heartsBroken ? 'Ja' : 'Nej'}`;
    turnHint.textContent = state.trick.turn === mySeat ? 'Din tur' : '';
  } else if (state.phase === 'scoring') {
    statusEl.textContent = `Omgang slut – Point (denne omgang): ${state.lastHandPoints.join(' / ')}`;
    turnHint.textContent = 'Tryk Start omgang for næste omgang';
  }

  renderPlayers();
  renderScores();
  renderLog();
  renderSlots();
  renderHand();
  renderSuitCount();
}

createBtn.addEventListener('click', () => {
  const name = (nameInput.value || '').trim() || 'Player';
  const rid = (roomInput.value || '').trim();
  socket.emit('create_room', { roomId: rid, name });
});

joinBtn.addEventListener('click', () => {
  const name = (nameInput.value || '').trim() || 'Player';
  const rid = (roomInput.value || '').trim();
  if (!rid) return showToast('Indtast Room ID');
  socket.emit('join_room', { roomId: rid, name });
});

startBtn.addEventListener('click', () => {
  if (!roomId) return;
  if (!state) return;

  // If scoring, server starts next hand; visuals are client-side (we keep it simple here)
  if (state.phase === 'scoring') {
    socket.emit('next_hand', { roomId });
  } else {
    socket.emit('start_hand', { roomId });
  }
});

send3Btn.addEventListener('click', () => {
  if (!roomId) return;
  if (selectedPass.size !== 3) return;
  socket.emit('pass_select', { roomId, seat: mySeat, cards: Array.from(selectedPass) });
});

socket.on('hello', (data) => {
  statusEl.textContent = `Forbundet (server v${data.version}) – klar`;
});

socket.on('joined', (data) => {
  roomId = data.roomId;
  mySeat = data.seat;
  roomInput.value = roomId;
  selectedPass.clear();
  showToast(`Joined ${roomId} som seat ${mySeat + 1}`);
});

socket.on('state', (s) => {
  state = s;
  // Reset pass selections if phase changes
  if (state.phase !== 'passing') selectedPass.clear();
  updateUI();
});

socket.on('illegal', ({ message }) => {
  showToast(message || 'Ulovligt træk');
});

socket.on('error_msg', ({ message }) => {
  showToast(message || 'Fejl');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    selectedPass.clear();
    updateUI();
  }
});

// Initial UI
statusEl.textContent = `Hjerterfri v${VERSION} – forbinder...`;
