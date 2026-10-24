/* =========================================================
   finance.js — расчёты без DOM и без сети:
   сводка, сортировка, проверка формы, форматирование.
   ========================================================= */

export const TYPES = {
  income: 'income',
  expense: 'expense',
};

const MAX_AMOUNT = 1_000_000_000;
const MAX_COMMENT_LENGTH = 200;

/** id в json-server бывают числами (0.17) и строками (1.0) — сравниваем всегда как строки */
export function sameId(a, b) {
  return String(a) === String(b);
}

/** Суммы считаем в копейках, чтобы не ловить 0.1 + 0.2 = 0.30000000000000004 */
function toKopecks(amount) {
  return Math.round(Number(amount) * 100);
}

/** Итоговая сводка по всем операциям */
export function calculateSummary(transactions) {
  let incomeKopecks = 0;
  let expenseKopecks = 0;

  transactions.forEach((transaction) => {
    if (transaction.type === TYPES.income) incomeKopecks += toKopecks(transaction.amount);
    else expenseKopecks += toKopecks(transaction.amount);
  });

  return {
    income: incomeKopecks / 100,
    expense: expenseKopecks / 100,
    balance: (incomeKopecks - expenseKopecks) / 100,
  };
}

/** Новые сверху: по дате, при одинаковой дате — по времени добавления */
export function sortTransactions(transactions) {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => {
      if (a.transaction.date !== b.transaction.date) {
        return a.transaction.date < b.transaction.date ? 1 : -1;
      }
      const createdA = a.transaction.createdAt ?? 0;
      const createdB = b.transaction.createdAt ?? 0;
      if (createdA !== createdB) return createdB - createdA;
      return b.index - a.index;
    })
    .map(({ transaction }) => transaction);
}

/** Сегодняшняя дата в формате YYYY-MM-DD по местному времени (не UTC) */
export function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** «1 500,5» → «1500.5»: убираем пробелы, запятую меняем на точку */
function normalizeAmount(raw) {
  return String(raw).replace(/\s/g, '').replace(',', '.');
}

/** «1 500,5» → 1500.5; не число → NaN */
export function parseAmount(raw) {
  const normalized = normalizeAmount(raw);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

/**
 * Проверяет поля формы.
 * Возвращает { data } с готовой к отправке операцией или { errors } — тексты ошибок по полям.
 */
export function validateTransaction(raw, categories) {
  const errors = {};

  const amount = parseAmount(raw.amount);
  if (String(raw.amount).trim() === '') {
    errors.amount = 'Введите сумму.';
  } else if (Number.isNaN(amount)) {
    errors.amount = 'Сумма — это число, например 1500 или 249,90.';
  } else if (amount <= 0) {
    errors.amount = 'Сумма должна быть больше нуля.';
  } else if (amount > MAX_AMOUNT) {
    errors.amount = 'Слишком большая сумма.';
  } else if (/\.\d{3,}$/.test(normalizeAmount(raw.amount))) {
    errors.amount = 'Не больше двух знаков после запятой.';
  }

  if (raw.type !== TYPES.income && raw.type !== TYPES.expense) {
    errors.type = 'Выберите, доход это или расход.';
  }

  const category = categories.find((item) => sameId(item.id, raw.categoryId));
  if (!raw.categoryId) {
    errors.categoryId = 'Выберите категорию.';
  } else if (!category) {
    errors.categoryId = 'Такой категории нет на сервере.';
  } else if (category.type !== raw.type) {
    errors.categoryId = 'Категория не подходит к типу операции.';
  }

  if (!raw.date) {
    errors.date = 'Укажите дату.';
  } else if (!isValidISODate(raw.date)) {
    errors.date = 'Дата указана неверно.';
  }

  const comment = String(raw.comment ?? '').trim();
  if (comment.length > MAX_COMMENT_LENGTH) {
    errors.comment = `Комментарий не длиннее ${MAX_COMMENT_LENGTH} символов.`;
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    data: {
      amount: Math.round(amount * 100) / 100,
      type: raw.type,
      categoryId: category.id,   // сохраняем id в том виде, в каком его отдал сервер
      date: raw.date,
      comment,
    },
  };
}

/* ---------- Форматирование ---------- */

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value) {
  return moneyFormatter.format(value);
}

/** Сумма со знаком: «+1 500,00 ₽» для дохода и «−1 500,00 ₽» для расхода */
export function formatSignedAmount(transaction) {
  const sign = transaction.type === TYPES.income ? '+' : '−';
  return `${sign}${formatMoney(Number(transaction.amount))}`;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** «2026-10-24» → «24 окт. 2026». Строим дату в UTC, чтобы часовой пояс не сдвинул день */
export function formatDate(isoDate) {
  if (!isValidISODate(isoDate)) return isoDate || '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day))).replace(/\s?г\.$/, '');
}
