'use strict';

/* =========================================================
   Состояние игры
   Источник правды — объект state. Экран рисует render(),
   CSS-классы на странице только отражают state и никогда
   не используются, чтобы «угадать», что сейчас происходит.
   ========================================================= */

const PADS_COUNT = 4;

/** Фазы игры */
const PHASE = {
  IDLE: 'idle',         // ещё не начинали
  SHOWING: 'showing',   // компьютер показывает последовательность — клики игнорируются
  INPUT: 'input',       // ждём нажатий игрока
  PAUSE: 'pause',       // короткая пауза после верного раунда — клики игнорируются
  OVER: 'over',         // ошибка, игра окончена — кнопки заблокированы до «Старт»
};

const state = {
  phase: PHASE.IDLE,
  sequence: [],         // [2, 0, 3, ...] — номера секторов
  playerIndex: 0,       // какой по счёту шаг игрок вводит сейчас
  showIndex: -1,        // какой шаг сейчас показывает компьютер
  litPad: null,         // какой сектор сейчас подсвечен (класс .active)
  best: 0,
  gameNumber: 0,
  runId: 0,             // меняется при каждом старте: старый показ видит, что он устарел, и останавливается
  soundOn: true,
  message: 'Нажмите «Старт», чтобы начать.',
};

/* =========================================================
   Таймеры
   Все паузы — через wait(ms): это Promise с setTimeout внутри.
   Каждый таймер записан в pendingTimers, поэтому cancelAllTimers()
   может снять их все разом — при ошибке и при новом старте.
   ========================================================= */

const pendingTimers = new Map();   // id таймера → resolve его промиса

/** Ждёт ms миллисекунд. Резолвится true, если дождались, и false, если таймер отменили. */
function wait(ms) {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      resolve(true);
    }, ms);
    pendingTimers.set(id, resolve);
  });
}

/** Снимает все запланированные таймеры. Ожидающие их функции получают false и завершаются. */
function cancelAllTimers() {
  pendingTimers.forEach((resolve, id) => {
    clearTimeout(id);
    resolve(false);
  });
  pendingTimers.clear();
}

/* =========================================================
   Тайминги: с ростом уровня показ немного ускоряется
   ========================================================= */

function getLightDuration(level) {
  return Math.max(260, 520 - level * 18);   // сколько горит кнопка при показе, мс
}

function getGapDuration(level) {
  return Math.round(getLightDuration(level) * 0.5);   // пауза между вспышками, мс
}

const PLAYER_FLASH_MS = 220;
const BEFORE_SHOW_MS = 600;
const AFTER_ROUND_MS = 750;

/* =========================================================
   Логика игры
   ========================================================= */

function getRandomPad() {
  return Math.floor(Math.random() * PADS_COUNT);
}

/** «Старт»: если игра уже шла — останавливаем её полностью и начинаем заново */
function startGame() {
  cancelAllTimers();
  state.runId++;
  state.gameNumber++;
  state.sequence = [];
  state.playerIndex = 0;
  state.litPad = null;
  console.log(`%c▶ Игра ${state.gameNumber} началась`, 'font-weight: bold');
  nextRound();
}

/** Добавляет к последовательности один случайный шаг и показывает её целиком с начала */
function nextRound() {
  state.sequence.push(getRandomPad());
  state.playerIndex = 0;
  console.log(`  Раунд ${state.sequence.length}: ${state.sequence.join(' ')}`);
  playSequence();
}

/** Очередь показа: шаги по одному, между ними — паузы на setTimeout. Во время показа ввод заблокирован. */
async function playSequence() {
  const runId = state.runId;
  const level = state.sequence.length;
  const lightMs = getLightDuration(level);
  const gapMs = getGapDuration(level);

  state.phase = PHASE.SHOWING;
  state.message = 'Смотрите и запоминайте…';
  state.showIndex = -1;
  render();

  if (!(await wait(BEFORE_SHOW_MS)) || runId !== state.runId) return;

  for (let i = 0; i < state.sequence.length; i++) {
    const pad = state.sequence[i];
    state.showIndex = i;
    state.litPad = pad;
    playPadTone(pad, lightMs);
    render();

    if (!(await wait(lightMs)) || runId !== state.runId) return;

    state.litPad = null;
    render();

    if (!(await wait(gapMs)) || runId !== state.runId) return;
  }

  state.showIndex = -1;
  state.phase = PHASE.INPUT;
  state.message = `Ваш ход: повторите ${level} ${plural(level, ['шаг', 'шага', 'шагов'])}.`;
  render();
}

/** Нажатие игрока на сектор */
function handlePadPress(pad) {
  // Во время показа, паузы и после ошибки клики просто игнорируются
  if (state.phase !== PHASE.INPUT) return;

  const expected = state.sequence[state.playerIndex];
  flashPad(pad);

  if (pad !== expected) {
    gameOver(expected);
    return;
  }

  playPadTone(pad, PLAYER_FLASH_MS + 80);
  state.playerIndex++;

  if (state.playerIndex === state.sequence.length) {
    finishRound();
  } else {
    const left = state.sequence.length - state.playerIndex;
    state.message = `Верно! Осталось ${left} ${plural(left, ['шаг', 'шага', 'шагов'])}.`;
    render();
  }
}

