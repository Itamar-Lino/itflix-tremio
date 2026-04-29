# 🎬 ITFLIXHD — Addon Stremio

Addon para o Stremio que exibe filmes e séries em HD.

---

## 📁 Estrutura

```
itflixhd-addon/
├── index.js        ← Servidor principal do addon
├── package.json    ← Dependências Node.js
└── README.md       ← Este arquivo
```

---

## 🚀 Como instalar e rodar

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) versão 14 ou superior
- npm (vem junto com o Node.js)

### 2. Instalar dependências

```bash
cd itflixhd-addon
npm install
```

### 3. Iniciar o addon

```bash
npm start
```

O terminal vai exibir:
```
🎬 ITFLIXHD Addon rodando em http://localhost:7000/manifest.json
```

---

## 📲 Como instalar no Stremio

1. Abra o **Stremio** no celular ou PC
2. Vá em **Configurações → Addons**
3. Clique em **+ Addon** ou **Instalar por URL**
4. Cole a URL:
   ```
   http://localhost:7000/manifest.json
   ```
   > Se o servidor estiver em outra máquina/nuvem, use o IP/domínio correto.
5. Confirme a instalação ✅

---

## ☁️ Deploy na nuvem (opcional)

Para acessar o addon de qualquer lugar, faça deploy no **Railway**, **Render** ou **Heroku**:

### Railway (recomendado — grátis)
1. Crie conta em [railway.app](https://railway.app)
2. Novo projeto → **Deploy from GitHub**
3. Suba o código no GitHub e conecte
4. A URL pública será algo como: `https://itflixhd.up.railway.app/manifest.json`

---

## ⚙️ Personalizar streams (IMPORTANTE)

No arquivo `index.js`, o handler `defineStreamHandler` retorna streams de demonstração.

Para usar streams reais, substitua as URLs dentro de `demoStreams`:

```js
const demoStreams = [
  {
    name: 'ITFLIXHD · 1080p',
    description: '🎬 Full HD',
    url: 'SUA_URL_DE_VIDEO_AQUI.mp4',  // ← substitua aqui
  },
];
```

Fontes suportadas pelo Stremio:
- Links diretos MP4/MKV
- HLS (`.m3u8`)
- Torrents (magnet links)
- HTTP streams

---

## 📋 Adicionar mais filmes/séries ao catálogo

Edite os arrays `MOVIES_CATALOG` e `SERIES_CATALOG` em `index.js`:

```js
{
  id: 'tt0000000',        // ID do IMDB (obrigatório para metadados)
  type: 'movie',          // 'movie' ou 'series'
  name: 'Nome do Filme',
  poster: 'https://url-do-poster.jpg',
  genres: ['Ação', 'Drama'],
  description: 'Descrição do filme.',
  releaseInfo: '2024',
  imdbRating: '8.0',
},
```

---

## 🛠️ Desenvolvimento

Para rodar com auto-reload ao salvar:

```bash
npm run dev
```

---

## ⚠️ Aviso Legal

Este addon é um template educacional. Certifique-se de usar apenas conteúdo que você tem o direito de distribuir. Respeite os direitos autorais e as leis aplicáveis.
