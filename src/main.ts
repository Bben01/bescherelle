import './style.css';
import { BINYANIM, BINYAN_ORDER, CODE_TO_HEBREW, KEYBOARD_ROWS, hkey, isHebrew } from './hebrew.ts';
import { CELL_LABEL, TENSES, headForm, loadExamples, loadVerbs, type Verb } from './data.ts';
import { SearchIndex, type SearchMode } from './search.ts';
import {
  esc, formHtml, indexCtx, pageDescription, pageTitle, renderAbout, renderBinyanim, renderCompare,
  renderCompareShell, renderHome, renderList, renderResults, renderRoot, renderSearchForm, renderTatoeba, renderVerb, verbCard, verbUrl, type Ctx,
} from './render.ts';

const app = document.getElementById('app')!;
const nav = window.history;
let ctx: Ctx;
let index: SearchIndex;
let byId = new Map<string, Verb>();

// ---------- Settings & storage ----------

interface Settings { niqqud: boolean; ktiv: boolean; tr: boolean; trStyle: 'fr' | 'en'; theme: 'auto' | 'light' | 'dark'; phys: boolean }
const DEFAULTS: Settings = { niqqud: true, ktiv: true, tr: true, trStyle: 'fr', theme: 'auto', phys: false };
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let settings: Settings = { ...DEFAULTS, ...store.get<Partial<Settings>>('settings', {}) };

function applySettings() {
  const c = document.documentElement.classList;
  c.toggle('no-niqqud', !settings.niqqud);
  c.toggle('no-ktiv', !settings.ktiv);
  c.toggle('no-tr', !settings.tr);
  c.toggle('tr-style-en', settings.trStyle === 'en');
  c.toggle('dark', settings.theme === 'dark');
  c.toggle('light', settings.theme === 'light');
  document.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((el) => {
    const k = el.dataset.setting as keyof Settings;
    if (el.type === 'checkbox') el.checked = Boolean(settings[k]);
    else if (el.type === 'radio') el.checked = String(settings[k]) === el.value;
  });
}

const favs = () => store.get<string[]>('favs', []);
const seen = () => store.get<string[]>('history', []);
function pushHistory(id: string) { store.set('history', [id, ...seen().filter((x) => x !== id)].slice(0, 40)); }

function refreshFavButtons() {
  const f = new Set(favs());
  document.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => {
    const on = f.has(b.dataset.fav!);
    b.textContent = on ? '★' : '☆';
    b.classList.toggle('on', on);
    b.title = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
  });
}

// ---------- Toast, speech, copy ----------

let toastTimer = 0;
function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), 2000);
}

function hebrewVoice(): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  return speechSynthesis.getVoices().find((v) => /^(he|iw)/i.test(v.lang));
}

function say(text: string) {
  const voice = hebrewVoice();
  if (voice) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice.lang;
    u.voice = voice;
    u.rate = 0.85;
    speechSynthesis.speak(u);
  }
  const msg = voice ? `🔊 ${text}` : text;
  const copy = navigator.clipboard?.writeText(text);
  if (copy) copy.then(() => toast(`${msg} — copié${voice ? '' : ' (pas de voix hébraïque sur cet appareil)'}`), () => toast(msg));
  else toast(msg);
}

// ---------- Router ----------

function setMeta(title: string, desc?: string) {
  document.title = title;
  if (desc) document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
}

function navigate(url: string, replace = false) {
  if (replace) nav.replaceState(null, '', url); else nav.pushState(null, '', url);
  route();
  if (!replace) window.scrollTo(0, 0);
}

function markNav(path: string) {
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => {
    const href = a.getAttribute('href')!;
    a.classList.toggle('on', href === '/' ? path === '/' || path.startsWith('/verbe') : path.startsWith(href));
  });
}

