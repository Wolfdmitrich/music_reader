/* ══════════════════════════════════════════════════════════════
   AudioVault v3.1 — script.js
   Features:
   • Auto-load from remote URL on startup
   • Per-ID edit/delete overrides stored in localStorage
   • Add new tracks, auto-detect duration via preview proxy
   • Download full current dataset as JSON
   • Inline audio preview via Cloudflare Worker proxy (3x retry,
     auto-tags unplayable tracks as "unavailable")
   • Bottom mini player: seek, volume, download
   • Bulk select + mass favorite/category/playlist/export/delete
   • Undo toast (5s) for single and bulk deletes
   • Named playlists, separate from favorites
   • "Recent" view (recently opened/played tracks)
   • Fuzzy search via Fuse.js (falls back to substring match)
   • Progressive/virtualized rendering (IntersectionObserver, no
     "load more" buttons)
   ══════════════════════════════════════════════════════════════ */

"use strict";

const REMOTE_URL =
  "https://raw.githubusercontent.com/Wolfdmitrich/music_reader/refs/heads/main/audios.json";
const LS_OVERRIDES = "av_overrides_v3"; // { id: {deleted:true} | {id,title,category,duration} }
const LS_ADDED = "av_added_v3"; // array of {id,title,category,duration}
const LS_FAVS = "av_favs";
const LS_LANG = "av_lang";
const LS_THEME = "av_theme";
const LS_UNAVAILABLE = "av_unavailable_v1"; // ids that failed to load 3x
const LS_RECENT = "av_recent_v1"; // [{id, ts}]
const LS_PLAYLISTS = "av_playlists_v1"; // { plId: {name, ids:[]} }
const LS_VOLUME = "av_volume_v1";
const LS_PLAYMODE = "av_playmode_v1"; // {shuffle:bool, repeat:'off'|'all'|'one'}
const LS_SEARCH_HISTORY = "av_search_history_v1";
const SEARCH_HISTORY_MAX = 8;
const LS_TAG_META = "av_tag_meta_v1"; // { tagName: {icon, color} }
const LS_BADGE_META = "av_badge_meta_v1"; // { modified|added|unavailable: {label, color} }

// Cloudflare Worker proxy — резолвит Roblox превью в проигрываемый URL.
// Замени на свой адрес воркера, если он отличается.
const AUDIO_PROXY_BASE =
  "https://roblox-audio-proxy.wolfdmitrich-github.workers.dev";
const PREVIEW_MAX_ATTEMPTS = 3;
const RECENT_MAX = 40;
const RECENT_TTL_MS = 60 * 60 * 1000; // "недавние" живут 1 час

const previewUrl = (id) => `${AUDIO_PROXY_BASE}/preview/${id}`;

// ─── State ───────────────────────────────────────────────────────
const state = {
  baseRemote: [], // loaded from URL, never mutated
  tracks: [], // computed: baseRemote ∪ added – deleted + edits
  favorites: new Set(),
  tagMeta: {}, // { tagName: {icon, color} }
  badgeMeta: {}, // { modified|added|unavailable: {label, color} }
  dataVersion: 0, // bumped on every track-content mutation, forces render() to rebuild
  view: "all",
  catFilter: null,
  playlistFilter: null,
  query: "",
  sort: "default",
  layout: "grid",
  modal: null,
  lang: "ru",
  theme: "dark",
  overrides: {}, // { id → {deleted:true} | full track obj }
  added: [], // locally added tracks
  unavailable: new Set(), // ids that failed preview 3x
  recent: [], // [{id, ts}] most-recent first
  playlists: {}, // { id: {name, ids:[]} }
  selectMode: false,
  selected: new Set(),
  playingId: null,
  shuffle: false,
  repeat: "off", // 'off' | 'all' | 'one'
  renderedCount: 0,
  currentDisplayed: [],
  fuse: null,
};

// ─── Translations ──────────────────────────────────────────────
const translations = {
  ru: {
    version: "v3.1",
    nav_all: "Все треки",
    nav_favorites: "Избранное",
    nav_categories: "Категории",
    upload_json: "Загрузить JSON",
    sample: "Пример",
    search_placeholder: "Поиск по названию, ID, категории…",
    sort_default: "По умолчанию",
    sort_title_asc: "Название А→Я",
    sort_title_desc: "Название Я→А",
    sort_duration_asc: "Длительность ↑",
    sort_duration_desc: "Длительность ↓",
    sort_category_asc: "Категория А→Я",
    stat_tracks: "треков",
    stat_favorites: "избранных",
    stat_categories: "категорий",
    stat_shown: "показано",
    export_fav: "Экспорт избранных",
    filter_label: "Фильтр:",
    filter_clear: "убрать",
    empty_title: "Добро пожаловать в AudioVault",
    empty_desc: "Загружаем аудио с сервера…",
    no_results_title: "Ничего не найдено",
    no_results_desc: "Попробуйте изменить запрос или фильтр категории",
    drop_text: "Отпустите для загрузки JSON",
    copied: "Скопировано:",
    removed_fav: "Убрано из избранного",
    added_fav: "Добавлено в избранное ★",
    no_fav_export: "Нет избранных треков для экспорта",
    export_success: "Экспортировано {count} треков",
    clear_fav_confirm: "Удалить все {count} избранных? Это нельзя отменить.",
    clear_fav_success: "Избранное очищено",
    load_sample_success: "✓ Загружен пример: {count} треков",
    load_json_success: '✓ Загружено {count} треков из "{name}"',
    remote_load_success: "✓ Загружено {count} треков с сервера",
    remote_load_error: "Не удалось загрузить треки с сервера",
    invalid_json: "Ожидается массив JSON",
    no_valid_tracks: "Нет валидных треков в файле",
    skipped_records: "Пропущено {skipped} некорректных записей",
    error_parse: "Ошибка парсинга JSON: {msg}",
    error_read: "Не удалось прочитать файл",
    error_file_type: "Пожалуйста загрузите .json файл",
    toast_info_fav_removed: "Убрано из избранного",
    toast_info_fav_added: "Добавлено в избранное ★",
    toast_success_export: "Экспортировано {count} треков",
    toast_error_no_fav: "Нет избранных треков",
    toast_info_clear: "Избранное очищено",
    toast_info_no_fav: "Нет избранных треков",
    modal_copy_id: "Копировать ID",
    modal_open_roblox: "Открыть в Roblox",
    modal_fav_add: "☆ В избранное",
    modal_fav_remove: "★ В избранном",
    modal_duration: "Длительность",
    modal_seconds: "Секунд",
    unit_seconds_short: "с",
    shuffle_on: "🔀 Перемешивание включено",
    shuffle_off: "Перемешивание выключено",
    repeat_all: "🔁 Повтор плейлиста",
    repeat_one: "🔂 Повтор трека",
    repeat_off: "Повтор выключен",
    categories_label: "Категории",
    edit_track: "Редактировать",
    delete_track: "Удалить",
    add_track: "Добавить трек",
    edit_title: "Редактирование трека",
    add_title: "Новый трек",
    field_title: "Название",
    field_id: "ID",
    field_category: "Категория",
    field_tags: "Теги",
    field_tags_placeholder: "Введи тег и нажми Enter…",
    field_tags_hint: "Можно несколько — Enter или запятая добавляют тег",
    tag_editor_title: "Управление тегами",
    tag_editor_hint: "Цвет, иконка, переименование и объединение тегов",
    tag_editor_new_placeholder: "Название нового тега",
    tag_editor_create: "Создать",
    tag_editor_created: 'Тег "{name}" создан',
    tag_editor_empty: "Тегов пока нет",
    tag_editor_color: "Цвет тега",
    badge_editor_title: "Метки статуса (изменено / новое / недоступно)",
    badge_editor_reset: "Сбросить к стандартному",
    badge_editor_hint: "Цвет, иконка и текст меток EDITED / NEW / UNAVAILABLE",
    tab_tags: "Теги",
    tab_badges: "Метки",
    tag_editor_rename: "Переименовать / объединить",
    tag_editor_rename_prompt:
      'Новое имя для "{name}" (существующее имя объединит теги):',
    tag_editor_renamed: "Обновлено треков: {count}",
    tag_editor_delete: "Удалить тег",
    tag_editor_delete_confirm:
      'Убрать тег "{name}" у {count} треков? Сами треки не удалятся.',
    tag_editor_delete_confirm_empty: 'Удалить неиспользуемый тег "{name}"?',
    tag_editor_deleted: 'Тег "{name}" удалён',
    drag_reorder: "Перетащи, чтобы изменить порядок",
    playlist_reordered: "Порядок обновлён",
    field_duration: "Длительность (сек)",
    save: "Сохранить",
    cancel: "Отмена",
    track_saved: "Трек сохранён",
    track_deleted: "Трек удалён",
    track_added: "Трек добавлен",
    delete_confirm: 'Удалить трек "{title}"? Это нельзя отменить.',
    download_all: "Скачать все треки",
    id_exists: "Трек с таким ID уже существует",
    field_required: "Заполните все поля",
    modified_badge: "изм.",
    added_badge: "новый",
    reset_changes: "Сбросить изменения",
    reset_confirm:
      "Сбросить все локальные изменения (правки, удаления, добавления)? Данные вернутся к исходным.",
    changes_reset: "Изменения сброшены",
    retry_track: "Попробовать снова",
    retry_track_started: "Повторная попытка воспроизведения…",
    feel_lucky: "Мне повезёт",
    search_history_empty: "История поиска пуста",
    search_history_remove: "Удалить из истории",
    search_history_clear: "Очистить историю поиска",

    // Preview player
    preview_play: "Прослушать",
    preview_pause: "Пауза",
    preview_loading: "Загрузка…",
    preview_error: "Ошибка загрузки",
    preview_unavailable: "Возможно удалено/недоступно",
    unavailable_badge: "недоступно",
    preview_download: "Скачать",
    preview_retry: "Повторить попытку",
    preview_close: "Закрыть плеер",

    // Undo
    undo: "Отменить",
    track_restored: "Трек восстановлен",

    // Select / bulk
    select_mode: "Выбрать несколько",
    bulk_selected: "выбрано",
    bulk_fav: "В избранное",
    bulk_unfav: "Убрать из избранного",
    bulk_category: "Добавить тег",
    bulk_category_prompt: "Тег, который добавить выбранным трекам:",
    bulk_playlist: "В плейлист",
    bulk_export: "Экспорт",
    bulk_delete: "Удалить",
    bulk_delete_confirm: "Удалить {count} выбранных треков?",
    bulk_select_all: "Выбрать всё",
    bulk_cancel: "Готово",
    bulk_none_selected: "Ничего не выбрано",

    // Recent
    nav_recent: "Недавние",
    recent_empty_title: "Пока ничего нет",
    recent_empty_desc: "Здесь появятся треки, которые вы недавно слушали или открывали",

    // Playlists
    nav_playlists: "Плейлисты",
    playlists_label: "Плейлисты",
    playlist_create: "+ Новый плейлист",
    playlist_name_prompt: "Название плейлиста:",
    playlist_created: 'Плейлист "{name}" создан',
    playlist_delete_confirm: 'Удалить плейлист "{name}"?',
    playlist_deleted: "Плейлист удалён",
    playlist_add_prompt: "Введите номер плейлиста или новое название:",
    playlist_added: "Добавлено в плейлист",
    playlist_empty_title: "В этом плейлисте пусто",
    playlist_empty_desc: "Добавляйте треки через режим выбора → «В плейлист»",

    // Add/edit form extras
    field_title_paste: "Найти",
    field_duration_detect: "Определить",
    field_duration_detecting: "Слушаю…",
    field_duration_not_found: "Не удалось определить",
    field_id_hint: "Заполни ID и нажми «Определить» — длительность подставится автоматически",
  },
  en: {
    version: "v3.1",
    nav_all: "All tracks",
    nav_favorites: "Favorites",
    nav_categories: "Categories",
    upload_json: "Upload JSON",
    sample: "Sample",
    search_placeholder: "Search by title, ID, category…",
    sort_default: "Default",
    sort_title_asc: "Title A→Z",
    sort_title_desc: "Title Z→A",
    sort_duration_asc: "Duration ↑",
    sort_duration_desc: "Duration ↓",
    sort_category_asc: "Category A→Z",
    stat_tracks: "tracks",
    stat_favorites: "favorites",
    stat_categories: "categories",
    stat_shown: "shown",
    export_fav: "Export favorites",
    filter_label: "Filter:",
    filter_clear: "clear",
    empty_title: "Welcome to AudioVault",
    empty_desc: "Loading audio from server…",
    no_results_title: "Nothing found",
    no_results_desc: "Try changing your query or category filter",
    drop_text: "Drop to upload JSON",
    copied: "Copied:",
    removed_fav: "Removed from favorites",
    added_fav: "Added to favorites ★",
    no_fav_export: "No favorite tracks to export",
    export_success: "Exported {count} tracks",
    clear_fav_confirm: "Delete all {count} favorites? This cannot be undone.",
    clear_fav_success: "Favorites cleared",
    load_sample_success: "✓ Sample loaded: {count} tracks",
    load_json_success: '✓ Loaded {count} tracks from "{name}"',
    remote_load_success: "✓ Loaded {count} tracks from server",
    remote_load_error: "Failed to load tracks from server",
    invalid_json: "Expected a JSON array",
    no_valid_tracks: "No valid tracks in file",
    skipped_records: "Skipped {skipped} invalid entries",
    error_parse: "JSON parsing error: {msg}",
    error_read: "Failed to read file",
    error_file_type: "Please upload a .json file",
    toast_info_fav_removed: "Removed from favorites",
    toast_info_fav_added: "Added to favorites ★",
    toast_success_export: "Exported {count} tracks",
    toast_error_no_fav: "No favorite tracks",
    toast_info_clear: "Favorites cleared",
    toast_info_no_fav: "No favorites",
    modal_copy_id: "Copy ID",
    modal_open_roblox: "Open in Roblox",
    modal_fav_add: "☆ Add to favorites",
    modal_fav_remove: "★ In favorites",
    modal_duration: "Duration",
    modal_seconds: "Seconds",
    unit_seconds_short: "s",
    shuffle_on: "🔀 Shuffle on",
    shuffle_off: "Shuffle off",
    repeat_all: "🔁 Repeat playlist",
    repeat_one: "🔂 Repeat track",
    repeat_off: "Repeat off",
    categories_label: "Categories",
    edit_track: "Edit",
    delete_track: "Delete",
    add_track: "Add track",
    edit_title: "Edit track",
    add_title: "New track",
    field_title: "Title",
    field_id: "ID",
    field_category: "Category",
    field_tags: "Tags",
    field_tags_placeholder: "Type a tag and press Enter…",
    field_tags_hint: "Add several — Enter or comma confirms a tag",
    tag_editor_title: "Manage tags",
    tag_editor_hint: "Color, icon, rename and merge tags",
    tag_editor_new_placeholder: "New tag name",
    tag_editor_create: "Create",
    tag_editor_created: 'Tag "{name}" created',
    tag_editor_empty: "No tags yet",
    tag_editor_color: "Tag color",
    badge_editor_title: "Status badges (edited / new / unavailable)",
    badge_editor_reset: "Reset to default",
    badge_editor_hint: "Color, icon and text for the EDITED / NEW / UNAVAILABLE marks",
    tab_tags: "Tags",
    tab_badges: "Marks",
    tag_editor_rename: "Rename / merge",
    tag_editor_rename_prompt:
      'New name for "{name}" (an existing name will merge tags):',
    tag_editor_renamed: "Tracks updated: {count}",
    tag_editor_delete: "Delete tag",
    tag_editor_delete_confirm:
      'Remove tag "{name}" from {count} tracks? Tracks themselves stay.',
    tag_editor_delete_confirm_empty: 'Delete unused tag "{name}"?',
    tag_editor_deleted: 'Tag "{name}" deleted',
    drag_reorder: "Drag to reorder",
    playlist_reordered: "Order updated",
    field_duration: "Duration (sec)",
    save: "Save",
    cancel: "Cancel",
    track_saved: "Track saved",
    track_deleted: "Track deleted",
    track_added: "Track added",
    delete_confirm: 'Delete track "{title}"? This cannot be undone.',
    download_all: "Download all tracks",
    id_exists: "A track with this ID already exists",
    field_required: "Please fill in all fields",
    modified_badge: "edited",
    added_badge: "new",
    reset_changes: "Reset changes",
    reset_confirm:
      "Reset all local changes (edits, deletions, additions)? Data will revert to original.",
    changes_reset: "Changes reset",
    retry_track: "Retry",
    retry_track_started: "Retrying playback…",
    feel_lucky: "Feeling lucky",
    search_history_empty: "No search history yet",
    search_history_remove: "Remove from history",
    search_history_clear: "Clear search history",

    // Preview player
    preview_play: "Play preview",
    preview_pause: "Pause",
    preview_loading: "Loading…",
    preview_error: "Failed to load",
    preview_unavailable: "Possibly deleted / unavailable",
    unavailable_badge: "unavailable",
    preview_download: "Download",
    preview_retry: "Retry",
    preview_close: "Close player",

    // Undo
    undo: "Undo",
    track_restored: "Track restored",

    // Select / bulk
    select_mode: "Select multiple",
    bulk_selected: "selected",
    bulk_fav: "Add to favorites",
    bulk_unfav: "Remove from favorites",
    bulk_category: "Add tag",
    bulk_category_prompt: "Tag to add to selected tracks:",
    bulk_playlist: "Add to playlist",
    bulk_export: "Export",
    bulk_delete: "Delete",
    bulk_delete_confirm: "Delete {count} selected tracks?",
    bulk_select_all: "Select all",
    bulk_cancel: "Done",
    bulk_none_selected: "Nothing selected",

    // Recent
    nav_recent: "Recent",
    recent_empty_title: "Nothing yet",
    recent_empty_desc: "Tracks you recently played or opened will show up here",

    // Playlists
    nav_playlists: "Playlists",
    playlists_label: "Playlists",
    playlist_create: "+ New playlist",
    playlist_name_prompt: "Playlist name:",
    playlist_created: 'Playlist "{name}" created',
    playlist_delete_confirm: 'Delete playlist "{name}"?',
    playlist_deleted: "Playlist deleted",
    playlist_add_prompt: "Enter playlist number or a new name:",
    playlist_added: "Added to playlist",
    playlist_empty_title: "This playlist is empty",
    playlist_empty_desc: "Add tracks via select mode → “Add to playlist”",

    // Add/edit form extras
    field_title_paste: "Fetch",
    field_duration_detect: "Detect",
    field_duration_detecting: "Listening…",
    field_duration_not_found: "Could not detect",
    field_id_hint: "Fill in the ID and click “Detect” — duration will be filled in automatically",
  },
};

