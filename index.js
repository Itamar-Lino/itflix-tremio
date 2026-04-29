const express = require('express');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

const manifest = {
  id: 'com.itflixhd.addon',
  version: '1.0.0',
  name: 'ITFLIXHD',
  description: 'Filmes e Séries em HD',
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'itflixhd-movies', name: 'ITFLIXHD Filmes' },
    { type: 'series', id: 'itflixhd-series', name: 'ITFLIXHD Séries' }
  ],
  resources: ['catalog', 'stream'],
  idPrefixes: ['tt']
};

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

app.get('/catalog/:type/:id.json', (req, res) => {
  res.json({ metas: [] });
});

app.get('/stream/:type/:id.json', (req, res) => {
  res.json({ streams: [
    {
      name: 'ITFLIXHD 1080p',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    }
  ]});
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`ITFLIXHD rodando na porta ${PORT}`));