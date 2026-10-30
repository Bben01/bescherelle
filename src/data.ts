import { hkey, stripNiqqud } from './hebrew.ts';

export interface RawVerb {
  id: string;
  w: string; // unpointed lemma (3ms past)
  l: string; // pointed lemma
  b: string; // binyan code
  bs?: string; // sub-pattern (po'el…)
  r: string; // root letters
  g: string[]; // gizra tags
  t: string; // romanisation from Wiktionary
  en: string[];
  fr: string[];
  mt?: number; // French is machine-translated
  q?: number; // usage frequency (occurrences in Tatoeba Hebrew sentences)
  c: string[]; // cells, in DataFile.cells order
  pass?: string;
  act?: string;
  ex?: { he: string; en: string; tr?: string; fr?: string }[];
}

export interface DataFile { v: number; cells: string[]; verbs: RawVerb[] }

export interface Form { p: string; u: string } // pointed, unpointed (ktiv male)

export interface Verb extends RawVerb {
  idx: number;
  forms: Record<string, Form[]>;
  rootKey: string;
  inf: Form | null;
}

export const TENSES: { id: string; fr: string; he: string; cells: { k: string; pron: string; fr: string }[] }[] = [
  {
    id: 'pr', fr: 'Présent', he: 'הוֹוֶה', cells: [
      { k: 'pr.ms', pron: 'אֲנִי, אַתָּה, הוּא', fr: 'masc. sing.' },
      { k: 'pr.fs', pron: 'אֲנִי, אַתְּ, הִיא', fr: 'fém. sing.' },
      { k: 'pr.mp', pron: 'אֲנַחְנוּ, אַתֶּם, הֵם', fr: 'masc. plur.' },
      { k: 'pr.fp', pron: 'אֲנַחְנוּ, אַתֶּן, הֵן', fr: 'fém. plur.' },
    ],
  },
  {
    id: 'p', fr: 'Passé', he: 'עָבָר', cells: [
      { k: 'p.1s', pron: 'אֲנִי', fr: 'je' },
      { k: 'p.2ms', pron: 'אַתָּה', fr: 'tu (m.)' },
      { k: 'p.2fs', pron: 'אַתְּ', fr: 'tu (f.)' },
      { k: 'p.3ms', pron: 'הוּא', fr: 'il' },
      { k: 'p.3fs', pron: 'הִיא', fr: 'elle' },
      { k: 'p.1p', pron: 'אֲנַחְנוּ', fr: 'nous' },
      { k: 'p.2mp', pron: 'אַתֶּם', fr: 'vous (m.)' },
      { k: 'p.2fp', pron: 'אַתֶּן', fr: 'vous (f.)' },
      { k: 'p.3p', pron: 'הֵם, הֵן', fr: 'ils, elles' },
    ],
  },
  {
    id: 'fut', fr: 'Futur', he: 'עָתִיד', cells: [
      { k: 'fut.1s', pron: 'אֲנִי', fr: 'je' },
      { k: 'fut.2ms', pron: 'אַתָּה', fr: 'tu (m.)' },
      { k: 'fut.2fs', pron: 'אַתְּ', fr: 'tu (f.)' },
      { k: 'fut.3ms', pron: 'הוּא', fr: 'il' },
      { k: 'fut.3fs', pron: 'הִיא', fr: 'elle' },
      { k: 'fut.1p', pron: 'אֲנַחְנוּ', fr: 'nous' },
      { k: 'fut.2mp', pron: 'אַתֶּם', fr: 'vous (m.)' },
      { k: 'fut.2fp', pron: 'אַתֶּן', fr: 'vous (f.)' },
      { k: 'fut.3mp', pron: 'הֵם', fr: 'ils' },
      { k: 'fut.3fp', pron: 'הֵן', fr: 'elles' },
    ],
  },
  {
    id: 'imp', fr: 'Impératif', he: 'צִוּוּי', cells: [
      { k: 'imp.ms', pron: 'אַתָּה', fr: 'tu (m.)' },
      { k: 'imp.fs', pron: 'אַתְּ', fr: 'tu (f.)' },
      { k: 'imp.mp', pron: 'אַתֶּם', fr: 'vous (m.)' },
      { k: 'imp.fp', pron: 'אַתֶּן', fr: 'vous (f.)' },
    ],
  },
];

export const OTHER_CELLS = [
  { k: 'inf', fr: 'Infinitif', he: 'שֵׁם הַפֹּעַל' },
  { k: 'n', fr: "Nom d'action", he: 'שֵׁם פְּעֻלָּה' },
  { k: 'pp', fr: 'Participe passif', he: 'בֵּינוֹנִי פָּעוּל' },
];

export const CELL_LABEL: Record<string, string> = {};
for (const t of TENSES) for (const c of t.cells) CELL_LABEL[c.k] = `${t.fr} – ${c.fr}`;
for (const o of OTHER_CELLS) CELL_LABEL[o.k] = o.fr;

export function decodeCell(s: string): Form[] {
  if (!s) return [];
  return s.split(',').map((x) => {
    const [p, u] = x.split('|');
    return { p, u: u ?? stripNiqqud(p) };
  });
}

export function hydrate(data: DataFile): Verb[] {
  return data.verbs.map((rv, idx) => {
    const forms: Record<string, Form[]> = {};
    data.cells.forEach((k, i) => { forms[k] = decodeCell(rv.c[i] ?? ''); });
    return { ...rv, idx, forms, rootKey: hkey(rv.r), inf: forms.inf?.[0] ?? null };
  });
}

declare const __DATA_V__: string;
const DATA_V = typeof __DATA_V__ === 'string' ? __DATA_V__ : 'dev';

let cache: Promise<Verb[]> | null = null;

export function loadVerbs(): Promise<Verb[]> {
  cache ??= fetch(`/data/verbs.json?v=${DATA_V}`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<DataFile>; })
    .then(hydrate);
  return cache;
}

/** Tatoeba sentence pair: [sentence id, Hebrew, French, matched cell]. */
export type TatoebaEx = [number, string, string, string];
let exCache: Promise<Record<string, TatoebaEx[]>> | null = null;

export function loadExamples(): Promise<Record<string, TatoebaEx[]>> {
  exCache ??= fetch(`/data/examples.json?v=${DATA_V}`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => { exCache = null; return {}; });
  return exCache;
}

/** Main display form: infinitive if any, else the lemma. */
export const headForm = (v: Verb): Form => v.inf ?? { p: v.l, u: v.w };
