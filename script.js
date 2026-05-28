/* ══════════════════════════════════════════════════════════════
   AudioVault v3 — script.js
   Features:
   • Auto-load from remote URL on startup
   • Per-ID edit/delete overrides stored in localStorage
   • Add new tracks
   • Download full current dataset as JSON
   ══════════════════════════════════════════════════════════════ */

'use strict';

const REMOTE_URL = 'https://raw.githubusercontent.com/Wolfdmitrich/music_reader/refs/heads/main/audios.json';
const LS_OVERRIDES = 'av_overrides_v3'; // { id: {deleted:true} | {id,title,category,duration} }
const LS_ADDED    = 'av_added_v3';      // array of {id,title,category,duration}
const LS_FAVS     = 'av_favs';
const LS_LANG     = 'av_lang';
const LS_THEME    = 'av_theme';

// ─── State ───────────────────────────────────────────────────────
const state = {
    baseRemote: [],   // loaded from URL, never mutated
    tracks: [],       // computed: baseRemote ∪ added – deleted + edits
    favorites: new Set(),
    view: 'all',
    catFilter: null,
    query: '',
    sort: 'default',
    layout: 'grid',
    modal: null,
    lang: 'ru',
    theme: 'dark',
    overrides: {},    // { id → {deleted:true} | full track obj }
    added: [],        // locally added tracks
};

// ─── Translations ──────────────────────────────────────────────
const translations = {
    ru: {
        version: "v3.0",
        nav_all: "Все треки", nav_favorites: "Избранное", nav_categories: "Категории",
        upload_json: "Загрузить JSON", sample: "Пример",
        search_placeholder: "Поиск по названию, ID, категории…",
        sort_default: "По умолчанию", sort_title_asc: "Название А→Я", sort_title_desc: "Название Я→А",
        sort_duration_asc: "Длительность ↑", sort_duration_desc: "Длительность ↓", sort_category_asc: "Категория А→Я",
        stat_tracks: "треков", stat_favorites: "избранных", stat_categories: "категорий", stat_shown: "показано",
        export_fav: "Экспорт избранных", filter_label: "Фильтр:", filter_clear: "убрать",
        empty_title: "Добро пожаловать в AudioVault",
        empty_desc: "Загружаем аудио с сервера…",
        no_results_title: "Ничего не найдено", no_results_desc: "Попробуйте изменить запрос или фильтр категории",
        drop_text: "Отпустите для загрузки JSON",
        copied: "Скопировано:", removed_fav: "Убрано из избранного", added_fav: "Добавлено в избранное ★",
        no_fav_export: "Нет избранных треков для экспорта",
        export_success: "Экспортировано {count} треков",
        clear_fav_confirm: "Удалить все {count} избранных? Это нельзя отменить.",
        clear_fav_success: "Избранное очищено",
        load_sample_success: "✓ Загружен пример: {count} треков",
        load_json_success: "✓ Загружено {count} треков из \"{name}\"",
        remote_load_success: "✓ Загружено {count} треков с сервера",
        remote_load_error: "Не удалось загрузить треки с сервера",
        invalid_json: "Ожидается массив JSON", no_valid_tracks: "Нет валидных треков в файле",
        skipped_records: "Пропущено {skipped} некорректных записей",
        error_parse: "Ошибка парсинга JSON: {msg}", error_read: "Не удалось прочитать файл",
        error_file_type: "Пожалуйста загрузите .json файл",
        toast_info_fav_removed: "Убрано из избранного", toast_info_fav_added: "Добавлено в избранное ★",
        toast_success_export: "Экспортировано {count} треков", toast_error_no_fav: "Нет избранных треков",
        toast_info_clear: "Избранное очищено", toast_info_no_fav: "Нет избранных треков",
        modal_copy_id: "Копировать ID", modal_open_roblox: "Открыть в Roblox",
        modal_fav_add: "☆ В избранное", modal_fav_remove: "★ В избранном",
        modal_duration: "Длительность", modal_seconds: "Секунд",
        categories_label: "Категории",
        edit_track: "Редактировать", delete_track: "Удалить",
        add_track: "Добавить трек",
        edit_title: "Редактирование трека", add_title: "Новый трек",
        field_title: "Название", field_id: "ID", field_category: "Категория", field_duration: "Длительность (сек)",
        save: "Сохранить", cancel: "Отмена",
        track_saved: "Трек сохранён", track_deleted: "Трек удалён", track_added: "Трек добавлен",
        delete_confirm: "Удалить трек \"{title}\"? Это нельзя отменить.",
        download_all: "Скачать все треки",
        id_exists: "Трек с таким ID уже существует",
        field_required: "Заполните все поля",
        modified_badge: "изм.",
        added_badge: "новый",
        reset_changes: "Сбросить изменения",
        reset_confirm: "Сбросить все локальные изменения (правки, удаления, добавления)? Данные вернутся к исходным.",
        changes_reset: "Изменения сброшены",
    },
    en: {
        version: "v3.0",
        nav_all: "All tracks", nav_favorites: "Favorites", nav_categories: "Categories",
        upload_json: "Upload JSON", sample: "Sample",
        search_placeholder: "Search by title, ID, category…",
        sort_default: "Default", sort_title_asc: "Title A→Z", sort_title_desc: "Title Z→A",
        sort_duration_asc: "Duration ↑", sort_duration_desc: "Duration ↓", sort_category_asc: "Category A→Z",
        stat_tracks: "tracks", stat_favorites: "favorites", stat_categories: "categories", stat_shown: "shown",
        export_fav: "Export favorites", filter_label: "Filter:", filter_clear: "clear",
        empty_title: "Welcome to AudioVault",
        empty_desc: "Loading audio from server…",
        no_results_title: "Nothing found", no_results_desc: "Try changing your query or category filter",
        drop_text: "Drop to upload JSON",
        copied: "Copied:", removed_fav: "Removed from favorites", added_fav: "Added to favorites ★",
        no_fav_export: "No favorite tracks to export",
        export_success: "Exported {count} tracks",
        clear_fav_confirm: "Delete all {count} favorites? This cannot be undone.",
        clear_fav_success: "Favorites cleared",
        load_sample_success: "✓ Sample loaded: {count} tracks",
        load_json_success: "✓ Loaded {count} tracks from \"{name}\"",
        remote_load_success: "✓ Loaded {count} tracks from server",
        remote_load_error: "Failed to load tracks from server",
        invalid_json: "Expected a JSON array", no_valid_tracks: "No valid tracks in file",
        skipped_records: "Skipped {skipped} invalid entries",
        error_parse: "JSON parsing error: {msg}", error_read: "Failed to read file",
        error_file_type: "Please upload a .json file",
        toast_info_fav_removed: "Removed from favorites", toast_info_fav_added: "Added to favorites ★",
        toast_success_export: "Exported {count} tracks", toast_error_no_fav: "No favorite tracks",
        toast_info_clear: "Favorites cleared", toast_info_no_fav: "No favorites",
        modal_copy_id: "Copy ID", modal_open_roblox: "Open in Roblox",
        modal_fav_add: "☆ Add to favorites", modal_fav_remove: "★ In favorites",
        modal_duration: "Duration", modal_seconds: "Seconds",
        categories_label: "Categories",
        edit_track: "Edit", delete_track: "Delete",
        add_track: "Add track",
        edit_title: "Edit track", add_title: "New track",
        field_title: "Title", field_id: "ID", field_category: "Category", field_duration: "Duration (sec)",
        save: "Save", cancel: "Cancel",
        track_saved: "Track saved", track_deleted: "Track deleted", track_added: "Track added",
        delete_confirm: "Delete track \"{title}\"? This cannot be undone.",
        download_all: "Download all tracks",
        id_exists: "A track with this ID already exists",
        field_required: "Please fill in all fields",
        modified_badge: "edited",
        added_badge: "new",
        reset_changes: "Reset changes",
        reset_confirm: "Reset all local changes (edits, deletions, additions)? Data will revert to original.",
        changes_reset: "Changes reset",
    }
};

