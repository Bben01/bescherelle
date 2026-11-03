// Pure HTML-string renderers, shared by the client app and the static prerenderer.
import { BINYANIM, BINYAN_ORDER, BINYAN_SUB, GIZROT, formatRoot, hkey, stripNiqqud, translit } from './hebrew.ts';
import { CELL_LABEL, OTHER_CELLS, TENSES, headForm, type Form, type TatoebaEx, type Verb } from './data.ts';
import { SECTIONS, describeCells, type Hit, type SearchMode } from './search.ts';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const verbUrl = (v: Verb, hl?: string[]) => `/verbe/${encodeURIComponent(v.id)}${hl?.length ? `?hl=${hl.join(',')}` : ''}`;
export const rootUrl = (rootKey: string) => `/racine/${encodeURIComponent(rootKey)}`;

export interface Ctx { verbs: Verb[]; byKey?: Map<string, Verb[]>; byRoot?: Map<string, Verb[]> }

export function indexCtx(verbs: Verb[]): Ctx {
  const byKey = new Map<string, Verb[]>(), byRoot = new Map<string, Verb[]>();
  for (const v of verbs) {
    const k = hkey(v.w);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(v);
    if (!byRoot.has(v.rootKey)) byRoot.set(v.rootKey, []);
    byRoot.get(v.rootKey)!.push(v);
  }
  return { verbs, byKey, byRoot };
}

const he = (s: string, cls = '') => `<span lang="he" dir="rtl"${cls ? ` class="${cls}"` : ''}>${esc(s)}</span>`;

/** A Hebrew form with pointed / unpointed / transliterations; visibility is driven by body classes. */
export function formHtml(f: Form, opts: { big?: boolean; button?: boolean } = {}): string {
  const inner = `<span class="p" lang="he" dir="rtl">${esc(f.p)}</span>`
    + `<span class="u" lang="he" dir="rtl">${esc(f.u)}</span>`
    + `<span class="tr tr-fr">${esc(translit(f.p, 'fr'))}</span>`
    + `<span class="tr tr-en">${esc(translit(f.p, 'en'))}</span>`;
  const cls = `form${opts.big ? ' big' : ''}`;
  return opts.button === false
    ? `<span class="${cls}">${inner}</span>`
    : `<button type="button" class="${cls}" data-say="${esc(f.p)}" title="Écouter / copier">${inner}</button>`;
}

export function binyanBadge(v: Verb): string {
  const b = BINYANIM[v.b];
  if (!b) return '';
  const sub = v.bs ? ` <small>(${esc(BINYAN_SUB[v.bs] ?? v.bs)})</small>` : '';
  return `<a class="badge b-${esc(v.b)}" href="/liste?b=${esc(v.b)}">${esc(b.fr)}${sub}</a>`;
}

function translations(v: Verb, max = 6): string {
  if (v.fr.length) {
    return `<span class="fr-tr">${v.fr.slice(0, max).map(esc).join(', ')}</span>${v.mt ? ' <span class="mt" title="Traduction automatique depuis l\'anglais">auto</span>' : ''}`;
  }
  return `<span class="en-tr" title="Pas encore de traduction française : glose anglaise">🇬🇧 ${v.en.slice(0, 3).map(esc).join('; ')}</span>`;
}

export function verbCard(v: Verb, extra = '', hl?: string[]): string {
  const f = headForm(v);
  return `<a class="card" href="${verbUrl(v, hl)}">
    <span class="card-he">${formHtml(f, { button: false })}</span>
    <span class="card-meta">${binyanBadge(v).replace(/<a /, '<span ').replace(/<\/a>/, '</span>').replace(/ href="[^"]*"/, '')}
      <span class="root" lang="he">${esc(formatRoot(v.r))}</span></span>
    <span class="card-tr">${translations(v, 4)}</span>
    ${extra ? `<span class="card-extra">${extra}</span>` : ''}
  </a>`;
}

