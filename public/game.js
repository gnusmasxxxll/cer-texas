const socket = io();
let currentPlayer = null;

const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginMessage = document.getElementById('loginMessage');

const playerInfo = document.getElementById('playerInfo');
const pointsInfo = document.getElementById('pointsInfo');
const phaseInfo = document.getElementById('phaseInfo');
const turnInfo = document.getElementById('turnInfo');
const potInfo = document.getElementById('potInfo');

const communityCardsEl = document.getElementById('communityCards');
const myCardsEl = document.getElementById('myCards');
const mySeatEl = document.getElementById('mySeat');
const gameControls = document.getElementById('gameControls');
const startBtn = document.getElementById('startBtn');
const messagesEl = document.getElementById('messages');

const seatElements = [
  document.getElementById('seatTop'),
  document.getElementById('seatTopLeft'),
  document.getElementById('seatTopRight'),
  document.getElementById('seatBottomLeft'),
  document.getElementById('seatBottomRight')
];

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  socket.emit('login', {
    username: usernameInput.value.trim(),
    password: passwordInput.value
  });
});

socket.on('loginResult', (data) => {
  if (!data.success) {
    loginMessage.textContent = data.error;
    return;
  }

  currentPlayer = data.player;
  loginScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

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

function renderGame(state) {
  const me = state.players.find((player) => player.id === currentPlayer?.id);

  phaseInfo.textContent = getPhaseLabel(state.phase);
  potInfo.textContent = `PULA: ${state.pot}`;

  communityCardsEl.innerHTML = state.communityCards
    .map(createCardHTML)
    .join('');

  if (me) {
    currentPlayer = { ...currentPlayer, chips: me.chips };
    pointsInfo.textContent = `Żetony: ${me.chips}`;
    myCardsEl.innerHTML = me.cards.map(createCardHTML).join('');
    mySeatEl.innerHTML = createSeatHTML(me, true, state);
  } else {
    mySeatEl.innerHTML = createEmptySeatHTML('Twoje miejsce');
  }

  /*
    Zawsze pokazujemy zalogowanego użytkownika na dole.
    Inni gracze są rozstawieni kolejno wokół stołu.
  */
  const opponents = state.players.filter((player) => player.id !== currentPlayer?.id);

  seatElements.forEach((seatElement, index) => {
    const opponent = opponents[index];

    seatElement.innerHTML = opponent
      ? createSeatHTML(opponent, false, state)
      : createEmptySeatHTML('Wolne miejsce');
  });

  const isMyTurn =
    me &&
    state.phase !== 'waiting' &&
    state.players[state.currentPlayerIndex]?.id === currentPlayer?.id;

  if (isMyTurn && !me.folded && !me.allIn) {
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

      if (me?.folded) {
        turnInfo.textContent = 'Spasowałeś — czekasz na kolejne rozdanie.';
      } else if (me?.allIn) {
        turnInfo.textContent = 'Jesteś all-in — czekasz na wynik.';
      } else {
        const activePlayer = state.players[state.currentPlayerIndex];
        turnInfo.textContent = activePlayer
          ? `Ruch wykonuje: ${activePlayer.username}`
          : 'Trwa rozdanie.';
      }
    }
  }
}

function createSeatHTML(player, isMine, state) {
  const activePlayer = state.players[state.currentPlayerIndex];
  const isActive = activePlayer?.id === player.id;

  const classes = [
    'player-seat',
    isMine ? 'mine' : '',
    isActive ? 'active' : '',
    player.folded ? 'folded' : ''
  ].filter(Boolean).join(' ');

  const firstLetter = escapeHTML(player.username.charAt(0).toUpperCase());
  const betText = player.bet > 0 ? `Stawka: ${player.bet}` : 'Stawka: —';
  const status = player.folded
    ? 'FOLD'
    : player.allIn
      ? 'ALL-IN'
      : isActive
        ? 'TWOJA KOLEJ'
        : '';

  const opponentCards = isMine
    ? ''
    : `
      <div class="player-hole-cards" aria-label="Zakryte karty">
        <div class="mini-card"></div>
        <div class="mini-card"></div>
      </div>
    `;

  return `
    <article class="${classes}">
      <div class="player-avatar">${firstLetter}</div>
      <div class="player-name">${escapeHTML(player.username)}${isMine ? ' (Ty)' : ''}</div>
      <div class="player-chips">● ${player.chips} żetonów</div>
      <div class="player-bet">${betText}</div>
      <div class="player-status">${status}</div>
      ${opponentCards}
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
  return `<div class="card ${isRed ? 'red' : 'black'}">${card.value}${card.suit}</div>`;
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