function t(key, vars = {}) {
    let str = (translations[state.lang] || translations.ru)[key] || key;
    for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
    return str;
}

// ─── Theme ────────────────────────────────────────────────────
function setTheme(theme) {
    state.theme = theme;
    localStorage.setItem(LS_THEME, theme);
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.getElementById('themeIcon').innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    } else {
        document.body.classList.remove('light-theme');
        document.getElementById('themeIcon').innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
}
function toggleTheme() { setTheme(state.theme === 'dark' ? 'light' : 'dark'); }

function setLanguage(lang) {
    state.lang = lang;
    localStorage.setItem(LS_LANG, lang);
    document.documentElement.lang = lang;
    document.getElementById('langToggle').textContent = lang === 'ru' ? 'RU' : 'EN';
    updateAllTexts(); buildCategoryList(); render();
    if (state.modal) openModal(state.modal);
}

function updateAllTexts() {
    document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k) el.textContent = t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const k = el.dataset.i18nPlaceholder; if (k) el.placeholder = t(k); });
    document.querySelectorAll('#sortSelect option').forEach(opt => { const k = opt.dataset.i18n; if (k) opt.textContent = t(k); });
    document.querySelectorAll('.stat-label[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k) el.textContent = t(k); });
    const addTrackBtn = document.getElementById('addTrackBtn');
    if (addTrackBtn) addTrackBtn.title = t('add_track');
    const dlBtn = document.getElementById('downloadAllBtn');
    if (dlBtn) { const sp = dlBtn.querySelector('span'); if (sp) sp.textContent = t('download_all'); }
    const resetBtn = document.getElementById('resetChangesBtn');
    if (resetBtn) resetBtn.title = t('reset_changes');
}

