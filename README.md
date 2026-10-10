# StormGuide 🛡️

**Crisis guide for foreign tourists during extreme weather: official alerts in your language, flooded and unsafe areas, open shelters, and an SOS that still works without internet.**

> Hackathon track: **TravelTech** · Live demo: `https://<your-app>.onrender.com` · Control room: `https://<your-app>.onrender.com/authority.html` (host login; judges can request access on that page) · Demo video: [`demo/StormGuide-demo.mp4`](demo/)

---

## 1. The problem

When a cyclone or flash flood hits a city, foreign tourists are the most exposed people in it:

- **Warnings are fragmented and untranslated.** Alerts come from the weather department, the city corporation, the state disaster authority and the police. They arrive in the local language (Tamil in Chennai) on channels that tourists never subscribed to.
- **Tourists cannot tell which streets are flooded or unsafe.** They don't know the neighbourhood names in the warnings, so "Velachery and Saidapet" means nothing to them.
- **Rumors spread faster than facts.** Forwarded messages ("the lake has burst, all of Chennai will flood in one hour!") cause panic.
- **Networks fail.** Mobile data drops first. SMS and voice often keep working longer.
- **Rescue teams get overloaded** by duplicate, vague calls from people who don't speak the language and don't know where they are.

## 2. Our solution

StormGuide is an **offline-first web app** (PWA, no install or app store needed: scan a QR code at the airport or hotel) plus a **control-room console** for officials.

| For the traveller | For the control room |
|---|---|
| Personal risk: *"You are inside a danger area: Velachery (flooded)"*, worked out on the phone | Publish alerts with **fixed, pre-translated instructions**. Officials write once, travellers read them in 10 languages |
| Official alerts translated **without machine translation**, with the original official text always one tap away | Draw flooded/unsafe/safe zones and closed roads on a map |
| Nearest **open** shelter, places left, step-free access, and a warning if the straight line crosses a flooded zone or closed road | Update shelter occupancy and transport status |
| **Compass guide** to the shelter that works with no map and no internet | SOS queue: acknowledge, dispatch with an arrival time, resolve; the traveller sees *"Help is on the way: about 20 min"* |
| **SOS chain: internet → SMS → call 112**, tried in order | Verify or reject crowd reports; turn a verified report into a danger zone |
| Report flooding, blocked roads, fallen wires, trapped people, **even offline** | Publish rumor verdicts (FALSE / TRUE / NOT CONFIRMED) |
| QR relay: a phone with no signal hands its SOS to any phone that has signal | SMS gateway webhook (Twilio-compatible) plus a paste-in SMS tester |
| Rumor check, transport status, phrase cards in Tamil, "I'm safe" message to family | Storm **simulation** for live demos |

Everything the traveller needs keeps working with **no network at all**: the app opens, shows the last saved updates (with *"Offline: showing saved updates · Updated 14 min ago"*), computes risk, finds shelters, guides by compass and queues reports and SOS until a signal returns.

## 3. What makes it different (innovation)

1. **Safe translation by design.** Officials don't type free-text instructions. They tick items from a fixed list of 15 instructions (e.g. *"Move to higher ground or an upper floor now"*) that we pre-translated into 10 languages. A translation can never invent, drop or soften an order. The official's own headline and description are shown **verbatim**, labelled with their language and source, so nothing is hidden. (A unit test checks that every language covers every safety phrase and keeps every placeholder.)
2. **A 3-step SOS fallback chain.** (1) internet: POST to the control room, stored first in an IndexedDB outbox and retried automatically; (2) SMS: a short coded message, `SOS 13.04001,80.23370 P:2 S:TRAP L:fr ID:k3j9x2mq7a`, that a gateway parses and answers in the sender's language; (3) a one-tap call to 112. The **same request ID** travels on every channel, so the server merges them and rescuers see one request "via web + sms" instead of duplicates.
3. **Store-carry-forward QR relay.** With no signal at all, the phone shows a QR code holding the SOS. Anyone nearby scans it with their camera and their phone forwards it. If they are offline too, it waits in their outbox (a delay-tolerant network made of people).
4. **Privacy-preserving risk.** The server publishes zones. Each phone checks for itself whether it is inside or near one (point-in-polygon, distance to edge). A traveller's location never leaves the phone unless they send an SOS or a report.
5. **Prefetch on warning.** When a Severe or Extreme alert reaches your area, the app downloads the map tiles around you and the nearest shelters by itself, so the map still works when the network drops mid-storm.
6. **Crowd reports with honest labels.** Reports show "Not checked by officials" until verified, show how many independent devices confirmed them, and can be marked false. This turns the rumor problem into a feature.

