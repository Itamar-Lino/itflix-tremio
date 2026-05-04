const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const http = require('http');
const url  = require('url');

// ── Configurações ─────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

const SERIES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/series.json';

// ── Real-Debrid API Key fixa ──────────────────────────────────────────────────
// Cole sua API Key aqui (obtenha em real-debrid.com/apitoken)
// Deixe como null para desativar o Real-Debrid
const RD_API_KEY = ''; // ex: 'ABCDEF123456...'

const TMDB_API_KEY  = 'c311ad203b7db4a3bf1e1275ecdf41de';
const TMDB_BASE     = 'https://api.themoviedb.org/3';
const TMDB_POSTER   = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACK     = 'https://image.tmdb.org/t/p/w1280';

const CACHE_TTL     = 30 * 60 * 1000;
const TMDB_TTL      = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 7_000;

// ── Real-Debrid ───────────────────────────────────────────────────────────────
const RD_BASE = 'https://api.real-debrid.com/rest/1.0';

async function rdAddMagnet(apiKey, infoHash, sources) {
  const trackers = (sources || [])
    .filter(s => s.startsWith('tracker:'))
    .map(s => s.replace('tracker:', ''))
    .join('&tr=');

  const magnet = `magnet:?xt=urn:btih:${infoHash}${trackers ? '&tr=' + trackers : ''}`;

  const addRes = await fetchWithTimeout(`${RD_BASE}/torrents/addMagnet`, 10_000, 1,
    { Authorization: `Bearer ${apiKey}` },
    { method: 'POST', body: new URLSearchParams({ magnet }) }
  );
  if (!addRes.ok) throw new Error(`RD addMagnet HTTP ${addRes.status}`);
  const { id: torrentId } = await addRes.json();
  if (!torrentId) throw new Error('RD: sem torrentId');

  const selRes = await fetchWithTimeout(`${RD_BASE}/torrents/selectFiles/${torrentId}`, 8_000, 1,
    { Authorization: `Bearer ${apiKey}` },
    { method: 'POST', body: new URLSearchParams({ files: 'all' }) }
  );
  if (!selRes.ok) console.warn(`RD selectFiles HTTP ${selRes.status}`);

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const infoRes = await fetchWithTimeout(`${RD_BASE}/torrents/info/${torrentId}`, 8_000, 1,
      { Authorization: `Bearer ${apiKey}` }
    );
    if (!infoRes.ok) continue;
    const info = await infoRes.json();
    if (info.status === 'downloaded') return info.links || [];
    if (['error', 'virus', 'dead'].includes(info.status))
      throw new Error(`RD torrent status: ${info.status}`);
  }
  throw new Error('RD: timeout aguardando download');
}

async function rdUnrestrictLink(apiKey, link) {
  const res = await fetchWithTimeout(`${RD_BASE}/unrestrict/link`, 8_000, 1,
    { Authorization: `Bearer ${apiKey}` },
    { method: 'POST', body: new URLSearchParams({ link }) }
  );
  if (!res.ok) throw new Error(`RD unrestrict HTTP ${res.status}`);
  const data = await res.json();
  return data.download || null;
}

async function rdGetStreamUrl(apiKey, infoHash, sources, fileIdx = 0) {
  try {
    const listRes = await fetchWithTimeout(`${RD_BASE}/torrents`, 8_000, 1,
      { Authorization: `Bearer ${apiKey}` }
    );
    if (listRes.ok) {
      const torrents = await listRes.json();
      const existing = torrents.find(t =>
        t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() &&
        t.status === 'downloaded'
      );
      if (existing) {
        const infoRes = await fetchWithTimeout(`${RD_BASE}/torrents/info/${existing.id}`, 8_000, 1,
          { Authorization: `Bearer ${apiKey}` }
        );
        if (infoRes.ok) {
          const info  = await infoRes.json();
          const links = info.links || [];
          const link  = links[fileIdx] || links[0];
          if (link) return await rdUnrestrictLink(apiKey, link);
        }
      }
    }
    const links = await rdAddMagnet(apiKey, infoHash, sources);
    const link  = links[fileIdx] || links[0];
    if (!link) throw new Error('RD: sem links após adicionar');
    return await rdUnrestrictLink(apiKey, link);
  } catch (err) {
    console.error(`RD erro para ${infoHash}:`, err.message);
    return null;
  }
}

