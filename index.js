const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── Configurações ─────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

const SERIES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/series.json';

const TMDB_API_KEY  = 'c311ad203b7db4a3bf1e1275ecdf41de';
const TMDB_BASE     = 'https://api.themoviedb.org/3';
const TMDB_POSTER   = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACK     = 'https://image.tmdb.org/t/p/w1280';

const CACHE_TTL     = 30 * 60 * 1000;
const TMDB_TTL      = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 7_000;

// ── Real-Debrid ───────────────────────────────────────────────────────────────
const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

// Extrai a API key do Real-Debrid da config (passada via URL como ?rd=XXXXX)
function getRdKey(config) {
  return (config && config.rd) ? config.rd.trim() : null;
}

// Verifica se a API key é válida
async function rdCheckToken(apiKey) {
  try {
    const res = await fetchWithTimeout(
      `${RD_BASE}/user`,
      5000,
      1,
      { Authorization: `Bearer ${apiKey}` }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Adiciona um magnet no Real-Debrid e aguarda ficar "downloaded"
async function rdAddMagnet(apiKey, infoHash, sources) {
  const trackers = (sources || [])
    .filter(s => s.startsWith('tracker:'))
    .map(s => s.replace('tracker:', ''))
    .join('&tr=');

  const magnet = `magnet:?xt=urn:btih:${infoHash}${trackers ? '&tr=' + trackers : ''}`;

  // 1. Adiciona o magnet
  const addRes = await fetchWithTimeout(`${RD_BASE}/torrents/addMagnet`, 10_000, 1, {
    Authorization: `Bearer ${apiKey}`,
  }, {
    method: 'POST',
    body: new URLSearchParams({ magnet }),
  });
  if (!addRes.ok) throw new Error(`RD addMagnet HTTP ${addRes.status}`);
  const { id: torrentId } = await addRes.json();
  if (!torrentId) throw new Error('RD: sem torrentId');

  // 2. Seleciona os arquivos (all)
  const selRes = await fetchWithTimeout(`${RD_BASE}/torrents/selectFiles/${torrentId}`, 8_000, 1, {
    Authorization: `Bearer ${apiKey}`,
  }, {
    method: 'POST',
    body: new URLSearchParams({ files: 'all' }),
  });
  if (!selRes.ok) console.warn(`RD selectFiles HTTP ${selRes.status}`);

  // 3. Aguarda o torrent ficar disponível (poll até 15s)
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const infoRes = await fetchWithTimeout(`${RD_BASE}/torrents/info/${torrentId}`, 8_000, 1, {
      Authorization: `Bearer ${apiKey}`,
    });
    if (!infoRes.ok) continue;
    const info = await infoRes.json();

    if (info.status === 'downloaded') {
      return info.links || [];
    }
    if (['error', 'virus', 'dead'].includes(info.status)) {
      throw new Error(`RD torrent status: ${info.status}`);
    }
  }

  throw new Error('RD: timeout aguardando download');
}

// Desbloqueia um link RD → retorna URL direta
async function rdUnrestrictLink(apiKey, link) {
  const res = await fetchWithTimeout(`${RD_BASE}/unrestrict/link`, 8_000, 1, {
    Authorization: `Bearer ${apiKey}`,
  }, {
    method: 'POST',
    body: new URLSearchParams({ link }),
  });
  if (!res.ok) throw new Error(`RD unrestrict HTTP ${res.status}`);
  const data = await res.json();
  return data.download || null;
}

// Tenta obter link direto via RD para um infoHash
// Primeiro checa o cache de torrents já adicionados
const rdTorrentCache = {};

async function rdGetStreamUrl(apiKey, infoHash, sources, fileIdx = 0) {
  try {
    // Verifica se já tem este torrent adicionado no RD
    const listRes = await fetchWithTimeout(`${RD_BASE}/torrents`, 8_000, 1, {
      Authorization: `Bearer ${apiKey}`,
    });

    if (listRes.ok) {
      const torrents = await listRes.json();
      const existing = torrents.find(t =>
        t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() &&
        t.status === 'downloaded'
      );

      if (existing) {
        // Já está no RD → busca os links
        const infoRes = await fetchWithTimeout(`${RD_BASE}/torrents/info/${existing.id}`, 8_000, 1, {
          Authorization: `Bearer ${apiKey}`,
        });
        if (infoRes.ok) {
          const info = await infoRes.json();
          const links = info.links || [];
          const link  = links[fileIdx] || links[0];
          if (link) {
            const url = await rdUnrestrictLink(apiKey, link);
            return url;
          }
        }
      }
    }

    // Ainda não está no RD → adiciona
    const links = await rdAddMagnet(apiKey, infoHash, sources);
    const link  = links[fileIdx] || links[0];
    if (!link) throw new Error('RD: sem links após adicionar');

    const url = await rdUnrestrictLink(apiKey, link);
    return url;
  } catch (err) {
    console.error(`⚠️  RD erro para ${infoHash}:`, err.message);
    return null;
  }
}

const DEFAULT_TRACKERS = [
  'tracker:udp://tracker.openbittorrent.com:80/announce',
  'tracker:udp://tracker.opentrackr.org:1337/announce',
  'tracker:udp://open.stealth.si:80/announce',
  'tracker:udp://tracker.torrent.eu.org:451/announce',
  'tracker:udp://tracker.dler.org:6969/announce',
  'tracker:udp://exodus.desync.com:6969/announce',
  'tracker:udp://tracker.moeking.me:6969/announce',
  'tracker:udp://movies.zsw.ca:6969/announce',
  'tracker:udp://tracker.tiny-vps.com:6969/announce',
  'tracker:udp://retracker01-msk-virt.corbina.net:80/announce',
  'tracker:https://tracker.gbitt.info/announce',
  'tracker:https://tracker.tamersunion.org:443/announce',
];

// ── Manifest (com configuração de Real-Debrid) ────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.4.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes e séries em HD com o addon ITFLIXHD para Stremio. Suporte a Real-Debrid.',
  logo: 'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/itflix.png',
  background: 'https://i.imgur.com/mEHGqaJ.jpg',
  types: ['movie', 'series'],
  // Configuração de Real-Debrid exposta na UI do Stremio
  config: [
    {
      key:      'rd',
      type:     'text',
      title:    '🔑 Real-Debrid API Key (opcional)',
      required: false,
    },
  ],
  catalogs: [
    {
      type: 'movie',
      id:   'itflixhd-movies',
      name: 'ITFLIXHD – Filmes',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id:   'itflixhd-series',
      name: 'ITFLIXHD – Séries',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['itflixhd_', 'tt'],
  behaviorHints: { adult: false, p2p: true },
};

// ── pMap ──────────────────────────────────────────────────────────────────────
async function pMap(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Fetch com timeout e retry ─────────────────────────────────────────────────
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT, retries = 2, headers = {}, opts = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers,
        ...opts,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ── Cache de filmes ───────────────────────────────────────────────────────────
let cachedMovies   = null;
let lastMovieFetch = 0;

async function getMovies() {
  const now = Date.now();
  if (cachedMovies && now - lastMovieFetch < CACHE_TTL) return cachedMovies;
  try {
    const res = await fetchWithTimeout(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedMovies   = Array.isArray(data) ? data : (data.streams || []);
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
    cachedSeries    = Array.isArray(data) ? data : (data.streams || []);
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
      map[imdbId] = { imdbId, seriesName: extractSeriesName(s.title || s.name || ''), streams: [] };
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
  const raw       = stream.title || stream.name || 'Sem título';
  const nameMatch = raw.match(/^([^·(]+)/);
  const name      = nameMatch ? nameMatch[1].trim() : raw.trim();
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year      = yearMatch ? yearMatch[1] : '';
  return { name, year, fullTitle: raw };
}

function parseQuality(stream) {
  const raw = stream.name || '';
  const q   = raw.match(/\d{3,4}p[^\s]*/i);
  return q ? q[0] : (raw.split(' ')[0] || 'HD');
}

function parseAudio(stream) {
  const raw = (stream.title || stream.name || '').toLowerCase();
  if (raw.includes('dual') || raw.includes('dublado')) return '🇧🇷 Dual';
  if (raw.includes('nacional') || raw.includes('português')) return '🇧🇷 Nacional';
  if (raw.includes('legendado') || raw.includes('leg.')) return '🇧🇷 Legendado';
  return '';
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

function mergeTrackers(sources) {
  const existing = new Set(sources || []);
  for (const t of DEFAULT_TRACKERS) existing.add(t);
  return [...existing];
}

// Monta objeto de stream torrent (fallback sem RD)
function buildStreamObj(s, extraHints = {}) {
  const quality = parseQuality(s);
  const audio   = parseAudio(s);
  const label   = [quality, audio].filter(Boolean).join(' · ');
  const fileIdx = typeof s.fileIdx === 'number' ? s.fileIdx : 0;

  return {
    name:     `ITFLIXHD\n${label}`,
    title:    s.title || s.name || '',
    infoHash: s.infoHash.toLowerCase(),
    fileIdx,
    sources:  mergeTrackers(s.sources),
    ...(Object.keys(extraHints).length ? { behaviorHints: extraHints } : {}),
  };
}

// Monta objeto de stream via Real-Debrid (HTTP direto)
function buildRdStreamObj(s, url, extraHints = {}) {
  const quality = parseQuality(s);
  const audio   = parseAudio(s);
  const label   = [quality, audio].filter(Boolean).join(' · ');

  return {
    name:  `⚡ RD | ITFLIXHD\n${label}`,
    title: s.title || s.name || '',
    url,
    ...(Object.keys(extraHints).length ? { behaviorHints: extraHints } : {}),
  };
}

// ── Cache TMDB ────────────────────────────────────────────────────────────────
const tmdbCache = {};

async function getTmdbByImdb(imdbId, mediaType = 'movie') {
  const key    = `${mediaType}_${imdbId}`;
  const cached = tmdbCache[key];
  if (cached && Date.now() - cached.ts < TMDB_TTL) return cached.data;

  try {
    const findUrl = `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&external_source=imdb_id`;
    const res     = await fetchWithTimeout(findUrl);
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
    console.log(`🎬 TMDB ${mediaType}: ${imdbId} → ${data.name}`);
    return data;
  } catch (err) {
    console.error(`⚠️  Erro TMDB (${imdbId}):`, err.message);
    tmdbCache[key] = { ts: Date.now(), data: {} };
    return {};
  }
}

// ── Builder ───────────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Catálogo ──────────────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = extra?.search?.toLowerCase() || null;

  if (type === 'movie' && id === 'itflixhd-movies') {
    const streams  = await getMovies();
    const filtered = streams.filter(s =>
      !search || (s.title || s.name || '').toLowerCase().includes(search)
    );
    const metas = await pMap(filtered, async (stream) => {
      const { name, year, fullTitle } = parseStreamTitle(stream);
      const sid  = `itflixhd_${streamId(stream)}`;
      const tmdb = stream.imdbId ? await getTmdbByImdb(stream.imdbId, 'movie') : {};
      return {
        id:          sid,
        type:        'movie',
        name:        tmdb.name        || name,
        description: tmdb.description || fullTitle,
        releaseInfo: tmdb.year        || year,
        poster:      tmdb.poster      || `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
        background:  tmdb.background  || null,
        imdbRating:  tmdb.rating      || null,
      };
    }, 5);
    return { metas };
  }

  if (type === 'series' && id === 'itflixhd-series') {
    const streams  = await getSeriesStreams();
    const grouped  = groupSeriesByImdb(streams);
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

// ── Meta ──────────────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (type === 'movie') {
    const streams = await getMovies();
    const rawId   = id.replace('itflixhd_', '');
    const stream  = rawId.startsWith('tt')
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

  if (type === 'series') {
    const allStreams = await getSeriesStreams();
    const grouped   = groupSeriesByImdb(allStreams);
    const imdbId    = id.startsWith('tt') ? id : null;
    const serie     = imdbId ? grouped[imdbId] : null;

    if (!serie) return { meta: null };

    const tmdb   = await getTmdbByImdb(serie.imdbId, 'series');
    const videos = serie.streams
      .map(s => {
        const { season, episode } = parseEpisodeInfo(s.title || s.name || '');
        return {
          id:       `${serie.imdbId}:${season}:${episode}`,
          title:    s.title || s.name,
          season,
          episode,
          released: new Date(0).toISOString(),
        };
      })
      .sort((a, b) => a.season - b.season || a.episode - b.episode);

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

// ── Stream ────────────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id, config }) => {
  const rdKey = getRdKey(config);

  if (type === 'movie') {
    const streams = await getMovies();
    const rawId   = id.replace('itflixhd_', '');
    const stream  = rawId.startsWith('tt')
      ? findByImdbId(streams, rawId)
      : findByInternalId(streams, rawId);

    if (!stream || !stream.infoHash) return { streams: [] };

    const result = [];

    // Tenta Real-Debrid primeiro
    if (rdKey) {
      console.log(`🔑 RD: tentando desbloquear ${stream.infoHash}`);
      const rdUrl = await rdGetStreamUrl(
        rdKey,
        stream.infoHash,
        mergeTrackers(stream.sources),
        typeof stream.fileIdx === 'number' ? stream.fileIdx : 0
      );
      if (rdUrl) {
        console.log(`✅ RD: stream obtido para ${stream.infoHash}`);
        result.push(buildRdStreamObj(stream, rdUrl));
      } else {
        console.warn(`⚠️  RD: falhou, usando torrent como fallback`);
      }
    }

    // Sempre adiciona o torrent como fallback (ou única opção se sem RD)
    result.push(buildStreamObj(stream));

    return { streams: result };
  }

  if (type === 'series') {
    const parts = id.split(':');
    if (parts.length < 3) return { streams: [] };

    const [imdbId, seasonStr, episodeStr] = parts;
    const season  = parseInt(seasonStr,  10);
    const episode = parseInt(episodeStr, 10);

    const allStreams = await getSeriesStreams();
    const matched   = allStreams.filter(s => {
      if (s.imdbId !== imdbId) return false;
      const ep = parseEpisodeInfo(s.title || s.name || '');
      return ep.season === season && ep.episode === episode;
    });

    if (!matched.length) return { streams: [] };

    const bingeGroup = `itflixhd-${imdbId}-s${String(season).padStart(2, '0')}`;
    const result     = [];

    for (const s of matched) {
      // Tenta Real-Debrid
      if (rdKey && s.infoHash) {
        console.log(`🔑 RD: tentando desbloquear série ${s.infoHash}`);
        const rdUrl = await rdGetStreamUrl(
          rdKey,
          s.infoHash,
          mergeTrackers(s.sources),
          typeof s.fileIdx === 'number' ? s.fileIdx : 0
        );
        if (rdUrl) {
          console.log(`✅ RD: stream obtido para ${s.infoHash}`);
          result.push(buildRdStreamObj(s, rdUrl, { bingeGroup }));
          continue; // Não adiciona o torrent se RD funcionou
        }
        console.warn(`⚠️  RD: falhou para ${s.infoHash}, usando torrent`);
      }

      result.push(buildStreamObj(s, { bingeGroup }));
    }

    return { streams: result };
  }

  return { streams: [] };
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

Promise.all([getMovies(), getSeriesStreams()]).then(() => {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`\n🎬 ITFLIXHD v1.4.0 rodando em http://localhost:${PORT}/manifest.json\n`);
  console.log(`⚡ Real-Debrid: configure sua API Key ao instalar o addon no Stremio\n`);
});