function t(key, vars = {}) {
  let str = (translations[state.lang] || translations.ru)[key] || key;
  for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

// ─── Theme ────────────────────────────────────────────────────
function setTheme(theme, persist = true) {
  state.theme = theme;
  if (persist) localStorage.setItem(LS_THEME, theme);
  if (theme === "light") {
    document.body.classList.add("light-theme");
    document.getElementById("themeIcon").innerHTML =
      '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  } else {
    document.body.classList.remove("light-theme");
    document.getElementById("themeIcon").innerHTML =
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
}
function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem(LS_LANG, lang);
  document.documentElement.lang = lang;
  document.getElementById("langToggle").textContent =
    lang === "ru" ? "RU" : "EN";
  updateAllTexts();
  buildCategoryList();
  render();
  if (state.modal) openModal(state.modal);
}

function updateAllTexts() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n;
    if (k) el.textContent = t(k);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const k = el.dataset.i18nPlaceholder;
    if (k) el.placeholder = t(k);
  });
  document.querySelectorAll("#sortSelect option").forEach((opt) => {
    const k = opt.dataset.i18n;
    if (k) opt.textContent = t(k);
  });
  document.querySelectorAll(".stat-label[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n;
    if (k) el.textContent = t(k);
  });
  const addTrackBtn = document.getElementById("addTrackBtn");
  if (addTrackBtn) addTrackBtn.title = t("add_track");
  const dlBtn = document.getElementById("downloadAllBtn");
  if (dlBtn) {
    const sp = dlBtn.querySelector("span");
    if (sp) sp.textContent = t("download_all");
  }
  const resetBtn = document.getElementById("resetChangesBtn");
  if (resetBtn) resetBtn.title = t("reset_changes");
  const selectBtn = document.getElementById("selectModeBtn");
  if (selectBtn) selectBtn.title = t("select_mode");
  const bulkLabel = document.querySelector("#bulkBar .bulk-label");
  if (bulkLabel) bulkLabel.textContent = t("bulk_selected");
  const bulkMap = {
    bulkAllBtn: "bulk_select_all",
    bulkFavBtn: "bulk_fav",
    bulkUnfavBtn: "bulk_unfav",
    bulkCatBtn: "bulk_category",
    bulkPlaylistBtn: "bulk_playlist",
    bulkExportBtn: "bulk_export",
    bulkDeleteBtn: "bulk_delete",
    bulkCancelBtn: "bulk_cancel",
  };
  Object.entries(bulkMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });
  buildPlaylistList();
}

// ─── DOM refs ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const DOM = {
  jsonInput: $("jsonInput"),
  searchInput: $("searchInput"),
  searchClear: $("searchClear"),
  sortSelect: $("sortSelect"),
  tracksGrid: $("tracksGrid"),
  contentArea: $("contentArea"),
  emptyState: $("emptyState"),
  noResults: $("noResults"),
  totalCount: $("totalCount"),
  favCount: $("favCount"),
  catCount: $("catCount"),
  shownCount: $("shownCount"),
  navTotal: $("navTotal"),
  navFavs: $("navFavs"),
  navCats: $("navCats"),
  categoryList: $("categoryList"),
  playlistList: $("playlistList"),
  clearFavBtn: $("clearFavBtn"),
  loadSampleBtn: $("loadSampleBtn"),
  emptySampleBtn: $("emptySampleBtn"),
  exportBtn: $("exportBtn"),
  activeFilter: $("activeFilter"),
  activeFilterVal: $("activeFilterVal"),
  filterClear: $("filterClear"),
  sidebar: $("sidebar"),
  sidebarToggle: $("sidebarToggle"),
  viewGrid: $("viewGrid"),
  viewList: $("viewList"),
  modalBackdrop: $("modalBackdrop"),
  trackModal: $("trackModal"),
  modalClose: $("modalClose"),
  modalBody: $("modalBody"),
  toastStack: $("toastStack"),
  dropOverlay: $("dropOverlay"),
  themeToggle: $("themeToggle"),
  langToggle: $("langToggle"),
  statsBar: $("statsBar"),
  miniPlayer: $("miniPlayer"),
  mpPlayBtn: $("mpPlayBtn"),
  mpTitle: $("mpTitle"),
  mpId: $("mpId"),
  mpCurrent: $("mpCurrent"),
  mpTotal: $("mpTotal"),
  mpProgressTrack: $("mpProgressTrack"),
  mpProgressFill: $("mpProgressFill"),
  mpProgressHandle: $("mpProgressHandle"),
  mpStatus: $("mpStatus"),
  mpDownloadBtn: $("mpDownloadBtn"),
  mpVolume: $("mpVolume"),
  mpCloseBtn: $("mpCloseBtn"),
  mpPrevBtn: $("mpPrevBtn"),
  mpNextBtn: $("mpNextBtn"),
  mpShuffleBtn: $("mpShuffleBtn"),
  mpRepeatBtn: $("mpRepeatBtn"),
  mpEq: $("mpEq"),
  bulkBar: null, // injected at init
};

const mediaReducedMotion = window.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);
const mediaCoarsePointer = window.matchMedia?.("(pointer: coarse)");
const isLowPowerDevice = () => {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return (
    cores <= 4 ||
    memory <= 4 ||
    window.innerWidth < 860 ||
    mediaCoarsePointer?.matches
  );
};
const perf = {
  get lowPower() {
    return isLowPowerDevice();
  },
  get maxCanvasDpr() {
    return this.lowPower ? 1 : 1.5;
  },
  get initialRenderLimit() {
    // Рендерим только первый экран сразу — остальное подгружается по
    // мере скролла через IntersectionObserver (см. updateSentinel/growRender).
    // Раньше здесь стояло 9999 ("рендерить всё сразу"), из-за чего при
    // 2900+ треках страница создавала тысячи карточек одним махом и
    // намертво зависала на слабом железе.
    return this.lowPower ? 24 : 40;
  },
  get renderStep() {
    return this.lowPower ? 24 : 40;
  },
};

