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
  return {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14
  }[card.value];
}

function evaluateHand(cards) {
  /*
    Texas Hold'em: wybieramy najlepszy układ 5 kart
    ze wszystkich 7 kart: 2 własne + 5 wspólnych.
  */
  const combinations = getCombinations(cards, 5);

  let bestHand = null;

  combinations.forEach(fiveCards => {
    const evaluated = evaluateFiveCards(fiveCards);

    if (!bestHand || compareHands(evaluated, bestHand) > 0) {
      bestHand = evaluated;
    }
  });

  return bestHand;
}

function getCombinations(items, size) {
  const result = [];

  function build(startIndex, combination) {
    if (combination.length === size) {
      result.push([...combination]);
      return;
    }

    for (let i = startIndex; i < items.length; i++) {
      combination.push(items[i]);
      build(i + 1, combination);
      combination.pop();
    }
  }

  build(0, []);
  return result;
}

function evaluateFiveCards(cards) {
  const values = cards
    .map(getCardValue)
    .sort((a, b) => b - a);

  const suits = cards.map(card => card.suit);

  const counts = {};

  values.forEach(value => {
    counts[value] = (counts[value] || 0) + 1;
  });

  const valueGroups = Object.entries(counts)
    .map(([value, count]) => ({
      value: Number(value),
      count
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return b.value - a.value;
    });

  const isFlush = suits.every(suit => suit === suits[0]);
  const straightHighCard = getStraightHighCard(values);

  /*
    Wartości kategorii:
    8 = poker królewski / straight flush
    7 = kareta
    6 = full house
    5 = kolor
    4 = strit
    3 = trójka
    2 = dwie pary
    1 = jedna para
    0 = wysoka karta

    Zwracamy tablicę. Pierwsza wartość oznacza rodzaj układu,
    kolejne wartości są porównywane jako kickery.
  */

  if (isFlush && straightHighCard) {
    return [8, straightHighCard];
  }

  if (valueGroups[0].count === 4) {
    return [
      7,
      valueGroups[0].value,
      valueGroups[1].value
    ];
  }

  if (
    valueGroups[0].count === 3 &&
    valueGroups[1].count === 2
  ) {
    return [
      6,
      valueGroups[0].value,
      valueGroups[1].value
    ];
  }

  if (isFlush) {
    return [5, ...values];
  }

  if (straightHighCard) {
    return [4, straightHighCard];
  }

  if (valueGroups[0].count === 3) {
    return [
      3,
      valueGroups[0].value,
      valueGroups[1].value,
      valueGroups[2].value
    ];
  }

  if (
    valueGroups[0].count === 2 &&
    valueGroups[1].count === 2
  ) {
    return [
      2,
      valueGroups[0].value,
      valueGroups[1].value,
      valueGroups[2].value
    ];
  }

  if (valueGroups[0].count === 2) {
    return [
      1,
      valueGroups[0].value,
      valueGroups[1].value,
      valueGroups[2].value,
      valueGroups[3].value
    ];
  }

  return [0, ...values];
}

function getStraightHighCard(values) {
  const uniqueDescending = [...new Set(values)]
    .sort((a, b) => b - a);

  /*
    As może być niską kartą w stricie A-2-3-4-5.
  */
  if (
    uniqueDescending.includes(14) &&
    uniqueDescending.includes(5) &&
    uniqueDescending.includes(4) &&
    uniqueDescending.includes(3) &&
    uniqueDescending.includes(2)
  ) {
    return 5;
  }

  for (let i = 0; i <= uniqueDescending.length - 5; i++) {
    const first = uniqueDescending[i];
    const fifth = uniqueDescending[i + 4];

    if (first - fifth === 4) {
      return first;
    }
  }

  return null;
}

function compareHands(handA, handB) {
  const length = Math.max(handA.length, handB.length);

  for (let i = 0; i < length; i++) {
    const valueA = handA[i] || 0;
    const valueB = handB[i] || 0;

    if (valueA > valueB) {
      return 1;
    }

    if (valueA < valueB) {
      return -1;
    }
  }

  return 0;
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
  bigBlind: 20,
  firstPlayerThisStreet: 0,
  handSettled: false
};

io.on('connection', socket => {
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

socket.on('restartGame', () => {
  if (!gameState.gameOver) {
    socket.emit('error', 'Nową grę można rozpocząć dopiero po zakończeniu poprzedniej.');
    return;
  }

  if (gameState.players.length < 2) {
    socket.emit('error', 'Do nowej gry potrzeba minimum 2 zalogowanych graczy.');
    return;
  }

  gameState.gameOver = false;
  gameState.deck = [];
  gameState.communityCards = [];
  gameState.pot = 0;
  gameState.currentBet = 0;
  gameState.dealerIndex = 0;
  gameState.currentPlayerIndex = 0;
  gameState.firstPlayerThisStreet = 0;
  gameState.phase = 'waiting';

  gameState.players.forEach(player => {
    player.chips = 1000;
    player.cards = [];
    player.bet = 0;
    player.folded = false;
    player.allIn = false;
  });

  io.emit('gameRestarted');
  io.emit('gameState', gameState);
  io.emit('message', 'Nowa gra jest gotowa. Kliknij Rozpocznij rozdanie.');
});
  
  socket.on('playerAction', ({ action, amount }) => {
    const player = gameState.players.find(item => item.id === socket.id);

    if (!player || gameState.gameOver) return;
    if (gameState.players[gameState.currentPlayerIndex]?.id !== socket.id) return;

    handlePlayerAction(player, action, amount);
  });

  socket.on('logout', () => removePlayer(socket.id, true));
  socket.on('disconnect', () => removePlayer(socket.id, false));
});

function removePlayer(socketId, notify) {
  const index = gameState.players.findIndex(player => player.id === socketId);
  if (index === -1) return;

  const [player] = gameState.players.splice(index, 1);
  if (notify) io.emit('message', `${player.username} wylogował się.`);

  if (gameState.players.length < 2) resetGame();
  else {
    gameState.dealerIndex %= gameState.players.length;
    gameState.currentPlayerIndex %= gameState.players.length;
    io.emit('gameState', gameState);
  }
}

function startNewRound() {
  if (gameState.gameOver) return;

  const playersWithPoints = gameState.players.filter(player => player.chips > 0);
  if (playersWithPoints.length < 2) {
    finishHandOrGame();
    return;
  }

  const count = gameState.players.length;
  gameState.dealerIndex = ((gameState.dealerIndex % count) + count) % count;

  gameState.deck = shuffleDeck(createDeck());
  gameState.communityCards = [];
  gameState.pot = 0;
  gameState.currentBet = gameState.bigBlind;
  gameState.phase = 'preflop';
  gameState.handSettled = false;

gameState.players.forEach(player => {
  player.cards = [gameState.deck.pop(), gameState.deck.pop()];
  player.bet = 0;
  player.folded = false;
  player.allIn = false;
  player.showCards = false;
});

  let smallBlindIndex;
  let bigBlindIndex;
  let firstPlayerIndex;

  if (count === 2) {
    // Heads-up: dealer = small blind i zaczyna preflop.
    smallBlindIndex = gameState.dealerIndex;
    bigBlindIndex = (gameState.dealerIndex + 1) % count;
    firstPlayerIndex = smallBlindIndex;
  } else {
    smallBlindIndex = (gameState.dealerIndex + 1) % count;
    bigBlindIndex = (gameState.dealerIndex + 2) % count;
    firstPlayerIndex = getNextAbleToActIndex(bigBlindIndex);
  }

  placeBet(gameState.players[smallBlindIndex], gameState.smallBlind);
  placeBet(gameState.players[bigBlindIndex], gameState.bigBlind);

  gameState.currentPlayerIndex = firstPlayerIndex;
  gameState.firstPlayerThisStreet = firstPlayerIndex;

  io.emit('gameState', gameState);
  io.emit(
    'message',
    `Nowa ręka! ${gameState.players[smallBlindIndex].username}: SB, ${gameState.players[bigBlindIndex].username}: BB`
  );
}

function placeBet(player, amount) {
  const actualAmount = Math.max(0, Math.min(Number(amount) || 0, player.chips));
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
      io.to(player.id).emit('error', 'Nie możesz wykonać Check. Wybierz Call albo Fold.');
      return;
    }
    io.emit('message', `${player.username} wykonał Check`);
  } else if (action === 'call') {
  const toCall = Math.max(
    0,
    gameState.currentBet - player.bet
  );

  placeBet(player, toCall);

  io.emit(
    'message',
    `${player.username} sprawdził za ${toCall} punktów.`
  );

  if (player.allIn) {
    io.emit(
      'message',
      `${player.username} jest all-in.`
    );
  }

placeBet(player, toCall);

io.emit(
  'message',
  `${player.username} sprawdził za ${toCall} punktów.`
);

if (player.allIn) {
  io.emit(
    'message',
    `${player.username} jest all-in.`
  );
}
  } else if (action === 'bet' || action === 'raise') {
    const totalBet = Number(amount);

    if (!Number.isFinite(totalBet) || totalBet <= gameState.currentBet) {
      io.to(player.id).emit('error', `Stawka musi być większa niż ${gameState.currentBet}.`);
      return;
    }

    placeBet(player, totalBet - player.bet);
    gameState.currentBet = Math.max(gameState.currentBet, player.bet);
    io.emit('message', `${player.username} podbił stawkę do ${player.bet}`);
  } else {
    io.to(player.id).emit('error', 'Nieznana akcja.');
    return;
  }

  advanceAfterAction();
}

