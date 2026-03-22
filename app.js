/* ============================================
   IN-BETWEEN CARD GAME — App Logic
   ============================================ */

// =============================================
// FIREBASE CONFIG
// =============================================
const firebaseConfig = {
  apiKey: "AIzaSyCDQf-i8UH5wXc9Erz-clkrRi-byRbrwNE",
  authDomain: "multip-35e38.firebaseapp.com",
  databaseURL: "https://multip-35e38-default-rtdb.firebaseio.com",
  projectId: "multip-35e38",
  storageBucket: "multip-35e38.firebasestorage.app",
  messagingSenderId: "641663267611",
  appId: "1:641663267611:web:8c20f6b7a47657226e19be"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// =============================================
// STATE
// =============================================
const S = {
  myId: null,
  myName: '',
  roomCode: null,
  isCreator: false,
  baseValue: 20,
  players: {},
  gameState: null,
  listeners: [],
  timerInterval: null,
  bidding: false,
};

// =============================================
// HELPERS
// =============================================
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function genId() { return Math.random().toString(36).substr(2, 9) + Date.now().toString(36); }
function genRoomCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function roomRef(path) {
  return db.ref(`rooms/${S.roomCode}` + (path ? '/' + path : ''));
}

function detachListeners() {
  S.listeners.forEach(({ ref, evt, fn }) => ref.off(evt, fn));
  S.listeners = [];
}

function addListener(ref, evt, fn) {
  ref.on(evt, fn);
  S.listeners.push({ ref, evt, fn });
}

// =============================================
// CARD UTILITIES
// =============================================
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    SUITS.forEach(suit => {
      RANKS.forEach((rank, i) => {
        deck.push({ suit, rank, value: i + 1 });
      });
    });
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isStrictlyBetween(drawn, c1, c2) {
  const lo = Math.min(c1.value, c2.value);
  const hi = Math.max(c1.value, c2.value);
  return drawn.value > lo && drawn.value < hi;
}

function suitColor(suit) { return ['♥', '♦'].includes(suit) ? 'red' : 'black'; }

function renderCardHTML(card, faceDown = false, mini = false) {
  const cls = mini ? 'card card-mini' : 'card';
  if (faceDown) {
    return `<div class="${cls} card-back"><div class="card-back-pattern">🂠</div></div>`;
  }
  const col = suitColor(card.suit);
  return `<div class="${cls} card-front ${col}">
    <div class="card-tl"><span class="card-rank">${card.rank}</span><span class="card-suit-sm">${card.suit}</span></div>
    <div class="card-center-suit">${card.suit}</div>
    <div class="card-br"><span class="card-rank">${card.rank}</span><span class="card-suit-sm">${card.suit}</span></div>
  </div>`;
}

// =============================================
// SORTED PLAYERS UTILITY
// =============================================
function getSortedPlayers(players) {
  return Object.entries(players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.order - b.order);
}

function getPlayerByOrder(players, order) {
  return getSortedPlayers(players).find(p => p.order === order);
}

function getNextOrder(players, currentOrder) {
  const sorted = getSortedPlayers(players);
  const idx = sorted.findIndex(p => p.order === currentOrder);
  return sorted[(idx + 1) % sorted.length].order;
}

function getPlayerIdByOrder(players, order) {
  const p = getPlayerByOrder(players, order);
  return p ? p.id : null;
}

// =============================================
// ROOM MANAGEMENT
// =============================================
async function createRoom() {
  const name = $('player-name').value.trim();
  if (!name) return showToast('Enter your display name!', 'error');
  if (name.length < 2) return showToast('Name must be at least 2 characters', 'error');

  S.myName = name;
  S.myId = genId();
  S.roomCode = genRoomCode();
  S.isCreator = true;

  try {
    await roomRef().set({
      creator: S.myId,
      baseValue: S.baseValue,
      status: 'waiting',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    await roomRef(`players/${S.myId}`).set({
      name: S.myName,
      balance: 0,
      order: 0,
      online: true,
    });
    roomRef(`players/${S.myId}/online`).onDisconnect().set(false);
    showScreen('screen-lobby');
    setupLobby();
  } catch (e) {
    showToast('Failed to create room: ' + e.message, 'error');
  }
}

async function joinRoom() {
  const name = $('player-name').value.trim();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!name) return showToast('Enter your display name!', 'error');
  if (name.length < 2) return showToast('Name must be at least 2 characters', 'error');
  if (!code || code.length < 4) return showToast('Enter a valid room code!', 'error');

  S.myName = name;
  S.roomCode = code;

  try {
    const snap = await roomRef().once('value');
    if (!snap.exists()) return showToast('Room not found!', 'error');
    const room = snap.val();
    if (room.status !== 'waiting') return showToast('Game already in progress!', 'error');

    const players = room.players || {};
    const names = Object.values(players).map(p => p.name.toLowerCase());
    if (names.includes(name.toLowerCase())) return showToast('Name already taken!', 'error');
    if (Object.keys(players).length >= 10) return showToast('Room is full! (10 max)', 'error');

    S.myId = genId();
    S.isCreator = false;
    S.baseValue = room.baseValue;

    await roomRef(`players/${S.myId}`).set({
      name: S.myName,
      balance: 0,
      order: Object.keys(players).length,
      online: true,
    });
    roomRef(`players/${S.myId}/online`).onDisconnect().set(false);
    showScreen('screen-lobby');
    setupLobby();
  } catch (e) {
    showToast('Failed to join: ' + e.message, 'error');
  }
}

async function leaveRoom() {
  detachListeners();
  clearTimer();
  if (S.roomCode && S.myId) {
    try { await roomRef(`players/${S.myId}`).remove(); } catch (e) {}
  }
  S.roomCode = null;
  S.myId = null;
  S.isCreator = false;
  showScreen('screen-landing');
}

// =============================================
// LOBBY
// =============================================
function setupLobby() {
  detachListeners();
  $('lobby-room-code').textContent = S.roomCode;
  $('lobby-base-value').textContent = S.baseValue;
  $('btn-start-game').style.display = S.isCreator ? '' : 'none';

  const pRef = roomRef('players');
  addListener(pRef, 'value', snap => {
    const players = snap.val() || {};
    S.players = players;
    renderLobbyPlayers(players);
  });

  const statusRef = roomRef('status');
  addListener(statusRef, 'value', snap => {
    if (snap.val() === 'playing') {
      detachListeners();
      showScreen('screen-game');
      setupGame();
    }
  });
}

function renderLobbyPlayers(players) {
  const sorted = getSortedPlayers(players);
  const el = $('lobby-players');
  $('lobby-player-count').textContent = sorted.length;

  el.innerHTML = sorted.map(p => {
    const isMe = p.id === S.myId;
    const initial = p.name.charAt(0).toUpperCase();
    const crTag = p.id === getSortedPlayers(players)[0]?.id ? '<span class="ptag">👑 Host</span>' : '';
    return `<div class="lobby-player ${p.order === 0 ? 'creator' : ''}">
      <div class="player-avatar">${initial}</div>
      <div class="player-info">
        <div class="pname">${p.name}${isMe ? ' (You)' : ''}</div>
        ${crTag}
      </div>
      <span style="color:${p.online ? 'var(--emerald)' : 'var(--red)'}">${p.online ? '●' : '○'}</span>
    </div>`;
  }).join('');
}

// =============================================
// START GAME (Creator only)
// =============================================
async function startGame() {
  if (!S.isCreator) return;
  const pSnap = await roomRef('players').once('value');
  const players = pSnap.val();
  if (!players) return;
  const pIds = Object.keys(players);
  if (pIds.length < 1) return showToast('Need at least 1 player!', 'error');

  const deck = shuffle(createDeck());
  const sorted = getSortedPlayers(players);
  const boardValue = S.baseValue * sorted.length;

  const updates = {};
  let deckIndex = 0;
  const hands = {};

  sorted.forEach(p => {
    updates[`players/${p.id}/balance`] = (p.balance || 0) - S.baseValue;
    hands[p.id] = {
      card1: deck[deckIndex++],
      card2: deck[deckIndex++],
      revealed: false,
    };
  });

  updates['deck'] = deck;
  updates['game'] = {
    boardValue,
    currentPlayerOrder: sorted[0].order,
    phase: 'player_turn',
    deckIndex,
    turnStartTime: firebase.database.ServerValue.TIMESTAMP,
    currentBid: 0,
    drawnCard: null,
    roundStarter: 0,
    roundNumber: 1,
    playerHands: hands,
    lastResult: null,
    pendingAction: null,
  };
  updates['status'] = 'playing';

  await roomRef().update(updates);
}

// =============================================
// GAME SETUP & LISTENERS
// =============================================
function setupGame() {
  $('game-room-code').textContent = S.roomCode;
  $('btn-end-game').style.display = S.isCreator ? '' : 'none';

  const gameRef = roomRef('game');
  addListener(gameRef, 'value', snap => {
    const game = snap.val();
    if (!game) return;
    S.gameState = game;
    renderGame(game);
  });

  const pRef = roomRef('players');
  addListener(pRef, 'value', snap => {
    S.players = snap.val() || {};
    if (S.gameState) renderScoreboard(S.players, S.gameState);
  });

  const statusRef = roomRef('status');
  addListener(statusRef, 'value', snap => {
    if (snap.val() === 'ended') {
      detachListeners();
      clearTimer();
      showGameOver();
    }
  });

  // Creator watches for pending actions
  if (S.isCreator) {
    const actionRef = roomRef('game/pendingAction');
    addListener(actionRef, 'value', snap => {
      const action = snap.val();
      if (action) processAction(action);
    });
  }
}

// =============================================
// GAME RENDERING
// =============================================
function renderGame(game) {
  // Board value
  $('game-board-value').textContent = game.boardValue;
  $('game-round').textContent = `Round ${game.roundNumber || 1}`;

  // Deck count
  const deckTotal = 104;
  const remaining = deckTotal - (game.deckIndex || 0);
  $('deck-count').textContent = remaining;

  // My cards
  const myHand = game.playerHands?.[S.myId];
  renderMyCards(myHand, game);

  // Other players
  renderOtherPlayers(game);

  // Drawn card
  renderDrawnCard(game.drawnCard);

  // Action / Waiting panel
  const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);
  const isMyTurn = currentPid === S.myId;

  if (game.phase === 'player_turn') {
    if (isMyTurn) {
      $('action-panel').style.display = '';
      $('waiting-panel').style.display = 'none';
      $('turn-badge').textContent = 'Your Turn!';
      $('action-main').style.display = 'flex';
      if (!S.bidding) $('bid-options').style.display = 'none';
      updateBidLabels(game);
      startTimer(game.turnStartTime);
    } else {
      $('action-panel').style.display = 'none';
      $('waiting-panel').style.display = '';
      const cp = getPlayerByOrder(S.players, game.currentPlayerOrder);
      $('waiting-player-name').textContent = cp ? cp.name : 'Player';
      startWaitingTimer(game.turnStartTime);
    }
  } else if (game.phase === 'result') {
    $('action-panel').style.display = 'none';
    $('waiting-panel').style.display = 'none';
    clearTimer();
    if (game.lastResult) showResult(game.lastResult);
  } else {
    $('action-panel').style.display = 'none';
    $('waiting-panel').style.display = 'none';
    clearTimer();
  }

  renderScoreboard(S.players, game);
}

function renderMyCards(hand, game) {
  const c1El = $('my-card-1');
  const c2El = $('my-card-2');
  if (!hand || !hand.card1) {
    c1El.outerHTML = `<div id="my-card-1" class="card card-back"><div class="card-back-pattern">🂠</div></div>`;
    c2El.outerHTML = `<div id="my-card-2" class="card card-back"><div class="card-back-pattern">🂠</div></div>`;
    return;
  }
  // Player can always see both their own cards
  const w1 = $('my-card-1').parentElement;
  const w2 = $('my-card-2').parentElement;
  w1.querySelector('.card-label').textContent = 'Face Down';
  w2.querySelector('.card-label').textContent = 'Face Up';
  $('my-card-1').outerHTML = `<div id="my-card-1">${renderCardHTML(hand.card1, false)}</div>`;
  $('my-card-2').outerHTML = `<div id="my-card-2">${renderCardHTML(hand.card2, false)}</div>`;
}

function renderOtherPlayers(game) {
  const el = $('other-players');
  const sorted = getSortedPlayers(S.players).filter(p => p.id !== S.myId);
  if (sorted.length === 0) { el.innerHTML = ''; return; }

  const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);

  el.innerHTML = sorted.map(p => {
    const hand = game.playerHands?.[p.id];
    const isTurn = p.id === currentPid;
    const balClass = p.balance >= 0 ? 'positive' : 'negative';
    let cardsHTML = '';
    if (hand) {
      const showHidden = hand.revealed;
      cardsHTML = `<div class="op-cards-row">
        ${renderCardHTML(hand.card1, !showHidden, true)}
        ${renderCardHTML(hand.card2, false, true)}
      </div>`;
    }
    return `<div class="op-card ${isTurn ? 'active-turn' : ''}">
      <div class="op-name">${p.name}</div>
      <div class="op-balance ${balClass}">${p.balance >= 0 ? '+' : ''}${p.balance}</div>
      ${cardsHTML}
    </div>`;
  }).join('');
}

