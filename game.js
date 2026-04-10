const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const teamEl = document.getElementById('team');
const overlay = document.getElementById('overlay');
const startButton = document.getElementById('startButton');

const TILE = 32;
const MAP_W = 30;
const MAP_H = 16;

const animals = [
  ['Fox', 'Swift'], ['Bear', 'Tank'], ['Otter', 'Wave'], ['Hawk', 'Sky'], ['Stag', 'Forest'],
  ['Wolf', 'Howl'], ['Rabbit', 'Quick'], ['Badger', 'Earth'], ['Moose', 'Horn'], ['Lynx', 'Shadow'],
  ['Panda', 'Bamboo'], ['Tiger', 'Fang'], ['Seal', 'Ice'], ['Falcon', 'Gale'], ['Bison', 'Stone'],
  ['Cobra', 'Venom'], ['Mole', 'Burrow'], ['Crane', 'Mist'], ['Jaguar', 'Night'], ['Goat', 'Cliff'],
  ['Raccoon', 'Trick'], ['Buffalo', 'Charge'], ['Eagle', 'Storm'], ['Beaver', 'River'], ['Koala', 'Dream'],
  ['Ferret', 'Spark'], ['Toucan', 'Sun'], ['Camel', 'Dune'], ['Rhino', 'Iron'], ['Penguin', 'Frost']
].map(([name, type], i) => ({
  id: i + 1,
  name,
  type,
  maxHp: 38 + (i % 7) * 8,
  attack: 8 + (i % 6) * 3,
  speed: 7 + (i % 8) * 2,
  hue: (i * 37) % 360,
  shape: i % 5,
}));

const state = {
  mode: 'intro',
  keys: new Set(),
  map: [],
  player: { x: 3 * TILE, y: 3 * TILE, hp: 120, maxHp: 120, speed: 2.6 },
  stepsInGrass: 0,
  encounter: null,
  team: [],
  uniqueCaught: new Set(),
  messageQueue: [],
  lastTime: 0,
  musicStarted: false,
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickAnimal() {
  const base = animals[randomInt(0, animals.length - 1)];
  return {
    ...base,
    level: randomInt(1, 9),
    hp: base.maxHp,
  };
}

function initMap() {
  state.map = Array.from({ length: MAP_H }, (_, y) =>
    Array.from({ length: MAP_W }, (_, x) => {
      const edge = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
      if (edge) return 'rock';
      const r = Math.random();
      if (r < 0.2) return 'grass';
      if (r < 0.23) return 'tree';
      return 'plain';
    })
  );
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 8; x += 1) state.map[y][x] = 'plain';
  }
}

const audio = {
  ctx: null,
  master: null,
};

function ensureAudio() {
  if (audio.ctx) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.08;
  audio.master.connect(audio.ctx.destination);
}

function tone(freq, dur, type = 'triangle', gain = 0.12) {
  ensureAudio();
  const t0 = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(audio.master);
  osc.start(t0);
  osc.stop(t0 + dur);
}

function noise(dur = 0.1, gain = 0.08) {
  ensureAudio();
  const length = Math.floor(audio.ctx.sampleRate * dur);
  const buffer = audio.ctx.createBuffer(1, length, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = audio.ctx.createBufferSource();
  const g = audio.ctx.createGain();
  source.buffer = buffer;
  g.gain.value = gain;
  source.connect(g);
  g.connect(audio.master);
  source.start();
}

function startMusic() {
  if (state.musicStarted) return;
  ensureAudio();
  state.musicStarted = true;
  const notes = [220, 247, 262, 294, 330, 294, 262, 247];
  let i = 0;
  setInterval(() => {
    if (state.mode === 'intro') return;
    tone(notes[i % notes.length], 0.22, 'sine', 0.05);
    if (i % 4 === 0) tone(notes[(i + 2) % notes.length] / 2, 0.2, 'triangle', 0.03);
    i += 1;
  }, 280);
}

function log(msg) {
  const time = new Date().toLocaleTimeString();
  state.messageQueue.unshift(`[${time}] ${msg}`);
  state.messageQueue = state.messageQueue.slice(0, 100);
  logEl.innerHTML = state.messageQueue.map((m) => `<div>${m}</div>`).join('');
}

function refreshTeam() {
  teamEl.innerHTML = state.team
    .map((a) => `<li>${a.name} Lv${a.level} (${a.hp}/${a.maxHp})</li>`)
    .join('');
}

function clampPlayer() {
  state.player.x = Math.max(TILE, Math.min(state.player.x, (MAP_W - 2) * TILE));
  state.player.y = Math.max(TILE, Math.min(state.player.y, (MAP_H - 2) * TILE));
}

function tileAtPixel(x, y) {
  return state.map[Math.floor(y / TILE)][Math.floor(x / TILE)];
}

function isBlocked(x, y) {
  const tile = tileAtPixel(x, y);
  return tile === 'rock' || tile === 'tree';
}

function updateOverworld() {
  const p = state.player;
  let dx = 0;
  let dy = 0;
  if (state.keys.has('ArrowLeft') || state.keys.has('a')) dx -= p.speed;
  if (state.keys.has('ArrowRight') || state.keys.has('d')) dx += p.speed;
  if (state.keys.has('ArrowUp') || state.keys.has('w')) dy -= p.speed;
  if (state.keys.has('ArrowDown') || state.keys.has('s')) dy += p.speed;

  if (dx || dy) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!isBlocked(nx, p.y)) p.x = nx;
    if (!isBlocked(p.x, ny)) p.y = ny;
    clampPlayer();

    const under = tileAtPixel(p.x, p.y);
    if (under === 'grass') {
      state.stepsInGrass += Math.abs(dx) + Math.abs(dy);
      if (state.stepsInGrass > 46 && Math.random() < 0.07) {
        state.stepsInGrass = 0;
        beginEncounter();
      }
    }
  }
}