function getNextAbleToActIndex(fromIndex) {
  const count = gameState.players.length;

  for (let offset = 1; offset <= count; offset++) {
    const index = (fromIndex + offset) % count;
    const player = gameState.players[index];

    if (player && !player.folded && !player.allIn) {
      return index;
    }
  }

  return -1;
}

function advanceAfterAction() {
  const playersStillInHand = gameState.players.filter(
    player => !player.folded
  );

  if (playersStillInHand.length === 1) {
    endRound();
    return;
  }

  const playersWhoCanAct = gameState.players.filter(
    player => !player.folded && !player.allIn
  );

  /*
    Gdy pozostali gracze są all-in albo wyrównali ich zakład,
    nie czekamy na powrót do firstPlayerThisStreet.
  */
  const everyoneMatched = gameState.players.every(
    player =>
      player.folded ||
      player.allIn ||
      player.bet === gameState.currentBet
  );

  if (playersWhoCanAct.length === 0) {
    runOutCommunityCards();
    return;
  }

  /*
    Jeżeli wszyscy gracze, którzy mogą działać, wyrównali stawkę,
    kończymy aktualną rundę licytacji.
  */
  const activePlayersMatched = playersWhoCanAct.every(
    player => player.bet === gameState.currentBet
  );

  if (everyoneMatched || activePlayersMatched) {
    nextPhase();
    return;
  }

  const nextIndex = getNextAbleToActIndex(
    gameState.currentPlayerIndex
  );

  if (nextIndex === -1) {
    runOutCommunityCards();
    return;
  }

  gameState.currentPlayerIndex = nextIndex;
  io.emit('gameState', gameState);
}