// ─── DOM refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const DOM = {
    jsonInput:       $('jsonInput'),
    searchInput:     $('searchInput'),
    searchClear:     $('searchClear'),
    sortSelect:      $('sortSelect'),
    tracksGrid:      $('tracksGrid'),
    emptyState:      $('emptyState'),
    noResults:       $('noResults'),
    totalCount:      $('totalCount'),
    favCount:        $('favCount'),
    catCount:        $('catCount'),
    shownCount:      $('shownCount'),
    navTotal:        $('navTotal'),
    navFavs:         $('navFavs'),
    navCats:         $('navCats'),
    categoryList:    $('categoryList'),
    clearFavBtn:     $('clearFavBtn'),
    loadSampleBtn:   $('loadSampleBtn'),
    emptySampleBtn:  $('emptySampleBtn'),
    exportBtn:       $('exportBtn'),
    activeFilter:    $('activeFilter'),
    activeFilterVal: $('activeFilterVal'),
    filterClear:     $('filterClear'),
    sidebar:         $('sidebar'),
    sidebarToggle:   $('sidebarToggle'),
    viewGrid:        $('viewGrid'),
    viewList:        $('viewList'),
    modalBackdrop:   $('modalBackdrop'),
    trackModal:      $('trackModal'),
    modalClose:      $('modalClose'),
    modalBody:       $('modalBody'),
    toastStack:      $('toastStack'),
    dropOverlay:     $('dropOverlay'),
    themeToggle:     $('themeToggle'),
    langToggle:      $('langToggle'),
    statsBar:        $('statsBar'),
};

// ─── Background Canvas ────────────────────────────────────────
(function initCanvas() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, orbs;
    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; buildOrbs(); }
    function buildOrbs() {
        orbs = [
            { x: w * 0.15, y: h * 0.2, r: Math.min(w,h)*0.35, color: '62,207,255',  speed: 0.0003 },
            { x: w * 0.8,  y: h * 0.7, r: Math.min(w,h)*0.30, color: '124,111,255', speed: 0.0005 },
            { x: w * 0.5,  y: h * 0.9, r: Math.min(w,h)*0.25, color: '255,107,138', speed: 0.0004 },
        ];
    }
    let tick = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h); tick++;
        orbs.forEach((o, i) => {
            const dx = Math.sin(tick * o.speed + i * 2) * 60;
            const dy = Math.cos(tick * o.speed + i * 1.3) * 40;
            const grd = ctx.createRadialGradient(o.x+dx, o.y+dy, 0, o.x+dx, o.y+dy, o.r);
            grd.addColorStop(0, `rgba(${o.color},0.12)`);
            grd.addColorStop(1, `rgba(${o.color},0)`);
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, w, h);
        });
        requestAnimationFrame(draw);
    }
    window.addEventListener('resize', resize);
    resize(); draw();
})();

// ─── Persistence ──────────────────────────────────────────────
function loadLS(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn('LS save failed', e); } }

function loadFavorites() { state.favorites = new Set(loadLS(LS_FAVS, [])); }
function saveFavorites() { saveLS(LS_FAVS, [...state.favorites]); }

function loadOverrides() {
    state.overrides = loadLS(LS_OVERRIDES, {});
    state.added = loadLS(LS_ADDED, []);
}
function saveOverrides() {
    saveLS(LS_OVERRIDES, state.overrides);
    saveLS(LS_ADDED, state.added);
}

// ─── Compute tracks from base + overrides + added ─────────────
function recomputeTracks() {
    const result = [];
    state.baseRemote.forEach((track, idx) => {
        const ov = state.overrides[track.id];
        if (ov && ov.deleted) return;
        if (ov && !ov.deleted) {
            result.push({ ...ov, _idx: idx, _modified: true });
        } else {
            result.push({ ...track, _idx: idx });
        }
    });
    state.added.forEach((track, idx) => {
        const ov = state.overrides[track.id];
        if (ov && ov.deleted) return;
        const base = ov && !ov.deleted ? { ...ov } : { ...track };
        result.push({ ...base, _idx: state.baseRemote.length + idx, _added: true });
    });
    state.tracks = result;
}

