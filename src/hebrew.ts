// Hebrew text utilities: niqqud handling, normalisation, transliteration, keyboard.

const NIQQUD_RE = /[\u0591-\u05C7]/g;
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const TO_FINAL: Record<string, string> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

export const isHebrew = (s: string) => /[\u05D0-\u05EA]/.test(s);
export const stripNiqqud = (s: string) => s.replace(NIQQUD_RE, '');

/** Search key: bare consonants, final letters normalised, everything else dropped. */
export function hkey(s: string): string {
  let out = '';
  for (const ch of stripNiqqud(s)) {
    if (ch >= '\u05D0' && ch <= '\u05EA') out += FINALS[ch] ?? ch;
  }
  return out;
}

/** Display a bare root as ש־מ־ר (with final forms normalised to regular letters). */
export function formatRoot(root: string): string {
  return [...stripNiqqud(root)].filter((c) => isHebrew(c)).map((c) => FINALS[c] ?? c).join('־');
}

/** Turn a key back into displayable text (final letter at the end). */
export function keyToDisplay(k: string): string {
  if (!k) return k;
  const last = k[k.length - 1];
  return k.slice(0, -1) + (TO_FINAL[last] ?? last);
}

export const BINYANIM: Record<string, { fr: string; he: string; desc: string }> = {
  pa: { fr: "Pa'al", he: 'פָּעַל', desc: 'Binyan de base (kal) : action simple, active. Ex. כָּתַב « écrire ».' },
  nif: { fr: "Nif'al", he: 'נִפְעַל', desc: 'Passif ou réfléchi du pa\'al. Ex. נִכְתַּב « être écrit ».' },
  pi: { fr: "Pi'el", he: 'פִּעֵל', desc: 'Action intensive ou causative ; très productif pour les verbes modernes. Ex. דִּבֵּר « parler ».' },
  pu: { fr: "Pu'al", he: 'פֻּעַל', desc: 'Passif du pi\'el (pas d\'impératif ni d\'infinitif usuels). Ex. סֻפַּר « être raconté ».' },
  hif: { fr: "Hif'il", he: 'הִפְעִיל', desc: 'Causatif : faire faire l\'action. Ex. הִכְתִּיב « dicter ».' },
  huf: { fr: "Huf'al", he: 'הֻפְעַל', desc: 'Passif du hif\'il. Ex. הֻכְתַּב « être dicté ».' },
  hit: { fr: "Hitpa'el", he: 'הִתְפַּעֵל', desc: 'Réfléchi ou réciproque. Ex. הִתְכַּתֵּב « correspondre ».' },
};
export const BINYAN_ORDER = ['pa', 'nif', 'pi', 'pu', 'hif', 'huf', 'hit'];
export const BINYAN_SUB: Record<string, string> = {
  po: "Po'el", poal: "Po'al", hitpo: "Hitpo'el", hitpu: "Hitpu'al", nitpa: "Nitpa'el",
};

export const GIZROT: Record<string, { fr: string; he: string; desc: string }> = {
  shlemim: { fr: 'Régulier', he: 'שְׁלֵמִים', desc: 'Racine sans lettre faible ni gutturale.' },
  pg: { fr: '1re gutturale', he: 'פ׳ גְּרוֹנִית', desc: 'Première radicale ה, ח ou ע : voyelles modifiées (chatafim).' },
  ag: { fr: '2e gutturale', he: 'ע׳ גְּרוֹנִית', desc: 'Deuxième radicale gutturale : pas de dagesh, voyelles allongées.' },
  lg: { fr: '3e gutturale (ח/ע)', he: 'ל׳ גְּרוֹנִית', desc: 'Dernière radicale ח ou ע : patah furtif, voyelle « a ».' },
  pn: { fr: 'Pe-noun (פ״נ)', he: 'פ״נ', desc: 'Première radicale נ, souvent assimilée (יִפֹּל).' },
  py: { fr: 'Pe-yod (פ״י)', he: 'פ״י', desc: 'Première radicale י, qui tombe ou devient ו (יָשַׁב → יֵשֵׁב, הוֹשִׁיב).' },
  pa: { fr: 'Pe-alef (פ״א)', he: 'פ״א', desc: 'Première radicale א (אָכַל → יֹאכַל).' },
  aw: { fr: 'Creux (ע״ו/ע״י)', he: 'ע״ו / ע״י', desc: 'Deuxième radicale ו ou י, verbes « creux » (קָם, שָׂם).' },
  aa: { fr: 'Géminé (ע״ע)', he: 'ע״ע', desc: 'Deuxième et troisième radicales identiques (סָבַב).' },
  lh: { fr: 'Lamed-hé (ל״ה)', he: 'ל״ה / ל״י', desc: 'Dernière radicale ה/י (קָנָה → קָנִיתִי).' },
  la: { fr: 'Lamed-alef (ל״א)', he: 'ל״א', desc: 'Dernière radicale א, souvent muette (קָרָא).' },
  merubaim: { fr: 'Quadrilitère', he: 'מְרֻבָּעִים', desc: 'Racine de quatre lettres (תִּרְגֵּם).' },
};