// ─── Background Canvas (passive, ~20fps, no mouse tracking) ──
(function initCanvas() {
  if (perf.lowPower || mediaReducedMotion?.matches) return;
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  let w = 0,
    h = 0,
    dpr = 1,
    tick = 0;
  // Low-frequency waves: slow, gentle
  const waves = [
    { color: "99,102,241", amp: 20, speed: 0.006, y: 0.22, width: 1.0 },
    { color: "139,92,246", amp: 30, speed: 0.004, y: 0.55, width: 1.2 },
    { color: "244,114,182", amp: 16, speed: 0.008, y: 0.8, width: 0.8 },
  ];
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function drawWave(wave, i) {
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 32) {
      const r = x / Math.max(w, 1);
      const y = h * wave.y + Math.sin(r * 6 + tick * wave.speed + i) * wave.amp;
      x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${wave.color},0.18)`;
    ctx.lineWidth = wave.width;
    ctx.stroke();
  }
  let lastFrame = 0;
  const TARGET_FPS = 20;
  const FRAME_MS = 1000 / TARGET_FPS;
  function loop(now) {
    requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS) return;
    lastFrame = now;
    tick++;
    ctx.clearRect(0, 0, w, h);
    waves.forEach(drawWave);
  }
  window.addEventListener("resize", debounce(resize, 160));
  resize();
  requestAnimationFrame(loop);
})();

function initParallax() {
  // Parallax killed: it triggers body background repaint on every pointermove.
  // Body background uses static radial-gradients now — no JS needed.
}

function motionAllowed() {
  return !mediaReducedMotion?.matches;
}

function initMotionLibraries() {
  if (!motionAllowed() || !window.gsap) return;

  gsap.from(".sidebar-logo, .topbar, .stats-bar", {
    opacity: 0,
    y: 12,
    duration: perf.lowPower ? 0.36 : 0.58,
    stagger: perf.lowPower ? 0.018 : 0.035,
    ease: "power3.out",
    clearProps: "opacity,transform",
  });
}

let cardRevealObserver = null;
function enhanceVisibleCards() {
  if (!motionAllowed() || state.layout === "list" || perf.lowPower) return;
  const cards = [
    ...DOM.tracksGrid.querySelectorAll(".track-card:not(.motion-ready)"),
  ].slice(0, 18);
  if (!cards.length) return;

  if ("IntersectionObserver" in window) {
    cardRevealObserver ||= new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("revealed");
          cardRevealObserver.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: "120px 0px", threshold: 0.08 },
    );
    cards.forEach((card) => {
      card.classList.add("motion-ready");
      cardRevealObserver.observe(card);
    });
    return;
  }

  cards.forEach((card) => card.classList.add("motion-ready", "revealed"));
}

// ─── Persistence ──────────────────────────────────────────────
function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn("LS save failed", e);
  }
}

function loadFavorites() {
  state.favorites = new Set(loadLS(LS_FAVS, []));
}
function saveFavorites() {
  saveLS(LS_FAVS, [...state.favorites]);
}

function loadOverrides() {
  state.overrides = loadLS(LS_OVERRIDES, {});
  state.added = loadLS(LS_ADDED, []);
}
function saveOverrides() {
  saveLS(LS_OVERRIDES, state.overrides);
  saveLS(LS_ADDED, state.added);
}

function loadUnavailable() {
  state.unavailable = new Set(loadLS(LS_UNAVAILABLE, []));
}
function saveUnavailable() {
  saveLS(LS_UNAVAILABLE, [...state.unavailable]);
}

function loadRecent() {
  state.recent = loadLS(LS_RECENT, []);
  pruneRecent();
}
function saveRecent() {
  saveLS(LS_RECENT, state.recent);
}
function pruneRecent() {
  const cutoff = Date.now() - RECENT_TTL_MS;
  const before = state.recent.length;
  state.recent = state.recent.filter((r) => r.ts > cutoff);
  if (state.recent.length !== before) saveRecent();
}
function pushRecent(id) {
  pruneRecent();
  state.recent = state.recent.filter((r) => r.id !== id);
  state.recent.unshift({ id, ts: Date.now() });
  if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
  saveRecent();
  if (state.view === "recent") render();
}

function loadPlaylists() {
  state.playlists = loadLS(LS_PLAYLISTS, {});
}
function savePlaylists() {
  saveLS(LS_PLAYLISTS, state.playlists);
}

// ─── Compute tracks from base + overrides + added ─────────────
function recomputeTracks() {
  state.dataVersion++;
  // Map по id — гарантирует, что на один ID приходится ровно один трек,
  // даже если дубликат сидит в самом исходном JSON или id из "добавленных"
  // совпал с уже существующим в основном списке.
  const byId = new Map();
  state.baseRemote.forEach((track, idx) => {
    const ov = state.overrides[track.id];
    if (ov && ov.deleted) return;
    if (ov && !ov.deleted) {
      byId.set(track.id, ensureTrackTags({ ...ov, _idx: idx, _modified: true }));
    } else {
      byId.set(track.id, ensureTrackTags({ ...track, _idx: idx }));
    }
  });
  state.added.forEach((track, idx) => {
    const ov = state.overrides[track.id];
    if (ov && ov.deleted) {
      byId.delete(track.id);
      return;
    }
    const base = ov && !ov.deleted ? { ...ov } : { ...track };
    byId.set(
      track.id,
      ensureTrackTags({ ...base, _idx: state.baseRemote.length + idx, _added: true }),
    );
  });
  state.tracks = [...byId.values()];
  rebuildSearchIndex();
}

// ─── Fuzzy search (Fuse.js) ────────────────────────────────────
function rebuildSearchIndex() {
  if (typeof Fuse === "undefined") {
    state.fuse = null;
    return;
  }
  state.fuse = new Fuse(state.tracks, {
    keys: [
      { name: "title", weight: 0.55 },
      { name: "tags", weight: 0.3 },
      { name: "id", weight: 0.15 },
    ],
    threshold: 0.36,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

// ─── Remote load ──────────────────────────────────────────────
async function loadRemote() {
  try {
    const res = await fetch(REMOTE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const valid = parseRawTracks(data);
    if (valid.length === 0) {
      toast(t("no_valid_tracks"), "error");
      return;
    }
    state.baseRemote = valid;
    recomputeTracks();
    state.catFilter = null;
    state.query = "";
    DOM.searchInput.value = "";
    DOM.activeFilter.style.display = "none";
    DOM.searchClear.classList.remove("visible");
    DOM.sortSelect.value = "default";
    state.sort = "default";
    updateCounters();
    buildCategoryList();
    render();
    toast(t("remote_load_success", { count: state.tracks.length }), "success");
  } catch (e) {
    console.error("Remote load error:", e);
    toast(t("remote_load_error"), "error");
    // Still show empty state with upload option
    render();
  }
}

// ─── Tag icon palette (кастомные "эмодзи" на SVG) ───────────────
// Маленький монохромный набор — стилистически подходит под остальные
// иконки в приложении (stroke, viewBox 0 0 24 24).
const TAG_ICONS = {
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  fire: '<path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1-1-2-1-2 2 1 3 3 3 5a6 6 0 0 1-12 0c0-5 4-7 4-9 0-1 1-2 2-3z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/>',
  skull:
    '<circle cx="12" cy="11" r="8"/><circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.3" fill="currentColor" stroke="none"/><path d="M9 19v2M15 19v2M8 15h8"/>',
  sword:
    '<line x1="14.5" y1="17.5" x2="3" y2="6" transform="rotate(45 12 12)"/><path d="M4 4l4 1 1 4-4-1z"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>',
  robot:
    '<rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.4" fill="currentColor" stroke="none"/><path d="M12 8V4M9 4h6"/>',
  ghost:
    '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.5-2-2 2-2.5-2-2 2-2.5-2z"/><circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="1" fill="currentColor" stroke="none"/>',
  controller:
    '<rect x="2" y="8" width="20" height="10" rx="4"/><line x1="7" y1="11" x2="7" y2="15"/><line x1="5" y1="13" x2="9" y2="13"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="14" r="1" fill="currentColor" stroke="none"/>',
  headphones:
    '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  crown:
    '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 6-10 15-11 -1 9-5 15-11 15z"/>',
  snowflake:
    '<line x1="12" y1="2" x2="12" y2="22"/><line x1="4" y1="7" x2="20" y2="17"/><line x1="20" y1="7" x2="4" y2="17"/>',
  wave: '<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="17" y2="20"/><line x1="3" y1="9" x2="7" y2="9"/><line x1="3" y1="15" x2="7" y2="15"/><line x1="17" y1="9" x2="21" y2="9"/><line x1="17" y1="15" x2="21" y2="15"/>',
  book: '<path d="M4 4h9a4 4 0 0 1 4 4v13H8a4 4 0 0 0-4 4z"/><path d="M20 4v13"/>',
  gem: '<path d="M3 9l4-6h10l4 6-9 12z"/><path d="M3 9h18M9 3l3 6 3-6"/>',
  paw: '<circle cx="6" cy="9" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5"/>',
  rocket:
    '<path d="M12 2c3 2 5 6 5 10 0 3-1.5 5.5-2.5 7l-5-5c1-1.5 2.5-8 2.5-12z"/><path d="M9 14l-4 2 2-4z"/>',
  puzzle:
    '<path d="M10 4h4v2a2 2 0 0 0 4 0V4h2a2 2 0 0 1 2 2v2h-2a2 2 0 0 0 0 4h2v2a2 2 0 0 1-2 2h-2a2 2 0 0 0-4 0v2h-4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4H4V8a2 2 0 0 1 2-2h2a2 2 0 0 0 4 0z"/>',
  waveform:
    '<line x1="3" y1="12" x2="3" y2="12"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="11" y1="4" x2="11" y2="20"/><line x1="15" y1="9" x2="15" y2="15"/><line x1="19" y1="6" x2="19" y2="18"/>',
};
const TAG_COLORS = [
  "#3ecfff",
  "#7c6fff",
  "#ff6b8a",
  "#f5c842",
  "#39e88c",
  "#ff5566",
  "#ff9f4a",
  "#4ad6c4",
  "#c66bff",
  "#8aa9ff",
];
function tagIconSvg(iconKey, size = 11) {
  const path = TAG_ICONS[iconKey] || TAG_ICONS.note;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${path}</svg>`;
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function defaultTagMeta(tagName) {
  const keys = Object.keys(TAG_ICONS);
  const h = hashStr(tagName);
  return {
    icon: keys[h % keys.length],
    color: TAG_COLORS[h % TAG_COLORS.length],
  };
}
function loadTagMeta() {
  state.tagMeta = loadLS(LS_TAG_META, {});
}
function saveTagMeta() {
  saveLS(LS_TAG_META, state.tagMeta);
}
function getTagMeta(tagName) {
  return state.tagMeta[tagName] || defaultTagMeta(tagName);
}
function setTagMeta(tagName, patch) {
  state.tagMeta[tagName] = { ...getTagMeta(tagName), ...patch };
  saveTagMeta();
}

// ─── Status badges (EDITED / NEW / UNAVAILABLE) — настраиваемые ─
function defaultBadgeMeta(key) {
  return {
    modified: { label: t("modified_badge"), color: "#f5c842", icon: "star" },
    added: { label: t("added_badge"), color: "#39e88c", icon: "bolt" },
    unavailable: { label: t("unavailable_badge"), color: "#ff5566", icon: "ghost" },
  }[key];
}
function loadBadgeMeta() {
  state.badgeMeta = loadLS(LS_BADGE_META, {});
}
function saveBadgeMeta() {
  saveLS(LS_BADGE_META, state.badgeMeta);
}
function getBadgeMeta(key) {
  return { ...defaultBadgeMeta(key), ...(state.badgeMeta[key] || {}) };
}
function setBadgeMeta(key, patch) {
  state.badgeMeta[key] = { ...getBadgeMeta(key), ...patch };
  saveBadgeMeta();
}



// Существующие "category" вида "ANIME/ATTACK ON TITAN" превращаются
// в реальные независимые теги ["ANIME","ATTACK ON TITAN"] — так фильтр
// по одному тегу покажет вообще всё аниме, а по другому — конкретный тайтл.
function normalizeTagForDedup(s) {
  return s
    .toLowerCase()
    .replace(/[|]/g, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function deriveTags(item) {
  if (Array.isArray(item.tags) && item.tags.length) {
    return [...new Set(item.tags.map((s) => String(s).trim()).filter(Boolean))];
  }
  const raw = String(item.category || "Без категории");
  const parts = raw
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return ["Без категории"];
  // Некоторые исходные категории вида "X/X" на самом деле один и тот же
  // тег, просто по-разному отформатированный (лишние пробелы, "|" вместо
  // разделителя и т.п.) — схлопываем такие клоны в один тег.
  const seen = new Set();
  const deduped = [];
  for (const part of parts) {
    const key = normalizeTagForDedup(part);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(part);
  }
  return deduped;
}
function tagsToCategory(tags) {
  return (tags && tags.length ? tags : ["Без категории"]).join(" / ");
}
function ensureTrackTags(track) {
  if (!Array.isArray(track.tags) || !track.tags.length) {
    track.tags = deriveTags(track);
  }
  track.category = tagsToCategory(track.tags);
  return track;
}

function parseRawTracks(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Map();
  arr.forEach((item, i) => {
    if (item.id && item.title !== undefined) {
      const tags = deriveTags(item);
      const id = String(item.id);
      seen.set(id, {
        id,
        title: String(item.title || "Без названия"),
        tags,
        category: tagsToCategory(tags),
        duration:
          typeof item.duration === "number"
            ? item.duration
            : parseInt(item.duration) || 0,
        _idx: i,
      });
    }
  });
  return [...seen.values()];
}

// ─── File load ────────────────────────────────────────────────
function loadTracks(arr) {
  if (!Array.isArray(arr)) {
    toast(t("invalid_json"), "error");
    return false;
  }
  const valid = parseRawTracks(arr);
  if (valid.length === 0) {
    toast(t("no_valid_tracks"), "error");
    return false;
  }
  state.baseRemote = valid;
  recomputeTracks();
  state.catFilter = null;
  state.query = "";
  DOM.searchInput.value = "";
  DOM.activeFilter.style.display = "none";
  DOM.searchClear.classList.remove("visible");
  DOM.sortSelect.value = "default";
  state.sort = "default";
  updateCounters();
  buildCategoryList();
  render();
  return true;
}

function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith(".json") && file.type !== "application/json") {
    toast(t("error_file_type"), "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (loadTracks(data))
        toast(
          t("load_json_success", {
            count: state.tracks.length,
            name: file.name,
          }),
          "success",
        );
    } catch (err) {
      toast(t("error_parse", { msg: err.message }), "error");
    }
  };
  reader.onerror = () => toast(t("error_read"), "error");
  reader.readAsText(file);
}

const SAMPLE_DATA = [
  {
    category: "ANIME/ATTACK ON TITAN",
    id: "131737171257366",
    title: "The Rumbling But it's Lofi",
    duration: 85,
  },
  {
    category: "ANIME/ATTACK ON TITAN",
    id: "78589694220912",
    title: "Vientos serenos",
    duration: 124,
  },
  {
    category: "ANIME/CHAINSAW MAN",
    id: "78556475714069",
    title: "Holy Power",
    duration: 96,
  },
  {
    category: "ANIME/DEMON SLAYER",
    id: "99887766554433",
    title: "Gurenge (Epic Version)",
    duration: 210,
  },
  {
    category: "GAMING/MINECRAFT",
    id: "11223344556677",
    title: "Sweden - Calm Piano",
    duration: 142,
  },
  {
    category: "AMBIENT/LOFI",
    id: "99001122334455",
    title: "Rainy Night Study Session",
    duration: 190,
  },
  {
    category: "GAMING/CYBERPUNK",
    id: "66554433221100",
    title: "Night City Ambience",
    duration: 300,
  },
];

// ─── Toast ────────────────────────────────────────────────────
function toast(msg, type = "info", duration = 2200) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  DOM.toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}

function toastWithUndo(msg, onUndo, duration = 5000) {
  const el = document.createElement("div");
  el.className = "toast info toast-undo";
  const label = document.createElement("span");
  label.textContent = msg;
  const btn = document.createElement("button");
  btn.className = "toast-undo-btn";
  btn.textContent = t("undo");
  let done = false;
  const remove = () => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  btn.addEventListener("click", () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    remove();
    onUndo();
  });
  el.appendChild(label);
  el.appendChild(btn);
  DOM.toastStack.appendChild(el);
  const timer = setTimeout(() => {
    if (!done) remove();
  }, duration);
}