function route() {
  const { pathname, searchParams } = new URL(location.href);
  const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
  markNav(path);
  const m = path.match(/^\/(verbe|racine)\/(.+)$/);
  if (m?.[1] === 'verbe') return showVerb(m[2], searchParams.get('hl')?.split(',') ?? []);
  if (m?.[1] === 'racine') {
    app.innerHTML = renderRoot(hkey(m[2]), ctx);
    return setMeta(`Racine ${m[2]} – verbes hébreux | Bescherelle hébreu`);
  }
  switch (path) {
    case '/': return showHome(searchParams);
    case '/liste': app.innerHTML = renderList(ctx, searchParams); return setMeta('Liste des verbes hébreux | Bescherelle hébreu');
    case '/binyanim': app.innerHTML = renderBinyanim(ctx); return setMeta('Les binyanim et gizrot | Bescherelle hébreu');
    case '/a-propos': app.innerHTML = renderAbout(ctx); return setMeta('À propos | Bescherelle hébreu');
    case '/comparer': return showCompare(searchParams);
    case '/quiz': return showQuiz(searchParams);
    case '/favoris': return showFavs();
    case '/hasard': {
      const pool = ctx.verbs.filter((v) => v.fr.length);
      return navigate(verbUrl(pool[Math.floor(Math.random() * pool.length)]), true);
    }
    default:
      app.innerHTML = `<h1>Page introuvable</h1><p><a href="/">Retour à la recherche</a></p>`;
      setMeta('Page introuvable | Bescherelle hébreu');
  }
}

function showVerb(id: string, hl: string[]) {
  const v = byId.get(id) ?? index.search(id, { limit: 1 })[0]?.verb;
  if (!v) {
    app.innerHTML = `<h1>Verbe introuvable</h1><p>Aucun verbe « ${esc(id)} ». <a href="/?q=${encodeURIComponent(id)}">Lancer une recherche</a>.</p>`;
    return;
  }
  app.innerHTML = renderVerb(v, ctx, hl);
  setMeta(pageTitle(v), pageDescription(v));
  loadExamples().then((ex) => {
    const box = document.getElementById('tatoeba');
    if (box && (box.closest('[data-id]') as HTMLElement | null)?.dataset.id === v.id) box.innerHTML = renderTatoeba(v, ex[v.id]);
  });
  pushHistory(v.id);
  refreshFavButtons();
  if (hl.length) document.getElementById(`c-${hl[0].replace('.', '-')}`)?.scrollIntoView({ block: 'center' });
}

// ---------- Home / search ----------

function dailyVerb(): Verb | undefined {
  const pool = ctx.verbs.filter((v) => v.fr.length && !v.mt && v.forms['inf']?.length);
  if (!pool.length) return undefined;
  const day = Math.floor(Date.now() / 86400000);
  return pool[(day * 7919) % pool.length];
}

function showHome(params: URLSearchParams) {
  const q = params.get('q') ?? '', mode = (params.get('mode') ?? 'auto') as SearchMode;
  app.innerHTML = renderHome(ctx, dailyVerb());
  app.querySelector('form.search')!.outerHTML = renderSearchForm(q, mode, params.get('b') ?? '', params.get('g') ?? '');
  setMeta('Bescherelle hébreu – conjugaison des verbes hébreux en français');
  bindSearch();
  if (q || params.get('b') || params.get('g')) runSearch(false);
}

function readForm() {
  const fd = new FormData(app.querySelector<HTMLFormElement>('form.search')!);
  return { q: String(fd.get('q') ?? ''), mode: String(fd.get('mode') ?? 'auto') as SearchMode, b: String(fd.get('b') ?? ''), g: String(fd.get('g') ?? '') };
}

