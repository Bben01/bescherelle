import { hkey, isHebrew, latinSkeleton, translit } from './hebrew.ts';
import { CELL_LABEL, type Verb } from './data.ts';

export type SearchMode = 'auto' | 'root' | 'contains' | 'subseq' | 'anyorder' | 'pattern' | 'fr' | 'translit';

export interface SearchOptions { mode?: SearchMode; binyan?: string; gizra?: string; limit?: number }

export interface Hit { verb: Verb; score: number; section: string; detail?: string; cells?: string[] }

export const SECTIONS: Record<string, string> = {
  exact: 'Correspondance exacte',
  form: 'Forme conjuguée',
  prefixed: 'Forme avec préfixe (ו, ה, ש, ב, כ, ל, מ)',
  root: 'Racine',
  start: 'Commence par',
  contains: 'Contient la suite de lettres',
  subseq: 'Contient les lettres dans cet ordre',
  anyorder: 'Contient toutes ces lettres (ordre libre)',
  pattern: 'Correspond au motif',
  rootin: 'Racine possible du mot (lettres de la racine présentes dans le mot)',
  fr: 'Traduction française',
  en: 'Traduction anglaise',
  translit: 'Prononciation (translittération)',
  fuzzy: 'Orthographe approchante',
};

const PREFIXES = ['וכש', 'וש', 'וכ', 'וב', 'ול', 'ומ', 'וה', 'כש', 'שה', 'ו', 'ה', 'ש', 'ב', 'כ', 'ל', 'מ'];