// ─── Helpers ──────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return str.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}
function fmtDuration(sec) {
  sec = parseInt(sec) || 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Preview button icons ───────────────────────────────────────
const ICON_PLAY = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const ICON_LOADING = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="spin-icon"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;
const ICON_BLOCKED = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`;
async function copyText(text, label) {
  if (state.tracks?.some((tr) => tr.id === text)) pushRecent(text);
  try {
    await navigator.clipboard.writeText(text);
    toast(`${t("copied")} ${label || text}`, "success");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast(`${t("copied")} ${label || text}`, "success");
  }
}

// ─── Favorites ────────────────────────────────────────────────
function toggleFav(id) {
  id = String(id);
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    toast(t("toast_info_fav_removed"), "info", 1500);
  } else {
    state.favorites.add(id);
    toast(t("toast_info_fav_added"), "success", 1500);
  }
  saveFavorites();
  updateCounters();
  const star = DOM.tracksGrid.querySelector(`.fav-star[data-id="${id}"]`);
  const card = DOM.tracksGrid.querySelector(`.track-card[data-id="${id}"]`);
  if (star) {
    const f = state.favorites.has(id);
    star.textContent = f ? "★" : "☆";
    star.classList.toggle("active", f);
    if (card) card.classList.toggle("is-fav", f);
  }
  if (state.view === "favorites") render();
}

// ─── Select mode & bulk actions ────────────────────────────────
function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  state.selected.clear();
  const btn = document.getElementById("selectModeBtn");
  if (btn) btn.classList.toggle("active", state.selectMode);
  render();
}

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  const card = DOM.tracksGrid.querySelector(`.track-card[data-id="${id}"]`);
  if (card) card.classList.toggle("is-selected", state.selected.has(id));
  const cb = DOM.tracksGrid.querySelector(`.select-check[data-id="${id}"]`);
  if (cb) cb.checked = state.selected.has(id);
  renderBulkBar();
}

function refreshSelectionVisuals() {
  DOM.tracksGrid.querySelectorAll(".track-card").forEach((card) => {
    const sel = state.selected.has(card.dataset.id);
    card.classList.toggle("is-selected", sel);
    const cb = card.querySelector(".select-check");
    if (cb) cb.checked = sel;
  });
  renderBulkBar();
}

function selectAllVisible() {
  state.currentDisplayed.forEach((tr) => state.selected.add(tr.id));
  refreshSelectionVisuals();
}

function clearSelection() {
  state.selected.clear();
  refreshSelectionVisuals();
}

function renderBulkBar() {
  if (!DOM.bulkBar) return;
  DOM.bulkBar.style.display = state.selectMode ? "flex" : "none";
  const countEl = document.getElementById("bulkCount");
  if (countEl) countEl.textContent = state.selected.size;
}

function bulkRequireSelection() {
  if (state.selected.size === 0) {
    toast(t("bulk_none_selected"), "info");
    return false;
  }
  return true;
}

function bulkSetFavorite(fav) {
  if (!bulkRequireSelection()) return;
  state.selected.forEach((id) => {
    if (fav) state.favorites.add(id);
    else state.favorites.delete(id);
  });
  saveFavorites();
  updateCounters();
  render();
  toast(t(fav ? "toast_info_fav_added" : "toast_info_fav_removed"), "success");
}

function bulkSetCategory() {
  if (!bulkRequireSelection()) return;
  const newTag = prompt(t("bulk_category_prompt"));
  if (!newTag || !newTag.trim()) return;
  const changed = addTagToTracks([...state.selected], newTag.trim());
  toast(t("track_saved") + ` (+${changed})`, "success");
}

function bulkAddToPlaylist() {
  if (!bulkRequireSelection()) return;
  const plId = pickOrCreatePlaylist();
  if (!plId) return;
  const pl = state.playlists[plId];
  state.selected.forEach((id) => {
    if (!pl.ids.includes(id)) pl.ids.push(id);
  });
  savePlaylists();
  buildPlaylistList();
  if (state.view === "playlists") render();
  toast(t("playlist_added"), "success");
}

function bulkExportSelected() {
  if (!bulkRequireSelection()) return;
  const items = state.tracks
    .filter((tr) => state.selected.has(tr.id))
    .map(({ id, title, category, duration, tags }) => ({
      id,
      title,
      category,
      tags,
      duration,
    }));
  const blob = new Blob([JSON.stringify(items, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audiovault-selected-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("toast_success_export", { count: items.length }), "success");
}

function bulkDelete() {
  if (!bulkRequireSelection()) return;
  const ids = [...state.selected];
  if (!confirm(t("bulk_delete_confirm", { count: ids.length }))) return;
  const snapshot = {};
  ids.forEach((id) => {
    snapshot[id] = state.overrides[id]; // may be undefined
    state.overrides[id] = { deleted: true };
  });
  state.selected.clear();
  saveOverrides();
  recomputeTracks();
  updateCounters();
  buildCategoryList();
  render();
  toastWithUndo(t("track_deleted"), () => {
    ids.forEach((id) => {
      if (snapshot[id]) state.overrides[id] = snapshot[id];
      else delete state.overrides[id];
    });
    saveOverrides();
    recomputeTracks();
    updateCounters();
    buildCategoryList();
    render();
    toast(t("track_restored"), "success");
  });
}

// ─── Edit / Delete / Add ──────────────────────────────────────
function deleteTrack(id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;
  const prevOverride = state.overrides[id];
  state.overrides[id] = { deleted: true };
  saveOverrides();
  recomputeTracks();
  updateCounters();
  buildCategoryList();
  render();
  if (state.modal === id) closeModal();
  toastWithUndo(t("track_deleted"), () => {
    if (prevOverride) state.overrides[id] = prevOverride;
    else delete state.overrides[id];
    saveOverrides();
    recomputeTracks();
    updateCounters();
    buildCategoryList();
    render();
    toast(t("track_restored"), "success");
  });
}

function openEditModal(id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;
  openFormModal({
    mode: "edit",
    id: track.id,
    title: track.title,
    tags: track.tags || deriveTags(track),
    duration: track.duration,
  });
}

function openAddModal() {
  openFormModal({ mode: "add", id: "", title: "", tags: [], duration: "" });
}

function openFormModal(opts) {
  closeModal();
  const isEdit = opts.mode === "edit";
  const heading = isEdit ? t("edit_title") : t("add_title");
  const idReadonly = isEdit ? "readonly" : "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";
  backdrop.id = "formModalBackdrop";
  backdrop.innerHTML = `
      <div class="modal form-modal">
        <button class="modal-close" id="formModalClose">×</button>
        <div class="modal-body">
          <div class="modal-cat">${heading}</div>
          <div class="form-fields">
            <label class="form-label">${t("field_title")}
              <div class="form-input-row">
                <input class="form-input" id="fTitle" type="text" value="${esc(opts.title)}" placeholder="${t("field_title")}">
                <button type="button" class="form-mini-btn" id="fTitlePasteBtn">${t("field_title_paste")}</button>
              </div>
            </label>
            <label class="form-label">${t("field_id")}<input class="form-input" id="fId" type="text" value="${esc(opts.id)}" placeholder="e.g. 12345678901234" ${idReadonly}></label>
            <label class="form-label">${t("field_tags")}
              <div class="tag-chip-input" id="fTagsBox">
                <input type="text" id="fTagsText" placeholder="${t("field_tags_placeholder")}" list="tagSuggestions">
              </div>
              <span class="form-hint">${t("field_tags_hint")}</span>
            </label>
            <datalist id="tagSuggestions">${allTagNames()
              .map((c) => `<option value="${esc(c)}">`)
              .join("")}</datalist>
            <label class="form-label">${t("field_duration")}
              <div class="form-input-row">
                <input class="form-input" id="fDuration" type="number" min="0" value="${opts.duration}" placeholder="120">
                <button type="button" class="form-mini-btn" id="fDurationDetectBtn">${t("field_duration_detect")}</button>
              </div>
              <span class="form-hint" id="fDurationHint">${t("field_id_hint")}</span>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" id="formCancelBtn">${t("cancel")}</button>
            <button class="btn-primary" id="formSaveBtn">${t("save")}</button>
          </div>
        </div>
      </div>
    `;
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";

  // ── Tag chip input ──
  let formTags = [...(opts.tags || [])];
  const tagsBox = document.getElementById("fTagsBox");
  const tagsText = document.getElementById("fTagsText");
  function renderChips() {
    tagsBox.querySelectorAll(".tag-chip").forEach((c) => c.remove());
    formTags.forEach((tag) => {
      const meta = getTagMeta(tag);
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.setProperty("--tag-color", meta.color);
      chip.innerHTML = `${tagIconSvg(meta.icon, 10)}${esc(tag)}<button type="button" data-remove="${esc(tag)}">×</button>`;
      tagsBox.insertBefore(chip, tagsText);
    });
  }
  function addChip(raw) {
    const tag = raw.trim();
    if (!tag) return;
    if (!formTags.includes(tag)) formTags.push(tag);
    tagsText.value = "";
    renderChips();
  }
  tagsBox.addEventListener("click", () => tagsText.focus());
  tagsBox.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) formTags = formTags.filter((t) => t !== rm.dataset.remove);
    renderChips();
  });
  tagsText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip(tagsText.value.replace(/,$/, ""));
    } else if (e.key === "Backspace" && !tagsText.value && formTags.length) {
      formTags.pop();
      renderChips();
    }
  });
  tagsText.addEventListener("blur", () => {
    if (tagsText.value.trim()) addChip(tagsText.value);
  });
  renderChips();

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = "";
  };
  document.getElementById("formModalClose").addEventListener("click", close);
  document.getElementById("formCancelBtn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  document
    .getElementById("fTitlePasteBtn")
    .addEventListener("click", async () => {
      const titleInput = document.getElementById("fTitle");
      const btn = document.getElementById("fTitlePasteBtn");
      const idVal = document.getElementById("fId").value.trim() || opts.id;

      if (idVal) {
        const prevText = btn.textContent;
        btn.disabled = true;
        btn.textContent = t("field_duration_detecting");
        const found = await new Promise((resolve) => {
          fetchTitleForId(idVal, (name) => resolve(name));
        });
        btn.disabled = false;
        btn.textContent = prevText;
        if (found) {
          titleInput.value = found;
          return;
        }
      }

      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) {
          titleInput.value = text;
          return;
        }
      } catch {
        // clipboard unavailable/denied — fall through to a generated placeholder
      }
      titleInput.value =
        (state.lang === "ru" ? "Без названия " : "Untitled ") +
        (idVal || "track");
    });

  document
    .getElementById("fDurationDetectBtn")
    .addEventListener("click", () => {
      const idVal = document.getElementById("fId").value.trim();
      const hint = document.getElementById("fDurationHint");
      const btn = document.getElementById("fDurationDetectBtn");
      if (!idVal) {
        toast(t("field_required"), "error");
        return;
      }
      btn.disabled = true;
      btn.textContent = t("field_duration_detecting");
      fetchDurationForId(idVal, (seconds, err) => {
        btn.disabled = false;
        btn.textContent = t("field_duration_detect");
        if (seconds != null) {
          document.getElementById("fDuration").value = seconds;
          hint.textContent = `✓ ${fmtDuration(seconds)} (${seconds}${t("unit_seconds_short")})`;
        } else {
          hint.textContent = t("field_duration_not_found");
        }
      });
    });

  document.getElementById("formSaveBtn").addEventListener("click", () => {
    const newTitle = document.getElementById("fTitle").value.trim();
    const newId = document.getElementById("fId").value.trim();
    if (tagsText.value.trim()) addChip(tagsText.value);
    const newTags = [...formTags];
    const newDuration =
      parseInt(document.getElementById("fDuration").value) || 0;

    if (!newTitle || !newId || !newTags.length) {
      toast(t("field_required"), "error");
      return;
    }

    if (isEdit) {
      const updated = {
        id: opts.id,
        title: newTitle,
        tags: newTags,
        category: tagsToCategory(newTags),
        duration: newDuration,
      };
      state.overrides[opts.id] = updated;
      saveOverrides();
      recomputeTracks();
      toast(t("track_saved"), "success");
    } else {
      // Check ID uniqueness
      if (state.tracks.some((tr) => tr.id === newId)) {
        toast(t("id_exists"), "error");
        return;
      }
      const newTrack = {
        id: newId,
        title: newTitle,
        tags: newTags,
        category: tagsToCategory(newTags),
        duration: newDuration,
      };
      state.added.push(newTrack);
      saveOverrides();
      recomputeTracks();
      toast(t("track_added"), "success");
    }
    updateCounters();
    buildCategoryList();
    render();
    close();
  });

  // Focus first input
  setTimeout(() => {
    document.getElementById("fTitle").focus();
  }, 50);
}

// ─── Download all tracks ──────────────────────────────────────
function feelLucky() {
  const pool = getDisplayed().length ? getDisplayed() : state.tracks;
  if (!pool.length) return;
  const track = pool[Math.floor(Math.random() * pool.length)];
  openModal(track.id);
  toast(`🎲 ${track.title}`, "info");
}

function downloadAllTracks() {
  const data = state.tracks.map(({ id, title, category, duration, tags }) => ({
    id,
    title,
    category,
    tags,
    duration,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audiovault-tracks-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`✓ ${data.length} треков`, "success");
}

function exportFavorites() {
  const favTracks = state.tracks.filter((tr) => state.favorites.has(tr.id));
  if (favTracks.length === 0) {
    toast(t("toast_error_no_fav"), "info");
    return;
  }
  const data = favTracks.map(({ id, title, category, duration, tags }) => ({
    id,
    title,
    category,
    tags,
    duration,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audiovault-favorites-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("toast_success_export", { count: favTracks.length }), "success");
}

function resetAllChanges() {
  if (!confirm(t("reset_confirm"))) return;
  state.overrides = {};
  state.added = [];
  saveOverrides();
  recomputeTracks();
  updateCounters();
  buildCategoryList();
  render();
  toast(t("changes_reset"), "info");
}

// ─── Derived list ─────────────────────────────────────────────
function getDisplayed() {
  let list = [...state.tracks];

  if (state.view === "favorites") {
    list = list.filter((tr) => state.favorites.has(tr.id));
  } else if (state.view === "recent") {
    const order = new Map(state.recent.map((r, i) => [r.id, i]));
    list = list.filter((tr) => order.has(tr.id));
    list.sort((a, b) => order.get(a.id) - order.get(b.id));
  } else if (state.view === "playlists") {
    const pl = state.playlistFilter
      ? state.playlists[state.playlistFilter]
      : null;
    if (pl) {
      const byId = new Map(list.map((tr) => [tr.id, tr]));
      list = pl.ids.map((id) => byId.get(id)).filter(Boolean);
    } else {
      list = [];
    }
  }

  if (state.catFilter)
    list = list.filter((tr) => (tr.tags || []).includes(state.catFilter));

  const q = state.query.trim();
  let fuzzyRanked = false;
  if (q) {
    if (state.fuse) {
      const allowed = new Set(list.map((tr) => tr.id));
      list = state.fuse
        .search(q)
        .map((r) => r.item)
        .filter((tr) => allowed.has(tr.id));
      fuzzyRanked = true;
    } else {
      const ql = q.toLowerCase();
      list = list.filter(
        (tr) =>
          tr.title.toLowerCase().includes(ql) ||
          (tr.tags || []).some((tag) => tag.toLowerCase().includes(ql)) ||
          tr.id.includes(ql),
      );
    }
  }

  // Fuzzy-search results are already ranked by relevance, "recent" is already
  // ordered by recency, and a specific playlist keeps its own manual (drag&drop)
  // order — don't re-sort those unless user chose a sort mode explicitly.
  const keepIncomingOrder =
    (fuzzyRanked && state.sort === "default") ||
    (state.view === "recent" && state.sort === "default") ||
    (state.view === "playlists" &&
      state.playlistFilter &&
      state.sort === "default");

  if (!keepIncomingOrder) {
    switch (state.sort) {
      case "title_asc":
        list.sort((a, b) => a.title.localeCompare(b.title, state.lang));
        break;
      case "title_desc":
        list.sort((a, b) => b.title.localeCompare(a.title, state.lang));
        break;
      case "duration_asc":
        list.sort((a, b) => a.duration - b.duration);
        break;
      case "duration_desc":
        list.sort((a, b) => b.duration - a.duration);
        break;
      case "category_asc":
        list.sort((a, b) => a.category.localeCompare(b.category, state.lang));
        break;
      default:
        list.sort((a, b) => a._idx - b._idx);
        break;
    }
  }
  if (state.view === "all") {
    list.sort((a, b) => {
      const af = state.favorites.has(a.id),
        bf = state.favorites.has(b.id);
      return af && !bf ? -1 : !af && bf ? 1 : 0;
    });
  }
  return list;
}

// ─── Render ───────────────────────────────────────────────────
// content-visibility:auto in CSS skips painting off-screen cards,
// so we can safely dump the full list in one shot.
let renderSignature = "";

function getRenderSignature() {
  return [
    state.view,
    state.catFilter || "",
    state.playlistFilter || "",
    state.query,
    state.sort,
    state.layout,
    state.selectMode,
    state.tracks.length,
    state.favorites.size,
    state.unavailable.size,
    state.dataVersion,
  ].join("|");
}

function updateEmptyMessage() {
  const h3 = DOM.noResults.querySelector("h3");
  const p = DOM.noResults.querySelector("p");
  if (!h3 || !p) return;
  if (state.view === "recent") {
    h3.textContent = t("recent_empty_title");
    p.textContent = t("recent_empty_desc");
  } else if (state.view === "playlists") {
    h3.textContent = t("playlist_empty_title");
    p.textContent = t("playlist_empty_desc");
  } else {
    h3.textContent = t("no_results_title");
    p.textContent = t("no_results_desc");
  }
}

// Progressive rendering: only the first N cards are ever put in the DOM.
// A tiny sentinel element at the end of the grid is watched by an
// IntersectionObserver — scrolling near it silently grows the rendered
// slice. No "load more" button, no manual pagination.
let sentinelObserver = null;

function render() {
  const displayed = getDisplayed();
  state.currentDisplayed = displayed;
  const sig = getRenderSignature();
  const sigChanged = sig !== renderSignature;
  if (sigChanged) {
    renderSignature = sig;
    state.renderedCount = perf.initialRenderLimit;
    if (DOM.contentArea) DOM.contentArea.scrollTop = 0;
  }

  const hasData = state.tracks.length > 0;
  updateEmptyMessage();
  DOM.emptyState.style.display = hasData ? "none" : "flex";
  DOM.noResults.style.display =
    hasData && displayed.length === 0 ? "flex" : "none";
  DOM.tracksGrid.style.display =
    hasData && displayed.length > 0 ? "grid" : "none";
  renderBulkBar();

  if (!hasData || displayed.length === 0) {
    DOM.shownCount.textContent = "0";
    document.getElementById("renderSentinel")?.remove();
    return;
  }

  DOM.tracksGrid.className = `tracks-grid${state.layout === "list" ? " list-view" : ""}${state.selectMode ? " select-mode" : ""}`;
  DOM.shownCount.textContent = displayed.length;

  if (sigChanged) {
    const slice = displayed.slice(0, state.renderedCount);
    DOM.tracksGrid.innerHTML = slice.map(buildCardHTML).join("");
  }
  enhanceVisibleCards();
  updateSentinel();
}

function updateSentinel() {
  const hasMore = state.renderedCount < state.currentDisplayed.length;
  let sentinel = document.getElementById("renderSentinel");
  if (!hasMore) {
    sentinel?.remove();
    return;
  }
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.id = "renderSentinel";
    sentinel.className = "render-sentinel";
  }
  DOM.tracksGrid.appendChild(sentinel); // keep it last
  sentinelObserver ||= new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && growRender()),
    { root: null, rootMargin: "600px 0px" },
  );
  sentinelObserver.observe(sentinel);
}

function growRender() {
  const displayed = state.currentDisplayed;
  if (state.renderedCount >= displayed.length) return;
  const prevCount = state.renderedCount;
  state.renderedCount = Math.min(
    displayed.length,
    state.renderedCount + perf.renderStep,
  );
  const newSlice = displayed.slice(prevCount, state.renderedCount);
  if (newSlice.length) {
    const sentinel = document.getElementById("renderSentinel");
    const wrap = document.createElement("div");
    wrap.innerHTML = newSlice.map(buildCardHTML).join("");
    const frag = document.createDocumentFragment();
    while (wrap.firstElementChild) frag.appendChild(wrap.firstElementChild);
    sentinel
      ? DOM.tracksGrid.insertBefore(frag, sentinel)
      : DOM.tracksGrid.appendChild(frag);
  }
  enhanceVisibleCards();
  updateSentinel();
}

function buildCardHTML(track) {
  const isFav = state.favorites.has(track.id);
  const isUnavailable = state.unavailable.has(track.id);
  const isSelected = state.selected.has(track.id);
  const isPlaying = state.playingId === track.id;
  const dur = fmtDuration(track.duration);
  const robloxUrl = `https://create.roblox.com/store/asset/${track.id}`;
  const modBadge = track._modified
    ? `<span class="track-badge" style="--badge-color:${getBadgeMeta("modified").color}">${tagIconSvg(getBadgeMeta("modified").icon, 9)}${esc(getBadgeMeta("modified").label)}</span>`
    : "";
  const addBadge = track._added
    ? `<span class="track-badge" style="--badge-color:${getBadgeMeta("added").color}">${tagIconSvg(getBadgeMeta("added").icon, 9)}${esc(getBadgeMeta("added").label)}</span>`
    : "";
  const unavailBadge = isUnavailable
    ? `<span class="track-badge" title="${t("preview_unavailable")}" style="--badge-color:${getBadgeMeta("unavailable").color}">${tagIconSvg(getBadgeMeta("unavailable").icon, 9)}${esc(getBadgeMeta("unavailable").label)}</span>`
    : "";
  const selectBox = state.selectMode
    ? `<input type="checkbox" class="select-check" data-id="${track.id}" ${isSelected ? "checked" : ""} aria-label="select">`
    : "";
  const previewIcon = isUnavailable
    ? ICON_BLOCKED
    : isPlaying
      ? ICON_PAUSE
      : ICON_PLAY;
  const previewTitle = isUnavailable
    ? t("preview_unavailable")
    : isPlaying
      ? t("preview_pause")
      : t("preview_play");

  const tagPills = (track.tags || [])
    .map((tag) => {
      const meta = getTagMeta(tag);
      return `<span class="track-tag-pill" data-tag="${esc(tag)}" title="${esc(tag)}" style="--tag-color:${meta.color}">${tagIconSvg(meta.icon, 10)}${esc(tag)}</span>`;
    })
    .join("");

  const isPlaylistReorder =
    state.view === "playlists" && !!state.playlistFilter && !state.selectMode;

  return `
    <div class="track-card${isFav ? " is-fav" : ""}${isUnavailable ? " is-unavailable" : ""}${isSelected ? " is-selected" : ""}${isPlaying ? " is-playing" : ""}${isPlaylistReorder ? " is-draggable" : ""}" data-id="${track.id}" tabindex="0" ${isPlaylistReorder ? 'draggable="true"' : ""}>
      ${isPlaylistReorder ? `<span class="drag-handle" title="${t("drag_reorder")}">${tagIconSvg("waveform", 12)}</span>` : ""}
      <div class="card-header">
        ${selectBox}
        <div class="track-tag-pills">${tagPills}</div>
        <div class="card-header-right">
          ${modBadge}${addBadge}${unavailBadge}
          <button class="fav-star${isFav ? " active" : ""}" data-id="${track.id}">${isFav ? "★" : "☆"}</button>
        </div>
      </div>
      <div class="track-title">${esc(track.title)}</div>
      <div class="track-meta">
        <span class="meta-chip"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dur}</span>
        <span class="meta-chip">${track.duration}${t("unit_seconds_short")}</span>
      </div>
      <div class="card-actions">
        <button class="preview-btn${isUnavailable ? " disabled" : ""}${isPlaying ? " playing" : ""}" data-id="${track.id}" title="${previewTitle}">${previewIcon}</button>
        <button class="copy-id-btn" data-id="${track.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>${track.id}</button>
        <a class="roblox-link" href="${robloxUrl}" target="_blank" rel="noopener noreferrer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Roblox</a>
        <button class="edit-btn" data-id="${track.id}" title="${t("edit_track")}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="delete-btn" data-id="${track.id}" title="${t("delete_track")}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        <button class="detail-btn" data-id="${track.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>
      </div>
    </div>`;
}

