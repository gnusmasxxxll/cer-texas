const socket = io();
let currentPlayer = null;
let isManualLogout = false;

const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginMessage = document.getElementById('loginMessage');

const playerInfo = document.getElementById('playerInfo');
const pointsInfo = document.getElementById('pointsInfo');
const logoutBtn = document.getElementById('logoutBtn');

const phaseInfo = document.getElementById('phaseInfo');
const turnInfo = document.getElementById('turnInfo');
const potInfo = document.getElementById('potInfo');

const communityCardsEl = document.getElementById('communityCards');
const myCardsEl = document.getElementById('myCards');
const mySeatEl = document.getElementById('mySeat');
const gameControls = document.getElementById('gameControls');
const startBtn = document.getElementById('startBtn');
const messagesEl = document.getElementById('messages');

const gameOverModal = document.getElementById('gameOverModal');
const gameOverWinner = document.getElementById('gameOverWinner');
const rankingList = document.getElementById('rankingList');

const restartGameBtn = document.getElementById('restartGameBtn');

const seatElements = [
  document.getElementById('seatTop'),
  document.getElementById('seatTopLeft'),
  document.getElementById('seatTopRight'),
  document.getElementById('seatBottomLeft'),
  document.getElementById('seatBottomRight')
];

/*
  Dane do automatycznego logowania zostaną zapisane tylko lokalnie
  w przeglądarce danego użytkownika.
*/
const STORAGE_KEY = 'texasHoldemLogin';

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    loginMessage.textContent = 'Podaj login oraz hasło.';
    return;
  }

  isManualLogout = false;
  socket.emit('login', { username, password });
});

logoutBtn.addEventListener('click', () => {
  isManualLogout = true;

  /*
    Usuwa dane automatycznego logowania z przeglądarki.
    Serwer usuwa gracza z gry.
  */
  localStorage.removeItem(STORAGE_KEY);

  socket.emit('logout');

  currentPlayer = null;
  gameScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  logoutBtn.classList.add('hidden');

  usernameInput.value = '';
  passwordInput.value = '';
  loginMessage.textContent = 'Wylogowano pomyślnie.';
});

restartGameBtn.addEventListener('click', () => {
  socket.emit('restartGame');
});


socket.on('connect', () => {
  /*
    Po odświeżeniu strony odczytujemy zapisane dane
    i automatycznie odtwarzamy sesję gracza.
  */
  const savedLogin = localStorage.getItem(STORAGE_KEY);

  if (savedLogin && !isManualLogout && !currentPlayer) {
    try {
      const credentials = JSON.parse(savedLogin);
      socket.emit('login', credentials);
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
});

socket.on('loginResult', (data) => {
  if (!data.success) {
    loginMessage.textContent = data.error;

    /*
      Gdy login nie może zostać odtworzony, np. konto jest użyte
      na innym komputerze, nie próbujemy automatycznie w kółko.
    */
    if (!currentPlayer) {
      localStorage.removeItem(STORAGE_KEY);
    }

    return;
  }

  currentPlayer = data.player;

  /*
    Zapamiętujemy dane wyłącznie do automatycznego zalogowania
    po odświeżeniu bieżącej przeglądarki.
  */
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      username: data.player.username,
      password: passwordInput.value || getSavedPassword()
    })
  );

  loginScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');

  playerInfo.textContent = `Gracz: ${currentPlayer.username}`;
  pointsInfo.textContent = `Żetony: ${currentPlayer.chips}`;

  addMessage(`Witaj przy stole, ${currentPlayer.username}.`);
});

socket.on('gameState', (state) => {
  renderGame(state);
});

socket.on('message', (message) => {
  addMessage(message);
});

socket.on('error', (message) => {
  addMessage(`Błąd: ${message}`);
});

socket.on('gameOver', (data) => {
  showGameOver(data);
});

socket.on('gameRestarted', () => {
  gameOverModal.classList.add('hidden');
  messagesEl.innerHTML = '';
  addMessage('Rozpoczęto nową grę. Każdy gracz ma ponownie 1000 punktów.');
});

function getSavedPassword() {
  try {
    const savedLogin = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return savedLogin.password || '';
  } catch {
    return '';
  }
}