## 4. Feature checklist

- 🌐 10 languages: English, தமிழ், हिन्दी, తెలుగు, Français, Deutsch, Español, 中文, 日本語, العربية (full right-to-left layout)
- 📶 Offline: service worker precaches the whole app; network-first with 3 s timeout, cached fallback; data-age banner; stale warning after 3 h
- 🔴 Live: Server-Sent Events push every change to every phone in about a second; polling fallback; ETag/304 to save data
- ⚠️ Personal risk card: inside zone / near (≤ 1.5 km) / alert area / clear; safe-zone note
- 📢 Alerts: CAP-style (Alert/Update/Cancel, severity, onset, expiry); expired alerts are greyed out with "newer information may exist"; times shown in local time with "IST" label
- 🔊 Read-aloud of the translated alert (Web Speech API)
- ⛺ Shelters: open/full/closed, places left, step-free first if the traveller needs it, shelters inside a flooded zone are pushed down the list
- 🧭 Compass guide (DeviceOrientation, iOS permission flow), cardinal-direction fallback when there is no compass sensor
- 🆘 SOS: hold 2 s to avoid pocket presses; people count; situation; live status from the control room
- 📣 Reports: 7 types, offline queue, SMS and QR fallbacks, "I see this too" confirmations (one per device)
- 🕵️ Rumor check with translated topic + verdict and the original claim
- 🚇 Transport status (metro, trains, buses, airport)
- 🗣️ Phrase cards in Tamil with transliteration and read-aloud ("I need help", "Where is the nearest relief shelter?"…)
- ✅ "I'm safe" message to family (share sheet, SMS, WhatsApp)
- ♿ Needs profile: step-free access, children, older people, with tailored tips
- 🔔 Notifications only when danger **increases** for your area (no alert fatigue)
- 🌧️ Automatic weather card from Open-Meteo with **IMD rainfall categories** (heavy ≥ 64.5 mm, very heavy ≥ 115.6 mm, extremely heavy ≥ 204.5 mm per day), clearly marked "not an official warning"
- 📲 Installable PWA

## 5. Architecture

```
            Phones (PWA)                                   Control room (browser)
 ┌───────────────────────────────┐                  ┌───────────────────────────┐
 │ index.html  app.js  core.js   │  GET /api/state  │ authority.html            │
 │ map.js (Leaflet)              │◄──── ETag ───────│ authority.js              │
 │ i18n/*.js (10 languages)       │  SSE /api/stream │  publish / verify /       │
 │ geo.js  (risk maths, offline) │◄──── push ───────│  dispatch / simulate      │
 │ db.js   (IndexedDB outbox)    │                  └────────────┬──────────────┘
 │ sw.js   (cache + bg sync)     │  POST /api/sos, /api/reports │ Bearer token
 └───────┬───────────────┬───────┘  POST /api/relay (QR)        │
         │ SMS (no data) │ tel:112                              ▼
         ▼               ▼                          ┌──────────────────────────┐
   SMS gateway ──► POST /api/sms/inbound ─────────► │ server.js (Node, no deps)│
   (Twilio etc.)   TwiML reply in sender's language │ src/store.js  JSON file  │
                                                    │ src/validate.js          │
                                                    │ src/sms.js  src/scenario │
                                                    └──────────────────────────┘
```

