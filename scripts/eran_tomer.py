"""Hebrew verb inflections from Eran Tomer's MSc thesis (Ben-Gurion University, CC BY 4.0).

https://github.com/NNLP-IL/Hebrew-Resources/tree/master/linguistic_resources/word_lists/hebrew_verbs_eran_tomer
~4 200 verbs (lemma + binyan), fully vocalised, generated from ~300 inflection classes (`table_number`).
Each form comes in ktiv male ("COMPLETE", vocalised plene spelling) and, when it differs, ktiv haser ("MISSING").
The resource has no roots and no translations: roots are learnt per inflection class from the verbs shared
with Wiktionary (see `RootGuesser`).
"""
import csv
import os
import re
from collections import Counter, defaultdict
from itertools import product

URL = ("https://raw.githubusercontent.com/NNLP-IL/Hebrew-Resources/master/linguistic_resources/"
       "word_lists/hebrew_verbs_eran_tomer/InflectedVerbsExtended.csv")
FILE = "et_inflected.csv"

PATTERN = {"A": "pa", "B": "nif", "C": "pi", "D": "pu", "E": "hit", "F": "hif", "G": "huf"}
# Index errors in the source (התחיל is hif'il only).
SKIP = {("התחיל", "hit")}

NIQQUD = re.compile(r"[\u0591-\u05C7]")
LETTER = re.compile(r"[\u05D0-\u05EA]")
FINALS = str.maketrans("ךםןףץ", "כמנפצ")
SHIN, SIN = "\u05C1", "\u05C2"


def strip(s):
    return NIQQUD.sub("", s)


def letters(s):
    return [c.translate(FINALS) for c in strip(s) if LETTER.match(c)]


def skeleton(s):
    """Consonants with the shin/sin distinction kept (ש→ש/שׂ), finals normalised: matching key for lemmas."""
    out = []
    for c in s:
        if LETTER.match(c):
            out.append(c.translate(FINALS))
        elif c == SIN and out and out[-1] == "ש":
            out[-1] = "שׂ"
    return "".join(out)


def cell_of(morph):
    """'PAST+THIRD+F+SINGULAR+COMPLETE' -> ('p.3fs', 'C'); None for redundant/unused forms."""
    t, p, g, n, sp = morph.split("+")
    sp = "C" if sp == "COMPLETE" else "M"
    if t == "INFINITIVE":
        return "inf", sp
    if t == "BEINONI":  # passive participle (pa'al)
        return ("pp", sp) if (p, g, n) == ("THIRD", "M", "SINGULAR") else None
    num = "s" if n == "SINGULAR" else "p"
    gen = {"M": "m", "F": "f"}.get(g, "")
    per = {"FIRST": "1", "SECOND": "2", "THIRD": "3"}[p]
    if t == "PRESENT":
        return (f"pr.{gen}{num}", sp) if per == "3" else None
    if t == "IMPERATIVE":
        return f"imp.{gen}{num}", sp
    if t == "PAST":
        if per == "1" or (per == "3" and num == "p"):
            return f"p.{per}{num}", sp
        return f"p.{per}{gen}{num}", sp
    if t == "FUTURE":
        return (f"fut.{per}{num}" if per == "1" else f"fut.{per}{gen}{num}"), sp
    return None


def _fold(s):
    """Compare a vocalised plene form with its defective twin: drop bare matres, merge holam/shuruk spellings."""
    s = s.replace("'", "\u05F3")
    s = re.sub("ו\u05BC(?![\u05B0-\u05BB\u05C7])", "\u05BB", s)  # shuruk -> qubuts (not consonantal vav with dagesh)
    s = re.sub("ו\u05B9", "\u05B9", s)  # holam male -> holam
    s = re.sub("[וי](?![\u0591-\u05C7])", "", s)  # bare yod/vav (matres lectionis)
    return s


def pair_forms(complete, missing):
    """[(pointed, unpointed)]: pointed in ktiv haser when available (Wiktionary style), unpointed in ktiv male."""
    rest = list(missing)
    out = []
    for c in complete:
        c = c.replace("'", "\u05F3")
        m = next((x for x in rest if _fold(x) == _fold(c)), None)
        if m is None and len(complete) == len(missing) and rest:
            m = rest[0]
        if m is not None:
            rest.remove(m)
        pair = ((m or c).replace("'", "\u05F3"), strip(c))
        if pair not in out:
            out.append(pair)
    return out


