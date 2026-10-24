'use strict';

/* =========================================================
   Настройки
   ========================================================= */

const API_URL = 'https://jsonplaceholder.typicode.com/posts';
const PAGE_SIZE = 10;            // постов в одной порции
const SCROLL_THRESHOLD = 200;    // начинаем грузить, когда до конца списка осталось 200px
const SEARCH_DELAY = 300;        // дебаунс поиска, мс
const REQUEST_TIMEOUT = 10000;   // если сервер молчит дольше 10 с — считаем это ошибкой

/* =========================================================
   Состояние
   Все загруженные посты лежат в одном массиве state.posts.
   Список на экране и фильтрация строятся только из него.
   ========================================================= */

const state = {
  posts: [],          // { userId, id, title, body }
  total: null,        // сколько постов всего на сервере (из заголовка X-Total-Count, если он есть)
  query: '',          // применённый (после дебаунса) поисковый запрос
  isLoading: false,
  hasMore: true,
  error: null,        // текст ошибки для пользователя или null
};

let newPostIds = new Set();   // карточки из последней порции появляются с анимацией

/* =========================================================
   Загрузка данных
   ========================================================= */

/** Ошибка «сервер ответил, но не 2xx» — чтобы отличать её от обрыва сети */
class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

function buildPageUrl(start, limit) {
  const url = new URL(API_URL);
  url.searchParams.set('_start', String(start));
  url.searchParams.set('_limit', String(limit));
  return url.toString();
}

/** Понятный текст ошибки для пользователя */
function describeError(error) {
  if (error.name === 'AbortError') {
    return 'Сервер слишком долго не отвечает. Попробуйте ещё раз чуть позже.';
  }
  if (error instanceof HttpError) {
    if (error.status === 404) return 'Адрес с постами не найден (ошибка 404).';
    if (error.status >= 500) return `Сервер временно не работает (ошибка ${error.status}). Попробуйте ещё раз.`;
    return `Сервер отклонил запрос (ошибка ${error.status}).`;
  }
  if (error instanceof SyntaxError || error.name === 'DataError') {
    return 'Сервер прислал данные в неожиданном формате.';
  }
  if (!navigator.onLine) {
    return 'Нет подключения к интернету. Проверьте сеть и нажмите «Попробовать снова».';
  }
  return 'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.';
}

function isValidPost(post) {
  return post !== null && typeof post === 'object'
    && Number.isInteger(post.id) && typeof post.title === 'string' && typeof post.body === 'string';
}

/** Загружает следующую порцию и добавляет её в конец state.posts */
async function loadNextPage() {
  if (state.isLoading || !state.hasMore) return;

  state.isLoading = true;
  state.error = null;
  renderFooter();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(buildPageUrl(state.posts.length, PAGE_SIZE), { signal: controller.signal });

    if (!response.ok) {
      throw new HttpError(response.status);
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.every(isValidPost)) {
      const formatError = new Error('Unexpected response format');
      formatError.name = 'DataError';
      throw formatError;
    }

    const totalHeader = Number(response.headers.get('X-Total-Count'));
    if (Number.isInteger(totalHeader) && totalHeader > 0) {
      state.total = totalHeader;
    }

    appendPosts(data);

    // Данные кончились, если пришло меньше, чем просили, или загружено уже всё, что есть на сервере
    state.hasMore = data.length === PAGE_SIZE && (state.total === null || state.posts.length < state.total);
  } catch (error) {
    state.error = describeError(error);
    console.error('Ошибка загрузки постов:', error);
  } finally {
    clearTimeout(timeoutId);
    state.isLoading = false;
    render();
    // Если экран высокий и список ещё не доходит до низа — догружаем, не дожидаясь прокрутки
    requestAnimationFrame(loadMoreIfSentinelVisible);
  }
}

/** Добавляет посты в общий массив, пропуская уже загруженные id */
function appendPosts(newPosts) {
  const knownIds = new Set(state.posts.map((post) => post.id));
  const fresh = newPosts.filter((post) => !knownIds.has(post.id));
  state.posts.push(...fresh);
  newPostIds = new Set(fresh.map((post) => post.id));
}

/* =========================================================
   Бесконечный скролл
   ========================================================= */

const sentinel = document.getElementById('sentinel');

/** Можно ли сейчас автоматически подгружать следующую порцию */
function canAutoLoad() {
  return !state.isLoading && state.hasMore && state.error === null && state.query === '';
}

function loadMoreIfSentinelVisible() {
  if (!canAutoLoad()) return;
  const sentinelTop = sentinel.getBoundingClientRect().top;
  if (sentinelTop - window.innerHeight <= SCROLL_THRESHOLD) {
    loadNextPage();
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMoreIfSentinelVisible();
    }
  },
  { rootMargin: `0px 0px ${SCROLL_THRESHOLD}px 0px` }
);

/* =========================================================
   Поиск по загруженным постам
   ========================================================= */

/** Свой дебаунс: функция сработает, только когда с последнего вызова прошло `delay` мс */
function debounce(callback, delay) {
  let timerId = null;
  const debounced = (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      callback(...args);
    }, delay);
  };
  debounced.cancel = () => {
    clearTimeout(timerId);
    timerId = null;
  };
  return debounced;
}

function normalizeQuery(value) {
  return value.trim().toLowerCase();
}

/** Посты, которые нужно показать: фильтр по подстроке в title без учёта регистра */
function getVisiblePosts() {
  if (state.query === '') return state.posts;
  return state.posts.filter((post) => post.title.toLowerCase().includes(state.query));
}

