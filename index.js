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

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.1.0',
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

// ── Cache de filmes ───────────────────────────────────────────────────────────
let cachedMovies = null;
let lastMovieFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getMovies() {
  const now = Date.now();
  if (cachedMovies && now - lastMovieFetch < CACHE_TTL) return cachedMovies;

  try {
    const res = await fetch(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedMovies = Array.isArray(data) ? data : (data.streams || []);
    lastMovieFetch = now;
    console.log(`✅ Filmes carregados: ${cachedMovies.length} item(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar filmes:', err.message);
    cachedMovies = cachedMovies || [];
  }

  return cachedMovies;
}

// ── Cache de séries ───────────────────────────────────────────────────────────
let cachedSeries = null;
let lastSeriesFetch = 0;

async function getSeriesStreams() {
  const now = Date.now();
  if (cachedSeries && now - lastSeriesFetch < CACHE_TTL) return cachedSeries;

  try {
    const res = await fetch(SERIES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Aceita { streams: [...] } ou array direto
    cachedSeries = Array.isArray(data) ? data : (data.streams || []);
    lastSeriesFetch = now;
    console.log(`✅ Séries carregadas: ${cachedSeries.length} stream(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar séries:', err.message);
    cachedSeries = cachedSeries || [];
  }

  return cachedSeries;
}

// ── Agrupa streams de séries por imdbId (série única) ─────────────────────────
// Retorna um map: imdbId -> { imdbId, title (nome da série), streams[] }
function groupSeriesByImdb(streams) {
  const map = {};
  for (const s of streams) {
    const imdbId = s.imdbId;
    if (!imdbId) continue;

    if (!map[imdbId]) {
      // Extrai nome da série a partir do título do episódio (antes de SxxExx)
      const seriesName = extractSeriesName(s.title || s.name || '');
      map[imdbId] = { imdbId, seriesName, streams: [] };
    }
    map[imdbId].streams.push(s);
  }
  return map;
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function extractSeriesName(raw) {
  // "Dan Da Dan S01E01 · Dual Áudio · 2.0" → "Dan Da Dan"
  const match = raw.match(/^(.+?)\s+[Ss]\d{2}[Ee]\d{2}/);
  return match ? match[1].trim() : raw.trim();
}

function parseEpisodeInfo(raw) {
  // Extrai season e episode do título
  const match = raw.match(/[Ss](\d{2})[Ee](\d{2})/);
  if (match) {
    return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  }
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

// ── Cache de metadados TMDB ───────────────────────────────────────────────────
const tmdbCache = {};

async function getTmdbMovieMeta(tmdbId) {
  const key = `movie_${tmdbId}`;
  if (tmdbCache[key]) return tmdbCache[key];

  try {
    const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const data = await res.json();

    tmdbCache[key] = {
      poster:      data.poster_path   ? `${TMDB_POSTER}${data.poster_path}`  : null,
      background:  data.backdrop_path ? `${TMDB_BACK}${data.backdrop_path}`  : null,
      description: data.overview      || '',
      rating:      data.vote_average  ? String(data.vote_average.toFixed(1)) : '',
      genres:      (data.genres || []).map(g => g.name),
      runtime:     data.runtime       || null,
      imdbId:      data.imdb_id       || null,
    };

    console.log(`🎬 TMDB (filme) carregado: ${tmdbId}`);
  } catch (err) {
    console.error(`⚠️  Erro TMDB filme (${tmdbId}):`, err.message);
    tmdbCache[key] = {};
  }

  return tmdbCache[key];
}

async function getTmdbSeriesMeta(imdbId) {
  const key = `series_${imdbId}`;
  if (tmdbCache[key]) return tmdbCache[key];

  try {
    // Busca pelo IMDB ID na API TMDB
    const findUrl = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&external_source=imdb_id`;
    const findRes = await fetch(findUrl);
    if (!findRes.ok) throw new Error(`TMDB find HTTP ${findRes.status}`);
    const findData = await findRes.json();

    const tvResult = (findData.tv_results || [])[0];
    if (!tvResult) {
      tmdbCache[key] = {};
      return tmdbCache[key];
    }

    tmdbCache[key] = {
      poster:      tvResult.poster_path   ? `${TMDB_POSTER}${tvResult.poster_path}`  : null,
      background:  tvResult.backdrop_path ? `${TMDB_BACK}${tvResult.backdrop_path}`  : null,
      description: tvResult.overview      || '',
      rating:      tvResult.vote_average  ? String(tvResult.vote_average.toFixed(1)) : '',
      name:        tvResult.name          || tvResult.original_name || '',
    };

    console.log(`📺 TMDB (série) carregado: ${imdbId}`);
  } catch (err) {
    console.error(`⚠️  Erro TMDB série (${imdbId}):`, err.message);
    tmdbCache[key] = {};
  }

  return tmdbCache[key];
}

// ── Builder ───────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Handler: Catálogo de Filmes ───────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = extra?.search?.toLowerCase() || null;

  // ── Catálogo de Filmes ──
  if (type === 'movie' && id === 'itflixhd-movies') {
    const streams = await getMovies();

    const metas = await Promise.all(
      streams
        .filter(s => !search || (s.title || s.name || '').toLowerCase().includes(search))
        .map(async (stream) => {
          const { name, year, fullTitle } = parseStreamTitle(stream);
          const sid = `itflixhd_${streamId(stream)}`;

          let poster = null;
          if (stream.tmdbId) {
            const tmdb = await getTmdbMovieMeta(stream.tmdbId);
            poster = tmdb.poster;
          }

          return {
            id:          sid,
            type:        'movie',
            name,
            description: fullTitle,
            releaseInfo: year,
            poster:      poster || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
          };
        })
    );

    return { metas };
  }

  // ── Catálogo de Séries ──
  if (type === 'series' && id === 'itflixhd-series') {
    const streams = await getSeriesStreams();
    const grouped = groupSeriesByImdb(streams);

    const metas = await Promise.all(
      Object.values(grouped)
        .filter(serie => !search || serie.seriesName.toLowerCase().includes(search))
        .map(async (serie) => {
          const tmdb = await getTmdbSeriesMeta(serie.imdbId);

          return {
            id:          serie.imdbId,
            type:        'series',
            name:        tmdb.name || serie.seriesName,
            description: tmdb.description || '',
            poster:      tmdb.poster || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(serie.seriesName)}`,
            background:  tmdb.background || null,
          };
        })
    );

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
    const sid = `itflixhd_${streamId(stream)}`;

    let tmdb = {};
    if (stream.tmdbId) tmdb = await getTmdbMovieMeta(stream.tmdbId);

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
  }

  // ── Meta de Séries ──
  if (type === 'series') {
    const allStreams = await getSeriesStreams();
    const grouped = groupSeriesByImdb(allStreams);

    // id pode ser imdbId direto (tt...) ou itflixhd_...
    const imdbId = id.startsWith('tt') ? id : null;
    const serie = imdbId ? grouped[imdbId] : null;

    if (!serie) return { meta: null };

    const tmdb = await getTmdbSeriesMeta(serie.imdbId);

    // Monta os vídeos (episódios) para o Stremio
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

    // Ordena por temporada e episódio
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
    const rawId = id.replace('itflixhd_', '');

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
          sources:  stream.sources || [],
          behaviorHints: { notWebReady: false },
        },
      ],
    };
  }

  // ── Stream de Séries ──
  // id formato: "tt30217403:1:1" (imdbId:season:episode)
  if (type === 'series') {
    const parts = id.split(':');
    // Suporte tanto "tt30217403:1:1" quanto "tt30217403"
    if (parts.length < 3) return { streams: [] };

    const [imdbId, seasonStr, episodeStr] = parts;
    const season  = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    const allStreams = await getSeriesStreams();

    // Filtra streams que correspondem ao imdbId + temporada + episódio
    const matched = allStreams.filter(s => {
      if (s.imdbId !== imdbId) return false;
      const ep = parseEpisodeInfo(s.title || s.name || '');
      return ep.season === season && ep.episode === episode;
    });

    if (!matched.length) return { streams: [] };

    return {
      streams: matched.map(s => ({
        name:     s.name || 'ITFLIXHD',
        title:    s.title || s.name,
        infoHash: s.infoHash.toLowerCase(),
        fileIdx:  s.fileIdx ?? 0,
        sources:  s.sources || [],
        behaviorHints: { notWebReady: false },
      })),
    };
  }

  return { streams: [] };
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

Promise.all([getMovies(), getSeriesStreams()]).then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD rodando em http://localhost:${PORT}/manifest.json\n`);
});