# Hjerterfri v1.2.3 (Online rum)

Denne version er en **spilbar online** udgave af **Hjerterfri** med:

- Online **rum (rooms)** via **Socket.IO**
- Host kan vælge **0–3 computer-spillere (CPU)**
- **Rundt bord UI** + kort-animationer, når der spilles til midten
- **Regler (grundregler)**:
  - **2♣ starter** runden
  - **Følg kulør** hvis muligt
  - **Hearts broken**: hjerter må først ledes når hjerter er “brudt” (medmindre du kun har hjerter)
  - **Første stik**: der ledes 2♣, og der må ikke smides pointkort (♥ eller ♠Q), medmindre man ikke kan andet
  - **Point**: ♥ = 1 pr. kort, ♠Q = 13
  - **Shoot the moon**: hvis en spiller tager alle 26 point i en runde, får de andre 26 og spilleren 0
- **Kulør-tæller** (♣♦♥♠ spillet) vises kun for **starteren** (den der har 2♣)

> Note: Der findes mange varianter af Hjerterfri. Denne version følger en almindelig standard-variant.

## Render / deploy note

Node-versionen er pinned til **20.12.2 (LTS)** og der er tilføjet `.npmrc`, så deploy på Render ikke forsøger at hente pakker via interne registries.

## Fix i v1.2.3

- Din hånd rendres korrekt: klienten lytter nu på serverens `game:privateState` og passerunden sender `game:passSelect` (matching serverens events).

På Render kan du med fordel sætte **Build Command** til:

```
npm run render-build
```

## Kør lokalt

```bash
npm install
npm start
```

Åbn: `http://localhost:3000`

## Deploy

Denne version kræver en **Node.js server** (kan ikke køre som ren GitHub Pages alene).

Muligheder:
- Render / Fly.io / Railway: deploy hele repo’et som en Node app og kør `npm start`.

## Struktur

- `server.js` — Express + Socket.IO + game-engine (regler + CPU)
- `public/` — klient (HTML/CSS/JS)
