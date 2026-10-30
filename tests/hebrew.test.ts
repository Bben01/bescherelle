import { describe, expect, it } from 'vitest';
import { formatRoot, hkey, isHebrew, latinSkeleton, stripNiqqud, translit } from '../src/hebrew.ts';

describe('hebrew utils', () => {
  it('strips niqqud and normalises keys', () => {
    expect(stripNiqqud('שָׁמַר')).toBe('שמר');
    expect(hkey('לִשְׁמֹר')).toBe(hkey('לשמר'));
    expect(isHebrew('abc')).toBe(false);
    expect(isHebrew('abc ש')).toBe(true);
  });

  it('formats roots with separators', () => {
    expect(formatRoot('שמר')).toMatch(/ש.+מ.+ר/);
  });

  it.each([
    ['שָׁמַר', 'chamar', 'shamar'],
    ['לִשְׁמֹר', 'lichmor', 'lishmor'],
    ['שׁוֹמֶרֶת', 'chomeret', 'shomeret'],
    ['יִשְׁמְרוּ', 'yichmerou', 'yishmeru'],
    ['הִתְכּוֹנֵן', 'hitkonen', 'hitkonen'],
    ['לְדַבֵּר', 'ledaber', 'ledaber'],
  ])('transliterates %s', (w, fr, en) => {
    expect(translit(w, 'fr')).toBe(fr);
    expect(translit(w, 'en')).toBe(en);
    expect(latinSkeleton(fr)).toBe(latinSkeleton(en));
  });
});
