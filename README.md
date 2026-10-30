# Bescherelle hébreu

**https://bescherelle.pages.dev** — conjugueur hébreu ↔ français gratuit, hommage à feu *hebreu.mobi*.

- **2 139 verbes** conjugués à tous les temps (présent, passé, futur, impératif, infinitif, nom d'action, participe passif) avec nikoud, écriture pleine (כתיב מלא) et translittération française ou anglaise.
- **Recherche intelligente** (instantanée, côté client) :
  - français (`garder`, `ecrire` sans accent), anglais (`to write`) ;
  - hébreu avec ou sans nikoud, **n'importe quelle forme conjuguée**, même avec préfixe (`ונכתוב`, `כשאמרתי`) ;
  - racine (`שמר` → tous les binyanim) ; prononciation latine (`lichmor`, `shamar`, `hitkonen`) avec tolérance aux fautes ;
  - **par lettres** : suite de lettres contenue, lettres dans l'ordre, lettres dans le désordre (`מרש` → שמר), motifs `ש?ר` / `ה*ר`, racine contenue dans un mot (`תשובה` → שוב) ;
  - filtres par binyan et par type de racine (gizra).
- Pages verbe : tableaux, racine, binyan, gizra, passif/actif, **phrases d'exemple Tatoeba** traduites, verbes de même racine et de même modèle.
- Binyanim (tableau récapitulatif), liste filtrable, comparateur (jusqu'à 4 verbes), quiz (conjugaison ou sens), favoris et historique, verbe du jour, verbe au hasard.
- Clavier hébreu virtuel + saisie hébraïque depuis un clavier AZERTY/QWERTY, synthèse vocale, copie d'un clic, mode sombre, impression.
- **PWA hors ligne** (installable), pages prérendues pour le référencement, aucun serveur.

## Architecture (100 % gratuit)

- Site statique Vite + TypeScript sans framework, hébergé sur **Cloudflare Pages** (requêtes statiques illimitées, ~3 500 fichiers < limite de 20 000).
- Aucune fonction serveur : la recherche tourne dans le navigateur sur `verbs.json` (~500 Ko gzip, mis en cache par le service worker).
- `scripts/prerender.ts` génère une page HTML par verbe et par racine + `sitemap.xml`.

## Données

```sh
npm run data        # télécharge Wiktionary/kaikki + Tatoeba dans .cache/ et construit public/data/
npm run translate   # (optionnel) traductions FR manquantes via Workers AI (free tier, wrangler login)
python3 scripts/build_data.py   # reconstruit après traduction
```

Les traductions automatiques déjà produites sont versionnées dans `data/fr_mt.json` (marquées « auto » dans l'interface), ce qui rend la reconstruction reproductible sans rappeler l'IA.

Sources : Wiktionary anglais (tableaux `he-conj`), Wiktionnaire, pivot par les tables de traduction anglaises, Tatoeba. Voir [DATA_LICENSE.md](DATA_LICENSE.md).

Les corrections de conjugaison ou de traduction se font idéalement **directement sur le Wiktionnaire / Wiktionary** : elles seront reprises à la prochaine reconstruction.

## Développement

```sh
npm install
npm run dev      # serveur de dev
npm test         # vitest (translittération, recherche)
npm run build    # tsc + vite + prérendu → dist/
npm run preview  # émulateur Cloudflare Pages sur dist/
npm run deploy   # build + wrangler pages deploy
```

Node ≥ 23.6 (le prérendu exécute directement du TypeScript). La CI GitHub Actions teste et construit à chaque push ; elle déploie aussi si les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` sont définis.

## Licence

Code et site : [CC BY-NC 4.0](LICENSE). Données : CC BY-SA 4.0 (Wiktionary) et CC BY 2.0 FR (Tatoeba) — voir [DATA_LICENSE.md](DATA_LICENSE.md).
