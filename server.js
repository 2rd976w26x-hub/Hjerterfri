'use strict';

// Hjerterfri v1.3.9
// Online rum (Socket.IO) + fulde grundregler for Hjerterfri (tricks, point, 2♣ starter, hearts broken)
// + simpel CPU-AI + public/private state.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

/**
 * rooms[code] = {
 *   code,
 *   createdAt,
 *   hostSocketId,
 *   seats: [ { kind:'human'|'cpu', socketId?, name } ] (len 4)
 *   started: boolean,
 *   startingSeatIndex: number,
 *   playedSuitCounts: { '♠':n,'♥':n,'♦':n,'♣':n },
 *   game: {
 *     phase: 'passing'|'playing'|'roundEnd'|'gameOver',
 *     round: number,
 *     passDir: 'left'|'right'|'across'|'none',
 *     hands: Card[][],
 *     passPicks: Card[][], // length 4, arrays of 0..3
 *     trick: { leader:number, cards: ({seatIndex,card})[], leadSuit:string|null, trickNo:number },
 *     heartsBroken: boolean,
 *     currentTurn: number,
 *     roundPoints: number[],
 *     totalPoints: number[],
 *     lastTrickWinner: number|null,
 *   }
 * }
 */

const rooms = new Map();

// ----- Cards & helpers

const SUITS = ['♣', '♦', '♥', '♠'];
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VALUE_RANK = Object.fromEntries(VALUES.map((v, i) => [v, i]));

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const v of VALUES) d.push({ suit: s, value: v });
  return d;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardKey(c) {
  return `${c.suit}${c.value}`;
}

function sameCard(a, b) {
  return a && b && a.suit === b.suit && a.value === b.value;
}

