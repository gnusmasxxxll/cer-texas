const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Gotowe konta (6 graczy)
const VALID_USERS = [
  { username: 'gracz1', password: '123' },
  { username: 'gracz2', password: '123' },
  { username: 'gracz3', password: '123' },
  { username: 'gracz4', password: '123' },
  { username: 'gracz5', password: '123' },
  { username: 'gracz6', password: '123' }
];

// Logika kart
const suits = ['♠', '♥', '♦', '♣'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
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
  const valueMap = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return valueMap[card.value];
}

function evaluateHand(cards) {
  const cardValues = cards.map(getCardValue).sort((a, b) => b - a);
  const cardSuits = cards.map(c => c.suit);
  
  const isFlush = cardSuits.every(s => s === cardSuits[0]);
  const uniqueValues = [...new Set(cardValues)];
  const isStraight = uniqueValues.length === 5 && (cardValues[0] - cardValues[4] === 4 || 
    (cardValues[0] === 14 && cardValues[1] === 5 && cardValues[2] === 4 && cardValues[3] === 3 && cardValues[4] === 2));
  
  const counts = {};
  cardValues.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const pairs = Object.values(counts).filter(c => c === 2).length;
  const trips = Object.values(counts).some(c => c === 3);
  const quads = Object.values(counts).some(c => c === 4);
  
  if (isFlush && isStraight) return 800 + cardValues[0];
  if (quads) return 700 + parseInt(Object.keys(counts).find(k => counts[k] === 4));
  if (trips && pairs >= 1) return 600 + parseInt(Object.keys(counts).find(k => counts[k] === 3));
  if (isFlush) return 500 + cardValues[0];
  if (isStraight) return 400 + cardValues[0];
  if (trips) return 300 + parseInt(Object.keys(counts).find(k => counts[k] === 3));
  if (pairs === 2) return 200 + parseInt(Object.keys(counts).find(k => counts[k] === 2));
  if (pairs === 1) return 100 + parseInt(Object.keys(counts).find(k => counts[k] === 2));
  return cardValues[0];
}

// Stan gry
let gameState = {
  players: [],
  deck: [],
  communityCards: [],
  pot: 0,
  currentBet: 0,
  dealerIndex: 0,
  currentPlayerIndex: 0,
  phase: 'waiting',
  smallBlind: 10,
  bigBlind: 20
};

io.on('connection', (socket) => {
  console.log('Gracz połączony:', socket.id);
  
  socket.on('login', (data) => {
    const { username, password } = data;
    const user = VALID_USERS.find(u => u.username === username && u.password === password);
    
    if (!user) {
      socket.emit('loginResult', { success: false, error: 'Nieprawidłowe dane' });
      return;
    }
    
    if (gameState.players.find(p => p.username === username)) {
      socket.emit('loginResult', { success: false, error: 'Ten gracz już gra' });
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
    console.log(`${username} zalogował się`);
  });
  
  socket.on('startGame', () => {
    if (gameState.players.length < 2) {
      socket.emit('error', 'Potrzeba minimum 2 graczy');
      return;
    }
    startNewRound();
  });
  
  socket.on('playerAction', (data) => {
    const { action, amount } = data;
    const player = gameState.players.find(p => p.id === socket.id);
    
    if (!player || gameState.players[gameState.currentPlayerIndex]?.id !== socket.id) {
      return;
    }
    
    handlePlayerAction(player, action, amount);
  });
  
  socket.on('disconnect', () => {
    const index = gameState.players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      const player = gameState.players[index];
      console.log(`${player.username} rozłączył się`);
      gameState.players.splice(index, 1);
      
      if (gameState.players.length < 2) {
        resetGame();
      }
    }
    io.emit('gameState', gameState);
  });
});

function startNewRound() {
  gameState.deck = shuffleDeck(createDeck());
  gameState.communityCards = [];
  gameState.pot = 0;
  gameState.currentBet = gameState.bigBlind;
  gameState.phase = 'preflop';
  
  gameState.players.forEach(p => {
    p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    p.bet = 0;
    p.folded = false;
    p.allIn = false;
  });
  
  const dealerIndex = gameState.dealerIndex;
  const sbIndex = (dealerIndex + 1) % gameState.players.length;
  const bbIndex = (dealerIndex + 2) % gameState.players.length;
  
  placeBet(gameState.players[sbIndex], gameState.smallBlind);
  placeBet(gameState.players[bbIndex], gameState.bigBlind);
  
  gameState.currentPlayerIndex = (bbIndex + 1) % gameState.players.length;
  
  io.emit('gameState', gameState);
  io.emit('message', `Nowa ręka! ${gameState.players[sbIndex].username}: SB, ${gameState.players[bbIndex].username}: BB`);
}