// ─── Remote load ──────────────────────────────────────────────
async function loadRemote() {
    try {
        const res = await fetch(REMOTE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const valid = parseRawTracks(data);
        if (valid.length === 0) { toast(t('no_valid_tracks'), 'error'); return; }
        state.baseRemote = valid;
        recomputeTracks();
        state.catFilter = null; state.query = ''; DOM.searchInput.value = '';
        DOM.activeFilter.style.display = 'none';
        DOM.searchClear.classList.remove('visible');
        DOM.sortSelect.value = 'default'; state.sort = 'default';
        updateCounters(); buildCategoryList(); render();
        toast(t('remote_load_success', { count: state.tracks.length }), 'success');
    } catch(e) {
        console.error('Remote load error:', e);
        toast(t('remote_load_error'), 'error');
        // Still show empty state with upload option
        render();
    }
}

function parseRawTracks(arr) {
    if (!Array.isArray(arr)) return [];
    const valid = [];
    arr.forEach((item, i) => {
        if (item.id && item.title !== undefined) {
            valid.push({ id: String(item.id), title: String(item.title || 'Без названия'), category: String(item.category || 'Без категории'), duration: typeof item.duration === 'number' ? item.duration : parseInt(item.duration) || 0, _idx: i });
        }
    });
    return valid;
}

// ─── File load ────────────────────────────────────────────────
function loadTracks(arr) {
    if (!Array.isArray(arr)) { toast(t('invalid_json'), 'error'); return false; }
    const valid = parseRawTracks(arr);
    if (valid.length === 0) { toast(t('no_valid_tracks'), 'error'); return false; }
    state.baseRemote = valid;
    recomputeTracks();
    state.catFilter = null; state.query = ''; DOM.searchInput.value = '';
    DOM.activeFilter.style.display = 'none';
    DOM.searchClear.classList.remove('visible');
    DOM.sortSelect.value = 'default'; state.sort = 'default';
    updateCounters(); buildCategoryList(); render();
    return true;
}

function handleFile(file) {
    if (!file) return;
    if (!file.name.endsWith('.json') && file.type !== 'application/json') { toast(t('error_file_type'), 'error'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (loadTracks(data)) toast(t('load_json_success', { count: state.tracks.length, name: file.name }), 'success');
        } catch(err) { toast(t('error_parse', { msg: err.message }), 'error'); }
    };
    reader.onerror = () => toast(t('error_read'), 'error');
    reader.readAsText(file);
}

const SAMPLE_DATA = [
    { "category": "ANIME/ATTACK ON TITAN", "id": "131737171257366", "title": "The Rumbling But it's Lofi", "duration": 85 },
    { "category": "ANIME/ATTACK ON TITAN", "id": "78589694220912",  "title": "Vientos serenos", "duration": 124 },
    { "category": "ANIME/CHAINSAW MAN",    "id": "78556475714069",  "title": "Holy Power", "duration": 96 },
    { "category": "ANIME/DEMON SLAYER",    "id": "99887766554433",  "title": "Gurenge (Epic Version)", "duration": 210 },
    { "category": "GAMING/MINECRAFT",      "id": "11223344556677",  "title": "Sweden - Calm Piano", "duration": 142 },
    { "category": "AMBIENT/LOFI",          "id": "99001122334455",  "title": "Rainy Night Study Session", "duration": 190 },
    { "category": "GAMING/CYBERPUNK",      "id": "66554433221100",  "title": "Night City Ambience", "duration": 300 },
];

// ─── Toast ────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 2200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    DOM.toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('removing'); el.addEventListener('animationend', () => el.remove(), { once: true }); }, duration);
}