function renderDrawnCard(card) {
  const slot = $('drawn-card-slot');
  const arrow = $('draw-arrow');
  if (card) {
    slot.innerHTML = renderCardHTML(card);
    slot.style.border = 'none';
    arrow.style.display = '';
  } else {
    slot.innerHTML = '<span class="slot-label">Drawn Card</span>';
    slot.style.border = '';
    arrow.style.display = 'none';
  }
}

function updateBidLabels(game) {
  const bv = game.boardValue;
  $('btn-full-board').querySelector('.opt-val').textContent = `(${bv})`;
  $('btn-half-board').querySelector('.opt-val').textContent = `(${Math.floor(bv / 2)})`;
  $('btn-base-half').querySelector('.opt-val').textContent = `(${Math.floor(S.baseValue / 2)})`;
}

function renderScoreboard(players, game) {
  const sorted = getSortedPlayers(players);
  const currentPid = game ? getPlayerIdByOrder(players, game.currentPlayerOrder) : null;
  $('scoreboard').innerHTML = sorted.map(p => {
    const isMe = p.id === S.myId;
    const isTurn = p.id === currentPid;
    const balClass = p.balance >= 0 ? 'positive' : 'negative';
    const crown = p.order === 0 ? '<span class="sb-crown">👑</span>' : '';
    return `<div class="sb-player ${isMe ? 'me' : ''} ${isTurn ? 'current-turn' : ''}">
      ${crown}<span class="sb-name">${p.name}</span>
      <span class="sb-bal ${balClass}">${p.balance >= 0 ? '+' : ''}${p.balance}</span>
    </div>`;
  }).join('');
}