function renderGame(state) {
  const me = state.players.find((player) => player.id === currentPlayer?.id);

  /*
    Po odświeżeniu socket.id zmienia się.
    Aby interfejs nadal znalazł gracza, porównujemy także login.
  */
  const meByUsername = state.players.find(
    (player) => player.username === currentPlayer?.username
  );

  const actualMe = me || meByUsername;

  phaseInfo.textContent = getPhaseLabel(state.phase);
  potInfo.textContent = `PULA: ${state.pot}`;

  communityCardsEl.innerHTML = state.communityCards
    .map(createCardHTML)
    .join('');

  if (actualMe) {
    currentPlayer = { ...currentPlayer, ...actualMe };

    pointsInfo.textContent = `Żetony: ${actualMe.chips}`;
    myCardsEl.innerHTML = actualMe.cards.map(createCardHTML).join('');
    mySeatEl.innerHTML = createSeatHTML(actualMe, true, state);
  } else {
    mySeatEl.innerHTML = createEmptySeatHTML('Twoje miejsce');
  }

  const opponents = state.players.filter(
    (player) => player.username !== currentPlayer?.username
  );

  seatElements.forEach((seatElement, index) => {
    const opponent = opponents[index];

    seatElement.innerHTML = opponent
      ? createSeatHTML(opponent, false, state)
      : createEmptySeatHTML('Wolne miejsce');
  });

  const activePlayer = state.players[state.currentPlayerIndex];
  const isMyTurn =
    actualMe &&
    state.phase !== 'waiting' &&
    activePlayer?.username === currentPlayer?.username;

  if (isMyTurn && !actualMe.folded && !actualMe.allIn) {
    gameControls.classList.remove('hidden');
    startBtn.classList.add('hidden');
    turnInfo.textContent = 'Twoja kolej — wybierz ruch.';
  } else {
    gameControls.classList.add('hidden');

    if (state.phase === 'waiting') {
      startBtn.classList.remove('hidden');
      turnInfo.textContent = 'Czekasz na rozpoczęcie rozdania.';
    } else {
      startBtn.classList.add('hidden');

      if (actualMe?.folded) {
        turnInfo.textContent = 'Spasowałeś — czekasz na kolejne rozdanie.';
      } else if (actualMe?.allIn) {
        turnInfo.textContent = 'Jesteś all-in — czekasz na wynik.';
      } else {
        turnInfo.textContent = activePlayer
          ? `Ruch wykonuje: ${activePlayer.username}`
          : 'Trwa rozdanie.';
      }
    }
  }
}

function createSeatHTML(player, isMine, state) {
  const activePlayer = state.players[state.currentPlayerIndex];
  const isActive = activePlayer?.username === player.username;

  const classes = [
    'player-seat',
    isMine ? 'mine' : '',
    isActive ? 'active' : '',
    player.folded ? 'folded' : ''
  ].filter(Boolean).join(' ');

  const status = player.folded
    ? 'FOLD'
    : player.allIn
      ? 'ALL-IN'
      : isActive
        ? 'TWOJA KOLEJ'
        : '';

  return `
    <article class="${classes}">
      <div class="player-avatar">${escapeHTML(player.username.charAt(0).toUpperCase())}</div>
      <div class="player-name">${escapeHTML(player.username)}${isMine ? ' (Ty)' : ''}</div>
      <div class="player-chips">● ${player.chips} żetonów</div>
      <div class="player-bet">${player.bet > 0 ? `Stawka: ${player.bet}` : 'Stawka: —'}</div>
      <div class="player-status">${status}</div>
      ${isMine ? '' : `
        <div class="player-hole-cards">
          <div class="mini-card"></div>
          <div class="mini-card"></div>
        </div>
      `}
    </article>
  `;
}

function createEmptySeatHTML(label) {
  return `
    <div class="seat-empty">
      <span>${label}</span>
    </div>
  `;
}

function createCardHTML(card) {
  const isRed = card.suit === '♥' || card.suit === '♦';

  return `
    <div class="card ${isRed ? 'red' : 'black'}">
      ${card.value}${card.suit}
    </div>
  `;
}

function getPhaseLabel(phase) {
  const labels = {
    waiting: 'OCZEKIWANIE',
    preflop: 'PREFLOP',
    flop: 'FLOP',
    turn: 'TURN',
    river: 'RIVER',
    showdown: 'WYNIK'
  };

  return labels[phase] || 'GRA';
}

function sendAction(action) {
  let amount = 0;

  if (action === 'bet' || action === 'raise') {
    amount = Number.parseInt(document.getElementById('betAmount').value, 10);

    if (!Number.isInteger(amount) || amount < 20) {
      addMessage('Podaj stawkę nie mniejszą niż 20.');
      return;
    }
  }

  socket.emit('playerAction', { action, amount });
}

function startGame() {
  socket.emit('startGame');
}

function addMessage(message) {
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  messagesEl.appendChild(paragraph);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showGameOver(data) {
  const winnerName = data.winner
    ? data.winner.username
    : 'Brak zwycięzcy';

  gameOverWinner.textContent = `Zwycięzca: ${winnerName}`;

  rankingList.innerHTML = data.ranking.map(player => `
    <div class="ranking-row">
      <div class="ranking-place">#${player.place}</div>
      <div class="ranking-name">${escapeHTML(player.username)}</div>
      <div class="ranking-chips">${player.chips} pkt</div>
    </div>
  `).join('');

  gameControls.classList.add('hidden');
  startBtn.classList.add('hidden');
  turnInfo.textContent = 'Gra została zakończona.';
  gameOverModal.classList.remove('hidden');
}
