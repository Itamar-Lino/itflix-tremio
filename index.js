const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── URL da lista ──────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

// ── Base do poster TMDB ───────────────────────────────────────────────────────
const TMDB_POSTER = 'https://image.tmdb.org/t/p/w500';

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.0.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes em HD com o addon ITFLIXHD para Stremio.',
  logo: 'https://logowik.com/content/uploads/images/iflix7255.jpg',
  background: 'https://i.imgur.com/mEHGqaJ.jpg',
  types: ['movie'],
  catalogs: [
    {
      type: 'movie',
      id: 'itflixhd-movies',
      name: 'ITFLIXHD – Filmes',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['itflixhd_'],
  behaviorHints: { adult: false, p2p: true },
};

// ── Cache ─────────────────────────────────────────────────────────────────────
let cachedFilmes = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getFilmes() {
  const now = Date.now();
  if (cachedFilmes && now - lastFetch < CACHE_TTL) return cachedFilmes;

  try {
    const res = await fetch(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedFilmes = await res.json();
    lastFetch = now;
    console.log(`✅ Lista carregada: ${cachedFilmes.length} filme(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar lista:', err.message);
    cachedFilmes = cachedFilmes || [];
  }

  return cachedFilmes;
}

// ── Extrai infoHash do magnet link ────────────────────────────────────────────
function extractInfoHash(magnet) {
  if (!magnet) return null;
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
}

// ── Converte item do JSON → meta do Stremio ───────────────────────────────────
function toMeta(item) {
  return {
    id: `itflixhd_${item.id}`,
    type: 'movie',
    name: item.title,
    poster: item.poster_path ? `${TMDB_POSTER}${item.poster_path}` : '',
    releaseInfo: String(item.year || ''),
    imdbRating: item.vote_average ? String(item.vote_average) : '',
  };
}

const builder = new addonBuilder(manifest);

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ extra }) => {
  const filmes = await getFilmes();
  const search = extra?.search?.toLowerCase() || null;

  let metas = filmes.map(toMeta);

  if (search) {
    metas = metas.filter(m => m.name.toLowerCase().includes(search));
  }

  return { metas };
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const filmes = await getFilmes();
  const rawId = id.replace('itflixhd_', '');
  const item = filmes.find(f => String(f.id) === rawId);

  if (!item) return { meta: null };

  return { meta: toMeta(item) };
});

// ── Handler: Stream ───────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const filmes = await getFilmes();
  const rawId = id.replace('itflixhd_', '');
  const item = filmes.find(f => String(f.id) === rawId);

  if (!item || !item.video_link) {
    return { streams: [] };
  }

  const infoHash = extractInfoHash(item.video_link);

  if (!infoHash) {
    console.warn(`⚠️  Magnet inválido para: ${item.title}`);
    return { streams: [] };
  }

  return {
    streams: [
      {
        name: 'ITFLIXHD',
        description: `🧲 ${item.title} (${item.year})`,
        infoHash,
        behaviorHints: { notWebReady: false },
      },
    ],
  };
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

getFilmes().then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD rodando em http://localhost:${PORT}/manifest.json\n`);
});