// ---------- Transliteration ----------

const DAGESH = '\u05BC', SHIN_DOT = '\u05C1', SIN_DOT = '\u05C2', SHEVA = '\u05B0';
const VOWELS: Record<string, string> = {
  '\u05B1': 'e', '\u05B2': 'a', '\u05B3': 'o', '\u05B4': 'i', '\u05B5': 'e', '\u05B6': 'e',
  '\u05B7': 'a', '\u05B8': 'a', '\u05B9': 'o', '\u05BA': 'o', '\u05BB': 'u', '\u05C7': 'o',
};
const GUTTURALS = 'אהחע';

interface Cluster { l: string; marks: string; geresh: boolean }

function clusters(word: string): Cluster[] {
  const out: Cluster[] = [];
  for (const ch of word) {
    if (ch >= '\u05D0' && ch <= '\u05EA') out.push({ l: ch, marks: '', geresh: false });
    else if (out.length && /[\u0591-\u05C7]/.test(ch)) out[out.length - 1].marks += ch;
    else if (out.length && (ch === '׳' || ch === "'")) out[out.length - 1].geresh = true;
  }
  return out;
}

const vowelOf = (c: Cluster) => {
  for (const m of c.marks) if (VOWELS[m]) return VOWELS[m];
  return '';
};
const hasSheva = (c?: Cluster) => !!c && c.marks.includes(SHEVA);
const hasDagesh = (c: Cluster) => c.marks.includes(DAGESH);
const isShuruk = (c: Cluster, prev?: Cluster) =>
  c.l === 'ו' && hasDagesh(c) && !vowelOf(c) && !hasSheva(c) && (!prev || !vowelOf(prev) || hasSheva(prev));
const isHolamMale = (c: Cluster) => c.l === 'ו' && (c.marks.includes('\u05B9') || c.marks.includes('\u05BA')) && !c.marks.includes(DAGESH);

