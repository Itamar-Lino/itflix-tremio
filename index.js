const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── Configurações ─────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

const SERIES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/series.json';

const TMDB_API_KEY = 'c311ad203b7db4a3bf1e1275ecdf41de';
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TMDB_POSTER  = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACK    = 'https://image.tmdb.org/t/p/w1280';

// TTL mais longo: re-fetch a cada 30 min (lista muda pouco)
const CACHE_TTL    = 30 * 60 * 1000;
// Timeout para qualquer fetch externo (5 s)
const FETCH_TIMEOUT = 5_000;

// Trackers adicionais para mais peers e velocidade
const DEFAULT_TRACKERS = [
  'tracker:udp://tracker.openbittorrent.com:80/announce',
  'tracker:udp://tracker.opentrackr.org:1337/announce',
  'tracker:udp://open.stealth.si:80/announce',
  'tracker:udp://tracker.torrent.eu.org:451/announce',
  'tracker:udp://tracker.dler.org:6969/announce',
  'tracker:udp://exodus.desync.com:6969/announce',
  'tracker:udp://tracker.moeking.me:6969/announce',
  'tracker:udp://movies.zsw.ca:6969/announce',
  'tracker:https://tracker.gbitt.info/announce',
  'tracker:https://tracker.tamersunion.org:443/announce',
];

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.2.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes e séries em HD com o addon ITFLIXHD para Stremio.',
  logo: 'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/itflix.png',
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
  idPrefixes: ['itflixhd_', 'tt'],
  behaviorHints: { adult: false, p2p: true },
};

// ── Fetch com timeout ─────────────────────────────────────────────────────────
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Cache de filmes ───────────────────────────────────────────────────────────
let cachedMovies    = null;
let lastMovieFetch  = 0;

