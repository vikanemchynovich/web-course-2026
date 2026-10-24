'use strict';

/* =========================================================
   Настройки
   ========================================================= */

const GRID_SIZE = 20;          // поле 20×20 клеток
const CELL_SIZE = 24;          // клетка 24px → canvas 480×480
const BOARD_SIZE = GRID_SIZE * CELL_SIZE;
const MOVE_INTERVAL = 140;     // змейка сдвигается на клетку раз в 140 мс — на любом мониторе
const MAX_QUEUED_TURNS = 2;    // сколько нажатий можно «запомнить» между шагами

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const KEY_TO_DIRECTION = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

const COLORS = {
  ink: '#1A0B2E',
  cellA: '#211037',
  cellB: '#1D0D32',
  dot: 'rgba(255, 255, 255, 0.07)',
  head: '#FFE600',
  bodyFrom: [183, 255, 92],    // лаймовый у головы
  bodyTo: [61, 245, 224],      // бирюзовый к хвосту
  apple: '#FF2E93',
  leaf: '#B7FF5C',
  dead: '#8A8197',
};

/* =========================================================
   Состояние игры — отдельно от отрисовки
   ========================================================= */

/** @type {{
 *   snake: {x:number, y:number}[], direction: string, directionQueue: string[],
 *   apple: {x:number, y:number} | null, score: number, best: number,
 *   status: 'ready' | 'running' | 'paused' | 'over' | 'won', isGameOver: boolean
 * }} */
const state = {
  snake: [],
  direction: 'right',
  directionQueue: [],
  apple: null,
  score: 0,
  best: 0,
  status: 'ready',
  isGameOver: false,
};

let lastMoveTime = null;   // время последнего шага змейки (из requestAnimationFrame)
let animationFrameId = null;

/* =========================================================
   Логика: только меняет state, ничего не рисует
   ========================================================= */

/** Начальная змейка из 3 сегментов в середине поля, движется вправо */
function createInitialSnake() {
  const y = Math.floor(GRID_SIZE / 2);
  const headX = Math.floor(GRID_SIZE / 2);
  return [
    { x: headX, y },
    { x: headX - 1, y },
    { x: headX - 2, y },
  ];
}

function resetGame() {
  state.snake = createInitialSnake();
  state.direction = 'right';
  state.directionQueue = [];
  state.score = 0;
  state.status = 'ready';
  state.isGameOver = false;
  state.apple = spawnApple(state.snake);
  lastMoveTime = null;
}

function isSameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

/** Случайная свободная клетка (не на теле змейки). Если свободных нет — null. */
function spawnApple(snake) {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  const freeCells = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!occupied.has(`${x},${y}`)) freeCells.push({ x, y });
    }
  }
  if (freeCells.length === 0) return null;
  return freeCells[Math.floor(Math.random() * freeCells.length)];
}

function isOppositeDirection(a, b) {
  return OPPOSITE[a] === b;
}

/**
 * Запоминает поворот. Разворот на 180° игнорируется: сравниваем с последним
 * запланированным направлением, поэтому быстрое «вверх → влево» между двумя
 * шагами тоже работает и не приводит к врезанию в шею.
 */
function queueDirection(newDirection) {
  const lastPlanned = state.directionQueue.length > 0
    ? state.directionQueue[state.directionQueue.length - 1]
    : state.direction;

  if (newDirection === lastPlanned || isOppositeDirection(newDirection, lastPlanned)) return;
  if (state.directionQueue.length >= MAX_QUEUED_TURNS) return;
  state.directionQueue.push(newDirection);
}

function applyQueuedDirection() {
  if (state.directionQueue.length > 0) {
    state.direction = state.directionQueue.shift();
  }
}

function getNextHead() {
  const head = state.snake[0];
  const step = DIRECTIONS[state.direction];
  return { x: head.x + step.x, y: head.y + step.y };
}

function isOutsideBoard(cell) {
  return cell.x < 0 || cell.y < 0 || cell.x >= GRID_SIZE || cell.y >= GRID_SIZE;
}

/**
 * Столкновение со стеной или с телом. Если змейка не ест яблоко, хвост на этом шаге
 * уйдёт со своей клетки — значит, «наступить» на текущий кончик хвоста можно.
 */