// =============================================
// TIMER
// =============================================
const TURN_DURATION = 20;

function startTimer(turnStartTime) {
  clearTimer();
  if (!turnStartTime) return;

  const update = () => {
    const elapsed = (Date.now() - turnStartTime) / 1000;
    const remaining = Math.max(0, TURN_DURATION - elapsed);
    const secs = Math.ceil(remaining);
    $('timer-text').textContent = secs;
    const frac = remaining / TURN_DURATION;
    const circumference = 2 * Math.PI * 52;
    $('timer-circle').style.strokeDashoffset = (1 - frac) * circumference;

    if (remaining <= 5) {
      $('timer-circle').classList.add('danger');
      $('timer-text').classList.add('danger');
    } else {
      $('timer-circle').classList.remove('danger');
      $('timer-text').classList.remove('danger');
    }

    if (remaining <= 0) {
      clearTimer();
      onTimerExpired();
    }
  };
  update();
  S.timerInterval = setInterval(update, 250);
}

function startWaitingTimer(turnStartTime) {
  clearTimer();
  if (!turnStartTime) return;

  const update = () => {
    const elapsed = (Date.now() - turnStartTime) / 1000;
    const remaining = Math.max(0, TURN_DURATION - elapsed);
    const secs = Math.ceil(remaining);
    $('waiting-timer-text').textContent = secs;
    const frac = remaining / TURN_DURATION;
    const circumference = 2 * Math.PI * 52;
    $('waiting-timer-circle').style.strokeDashoffset = (1 - frac) * circumference;

    if (remaining <= 5) {
      $('waiting-timer-circle').classList.add('danger');
      $('waiting-timer-text').classList.add('danger');
    } else {
      $('waiting-timer-circle').classList.remove('danger');
      $('waiting-timer-text').classList.remove('danger');
    }

    if (remaining <= 0) clearTimer();
  };
  update();
  S.timerInterval = setInterval(update, 250);
}