function nextPhase() {
  gameState.players.forEach(player => {
    player.bet = 0;
  });

  gameState.currentBet = 0;

  if (gameState.phase === 'preflop') {
    gameState.phase = 'flop';

    gameState.communityCards.push(
      gameState.deck.pop(),
      gameState.deck.pop(),
      gameState.deck.pop()
    );
  } else if (gameState.phase === 'flop') {
    gameState.phase = 'turn';
    gameState.communityCards.push(gameState.deck.pop());
  } else if (gameState.phase === 'turn') {
    gameState.phase = 'river';
    gameState.communityCards.push(gameState.deck.pop());
  } else if (gameState.phase === 'river') {
    /*
      River został rozegrany.
      Nie ustawiamy tutaj osobnego oczekiwania na showdown.
      Od razu wyliczamy zwycięzcę i rozliczamy pulę.
    */
    determineWinner();
    return;
  }

  const firstIndex = getNextAbleToActIndex(gameState.dealerIndex);

  if (firstIndex === -1) {
    runOutCommunityCards();
    return;
  }

  gameState.firstPlayerThisStreet = firstIndex;
  gameState.currentPlayerIndex = firstIndex;

  io.emit('gameState', gameState);

  io.emit(
    'message',
    `Faza: ${gameState.phase.toUpperCase()}`
  );
}