function beginEncounter() {
  const foe = pickAnimal();
  state.encounter = foe;
  state.mode = 'battle';
  tone(280, 0.15, 'square', 0.1);
  tone(440, 0.18, 'square', 0.08);
  log(`A wild ${foe.name} appeared!`);
}

function getLead() {
  if (state.team.length === 0) {
    const starter = { ...animals[0], level: 5, hp: animals[0].maxHp };
    state.team.push(starter);
    state.uniqueCaught.add(starter.name);
    refreshTeam();
    log(`You received starter ${starter.name}!`);
  }
  return state.team[0];
}

function attackTurn() {
  const hero = getLead();
  const foe = state.encounter;
  if (!foe || hero.hp <= 0) return;

  const heroHit = randomInt(hero.attack - 2, hero.attack + 6);
  foe.hp -= Math.max(4, heroHit);
  tone(660, 0.09, 'square', 0.1);
  noise(0.05, 0.05);
  log(`${hero.name} strikes ${foe.name} for ${Math.max(4, heroHit)} damage.`);

  if (foe.hp <= 0) {
    log(`${foe.name} was calmed and escaped into the wild.`);
    endEncounter();
    return;
  }

  const foeHit = randomInt(foe.attack - 1, foe.attack + 5);
  hero.hp = Math.max(0, hero.hp - Math.max(3, foeHit));
  tone(180, 0.09, 'sawtooth', 0.08);
  log(`${foe.name} counters for ${Math.max(3, foeHit)} damage.`);

  if (hero.hp <= 0) {
    hero.hp = Math.ceil(hero.maxHp * 0.6);
    state.player.hp = Math.max(1, state.player.hp - 15);
    log(`${hero.name} retreated to recover. You stagger back with less stamina.`);
    endEncounter();
  }
  refreshTeam();
}

function captureTurn() {
  const hero = getLead();
  const foe = state.encounter;
  if (!foe || !hero) return;

  const hpRatio = foe.hp / foe.maxHp;
  const chance = 0.25 + (1 - hpRatio) * 0.55;
  tone(520, 0.08, 'triangle', 0.1);
  tone(720, 0.1, 'triangle', 0.07);

  if (Math.random() < chance) {
    const caught = { ...foe };
    state.team.push(caught);
    state.uniqueCaught.add(caught.name);
    log(`Captured ${caught.name}! Unique animals: ${state.uniqueCaught.size}/10`);
    refreshTeam();
    endEncounter();
    checkWin();
    return;
  }

  log(`Capture failed! ${foe.name} broke free.`);
  const foeHit = randomInt(foe.attack - 2, foe.attack + 5);
  hero.hp = Math.max(0, hero.hp - Math.max(2, foeHit));
  noise(0.08, 0.06);
  refreshTeam();
  if (hero.hp <= 0) {
    hero.hp = Math.ceil(hero.maxHp * 0.6);
    log(`${hero.name} had to fall back!`);
    endEncounter();
  }
}

function runTurn() {
  if (!state.encounter) return;
  const flee = Math.random() < 0.75;
  if (flee) {
    tone(760, 0.07, 'sine', 0.07);
    log('You got away safely.');
    endEncounter();
    return;
  }
  tone(140, 0.1, 'square', 0.08);
  log('Could not escape!');
}

function endEncounter() {
  state.encounter = null;
  state.mode = 'overworld';
}

