/*
  Hjerterfri Online (Hearts) - v1.3.16
  Tech: Node.js + Express + Socket.IO
  Principle: Server-authoritative validation.
*/

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const VERSION = '1.3.13';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Game model ----------

const SUITS = ['C', 'D', 'S', 'H']; // Clubs, Diamonds, Spades, Hearts
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function cardId(suit, rank) {
  return `${rank}${suit}`;
}

function parseCard(id) {
  // e.g. "QH", "10S"
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { suit, rank, id };
}

function rankValue(rank) {
  // Low to high for comparisons
  return RANKS.indexOf(rank);
}

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push(cardId(s, r));
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pointsOfCard(id) {
  const c = parseCard(id);
  if (c.suit === 'H') return 1;
  if (c.suit === 'S' && c.rank === 'Q') return 13;
  return 0;
}

function isHeartsCard(id) {
  return parseCard(id).suit === 'H';
}

function isQueenSpades(id) {
  const c = parseCard(id);
  return c.suit === 'S' && c.rank === 'Q';
}

function hasSuit(hand, suit) {
  return hand.some((id) => parseCard(id).suit === suit);
}

function sortHand(hand) {
  // Suit order: Clubs -> Diamonds -> Spades -> Hearts
  const suitOrder = { C: 0, D: 1, S: 2, H: 3 };
  return hand.slice().sort((a, b) => {
    const ca = parseCard(a);
    const cb = parseCard(b);
    if (suitOrder[ca.suit] !== suitOrder[cb.suit]) return suitOrder[ca.suit] - suitOrder[cb.suit];
    // Within suit: A -> 2 (as requested)
    // We'll map A high but sort A first by custom value
    const orderA2 = (rank) => {
      if (rank === 'A') return 0;
      return 1 + RANKS.indexOf(rank); // 2 becomes 1, 3 becomes 2, ...
    };
    return orderA2(ca.rank) - orderA2(cb.rank);
  });
}

function findTwoClubsIndex(hand) {
  return hand.indexOf('2C');
}

function makeEmptyTrick() {
  return {
    leadSuit: null,
    plays: [null, null, null, null], // card ids
    leader: 0,
    turn: 0
  };
}

function nextPlayer(i) {
  return (i + 1) % 4;
}

function rotationForHandNumber(handNo) {
  // 0 left, 1 right, 2 across, 3 none
  const mod = handNo % 4;
  if (mod === 0) return 'left';
  if (mod === 1) return 'right';
  if (mod === 2) return 'across';
  return 'none';
}

function passTarget(fromIndex, rotation) {
  if (rotation === 'left') return (fromIndex + 1) % 4;
  if (rotation === 'right') return (fromIndex + 3) % 4;
  if (rotation === 'across') return (fromIndex + 2) % 4;
  return fromIndex;
}

function computeTrickWinner(trick) {
  const leadSuit = trick.leadSuit;
  let best = null;
  let bestPlayer = null;
  for (let p = 0; p < 4; p++) {
    const id = trick.plays[p];
    if (!id) continue;
    const c = parseCard(id);
    if (c.suit !== leadSuit) continue;
    const v = rankValue(c.rank);
    if (best === null || v > best) {
      best = v;
      bestPlayer = p;
    }
  }
  return bestPlayer;
}

function trickPoints(trick) {
  return trick.plays.reduce((sum, id) => sum + (id ? pointsOfCard(id) : 0), 0);
}

function allNull(arr) {
  return arr.every((x) => x === null);
}

// ---------- Rooms ----------

const rooms = new Map();

function makeRoom(roomId) {
  return {
    id: roomId,
    createdAt: Date.now(),
    version: VERSION,
    players: [null, null, null, null], // {id, name, type:'human'|'cpu'}
    sockets: [null, null, null, null],
    handNo: 0,
    phase: 'lobby', // lobby | passing | playing | scoring
    passRotation: 'left',
    passSelections: [[], [], [], []],
    hands: [[], [], [], []],
    taken: [[], [], [], []],
    scores: [0, 0, 0, 0],
    heartsBroken: false,
    trick: makeEmptyTrick(),
    trickNo: 0,
    lastTrickWinner: null,
    lastHandPoints: [0, 0, 0, 0],
    log: []
  };
}

