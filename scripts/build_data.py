#!/usr/bin/env python3
"""Build public/data/verbs.json from Wiktionary extractions (kaikki.org, CC BY-SA).

Inputs (see scripts/fetch_sources.sh), in .cache/:
  he.jsonl        English Wiktionary, Hebrew entries (conjugation tables, roots, EN glosses)
  fr_he.jsonl     French Wiktionary, French verbs having Hebrew translations (filtered)
  en_pivot.jsonl  English Wiktionary, English verbs translated into both Hebrew and French (filtered)
  fr_hebreu.jsonl French Wiktionary, Hebrew entries (FR glosses)
  ../data/fr_mt.json  committed machine translations EN gloss -> FR (fallback, flagged)
"""
import json
import os
import re
import sys
import math
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "public", "data", "verbs.json")

NIQQUD = re.compile(r"[\u0591-\u05C7]")
FINALS = str.maketrans("ךםןףץ", "כמנפצ")
HEB = re.compile(r"[\u05D0-\u05EA]")


def strip(s):
    return NIQQUD.sub("", s).replace("\u05BE", "-")


def has_niqqud(s):
    return bool(NIQQUD.search(s))


def key(s):
    return re.sub(r"[^\u05D0-\u05EA]", "", strip(s)).translate(FINALS)


# he-conj code -> (binyan, sub-pattern)
BINYAN = {"pa": ("pa", ""), "nif": ("nif", ""), "pi": ("pi", ""), "pu": ("pu", ""), "hif": ("hif", ""),
          "huf": ("huf", ""), "hit": ("hit", ""), "po": ("pi", "po"), "poal": ("pu", "poal"),
          "hitpo": ("hit", "hitpo"), "hitpu": ("hit", "hitpu"), "hitpu'al": ("hit", "hitpu"),
          "nitpa'el": ("hit", "nitpa")}
ROOT_FIX = {"היה": "היה", "חי": "חיה", "התענו": "ענו"}

CELL_KEYS = ["pr.ms", "pr.fs", "pr.mp", "pr.fp",
             "p.1s", "p.1p", "p.2ms", "p.2fs", "p.2mp", "p.2fp", "p.3ms", "p.3fs", "p.3p",
             "fut.1s", "fut.1p", "fut.2ms", "fut.2fs", "fut.2mp", "fut.2fp",
             "fut.3ms", "fut.3fs", "fut.3mp", "fut.3fp",
             "imp.ms", "imp.fs", "imp.mp", "imp.fp", "inf", "n", "pp"]


def cell_from_tags(tags):
    t = set(tags)
    if "error-unrecognized-form" in t:
        return "inf"
    if "noun-from-verb" in t:
        return "n"
    if "participle" in t and "passive" in t:
        return "pp"
    if "negative" in t:
        return None
    g = "m" if "masculine" in t and "feminine" not in t else "f" if "feminine" in t and "masculine" not in t else ""
    n = "s" if "singular" in t else "p" if "plural" in t else ""
    p = "1" if "first-person" in t else "2" if "second-person" in t else "3" if "third-person" in t else ""
    if "present" in t:
        return f"pr.{g}{n}"
    if "imperative" in t:
        return f"imp.{g}{n}"
    if "past" in t:
        if p == "1" or (p == "3" and n == "p"):
            return f"p.{p}{n}"
        return f"p.{p}{g}{n}"
    if "future" in t:
        if p == "1":
            return f"fut.{p}{n}"
        return f"fut.{p}{g}{n}"
    return None


def parse_tables(forms):
    """Return {cell: [[pointed, unpointed], ...]} merging all tables of the entry."""
    cells = defaultdict(list)
    pending = defaultdict(list)  # unpointed forms waiting for their pointed counterpart
    for f in forms:
        if f.get("source") != "conjugation":
            continue
        tags = f.get("tags", [])
        if "inflection-template" in tags or "table-tags" in tags:
            pending.clear()
            continue
        c = cell_from_tags(tags)
        if c not in CELL_KEYS:
            continue
        form = f["form"].strip()
        if not HEB.search(form):
            continue
        if not has_niqqud(form):
            pending[c].append(form)
            continue
        unp = None
        for link in f.get("links", []):
            target = link[1].split("#")[0]
            if HEB.search(target) and not has_niqqud(target):
                unp = target
                break
        if unp is None and pending[c]:
            unp = pending[c].pop(0)
        if unp is None:
            unp = strip(form)
        pair = [form, unp]
        if pair not in cells[c]:
            cells[c].append(pair)
    return cells


