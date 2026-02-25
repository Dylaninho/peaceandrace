// ============================================================
//  🏎️  F1 DISCORD BOT  v2  —  index.js
//  npm install discord.js mongoose node-cron dotenv
// ============================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder,
        SlashCommandBuilder, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const cron     = require('node-cron');
const http     = require('http');   // keep-alive ping

// ─── ENV (.env) ──────────────────────────────────────────────
// DISCORD_TOKEN=...
// CLIENT_ID=...
// GUILD_ID=...
// MONGODB_URI=mongodb://localhost:27017/f1bot
// RACE_CHANNEL_ID=...
// PORT=3000   (optionnel, pour le keep-alive)
// ─────────────────────────────────────────────────────────────

const TOKEN        = process.env.DISCORD_TOKEN;
const CLIENT_ID    = process.env.CLIENT_ID;
const GUILD_ID     = process.env.GUILD_ID;
const MONGO_URI    = process.env.MONGODB_URI || 'mongodb://localhost:27017/f1bot';
const RACE_CHANNEL = process.env.RACE_CHANNEL_ID;
const PORT         = process.env.PORT || 3000;

// ============================================================
// ██╗  ██╗███████╗███████╗██████╗      █████╗ ██╗     ██╗██╗   ██╗███████╗
// ██║ ██╔╝██╔════╝██╔════╝██╔══██╗    ██╔══██╗██║     ██║██║   ██║██╔════╝
// █████╔╝ █████╗  █████╗  ██████╔╝    ███████║██║     ██║██║   ██║█████╗
// ██╔═██╗ ██╔══╝  ██╔══╝  ██╔═══╝     ██╔══██║██║     ██║╚██╗ ██╔╝██╔══╝
// ██║  ██╗███████╗███████╗██║         ██║  ██║███████╗██║ ╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝         ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝  ╚══════╝
// ── Keep-alive HTTP server (ping toutes les 15min) ──────────
// ============================================================

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('F1 Bot is alive 🏎️');
});
server.listen(PORT, () => console.log(`✅ Keep-alive server sur port ${PORT}`));

// Auto-ping toutes les 15 minutes pour éviter la mise en veille (ex: Render/Railway)
cron.schedule('*/15 * * * *', () => {
  http.get(`http://localhost:${PORT}/ping`, (res) => {
    console.log(`🔔 Keep-alive ping — ${new Date().toLocaleTimeString()}`);
  }).on('error', () => {});
});

// ============================================================
// ███████╗ ██████╗██╗  ██╗███████╗███╗   ███╗ █████╗ ███████╗
// ██╔════╝██╔════╝██║  ██║██╔════╝████╗ ████║██╔══██╗██╔════╝
// ███████╗██║     ███████║█████╗  ██╔████╔██║███████║███████╗
// ╚════██║██║     ██╔══██║██╔══╝  ██║╚██╔╝██║██╔══██║╚════██║
// ███████║╚██████╗██║  ██║███████╗██║ ╚═╝ ██║██║  ██║███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝
// ============================================================

// ── Pilot ──────────────────────────────────────────────────
const PilotSchema = new mongoose.Schema({
  discordId    : { type: String, required: true, unique: true },
  name         : { type: String, required: true },
  // Stats pilote (0-100) — influencent directement la simulation
  depassement  : { type: Number, default: 50 },  // overtaking en ligne droite / attaque
  freinage     : { type: Number, default: 50 },  // performance en zone de freinage tardif
  defense      : { type: Number, default: 50 },  // résistance aux dépassements subis
  adaptabilite : { type: Number, default: 50 },  // adaptation aux conditions changeantes (météo, SC)
  reactions    : { type: Number, default: 50 },  // départ, réaction aux incidents, opportunisme
  controle     : { type: Number, default: 50 },  // consistance sur un tour, gestion des limites de piste
  gestionPneus : { type: Number, default: 50 },  // préservation des pneus, fenêtre de fonctionnement
  // Économie
  plcoins      : { type: Number, default: 500 },
  totalEarned  : { type: Number, default: 0 },
  // État
  teamId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  createdAt    : { type: Date, default: Date.now },
});
const Pilot = mongoose.model('Pilot', PilotSchema);

// ── Team ───────────────────────────────────────────────────
const TeamSchema = new mongoose.Schema({
  name         : String,
  emoji        : String,
  color        : String,
  budget       : { type: Number, default: 100 },
  // Stats voiture (0-100) — évoluent en cours de saison
  vitesseMax       : { type: Number, default: 75 },  // performance en ligne droite
  drs              : { type: Number, default: 75 },  // efficacité DRS
  refroidissement  : { type: Number, default: 75 },  // performance en conditions chaudes / dégradation moteur
  dirtyAir         : { type: Number, default: 75 },  // vitesse derrière une autre voiture
  conservationPneus: { type: Number, default: 75 },  // usure pneus côté châssis
  vitesseMoyenne   : { type: Number, default: 75 },  // vitesse globale en courbe
  // Ressources disponibles pour développement en cours de saison
  devPoints        : { type: Number, default: 0 },
});
const Team = mongoose.model('Team', TeamSchema);

// ── Contract ───────────────────────────────────────────────
const ContractSchema = new mongoose.Schema({
  pilotId          : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  teamId           : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  seasonsDuration  : { type: Number, default: 1 },
  seasonsRemaining : { type: Number, default: 1 },
  // Financier
  coinMultiplier   : { type: Number, default: 1.0 },   // multiplicateur PLcoins sur résultats
  primeVictoire    : { type: Number, default: 0 },      // PLcoins bonus par victoire
  primePodium      : { type: Number, default: 0 },      // PLcoins bonus par podium
  salaireBase      : { type: Number, default: 100 },    // PLcoins fixes par course disputée
  active           : { type: Boolean, default: true },
  signedAt         : { type: Date, default: Date.now },
});
const Contract = mongoose.model('Contract', ContractSchema);

// ── TransferOffer ──────────────────────────────────────────
const TransferOfferSchema = new mongoose.Schema({
  teamId           : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  pilotId          : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  coinMultiplier   : { type: Number, default: 1.0 },
  primeVictoire    : { type: Number, default: 0 },
  primePodium      : { type: Number, default: 0 },
  salaireBase      : { type: Number, default: 100 },
  seasons          : { type: Number, default: 1 },
  status           : { type: String, enum: ['pending','accepted','rejected','expired'], default: 'pending' },
  expiresAt        : Date,
});
const TransferOffer = mongoose.model('TransferOffer', TransferOfferSchema);

// ── Season ─────────────────────────────────────────────────
const SeasonSchema = new mongoose.Schema({
  year             : Number,
  status           : { type: String, enum: ['upcoming','active','transfer','finished'], default: 'upcoming' },
  regulationSet    : { type: Number, default: 1 },
  currentRaceIndex : { type: Number, default: 0 },
});
const Season = mongoose.model('Season', SeasonSchema);

// ── Race ───────────────────────────────────────────────────
const RaceSchema = new mongoose.Schema({
  seasonId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  index         : Number,
  circuit       : String,
  country       : String,
  emoji         : String,
  laps          : { type: Number, default: 50 },
  gpStyle       : { type: String, enum: ['urbain','mixte','rapide','technique','endurance'], default: 'mixte' },
  scheduledDate : Date,
  status        : { type: String, enum: ['upcoming','practice_done','quali_done','done'], default: 'upcoming' },
  qualiGrid     : { type: Array, default: [] },
  raceResults   : { type: Array, default: [] },
});
const Race = mongoose.model('Race', RaceSchema);

// ── Championship ───────────────────────────────────────────
const StandingSchema = new mongoose.Schema({
  seasonId : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  pilotId  : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  points   : { type: Number, default: 0 },
  wins     : { type: Number, default: 0 },
  podiums  : { type: Number, default: 0 },
  dnfs     : { type: Number, default: 0 },
});
const Standing = mongoose.model('Standing', StandingSchema);

// ── ConstructorStanding ────────────────────────────────────
const ConstructorSchema = new mongoose.Schema({
  seasonId : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  teamId   : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  points   : { type: Number, default: 0 },
});
const ConstructorStanding = mongoose.model('ConstructorStanding', ConstructorSchema);

// ============================================================
// ████████╗███████╗ █████╗ ███╗   ███╗███████╗     ██████╗  █████╗ ████████╗ █████╗
// ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔════╝    ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗
//    ██║   █████╗  ███████║██╔████╔██║███████╗    ██║  ██║███████║   ██║   ███████║
//    ██║   ██╔══╝  ██╔══██║██║╚██╔╝██║╚════██║    ██║  ██║██╔══██║   ██║   ██╔══██║
//    ██║   ███████╗██║  ██║██║ ╚═╝ ██║███████║    ██████╔╝██║  ██║   ██║   ██║  ██║
//    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
// ============================================================