- **Zero npm dependencies.** The server uses only Node's built-in `http`, `fs`, `crypto` and `zlib`, so there is nothing to install or break at deploy time. The frontend is plain HTML/CSS/JS with no build step; libraries are vendored (served from our own server, no CDN, so they work offline).
- **Shared code** between browser and server (UMD modules): geometry (`geo.js`), translations (`i18n.js`), SMS format (`smscode.js`). Server and app always agree.
- **Data:** one JSON document in memory, saved atomically (write temp file, then rename). Every change bumps a version that drives ETags and live pushes. Private data (SOS, phone numbers, device hashes) is stored separately and never appears in `/api/state`.

### Offline strategy (service worker)

| Request | Strategy |
|---|---|
| App shell (HTML, JS, CSS, icons, Leaflet) | Precached at install; cache name includes a build hash computed from the files, so every deploy updates clients |
| Page navigation | Network first, 3 s timeout, then cached page |
| `/api/state` | Network first, 4 s timeout, then cached copy marked `X-SG-From-Cache` so the UI says "offline" |
| Map tiles (OpenStreetMap) | Cache first; filled while browsing, by "Download map" and automatically on severe warnings; capped at 3000 tiles |
| POST (SOS, reports) | IndexedDB outbox → immediate send → Background Sync → retry on `online`, on app start and every 45 s |

## 6. Edge cases we handle

- Phone offline at launch → app opens from cache and shows data age; never a blank screen
- Wi-Fi connected but no internet (captive portal) → 3.5 s timeout falls back to cache
- No data saved yet and offline → explicit message instead of empty lists
- SOS while offline → step 1 is skipped instantly, SMS is offered, 112 is always one tap away; the internet copy still sends itself later
- SMS sent **and** internet comes back → server merges both into one request (same ID)
- SOS without location (GPS off) → still accepted; the control room sees "no location, call back" and the phone number from SMS
- Wrong phone clock or an SOS queued for hours → server clamps client timestamps; times shown in the region's time zone
- Expired or cancelled alerts while offline → greyed out, "newer information may exist"
- GPS denied → manual "tap the map" location or demo locations; inaccurate GPS (> 500 m) is flagged
- Traveller far from the active area → told the distance and offered a demo location
- Shelter inside a flooded zone or full → ranked below open, safe ones; step-free first when needed
- Straight line to a shelter crosses a flood zone or closed road → warning (we never pretend it is turn-by-turn routing)
- Duplicate submissions and retries → client-generated IDs, server de-duplication
- One person confirming a report many times → counted once per device (hashed, salted)
- Too many requests → per-IP token-bucket rate limits; 64 KB body limit; strict validation of every field, polygon and coordinate
- Officials typing while a live update arrives → form is not re-rendered under their cursor
- Concurrent live updates during a fetch → client re-fetches once the current fetch finishes
- XSS → all text rendered with `textContent`; strict Content-Security-Policy; no inline scripts
- Path traversal, unknown routes, wrong methods → 403 / 404 / 405
- Authority PIN brute force → 5 attempts per minute; tokens are HMAC-signed and expire after 12 h; Twilio webhook signature verification when `TWILIO_AUTH_TOKEN` is set
- Server restart on free hosting (disk wiped) → demo scenario re-seeds automatically; version numbers stay monotonic so phones don't get confused
- Right-to-left (Arabic) layout, dark mode, reduced motion, large tap targets, keyboard-operable SOS button

## 7. Run it locally

Requirements: **Node.js 18 or newer**. Nothing else.

```bash
git clone https://github.com/<you>/stormguide.git
cd stormguide
npm start            # → http://localhost:3000
npm test             # 28 unit + API tests (node:test, no extra packages)
```

- Traveller app: http://localhost:3000
- Control room: http://localhost:3000/authority.html (log in with a host email and PIN; initial PIN `2026`)