function newPlayedSuitCounts() {
  return { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
}

function sortHand(hand) {
  // suit order: clubs, diamonds, spades, hearts (common for readability)
  const suitOrder = { '♣': 0, '♦': 1, '♠': 2, '♥': 3 };
  hand.sort((a, b) => {
    const sa = suitOrder[a.suit] ?? 9;
    const sb = suitOrder[b.suit] ?? 9;
    if (sa !== sb) return sa - sb;
    return VALUE_RANK[a.value] - VALUE_RANK[b.value];
  });
}

function hasSuit(hand, suit) {
  return hand.some(c => c.suit === suit);
}

function onlyHearts(hand) {
  return hand.length > 0 && hand.every(c => c.suit === '♥');
}

function pointsOfCard(card) {
  if (card.suit === '♥') return 1;
  if (card.suit === '♠' && card.value === 'Q') return 13;
  return 0;
}

function trickPoints(trickCards) {
  return trickCards.reduce((sum, t) => sum + pointsOfCard(t.card), 0);
}

function findTwoOfClubsSeat(hands) {
  for (let i = 0; i < 4; i++) {
    if (hands[i].some(c => c.suit === '♣' && c.value === '2')) return i;
  }
  return 0;
}

function passDirectionForRound(round) {
  // Requested behavior: passing is always clockwise.
  // Note: Seat indices are laid out as 0=bottom,1=right,2=top,3=left.
  // Clockwise therefore means: 0 -> 3 -> 2 -> 1 -> 0 (i.e. -1 mod 4).
  // We keep the public label as 'clockwise' to avoid confusion.
  void round;
  return 'clockwise';
}

// ----- Room lifecycle

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function ensureRoom(code) {
  return rooms.get(code) || null;
}

function seatIndexForSocket(room, socketId) {
  return room.seats.findIndex(s => s.kind === 'human' && s.socketId === socketId);
}

function isRoomFull(room) {
  return room.seats.every(s => s.kind === 'cpu' || (s.kind === 'human' && s.socketId));
}

function roomPublicState(room) {
  const g = room.game;
  const publicGame = g ? {
    phase: g.phase,
    round: g.round,
    passDir: g.passDir,
    trick: g.trick,
    heartsBroken: g.heartsBroken,
    currentTurn: g.currentTurn,
    roundPoints: g.roundPoints,
    totalPoints: g.totalPoints,
    lastTrickWinner: g.lastTrickWinner,
    handCounts: g.hands ? g.hands.map(h => h.length) : [0,0,0,0]
  } : null;

  return {
    code: room.code,
    createdAt: room.createdAt,
    started: room.started,
    hostSocketId: room.hostSocketId,
    seats: room.seats.map(s => ({ kind: s.kind, name: s.name, socketId: s.socketId || null })),
    startingSeatIndex: room.startingSeatIndex,
    playedSuitCounts: room.playedSuitCounts,
    game: publicGame
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', roomPublicState(room));
}

function sendPrivateState(room) {
  // send each human their own hand + legal moves (if any)
  const g = room.game;
  if (!g || !g.hands) return;

  room.seats.forEach((seat, seatIndex) => {
    if (seat.kind !== 'human' || !seat.socketId) return;
    const socket = io.sockets.sockets.get(seat.socketId);
    if (!socket) return;
    const hand = g.hands[seatIndex];
    const legal = g.phase === 'playing' && g.currentTurn === seatIndex
      ? legalMovesForSeat(g, seatIndex)
      : [];
    const passPick = g.phase === 'passing' ? g.passPicks[seatIndex].map(cardKey) : [];

    socket.emit('game:privateState', {
      code: room.code,
      seatIndex,
      phase: g.phase,
      round: g.round,
      passDir: g.passDir,
      hand,
      legalCardKeys: legal.map(cardKey),
      passPickKeys: passPick,
      mustPickPass: g.phase === 'passing' && g.passDir !== 'none'
    });
  });
}

function startRoomIfReady(room) {
  if (room.started) return;
  if (!isRoomFull(room)) return;

  room.started = true;
  room.playedSuitCounts = newPlayedSuitCounts();

  // init game state
  room.game = {
    phase: 'passing',
    round: 1,
    passDir: passDirectionForRound(1),
    hands: [[],[],[],[]],
    passPicks: [[],[],[],[]],
    trick: { leader: 0, cards: [], leadSuit: null, trickNo: 0 },
    heartsBroken: false,
    currentTurn: 0,
    roundPoints: [0,0,0,0],
    totalPoints: [0,0,0,0],
    lastTrickWinner: null
  };

  newRound(room);
}

function newRound(room) {
  const g = room.game;
  g.phase = 'passing';
  g.passDir = passDirectionForRound(g.round);
  g.heartsBroken = false;
  g.roundPoints = [0,0,0,0];
  g.passPicks = [[],[],[],[]];
  room.playedSuitCounts = newPlayedSuitCounts();

  const deck = shuffle(makeDeck());
  g.hands = [[],[],[],[]];
  for (let i = 0; i < deck.length; i++) g.hands[i % 4].push(deck[i]);
  for (const h of g.hands) sortHand(h);

  const twoClubs = findTwoOfClubsSeat(g.hands);
  room.startingSeatIndex = twoClubs;
  g.trick = { leader: twoClubs, cards: [], leadSuit: null, trickNo: 0 };
  g.currentTurn = twoClubs;

  broadcastRoom(room);
  sendPrivateState(room);

  if (g.passDir === 'none') {
    // skip passing
    g.phase = 'playing';
    broadcastRoom(room);
    sendPrivateState(room);
    maybeAutoplayCpu(room);
  } else {
    maybeAutoplayCpu(room);
  }
}

// ----- Rules: legal moves

function legalMovesForSeat(g, seatIndex) {
  const hand = g.hands[seatIndex];
  if (hand.length === 0) return [];

  // Passing phase: client handles selection; not a card-play phase
  if (g.phase !== 'playing') return [];

  const trick = g.trick;
  const isLeader = trick.cards.length === 0;
  const isFirstTrick = trick.trickNo === 0;

  if (isLeader) {
    // First trick must start with 2♣
    if (isFirstTrick) {
      const twoClubs = hand.find(c => c.suit === '♣' && c.value === '2');
      return twoClubs ? [twoClubs] : hand.slice();
    }

    // Cannot lead hearts until broken, unless only hearts left
    if (!g.heartsBroken && !onlyHearts(hand)) {
      return hand.filter(c => c.suit !== '♥');
    }
    return hand.slice();
  }

  // Following: must follow suit if possible
  const leadSuit = trick.leadSuit;
  if (leadSuit && hasSuit(hand, leadSuit)) {
    return hand.filter(c => c.suit === leadSuit);
  }

  // No lead suit: any card, BUT on first trick avoid point cards unless forced
  if (isFirstTrick) {
    const nonPoints = hand.filter(c => pointsOfCard(c) === 0);
    return nonPoints.length ? nonPoints : hand.slice();
  }

  return hand.slice();
}

function removeCardFromHand(hand, card) {
  const idx = hand.findIndex(c => sameCard(c, card));
  if (idx === -1) return false;
  hand.splice(idx, 1);
  return true;
}

function determineTrickWinner(trick) {
  const leadSuit = trick.leadSuit;
  let winner = trick.cards[0].seatIndex;
  let bestRank = -1;
  for (const t of trick.cards) {
    if (t.card.suit !== leadSuit) continue;
    const r = VALUE_RANK[t.card.value];
    if (r > bestRank) {
      bestRank = r;
      winner = t.seatIndex;
    }
  }
  return winner;
}

function applyPlayedCard(room, seatIndex, card, fromCpu = false) {
  const g = room.game;
  if (!room.started || !g || g.phase !== 'playing') return;
  if (seatIndex !== g.currentTurn) return;

  const hand = g.hands[seatIndex];
  const legal = legalMovesForSeat(g, seatIndex);
  if (!legal.some(c => sameCard(c, card))) return;

  if (!removeCardFromHand(hand, card)) return;

  // Update suit count (defensive cap)
  room.playedSuitCounts[card.suit] = Math.min(13, (room.playedSuitCounts[card.suit] || 0) + 1);

  // Update hearts broken
  if (card.suit === '♥') g.heartsBroken = true;

  // Apply to trick
  const trick = g.trick;
  if (trick.cards.length === 0) {
    trick.leader = seatIndex;
    trick.leadSuit = card.suit;
  }
  trick.cards.push({ seatIndex, card });

  io.to(room.code).emit('game:cardPlayed', {
    seatIndex,
    card,
    playedSuitCounts: room.playedSuitCounts,
    fromCpu
  });

  // Next turn or resolve trick
  if (trick.cards.length < 4) {
    // Clockwise turn order with seat layout 0=bottom,1=right,2=top,3=left.
    g.currentTurn = (seatIndex + 3) % 4;
    broadcastRoom(room);
    sendPrivateState(room);
    maybeAutoplayCpu(room);
    return;
  }

  // Resolve trick
  const winner = determineTrickWinner(trick);
  const pts = trickPoints(trick.cards);
  g.roundPoints[winner] += pts;
  g.lastTrickWinner = winner;

  io.to(room.code).emit('game:trickEnd', {
    winner,
    points: pts,
    roundPoints: g.roundPoints
  });

  // Next trick
  trick.cards = [];
  trick.leadSuit = null;
  trick.trickNo += 1;
  trick.leader = winner;
  g.currentTurn = winner;

  // Round end?
  const allEmpty = g.hands.every(h => h.length === 0);
  if (allEmpty) {
    finalizeRound(room);
    return;
  }

  broadcastRoom(room);
  sendPrivateState(room);
  maybeAutoplayCpu(room);
}

function finalizeRound(room) {
  const g = room.game;
  g.phase = 'roundEnd';

  // Shoot the moon: if someone has 26 in round
  const shooter = g.roundPoints.findIndex(p => p === 26);
  if (shooter !== -1) {
    for (let i = 0; i < 4; i++) {
      g.totalPoints[i] += (i === shooter) ? 0 : 26;
    }
    io.to(room.code).emit('game:roundEnd', {
      shootMoon: true,
      shooter,
      roundPoints: g.roundPoints,
      totalPoints: g.totalPoints
    });
  } else {
    for (let i = 0; i < 4; i++) g.totalPoints[i] += g.roundPoints[i];
    io.to(room.code).emit('game:roundEnd', {
      shootMoon: false,
      shooter: null,
      roundPoints: g.roundPoints,
      totalPoints: g.totalPoints
    });
  }

  // Game over at 100+
  const over = g.totalPoints.some(p => p >= 100);
  if (over) {
    g.phase = 'gameOver';
    const min = Math.min(...g.totalPoints);
    const winners = g.totalPoints.map((p, i) => ({ p, i })).filter(x => x.p === min).map(x => x.i);
    io.to(room.code).emit('game:gameOver', {
      totalPoints: g.totalPoints,
      winners
    });
    broadcastRoom(room);
    sendPrivateState(room);
    return;
  }

  // Next round
  g.round += 1;
  broadcastRoom(room);
  sendPrivateState(room);

  // Delay before dealing the next round.
  // Requirement: after the final card of the last trick is played, we must allow the
  // card-fly animation to complete, then wait ~2 seconds before dealing new cards.
  // We keep this delay server-side so clients stay in sync.
  const NEXT_ROUND_DELAY_MS = 2600;
  setTimeout(() => {
    newRound(room);
  }, NEXT_ROUND_DELAY_MS);
}

// ----- Passing

function applyPassIfReady(room) {
  const g = room.game;
  if (!g || g.phase !== 'passing') return;
  if (g.passDir === 'none') {
    g.phase = 'playing';
    broadcastRoom(room);
    sendPrivateState(room);
    maybeAutoplayCpu(room);
    return;
  }

  const allPicked = g.passPicks.every(p => p.length === 3);
  if (!allPicked) return;

  const targetForSeat = (seat) => {
    // Seat indices are laid out as 0=bottom,1=right,2=top,3=left.
    // Clockwise passing therefore means: seat -> (seat + 3) % 4.
    if (g.passDir === 'clockwise') return (seat + 3) % 4;
    // Backward-compat (shouldn't happen in this build)
    if (g.passDir === 'left') return (seat + 1) % 4;
    if (g.passDir === 'right') return (seat + 3) % 4;
    if (g.passDir === 'across') return (seat + 2) % 4;
    return seat;
  };

  // Remove selected cards from each hand first
  const picked = g.passPicks.map(p => p.slice());
  for (let seat = 0; seat < 4; seat++) {
    for (const c of picked[seat]) {
      removeCardFromHand(g.hands[seat], c);
    }
  }

  // Add to targets
  for (let seat = 0; seat < 4; seat++) {
    const t = targetForSeat(seat);
    g.hands[t].push(...picked[seat]);
  }

  for (const h of g.hands) sortHand(h);

  // Reset trick starter based on 2♣ holder after passing
  const twoClubs = findTwoOfClubsSeat(g.hands);
  room.startingSeatIndex = twoClubs;
  g.trick = { leader: twoClubs, cards: [], leadSuit: null, trickNo: 0 };
  g.currentTurn = twoClubs;

  g.phase = 'playing';
  broadcastRoom(room);
  sendPrivateState(room);
  io.to(room.code).emit('game:passDone', { startingSeatIndex: twoClubs });
  maybeAutoplayCpu(room);
}

function isValidPassSelection(hand, picks) {
  if (!Array.isArray(picks) || picks.length !== 3) return false;
  const uniq = new Set(picks.map(cardKey));
  if (uniq.size !== 3) return false;
  return picks.every(c => hand.some(hc => sameCard(hc, c)));
}

// ----- CPU AI

function cpuPickPassCards(hand) {
  // simple: pick 3 highest point-risk cards: Q♠, A♠, K♠, high hearts, then high cards.
  const score = (c) => {
    let s = 0;
    if (c.suit === '♠' && c.value === 'Q') s += 100;
    if (c.suit === '♠' && (c.value === 'A' || c.value === 'K')) s += 40;
    if (c.suit === '♥') s += 20 + VALUE_RANK[c.value];
    s += VALUE_RANK[c.value] / 10;
    return s;
  };
  const sorted = hand.slice().sort((a, b) => score(b) - score(a));
  return sorted.slice(0, 3);
}

function cpuChooseCard(g, seatIndex) {
  const legal = legalMovesForSeat(g, seatIndex);
  if (!legal.length) return null;

  const trick = g.trick;
  const isLeader = trick.cards.length === 0;
  const leadSuit = trick.leadSuit;

  const rank = (c) => VALUE_RANK[c.value];

  if (isLeader) {
    // lead lowest non-heart when possible
    const nonHearts = legal.filter(c => c.suit !== '♥');
    const pool = nonHearts.length ? nonHearts : legal;
    pool.sort((a, b) => rank(a) - rank(b));
    // avoid leading Q♠ if possible
    const safe = pool.find(c => !(c.suit === '♠' && c.value === 'Q'));
    return safe || pool[0];
  }

  // following
  // try not to win the trick: play the highest card that is still below current best, else dump lowest.
  let currentBestRank = -1;
  for (const t of trick.cards) {
    if (t.card.suit !== leadSuit) continue;
    currentBestRank = Math.max(currentBestRank, rank(t.card));
  }

  const followSuit = legal.filter(c => c.suit === leadSuit);
  if (followSuit.length) {
    const under = followSuit.filter(c => rank(c) < currentBestRank).sort((a, b) => rank(b) - rank(a));
    if (under.length) return under[0];
    // forced to potentially win: play lowest
    followSuit.sort((a, b) => rank(a) - rank(b));
    return followSuit[0];
  }

  // cannot follow: try dump points/high cards
  const dumpScore = (c) => {
    let s = 0;
    if (c.suit === '♠' && c.value === 'Q') s += 100;
    if (c.suit === '♥') s += 30 + rank(c);
    if (c.suit === '♠' && (c.value === 'A' || c.value === 'K')) s += 10;
    s += rank(c);
    return s;
  };
  const sorted = legal.slice().sort((a, b) => dumpScore(b) - dumpScore(a));
  return sorted[0];
}

function maybeAutoplayCpu(room) {
  const g = room.game;
  if (!room.started || !g) return;

  // Passing: let CPUs choose immediately
  if (g.phase === 'passing' && g.passDir !== 'none') {
    for (let seat = 0; seat < 4; seat++) {
      const s = room.seats[seat];
      if (s.kind !== 'cpu') continue;
      if (g.passPicks[seat].length === 3) continue;
      const picks = cpuPickPassCards(g.hands[seat]);
      g.passPicks[seat] = picks;
    }
    applyPassIfReady(room);
    return;
  }

  if (g.phase !== 'playing') return;
  const seat = room.seats[g.currentTurn];
  if (!seat || seat.kind !== 'cpu') return;

  const card = cpuChooseCard(g, g.currentTurn);
  if (!card) return;

  setTimeout(() => {
    applyPlayedCard(room, g.currentTurn, card, true);
  }, 650);
}

// ----- Socket.IO handlers

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, cpuCount }) => {
    const playerName = (name || 'Spiller').toString().slice(0, 20);
    const cpu = Math.max(0, Math.min(3, Number(cpuCount ?? 0)));

    let code;
    do { code = makeRoomCode(); } while (rooms.has(code));

    const seats = Array.from({ length: 4 }, (_, i) => {
      if (i === 0) return { kind: 'human', socketId: socket.id, name: playerName };
      // Open human seats first, then CPUs.
      return { kind: i <= (3 - cpu) ? 'human' : 'cpu', socketId: null, name: i <= (3 - cpu) ? `Åben plads ${i+1}` : `CPU ${i - (3 - cpu)}` };
    });

    const room = {
      code,
      createdAt: Date.now(),
      hostSocketId: socket.id,
      seats,
      started: false,
      startingSeatIndex: 0,
      playedSuitCounts: newPlayedSuitCounts(),
      game: null
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit('room:joined', { code, seatIndex: 0, isHost: true });
    broadcastRoom(room);
    startRoomIfReady(room);
  });

  socket.on('room:join', ({ code, name }) => {
    const roomCode = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = ensureRoom(roomCode);
    if (!room) {
      socket.emit('room:error', { message: 'Rummet findes ikke (tjek koden).' });
      return;
    }
    if (room.started) {
      socket.emit('room:error', { message: 'Spillet er allerede startet i det rum.' });
      return;
    }

    const openIndex = room.seats.findIndex(s => s.kind === 'human' && !s.socketId);
    if (openIndex === -1) {
      socket.emit('room:error', { message: 'Rummet er fuldt.' });
      return;
    }

    const playerName = (name || 'Spiller').toString().slice(0, 20);
    room.seats[openIndex].socketId = socket.id;
    room.seats[openIndex].name = playerName;

    socket.join(room.code);
    socket.emit('room:joined', { code: room.code, seatIndex: openIndex, isHost: room.hostSocketId === socket.id });
    broadcastRoom(room);
    startRoomIfReady(room);
  });

  socket.on('game:passSelect', ({ code, picks }) => {
    const roomCode = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = ensureRoom(roomCode);
    if (!room || !room.game) return;
    const g = room.game;
    if (!room.started || g.phase !== 'passing' || g.passDir === 'none') return;

    const seatIndex = seatIndexForSocket(room, socket.id);
    if (seatIndex === -1) return;
    const hand = g.hands[seatIndex];

    const cards = Array.isArray(picks) ? picks.map(c => ({ suit: c.suit, value: c.value })) : [];
    if (!isValidPassSelection(hand, cards)) return;

    g.passPicks[seatIndex] = cards;
    sendPrivateState(room);
    broadcastRoom(room);
    applyPassIfReady(room);
  });

  socket.on('game:playCard', ({ code, card }) => {
    const roomCode = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = ensureRoom(roomCode);
    if (!room || !room.game) return;

    const seatIndex = seatIndexForSocket(room, socket.id);
    if (seatIndex === -1) return;

    if (!card || typeof card.suit !== 'string' || typeof card.value !== 'string') return;
    if (!SUITS.includes(card.suit) || !VALUES.includes(card.value)) return;

    applyPlayedCard(room, seatIndex, { suit: card.suit, value: card.value });
  });

  socket.on('room:leave', ({ code }) => {
    const roomCode = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = ensureRoom(roomCode);
    if (!room) return;

    const idx = seatIndexForSocket(room, socket.id);
    if (idx !== -1) {
      room.seats[idx].socketId = null;
      room.seats[idx].name = `Åben plads ${idx+1}`;
    }
    socket.leave(room.code);

    if (room.hostSocketId === socket.id) {
      io.to(room.code).emit('room:error', { message: 'Host forlod rummet. Rummet er lukket.' });
      rooms.delete(room.code);
      return;
    }

    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const idx = seatIndexForSocket(room, socket.id);
      if (idx !== -1) {
        room.seats[idx].socketId = null;
        room.seats[idx].name = `Åben plads ${idx+1}`;
        if (room.hostSocketId === socket.id) {
          io.to(room.code).emit('room:error', { message: 'Host mistede forbindelsen. Rummet er lukket.' });
          rooms.delete(room.code);
        } else {
          broadcastRoom(room);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Hjerterfri online server lytter på port ${PORT}`);
});