// ─── Helpers ──────────────────────────────────────────────────
function esc(str) { if (!str) return ''; return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmtDuration(sec) { sec = parseInt(sec) || 0; const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2,'0')}`; }
async function copyText(text, label) {
    try {
        await navigator.clipboard.writeText(text);
        toast(`${t('copied')} ${label || text}`, 'success');
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        toast(`${t('copied')} ${label || text}`, 'success');
    }
}

// ─── Favorites ────────────────────────────────────────────────
function toggleFav(id) {
    id = String(id);
    if (state.favorites.has(id)) { state.favorites.delete(id); toast(t('toast_info_fav_removed'), 'info', 1500); }
    else { state.favorites.add(id); toast(t('toast_info_fav_added'), 'success', 1500); }
    saveFavorites(); updateCounters();
    const star = DOM.tracksGrid.querySelector(`.fav-star[data-id="${id}"]`);
    const card = DOM.tracksGrid.querySelector(`.track-card[data-id="${id}"]`);
    if (star) { const f = state.favorites.has(id); star.textContent = f ? '★' : '☆'; star.classList.toggle('active', f); if (card) card.classList.toggle('is-fav', f); }
    if (state.view === 'favorites') render();
}

// ─── Edit / Delete / Add ──────────────────────────────────────
function deleteTrack(id) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) return;
    if (!confirm(t('delete_confirm', { title: track.title }))) return;
    state.overrides[id] = { deleted: true };
    saveOverrides();
    recomputeTracks();
    updateCounters(); buildCategoryList(); render();
    if (state.modal === id) closeModal();
    toast(t('track_deleted'), 'info');
}

function openEditModal(id) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) return;
    openFormModal({
        mode: 'edit',
        id: track.id,
        title: track.title,
        category: track.category,
        duration: track.duration,
    });
}

function openAddModal() {
    openFormModal({ mode: 'add', id: '', title: '', category: '', duration: '' });
}

function openFormModal(opts) {
    closeModal();
    const isEdit = opts.mode === 'edit';
    const heading = isEdit ? t('edit_title') : t('add_title');
    const idReadonly = isEdit ? 'readonly' : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.id = 'formModalBackdrop';
    backdrop.innerHTML = `
      <div class="modal form-modal">
        <button class="modal-close" id="formModalClose">×</button>
        <div class="modal-body">
          <div class="modal-cat">${heading}</div>
          <div class="form-fields">
            <label class="form-label">${t('field_title')}<input class="form-input" id="fTitle" type="text" value="${esc(opts.title)}" placeholder="${t('field_title')}"></label>
            <label class="form-label">${t('field_id')}<input class="form-input" id="fId" type="text" value="${esc(opts.id)}" placeholder="e.g. 12345678901234" ${idReadonly}></label>
            <label class="form-label">${t('field_category')}<input class="form-input" id="fCategory" type="text" value="${esc(opts.category)}" placeholder="e.g. ANIME/NARUTO" list="catSuggestions"></label>
            <datalist id="catSuggestions">${[...new Set(state.tracks.map(t=>t.category))].sort().map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
            <label class="form-label">${t('field_duration')}<input class="form-input" id="fDuration" type="number" min="0" value="${opts.duration}" placeholder="120"></label>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" id="formCancelBtn">${t('cancel')}</button>
            <button class="btn-primary" id="formSaveBtn">${t('save')}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    const close = () => { backdrop.remove(); document.body.style.overflow = ''; };
    document.getElementById('formModalClose').addEventListener('click', close);
    document.getElementById('formCancelBtn').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    document.getElementById('formSaveBtn').addEventListener('click', () => {
        const newTitle    = document.getElementById('fTitle').value.trim();
        const newId       = document.getElementById('fId').value.trim();
        const newCategory = document.getElementById('fCategory').value.trim();
        const newDuration = parseInt(document.getElementById('fDuration').value) || 0;

        if (!newTitle || !newId || !newCategory) { toast(t('field_required'), 'error'); return; }

        if (isEdit) {
            const updated = { id: opts.id, title: newTitle, category: newCategory, duration: newDuration };
            state.overrides[opts.id] = updated;
            saveOverrides();
            recomputeTracks();
            toast(t('track_saved'), 'success');
        } else {
            // Check ID uniqueness
            if (state.tracks.some(tr => tr.id === newId)) { toast(t('id_exists'), 'error'); return; }
            const newTrack = { id: newId, title: newTitle, category: newCategory, duration: newDuration };
            state.added.push(newTrack);
            saveOverrides();
            recomputeTracks();
            toast(t('track_added'), 'success');
        }
        updateCounters(); buildCategoryList(); render();
        close();
    });

    // Focus first input
    setTimeout(() => { document.getElementById('fTitle').focus(); }, 50);
}

