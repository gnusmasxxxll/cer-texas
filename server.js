const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const VALID_USERS = [
  { username: 'ms', password: '123' },
  { username: 'kb', password: '123' },
  { username: 'gs', password: '123' },
  { username: 'kk', password: '123' },
  { username: 'rp', password: '123' },
  { username: 'xd', password: '123' }
];

const suits = ['♠', '♥', '♦', '♣'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const value of values) deck.push({ suit, value });
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(card) {
  return { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 }[card.value];
}

function evaluateHand(cards) {
  const cardValues = cards.map(getCardValue).sort((a, b) => b - a);
  const cardSuits = cards.map(card => card.suit);
  const isFlush = cardSuits.length === 5 && cardSuits.every(suit => suit === cardSuits[0]);
  const uniqueValues = [...new Set(cardValues)];
  const isStraight = uniqueValues.length === 5 && (
    cardValues[0] - cardValues[4] === 4 ||
    (cardValues[0] === 14 && cardValues[1] === 5 && cardValues[2] === 4 && cardValues[3] === 3 && cardValues[4] === 2)
  );

  const counts = {};
  cardValues.forEach(value => { counts[value] = (counts[value] || 0) + 1; });
  const pairs = Object.values(counts).filter(count => count === 2).length;
  const trips = Object.values(counts).some(count => count === 3);
  const quads = Object.values(counts).some(count => count === 4);

  if (isFlush && isStraight) return 800 + cardValues[0];
  if (quads) return 700 + Number(Object.keys(counts).find(key => counts[key] === 4));
  if (trips && pairs >= 1) return 600 + Number(Object.keys(counts).find(key => counts[key] === 3));
  if (isFlush) return 500 + cardValues[0];
  if (isStraight) return 400 + cardValues[0];
  if (trips) return 300 + Number(Object.keys(counts).find(key => counts[key] === 3));
  if (pairs === 2) return 200 + Number(Object.keys(counts).find(key => counts[key] === 2));
  if (pairs === 1) return 100 + Number(Object.keys(counts).find(key => counts[key] === 2));
  return cardValues[0] || 0;
}

let gameState = {
  players: [],
  deck: [],
  communityCards: [],
  pot: 0,
  currentBet: 0,
  dealerIndex: 0,
  currentPlayerIndex: 0,
  phase: 'waiting',
  gameOver: false,
  smallBlind: 10,
  bigBlind: 20
};

io.on('connection', socket => {
  console.log('Gracz połączony:', socket.id);

  socket.on('login', ({ username, password }) => {
    const user = VALID_USERS.find(item => item.username === username && item.password === password);
    if (!user) {
      socket.emit('loginResult', { success: false, error: 'Nieprawidłowe dane' });
      return;
    }

    const existingPlayer = gameState.players.find(player => player.username === username);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      socket.emit('loginResult', { success: true, player: existingPlayer });
      io.emit('gameState', gameState);
      return;
    }

    const player = {
      id: socket.id,
      username,
      cards: [],
      chips: 1000,
      bet: 0,
      folded: false,
      allIn: false
    };

    gameState.players.push(player);
    socket.emit('loginResult', { success: true, player });
    io.emit('gameState', gameState);
  });

  socket.on('startGame', () => {
    if (gameState.gameOver) {
      socket.emit('error', 'Gra została zakończona.');
      return;
    }
    if (gameState.players.length < 2) {
      socket.emit('error', 'Potrzeba minimum 2 graczy');
      return;
    }
    startNewRound();
  });

  socket.on('playerAction', ({ action, amount }) => {
    const player = gameState.players.find(item => item.id === socket.id);
    if (!player || gameState.players[gameState.currentPlayerIndex]?.id !== socket.id || gameState.gameOver) return;
    handlePlayerAction(player, action, amount);
  });

  socket.on('logout', () => {
    removePlayer(socket.id, true);
  });

  socket.on('disconnect', () => {
    removePlayer(socket.id, false);
  });
});

function removePlayer(socketId, notify) {
  const index = gameState.players.findIndex(player => player.id === socketId);
  if (index === -1) return;

  const [player] = gameState.players.splice(index, 1);
  if (notify) io.emit('message', `${player.username} wylogował się.`);

  if (gameState.players.length < 2) resetGame();
  else io.emit('gameState', gameState);
}

function startNewRound() {
  if (gameState.gameOver) return;

  const playersWithPoints = gameState.players.filter(player => player.chips > 0);
  if (playersWithPoints.length < 2) {
    finishHandOrGame();
    return;
  }

  gameState.deck = shuffleDeck(createDeck());
  gameState.communityCards = [];
  gameState.pot = 0;
  gameState.currentBet = gameState.bigBlind;
  gameState.phase = 'preflop';

  gameState.players.forEach(player => {
    player.cards = player.chips > 0 ? [gameState.deck.pop(), gameState.deck.pop()] : [];
    player.bet = 0;
    player.folded = player.chips <= 0;
    player.allIn = false;
  });

  const dealerIndex = gameState.dealerIndex % gameState.players.length;
  const sbIndex = (dealerIndex + 1) % gameState.players.length;
  const bbIndex = (dealerIndex + 2) % gameState.players.length;

  placeBet(gameState.players[sbIndex], gameState.smallBlind);
  placeBet(gameState.players[bbIndex], gameState.bigBlind);
  gameState.currentPlayerIndex = (bbIndex + 1) % gameState.players.length;

  io.emit('gameState', gameState);
  io.emit('message', `Nowa ręka! ${gameState.players[sbIndex].username}: SB, ${gameState.players[bbIndex].username}: BB`);
}