async function getMovies() {
  const now = Date.now();
  if (cachedMovies && now - lastMovieFetch < CACHE_TTL) return cachedMovies;

  try {
    const res = await fetchWithTimeout(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedMovies = Array.isArray(data) ? data : (data.streams || []);
    lastMovieFetch = now;
    console.log(`✅ Filmes carregados: ${cachedMovies.length}`);
  } catch (err) {
    console.error('❌ Erro ao carregar filmes:', err.message);
    cachedMovies = cachedMovies || [];
  }

  return cachedMovies;
}

// ── Cache de séries ───────────────────────────────────────────────────────────
let cachedSeries    = null;
let lastSeriesFetch = 0;

async function getSeriesStreams() {
  const now = Date.now();
  if (cachedSeries && now - lastSeriesFetch < CACHE_TTL) return cachedSeries;

  try {
    const res = await fetchWithTimeout(SERIES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedSeries = Array.isArray(data) ? data : (data.streams || []);
    lastSeriesFetch = now;
    console.log(`✅ Séries carregadas: ${cachedSeries.length} stream(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar séries:', err.message);
    cachedSeries = cachedSeries || [];
  }

  return cachedSeries;
}

// ── Agrupar séries por imdbId ─────────────────────────────────────────────────
function groupSeriesByImdb(streams) {
  const map = {};
  for (const s of streams) {
    const imdbId = s.imdbId;
    if (!imdbId) continue;
    if (!map[imdbId]) {
      const seriesName = extractSeriesName(s.title || s.name || '');
      map[imdbId] = { imdbId, seriesName, streams: [] };
    }
    map[imdbId].streams.push(s);
  }
  return map;
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function extractSeriesName(raw) {
  const match = raw.match(/^(.+?)\s+[Ss]\d{2}[Ee]\d{2}/);
  return match ? match[1].trim() : raw.trim();
}

function parseEpisodeInfo(raw) {
  const match = raw.match(/[Ss](\d{2})[Ee](\d{2})/);
  if (match) return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  return { season: 1, episode: 1 };
}

function parseStreamTitle(stream) {
  const raw = stream.title || stream.name || 'Sem título';
  const nameMatch = raw.match(/^([^·(]+)/);
  const name = nameMatch ? nameMatch[1].trim() : raw.trim();
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  return { name, year, fullTitle: raw };
}

function streamId(stream) {
  const base = stream.infoHash
    ? stream.infoHash.toLowerCase()
    : Buffer.from(stream.title || stream.name || '').toString('hex').slice(0, 40);
  const idx = stream.fileIdx !== undefined ? stream.fileIdx : 0;
  return `${base}_${idx}`;
}

function findByImdbId(streams, imdbId) {
  return streams.find(s => s.imdbId && s.imdbId === imdbId);
}

function findByInternalId(streams, rawId) {
  return streams.find(s => streamId(s) === rawId);
}

// Mescla trackers do JSON com os padrões, sem duplicar
function mergeTrackers(sources) {
  const existing = new Set(sources || []);
  for (const t of DEFAULT_TRACKERS) {
    existing.add(t);
  }
  return [...existing];
}

// ── Cache TMDB em memória (com TTL próprio de 24 h) ───────────────────────────
const tmdbCache   = {};
const TMDB_TTL    = 24 * 60 * 60 * 1000; // 24 horas

async function getTmdbByImdb(imdbId, mediaType = 'movie') {
  const key = `${mediaType}_${imdbId}`;
  const cached = tmdbCache[key];
  if (cached && Date.now() - cached.ts < TMDB_TTL) return cached.data;

  try {
    // Busca pelo IMDB ID direto (funciona para filme e série)
    const findUrl = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&external_source=imdb_id`;
    const res = await fetchWithTimeout(findUrl);
    if (!res.ok) throw new Error(`TMDB find HTTP ${res.status}`);
    const findData = await res.json();

    const result = mediaType === 'movie'
      ? (findData.movie_results || [])[0]
      : (findData.tv_results    || [])[0];

    if (!result) {
      tmdbCache[key] = { ts: Date.now(), data: {} };
      return {};
    }

    const data = {
      poster:      result.poster_path   ? `${TMDB_POSTER}${result.poster_path}`  : null,
      background:  result.backdrop_path ? `${TMDB_BACK}${result.backdrop_path}`  : null,
      description: result.overview      || '',
      rating:      result.vote_average  ? String(result.vote_average.toFixed(1)) : '',
      name:        result.title || result.name || result.original_title || result.original_name || '',
      year:        (result.release_date || result.first_air_date || '').slice(0, 4),
    };

    tmdbCache[key] = { ts: Date.now(), data };
    console.log(`🎬 TMDB ${mediaType} carregado: ${imdbId} → ${data.name}`);
    return data;
  } catch (err) {
    console.error(`⚠️  Erro TMDB (${imdbId}):`, err.message);
    tmdbCache[key] = { ts: Date.now(), data: {} };
    return {};
  }
}

// ── Builder ───────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = extra?.search?.toLowerCase() || null;

  // ── Catálogo de Filmes ──
  if (type === 'movie' && id === 'itflixhd-movies') {
    const streams = await getMovies();

    const filtered = streams.filter(s =>
      !search || (s.title || s.name || '').toLowerCase().includes(search)
    );

    // Busca TMDB em paralelo com limite de concorrência (5 por vez)
    const metas = await pMap(filtered, async (stream) => {
      const { name, year, fullTitle } = parseStreamTitle(stream);
      const sid = `itflixhd_${streamId(stream)}`;

      // Prefere imdbId para buscar no TMDB (mais confiável que tmdbId)
      let tmdb = {};
      if (stream.imdbId) {
        tmdb = await getTmdbByImdb(stream.imdbId, 'movie');
      } else if (stream.tmdbId) {
        // Fallback: busca direto pelo tmdbId se não houver imdbId
        tmdb = await getTmdbByImdb(stream.tmdbId, 'movie');
      }

      return {
        id:          sid,
        type:        'movie',
        name:        tmdb.name  || name,
        description: tmdb.description || fullTitle,
        releaseInfo: tmdb.year  || year,
        poster:      tmdb.poster || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
        background:  tmdb.background || null,
        imdbRating:  tmdb.rating || null,
      };
    }, 5);

    return { metas };
  }

  // ── Catálogo de Séries ──
  if (type === 'series' && id === 'itflixhd-series') {
    const streams = await getSeriesStreams();
    const grouped = groupSeriesByImdb(streams);

    const filtered = Object.values(grouped).filter(serie =>
      !search || serie.seriesName.toLowerCase().includes(search)
    );

    const metas = await pMap(filtered, async (serie) => {
      const tmdb = await getTmdbByImdb(serie.imdbId, 'series');
      return {
        id:          serie.imdbId,
        type:        'series',
        name:        tmdb.name        || serie.seriesName,
        description: tmdb.description || '',
        poster:      tmdb.poster      || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(serie.seriesName)}`,
        background:  tmdb.background  || null,
        imdbRating:  tmdb.rating      || null,
      };
    }, 5);

    return { metas };
  }

  return { metas: [] };
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  // ── Meta de Filmes ──
  if (type === 'movie') {
    const streams = await getMovies();
    const rawId = id.replace('itflixhd_', '');

    const stream = rawId.startsWith('tt')
      ? findByImdbId(streams, rawId)
      : findByInternalId(streams, rawId);

    if (!stream) return { meta: null };

    const { name, year, fullTitle } = parseStreamTitle(stream);
    const sid  = `itflixhd_${streamId(stream)}`;
    const tmdb = stream.imdbId ? await getTmdbByImdb(stream.imdbId, 'movie') : {};

    return {
      meta: {
        id:          sid,
        type:        'movie',
        name:        tmdb.name        || name,
        description: tmdb.description || fullTitle,
        releaseInfo: tmdb.year        || year,
        poster:      tmdb.poster      || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
        background:  tmdb.background  || null,
        imdbRating:  tmdb.rating      || null,
      },
    };
  }

  // ── Meta de Séries ──
  if (type === 'series') {
    const allStreams = await getSeriesStreams();
    const grouped   = groupSeriesByImdb(allStreams);
    const imdbId    = id.startsWith('tt') ? id : null;
    const serie     = imdbId ? grouped[imdbId] : null;

    if (!serie) return { meta: null };

    const tmdb = await getTmdbByImdb(serie.imdbId, 'series');

    const videos = serie.streams.map(s => {
      const { season, episode } = parseEpisodeInfo(s.title || s.name || '');
      return {
        id:       `${serie.imdbId}:${season}:${episode}`,
        title:    s.title || s.name,
        season,
        episode,
        released: new Date(0).toISOString(),
      };
    });

    videos.sort((a, b) => a.season - b.season || a.episode - b.episode);

    return {
      meta: {
        id:          serie.imdbId,
        type:        'series',
        name:        tmdb.name        || serie.seriesName,
        description: tmdb.description || '',
        poster:      tmdb.poster      || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(serie.seriesName)}`,
        background:  tmdb.background  || null,
        imdbRating:  tmdb.rating      || null,
        videos,
      },
    };
  }

  return { meta: null };
});

// ── Handler: Stream ───────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
  // ── Stream de Filmes ──
  if (type === 'movie') {
    const streams = await getMovies();
    const rawId   = id.replace('itflixhd_', '');

    const stream = rawId.startsWith('tt')
      ? findByImdbId(streams, rawId)
      : findByInternalId(streams, rawId);

    if (!stream || !stream.infoHash) return { streams: [] };

    const { fullTitle } = parseStreamTitle(stream);

    return {
      streams: [
        {
          name:     stream.name || 'ITFLIXHD',
          title:    fullTitle,
          infoHash: stream.infoHash.toLowerCase(),
          fileIdx:  stream.fileIdx ?? 0,
          // Mescla trackers do JSON com os trackers padrão
          sources:  mergeTrackers(stream.sources),
          // SEM behaviorHints.notWebReady para não bloquear reprodução web
        },
      ],
    };
  }

  // ── Stream de Séries ──
  // id formato: "tt30217403:1:1"
  if (type === 'series') {
    const parts = id.split(':');
    if (parts.length < 3) return { streams: [] };

    const [imdbId, seasonStr, episodeStr] = parts;
    const season  = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    const allStreams = await getSeriesStreams();

    const matched = allStreams.filter(s => {
      if (s.imdbId !== imdbId) return false;
      const ep = parseEpisodeInfo(s.title || s.name || '');
      return ep.season === season && ep.episode === episode;
    });

    if (!matched.length) return { streams: [] };

    return {
      streams: matched.map(s => ({
        name:    s.name || 'ITFLIXHD',
        title:   s.title || s.name,
        infoHash: s.infoHash.toLowerCase(),
        fileIdx:  s.fileIdx ?? 0,
        sources:  mergeTrackers(s.sources),
        // SEM behaviorHints.notWebReady
      })),
    };
  }

  return { streams: [] };
});

// ── Utilitário: pMap (Promise.all com limite de concorrência) ─────────────────
// Evita fazer centenas de requests simultâneos ao TMDB
async function pMap(items, fn, concurrency = 5) {
  const results = [];
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    i += concurrency;
  }
  return results;
}

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

Promise.all([getMovies(), getSeriesStreams()]).then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD rodando em http://localhost:${PORT}/manifest.json\n`);
});