function publicState(room, forSeat) {
  // Hide other players' hands (unless spectator seat is null)
  const handsPublic = room.hands.map((h, idx) => (idx === forSeat ? h : new Array(h.length).fill('BACK')));
  return {
    id: room.id,
    version: room.version,
    phase: room.phase,
    handNo: room.handNo,
    passRotation: room.passRotation,
    players: room.players,
    scores: room.scores,
    heartsBroken: room.heartsBroken,
    trick: room.trick,
    trickNo: room.trickNo,
    lastTrickWinner: room.lastTrickWinner,
    lastHandPoints: room.lastHandPoints,
    hands: handsPublic,
    passSelectionsCount: room.passSelections.map((s) => s.length),
    log: room.log.slice(-20)
  };
}

function broadcastRoom(room) {
  for (let seat = 0; seat < 4; seat++) {
    const sockId = room.sockets[seat];
    if (!sockId) continue;
    io.to(sockId).emit('state', publicState(room, seat));
  }
  // Also broadcast to room channel for spectators
  io.to(room.id).emit('state_spectator', publicState(room, null));
}

function roomHasHumans(room) {
  return room.players.some((p) => p && p.type === 'human');
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 200) room.log.shift();
}

function ensureCPUs(room) {
  for (let i = 0; i < 4; i++) {
    if (!room.players[i]) {
      room.players[i] = { id: `cpu-${room.id}-${i}`, name: `CPU ${i + 1}`, type: 'cpu' };
    }
  }
}

function startNewHand(room) {
  room.handNo += 1;
  room.phase = 'passing';
  room.passRotation = rotationForHandNumber(room.handNo - 1);
  room.passSelections = [[], [], [], []];
  room.heartsBroken = false;
  room.taken = [[], [], [], []];
  room.trick = makeEmptyTrick();
  room.trickNo = 0;
  room.lastTrickWinner = null;
  room.lastHandPoints = [0, 0, 0, 0];

  const deck = shuffle(makeDeck());
  for (let i = 0; i < 4; i++) {
    room.hands[i] = sortHand(deck.slice(i * 13, (i + 1) * 13));
  }

  addLog(room, `Ny omgang #${room.handNo} – passing: ${room.passRotation}`);

  // If rotation is none, skip passing instantly
  if (room.passRotation === 'none') {
    room.phase = 'playing';
    initFirstTrick(room);
  } else {
    // CPUs auto-pick passing cards
    for (let i = 0; i < 4; i++) {
      if (room.players[i]?.type === 'cpu') {
        room.passSelections[i] = pickPassCardsCPU(room, i);
        addLog(room, `${room.players[i].name} valgte 3 kort til passing.`);
      }
    }
    checkResolvePassing(room);
  }
}

function initFirstTrick(room) {
  // Find who has 2C
  let leader = 0;
  for (let i = 0; i < 4; i++) {
    if (room.hands[i].includes('2C')) {
      leader = i;
      break;
    }
  }
  room.trick = makeEmptyTrick();
  room.trick.leader = leader;
  room.trick.turn = leader;
  room.trick.leadSuit = null;
  room.trick.plays = [null, null, null, null];
  room.trickNo = 1;
  addLog(room, `Første stik: ${room.players[leader]?.name || 'Spiller'} starter (har 2♣).`);
  maybeAutoPlayCPU(room);
}