/** Раунд пройден: короткая пауза — и следующий, на шаг длиннее */
async function finishRound() {
  const runId = state.runId;
  state.phase = PHASE.PAUSE;
  state.message = 'Отлично! Следующий раунд…';
  render();

  if (!(await wait(AFTER_ROUND_MS)) || runId !== state.runId) return;
  nextRound();
}

/** Ошибка: останавливаем все таймеры, показываем счёт и правильную кнопку */
async function gameOver(expectedPad) {
  cancelAllTimers();
  state.runId++;
  const runId = state.runId;

  const level = state.sequence.length;
  state.best = Math.max(state.best, level);
  state.phase = PHASE.OVER;
  state.litPad = null;
  state.message = `Вы дошли до уровня ${level}`;
  playErrorTone();
  render();

  console.log(`■ Игра ${state.gameNumber} окончена на уровне ${level}. Активных таймеров после остановки: ${pendingTimers.size}`);

  // Дважды мигаем правильной кнопкой — эти таймеры тоже учтены и снимутся при новом «Старт»
  for (let i = 0; i < 2; i++) {
    if (!(await wait(260)) || runId !== state.runId) return;
    state.litPad = expectedPad;
    render();
    if (!(await wait(260)) || runId !== state.runId) return;
    state.litPad = null;
    render();
  }
}

/** Короткая вспышка сектора при нажатии игрока */
async function flashPad(pad) {
  state.litPad = pad;
  render();
  await wait(PLAYER_FLASH_MS);
  // Гасим, только если за это время не загорелся другой сектор
  if (state.litPad === pad && state.phase !== PHASE.SHOWING) {
    state.litPad = null;
    render();
  }
}

/* =========================================================
   Звук (AudioContext). Тон планируется на аудиочасах браузера
   и ничего не блокирует: логика игры от него не зависит.
   ========================================================= */

const PAD_FREQUENCIES = [415.3, 310.0, 252.0, 209.0];   // частоты классического Simon
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

function playTone(frequency, durationMs, type = 'triangle', volume = 0.22) {
  if (!state.soundOn) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const end = now + durationMs / 1000;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(end + 0.05);
  } catch (error) {
    // Звук — необязательное украшение: если браузер не дал его воспроизвести, игра продолжается
  }
}

function playPadTone(pad, durationMs) {
  playTone(PAD_FREQUENCIES[pad], durationMs);
}

function playErrorTone() {
  playTone(110, 450, 'sawtooth', 0.18);
}

/* =========================================================
   Отрисовка
   ========================================================= */

const elements = {
  board: document.getElementById('board'),
  pads: document.querySelectorAll('.pad'),
  start: document.getElementById('start'),
  level: document.getElementById('level'),
  levelStat: document.getElementById('level-stat'),
  bestStat: document.getElementById('best-stat'),
  status: document.getElementById('status'),
  progress: document.getElementById('progress'),
  soundToggle: document.getElementById('sound-toggle'),
};

function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Точки под полем: сколько шагов в раунде и какой сейчас показывается или вводится */
function createProgressDot(_, index) {
  const dot = document.createElement('li');
  dot.className = 'progress__dot';
  const { phase, showIndex, playerIndex } = state;

  if (phase === PHASE.SHOWING && index === showIndex) dot.classList.add('is-current');
  if ((phase === PHASE.INPUT || phase === PHASE.PAUSE) && index < playerIndex) dot.classList.add('is-done');
  if (phase === PHASE.INPUT && index === playerIndex) dot.classList.add('is-current');
  if (phase === PHASE.OVER && index < playerIndex) dot.classList.add('is-done');
  if (phase === PHASE.OVER && index === playerIndex) dot.classList.add('is-failed');
  return dot;
}

function render() {
  const { phase, sequence, litPad, best, soundOn, message } = state;
  const level = sequence.length;
  const canPress = phase === PHASE.INPUT;

  elements.pads.forEach((pad, index) => {
    pad.classList.toggle('active', litPad === index);
    pad.setAttribute('aria-disabled', String(!canPress));
  });

  elements.board.classList.toggle('is-input', canPress);
  elements.board.classList.toggle('is-over', phase === PHASE.OVER);
  elements.board.classList.toggle('is-showing', phase === PHASE.SHOWING);

  elements.level.textContent = String(level);
  elements.levelStat.textContent = String(level);
  elements.bestStat.textContent = String(best);
  elements.start.textContent = phase === PHASE.IDLE || phase === PHASE.OVER ? 'Старт' : 'Заново';

  elements.status.textContent = message;
  elements.status.classList.toggle('status--over', phase === PHASE.OVER);

  elements.progress.replaceChildren(...Array.from({ length: level }, createProgressDot));

  elements.soundToggle.textContent = soundOn ? 'Звук: вкл' : 'Звук: выкл';
  elements.soundToggle.setAttribute('aria-pressed', String(soundOn));
}

/* =========================================================
   Обработчики событий
   ========================================================= */

elements.start.addEventListener('click', () => {
  getAudioContext();   // браузеры разрешают звук только после действия пользователя
  startGame();
});

// Делегирование: один обработчик на всё поле
elements.board.addEventListener('click', (event) => {
  const pad = event.target.closest('.pad');
  if (!pad) return;
  handlePadPress(Number(pad.dataset.pad));
});

elements.soundToggle.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  render();
});

render();