function clearTimer() {
  if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
}

function onTimerExpired() {
  // Auto-drop if it's my turn
  const game = S.gameState;
  if (!game) return;
  const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);
  if (currentPid === S.myId && game.phase === 'player_turn') {
    submitAction('drop', 0);
  }
}

// =============================================
// PLAYER ACTIONS
// =============================================
function submitAction(type, amount = 0) {
  S.bidding = false;
  $('bid-options').style.display = 'none';
  roomRef('game/pendingAction').set({ type, amount, by: S.myId });
}

// =============================================
// PROCESS ACTIONS (Creator only)
// =============================================
async function processAction(action) {
  const game = S.gameState;
  if (!game) return;
  const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);
  if (action.by !== currentPid) return; // Ignore stale actions

  // Clear the pending action first
  await roomRef('game/pendingAction').remove();

  if (action.type === 'drop') {
    await handleDrop(currentPid);
  } else if (action.type === 'bid') {
    await handleBid(currentPid, action.amount);
  }
}

async function handleDrop(playerId) {
  // Reveal cards and move to next player
  await roomRef(`game/playerHands/${playerId}/revealed`).set(true);
  await advanceToNextPlayer();
}

async function handleBid(playerId, amount) {
  const game = S.gameState;
  const deckSnap = await roomRef('deck').once('value');
  const deck = deckSnap.val();
  let deckIndex = game.deckIndex;

  // Check if deck needs reshuffling
  if (deckIndex >= deck.length) {
    const newDeck = shuffle(createDeck());
    await roomRef('deck').set(newDeck);
    deckIndex = 0;
  }

  const drawnCard = deck[deckIndex];
  const hand = game.playerHands[playerId];
  const won = isStrictlyBetween(drawnCard, hand.card1, hand.card2);

  // Cap amount to board value
  const actualAmount = Math.min(amount, game.boardValue);

  const updates = {};
  if (won) {
    updates[`players/${playerId}/balance`] = (S.players[playerId].balance || 0) + actualAmount;
    updates['game/boardValue'] = game.boardValue - actualAmount;
  } else {
    updates[`players/${playerId}/balance`] = (S.players[playerId].balance || 0) - actualAmount;
    updates['game/boardValue'] = game.boardValue + actualAmount;
  }

  updates['game/drawnCard'] = drawnCard;
  updates['game/deckIndex'] = deckIndex + 1;
  updates['game/currentBid'] = actualAmount;
  updates['game/phase'] = 'result';
  updates['game/lastResult'] = { won, amount: actualAmount, playerId, card: drawnCard };
  updates[`game/playerHands/${playerId}/revealed`] = true;

  await roomRef().update(updates);

  // Wait then advance
  setTimeout(() => advanceAfterResult(), 3500);
}

