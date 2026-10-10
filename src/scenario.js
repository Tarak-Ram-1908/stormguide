'use strict';
/**
 * Demo scenarios for Chennai. ALL locations, names and numbers here are demo
 * data for the hackathon and are labelled as such in the UI. Polygons are
 * approximate. In production these would come from IMD / Sachet CAP feeds,
 * the city corporation and the State Disaster Management Authority.
 */

const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();

const REGION = {
  name: 'Chennai',
  center: [13.0475, 80.2400],
  zoom: 12,
  localLang: 'ta',
  timeZone: 'Asia/Kolkata',
  tzLabel: 'IST',
  demo: true
};

const DEMO_PLACES = [
  { id: 'egmore', name: 'Hotel area, Egmore', point: [13.0780, 80.2600] },
  { id: 'tnagar', name: 'T. Nagar shopping area', point: [13.0372, 80.2335] },
  { id: 'velachery', name: 'Velachery', point: [12.9790, 80.2200] },
  { id: 'marina', name: 'Marina Beach', point: [13.0500, 80.2830] }
];

const POLY = {
  chennai: [[13.155, 80.200], [13.150, 80.312], [12.980, 80.292], [12.900, 80.262], [12.880, 80.080], [12.980, 80.060], [13.100, 80.120]],
  south: [[13.036, 80.198], [13.036, 80.242], [12.958, 80.247], [12.958, 80.198]],
  coastAlert: [[13.110, 80.284], [13.110, 80.310], [12.960, 80.290], [12.960, 80.262], [13.040, 80.274]],
  velachery: [[12.9905, 80.2105], [12.9890, 80.2290], [12.9760, 80.2330], [12.9680, 80.2240], [12.9700, 80.2120], [12.9800, 80.2070]],
  saidapet: [[13.0285, 80.2140], [13.0270, 80.2300], [13.0180, 80.2330], [13.0160, 80.2200], [13.0200, 80.2120]],
  mudichur: [[12.9180, 80.0600], [12.9170, 80.0800], [12.9030, 80.0820], [12.9020, 80.0620]],
  marina: [[13.095, 80.2895], [13.095, 80.3000], [13.000, 80.2840], [12.995, 80.2730], [13.040, 80.2790], [13.070, 80.2840]],
  annaNagar: [[13.095, 80.200], [13.095, 80.222], [13.077, 80.222], [13.077, 80.200]]
};

function shelters() {
  return [
    { id: 'sh-egmore', name: 'Corporation Hr. Sec. School, Egmore', lat: 13.0745, lng: 80.2605, capacity: 400, occupancy: 210, stepFree: true, amenities: ['water', 'food', 'toilets', 'power'], status: 'open' },
    { id: 'sh-nehru', name: 'Indoor Stadium relief centre, Periamet', lat: 13.0860, lng: 80.2712, capacity: 1500, occupancy: 640, stepFree: true, amenities: ['water', 'food', 'toilets', 'power', 'medical', 'wifi'], status: 'open' },
    { id: 'sh-guindy', name: 'Community Hall, Guindy', lat: 13.0100, lng: 80.2120, capacity: 300, occupancy: 180, stepFree: true, amenities: ['water', 'toilets'], status: 'open' },
    { id: 'sh-tnagar', name: 'Community Hall, T. Nagar', lat: 13.0418, lng: 80.2341, capacity: 250, occupancy: 90, stepFree: false, amenities: ['water', 'food', 'toilets'], status: 'open' },
    { id: 'sh-velachery', name: 'Govt. School, Velachery', lat: 12.9805, lng: 80.2205, capacity: 300, occupancy: 0, stepFree: true, amenities: ['water', 'toilets'], status: 'open' },
    { id: 'sh-tambaram', name: 'Municipal School, Tambaram', lat: 12.9249, lng: 80.1170, capacity: 350, occupancy: 120, stepFree: true, amenities: ['water', 'food', 'toilets'], status: 'open' },
    { id: 'sh-annanagar', name: 'Community Centre, Anna Nagar', lat: 13.0870, lng: 80.2110, capacity: 500, occupancy: 150, stepFree: true, amenities: ['water', 'food', 'toilets', 'medical', 'power'], status: 'open' },
    { id: 'sh-mylapore', name: 'Marriage hall relief centre, Mylapore', lat: 13.0340, lng: 80.2680, capacity: 200, occupancy: 60, stepFree: false, amenities: ['water', 'food'], status: 'open' }
  ];
}