> Service workers need HTTPS, except on `localhost`. To test on a phone, use the deployed HTTPS link.

### Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (Render sets it automatically) |
| `HOST_EMAILS` | `lokesh09006@gmail.com,alaharitarak@gmail.com` | Founding control-room hosts (comma-separated). Only hosts can change data |
| `INITIAL_PIN` | `2026` | First PIN for founding hosts; each host is asked to change it after logging in |
| `RESEND_API_KEY` / `NOTIFY_FROM` | empty | Optional: email all hosts when someone requests access (via resend.com). Without it, hosts get a sound + pop-up in the control room |
| `SESSION_SECRET` | random at boot | Signs control-room tokens (set it so logins survive restarts) |
| `SMS_NUMBER` | empty | Number that receives coded SOS SMS. If empty, the traveller picks a recipient (e.g. family); the SMS includes a Google Maps link so a person can read it |
| `TWILIO_AUTH_TOKEN` | empty | If set, `/api/sms/inbound` rejects requests without a valid Twilio signature |
| `PUBLIC_URL` | Render URL | Public base URL used for the Twilio signature check |
| `DATA_DIR` | `./data` | Where `db.json` is stored |

## 8. Deploy (step by step, about 5 minutes, free)

We deploy on **Render** (free web service, HTTPS included; HTTPS is required for the offline service worker).

1. Push this folder to a **public GitHub repository**.
2. Go to https://render.com → sign in with GitHub.
3. Click **New + → Blueprint**, choose your repository. Render reads `render.yaml`.
   *(Or **New + → Web Service** → pick the repo → Runtime **Node**, Build command `npm install`, Start command `node server.js`, Instance type **Free**.)*
4. Leave `SMS_NUMBER` empty or put your team phone number. Hosts come from `HOST_EMAILS` (defaults to the two team emails, initial PIN `2026`).
5. Click **Apply / Create**. After about 2 minutes you get `https://<your-app>.onrender.com`. Open `/api/health` and you should see `{"ok":true,...}`.
6. **Keep it awake** (Render free instances sleep after 15 minutes idle, and the first request then takes about 50 s): create a free monitor at https://uptimerobot.com → *HTTP(s)* → URL `https://<your-app>.onrender.com/api/health` → every 5 minutes.
7. Put the live link at the top of this README and in the submission form.

Other hosts: `Procfile` (Railway, Heroku-style) and `Dockerfile` (Koyeb, Fly.io, Cloud Run) are included. Any host that runs `node server.js` works.

**SMS gateway (optional, real SMS):** buy a number on Twilio, set its *"A message comes in"* webhook to `https://<your-app>.onrender.com/api/sms/inbound` (HTTP POST), set `SMS_NUMBER` to that number and `TWILIO_AUTH_TOKEN` to your Twilio auth token. Without Twilio, use the control room's **SMS gateway** tab to paste a received SMS. It goes through exactly the same parser and reply code.

## 9. How to try it (for judges, 2 minutes)

1. Open the live link on a phone → pick a language (try 日本語 or العربية).
2. If you are not in Chennai, tap **Demo location** → *Velachery* (inside a flooded zone) or *T. Nagar* (near one).
3. Read the alerts: the Tamil-language flood warning appears with instructions in your language; tap **Original official text** to see the untranslated Tamil.
4. Tap **Guide me** on the nearest shelter → compass.
5. Open the control room on a laptop (`/authority.html`; ask the team for a host login, or use **Request access** and a host approves you) → **Simulation → Start manual → Next step** and watch the phone update live.
6. On the phone: **SOS** → hold the button → in the control room, **Dispatch** → the phone shows "Help is on the way: about 20 min".
7. Turn on **airplane mode** → reload the app: it still opens, shows the saved data, and SOS moves straight to **SMS** then **112**. Submit a report offline → turn the network back on → it sends itself.

### Control-room access (hosts)