function checkCollision(nextHead, willGrow) {
  if (isOutsideBoard(nextHead)) return true;
  const body = willGrow ? state.snake : state.snake.slice(0, -1);
  return body.some((segment) => isSameCell(segment, nextHead));
}

/** Сдвиг на одну клетку: голова вперёд, хвост убираем (или оставляем, если съели яблоко) */
function moveSnake(nextHead, willGrow) {
  state.snake.unshift(nextHead);
  if (!willGrow) {
    state.snake.pop();
  }
}

function eatApple() {
  state.score++;
  state.best = Math.max(state.best, state.score);
  state.apple = spawnApple(state.snake);
  if (state.apple === null) {
    endGame('won');   // змейка заняла всё поле
  }
}

function endGame(status = 'over') {
  state.status = status;
  state.isGameOver = true;
  state.best = Math.max(state.best, state.score);
}

/** Один шаг игры. Вызывается из игрового цикла раз в MOVE_INTERVAL мс. */
function update() {
  if (state.status !== 'running') return;

  applyQueuedDirection();
  const nextHead = getNextHead();
  const willGrow = state.apple !== null && isSameCell(nextHead, state.apple);

  if (checkCollision(nextHead, willGrow)) {
    endGame('over');
    return;
  }

  moveSnake(nextHead, willGrow);
  if (willGrow) {
    eatApple();
  }
}

/* =========================================================
   Управление игрой
   ========================================================= */

function startGame() {
  if (state.isGameOver) resetGame();
  state.status = 'running';
  lastMoveTime = null;
  startLoop();
  renderInterface();
}

function restartGame() {
  resetGame();
  startGame();
}

function togglePause() {
  if (state.status === 'running') {
    state.status = 'paused';
    stopLoop();
    draw(performance.now());
  } else if (state.status === 'paused') {
    startGame();
    return;
  }
  renderInterface();
}

function handleDirectionInput(direction) {
  if (state.status === 'ready' || state.status === 'paused') {
    queueDirection(direction);
    startGame();
  } else if (state.status === 'running') {
    queueDirection(direction);
  }
}

/* =========================================================
   Игровой цикл: requestAnimationFrame + расчёт прошедшего времени.
   Кадры могут идти 30, 60 или 144 раза в секунду, а змейка всё равно
   шагает строго раз в MOVE_INTERVAL мс.
   ========================================================= */

function gameLoop(currentTime) {
  if (lastMoveTime === null) {
    lastMoveTime = currentTime;
  }

  // После долгой паузы кадров (вкладка была в фоне) не «догоняем» сотни шагов разом
  if (currentTime - lastMoveTime > MOVE_INTERVAL * 5) {
    lastMoveTime = currentTime - MOVE_INTERVAL;
  }

  // Столько шагов, сколько интервалов прошло: на медленном устройстве может быть 2 шага за кадр, на быстром — 0
  while (state.status === 'running' && currentTime - lastMoveTime >= MOVE_INTERVAL) {
    update();
    lastMoveTime += MOVE_INTERVAL;
  }

  draw(currentTime);
  renderScoreIfChanged();

  if (state.status === 'running') {
    animationFrameId = requestAnimationFrame(gameLoop);
  } else {
    animationFrameId = null;
    renderInterface();   // игра закончилась внутри update() — показываем окно «Игра окончена»
  }
}

function startLoop() {
  if (animationFrameId !== null) return;   // цикл уже идёт — второй не запускаем
  animationFrameId = requestAnimationFrame(gameLoop);
}

function stopLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

/* =========================================================
   Отрисовка: только читает state и рисует, ничего не меняет
   ========================================================= */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