/** Tokens [consonant, vowel] in a neutral (English-like) scheme. */
function translitTokens(word: string): Array<[string, string]> {
  const cs = clusters(word);
  const toks: Array<[string, string]> = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], prev = cs[i - 1], next = cs[i + 1];
    const last = i === cs.length - 1;
    const d = hasDagesh(c);
    let v = vowelOf(c);
    // Vowel letters
    if (c.l === 'ו' && isShuruk(c, prev)) { toks.push(['', 'u']); continue; }
    if (isHolamMale(c) && prev && !vowelOf(prev) && !hasSheva(prev)) { toks.push(['', 'o']); continue; }
    if (isHolamMale(c) && prev && vowelOf(prev) === 'o') { continue; }
    if (c.l === 'י' && !v && !hasSheva(c) && !d && prev) {
      const pv = toks.length ? toks[toks.length - 1][1] : '';
      if (pv === 'i' || pv === 'e') continue;
      if (pv === 'a' || pv === 'o' || pv === 'u') { toks.push(['y', '']); continue; }
    }
    if (c.l === 'ה' && last && !d && !v) continue;
    if (c.l === 'א' && !v) continue;

    let cons: string;
    switch (c.l) {
      case 'א': case 'ע': cons = toks.length && toks[toks.length - 1][1] ? "'" : ''; break;
      case 'ב': cons = d ? 'b' : 'v'; break;
      case 'ג': cons = c.geresh ? 'j' : 'g'; break;
      case 'ד': cons = 'd'; break;
      case 'ה': cons = 'h'; break;
      case 'ו': cons = 'v'; if (isHolamMale(c)) { cons = 'v'; v = 'o'; } break;
      case 'ז': cons = c.geresh ? 'zh' : 'z'; break;
      case 'ח': cons = 'kh'; break;
      case 'ט': cons = 't'; break;
      case 'י': cons = 'y'; break;
      case 'כ': case 'ך': cons = d ? 'k' : 'kh'; break;
      case 'ל': cons = 'l'; break;
      case 'מ': case 'ם': cons = 'm'; break;
      case 'נ': case 'ן': cons = 'n'; break;
      case 'ס': cons = 's'; break;
      case 'פ': case 'ף': cons = d ? 'p' : 'f'; break;
      case 'צ': case 'ץ': cons = c.geresh ? 'tsh' : 'ts'; break;
      case 'ק': cons = 'k'; break;
      case 'ר': cons = 'r'; break;
      case 'ש': cons = c.marks.includes(SIN_DOT) ? 's' : 'sh'; break;
      case 'ת': cons = 't'; break;
      default: cons = '';
    }
    if (c.marks.includes(SHIN_DOT) && c.l === 'ש') cons = 'sh';
    if (!v && hasSheva(c) && !last) {
      const first = i === 0;
      const vocal = first
        ? ('ילמנר'.includes(c.l) || (next && (GUTTURALS.includes(next.l) || next.l === c.l)))
        : (hasSheva(prev) && i > 1 && !(i === cs.length - 1)) || (next && next.l === c.l);
      if (vocal) v = 'e';
    }
    // Furtive patah under final ח / ע / הּ: pronounced before the consonant.
    if (last && (c.l === 'ח' || c.l === 'ע' || (c.l === 'ה' && d)) && c.marks.includes('\u05B7')) {
      const pv = toks.length ? toks[toks.length - 1][1] : '';
      if (pv && pv !== 'a') { toks.push(['', 'a']); toks.push([cons === "'" ? '' : cons, '']); continue; }
    }
    toks.push([cons, v]);
  }
  return toks;
}

export type TranslitStyle = 'fr' | 'en';

const FR_CONS: Record<string, string> = { sh: 'ch', kh: 'kh', j: 'dj', zh: 'j', tsh: 'tch', y: 'y' };

export function translit(text: string, style: TranslitStyle = 'fr'): string {
  return text.split(/([\s\u05BE\-/,]+)/).map((part) => {
    if (!isHebrew(part)) return part.replace('\u05BE', '-');
    return translitTokens(part).map(([c, v]) => {
      if (style === 'fr') {
        c = FR_CONS[c] ?? c;
        if (v === 'u') v = 'ou';
      }
      return c + v;
    }).join('');
  }).join('').replace(/^'/, '');
}

/** Normalise a Latin query or transliteration to a loose phonetic skeleton for matching. */
export function latinSkeleton(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/tch|tsh/g, 'Č').replace(/dj/g, 'j')
    .replace(/sch|sh|ch|ş|š/g, 'S').replace(/kh|ḥ|x/g, 'X').replace(/ou/g, 'u')
    .replace(/tz|ts|ç/g, 'Z').replace(/ph/g, 'f').replace(/w/g, 'v').replace(/q|c/g, 'k')
    .replace(/['’`ʼ\-\s]/g, '').replace(/y/g, 'i').replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

// ---------- Keyboard (Israeli standard layout, by physical key code) ----------

export const KEYBOARD_ROWS: string[][] = [
  ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'],
  ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
  ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'],
];

export const CODE_TO_HEBREW: Record<string, string> = {
  KeyE: 'ק', KeyR: 'ר', KeyT: 'א', KeyY: 'ט', KeyU: 'ו', KeyI: 'ן', KeyO: 'ם', KeyP: 'פ',
  KeyA: 'ש', KeyS: 'ד', KeyD: 'ג', KeyF: 'כ', KeyG: 'ע', KeyH: 'י', KeyJ: 'ח', KeyK: 'ל', KeyL: 'ך', Semicolon: 'ף',
  KeyZ: 'ז', KeyX: 'ס', KeyC: 'ב', KeyV: 'ה', KeyB: 'נ', KeyN: 'מ', KeyM: 'צ', Comma: 'ת', Period: 'ץ',
};
