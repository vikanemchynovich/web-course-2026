/* =========================================================
   main.js — точка входа: состояние приложения,
   загрузка данных и подписки на события.
   ========================================================= */

import { getCategories, getTransactions, addTransaction, updateTransaction, deleteTransaction } from './api.js';
import * as ui from './ui.js';
import { calculateSummary, sortTransactions, validateTransaction, sameId, formatSignedAmount, formatDate } from './finance.js';

const DELETE_CONFIRM_TIMEOUT = 4000;

/** Всё состояние приложения. Сводка и список всегда считаются из state.transactions */
const state = {
  transactions: [],
  categories: [],
  isLoading: true,
  loadError: null,
  editingId: null,          // id операции в режиме правки или null
  confirmDeleteId: null,    // у какой операции нажали «Удалить» и ждём подтверждения
  busyIds: new Set(),       // операции, по которым идёт запрос удаления
  isSubmitting: false,
};

let confirmDeleteTimer = null;

/* ---------- Отрисовка из состояния ---------- */

function render() {
  ui.renderSummary(calculateSummary(state.transactions));
  ui.renderTransactions(sortTransactions(state.transactions), state.categories, {
    editingId: state.editingId,
    confirmDeleteId: state.confirmDeleteId,
    busyIds: state.busyIds,
  });
  ui.renderListStatus({
    isLoading: state.isLoading,
    error: state.loadError,
    isEmpty: state.transactions.length === 0,
  });
}

function findTransaction(id) {
  return state.transactions.find((transaction) => sameId(transaction.id, id));
}

function removeTransactionLocally(id) {
  state.transactions = state.transactions.filter((transaction) => !sameId(transaction.id, id));
  if (state.editingId !== null && sameId(state.editingId, id)) {
    exitEditMode();
  }
}

/* ---------- Загрузка ---------- */

async function loadData() {
  state.isLoading = true;
  state.loadError = null;
  render();

  try {
    const [categories, transactions] = await Promise.all([getCategories(), getTransactions()]);
    state.categories = Array.isArray(categories) ? categories : [];
    state.transactions = Array.isArray(transactions) ? transactions : [];
  } catch (error) {
    state.loadError = error.message;
  } finally {
    state.isLoading = false;
    ui.renderCategoryOptions(state.categories, ui.getSelectedType());
    ui.setFormEnabled(state.categories.length > 0);
    render();
  }
}

/* ---------- Добавление и редактирование ---------- */

function enterEditMode(id) {
  const transaction = findTransaction(id);
  if (!transaction) return;

  state.editingId = transaction.id;
  state.confirmDeleteId = null;
  ui.fillForm(transaction, state.categories);
  ui.clearFieldErrors();
  const categoryName = state.categories.find((category) => sameId(category.id, transaction.categoryId))?.name ?? 'Без категории';
  ui.setFormMode('edit', `${categoryName}, ${formatDate(transaction.date)}, ${formatSignedAmount(transaction)}`);
  render();
  ui.focusForm();
}

function exitEditMode() {
  state.editingId = null;
  ui.resetForm(state.categories);
  ui.setFormMode('create');
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) return;

  const { data, errors } = validateTransaction(ui.readForm(), state.categories);
  if (errors) {
    ui.showFieldErrors(errors);
    return;
  }
  ui.clearFieldErrors();

  const mode = state.editingId === null ? 'create' : 'edit';
  state.isSubmitting = true;
  ui.setSubmitting(true, mode);

  try {
    if (mode === 'edit') {
      const editingId = state.editingId;
      const existing = findTransaction(editingId);
      const saved = await updateTransaction(editingId, { ...data, createdAt: existing?.createdAt ?? Date.now() });
      state.transactions = state.transactions.map((transaction) =>
        sameId(transaction.id, editingId) ? saved : transaction
      );
      exitEditMode();
      ui.showToast('Изменения сохранены');
    } else {
      const created = await addTransaction({ ...data, createdAt: Date.now() });
      state.transactions.push(created);
      ui.resetForm(state.categories, { keepTypeAndDate: true });
      ui.showToast('Операция добавлена');
      ui.elements.amount.focus();
    }
    render();
  } catch (error) {
    if (mode === 'edit' && error.status === 404) {
      removeTransactionLocally(state.editingId);
      render();
      ui.showToast('Эту операцию уже удалили на сервере — правка отменена.', 'error');
    } else {
      ui.showToast(error.message, 'error');
    }
  } finally {
    state.isSubmitting = false;
    ui.setSubmitting(false, state.editingId === null ? 'create' : 'edit');
  }
}

/* ---------- Удаление: первое нажатие спрашивает, второе удаляет ---------- */

function askDeleteConfirmation(id) {
  clearTimeout(confirmDeleteTimer);
  state.confirmDeleteId = id;
  render();
  // Кнопка «Точно удалить?» получает фокус, чтобы подтвердить можно было и с клавиатуры
  ui.elements.tableBody.querySelector(`[data-id="${CSS.escape(String(id))}"] [data-action="delete"]`)?.focus();
  confirmDeleteTimer = setTimeout(() => {
    state.confirmDeleteId = null;
    render();
  }, DELETE_CONFIRM_TIMEOUT);
}

async function handleDelete(id) {
  if (state.confirmDeleteId === null || !sameId(state.confirmDeleteId, id)) {
    askDeleteConfirmation(id);
    return;
  }

  clearTimeout(confirmDeleteTimer);
  state.confirmDeleteId = null;
  state.busyIds.add(String(id));
  render();

  try {
    await deleteTransaction(id);
    // Убираем запись из интерфейса только после успешного ответа сервера
    removeTransactionLocally(id);
    ui.showToast('Операция удалена');
  } catch (error) {
    if (error.status === 404) {
      removeTransactionLocally(id);
      ui.showToast('Эта операция уже была удалена на сервере.', 'error');
    } else {
      ui.showToast(error.message, 'error');
    }
  } finally {
    state.busyIds.delete(String(id));
    render();
  }
}

/* ---------- События ---------- */

function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-id]');
  if (!row) return;

  const transaction = findTransaction(row.dataset.id);
  if (!transaction) return;

  if (button.dataset.action === 'edit') enterEditMode(transaction.id);
  if (button.dataset.action === 'delete') handleDelete(transaction.id);
}

function handleTypeChange() {
  ui.renderCategoryOptions(state.categories, ui.getSelectedType());
  ui.clearFieldError('categoryId');
}

function handleFieldInput(event) {
  ui.clearFieldError(event.target.name);
}

function handleKeyDown(event) {
  if (event.key === 'Escape' && state.editingId !== null && !state.isSubmitting) {
    exitEditMode();
    render();
  }
}

function subscribe() {
  const { form, cancel, tableBody, listStatus, typeInputs } = ui.elements;

  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', handleFieldInput);
  typeInputs.forEach((input) => input.addEventListener('change', handleTypeChange));
  cancel.addEventListener('click', () => {
    exitEditMode();
    render();
  });
  tableBody.addEventListener('click', handleListClick);
  listStatus.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry"]')) loadData();
  });
  document.addEventListener('keydown', handleKeyDown);
}

/* ---------- Старт ---------- */

subscribe();
ui.resetForm(state.categories);
ui.setFormMode('create');
ui.setFormEnabled(false);
loadData();
