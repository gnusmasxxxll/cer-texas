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
const communityCardsEl = document.getElementById('communityCards');
const myCardsEl = document.getElementById('myCards');
const playersListEl = document.getElementById('playersList');
const potInfo = document.getElementById('potInfo');
const gameControls = document.getElementById('gameControls');
const startBtn = document.getElementById('startBtn');
const messagesEl = document.getElementById('messages');

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = usernameInput.value;
  const password = passwordInput.value;
  
  socket.emit('login', { username, password });
});

socket.on('loginResult', (data) => {
  if (data.success) {
    currentPlayer = data.player;
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    playerInfo.textContent = `Gracz: ${currentPlayer.username}`;
    pointsInfo.textContent = `Punkty: ${currentPlayer.chips}`;
    addMessage(`Witaj ${currentPlayer.username}!`);
  } else {
    loginMessage.textContent = data.error;
    loginMessage.style.color = '#e74c3c';
  }
});

socket.on('gameState', (state) => {
  renderGame(state);
});

socket.on('message', (msg) => {
  addMessage(msg);
});

socket.on('error', (error) => {
  addMessage(`Błąd: ${error}`);
});

function renderGame(state) {
  communityCardsEl.innerHTML = state.communityCards.map(card => createCardHTML(card)).join('');
  
  const myPlayer = state.players.find(p => p.id === currentPlayer?.id);
  if (myPlayer) {
    myCardsEl.innerHTML = myPlayer.cards.map(card => createCardHTML(card)).join('');
    pointsInfo.textContent = `Punkty: ${myPlayer.chips}`;
  }
  
  potInfo.textContent = `Pula: ${state.pot}`;
  
  playersListEl.innerHTML = state.players.map((player, index) => {
    const isActive = index === state.currentPlayerIndex;
    const isMe = player.id === currentPlayer?.id;
    
    return `
      <div class="player ${isActive ? 'active' : ''} ${player.folded ? 'folded' : ''}">
        <h4>${player.username} ${isMe ? '(Ty)' : ''}</h4>
        <div class="chips">Żetony: ${player.chips}</div>
        <div class="bet">Stawka: ${player.bet}</div>
        ${player.folded ? '<div style="color: #e74c3c;">SPASOWAŁ</div>' : ''}
      </div>
    `;
  }).join('');
  
  if (myPlayer && state.players[state.currentPlayerIndex]?.id === currentPlayer?.id && state.phase !== 'waiting') {
    gameControls.classList.remove('hidden');
    startBtn.classList.add('hidden');
  } else {
    gameControls.classList.add('hidden');
    if (state.phase === 'waiting') {
      startBtn.classList.remove('hidden');
    }
  }
}

function createCardHTML(card) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  return `<div class="card ${isRed ? 'red' : 'black'}">${card.value}${card.suit}</div>`;
}

function sendAction(action) {
  const amount = action === 'bet' || action === 'raise' ? parseInt(document.getElementById('betAmount').value) : 0;
  socket.emit('playerAction', { action, amount });
}

function startGame() {
  socket.emit('startGame');
}

function addMessage(msg) {
  const p = document.createElement('p');
  p.textContent = msg;
  messagesEl.appendChild(p);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}