export function renderResults(hits: Hit[], q: string, limit = 120): string {
  if (!q.trim()) return '';
  if (!hits.length) {
    return `<p class="empty">Aucun verbe trouvé pour « ${esc(q)} ». Essayez un autre mode de recherche, une racine (ex. <a href="/?q=כתב&amp;mode=root">כתב</a>) ou un mot français.</p>`;
  }
  const groups = new Map<string, Hit[]>();
  for (const h of hits.slice(0, limit)) {
    if (!groups.has(h.section)) groups.set(h.section, []);
    groups.get(h.section)!.push(h);
  }
  let html = `<p class="count">${hits.length} verbe${hits.length > 1 ? 's' : ''}${hits.length > limit ? ` (${limit} premiers affichés)` : ''}</p>`;
  for (const [section, hs] of groups) {
    html += `<section class="group"><h3>${esc(SECTIONS[section] ?? section)} <small>${hs.length}</small></h3><div class="cards">`;
    for (const h of hs) {
      const extra = [h.cells?.length ? esc(describeCells(h.cells.slice(0, 3))) : '', h.detail ? esc(h.detail) : ''].filter(Boolean).join(' — ');
      html += verbCard(h.verb, extra, h.cells);
    }
    html += '</div></section>';
  }
  return html;
}

const MODES: [SearchMode, string, string][] = [
  ['auto', 'Intelligent', 'Détection automatique : français, hébreu, forme conjuguée, racine, prononciation…'],
  ['root', 'Racine', 'Racine exacte, puis racines contenant ces lettres'],
  ['contains', 'Contient', 'Verbes dont une forme contient cette suite de lettres'],
  ['subseq', 'Lettres dans l\'ordre', 'Les lettres apparaissent dans cet ordre (pas forcément collées)'],
  ['anyorder', 'Lettres (désordre)', 'Toutes les lettres présentes, dans n\'importe quel ordre'],
  ['pattern', 'Motif ? *', '? = une lettre, * = plusieurs lettres. Ex. ש?ר, *מר, ה*יל'],
  ['fr', 'Français', 'Recherche dans les traductions françaises'],
  ['translit', 'Prononciation', 'Ex. lichmor, katav, hitkonen'],
];