function runSearch(updateUrl = true) {
  const { q, mode, b, g } = readForm();
  const res = document.getElementById('results')!;
  const extra = document.getElementById('home-extra');
  if (extra) extra.hidden = q.trim() !== '' || b !== '' || g !== '';
  if (!q.trim() && (b || g)) {
    res.innerHTML = `<p><a href="/liste?${new URLSearchParams({ ...(b && { b }), ...(g && { g }) })}">Voir tous les verbes de ce groupe →</a></p>`;
  } else {
    res.innerHTML = renderResults(index.search(q, { mode, binyan: b || undefined, gizra: g || undefined }), q);
  }
  if (updateUrl) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (mode !== 'auto') p.set('mode', mode);
    if (b) p.set('b', b);
    if (g) p.set('g', g);
    nav.replaceState(null, '', p.toString() ? `/?${p}` : '/');
  }
  if (q) document.title = `${q} – recherche | Bescherelle hébreu`;
}

// On touch devices, Enter ("Rechercher"/"OK") should hide the virtual keyboard so results are visible.
const touchScreen = matchMedia('(pointer: coarse)');
function dismissKeyboard() {
  if (touchScreen.matches && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
}

let searchTimer = 0;
function bindSearch() {
  const form = app.querySelector<HTMLFormElement>('form.search');
  if (!form) return;
  form.addEventListener('submit', (e) => { e.preventDefault(); dismissKeyboard(); runSearch(); });
  form.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => runSearch(), 120); });
  form.addEventListener('change', () => runSearch());
  const adv = form.querySelector<HTMLDetailsElement>('details.adv');
  if (adv && matchMedia('(min-width: 641px)').matches) adv.open = true;
  bindKeyboard(form);
}

// ---------- Hebrew keyboard ----------

function insertText(input: HTMLInputElement, text: string) {
  const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? input.value.length;
  input.setRangeText(text, s, e, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderKeyboard(): string {
  return KEYBOARD_ROWS.map((row) => `<div class="krow">${row.map((k) => `<button type="button" data-key="${k}" lang="he">${k}</button>`).join('')}</div>`).join('')
    + `<div class="krow"><button type="button" data-key="?" title="Une lettre quelconque (mode motif)">?</button><button type="button" data-key="*" title="Plusieurs lettres (mode motif)">*</button><button type="button" data-key=" " class="space">espace</button><button type="button" data-key="⌫" title="Effacer" aria-label="Effacer">⌫</button></div>
      <label class="phys"><input type="checkbox" data-setting="phys"> Taper en hébreu avec le clavier physique (disposition israélienne)</label>`;
}

function bindKeyboard(scope: HTMLElement) {
  const toggle = scope.querySelector<HTMLButtonElement>('#kbd-toggle');
  const kbd = scope.querySelector<HTMLDivElement>('#kbd');
  const input = scope.querySelector<HTMLInputElement>('input[type=search], input[type=text]');
  if (!toggle || !kbd || !input) return;
  kbd.innerHTML = renderKeyboard();
  kbd.hidden = !store.get('kbdOpen', false);
  toggle.setAttribute('aria-expanded', String(!kbd.hidden));
  toggle.addEventListener('click', () => {
    kbd.hidden = !kbd.hidden;
    store.set('kbdOpen', !kbd.hidden);
    toggle.setAttribute('aria-expanded', String(!kbd.hidden));
    input.focus();
  });
  kbd.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('[data-key]')) e.preventDefault(); });
  kbd.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-key]')?.dataset.key;
    if (!k) return;
    if (k === '⌫') {
      const s = input.selectionStart ?? input.value.length, en = input.selectionEnd ?? s;
      if (s === en && s > 0) input.setRangeText('', s - 1, s, 'end'); else input.setRangeText('', s, en, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else insertText(input, k);
  });
  applySettings();
}

document.addEventListener('keydown', (e) => {
  if (!settings.phys || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement) || !['search', 'text'].includes(t.type)) return;
  const he = CODE_TO_HEBREW[e.code];
  if (he) { e.preventDefault(); insertText(t, he); }
});

// ---------- Compare ----------