async function advanceAfterResult() {
  dismissResult();
  const game = (await roomRef('game').once('value')).val();
  if (!game) return;

  if (game.boardValue <= 0) {
    await startNewRound(game);
  } else {
    await advanceToNextPlayer();
  }
}

async function advanceToNextPlayer() {
  const game = S.gameState || (await roomRef('game').once('value')).val();
  if (!game) return;
  const nextOrder = getNextOrder(S.players, game.currentPlayerOrder);

  // If we've cycled back to the round starter, all players have had their turn
  if (nextOrder === game.roundStarter) {
    await startNewRound(game);
    return;
  }

  await roomRef('game').update({
    currentPlayerOrder: nextOrder,
    phase: 'player_turn',
    turnStartTime: firebase.database.ServerValue.TIMESTAMP,
    currentBid: 0,
    drawnCard: null,
    lastResult: null,
    pendingAction: null,
  });
}

async function startNewRound(game) {
  const pSnap = await roomRef('players').once('value');
  const players = pSnap.val();
  const sorted = getSortedPlayers(players);

  // Only collect antes if the board is empty (0 or less)
  const needsAnte = game.boardValue <= 0;
  const boardValue = needsAnte ? S.baseValue * sorted.length : game.boardValue;

  let deckSnap = await roomRef('deck').once('value');
  let deck = deckSnap.val();
  let deckIndex = game.deckIndex;

  // Check if we have enough cards for dealing
  const cardsNeeded = sorted.length * 2;
  if (deckIndex + cardsNeeded > deck.length) {
    deck = shuffle(createDeck());
    await roomRef('deck').set(deck);
    deckIndex = 0;
  }

  const updates = {};
  const hands = {};

  sorted.forEach(p => {
    // Only deduct ante if the board was empty
    if (needsAnte) {
      updates[`players/${p.id}/balance`] = (players[p.id].balance || 0) - S.baseValue;
    }
    hands[p.id] = {
      card1: deck[deckIndex++],
      card2: deck[deckIndex++],
      revealed: false,
    };
  });

  const newRoundStarter = getNextOrder(players, game.roundStarter);
  const roundNum = (game.roundNumber || 1) + 1;

  updates['game'] = {
    boardValue,
    currentPlayerOrder: newRoundStarter,
    phase: 'player_turn',
    deckIndex,
    turnStartTime: firebase.database.ServerValue.TIMESTAMP,
    currentBid: 0,
    drawnCard: null,
    roundStarter: newRoundStarter,
    roundNumber: roundNum,
    playerHands: hands,
    lastResult: null,
    pendingAction: null,
  };

  await roomRef().update(updates);
}