const DEFAULT_TEAMS = [
  { name:'Red Horizon',   emoji:'🔵', color:'#1E3A5F', budget:160,
    vitesseMax:95, drs:95, refroidissement:90, dirtyAir:88, conservationPneus:88, vitesseMoyenne:93, devPoints:0 },
  { name:'Scuderia Alfa', emoji:'🔴', color:'#DC143C', budget:150,
    vitesseMax:92, drs:90, refroidissement:88, dirtyAir:85, conservationPneus:85, vitesseMoyenne:90, devPoints:0 },
  { name:'Silver Arrow',  emoji:'⚪', color:'#C0C0C0', budget:145,
    vitesseMax:90, drs:88, refroidissement:92, dirtyAir:82, conservationPneus:87, vitesseMoyenne:88, devPoints:0 },
  { name:'McLaren PL',    emoji:'🟠', color:'#FF7722', budget:130,
    vitesseMax:85, drs:84, refroidissement:82, dirtyAir:80, conservationPneus:83, vitesseMoyenne:85, devPoints:0 },
  { name:'Aston Speed',   emoji:'🟢', color:'#006400', budget:120,
    vitesseMax:80, drs:80, refroidissement:80, dirtyAir:78, conservationPneus:80, vitesseMoyenne:80, devPoints:0 },
  { name:'Alpine Bleu',   emoji:'💙', color:'#0066CC', budget:110,
    vitesseMax:75, drs:76, refroidissement:78, dirtyAir:75, conservationPneus:76, vitesseMoyenne:76, devPoints:0 },
  { name:'Williams PL',   emoji:'🔷', color:'#00B4D8', budget:90,
    vitesseMax:70, drs:71, refroidissement:74, dirtyAir:70, conservationPneus:72, vitesseMoyenne:70, devPoints:0 },
  { name:'Haas PL',       emoji:'⬜', color:'#AAAAAA', budget:75,
    vitesseMax:65, drs:65, refroidissement:68, dirtyAir:65, conservationPneus:67, vitesseMoyenne:65, devPoints:0 },
  { name:'Sauber PL',     emoji:'🟤', color:'#8B4513', budget:60,
    vitesseMax:60, drs:60, refroidissement:63, dirtyAir:60, conservationPneus:62, vitesseMoyenne:60, devPoints:0 },
  { name:'RB Junior',     emoji:'🟡', color:'#FFD700', budget:50,
    vitesseMax:55, drs:56, refroidissement:58, dirtyAir:55, conservationPneus:57, vitesseMoyenne:55, devPoints:0 },
];

// ── Circuits avec style de GP ──────────────────────────────
// gpStyle influence quelles stats voiture/pilote sont amplifiées
const CIRCUITS = [
  { circuit:'Bahrain GP',        country:'Bahreïn',         emoji:'🇧🇭', laps:57, gpStyle:'technique'  },
  { circuit:'Saudi Arabian GP',  country:'Arabie Saoudite', emoji:'🇸🇦', laps:50, gpStyle:'rapide'     },
  { circuit:'Australian GP',     country:'Australie',       emoji:'🇦🇺', laps:58, gpStyle:'mixte'      },
  { circuit:'Japanese GP',       country:'Japon',           emoji:'🇯🇵', laps:53, gpStyle:'technique'  },
  { circuit:'Chinese GP',        country:'Chine',           emoji:'🇨🇳', laps:56, gpStyle:'mixte'      },
  { circuit:'Miami GP',          country:'États-Unis',      emoji:'🇺🇸', laps:57, gpStyle:'urbain'     },
  { circuit:'Emilia Romagna GP', country:'Italie',          emoji:'🇮🇹', laps:63, gpStyle:'mixte'      },
  { circuit:'Monaco GP',         country:'Monaco',          emoji:'🇲🇨', laps:78, gpStyle:'urbain'     },
  { circuit:'Canadian GP',       country:'Canada',          emoji:'🇨🇦', laps:70, gpStyle:'mixte'      },
  { circuit:'Spanish GP',        country:'Espagne',         emoji:'🇪🇸', laps:66, gpStyle:'technique'  },
  { circuit:'Austrian GP',       country:'Autriche',        emoji:'🇦🇹', laps:71, gpStyle:'rapide'     },
  { circuit:'British GP',        country:'Royaume-Uni',     emoji:'🇬🇧', laps:52, gpStyle:'rapide'     },
  { circuit:'Hungarian GP',      country:'Hongrie',         emoji:'🇭🇺', laps:70, gpStyle:'technique'  },
  { circuit:'Belgian GP',        country:'Belgique',        emoji:'🇧🇪', laps:44, gpStyle:'rapide'     },
  { circuit:'Dutch GP',          country:'Pays-Bas',        emoji:'🇳🇱', laps:72, gpStyle:'technique'  },
  { circuit:'Italian GP',        country:'Italie',          emoji:'🇮🇹', laps:53, gpStyle:'rapide'     },
  { circuit:'Azerbaijan GP',     country:'Azerbaïdjan',     emoji:'🇦🇿', laps:51, gpStyle:'urbain'     },
  { circuit:'Singapore GP',      country:'Singapour',       emoji:'🇸🇬', laps:62, gpStyle:'urbain'     },
  { circuit:'COTA GP',           country:'États-Unis',      emoji:'🇺🇸', laps:56, gpStyle:'mixte'      },
  { circuit:'Mexican GP',        country:'Mexique',         emoji:'🇲🇽', laps:71, gpStyle:'endurance'  },
  { circuit:'Brazilian GP',      country:'Brésil',          emoji:'🇧🇷', laps:71, gpStyle:'endurance'  },
  { circuit:'Vegas GP',          country:'États-Unis',      emoji:'🇺🇸', laps:50, gpStyle:'rapide'     },
  { circuit:'Qatar GP',          country:'Qatar',           emoji:'🇶🇦', laps:57, gpStyle:'endurance'  },
  { circuit:'Abu Dhabi GP',      country:'Abu Dhabi',       emoji:'🇦🇪', laps:58, gpStyle:'mixte'      },
];

// Points F1
const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// ============================================================
// ███╗   ███╗ ██████╗ ████████╗███████╗██╗   ██╗██████╗
// ████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝██║   ██║██╔══██╗
// ██╔████╔██║██║   ██║   ██║   █████╗  ██║   ██║██████╔╝
// ██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  ██║   ██║██╔══██╗
// ██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗╚██████╔╝██║  ██║
// ╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
// ============================================================

const TIRE = {
  SOFT  : { grip: 1.00, deg: 0.028, emoji: '🔴', label: 'Soft'   },
  MEDIUM: { grip: 0.94, deg: 0.016, emoji: '🟡', label: 'Medium' },
  HARD  : { grip: 0.87, deg: 0.008, emoji: '⚪', label: 'Hard'   },
  INTER : { grip: 0.91, deg: 0.013, emoji: '🟢', label: 'Inter'  },
  WET   : { grip: 0.85, deg: 0.010, emoji: '🔵', label: 'Wet'    },
};

// ─── Poids des stats selon le style de GP ─────────────────
// Chaque style amplifie certaines stats voiture et pilote
const GP_STYLE_WEIGHTS = {
  urbain: {
    car:   { vitesseMoyenne: 1.0, drs: 0.4, refroidissement: 0.8, dirtyAir: 1.2, conservationPneus: 1.1, vitesseMax: 0.5 },
    pilot: { depassement: 0.7, freinage: 1.4, defense: 1.3, adaptabilite: 1.0, reactions: 1.2, controle: 1.4, gestionPneus: 1.0 },
  },
  rapide: {
    car:   { vitesseMoyenne: 0.8, drs: 1.4, refroidissement: 1.0, dirtyAir: 0.9, conservationPneus: 0.8, vitesseMax: 1.5 },
    pilot: { depassement: 1.3, freinage: 0.8, defense: 0.9, adaptabilite: 0.9, reactions: 1.1, controle: 0.9, gestionPneus: 0.8 },
  },
  technique: {
    car:   { vitesseMoyenne: 1.3, drs: 0.7, refroidissement: 0.9, dirtyAir: 1.0, conservationPneus: 1.2, vitesseMax: 0.7 },
    pilot: { depassement: 0.8, freinage: 1.3, defense: 1.0, adaptabilite: 1.1, reactions: 0.9, controle: 1.5, gestionPneus: 1.1 },
  },
  mixte: {
    car:   { vitesseMoyenne: 1.0, drs: 1.0, refroidissement: 1.0, dirtyAir: 1.0, conservationPneus: 1.0, vitesseMax: 1.0 },
    pilot: { depassement: 1.0, freinage: 1.0, defense: 1.0, adaptabilite: 1.0, reactions: 1.0, controle: 1.0, gestionPneus: 1.0 },
  },
  endurance: {
    car:   { vitesseMoyenne: 0.9, drs: 0.9, refroidissement: 1.4, dirtyAir: 0.9, conservationPneus: 1.5, vitesseMax: 0.9 },
    pilot: { depassement: 0.8, freinage: 0.9, defense: 1.0, adaptabilite: 1.2, reactions: 0.8, controle: 1.0, gestionPneus: 1.5 },
  },
};