/** Чёткая картинка на экранах высокой плотности: логический размер 480×480, буфер — ×devicePixelRatio */
function setupCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = BOARD_SIZE * ratio;
  canvas.height = BOARD_SIZE * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawBoard() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.cellA : COLORS.cellB;
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
  ctx.fillStyle = COLORS.dot;
  for (let y = 1; y < GRID_SIZE; y++) {
    for (let x = 1; x < GRID_SIZE; x++) {
      ctx.beginPath();
      ctx.arc(x * CELL_SIZE, y * CELL_SIZE, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/** Цвет сегмента: от лаймового у головы к бирюзовому у хвоста */
function getSegmentColor(index, length) {
  if (state.isGameOver && state.status === 'over') return COLORS.dead;
  const t = length > 1 ? index / (length - 1) : 0;
  const [r, g, b] = COLORS.bodyFrom.map((from, i) => Math.round(from + (COLORS.bodyTo[i] - from) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

const BODY_INSET = 3;   // отступ сегмента тела от края клетки
const SHADOW_OFFSET = 3;

/**
 * Часть тела: скруглённый квадрат в своей клетке и «перемычка» к соседнему сегменту,
 * чтобы змейка выглядела сплошной, а не пунктиром. offset — сдвиг для жёсткой тени.
 */
function drawBodyPart(cell, towardCell, offset) {
  const size = CELL_SIZE - BODY_INSET * 2;
  roundedRect(cell.x * CELL_SIZE + BODY_INSET + offset, cell.y * CELL_SIZE + BODY_INSET + offset, size, size, 7);
  ctx.fill();

  if (!towardCell) return;
  const dx = towardCell.x - cell.x;
  const dy = towardCell.y - cell.y;
  const bridgeX = Math.min(cell.x, towardCell.x) * CELL_SIZE + CELL_SIZE / 2 + offset - (dx === 0 ? size / 2 : 0);
  const bridgeY = Math.min(cell.y, towardCell.y) * CELL_SIZE + CELL_SIZE / 2 + offset - (dy === 0 ? size / 2 : 0);
  ctx.fillRect(bridgeX, bridgeY, dx !== 0 ? CELL_SIZE : size, dy !== 0 ? CELL_SIZE : size);
}

/** Голова — «наклейка» с обводкой и жёсткой тенью */
function drawHead(head, fill) {
  const inset = 1.5;
  const size = CELL_SIZE - inset * 2;
  const x = head.x * CELL_SIZE + inset;
  const y = head.y * CELL_SIZE + inset;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  roundedRect(x + SHADOW_OFFSET, y + SHADOW_OFFSET, size, size, 8);
  ctx.fill();

  roundedRect(x, y, size, size, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();
}

function drawEyes(head) {
  const step = DIRECTIONS[state.direction];
  const centerX = head.x * CELL_SIZE + CELL_SIZE / 2;
  const centerY = head.y * CELL_SIZE + CELL_SIZE / 2;
  // Глаза сдвинуты вперёд по направлению движения и разнесены поперёк него
  const forward = 3.5;
  const side = 4.5;
  const eyes = [
    { x: centerX + step.x * forward - step.y * side, y: centerY + step.y * forward + step.x * side },
    { x: centerX + step.x * forward + step.y * side, y: centerY + step.y * forward - step.x * side },
  ];

  eyes.forEach((eye) => {
    if (state.status === 'over') {
      // Крестики вместо глаз после столкновения
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(eye.x - 2.5, eye.y - 2.5);
      ctx.lineTo(eye.x + 2.5, eye.y + 2.5);
      ctx.moveTo(eye.x + 2.5, eye.y - 2.5);
      ctx.lineTo(eye.x - 2.5, eye.y + 2.5);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(eye.x + step.x * 1.2, eye.y + step.y * 1.2, 1.7, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSnake() {
  const { snake } = state;

  // 1) Общая жёсткая тень всего тела
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  for (let i = snake.length - 1; i >= 1; i--) {
    drawBodyPart(snake[i], snake[i - 1], SHADOW_OFFSET);
  }

  // 2) Тело с хвоста к голове: цвет плавно меняется от бирюзового к лаймовому
  for (let i = snake.length - 1; i >= 1; i--) {
    ctx.fillStyle = getSegmentColor(i, snake.length);
    drawBodyPart(snake[i], snake[i - 1], 0);
  }

  // 3) Голова поверх тела
  const head = snake[0];
  drawHead(head, state.status === 'over' ? '#FF6B6B' : COLORS.head);
  drawEyes(head);
}

/** Яблоко слегка «дышит» — масштаб зависит только от времени кадра, состояние не меняется */
function drawApple(time) {
  if (!state.apple) return;
  const pulse = state.status === 'running' ? 1 + Math.sin(time / 180) * 0.06 : 1;
  const centerX = state.apple.x * CELL_SIZE + CELL_SIZE / 2;
  const centerY = state.apple.y * CELL_SIZE + CELL_SIZE / 2 + 1;
  const radius = (CELL_SIZE / 2 - 1.5) * pulse;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.arc(centerX + 2, centerY + 2, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.apple;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  // Блик
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  ctx.ellipse(centerX - radius * 0.35, centerY - radius * 0.35, radius * 0.22, radius * 0.14, -0.7, 0, Math.PI * 2);
  ctx.fill();

  // Листик
  ctx.fillStyle = COLORS.leaf;
  ctx.beginPath();
  ctx.ellipse(centerX + 3, centerY - radius - 1, 4.5, 2.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function draw(time = 0) {
  ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
  drawBoard();
  drawApple(time);
  drawSnake();
}

/* =========================================================
   HTML-интерфейс: счёт, кнопка паузы и окно поверх поля
   ========================================================= */

const ui = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  pause: document.getElementById('pause'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  overlayButton: document.getElementById('overlay-button'),
};

let lastShownScore = 0;

function getOverlayContent() {
  switch (state.status) {
    case 'ready':
      return { title: 'Готовы?', text: 'Управление — стрелками или кнопками под полем.', button: 'Начать игру' };
    case 'paused':
      return { title: 'Пауза', text: `Счёт: ${state.score}`, button: 'Продолжить' };
    case 'over':
      return { title: 'Игра окончена', text: `Ваш счёт: ${state.score}`, button: 'Начать заново' };
    case 'won':
      return { title: 'Победа!', text: `Змейка заняла всё поле. Счёт: ${state.score}`, button: 'Начать заново' };
    default:
      return null;
  }
}

function renderInterface() {
  lastShownScore = state.score;
  ui.score.textContent = String(state.score);
  ui.best.textContent = String(state.best);

  ui.pause.textContent = state.status === 'paused' ? 'Продолжить' : 'Пауза';
  ui.pause.disabled = state.status !== 'running' && state.status !== 'paused';

  const content = getOverlayContent();
  const wasHidden = ui.overlay.hidden;
  ui.overlay.hidden = content === null;
  ui.overlay.classList.toggle('overlay--over', state.status === 'over');
  ui.overlay.classList.toggle('overlay--won', state.status === 'won');

  if (content) {
    ui.overlayTitle.textContent = content.title;
    ui.overlayText.textContent = content.text;
    ui.overlayButton.textContent = content.button;
    if (wasHidden && state.isGameOver) {
      ui.overlayButton.focus();
    }
  }
}

/** Счёт в HTML меняется по ходу игры; съеденное яблоко отмечаем лёгким «подпрыгиванием» плашки */
function renderScoreIfChanged() {
  if (state.score === lastShownScore) return;
  lastShownScore = state.score;
  ui.score.textContent = String(state.score);
  ui.best.textContent = String(state.best);
  ui.score.parentElement.classList.remove('is-bumped');
  void ui.score.parentElement.offsetWidth;
  ui.score.parentElement.classList.add('is-bumped');
}

/* =========================================================
   События
   ========================================================= */

function handleKeyDown(event) {
  const direction = KEY_TO_DIRECTION[event.code];

  if (direction) {
    event.preventDefault();   // стрелки не прокручивают страницу
    if (!state.isGameOver) handleDirectionInput(direction);
    return;
  }

  if (event.code === 'Space' || event.code === 'KeyP') {
    event.preventDefault();
    if (state.isGameOver) restartGame();
    else if (state.status === 'ready') startGame();
    else togglePause();
    return;
  }

  if (event.code === 'Enter' && state.isGameOver) {
    event.preventDefault();
    restartGame();
  }
}

function handleOverlayButton() {
  if (state.isGameOver) restartGame();
  else startGame();
}

function handleDpadClick(event) {
  const button = event.target.closest('[data-direction]');
  if (!button || state.isGameOver) return;
  handleDirectionInput(button.dataset.direction);
}

document.addEventListener('keydown', handleKeyDown);
ui.overlayButton.addEventListener('click', handleOverlayButton);
ui.pause.addEventListener('click', togglePause);
document.querySelector('.dpad').addEventListener('click', handleDpadClick);

/* =========================================================
   Старт
   ========================================================= */

function init() {
  setupCanvas();
  resetGame();
  draw(0);
  renderInterface();
}

init();
