'use strict';

/* =========================================================
   Данные
   Источник правды — массив tasks. Экран никогда не меняется
   напрямую: любое действие меняет массив и вызывает render().
   ========================================================= */

/** @type {{ id: number, text: string, completed: boolean }[]} */
let tasks = [];

let nextId = 1;               // уникальный id: счётчик, растущий на 1
let currentFilter = 'all';    // 'all' | 'active' | 'completed'
let justAddedId = null;       // id только что добавленной задачи — только она проигрывает анимацию появления

// Условие отбора для каждого фильтра — используется в tasks.filter(...)
const FILTERS = {
  all: () => true,
  active: (task) => !task.completed,
  completed: (task) => task.completed,
};

const EMPTY_TEXT = {
  all: 'Задач пока нет. Добавьте первую в поле выше.',
  active: 'Активных задач нет: всё сделано.',
  completed: 'Выполненных задач пока нет.',
};

/* =========================================================
   Элементы страницы
   ========================================================= */

const form = document.getElementById('add-form');
const input = document.getElementById('task-input');
const errorText = document.getElementById('add-error');
const counter = document.getElementById('counter');
const filterButtons = document.querySelectorAll('.filters__button');
const list = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');

/* =========================================================
   Изменение данных
   ========================================================= */

function addTask(text) {
  const task = { id: nextId++, text, completed: false };
  tasks.push(task);
  justAddedId = task.id;
  render();
}

function toggleTask(id) {
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, completed: !task.completed } : task
  );
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  render();
}

function setFilter(filter) {
  if (!(filter in FILTERS)) return;
  currentFilter = filter;
  render();
}

/* =========================================================
   Отрисовка
   ========================================================= */

/** Создаёт <li> для одной задачи. Текст вставляется через textContent, поэтому любой ввод безопасен. */
function createTaskElement(task) {
  const item = document.createElement('li');
  item.className = 'task';
  item.dataset.id = String(task.id);
  if (task.completed) {
    item.classList.add('completed');
  }
  if (task.id === justAddedId) {
    item.classList.add('is-new');
  }

  const label = document.createElement('label');
  label.className = 'task__label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task__checkbox';
  checkbox.checked = task.completed;

  const text = document.createElement('span');
  text.className = 'task__text';
  text.textContent = task.text;

  label.append(checkbox, text);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'task__delete';
  deleteButton.textContent = 'Удалить';
  deleteButton.setAttribute('aria-label', `Удалить задачу «${task.text}»`);

  item.append(label, deleteButton);
  return item;
}

/** Полностью перерисовывает экран по текущему состоянию массива tasks. */
function render() {
  // 1. Список: только задачи текущего фильтра. Остальные не удаляются из массива, просто не показываются
  const visibleTasks = tasks.filter(FILTERS[currentFilter]);
  list.replaceChildren(...visibleTasks.map(createTaskElement));
  justAddedId = null;

  // 2. Сообщение для пустого списка
  emptyState.hidden = visibleTasks.length > 0;
  emptyState.textContent = visibleTasks.length > 0 ? '' : EMPTY_TEXT[currentFilter];

  // 3. Счётчик
  const completedCount = tasks.filter((task) => task.completed).length;
  const activeCount = tasks.length - completedCount;
  counter.textContent = `Осталось: ${activeCount}, Выполнено: ${completedCount}`;

  // 4. Подсветка активной вкладки фильтра
  filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === currentFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

/* =========================================================
   Предупреждение о пустом вводе
   ========================================================= */

function showError(message) {
  errorText.textContent = message;
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');

  // Перезапускаем анимацию «встряхивания», даже если она уже проигрывалась
  input.classList.remove('shake');
  void input.offsetWidth;
  input.classList.add('shake');
}

function hideError() {
  errorText.textContent = '';
  input.classList.remove('is-invalid', 'shake');
  input.removeAttribute('aria-invalid');
}

/* =========================================================
   Обработчики событий
   ========================================================= */

// Добавление: клик по «Добавить» и Enter в поле
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();

  if (text === '') {
    showError('Введите текст задачи: пустую задачу добавить нельзя.');
    input.value = '';
    input.focus();
    return;
  }

  hideError();
  addTask(text);
  input.value = '';
  input.focus();
});

// Как только пользователь начал печатать, предупреждение убираем
input.addEventListener('input', () => {
  if (input.value.trim() !== '') {
    hideError();
  }
});

// Делегирование: один обработчик на весь список вместо обработчика на каждой задаче
list.addEventListener('change', (event) => {
  if (!event.target.matches('.task__checkbox')) return;
  const id = Number(event.target.closest('.task').dataset.id);
  toggleTask(id);
  // После перерисовки возвращаем фокус на тот же чекбокс, если задача всё ещё видна
  const checkbox = list.querySelector(`.task[data-id="${id}"] .task__checkbox`);
  (checkbox || input).focus();
});

list.addEventListener('click', (event) => {
  const button = event.target.closest('.task__delete');
  if (!button) return;
  const item = button.closest('.task');
  const neighbour = item.nextElementSibling || item.previousElementSibling;
  const neighbourId = neighbour ? neighbour.dataset.id : null;

  deleteTask(Number(item.dataset.id));

  // Фокус переходит к соседней задаче, а если задач не осталось — в поле ввода
  const nextButton = neighbourId && list.querySelector(`.task[data-id="${neighbourId}"] .task__delete`);
  (nextButton || input).focus();
});

filterButtons.forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});

// Первая отрисовка: пустой список, счётчик 0/0, активна вкладка «Все»
render();