function bindGridEvents() {
  DOM.tracksGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".track-card");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest(".select-check")) {
      toggleSelect(id);
      return;
    }
    if (state.selectMode) {
      toggleSelect(id);
      return;
    }
    if (e.target.closest(".track-tag-pill")) {
      const tag = e.target.closest(".track-tag-pill").dataset.tag;
      setCatFilter(tag);
      return;
    }
    if (e.target.closest(".preview-btn")) {
      togglePreview(id);
      return;
    }
    if (e.target.closest(".fav-star")) {
      toggleFav(id);
      return;
    }
    if (e.target.closest(".copy-id-btn")) {
      const tr = state.tracks.find((t) => t.id === id);
      copyText(id, tr?.title);
      return;
    }
    if (e.target.closest(".edit-btn")) {
      openEditModal(id);
      return;
    }
    if (e.target.closest(".delete-btn")) {
      deleteTrack(id);
      return;
    }
    if (e.target.closest(".detail-btn")) {
      openModal(id);
      return;
    }
  });
  DOM.tracksGrid.addEventListener("dblclick", (e) => {
    if (
      e.target.closest(
        ".fav-star, .roblox-link, .copy-id-btn, .edit-btn, .delete-btn, .detail-btn, .preview-btn, .select-check",
      )
    )
      return;
    if (state.selectMode) return;
    const card = e.target.closest(".track-card");
    if (!card) return;
    const tr = state.tracks.find((t) => t.id === card.dataset.id);
    copyText(card.dataset.id, tr?.title);
  });
  DOM.tracksGrid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".track-card");
    if (card) openModal(card.dataset.id);
  });

  // ── Drag&drop reorder within a playlist ──
  let dragSourceId = null;
  DOM.tracksGrid.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".track-card.is-draggable");
    if (!card) {
      e.preventDefault();
      return;
    }
    dragSourceId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragSourceId);
  });
  DOM.tracksGrid.addEventListener("dragend", (e) => {
    e.target.closest(".track-card")?.classList.remove("dragging");
    DOM.tracksGrid
      .querySelectorAll(".drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
    dragSourceId = null;
  });
  DOM.tracksGrid.addEventListener("dragover", (e) => {
    const card = e.target.closest(".track-card.is-draggable");
    if (!card || !dragSourceId || card.dataset.id === dragSourceId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    DOM.tracksGrid
      .querySelectorAll(".drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
    card.classList.add("drag-over");
  });
  DOM.tracksGrid.addEventListener("drop", (e) => {
    const card = e.target.closest(".track-card.is-draggable");
    if (!card || !dragSourceId || card.dataset.id === dragSourceId) return;
    e.preventDefault();
    const targetId = card.dataset.id;
    const pl = state.playlists[state.playlistFilter];
    if (!pl) return;
    const from = pl.ids.indexOf(dragSourceId);
    const to = pl.ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    pl.ids.splice(from, 1);
    pl.ids.splice(to, 0, dragSourceId);
    savePlaylists();
    render();
    toast(t("playlist_reordered"), "success");
  });
}

// ─── Preview playback (mini player) ────────────────────────────
const ICON_PLAY_LG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE_LG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;

let previewAudio = null;
let previewAttemptToken = 0; // guards stale retries after switching tracks

function getPreviewAudio() {
  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.preload = "none";
    const savedVol = parseFloat(localStorage.getItem(LS_VOLUME));
    previewAudio.volume = isNaN(savedVol) ? 0.85 : savedVol;
    previewAudio.addEventListener("timeupdate", updatePlayerProgress);
    previewAudio.addEventListener("loadedmetadata", updatePlayerProgress);
    previewAudio.addEventListener("play", () => {
      syncPlayButtons();
      startWaveform();
    });
    previewAudio.addEventListener("pause", () => {
      syncPlayButtons();
      stopWaveform();
    });
    previewAudio.addEventListener("ended", () => {
      syncPlayButtons();
      updatePlayerProgress();
      stopWaveform();
      handleTrackEnded();
    });
  }
  return previewAudio;
}

// ─── Real waveform (Web Audio AnalyserNode) ────────────────────
// Настоящий анализ частот вместо декоративной анимации. Если ресурс
// не отдаёт CORS-заголовки, анализ молча деградирует до декоративного
// режима — звук при этом всё равно играет нормально.
let waveAudioCtx = null;
let waveAnalyser = null;
let waveSource = null;
let waveData = null;
let waveRAF = null;
let waveSilentFrames = 0;

function ensureWaveGraph(audio) {
  if (waveAnalyser) return true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    waveAudioCtx = new Ctx();
    waveAnalyser = waveAudioCtx.createAnalyser();
    waveAnalyser.fftSize = 64;
    waveAnalyser.smoothingTimeConstant = 0.75;
    waveData = new Uint8Array(waveAnalyser.frequencyBinCount);
    waveSource = waveAudioCtx.createMediaElementSource(audio);
    waveSource.connect(waveAnalyser);
    waveAnalyser.connect(waveAudioCtx.destination);

    // ─── КРИТИЧНО ───────────────────────────────────────────────
    // С этого момента звук трека идёт ТОЛЬКО через этот AudioContext
    // (это необратимо — Web Audio API так устроено). Если браузер
    // когда-нибудь сам приостановит контекст (энергосбережение, уход
    // вкладки в фон и т.п.) — звук пропадёт молча, хотя всё вокруг
    // (прогресс-бар, статус) будет выглядеть так, будто всё играет.
    // Поэтому агрессивно самовосстанавливаемся при малейшей возможности.
    waveAudioCtx.addEventListener("statechange", () => {
      if (waveAudioCtx.state === "suspended" && previewAudio && !previewAudio.paused) {
        waveAudioCtx.resume().catch(() => {});
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        waveAudioCtx?.state === "suspended" &&
        previewAudio &&
        !previewAudio.paused
      ) {
        waveAudioCtx.resume().catch(() => {});
      }
    });
    // На всякий случай ещё и периодическая проверка — не полагаемся
    // только на события, некоторые браузеры их не всегда шлют вовремя.
    setInterval(() => {
      if (waveAudioCtx?.state === "suspended" && previewAudio && !previewAudio.paused) {
        waveAudioCtx.resume().catch(() => {});
      }
    }, 2000);

    return true;
  } catch (e) {
    console.warn("Waveform analysis unavailable, falling back to decorative eq:", e);
    waveAnalyser = null;
    return false;
  }
}

function startWaveform() {
  const audio = previewAudio;
  if (!audio) return;

  // Уже точно знаем, что CORS не поддерживается прокси — даже не пробуем
  // "реальный" режим (это раньше давало ~1.5с "замороженных" баров на
  // каждом треке перед откатом). Сразу декоративная CSS-анимация.
  if (waveformCorsSupported === false) {
    DOM.mpEq?.classList.remove("real");
    return;
  }

  const ok = ensureWaveGraph(audio);
  if (!ok) {
    DOM.mpEq?.classList.remove("real"); // decorative CSS animation takes over
    return;
  }
  // Звук важнее визуализации: всегда пытаемся резюмировать контекст перед
  // стартом, и не полагаемся на то, что это сработает мгновенно/само собой.
  if (waveAudioCtx.state === "suspended") {
    waveAudioCtx.resume().catch(() => {});
  }
  DOM.mpEq?.classList.add("real");
  waveSilentFrames = 0;
  cancelAnimationFrame(waveRAF);

  const bars = DOM.mpEq ? [...DOM.mpEq.querySelectorAll("span")] : [];
  // Группируем частотные бины в N полос (по числу баров) с лёгким весом
  // в сторону низких/средних частот, где обычно видна "жизнь" трека.
  const bandCount = bars.length || 4;
  const prevScale = new Array(bandCount).fill(0.12);

  function tick() {
    waveRAF = requestAnimationFrame(tick);
    waveAnalyser.getByteFrequencyData(waveData);
    let sum = 0;
    const bandsSize = Math.floor(waveData.length / bandCount);
    for (let b = 0; b < bandCount; b++) {
      let bandSum = 0;
      const start = b * bandsSize;
      for (let i = start; i < start + bandsSize; i++) bandSum += waveData[i];
      const avg = bandSum / bandsSize;
      sum += avg;
      // sqrt-кривая делает тихие места заметнее, не убивая динамику громких.
      const norm = Math.min(1, avg / 150);
      const target = Math.max(0.12, Math.sqrt(norm));
      // лёгкое сглаживание, чтобы бары не дёргались хаотично каждый кадр
      const smoothed = prevScale[b] + (target - prevScale[b]) * 0.5;
      prevScale[b] = smoothed;
      if (bars[b]) bars[b].style.transform = `scaleY(${smoothed.toFixed(2)})`;
    }
    // Если звук стабильно "тихий" (не удалось прочитать реальные данные —
    // например, из-за отсутствия CORS у прокси), откатываемся на декор.
    if (sum / bandCount < 2) {
      waveSilentFrames++;
      if (waveSilentFrames > 90) {
        DOM.mpEq?.classList.remove("real");
        bars.forEach((b) => (b.style.transform = ""));
        cancelAnimationFrame(waveRAF);
        return;
      }
    } else {
      waveSilentFrames = 0;
    }
  }
  tick();
}

function stopWaveform() {
  cancelAnimationFrame(waveRAF);
  waveRAF = null;
  DOM.mpEq?.querySelectorAll("span").forEach((b) => (b.style.transform = ""));
}

function togglePreview(id) {
  const track = state.tracks.find((tr) => tr.id === id);
  if (!track) return;
  if (state.unavailable.has(id)) {
    retryTrack(id);
    return;
  }
  const audio = getPreviewAudio();
  if (state.playingId === id) {
    if (audio.paused) audio.play().catch(() => markUnavailable(id));
    else audio.pause();
    return;
  }
  state.playingId = id;
  openPlayer(track);
  syncPlayButtons();
  startPreview(track, 0);
  pushRecent(id);
}

let waveformCorsSupported = null; // null = ещё не знаем, true/false = выяснили

function startPreview(track, attempt) {
  const id = track.id;
  previewAttemptToken++;
  const myToken = previewAttemptToken;
  const audio = getPreviewAudio();
  setButtonLoading(id);
  setPlayerStatus(
    attempt > 0
      ? `${t("preview_loading")} (${attempt + 1}/${PREVIEW_MAX_ATTEMPTS})`
      : t("preview_loading"),
  );

  // Пробуем CORS (нужно для реальной визуализации волны через AnalyserNode)
  // только пока не выяснили, что прокси его не поддерживает. Если это
  // первая проба и она провалится — не тратим один из "настоящих" retry,
  // сразу тихо откатываемся без CORS, чтобы воспроизведение точно работало.
  const tryingCors = attempt === 0 && waveformCorsSupported !== false;
  audio.crossOrigin = tryingCors ? "anonymous" : null;

  const cleanup = () => {
    audio.removeEventListener("canplay", onCanPlay);
    audio.removeEventListener("error", onError);
  };
  const onCanPlay = () => {
    if (myToken !== previewAttemptToken) return cleanup();
    cleanup();
    if (tryingCors) waveformCorsSupported = true;
    audio
      .play()
      .then(() => setPlayerStatus(""))
      .catch(onError);
  };
  const onError = () => {
    if (myToken !== previewAttemptToken) return cleanup();
    cleanup();
    if (tryingCors) {
      waveformCorsSupported = false;
      startPreview(track, attempt); // тот же attempt, но уже без CORS
      return;
    }
    if (attempt + 1 < PREVIEW_MAX_ATTEMPTS) {
      setTimeout(() => {
        if (myToken === previewAttemptToken) startPreview(track, attempt + 1);
      }, 500);
    } else {
      markUnavailable(id);
    }
  };
  audio.addEventListener("canplay", onCanPlay, { once: true });
  audio.addEventListener("error", onError, { once: true });
  audio.src = previewUrl(id);
  audio.load();
}

function markUnavailable(id) {
  state.unavailable.add(id);
  saveUnavailable();
  if (state.playingId === id) state.playingId = null;
  syncPlayButtons();
  setPlayerStatus(t("preview_error"), true);
  const card = DOM.tracksGrid.querySelector(`.track-card[data-id="${id}"]`);
  if (card) {
    card.classList.add("is-unavailable");
    if (!card.querySelector(".badge-unavailable")) {
      const right = card.querySelector(".card-header-right");
      if (right) {
        const meta = getBadgeMeta("unavailable");
        const badge = document.createElement("span");
        badge.className = "track-badge";
        badge.style.setProperty("--badge-color", meta.color);
        badge.title = t("preview_unavailable");
        badge.innerHTML = tagIconSvg(meta.icon, 9) + esc(meta.label);
        right.insertBefore(badge, right.firstChild);
      }
    }
  }
  toast(`${t("preview_error")}: ${t("preview_unavailable")}`, "error");
}

function retryTrack(id) {
  state.unavailable.delete(id);
  saveUnavailable();

  // Не полагаемся только на render() — сигнатура рендера кешируется, а
  // markUnavailable() ставит метку "недоступен" точечным патчем DOM, минуя
  // render(). Из-за этого сигнатура могла ни разу не узнать, что где-то
  // появлялась недоступность, и retry визуально ничего не менял. Поэтому
  // чистим карточку и кнопку так же точечно, зеркально markUnavailable().
  const card = DOM.tracksGrid.querySelector(`.track-card[data-id="${id}"]`);
  if (card) {
    card.classList.remove("is-unavailable");
    card
      .querySelectorAll(".track-badge")
      .forEach((b) => {
        if (b.title === t("preview_unavailable")) b.remove();
      });
    const btn = card.querySelector(".preview-btn");
    if (btn) {
      btn.classList.remove("disabled");
      btn.innerHTML = ICON_PLAY;
      btn.title = t("preview_play");
    }
  }

  render();
  if (state.modal === id) openModal(id);
  toast(t("retry_track_started"), "info");
  togglePreview(id);
}