def encode_cell(pairs):
    """'pointed' or 'pointed|unpointed' when ktiv male differs; variants joined by ','."""
    out = []
    for p, u in pairs:
        out.append(p if u == strip(p) else f"{p}|{u}")
    return ",".join(out)


GUTT = set("אהחער")


def gizra(root):
    """Weak-root classes (גזרות) from the bare root letters."""
    r = [ch.translate(FINALS) for ch in root]
    tags = []
    if len(r) == 4:
        tags.append("merubaim")
    if len(r) < 3:
        return tags
    p, a, l = r[0], r[1], r[-1]
    if len(r) == 3:
        if p == "נ":
            tags.append("pn")
        if p == "י":
            tags.append("py")
        if p == "א":
            tags.append("pa")
        if a in "וי":
            tags.append("aw")
        if a == l:
            tags.append("aa")
        if l == "ה":
            tags.append("lh")
        if l == "א":
            tags.append("la")
    if p in GUTT and p not in "אר":
        tags.append("pg")
    if len(r) == 3 and a in GUTT:
        tags.append("ag")
    if l in "חע":
        tags.append("lg")
    if not tags:
        tags.append("shlemim")
    return tags


def root_from_args(args):
    r = args.get("2") or ""
    r = re.sub(r"[^\u05D0-\u05EA\u05C1\u05C2]", "", r)
    return r


def load_jsonl(name):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print(f"warning: missing {path}", file=sys.stderr)
        return []
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def clean_gloss(g):
    g = re.sub(r"\s+", " ", g).strip()
    return g