// ─── Download all tracks ──────────────────────────────────────
function downloadAllTracks() {
    const data = state.tracks.map(({ id, title, category, duration }) => ({ id, title, category, duration }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `audiovault-tracks-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast(`✓ ${data.length} треков`, 'success');
}

function exportFavorites() {
    const favTracks = state.tracks.filter(tr => state.favorites.has(tr.id));
    if (favTracks.length === 0) { toast(t('toast_error_no_fav'), 'info'); return; }
    const data = favTracks.map(({ id, title, category, duration }) => ({ id, title, category, duration }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `audiovault-favorites-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast(t('toast_success_export', { count: favTracks.length }), 'success');
}

function resetAllChanges() {
    if (!confirm(t('reset_confirm'))) return;
    state.overrides = {};
    state.added = [];
    saveOverrides();
    recomputeTracks();
    updateCounters(); buildCategoryList(); render();
    toast(t('changes_reset'), 'info');
}

// ─── Derived list ─────────────────────────────────────────────
function getDisplayed() {
    let list = [...state.tracks];
    if (state.view === 'favorites') list = list.filter(tr => state.favorites.has(tr.id));
    if (state.view === 'categories') list = state.catFilter ? list.filter(tr => tr.category === state.catFilter) : list;
    if (state.catFilter) list = list.filter(tr => tr.category === state.catFilter);
    const q = state.query.toLowerCase().trim();
    if (q) list = list.filter(tr => tr.title.toLowerCase().includes(q) || tr.category.toLowerCase().includes(q) || tr.id.includes(q));
    switch (state.sort) {
        case 'title_asc':    list.sort((a,b) => a.title.localeCompare(b.title, state.lang)); break;
        case 'title_desc':   list.sort((a,b) => b.title.localeCompare(a.title, state.lang)); break;
        case 'duration_asc': list.sort((a,b) => a.duration - b.duration); break;
        case 'duration_desc':list.sort((a,b) => b.duration - a.duration); break;
        case 'category_asc': list.sort((a,b) => a.category.localeCompare(b.category, state.lang)); break;
        default:             list.sort((a,b) => a._idx - b._idx); break;
    }
    if (state.view === 'all') {
        list.sort((a,b) => { const af = state.favorites.has(a.id), bf = state.favorites.has(b.id); return af && !bf ? -1 : !af && bf ? 1 : 0; });
    }
    return list;
}

// ─── Render ───────────────────────────────────────────────────
let renderJob = null;
function render() {
    if (renderJob) cancelAnimationFrame(renderJob);
    const displayed = getDisplayed();
    DOM.shownCount.textContent = displayed.length;
    const hasData = state.tracks.length > 0;
    DOM.emptyState.style.display = hasData ? 'none' : 'flex';
    DOM.noResults.style.display  = (hasData && displayed.length === 0) ? 'flex' : 'none';
    DOM.tracksGrid.style.display = (hasData && displayed.length > 0) ? 'grid' : 'none';
    if (!hasData || displayed.length === 0) return;
    DOM.tracksGrid.className = `tracks-grid${state.layout === 'list' ? ' list-view' : ''}`;
    const CHUNK = 40;
    let html = '';
    for (let i = 0; i < Math.min(CHUNK, displayed.length); i++) html += buildCardHTML(displayed[i]);
    DOM.tracksGrid.innerHTML = html;
    bindCardEvents(DOM.tracksGrid);
    if (displayed.length > CHUNK) {
        let idx = CHUNK;
        function appendChunk() {
            const end = Math.min(idx + CHUNK, displayed.length);
            let chunk = '';
            for (let i = idx; i < end; i++) chunk += buildCardHTML(displayed[i]);
            DOM.tracksGrid.insertAdjacentHTML('beforeend', chunk);
            bindCardEvents(DOM.tracksGrid, idx, end);
            idx = end;
            if (idx < displayed.length) renderJob = requestAnimationFrame(appendChunk);
        }
        renderJob = requestAnimationFrame(appendChunk);
    }
}

function buildCardHTML(track) {
    const isFav = state.favorites.has(track.id);
    const dur = fmtDuration(track.duration);
    const robloxUrl = `https://create.roblox.com/store/asset/${track.id}`;
    const modBadge = track._modified ? `<span class="track-badge badge-modified">${t('modified_badge')}</span>` : '';
    const addBadge = track._added    ? `<span class="track-badge badge-added">${t('added_badge')}</span>`       : '';
    return `
    <div class="track-card${isFav?' is-fav':''}" data-id="${track.id}" tabindex="0">
      <div class="card-header">
        <span class="track-category-pill" title="${esc(track.category)}">${esc(track.category)}</span>
        <div class="card-header-right">
          ${modBadge}${addBadge}
          <button class="fav-star${isFav?' active':''}" data-id="${track.id}">${isFav?'★':'☆'}</button>
        </div>
      </div>
      <div class="track-title">${esc(track.title)}</div>
      <div class="track-meta">
        <span class="meta-chip"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${dur}</span>
        <span class="meta-chip">${track.duration}с</span>
      </div>
      <div class="card-actions">
        <button class="copy-id-btn" data-id="${track.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>${track.id}</button>
        <a class="roblox-link" href="${robloxUrl}" target="_blank" rel="noopener noreferrer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Roblox</a>
        <button class="edit-btn" data-id="${track.id}" title="${t('edit_track')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="delete-btn" data-id="${track.id}" title="${t('delete_track')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        <button class="detail-btn" data-id="${track.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>
      </div>
    </div>`;
}

function bindCardEvents(grid, from = 0, to = null) {
    const cards = grid.querySelectorAll('.track-card');
    const slice = to !== null ? [...cards].slice(from, to) : cards;
    slice.forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.fav-star')?.addEventListener('click', e => { e.stopPropagation(); toggleFav(id); });
        card.querySelector('.copy-id-btn')?.addEventListener('click', e => { e.stopPropagation(); const tr = state.tracks.find(t => t.id === id); copyText(id, tr?.title); });
        card.querySelector('.roblox-link')?.addEventListener('click', e => e.stopPropagation());
        card.querySelector('.edit-btn')?.addEventListener('click', e => { e.stopPropagation(); openEditModal(id); });
        card.querySelector('.delete-btn')?.addEventListener('click', e => { e.stopPropagation(); deleteTrack(id); });
        card.querySelector('.detail-btn')?.addEventListener('click', e => { e.stopPropagation(); openModal(id); });
        card.addEventListener('dblclick', e => { if (e.target.closest('.fav-star, .roblox-link, .copy-id-btn, .edit-btn, .delete-btn, .detail-btn')) return; const tr = state.tracks.find(t => t.id === id); copyText(id, tr?.title); });
        card.addEventListener('keydown', e => { if (e.key === 'Enter') openModal(id); });
    });
}

// ─── Counters ─────────────────────────────────────────────────
function updateCounters() {
    DOM.totalCount.textContent = state.tracks.length;
    DOM.favCount.textContent   = state.favorites.size;
    DOM.navTotal.textContent   = state.tracks.length;
    DOM.navFavs.textContent    = state.favorites.size;
    const cats = new Set(state.tracks.map(t => t.category));
    DOM.catCount.textContent = cats.size;
    DOM.navCats.textContent  = cats.size;
    // Show/hide reset button
    const hasChanges = Object.keys(state.overrides).length > 0 || state.added.length > 0;
    const resetBtn = document.getElementById('resetChangesBtn');
    if (resetBtn) resetBtn.style.display = hasChanges ? 'flex' : 'none';
}

