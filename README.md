# 🎬 ITFLIXHD — Addon Stremio

Addon para o Stremio que carrega filmes e séries dinamicamente a partir de uma lista JSON hospedada no GitHub.

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
- [Node.js](https://nodejs.org/) versão **18 ou superior**
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
✅ Lista carregada: XX item(s) do GitHub
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

## 📋 Fonte da lista de filmes

A lista é carregada automaticamente do GitHub a cada inicialização (e atualizada a cada **5 minutos** com cache):

```
https://raw.githubusercontent.com/Itamar-Lino/lista/refs/heads/main/filmes.json
```

Para trocar a fonte, edite a constante `FILMES_URL` no topo do `index.js`.

### Estrutura esperada do JSON

O addon aceita as seguintes variações de campos:

```json
[
  {
    "id": "tt1234567",          // IMDB ID — obrigatório
    "type": "movie",            // "movie" ou "series"
    "name": "Nome do Filme",    // ou "title" / "titulo"
    "poster": "https://...",    // URL do poster
    "genres": ["Ação"],         // ou "generos"
    "description": "...",       // ou "descricao" / "overview"
    "releaseInfo": "2024",      // ou "year" / "ano"
    "imdbRating": "8.5",
    "streams": [                // opcional — streams embutidos
      {
        "name": "1080p",
        "url": "https://seu-video.mp4"
      }
    ]
  }
]
```

Também aceita objeto raiz com chave `filmes`, `movies` ou `items`:
```json
{ "filmes": [ ... ] }
```

---

## ☁️ Deploy na nuvem (opcional)

Para acessar o addon de qualquer lugar, faça deploy no **Railway**, **Render** ou **Heroku**:

### Railway (recomendado — grátis)
1. Crie conta em [railway.app](https://railway.app)
2. Novo projeto → **Deploy from GitHub**
3. Suba o código no GitHub e conecte
4. A URL pública será algo como: `https://itflixhd.up.railway.app/manifest.json`

---

## 🛠️ Desenvolvimento

Para rodar com auto-reload ao salvar:

```bash
npm run dev
```

---

## ⚠️ Aviso Legal

Este addon é um template educacional. Certifique-se de usar apenas conteúdo que você tem o direito de distribuir. Respeite os direitos autorais e as leis aplicáveis.
