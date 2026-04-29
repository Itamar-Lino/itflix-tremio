const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// ── Manifest ──────────────────────────────────────────────────────────────────
const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.0.0',
  name: 'ITFLIXHD',
  description: 'Assista filmes e séries em HD com o addon ITFLIXHD para Stremio.',
  logo: 'https://cdn.jsdelivr.net/gh/Itamar-Lino/Itflix-@main/itflixhd.png',
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

const builder = new addonBuilder(manifest);

// ── Catálogos de exemplo ──────────────────────────────────────────────────────
// Substitua estes dados por uma integração real com sua fonte de vídeos.

const MOVIES_CATALOG = [
  {
    id: 'tt9362722',
    type: 'movie',
    name: 'Homem-Aranha: Através do Aranhaverso',
    poster: 'https://m.media-amazon.com/images/M/MV5BMzI0NmVkMjEtYmY4MS00ZDMxLTlkZmEtMzU4MDQxYTMzMjU2XkEyXkFqcGdeQXVyMzQ0MzA0NTM@._V1_SX300.jpg',
    genres: ['Animação', 'Ação', 'Aventura'],
    description: 'Miles Morales é lançado no Multiverso.',
    releaseInfo: '2023',
    imdbRating: '8.6',
  },
  {
    id: 'tt1745960',
    type: 'movie',
    name: 'Top Gun: Maverick',
    poster: 'https://m.media-amazon.com/images/M/MV5BZWYzOGEwNTgtNWU3NS00ZTQ0LWJkODUtMmVhMjIwMjA1ZmQwXkEyXkFqcGdeQXVyMjkwOTAyMDU@._V1_SX300.jpg',
    genres: ['Ação', 'Drama'],
    description: 'Maverick está de volta aos céus.',
    releaseInfo: '2022',
    imdbRating: '8.3',
  },
  {
    id: 'tt15239678',
    type: 'movie',
    name: 'Dune: Part Two',
    poster: 'https://m.media-amazon.com/images/M/MV5BN2QyZGU4ZDctOWMzMy00NTc5LThlOGQtODhmNDBiNTIwNDBlXkEyXkFqcGdeQXVyMDM2NDM2MQ@@._V1_SX300.jpg',
    genres: ['Ficção Científica', 'Aventura'],
    description: 'Paul Atreides une-se a Chani e os Fremen.',
    releaseInfo: '2024',
    imdbRating: '8.5',
  },
];

const SERIES_CATALOG = [
  {
    id: 'tt7221388',
    type: 'series',
    name: 'The Boys',
    poster: 'https://m.media-amazon.com/images/M/MV5BYTEzZmE4Y2UtNGQ5Yi00ZWZkLWJhNzAtZmI1YWZhYTI4ZmFhXkEyXkFqcGdeQXVyMTkxNjUyNQ@@._V1_SX300.jpg',
    genres: ['Ação', 'Comédia', 'Crime'],
    description: 'Um grupo de vigilantes enfrenta super-heróis corruptos.',
    releaseInfo: '2019–',
    imdbRating: '8.7',
  },
  {
    id: 'tt6741278',
    type: 'series',
    name: 'Invincible',
    poster: 'https://m.media-amazon.com/images/M/MV5BZjY2Y2M5ZTItNjk3ZS00ZDY1LTgwZjAtZGNhNjc5ZWZhYjI5XkEyXkFqcGdeQXVyMTkxNjUyNQ@@._V1_SX300.jpg',
    genres: ['Animação', 'Ação', 'Aventura'],
    description: 'Filho de um super-herói descobre seus poderes.',
    releaseInfo: '2021–',
    imdbRating: '8.7',
  },
  {
    id: 'tt14218830',
    type: 'series',
    name: 'Beef',
    poster: 'https://m.media-amazon.com/images/M/MV5BZTcxNTViY2UtMjI1OC00YTE5LWFiOWYtYWY3ZjhlNzhjZTI5XkEyXkFqcGdeQXVyMTkxNjUyNQ@@._V1_SX300.jpg',
    genres: ['Comédia', 'Drama'],
    description: 'Uma briga de trânsito desencadeia uma guerra intensa.',
    releaseInfo: '2023',
    imdbRating: '8.0',
  },
];

// ── Handler: Catálogo ─────────────────────────────────────────────────────────
builder.defineCatalogHandler(({ type, id, extra }) => {
  const search = extra && extra.search ? extra.search.toLowerCase() : null;

  let items = type === 'movie' ? MOVIES_CATALOG : SERIES_CATALOG;

  if (search) {
    items = items.filter(m => m.name.toLowerCase().includes(search));
  }

  return Promise.resolve({ metas: items });
});

// ── Handler: Meta ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(({ type, id }) => {
  const all = [...MOVIES_CATALOG, ...SERIES_CATALOG];
  const meta = all.find(m => m.id === id && m.type === type);

  if (!meta) return Promise.resolve({ meta: null });

  return Promise.resolve({ meta });
});

// ── Handler: Streams ──────────────────────────────────────────────────────────
// IMPORTANTE: Substitua as URLs abaixo por streams reais (HTTP, HLS, torrents, etc.)
// Certifique-se de respeitar os direitos autorais e as leis aplicáveis.
builder.defineStreamHandler(({ type, id }) => {
  // Exemplo de stream demo — troque pelas suas fontes reais
  const demoStreams = [
    {
      name: 'ITFLIXHD · 1080p',
      description: '🎬 Full HD',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      behaviorHints: { notWebReady: false },
    },
    {
      name: 'ITFLIXHD · 720p',
      description: '📺 HD',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      behaviorHints: { notWebReady: false },
    },
  ];

  return Promise.resolve({ streams: demoStreams });
});

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`\n🎬 ITFLIXHD Addon rodando em http://localhost:${PORT}/manifest.json\n`);
