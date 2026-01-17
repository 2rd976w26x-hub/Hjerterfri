# Hjerterfri v1.1.4 (Online rum - demo)

## Render / deploy note

Hvis du deployer på Render, så er Node-versionen pinned til **20.12.2 (LTS)** for at undgå npm-fejlen
"Exit handler never called!" som er rapporteret i CI-miljøer på visse nyere Node/npm-kombinationer.

På Render kan du med fordel sætte **Build Command** til:

```
npm run render-build
```

Dette er en **github-ready** demo af **Hjerterfri** med:

- Online **rum (rooms)** via **Socket.IO**
- Host kan vælge **0–3 computer-spillere (CPU)**
- Et simpelt **rundt bord**-layout og **kort-animation** når der spilles
- "Kulør-tæller" (♣♦♥♠ spillet) **vises kun for den spiller der starter** (demo: host/stol 1)

> **Bemærk:** Dette er en **spilbar demo**. Fuld Hjerterfri-regel-engine (lovlige træk, stik-vinder, runder, point, shoot-the-moon osv.) er **ikke** implementeret endnu.

## Kør lokalt

1) Installer Node.js (>= 18)
2) I projektmappen:

```bash
npm install
npm start
```

Åbn så: `http://localhost:3000`

## Deploy

Denne version kræver en **Node.js server** (kan ikke køre som ren GitHub Pages alene).

Muligheder:
- Render / Fly.io / Railway: deploy hele repo’et som en Node app og kør `npm start`.

## Struktur

- `server.js` — Express + Socket.IO
- `public/` — klient (HTML/CSS/JS)

