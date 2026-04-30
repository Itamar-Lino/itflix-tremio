const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── Configurações ─────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

const TMDB_API_KEY = 'c311ad203b7db4a3bf1e1275ecdf41de';
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TMDB_POSTER  = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACK    = 'https://image.tmdb.org/t/p/w1280';

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
  // Responde tanto a IDs próprios quanto a IDs do IMDB (tt...)
  idPrefixes: ['itflixhd_', 'tt'],
  behaviorHints: { adult: false, p2p: true },
};

// ── Cache de streams ──────────────────────────────────────────────────────────
let cachedStreams = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getStreams() {
  const now = Date.now();
  if (cachedStreams && now - lastFetch < CACHE_TTL) return cachedStreams;

  try {
    const res = await fetch(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedStreams = Array.isArray(data) ? data : (data.streams || []);
    lastFetch = now;
    console.log(`✅ Lista carregada: ${cachedStreams.length} stream(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar lista:', err.message);
    cachedStreams = cachedStreams || [];
  }

  return cachedStreams;
}

// ── Cache de metadados TMDB ───────────────────────────────────────────────────
const tmdbCache = {};

async function getTmdbMeta(tmdbId) {
  if (tmdbCache[tmdbId]) return tmdbCache[tmdbId];

  try {
    const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const data = await res.json();

    tmdbCache[tmdbId] = {
      poster:      data.poster_path   ? `${TMDB_POSTER}${data.poster_path}`  : null,
      background:  data.backdrop_path ? `${TMDB_BACK}${data.backdrop_path}`  : null,
      description: data.overview      || '',
      rating:      data.vote_average  ? String(data.vote_average.toFixed(1)) : '',
      genres:      (data.genres || []).map(g => g.name),
      runtime:     data.runtime       || null,
      imdbId:      data.imdb_id       || null,
    };

    console.log(`🎬 TMDB carregado: ${tmdbId}`);
  } catch (err) {
    console.error(`⚠️  Erro TMDB (${tmdbId}):`, err.message);
    tmdbCache[tmdbId] = {};
  }

  return tmdbCache[tmdbId];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseStreamTitle(stream) {
  const raw = stream.title || stream.name || 'Sem título';
  const nameMatch = raw.match(/^([^·(]+)/);
  const name = nameMatch ? nameMatch[1].trim() : raw.trim();
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  return { name, year, fullTitle: raw };
}

function streamId(stream) {
  return stream.infoHash
    ? stream.infoHash.toLowerCase()
    : Buffer.from(stream.title || stream.name || '').toString('hex').slice(0, 40);
}

// Busca stream pelo imdbId na lista
function findByImdbId(streams, imdbId) {
  return streams.find(s => s.imdbId && s.imdbId === imdbId);
}

// Busca stream pelo infoHash/id próprio
function findByInternalId(streams, rawId) {
  return streams.find(s => streamId(s) === rawId);
}

// ── Builder ───────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ extra }) => {
  const streams = await getStreams();
  const search = extra?.search?.toLowerCase() || null;

  const metas = await Promise.all(
    streams
      .filter(s => !search || (s.title || s.name || '').toLowerCase().includes(search))
      .map(async (stream) => {
        const { name, year, fullTitle } = parseStreamTitle(stream);
        const id = `itflixhd_${streamId(stream)}`;

        let poster = null;
        if (stream.tmdbId) {
          const tmdb = await getTmdbMeta(stream.tmdbId);
          poster = tmdb.poster;
        }

        return {
          id,
          type: 'movie',
          name,
          description: fullTitle,
          releaseInfo: year,
          poster: poster || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
        };
      })
  );

  return { metas };
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const streams = await getStreams();
  const rawId = id.replace('itflixhd_', '');

  // Busca por ID interno ou por IMDB ID
  const stream = rawId.startsWith('tt')
    ? findByImdbId(streams, rawId)
    : findByInternalId(streams, rawId);

  if (!stream) return { meta: null };

  const { name, year, fullTitle } = parseStreamTitle(stream);
  const sid = `itflixhd_${streamId(stream)}`;

  let tmdb = {};
  if (stream.tmdbId) tmdb = await getTmdbMeta(stream.tmdbId);

  return {
    meta: {
      id:          sid,
      type:        'movie',
      name,
      description: tmdb.description || fullTitle,
      releaseInfo: year,
      poster:      tmdb.poster      || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
      background:  tmdb.background  || null,
      imdbRating:  tmdb.rating      || null,
      genres:      tmdb.genres      || [],
      runtime:     tmdb.runtime     || null,
    },
  };
});

// ── Handler: Stream ───────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const streams = await getStreams();
  const rawId = id.replace('itflixhd_', '');

  // Busca por IMDB ID (tt...) ou por ID interno
  const stream = rawId.startsWith('tt')
    ? findByImdbId(streams, rawId)
    : findByInternalId(streams, rawId);

  if (!stream || !stream.infoHash) return { streams: [] };

  const { fullTitle } = parseStreamTitle(stream);

  return {
    streams: [
      {
        name:    stream.name || 'ITFLIXHD',
        title:   fullTitle,
        infoHash: stream.infoHash.toLowerCase(),
        fileIdx:  stream.fileIdx ?? 0,
        sources:  stream.sources || [],
        behaviorHints: { notWebReady: false },
      },
    ],
  };
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

getStreams().then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD rodando em http://localhost:${PORT}/manifest.json\n`);
});