function legalMoves(room, seat) {
  const hand = room.hands[seat];
  const trick = room.trick;
  const isFirstTrick = room.trickNo === 1;
  const isLeading = allNull(trick.plays);

  // Must play 2C to lead first trick
  if (isFirstTrick && isLeading) {
    if (hand.includes('2C')) return ['2C'];
  }

  const leadSuit = trick.leadSuit;
  if (!isLeading && leadSuit) {
    // must follow suit if possible
    if (hasSuit(hand, leadSuit)) {
      return hand.filter((id) => parseCard(id).suit === leadSuit);
    }
    // otherwise any card, but first trick restrictions apply
    if (isFirstTrick) {
      const filtered = hand.filter((id) => !isHeartsCard(id) && !isQueenSpades(id));
      return filtered.length ? filtered : hand.slice();
    }
    return hand.slice();
  }

  // leading
  if (!room.heartsBroken) {
    // cannot lead hearts unless only hearts
    const nonHearts = hand.filter((id) => !isHeartsCard(id));
    const onlyHearts = nonHearts.length === 0;
    if (!onlyHearts) {
      const nonHeartLead = hand.filter((id) => !isHeartsCard(id));
      // still must respect first trick restrictions if first trick
      if (isFirstTrick) {
        const filtered = nonHeartLead.filter((id) => !isQueenSpades(id));
        return filtered.length ? filtered : nonHeartLead;
      }
      return nonHeartLead;
    }
  }

  // first trick lead also disallows hearts and QS, but 2C already forced
  if (isFirstTrick) {
    const filtered = hand.filter((id) => !isHeartsCard(id) && !isQueenSpades(id));
    return filtered.length ? filtered : hand.slice();
  }

  return hand.slice();
}

function playCard(room, seat, card) {
  if (room.phase !== 'playing') return { ok: false, err: 'Not in playing phase' };
  if (room.trick.turn !== seat) return { ok: false, err: 'Not your turn' };

  const hand = room.hands[seat];
  if (!hand.includes(card)) return { ok: false, err: 'Card not in hand' };

  const legal = legalMoves(room, seat);
  if (!legal.includes(card)) return { ok: false, err: 'Illegal move' };

  // apply
  room.hands[seat] = sortHand(hand.filter((c) => c !== card));

  // set lead suit
  if (allNull(room.trick.plays)) {
    room.trick.leadSuit = parseCard(card).suit;
  }
  room.trick.plays[seat] = card;

  // hearts broken?
  if (isHeartsCard(card) && !room.heartsBroken) room.heartsBroken = true;

  addLog(room, `${room.players[seat]?.name || 'Spiller'} spillede ${cardDisplay(card)}.`);

  // advance turn or resolve trick
  if (room.trick.plays.every((x) => x !== null)) {
    resolveTrick(room);
  } else {
    room.trick.turn = nextPlayer(room.trick.turn);
    maybeAutoPlayCPU(room);
  }

  return { ok: true };
}

function cardDisplay(id) {
  const c = parseCard(id);
  const suitSym = c.suit === 'C' ? '♣' : c.suit === 'D' ? '♦' : c.suit === 'S' ? '♠' : '♥';
  return `${c.rank}${suitSym}`;
}

function resolveTrick(room) {
  const winner = computeTrickWinner(room.trick);
  const pts = trickPoints(room.trick);
  room.lastTrickWinner = winner;

  // store taken cards
  room.taken[winner].push(...room.trick.plays);

  addLog(room, `Stik vundet af ${room.players[winner]?.name || 'Spiller'} (+${pts} point i stik).`);

  // next trick or scoring
  if (room.hands[0].length === 0) {
    // hand finished
    finalizeHand(room);
    return;
  }

  room.trick = makeEmptyTrick();
  room.trick.leader = winner;
  room.trick.turn = winner;
  room.trickNo += 1;

  maybeAutoPlayCPU(room);
}