function showCompare(params: URLSearchParams) {
  setMeta('Comparer des verbes hébreux | Bescherelle hébreu');
  const ids = (params.get('v') ?? '').split(',').map((s) => decodeURIComponent(s)).filter((id) => byId.has(id)).slice(0, 4);
  app.innerHTML = renderCompareShell();
  const out = document.getElementById('cmp')!;
  const draw = () => {
    out.innerHTML = renderCompare(ids.map((id) => byId.get(id)!));
    nav.replaceState(null, '', ids.length ? `/comparer?v=${ids.map(encodeURIComponent).join(',')}` : '/comparer');
  };
  draw();
  const input = document.getElementById('cmp-q') as HTMLInputElement, sugg = document.getElementById('cmp-sugg')!;
  input.addEventListener('input', () => {
    const hits = index.search(input.value, { limit: 8 });
    sugg.innerHTML = hits.map((h) => `<button type="button" data-add="${esc(h.verb.id)}">${formHtml(headForm(h.verb), { button: false })} <small>${esc(h.verb.fr[0] ?? h.verb.en[0] ?? '')} · ${esc(BINYANIM[h.verb.b]?.fr ?? '')}</small></button>`).join('');
  });
  input.form!.addEventListener('submit', (e) => { e.preventDefault(); dismissKeyboard(); sugg.querySelector<HTMLButtonElement>('[data-add]')?.click(); });
  app.onclick = (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-add]')?.dataset.add;
    const rem = t.closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (add && !ids.includes(add) && ids.length < 4) { ids.push(add); input.value = ''; sugg.innerHTML = ''; draw(); }
    if (rem) { ids.splice(ids.indexOf(rem), 1); draw(); }
  };
}

// ---------- Favorites ----------

function showFavs() {
  setMeta('Mes favoris | Bescherelle hébreu');
  const f = favs().map((id) => byId.get(id)).filter(Boolean) as Verb[];
  const h = seen().map((id) => byId.get(id)).filter(Boolean) as Verb[];
  app.innerHTML = `<h1>Favoris</h1>${f.length ? `<div class="cards">${f.map((v) => verbCard(v)).join('')}</div>
      <p><a href="/comparer?v=${f.slice(0, 4).map((v) => encodeURIComponent(v.id)).join(',')}">Comparer mes favoris</a> · <a href="/quiz?favs=1">Quiz sur mes favoris</a></p>`
    : '<p class="empty">Aucun favori pour l\'instant. Cliquez sur ☆ sur la page d\'un verbe.</p>'}
    <h2>Historique</h2>${h.length ? `<div class="cards">${h.map((v) => verbCard(v)).join('')}</div><p><button type="button" class="link" id="clear-hist">Effacer l'historique</button></p>` : '<p class="empty">Aucun verbe consulté.</p>'}`;
  document.getElementById('clear-hist')?.addEventListener('click', () => { store.set('history', []); showFavs(); });
}

// ---------- Quiz ----------

interface QuizPrefs { kind: 'conj' | 'sens'; level: 'common' | 'all'; tenses: string[]; binyanim: string[] }