function transport(now) {
  return [
    { id: 'metro-blue', mode: 'metro', name: 'Chennai Metro — Blue Line', status: 'normal', updatedAt: iso(now) },
    { id: 'metro-green', mode: 'metro', name: 'Chennai Metro — Green Line', status: 'normal', updatedAt: iso(now) },
    { id: 'mrts', mode: 'train', name: 'MRTS (Beach – Velachery)', status: 'normal', updatedAt: iso(now) },
    { id: 'suburban', mode: 'train', name: 'Suburban train (Beach – Tambaram)', status: 'normal', updatedAt: iso(now) },
    { id: 'mtc', mode: 'bus', name: 'MTC city buses', status: 'normal', updatedAt: iso(now) },
    { id: 'airport', mode: 'airport', name: 'Chennai Airport (MAA)', status: 'normal', updatedAt: iso(now) }
  ];
}

const ALERT_TEMPLATES = {
  rain(now, severity) {
    return {
      id: 'imd-rain', msgType: 'Alert', revision: 1, event: 'heavy_rain', severity,
      source: 'India Meteorological Department, RMC Chennai (demo)',
      originalLang: 'en',
      headline: severity === 'Moderate'
        ? 'Orange alert: Heavy to very heavy rainfall likely over Chennai, Tiruvallur, Chengalpattu and Kancheepuram'
        : 'Red alert: Extremely heavy rainfall likely over Chennai, Tiruvallur, Chengalpattu and Kancheepuram',
      description: 'Heavy to very heavy rainfall with extremely heavy falls at isolated places likely during the next 24 hours. Surface wind speed 40-50 kmph gusting to 60 kmph. Fishermen are advised not to venture into the sea.',
      instructions: severity === 'Moderate'
        ? ['charge_phone', 'keep_supplies', 'check_transport']
        : ['stay_indoors', 'no_travel', 'charge_phone', 'keep_supplies', 'avoid_coast'],
      area: { name: 'Chennai metropolitan area', polygon: POLY.chennai },
      onset: iso(now - 1 * H), expires: iso(now + 21 * H), issuedAt: iso(now - 1 * H), updatedAt: iso(now)
    };
  },
  flood(now) {
    return {
      id: 'gcc-flood', msgType: 'Alert', revision: 1, event: 'flood', severity: 'Extreme',
      source: 'Greater Chennai Corporation (demo)',
      originalLang: 'ta',
      headline: 'வேளச்சேரி, சைதாப்பேட்டை பகுதிகளில் வெள்ள அபாயம்',
      description: 'அடையாறு ஆற்றில் நீர்வரத்து அதிகரித்துள்ளதால் தாழ்வான பகுதிகளில் வசிப்போர் உடனடியாக அருகிலுள்ள நிவாரண முகாம்களுக்குச் செல்லவும். வெள்ள நீரில் நடக்கவோ வாகனம் ஓட்டவோ வேண்டாம். மின் கம்பிகளிலிருந்து விலகி இருக்கவும்.',
      instructions: ['move_higher', 'go_shelter', 'avoid_water', 'power_lines'],
      area: { name: 'Velachery, Saidapet, Guindy (south Chennai)', polygon: POLY.south },
      onset: iso(now - 0.5 * H), expires: iso(now + 12 * H), issuedAt: iso(now - 0.5 * H), updatedAt: iso(now)
    };
  },
  surge(now) {
    return {
      id: 'tnsdma-surge', msgType: 'Alert', revision: 1, event: 'storm_surge', severity: 'Severe',
      source: 'Tamil Nadu State Disaster Management Authority (demo)',
      originalLang: 'en',
      headline: 'Storm surge warning for the Chennai coastline',
      description: 'Sea waves of 2-3 m are expected along Marina, Besant Nagar and Thiruvanmiyur beaches. The public must not visit beaches until further notice.',
      instructions: ['avoid_coast', 'follow_officials', 'move_higher'],
      area: { name: 'Chennai coastline', polygon: POLY.coastAlert },
      onset: iso(now - 2 * H), expires: iso(now + 18 * H), issuedAt: iso(now - 2 * H), updatedAt: iso(now)
    };
  }
};