- Only **hosts** can change alerts, zones, shelters, transport, rumors, reports and SOS status. Travellers can only *send* reports and SOS; every `/api/admin/*` endpoint checks a signed host token.
- Founding hosts: the emails in `HOST_EMAILS`. Log in with email + PIN (initial `2026`); the console asks you to set your own PIN (stored as a salted scrypt hash).
- Anyone else opens `/authority.html` → **Request access** (name, email, reason, chosen PIN). All logged-in hosts get a sound and a pop-up, and an email if `RESEND_API_KEY` is set. Any host can **approve** or **reject** in the **👥 Hosts** tab, and remove added hosts. Founding hosts cannot be removed; a removed host loses access immediately.
- Brute-force protection: login is rate-limited per IP and per email.
- ⚠️ On Render's free plan the disk is temporary: after a restart or redeploy, approved hosts and changed PINs go back to the defaults. For permanent accounts, add `HOST_EMAILS` entries in Render → Environment, or attach a persistent disk / database.

## 10. Libraries, APIs and data (disclosure)

| What | Used for | License / terms |
|---|---|---|
| [Leaflet 1.9.4](https://leafletjs.com) (built from the official v1.9.4 source, vendored) | Interactive maps | BSD-2-Clause |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (vendored) | QR codes for the offline relay | MIT |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles | Map background | ODbL; [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) respected: small, user-triggered prefetch only (≤ 450 tiles) |
| [Open-Meteo](https://open-meteo.com) forecast API | Automatic weather card | CC BY 4.0, free, no API key |
| IMD rainfall categories | Weather thresholds | India Meteorological Department public criteria |
| Browser APIs | Service Worker, Cache Storage, IndexedDB, Background Sync, Geolocation, DeviceOrientation, Web Speech, Notifications, Web Share | Standard web platform |
| Node.js built-ins | `http`, `fs`, `crypto`, `zlib`, `node:test` | MIT |

No paid APIs, no API keys, no AI or machine-translation service at runtime. Translations of the fixed vocabulary were written by the team during the hackathon. In production they should be reviewed by native speakers.

## 11. Honest limitations and next steps

- **Demo data.** Shelter names, zones and alerts for Chennai are **demo data**, labelled in the app. Production would ingest IMD/Sachet **CAP feeds** (India's Common Alerting Protocol platform by NDMA) and city or state disaster authority data.
- **SMS needs a gateway number** (Twilio or an Indian SMS provider) to be fully automatic; the parser, the reply and the de-duplication are implemented and tested.
- **Route warnings use a straight line,** not road routing. That is deliberate (it works offline) and the app says so.
- **Free hosting disk is temporary:** data resets to the demo scenario on restart. Production would use a managed database.
- **Next:** India's Cell Broadcast system (C-DOT/NDMA) as an additional alert source; Bluetooth/Wi-Fi Direct mesh relay in a native wrapper; embassy notification; native-speaker review of all translations; more languages.

## 12. Project structure

```
server.js              HTTP server, routes, SSE, auth, static files (no dependencies)
src/store.js           JSON store with atomic saves and versioning
src/validate.js        input validation
src/sms.js             coded-SMS parser, TwiML, Twilio signature check
src/scenario.js        Chennai demo data and storm simulation timeline
public/index.html      traveller app
public/authority.html  control-room console
public/relay.html      QR relay page
public/sw.js           service worker
public/js/             core.js, app.js, map.js, ui.js, db.js, geo.js, i18n.js, i18n/*.js, smscode.js, authority.js, relay.js
public/vendor/         Leaflet, qrcode-generator (+ licenses)
test/                  geometry, SMS + translation, API tests
render.yaml            Render blueprint · Procfile · Dockerfile
DEMO_SCRIPT.md         script for the 2–5 minute demo video
```

## License

MIT. See [LICENSE](LICENSE). Vendored libraries keep their own licenses (`public/vendor/`).
