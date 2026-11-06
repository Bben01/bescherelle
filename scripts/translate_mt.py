#!/usr/bin/env python3
"""Fallback French translations for verbs without any Wiktionary French translation.

Providers: Google Gemini when GEMINI_API_KEY is set (GEMINI_MODELS, comma-separated; one parallel worker per
model so their free-tier quotas add up, a model retires when its daily quota is exhausted) and/or the local
Codex CLI when CODEX_MODEL is set (e.g. gpt-6-luna; CODEX_EFFORT, default high; CODEX_JOBS parallel calls), otherwise
Cloudflare Workers AI (free tier: 10k neurons/day). Resumable: `--limit N` translates the N most frequent verbs.
Verbs from Eran Tomer's list have no English gloss: they are translated from the vocalised Hebrew, with the
French meanings of same-root verbs as context; the model may answer [] when unsure (cached, not retried).
Gemini Flash and gpt-6-luna (high effort) are much more reliable than Llama 3.3 for gloss-less verbs.
`--verify` has a (second) model review the cached translations and only rewrite the wrong ones; reviewed ids
and every change are kept in .cache/mt_verified.json and .cache/mt_verify_log.json (resumable).
Results are stored in data/fr_mt.json (committed, resumable) and flagged as machine translations in the UI.
Auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars, or the local wrangler OAuth login.
"""
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
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
    "Sans glose anglaise, traduis depuis le verbe hébreu vocalisé, en t'aidant des verbes de même racine indiqués ; "
    "si tu ne connais pas ce verbe avec certitude, réponds par une liste vide []. "
    "Réponds UNIQUEMENT par un objet JSON {\"clé\": [\"infinitif\", ...]} sans texte autour."
)


VERIFY_SYSTEM = (
    "Tu es lexicographe hébreu-français et tu relis des traductions automatiques. Pour chaque verbe hébreu moderne "
    "(avec son binyan, sa glose anglaise ou des verbes de même racine), une liste de traductions françaises est proposée. "
    "Si la proposition est correcte (sens principal présent, binyan respecté : nif'al, pu'al, huf'al souvent passifs, "
    "hitpa'el réfléchi ou réciproque), N'INCLUS PAS la clé. Sinon, renvoie la liste corrigée : 1 à 4 infinitifs courts, "
    "du plus courant au plus rare. Si la proposition est vide [] et que tu connais ce verbe avec certitude, donne sa "
    "traduction. Si tu ne connais pas le verbe avec certitude, n'inclus pas la clé ; renvoie [] seulement si la "
    "proposition est fausse et que tu ignores le bon sens. "
    "Réponds UNIQUEMENT par un objet JSON {\"clé\": [\"infinitif\", ...]} ({} si tout est correct)."
)
VERIFIED = os.path.join(CACHE, "mt_verified.json")
VERIFY_LOG = os.path.join(CACHE, "mt_verify_log.json")


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


GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
# Each model has its own free-tier quota (requests/minute and /day): one worker per model, in parallel.
# Weaker models (flash-lite 3.1, gemma, openrouter free models) transliterate or invent meanings: not used.
GEMINI_MODELS = os.environ.get("GEMINI_MODELS", "gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,"
                               "gemini-3.8-flash,gemini-3.7-flash,gemini-flash-latest,gemini-3.5-flash-lite").split(",")


class QuotaExhausted(Exception):
    pass


