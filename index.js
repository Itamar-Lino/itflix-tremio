const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── URL da lista ──────────────────────────────────────────────────────────────
const FILMES_URL =
  'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json';

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.0.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes em HD com o addon ITFLIXHD para Stremio.',
  logo: 'https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/itflix.png',
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

    // Suporta tanto { streams: [...] } quanto array direto [...]
    cachedStreams = Array.isArray(data) ? data : (data.streams || []);
    lastFetch = now;
    console.log(`✅ Lista carregada: ${cachedStreams.length} stream(s)`);
  } catch (err) {
    console.error('❌ Erro ao carregar lista:', err.message);
    cachedStreams = cachedStreams || [];
  }

  return cachedStreams;
}

// ── Extrai título limpo do campo "title" do stream ────────────────────────────
// Ex: "Eles Vão Te Matar (2026) · Dual Áudio · 5.1" → "Eles Vão Te Matar"
function parseStreamTitle(stream) {
  const raw = stream.title || stream.name || 'Sem título';
  // Pega tudo antes do primeiro " ·" ou "(" para nome curto
  const nameMatch = raw.match(/^([^·(]+)/);
  const name = nameMatch ? nameMatch[1].trim() : raw.trim();

  // Tenta extrair o ano
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';

  return { name, year, fullTitle: raw };
}

// ── Gera um ID estável baseado no infoHash ────────────────────────────────────
function streamId(stream) {
  return stream.infoHash
    ? stream.infoHash.toLowerCase()
    : Buffer.from(stream.title || stream.name || '').toString('hex').slice(0, 40);
}

// ── Converte stream da lista → meta do Stremio ────────────────────────────────
function toMeta(stream) {
  const { name, year, fullTitle } = parseStreamTitle(stream);
  const id = `itflixhd_${streamId(stream)}`;

  return {
    id,
    type: 'movie',
    name,
    description: fullTitle,
    releaseInfo: year,
    // Sem poster na lista — usa placeholder genérico
    poster: `https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${encodeURIComponent(name)}`,
  };
}

const builder = new addonBuilder(manifest);

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ extra }) => {
  const streams = await getStreams();
  const search = extra?.search?.toLowerCase() || null;

  let metas = streams.map(toMeta);

  if (search) {
    metas = metas.filter(m => m.name.toLowerCase().includes(search));
  }

  return { metas };
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const streams = await getStreams();
  const rawId = id.replace('itflixhd_', '');

  const stream = streams.find(s => streamId(s) === rawId);
  if (!stream) return { meta: null };

  return { meta: toMeta(stream) };
});

// ── Handler: Stream ───────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const streams = await getStreams();
  const rawId = id.replace('itflixhd_', '');

  const stream = streams.find(s => streamId(s) === rawId);
  if (!stream || !stream.infoHash) return { streams: [] };

  const { fullTitle } = parseStreamTitle(stream);

  return {
    streams: [
      {
        name: stream.name || 'ITFLIXHD',
        title: fullTitle,
        infoHash: stream.infoHash.toLowerCase(),
        fileIdx: stream.fileIdx ?? 0,
        sources: stream.sources || [],
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
