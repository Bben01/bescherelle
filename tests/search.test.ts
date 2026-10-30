import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hydrate, type Verb } from '../src/data.ts';
import { SearchIndex, isSubsequence, containsAllLetters, levenshtein } from '../src/search.ts';

let idx: SearchIndex;
let verbs: Verb[];
const top = (q: string, mode?: Parameters<SearchIndex['search']>[1]) => idx.search(q, { limit: 10, ...mode }).map((h) => h.verb.w);

beforeAll(() => {
  verbs = hydrate(JSON.parse(readFileSync(new URL('../public/data/verbs.json', import.meta.url), 'utf8')));
  idx = new SearchIndex(verbs);
});

describe('helpers', () => {
  it('subsequence / letters / levenshtein', () => {
    expect(isSubsequence('שר', 'שמר')).toBe(true);
    expect(isSubsequence('רש', 'שמר')).toBe(false);
    expect(containsAllLetters('רש', 'שמר')).toBe(true);
    expect(levenshtein('chamar', 'shamar', 3)).toBe(1);
  });
});

describe('search', () => {
  it('has data with conjugations', () => {
    expect(verbs.length).toBeGreaterThan(2000);
    const v = verbs.find((x) => x.w === 'שמר' && x.b === 'pa')!;
    expect(v.forms['p.1s'][0].u).toBe('שמרתי');
  });
  it('finds the infinitive, conjugated and prefixed forms', () => {
    expect(top('שמר')[0]).toBe('שמר');
    expect(top('אשמור')[0]).toBe('שמר');
    expect(top('ושמרתי')).toContain('שמר');
    expect(top('לשמור')).toContain('שמר');
  });
  it('searches French, English and transliteration', () => {
    expect(top('garder')).toContain('שמר');
    expect(top('guard')).toContain('שמר');
    expect(top('lishmor')[0]).toBe('שמר');
    expect(top('chamar')[0]).toBe('שמר');
    expect(top('ecrire')[0]).toBe('כתב');
  });
  it('supports letter modes and patterns', () => {
    expect(top('ש?ר')).toContain('שמר');
    expect(top('מרש', { mode: 'anyorder' })).toContain('שמר');
    expect(idx.search('שמר', { mode: 'contains', limit: 50 }).every((h) => h.verb.forms)).toBe(true);
    expect(top('שמר', { mode: 'root' })).toEqual(expect.arrayContaining(['שמר', 'נשמר']));
  });
  it('filters by binyan', () => {
    expect(idx.search('שמר', { binyan: 'nif' }).every((h) => h.verb.b === 'nif')).toBe(true);
  });
});
