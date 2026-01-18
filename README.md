# Hjerterfri Online v1.3.16

Browser-baseret Hjerterfri (Hearts) med Node.js + Express + Socket.IO.

## Kør lokalt

```bash
npm install
npm start
# Åbn http://localhost:3000
```

## Deployment (Render)
- Node: 20.x LTS
- Start command: `npm start`
- `.npmrc` peger på `registry.npmjs.org`

## Notes
- Serveren er **server-authoritative** og validerer tur + lovlige kort.
- Passing rotation: venstre → højre → overfor → ingen → gentag.
- Shoot the Moon understøttes.

## v1.3.16 (manual patch)
Fixed mobile layout issue where the player hand was clipped due to overflow: hidden.
Hand is now fixed to the bottom of the viewport and wraps into multiple rows when needed.

## Changelog

### v1.3.16
- Status/tekstlog er som standard skjult og kan tændes/slukkes med knappen **Vis status**.
- Mobil: I portrait vises et "Drej telefonen" hint; landscape er optimeret til spil.
- Mobil hånd: fast i bunden og wrap til flere rækker ved behov (ingen clipping).