function placeBet(player, amount) {
  const actualAmount = Math.min(amount, player.chips);
  player.chips -= actualAmount;
  player.bet += actualAmount;
  gameState.pot += actualAmount;
  
  if (player.chips === 0) {
    player.allIn = true;
  }
}

function handlePlayerAction(player, action, amount) {
  if (action === 'fold') {
    player.folded = true;
    io.emit('message', `${player.username} spasował`);
  } else if (action === 'check') {
    io.emit('message', `${player.username} sprawdził`);
  } else if (action === 'call') {
    const toCall = gameState.currentBet - player.bet;
    placeBet(player, toCall);
    io.emit('message', `${player.username} sprawdził za ${toCall}`);
  } else if (action === 'bet' || action === 'raise') {
    const totalBet = amount;
    const added = totalBet - player.bet;
    placeBet(player, added);
    gameState.currentBet = totalBet;
    io.emit('message', `${player.username} postawił ${totalBet}`);
  }
  
  nextPlayer();
}

function nextPlayer() {
  const activePlayers = gameState.players.filter(p => !p.folded && !p.allIn);
  
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
  
  const allCalled = gameState.players.every(p => 
    p.folded || p.allIn || p.bet === gameState.currentBet
  );
  
  if (allCalled && nextIndex === getFirstBetterIndex()) {
    nextPhase();
  } else {
    gameState.currentPlayerIndex = nextIndex;
    io.emit('gameState', gameState);
  }
}

function getFirstBetterIndex() {
  const dealerIndex = gameState.dealerIndex;
  if (gameState.phase === 'preflop') {
    return (dealerIndex + 3) % gameState.players.length;
  }
  return (dealerIndex + 1) % gameState.players.length;
}

function nextPhase() {
  gameState.players.forEach(p => p.bet = 0);
  gameState.currentBet = 0;
  
  switch (gameState.phase) {
    case 'preflop':
      gameState.phase = 'flop';
      gameState.communityCards.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop());
      break;
    case 'flop':
      gameState.phase = 'turn';
      gameState.communityCards.push(gameState.deck.pop());
      break;
    case 'turn':
      gameState.phase = 'river';
      gameState.communityCards.push(gameState.deck.pop());
      break;
    case 'river':
      gameState.phase = 'showdown';
      determineWinner();
      return;
  }
  
  gameState.currentPlayerIndex = getFirstBetterIndex();
  io.emit('gameState', gameState);
  io.emit('message', `Faza: ${gameState.phase.toUpperCase()}`);
}

function determineWinner() {
  const activePlayers = gameState.players.filter(p => !p.folded);
  
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += gameState.pot;
    io.emit('message', `${winner.username} wygrywa ${gameState.pot} punktów!`);
  } else {
    let bestScore = -1;
    let winners = [];
    
    activePlayers.forEach(player => {
      const hand = [...player.cards, ...gameState.communityCards];
      const score = evaluateHand(hand);
      
      if (score > bestScore) {
        bestScore = score;
        winners = [player];
      } else if (score === bestScore) {
        winners.push(player);
      }
    });
    
    const winAmount = Math.floor(gameState.pot / winners.length);
    winners.forEach(w => {
      w.chips += winAmount;
      io.emit('message', `${w.username} wygrywa ${winAmount} punktów!`);
    });
  }
  
  gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
  setTimeout(() => {
    startNewRound();
  }, 3000);
}

function endRound() {
  const winner = gameState.players.find(p => !p.folded);
  if (winner) {
    winner.chips += gameState.pot;
    io.emit('message', `${winner.username} wygrywa ${gameState.pot} punktów!`);
  }
  
  gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
  setTimeout(() => {
    startNewRound();
  }, 3000);
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
    smallBlind: 10,
    bigBlind: 20
  };
  io.emit('gameState', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer uruchomiony na http://localhost:${PORT}`);
});