function finalizeHand(room) {
  room.phase = 'scoring';

  // count points
  const pts = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    pts[i] = room.taken[i].reduce((sum, id) => sum + pointsOfCard(id), 0);
  }

  // shoot the moon
  const shooter = pts.findIndex((p) => p === 26);
  if (shooter !== -1) {
    addLog(room, `${room.players[shooter]?.name || 'Spiller'} skød månen! (Shoot the Moon)`);
    for (let i = 0; i < 4; i++) {
      if (i === shooter) pts[i] = 0;
      else pts[i] = 26;
    }
  }

  room.lastHandPoints = pts.slice();
  for (let i = 0; i < 4; i++) room.scores[i] += pts[i];

  addLog(room, `Omgang slut. Point: ${pts.map((p) => p).join(' / ')}`);

  // Wait timings handled client-side; server just starts next hand when requested.
}

function checkResolvePassing(room) {
  if (room.passRotation === 'none') return;
  const done = room.passSelections.every((sel) => sel.length === 3);
  if (!done) return;

  // Validate each selection is in hand
  for (let i = 0; i < 4; i++) {
    const hand = room.hands[i];
    for (const c of room.passSelections[i]) {
      if (!hand.includes(c)) {
        addLog(room, `Passing fejl: ${room.players[i]?.name} valgte et kort de ikke har.`);
        // reset their selection
        room.passSelections[i] = [];
        return;
      }
    }
  }

  // Remove selected cards
  const outgoing = room.passSelections.map((sel) => sel.slice());
  for (let i = 0; i < 4; i++) {
    room.hands[i] = room.hands[i].filter((c) => !outgoing[i].includes(c));
  }

  // Deliver
  const rotation = room.passRotation;
  for (let from = 0; from < 4; from++) {
    const to = passTarget(from, rotation);
    room.hands[to].push(...outgoing[from]);
  }

  // Sort
  for (let i = 0; i < 4; i++) room.hands[i] = sortHand(room.hands[i]);

  room.phase = 'playing';
  addLog(room, `Passing gennemført (${rotation}). Spillet starter.`);
  initFirstTrick(room);
}