export function renderSearchForm(q = '', mode: SearchMode = 'auto', b = '', g = ''): string {
  return `<form class="search" role="search" action="/" method="get">
    <div class="search-row">
      <input id="q" name="q" type="search" enterkeyhint="search" value="${esc(q)}" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="garder, שמר, לשמור, אשמור, ש?ר, lichmor…" aria-label="Rechercher un verbe" dir="auto" autofocus>
      <button type="button" class="icon" id="kbd-toggle" title="Clavier hébreu" aria-label="Clavier hébreu">⌨︎ א</button>
      <button type="submit" class="primary">Chercher</button>
    </div>
    <div id="kbd" class="kbd" hidden></div>
    <details class="adv"${mode !== 'auto' || b || g ? ' open' : ''}>
      <summary>Options de recherche${mode !== 'auto' || b || g ? ' <span class="adv-on" aria-label="actives">•</span>' : ''}</summary>
      <div class="adv-body">
    <div class="modes" role="radiogroup" aria-label="Mode de recherche">
      ${MODES.map(([m, label, title]) => `<label title="${esc(title)}"><input type="radio" name="mode" value="${m}"${m === mode ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}
    </div>
    <div class="filters">
      <select name="b" aria-label="Binyan"><option value="">Tous les binyanim</option>
        ${BINYAN_ORDER.map((k) => `<option value="${k}"${k === b ? ' selected' : ''}>${esc(BINYANIM[k].fr)} ${esc(BINYANIM[k].he)}</option>`).join('')}</select>
      <select name="g" aria-label="Type de racine"><option value="">Tous types de racines</option>
        ${Object.entries(GIZROT).map(([k, x]) => `<option value="${k}"${k === g ? ' selected' : ''}>${esc(x.fr)}</option>`).join('')}</select>
    </div>
      </div>
    </details>
  </form>`;
}

export function renderHome(ctx: Ctx, daily?: Verb): string {
  const n = ctx.verbs.length;
  const examples = ['parler', 'שמר', 'אשמור', 'ונכתוב', 'כתב', 'ש?ר', 'lichmor', 'se souvenir', 'מרש'];
  return `<section class="hero">
    <h1>Conjugueur hébreu – français</h1>
    <p class="lead">${n.toLocaleString('fr-FR')} verbes conjugués à tous les temps, avec nikoud, écriture pleine et prononciation. Cherchez en français, en hébreu (avec ou sans nikoud), par racine, par forme conjuguée, ou par lettres.</p>
    ${renderSearchForm()}
    <p class="examples">Exemples : ${examples.map((e) => `<span class="ex"><a href="/?q=${encodeURIComponent(e)}">${esc(e)}</a></span>`).join('')}</p>
  </section>
  <div id="results"></div>
  <div id="home-extra"><section class="home-grid">
    ${daily ? `<div class="panel"><h2>Verbe du jour</h2>${verbCard(daily)}<p class="more"><a href="/hasard" data-random>Un verbe au hasard 🎲</a></p></div>` : ''}
    <div class="panel explore"><h2>Explorer</h2><ul class="links">
      <li><a href="/binyanim">Les 7 binyanim et les types de racines</a></li>
      <li><a href="/liste">Liste de tous les verbes</a> · <a href="/liste?tri=freq">les plus courants</a></li>
      <li><a href="/comparer">Comparer des verbes</a></li>
      <li><a href="/quiz">S'entraîner (quiz)</a></li>
      <li><a href="/favoris">Mes favoris et historique</a></li>
      <li><a href="/hasard" data-random>Un verbe au hasard 🎲</a></li>
    </ul></div>
  </section>
  <section class="common"><h2>Les verbes les plus courants</h2>
    <div class="cards">${[...ctx.verbs].sort((x, y) => (y.q ?? 0) - (x.q ?? 0)).slice(0, 12).map((v) => verbCard(v)).join('')}</div>
    <p><a href="/liste?tri=freq">Voir la liste complète par fréquence →</a></p>
  </section></div>`;
}

function findVerbByForm(ctx: Ctx, s?: string): Verb | undefined {
  if (!s || !ctx.byKey) return undefined;
  return ctx.byKey.get(hkey(s))?.[0];
}

/** Grammatical person of a Hebrew pronoun: אני/אנחנו → 1, את… → 2, הוא/היא/הם/הן → 3. */
const pronPerson = (p: string) => { const s = stripNiqqud(p); return s.startsWith('אנ') ? 1 : s.startsWith('את') ? 2 : 3; };

/** Pronoun list ("אֲנִי, אַתָּה, הוּא") with each pronoun colour-coded by person. */
export const pronHtml = (pron: string) => pron.split(', ').map((p) => `<span class="pp${pronPerson(p)}">${esc(p)}</span>`).join(', ');

/** Cell key → person (imperative is always 2nd; present mixes all persons) and number. */
function cellGroup(k: string): { person: string; plural: boolean } {
  return { person: /\.(\d)/.exec(k)?.[1] ?? (k.startsWith('imp.') ? '2' : ''), plural: k.endsWith('p') };
}

/** Gizrot grouped by which radical is weak (1st, 2nd, 3rd), plus regular and quadriliteral roots. */
const GIZRA_POS: Record<string, string> = {
  shlemim: 'reg', merubaim: 'quad', pg: 'first', pn: 'first', py: 'first', pa: 'first',
  ag: 'mid', aw: 'mid', aa: 'mid', lg: 'last', lh: 'last', la: 'last',
};

function tenseTable(v: Verb, t: (typeof TENSES)[number], hl: Set<string>): string {
  const rows = t.cells.filter((c) => v.forms[c.k]?.length);
  if (!rows.length) return '';
  const firstPlural = rows.find((c) => cellGroup(c.k).plural);
  const body = rows.map((c) => {
    const { person } = cellGroup(c.k);
    const cls = [hl.has(c.k) && 'hl', person && `pers-${person}`, c === firstPlural && c !== rows[0] && 'pl-start'].filter(Boolean).join(' ');
    return `<tr class="${cls}" id="c-${c.k.replace('.', '-')}">
      <th scope="row"><span class="pron" lang="he" dir="rtl">${pronHtml(c.pron)}</span><span class="pfr">${esc(c.fr)}</span></th>
      <td>${v.forms[c.k].map((f) => formHtml(f)).join('<span class="or">ou</span>')}</td></tr>`;
  }).join('');
  let note = '';
  if (t.id === 'imp' && v.forms['fut.2ms']?.[0]) {
    note = `<p class="note">Impératif négatif : <span lang="he" dir="rtl">אַל</span> + futur, ex. ${he('אַל ' + v.forms['fut.2ms'][0].p, 'p')}${he('אל ' + v.forms['fut.2ms'][0].u, 'u')}</p>`;
  }
  return `<section class="tense t-${t.id}"><h2>${esc(t.fr)} <span lang="he" dir="rtl">${esc(t.he)}</span></h2>
    <table>${body}</table>${note}</section>`;
}

const PREFIXES = ['', 'ו', 'ש', 'וש', 'כש', 'וכש'];

/** Hebrew sentence with the conjugated verb form highlighted. */
function markForm(sentence: string, forms: Form[]): string {
  const targets = new Set(forms.map((f) => f.u));
  return sentence.split(/(\s+)/).map((tok) => {
    const bare = hkey(tok.replace(/[^\u05D0-\u05EA\u05B0-\u05C7]/g, ''));
    return PREFIXES.some((p) => bare.startsWith(p) && targets.has(bare.slice(p.length))) ? `<mark>${esc(tok)}</mark>` : esc(tok);
  }).join('');
}

export function renderTatoeba(v: Verb, ex: TatoebaEx[] | undefined): string {
  if (!ex?.length) return '';
  return `<h2>Phrases d'exemple</h2><ul>${ex.map(([id, h, fr, cell]) => `<li>
    <p lang="he" dir="rtl" class="ex-he">${markForm(h, v.forms[cell] ?? [])} <button type="button" class="icon mini" data-say="${esc(h)}" aria-label="Écouter">🔊</button></p>
    <p class="ex-fr">${esc(fr)}</p>
    <p class="ex-meta"><a href="${verbUrlCell(v, cell)}">${esc(CELL_LABEL[cell] ?? cell)}</a> · <a href="https://tatoeba.org/fr/sentences/show/${id}" rel="noopener" target="_blank">Tatoeba #${id}</a></p></li>`).join('')}</ul>
  <p class="note">Phrases de <a href="https://tatoeba.org" rel="noopener" target="_blank">Tatoeba</a> (CC BY 2.0 FR), associées automatiquement : une forme identique peut appartenir à un autre mot.</p>`;
}

const verbUrlCell = (v: Verb, cell: string) => verbUrl(v, [cell]);

export function renderVerb(v: Verb, ctx: Ctx, hlCells: string[] = [], tatoeba?: TatoebaEx[]): string {
  const hl = new Set(hlCells);
  const f = headForm(v);
  const g = v.g.map((k) => GIZROT[k] ? `<a class="badge g gz-${GIZRA_POS[k] ?? 'reg'}" href="/liste?g=${k}" title="${esc(GIZROT[k].desc)}">${esc(GIZROT[k].fr)}</a>` : '').join(' ');
  const passV = findVerbByForm(ctx, v.pass), actV = findVerbByForm(ctx, v.act);
  const others = (ctx.byRoot?.get(v.rootKey) ?? []).filter((x) => x !== v);
  const gkey = v.g.join(',');
  const model = ctx.verbs.filter((x) => x !== v && x.b === v.b && x.g.join(',') === gkey && x.fr.length).slice(0, 12);
  const other = OTHER_CELLS.filter((o) => v.forms[o.k]?.length).map((o) => `<div class="kv"><dt>${esc(o.fr)} <span lang="he">${esc(o.he)}</span></dt><dd>${v.forms[o.k].map((x) => formHtml(x)).join(' ')}</dd></div>`).join('');
  return `<article class="verb" data-id="${esc(v.id)}">
  <header class="verb-head vh-${esc(v.b)}">
    <div class="title-row">
      <h1>${formHtml(f, { big: true })}</h1>
      <div class="actions">
        <button type="button" class="icon" data-say="${esc(f.p)}" title="Écouter" aria-label="Écouter">🔊</button>
        <button type="button" class="icon fav" data-fav="${esc(v.id)}" title="Ajouter aux favoris" aria-label="Favori">☆</button>
        <a class="icon" href="/comparer?v=${encodeURIComponent(v.id)}" title="Comparer avec un autre verbe" aria-label="Comparer">⇄</a>
      </div>
    </div>
    <p class="translations">${translations(v, 8)}</p>
    ${v.fr.length && v.en.length ? `<p class="en-gloss"><span>🇬🇧</span> ${v.en.slice(0, 5).map(esc).join(' ; ')}</p>` : ''}
    <dl class="facts">
      <div class="kv"><dt>Racine <span lang="he">שֹׁרֶשׁ</span></dt><dd><a class="root big-root" lang="he" href="${rootUrl(v.rootKey)}">${esc(formatRoot(v.r))}</a></dd></div>
      <div class="kv"><dt>Binyan <span lang="he">בִּנְיָן</span></dt><dd>${binyanBadge(v)} <span lang="he">${esc(BINYANIM[v.b]?.he ?? '')}</span></dd></div>
      <div class="kv"><dt>Type de racine <span lang="he">גִּזְרָה</span></dt><dd>${g}</dd></div>
      <div class="kv"><dt>Forme de base (il, passé)</dt><dd>${formHtml({ p: v.l, u: v.w })}</dd></div>
      ${passV ? `<div class="kv"><dt>Passif</dt><dd>${verbCard(passV)}</dd></div>` : ''}
      ${actV ? `<div class="kv"><dt>Actif</dt><dd>${verbCard(actV)}</dd></div>` : ''}
      ${other}
    </dl>
  </header>
  <p class="legend" aria-hidden="true">Personnes : <span class="pp1">1<sup>re</sup> (je, nous)</span> <span class="pp2">2<sup>e</sup> (tu, vous)</span> <span class="pp3">3<sup>e</sup> (il, elle, ils, elles)</span></p>
  <div class="tables">${TENSES.map((t) => tenseTable(v, t, hl)).join('')}</div>
  ${v.ex?.length ? `<section class="examples-sec"><h2>Exemples</h2><ul>${v.ex.map((e) => `<li><p lang="he" dir="rtl" class="ex-he">${esc(e.he)}</p>${e.fr ? `<p class="ex-fr">${esc(e.fr)}</p>` : ''}<p class="ex-en">${esc(e.en)}</p></li>`).join('')}</ul></section>` : ''}
  <section class="examples-sec" id="tatoeba">${renderTatoeba(v, tatoeba)}</section>
  ${others.length ? `<section><h2>Même racine <span lang="he">${esc(formatRoot(v.r))}</span></h2><div class="cards">${others.map((x) => verbCard(x)).join('')}</div></section>` : ''}
  ${model.length ? `<section><h2>Verbes qui se conjuguent pareil</h2><p class="note">${esc(BINYANIM[v.b]?.fr ?? '')}, ${v.g.map((k) => esc(GIZROT[k]?.fr ?? k)).join(', ')}</p><div class="cards">${model.map((x) => verbCard(x)).join('')}</div></section>` : ''}
  <p class="source">Source : <a href="https://en.wiktionary.org/wiki/${encodeURIComponent(v.w)}#Hebrew" rel="noopener" target="_blank">Wiktionary « ${esc(v.w)} »</a> (CC BY-SA 4.0). Voir aussi <a href="https://www.pealim.com/search/?q=${encodeURIComponent(v.w)}" rel="noopener" target="_blank">Pealim</a>, <a href="https://www.morfix.co.il/${encodeURIComponent(v.w)}" rel="noopener" target="_blank">Morfix</a>.</p>
</article>`;
}

export function renderRoot(rootKey: string, ctx: Ctx): string {
  const vs = ctx.byRoot?.get(rootKey) ?? [];
  const disp = formatRoot(rootKey);
  return `<h1>Racine <span lang="he" dir="rtl">${esc(disp)}</span></h1>
    ${vs.length ? `<p>${vs.length} verbe${vs.length > 1 ? 's' : ''} construit${vs.length > 1 ? 's' : ''} sur cette racine.</p>
    <div class="cards">${vs.sort((a, b) => BINYAN_ORDER.indexOf(a.b) - BINYAN_ORDER.indexOf(b.b)).map((v) => verbCard(v)).join('')}</div>`
      : `<p class="empty">Aucun verbe pour cette racine.</p>`}
    <p><a href="/?q=${encodeURIComponent(rootKey)}&amp;mode=root">Racines proches…</a></p>`;
}

const ALEPHBET = 'אבגדהוזחטיכלמנסעפצקרשת';

export function renderList(ctx: Ctx, params: URLSearchParams): string {
  const b = params.get('b') ?? '', g = params.get('g') ?? '', letter = params.get('l') ?? '', sort = params.get('tri') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const per = 60;
  let vs = ctx.verbs.filter((v) => (!b || v.b === b) && (!g || v.g.includes(g)));
  if (letter) vs = vs.filter((v) => v.rootKey.startsWith(letter));
  if (sort === 'freq') vs = [...vs].sort((x, y) => (y.q ?? 0) - (x.q ?? 0));
  const pages = Math.max(1, Math.ceil(vs.length / per));
  const qs = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(b && { b }), ...(g && { g }), ...(letter && { l: letter }), ...(sort && { tri: sort }) });
    for (const [k, val] of Object.entries(o)) { if (val === '' || val === 1 && k === 'page') p.delete(k); else p.set(k, String(val)); }
    const s = p.toString();
    return `/liste${s ? '?' + s : ''}`;
  };
  const title = [b && BINYANIM[b]?.fr, g && GIZROT[g]?.fr].filter(Boolean).join(' · ') || 'Tous les verbes';
  const desc = b ? BINYANIM[b]?.desc : g ? GIZROT[g]?.desc : '';
  return `<h1>${esc(title)}</h1>${desc ? `<p class="lead">${esc(desc)}</p>` : ''}
  <nav class="chips">${BINYAN_ORDER.map((k) => `<a class="chip${k === b ? ' on' : ''}" href="${qs({ b: k === b ? '' : k, page: 1 })}">${esc(BINYANIM[k].fr)}</a>`).join('')}</nav>
  <nav class="chips">${Object.entries(GIZROT).map(([k, x]) => `<a class="chip${k === g ? ' on' : ''}" href="${qs({ g: k === g ? '' : k, page: 1 })}">${esc(x.fr)}</a>`).join('')}</nav>
  <nav class="chips letters" lang="he" dir="rtl">${[...ALEPHBET].map((l) => `<a class="chip${l === letter ? ' on' : ''}" href="${qs({ l: l === letter ? '' : l, page: 1 })}">${l}</a>`).join('')}</nav>
  <p class="count">${vs.length} verbes · tri : ${sort === 'freq' ? `<a href="${qs({ tri: '', page: 1 })}">alphabétique (racine)</a> · <strong>les plus courants</strong>` : `<strong>alphabétique (racine)</strong> · <a href="${qs({ tri: 'freq', page: 1 })}">les plus courants</a>`}</p>
  <div class="cards">${vs.slice((page - 1) * per, page * per).map((v) => verbCard(v)).join('')}</div>
  ${pages > 1 ? `<nav class="pager">${page > 1 ? `<a href="${qs({ page: page - 1 })}">← Précédent</a>` : ''}<span>Page ${page} / ${pages}</span>${page < pages ? `<a href="${qs({ page: page + 1 })}">Suivant →</a>` : ''}</nav>` : ''}`;
}

export function renderBinyanim(ctx: Ctx): string {
  const count = (pred: (v: Verb) => boolean) => ctx.verbs.filter(pred).length;
  return `<h1>Binyanim et types de racines</h1>
  <p class="lead">Un verbe hébreu = une <strong>racine</strong> (en général 3 consonnes) coulée dans un <strong>binyan</strong> (schème). Les racines « faibles » (gizrot) modifient la conjugaison.</p>
  <h2>Les 7 binyanim</h2>
  <div class="cards wide">${BINYAN_ORDER.map((k) => `<a class="card" href="/liste?b=${k}"><span class="card-he" lang="he" dir="rtl">${esc(BINYANIM[k].he)}</span><strong>${esc(BINYANIM[k].fr)}</strong><span class="card-tr">${esc(BINYANIM[k].desc)}</span><span class="card-extra">${count((v) => v.b === k)} verbes</span></a>`).join('')}</div>
  <h2>Types de racines (gizrot)</h2>
  <div class="cards wide">${Object.entries(GIZROT).map(([k, x]) => `<a class="card" href="/liste?g=${k}"><span class="card-he" lang="he" dir="rtl">${esc(x.he)}</span><strong>${esc(x.fr)}</strong><span class="card-tr">${esc(x.desc)}</span><span class="card-extra">${count((v) => v.g.includes(k))} verbes</span></a>`).join('')}</div>
  <h2>Tableau récapitulatif (racine פ־ע־ל)</h2>
  <div class="scroll"><table class="recap"><thead><tr><th>Binyan</th><th>Passé (il)</th><th>Présent (m. sg.)</th><th>Futur (il)</th><th>Infinitif</th></tr></thead><tbody>
  ${[['pa', 'פָּעַל', 'פּוֹעֵל', 'יִפְעַל', 'לִפְעֹל'], ['nif', 'נִפְעַל', 'נִפְעָל', 'יִפָּעֵל', 'לְהִפָּעֵל'], ['pi', 'פִּעֵל', 'מְפַעֵל', 'יְפַעֵל', 'לְפַעֵל'], ['pu', 'פֻּעַל', 'מְפֻעָל', 'יְפֻעַל', '—'], ['hif', 'הִפְעִיל', 'מַפְעִיל', 'יַפְעִיל', 'לְהַפְעִיל'], ['huf', 'הֻפְעַל', 'מֻפְעָל', 'יֻפְעַל', '—'], ['hit', 'הִתְפַּעֵל', 'מִתְפַּעֵל', 'יִתְפַּעֵל', 'לְהִתְפַּעֵל']]
    .map(([k, ...cols]) => `<tr><th><a href="/liste?b=${k}">${esc(BINYANIM[k].fr)}</a></th>${cols.map((c) => `<td lang="he" dir="rtl">${esc(c)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

export function renderAbout(ctx: Ctx): string {
  const withFr = ctx.verbs.filter((v) => v.fr.length && !v.mt).length;
  const mt = ctx.verbs.filter((v) => v.mt).length;
  return `<h1>À propos</h1>
  <p>Ce site est un hommage à <em>hebreu.mobi</em>, le « GPS pour verbes hébreux » aujourd'hui hors ligne : un Bescherelle hébreu–français gratuit, rapide, utilisable hors connexion.</p>
  <h2>Fonctionnalités</h2>
  <ul>
    <li>Recherche intelligente : français, anglais, hébreu avec ou sans nikoud, n'importe quelle forme conjuguée (même avec préfixe : ו, ה, ש, ב, כ, ל, מ), racine, prononciation latine, fautes de frappe.</li>
    <li>Recherche par lettres : suite de lettres, lettres dans l'ordre, lettres dans le désordre, motifs avec <code>?</code> et <code>*</code>, racine contenue dans un mot.</li>
    <li>Tableaux complets : présent, passé, futur, impératif, infinitif, nom d'action, participe passif ; nikoud, écriture pleine (כתיב מלא), translittération française ou anglaise.</li>
    <li>Prononciation par synthèse vocale (si une voix hébraïque est installée), copie d'un clic.</li>
    <li>Phrases d'exemple réelles avec traduction française, comparateur de verbes, familles de racines, verbes du même modèle, quiz, favoris, mode sombre, clavier hébreu, fonctionne hors-ligne (installable).</li>
  </ul>
  <h2>Données et licences</h2>
  <ul>
    <li>Conjugaisons, racines, binyanim, gloses anglaises et exemples : <a href="https://en.wiktionary.org/">Wiktionary</a> (anglais), via <a href="https://kaikki.org/">kaikki.org / wiktextract</a> — licence <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr">CC BY-SA 4.0</a>.</li>
    <li>Traductions françaises : <a href="https://fr.wiktionary.org/">Wiktionnaire</a> et tables de traduction du Wiktionary anglais — CC BY-SA 4.0 (${withFr} verbes)${mt ? `, complétées par traduction automatique de la glose anglaise (${mt} verbes, marquées « auto »)` : ''}.</li>
    <li>Traduction automatique : modèle Llama 3.3 via Cloudflare Workers AI, à partir des gloses anglaises du Wiktionary.</li>
    <li>Phrases d'exemple hébreu–français : <a href="https://tatoeba.org">Tatoeba</a> — licence <a href="https://creativecommons.org/licenses/by/2.0/fr/">CC BY 2.0 FR</a>, chaque phrase renvoie vers sa page et ses auteurs (<a href="/data/examples.json">examples.json</a>).</li>
    <li>Le fichier de données <a href="/data/verbs.json">verbs.json</a> est donc diffusé sous CC BY-SA 4.0.</li>
    <li>Le code et le design du site : <a href="https://creativecommons.org/licenses/by-nc/4.0/deed.fr">CC BY-NC 4.0</a>. Code source sur <a href="https://github.com/Bben01/bescherelle">GitHub</a>.</li>
  </ul>
  <p class="note">Les translittérations sont générées automatiquement (accent tonique non indiqué) et les traductions peuvent être incomplètes. Corrections bienvenues via GitHub, ou directement sur le Wiktionnaire !</p>`;
}

export function renderCompareShell(): string {
  return `<h1>Comparer des verbes</h1>
  <p class="lead">Ajoutez jusqu'à 4 verbes pour comparer leurs conjugaisons côte à côte.</p>
  <form class="compare-add"><input id="cmp-q" type="search" enterkeyhint="done" placeholder="Ajouter un verbe (français, hébreu…)" autocomplete="off" dir="auto"><div id="cmp-sugg" class="sugg"></div></form>
  <div id="cmp"></div>`;
}

export function renderCompare(vs: Verb[]): string {
  if (!vs.length) return '<p class="empty">Aucun verbe sélectionné.</p>';
  const head = `<tr><th></th>${vs.map((v) => `<th><a href="${verbUrl(v)}">${formHtml(headForm(v), { button: false })}</a><br><small>${esc(BINYANIM[v.b]?.fr ?? '')} · ${esc(v.fr[0] ?? v.en[0] ?? '')}</small><br><button type="button" class="link" data-remove="${esc(v.id)}">retirer</button></th>`).join('')}</tr>`;
  let rows = '';
  for (const t of TENSES) {
    rows += `<tr class="sep t-${t.id}"><th colspan="${vs.length + 1}">${esc(t.fr)} <span lang="he">${esc(t.he)}</span></th></tr>`;
    for (const c of t.cells) {
      rows += `<tr><th><span class="pron" lang="he">${pronHtml(c.pron)}</span> <span class="pfr">${esc(c.fr)}</span></th>${vs.map((v) => `<td>${(v.forms[c.k] ?? []).map((f) => formHtml(f)).join(' ') || '—'}</td>`).join('')}</tr>`;
    }
  }
  for (const o of OTHER_CELLS) rows += `<tr><th>${esc(o.fr)}</th>${vs.map((v) => `<td>${(v.forms[o.k] ?? []).map((f) => formHtml(f)).join(' ') || '—'}</td>`).join('')}</tr>`;
  return `<div class="scroll"><table class="compare">${head}${rows}</table></div>`;
}

export function pageTitle(v: Verb): string {
  const f = headForm(v);
  return `${f.u} – conjugaison ${v.fr[0] ? `« ${v.fr[0]} »` : ''} | Bescherelle hébreu`;
}

export function pageDescription(v: Verb): string {
  const f = headForm(v);
  return `Conjugaison du verbe hébreu ${f.p} (${translit(f.p, 'fr')})${v.fr.length ? ` : ${v.fr.slice(0, 3).join(', ')}` : ''}. Racine ${formatRoot(v.r)}, binyan ${BINYANIM[v.b]?.fr ?? ''}. Présent, passé, futur, impératif avec nikoud.`;
}