// =============================================
// RESULT DISPLAY
// =============================================
function showResult(result) {
  const overlay = $('result-overlay');
  const box = $('result-box');
  const player = S.players[result.playerId];
  const name = player ? player.name : 'Player';
  const isMe = result.playerId === S.myId;

  box.className = 'result-box ' + (result.won ? 'win' : 'lose');
  $('result-title').textContent = result.won ? '🎉 WIN!' : '💥 LOSE!';

  if (isMe) {
    $('result-message').textContent = result.won
      ? `Card was between! You won ${result.amount}!`
      : `Card was NOT between. You lost ${result.amount}.`;
  } else {
    $('result-message').textContent = result.won
      ? `${name} won ${result.amount}!`
      : `${name} lost ${result.amount}.`;
  }

  $('result-card-slot').innerHTML = renderCardHTML(result.card);
  overlay.style.display = 'flex';

  // Click anywhere on the overlay to dismiss
  overlay.onclick = (e) => {
    overlay.style.display = 'none';
    overlay.onclick = null;
  };
}

function dismissResult() {
  $('result-overlay').style.display = 'none';
  $('result-overlay').onclick = null;
}

// =============================================
// END GAME
// =============================================
async function endGame() {
  if (!S.isCreator) return;
  if (!confirm('Are you sure you want to end the game?')) return;
  await roomRef('status').set('ended');
}