function rand(min, max)     { return Math.random() * (max - min) + min; }
function randInt(min, max)  { return Math.floor(rand(min, max + 1)); }
function pick(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ─── Score voiture pondéré selon le style de GP ───────────
// Retourne un score 0-100 représentant la performance de la voiture sur ce circuit
function carScore(team, gpStyle) {
  const w = GP_STYLE_WEIGHTS[gpStyle].car;
  const total = Object.values(w).reduce((a,b) => a+b, 0);
  const score =
    (team.vitesseMax        * w.vitesseMax +
     team.drs               * w.drs +
     team.refroidissement   * w.refroidissement +
     team.dirtyAir          * w.dirtyAir +
     team.conservationPneus * w.conservationPneus +
     team.vitesseMoyenne    * w.vitesseMoyenne) / total;
  return score;
}

// ─── Score pilote pondéré selon le style de GP ────────────
function pilotScore(pilot, gpStyle) {
  const w = GP_STYLE_WEIGHTS[gpStyle].pilot;
  const total = Object.values(w).reduce((a,b) => a+b, 0);
  const score =
    (pilot.depassement  * w.depassement +
     pilot.freinage     * w.freinage +
     pilot.defense      * w.defense +
     pilot.adaptabilite * w.adaptabilite +
     pilot.reactions    * w.reactions +
     pilot.controle     * w.controle +
     pilot.gestionPneus * w.gestionPneus) / total;
  return score;
}

// ─── Calcul du lap time ───────────────────────────────────
function calcLapTime(pilot, team, tireCompound, tireWear, weather, trackEvo, gpStyle, position) {
  const BASE = 90_000;
  const w = GP_STYLE_WEIGHTS[gpStyle];

  // Contribution voiture (45% du temps)
  const cScore = carScore(team, gpStyle);
  const carF = 1 - ((cScore - 70) / 70 * 0.15);

  // Contribution pilote (35% du temps)
  const pScore = pilotScore(pilot, gpStyle);
  const pilotF = 1 - ((pScore - 50) / 50 * 0.12);

  // Pneus
  const tireData = TIRE[tireCompound];
  // Conservation pneus côté voiture réduit la dégradation effective
  const carTireBonus = (team.conservationPneus - 70) / 70 * 0.3;
  // Gestion pneus côté pilote réduit aussi la dégradation
  const pilotTireBonus = (pilot.gestionPneus - 50) / 50 * 0.2;
  const effectiveDeg = tireData.deg * (1 - carTireBonus - pilotTireBonus * 0.01);
  const wearPenalty = tireWear * effectiveDeg;
  const tireF = (1 + wearPenalty) / tireData.grip;

  // Dirty air — voiture derrière une autre souffre plus ou moins selon dirtyAir
  let dirtyAirF = 1.0;
  if (position > 1) {
    const dirtyAirPenalty = (100 - team.dirtyAir) / 100 * 0.012;
    dirtyAirF = 1 + dirtyAirPenalty * Math.random();
  }

  // Track evolution
  const trackF = 1 - (trackEvo / 100 * 0.015);

  // Variabilité (controle réduit les erreurs de pilotage)
  const errorRange = (100 - pilot.controle) / 100 * 0.6 / 100;
  const randF = 1 + (Math.random() - 0.5) * errorRange;

  // Météo — adaptabilite réduit la perte par temps variable
  let weatherF = 1.0;
  if (weather === 'WET') {
    weatherF = 1.18 - (pilot.adaptabilite / 100 * 0.10);
  } else if (weather === 'INTER') {
    weatherF = 1.07 - (pilot.adaptabilite / 100 * 0.05);
  }
  // Refroidissement moteur pénalise par temps chaud (simulation)
  if (weather === 'HOT') {
    weatherF *= 1 + ((100 - team.refroidissement) / 100 * 0.02);
  }

  return Math.round(BASE * carF * pilotF * tireF * dirtyAirF * trackF * randF * weatherF);
}

// ─── Calcul Q time (tour lancé, pneus neufs) ──────────────
function calcQualiTime(pilot, team, weather, gpStyle) {
  const BASE = 88_000;
  const cScore = carScore(team, gpStyle);
  const pScore = pilotScore(pilot, gpStyle);
  // En Q, le freinage et le controle comptent encore plus
  const qualiBoost = (pilot.freinage + pilot.controle) / 200 * 0.03;
  const carF   = 1 - ((cScore - 70) / 70 * 0.16);
  const pilotF = 1 - ((pScore - 50) / 50 * 0.13) - qualiBoost;
  const randF  = 1 + (Math.random() - 0.5) * 0.003;
  const wetF   = weather === 'WET' ? 1.13 - (pilot.adaptabilite / 100 * 0.09) : 1.0;
  return Math.round(BASE * carF * pilotF * randF * wetF);
}

function msToLapStr(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

// ─── Stratégie pneus ──────────────────────────────────────
function chooseStartCompound(laps, weather) {
  if (weather === 'WET')   return 'WET';
  if (weather === 'INTER') return 'INTER';
  if (laps < 55) return Math.random() > 0.5 ? 'MEDIUM' : 'SOFT';
  return Math.random() > 0.6 ? 'HARD' : 'MEDIUM';
}

function shouldPit(driver, lapsRemaining, gapAhead) {
  const { tireWear, tireCompound, pilot, team } = driver;
  // Seuils de dégradation ajustés par conservationPneus voiture et gestionPneus pilote
  const wornThreshold = 35 - (team.conservationPneus - 70) * 0.2 - (pilot.gestionPneus - 50) * 0.1;
  const softThreshold = 22 - (team.conservationPneus - 70) * 0.15;

  if (tireWear > wornThreshold) return { pit: true, reason: 'tires_worn' };
  if (tireWear > softThreshold && tireCompound === 'SOFT') return { pit: true, reason: 'tires_worn' };

  // Undercut — amplifié par le stat Dépassement du pilote
  if (gapAhead !== null && gapAhead < 1800 && tireWear > 18 && lapsRemaining > 15) {
    const agression = (pilot.depassement / 100) * Math.random();
    if (agression > 0.52) return { pit: true, reason: 'undercut' };
  }

  return { pit: false, reason: null };
}

function choosePitCompound(currentCompound, lapsRemaining, usedCompounds) {
  if (!usedCompounds.includes('HARD')   && lapsRemaining > 20) return 'HARD';
  if (!usedCompounds.includes('MEDIUM') && lapsRemaining > 10) return 'MEDIUM';
  if (lapsRemaining <= 15) return 'SOFT';
  return 'MEDIUM';
}

// ─── Safety Car / VSC ─────────────────────────────────────
function checkSafetyCar(scState, dnfCount) {
  if (scState.state !== 'NONE') {
    const newLeft = scState.lapsLeft - 1;
    if (newLeft <= 0) return { state: 'NONE', lapsLeft: 0 };
    return { ...scState, lapsLeft: newLeft };
  }
  const base = 0.03 + dnfCount * 0.01;
  const roll = Math.random();
  if (roll < base * 0.4) return { state: 'SC',  lapsLeft: randInt(2,4) };
  if (roll < base)       return { state: 'VSC', lapsLeft: randInt(1,3) };
  return { state: 'NONE', lapsLeft: 0 };
}

// ─── Incidents ────────────────────────────────────────────
// Les réactions et le controle réduisent le risque d'accident
function checkIncident(pilot, team) {
  const roll = Math.random();
  const reliabF  = (100 - team.refroidissement) / 100 * 0.012;
  const crashF   = ((100 - pilot.controle) / 100 * 0.005) + ((100 - pilot.reactions) / 100 * 0.003);
  if (roll < reliabF)            return { type: 'MECHANICAL', msg: `💥 Problème mécanique` };
  if (roll < reliabF + crashF)   return { type: 'CRASH',      msg: `💥 Accident` };
  if (roll < 0.008)              return { type: 'PUNCTURE',   msg: `🫧 Crevaison` };
  return null;
}

// ─── SIMULATION QUALIFICATIONS ────────────────────────────
async function simulateQualifying(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','WET']);
  const results = [];
  for (const pilot of pilots) {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) continue;
    const time = calcQualiTime(pilot, team, weather, race.gpStyle);
    results.push({ pilotId: pilot._id, pilotName: pilot.name, teamName: team.name, teamEmoji: team.emoji, time });
  }
  results.sort((a,b) => a.time - b.time);
  return { grid: results, weather };
}

// ─── SIMULATION ESSAIS LIBRES ─────────────────────────────
async function simulatePractice(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','WET','INTER']);
  const results = [];
  for (const pilot of pilots) {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) continue;
    const time = calcQualiTime(pilot, team, weather, race.gpStyle) + randInt(-800, 800);
    results.push({ pilot, team, time });
  }
  results.sort((a,b) => a.time - b.time);
  return { results, weather };
}