function applySearch(value) {
  const query = normalizeQuery(value);
  if (query === state.query) return;
  state.query = query;
  newPostIds = new Set();
  render();
  // Поиск очистили — снова можно листать и подгружать
  if (query === '') requestAnimationFrame(loadMoreIfSentinelVisible);
}

const applySearchDebounced = debounce(applySearch, SEARCH_DELAY);

/* =========================================================
   Отрисовка
   ========================================================= */

const elements = {
  posts: document.getElementById('posts'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  searchSummary: document.getElementById('search-summary'),
  empty: document.getElementById('empty'),
  loader: document.getElementById('loader'),
  error: document.getElementById('error'),
  errorText: document.getElementById('error-text'),
  retry: document.getElementById('retry'),
  paused: document.getElementById('paused'),
  end: document.getElementById('end'),
  toTop: document.getElementById('to-top'),
};

const AUTHOR_COLORS = ['yellow', 'cyan', 'pink', 'lime', 'orange'];

/** Заголовок с подсвеченным совпадением. Только текстовые узлы и <mark> — без innerHTML */
function createHighlightedText(text, query) {
  const fragment = document.createDocumentFragment();
  if (query === '') {
    fragment.append(text);
    return fragment;
  }
  const lower = text.toLowerCase();
  let position = 0;
  let index = lower.indexOf(query);
  while (index !== -1) {
    fragment.append(text.slice(position, index));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(index, index + query.length);
    fragment.append(mark);
    position = index + query.length;
    index = lower.indexOf(query, position);
  }
  fragment.append(text.slice(position));
  return fragment;
}

function createPostCard(post) {
  const item = document.createElement('li');
  item.className = `post post--${AUTHOR_COLORS[(post.userId - 1 + AUTHOR_COLORS.length) % AUTHOR_COLORS.length]}`;
  if (newPostIds.has(post.id)) item.classList.add('is-new');

  const article = document.createElement('article');
  article.className = 'post__inner';

  const meta = document.createElement('div');
  meta.className = 'post__meta';

  const author = document.createElement('span');
  author.className = 'post__author';
  author.textContent = `Автор #${post.userId}`;

  const number = document.createElement('span');
  number.className = 'post__id';
  number.textContent = `Пост ${post.id}`;

  meta.append(author, number);

  const title = document.createElement('h2');
  title.className = 'post__title';
  title.append(createHighlightedText(post.title, state.query));

  const body = document.createElement('p');
  body.className = 'post__body';
  body.textContent = post.body;

  article.append(meta, title, body);
  item.append(article);
  return item;
}

function renderPosts() {
  const visible = getVisiblePosts();
  elements.posts.replaceChildren(...visible.map(createPostCard));
  newPostIds = new Set();
  return visible.length;
}

function renderSearchSummary(visibleCount) {
  const loaded = state.posts.length;
  const totalPart = state.total ? ` из ${state.total}` : '';

  if (state.query === '') {
    elements.searchSummary.textContent = loaded > 0 ? `Загружено ${loaded}${totalPart} постов` : '';
  } else {
    elements.searchSummary.textContent = `Найдено ${visibleCount} среди ${loaded} загруженных`;
  }
}

function renderFooter(visibleCount = getVisiblePosts().length) {
  const { isLoading, error, hasMore, query, posts } = state;

  elements.loader.hidden = !isLoading;

  elements.error.hidden = error === null;
  elements.errorText.textContent = error ?? '';

  const nothingFound = !isLoading && query !== '' && visibleCount === 0 && posts.length > 0;
  elements.empty.hidden = !nothingFound;
  if (nothingFound) {
    elements.empty.textContent = `По запросу «${elements.searchInput.value.trim()}» среди загруженных постов ничего нет.`;
  }

  elements.paused.hidden = !(query !== '' && hasMore && !isLoading && error === null);
  elements.end.hidden = !(!hasMore && !isLoading && error === null);
}

function render() {
  const visibleCount = renderPosts();
  renderSearchSummary(visibleCount);
  renderFooter(visibleCount);
}

/* =========================================================
   События
   ========================================================= */

function handleSearchInput() {
  elements.searchClear.hidden = elements.searchInput.value === '';
  applySearchDebounced(elements.searchInput.value);
}

function clearSearch() {
  elements.searchInput.value = '';
  elements.searchClear.hidden = true;
  applySearchDebounced.cancel();
  applySearch('');
  elements.searchInput.focus();
}

function handleSearchKeyDown(event) {
  if (event.key === 'Escape' && elements.searchInput.value !== '') {
    event.preventDefault();
    clearSearch();
  }
}

function handleScroll() {
  elements.toTop.hidden = window.scrollY < 800;
}

elements.searchInput.addEventListener('input', handleSearchInput);
elements.searchInput.addEventListener('keydown', handleSearchKeyDown);
elements.searchClear.addEventListener('click', clearSearch);
elements.retry.addEventListener('click', loadNextPage);
elements.toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', handleScroll, { passive: true });

/* =========================================================
   Старт
   ========================================================= */

function init() {
  // Браузер может восстановить текст в поле после перезагрузки — сразу применяем его
  if (elements.searchInput.value !== '') {
    elements.searchClear.hidden = false;
    state.query = normalizeQuery(elements.searchInput.value);
  }
  render();
  observer.observe(sentinel);
  loadNextPage();
}

init();
