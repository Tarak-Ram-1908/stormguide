# StormGuide demo video script (target 3:30, hard limit 5:00)

**Setup before recording**
- Laptop: control room `https://<your-app>.onrender.com/authority.html`, logged in (PIN). Open it 2 minutes before so the free server is awake.
- Phone (screen-mirrored or screen-recorded): the traveller app, opened once while online, language **Français** (or 日本語). Demo location **T. Nagar**.
- Control room → Simulation → **Start manual** (calm city). Phone now shows "No active official alerts".
- Record at 1080p. Speak slowly. Show the phone and the laptop side by side if possible.

---

**0:00–0:25 · The problem** (talking over the phone home screen)
> "Chennai, during a cyclone. A French tourist gets warnings in Tamil from four different agencies, doesn't know which streets are flooded, sees WhatsApp rumors, and mobile data is dropping. That's our TravelTech problem. This is StormGuide."

**0:25–1:10 · Live, translated official alerts**
- Laptop: **Next step** (orange alert) → phone updates in about a second, no reload. Point at the green "En direct" pill.
- **Next step** twice → red alert, storm surge, then the **Tamil** flood alert from the city corporation.
- Phone: open the flood alert → instructions in French → tap **"Texte officiel original (தமிழ்)"**.
> "We never machine-translate a warning. Officials pick instructions from a fixed list that is pre-translated into 9 languages, so translation can't change the meaning, and the original official text is always one tap away."
- Tap **Écouter** (read aloud) for 2 seconds.

**1:10–1:40 · Personal risk + shelter**
- Laptop: **Next step** (flooding spreads to Saidapet). Phone: risk card turns orange, "Zone dangereuse à 1.2 km". Switch demo location to **Velachery** → red: "Vous êtes dans une zone dangereuse".
- Nearest open shelter (full and flooded shelters are skipped; a warning appears if the straight line crosses a flooded zone or closed road) → **Guidez-moi** → compass.
> "Your location never leaves the phone: the server only publishes the zones and the phone does the maths. It works offline."

**1:40–2:30 · SOS: internet → SMS → 112**
- Phone: **SOS** tab → 2 people, "Bloqué" → hold the button.
- Laptop: SOS appears with a beep → **Dispatch 20 min** → phone: "Les secours arrivent — environ 20 min".
- Now **airplane mode** on the phone → **Nouvelle demande** → hold SOS → step 1 is skipped, **Open SMS** shows the coded message with location and language.
- Laptop: SMS gateway tab → type the SMS shown on the phone (or use the prefilled sample) → **Process SMS** → reply comes back in French; the SOS shows *via sms*.
> "Same request ID on every channel, so the control room sees one request, not three. If SMS fails, 112 is one tap away. With no signal at all, the phone shows a QR code: anyone nearby scans it and their phone forwards the SOS."
- Show the QR for 2 seconds.

**2:30–3:05 · Fully offline**
- Still in airplane mode: close and reopen the app → it opens, "Hors ligne — mises à jour enregistrées · il y a 1 min".
- **Signaler** → Inondation → send → "Enregistré sur votre téléphone…" → airplane mode off → report sends itself (it appears on the laptop).

**3:05–3:25 · Rumors + control room**
- Laptop: **Next step** (rumors, step 5) → phone: "Rupture de barrage — FAUX".
- Laptop: Reports tab → **Verify + mark zone** on the new report → zone appears on the phone map.

**3:25–3:40 · Close**
> "Zero-dependency Node server, offline-first PWA, 9 languages including Arabic right-to-left, 28 automated tests, deployed on Render. StormGuide: the right warning, in your language, even when the network fails."
- Show the GitHub repo and the live URL.

---

**Checklist:** video ≤ 5 min · uploaded to the repo (`demo/StormGuide-demo.mp4`, or link it if over GitHub's 100 MB limit) · live URL works in an incognito window · README links updated.