// ─── SIMULATION COURSE COMPLÈTE ───────────────────────────
async function simulateRace(race, grid, pilots, teams, contracts, channel) {
  const totalLaps = race.laps;
  const weather   = pick(['DRY','DRY','DRY','DRY','WET','INTER','HOT']);
  const gpStyle   = race.gpStyle;

  let drivers = grid.map((g, idx) => {
    const pilot = pilots.find(p => String(p._id) === String(g.pilotId));
    const team  = teams.find(t => String(t._id) === String(pilot?.teamId));
    if (!pilot || !team) return null;
    const startCompound = chooseStartCompound(totalLaps, weather);
    return {
      pilot, team,
      pos          : idx + 1,
      totalTime    : idx * 200,
      tireCompound : startCompound,
      tireWear     : 0,
      tireAge      : 0,
      usedCompounds: [startCompound],
      pitStops     : 0,
      dnf          : false,
      dnfLap       : null,
      dnfReason    : '',
      fastestLap   : Infinity,
    };
  }).filter(Boolean);

  let scState             = { state: 'NONE', lapsLeft: 0 };
  let fastestLapMs        = Infinity;
  let fastestLapHolder    = null;

  const send = async (msg) => {
    if (!channel) return;
    try { await channel.send(msg); } catch(e) {}
    await sleep(2800);
  };

  // ── Annonce départ ──────────────────────────────────────
  const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  await send(
    `🏁 **DÉPART — ${race.circuit.toUpperCase()}** ${race.emoji}\n` +
    `📋 Style : **${gpStyle.toUpperCase()}** ${styleEmojis[gpStyle]} | Météo : **${weather}** | ${totalLaps} tours\n` +
    `🔝 Top 5 grille : ${drivers.slice(0,5).map(d => `${d.team.emoji}${d.pilot.name}`).join(' › ')}`
  );

  // ── Boucle course ───────────────────────────────────────
  for (let lap = 1; lap <= totalLaps; lap++) {
    const lapsRemaining  = totalLaps - lap;
    const trackEvo       = (lap / totalLaps) * 100;
    const alive          = drivers.filter(d => !d.dnf);
    const dnfCount       = drivers.filter(d => d.dnf).length;

    scState = checkSafetyCar(scState, dnfCount);
    const scActive = scState.state !== 'NONE';

    let lapMsg = '';

    // Départ : réactions influencent les positions du 1er tour
    if (lap === 1) {
      const startSwaps = [];
      for (let i = 1; i < drivers.length; i++) {
        const d = drivers[i];
        const ahead = drivers[i-1];
        const reactDiff = d.pilot.reactions - ahead.pilot.reactions;
        if (reactDiff > 15 && Math.random() > 0.55) {
          // Ce pilote réagit mieux au départ et double le pilote devant
          drivers[i-1] = d;
          drivers[i]   = ahead;
          drivers[i-1].pos = i;
          drivers[i].pos   = i + 1;
          startSwaps.push(`${d.team.emoji}${d.pilot.name} devant ${ahead.team.emoji}${ahead.pilot.name}`);
        }
      }
      if (startSwaps.length) lapMsg += `\n🚦 **DÉPART** : ${startSwaps.slice(0,3).join(', ')}`;
    }

    for (const driver of alive) {
      // Incident ?
      const incident = checkIncident(driver.pilot, driver.team);
      if (incident) {
        driver.dnf       = true;
        driver.dnfLap    = lap;
        driver.dnfReason = incident.type;
        lapMsg += `\n${incident.msg} — **${driver.pilot.name}** (${driver.team.emoji}) au tour ${lap}`;
        continue;
      }

      // Temps au tour
      let lt = calcLapTime(driver.pilot, driver.team, driver.tireCompound, driver.tireWear, weather, trackEvo, gpStyle, driver.pos);
      if (scActive) lt = Math.round(lt * (scState.state === 'SC' ? 1.35 : 1.18));

      driver.totalTime    += lt;
      driver.tireWear     += 1;
      driver.tireAge      += 1;
      if (lt < driver.fastestLap) driver.fastestLap = lt;
      if (lt < fastestLapMs) { fastestLapMs = lt; fastestLapHolder = driver; }

      // Gap avec voiture devant
      const sorted  = alive.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      const myIdx   = sorted.findIndex(d => String(d.pilot._id) === String(driver.pilot._id));
      const gapAhead = myIdx > 0 ? driver.totalTime - sorted[myIdx-1].totalTime : null;

      // Tentative de dépassement en piste (stat depassement vs defense)
      if (myIdx > 0 && gapAhead !== null && gapAhead < 800 && !scActive) {
        const attacker = driver;
        const defender = sorted[myIdx - 1];
        // DRS bonus en ligne droite (piste rapide)
        const drsBonus = gpStyle === 'rapide' ? (attacker.team.drs - 70) * 0.003 : 0;
        const attackScore = (attacker.pilot.depassement / 100) + drsBonus + Math.random() * 0.3;
        const defScore    = (defender.pilot.defense / 100) + Math.random() * 0.25;
        if (attackScore > defScore) {
          // Dépassement réussi
          const tmpTime = attacker.totalTime;
          attacker.totalTime = defender.totalTime - randInt(50, 300);
          lapMsg += `\n⚔️ **${attacker.team.emoji}${attacker.pilot.name}** double **${defender.team.emoji}${defender.pilot.name}** !`;
        }
      }

      // Pit stop
      const { pit, reason } = shouldPit(driver, lapsRemaining, gapAhead);
      if (pit && driver.pitStops < 3 && lapsRemaining > 5) {
        const newCompound = choosePitCompound(driver.tireCompound, lapsRemaining, driver.usedCompounds);
        const pitTime     = randInt(19_000, 24_000);
        driver.totalTime  += pitTime;
        driver.tireCompound = newCompound;
        driver.tireWear    = 0;
        driver.tireAge     = 0;
        driver.pitStops   += 1;
        if (!driver.usedCompounds.includes(newCompound)) driver.usedCompounds.push(newCompound);
        lapMsg += `\n🔧 **${driver.pilot.name}** pit stop → ${TIRE[newCompound].emoji}${TIRE[newCompound].label}` +
                  (reason === 'undercut' ? ' *(undercut !)*' : '');
      }
    }

    // Reclasser
    drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);

    // Messages
    if (lap === 1 || lap % 8 === 0 || lap === totalLaps || scActive || lapMsg) {
      const ranked = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      let msg = `**Tour ${lap}/${totalLaps}**`;
      if (scState.state === 'SC')  msg += ` 🚨 **SAFETY CAR**`;
      if (scState.state === 'VSC') msg += ` 🟡 **VSC**`;
      msg += lapMsg;

      if (lap % 8 === 0 || lap === totalLaps) {
        msg += '\n' + ranked.slice(0,3).map((d,i) => {
          const gap = i === 0 ? 'LEADER' : `+${((d.totalTime - ranked[0].totalTime)/1000).toFixed(1)}s`;
          return `**P${i+1}** ${d.team.emoji} ${d.pilot.name} (${gap}) ${TIRE[d.tireCompound].emoji}`;
        }).join('\n');
      }

      if (msg.trim() !== `**Tour ${lap}/${totalLaps}**`) await send(msg);
    }
  }

  // ── Résultats finaux ─────────────────────────────────────
  const finalRanked = [
    ...drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime),
    ...drivers.filter(d => d.dnf).sort((a,b) => (b.dnfLap||0) - (a.dnfLap||0)),
  ];
  finalRanked.forEach((d,i) => d.pos = i+1);

  const results = [];
  for (const driver of finalRanked) {
    const pts      = F1_POINTS[driver.pos - 1] || 0;
    const contract = contracts.find(c => String(c.pilotId) === String(driver.pilot._id) && c.active);
    const multi    = contract?.coinMultiplier || 1.0;
    const salary   = contract?.salaireBase    || 0;
    const primeV   = (driver.pos === 1 && !driver.dnf) ? (contract?.primeVictoire || 0) : 0;
    const primeP   = (driver.pos <= 3 && !driver.dnf)  ? (contract?.primePodium   || 0) : 0;
    const fl       = fastestLapHolder && String(fastestLapHolder.pilot._id) === String(driver.pilot._id);
    const coins    = Math.round((pts * 20 + (driver.dnf ? 0 : 50)) * multi + salary + primeV + primeP + (fl ? 30 : 0));

    results.push({
      pilotId: driver.pilot._id,
      teamId : driver.team._id,
      pos: driver.pos, dnf: driver.dnf, dnfReason: driver.dnfReason,
      coins, fastestLap: fl,
    });
  }

  // Podium
  const podium = finalRanked.slice(0,3);
  await send(
    `🏆 **PODIUM — ${race.circuit.toUpperCase()}**\n` +
    podium.map((d,i) => `${['🥇','🥈','🥉'][i]} **${d.pilot.name}** (${d.team.emoji} ${d.team.name})`).join('\n') +
    (fastestLapHolder ? `\n\n⚡ **Meilleur tour** : ${fastestLapHolder.pilot.name} — ${msToLapStr(fastestLapMs)}` : '')
  );

  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// ██╗   ██╗ ██████╗ ██╗████████╗██╗   ██╗██████╗ ███████╗
// ██║   ██║██╔═══██╗██║╚══██╔══╝██║   ██║██╔══██╗██╔════╝
// ██║   ██║██║   ██║██║   ██║   ██║   ██║██████╔╝█████╗
// ╚██╗ ██╔╝██║   ██║██║   ██║   ██║   ██║██╔══██╗██╔══╝
//  ╚████╔╝ ╚██████╔╝██║   ██║   ╚██████╔╝██║  ██║███████╗
//   ╚═══╝   ╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝
// ── Évolution voitures en cours de saison ───────────────────
// ============================================================