// ─── Category list ────────────────────────────────────────────
function buildCategoryList() {
    const catMap = {};
    state.tracks.forEach(tr => { catMap[tr.category] = (catMap[tr.category] || 0) + 1; });
    const sorted = Object.entries(catMap).sort((a,b) => a[0].localeCompare(b[0], state.lang));
    if (sorted.length === 0) { DOM.categoryList.innerHTML = ''; return; }
    let html = `<div class="cat-section-label">${t('categories_label')}</div>`;
    sorted.forEach(([cat, cnt]) => {
        const isActive = state.catFilter === cat;
        html += `<button class="cat-item${isActive?' active-cat':''}" data-cat="${esc(cat)}">
            <span class="dot"></span>
            <span class="cat-name" title="${esc(cat)}">${esc(cat)}</span>
            <span class="cat-cnt">${cnt}</span>
        </button>`;
    });
    DOM.categoryList.innerHTML = html;
    DOM.categoryList.querySelectorAll('.cat-item').forEach(btn => {
        btn.addEventListener('click', () => { const cat = btn.dataset.cat; if (state.catFilter === cat) setCatFilter(null); else setCatFilter(cat); });
    });
}

function setCatFilter(cat) {
    state.catFilter = cat;
    if (cat) { DOM.activeFilter.style.display = 'flex'; DOM.activeFilterVal.textContent = cat; if (state.view !== 'all') setView('all', false); }
    else DOM.activeFilter.style.display = 'none';
    buildCategoryList(); render();
}

function setView(v, clearCat = true) {
    state.view = v;
    if (clearCat && v !== 'all') { state.catFilter = null; DOM.activeFilter.style.display = 'none'; }
    document.querySelectorAll('.nav-item').forEach(btn => { btn.classList.toggle('active', btn.dataset.view === v); });
    buildCategoryList(); render();
}

// ─── Detail Modal ─────────────────────────────────────────────
function openModal(id) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) return;
    state.modal = id;
    const isFav = state.favorites.has(id);
    const dur = fmtDuration(track.duration);
    const robloxUrl = `https://create.roblox.com/store/asset/${id}`;
    DOM.modalBody.innerHTML = `
        <div class="modal-cat">${esc(track.category)}</div>
        <div class="modal-title">${esc(track.title)}</div>
        <div class="modal-stats">
            <div class="modal-stat"><span class="s-label">${t('modal_duration')}</span><span class="s-val">${dur}</span></div>
            <div class="modal-stat"><span class="s-label">${t('modal_seconds')}</span><span class="s-val">${track.duration}</span></div>
            <div class="modal-stat"><span class="s-label">ID</span><span class="s-val" style="font-size:11px;font-family:'DM Mono',monospace">${esc(id)}</span></div>
        </div>
        <div class="modal-id-box">
            <span class="modal-id-val">${esc(id)}</span>
            <button class="modal-copy-btn" id="modalCopyId"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>${t('modal_copy_id')}</button>
        </div>
        <div class="modal-actions">
            <a class="btn-primary" href="${robloxUrl}" target="_blank" rel="noopener noreferrer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${t('modal_open_roblox')}</a>
            <button class="modal-fav-toggle${isFav?' active':''}" id="modalFavBtn">${isFav ? t('modal_fav_remove') : t('modal_fav_add')}</button>
            <button class="modal-edit-btn" id="modalEditBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${t('edit_track')}</button>
            <button class="modal-delete-btn" id="modalDeleteBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>${t('delete_track')}</button>
        </div>
    `;
    document.getElementById('modalCopyId')?.addEventListener('click', () => copyText(id, track.title));
    document.getElementById('modalFavBtn')?.addEventListener('click', () => { toggleFav(id); const f = state.favorites.has(id); const btn = document.getElementById('modalFavBtn'); if (btn) { btn.textContent = f ? t('modal_fav_remove') : t('modal_fav_add'); btn.classList.toggle('active', f); } });
    document.getElementById('modalEditBtn')?.addEventListener('click', () => { closeModal(); openEditModal(id); });
    document.getElementById('modalDeleteBtn')?.addEventListener('click', () => { closeModal(); deleteTrack(id); });
    DOM.modalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() { DOM.modalBackdrop.classList.remove('open'); document.body.style.overflow = ''; state.modal = null; }

// ─── Sidebar ──────────────────────────────────────────────────
let sidebarOverlay = null;
function openSidebar() {
    DOM.sidebar.classList.add('open');
    if (!sidebarOverlay) { sidebarOverlay = document.createElement('div'); sidebarOverlay.className = 'sidebar-overlay visible'; sidebarOverlay.addEventListener('click', closeSidebar); document.body.appendChild(sidebarOverlay); }
    else sidebarOverlay.classList.add('visible');
}
function closeSidebar() { DOM.sidebar.classList.remove('open'); if (sidebarOverlay) sidebarOverlay.classList.remove('visible'); }

function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }

