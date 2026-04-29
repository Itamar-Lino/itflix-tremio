const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── URL da lista de filmes ────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.0.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes e séries em HD com o addon ITFLIXHD para Stremio.',
  logo: 'https://logowik.com/content/uploads/images/iflix7255.jpg',
  background: 'https://i.imgur.com/mEHGqaJ.jpg',
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'itflixhd-movies',
      name: 'ITFLIXHD – Filmes',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'itflixhd-series',
      name: 'ITFLIXHD – Séries',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['tt'],
  behaviorHints: { adult: false, p2p: false },
};

// ── Cache da lista ────────────────────────────────────────────────────────────
let cachedFilmes = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getFilmes() {
  const now = Date.now();
  if (cachedFilmes && now - lastFetch < CACHE_TTL) {
    return cachedFilmes;
  }

  try {
    const res = await fetch(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Suporta tanto array direto quanto { filmes: [...] } ou { movies: [...] }
    cachedFilmes = Array.isArray(data)
      ? data
      : data.filmes || data.movies || data.items || [];
    lastFetch = now;
    console.log(`✅ Lista carregada: ${cachedFilmes.length} item(s) do GitHub`);
  } catch (err) {
    console.error('❌ Erro ao buscar lista do GitHub:', err.message);
    cachedFilmes = cachedFilmes || []; // mantém cache antigo se existir
  }

  return cachedFilmes;
}

// ── Normaliza um item da lista para o formato Stremio ─────────────────────────
function normalizeItem(item) {
  return {
    id: item.id || item.imdb_id || item.imdbId || '',
    type: item.type || 'movie',
    name: item.name || item.title || item.titulo || '',
    poster: item.poster || item.poster_url || item.posterUrl || '',
    genres: item.genres || item.generos || [],
    description: item.description || item.descricao || item.overview || '',
    releaseInfo: String(item.releaseInfo || item.year || item.ano || ''),
    imdbRating: String(item.imdbRating || item.rating || ''),
    background: item.background || item.backdrop || '',
    logo: item.logo || '',
    // Streams embutidos na lista (campo streams, url ou magnet)
    _streams: item.streams || item.videos || null,
    _url: item.url || item.stream || item.link || null,
    _magnet: item.magnet || null,
  };
}

const builder = new addonBuilder(manifest);

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = extra && extra.search ? extra.search.toLowerCase() : null;
  const rawList = await getFilmes();

  let items = rawList
    .map(normalizeItem)
    .filter(m => m.type === type && m.id);

  if (search) {
    items = items.filter(m => m.name.toLowerCase().includes(search));
  }

  // Remove campos internos antes de enviar
  const metas = items.map(({ _streams, _url, _magnet, ...rest }) => rest);

  return { metas };
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  const rawList = await getFilmes();
  const all = rawList.map(normalizeItem);
  const found = all.find(m => m.id === id && m.type === type);

  if (!found) return { meta: null };

  const { _streams, _url, _magnet, ...meta } = found;
  return { meta };
});

// ── Handler: Streams ──────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
  const rawList = await getFilmes();
  const all = rawList.map(normalizeItem);
  const item = all.find(m => m.id === id);

  const streams = [];

  if (item) {
    // 1. Streams embutidos no JSON ({ streams: [ { name, url }, ... ] })
    if (Array.isArray(item._streams) && item._streams.length > 0) {
      item._streams.forEach(s => {
        streams.push({
          name: s.name || 'ITFLIXHD',
          description: s.description || s.quality || '🎬',
          url: s.url || s.link,
          behaviorHints: { notWebReady: false },
        });
      });
    }

    // 2. URL direta no item
    if (item._url) {
      streams.push({
        name: 'ITFLIXHD',
        description: '🎬 Stream',
        url: item._url,
        behaviorHints: { notWebReady: false },
      });
    }

    // 3. Magnet link
    if (item._magnet) {
      streams.push({
        name: 'ITFLIXHD · Torrent',
        description: '🧲 Magnet',
        infoHash: item._magnet.replace('magnet:?xt=urn:btih:', '').split('&')[0],
        behaviorHints: { notWebReady: false },
      });
    }
  }

  // Fallback de demonstração caso não haja streams na lista
  if (streams.length === 0) {
    streams.push(
      {
        name: 'ITFLIXHD · Demo 1080p',
        description: '🎬 Full HD (demo)',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        behaviorHints: { notWebReady: false },
      },
      {
        name: 'ITFLIXHD · Demo 720p',
        description: '📺 HD (demo)',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        behaviorHints: { notWebReady: false },
      },
    );
  }

  return { streams };
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

// Pré-aquece o cache antes de subir o servidor
getFilmes().then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD Addon rodando em http://localhost:${PORT}/manifest.json\n`);
});