function showGameOver() {
  showScreen('screen-gameover');
  const sorted = getSortedPlayers(S.players).sort((a, b) => b.balance - a.balance);
  $('final-standings').innerHTML = sorted.map((p, i) => {
    const prefix = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    const balClass = p.balance >= 0 ? 'positive' : 'negative';
    const isMe = p.id === S.myId;
    return `<div class="standing-row">
      <span class="standing-rank">${prefix}</span>
      <span class="standing-name">${p.name}${isMe ? ' (You)' : ''}</span>
      <span class="standing-balance ${balClass}">${p.balance >= 0 ? '+' : ''}${p.balance}</span>
    </div>`;
  }).join('');
}

// =============================================
// EVENT HANDLERS
// =============================================
function setupEvents() {
  // Base value chips
  $$('.bv-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.bv-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.baseValue = parseInt(btn.dataset.value);
      $('custom-base-value').value = '';
    });
  });

  $('custom-base-value').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (v > 0) {
      S.baseValue = v;
      $$('.bv-chip').forEach(b => b.classList.remove('active'));
    }
  });

  // Room actions
  $('btn-create-room').addEventListener('click', createRoom);
  $('btn-join-room').addEventListener('click', joinRoom);
  $('btn-leave-room').addEventListener('click', leaveRoom);
  $('btn-start-game').addEventListener('click', startGame);

  $('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(S.roomCode).then(() => showToast('Code copied!', 'success'));
  });

  // Copy room code from game screen header
  $('btn-copy-game-code').addEventListener('click', () => {
    navigator.clipboard.writeText(S.roomCode).then(() => showToast('Room code copied!', 'success'));
  });

  // Firebase cleanup
  $('btn-cleanup').addEventListener('click', async () => {
    const key = prompt('Enter keyphrase to reset all Firebase data:');
    if (key !== '123456') {
      if (key !== null) showToast('Incorrect keyphrase!', 'error');
      return;
    }
    try {
      await db.ref('rooms').remove();
      showToast('All Firebase data cleared!', 'success');
    } catch (e) {
      showToast('Failed to clear data: ' + e.message, 'error');
    }
  });

  // Game actions
  $('btn-drop').addEventListener('click', () => {
    const game = S.gameState;
    if (!game || game.phase !== 'player_turn') return;
    const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);
    if (currentPid !== S.myId) return;
    submitAction('drop');
  });

  $('btn-bid').addEventListener('click', () => {
    const game = S.gameState;
    if (!game || game.phase !== 'player_turn') return;
    const currentPid = getPlayerIdByOrder(S.players, game.currentPlayerOrder);
    if (currentPid !== S.myId) return;
    S.bidding = true;
    clearTimer(); // Stop timer when player commits to bidding
    $('action-main').style.display = 'none';
    $('bid-options').style.display = '';
    $('timer-text').textContent = '✓';
    $('timer-circle').style.strokeDashoffset = '0';
  });

  $('btn-full-board').addEventListener('click', () => {
    if (S.gameState) submitAction('bid', S.gameState.boardValue);
  });
  $('btn-half-board').addEventListener('click', () => {
    if (S.gameState) submitAction('bid', Math.floor(S.gameState.boardValue / 2));
  });
  $('btn-base-half').addEventListener('click', () => {
    submitAction('bid', Math.floor(S.baseValue / 2));
  });
  $('btn-custom-bid').addEventListener('click', () => {
    const v = parseInt($('custom-bid-input').value);
    if (!v || v < 1) return showToast('Enter a valid amount!', 'error');
    if (S.gameState && v > S.gameState.boardValue) return showToast(`Max bid is ${S.gameState.boardValue}`, 'error');
    submitAction('bid', v);
  });

  $('btn-end-game').addEventListener('click', endGame);
  $('btn-back-home').addEventListener('click', () => {
    S.roomCode = null;
    S.myId = null;
    S.isCreator = false;
    S.gameState = null;
    S.players = {};
    showScreen('screen-landing');
  });

  // Enter key support
  $('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-create-room').focus();
  });
  $('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });
  $('custom-bid-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-custom-bid').click();
  });
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', setupEvents);
