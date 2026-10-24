'use strict';

/* =========================================================
   Состояние игры
   Всё, что видно на экране, вычисляется из этого объекта
   функцией render(). Обработчики событий только меняют state.
   ========================================================= */

const DIGITS_COUNT = 4;

const state = {
  secret: '',          // загаданное число, строкой: '0372'
  attempts: [],        // { id, guess, bulls, cows }
  isWon: false,
  isPeeking: false,    // показать загаданное число (удобно для проверки подсчёта)
  message: null,       // { type: 'error' | 'win', text }
};

let nextAttemptId = 1;
let lastAttemptId = null;   // только новая строка истории проигрывает анимацию

/* =========================================================
   Логика игры: три отдельные чистые функции
   ========================================================= */

/**
 * Генерирует строку из `length` неповторяющихся цифр.
 * Перемешиваем все 10 цифр (тасование Фишера — Йетса) и берём первые `length`.
 */
function generateSecret(length = DIGITS_COUNT) {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, length).join('');
}

/**
 * Проверяет ввод игрока.
 * Возвращает { ok: true, value } или { ok: false, error } с понятным текстом ошибки.
 */
function validateGuess(rawValue) {
  const value = rawValue.trim();

  if (value === '') {
    return { ok: false, error: `Введите ${DIGITS_COUNT} цифры.` };
  }
  if (!/^[0-9]+$/.test(value)) {
    return { ok: false, error: 'Можно вводить только цифры: без букв, пробелов и других знаков.' };
  }
  if (value.length !== DIGITS_COUNT) {
    return {
      ok: false,
      error: `Нужно ровно ${DIGITS_COUNT} цифры, а введено ${value.length} ${plural(value.length, ['цифра', 'цифры', 'цифр'])}.`,
    };
  }

  const repeated = [...value].find((digit, index) => value.indexOf(digit) !== index);
  if (repeated !== undefined) {
    return { ok: false, error: `Цифры не должны повторяться, а «${repeated}» встречается больше одного раза.` };
  }

  return { ok: true, value };
}

/**
 * Считает быков (цифра на своём месте) и коров (цифра есть, но на другом месте).
 * Обе строки состоят из неповторяющихся цифр, поэтому каждая цифра попытки
 * даёт не больше одного быка или одной коровы.
 */
function countBullsAndCows(secret, guess) {
  let bulls = 0;
  let cows = 0;

  [...guess].forEach((digit, index) => {
    if (digit === secret[index]) {
      bulls++;
    } else if (secret.includes(digit)) {
      cows++;
    }
  });

  return { bulls, cows };
}

/* =========================================================
   Вспомогательные функции для текста
   ========================================================= */

/** Русское склонение: plural(2, ['бык', 'быка', 'быков']) → 'быка' */
function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** '1 бык, 2 коровы' */
function formatResult(bulls, cows) {
  return `${bulls} ${plural(bulls, ['бык', 'быка', 'быков'])}, ${cows} ${plural(cows, ['корова', 'коровы', 'коров'])}`;
}

/* =========================================================
   Действия: меняют state и вызывают render()
   ========================================================= */

function startNewGame() {
  state.secret = generateSecret();
  state.attempts = [];
  state.isWon = false;
  state.isPeeking = false;
  state.message = null;
  nextAttemptId = 1;
  lastAttemptId = null;
  clearConfetti();
  render();
}

function makeGuess(rawValue) {
  if (state.isWon) return;

  const validation = validateGuess(rawValue);
  if (!validation.ok) {
    state.message = { type: 'error', text: validation.error };
    render();
    return false;          // попытка не засчитана
  }

  const guess = validation.value;
  const { bulls, cows } = countBullsAndCows(state.secret, guess);
  const attempt = { id: nextAttemptId++, guess, bulls, cows };
  state.attempts.push(attempt);
  lastAttemptId = attempt.id;
  state.message = null;

  if (bulls === DIGITS_COUNT) {
    state.isWon = true;
    state.isPeeking = false;
    const n = state.attempts.length;
    state.message = { type: 'win', text: `Победа! Угадано за ${n} ${plural(n, ['попытку', 'попытки', 'попыток'])}` };
  }

  render();
  return true;
}

function togglePeek() {
  if (state.isWon) return;
  state.isPeeking = !state.isPeeking;
  render();
}

/* =========================================================
   Отрисовка
   ========================================================= */

const elements = {
  secret: document.getElementById('secret'),
  counter: document.getElementById('counter'),
  newGame: document.getElementById('new-game'),
  peek: document.getElementById('peek'),
  form: document.getElementById('guess-form'),
  input: document.getElementById('guess-input'),
  check: document.getElementById('check'),
  message: document.getElementById('message'),
  history: document.getElementById('history'),
  historyEmpty: document.getElementById('history-empty'),
  confetti: document.getElementById('confetti'),
};

function createDigitTile(digit, extraClass) {
  const tile = document.createElement('span');
  tile.className = `tile ${extraClass}`;
  tile.textContent = digit;
  return tile;
}

/** Четыре «колышка»: закрашенные — быки, бирюзовые — коровы, пустые — мимо. Порядок не выдаёт позиции цифр. */
function createPegs(bulls, cows) {
  const pegs = document.createElement('span');
  pegs.className = 'pegs';
  pegs.setAttribute('aria-hidden', 'true');

  const kinds = Array.from({ length: DIGITS_COUNT }, (_, i) =>
    i < bulls ? 'bull' : i < bulls + cows ? 'cow' : 'miss'
  );
  kinds.forEach((kind) => {
    const peg = document.createElement('span');
    peg.className = `peg peg--${kind}`;
    pegs.append(peg);
  });
  return pegs;
}