// Appelé après chaque course — distribue des devPoints selon les résultats
// Chaque équipe investit ensuite dans une stat aléatoire
async function evolveCarStats(raceResults, teams) {
  // Points constructeurs par résultat de course
  const teamPoints = {};
  for (const r of raceResults) {
    const pts = F1_POINTS[r.pos - 1] || 0;
    const key = String(r.teamId);
    teamPoints[key] = (teamPoints[key] || 0) + pts;
  }

  for (const team of teams) {
    const key    = String(team._id);
    const pts    = teamPoints[key] || 0;
    // Plus une équipe marque de points, plus elle développe
    // Budget influe aussi (les grosses équipes développent plus vite)
    const devGained = Math.round(pts * 0.8 + (team.budget / 100) * 2);
    const newDevPts = team.devPoints + devGained;

    // Seuil : 50 devPoints = 1 point de stat gagné aléatoirement
    let gained = 0;
    let remaining = newDevPts;
    while (remaining >= 50) {
      remaining -= 50;
      gained++;
    }

    if (gained > 0) {
      // Choisir la stat à améliorer — priorité à la stat la plus faible (réaliste)
      const statKeys = ['vitesseMax','drs','refroidissement','dirtyAir','conservationPneus','vitesseMoyenne'];
      const statVals = statKeys.map(k => ({ key: k, val: team[k] }));
      statVals.sort((a,b) => a.val - b.val);
      // 60% chance d'améliorer la plus faible, sinon aléatoire
      const targetStat = Math.random() < 0.6 ? statVals[0].key : pick(statKeys);
      const newVal = clamp(team[targetStat] + gained, 0, 99);
      await Team.findByIdAndUpdate(team._id, {
        [targetStat]: newVal,
        devPoints: remaining,
      });
    } else {
      await Team.findByIdAndUpdate(team._id, { devPoints: newDevPts });
    }
  }
}

// ============================================================
// ██╗  ██╗███████╗██╗     ██████╗ ███████╗██████╗ ███████╗
// ██║  ██║██╔════╝██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████║█████╗  ██║     ██████╔╝█████╗  ██████╔╝███████╗
// ██╔══██║██╔══╝  ██║     ██╔═══╝ ██╔══╝  ██╔══██╗╚════██║
// ██║  ██║███████╗███████╗██║     ███████╗██║  ██║███████║
// ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝
// ============================================================

async function getActiveSeason() {
  return Season.findOne({ status: { $in: ['active','transfer'] } });
}

async function getCurrentRace(season) {
  if (!season) return null;
  return Race.findOne({ seasonId: season._id, status: { $ne: 'done' } }).sort({ index: 1 });
}

async function getAllPilotsWithTeams() {
  const pilots = await Pilot.find({ teamId: { $ne: null } });
  const teams  = await Team.find();
  return { pilots, teams };
}

async function applyRaceResults(raceResults, raceId, season) {
  const teams = await Team.find();

  for (const r of raceResults) {
    await Pilot.findByIdAndUpdate(r.pilotId, { $inc: { plcoins: r.coins, totalEarned: r.coins } });
    const pts = F1_POINTS[r.pos - 1] || 0;
    await Standing.findOneAndUpdate(
      { seasonId: season._id, pilotId: r.pilotId },
      { $inc: { points: pts, wins: r.pos===1&&!r.dnf?1:0, podiums: r.pos<=3&&!r.dnf?1:0, dnfs: r.dnf?1:0 } },
      { upsert: true }
    );
    // Classement constructeurs
    await ConstructorStanding.findOneAndUpdate(
      { seasonId: season._id, teamId: r.teamId },
      { $inc: { points: pts } },
      { upsert: true }
    );
  }

  await Race.findByIdAndUpdate(raceId, { status: 'done', raceResults });

  // Évolution voitures après la course
  await evolveCarStats(raceResults, teams);
}

async function createNewSeason() {
  const lastSeason = await Season.findOne().sort({ year: -1 });
  const year   = lastSeason ? lastSeason.year + 1 : new Date().getFullYear();
  const regSet = lastSeason ? (lastSeason.year % 4 === 3 ? lastSeason.regulationSet + 1 : lastSeason.regulationSet) : 1;

  const season = await Season.create({ year, status: 'active', regulationSet: regSet });

  if (regSet > 1) await applyRegulationChange(season);

  const startDate = new Date();
  startDate.setHours(0,0,0,0);
  for (let i = 0; i < CIRCUITS.length; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Math.round(i * 1.2));
    await Race.create({ seasonId: season._id, index: i, ...CIRCUITS[i], scheduledDate: d, status: 'upcoming' });
  }

  const pilots = await Pilot.find({ teamId: { $ne: null } });
  for (const p of pilots) await Standing.create({ seasonId: season._id, pilotId: p._id });

  return season;
}

async function applyRegulationChange(season) {
  const teams = await Team.find();
  const statKeys = ['vitesseMax','drs','refroidissement','dirtyAir','conservationPneus','vitesseMoyenne'];
  for (const team of teams) {
    const updates = {};
    for (const key of statKeys) {
      // Chaque stat est rebrassée légèrement (±8 points)
      updates[key] = clamp(team[key] + randInt(-8, 8), 40, 99);
    }
    await Team.findByIdAndUpdate(team._id, updates);
  }
  console.log(`🔄 Changement de réglementation appliqué (saison ${season.year})`);
}

async function startTransferPeriod() {
  const season = await getActiveSeason();
  if (!season) return 0;

  await Season.findByIdAndUpdate(season._id, { status: 'transfer' });
  await Contract.updateMany({ active: true }, { $inc: { seasonsRemaining: -1 } });

  const expired = await Contract.find({ seasonsRemaining: 0, active: true });
  for (const c of expired) {
    await Contract.findByIdAndUpdate(c._id, { active: false });
    await Pilot.findByIdAndUpdate(c.pilotId, { teamId: null });
  }

  // Offres auto des écuries
  const freePilots = await Pilot.find({ teamId: null });
  const teams      = await Team.find();

  for (const pilot of freePilots) {
    for (const team of teams) {
      const inTeam = await Pilot.countDocuments({ teamId: team._id });
      if (inTeam >= 2) continue;
      if (Math.random() > 0.4) continue;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      await TransferOffer.create({
        teamId: team._id, pilotId: pilot._id,
        coinMultiplier: parseFloat(rand(0.9, 1.8).toFixed(2)),
        primeVictoire:  randInt(0, 200),
        primePodium:    randInt(0, 100),
        salaireBase:    randInt(50, 300),
        seasons:        randInt(1, 3),
        status: 'pending', expiresAt: expiry,
      });
    }
  }

  return expired.length;
}

// ============================================================
// ███████╗██╗      █████╗ ███████╗██╗  ██╗     ██████╗ ███╗   ███╗██████╗ ███████╗
// ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║    ██╔════╝████╗ ████║██╔══██╗██╔════╝
// ███████╗██║     ███████║███████╗███████║    ██║     ██╔████╔██║██║  ██║███████╗
// ╚════██║██║     ██╔══██║╚════██║██╔══██║    ██║     ██║╚██╔╝██║██║  ██║╚════██║
// ███████║███████╗██║  ██║███████║██║  ██║    ╚██████╗██║ ╚═╝ ██║██████╔╝███████║
// ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝     ╚═════╝╚═╝     ╚═╝╚═════╝ ╚══════╝
// ============================================================

const commands = [
  new SlashCommandBuilder().setName('create_pilot')
    .setDescription('Crée ton pilote F1 !')
    .addStringOption(o => o.setName('nom').setDescription('Nom de ton pilote').setRequired(true)),

  new SlashCommandBuilder().setName('profil')
    .setDescription('Voir le profil d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible')),

  new SlashCommandBuilder().setName('ameliorer')
    .setDescription('Améliore une stat de ton pilote')
    .addStringOption(o => o.setName('stat').setDescription('Stat à améliorer').setRequired(true)
      .addChoices(
        { name: 'Dépassement    — 500 🪙', value: 'depassement'  },
        { name: 'Freinage       — 500 🪙', value: 'freinage'     },
        { name: 'Défense        — 450 🪙', value: 'defense'      },
        { name: 'Adaptabilité   — 400 🪙', value: 'adaptabilite' },
        { name: 'Réactions      — 400 🪙', value: 'reactions'    },
        { name: 'Contrôle       — 450 🪙', value: 'controle'     },
        { name: 'Gestion Pneus  — 400 🪙', value: 'gestionPneus' },
      )),

  new SlashCommandBuilder().setName('ecuries')
    .setDescription('Liste des 10 écuries'),

  new SlashCommandBuilder().setName('ecurie')
    .setDescription('Détail d\'une écurie (stats voiture)')
    .addStringOption(o => o.setName('nom').setDescription('Nom de l\'écurie').setRequired(true)),

  new SlashCommandBuilder().setName('classement')
    .setDescription('Classement pilotes de la saison'),

  new SlashCommandBuilder().setName('classement_constructeurs')
    .setDescription('Classement constructeurs de la saison'),

  new SlashCommandBuilder().setName('calendrier')
    .setDescription('Calendrier de la saison'),

  new SlashCommandBuilder().setName('resultats')
    .setDescription('Résultats de la dernière course'),

  new SlashCommandBuilder().setName('mon_contrat')
    .setDescription('Voir ton contrat actuel'),

  new SlashCommandBuilder().setName('offres')
    .setDescription('Voir tes offres de contrat'),

  new SlashCommandBuilder().setName('accepter_offre')
    .setDescription('Accepter une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true)),

  new SlashCommandBuilder().setName('refuser_offre')
    .setDescription('Refuser une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true)),

  new SlashCommandBuilder().setName('admin_new_season')
    .setDescription('[ADMIN] Lance une nouvelle saison'),

  new SlashCommandBuilder().setName('admin_force_practice')
    .setDescription('[ADMIN] Force les essais libres'),

  new SlashCommandBuilder().setName('admin_force_quali')
    .setDescription('[ADMIN] Force les qualifications'),

  new SlashCommandBuilder().setName('admin_force_race')
    .setDescription('[ADMIN] Force la course'),

  new SlashCommandBuilder().setName('admin_transfer')
    .setDescription('[ADMIN] Lance la période de transfert'),

  new SlashCommandBuilder().setName('admin_evolve_cars')
    .setDescription('[ADMIN] Affiche l\'évolution des voitures cette saison'),
];

// ============================================================
// ██████╗  ██████╗ ████████╗    ██╗███╗   ██╗██╗████████╗
// ██╔══██╗██╔═══██╗╚══██╔══╝   ██║████╗  ██║██║╚══██╔══╝
// ██████╔╝██║   ██║   ██║      ██║██╔██╗ ██║██║   ██║
// ██╔══██╗██║   ██║   ██║      ██║██║╚██╗██║██║   ██║
// ██████╔╝╚██████╔╝   ██║      ██║██║ ╚████║██║   ██║
// ╚═════╝  ╚═════╝    ╚═╝      ╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝
// ============================================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connecté');

  const teamCount = await Team.countDocuments();
  if (teamCount === 0) {
    await Team.insertMany(DEFAULT_TEAMS);
    console.log('✅ 10 écuries créées');
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log('✅ Slash commands enregistrées');
  startScheduler();
});

