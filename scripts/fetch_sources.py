#!/usr/bin/env python3
"""Download the source data into .cache/ (all CC BY-SA, from kaikki.org / wiktextract).

1. Hebrew entries of English Wiktionary (conjugation tables, roots, glosses)   -> he.jsonl
2. Hebrew entries of French Wiktionary (French glosses)                         -> fr_hebreu.jsonl
3. For every English verb used in a Hebrew gloss, its English Wiktionary entry;
   we keep translation-table senses listing both Hebrew and French              -> en_pivot.jsonl

The full English dump is >3 GB, so step 3 fetches only the needed per-word files.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

import eran_tomerfrom concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
WORDS = os.path.join(CACHE, "en_words")
UA = {"User-Agent": "bescherelle-hebreu data builder (https://github.com/Bben01/bescherelle)"}


def get(url, dest=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if dest:
        with open(dest, "wb") as fh:
            fh.write(data)
    return data


def fetch_bulk():
    files = {
        "he.jsonl": "https://kaikki.org/dictionary/Hebrew/kaikki.org-dictionary-Hebrew.jsonl",
        "fr_hebreu.jsonl": "https://kaikki.org/frwiktionary/H%C3%A9breu/kaikki.org-dictionary-H%C3%A9breu.jsonl",
        eran_tomer.FILE: eran_tomer.URL,
    }
    for name, url in files.items():
        dest = os.path.join(CACHE, name)
        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            print("downloading", url)
            get(url, dest)


def english_heads(gloss):
    """'to guard, watch over' -> ['guard', 'watch over', 'watch']"""
    out = []
    gloss = re.sub(r"\([^)]*\)", "", gloss)
    for part in re.split(r"[,;/]| or ", gloss):
        part = part.strip().lower()
        part = re.sub(r"^(to|be able to)\s+", "", part)
        if not part or part.startswith("be ") or len(part) > 30 or not re.match(r"^[a-z][a-z '\-]*$", part):
            continue
        words = part.split()
        if len(words) <= 3:
            out.append(part)
        if len(words) > 1 and words[0] not in ("be", "get", "make", "have", "take", "go", "do"):
            out.append(words[0])
    return out


def word_url(w):
    p1 = w[0]
    p2 = w[:2] if len(w) > 1 else w
    q = urllib.parse.quote
    return f"https://kaikki.org/dictionary/English/meaning/{q(p1)}/{q(p2)}/{q(w)}.jsonl"


def fetch_word(w):
    dest = os.path.join(WORDS, urllib.parse.quote(w, safe="") + ".jsonl")
    if os.path.exists(dest):
        return dest
    try:
        get(word_url(w), dest)
    except Exception:
        open(dest, "w").close()
    return dest


def fetch_pivot():
    os.makedirs(WORDS, exist_ok=True)
    heads = set()
    with open(os.path.join(CACHE, "he.jsonl")) as fh:
        for line in fh:
            d = json.loads(line)
            if d.get("pos") != "verb":
                continue
            for s in d.get("senses", []):
                for g in s.get("glosses", []):
                    heads.update(english_heads(g))
    heads = sorted(heads)
    print(f"{len(heads)} English headwords to fetch")
    done = 0
    with ThreadPoolExecutor(max_workers=12) as ex:
        for _ in ex.map(fetch_word, heads):
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(heads)}", flush=True)
    n = 0
    with open(os.path.join(CACHE, "en_pivot.jsonl"), "w") as out:
        for w in heads:
            path = os.path.join(WORDS, urllib.parse.quote(w, safe="") + ".jsonl")
            if not os.path.exists(path):
                continue
            with open(path) as fh:
                for line in fh:
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if d.get("pos") != "verb" or d.get("lang_code") != "en":
                        continue
                    tr = [t for t in d.get("translations", []) if t.get("lang_code") in ("he", "fr")]
                    if any(t["lang_code"] == "he" for t in tr) and any(t["lang_code"] == "fr" for t in tr):
                        out.write(json.dumps({"word": d["word"], "tr": tr}, ensure_ascii=False) + "\n")
                        n += 1
    print(f"{n} English verb entries with he+fr translations")


if __name__ == "__main__":
    os.makedirs(CACHE, exist_ok=True)
    fetch_bulk()
    if "--no-pivot" not in sys.argv:
        fetch_pivot()