function setButtonLoading(id) {
  const btn = DOM.tracksGrid.querySelector(`.preview-btn[data-id="${id}"]`);
  if (btn) {
    btn.innerHTML = ICON_LOADING;
    btn.classList.remove("playing", "disabled");
  }
}

function syncPlayButtons() {
  const audio = previewAudio;
  DOM.tracksGrid.querySelectorAll(".preview-btn").forEach((btn) => {
    const id = btn.dataset.id;
    if (state.unavailable.has(id)) {
      btn.innerHTML = ICON_BLOCKED;
      btn.classList.add("disabled");
      btn.classList.remove("playing");
      return;
    }
    btn.classList.remove("disabled");
    if (id === state.playingId && audio && !audio.paused) {
      btn.innerHTML = ICON_PAUSE;
      btn.classList.add("playing");
    } else {
      btn.innerHTML = ICON_PLAY;
      btn.classList.remove("playing");
    }
  });
  DOM.tracksGrid.querySelectorAll(".track-card").forEach((c) => {
    c.classList.toggle(
      "is-playing",
      c.dataset.id === state.playingId && previewAudio && !previewAudio.paused,
    );
  });
  DOM.miniPlayer?.classList.toggle(
    "is-playing",
    !!(previewAudio && !previewAudio.paused && state.playingId),
  );
  updatePlayerPlayButton();
}

function openPlayer(track) {
  if (!DOM.miniPlayer) return;
  DOM.miniPlayer.classList.add("open");
  document.body.classList.add("has-mini-player");
  DOM.mpTitle.textContent = track.title;
  DOM.mpId.textContent = track.id;
  setPlayerStatus("");
  DOM.mpProgressFill.style.width = "0%";
  DOM.mpProgressHandle.style.left = "0%";
  DOM.mpCurrent.textContent = "0:00";
  DOM.mpTotal.textContent = fmtDuration(track.duration);
}

// Cross-origin <a download> is ignored by browsers for security reasons —
// so we fetch the bytes ourselves and download a same-origin Blob URL instead.
async function downloadPreviewFile(track) {
  const btn = DOM.mpDownloadBtn;
  const prevHTML = btn ? btn.innerHTML : "";
  try {
    if (btn) {
      btn.innerHTML = ICON_LOADING;
      btn.classList.add("disabled");
    }
    const res = await fetch(previewUrl(track.id));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer.slice(0, 4));
    const isOgg = String.fromCharCode(...bytes) === "OggS";
    const blob = new Blob([buffer], {
      type: isOgg ? "audio/ogg" : "audio/mpeg",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(track.title || track.id).replace(/[\\/:*?"<>|]/g, "_")}.${isOgg ? "ogg" : "mp3"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    toast(t("preview_error"), "error");
  } finally {
    if (btn) {
      btn.innerHTML = prevHTML;
      btn.classList.remove("disabled");
    }
  }
}

function closePlayer() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.removeAttribute("src");
    previewAudio.load();
  }
  state.playingId = null;
  DOM.miniPlayer?.classList.remove("open");
  document.body.classList.remove("has-mini-player");
  syncPlayButtons();
}

function updatePlayerProgress() {
  const audio = previewAudio;
  if (!audio || !DOM.miniPlayer) return;
  const track = state.tracks.find((tr) => tr.id === state.playingId);
  const dur =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : track?.duration || 0;
  const cur = audio.currentTime || 0;
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  DOM.mpProgressFill.style.width = pct + "%";
  DOM.mpProgressHandle.style.left = pct + "%";
  DOM.mpCurrent.textContent = fmtDuration(Math.floor(cur));
  if (dur) DOM.mpTotal.textContent = fmtDuration(Math.floor(dur));
}

function updatePlayerPlayButton() {
  if (!DOM.mpPlayBtn) return;
  const playing = !!(previewAudio && !previewAudio.paused && state.playingId);
  DOM.mpPlayBtn.innerHTML = playing ? ICON_PAUSE_LG : ICON_PLAY_LG;
}

function setPlayerStatus(text, isError = false) {
  if (!DOM.mpStatus) return;
  DOM.mpStatus.textContent = text;
  DOM.mpStatus.classList.toggle("mp-status-error", !!isError);
}

function seekPlayerFromEvent(e) {
  const audio = previewAudio;
  if (!audio || !DOM.mpProgressTrack || !state.playingId) return;
  const rect = DOM.mpProgressTrack.getBoundingClientRect();
  if (rect.width <= 0) return;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  // audio.duration can be Infinity/NaN for some Ogg streams until fully
  // scanned — fall back to the known catalog duration so seeking never
  // collapses to 0.
  const track = state.tracks.find((tr) => tr.id === state.playingId);
  const knownDuration =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : track?.duration || 0;
  if (!knownDuration) return;
  try {
    audio.currentTime = ratio * knownDuration;
  } catch {
    // some browsers throw if seeking before the element is ready — ignore
  }
  updatePlayerProgress();
}

// ─── Queue navigation (prev/next/shuffle/repeat) ───────────────
function loadPlayMode() {
  const saved = loadLS(LS_PLAYMODE, null);
  if (saved) {
    state.shuffle = !!saved.shuffle;
    state.repeat = ["off", "all", "one"].includes(saved.repeat)
      ? saved.repeat
      : "off";
  }
}
function savePlayMode() {
  saveLS(LS_PLAYMODE, { shuffle: state.shuffle, repeat: state.repeat });
}

// ─── Search history ("сохранённые/недавние поисковые запросы") ─
function loadSearchHistory() {
  return loadLS(LS_SEARCH_HISTORY, []);
}
function pushSearchHistory(q) {
  q = q.trim();
  if (q.length < 2) return;
  let hist = loadSearchHistory();
  hist = hist.filter((h) => h.toLowerCase() !== q.toLowerCase());
  hist.unshift(q);
  if (hist.length > SEARCH_HISTORY_MAX) hist.length = SEARCH_HISTORY_MAX;
  saveLS(LS_SEARCH_HISTORY, hist);
}
function removeSearchHistoryItem(q) {
  const hist = loadSearchHistory().filter((h) => h !== q);
  saveLS(LS_SEARCH_HISTORY, hist);
  renderSearchHistory();
}
function clearSearchHistory() {
  saveLS(LS_SEARCH_HISTORY, []);
  renderSearchHistory();
}
function renderSearchHistory() {
  const box = document.getElementById("searchHistory");
  if (!box) return;
  const hist = loadSearchHistory();
  if (!hist.length) {
    box.innerHTML = `<div class="search-history-empty">${t("search_history_empty")}</div>`;
    return;
  }
  const iconClock = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`;
  box.innerHTML =
    hist
      .map(
        (q) => `
      <button class="search-history-item" data-q="${esc(q)}">
        ${iconClock}<span>${esc(q)}</span>
        <span class="sh-remove" data-remove="${esc(q)}" title="${t("search_history_remove")}">×</span>
      </button>`,
      )
      .join("") +
    `<button class="search-history-clear" id="searchHistoryClearBtn">${t("search_history_clear")}</button>`;
}
function openSearchHistory() {
  renderSearchHistory();
  document.getElementById("searchHistory")?.classList.add("open");
}
function closeSearchHistory() {
  document.getElementById("searchHistory")?.classList.remove("open");
}

function playableQueue() {
  // Same order the user currently sees, minus tracks known to fail preview.
  return state.currentDisplayed.filter((tr) => !state.unavailable.has(tr.id));
}

function queueNeighbor(dir) {
  const queue = playableQueue();
  if (!queue.length) return null;
  const curIdx = queue.findIndex((tr) => tr.id === state.playingId);
  if (state.shuffle) {
    if (queue.length === 1) return queue[0];
    let pick;
    do {
      pick = queue[Math.floor(Math.random() * queue.length)];
    } while (pick.id === state.playingId);
    return pick;
  }
  if (curIdx === -1) return queue[0];
  const nextIdx = (curIdx + dir + queue.length) % queue.length;
  return queue[nextIdx];
}

function playNext(auto = false) {
  const track = queueNeighbor(1);
  if (!track) return;
  state.playingId = track.id;
  openPlayer(track);
  syncPlayButtons();
  startPreview(track, 0);
  if (!auto) pushRecent(track.id);
}

function playPrev() {
  const track = queueNeighbor(-1);
  if (!track) return;
  state.playingId = track.id;
  openPlayer(track);
  syncPlayButtons();
  startPreview(track, 0);
}

function handleTrackEnded() {
  if (state.repeat === "one") {
    const track = state.tracks.find((tr) => tr.id === state.playingId);
    if (track) {
      startPreview(track, 0);
      return;
    }
  }
  const queue = playableQueue();
  const curIdx = queue.findIndex((tr) => tr.id === state.playingId);
  const isLast = curIdx === queue.length - 1;
  if (isLast && state.repeat === "off" && !state.shuffle) {
    closePlayer();
    return;
  }
  playNext(true);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  savePlayMode();
  DOM.mpShuffleBtn?.classList.toggle("active", state.shuffle);
  toast(
    state.shuffle ? t("shuffle_on") : t("shuffle_off"),
    "info",
    1400,
  );
}

function cycleRepeat() {
  state.repeat =
    state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  savePlayMode();
  DOM.mpRepeatBtn?.classList.toggle("active", state.repeat !== "off");
  DOM.mpRepeatBtn?.classList.toggle("repeat-one", state.repeat === "one");
  const msg =
    state.repeat === "all"
      ? t("repeat_all")
      : state.repeat === "one"
        ? t("repeat_one")
        : t("repeat_off");
  toast(msg, "info", 1400);
}

function bindMiniPlayerEvents() {
  if (!DOM.miniPlayer) return;
  DOM.mpPlayBtn?.addEventListener("click", () => {
    if (state.playingId) togglePreview(state.playingId);
  });
  DOM.mpCloseBtn?.addEventListener("click", closePlayer);
  DOM.mpPrevBtn?.addEventListener("click", playPrev);
  DOM.mpNextBtn?.addEventListener("click", () => playNext(false));
  DOM.mpShuffleBtn?.addEventListener("click", toggleShuffle);
  DOM.mpRepeatBtn?.addEventListener("click", cycleRepeat);
  DOM.mpDownloadBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    const track = state.tracks.find((tr) => tr.id === state.playingId);
    if (track) downloadPreviewFile(track);
  });

  let seeking = false;
  DOM.mpProgressTrack?.addEventListener("mousedown", (e) => {
    seeking = true;
    seekPlayerFromEvent(e);
  });
  DOM.mpProgressTrack?.addEventListener("touchstart", (e) => {
    seeking = true;
    seekPlayerFromEvent(e);
  });
  window.addEventListener("mousemove", (e) => {
    if (seeking) seekPlayerFromEvent(e);
  });
  window.addEventListener("touchmove", (e) => {
    if (seeking) seekPlayerFromEvent(e);
  });
  window.addEventListener("mouseup", () => (seeking = false));
  window.addEventListener("touchend", () => (seeking = false));

  if (DOM.mpVolume) {
    const savedVol = parseFloat(localStorage.getItem(LS_VOLUME));
    DOM.mpVolume.value = isNaN(savedVol) ? 0.85 : savedVol;
    DOM.mpVolume.addEventListener("input", () => {
      const v = parseFloat(DOM.mpVolume.value);
      getPreviewAudio().volume = v;
      localStorage.setItem(LS_VOLUME, String(v));
    });
  }
}

// ─── Auto-detect duration via the preview proxy (used in add/edit form) ──
function fetchDurationForId(id, onResult) {
  if (!id) {
    onResult(null, "no_id");
    return;
  }
  const probe = new Audio();
  probe.preload = "metadata";
  const cleanup = () => {
    probe.removeEventListener("loadedmetadata", onMeta);
    probe.removeEventListener("error", onErr);
  };
  const onMeta = () => {
    cleanup();
    onResult(Math.round(probe.duration) || 0, null);
  };
  const onErr = () => {
    cleanup();
    onResult(null, "not_found");
  };
  probe.addEventListener("loadedmetadata", onMeta, { once: true });
  probe.addEventListener("error", onErr, { once: true });
  probe.src = previewUrl(id);
  probe.load();
}

// ─── Auto-fetch the real asset name via the Worker (/title/:id route) ──
async function fetchTitleForId(id, onResult) {
  if (!id) {
    onResult(null, "no_id");
    return;
  }
  try {
    const res = await fetch(`${AUDIO_PROXY_BASE}/title/${id}`);
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.name) {
      onResult(data.name, null);
    } else {
      onResult(null, "not_found");
    }
  } catch {
    onResult(null, "network_error");
  }
}

// ─── Counters ─────────────────────────────────────────────────
function updateCounters() {
  DOM.totalCount.textContent = state.tracks.length;
  DOM.favCount.textContent = state.favorites.size;
  DOM.navTotal.textContent = state.tracks.length;
  DOM.navFavs.textContent = state.favorites.size;
  const cats = new Set();
  state.tracks.forEach((tr) => (tr.tags || []).forEach((tg) => cats.add(tg)));
  DOM.catCount.textContent = cats.size;
  DOM.navCats.textContent = cats.size;
  const navRecent = document.getElementById("navRecent");
  if (navRecent) navRecent.textContent = state.recent.length;
  const navPlaylists = document.getElementById("navPlaylists");
  if (navPlaylists)
    navPlaylists.textContent = Object.keys(state.playlists).length;
  // Show/hide reset button
  const hasChanges =
    Object.keys(state.overrides).length > 0 || state.added.length > 0;
  const resetBtn = document.getElementById("resetChangesBtn");
  if (resetBtn) resetBtn.style.display = hasChanges ? "flex" : "none";
}

// ─── Category list ────────────────────────────────────────────
function buildCategoryList() {
  const catMap = {};
  state.tracks.forEach((tr) => {
    (tr.tags || []).forEach((tag) => {
      catMap[tag] = (catMap[tag] || 0) + 1;
    });
  });
  const sorted = Object.entries(catMap).sort((a, b) =>
    a[0].localeCompare(b[0], state.lang),
  );
  if (sorted.length === 0) {
    DOM.categoryList.innerHTML = "";
    return;
  }
  let html = `<div class="cat-section-label">${t("categories_label")}<button class="tag-editor-open-btn" id="openTagEditorBtn" title="${t("tag_editor_title")}">${tagIconSvg("puzzle", 12)}</button></div>`;
  sorted.forEach(([tag, cnt]) => {
    const isActive = state.catFilter === tag;
    const meta = getTagMeta(tag);
    html += `<button class="cat-item${isActive ? " active-cat" : ""}" data-cat="${esc(tag)}" style="--tag-color:${meta.color}">
            <span class="dot" style="background:${meta.color}">${tagIconSvg(meta.icon, 9)}</span>
            <span class="cat-name" title="${esc(tag)}">${esc(tag)}</span>
            <span class="cat-cnt">${cnt}</span>
        </button>`;
  });
  DOM.categoryList.innerHTML = html;
  DOM.categoryList.querySelectorAll(".cat-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      if (state.catFilter === cat) setCatFilter(null);
      else setCatFilter(cat);
    });
  });
  document
    .getElementById("openTagEditorBtn")
    ?.addEventListener("click", openTagEditor);
}

function updateTrackTags(id, newTags) {
  const tr = state.tracks.find((t) => t.id === id);
  if (!tr) return;
  let tags = [...new Set(newTags.map((s) => String(s).trim()).filter(Boolean))];
  if (!tags.length) tags = ["Без категории"];
  const addedIdx = state.added.findIndex((a) => a.id === id);
  if (addedIdx !== -1) {
    state.added[addedIdx] = {
      ...state.added[addedIdx],
      tags,
      category: tagsToCategory(tags),
    };
  } else {
    state.overrides[id] = {
      id: tr.id,
      title: tr.title,
      duration: tr.duration,
      tags,
      category: tagsToCategory(tags),
    };
  }
}

function renameTagEverywhere(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return 0;
  let changed = 0;
  state.tracks.forEach((tr) => {
    if ((tr.tags || []).includes(oldName)) {
      updateTrackTags(
        tr.id,
        tr.tags.map((t) => (t === oldName ? newName : t)),
      );
      changed++;
    }
  });
  if (state.tagMeta[oldName] && !state.tagMeta[newName]) {
    state.tagMeta[newName] = state.tagMeta[oldName];
  }
  delete state.tagMeta[oldName];
  saveTagMeta();
  saveOverrides();
  recomputeTracks();
  buildCategoryList();
  render();
  return changed;
}

function deleteTagEverywhere(name) {
  let changed = 0;
  state.tracks.forEach((tr) => {
    if ((tr.tags || []).includes(name)) {
      updateTrackTags(
        tr.id,
        tr.tags.filter((t) => t !== name),
      );
      changed++;
    }
  });
  delete state.tagMeta[name];
  saveTagMeta();
  saveOverrides();
  recomputeTracks();
  buildCategoryList();
  render();
  return changed;
}

function addTagToTracks(ids, tagName) {
  tagName = tagName.trim();
  if (!tagName) return 0;
  let changed = 0;
  ids.forEach((id) => {
    const tr = state.tracks.find((t) => t.id === id);
    if (!tr) return;
    if ((tr.tags || []).includes(tagName)) return;
    updateTrackTags(id, [...(tr.tags || []), tagName]);
    changed++;
  });
  saveOverrides();
  recomputeTracks();
  buildCategoryList();
  render();
  return changed;
}

// ─── Tag editor (полноценное управление тегами) ────────────────
let tagEditorReady = false;

function ensureTagEditorDOM() {
  if (tagEditorReady) return;
  tagEditorReady = true;
  const overlay = document.createElement("div");
  overlay.className = "tag-editor-overlay";
  overlay.id = "tagEditorOverlay";
  overlay.innerHTML = `
    <div class="tag-editor-modal">
      <div class="tag-editor-head">
        <h3>${t("tag_editor_title")}</h3>
        <button class="modal-close-btn" id="tagEditorCloseBtn">×</button>
      </div>
      <div class="tag-editor-tabs">
        <button class="tag-editor-tab active" data-tab="tags">${tagIconSvg("puzzle", 13)}${t("tab_tags")}</button>
        <button class="tag-editor-tab" data-tab="badges">${tagIconSvg("star", 13)}${t("tab_badges")}</button>
      </div>

      <div class="tag-editor-pane" id="paneTags">
        <p class="tag-editor-hint">${t("tag_editor_hint")}</p>
        <div class="tag-editor-new-row">
          <input type="text" id="tagEditorNewInput" placeholder="${t("tag_editor_new_placeholder")}" />
          <button class="btn-secondary" id="tagEditorNewBtn">${t("tag_editor_create")}</button>
        </div>
        <div class="tag-editor-list" id="tagEditorList"></div>
      </div>

      <div class="tag-editor-pane" id="paneBadges" style="display:none">
        <p class="tag-editor-hint">${t("badge_editor_hint")}</p>
        <div class="badge-editor-list" id="badgeEditorList"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTagEditor();
  });
  document
    .getElementById("tagEditorCloseBtn")
    .addEventListener("click", closeTagEditor);

  overlay.querySelectorAll(".tag-editor-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      overlay
        .querySelectorAll(".tag-editor-tab")
        .forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      const isTags = tab.dataset.tab === "tags";
      document.getElementById("paneTags").style.display = isTags ? "" : "none";
      document.getElementById("paneBadges").style.display = isTags ? "none" : "";
    });
  });

  renderBadgeEditorList();
  const createNewTag = () => {
    const input = document.getElementById("tagEditorNewInput");
    const name = input.value.trim();
    if (!name) return;
    if (!state.tagMeta[name]) {
      state.tagMeta[name] = defaultTagMeta(name);
      saveTagMeta();
    }
    input.value = "";
    renderTagEditorList();
    toast(t("tag_editor_created", { name }), "success");
  };
  document
    .getElementById("tagEditorNewBtn")
    .addEventListener("click", createNewTag);
  document
    .getElementById("tagEditorNewInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") createNewTag();
    });
}