const ZONES = {
  velachery: (now) => ({ id: 'z-velachery', kind: 'flooded', name: 'Velachery low-lying area', polygon: POLY.velachery, updatedAt: iso(now) }),
  saidapet: (now) => ({ id: 'z-saidapet', kind: 'flooded', name: 'Saidapet (Adyar riverbank)', polygon: POLY.saidapet, updatedAt: iso(now) }),
  mudichur: (now) => ({ id: 'z-mudichur', kind: 'flooded', name: 'Mudichur', polygon: POLY.mudichur, updatedAt: iso(now) }),
  marina: (now) => ({ id: 'z-marina', kind: 'unsafe', name: 'Marina beach (storm surge)', polygon: POLY.marina, updatedAt: iso(now) }),
  annaNagar: (now) => ({ id: 'z-annanagar', kind: 'safe', name: 'Anna Nagar (no flooding reported)', polygon: POLY.annaNagar, updatedAt: iso(now) })
};

const CLOSURES = {
  madley: (now) => ({ id: 'c-madley', name: 'Madley Road subway, T. Nagar', path: [[13.0378, 80.2268], [13.0392, 80.2290], [13.0405, 80.2310]], updatedAt: iso(now) }),
  velacheryMain: (now) => ({ id: 'c-velachery', name: 'Velachery Main Road', path: [[12.9850, 80.2160], [12.9790, 80.2210], [12.9740, 80.2250]], updatedAt: iso(now) }),
  saidapetBridge: (now) => ({ id: 'c-saidapet', name: 'Saidapet bridge approach', path: [[13.0215, 80.2250], [13.0245, 80.2235]], updatedAt: iso(now) })
};

const RUMORS = {
  dam: (now) => ({ id: 'rm-dam', topic: 'dam_burst', verdict: 'false', claim: 'Forwarded message: "Chembarambakkam lake has burst! All of Chennai will be under water in 1 hour!"', createdAt: iso(now) }),
  airport: (now) => ({ id: 'rm-airport', topic: 'airport_closed', verdict: 'false', claim: 'Chennai airport is closed and all flights are cancelled.', createdAt: iso(now) }),
  water: (now) => ({ id: 'rm-water', topic: 'water_unsafe', verdict: 'unverified', claim: 'Piped water in south Chennai is contaminated.', createdAt: iso(now) }),
  mrts: (now) => ({ id: 'rm-mrts', topic: 'transport_stopped', verdict: 'true', claim: 'MRTS trains between Beach and Velachery have stopped.', createdAt: iso(now) })
};

function setTransport(state, id, status, now) {
  const t = state.transport.find(x => x.id === id);
  if (t) { t.status = status; t.updatedAt = iso(now); }
}
function setShelter(state, id, patch) {
  const s = state.shelters.find(x => x.id === id);
  if (s) Object.assign(s, patch);
}
function upsert(list, item) {
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}

function base(now) {
  return {
    scenario: 'chennai-calm',
    region: REGION,
    demoPlaces: DEMO_PLACES,
    alerts: [], zones: [], closures: [], reports: [], rumors: [],
    shelters: shelters(),
    transport: transport(now)
  };
}

function build(name, now = Date.now()) {
  const s = base(now);
  if (name === 'chennai-calm') return s;
  // Full flood scenario.
  s.scenario = 'chennai-flood';
  s.alerts = [ALERT_TEMPLATES.rain(now, 'Severe'), ALERT_TEMPLATES.flood(now), ALERT_TEMPLATES.surge(now)];
  s.zones = [ZONES.velachery(now), ZONES.saidapet(now), ZONES.mudichur(now), ZONES.marina(now), ZONES.annaNagar(now)];
  s.closures = [CLOSURES.madley(now), CLOSURES.velacheryMain(now), CLOSURES.saidapetBridge(now)];
  s.rumors = [RUMORS.dam(now), RUMORS.airport(now), RUMORS.water(now), RUMORS.mrts(now)];
  setTransport(s, 'metro-green', 'delayed', now);
  setTransport(s, 'mrts', 'suspended', now);
  setTransport(s, 'suburban', 'delayed', now);
  setTransport(s, 'mtc', 'delayed', now);
  setShelter(s, 'sh-velachery', { status: 'closed', occupancy: 0 });
  setShelter(s, 'sh-guindy', { status: 'full', occupancy: 300 });
  s.reports = [
    { id: 'seed-r1', type: 'flooding', lat: 13.0230, lng: 80.2230, note: 'Water knee-deep near Saidapet market', people: 0, status: 'verified', confirmations: 6, createdAt: iso(now - 0.7 * H), via: 'web' },
    { id: 'seed-r2', type: 'road_blocked', lat: 13.0060, lng: 80.2570, note: 'Tree fallen across the road', people: 0, status: 'unverified', confirmations: 2, createdAt: iso(now - 0.4 * H), via: 'web' },
    { id: 'seed-r3', type: 'power_line', lat: 13.0330, lng: 80.2690, note: 'Electric wire hanging low near temple tank', people: 0, status: 'unverified', confirmations: 1, createdAt: iso(now - 0.2 * H), via: 'sms' },
    { id: 'seed-r4', type: 'flooding', lat: 13.0780, lng: 80.2610, note: 'Egmore station fully flooded', people: 0, status: 'false', confirmations: 0, createdAt: iso(now - 1.1 * H), via: 'web' }
  ];
  return s;
}