/** Строка истории: «#3 · 1234 → 1 бык, 2 коровы» + колышки */
function createAttemptElement(attempt) {
  const item = document.createElement('li');
  item.className = 'attempt';
  if (attempt.bulls === DIGITS_COUNT) item.classList.add('attempt--win');
  if (attempt.id === lastAttemptId) item.classList.add('is-new');

  const number = document.createElement('span');
  number.className = 'attempt__number';
  number.textContent = `#${attempt.id}`;

  const digits = document.createElement('span');
  digits.className = 'attempt__digits';
  digits.append(...[...attempt.guess].map((digit) => createDigitTile(digit, 'tile--small')));

  const arrow = document.createElement('span');
  arrow.className = 'attempt__arrow';
  arrow.textContent = ' → ';

  const result = document.createElement('span');
  result.className = 'attempt__result';
  result.textContent = formatResult(attempt.bulls, attempt.cows);

  // Стрелка и результат — одним блоком, чтобы при переносе на узком экране они не разрывались
  const outcome = document.createElement('span');
  outcome.className = 'attempt__outcome';
  outcome.append(arrow, result);

  // Пробел между номером и числом нужен для текста строки («#3 1234 → …»); на раскладку flex он не влияет
  item.append(number, ' ', digits, outcome, createPegs(attempt.bulls, attempt.cows));
  return item;
}

function render() {
  const { secret, attempts, isWon, isPeeking, message } = state;
  const isRevealed = isWon || isPeeking;

  // Загаданное число: «????» до победы, цифры — после победы или при подсматривании
  elements.secret.replaceChildren(
    ...[...secret].map((digit) => createDigitTile(isRevealed ? digit : '?', isRevealed ? 'tile--open' : 'tile--hidden'))
  );
  elements.secret.classList.toggle('is-won', isWon);
  elements.secret.classList.toggle('is-peeking', isPeeking);
  elements.secret.setAttribute('aria-label', isRevealed ? `Загаданное число: ${secret}` : 'Загаданное число скрыто');

  // Счётчик
  elements.counter.textContent = `Попыток: ${attempts.length}`;

  // История: новые попытки сверху
  const rows = attempts.slice().reverse().map(createAttemptElement);
  elements.history.replaceChildren(...rows);
  elements.historyEmpty.hidden = attempts.length > 0;
  lastAttemptId = null;

  // Сообщение
  elements.message.textContent = message ? message.text : '';
  elements.message.className = message ? `message message--${message.type}` : 'message';

  // Блокировка ввода после победы
  elements.input.disabled = isWon;
  elements.input.placeholder = isWon ? '' : '1234';
  elements.check.disabled = isWon;
  elements.input.classList.toggle('is-invalid', message !== null && message.type === 'error');
  elements.form.classList.toggle('is-locked', isWon);

  elements.peek.textContent = isPeeking ? 'Спрятать число' : 'Подсмотреть';
  elements.peek.setAttribute('aria-pressed', String(isPeeking));
  elements.peek.disabled = isWon;
}

/* =========================================================
   Конфетти при победе (обычные DOM-элементы, без canvas)
   ========================================================= */

const CONFETTI_COLORS = ['#FFE600', '#3DF5E0', '#FF9AD5', '#B7FF5C', '#FF2E93', '#FF8A00'];
let confettiTimer = null;

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  clearConfetti();

  const pieces = Array.from({ length: 70 }, () => {
    const piece = document.createElement('span');
    piece.className = 'confetti__piece';
    piece.style.setProperty('--x', `${Math.random() * 100}vw`);
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 30}vw`);
    piece.style.setProperty('--delay', `${Math.random() * 0.6}s`);
    piece.style.setProperty('--duration', `${2.2 + Math.random() * 1.6}s`);
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    piece.style.setProperty('--color', CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
    if (Math.random() < 0.35) piece.classList.add('confetti__piece--round');
    return piece;
  });

  elements.confetti.append(...pieces);
  confettiTimer = setTimeout(clearConfetti, 4500);
}

function clearConfetti() {
  clearTimeout(confettiTimer);
  elements.confetti.replaceChildren();
}

/* =========================================================
   Обработчики событий
   ========================================================= */

function handleSubmit(event) {
  event.preventDefault();
  const accepted = makeGuess(elements.input.value);

  if (accepted) {
    elements.input.value = '';
  }

  if (state.isWon) {
    launchConfetti();
    elements.newGame.focus();
  } else {
    elements.input.focus();
    if (!accepted) shakeInput();
  }
}

function handleNewGame() {
  startNewGame();
  elements.input.value = '';
  elements.input.focus();
}

function handleInput() {
  // Начали исправлять ввод — убираем сообщение об ошибке
  if (state.message && state.message.type === 'error') {
    state.message = null;
    render();
  }
}

function shakeInput() {
  elements.input.classList.remove('shake');
  void elements.input.offsetWidth;   // перезапуск CSS-анимации
  elements.input.classList.add('shake');
}

elements.form.addEventListener('submit', handleSubmit);
elements.input.addEventListener('input', handleInput);
elements.newGame.addEventListener('click', handleNewGame);
elements.peek.addEventListener('click', togglePeek);

// Старт: число загадывается при загрузке страницы
startNewGame();