function renderBadgeEditorList() {
  const list = document.getElementById("badgeEditorList");
  if (!list) return;
  const keys = ["modified", "added", "unavailable"];
  list.innerHTML = keys
    .map((key) => {
      const meta = getBadgeMeta(key);
      return `
      <div class="badge-editor-row" data-key="${key}">
        <button class="tag-swatch" data-role="icon-toggle" style="background:${meta.color}">${tagIconSvg(meta.icon, 14)}</button>
        <input type="color" class="tag-color-input" data-role="color" value="${meta.color}" title="${t("tag_editor_color")}" />
        <input type="text" class="badge-label-input" data-role="label" value="${esc(meta.label)}" maxlength="16" />
        <span class="track-badge" style="--badge-color:${meta.color}">${tagIconSvg(meta.icon, 9)}${esc(meta.label)}</span>
        <button class="icon-btn-sm" data-role="reset" title="${t("badge_editor_reset")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.89"/></svg>
        </button>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".badge-editor-row").forEach((row) => {
    const key = row.dataset.key;
    const preview = row.querySelector(".track-badge");
    const swatch = row.querySelector('[data-role="icon-toggle"]');
    row.querySelector('[data-role="color"]').addEventListener("input", (e) => {
      setBadgeMeta(key, { color: e.target.value });
      preview.style.setProperty("--badge-color", e.target.value);
      swatch.style.background = e.target.value;
      render();
    });
    row.querySelector('[data-role="label"]').addEventListener("input", (e) => {
      setBadgeMeta(key, { label: e.target.value });
      preview.innerHTML = tagIconSvg(getBadgeMeta(key).icon, 9) + esc(e.target.value);
      render();
    });
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      openIconPicker(e.currentTarget, getBadgeMeta(key).icon, (icon) => {
        setBadgeMeta(key, { icon });
        renderBadgeEditorList();
        render();
      });
    });
    row.querySelector('[data-role="reset"]').addEventListener("click", () => {
      delete state.badgeMeta[key];
      saveBadgeMeta();
      renderBadgeEditorList();
      render();
    });
  });
}

function openTagEditor() {
  ensureTagEditorDOM();
  renderTagEditorList();
  renderBadgeEditorList();
  document.getElementById("tagEditorOverlay").classList.add("open");
}
function closeTagEditor() {
  document.getElementById("tagEditorOverlay")?.classList.remove("open");
  closeIconPicker();
}

function allTagNames() {
  const set = new Set(Object.keys(state.tagMeta));
  state.tracks.forEach((tr) => (tr.tags || []).forEach((tg) => set.add(tg)));
  return [...set].sort((a, b) => a.localeCompare(b, state.lang));
}

// ─── Shared floating icon picker (не зависит от overflow/scroll
// родительских контейнеров — раньше поповер клипался внутри списка) ────
let iconPickerEl = null;
let iconPickerOnSelect = null;

function ensureIconPicker() {
  if (iconPickerEl) return iconPickerEl;
  iconPickerEl = document.createElement("div");
  iconPickerEl.className = "icon-picker-popover";
  iconPickerEl.id = "iconPickerPopover";
  document.body.appendChild(iconPickerEl);
  iconPickerEl.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => closeIconPicker());
  window.addEventListener("scroll", () => closeIconPicker(), true);
  window.addEventListener("resize", () => closeIconPicker());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeIconPicker();
  });
  return iconPickerEl;
}

function openIconPicker(anchorEl, currentIcon, onSelect) {
  const el = ensureIconPicker();
  iconPickerOnSelect = onSelect;
  el.innerHTML = Object.keys(TAG_ICONS)
    .map(
      (key) =>
        `<button class="tag-icon-opt${key === currentIcon ? " active" : ""}" data-icon="${key}">${tagIconSvg(key, 15)}</button>`,
    )
    .join("");
  el.querySelectorAll(".tag-icon-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      iconPickerOnSelect?.(btn.dataset.icon);
      closeIconPicker();
    });
  });

  const rect = anchorEl.getBoundingClientRect();
  const popW = 220;
  const popH = 130;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (top + popH > window.innerHeight - 8) top = rect.top - popH - 6;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  el.classList.add("open");
}

function closeIconPicker() {
  iconPickerEl?.classList.remove("open");
  iconPickerOnSelect = null;
}

function renderTagEditorList() {
  const list = document.getElementById("tagEditorList");
  if (!list) return;
  const counts = {};
  state.tracks.forEach((tr) =>
    (tr.tags || []).forEach((tg) => (counts[tg] = (counts[tg] || 0) + 1)),
  );
  const names = allTagNames();
  if (!names.length) {
    list.innerHTML = `<div class="tag-editor-empty">${t("tag_editor_empty")}</div>`;
    return;
  }
  list.innerHTML = names
    .map((name) => {
      const meta = getTagMeta(name);
      const cnt = counts[name] || 0;
      return `
      <div class="tag-editor-row" data-tag="${esc(name)}">
        <button class="tag-swatch" data-role="icon-toggle" style="background:${meta.color}">${tagIconSvg(meta.icon, 14)}</button>
        <input type="color" class="tag-color-input" data-role="color" value="${meta.color}" title="${t("tag_editor_color")}" />
        <span class="tag-editor-name" title="${esc(name)}">${esc(name)}</span>
        <span class="tag-editor-count">${cnt}</span>
        <button class="icon-btn-sm" data-role="rename" title="${t("tag_editor_rename")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn-sm danger" data-role="delete" title="${t("tag_editor_delete")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".tag-editor-row").forEach((row) => {
    const name = row.dataset.tag;
    row
      .querySelector('[data-role="icon-toggle"]')
      .addEventListener("click", (e) => {
        e.stopPropagation();
        openIconPicker(e.currentTarget, getTagMeta(name).icon, (icon) => {
          setTagMeta(name, { icon });
          renderTagEditorList();
          render();
          buildCategoryList();
        });
      });
    row.querySelector('[data-role="color"]').addEventListener("input", (e) => {
      setTagMeta(name, { color: e.target.value });
      row.querySelector('[data-role="icon-toggle"]').style.background = e.target.value;
      render();
      buildCategoryList();
    });
    row.querySelector('[data-role="rename"]').addEventListener("click", () => {
      const newName = prompt(t("tag_editor_rename_prompt", { name }), name);
      if (!newName || !newName.trim() || newName.trim() === name) return;
      const changed = renameTagEverywhere(name, newName.trim());
      renderTagEditorList();
      toast(t("tag_editor_renamed", { count: changed }), "success");
    });
    row.querySelector('[data-role="delete"]').addEventListener("click", () => {
      const cnt = counts[name] || 0;
      if (
        !confirm(
          cnt
            ? t("tag_editor_delete_confirm", { name, count: cnt })
            : t("tag_editor_delete_confirm_empty", { name }),
        )
      )
        return;
      deleteTagEverywhere(name);
      renderTagEditorList();
      toast(t("tag_editor_deleted", { name }), "info");
    });
  });
}

function setCatFilter(cat) {
  state.catFilter = cat;
  if (cat) {
    DOM.activeFilter.style.display = "flex";
    DOM.activeFilterVal.textContent = cat;
    if (state.view !== "all") setView("all", false);
  } else DOM.activeFilter.style.display = "none";
  buildCategoryList();
  render();
}

function setView(v, clearCat = true) {
  state.view = v;
  if (clearCat && v !== "all") {
    state.catFilter = null;
    DOM.activeFilter.style.display = "none";
  }
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === v);
  });
  buildCategoryList();
  buildPlaylistList();
  render();
}

// ─── Playlists ──────────────────────────────────────────────────
function createPlaylist(name) {
  const id = `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  state.playlists[id] = { name, ids: [] };
  savePlaylists();
  return id;
}

function pickOrCreatePlaylist() {
  const existing = Object.entries(state.playlists);
  const listStr = existing
    .map(([id, pl], i) => `${i + 1}. ${pl.name} (${pl.ids.length})`)
    .join("\n");
  const hint = existing.length
    ? `${listStr}\n\n${t("playlist_add_prompt")}`
    : t("playlist_name_prompt");
  const answer = prompt(hint);
  if (!answer || !answer.trim()) return null;
  const asNumber = parseInt(answer.trim());
  if (
    !isNaN(asNumber) &&
    asNumber >= 1 &&
    asNumber <= existing.length &&
    String(asNumber) === answer.trim()
  ) {
    return existing[asNumber - 1][0];
  }
  const id = createPlaylist(answer.trim());
  toast(t("playlist_created", { name: answer.trim() }), "success");
  buildPlaylistList();
  return id;
}

function deletePlaylist(id) {
  const pl = state.playlists[id];
  if (!pl) return;
  if (!confirm(t("playlist_delete_confirm", { name: pl.name }))) return;
  delete state.playlists[id];
  savePlaylists();
  if (state.playlistFilter === id) {
    state.playlistFilter = null;
    if (state.view === "playlists") setView("all");
  }
  buildPlaylistList();
  render();
  toast(t("playlist_deleted"), "info");
}

function removeFromPlaylist(plId, trackId) {
  const pl = state.playlists[plId];
  if (!pl) return;
  pl.ids = pl.ids.filter((id) => id !== trackId);
  savePlaylists();
  buildPlaylistList();
  render();
}

function setPlaylistFilter(id) {
  state.playlistFilter = id;
  setView("playlists", false);
  state.catFilter = null;
  DOM.activeFilter.style.display = "none";
  buildPlaylistList();
}

function buildPlaylistList() {
  if (!DOM.playlistList) return;
  const entries = Object.entries(state.playlists);
  let html = `<div class="cat-section-label">${t("playlists_label")}</div>`;
  html += `<button class="cat-item playlist-create-btn" id="playlistCreateBtn">
        <span class="dot" style="background:var(--c-accent2)"></span>
        <span class="cat-name">${t("playlist_create")}</span>
      </button>`;
  entries.forEach(([id, pl]) => {
    const isActive = state.view === "playlists" && state.playlistFilter === id;
    html += `<button class="cat-item playlist-item${isActive ? " active-cat" : ""}" data-plid="${id}">
          <span class="dot" style="background:var(--c-accent2)"></span>
          <span class="cat-name" title="${esc(pl.name)}">${esc(pl.name)}</span>
          <span class="cat-cnt">${pl.ids.length}</span>
          <span class="playlist-del" data-plid-del="${id}" title="${t("delete_track")}">×</span>
        </button>`;
  });
  DOM.playlistList.innerHTML = html;
  document
    .getElementById("playlistCreateBtn")
    ?.addEventListener("click", () => {
      const name = prompt(t("playlist_name_prompt"));
      if (!name || !name.trim()) return;
      const id = createPlaylist(name.trim());
      toast(t("playlist_created", { name: name.trim() }), "success");
      buildPlaylistList();
      setPlaylistFilter(id);
    });
  DOM.playlistList.querySelectorAll(".playlist-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest(".playlist-del")) {
        deletePlaylist(e.target.dataset.plidDel);
        return;
      }
      setPlaylistFilter(btn.dataset.plid);
      render();
    });
  });
}

// ─── Detail Modal ─────────────────────────────────────────────
function openModal(id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;
  state.modal = id;
  const isFav = state.favorites.has(id);
  const isUnavailable = state.unavailable.has(id);
  const dur = fmtDuration(track.duration);
  const robloxUrl = `https://create.roblox.com/store/asset/${id}`;
  DOM.modalBody.innerHTML = `
        <div class="track-tag-pills modal-tag-pills">${(track.tags || [])
          .map((tag) => {
            const meta = getTagMeta(tag);
            return `<span class="track-tag-pill" data-tag="${esc(tag)}" style="--tag-color:${meta.color}">${tagIconSvg(meta.icon, 10)}${esc(tag)}</span>`;
          })
          .join("")}</div>
        <div class="modal-title">${esc(track.title)}</div>
        <div class="modal-stats">
            <div class="modal-stat"><span class="s-label">${t("modal_duration")}</span><span class="s-val">${dur}</span></div>
            <div class="modal-stat"><span class="s-label">${t("modal_seconds")}</span><span class="s-val">${track.duration}</span></div>
            <div class="modal-stat"><span class="s-label">ID</span><span class="s-val" style="font-size:11px;font-family:'DM Mono',monospace">${esc(id)}</span></div>
        </div>
        <div class="modal-id-box">
            <span class="modal-id-val">${esc(id)}</span>
            <button class="modal-copy-btn" id="modalCopyId"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>${t("modal_copy_id")}</button>
        </div>
        <div class="modal-actions">
            ${
              isUnavailable
                ? `<button class="btn-secondary" id="modalRetryBtn" title="${t("retry_track")}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.89"/></svg> ${t("retry_track")}</button>`
                : `<button class="btn-secondary" id="modalPreviewBtn">${state.playingId === id && previewAudio && !previewAudio.paused ? ICON_PAUSE_LG : ICON_PLAY_LG} ${t("preview_play")}</button>`
            }
            <a class="btn-primary" href="${robloxUrl}" target="_blank" rel="noopener noreferrer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${t("modal_open_roblox")}</a>
            <button class="modal-fav-toggle${isFav ? " active" : ""}" id="modalFavBtn">${isFav ? t("modal_fav_remove") : t("modal_fav_add")}</button>
            <button class="modal-edit-btn" id="modalPlaylistBtn" title="${t("bulk_playlist")}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>${t("bulk_playlist")}</button>
            <button class="modal-edit-btn" id="modalEditBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${t("edit_track")}</button>
            <button class="modal-delete-btn" id="modalDeleteBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>${t("delete_track")}</button>
        </div>
    `;
  document
    .getElementById("modalCopyId")
    ?.addEventListener("click", () => copyText(id, track.title));
  document.getElementById("modalRetryBtn")?.addEventListener("click", () => {
    retryTrack(id);
  });
  DOM.modalBody.querySelectorAll(".modal-tag-pills .track-tag-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      setCatFilter(pill.dataset.tag);
      closeModal();
    });
  });
  document.getElementById("modalPreviewBtn")?.addEventListener("click", () => {
    togglePreview(id);
    setTimeout(() => {
      const btn = document.getElementById("modalPreviewBtn");
      if (!btn) return;
      const playing =
        state.playingId === id && previewAudio && !previewAudio.paused;
      btn.innerHTML = `${playing ? ICON_PAUSE_LG : ICON_PLAY_LG} ${t(playing ? "preview_pause" : "preview_play")}`;
    }, 60);
  });
  document
    .getElementById("modalPlaylistBtn")
    ?.addEventListener("click", () => {
      const plId = pickOrCreatePlaylist();
      if (!plId) return;
      const pl = state.playlists[plId];
      if (!pl.ids.includes(id)) pl.ids.push(id);
      savePlaylists();
      buildPlaylistList();
      toast(t("playlist_added"), "success");
    });
  document.getElementById("modalFavBtn")?.addEventListener("click", () => {
    toggleFav(id);
    const f = state.favorites.has(id);
    const btn = document.getElementById("modalFavBtn");
    if (btn) {
      btn.textContent = f ? t("modal_fav_remove") : t("modal_fav_add");
      btn.classList.toggle("active", f);
    }
  });
  document.getElementById("modalEditBtn")?.addEventListener("click", () => {
    closeModal();
    openEditModal(id);
  });
  document.getElementById("modalDeleteBtn")?.addEventListener("click", () => {
    closeModal();
    deleteTrack(id);
  });
  DOM.modalBackdrop.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  DOM.modalBackdrop.classList.remove("open");
  document.body.style.overflow = "";
  state.modal = null;
}

