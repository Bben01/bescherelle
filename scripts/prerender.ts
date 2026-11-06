// Static prerender after `vite build`: one HTML file per verb / root / static page (SEO + no-JS),
// plus sitemap.xml and a versioned service worker. Run with `node scripts/prerender.ts` (Node ≥ 23).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrate, type DataFile, type TatoebaEx } from '../src/data.ts';
import { esc, indexCtx, pageDescription, pageTitle, renderAbout, renderBinyanim, renderHome, renderList, renderRoot, renderVerb } from '../src/render.ts';

const SITE = process.env.SITE_URL ?? 'https://bescherelle.pages.dev';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shell = readFileSync(join(dist, 'index.html'), 'utf8');
const raw = readFileSync(join(dist, 'data', 'verbs.json'), 'utf8');
const verbs = hydrate(JSON.parse(raw) as DataFile);
const ctx = indexCtx(verbs);
const examples = JSON.parse(readFileSync(join(dist, 'data', 'examples.json'), 'utf8')) as Record<string, TatoebaEx[]>;

function page(path: string, title: string, desc: string, body: string): string {
  const url = SITE + encodeURI(path);
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(desc)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(desc)}`)
    .replace('</head>', `  <link rel="canonical" href="${esc(url)}" />\n    <meta property="og:url" content="${esc(url)}" />\n  </head>`)
    .replace(/<!--app-->[\s\S]*<!--\/app-->/, () => `<!--app-->${body}<!--/app-->`);
}

const urls: string[] = [];
function write(path: string, file: string, title: string, desc: string, body: string) {
  const out = join(dist, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page(path, title, desc, body));
  urls.push(path);
}

const D = 'Conjugueur hébreu–français gratuit : plus de 4000 verbes conjugués avec nikoud, écriture pleine et prononciation.';
write('/', 'index.html', 'Bescherelle hébreu – conjugaison des verbes hébreux en français', D, renderHome(ctx));
write('/binyanim', 'binyanim.html', 'Les binyanim et gizrot | Bescherelle hébreu', 'Les 7 binyanim de l’hébreu et leurs modèles de conjugaison, avec exemples.', renderBinyanim(ctx));
write('/a-propos', 'a-propos.html', 'À propos | Bescherelle hébreu', 'Sources, licences et fonctionnalités du Bescherelle hébreu.', renderAbout(ctx));
write('/liste', 'liste.html', 'Liste des verbes hébreux | Bescherelle hébreu', 'Liste alphabétique des verbes hébreux conjugués, filtrable par binyan et gizra.', renderList(ctx, new URLSearchParams()));

for (const v of verbs) {
  write(`/verbe/${v.id}`, `verbe/${v.id}.html`, pageTitle(v), pageDescription(v), renderVerb(v, ctx, [], examples[v.id]));
}
for (const key of ctx.byRoot!.keys()) {
  if (!key) continue;
  const n = ctx.byRoot!.get(key)!.length;
  write(`/racine/${key}`, `racine/${key}.html`, `Racine ${key} – verbes hébreux | Bescherelle hébreu`,
    `${n} verbe${n > 1 ? 's' : ''} hébreu${n > 1 ? 'x' : ''} de la racine ${key}, avec conjugaison complète et traduction française.`, renderRoot(key, ctx));
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE + encodeURI(u))}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);

const hash = createHash('sha256').update(raw).update(readdirSync(join(dist, 'assets')).join()).digest('hex').slice(0, 12);
const sw = join(dist, 'sw.js');
writeFileSync(sw, readFileSync(sw, 'utf8').replace('__VERSION__', hash));

console.log(`prerendered ${urls.length} pages (sw ${hash})`);