// ─── Inject extra topbar buttons ──────────────────────────────
function injectTopbarButtons() {
    const right = document.querySelector('.topbar-right');
    if (!right) return;

    // Add track button
    const addBtn = document.createElement('button');
    addBtn.className = 'icon-btn';
    addBtn.id = 'addTrackBtn';
    addBtn.title = t('add_track');
    addBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    right.insertBefore(addBtn, right.firstChild);
    addBtn.addEventListener('click', openAddModal);

    // Download all button
    const dlBtn = document.createElement('button');
    dlBtn.id = 'downloadAllBtn';
    dlBtn.className = 'export-btn';
    dlBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>${t('download_all')}</span>`;
    DOM.statsBar.insertBefore(dlBtn, DOM.statsBar.querySelector('.stat-spacer'));
    dlBtn.addEventListener('click', downloadAllTracks);

    // Reset changes button (hidden until changes exist)
    const resetBtn = document.createElement('button');
    resetBtn.id = 'resetChangesBtn';
    resetBtn.className = 'icon-btn danger-btn';
    resetBtn.title = t('reset_changes');
    resetBtn.style.display = 'none';
    resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.89"/></svg>`;
    right.insertBefore(resetBtn, right.firstChild);
    resetBtn.addEventListener('click', resetAllChanges);
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
    const savedLang = localStorage.getItem(LS_LANG);
    if (savedLang === 'ru' || savedLang === 'en') state.lang = savedLang; else state.lang = 'ru';
    const savedTheme = localStorage.getItem(LS_THEME);
    setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark');
    document.getElementById('langToggle').textContent = state.lang === 'ru' ? 'RU' : 'EN';

    loadFavorites();
    loadOverrides();
    updateAllTexts();
    injectTopbarButtons();
    updateCounters();

    // Event listeners
    DOM.jsonInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
    DOM.searchInput.addEventListener('input', debounce(() => { state.query = DOM.searchInput.value; DOM.searchClear.classList.toggle('visible', state.query.length > 0); render(); }, 180));
    DOM.searchClear.addEventListener('click', () => { DOM.searchInput.value = ''; state.query = ''; DOM.searchClear.classList.remove('visible'); render(); DOM.searchInput.focus(); });
    DOM.sortSelect.addEventListener('change', () => { state.sort = DOM.sortSelect.value; render(); });
    document.querySelectorAll('.nav-item').forEach(btn => { btn.addEventListener('click', () => setView(btn.dataset.view)); });
    DOM.clearFavBtn.addEventListener('click', () => {
        if (state.favorites.size === 0) { toast(t('toast_info_no_fav'), 'info'); return; }
        if (!confirm(t('clear_fav_confirm', { count: state.favorites.size }))) return;
        state.favorites.clear(); saveFavorites(); updateCounters(); buildCategoryList(); render(); toast(t('toast_info_clear'), 'info');
    });
    [DOM.loadSampleBtn, DOM.emptySampleBtn].forEach(btn => { if (btn) btn.addEventListener('click', () => { if (loadTracks(SAMPLE_DATA)) toast(t('load_sample_success', { count: state.tracks.length }), 'success'); }); });
    DOM.exportBtn.addEventListener('click', exportFavorites);
    DOM.filterClear.addEventListener('click', () => setCatFilter(null));
    DOM.viewGrid.addEventListener('click', () => { state.layout = 'grid'; DOM.viewGrid.classList.add('active'); DOM.viewList.classList.remove('active'); render(); });
    DOM.viewList.addEventListener('click', () => { state.layout = 'list'; DOM.viewList.classList.add('active'); DOM.viewGrid.classList.remove('active'); render(); });
    DOM.modalClose.addEventListener('click', closeModal);
    DOM.modalBackdrop.addEventListener('click', e => { if (e.target === DOM.modalBackdrop) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); document.getElementById('formModalBackdrop')?.remove(); document.body.style.overflow = ''; } });
    DOM.sidebarToggle.addEventListener('click', () => { if (DOM.sidebar.classList.contains('open')) closeSidebar(); else openSidebar(); });
    DOM.themeToggle.addEventListener('click', toggleTheme);
    DOM.langToggle.addEventListener('click', () => { setLanguage(state.lang === 'ru' ? 'en' : 'ru'); });

    let dragCounter = 0;
    document.addEventListener('dragenter', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { dragCounter++; DOM.dropOverlay.classList.add('active'); } });
    document.addEventListener('dragleave', () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; DOM.dropOverlay.classList.remove('active'); } });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); dragCounter = 0; DOM.dropOverlay.classList.remove('active'); const file = e.dataTransfer.files[0]; if (file) handleFile(file); });
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); DOM.searchInput.focus(); DOM.searchInput.select(); } });

    // Auto-load from remote
    await loadRemote();
}

document.addEventListener('DOMContentLoaded', init);
console.log('%c🎧 AudioVault v3 ready (edit/delete/add + auto-load)', 'color:#3ecfff;font-family:monospace;font-size:12px');