def call_gemini(model, payload, system=SYSTEM):
    body = {"systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"X-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            res = json.load(urllib.request.urlopen(req, timeout=300))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise QuotaExhausted(f"{model}: not available")
            if e.code not in (429, 500, 503) or attempt == 4:
                raise
            delay = 20 * (attempt + 1)
            if e.code == 429:
                details = json.loads(e.read() or b"{}").get("error", {}).get("details", [])
                quotas = [v.get("quotaId", "") for d in details for v in d.get("violations", [])]
                if not quotas or any("PerDay" in q for q in quotas):
                    raise QuotaExhausted(f"{model}: {', '.join(quotas) or 'no quota'}")
                delay = next((float(d["retryDelay"].rstrip("s")) + 1 for d in details if "retryDelay" in d), delay)
            time.sleep(delay)
        except (TimeoutError, urllib.error.URLError):
            if attempt == 4:
                raise
            time.sleep(10)
    text = "".join(p.get("text", "") for p in res["candidates"][0]["content"]["parts"] if not p.get("thought"))
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


CODEX_MODEL = os.environ.get("CODEX_MODEL")  # e.g. gpt-6-luna, through the local `codex` CLI login
CODEX_EFFORT = os.environ.get("CODEX_EFFORT", "high")
CODEX_JOBS = int(os.environ.get("CODEX_JOBS", "3"))


def call_codex(payload, system=SYSTEM):
    codex = shutil.which("codex") or os.path.expanduser("~/.local/bin/codex")
    with tempfile.TemporaryDirectory() as d:  # empty read-only workspace: the agent only answers
        out = os.path.join(d, "out.txt")
        r = subprocess.run([codex, "exec", "-m", CODEX_MODEL, "-c", f'model_reasoning_effort="{CODEX_EFFORT}"',
                            "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", d, "-o", out, "-"],
                           input=system + "\n\n" + json.dumps(payload, ensure_ascii=False),
                           capture_output=True, text=True, timeout=900)
        if r.returncode:
            if re.search(r"usage limit|quota|rate limit", r.stderr, re.I):
                raise QuotaExhausted(f"codex {CODEX_MODEL}: {r.stderr.strip()[-200:]}")
            raise RuntimeError(r.stderr.strip()[-300:])
        text = open(out).read()
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


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
    verify = "--verify" in sys.argv
    system = VERIFY_SYSTEM if verify else SYSTEM
    workers = [(m, lambda p, m=m: call_gemini(m, p, system)) for m in GEMINI_MODELS] if GEMINI_KEY else []
    workers += [(f"codex {CODEX_MODEL}", lambda p: call_codex(p, system))] * CODEX_JOBS if CODEX_MODEL else []
    if verify and not workers:
        sys.exit("--verify needs GEMINI_API_KEY or CODEX_MODEL.")
    token, account = (None, None) if workers else credentials()
    mt = json.load(open(MT)) if os.path.exists(MT) else {}
    verbs = json.load(open(DATA))["verbs"]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    checked = set(json.load(open(VERIFIED))) if verify and os.path.exists(VERIFIED) else set()
    log = json.load(open(VERIFY_LOG)) if verify and os.path.exists(VERIFY_LOG) else []
    if verify:
        todo = [v for v in verbs if v["id"] in mt and v["id"] not in checked]
    else:
        todo = [v for v in verbs if (not v["fr"] or v.get("mt")) and v["id"] not in mt and (v["en"] or v.get("src") == "et")]
    todo = sorted(todo, key=lambda v: -v.get("q", 0))[:limit]
    print(f"{len(todo)} verbs to {'verify' if verify else 'translate'}")
    by_root = {}
    for v in verbs:
        by_root.setdefault(re.sub(r"[^\u05D0-\u05EA]", "", v["r"]), []).append(v)

    def describe(v):
        if v["en"]:
            return f'{v["w"]} ({BIN.get(v["b"], v["b"])}): {"; ".join(v["en"][:3])[:160]}'
        sibs = [f'{x["l"]} ({BIN.get(x["b"], x["b"])}) = {", ".join((x["fr"] or mt.get(x["id"]) or x["en"])[:2])}'
                for x in by_root.get(re.sub(r"[^\u05D0-\u05EA]", "", v["r"]), [])
                if x is not v and (x["fr"] or mt.get(x["id"]) or x["en"])][:3]
        return f'{v["l"]} ({BIN.get(v["b"], v["b"])})' + (f' — même racine : {" ; ".join(sibs)}' if sibs else "")

    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    lock = threading.Lock()
    done = [0]

    def store(chunk, out, model=""):
        # The model sometimes keys answers by the Hebrew word (or the whole prompt line) instead of the index.
        by_word = {k.split(" ")[0]: val for k, val in out.items()}
        with lock:
            for j, v in enumerate(chunk):
                fr = out.get(str(j), by_word.get(v["w"], by_word.get(v["l"])))
                if verify:
                    checked.add(v["id"])
                    if fr is None:
                        continue
                if isinstance(fr, str):
                    fr = [fr]
                if isinstance(fr, list):
                    fr = [s.strip() for s in fr if isinstance(s, str) and 0 < len(s.strip()) <= 40][:4]
                    if fr or (v.get("src") == "et" and not v["en"]):
                        if verify and fr != mt.get(v["id"]):
                            log.append({"id": v["id"], "l": v["l"], "b": v["b"], "old": mt.get(v["id"]), "new": fr,
                                        "by": model})
                        mt[v["id"]] = fr
            json.dump(mt, open(MT, "w"), ensure_ascii=False, indent=0)
            if verify:
                os.makedirs(CACHE, exist_ok=True)
                json.dump(sorted(checked), open(VERIFIED, "w"), ensure_ascii=False)
                json.dump(log, open(VERIFY_LOG, "w"), ensure_ascii=False, indent=1)
            done[0] += len(chunk)
            return done[0]

    def payload_of(chunk):
        with lock:  # describe() reads mt, which other workers update
            if verify:
                return {str(j): f'{describe(v)} → proposé : {json.dumps(mt[v["id"]], ensure_ascii=False)}'
                        for j, v in enumerate(chunk)}
            return {str(j): describe(v) for j, v in enumerate(chunk)}

    if not workers:
        for chunk in batches:
            try:
                out = call(token, account, payload_of(chunk))
            except Exception as e:  # keep progress, retry later
                print("error:", e)
                continue
            print(f"  {store(chunk, out)}/{len(todo)}", flush=True)
    else:
        queue = collections.deque(batches)

        def worker(model, fn):
            failures = 0
            while failures < 3:
                with lock:
                    if not queue:
                        return
                    chunk = queue.popleft()
                try:
                    out = fn(payload_of(chunk))
                except QuotaExhausted as e:
                    with lock:
                        queue.appendleft(chunk)
                    print(f"  quota: {e}", flush=True)
                    return
                except Exception as e:  # give the batch back to another worker
                    with lock:
                        queue.append(chunk)
                    failures += 1
                    print(f"  {model} error: {e}", flush=True)
                    continue
                failures = 0
                print(f"  {store(chunk, out, model)}/{len(todo)} ({model})", flush=True)

        threads = [threading.Thread(target=worker, args=w) for w in workers]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    print(f"{len(mt)} machine translations cached" + (f", {len(log)} corrections logged in {VERIFY_LOG}" if verify else ""))


if __name__ == "__main__":
    main()