def build():
    verbs = []
    by_word = defaultdict(list)
    for d in load_jsonl("he.jsonl"):
        if d.get("pos") != "verb":
            continue
        cells = parse_tables(d.get("forms", []))
        if len(cells) < 10:
            continue
        head = next((h["args"] for h in d.get("head_templates", []) if h["name"] == "he-verb"), {})
        conj = next((t["args"] for t in d.get("inflection_templates", []) if t["name"] == "he-conj"), {})
        b, bs = BINYAN.get(conj.get("1") or head.get("1") or "", ("", ""))
        root = root_from_args(conj)
        if not root:
            m = re.search(r"Hebrew terms belonging to the root ([\u05D0-\u05EA\u05BE־\u05C1\u05C2]+)", json.dumps(d, ensure_ascii=False))
            if m:
                root = re.sub(r"[^\u05D0-\u05EA\u05C1\u05C2]", "", m.group(1))
        if not root:
            root = ROOT_FIX.get(d["word"]) or re.sub(r"[^\u05D0-\u05EA]", "", d["word"])
        lemma = head.get("wv") or next((f["form"] for f in d["forms"] if "canonical" in f.get("tags", [])), d["word"])
        if "p.3ms" in cells and not has_niqqud(lemma):
            lemma = cells["p.3ms"][0][0]
        tr = next((f["form"] for f in d["forms"] if "romanization" in f.get("tags", [])), head.get("tr", ""))
        en, examples = [], []
        for s in d.get("senses", []):
            for g in s.get("glosses", []):
                g = clean_gloss(g)
                if g and g not in en:
                    en.append(g)
            for ex in s.get("examples", []):
                text = ex.get("text", "")
                if HEB.search(text) and ex.get("english") and len(examples) < 4:
                    examples.append({"he": text, "en": ex.get("english"), "tr": ex.get("roman", "")})
        v = {
            "w": d["word"],
            "l": lemma,
            "b": b,
            "r": root,
            "g": gizra(strip(root)),
            "t": tr,
            "en": en[:8],
            "fr": [],
            "c": [encode_cell(cells.get(k, [])) for k in CELL_KEYS],
        }
        if bs:
            v["bs"] = bs
        for k_arg, k_out in (("pass", "pass"), ("act", "act")):
            if head.get(k_arg):
                v[k_out] = head[k_arg]
        if examples:
            v["ex"] = examples
        verbs.append(v)
        by_word[d["word"]].append(v)

    # Unique ids: unpointed lemma, disambiguated with binyan / counter.
    seen = defaultdict(int)
    for v in verbs:
        base = v["w"] if len(by_word[v["w"]]) == 1 else f'{v["w"]}-{v["b"]}'
        seen[base] += 1
        v["id"] = base if seen[base] == 1 else f"{base}-{seen[base]}"

    attach_french(verbs)
    verbs.sort(key=lambda v: key(v["w"]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    build_examples(verbs)
    with open(OUT, "w") as fh:
        json.dump({"v": 1, "cells": CELL_KEYS, "verbs": verbs}, fh, ensure_ascii=False, separators=(",", ":"))
    n_fr = sum(1 for v in verbs if v["fr"])
    print(f"{len(verbs)} verbs, {n_fr} with French, {os.path.getsize(OUT) // 1024} KiB -> {OUT}")


# Function words / nouns that collide with short verb forms and would produce bogus examples.
EX_STOP = set("את אם על כי לא יש אין הוא היא הם הן מה זה זו אני אתה את של אל עם גם כל רק אך או אז פה שם לו לה לי לך לנו לכם להם בו בה בי בך מי מן עד כן טוב רע רב חי מת ספר שיר דבר עבר בא באה באו קם שב".split())
EX_PREFIXES = ("", "ו", "ש", "וש", "כש", "וכש")
EX_PER_VERB = 4
EX_OUT = os.path.join(ROOT, "public", "data", "examples.json")


def build_examples(verbs):
    """Tatoeba Hebrew–French sentence pairs (CC BY 2.0 FR) matched to verbs through their conjugated forms."""
    paths = [os.path.join(CACHE, f) for f in ("heb_sentences.tsv", "fra_sentences.tsv", "heb-fra_links.tsv")]
    if not all(os.path.exists(p) for p in paths):
        print("Tatoeba files missing, skipping examples")
        return
    links = defaultdict(list)
    for line in open(paths[2]):
        a, b = line.rstrip("\n").split("\t")[:2]
        links[a].append(b)
    fra_needed = {b for bs in links.values() for b in bs}
    fra = {}
    for line in open(paths[1]):
        sid, _, text = line.rstrip("\n").split("\t", 2)
        if sid in fra_needed:
            fra[sid] = text
    heb, all_heb = {}, []
    for line in open(paths[0]):
        sid, _, text = line.rstrip("\n").split("\t", 2)
        all_heb.append(text)
        if sid in links:
            heb[sid] = text

    nonverb = set(EX_STOP)
    for e in load_jsonl("he.jsonl"):
        if e.get("pos") in ("verb", "root", "character", "suffix", "prefix"):
            continue
        words = [e.get("word", "")] + [f.get("form", "") for f in e.get("forms", [])]
        for args in (t.get("args", {}) for t in e.get("head_templates", [])):
            words += [a for k, a in args.items() if k in ("pl", "f", "fpl", "mpl", "cons", "plcons")]
        for w in words:
            w = strip(w)
            nonverb.add(w)
            if w.startswith("ה") and len(w) > 3:
                continue
            nonverb.add("ה" + w)  # definite article

    form_index = defaultdict(set)
    for vi, v in enumerate(verbs):
        for ci, cell in enumerate(v["c"]):
            for variant in cell.split(","):
                if not variant:
                    continue
                u = variant.split("|")[1] if "|" in variant else strip(variant)
                if len(u) >= 3 and u not in nonverb:
                    form_index[u].add((vi, CELL_KEYS[ci]))

    def match(tok):
        for p in EX_PREFIXES:
            if tok.startswith(p) and len(tok) - len(p) >= 3 and tok[len(p):] in form_index:
                return form_index[tok[len(p):]]
        return None

    # Usage frequency: occurrences in all Hebrew Tatoeba sentences (ambiguous forms split their weight).
    freq = defaultdict(float)
    for text in all_heb:
        for tok in re.findall(r"[\u05D0-\u05EA\u05B0-\u05C7]+", text):
            hits = match(strip(tok))
            if hits:
                vis = {h[0] for h in hits}
                for vi in vis:
                    freq[vi] += 1 / len(vis)
    for vi, v in enumerate(verbs):
        if freq[vi] >= 1:
            v["q"] = round(freq[vi])

    cands = defaultdict(list)
    for sid, text in heb.items():
        fr_text = next((fra[b] for b in links[sid] if b in fra), None)
        if not fr_text or len(text) > 90:
            continue
        seen = set()
        for tok in re.findall(r"[\u05D0-\u05EA\u05B0-\u05C7\"'׳״-]+", text):
            tok = strip(tok).strip("-\"'׳״")
            for p in EX_PREFIXES:
                if not tok.startswith(p) or len(tok) - len(p) < 3:
                    continue
                hits = form_index.get(tok[len(p):])
                if not hits:
                    continue
                # Ambiguous forms (shared by several verbs) rank lower.
                for vi, cell in hits:
                    if vi not in seen:
                        seen.add(vi)
                        cands[vi].append((len({h[0] for h in hits}), len(text), sid, text, fr_text, cell))
                break

    out = {}
    for vi, lst in cands.items():
        lst.sort(key=lambda c: (c[0] > 1, c[1]))
        out[verbs[vi]["id"]] = [[int(c[2]), c[3], c[4], c[5]] for c in lst[:EX_PER_VERB]]
    with open(EX_OUT, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{sum(len(x) for x in out.values())} Tatoeba examples for {len(out)} verbs, {os.path.getsize(EX_OUT) // 1024} KiB -> {EX_OUT}")


FR_BAD = re.compile(r"[0-9()\[\]]")


def norm_fr(w):
    w = re.sub(r"\s+", " ", w).strip()
    if not w or FR_BAD.search(w) or len(w) > 40:
        return None
    return w


FR_PREPS = {"de", "d'", "à", "avec", "sur", "pour", "contre", "en", "par", "dans", "chez", "vers", "quelque", "chose", "quelqu'un", "qqn", "qqch"}


def clean_fr_gloss(part):
    """'Parler de' -> 'parler'; drops fragments like 'avec' or '…' from glosses such as 'Parler de, avec, …'."""
    part = re.sub(r"\(.*?\)|…|\.\.\.", "", part).strip().rstrip(".").strip()
    words = part.split()
    while len(words) > 1 and words[-1].lower() in FR_PREPS:
        words.pop()
    if not words or (len(words) == 1 and words[0].lower() in FR_PREPS):
        return ""
    return " ".join(words)


def attach_french(verbs):
    index = defaultdict(set)
    for i, v in enumerate(verbs):
        keys = {key(v["w"]), key(v["l"])}
        for form in re.split(r"[,|]", v["c"][CELL_KEYS.index("inf")]):
            keys.add(key(form))
        for k in keys:
            if k:
                index[k].add(i)

    scores = defaultdict(lambda: defaultdict(float))
    src = defaultdict(lambda: defaultdict(set))

    def add(i, fr, s, origin):
        fr = norm_fr(fr)
        if fr:
            scores[i][fr] += s
            src[i][fr].add(origin)

    # 1. fr.wiktionary: French verb -> Hebrew translation
    for e in load_jsonl("fr_he.jsonl"):
        for t in e["tr"]:
            for i in index.get(key(t.get("word", "")), ()):
                add(i, e["word"], 3, "frwikt")

    # 2. en.wiktionary pivot: same translation-table sense contains Hebrew + French
    for e in load_jsonl("en_pivot.jsonl"):
        groups = defaultdict(lambda: {"he": [], "fr": []})
        for t in e["tr"]:
            groups[t.get("sense", "")][t["lang_code"]].append(t.get("word", ""))
        for sense, g in groups.items():
            hits = set()
            for hw in g["he"]:
                hits |= index.get(key(hw), set())
            for i in hits:
                glosses = " ".join(verbs[i]["en"]).lower()
                strong = re.search(r"\b" + re.escape(e["word"].lower()) + r"\b", glosses) is not None
                for fw in g["fr"]:
                    add(i, fw, 2 if strong else 0.5, "enpivot")

    # 3. fr.wiktionary Hebrew entries (French glosses)
    for e in load_jsonl("fr_hebreu.jsonl"):
        if e.get("pos") != "verb":
            continue
        for i in index.get(key(e.get("word", "")), ()):
            for s in e.get("senses", []):
                for g in s.get("glosses", []):
                    for part in re.split(r"[,;]", g):
                        part = clean_fr_gloss(part)
                        if part and len(part.split()) <= 4:
                            add(i, part[0].lower() + part[1:], 3, "frwikt-he")

    mt_path = os.path.join(ROOT, "data", "fr_mt.json")
    mt = json.load(open(mt_path)) if os.path.exists(mt_path) else {}

    # French word frequencies (Tatoeba French sentences) to order translations with equal evidence.
    fr_freq = Counter()
    fra_path = os.path.join(CACHE, "fra_sentences.tsv")
    if os.path.exists(fra_path):
        with open(fra_path) as fh:
            for line in fh:
                fr_freq.update(re.findall(r"[a-zàâçéèêëîïôûùüÿœ]+", line.split("\t", 2)[-1].lower()))

    def fr_weight(w):
        head = [t for t in re.findall(r"[a-zàâçéèêëîïôûùüÿœ]+", w.lower()) if t not in ("se", "s", "être")]
        return math.log10(1 + fr_freq[head[0]]) if head else 0

    for i, v in enumerate(verbs):
        ranked = sorted(scores[i].items(), key=lambda kv: (-(kv[1] + 0.3 * fr_weight(kv[0])), kv[0]))
        best = max(scores[i].values(), default=0)
        v["fr"] = [w for w, s in ranked if s >= max(1, best / 4)][:8]
        if not v["fr"] and mt.get(v["id"]):
            v["fr"] = mt[v["id"]]
            v["mt"] = 1


if __name__ == "__main__":
    build()