def load(cache):
    """{(skeleton(lemma), binyan): {'l', 'b', 'cls', 'cells': {cell: [(pointed, unpointed)]}}} or {} if missing."""
    path = os.path.join(cache, FILE)
    if not os.path.exists(path):
        print(f"warning: missing {path} (Eran Tomer verbs)")
        return {}
    raw = defaultdict(lambda: defaultdict(lambda: {"C": [], "M": []}))
    meta = {}
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            c = cell_of(r["morphology"])
            if not c:
                continue
            b = PATTERN[r["pattern"]]
            k = (skeleton(r["base_form"]), b)
            if (strip(r["base_form"]), b) in SKIP:
                continue
            meta.setdefault(k, {"l": r["base_form"], "b": b, "cls": (r["pattern"], r["table_number"])})
            lst = raw[k][c[0]][c[1]]
            if r["vocalized_inflection"] not in lst:
                lst.append(r["vocalized_inflection"])
    out = {}
    for k, m in meta.items():
        m["cells"] = {cell: pair_forms(v["C"], v["M"]) for cell, v in raw[k].items() if v["C"] or v["M"]}
        out[k] = m
    return out


class RootGuesser:
    """Learn, per inflection class, which lemma letters (or constant letters) make up the root.

    Trained on verbs present both in Wiktionary (known root) and in the Eran Tomer data; classes without
    training data, or guesses not attested as roots, fall back to weak-root heuristics checked against `known`.
    """

    def __init__(self, known):
        self.known = known
        self.rules = defaultdict(Counter)

    @staticmethod
    def _templates(lem, root):
        opts = [[("p", i) for i, ch in enumerate(lem) if ch == r] + [("c", r)] for r in root]
        if len(opts) > 5:
            return []
        return [tuple(t) for t in product(*opts)]

    def learn(self, cls, lemma, root):
        lem, rt = letters(lemma), letters(root)
        if len(rt) < 3:  # malformed Wiktionary roots
            return
        for t in self._templates(lem, rt):
            self.rules[(cls, len(lem))][t] += 1

    @staticmethod
    def _apply(t, lem):
        if any(kind == "p" and x >= len(lem) for kind, x in t):
            return None
        return "".join(lem[x] if kind == "p" else x for kind, x in t)

    def _best_rule(self, cls, n):
        rules = self.rules.get((cls, n))
        if not rules:
            return None
        # Most frequent; ties -> fewest constant letters.
        return max(rules.items(), key=lambda kv: (kv[1], -sum(k == "c" for k, _ in kv[0])))[0]

    @staticmethod
    def heuristics(lem, b):
        s = list(lem)
        if b == "nif" and s[:1] == ["נ"]:
            s = s[1:]
        elif b in ("hif", "huf") and s[:1] == ["ה"]:
            s = s[1:]
        elif b == "hit" and s[:1] == ["ה"]:
            if s[1:2] == ["ת"]:
                s = s[2:]
            elif len(s) > 3 and s[1] in "שסצז" and s[2] in "תטד":  # metathesis: הִשְׁתַּמֵּשׁ, הִצְטַלֵּם, הִזְדַּקֵּן
                s = [s[1]] + s[3:]
            else:  # assimilated: הִדַּבֵּר, הִטַּהֵר
                s = s[1:]
        cands = []
        if b == "hif" and len(s) >= 3 and s[-2] == "י":
            s2 = s[:-2] + s[-1:]
        else:
            s2 = s
        for core in (s, s2):
            if len(core) == 4 and core[1] == "ו" and core[2] == core[3]:  # polel: כּוֹנֵן
                cands.append(core[0] + "ו" + core[2])
            if core[:1] == ["ו"] and len(core) == 3:  # pe-yod: נוֹלַד, הוֹשִׁיב
                cands += ["י" + "".join(core[1:]), core[1] + "ו" + core[2], "".join(core)]
            if len(core) == 2:
                a, z = core
                cands += [a + "ו" + z, a + "י" + z, "נ" + a + z, "י" + a + z, a + z + z, a + z + "ה"]
            cands.append("".join(core))
        return list(dict.fromkeys(c for c in cands if len(c) >= 3))

    def guess(self, cls, lemma, b):
        lem = letters(lemma)
        cands = []
        rule = self._best_rule(cls, len(lem))
        if rule:
            r = self._apply(rule, lem)
            if r:
                cands.append(r)
        cands += self.heuristics(lem, b)
        for c in cands:
            if c in self.known:
                return c
        return cands[0] if cands else "".join(lem)