/**
 * Scripted storm timeline for live demos. Each step mutates state in place.
 * Starts from 'chennai-calm'.
 */
const TIMELINE = [
  {
    label: 'IMD issues an orange alert for heavy rain',
    apply(s, now) { upsert(s.alerts, ALERT_TEMPLATES.rain(now, 'Moderate')); }
  },
  {
    label: 'Upgraded to red alert; storm surge warning for the coast',
    apply(s, now) {
      const prev = s.alerts.find(a => a.id === 'imd-rain');
      const a = ALERT_TEMPLATES.rain(now, 'Severe');
      a.msgType = 'Update'; a.revision = (prev ? prev.revision : 0) + 1;
      upsert(s.alerts, a);
      upsert(s.alerts, ALERT_TEMPLATES.surge(now));
      upsert(s.zones, ZONES.marina(now));
      setTransport(s, 'mrts', 'delayed', now);
    }
  },
  {
    label: 'Flooding in Velachery: Tamil-language flood alert, road closed, MRTS suspended',
    apply(s, now) {
      upsert(s.alerts, ALERT_TEMPLATES.flood(now));
      upsert(s.zones, ZONES.velachery(now));
      upsert(s.closures, CLOSURES.velacheryMain(now));
      setTransport(s, 'mrts', 'suspended', now);
      setShelter(s, 'sh-velachery', { status: 'closed', occupancy: 0 });
    }
  },
  {
    label: 'Flooding spreads to Saidapet; Guindy shelter full; Madley subway closed',
    apply(s, now) {
      upsert(s.zones, ZONES.saidapet(now));
      upsert(s.closures, CLOSURES.madley(now));
      upsert(s.closures, CLOSURES.saidapetBridge(now));
      setShelter(s, 'sh-guindy', { status: 'full', occupancy: 300 });
      setShelter(s, 'sh-egmore', { occupancy: 330 });
      setTransport(s, 'suburban', 'delayed', now);
      setTransport(s, 'mtc', 'delayed', now);
      upsert(s.reports, { id: 'sim-r1', type: 'flooding', lat: 13.0230, lng: 80.2230, note: 'Water knee-deep near Saidapet market', people: 0, status: 'verified', confirmations: 4, createdAt: iso(now), via: 'web' });
    }
  },
  {
    label: 'Rumors spread on messaging apps; officials mark them false',
    apply(s, now) { upsert(s.rumors, RUMORS.dam(now)); upsert(s.rumors, RUMORS.airport(now)); upsert(s.zones, ZONES.annaNagar(now)); }
  },
  {
    label: 'All clear: warnings cancelled, roads reopen, transport resumes',
    apply(s, now) {
      s.alerts.forEach(a => {
        a.msgType = 'Cancel'; a.revision += 1; a.instructions = ['all_clear']; a.updatedAt = iso(now);
        a.expires = iso(now + 1 * H);
      });
      s.zones = s.zones.filter(z => z.kind === 'safe');
      s.closures = [];
      s.transport.forEach(t => { t.status = 'normal'; t.updatedAt = iso(now); });
      s.shelters.forEach(sh => { if (sh.status !== 'open') sh.status = 'open'; });
    }
  }
];

module.exports = { build, TIMELINE, REGION, DEMO_PLACES, POLY };