// ── Trackers ──────────────────────────────────────────────────────────────────
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

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id:          'com.itflixhd.addon',
  version:     '1.5.0',
  name:        'ITFLIXHD',
  description: 'Assista filmes e series em HD. Suporte a Real-Debrid.',
  logo:        'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/itflix.png',
  background:  'https://i.imgur.com/mEHGqaJ.jpg',
  types:       ['movie', 'series'],
  catalogs: [
    { type: 'movie',  id: 'itflixhd-movies', name: 'ITFLIXHD - Filmes', extra: [{ name: 'search', isRequired: false }] },
    { type: 'series', id: 'itflixhd-series', name: 'ITFLIXHD - Series', extra: [{ name: 'search', isRequired: false }] },
  ],
  resources:     ['catalog', 'meta', 'stream'],
  idPrefixes:    ['itflixhd_', 'tt'],
  behaviorHints: { adult: false, p2p: true, configurationRequired: true },
};

// ── pMap ──────────────────────────────────────────────────────────────────────
async function pMap(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

// ── Fetch com timeout e retry ─────────────────────────────────────────────────
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT, retries = 2, headers = {}, opts = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal, headers, ...opts });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ── Cache filmes ──────────────────────────────────────────────────────────────
let cachedMovies = null, lastMovieFetch = 0;
async function getMovies() {
  const now = Date.now();
  if (cachedMovies && now - lastMovieFetch < CACHE_TTL) return cachedMovies;
  try {
    const res = await fetchWithTimeout(FILMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data     = await res.json();
    cachedMovies   = Array.isArray(data) ? data : (data.streams || []);
    lastMovieFetch = now;
    console.log(`Filmes carregados: ${cachedMovies.length}`);
  } catch (err) {
    console.error('Erro ao carregar filmes:', err.message);
    cachedMovies = cachedMovies || [];
  }
  return cachedMovies;
}

// ── Cache series ──────────────────────────────────────────────────────────────
let cachedSeries = null, lastSeriesFetch = 0;
async function getSeriesStreams() {
  const now = Date.now();
  if (cachedSeries && now - lastSeriesFetch < CACHE_TTL) return cachedSeries;
  try {
    const res = await fetchWithTimeout(SERIES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data      = await res.json();
    cachedSeries    = Array.isArray(data) ? data : (data.streams || []);
    lastSeriesFetch = now;
    console.log(`Series carregadas: ${cachedSeries.length}`);
  } catch (err) {
    console.error('Erro ao carregar series:', err.message);
    cachedSeries = cachedSeries || [];
  }
  return cachedSeries;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function groupSeriesByImdb(streams) {
  const map = {};
  for (const s of streams) {
    const id = s.imdbId;
    if (!id) continue;
    if (!map[id]) map[id] = { imdbId: id, seriesName: extractSeriesName(s.title || s.name || ''), streams: [] };
    map[id].streams.push(s);
  }
  return map;
}

function extractSeriesName(raw) {
  const m = raw.match(/^(.+?)\s+[Ss]\d{2}[Ee]\d{2}/);
  return m ? m[1].trim() : raw.trim();
}

function parseEpisodeInfo(raw) {
  const m = raw.match(/[Ss](\d{2})[Ee](\d{2})/);
  return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : { season: 1, episode: 1 };
}

function parseStreamTitle(stream) {
  const raw       = stream.title || stream.name || 'Sem titulo';
  const nameMatch = raw.match(/^([^.(]+)/);
  const name      = nameMatch ? nameMatch[1].trim() : raw.trim();
  const yearMatch = raw.match(/\((\d{4})\)/);
  return { name, year: yearMatch ? yearMatch[1] : '', fullTitle: raw };
}

function parseQuality(stream) {
  const q = (stream.name || '').match(/\d{3,4}p[^\s]*/i);
  return q ? q[0] : ((stream.name || '').split(' ')[0] || 'HD');
}

function parseAudio(stream) {
  const raw = (stream.title || stream.name || '').toLowerCase();
  if (raw.includes('dual') || raw.includes('dublado')) return 'Dual';
  if (raw.includes('nacional') || raw.includes('português')) return 'Nacional';
  if (raw.includes('legendado') || raw.includes('leg.')) return 'Legendado';
  return '';
}

function streamId(stream) {
  const base = stream.infoHash
    ? stream.infoHash.toLowerCase()
    : Buffer.from(stream.title || stream.name || '').toString('hex').slice(0, 40);
  return `${base}_${stream.fileIdx ?? 0}`;
}

function findByImdbId(streams, id) { return streams.find(s => s.imdbId === id); }
function findByInternalId(streams, rawId) { return streams.find(s => streamId(s) === rawId); }

function mergeTrackers(sources) {
  const s = new Set(sources || []);
  DEFAULT_TRACKERS.forEach(t => s.add(t));
  return [...s];
}

function buildStreamObj(s, extraHints = {}) {
  const label = [parseQuality(s), parseAudio(s)].filter(Boolean).join(' | ');
  return {
    name:     `ITFLIXHD\n${label}`,
    title:    s.title || s.name || '',
    infoHash: s.infoHash.toLowerCase(),
    fileIdx:  s.fileIdx ?? 0,
    sources:  mergeTrackers(s.sources),
    ...(Object.keys(extraHints).length ? { behaviorHints: extraHints } : {}),
  };
}

function buildRdStreamObj(s, rdUrl, extraHints = {}) {
  const label = [parseQuality(s), parseAudio(s)].filter(Boolean).join(' | ');
  return {
    name:  `RD | ITFLIXHD\n${label}`,
    title: s.title || s.name || '',
    url:   rdUrl,
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
    const res = await fetchWithTimeout(
      `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&external_source=imdb_id`
    );
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const fd     = await res.json();
    const result = mediaType === 'movie' ? (fd.movie_results || [])[0] : (fd.tv_results || [])[0];
    if (!result) { tmdbCache[key] = { ts: Date.now(), data: {} }; return {}; }
    const data = {
      poster:      result.poster_path   ? `${TMDB_POSTER}${result.poster_path}`  : null,
      background:  result.backdrop_path ? `${TMDB_BACK}${result.backdrop_path}`  : null,
      description: result.overview      || '',
      rating:      result.vote_average  ? String(result.vote_average.toFixed(1)) : '',
      name:        result.title || result.name || result.original_title || result.original_name || '',
      year:        (result.release_date || result.first_air_date || '').slice(0, 4),
    };
    tmdbCache[key] = { ts: Date.now(), data };
    return data;
  } catch (err) {
    console.error(`TMDB (${imdbId}):`, err.message);
    tmdbCache[key] = { ts: Date.now(), data: {} };
    return {};
  }
}

// ── Builder do Addon ──────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = extra?.search?.toLowerCase() || null;

  if (type === 'movie' && id === 'itflixhd-movies') {
    const streams  = await getMovies();
    const filtered = streams.filter(s => !search || (s.title || s.name || '').toLowerCase().includes(search));
    const metas = await pMap(filtered, async (s) => {
      const { name, year, fullTitle } = parseStreamTitle(s);
      const tmdb = s.imdbId ? await getTmdbByImdb(s.imdbId, 'movie') : {};
      return {
        id:          `itflixhd_${streamId(s)}`,
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
    const filtered = Object.values(grouped).filter(s => !search || s.seriesName.toLowerCase().includes(search));
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

builder.defineMetaHandler(async ({ type, id }) => {
  if (type === 'movie') {
    const streams = await getMovies();
    const rawId   = id.replace('itflixhd_', '');
    const stream  = rawId.startsWith('tt') ? findByImdbId(streams, rawId) : findByInternalId(streams, rawId);
    if (!stream) return { meta: null };
    const { name, year, fullTitle } = parseStreamTitle(stream);
    const tmdb = stream.imdbId ? await getTmdbByImdb(stream.imdbId, 'movie') : {};
    return {
      meta: {
        id:          `itflixhd_${streamId(stream)}`,
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

// Stream handler — usa rdKey da URL ou a key fixa definida acima
builder.defineStreamHandler(async ({ type, id, extra }) => {
  const rdKey = (extra && extra.rdKey) || RD_API_KEY || null;

  if (type === 'movie') {
    const streams = await getMovies();
    const rawId   = id.replace('itflixhd_', '');
    const stream  = rawId.startsWith('tt') ? findByImdbId(streams, rawId) : findByInternalId(streams, rawId);
    if (!stream || !stream.infoHash) return { streams: [] };

    const result = [];
    if (rdKey) {
      const rdUrl = await rdGetStreamUrl(rdKey, stream.infoHash, mergeTrackers(stream.sources), stream.fileIdx ?? 0);
      if (rdUrl) result.push(buildRdStreamObj(stream, rdUrl));
    }
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
      if (rdKey && s.infoHash) {
        const rdUrl = await rdGetStreamUrl(rdKey, s.infoHash, mergeTrackers(s.sources), s.fileIdx ?? 0);
        if (rdUrl) { result.push(buildRdStreamObj(s, rdUrl, { bingeGroup })); continue; }
      }
      result.push(buildStreamObj(s, { bingeGroup }));
    }
    return { streams: result };
  }

  return { streams: [] };
});

// ── Página de Configuração ────────────────────────────────────────────────────
const CONFIG_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ITFLIXHD - Configurar</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f0f1a;
      color: #fff;
      font-family: 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 32px;
    }
    .logo img { width: 54px; height: 54px; border-radius: 12px; }
    .logo h1 { font-size: 1.6rem; letter-spacing: 1px; }
    .logo span { color: #e50914; }
    .section { margin-bottom: 24px; }
    label {
      display: block;
      font-size: 0.82rem;
      color: #aaa;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge {
      display: inline-block;
      background: #1a2d1a;
      color: #4caf50;
      border-radius: 6px;
      font-size: 0.7rem;
      padding: 2px 8px;
      margin-left: 6px;
      vertical-align: middle;
      text-transform: none;
      letter-spacing: 0;
    }
    input[type=text] {
      width: 100%;
      background: #0f0f1a;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      padding: 12px 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type=text]:focus { border-color: #e50914; }
    .hint { font-size: 0.78rem; color: #555; margin-top: 6px; }
    .hint a { color: #e50914; text-decoration: none; }
    .hint a:hover { text-decoration: underline; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #e50914;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      margin-top: 8px;
      transition: background 0.2s;
    }
    .btn:hover { background: #c4070f; }
    .btn-outline {
      background: transparent;
      border: 1px solid #2a2a4a;
      color: #888;
      font-weight: 400;
      margin-top: 10px;
    }
    .btn-outline:hover { border-color: #555; color: #fff; }
    #link-box {
      display: none;
      background: #0f0f1a;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.78rem;
      color: #777;
      word-break: break-all;
      margin-top: 14px;
      line-height: 1.5;
    }
    .divider {
      border: none;
      border-top: 1px solid #2a2a4a;
      margin: 28px 0;
    }
    .info { font-size: 0.82rem; color: #555; line-height: 1.6; }
    .info strong { color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <img src="https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/itflix.png" alt="logo"/>
      <h1>ITF<span>LIX</span>HD</h1>
    </div>

    <div class="section">
      <label>Real-Debrid API Key <span class="badge">opcional</span></label>
      <input type="text" id="rd-key" placeholder="Cole sua API Key aqui..."/>
      <p class="hint">Obtenha em <a href="https://real-debrid.com/apitoken" target="_blank">real-debrid.com/apitoken</a></p>
    </div>

    <button class="btn" onclick="instalar()">Instalar no Stremio</button>
    <button class="btn btn-outline" onclick="copiarLink()">Copiar link do manifest</button>

    <div id="link-box"></div>

    <hr class="divider"/>

    <p class="info">
      <strong>Sem Real-Debrid:</strong> os streams usam torrent direto no Stremio.<br/><br/>
      <strong>Com Real-Debrid:</strong> os streams aparecem como links HTTP diretos,
      mais rapidos e sem precisar de VPN.
    </p>
  </div>

  <script>
    function buildManifestUrl() {
      const rdKey = document.getElementById('rd-key').value.trim();
      const base  = window.location.origin;
      return rdKey
        ? base + '/' + encodeURIComponent(rdKey) + '/manifest.json'
        : base + '/manifest.json';
    }

    function instalar() {
      const manifestUrl = buildManifestUrl();
      // Tenta abrir o Stremio; se falhar mostra o link
      window.location.href = 'stremio://' + manifestUrl.replace(/^https?:\\/\\//, '');
      setTimeout(() => {
        const box = document.getElementById('link-box');
        box.style.display = 'block';
        box.innerHTML = '<strong style="color:#aaa">Caso o Stremio nao abra, cole este link em Addons > Instalar do URL:</strong><br/><br/>' + manifestUrl;
      }, 1500);
    }

    function copiarLink() {
      const manifestUrl = buildManifestUrl();
      navigator.clipboard.writeText(manifestUrl).catch(() => {});
      const box = document.getElementById('link-box');
      box.style.display = 'block';
      box.textContent   = manifestUrl;
    }
  </script>
</body>
</html>`;

// ── Servidor HTTP Customizado ─────────────────────────────────────────────────
// Rotas:
//   GET /                           → página de configuração
//   GET /configure                  → página de configuração
//   GET /manifest.json              → manifest base (engrenagem ⚙️ no Stremio)
//   GET /:rdKey/manifest.json       → manifest com RD ativo
//   GET /:rdKey/stream/...          → streams com RD
//   GET /stream/...                 → streams sem RD

const PORT       = process.env.PORT || 7000;
const addonIface = builder.getInterface();
const sdkRouter  = getRouter(addonIface);

function getBaseUrl(req) {
  const host  = req.headers.host || `localhost:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

function sendJson(res, obj) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function handleRequest(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const baseUrl  = getBaseUrl(req);

  // ── Página de configuração ─────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/configure') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(CONFIG_PAGE);
  }

  // ── Manifest base (sem rdKey na URL) ──────────────────────────────────────
  // configurationRequired: true → Stremio mostra a engrenagem ⚙️
  if (pathname === '/manifest.json') {
    return sendJson(res, {
      ...manifest,
      configureUrl:  `${baseUrl}/configure`,
      behaviorHints: { ...manifest.behaviorHints, configurationRequired: true },
    });
  }

  // ── Detecta rdKey no primeiro segmento /:rdKey/... ────────────────────────
  const sdkPaths = ['manifest.json', 'stream', 'meta', 'catalog'];
  const firstSeg = pathname.split('/').filter(Boolean)[0] || '';

  if (firstSeg && !sdkPaths.includes(firstSeg)) {
    const rdKey   = decodeURIComponent(firstSeg);
    const subPath = pathname.slice(firstSeg.length + 1) || '/';

    // /:rdKey/manifest.json — configurationRequired: false (já configurado)
    if (subPath === '/manifest.json') {
      return sendJson(res, {
        ...manifest,
        configureUrl:  `${baseUrl}/configure`,
        behaviorHints: { ...manifest.behaviorHints, configurationRequired: false },
      });
    }

    // Injeta rdKey para o stream handler via query param
    const sep = subPath.includes('?') ? '&' : '?';
    req.url   = subPath + sep + 'rdKey=' + encodeURIComponent(rdKey);
    console.log(`RD Key detectada: ${rdKey.slice(0, 8)}... → ${req.url}`);
  }

  // Passa para o router do SDK
  sdkRouter(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
Promise.all([getMovies(), getSeriesStreams()]).then(() => {
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`\nITFLIXHD v1.5.0 rodando`);
    console.log(`Configuracao:  http://localhost:${PORT}/`);
    console.log(`Manifest:      http://localhost:${PORT}/manifest.json`);
    console.log(`Com RD:        http://localhost:${PORT}/SUA_KEY/manifest.json\n`);
  });
});