// ============================================================
// ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
// ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// ============================================================

const STAT_COST = {
  depassement: 500, freinage: 500, defense: 450,
  adaptabilite: 400, reactions: 400, controle: 450, gestionPneus: 400,
};

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ── /create_pilot ─────────────────────────────────────────
  if (commandName === 'create_pilot') {
    const existing = await Pilot.findOne({ discordId: interaction.user.id });
    if (existing) return interaction.reply({ content: `❌ Tu as déjà un pilote : **${existing.name}**`, ephemeral: true });

    const nom = interaction.options.getString('nom');
    if (nom.length < 2 || nom.length > 30) return interaction.reply({ content: '❌ Nom entre 2 et 30 caractères.', ephemeral: true });

    const pilot = await Pilot.create({
      discordId: interaction.user.id, name: nom,
      depassement:  randInt(44, 62), freinage:     randInt(44, 62),
      defense:      randInt(44, 62), adaptabilite: randInt(44, 62),
      reactions:    randInt(44, 62), controle:     randInt(44, 62),
      gestionPneus: randInt(44, 62), plcoins: 500,
    });

    const bar = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10 - Math.round(v/10));
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`🏎️ Pilote créé : ${pilot.name}`)
        .setColor('#00FF88')
        .setDescription(
          `\`Dépassement  \` ${bar(pilot.depassement)}  **${pilot.depassement}**\n` +
          `\`Freinage     \` ${bar(pilot.freinage)}  **${pilot.freinage}**\n` +
          `\`Défense      \` ${bar(pilot.defense)}  **${pilot.defense}**\n` +
          `\`Adaptabilité \` ${bar(pilot.adaptabilite)}  **${pilot.adaptabilite}**\n` +
          `\`Réactions    \` ${bar(pilot.reactions)}  **${pilot.reactions}**\n` +
          `\`Contrôle     \` ${bar(pilot.controle)}  **${pilot.controle}**\n` +
          `\`Gestion Pneus\` ${bar(pilot.gestionPneus)}  **${pilot.gestionPneus}**\n\n` +
          `💰 **500 PLcoins** de départ`
        )
        .setFooter({ text: 'Attends la période de transfert pour rejoindre une écurie !' })
      ],
    });
  }

  // ── /profil ───────────────────────────────────────────────
  if (commandName === 'profil') {
    const target = interaction.options.getUser('joueur') || interaction.user;
    const pilot  = await Pilot.findOne({ discordId: target.id });
    if (!pilot) return interaction.reply({ content: `❌ Aucun pilote pour <@${target.id}>.`, ephemeral: true });

    const team     = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    const season   = await getActiveSeason();
    const standing = season ? await Standing.findOne({ seasonId: season._id, pilotId: pilot._id }) : null;
    const bar      = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));

    const embed = new EmbedBuilder()
      .setTitle(`${team?.emoji || '🏎️'} ${pilot.name}`)
      .setColor(team?.color || '#888888')
      .setDescription(
        (team ? `**${team.name}**` : '🔴 *Sans écurie*') +
        (contract ? `  |  ×${contract.coinMultiplier} · ${contract.seasonsRemaining} saison(s) restante(s)` : '') + '\n\n' +
        `\`Dépassement  \` ${bar(pilot.depassement)}  **${pilot.depassement}**\n` +
        `\`Freinage     \` ${bar(pilot.freinage)}  **${pilot.freinage}**\n` +
        `\`Défense      \` ${bar(pilot.defense)}  **${pilot.defense}**\n` +
        `\`Adaptabilité \` ${bar(pilot.adaptabilite)}  **${pilot.adaptabilite}**\n` +
        `\`Réactions    \` ${bar(pilot.reactions)}  **${pilot.reactions}**\n` +
        `\`Contrôle     \` ${bar(pilot.controle)}  **${pilot.controle}**\n` +
        `\`Gestion Pneus\` ${bar(pilot.gestionPneus)}  **${pilot.gestionPneus}**\n\n` +
        `💰 **${pilot.plcoins} PLcoins** (total gagné : ${pilot.totalEarned})`
      );

    if (contract) {
      embed.addFields({ name: '📋 Contrat détaillé', value:
        `Salaire/course : **${contract.salaireBase} 🪙** | Prime victoire : **${contract.primeVictoire} 🪙** | Prime podium : **${contract.primePodium} 🪙**`,
      });
    }
    if (standing) {
      embed.addFields({ name: '🏆 Saison en cours',
        value: `**${standing.points} pts** · ${standing.wins}V · ${standing.podiums}P · ${standing.dnfs} DNF`,
      });
    }
    return interaction.reply({ embeds: [embed] });
  }

  // ── /ameliorer ────────────────────────────────────────────
  if (commandName === 'ameliorer') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Crée d\'abord ton pilote.', ephemeral: true });

    const statKey = interaction.options.getString('stat');
    const cost    = STAT_COST[statKey];
    if (pilot.plcoins < cost) return interaction.reply({ content: `❌ Pas assez de PLcoins (${pilot.plcoins}/${cost}).`, ephemeral: true });
    if (pilot[statKey] >= 99) return interaction.reply({ content: '❌ Stat déjà au max (99) !', ephemeral: true });

    const gain = randInt(1, 3);
    await Pilot.findByIdAndUpdate(pilot._id, { $inc: { plcoins: -cost, [statKey]: gain } });
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('📈 Amélioration !').setColor('#FFD700')
        .setDescription(`**${statKey}** : ${pilot[statKey]} → ${Math.min(99, pilot[statKey]+gain)} (+${gain})\n💸 −${cost} PLcoins`)],
    });
  }

  // ── /ecuries ──────────────────────────────────────────────
  if (commandName === 'ecuries') {
    const teams  = await Team.find().sort({ vitesseMax: -1 });
    const pilots = await Pilot.find({ teamId: { $ne: null } });
    const embed  = new EmbedBuilder().setTitle('🏎️ Écuries F1').setColor('#FF1801');
    for (const t of teams) {
      const tp = pilots.filter(p => String(p.teamId) === String(t._id));
      const avg = Math.round((t.vitesseMax + t.drs + t.refroidissement + t.dirtyAir + t.conservationPneus + t.vitesseMoyenne) / 6);
      embed.addFields({
        name: `${t.emoji} ${t.name}  ·  Perf moy. **${avg}/100**`,
        value: tp.length ? tp.map(p => `• ${p.name}`).join('\n') : '*Aucun pilote*',
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed] });
  }

  // ── /ecurie ───────────────────────────────────────────────
  if (commandName === 'ecurie') {
    const nom  = interaction.options.getString('nom');
    const team = await Team.findOne({ name: { $regex: nom, $options: 'i' } });
    if (!team) return interaction.reply({ content: '❌ Écurie introuvable.', ephemeral: true });

    const pilots = await Pilot.find({ teamId: team._id });
    const bar    = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`${team.emoji} ${team.name}`)
        .setColor(team.color)
        .setDescription(
          `\`Vitesse Max       \` ${bar(team.vitesseMax)}  **${team.vitesseMax}**\n` +
          `\`DRS               \` ${bar(team.drs)}  **${team.drs}**\n` +
          `\`Refroidissement   \` ${bar(team.refroidissement)}  **${team.refroidissement}**\n` +
          `\`Dirty Air         \` ${bar(team.dirtyAir)}  **${team.dirtyAir}**\n` +
          `\`Conservation Pneus\` ${bar(team.conservationPneus)}  **${team.conservationPneus}**\n` +
          `\`Vitesse Moyenne   \` ${bar(team.vitesseMoyenne)}  **${team.vitesseMoyenne}**\n\n` +
          `👥 **Pilotes :** ${pilots.length ? pilots.map(p => p.name).join(', ') : 'Aucun'}`
        )
      ],
    });
  }

  // ── /classement ───────────────────────────────────────────
  if (commandName === 'classement') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const standings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).limit(20);
    const medals    = ['🥇','🥈','🥉'];
    let desc = '';
    for (let i = 0; i < standings.length; i++) {
      const s     = standings[i];
      const pilot = await Pilot.findById(s.pilotId);
      const team  = pilot?.teamId ? await Team.findById(pilot.teamId) : null;
      desc += `${medals[i] || `**${i+1}.**`} ${team?.emoji||''} **${pilot?.name||'?'}** — ${s.points} pts (${s.wins}V ${s.podiums}P ${s.dnfs}DNF)\n`;
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`🏆 Classement Pilotes — Saison ${season.year}`).setColor('#FF1801').setDescription(desc||'Aucune donnée')],
    });
  }

  // ── /classement_constructeurs ─────────────────────────────
  if (commandName === 'classement_constructeurs') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const standings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
    let desc = '';
    for (let i = 0; i < standings.length; i++) {
      const team = await Team.findById(standings[i].teamId);
      desc += `**${i+1}.** ${team?.emoji||''} **${team?.name||'?'}** — ${standings[i].points} pts\n`;
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`🏗️ Classement Constructeurs — Saison ${season.year}`).setColor('#0099FF').setDescription(desc||'Aucune donnée')],
    });
  }

  // ── /calendrier ───────────────────────────────────────────
  if (commandName === 'calendrier') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const races = await Race.find({ seasonId: season._id }).sort({ index: 1 });
    const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
    const lines = races.map(r => {
      const d = new Date(r.scheduledDate);
      const dateStr = `${d.getDate()}/${d.getMonth()+1}`;
      const status  = r.status === 'done' ? '✅' : '🔜';
      return `${status} ${r.emoji} **${r.circuit}** — ${dateStr} ${styleEmojis[r.gpStyle]}`;
    });

    const chunks = [];
    for (let i = 0; i < lines.length; i += 12) chunks.push(lines.slice(i, i+12).join('\n'));
    const embed = new EmbedBuilder().setTitle(`📅 Calendrier — Saison ${season.year}`).setColor('#0099FF').setDescription(chunks[0]);
    if (chunks[1]) embed.addFields({ name: '\u200B', value: chunks[1] });
    return interaction.reply({ embeds: [embed] });
  }

  // ── /resultats ────────────────────────────────────────────
  if (commandName === 'resultats') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const lastRace = await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 });
    if (!lastRace) return interaction.reply({ content: '❌ Aucune course terminée.', ephemeral: true });

    const medals = ['🥇','🥈','🥉'];
    let desc = '';
    for (const r of lastRace.raceResults.slice(0,15)) {
      const pilot = await Pilot.findById(r.pilotId);
      const team  = pilot?.teamId ? await Team.findById(pilot.teamId) : null;
      const pts   = F1_POINTS[r.pos-1] || 0;
      desc += `${medals[r.pos-1]||`P${r.pos}`} ${team?.emoji||''} **${pilot?.name||'?'}**`;
      if (r.dnf) desc += ` ❌ DNF (${r.dnfReason})`;
      else       desc += ` — ${pts} pts · +${r.coins} 🪙`;
      if (r.fastestLap) desc += ' ⚡';
      desc += '\n';
    }
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`${lastRace.emoji} Résultats — ${lastRace.circuit}`)
        .setColor('#FF1801')
        .setDescription(desc)
        .setFooter({ text: `Style : ${lastRace.gpStyle.toUpperCase()}` })
      ],
    });
  }

  // ── /mon_contrat ──────────────────────────────────────────
  if (commandName === 'mon_contrat') {
    const pilot    = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });
    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (!contract) return interaction.reply({ content: '📋 Aucun contrat actif. Attends la période de transfert !', ephemeral: true });
    const team     = await Team.findById(contract.teamId);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('📋 Mon Contrat').setColor(team.color)
        .addFields(
          { name: 'Écurie',              value: `${team.emoji} ${team.name}`,         inline: true },
          { name: 'Durée restante',      value: `${contract.seasonsRemaining} saison(s)`, inline: true },
          { name: 'Multiplicateur',      value: `×${contract.coinMultiplier}`,        inline: true },
          { name: 'Salaire / course',    value: `${contract.salaireBase} 🪙`,         inline: true },
          { name: 'Prime victoire',      value: `${contract.primeVictoire} 🪙`,       inline: true },
          { name: 'Prime podium',        value: `${contract.primePodium} 🪙`,         inline: true },
        )
      ],
    });
  }

  // ── /offres ───────────────────────────────────────────────
  if (commandName === 'offres') {
    const pilot  = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });
    const offers = await TransferOffer.find({ pilotId: pilot._id, status: 'pending' });
    if (!offers.length) return interaction.reply({ content: '📭 Aucune offre en attente.', ephemeral: true });

    const embed = new EmbedBuilder().setTitle('📬 Tes offres de contrat').setColor('#FFD700');
    for (const o of offers) {
      const team = await Team.findById(o.teamId);
      embed.addFields({
        name: `${team.emoji} ${team.name}  —  \`${o._id}\``,
        value: `×${o.coinMultiplier} | ${o.seasons} saison(s) | Salaire : ${o.salaireBase} 🪙/course | Prime V : ${o.primeVictoire} 🪙 | Prime P : ${o.primePodium} 🪙`,
      });
    }
    embed.setFooter({ text: '/accepter_offre <ID>  |  /refuser_offre <ID>' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /accepter_offre ───────────────────────────────────────
  if (commandName === 'accepter_offre') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });

    const activeContract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (activeContract) return interaction.reply({
      content: `❌ Contrat actif (${activeContract.seasonsRemaining} saison(s) restante(s)). Attends la fin pour changer d\'écurie.`,
      ephemeral: true,
    });

    const offerId = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || String(offer.pilotId) !== String(pilot._id) || offer.status !== 'pending') {
      return interaction.reply({ content: '❌ Offre invalide ou expirée.', ephemeral: true });
    }

    const team    = await Team.findById(offer.teamId);
    const inTeam  = await Pilot.countDocuments({ teamId: team._id });
    if (inTeam >= 2) return interaction.reply({ content: '❌ Écurie complète (2 pilotes max).', ephemeral: true });

    await TransferOffer.findByIdAndUpdate(offerId, { status: 'accepted' });
    await TransferOffer.updateMany({ pilotId: pilot._id, status: 'pending', _id: { $ne: offerId } }, { status: 'expired' });
    await Pilot.findByIdAndUpdate(pilot._id, { teamId: team._id });
    await Contract.create({
      pilotId: pilot._id, teamId: team._id,
      seasonsDuration:   offer.seasons, seasonsRemaining: offer.seasons,
      coinMultiplier:    offer.coinMultiplier,
      primeVictoire:     offer.primeVictoire,
      primePodium:       offer.primePodium,
      salaireBase:       offer.salaireBase,
      active: true,
    });

    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('✅ Contrat signé !').setColor(team.color)
        .setDescription(
          `**${pilot.name}** rejoint **${team.emoji} ${team.name}** !\n\n` +
          `×${offer.coinMultiplier} | ${offer.seasons} saison(s) | Salaire : ${offer.salaireBase} 🪙/course\n` +
          `Prime victoire : ${offer.primeVictoire} 🪙 | Prime podium : ${offer.primePodium} 🪙`
        )
      ],
    });
  }

  // ── /refuser_offre ────────────────────────────────────────
  if (commandName === 'refuser_offre') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });
    const offerId = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || String(offer.pilotId) !== String(pilot._id)) return interaction.reply({ content: '❌ Offre introuvable.', ephemeral: true });
    await TransferOffer.findByIdAndUpdate(offerId, { status: 'rejected' });
    return interaction.reply({ content: '🚫 Offre refusée.', ephemeral: true });
  }

  // ── /admin_new_season ─────────────────────────────────────
  if (commandName === 'admin_new_season') {
    await interaction.deferReply();
    try {
      const season = await createNewSeason();
      await interaction.editReply(`✅ Saison **${season.year}** créée ! ${CIRCUITS.length} GP au calendrier.`);
    } catch(e) { await interaction.editReply(`❌ ${e.message}`); }
  }

  if (commandName === 'admin_force_practice') {
    await interaction.deferReply();
    await runPractice(interaction.channel);
    await interaction.editReply('✅ Essais libres lancés !');
  }

  if (commandName === 'admin_force_quali') {
    await interaction.deferReply();
    await runQualifying(interaction.channel);
    await interaction.editReply('✅ Qualifications lancées !');
  }

  if (commandName === 'admin_force_race') {
    await interaction.deferReply();
    await runRace(interaction.channel);
    await interaction.editReply('✅ Course lancée !');
  }

  if (commandName === 'admin_transfer') {
    await interaction.deferReply();
    const expired = await startTransferPeriod();
    await interaction.editReply(`✅ Période de transfert ouverte ! ${expired} contrat(s) expiré(s).`);
  }

  // ── /admin_evolve_cars ────────────────────────────────────
  if (commandName === 'admin_evolve_cars') {
    const teams = await Team.find().sort({ vitesseMax: -1 });
    const bar   = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));
    const embed = new EmbedBuilder().setTitle('🔧 Stats Voitures (état actuel)').setColor('#888888');
    for (const t of teams) {
      embed.addFields({
        name: `${t.emoji} ${t.name}  (dev: ${t.devPoints} pts)`,
        value:
          `Vit. Max ${bar(t.vitesseMax)}${t.vitesseMax}  |  DRS ${bar(t.drs)}${t.drs}\n` +
          `Refroid. ${bar(t.refroidissement)}${t.refroidissement}  |  Dirty ${bar(t.dirtyAir)}${t.dirtyAir}\n` +
          `Pneus ${bar(t.conservationPneus)}${t.conservationPneus}  |  Moy ${bar(t.vitesseMoyenne)}${t.vitesseMoyenne}`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed] });
  }
});

