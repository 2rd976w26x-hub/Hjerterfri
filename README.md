# Hjerterfri v1.3.9 (Online rum)

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
- **Kulør-tæller** (♣♦♥♠ spillet) vises kun hvis **dit spillernavn indeholder "Jim"**

> Note: Der findes mange varianter af Hjerterfri. Denne version følger en almindelig standard-variant.

## Render / deploy note

Node-versionen er pinned til **20.12.2 (LTS)** og der er tilføjet `.npmrc`, så deploy på Render ikke forsøger at hente pakker via interne registries.

## Nyt i v1.3.9

- Hånden sorterer nu pr. kulør (Klør, Ruder, Spar, Hjerter) og derefter i styrke **A → 2**.

- Kulør-tæller vises kun hvis dit spillernavn indeholder "Jim" (ingen "starter"-logik)

- Kortlayout matcher Piratwhist: rigtige farver (rød for ♥/♦) og SVG pips/face-cards.

- Piratwhist-kortlayout (hjørner + stor pip) for både hånd og kort på bordet.

## Tidligere (v1.3.4)

- Hånden rykkes sammen side-om-side når du spiller et kort.

- Hånden er nu **side-om-side** (ikke "space-between"), så når du spiller et kort ud, rykker resten af kortene naturligt sammen.

- Håndkort er nu sorteret (kulør → værdi).
- Valgte bytte-kort (passerunde) markeres tydeligere og løftes ca. 10% op.

## Tidligere (v1.3.2)

- Desktop-hånden er nu **ikke overlappet**. Kortstørrelse og mellemrum skaleres automatisk,
  så hele hånden kan ses på én gang og fylder skærmbredden (Piratwhist-stil).

- Hånden auto-tilpasser overlap, så alle kort kan ses på én gang på desktop.

## Tidligere (v1.3.0)

- **Piratwhist-lignende bordlayout**: 4 faste kort-slots omkring midten (top/højre/bund/venstre).
- **Mere Piratwhist-agtig flyve-animation**: kort flyver fra spillerens seat til deres slot i midten (CPU flyver ind med bagsiden og flipper).
- **Indsamling af stik**: kort samles visuelt til vinderen.
- **Håndlayout**: mere “fan/overlap” så hånden føles som et rigtigt kortspil.

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