function placeBet(player, amount) {
  const actualAmount = Math.max(0, Math.min(amount, player.chips));
  player.chips -= actualAmount;
  player.bet += actualAmount;
  gameState.pot += actualAmount;
  if (player.chips === 0) player.allIn = true;
}

function handlePlayerAction(player, action, amount) {
  if (action === 'fold') {
    player.folded = true;
    io.emit('message', `${player.username} spasował`);

    if (gameState.players.filter(item => !item.folded).length === 1) {
      endRound();
      return;
    }
  } else if (action === 'check') {
    if (player.bet < gameState.currentBet) {
      io.to(player.id).emit('error', 'Nie możesz wykonać Check. Wybierz Call lub Fold.');
      return;
    }
    io.emit('message', `${player.username} wykonał Check`);
  } else if (action === 'call') {
    const toCall = gameState.currentBet - player.bet;
    placeBet(player, toCall);
    io.emit('message', `${player.username} sprawdził za ${Math.max(0, toCall)}`);
  } else if (action === 'bet' || action === 'raise') {
    const totalBet = Number(amount);
    if (!Number.isFinite(totalBet) || totalBet <= gameState.currentBet) {
      io.to(player.id).emit('error', `Stawka musi być większa niż ${gameState.currentBet}.`);
      return;
    }
    placeBet(player, totalBet - player.bet);
    gameState.currentBet = player.bet;
    io.emit('message', `${player.username} podbił stawkę do ${player.bet}`);
  } else {
    io.to(player.id).emit('error', 'Nieznana akcja.');
    return;
  }

  nextPlayer();
}

function nextPlayer() {
  const activePlayers = gameState.players.filter(player => !player.folded && !player.allIn);
  if (activePlayers.length === 0) {
    endRound();
    return;
  }

  let nextIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
  let loopCount = 0;
  while ((gameState.players[nextIndex].folded || gameState.players[nextIndex].allIn) && loopCount < gameState.players.length) {
    nextIndex = (nextIndex + 1) % gameState.players.length;
    loopCount++;
  }

  const allCalled = gameState.players.every(player => player.folded || player.allIn || player.bet === gameState.currentBet);
  if (allCalled && nextIndex === getFirstBetterIndex()) nextPhase();
  else {
    gameState.currentPlayerIndex = nextIndex;
    io.emit('gameState', gameState);
  }
}

function getFirstBetterIndex() {
  return gameState.phase === 'preflop'
    ? (gameState.dealerIndex + 3) % gameState.players.length
    : (gameState.dealerIndex + 1) % gameState.players.length;
}

function nextPhase() {
  gameState.players.forEach(player => { player.bet = 0; });
  gameState.currentBet = 0;

  if (gameState.phase === 'preflop') {
    gameState.phase = 'flop';
    gameState.communityCards.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop());
  } else if (gameState.phase === 'flop') {
    gameState.phase = 'turn';
    gameState.communityCards.push(gameState.deck.pop());
  } else if (gameState.phase === 'turn') {
    gameState.phase = 'river';
    gameState.communityCards.push(gameState.deck.pop());
  } else if (gameState.phase === 'river') {
    gameState.phase = 'showdown';
    determineWinner();
    return;
  }

  gameState.currentPlayerIndex = getFirstBetterIndex();
  io.emit('gameState', gameState);
  io.emit('message', `Faza: ${gameState.phase.toUpperCase()}`);
}

function determineWinner() {
  const activePlayers = gameState.players.filter(player => !player.folded);

  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += gameState.pot;
    io.emit('message', `${winner.username} wygrywa pulę: ${gameState.pot} punktów!`);
    finishHandOrGame();
    return;
  }

  let bestScore = -1;
  let winners = [];
  activePlayers.forEach(player => {
    const score = evaluateHand([...player.cards, ...gameState.communityCards]);
    if (score > bestScore) {
      bestScore = score;
      winners = [player];
    } else if (score === bestScore) winners.push(player);
  });

  const winAmount = Math.floor(gameState.pot / winners.length);
  winners.forEach(winner => {
    winner.chips += winAmount;
    io.emit('message', `${winner.username} wygrywa ${winAmount} punktów!`);
  });

  finishHandOrGame();
}

function finishHandOrGame() {
  gameState.phase = 'showdown';
  gameState.currentPlayerIndex = -1;
  io.emit('gameState', gameState);

  const playersWithPoints = gameState.players.filter(player => player.chips > 0);

  if (playersWithPoints.length <= 1) {
    gameState.gameOver = true;
    gameState.phase = 'gameover';
    gameState.pot = 0;
    gameState.currentBet = 0;

    const ranking = [...gameState.players]
      .sort((a, b) => b.chips - a.chips)
      .map((player, index) => ({ place: index + 1, username: player.username, chips: player.chips }));

    io.emit('gameOver', { winner: playersWithPoints[0] || null, ranking });
    io.emit('gameState', gameState);
    return;
  }

  gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
  setTimeout(() => {
    if (!gameState.gameOver && gameState.players.length >= 2) startNewRound();
  }, 3000);
}

function endRound() {
  const winner = gameState.players.find(player => !player.folded);
  if (winner) {
    winner.chips += gameState.pot;
    io.emit('message', `${winner.username} wygrywa pulę: ${gameState.pot} punktów!`);
  }
  finishHandOrGame();
}

function resetGame() {
  gameState = {
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    phase: 'waiting',
    gameOver: false,
    smallBlind: 10,
    bigBlind: 20
  };
  io.emit('gameState', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer uruchomiony na http://localhost:${PORT}`);
});