// ============================================================
// ███████╗ ██████╗██╗  ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗██████╗
// ██╔════╝██╔════╝██║  ██║██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔══██╗
// ███████╗██║     ███████║█████╗  ██║  ██║██║   ██║██║     █████╗  ██████╔╝
// ╚════██║██║     ██╔══██║██╔══╝  ██║  ██║██║   ██║██║     ██╔══╝  ██╔══██╗
// ███████║╚██████╗██║  ██║███████╗██████╔╝╚██████╔╝███████╗███████╗██║  ██║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// ============================================================

async function getRaceChannel(override) {
  if (override) return override;
  try { return await client.channels.fetch(RACE_CHANNEL); } catch(e) { return null; }
}

async function isRaceDay(race, override) {
  if (override) return true;
  const today = new Date(); today.setHours(0,0,0,0);
  const d     = new Date(race.scheduledDate); d.setHours(0,0,0,0);
  return d.getTime() === today.getTime();
}

async function runPractice(override) {
  const season = await getActiveSeason(); if (!season) return;
  const race   = await getCurrentRace(season); if (!race) return;
  if (!await isRaceDay(race, override)) return;

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { results, weather } = await simulatePractice(race, pilots, teams);
  const channel = await getRaceChannel(override);
  const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Essais Libres — ${race.emoji} ${race.circuit}`)
    .setColor('#888888')
    .setDescription(
      `Météo : **${weather}** | Style : **${race.gpStyle.toUpperCase()}** ${styleEmojis[race.gpStyle]}\n\n` +
      results.slice(0,10).map((r,i) => `**P${i+1}** ${r.team.emoji} ${r.pilot.name} — ${msToLapStr(r.time)}`).join('\n')
    );

  if (channel) await channel.send({ embeds: [embed] });
  await Race.findByIdAndUpdate(race._id, { status: 'practice_done' });
}

async function runQualifying(override) {
  const season = await getActiveSeason(); if (!season) return;
  const race   = await getCurrentRace(season); if (!race) return;
  if (!await isRaceDay(race, override)) return;

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { grid, weather } = await simulateQualifying(race, pilots, teams);
  const channel = await getRaceChannel(override);

  await Race.findByIdAndUpdate(race._id, {
    qualiGrid: grid.map(g => ({ pilotId: g.pilotId, time: g.time })),
    status: 'quali_done',
  });

  const embed = new EmbedBuilder()
    .setTitle(`⏱️ Qualifications — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(
      `Météo : **${weather}**\n\n` +
      grid.slice(0,20).map((g,i) => {
        const gap = i === 0 ? '' : ` (+${((g.time - grid[0].time)/1000).toFixed(3)}s)`;
        return `**P${i+1}** ${g.teamEmoji} ${g.pilotName} — ${msToLapStr(g.time)}${gap}`;
      }).join('\n')
    );

  if (channel) await channel.send({ embeds: [embed] });
}

