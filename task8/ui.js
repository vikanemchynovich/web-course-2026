/* =========================================================
   ui.js — всё, что касается DOM: отрисовка сводки, списка,
   категорий, состояние формы, уведомления.
   Модуль ничего не знает о сервере и не хранит данные:
   всё, что нужно нарисовать, приходит аргументами.
   ========================================================= */

import { TYPES, sameId, formatMoney, formatSignedAmount, formatDate, todayISO } from './finance.js';

const el = {
  summaryIncome: document.getElementById('summary-income'),
  summaryExpense: document.getElementById('summary-expense'),
  summaryBalance: document.getElementById('summary-balance'),
  summaryBalanceCard: document.getElementById('summary-balance-card'),

  form: document.getElementById('transaction-form'),
  formTitle: document.getElementById('form-title'),
  editingNote: document.getElementById('editing-note'),
  typeInputs: document.querySelectorAll('input[name="type"]'),
  amount: document.getElementById('amount'),
  category: document.getElementById('category'),
  date: document.getElementById('date'),
  comment: document.getElementById('comment'),
  submit: document.getElementById('submit-button'),
  cancel: document.getElementById('cancel-button'),

  listCount: document.getElementById('list-count'),
  listStatus: document.getElementById('list-status'),
  table: document.getElementById('ops-table'),
  tableBody: document.getElementById('ops-body'),
  toasts: document.getElementById('toasts'),
};

export const elements = el;

/* ---------- Сводка ---------- */

export function renderSummary({ income, expense, balance }) {
  el.summaryIncome.textContent = formatMoney(income);
  el.summaryExpense.textContent = formatMoney(expense);
  el.summaryBalance.textContent = formatMoney(balance);
  el.summaryBalanceCard.classList.toggle('is-negative', balance < 0);
}

/* ---------- Категории ---------- */

/** Выпадающий список: только категории выбранного типа. Выбор сохраняется, если он подходит */
export function renderCategoryOptions(categories, type, selectedId = el.category.value) {
  const suitable = categories.filter((category) => category.type === type);

  if (suitable.length === 0) {
    const option = new Option(categories.length === 0 ? 'Категории не загружены' : 'Нет категорий для этого типа', '');
    el.category.replaceChildren(option);
    el.category.disabled = true;
    return;
  }

  el.category.disabled = false;
  el.category.replaceChildren(...suitable.map((category) => new Option(category.name, String(category.id))));
  const keep = suitable.some((category) => sameId(category.id, selectedId));
  el.category.value = keep ? String(selectedId) : String(suitable[0].id);
}

/* ---------- Список операций ---------- */

function createCell(label, className, content) {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  if (className) cell.className = className;
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content;
  return cell;
}

const ICONS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  delete: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
};