export function normLatin(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ').trim();
}
const stripFrReflexive = (s: string) => s.replace(/^(se |s')/, '');
const stripTo = (s: string) => s.replace(/^to /, '');

export function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export function containsAllLetters(needle: string, hay: string): boolean {
  const counts = new Map<string, number>();
  for (const ch of hay) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const ch of needle) {
    const n = counts.get(ch) ?? 0;
    if (!n) return false;
    counts.set(ch, n - 1);
  }
  return true;
}

/** Pattern with ? (one letter) and * (any letters), matched against whole keys. */
export function patternToRegex(p: string): RegExp {
  const body = [...p].map((ch) => (ch === '?' || ch === '.' ? '.' : ch === '*' ? '.*' : hkey(ch))).join('');
  return new RegExp(`^${body}$`);
}

export function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface Entry {
  verb: Verb;
  headKeys: Set<string>; // lemma + infinitive (with and without ל)
  formKeys: Map<string, string[]>; // key -> cells
  letters: string; // root + lemma letters for letter searches
  seqKeys: string[]; // strings checked for substring / subsequence
  fr: string[];
  en: string[];
  lat?: Map<string, string[]>; // latin skeleton -> cells (lazy)
}

export class SearchIndex {
  entries: Entry[];
  verbs: Verb[];

  constructor(verbs: Verb[]) {
    this.verbs = verbs;
    this.entries = verbs.map((verb) => {
      const headKeys = new Set<string>([hkey(verb.w), hkey(verb.l)]);
      const formKeys = new Map<string, string[]>();
      for (const [cell, forms] of Object.entries(verb.forms)) {
        for (const f of forms) {
          for (const k of new Set([hkey(f.p), hkey(f.u)])) {
            if (!k) continue;
            if (!formKeys.has(k)) formKeys.set(k, []);
            if (!formKeys.get(k)!.includes(cell)) formKeys.get(k)!.push(cell);
            if (cell === 'inf') { headKeys.add(k); if (k.startsWith('ל')) headKeys.add(k.slice(1)); }
          }
        }
      }
      const lemmaKey = hkey(verb.w);
      return {
        verb, headKeys, formKeys,
        letters: verb.rootKey + lemmaKey,
        seqKeys: [verb.rootKey, lemmaKey, ...[...headKeys]],
        fr: verb.fr.map(normLatin),
        en: verb.en.map((e) => stripTo(normLatin(e))),
      };
    });
  }

  private latinForms(e: Entry): Map<string, string[]> {
    if (e.lat) return e.lat;
    const m = new Map<string, string[]>();
    const add = (s: string, cell: string) => {
      const k = latinSkeleton(s);
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      if (!m.get(k)!.includes(cell)) m.get(k)!.push(cell);
    };
    if (e.verb.t) add(e.verb.t, 'p.3ms');
    for (const [cell, forms] of Object.entries(e.verb.forms)) {
      for (const f of forms) { add(translit(f.p, 'fr'), cell); add(translit(f.p, 'en'), cell); }
    }
    e.lat = m;
    return m;
  }

  search(query: string, opts: SearchOptions = {}): Hit[] {
    const q = query.trim();
    if (!q) return [];
    let mode = opts.mode ?? 'auto';
    if (mode === 'auto' && /[?*]/.test(q) && isHebrew(q)) mode = 'pattern';
    const hits: Hit[] = [];
    for (const e of this.entries) {
      const v = e.verb;
      if (opts.binyan && v.b !== opts.binyan) continue;
      if (opts.gizra && !v.g.includes(opts.gizra)) continue;
      const h = isHebrew(q) || mode === 'pattern' ? this.matchHebrew(e, q, mode) : this.matchLatin(e, q, mode);
      if (h) {
        // Preference for frequent verbs (Tatoeba usage count), translated ones, and short lemmas.
        h.score += Math.log2(1 + (v.q ?? 0)) * 4 + (v.fr.length ? 6 : 0) + Math.min(v.en.length, 5) - v.w.length * 0.5;
        hits.push(h);
      }
    }
    hits.sort((a, b) => b.score - a.score || a.verb.w.localeCompare(b.verb.w, 'he'));
    const strong = hits.filter((h) => h.section !== 'fuzzy');
    const out = strong.length >= 3 ? strong : hits;
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Precompute transliteration keys in small idle chunks so the first Latin search is instant. */
  warmup(): void {
    let i = 0;
    const step = () => {
      const end = Math.min(i + 150, this.entries.length);
      for (; i < end; i++) this.latinForms(this.entries[i]);
      if (i < this.entries.length) schedule(step);
    };
    schedule(step);
  }

  private matchHebrew(e: Entry, q: string, mode: SearchMode): Hit | null {
    const verb = e.verb;
    if (mode === 'pattern') {
      const re = patternToRegex(q);
      if (re.test(verb.rootKey)) return { verb, score: 800, section: 'pattern', detail: 'racine' };
      for (const k of e.headKeys) if (re.test(k)) return { verb, score: 700, section: 'pattern' };
      for (const [k, cells] of e.formKeys) if (re.test(k)) return { verb, score: 600, section: 'pattern', cells };
      return null;
    }
    const k = hkey(q);
    if (!k) return null;
    if (mode === 'root') {
      if (verb.rootKey === k) return { verb, score: 1000, section: 'root' };
      if (verb.rootKey.includes(k)) return { verb, score: 600, section: 'contains', detail: 'dans la racine' };
      if (isSubsequence(k, verb.rootKey)) return { verb, score: 500, section: 'subseq', detail: 'dans la racine' };
      if (containsAllLetters(k, verb.rootKey)) return { verb, score: 400, section: 'anyorder', detail: 'dans la racine' };
      return null;
    }
    if (mode === 'contains') {
      for (const s of e.seqKeys) if (s.includes(k)) return { verb, score: 600 - s.length, section: 'contains' };
      for (const [fk, cells] of e.formKeys) if (fk.includes(k)) return { verb, score: 400, section: 'contains', cells };
      return null;
    }
    if (mode === 'subseq') {
      for (const s of e.seqKeys) if (isSubsequence(k, s)) return { verb, score: 500 - s.length, section: 'subseq' };
      return null;
    }
    if (mode === 'anyorder') {
      return containsAllLetters(k, e.letters) || [...e.headKeys].some((s) => containsAllLetters(k, s))
        ? { verb, score: 400, section: 'anyorder' } : null;
    }
    // auto
    if (e.headKeys.has(k)) return { verb, score: 1000, section: 'exact' };
    const cells = e.formKeys.get(k);
    if (cells) return { verb, score: 900, section: 'form', cells };
    if (verb.rootKey === k) return { verb, score: 850, section: 'root' };
    for (const p of PREFIXES) {
      if (k.length - p.length >= 2 && k.startsWith(p)) {
        const rest = k.slice(p.length);
        const c2 = e.formKeys.get(rest);
        if (c2) return { verb, score: 750 - p.length, section: 'prefixed', cells: c2, detail: `${p}+` };
      }
    }
    if (k.length >= 2) {
      for (const s of e.seqKeys) if (s.startsWith(k)) return { verb, score: 600, section: 'start' };
      for (const s of e.seqKeys) if (s.includes(k)) return { verb, score: 500, section: 'contains' };
      for (const [fk, c3] of e.formKeys) if (fk.includes(k)) return { verb, score: 450, section: 'contains', cells: c3 };
    }
    if (k.length >= 2) {
      if (isSubsequence(k, verb.rootKey) || e.seqKeys.some((s) => isSubsequence(k, s))) return { verb, score: 300, section: 'subseq' };
      if (containsAllLetters(k, e.letters)) return { verb, score: 200, section: 'anyorder' };
    }
    if (k.length >= 3 && verb.rootKey.length >= 3 && isSubsequence(verb.rootKey, k)) {
      return { verb, score: 150 + verb.rootKey.length * 10, section: 'rootin' };
    }
    return null;
  }

  private matchLatin(e: Entry, q: string, mode: SearchMode): Hit | null {
    const verb = e.verb;
    const nq = normLatin(q);
    const nqFr = stripFrReflexive(nq);
    const nqEn = stripTo(nq);
    let best: Hit | null = null;
    const take = (h: Hit) => { if (!best || h.score > best.score) best = h; };

    if (mode === 'auto' || mode === 'fr') {
      e.fr.forEach((f, i) => {
        const fs = stripFrReflexive(f);
        // Earlier translations are the main sense; machine translations are less trusted.
        const rank = -Math.min(i, 5) * 8 - (verb.mt ? 10 : 0);
        if (f === nq || fs === nqFr) take({ verb, score: 1000 + rank, section: 'fr', detail: f });
        else if (fs.startsWith(nqFr)) take({ verb, score: 700 - (fs.length - nqFr.length) + rank, section: 'fr', detail: f });
        else if (nq.length >= 3 && new RegExp(`\\b${escapeRe(nq)}`).test(f)) take({ verb, score: 600 + rank, section: 'fr', detail: f });
      });
      if (mode === 'auto') {
        for (const en of e.en) {
          if (en === nqEn || en.split(/[,;] ?/).includes(nqEn)) take({ verb, score: 650, section: 'en', detail: en });
          else if (nqEn.length >= 3 && new RegExp(`\\b${escapeRe(nqEn)}\\b`).test(en)) take({ verb, score: 420, section: 'en', detail: en });
        }
      }
    }
    if (mode === 'auto' || mode === 'translit') {
      const sk = latinSkeleton(q);
      if (sk.length >= 2) {
        for (const [k, cells] of this.latinForms(e)) {
          if (k === sk) take({ verb, score: cells.includes('inf') || cells.includes('p.3ms') ? 950 : 880, section: 'translit', cells });
          else if (sk.length >= 3 && k.startsWith(sk)) take({ verb, score: 480, section: 'translit', cells });
        }
      }
    }
    if (!best && nq.length >= 4) {
      const max = nq.length >= 8 ? 2 : 1;
      for (const f of e.fr) {
        for (const word of [stripFrReflexive(f), ...f.split(/[ ,'()]+/)]) {
          if (word.length >= 3 && levenshtein(nqFr, word, max) <= max) { take({ verb, score: 250, section: 'fuzzy', detail: f }); break; }
        }
      }
      if (!best && (mode === 'auto' || mode === 'translit')) {
        const sk = latinSkeleton(q);
        for (const [k, cells] of this.latinForms(e)) {
          if (levenshtein(sk, k, 1) <= 1) { take({ verb, score: 230, section: 'fuzzy', cells }); break; }
        }
      }
    }
    return best;
  }
}

const schedule = (fn: () => void) =>
  (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback?.(fn) ?? setTimeout(fn, 0);

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export const describeCells = (cells?: string[]) => (cells ?? []).map((c) => CELL_LABEL[c] ?? c).join(' · ');