async function runRace(override) {
  const season = await getActiveSeason(); if (!season) return;
  const race   = await getCurrentRace(season); if (!race || race.status === 'done') return;
  if (!await isRaceDay(race, override)) return;

  const { pilots, teams } = await getAllPilotsWithTeams();
  const contracts = await Contract.find({ active: true });
  if (!pilots.length) return;

  let grid = race.qualiGrid;
  if (!grid?.length) {
    grid = [...pilots]
      .sort((a,b) => {
        const ta = teams.find(t => String(t._id) === String(a.teamId));
        const tb = teams.find(t => String(t._id) === String(b.teamId));
        return carScore(tb, race.gpStyle) - carScore(ta, race.gpStyle);
      })
      .map(p => ({ pilotId: p._id }));
  }

  const channel = await getRaceChannel(override);
  const results = await simulateRace(race, grid, pilots, teams, contracts, channel);
  await applyRaceResults(results, race._id, season);

  // Tableau final
  const embed = new EmbedBuilder().setTitle(`🏁 Résultats Officiels — ${race.emoji} ${race.circuit}`).setColor('#FF1801');
  let desc = '';
  const medals = ['🥇','🥈','🥉'];
  for (const r of results.slice(0,15)) {
    const pilot = pilots.find(p => String(p._id) === String(r.pilotId));
    const team  = teams.find(t => String(t._id) === String(r.teamId));
    const pts   = F1_POINTS[r.pos-1] || 0;
    desc += `${medals[r.pos-1]||`P${r.pos}`} ${team?.emoji||''} **${pilot?.name||'?'}**`;
    if (r.dnf) desc += ` ❌ DNF`;
    else       desc += ` — ${pts} pts · +${r.coins} 🪙`;
    if (r.fastestLap) desc += ' ⚡';
    desc += '\n';
  }
  embed.setDescription(desc);
  if (channel) await channel.send({ embeds: [embed] });

  // Fin de saison ?
  const remaining = await Race.countDocuments({ seasonId: season._id, status: { $ne: 'done' } });
  if (remaining === 0 && channel) {
    await channel.send('🏆 **FIN DE SAISON !** La période de transfert commencera dans 24h.');
    setTimeout(async () => {
      await startTransferPeriod();
      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);
        await ch.send('🔄 **PÉRIODE DE TRANSFERT OUVERTE !** Utilisez `/offres` pour voir vos propositions.');
      } catch(e) {}
    }, 24 * 60 * 60 * 1000);
  }
}

// ============================================================
// ██╗  ██╗ █████╗ ██╗██████╗  ███╗ ██╗ ██████╗  ██╗████████╗
// ██║ ██╔╝██╔══██╗██║██╔══██╗ ████╗██║██╔═══██╗███║╚══██╔══╝
// █████╔╝ ███████║██║██████╔╝ ██╔██╗█║██║   ██║╚██║   ██║
// ██╔═██╗ ██╔══██║██║██╔═══╝  ██║╚████║██║   ██║ ██║   ██║
// ██║  ██╗██║  ██║██║██║      ██║ ╚███║╚██████╔╝ ██║   ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝      ╚═╝  ╚══╝ ╚═════╝  ╚═╝   ╚═╝
// ── keep-alive + cron 11h/15h/18h ─────────────────────────
// ============================================================

function startScheduler() {
  cron.schedule('0 11 * * *', () => runPractice().catch(console.error), { timezone: 'Europe/Paris' });
  cron.schedule('0 15 * * *', () => runQualifying().catch(console.error), { timezone: 'Europe/Paris' });
  cron.schedule('0 18 * * *', () => runRace().catch(console.error),      { timezone: 'Europe/Paris' });
  console.log('✅ Scheduler : 11h EL · 15h Q · 18h Course (Europe/Paris)');
  console.log('✅ Keep-alive : ping toutes les 15min');
}

client.login(TOKEN);

/*
============================================================
📦 INSTALLATION
============================================================
npm init -y
npm install discord.js mongoose node-cron dotenv

.env :
  DISCORD_TOKEN=...
  CLIENT_ID=...
  GUILD_ID=...
  MONGODB_URI=mongodb://localhost:27017/f1bot
  RACE_CHANNEL_ID=...
  PORT=3000

node index.js

============================================================
🆕 NOUVEAUTÉS V2
============================================================

📊 STATS PILOTE (7 stats, toutes sur 100)
  Dépassement   → attaque en piste, DRS, undercut agressif
  Freinage      → performance en Q, zones de freinage tardif
  Défense       → résistance aux tentatives de dépassement
  Adaptabilité  → météo changeante, SC/VSC, conditions
  Réactions     → départ, opportunisme, incidents
  Contrôle      → consistance, gestion des limites de piste
  Gestion Pneus → préservation, fenêtre de fonctionnement

🚗 STATS VOITURE (6 stats, évoluent en cours de saison)
  Vitesse Max        → ligne droite, circuits rapides
  DRS                → bonus en mode DRS
  Refroidissement    → fiabilité par temps chaud
  Dirty Air          → vitesse derrière une autre voiture
  Conservation Pneus → usure pneus côté châssis
  Vitesse Moyenne    → performance globale en courbe

🏙️ STYLES DE GP (5 types)
  Urbain    → Freinage + Contrôle + Défense + Dirty Air + Cons. Pneus
  Rapide    → Vitesse Max + DRS + Dépassement
  Technique → Vitesse Moy + Freinage + Contrôle + Gestion Pneus
  Mixte     → Stats équilibrées
  Endurance → Refroid. + Cons. Pneus + Gestion Pneus + Adaptabilité

📈 ÉVOLUTION VOITURES
  → Après chaque course, chaque écurie gagne des devPoints
  → Les équipes qui marquent plus de points développent plus vite
  → Budget influe sur le rythme de développement
  → La stat la plus faible est prioritairement améliorée (60%)

📋 CONTRATS ENRICHIS
  Multiplicateur PLcoins  × (appliqué aux résultats)
  Salaire de base         PLcoins fixes par course disputée
  Prime victoire          PLcoins bonus par victoire
  Prime podium            PLcoins bonus par podium
  Durée                   1 à 3 saisons, irrévocable

🔔 KEEP-ALIVE
  Serveur HTTP local + ping auto toutes les 15min
  Compatible Render, Railway, Fly.io, VPS...

============================================================
*/
