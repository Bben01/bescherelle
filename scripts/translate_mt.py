#!/usr/bin/env python3
"""Fallback French translations for verbs without any Wiktionary French translation.

Uses Cloudflare Workers AI (free tier: 10k neurons/day; this needs ~7k for ~1300 verbs).
Results are stored in data/fr_mt.json (committed, resumable) and flagged as machine translations in the UI.
Auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars, or the local wrangler OAuth login.
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
MT = os.path.join(ROOT, "data", "fr_mt.json")
DATA = os.path.join(ROOT, "public", "data", "verbs.json")
MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
BATCH = 30

SYSTEM = (
    "Tu es lexicographe hébreu-français. Pour chaque verbe hébreu moderne (avec son binyan et sa glose anglaise), "
    "donne 1 à 4 traductions françaises courtes, à l'infinitif (ex. « garder », « se souvenir », « être écrit »), "
    "de la plus courante à la plus rare. Respecte le sens passif/réfléchi du binyan (nif'al, pu'al, huf'al, hitpa'el). "
    "Réponds UNIQUEMENT par un objet JSON {\"clé\": [\"infinitif\", ...]} sans texte autour."
)


def credentials():
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token:
        for p in ("~/Library/Preferences/.wrangler/config/default.toml", "~/.wrangler/config/default.toml",
                  "~/.config/.wrangler/config/default.toml"):
            p = os.path.expanduser(p)
            if os.path.exists(p):
                m = re.search(r'^oauth_token\s*=\s*"([^"]+)"', open(p).read(), re.M)
                if m:
                    token = m.group(1)
                    break
    if not token:
        sys.exit("No Cloudflare credentials (set CLOUDFLARE_API_TOKEN or run `wrangler login`).")
    if not account:
        req = urllib.request.Request("https://api.cloudflare.com/client/v4/accounts",
                                     headers={"Authorization": f"Bearer {token}"})
        account = json.load(urllib.request.urlopen(req))["result"][0]["id"]
    return token, account


def call(token, account, payload):
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODEL}",
        data=json.dumps({"messages": [{"role": "system", "content": SYSTEM},
                                      {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                         "max_tokens": 2048, "temperature": 0.1}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    res = json.load(urllib.request.urlopen(req, timeout=120))["result"]
    text = res["response"] if "response" in res else res["choices"][0]["message"]["content"]
    if isinstance(text, dict):
        return text
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


BIN = {"pa": "pa'al", "nif": "nif'al", "pi": "pi'el", "pu": "pu'al", "hif": "hif'il", "huf": "huf'al", "hit": "hitpa'el"}


def main():
    token, account = credentials()
    mt = json.load(open(MT)) if os.path.exists(MT) else {}
    verbs = json.load(open(DATA))["verbs"]
    todo = [v for v in verbs if (not v["fr"] or v.get("mt")) and v["id"] not in mt and v["en"]]
    print(f"{len(todo)} verbs to translate")
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        payload = {str(j): f'{v["w"]} ({BIN.get(v["b"], v["b"])}): {"; ".join(v["en"][:3])[:160]}' for j, v in enumerate(chunk)}
        try:
            out = call(token, account, payload)
        except Exception as e:  # keep progress, retry later
            print("error:", e)
            continue
        # The model sometimes keys answers by the Hebrew word (or the whole prompt line) instead of the index.
        by_word = {k.split(" ")[0]: val for k, val in out.items()}
        for j, v in enumerate(chunk):
            fr = out.get(str(j), by_word.get(v["w"]))
            if isinstance(fr, str):
                fr = [fr]
            if isinstance(fr, list):
                fr = [s.strip() for s in fr if isinstance(s, str) and 0 < len(s.strip()) <= 40][:4]
                if fr:
                    mt[v["id"]] = fr
        json.dump(mt, open(MT, "w"), ensure_ascii=False, indent=0)
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    print(f"{len(mt)} machine translations cached")


if __name__ == "__main__":
    main()
