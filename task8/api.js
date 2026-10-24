/* =========================================================
   api.js — все запросы к json-server.
   Каждая функция возвращает данные или выбрасывает ApiError
   с понятным пользователю текстом.
   ========================================================= */

export const API_URL = 'http://localhost:3001';
const REQUEST_TIMEOUT = 8000;

/** Ошибка работы с сервером. status — HTTP-код (если сервер ответил), иначе null */
export class ApiError extends Error {
  constructor(message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
  }
}

function describeStatus(status) {
  if (status === 404) return 'запись не найдена на сервере (ошибка 404)';
  if (status >= 500) return `сервер вернул ошибку ${status}`;
  return `сервер отклонил запрос (ошибка ${status})`;
}

/**
 * Общая обёртка над fetch: тайм-аут, проверка response.ok, разбор JSON.
 * Здесь же ловим обрыв сети, чтобы не показывать пользователю «Failed to fetch».
 */
async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(describeStatus(response.status), { status: response.status });
    }

    const text = await response.text();
    return text === '' ? null : JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('сервер не ответил за 8 секунд', { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ApiError('сервер прислал некорректный ответ', { cause: error });
    }
    throw new ApiError(`нет связи с сервером ${API_URL}. Проверьте, что json-server запущен`, { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Добавляет к ошибке, что именно не получилось: «Не удалось сохранить операцию: …» */
function withAction(error, action) {
  const reason = error instanceof ApiError ? error.message : 'неизвестная ошибка';
  return new ApiError(`Не удалось ${action}: ${reason}.`, {
    status: error instanceof ApiError ? error.status : null,
    cause: error,
  });
}

export async function getCategories() {
  try {
    return await request('/categories');
  } catch (error) {
    throw withAction(error, 'загрузить категории');
  }
}

export async function getTransactions() {
  try {
    return await request('/transactions');
  } catch (error) {
    throw withAction(error, 'загрузить операции');
  }
}

/** POST /transactions — сервер сам присвоит id и вернёт созданную запись */
export async function addTransaction(transaction) {
  try {
    return await request('/transactions', { method: 'POST', body: transaction });
  } catch (error) {
    throw withAction(error, 'добавить операцию');
  }
}

/** PUT /transactions/:id — запись заменяется целиком */
export async function updateTransaction(id, transaction) {
  try {
    return await request(`/transactions/${encodeURIComponent(id)}`, { method: 'PUT', body: transaction });
  } catch (error) {
    throw withAction(error, 'сохранить изменения');
  }
}

export async function deleteTransaction(id) {
  try {
    await request(`/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    throw withAction(error, 'удалить операцию');
  }
}