/** Кнопка в строке: иконка + подпись (на широком экране подпись видна только экранным дикторам) */
function createActionButton(action, text, ariaLabel, { extraClass = '', showText = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `row-button row-button--${action} ${extraClass}`.trim();
  button.dataset.action = action;
  button.title = ariaLabel;
  button.setAttribute('aria-label', ariaLabel);

  const svgNS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('row-button__icon');
  const pathElement = document.createElementNS(svgNS, 'path');
  pathElement.setAttribute('d', ICONS[action]);
  icon.append(pathElement);

  const label = document.createElement('span');
  label.className = showText ? 'row-button__text is-visible' : 'row-button__text';
  label.textContent = text;

  button.append(icon, label);
  return button;
}

function createRow(transaction, categoryName, { isEditing, isConfirmingDelete, isBusy }) {
  const row = document.createElement('tr');
  row.className = `ops__row ops__row--${transaction.type}`;
  row.dataset.id = String(transaction.id);
  row.classList.toggle('is-editing', isEditing);
  row.classList.toggle('is-busy', isBusy);

  const tag = document.createElement('span');
  tag.className = `tag tag--${transaction.type}`;
  tag.textContent = categoryName;

  const comment = transaction.comment ? transaction.comment : '—';
  const signed = formatSignedAmount(transaction);
  const description = `${categoryName}, ${formatDate(transaction.date)}, ${signed}`;

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const editButton = createActionButton('edit', isEditing ? 'Правится' : 'Изменить', `Изменить операцию: ${description}`);
  // В режиме подтверждения подпись «Удалить?» видна всегда — иначе непонятно, чего ждёт кнопка
  const deleteButton = createActionButton(
    'delete',
    isBusy ? 'Удаляю…' : isConfirmingDelete ? 'Удалить?' : 'Удалить',
    isConfirmingDelete ? `Подтвердите удаление: ${description}` : `Удалить операцию: ${description}`,
    { extraClass: isConfirmingDelete ? 'is-confirm' : '', showText: isConfirmingDelete || isBusy }
  );
  editButton.disabled = isBusy || isEditing;
  deleteButton.disabled = isBusy;
  actions.append(editButton, deleteButton);

  row.append(
    createCell('Дата', 'ops__date', formatDate(transaction.date)),
    createCell('Категория', 'ops__category', tag),
    createCell('Комментарий', transaction.comment ? 'ops__comment' : 'ops__comment is-empty', comment),
    createCell('Сумма', `ops__amount ops__amount--${transaction.type}`, signed),
    createCell('', 'ops__actions', actions)
  );
  return row;
}

/**
 * Рисует таблицу операций.
 * options: editingId — какая запись сейчас правится, confirmDeleteId — у какой ждём подтверждения удаления,
 * busyIds — записи, по которым идёт запрос.
 */
export function renderTransactions(transactions, categories, { editingId, confirmDeleteId, busyIds }) {
  const categoryNames = new Map(categories.map((category) => [String(category.id), category.name]));

  el.tableBody.replaceChildren(
    ...transactions.map((transaction) =>
      createRow(transaction, categoryNames.get(String(transaction.categoryId)) ?? 'Без категории', {
        isEditing: editingId !== null && sameId(editingId, transaction.id),
        isConfirmingDelete: confirmDeleteId !== null && sameId(confirmDeleteId, transaction.id),
        isBusy: busyIds.has(String(transaction.id)),
      })
    )
  );

  el.table.hidden = transactions.length === 0;
  el.listCount.textContent = transactions.length > 0 ? `Всего: ${transactions.length}` : '';
}

/** Состояние под заголовком списка: загрузка, ошибка с кнопкой повтора или пустой список */
export function renderListStatus({ isLoading, error, isEmpty }) {
  el.listStatus.replaceChildren();

  if (isLoading) {
    const loader = document.createElement('p');
    loader.className = 'status status--loading';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    loader.append(spinner, 'Загрузка…');
    el.listStatus.append(loader);
    return;
  }

  if (error) {
    const box = document.createElement('div');
    box.className = 'status status--error';
    box.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = error;
    const hint = document.createElement('p');
    hint.className = 'status__hint';
    hint.append('Запустите сервер в папке проекта: ');
    const code = document.createElement('code');
    code.textContent = 'json-server --watch db.json --port 3001';
    hint.append(code);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--small';
    retry.dataset.action = 'retry';
    retry.textContent = 'Попробовать снова';
    box.append(text, hint, retry);
    el.listStatus.append(box);
    return;
  }

  if (isEmpty) {
    const empty = document.createElement('p');
    empty.className = 'status status--empty';
    empty.textContent = 'Операций пока нет. Добавьте первую с помощью формы.';
    el.listStatus.append(empty);
  }
}

/* ---------- Форма ---------- */

export function getSelectedType() {
  const checked = [...el.typeInputs].find((input) => input.checked);
  return checked ? checked.value : TYPES.expense;
}

function setSelectedType(type) {
  el.typeInputs.forEach((input) => {
    input.checked = input.value === type;
  });
}

/** Сырые значения полей — проверяет их finance.validateTransaction() */
export function readForm() {
  return {
    amount: el.amount.value,
    type: getSelectedType(),
    categoryId: el.category.value,
    date: el.date.value,
    comment: el.comment.value,
  };
}

/** Заполняет форму данными операции (режим правки) */
export function fillForm(transaction, categories) {
  setSelectedType(transaction.type);
  renderCategoryOptions(categories, transaction.type, transaction.categoryId);
  el.amount.value = String(transaction.amount).replace('.', ',');
  el.date.value = transaction.date;
  el.comment.value = transaction.comment ?? '';
}

/** Очищает форму. keepTypeAndDate — удобно добавлять несколько операций подряд */
export function resetForm(categories, { keepTypeAndDate = false } = {}) {
  if (!keepTypeAndDate) {
    setSelectedType(TYPES.expense);
    el.date.value = todayISO();
  }
  el.amount.value = '';
  el.comment.value = '';
  renderCategoryOptions(categories, getSelectedType());
  clearFieldErrors();
}

export function setFormMode(mode, description = '') {
  const isEdit = mode === 'edit';
  el.form.classList.toggle('is-editing', isEdit);
  el.formTitle.textContent = isEdit ? 'Редактирование' : 'Новая операция';
  el.editingNote.hidden = !isEdit;
  el.editingNote.textContent = isEdit ? description : '';
  el.submit.textContent = isEdit ? 'Сохранить изменения' : 'Добавить операцию';
  el.cancel.hidden = !isEdit;
}

export function setSubmitting(isSubmitting, mode) {
  el.submit.disabled = isSubmitting;
  el.cancel.disabled = isSubmitting;
  if (isSubmitting) {
    el.submit.textContent = 'Сохраняю…';
  } else {
    el.submit.textContent = mode === 'edit' ? 'Сохранить изменения' : 'Добавить операцию';
  }
}

/** Блокирует форму, пока нет категорий (без них операцию не сохранить) */
export function setFormEnabled(isEnabled) {
  el.submit.disabled = !isEnabled;
}

const FIELD_INPUTS = {
  amount: () => el.amount,
  categoryId: () => el.category,
  date: () => el.date,
  comment: () => el.comment,
};

export function clearFieldErrors() {
  Object.entries(FIELD_INPUTS).forEach(([name, getInput]) => {
    const input = getInput();
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    document.getElementById(`${name}-error`).textContent = '';
  });
}

export function showFieldErrors(errors) {
  clearFieldErrors();
  Object.entries(errors).forEach(([name, message]) => {
    const getInput = FIELD_INPUTS[name];
    if (!getInput) return;
    const input = getInput();
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    document.getElementById(`${name}-error`).textContent = message;
  });
  const first = Object.keys(FIELD_INPUTS).find((name) => errors[name]);
  if (first) FIELD_INPUTS[first]().focus();
}

export function clearFieldError(name) {
  const getInput = FIELD_INPUTS[name];
  if (!getInput) return;
  getInput().classList.remove('is-invalid');
  getInput().removeAttribute('aria-invalid');
  document.getElementById(`${name}-error`).textContent = '';
}

export function focusForm() {
  el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.amount.focus({ preventScroll: true });
}

/* ---------- Уведомления ---------- */

export function showToast(message, type = 'success') {
  const toast = document.createElement('p');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  el.toasts.append(toast);
  setTimeout(() => toast.remove(), type === 'error' ? 6000 : 3000);
}