// ─── Sidebar ──────────────────────────────────────────────────
let sidebarOverlay = null;
function openSidebar() {
  DOM.sidebar.classList.add("open");
  if (!sidebarOverlay) {
    sidebarOverlay = document.createElement("div");
    sidebarOverlay.className = "sidebar-overlay visible";
    sidebarOverlay.addEventListener("click", closeSidebar);
    document.body.appendChild(sidebarOverlay);
  } else sidebarOverlay.classList.add("visible");
}
function closeSidebar() {
  DOM.sidebar.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.classList.remove("visible");
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─── Inject extra topbar buttons ──────────────────────────────
function injectTopbarButtons() {
  const right = document.querySelector(".topbar-right");
  if (!right) return;

  // Add track button
  const addBtn = document.createElement("button");
  addBtn.className = "icon-btn";
  addBtn.id = "addTrackBtn";
  addBtn.title = t("add_track");
  addBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  right.insertBefore(addBtn, right.firstChild);
  addBtn.addEventListener("click", openAddModal);

  // Feel-lucky button — opens a random track
  const luckyBtn = document.createElement("button");
  luckyBtn.className = "icon-btn";
  luckyBtn.id = "luckyBtn";
  luckyBtn.title = t("feel_lucky");
  luckyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`;
  right.insertBefore(luckyBtn, right.firstChild);
  luckyBtn.addEventListener("click", feelLucky);

  // Download all button
  const dlBtn = document.createElement("button");
  dlBtn.id = "downloadAllBtn";
  dlBtn.className = "export-btn";
  dlBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>${t("download_all")}</span>`;
  DOM.statsBar.insertBefore(dlBtn, DOM.statsBar.querySelector(".stat-spacer"));
  dlBtn.addEventListener("click", downloadAllTracks);

  // Reset changes button (hidden until changes exist)
  const resetBtn = document.createElement("button");
  resetBtn.id = "resetChangesBtn";
  resetBtn.className = "icon-btn danger-btn";
  resetBtn.title = t("reset_changes");
  resetBtn.style.display = "none";
  resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.89"/></svg>`;
  right.insertBefore(resetBtn, right.firstChild);
  resetBtn.addEventListener("click", resetAllChanges);

  // Select mode toggle (bulk editing)
  const selectBtn = document.createElement("button");
  selectBtn.className = "icon-btn";
  selectBtn.id = "selectModeBtn";
  selectBtn.title = t("select_mode");
  selectBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
  right.insertBefore(selectBtn, right.firstChild);
  selectBtn.addEventListener("click", toggleSelectMode);
}

// ─── Bulk action bar (injected above the grid) ────────────────
function injectBulkUI() {
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.className = "bulk-bar";
  bar.style.display = "none";
  bar.innerHTML = `
    <span class="bulk-count" id="bulkCount">0</span>
    <span class="bulk-label">${t("bulk_selected")}</span>
    <div class="bulk-actions">
      <button class="bulk-btn" id="bulkAllBtn">${t("bulk_select_all")}</button>
      <button class="bulk-btn" id="bulkFavBtn">${t("bulk_fav")}</button>
      <button class="bulk-btn" id="bulkUnfavBtn">${t("bulk_unfav")}</button>
      <button class="bulk-btn" id="bulkCatBtn">${t("bulk_category")}</button>
      <button class="bulk-btn" id="bulkPlaylistBtn">${t("bulk_playlist")}</button>
      <button class="bulk-btn" id="bulkExportBtn">${t("bulk_export")}</button>
      <button class="bulk-btn danger" id="bulkDeleteBtn">${t("bulk_delete")}</button>
      <button class="bulk-btn ghost" id="bulkCancelBtn">${t("bulk_cancel")}</button>
    </div>`;
  DOM.activeFilter.insertAdjacentElement("afterend", bar);
  DOM.bulkBar = bar;

  document.getElementById("bulkAllBtn").addEventListener("click", selectAllVisible);
  document
    .getElementById("bulkFavBtn")
    .addEventListener("click", () => bulkSetFavorite(true));
  document
    .getElementById("bulkUnfavBtn")
    .addEventListener("click", () => bulkSetFavorite(false));
  document.getElementById("bulkCatBtn").addEventListener("click", bulkSetCategory);
  document
    .getElementById("bulkPlaylistBtn")
    .addEventListener("click", bulkAddToPlaylist);
  document
    .getElementById("bulkExportBtn")
    .addEventListener("click", bulkExportSelected);
  document.getElementById("bulkDeleteBtn").addEventListener("click", bulkDelete);
  document
    .getElementById("bulkCancelBtn")
    .addEventListener("click", toggleSelectMode);
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  document.body.classList.toggle("perf-lite", perf.lowPower);
  const savedLang = localStorage.getItem(LS_LANG);
  if (savedLang === "ru" || savedLang === "en") state.lang = savedLang;
  else state.lang = "ru";
  const savedTheme = localStorage.getItem(LS_THEME);
  if (savedTheme === "light" || savedTheme === "dark") {
    setTheme(savedTheme);
  } else {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    setTheme(media && !media.matches ? "light" : "dark", false);
    media?.addEventListener?.("change", (e) => {
      // Только пока юзер сам явно не выбрал тему — тогда LS_THEME пуст.
      if (localStorage.getItem(LS_THEME) === null) {
        setTheme(e.matches ? "dark" : "light", false);
      }
    });
  }
  document.getElementById("langToggle").textContent =
    state.lang === "ru" ? "RU" : "EN";

  loadFavorites();
  loadOverrides();
  loadUnavailable();
  loadRecent();
  loadPlaylists();
  loadPlayMode();
  loadTagMeta();
  loadBadgeMeta();
  DOM.mpShuffleBtn?.classList.toggle("active", state.shuffle);
  DOM.mpRepeatBtn?.classList.toggle("active", state.repeat !== "off");
  DOM.mpRepeatBtn?.classList.toggle("repeat-one", state.repeat === "one");
  updateAllTexts();
  injectTopbarButtons();
  injectBulkUI();
  buildPlaylistList();
  bindMiniPlayerEvents();
  initParallax();
  initMotionLibraries();
  bindGridEvents();
  updateCounters();

  // Event listeners
  DOM.jsonInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = "";
  });
  DOM.searchInput.addEventListener(
    "input",
    debounce(() => {
      state.query = DOM.searchInput.value;
      DOM.searchClear.classList.toggle("visible", state.query.length > 0);
      if (state.query.trim()) closeSearchHistory();
      else if (document.activeElement === DOM.searchInput) openSearchHistory();
      render();
    }, 240),
  );
  DOM.searchInput.addEventListener("focus", () => {
    if (!DOM.searchInput.value.trim()) openSearchHistory();
  });
  DOM.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.query.trim()) {
      pushSearchHistory(state.query);
      closeSearchHistory();
    } else if (e.key === "Escape") {
      closeSearchHistory();
    }
  });
  DOM.searchInput.addEventListener("blur", () => {
    if (state.query.trim()) pushSearchHistory(state.query);
  });
  document.getElementById("searchHistory")?.addEventListener("click", (e) => {
    const removeQ = e.target.closest("[data-remove]")?.dataset.remove;
    if (removeQ) {
      removeSearchHistoryItem(removeQ);
      return;
    }
    if (e.target.closest("#searchHistoryClearBtn")) {
      clearSearchHistory();
      return;
    }
    const item = e.target.closest(".search-history-item");
    if (item) {
      DOM.searchInput.value = item.dataset.q;
      state.query = item.dataset.q;
      DOM.searchClear.classList.toggle("visible", true);
      closeSearchHistory();
      render();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-bar")) closeSearchHistory();
  });
  DOM.searchClear.addEventListener("click", () => {
    if (state.query.trim()) pushSearchHistory(state.query);
    DOM.searchInput.value = "";
    state.query = "";
    DOM.searchClear.classList.remove("visible");
    render();
    DOM.searchInput.focus();
    openSearchHistory();
  });
  DOM.sortSelect.addEventListener("change", () => {
    state.sort = DOM.sortSelect.value;
    render();
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  DOM.clearFavBtn.addEventListener("click", () => {
    if (state.favorites.size === 0) {
      toast(t("toast_info_no_fav"), "info");
      return;
    }
    if (!confirm(t("clear_fav_confirm", { count: state.favorites.size })))
      return;
    state.favorites.clear();
    saveFavorites();
    updateCounters();
    buildCategoryList();
    render();
    toast(t("toast_info_clear"), "info");
  });
  [DOM.loadSampleBtn, DOM.emptySampleBtn].forEach((btn) => {
    if (btn)
      btn.addEventListener("click", () => {
        if (loadTracks(SAMPLE_DATA))
          toast(
            t("load_sample_success", { count: state.tracks.length }),
            "success",
          );
      });
  });
  DOM.exportBtn.addEventListener("click", exportFavorites);
  DOM.filterClear.addEventListener("click", () => setCatFilter(null));
  DOM.viewGrid.addEventListener("click", () => {
    state.layout = "grid";
    DOM.viewGrid.classList.add("active");
    DOM.viewList.classList.remove("active");
    render();
  });
  DOM.viewList.addEventListener("click", () => {
    state.layout = "list";
    DOM.viewList.classList.add("active");
    DOM.viewGrid.classList.remove("active");
    render();
  });
  DOM.modalClose.addEventListener("click", closeModal);
  DOM.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === DOM.modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.getElementById("formModalBackdrop")?.remove();
      document.body.style.overflow = "";
    }
  });
  DOM.sidebarToggle.addEventListener("click", () => {
    if (DOM.sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  DOM.themeToggle.addEventListener("click", toggleTheme);
  DOM.langToggle.addEventListener("click", () => {
    setLanguage(state.lang === "ru" ? "en" : "ru");
  });

  let dragCounter = 0;
  document.addEventListener("dragenter", (e) => {
    if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
      dragCounter++;
      DOM.dropOverlay.classList.add("active");
    }
  });
  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      DOM.dropOverlay.classList.remove("active");
    }
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    DOM.dropOverlay.classList.remove("active");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      DOM.searchInput.focus();
      DOM.searchInput.select();
    }
  });

  // Player shortcuts — ignored while typing in a field or with modifiers held.
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
    const isFocusedControl = tag === "BUTTON" || tag === "A";
    if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && isFocusedControl) return;
    if (!state.playingId && !["n", "N"].includes(e.key)) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        if (state.playingId) togglePreview(state.playingId);
        break;
      case "ArrowRight":
        if (previewAudio) {
          e.preventDefault();
          previewAudio.currentTime = Math.min(
            previewAudio.duration || Infinity,
            (previewAudio.currentTime || 0) + 5,
          );
          updatePlayerProgress();
        }
        break;
      case "ArrowLeft":
        if (previewAudio) {
          e.preventDefault();
          previewAudio.currentTime = Math.max(0, (previewAudio.currentTime || 0) - 5);
          updatePlayerProgress();
        }
        break;
      case "ArrowUp":
        if (DOM.mpVolume) {
          e.preventDefault();
          const v = Math.min(1, parseFloat(DOM.mpVolume.value) + 0.05);
          DOM.mpVolume.value = v;
          getPreviewAudio().volume = v;
          localStorage.setItem(LS_VOLUME, String(v));
        }
        break;
      case "ArrowDown":
        if (DOM.mpVolume) {
          e.preventDefault();
          const v = Math.max(0, parseFloat(DOM.mpVolume.value) - 0.05);
          DOM.mpVolume.value = v;
          getPreviewAudio().volume = v;
          localStorage.setItem(LS_VOLUME, String(v));
        }
        break;
      case "n":
      case "N":
        e.preventDefault();
        playNext(false);
        break;
      case "p":
      case "P":
        if (state.playingId) {
          e.preventDefault();
          playPrev();
        }
        break;
    }
  });

  // "Недавние" истекают через час — периодически проверяем и обновляем вид,
  // если он сейчас открыт.
  setInterval(() => {
    const before = state.recent.length;
    pruneRecent();
    if (state.recent.length !== before && state.view === "recent") render();
  }, 60 * 1000);

  // Auto-load from remote
  await loadRemote();
}

document.addEventListener("DOMContentLoaded", init);
console.log(
  "%c🎧 AudioVault v3.1 ready (preview player, bulk edit, playlists, recent, fuzzy search)",
  "color:#3ecfff;font-family:monospace;font-size:12px",
);