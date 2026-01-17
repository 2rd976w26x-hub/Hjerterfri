'use strict';

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
 * In-memory room model (simple demo; not persistent)
 * rooms[roomCode] = {
 *   code,
 *   createdAt,
 *   hostSocketId,
 *   seats: [ { kind: 'human'|'cpu', socketId?, name } ] (length 4)
 *   started: boolean,
 *   startingSeatIndex: number,
 *   playedSuitCounts: { '♠': number, '♥': number, '♦': number, '♣': number },
 *   currentTurn: number,
 * }
 */
const rooms = new Map();

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function newPlayedSuitCounts() {
  return { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
}

function roomPublicState(room) {
  return {
    code: room.code,
    createdAt: room.createdAt,
    started: room.started,
    hostSocketId: room.hostSocketId,
    seats: room.seats.map(s => ({ kind: s.kind, name: s.name, socketId: s.socketId || null })),
    startingSeatIndex: room.startingSeatIndex,
    playedSuitCounts: room.playedSuitCounts,
    currentTurn: room.currentTurn
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', roomPublicState(room));
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

function startRoomIfReady(room) {
  if (room.started) return;
  if (!isRoomFull(room)) return;

  room.started = true;
  // For demo: starting player = seat 0 (host). We'll extend to 2♣ later when full game is implemented.
  room.startingSeatIndex = 0;
  room.currentTurn = room.startingSeatIndex;
  room.playedSuitCounts = newPlayedSuitCounts();
  broadcastRoom(room);
  io.to(room.code).emit('game:started', { startingSeatIndex: room.startingSeatIndex });

  // CPU auto-play loop trigger
  maybeAutoplayCpu(room);
}

function maybeAutoplayCpu(room) {
  if (!room.started) return;
  const seat = room.seats[room.currentTurn];
  if (!seat) return;
  if (seat.kind !== 'cpu') return;

  // CPU plays a random suit for now (demo). Replace with real hand/legal move later.
  const suits = ['♣', '♦', '♥', '♠'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const card = { suit: suits[Math.floor(Math.random() * suits.length)], value: values[Math.floor(Math.random() * values.length)] };

  setTimeout(() => {
    applyPlayedCard(room, room.currentTurn, card, /*fromCpu*/ true);
  }, 650);
}

function applyPlayedCard(room, seatIndex, card, fromCpu = false) {
  if (!room.started) return;
  // Simple turn enforcement
  if (seatIndex !== room.currentTurn) return;

  if (!room.playedSuitCounts[card.suit] && room.playedSuitCounts[card.suit] !== 0) {
    return;
  }
  // Defensive cap: a suit cannot exceed 13 cards in a standard deck.
  room.playedSuitCounts[card.suit] = Math.min(13, room.playedSuitCounts[card.suit] + 1);

  io.to(room.code).emit('game:cardPlayed', {
    seatIndex,
    card,
    playedSuitCounts: room.playedSuitCounts,
    fromCpu
  });

  room.currentTurn = (room.currentTurn + 1) % 4;
  broadcastRoom(room);

  maybeAutoplayCpu(room);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, cpuCount }) => {
    const playerName = (name || 'Spiller').toString().slice(0, 20);
    const cpu = Math.max(0, Math.min(3, Number(cpuCount ?? 0)));

    let code;
    do { code = makeRoomCode(); } while (rooms.has(code));

    const seats = Array.from({ length: 4 }, (_, i) => {
      if (i === 0) return { kind: 'human', socketId: socket.id, name: playerName };
      // allocate CPUs at the end of the table for clarity
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
      currentTurn: 0
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

  socket.on('game:playCard', ({ code, card }) => {
    const roomCode = (code || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = ensureRoom(roomCode);
    if (!room) return;

    const seatIndex = seatIndexForSocket(room, socket.id);
    if (seatIndex === -1) return;

    // Basic card validation
    if (!card || typeof card.suit !== 'string' || typeof card.value !== 'string') return;
    const suit = card.suit;
    const value = card.value;
    const suits = new Set(['♣','♦','♥','♠']);
    const values = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A']);
    if (!suits.has(suit) || !values.has(value)) return;

    applyPlayedCard(room, seatIndex, { suit, value });
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

    // If host left, close room (simple) or promote.
    if (room.hostSocketId === socket.id) {
      io.to(room.code).emit('room:error', { message: 'Host forlod rummet. Rummet er lukket.' });
      rooms.delete(room.code);
      return;
    }

    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    // Clean up seat in any room
    for (const room of rooms.values()) {
      const idx = seatIndexForSocket(room, socket.id);
      if (idx !== -1) {
        room.seats[idx].socketId = null;
        room.seats[idx].name = `Åben plads ${idx+1}`;
        // if host disconnected, close room
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