function checkWin() {
  if (state.uniqueCaught.size >= 10) {
    state.mode = 'won';
    overlay.classList.remove('hidden');
    overlay.querySelector('h1').textContent = 'You Win!';
    overlay.querySelector('p').textContent = 'You built a diverse team of animals. Continue playing or refresh to restart.';
    log('Victory! Safari challenge complete.');
  }
}

function drawMap() {
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const tile = state.map[y][x];
      if (tile === 'plain') ctx.fillStyle = '#3b9b57';
      if (tile === 'grass') ctx.fillStyle = '#2f7d43';
      if (tile === 'rock') ctx.fillStyle = '#475569';
      if (tile === 'tree') ctx.fillStyle = '#14532d';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (tile === 'grass') {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(x * TILE + 10, y * TILE + 5, 3, 18);
        ctx.fillRect(x * TILE + 16, y * TILE + 7, 3, 16);
      }
      if (tile === 'tree') {
        ctx.fillStyle = '#166534';
        ctx.beginPath();
        ctx.arc(x * TILE + 16, y * TILE + 12, 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawAnimal(animal, x, y, scale = 1.2, alpha = 1) {
  const size = 34 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = `hsl(${animal.hue} 65% 55%)`;
  ctx.strokeStyle = '#0b1020';
  ctx.lineWidth = 2;

  switch (animal.shape) {
    case 0:
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.6, size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1:
      ctx.fillRect(-size * 0.45, -size * 0.35, size * 0.9, size * 0.7);
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(-size * 0.55, size * 0.3);
      ctx.lineTo(0, -size * 0.55);
      ctx.lineTo(size * 0.55, size * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 3:
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-size * 0.5, -size * 0.12, size, size * 0.24);
      break;
    default:
      ctx.fillRect(-size * 0.5, -size * 0.35, size, size * 0.7);
  }

  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-size * 0.18, -size * 0.06, 3, 0, Math.PI * 2);
  ctx.arc(size * 0.18, -size * 0.06, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(-size * 0.18, -size * 0.06, 1.5, 0, Math.PI * 2);
  ctx.arc(size * 0.18, -size * 0.06, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const p = state.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-10, -14, 20, 28);
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(-10, -20, 20, 8);
  ctx.fillStyle = '#111827';
  ctx.fillRect(-6, -2, 12, 16);
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(2,6,23,0.78)';
  ctx.fillRect(10, 10, 280, 84);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Explorer HP: ${state.player.hp}/${state.player.maxHp}`, 20, 34);
  ctx.fillText(`Captured (unique): ${state.uniqueCaught.size}`, 20, 58);
  ctx.fillText('Goal: 10 unique', 20, 82);
}

function drawBattle() {
  const hero = getLead();
  const foe = state.encounter;
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(0, canvas.height * 0.58, canvas.width, canvas.height * 0.42);

  drawAnimal(hero, 220, 340, 1.6);
  drawAnimal(foe, 710, 210, 1.45);

  ctx.fillStyle = '#020617cc';
  ctx.fillRect(22, 24, 320, 96);
  ctx.fillRect(620, 24, 320, 96);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '18px sans-serif';
  ctx.fillText(`${hero.name} Lv${hero.level}`, 32, 56);
  ctx.fillText(`HP ${hero.hp}/${hero.maxHp}`, 32, 86);
  ctx.fillText(`${foe.name} Lv${foe.level}`, 630, 56);
  ctx.fillText(`HP ${Math.max(0, foe.hp)}/${foe.maxHp}`, 630, 86);

  ctx.fillStyle = '#111827dd';
  ctx.fillRect(0, canvas.height - 120, canvas.width, 120);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '22px sans-serif';
  ctx.fillText('1) Attack    2) Capture    3) Run', 30, canvas.height - 70);
  ctx.font = '18px sans-serif';
  ctx.fillText(`Wild ${foe.name} (${foe.type}) is watching you...`, 30, canvas.height - 35);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.mode === 'battle') {
    drawBattle();
    return;
  }
  drawMap();
  drawPlayer();
  drawHUD();
}

function gameLoop(ts) {
  const dt = ts - state.lastTime;
  state.lastTime = ts;
  if (state.mode === 'overworld') updateOverworld(dt);
  render();
  requestAnimationFrame(gameLoop);
}

document.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(e.key)) {
    state.keys.add(e.key);
    e.preventDefault();
  }

  if (state.mode === 'battle') {
    if (e.key === '1') attackTurn();
    if (e.key === '2') captureTurn();
    if (e.key === '3') runTurn();
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  state.keys.delete(e.key);
});

startButton.addEventListener('click', () => {
  overlay.classList.add('hidden');
  startMusic();
  state.mode = 'overworld';
  getLead();
  log('Adventure started. Search the grass for wild animals!');
});

initMap();
overlay.classList.remove('hidden');
requestAnimationFrame(gameLoop);