function runOutCommunityCards() {
  while (gameState.communityCards.length < 5) {
    gameState.communityCards.push(gameState.deck.pop());
  }

  gameState.currentPlayerIndex = -1;

  io.emit('gameState', gameState);
  io.emit(
    'message',
    'Wszyscy pozostali gracze są all-in. Odkrywanie kart...'
  );

  setTimeout(() => {
    determineWinner();
  }, 1200);
}

function determineWinner() {
  if (gameState.handSettled) {
    return;
  }

  gameState.handSettled = true;
  gameState.phase = 'showdown';
  gameState.currentPlayerIndex = -1;

  const activePlayers = gameState.players.filter(player => !player.folded);

  if (activePlayers.length === 0) {
    io.emit('gameState', gameState);
    finishHandOrGame();
    return;
  }

let bestScore = null;
let winners = [];

  if (activePlayers.length === 1) {
    winners = [activePlayers[0]];
  } else {
    activePlayers.forEach(player => {
      const score = evaluateHand([
        ...player.cards,
        ...gameState.communityCards
      ]);

if (!bestScore || compareHands(score, bestScore) > 0) {
  bestScore = score;
  winners = [player];
} else if (compareHands(score, bestScore) === 0) {
  winners.push(player);
}
    });
  }

  const wonPot = gameState.pot;
  const winAmount = Math.floor(wonPot / winners.length);

  winners.forEach(winner => {
    winner.chips += winAmount;
  });

  gameState.pot = 0;
  gameState.players.forEach(player => {
  player.showCards = !player.folded;
  });
  
  // Wszyscy, którzy nie spasowali, ujawniają karty.
const showdownPlayers = gameState.players.map(player => ({
  id: player.id,
  username: player.username,
  cards: player.folded ? [] : player.cards,
  folded: player.folded,
  chips: player.chips,
  bet: player.bet,
  showCards: !player.folded,
  isWinner: winners.some(
    winner => winner.username === player.username
  )
}));

  io.emit('gameState', gameState);
  io.emit('showdownResult', {
    players: showdownPlayers,
    winners: winners.map(winner => winner.username),
    pot: wonPot
  });

  winners.forEach(winner => {
    io.emit('message', `${winner.username} wygrywa ${winAmount} punktów!`);
  });

  finishHandOrGame();
}

function finishHandOrGame() {
  gameState.phase = 'showdown';
  gameState.currentPlayerIndex = -1;

  io.emit('gameState', gameState);

  const playersWithPoints = gameState.players.filter(
    player => player.chips > 0
  );

  if (playersWithPoints.length <= 1) {
    gameState.gameOver = true;
    gameState.phase = 'gameover';
    gameState.pot = 0;
    gameState.currentBet = 0;

    const ranking = [...gameState.players]
      .sort((a, b) => b.chips - a.chips)
      .map((player, index) => ({
        place: index + 1,
        username: player.username,
        chips: player.chips
      }));

    io.emit('gameOver', {
      winner: playersWithPoints[0] || null,
      ranking
    });

    io.emit('gameState', gameState);
    return;
  }

  gameState.dealerIndex =
    (gameState.dealerIndex + 1) % gameState.players.length;

  setTimeout(() => {
    if (
      !gameState.gameOver &&
      gameState.players.length >= 2
    ) {
      startNewRound();
    }
  }, 10000);
}

function endRound() {
  // Zabezpieczenie przed drugim rozliczeniem puli po Fold.
  if (gameState.handSettled) return;
  gameState.handSettled = true;

  const winner = gameState.players.find(player => !player.folded);

  if (winner) {
    const wonPot = gameState.pot;
    winner.chips += wonPot;
    gameState.pot = 0;

    io.emit('message', `${winner.username} wygrywa ${wonPot} punktów!`);
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
    firstPlayerThisStreet: 0,
    gameOver: false,
    smallBlind: 10,
    bigBlind: 20,
    handSettled: false
  };

  io.emit('gameState', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer uruchomiony na http://localhost:${PORT}`);
});