function pickPassCardsCPU(room, seat) {
  // Simple: pass high spades + queen spades + high hearts; otherwise highest cards
  const hand = room.hands[seat].slice();
  const scored = hand
    .map((id) => {
      const c = parseCard(id);
      let score = 0;
      // Queen of spades very pass-worthy
      if (isQueenSpades(id)) score += 1000;
      // high spades risky
      if (c.suit === 'S') score += 20 + rankValue(c.rank);
      // hearts pass moderately
      if (c.suit === 'H') score += 10 + rankValue(c.rank);
      // high cards generally
      score += rankValue(c.rank);
      return { id, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((x) => x.id);
}

function pickPlayCPU(room, seat) {
  const legal = legalMoves(room, seat);
  // Avoid points if possible, otherwise play lowest legal
  const noPoints = legal.filter((id) => pointsOfCard(id) === 0);
  const choices = noPoints.length ? noPoints : legal;

  // "Plays lowest legal" within choices
  const byLow = choices.slice().sort((a, b) => {
    const ca = parseCard(a);
    const cb = parseCard(b);
    if (ca.suit !== cb.suit) return SUITS.indexOf(ca.suit) - SUITS.indexOf(cb.suit);
    return rankValue(ca.rank) - rankValue(cb.rank);
  });

  // If queen spades is legal and we are void in lead suit, dump it
  const trick = room.trick;
  const isFollowingVoid = trick.leadSuit && !hasSuit(room.hands[seat], trick.leadSuit);
  if (isFollowingVoid && legal.includes('QS')) {
    return 'QS';
  }

  return byLow[0];
}

function maybeAutoPlayCPU(room) {
  // If it's a CPU's turn, play with a small delay
  const seat = room.trick.turn;
  if (room.phase !== 'playing') return;
  if (room.players[seat]?.type !== 'cpu') return;

  setTimeout(() => {
    // State may have advanced
    if (!rooms.has(room.id)) return;
    if (room.phase !== 'playing') return;
    if (room.trick.turn !== seat) return;
    const card = pickPlayCPU(room, seat);
    playCard(room, seat, card);
    broadcastRoom(room);
  }, 450);
}

// ---------- Socket ----------

io.on('connection', (socket) => {
  socket.emit('hello', { version: VERSION });

  socket.on('create_room', ({ roomId, name }) => {
    const rid = (roomId || '').trim() || `room-${Math.random().toString(36).slice(2, 8)}`;
    if (rooms.has(rid)) {
      socket.emit('error_msg', { message: 'Room already exists' });
      return;
    }
    const room = makeRoom(rid);
    rooms.set(rid, room);

    // Join seat 0
    room.players[0] = { id: socket.id, name: (name || 'Player').trim() || 'Player', type: 'human' };
    room.sockets[0] = socket.id;

    socket.join(rid);
    socket.emit('joined', { roomId: rid, seat: 0, version: VERSION });
    addLog(room, `${room.players[0].name} oprettede rummet.`);

    ensureCPUs(room);
    room.phase = 'lobby';

    broadcastRoom(room);
  });

  socket.on('join_room', ({ roomId, name }) => {
    const rid = (roomId || '').trim();
    const room = rooms.get(rid);
    if (!room) {
      socket.emit('error_msg', { message: 'Room not found' });
      return;
    }

    // Find free seat
    const seat = room.players.findIndex((p) => !p || p.type === 'cpu');
    if (seat === -1) {
      socket.emit('error_msg', { message: 'Room is full' });
      return;
    }

    room.players[seat] = { id: socket.id, name: (name || `Player ${seat + 1}`).trim(), type: 'human' };
    room.sockets[seat] = socket.id;
    socket.join(rid);

    socket.emit('joined', { roomId: rid, seat, version: VERSION });
    addLog(room, `${room.players[seat].name} joined seat ${seat + 1}.`);

    // Ensure CPUs fill remaining
    ensureCPUs(room);

    broadcastRoom(room);
  });

  socket.on('start_hand', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Only allow if at least one human exists
    if (!roomHasHumans(room)) return;

    startNewHand(room);
    broadcastRoom(room);
  });

  socket.on('pass_select', ({ roomId, seat, cards }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.phase !== 'passing') return;
    if (room.players[seat]?.type !== 'human') return;
    if (room.sockets[seat] !== socket.id) return;

    const unique = Array.from(new Set((cards || []).slice(0, 3)));
    if (unique.length !== 3) {
      socket.emit('illegal', { message: 'Vælg præcis 3 forskellige kort.' });
      return;
    }

    // validate in hand
    const hand = room.hands[seat];
    if (!unique.every((c) => hand.includes(c))) {
      socket.emit('illegal', { message: 'Du kan kun sende kort du har på hånden.' });
      return;
    }

    room.passSelections[seat] = unique;
    addLog(room, `${room.players[seat].name} valgte 3 kort til passing.`);

    checkResolvePassing(room);
    broadcastRoom(room);
  });

  socket.on('play', ({ roomId, seat, card }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.players[seat]?.type !== 'human') return;
    if (room.sockets[seat] !== socket.id) return;

    const res = playCard(room, seat, card);
    if (!res.ok) {
      socket.emit('illegal', { message: res.err });
      return;
    }
    broadcastRoom(room);
  });

  socket.on('next_hand', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.phase !== 'scoring') return;

    // Start next hand immediately (client handles its own visuals/timings)
    startNewHand(room);
    broadcastRoom(room);
  });

  socket.on('set_name', ({ roomId, seat, name }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.players[seat]?.type !== 'human') return;
    if (room.sockets[seat] !== socket.id) return;
    room.players[seat].name = (name || room.players[seat].name).trim().slice(0, 18);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    // Remove from any room seat
    for (const room of rooms.values()) {
      const seat = room.sockets.findIndex((sid) => sid === socket.id);
      if (seat !== -1) {
        addLog(room, `${room.players[seat]?.name || 'Player'} disconnected.`);
        room.players[seat] = { id: `cpu-${room.id}-${seat}`, name: `CPU ${seat + 1}`, type: 'cpu' };
        room.sockets[seat] = null;
        broadcastRoom(room);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hjerterfri v${VERSION} listening on :${PORT}`);
});