function showQuiz(params: URLSearchParams) {
  setMeta('Quiz de conjugaison hébraïque | Bescherelle hébreu');
  const onlyFavs = params.get('favs') === '1';
  const prefs: QuizPrefs = { kind: 'conj', level: 'common', tenses: ['pr', 'p', 'fut'], binyanim: [...BINYAN_ORDER], ...store.get<Partial<QuizPrefs>>('quiz', {}) };
  let score = 0, total = 0, streak = 0;
  app.innerHTML = `<h1>S'entraîner</h1>
  <form id="quiz-opts" class="quiz-opts">
    <fieldset><legend>Exercice</legend>
      <label><input type="radio" name="kind" value="conj"${prefs.kind === 'conj' ? ' checked' : ''}> Conjuguer (écrire la forme)</label>
      <label><input type="radio" name="kind" value="sens"${prefs.kind === 'sens' ? ' checked' : ''}> Sens du verbe (QCM)</label></fieldset>
    <fieldset><legend>Verbes</legend>
      <label><input type="radio" name="level" value="common"${prefs.level === 'common' ? ' checked' : ''}> Les 300 plus courants</label>
      <label><input type="radio" name="level" value="all"${prefs.level === 'all' ? ' checked' : ''}> Tous</label></fieldset>
    <fieldset><legend>Temps</legend>${TENSES.map((t) => `<label><input type="checkbox" name="t" value="${t.id}"${prefs.tenses.includes(t.id) ? ' checked' : ''}> ${esc(t.fr)}</label>`).join('')}</fieldset>
    <fieldset><legend>Binyanim</legend>${BINYAN_ORDER.map((b) => `<label><input type="checkbox" name="b" value="${b}"${prefs.binyanim.includes(b) ? ' checked' : ''}> ${esc(BINYANIM[b].fr)}</label>`).join('')}</fieldset>
    ${onlyFavs ? '<p class="note">Quiz limité à vos favoris.</p>' : ''}
  </form>
  <div id="quiz" class="quiz panel"></div>`;
  const opts = document.getElementById('quiz-opts') as HTMLFormElement;
  const box = document.getElementById('quiz')!;
  const favSet = new Set(favs());
  const common = new Set([...ctx.verbs].sort((x, y) => (y.q ?? 0) - (x.q ?? 0)).slice(0, 300));
  const pool = () => ctx.verbs.filter((v) => prefs.binyanim.includes(v.b) && v.fr.length && (!onlyFavs || favSet.has(v.id)) && (onlyFavs || prefs.level === 'all' || common.has(v)));
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const scoreLine = () => `<p class="score">Score : ${score} / ${total}${streak > 1 ? ` · série de ${streak} 🔥` : ''}</p>`;
  const record = (ok: boolean) => { total++; if (ok) { score++; streak++; } else streak = 0; };
  const nextBtn = () => {
    const b = document.getElementById('qnext')!;
    b.addEventListener('click', next);
    b.focus();
  };

  function next() {
    const p = pool();
    if (!p.length) { box.innerHTML = '<p class="empty">Aucun verbe ne correspond à ces options.</p>'; return; }
    const v = pick(p);
    if (prefs.kind === 'sens') {
      const others = new Set<string>();
      for (let i = 0; others.size < 3 && i < 50; i++) { const o = pick(p); if (o !== v && !v.fr.includes(o.fr[0])) others.add(o.fr[0]); }
      const choices = [...others, v.fr[0]].sort(() => Math.random() - 0.5);
      box.innerHTML = `${scoreLine()}<p class="q">Que signifie ${formHtml(headForm(v), { big: true })} ?</p>
        <div class="choices">${choices.map((c) => `<button type="button" class="choice" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div><div class="fb"></div>`;
      box.querySelectorAll<HTMLButtonElement>('.choice').forEach((b) => b.addEventListener('click', () => {
        const ok = b.dataset.c === v.fr[0];
        record(ok);
        box.querySelectorAll<HTMLButtonElement>('.choice').forEach((x) => { x.disabled = true; x.classList.toggle('good', x.dataset.c === v.fr[0]); });
        if (!ok) b.classList.add('bad');
        box.querySelector('.fb')!.innerHTML = `<p>${ok ? '✅ Bravo !' : '❌'} <a href="${verbUrl(v)}">${esc(v.fr.join(', '))}</a></p><button type="button" class="primary" id="qnext">Suivant →</button>`;
        nextBtn();
      }));
      return;
    }
    const cells = TENSES.filter((t) => prefs.tenses.includes(t.id)).flatMap((t) => t.cells).filter((c) => v.forms[c.k]?.length);
    if (!cells.length) { box.innerHTML = '<p class="empty">Choisissez au moins un temps.</p>'; return; }
    const c = pick(cells);
    const answers = v.forms[c.k];
    box.innerHTML = `${scoreLine()}<p class="q">${formHtml(headForm(v), { big: true })} <span class="qfr">(${esc(v.fr.slice(0, 2).join(', '))})</span></p>
      <p class="q2">${esc(CELL_LABEL[c.k])} — <span lang="he" dir="rtl">${esc(c.pron)}</span></p>
      <form class="qa"><div class="search-row"><input type="text" id="qans" dir="rtl" lang="he" autocomplete="off" placeholder="Réponse en hébreu (nikoud facultatif)">
      <button type="button" class="icon" id="kbd-toggle" aria-label="Clavier hébreu">⌨︎ א</button><button class="primary">Vérifier</button></div>
      <div id="kbd" class="kbd" hidden></div></form><div class="fb"></div>`;
    const formEl = box.querySelector<HTMLFormElement>('form.qa')!;
    bindKeyboard(formEl);
    const input = document.getElementById('qans') as HTMLInputElement;
    input.focus();
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.disabled) return;
      const k = hkey(input.value);
      const ok = !!k && answers.some((a) => hkey(a.p) === k || hkey(a.u) === k);
      record(ok);
      box.querySelector('.fb')!.innerHTML = `<p>${ok ? '✅ Bravo !' : '❌ Réponse :'} ${answers.map((a) => formHtml(a)).join(' / ')}</p>
        <button type="button" class="primary" id="qnext">Suivant →</button> <a href="${verbUrl(v, [c.k])}">Voir le tableau</a>`;
      input.disabled = true;
      nextBtn();
    });
  }
  opts.addEventListener('change', () => {
    const fd = new FormData(opts);
    prefs.kind = (fd.get('kind') as QuizPrefs['kind']) ?? 'conj';
    prefs.level = (fd.get('level') as QuizPrefs['level']) ?? 'common';
    prefs.tenses = fd.getAll('t').map(String);
    prefs.binyanim = fd.getAll('b').map(String);
    store.set('quiz', prefs);
    next();
  });
  next();
}

// ---------- Global events ----------

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const sayEl = t.closest<HTMLElement>('[data-say]');
  if (sayEl) { e.preventDefault(); say(sayEl.dataset.say!); return; }
  const favEl = t.closest<HTMLElement>('[data-fav]');
  if (favEl) {
    const id = favEl.dataset.fav!, f = favs();
    store.set('favs', f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]);
    refreshFavButtons();
    toast(f.includes(id) ? 'Retiré des favoris' : 'Ajouté aux favoris ★');
    return;
  }
  const a = t.closest<HTMLAnchorElement>('a[href]');
  if (a && a.origin === location.origin && !a.target && !e.ctrlKey && !e.metaKey && !e.shiftKey && !a.hasAttribute('download')
      && !a.pathname.startsWith('/data/') && ctx) {
    e.preventDefault();
    document.getElementById('settings')?.removeAttribute('open');
    app.onclick = null;
    navigate(a.pathname + a.search + a.hash);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset?.setting as keyof Settings | undefined;
  if (!k) return;
  settings = { ...settings, [k]: el.type === 'checkbox' ? el.checked : el.value } as Settings;
  store.set('settings', settings);
  applySettings();
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
    const q = document.getElementById('q') as HTMLInputElement | null;
    e.preventDefault();
    if (q) { q.focus(); q.select(); } else navigate('/');
  }
});

window.addEventListener('popstate', () => { app.onclick = null; route(); });

// ---------- Boot ----------

async function boot() {
  applySettings();
  try {
    const verbs = await loadVerbs();
    ctx = indexCtx(verbs);
    byId = new Map(verbs.map((v) => [v.id, v]));
    index = new SearchIndex(verbs);
    route();
    index.warmup();
  } catch (err) {
    app.insertAdjacentHTML('afterbegin', `<p class="error">Impossible de charger les données (${esc(String(err))}). Vérifiez votre connexion.</p>`);
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Hebrew typed directly in the URL bar (e.g. /שמר) → search.
const rawPath = decodeURIComponent(location.pathname);
if (isHebrew(rawPath) && !/^\/(verbe|racine)\//.test(rawPath)) {
  nav.replaceState(null, '', `/?q=${encodeURIComponent(rawPath.slice(1))}`);
}
boot();
