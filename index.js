// ============================================================
//  🏎️  F1 DISCORD BOT  v2  —  index.js
//  npm install discord.js mongoose node-cron dotenv
// ============================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder,
        SlashCommandBuilder, REST, Routes,
        ActionRowBuilder, ButtonBuilder, ButtonStyle,
        StringSelectMenuBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron     = require('node-cron');
const http     = require('http');   // keep-alive ping
const https    = require('https');  // keep-alive ping (APP_URL https)

// ─── ENV (.env) ──────────────────────────────────────────────
// DISCORD_TOKEN=...
// CLIENT_ID=...
// GUILD_ID=...
// MONGODB_URI=mongodb://localhost:27017/f1bot
// RACE_CHANNEL_ID=...
// PORT=3000
// APP_URL=https://ton-app.onrender.com   <- URL publique (OBLIGATOIRE sur Render/Railway)
// ─────────────────────────────────────────────────────────────

const TOKEN        = process.env.DISCORD_TOKEN;
const CLIENT_ID    = process.env.CLIENT_ID;
const GUILD_ID     = process.env.GUILD_ID;
const MONGO_URI    = process.env.MONGODB_URI || 'mongodb://localhost:27017/f1bot';
const RACE_CHANNEL = process.env.RACE_CHANNEL_ID;
const PORT         = process.env.PORT || 3000;
// Ping URL : utilise l'URL publique si disponible (localhost echoue sur Render/Railway)
const PING_URL     = process.env.APP_URL
  ? `${process.env.APP_URL}/ping`
  : `http://localhost:${PORT}/ping`;

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
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('F1 Bot is alive 🏎️');
});
server.listen(PORT, () => console.log(`✅ Keep-alive server sur port ${PORT} — ping : ${PING_URL}`));

// ── Self-ping toutes les 8 min ────────────────────────────────
// ⚠️  Render/Railway endorment après ~10 min sans requête.
//     15 min était trop lent — 8 min laisse une marge de sécurité.
//     Ajoute APP_URL dans ton .env si localhost ne suffit pas.
function selfPing() {
  const url  = new URL(PING_URL);
  const mod  = url.protocol === 'https:' ? require('https') : http;
  const req  = mod.get(PING_URL, (res) => {
    console.log(`🔔 Keep-alive ping OK [${res.statusCode}] — ${new Date().toLocaleTimeString()}`);
    res.resume(); // vider la réponse pour éviter memory leak
  });
  req.on('error', (err) => {
    console.warn(`⚠️  Keep-alive ping FAILED : ${err.message} — URL : ${PING_URL}`);
  });
  req.setTimeout(8000, () => {
    console.warn(`⚠️  Keep-alive ping TIMEOUT — ${PING_URL}`);
    req.destroy();
  });
}

cron.schedule('*/8 * * * *', selfPing, { timezone: 'Europe/Paris' });

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
  // Photo de profil (URL définie par un admin via /admin_set_photo)
  photoUrl     : { type: String, default: null },
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


// ── DraftSession ─────────────────────────────────────────────
// Snake draft : round 1 = ordre ASC budget, round 2 = inversé
const DraftSchema = new mongoose.Schema({
  status           : { type: String, enum: ['active','done'], default: 'active' },
  order            : [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  picks            : [{ teamId: mongoose.Schema.Types.ObjectId, pilotId: mongoose.Schema.Types.ObjectId }],
  currentPickIndex : { type: Number, default: 0 },
  totalPicks       : { type: Number, default: 0 },
  createdAt        : { type: Date, default: Date.now },
});
const DraftSession = mongoose.model('DraftSession', DraftSchema);

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

// ─── Note Générale FIFA-style ─────────────────────────────
function overallRating(pilot) {
  return Math.round(
    pilot.freinage     * 0.17 +
    pilot.controle     * 0.17 +
    pilot.depassement  * 0.15 +
    pilot.gestionPneus * 0.15 +
    pilot.defense      * 0.13 +
    pilot.adaptabilite * 0.12 +
    pilot.reactions    * 0.11
  );
}
function ratingTier(r) {
  if (r >= 90) return { badge: '🟫', label: 'ICÔNE',          color: '#b07d26' };
  if (r >= 85) return { badge: '🟨', label: 'ÉLITE',          color: '#FFD700' };
  if (r >= 80) return { badge: '🟩', label: 'EXPERT',         color: '#00C851' };
  if (r >= 72) return { badge: '🟦', label: 'CONFIRMÉ',       color: '#0099FF' };
  if (r >= 64) return { badge: '🟥', label: 'INTERMÉDIAIRE',  color: '#CC4444' };
  return              { badge: '⬜', label: 'ROOKIE',          color: '#888888' };
}

// Snake draft : quel teamId pick à l'index donné ?
function draftTeamAtIndex(order, idx) {
  const n = order.length;
  const round = Math.floor(idx / n);
  const pos   = idx % n;
  return round % 2 === 0 ? order[pos] : order[n - 1 - pos];
}

// Construit le select menu des pilotes disponibles pour le draft
function buildDraftSelectMenu(freePilots, draftId) {
  const options = freePilots.slice(0, 25).map(p => {
    const ov = overallRating(p);
    const t  = ratingTier(ov);
    return { label: `${t.badge} ${ov} — ${p.name}`, value: String(p._id), description: `Frein ${p.freinage} | Ctrl ${p.controle} | Dep ${p.depassement}` };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`draft_pick_${draftId}`)
      .setPlaceholder('Choisissez un pilote...')
      .addOptions(options)
  );
}

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
// Ne se déclenche QUE sur un incident dangereux (CRASH ou PUNCTURE sur piste)
// lapIncidents = tableau des incidents du tour courant { type: 'CRASH'|'PUNCTURE'|'MECHANICAL', onTrack: bool }
function resolveSafetyCar(scState, lapIncidents) {
  // Si SC/VSC déjà actif : décrémenter
  if (scState.state !== 'NONE') {
    const newLeft = scState.lapsLeft - 1;
    if (newLeft <= 0) return { state: 'NONE', lapsLeft: 0 };
    return { ...scState, lapsLeft: newLeft };
  }

  // Un SC/VSC ne peut se déclencher que si un accident/crevaison bloque la piste
  // (MECHANICAL = voiture qui se range, pas de danger immédiat → pas de SC)
  const dangerousOnTrack = lapIncidents.filter(i => i.type === 'CRASH' || i.type === 'PUNCTURE');
  if (!dangerousOnTrack.length) return { state: 'NONE', lapsLeft: 0 };

  // Plus il y a de voitures accidentées sur la piste, plus le SC est probable
  const nDangerous = dangerousOnTrack.length;
  const roll = Math.random();

  // Crash → SC (70%) ou VSC (30%)
  // Crevaison solo → VSC (60%) ou rien (40%)
  const hasCrash = dangerousOnTrack.some(i => i.type === 'CRASH');
  if (hasCrash) {
    if (nDangerous >= 2) {
      // Double incident ou collision → SC quasi-certain
      if (roll < 0.85) return { state: 'SC',  lapsLeft: randInt(3, 5) };
      return { state: 'VSC', lapsLeft: randInt(2, 3) };
    }
    if (roll < 0.55) return { state: 'SC',  lapsLeft: randInt(2, 4) };
    if (roll < 0.80) return { state: 'VSC', lapsLeft: randInt(1, 3) };
    return { state: 'NONE', lapsLeft: 0 }; // crash solo qui se range sans bloquer
  } else {
    // Crevaison uniquement
    if (roll < 0.35) return { state: 'VSC', lapsLeft: randInt(1, 2) };
    return { state: 'NONE', lapsLeft: 0 };
  }
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

// ─── Bibliothèques de narration ───────────────────────────

// Comment un dépassement se produit physiquement, selon le style de GP et les stats
function overtakeDescription(attacker, defender, gpStyle) {
  const drs      = gpStyle === 'rapide' && attacker.team.drs > 82;
  const freinage = attacker.pilot.freinage > 75;
  const dep      = attacker.pilot.depassement > 75;
  const a = attacker.pilot.name;
  const d = defender.pilot.name;
  const ae = attacker.team.emoji;
  const de = defender.team.emoji;

  const straights = [
    `${ae}**${a}** surgit dans la ligne droite${drs ? ' en DRS 📡' : ''} — il passe côté intérieur, ${de}**${d}** ne peut rien faire !`,
    `${ae}**${a}** prend le sillage de ${de}**${d}**${drs ? ', active le DRS 📡' : ''} et déborde proprement dans la grande ligne droite !`,
    `Différence de vitesse de pointe énorme — ${ae}**${a}** passe ${de}**${d}** comme si ce dernier était à l'arrêt !`,
  ];
  const braking = [
    `${ae}**${a}** freine TRÈS tard au bout de la ligne droite — il plonge à l'intérieur et pique la position à ${de}**${d}** !`,
    `Freinage tardif audacieux de ${ae}**${a}** — il passe à l'intérieur du virage, ${de}**${d}** est débordé avant même de réagir !`,
    `${ae}**${a}** joue le tout pour le tout au freinage — une opportunité infime, saisie à la perfection. ${de}**${d}** est passé !`,
  ];
  const corner = [
    `${ae}**${a}** prend l'extérieur avec un culot monstre — il enroule le virage parfaitement et ressort devant ${de}**${d}** !`,
    `Belle manœuvre à l'extérieur du virage — ${ae}**${a}** a la trajectoire idéale et laisse ${de}**${d}** sur place !`,
    `${ae}**${a}** passe par l'extérieur en sortie de virage — une manœuvre propre et efficace sur ${de}**${d}** !`,
  ];
  const undercut = [
    `${ae}**${a}** refait son retard sur piste fraîche — il double ${de}**${d}** qui n'a aucune réponse sur pneus usés !`,
    `L'undercut paie pour ${ae}**${a}** ! ${de}**${d}** sort du garage derrière — la stratégie fait le travail.`,
  ];

  if (drs)       return pick(straights);
  if (freinage)  return pick(braking);
  if (dep > 75 && gpStyle === 'urbain') return pick(braking);
  if (gpStyle === 'technique') return pick(corner);
  if (gpStyle === 'endurance') return pick(undercut);
  return pick([...straights, ...braking, ...corner]);
}

// Description physique d'un accident solo selon le gpStyle
function crashSoloDescription(driver, lap, gpStyle) {
  const n = `**${driver.team.emoji}${driver.pilot.name}**`;
  const p = `(P${driver.pos})`;
  const urbain = [
    `💥 **T${lap} — ACCIDENT !** ${n} ${p} touche les glissières dans la chicane — la voiture se couche violemment dans les barrières. ❌ **DNF.**`,
    `🚧 **T${lap} — SORTIE DE PISTE !** ${n} ${p} part à la glisse dans un virage en épingle, percute le mur de l'extérieur et c'est terminé pour lui. ❌ **DNF.**`,
    `💥 **T${lap}** — ${n} ${p} tape le rail intérieur, les deux roues avant s'arrachent à l'impact. Scène violente mais le pilote est sain et sauf. ❌ **DNF.**`,
  ];
  const rapide = [
    `💨 **T${lap} — INCIDENT HAUTE VITESSE !** ${n} ${p} perd le contrôle à pleine vitesse, décollage et choc brutal dans les barrières de pneus. ❌ **DNF.**`,
    `🚨 **T${lap}** — ${n} ${p} part en tête-à-queue dans la courbe rapide, ne peut pas rattraper le mouvement — fin de course. ❌ **DNF.**`,
    `💥 **T${lap}** — Survitesse à l'entrée de courbe pour ${n} ${p} — la voiture vole littéralement hors de la piste. Dieu merci le pilote va bien. ❌ **DNF.**`,
  ];
  const generic = [
    `💥 **T${lap} — FAUTE DE PILOTAGE !** ${n} ${p} perd l'arrière dans un virage lent, tête-à-queue, et finit dans le bac à graviers. ❌ **DNF.**`,
    `🚗 **T${lap}** — ${n} ${p} sort large en sortie de virage, accroche le mur à faible vitesse mais les dégâts sont trop importants pour continuer. ❌ **DNF.**`,
    `💥 **T${lap}** — Erreur inexplicable de ${n} ${p} — la voiture part en travers et finit sa course dans les protections. ❌ **DNF.**`,
  ];

  if (gpStyle === 'urbain') return pick(urbain);
  if (gpStyle === 'rapide') return pick(rapide);
  return pick(generic);
}

// Description d'une collision entre deux pilotes
function collisionDescription(attacker, victim, lap, attackerDnf, victimDnf, damage) {
  const a = `**${attacker.team.emoji}${attacker.pilot.name}**`;
  const v = `**${victim.team.emoji}${victim.pilot.name}**`;
  const ap = `P${attacker.pos}`;
  const vp = `P${victim.pos}`;

  const intros = [
    `💥 **T${lap} — CONTACT !** ${a} (${ap}) plonge à l'intérieur sur ${v} (${vp}) — les deux voitures se touchent !`,
    `🚨 **T${lap} — ACCROCHAGE !** ${a} (${ap}) arrive trop vite et tape l'arrière de ${v} (${vp}) — les pièces volent !`,
    `💥 **T${lap}** — Tentative de dépassement de ${a} (${ap}) sur ${v} (${vp}) qui ferme la porte — contact inévitable !`,
    `🔥 **T${lap} — INCIDENT !** ${a} (${ap}) et ${v} (${vp}) se touchent au freinage — la course tourne au drame pour les deux !`,
  ];

  let consequence = '\n';
  if (attackerDnf && victimDnf) {
    consequence += `  ❌ **Double DNF.** Les deux voitures sont hors course — les commissaires vont se pencher sur la question.`;
  } else if (attackerDnf && !victimDnf) {
    consequence += `  ❌ ${a} abandonne immédiatement (DNF).\n  ⚠️ ${v} repart mais avec de gros dommages — **+${(damage/1000).toFixed(1)}s** de pénalité et une voiture abîmée.`;
  } else if (!attackerDnf && victimDnf) {
    consequence += `  ❌ ${v} est contraint à l'abandon (DNF).\n  ⚠️ ${a} continue mais endommagé — **+${(damage/1000).toFixed(1)}s** perdus.`;
  } else {
    consequence += `  ⚠️ Les deux continuent avec des dommages mais la direction de course prend note.`;
  }

  return pick(intros) + consequence;
}

// Ambiance aléatoire play-by-play (commentaires sans event)
function atmosphereLine(ranked, lap, totalLaps, weather, scState) {
  if (!ranked.length) return null;
  const leader   = ranked[0];
  const second   = ranked[1];
  const pct      = lap / totalLaps;

  if (scState.state !== 'NONE') return null; // pas pendant SC

  const lines = [];

  // Gap en tête serré
  if (second) {
    const gapTop = (second.totalTime - leader.totalTime) / 1000;
    if (gapTop < 1.5) {
      lines.push(`👀 Moins d'une seconde entre ${leader.team.emoji}**${leader.pilot.name}** et ${second.team.emoji}**${second.pilot.name}** — c'est du couteau !`);
      lines.push(`😤 ${second.team.emoji}**${second.pilot.name}** colle aux roues de ${leader.team.emoji}**${leader.pilot.name}** — la pression est maximale !`);
    }
    if (gapTop > 15) {
      lines.push(`🏃 ${leader.team.emoji}**${leader.pilot.name}** file à l'anglaise — **${gapTop.toFixed(1)}s** d'avance sur son dauphin.`);
    }
  }

  // Ambiance météo
  if (weather === 'WET') lines.push(`🌧️ La piste est toujours glissante — chaque virage est une loterie par ce temps.`);
  if (weather === 'HOT') lines.push(`🔥 La chaleur est intense — les pneus souffrent énormément sur ce circuit.`);

  // Phase de course
  if (pct > 0.45 && pct < 0.55) lines.push(`⏱ Mi-course franchie — le classement commence à se stabiliser. Qui va attaquer ?`);
  if (pct > 0.75) lines.push(`🏁 Dernier quart de course — les stratégies se dévoilent, le jeu des positions bat son plein.`);

  if (!lines.length) return null;
  return pick(lines);
}

// ─── SIMULATION COURSE COMPLÈTE ───────────────────────────
async function simulateRace(race, grid, pilots, teams, contracts, channel) {
  const totalLaps = race.laps;
  const gpStyle   = race.gpStyle;

  // ── Météo dynamique ───────────────────────────────────────
  // Météo de départ (pondérée vers DRY)
  let weather = pick(['DRY','DRY','DRY','DRY','WET','INTER','HOT']);

  // Transitions possibles selon la météo courante
  const WEATHER_TRANSITIONS = {
    DRY   : [{ to: 'DRY', w:12 }, { to: 'HOT', w:2 }, { to: 'INTER', w:1 }],
    HOT   : [{ to: 'HOT', w:10 }, { to: 'DRY', w:3 }, { to: 'INTER', w:1 }],
    INTER : [{ to: 'INTER', w:6 }, { to: 'DRY', w:3 }, { to: 'WET', w:3 }, { to: 'HOT', w:1 }],
    WET   : [{ to: 'WET', w:8 }, { to: 'INTER', w:4 }, { to: 'DRY', w:1 }],
  };

  // Résoudre la prochaine météo par tirage pondéré
  function nextWeather(current) {
    const options = WEATHER_TRANSITIONS[current] || WEATHER_TRANSITIONS['DRY'];
    const total   = options.reduce((s, o) => s + o.w, 0);
    let roll      = Math.random() * total;
    for (const o of options) { roll -= o.w; if (roll <= 0) return o.to; }
    return current;
  }

  // La météo ne change qu'entre certains intervalles (tous les ~10-15 tours)
  let nextWeatherChangeLap = totalLaps < 30
    ? Math.floor(totalLaps * 0.4)
    : randInt(10, 20);
  let weatherChanged = false; // flag pour n'annoncer qu'une fois par changement

  const styleEmojis   = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  const weatherLabels = { DRY:'Sec ☀️', WET:'Pluie 🌧️', INTER:'Mixte 🌦️', HOT:'Canicule 🔥' };

  let drivers = grid.map((g, idx) => {
    const pilot = pilots.find(p => String(p._id) === String(g.pilotId));
    const team  = teams.find(t => String(t._id) === String(pilot?.teamId));
    if (!pilot || !team) return null;
    const startCompound = chooseStartCompound(totalLaps, weather);
    return {
      pilot, team,
      pos          : idx + 1,
      startPos     : idx + 1,
      lastPos      : idx + 1,
      totalTime    : idx * 200,
      tireCompound : startCompound,
      tireWear     : 0,
      tireAge      : 0,
      usedCompounds: [startCompound],
      pitStops     : 0,
      pittedThisLap: false,
      dnf          : false,
      dnfLap       : null,
      dnfReason    : '',
      fastestLap   : Infinity,
    };
  }).filter(Boolean);

  let scState          = { state: 'NONE', lapsLeft: 0 };
  let fastestLapMs     = Infinity;
  let fastestLapHolder = null;

  const send = async (msg) => {
    if (!channel) return;
    // Discord limit: 2000 chars per message
    if (msg.length > 1950) msg = msg.slice(0, 1947) + '…';
    try { await channel.send(msg); } catch(e) { console.error('send error:', e.message); }
    await sleep(2500);
  };

  const sendEmbed = async (embed) => {
    if (!channel) return;
    try { await channel.send({ embeds: [embed] }); } catch(e) {}
    await sleep(2500);
  };

  // ══════════════════════════════════════════════════════════
  // PRE-RACE — Grille de départ complète
  // ══════════════════════════════════════════════════════════
  const gridLines = drivers.map((d, i) => {
    const ov   = overallRating(d.pilot);
    const tier = ratingTier(ov);
    const pos  = String(i + 1).padStart(2, ' ');
    return `\`P${pos}\` ${d.team.emoji} **${d.pilot.name}** ${tier.badge}**${ov}** — ${TIRE[d.tireCompound].emoji} ${TIRE[d.tireCompound].label}`;
  });

  // Discord embed description limit 4096 — split grid if needed
  const half      = Math.ceil(drivers.length / 2);
  const gridLeft  = gridLines.slice(0, half).join('\n');
  const gridRight = gridLines.slice(half).join('\n');

  const gridEmbed = new EmbedBuilder()
    .setTitle(`🏎️ GRILLE DE DÉPART — ${race.emoji} ${race.circuit}`)
    .setColor('#FF1801')
    .setDescription(`${styleEmojis[gpStyle]} **${gpStyle.toUpperCase()}** · ${weatherLabels[weather]} · **${totalLaps} tours**`)
    .addFields(
      { name: '📋 Positions 1–' + half,       value: gridLeft  || '—', inline: true },
      { name: '📋 Positions ' + (half+1) + '–' + drivers.length, value: gridRight || '—', inline: true },
    );
  await sendEmbed(gridEmbed);
  await sleep(3000);

  // Formation lap narrative
  await send(
    `🟢 **TOUR DE FORMATION** — ${race.emoji} ${race.circuit.toUpperCase()}\n` +
    `Les monoplaces prennent position sur la grille... La tension est à son comble.\n` +
    `🔴🔴🔴🔴🔴  Les feux s'allument un à un...`
  );
  await sleep(4000);
  await send(`🟢⚫ **EXTINCTION DES FEUX — C'EST PARTI !!** 🏁`);

  // ══════════════════════════════════════════════════════════
  // BOUCLE PRINCIPALE
  // ══════════════════════════════════════════════════════════
  for (let lap = 1; lap <= totalLaps; lap++) {
    const lapsRemaining = totalLaps - lap;
    const trackEvo      = (lap / totalLaps) * 100;
    drivers.forEach(d => { d.pittedThisLap = false; });
    const alive    = drivers.filter(d => !d.dnf);
    const dnfCount = drivers.filter(d => d.dnf).length;

    // ── Changement de météo dynamique ───────────────────────
    if (lap === nextWeatherChangeLap && lap < totalLaps - 5) {
      const prevWeather = weather;
      weather = nextWeather(weather);
      // Planifier le prochain changement possible
      nextWeatherChangeLap = lap + randInt(10, 18);
      weatherChanged = weather !== prevWeather;

      if (weatherChanged) {
        // Textes d'annonce selon la transition
        const weatherLabelsShort = { DRY:'Sec ☀️', WET:'Pluie 🌧️', INTER:'Mixte 🌦️', HOT:'Canicule 🔥' };
        const transitionMsgs = {
          'DRY→WET'   : `🌧️ **T${lap} — LA PLUIE ARRIVE !** Les premières gouttes tombent sur la piste — les équipes vont-elles rentrer pour des intermédiaires ? Stratégie cruciale !`,
          'DRY→INTER' : `🌦️ **T${lap} — Nuages menaçants.** La piste commence à se mouiller par endroits. Les inter' deviennent une option sérieuse.`,
          'DRY→HOT'   : `🔥 **T${lap} — Canicule !** La température monte en flèche — la gestion des pneus devient critique. Les voitures peu bien refroidies vont souffrir.`,
          'HOT→INTER' : `🌦️ **T${lap} — Orage soudain !** Un grain éclate sur le circuit — la piste devient traîtresse. Pit lane, tout le monde rentre !`,
          'HOT→DRY'   : `☀️ **T${lap} — Retour au calme.** Soleil de plomb, conditions sèches normales. Les temps devraient redevenir meilleurs.`,
          'INTER→DRY' : `☀️ **T${lap} — La piste sèche !** La fenêtre des slicks approche — qui va prendre le risque d'être le premier à rentrer pour des pneus secs ?`,
          'INTER→WET' : `🌧️ **T${lap} — Déluge !** La pluie se renforce — les inter' ne suffisent plus. Il va falloir basculer sur des pluies full wet.`,
          'WET→INTER' : `🌦️ **T${lap} — La pluie se calme.** La piste commence à sécher par endroits. Les pilotes les plus courageux vont tenter les inter'...`,
          'WET→DRY'   : `☀️ **T${lap} — Course folle en vue !** Le temps change radicalement — la piste sèche vite. Stratégie frénétique dans les stands !`,
        };
        const key = `${prevWeather}→${weather}`;
        const msg = transitionMsgs[key] || `🌡️ **T${lap} — Changement météo !** ${weatherLabelsShort[prevWeather]} → ${weatherLabelsShort[weather]}`;

        if (channel) {
          try { await channel.send(msg); await sleep(2500); } catch(e) {}
        }

        // Forcer les pilotes sur pneus inadaptés à pit au prochain tour si météo radicale
        // (DRY→WET, WET→DRY, HOT→INTER) : on augmente leur usure artificiellement pour déclencher shouldPit
        const forceWear = ['DRY→WET','WET→DRY','HOT→INTER','INTER→WET'].includes(key);
        if (forceWear) {
          for (const d of alive) {
            const needWet  = (weather === 'WET' || weather === 'INTER') && (d.tireCompound === 'SOFT' || d.tireCompound === 'MEDIUM' || d.tireCompound === 'HARD');
            const needDry  = (weather === 'DRY' || weather === 'HOT')   && (d.tireCompound === 'WET'  || d.tireCompound === 'INTER');
            if (needWet || needDry) d.tireWear = Math.max(d.tireWear, 38); // forcer shouldPit
          }
        }
      }
    }

    // Snapshot des positions avant ce tour
    alive.forEach(d => { d.lastPos = d.pos; });

    const events    = []; // { priority, text }
    const lapDnfs   = []; // DNFs survenus CE tour — pour expliquer le SC
    const lapIncidents = []; // incidents ce tour pour SC logic

    // ── Snapshot des temps AVANT calcul du tour ──────────────
    // Clé = String(pilot._id), valeur = totalTime avant ce tour
    const preLapTimes = new Map(alive.map(d => [String(d.pilot._id), d.totalTime]));

    // ── Tour 1 : bagarre au départ ──────────────────────────
    if (lap === 1) {
      const startSwaps = [];
      for (let i = drivers.length - 1; i > 0; i--) {
        const d     = drivers[i];
        const ahead = drivers[i - 1];
        if (!d || !ahead) continue;
        const reactDiff = d.pilot.reactions - ahead.pilot.reactions;
        if (reactDiff > 12 && Math.random() > 0.52) {
          [drivers[i], drivers[i - 1]] = [drivers[i - 1], drivers[i]];
          drivers[i].pos     = i + 1;
          drivers[i - 1].pos = i;
          startSwaps.push(`${d.team.emoji}**${d.pilot.name}** P${i+1}→**P${i}** dépasse ${ahead.team.emoji}**${ahead.pilot.name}**`);
        }
      }
      drivers.sort((a,b) => a.pos - b.pos).forEach((d,i) => d.pos = i+1);
      alive.forEach(d => { d.lastPos = d.pos; });
      const startLeader = drivers[0];
      if (startSwaps.length) {
        events.push({ priority: 9, text:
          `🚦 **BAGARRE AU PREMIER VIRAGE !**\n${startSwaps.slice(0,4).map(s => `  › ${s}`).join('\n')}\n  › ${startLeader.team.emoji}**${startLeader.pilot.name}** mène à l'issue du premier tour !`
        });
      } else {
        const cleanFlavors = [
          `🚦 **DÉPART CANON !** ${startLeader.team.emoji} **${startLeader.pilot.name}** bondit parfaitement et prend immédiatement deux longueurs d'avance !`,
          `🚦 **DÉPART PROPRE !** ${startLeader.team.emoji} **${startLeader.pilot.name}** conserve la pole et mène le peloton dans le premier virage.`,
          `🚦 **EN ROUTE !** ${startLeader.team.emoji} **${startLeader.pilot.name}** réaction parfaite — il fuit en tête dès l'extinction des feux !`,
        ];
        events.push({ priority: 9, text: pick(cleanFlavors) });
      }
    }

    // ── Tour final ──────────────────────────────────────────
    if (lap === totalLaps) {
      const leader = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime)[0];
      if (leader) {
        const finalFlavors = [
          `🏁 **DERNIER TOUR !** ${leader.team.emoji} **${leader.pilot.name}** en tête — le public est debout, les écuries retiennent leur souffle !`,
          `🏁 **TOUR ${totalLaps} — LE DERNIER !** ${leader.team.emoji} **${leader.pilot.name}** à quelques kilomètres d'une victoire qui s'annonce méritée !`,
          `🏁 **ALERTE LAST LAP !** ${leader.team.emoji} **${leader.pilot.name}** mène — mais rien n'est fait tant que le drapeau à damier n'a pas agité !`,
        ];
        events.push({ priority: 9, text: pick(finalFlavors) });
      }
    }

    // ── Incidents ───────────────────────────────────────────
    for (const driver of alive) {
      const incident = checkIncident(driver.pilot, driver.team);
      if (!incident) continue;

      let incidentText = '';

      if (incident.type === 'CRASH') {
        // Chercher pilote proche pour potentielle collision
        const candidates = alive.filter(d => !d.dnf && String(d.pilot._id) !== String(driver.pilot._id));
        const nearest    = [...candidates].sort((a,b) =>
          Math.abs(a.totalTime - driver.totalTime) - Math.abs(b.totalTime - driver.totalTime)
        )[0];
        const isCollision = nearest && Math.abs(nearest.totalTime - driver.totalTime) < 1200;

        if (isCollision) {
          const attackerDnf = true; // l'initiateur DNF toujours
          const victimDnf   = Math.random() > 0.45;
          const damage      = randInt(3000, 9000);

          driver.dnf       = true;
          driver.dnfLap    = lap;
          driver.dnfReason = 'CRASH';
          lapDnfs.push({ driver, reason: 'CRASH' });
          lapIncidents.push({ type: 'CRASH' });

          if (victimDnf) {
            nearest.dnf       = true;
            nearest.dnfLap    = lap;
            nearest.dnfReason = 'CRASH';
            lapDnfs.push({ driver: nearest, reason: 'CRASH' });
            lapIncidents.push({ type: 'CRASH' });
            incidentText = collisionDescription(driver, nearest, lap, true, true, 0);
          } else {
            nearest.totalTime += damage;
            incidentText = collisionDescription(driver, nearest, lap, true, false, damage);
          }
        } else {
          // Crash solo
          driver.dnf       = true;
          driver.dnfLap    = lap;
          driver.dnfReason = 'CRASH';
          lapDnfs.push({ driver, reason: 'CRASH' });
          lapIncidents.push({ type: 'CRASH' });
          incidentText = crashSoloDescription(driver, lap, gpStyle);
        }

      } else if (incident.type === 'MECHANICAL') {
        driver.dnf       = true;
        driver.dnfLap    = lap;
        driver.dnfReason = 'MECHANICAL';
        lapDnfs.push({ driver, reason: 'MECHANICAL' });
        lapIncidents.push({ type: 'MECHANICAL' }); // pas de SC pour mécanique
        const mechFlavors = [
          `🔩 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) se range sur le bas-côté, fumée blanche qui s'échappe du moteur. L'équipe le rappelle au garage. ❌ **DNF mécanique.**`,
          `💨 **T${lap}** — Le moteur de ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) rend l'âme dans une ligne droite. La voiture ralentit, ralentit... et s'arrête. ❌ **DNF.**`,
          `🔥 **T${lap}** — Température moteur dans le rouge pour ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}). La radio grésille, le muret dit "Rentre au garage". Abandon. ❌ **DNF.**`,
          `⚙️ **T${lap}** — Problème de transmission pour ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) — il ne passe plus les vitesses. La course est terminée. ❌ **DNF.**`,
          `💥 **T${lap}** — Explosion mécanique soudaine pour ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) ! Les débris jonchent la piste — voiture irrécupérable. ❌ **DNF.**`,
        ];
        incidentText = pick(mechFlavors);

      } else if (incident.type === 'PUNCTURE') {
        driver.dnf       = true;
        driver.dnfLap    = lap;
        driver.dnfReason = 'PUNCTURE';
        lapDnfs.push({ driver, reason: 'PUNCTURE' });
        lapIncidents.push({ type: 'PUNCTURE' });
        const puncFlavors = [
          `🫧 **T${lap}** — CREVAISON ! ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) perd un pneu à haute vitesse — la voiture devient inconduisible. Il rentre en se traînant sur la jante. ❌ **DNF.**`,
          `🫧 **T${lap}** — Pneu avant gauche qui explose pour ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) ! La voiture part en travers, il tient le choc mais ne peut pas continuer. ❌ **DNF.**`,
          `🫧 **T${lap}** — Délamination catastrophique sur la voiture de ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) — les caoutchoucs arrachés détruisent la carrosserie. ❌ **DNF.**`,
        ];
        incidentText = pick(puncFlavors);
      }

      if (incidentText) events.push({ priority: 8, text: incidentText });
    }

    // ── Safety Car (APRÈS les incidents — on peut citer la cause) ──
    const prevScState = scState.state;
    scState = resolveSafetyCar(scState, lapIncidents);
    const scActive = scState.state !== 'NONE';

    if (scState.state !== 'NONE' && prevScState === 'NONE') {
      // Trouver la cause probable (dernier DNF du tour)
      const cause     = lapDnfs.length > 0 ? lapDnfs[lapDnfs.length - 1] : null;
      const causeStr  = cause
        ? ` à cause de **l'abandon de ${cause.driver.pilot.name}**`
        : ` suite à un incident sur la piste`;

      if (scState.state === 'SC') {
        const scFlavors = [
          `🚨 **SAFETY CAR DÉPLOYÉ AU TOUR ${lap}**${causeStr} !\nLe peloton se reforme — tous les écarts sont effacés. C'est reparti de zéro !`,
          `🚨 **SAFETY CAR !** Tour ${lap}${causeStr}. La direction de course intervient — la voiture de sécurité prend la tête. Qui va rentrer aux stands ?`,
          `🚨 **SC IN !** Tour ${lap}${causeStr}. Les commissaires nettoient la piste. Le peloton se compacte — ça va redonner du piment à cette course !`,
        ];
        events.push({ priority: 10, text: pick(scFlavors) });
      } else {
        const vscFlavors = [
          `🟡 **VIRTUAL SAFETY CAR** déployé au tour ${lap}${causeStr}. Tout le monde roule au ralenti — pas de double yellow dans les stands.`,
          `🟡 **VSC !** Tour ${lap}${causeStr}. Les pilotes maintiennent le delta. La course se met en pause le temps de sécuriser la zone.`,
        ];
        events.push({ priority: 10, text: pick(vscFlavors) });
      }
    }

    if (prevScState !== 'NONE' && scState.state === 'NONE') {
      const ranked = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      const top3   = ranked.slice(0,3).map((d,i) => `P${i+1} ${d.team.emoji}**${d.pilot.name}**`).join(' · ');
      const gfFlavors = [
        `🟢 **GREEN FLAG !** Tour ${lap} — La course est relancée ! ${top3}\nLes stratèges se grattent la tête — qui va attaquer en premier ?`,
        `🟢 **FEU VERT !** Tour ${lap} — On repart ! Classement : ${top3}\nLa course va reprendre de plus belle — tensions garanties !`,
      ];
      events.push({ priority: 10, text: pick(gfFlavors) });
    }

    // ── Calcul des temps au tour ─────────────────────────────
    for (const driver of drivers.filter(d => !d.dnf)) {
      let lt = calcLapTime(
        driver.pilot, driver.team,
        driver.tireCompound, driver.tireWear,
        weather, trackEvo, gpStyle, driver.pos
      );
      if (scActive) lt = Math.round(lt * (scState.state === 'SC' ? 1.35 : 1.18));

      driver.totalTime += lt;
      driver.tireWear  += 1;
      driver.tireAge   += 1;
      if (lt < driver.fastestLap) driver.fastestLap = lt;
      if (lt < fastestLapMs) { fastestLapMs = lt; fastestLapHolder = driver; }
    }

    // ── Pit stops ────────────────────────────────────────────
    const aliveNow = drivers.filter(d => !d.dnf);
    aliveNow.sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);

    for (const driver of aliveNow) {
      const myIdx    = aliveNow.findIndex(d => String(d.pilot._id) === String(driver.pilot._id));
      const gapAhead = myIdx > 0 ? driver.totalTime - aliveNow[myIdx - 1].totalTime : null;
      const { pit, reason } = shouldPit(driver, lapsRemaining, gapAhead);

      if (pit && driver.pitStops < 3 && lapsRemaining > 5) {
        const posIn      = driver.pos;
        const oldTire    = driver.tireCompound;
        const newCompound = choosePitCompound(oldTire, lapsRemaining, driver.usedCompounds);
        const pitTime    = randInt(19_000, 24_000);

        driver.totalTime   += pitTime;
        driver.tireCompound = newCompound;
        driver.tireWear     = 0;
        driver.tireAge      = 0;
        driver.pitStops    += 1;
        driver.pittedThisLap = true;
        if (!driver.usedCompounds.includes(newCompound)) driver.usedCompounds.push(newCompound);

        aliveNow.sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
        const posOut = driver.pos;
        const pitDur = (pitTime / 1000).toFixed(1);

        const pitFlavors = reason === 'undercut' ? [
          `🔧 **T${lap} — UNDERCUT !** ${driver.team.emoji}**${driver.pilot.name}** plonge aux stands depuis **P${posIn}** — ${TIRE[oldTire].emoji} → ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** — arrêt de **${pitDur}s** — ressort **P${posOut}**. La stratégie va-t-elle payer ?`,
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** tente l'undercut depuis **P${posIn}** ! Chaussage en ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s — ressort **P${posOut}**. L'équipe joue le tout pour le tout.`,
        ] : [
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** rentre aux stands depuis **P${posIn}** — pneus ${TIRE[oldTire].emoji} en fin de vie. Passage en ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en **${pitDur}s** — ressort **P${posOut}**.`,
          `🔧 **T${lap} — ARRÊT AUX STANDS** pour ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) — ${TIRE[oldTire].emoji} cramés. L'équipe boulonne les ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s. **P${posOut}** à la sortie du pitlane.`,
        ];
        events.push({ priority: 7, text: pick(pitFlavors) });
      }
    }

    // ── Reclassement ─────────────────────────────────────────
    drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
    const ranked = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);

    // ── Dépassements ─────────────────────────────────────────
    // Un dépassement en piste ne peut se produire que si les deux pilotes
    // étaient PROCHES avant ce tour (gap pré-tour < 4s). Sinon c'est un
    // artefact de simulation (pit mal classifié, écart trop grand).
    for (const driver of ranked) {
      if (driver.pos >= driver.lastPos) continue;          // pas progressé
      if (driver.pittedThisLap) continue;                  // position due au pit
      if (scActive) continue;                              // pas pendant SC
      if (lap <= 1) continue;

      // Trouver le pilote "passé" : celui qui occupait driver.lastPos
      // et qui n'a pas lui-même pité
      const passed = ranked.find(d =>
        d.pos === driver.lastPos &&
        !d.pittedThisLap &&
        String(d.pilot._id) !== String(driver.pilot._id)
      );
      if (!passed) continue;

      // Vérifier que le gap PRÉ-tour entre les deux était réaliste
      // pour un vrai dépassement en piste (max ~4 secondes)
      const preLapDriver = preLapTimes.get(String(driver.pilot._id)) ?? driver.totalTime;
      const preLapPassed = preLapTimes.get(String(passed.pilot._id)) ?? passed.totalTime;
      const preLapGapMs  = Math.abs(preLapPassed - preLapDriver);
      if (preLapGapMs > 4000) continue; // trop loin l'un de l'autre — pas un vrai dépassement

      // Gap APRÈS le tour (écart résultant)
      const postGapMs = Math.abs(driver.totalTime - passed.totalTime);
      const gapStr    = postGapMs < 1000
        ? `${postGapMs}ms sur ${passed.pilot.name}`
        : `+${(postGapMs / 1000).toFixed(3)}s sur ${passed.pilot.name}`;

      const gapOnLeader = driver.pos > 1
        ? ` · ${((driver.totalTime - ranked[0].totalTime) / 1000).toFixed(3)}s du leader`
        : '';

      const drsTag  = gpStyle === 'rapide' && driver.team.drs > 82 ? ' 📡 *DRS*' : '';
      const howDesc = overtakeDescription(driver, passed, gpStyle);

      events.push({
        priority: 6,
        text: `⚔️ **T${lap} — DÉPASSEMENT !** P${driver.lastPos} → **P${driver.pos}**${drsTag}\n  › ${howDesc}\n  › Écart : **${gapStr}**${gapOnLeader}`,
      });
    }

    // ── Atmosphère play-by-play (tous les 3 tours si pas d'events) ──
    if (!events.length && lap % 3 === 0) {
      const atmo = atmosphereLine(ranked, lap, totalLaps, weather, scState);
      if (atmo) events.push({ priority: 1, text: atmo });
    }

    // ── Composition et envoi du message ─────────────────────
    events.sort((a,b) => b.priority - a.priority);
    const eventsText = events.map(e => e.text).join('\n\n');

    const showFullStandings = (lap % 10 === 0) || lap === totalLaps;
    const showTop5          = (lap % 5 === 0 && !showFullStandings) || (scActive && prevScState !== 'NONE');

    let standingsText = '';
    if (showFullStandings) {
      const dnfLines = drivers.filter(d => d.dnf);
      standingsText = '\n\n📋 **CLASSEMENT COMPLET — Tour ' + lap + '/' + totalLaps + '**\n' +
        ranked.map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? '⏱ **LEADER**' : `+${(gapMs/1000).toFixed(3)}s / leader`;
          return `\`P${String(i+1).padStart(2,' ')}\` ${d.team.emoji} **${d.pilot.name}** — ${gapStr} ${TIRE[d.tireCompound].emoji} (${d.pitStops} arr.)`;
        }).join('\n') +
        (dnfLines.length ? '\n' + dnfLines.map(d => `~~${d.team.emoji}${d.pilot.name}~~ ❌ T${d.dnfLap}`).join(' · ') : '');
    } else if (showTop5) {
      standingsText = '\n\n🏎️ **Top ' + Math.min(5, ranked.length) + ' — T' + lap + '/' + totalLaps + '**\n' +
        ranked.slice(0, 5).map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? 'LEADER' : `+${(gapMs/1000).toFixed(3)}s / leader`;
          return `**P${i+1}** ${d.team.emoji} **${d.pilot.name}** — ${gapStr} ${TIRE[d.tireCompound].emoji}`;
        }).join('\n');
    }

    const hasEvents = events.length > 0;
    if (hasEvents || showFullStandings || showTop5) {
      const header = `**⏱ Tour ${lap}/${totalLaps}**` +
        (scState.state === 'SC'  ? ` 🚨 **SAFETY CAR**` : '') +
        (scState.state === 'VSC' ? ` 🟡 **VSC**`         : '');
      await send([header, eventsText, standingsText].filter(Boolean).join('\n'));
    }
  }

  // ══════════════════════════════════════════════════════════
  // RÉSULTATS FINAUX
  // ══════════════════════════════════════════════════════════
  const finalRanked = [
    ...drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime),
    ...drivers.filter(d =>  d.dnf).sort((a,b) => (b.dnfLap||0) - (a.dnfLap||0)),
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
      pilotId   : driver.pilot._id,
      teamId    : driver.team._id,
      pos       : driver.pos,
      dnf       : driver.dnf,
      dnfReason : driver.dnfReason,
      coins, fastestLap: fl,
    });
  }

  // ── Drapeau à damier ────────────────────────────────────
  const winner = finalRanked[0];
  const winFlavors = [
    `🏁 **DRAPEAU À DAMIER !** ${race.emoji} ${race.circuit}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** remporte le Grand Prix !`,
    `🏁 **C'EST FINI !** ${race.emoji} ${race.circuit}\n🏆 Victoire de **${winner.team.emoji} ${winner.pilot.name}** — une course magistrale !`,
    `🏁 **FIN DE COURSE !** ${race.emoji} ${race.circuit}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** franchit la ligne en vainqueur !`,
  ];
  await send(pick(winFlavors));

  // ── Embed podium ─────────────────────────────────────────
  const dnfDrivers = drivers.filter(d => d.dnf);
  const dnfStr = dnfDrivers.length
    ? dnfDrivers.map(d => {
        const reasonLabels = { CRASH:'💥 Accident', MECHANICAL:'🔩 Mécanique', PUNCTURE:'🫧 Crevaison' };
        return `❌ ${d.team.emoji} **${d.pilot.name}** — ${reasonLabels[d.dnfReason]||'DNF'} (T${d.dnfLap})`;
      }).join('\n')
    : '*Aucun abandon — course propre !*';

  const podiumEmbed = new EmbedBuilder()
    .setTitle(`🏆 PODIUM OFFICIEL — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(
      finalRanked.slice(0, 3).map((d, i) => {
        const gapMs  = i === 0 ? null : d.totalTime - finalRanked[0].totalTime;
        const gapStr = i === 0 ? '' : ` (+${(gapMs/1000).toFixed(3)}s)`;
        return `${['🥇','🥈','🥉'][i]} **${d.team.emoji} ${d.pilot.name}** — ${d.team.name}${gapStr}`;
      }).join('\n') +
      '\n\u200B\n**Abandons :**\n' + dnfStr +
      (fastestLapHolder ? `\n\u200B\n⚡ **Meilleur tour :** ${fastestLapHolder.team.emoji} **${fastestLapHolder.pilot.name}** — ${msToLapStr(fastestLapMs)}` : '')
    );
  await sendEmbed(podiumEmbed);

  return results;
}

// ─── Fixtures de test (pilotes/équipes fictifs réutilisés par admin_test_*) ──
function buildTestFixtures() {
  const ObjectId = require('mongoose').Types.ObjectId;
  const testTeamDefs = [
    { name:'Red Horizon TEST',  emoji:'🔵', color:'#1E3A5F', budget:160, vitesseMax:95, drs:95, refroidissement:90, dirtyAir:88, conservationPneus:88, vitesseMoyenne:93, devPoints:0 },
    { name:'Scuderia TEST',     emoji:'🔴', color:'#DC143C', budget:150, vitesseMax:92, drs:90, refroidissement:88, dirtyAir:85, conservationPneus:85, vitesseMoyenne:90, devPoints:0 },
    { name:'Silver Arrow TEST', emoji:'⚪', color:'#C0C0C0', budget:145, vitesseMax:90, drs:88, refroidissement:92, dirtyAir:82, conservationPneus:87, vitesseMoyenne:88, devPoints:0 },
    { name:'McLaren TEST',      emoji:'🟠', color:'#FF7722', budget:130, vitesseMax:85, drs:84, refroidissement:82, dirtyAir:80, conservationPneus:83, vitesseMoyenne:85, devPoints:0 },
    { name:'Alpine TEST',       emoji:'💙', color:'#0066CC', budget:110, vitesseMax:75, drs:76, refroidissement:78, dirtyAir:75, conservationPneus:76, vitesseMoyenne:76, devPoints:0 },
  ];
  const testNames = ['Verstappen PL','Hamilton PL','Leclerc PL','Norris PL','Sainz PL','Russell PL','Alonso PL','Perez PL','Piastri PL','Albon PL'];
  const testTeams  = testTeamDefs.map(t => ({ ...t, _id: new ObjectId() }));
  const testPilots = testNames.map((name, i) => ({
    _id: new ObjectId(), name, discordId: 'bot',
    teamId: testTeams[Math.floor(i / 2)]._id,
    depassement: randInt(52, 92), freinage: randInt(52, 92),
    defense: randInt(48, 88),     adaptabilite: randInt(48, 88),
    reactions: randInt(50, 90),   controle: randInt(52, 92),
    gestionPneus: randInt(48, 88), plcoins: 0, totalEarned: 0,
  }));
  const testRace = {
    _id: new ObjectId(), circuit: 'Circuit Test PL', emoji: '🧪',
    laps: 30,
    gpStyle: pick(['mixte','rapide','technique','urbain','endurance']),
    status: 'upcoming',
  };
  return { testTeams, testPilots, testRace };
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

// ============================================================
// 🤖  IA DE RECRUTEMENT — Moteur d'offres automatique
// ============================================================
//
// Appelée UNE SEULE FOIS à la fin de chaque saison.
// Chaque écurie analyse les pilotes disponibles et génère
// des offres cohérentes avec son budget, son niveau et ses besoins.
//
// LOGIQUE PAR ÉCURIE :
//  1. Calculer les "besoins" : quels slots sont libres ?
//  2. Scorer chaque pilote libre selon la "philosophie" de l'écurie
//  3. Générer des offres sur les N meilleurs candidats (avec concurrence)
//  4. Calibrer le contrat (salaire, durée, primes) selon le budget et la valeur du pilote
//
// PHILOSOPHIE D'ÉCURIE (déduite du budget) :
//  Budget élevé  → cherche les meilleurs profils, offres généreuses, contrats courts (confiance)
//  Budget moyen  → cherche l'équilibre perf/coût, contrats 2 saisons
//  Budget faible → mise sur les jeunes (note basse mais potentiel), contrats longs (fidéliser)

async function startTransferPeriod() {
  const season = await getActiveSeason();
  if (!season) return 0;

  // 1. Passer la saison en mode transfert
  await Season.findByIdAndUpdate(season._id, { status: 'transfer' });

  // 2. Décrémenter tous les contrats actifs
  await Contract.updateMany({ active: true }, { $inc: { seasonsRemaining: -1 } });

  // 3. Expirer les contrats à 0 saison restante → pilote libéré
  const expiredContracts = await Contract.find({ seasonsRemaining: 0, active: true });
  for (const c of expiredContracts) {
    await Contract.findByIdAndUpdate(c._id, { active: false });
    await Pilot.findByIdAndUpdate(c.pilotId, { teamId: null });
  }

  // 4. Nettoyer les anciennes offres pending (saison précédente)
  await TransferOffer.updateMany({ status: 'pending' }, { status: 'expired' });

  // 5. IA de recrutement — chaque écurie fait ses offres
  const allTeams    = await Team.find();
  const freePilots  = await Pilot.find({ teamId: null });
  const allStandings = await Standing.find({ seasonId: season._id });

  if (!freePilots.length) return expiredContracts.length;

  // Classement constructeurs de la saison pour évaluer la force des écuries
  const constrStandings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
  const teamRankMap = new Map(constrStandings.map((s, i) => [String(s.teamId), i + 1]));
  const totalTeams  = allTeams.length;

  for (const team of allTeams) {
    const slotsAvailable = 2 - await Pilot.countDocuments({ teamId: team._id });
    if (slotsAvailable <= 0) continue; // écurie pleine

    const teamRank   = teamRankMap.get(String(team._id)) || Math.ceil(totalTeams / 2);
    const budgetRatio = team.budget / 160; // 160 = budget max (Red Horizon)

    // ── Philosophie de recrutement selon budget ──────────────
    // Riche  (>120) : cherche la performance brute, évite les rookies
    // Milieu (80-120): équilibre perf/coût, ouvert à tout profil
    // Pauvre (<80)  : mise sur les pilotes en progression (note basse mais stats clés élevées)
    const prefersPeakPerformers = team.budget >= 120;
    const prefersYoungTalent    = team.budget < 80;

    // ── Score d'attractivité du pilote pour CETTE écurie ─────
    function scoreCandidate(pilot) {
      const ov = overallRating(pilot);

      // Style du pilote par rapport aux circuits à venir
      // On utilise le score moyen sur les 5 styles comme proxy de polyvalence
      const polyvalence = (
        pilotScore(pilot, 'rapide')    +
        pilotScore(pilot, 'technique') +
        pilotScore(pilot, 'urbain')    +
        pilotScore(pilot, 'endurance') +
        pilotScore(pilot, 'mixte')
      ) / 5;

      // Statistiques en saison (si le pilote en a)
      const standing = allStandings.find(s => String(s.pilotId) === String(pilot._id));
      const seasonScore = standing
        ? (standing.points * 0.6 + standing.wins * 5 + standing.podiums * 2 - standing.dnfs * 3)
        : 0;

      // Adéquation voiture ↔ pilote : certaines stats du pilote complètent les faiblesses de la voiture
      // Ex: voiture faible en Dirty Air → préfère un pilote avec un bon score Dépassement
      const carWeakStat = ['vitesseMax','drs','refroidissement','dirtyAir','conservationPneus','vitesseMoyenne']
        .reduce((w, k) => team[k] < team[w] ? k : w, 'vitesseMax');
      const complementBonus =
        carWeakStat === 'dirtyAir'          ? pilot.depassement  * 0.1 :
        carWeakStat === 'conservationPneus' ? pilot.gestionPneus * 0.1 :
        carWeakStat === 'refroidissement'   ? pilot.adaptabilite * 0.1 :
        pilot.controle * 0.05;

      // Biais selon la philosophie
      const philosophyScore =
        prefersPeakPerformers ? ov * 1.4 + polyvalence * 0.4 :
        prefersYoungTalent    ? (100 - ov) * 0.3 + polyvalence * 0.8 + complementBonus :
                                ov * 1.0 + polyvalence * 0.6 + seasonScore * 0.02;

      return Math.round(philosophyScore + complementBonus + seasonScore * 0.015);
    }

    // Scorer et trier les pilotes libres
    const ranked = freePilots
      .map(p => ({ pilot: p, score: scoreCandidate(p) }))
      .sort((a, b) => b.score - a.score);

    // ── Nombre de candidats ciblés ────────────────────────────
    // Les riches font des offres plus sélectives (top 3 seulement)
    // Les pauvres font plus d'offres (ils ont besoin d'espoir que quelqu'un accepte)
    const offerCount = prefersPeakPerformers
      ? Math.min(3, ranked.length)
      : prefersYoungTalent
        ? Math.min(6, ranked.length)
        : Math.min(4, ranked.length);

    const targets = ranked.slice(0, offerCount * slotsAvailable); // plus de candidats si 2 slots

    for (const { pilot, score } of targets) {
      // ── Calibration du contrat ─────────────────────────────
      const ov = overallRating(pilot);

      // Salaire de base : proportionnel au budget ET à la valeur du pilote
      // Un pilote noté 80 dans une écurie à 160 budget → ~240 PLcoins/course
      const salaireBase = Math.round(
        (budgetRatio * 200) * (ov / 75) * rand(0.85, 1.15)
      );

      // Multiplicateur : les riches paient mieux en relatif
      const coinMultiplier = parseFloat(
        clamp(budgetRatio * rand(1.0, 1.6), 0.8, 2.5).toFixed(2)
      );

      // Primes : proportionnelles au rang de l'écurie (meilleures écuries = plus grosses primes)
      const primeVictoire = Math.round(
        (200 - teamRank * 15) * rand(0.8, 1.3) * budgetRatio
      );
      const primePodium = Math.round(primeVictoire * rand(0.3, 0.5));

      // Durée du contrat :
      //  Pilote top (ov ≥ 75) + écurie riche    → contrat court (1 saison — confiance mutuelle)
      //  Pilote moyen                             → 2 saisons (stabilité)
      //  Pilote faible + écurie pauvre (pari)    → 3 saisons (investissement long terme)
      //  Pilote top + écurie pauvre               → 1 saison (le pilote partira vite de toute façon)
      let seasons;
      if (ov >= 78 && prefersPeakPerformers)      seasons = 1;
      else if (ov >= 78 && prefersYoungTalent)    seasons = 1; // pilote trop fort pour eux, offre de passage
      else if (ov < 65 && prefersYoungTalent)     seasons = 3; // pari sur un jeune, on verrouille
      else                                         seasons = 2;

      // Expiration de l'offre : 7 jours
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Ne pas créer de doublon si une offre est déjà pending entre ces deux entités
      const already = await TransferOffer.findOne({ teamId: team._id, pilotId: pilot._id, status: 'pending' });
      if (already) continue;

      await TransferOffer.create({
        teamId: team._id, pilotId: pilot._id,
        coinMultiplier,
        primeVictoire: Math.max(0, primeVictoire),
        primePodium:   Math.max(0, primePodium),
        salaireBase:   Math.max(50, salaireBase),
        seasons,
        status: 'pending',
        expiresAt,
      });
    }
  }

  return expiredContracts.length;
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

  new SlashCommandBuilder().setName('historique')
    .setDescription('Historique de carrière multi-saisons d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible (toi par défaut)')),

  new SlashCommandBuilder().setName('pilotes')
    .setDescription('Liste tous les pilotes classés par note générale (style FIFA)'),

  new SlashCommandBuilder().setName('admin_set_photo')
    .setDescription('[ADMIN] Définit la photo de profil d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('URL directe de l\'image (jpg/png/gif)').setRequired(true)),

  new SlashCommandBuilder().setName('admin_draft_start')
    .setDescription('[ADMIN] Lance le draft snake — chaque joueur choisit son écurie'),

  new SlashCommandBuilder().setName('admin_test_race')
    .setDescription('[ADMIN] Simule une course fictive avec pilotes fictifs — test visuel'),

  new SlashCommandBuilder().setName('admin_test_practice')
    .setDescription('[ADMIN] Simule des essais libres fictifs — test narration'),

  new SlashCommandBuilder().setName('admin_test_quali')
    .setDescription('[ADMIN] Simule des qualifications fictives — test narration'),

  new SlashCommandBuilder().setName('admin_help')
    .setDescription('[ADMIN] Liste toutes les commandes administrateur'),

  new SlashCommandBuilder().setName('f1')
    .setDescription('Liste toutes tes commandes joueur disponibles'),

  new SlashCommandBuilder().setName('concept')
    .setDescription('Présentation complète du jeu F1 PL — pour les nouveaux !'),
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
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error('❌ interactionCreate error:', err.message);
    // Interaction expirée (10062) ou autre erreur Discord — on ne re-crash pas
    if (err.code === 10062) return; // Unknown interaction — token expiré, rien à faire
    // Tenter de répondre à l'utilisateur si possible
    const reply = { content: '❌ Une erreur interne est survenue.', ephemeral: true };
    try {
      if (!interaction.replied && !interaction.deferred) await interaction.reply(reply);
      else if (interaction.deferred) await interaction.editReply(reply);
    } catch(_) {} // Si même ça échoue, on laisse tomber silencieusement
  }
});

async function handleInteraction(interaction) {
  // ── Handler boutons (offres de transfert) ─────────────────
  // ── Handler select menu (draft) ──────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('draft_pick_')) {
      if (!interaction.member.permissions.has('Administrator'))
        return interaction.reply({ content: '❌ Seul un admin peut valider le pick.', ephemeral: true });

      const draftId  = interaction.customId.replace('draft_pick_', '');
      const pilotId  = interaction.values[0];
      let draft;
      try { draft = await DraftSession.findById(draftId); } catch(e) {}
      if (!draft || draft.status !== 'active')
        return interaction.reply({ content: '❌ Draft introuvable ou terminé.', ephemeral: true });

      // Vérifier que ce pilote n'est pas déjà pické
      if (draft.picks.some(pk => String(pk.pilotId) === pilotId))
        return interaction.reply({ content: '❌ Ce pilote a déjà été sélectionné !', ephemeral: true });

      const teamId   = String(draftTeamAtIndex(draft.order, draft.currentPickIndex));
      const team     = await Team.findById(teamId);
      const pilot    = await Pilot.findById(pilotId);
      if (!team || !pilot) return interaction.reply({ content: '❌ Données introuvables.', ephemeral: true });

      // Assigner le pilote à l'écurie + créer contrat de base
      await Pilot.findByIdAndUpdate(pilot._id, { teamId: team._id });
      const existingContract = await Contract.findOne({ pilotId: pilot._id, active: true });
      if (!existingContract) {
        await Contract.create({
          pilotId: pilot._id, teamId: team._id,
          seasonsDuration: 1, seasonsRemaining: 1,
          coinMultiplier: 1.0, primeVictoire: 0,
          primePodium: 0, salaireBase: 100, active: true,
        });
      }

      // Sauvegarder le pick
      draft.picks.push({ teamId: team._id, pilotId: pilot._id });
      draft.currentPickIndex += 1;

      const ov   = overallRating(pilot);
      const tier = ratingTier(ov);
      let msg = `✅ **${team.emoji} ${team.name}** choisit **${tier.badge} ${ov} ${pilot.name}** !`;

      if (draft.currentPickIndex >= draft.totalPicks) {
        // Draft terminé
        draft.status = 'done';
        await draft.save();
        await interaction.update({ content: msg + '\n\n🏁 **Draft terminé !** Toutes les écuries sont composées.', components: [] });
      } else {
        await draft.save();
        // Prochain pick
        const nextTeamId = draftTeamAtIndex(draft.order, draft.currentPickIndex);
        const nextTeam   = await Team.findById(nextTeamId);
        const pickedIds  = draft.picks.map(pk => String(pk.pilotId));
        const freePilots = await Pilot.find({ _id: { $nin: pickedIds } }).sort({ freinage: -1 });

        const round  = Math.floor(draft.currentPickIndex / draft.order.length) + 1;
        const pickN  = (draft.currentPickIndex % draft.order.length) + 1;
        const totalN = draft.order.length;

        if (!freePilots.length) {
          draft.status = 'done';
          await draft.save();
          await interaction.update({ content: msg + '\n\n🏁 **Draft terminé !** Plus de pilotes disponibles.', components: [] });
        } else {
          const selectRow = buildDraftSelectMenu(freePilots, String(draft._id));
          await interaction.update({
            content: msg + `\n\n**Round ${round} — Pick ${pickN}/${totalN}** : au tour de **${nextTeam.emoji} ${nextTeam.name}**`,
            components: [selectRow],
          });
        }
      }
      return;
    }
  }

  if (interaction.isButton()) {
    const [, action, offerId] = interaction.customId.split('_');  // offer_accept_<id> / offer_reject_<id>
    if (action !== 'accept' && action !== 'reject') return;

    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote trouvé.', ephemeral: true });

    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || String(offer.pilotId) !== String(pilot._id) || offer.status !== 'pending') {
      return interaction.reply({
        content: '❌ Cette offre est expirée ou invalide. Utilise `/offres` pour rafraîchir, ou `/accepter_offre <ID>` en secours.',
        ephemeral: true,
      });
    }

    if (action === 'reject') {
      await TransferOffer.findByIdAndUpdate(offerId, { status: 'rejected' });
      return interaction.update({ content: '🚫 Offre refusée.', embeds: [], components: [] });
    }

    // Accepter
    const activeContract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (activeContract) {
      return interaction.reply({
        content: `❌ Contrat actif (${activeContract.seasonsRemaining} saison(s) restante(s)). Attends la fin pour changer d'écurie.`,
        ephemeral: true,
      });
    }

    const team   = await Team.findById(offer.teamId);
    const inTeam = await Pilot.countDocuments({ teamId: team._id });
    if (inTeam >= 2) return interaction.reply({ content: '❌ Écurie complète (2 pilotes max).', ephemeral: true });

    await TransferOffer.findByIdAndUpdate(offerId, { status: 'accepted' });
    await TransferOffer.updateMany({ pilotId: pilot._id, status: 'pending', _id: { $ne: offerId } }, { status: 'expired' });
    await Pilot.findByIdAndUpdate(pilot._id, { teamId: team._id });
    await Contract.create({
      pilotId: pilot._id, teamId: team._id,
      seasonsDuration:  offer.seasons, seasonsRemaining: offer.seasons,
      coinMultiplier:   offer.coinMultiplier,
      primeVictoire:    offer.primeVictoire,
      primePodium:      offer.primePodium,
      salaireBase:      offer.salaireBase,
      active: true,
    });

    return interaction.update({
      content: '',
      embeds: [new EmbedBuilder().setTitle('✅ Contrat signé !').setColor(team.color)
        .setDescription(
          `**${pilot.name}** rejoint **${team.emoji} ${team.name}** !\n\n` +
          `×${offer.coinMultiplier} | ${offer.seasons} saison(s) | Salaire : ${offer.salaireBase} 🪙/course\n` +
          `Prime victoire : ${offer.primeVictoire} 🪙 | Prime podium : ${offer.primePodium} 🪙`
        )
      ],
      components: [],
    });
  }

  if (interaction.isStringSelectMenu()) return;

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

    const bar      = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10 - Math.round(v/10));
    const ovCreate = overallRating(pilot);
    const tierCr   = ratingTier(ovCreate);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`🏎️ Pilote créé : ${pilot.name}`)
        .setColor(tierCr.color)
        .setDescription(
          `## ${tierCr.badge} **${ovCreate}** — ${tierCr.label}\n\n` +
          `\`Dépassement  \` ${bar(pilot.depassement)}  **${pilot.depassement}**\n` +
          `\`Freinage     \` ${bar(pilot.freinage)}  **${pilot.freinage}**\n` +
          `\`Défense      \` ${bar(pilot.defense)}  **${pilot.defense}**\n` +
          `\`Adaptabilité \` ${bar(pilot.adaptabilite)}  **${pilot.adaptabilite}**\n` +
          `\`Réactions    \` ${bar(pilot.reactions)}  **${pilot.reactions}**\n` +
          `\`Contrôle     \` ${bar(pilot.controle)}  **${pilot.controle}**\n` +
          `\`Gestion Pneus\` ${bar(pilot.gestionPneus)}  **${pilot.gestionPneus}**\n\n` +
          `💰 **500 PLcoins** de départ`
        )
        .setFooter({ text: 'Attends le draft ou la période de transfert pour rejoindre une écurie !' })
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

    const ov   = overallRating(pilot);
    const tier = ratingTier(ov);
    const embed = new EmbedBuilder()
      .setTitle(`${team?.emoji || '🏎️'} ${pilot.name}`)
      .setColor(tier.color)
      .setThumbnail(pilot.photoUrl || null)
      .setDescription(
        `## ${tier.badge} **${ov}** — ${tier.label}\n` +
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

    const statKey  = interaction.options.getString('stat');
    const cost     = STAT_COST[statKey];
    const current  = pilot[statKey];
    const MAX_STAT = 99;

    if (current >= MAX_STAT) return interaction.reply({ content: '❌ Stat déjà au max (99) !', ephemeral: true });
    if (pilot.plcoins < cost) return interaction.reply({ content: `❌ Pas assez de PLcoins (${pilot.plcoins}/${cost}).`, ephemeral: true });

    // On calcule le vrai gain sans jamais dépasser 99
    const gain     = Math.min(2, MAX_STAT - current);
    const newValue = current + gain;

    // Double sécurité : $min garantit que même en cas de race condition, la stat ne dépasse pas 99
    await Pilot.findByIdAndUpdate(pilot._id, {
      $inc: { plcoins: -cost },
      $min: { [statKey]: MAX_STAT },          // si déjà à 99 suite à un race condition, ne bouge pas
      $set: { [statKey]: newValue },           // valeur calculée côté serveur, plafonnée
    });
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('📈 Amélioration !').setColor('#FFD700')
        .setDescription(`**${statKey}** : ${current} → **${newValue}** (+${gain})\n💸 −${cost} PLcoins` +
          (newValue >= MAX_STAT ? '\n🔒 **Maximum atteint (99)** — cette stat ne peut plus progresser.' : ''))],
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

    // Batch-fetch pilots & teams pour éviter les requêtes N+1
    const pilotIds = standings.map(s => s.pilotId);
    const allPilots = await Pilot.find({ _id: { $in: pilotIds } });
    const allTeams  = await Team.find();
    const pilotMap = new Map(allPilots.map(p => [String(p._id), p]));
    const teamMap  = new Map(allTeams.map(t => [String(t._id), t]));

    let desc = '';
    for (let i = 0; i < standings.length; i++) {
      const s     = standings[i];
      const pilot = pilotMap.get(String(s.pilotId));
      const team  = pilot?.teamId ? teamMap.get(String(pilot.teamId)) : null;
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

    // Batch-fetch teams
    const teamIds   = standings.map(s => s.teamId);
    const allTeams2 = await Team.find({ _id: { $in: teamIds } });
    const teamMap2  = new Map(allTeams2.map(t => [String(t._id), t]));

    let desc = '';
    for (let i = 0; i < standings.length; i++) {
      const team = teamMap2.get(String(standings[i].teamId));
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

    // Construire un embed + boutons par offre (max 5 offres affichées)
    const embeds = [];
    const components = [];

    for (const o of offers.slice(0, 5)) {
      const team = await Team.findById(o.teamId);
      const embed = new EmbedBuilder()
        .setTitle(`${team.emoji} ${team.name}`)
        .setColor(team.color)
        .setDescription(
          `×**${o.coinMultiplier}** coins | **${o.seasons}** saison(s)\n` +
          `💰 Salaire : **${o.salaireBase} 🪙**/course\n` +
          `🏆 Prime V : **${o.primeVictoire} 🪙** | Prime P : **${o.primePodium} 🪙**`
        )
        .setFooter({ text: `ID de secours : ${o._id}` });
      embeds.push(embed);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`offer_accept_${o._id}`)
          .setLabel(`✅ Rejoindre ${team.name}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`offer_reject_${o._id}`)
          .setLabel('❌ Refuser')
          .setStyle(ButtonStyle.Danger),
      );
      components.push(row);
    }

    // Discord limite à 1 embed + 5 rows par message — on envoie en éphémère
    // On envoie chaque offre séparément si > 1
    await interaction.reply({
      content: `📬 **${offers.length} offre(s) en attente.** Les boutons expirent après 10 min — utilise \`/accepter_offre <ID>\` en secours.`,
      embeds:  [embeds[0]],
      components: [components[0]],
      ephemeral: true,
    });

    // Offres supplémentaires en followUp
    for (let i = 1; i < embeds.length; i++) {
      await interaction.followUp({ embeds: [embeds[i]], components: [components[i]], ephemeral: true });
    }
    return;
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

  // ── /historique ───────────────────────────────────────────
  if (commandName === 'historique') {
    const target = interaction.options.getUser('joueur') || interaction.user;
    const pilot  = await Pilot.findOne({ discordId: target.id });
    if (!pilot) return interaction.reply({ content: `❌ Aucun pilote pour <@${target.id}>.`, ephemeral: true });

    // Récupérer tous les standings toutes saisons confondues
    const allStandings = await Standing.find({ pilotId: pilot._id }).sort({ seasonId: 1 });
    if (!allStandings.length) return interaction.reply({ content: '📊 Aucune saison jouée pour ce pilote.', ephemeral: true });

    // Batch-fetch les saisons
    const seasonIds = allStandings.map(s => s.seasonId);
    const seasons   = await Season.find({ _id: { $in: seasonIds } });
    const seasonMap = new Map(seasons.map(s => [String(s._id), s]));

    // Calculer les totaux de carrière
    const totalPts    = allStandings.reduce((a, s) => a + s.points, 0);
    const totalWins   = allStandings.reduce((a, s) => a + s.wins, 0);
    const totalPodium = allStandings.reduce((a, s) => a + s.podiums, 0);
    const totalDnf    = allStandings.reduce((a, s) => a + s.dnfs, 0);

    // Trouver la meilleure saison
    const bestSeason = allStandings.reduce((best, s) => s.points > (best?.points || 0) ? s : best, null);
    const bestSeasonObj = bestSeason ? seasonMap.get(String(bestSeason.seasonId)) : null;

    let desc = `**${allStandings.length} saison(s) disputée(s)**\n\n`;
    desc += `🏆 **Totaux carrière**\n`;
    desc += `Points : **${totalPts}** | Victoires : **${totalWins}** | Podiums : **${totalPodium}** | DNF : **${totalDnf}**\n\n`;
    if (bestSeasonObj) {
      desc += `⭐ **Meilleure saison : ${bestSeasonObj.year}** — ${bestSeason.points} pts (${bestSeason.wins}V ${bestSeason.podiums}P)\n\n`;
    }
    desc += `**Détail par saison :**\n`;

    for (const s of allStandings) {
      const season = seasonMap.get(String(s.seasonId));
      if (!season) continue;
      const medal = s.wins > 0 ? '🏆' : s.podiums > 0 ? '🥉' : '📋';
      desc += `${medal} **${season.year}** — ${s.points} pts · ${s.wins}V ${s.podiums}P ${s.dnfs}DNF\n`;
    }

    const team    = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const embed   = new EmbedBuilder()
      .setTitle(`📊 Carrière — ${pilot.name}`)
      .setColor(team?.color || '#888888')
      .setDescription(desc)
      .addFields({ name: '💰 Total gagné (carrière)', value: `${pilot.totalEarned} PLcoins`, inline: true });

    return interaction.reply({ embeds: [embed] });
  }

  // ── /pilotes ──────────────────────────────────────────────

  // ── /admin_set_photo ─────────────────────────────────────
  if (commandName === 'admin_set_photo') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const target = interaction.options.getUser('joueur');
    const url    = interaction.options.getString('url').trim();

    // Vérification basique que c'est une URL valide
    try { new URL(url); } catch {
      return interaction.reply({ content: '❌ URL invalide.', ephemeral: true });
    }

    const pilot = await Pilot.findOneAndUpdate(
      { discordId: target.id },
      { photoUrl: url },
      { new: true }
    );
    if (!pilot) return interaction.reply({ content: `❌ Aucun pilote trouvé pour <@${target.id}>.`, ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📸 Photo mise à jour — ${pilot.name}`)
      .setColor('#FFD700')
      .setThumbnail(url)
      .setDescription(`La photo de profil de **${pilot.name}** a été définie.\nElle apparaîtra dans \`/profil\`, \`/historique\` et \`/pilotes\`.`);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /admin_draft_start ────────────────────────────────────
  if (commandName === 'admin_draft_start') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    // Vérifier qu'il n'y a pas un draft actif
    const existing = await DraftSession.findOne({ status: 'active' });
    if (existing) return interaction.reply({ content: '❌ Un draft est déjà en cours !', ephemeral: true });

    // Ordre des teams : budget ASC (plus petite écurie choisit en premier — fair play)
    const teams = await Team.find().sort({ budget: 1 });
    if (!teams.length) return interaction.reply({ content: '❌ Aucune écurie trouvée.', ephemeral: true });

    // Pilotes libres (sans équipe), triés par note
    const freePilots = await Pilot.find({ teamId: null });
    if (!freePilots.length) return interaction.reply({ content: '❌ Aucun pilote libre pour le draft.', ephemeral: true });

    const totalRounds = 2; // 2 pilotes par écurie
    const totalPicks  = teams.length * totalRounds;

    const draft = await DraftSession.create({
      order: teams.map(t => t._id),
      currentPickIndex: 0,
      totalPicks,
      status: 'active',
    });

    // Afficher l'ordre du draft
    const orderStr = teams.map((t, i) => `${i+1}. ${t.emoji} ${t.name}`).join('\n');
    const pilotListStr = freePilots
      .map(p => { const ov = overallRating(p); const t = ratingTier(ov); return `${t.badge} **${ov}** — ${p.name}`; })
      .sort((a, b) => {
        const getOv = s => parseInt(s.match(/\*\*(\d+)\*\*/)?.[1] || '0');
        return getOv(b) - getOv(a);
      })
      .join('\n');

    const infoEmbed = new EmbedBuilder()
      .setTitle('🎯 DRAFT DES ÉCURIES — Début !')
      .setColor('#FFD700')
      .setDescription(
        '**Format : Snake Draft** (round 1 = ordre ASC budget · round 2 = ordre inversé)\n' +
        `**${totalPicks} picks au total** (${teams.length} écuries × ${totalRounds} rounds)\n\u200B`
      )
      .addFields(
        { name: '📋 Ordre Round 1', value: orderStr, inline: true },
        { name: '🏎️ Pilotes disponibles', value: pilotListStr.slice(0, 1024) || 'Aucun', inline: false },
      );

    const firstTeamId = draftTeamAtIndex(teams.map(t => t._id), 0);
    const firstTeam   = teams.find(t => String(t._id) === String(firstTeamId));
    const sortedFree  = [...freePilots].sort((a, b) => overallRating(b) - overallRating(a));
    const selectRow   = buildDraftSelectMenu(sortedFree, String(draft._id));

    await interaction.reply({ embeds: [infoEmbed] });
    await interaction.followUp({
      content: `**Round 1 — Pick 1/${teams.length}** : au tour de **${firstTeam.emoji} ${firstTeam.name}** de choisir !`,
      components: [selectRow],
    });
    return;
  }

  // -- /pilotes --
  if (commandName === 'pilotes') {
    const allPilots = await Pilot.find().sort({ createdAt: 1 });
    if (!allPilots.length) return interaction.reply({ content: 'Aucun pilote.', ephemeral: true });
    const allTeams = await Team.find();
    const teamMap  = new Map(allTeams.map(t => [String(t._id), t]));
    const sorted   = allPilots.map(p => ({ pilot: p, ov: overallRating(p) })).sort((a,b) => b.ov-a.ov);
    const medals   = ['🥇','🥈','🥉'];
    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const { pilot, ov } = sorted[i];
      const tier = ratingTier(ov);
      const team = pilot.teamId ? teamMap.get(String(pilot.teamId)) : null;
      const rank = medals[i] || ('**'+(i+1)+'.**');
      desc += rank+' '+tier.badge+' **'+ov+'** '+tier.label.padEnd(9)+' — **'+pilot.name+'** '+(team ? team.emoji+' '+team.name : '🔴 *Libre*')+'\n';
    }
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏎️ Classement Pilotes — Note Générale').setColor('#FF1801').setDescription(desc.slice(0,4000)||'Aucun').setFooter({ text: sorted.length+' pilote(s) · Poids: Freinage 17% · Contrôle 17% · Dépassement 15%...' })] });
  }


  // -- /admin_test_race --
  if (commandName === 'admin_test_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: 'Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    const testQt = testPilots.map(p => {
      const t = testTeams.find(t => String(t._id) === String(p.teamId));
      return { pilotId: p._id, time: calcQualiTime(p, t, 'DRY', testRace.gpStyle) };
    }).sort((a,b) => a.time - b.time);

    await interaction.reply({ content: `🧪 **Course de test** — style **${testRace.gpStyle.toUpperCase()}** · ${testRace.laps} tours — résultats en cours dans ce channel !`, ephemeral: true });

    ;(async () => {
      const testResults = await simulateRace(testRace, testQt, testPilots, testTeams, [], interaction.channel);
      const testEmbed = new EmbedBuilder().setTitle('🧪 [TEST] Résultats finaux — Circuit Test PL').setColor('#888888');
      let testDesc = '';
      for (const r of testResults.slice(0,15)) {
        const p = testPilots.find(x => String(x._id) === String(r.pilotId));
        const t = testTeams.find(x => String(x._id) === String(r.teamId));
        const testOv = overallRating(p); const pts = F1_POINTS[r.pos-1]||0;
        const testRank = ['🥇','🥈','🥉'][r.pos-1] || ('P'+r.pos);
        testDesc += testRank+' '+(t?.emoji||'')+' **'+(p?.name||'?')+'** *('+testOv+')* ';
        if (r.dnf) testDesc += '❌ DNF'; else testDesc += '— '+pts+' pts';
        if (r.fastestLap) testDesc += ' ⚡'; testDesc += '\n';
      }
      testEmbed.setDescription(testDesc+'\n*⚠️ Aucune donnée sauvegardée — test uniquement*');
      await interaction.channel.send({ embeds: [testEmbed] });
    })().catch(e => console.error('admin_test_race error:', e.message));
    return;
  }

  // -- /admin_test_practice --
  if (commandName === 'admin_test_practice') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    await interaction.reply({ content: `🔧 **Essais libres de test** — style **${testRace.gpStyle.toUpperCase()}** · résultats en cours...`, ephemeral: true });

    ;(async () => {
      const channel = interaction.channel;
      const { results, weather } = await simulatePractice(testRace, testPilots, testTeams);
      const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };

      // Narration EL enrichie
      await channel.send(
        `🔧 **ESSAIS LIBRES — ${testRace.emoji} ${testRace.circuit}** *(TEST)*\n` +
        `${styleEmojis[testRace.gpStyle]} **${testRace.gpStyle.toUpperCase()}** · Météo : **${weather}**\n` +
        `Les pilotes prennent leurs marques sur le circuit. Chaque équipe cherche son réglage...`
      );
      await sleep(2000);

      // Commentaire en cours de session
      const mid   = Math.floor(results.length / 2);
      const early = results.slice(0, 3);
      await channel.send(
        `📻 *Mi-session :* ${early[0].team.emoji}**${early[0].pilot.name}** signe le meilleur temps provisoire en ${msToLapStr(early[0].time)}.` +
        (early[1] ? ` ${early[1].team.emoji}**${early[1].pilot.name}** est à **+${((early[1].time - early[0].time)/1000).toFixed(3)}s**.` : '')
      );
      await sleep(2000);

      // Embed final EL
      const embed = new EmbedBuilder()
        .setTitle(`🔧 Résultats Essais Libres — ${testRace.emoji} ${testRace.circuit} *(TEST)*`)
        .setColor('#888888')
        .setDescription(
          `Météo : **${weather}** | Style : **${testRace.gpStyle.toUpperCase()}** ${styleEmojis[testRace.gpStyle]}\n\n` +
          results.map((r, i) => {
            const gap = i === 0 ? '⏱ **RÉFÉRENCE**' : `+${((r.time - results[0].time)/1000).toFixed(3)}s`;
            const ov  = overallRating(r.pilot);
            return `\`P${String(i+1).padStart(2,' ')}\` ${r.team.emoji} **${r.pilot.name}** *(${ov})* — ${msToLapStr(r.time)} — ${gap}`;
          }).join('\n') +
          '\n\n*⚠️ Session fictive — aucune donnée sauvegardée*'
        );
      await channel.send({ embeds: [embed] });
    })().catch(e => console.error('admin_test_practice error:', e.message));
    return;
  }

  // -- /admin_test_quali --
  if (commandName === 'admin_test_quali') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    await interaction.reply({ content: `⏱️ **Qualifications de test** — style **${testRace.gpStyle.toUpperCase()}** · résultats en cours...`, ephemeral: true });

    ;(async () => {
      const channel = interaction.channel;
      const { grid, weather } = await simulateQualifying(testRace, testPilots, testTeams);
      const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };

      // Intro Q
      await channel.send(
        `⏱️ **QUALIFICATIONS — ${testRace.emoji} ${testRace.circuit}** *(TEST)*\n` +
        `${styleEmojis[testRace.gpStyle]} **${testRace.gpStyle.toUpperCase()}** · Météo : **${weather}**\n` +
        `Les pilotes s'élancent pour le tour lancé. Un seul tour, tout donner...`
      );
      await sleep(2000);

      // Suspense : annonce les temps progressivement
      const sorted = [...grid];
      const mid    = Math.floor(sorted.length / 2);

      // Premier secteur — quelques temps intermédiaires
      const early3 = sorted.slice(0, 3);
      await channel.send(
        `📻 *Q en cours...* ${early3.map((g,i) => `P${i+1} ${g.teamEmoji}**${g.pilotName}** ${msToLapStr(g.time)}`).join(' · ')}`
      );
      await sleep(2500);

      // Embed final grille quali
      const embed = new EmbedBuilder()
        .setTitle(`⏱️ Classement Qualifications — ${testRace.emoji} ${testRace.circuit} *(TEST)*`)
        .setColor('#FFD700')
        .setDescription(
          `Météo : **${weather}** · **${testRace.gpStyle.toUpperCase()}** ${styleEmojis[testRace.gpStyle]}\n\n` +
          grid.map((g, i) => {
            const gap     = i === 0 ? '🏆 **POLE POSITION**' : `+${((g.time - grid[0].time)/1000).toFixed(3)}s`;
            const medal   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`P${String(i+1).padStart(2,' ')}\``;
            return `${medal} ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          '\n\n*⚠️ Session fictive — aucune donnée sauvegardée*'
        );
      await channel.send({ embeds: [embed] });

      // Commentaire pole
      const poleman = grid[0];
      const gap2nd  = ((grid[1]?.time - grid[0].time) / 1000).toFixed(3);
      await channel.send(
        `🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** en **${msToLapStr(poleman.time)}** !` +
        (grid[1] ? ` **+${gap2nd}s** d'avance sur ${grid[1].teamEmoji}**${grid[1].pilotName}**. Belle performance !` : '')
      );
    })().catch(e => console.error('admin_test_quali error:', e.message));
    return;
  }

  // -- /admin_help --
  if (commandName === 'admin_help') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Accès refusé.', ephemeral: true });
    const adminHelpEmbed = new EmbedBuilder().setTitle('🛠️ Commandes Administrateur — F1 PL').setColor('#FF6600')
      .setDescription('Toutes les commandes nécessitent la permission **Administrateur**.')
      .addFields(
        { name: '🏁 Saison & Course', value: [
          '`/admin_new_season` — Crée une nouvelle saison (24 GP)',
          '`/admin_force_practice` — Déclenche les essais libres',
          '`/admin_force_quali` — Déclenche les qualifications',
          '`/admin_force_race` — Déclenche la course',
          '`/admin_evolve_cars` — État des stats voitures',
        ].join('\n') },
        { name: '🔄 Transferts & Draft', value: [
          '`/admin_transfer` — Ouvre la période de transfert (offres IA auto)',
          '`/admin_draft_start` — Lance le draft snake',
        ].join('\n') },
        { name: '🧪 Test & Debug', value: [
          '`/admin_test_race` — Simule une course fictive (aucune sauvegarde)',
          '`/admin_help` — Affiche ce panneau',
        ].join('\n') },
        { name: '📋 Ordre de démarrage', value: [
          '1️⃣ Tous les joueurs font `/create_pilot`',
          '2️⃣ `/admin_draft_start` — chaque joueur choisit son écurie',
          '3️⃣ `/admin_new_season` — crée la saison',
          '4️⃣ Courses auto à 11h · 15h · 18h',
          '5️⃣ Fin de saison : `/admin_transfer`',
        ].join('\n') },
      ).setFooter({ text: 'F1 PL Bot — Panneau Admin' });
    return interaction.reply({ embeds: [adminHelpEmbed], ephemeral: true });
  }

  // -- /f1 --
  if (commandName === 'f1') {
    const f1Pilot  = await Pilot.findOne({ discordId: interaction.user.id });
    const f1Embed  = new EmbedBuilder().setTitle('🏎️ F1 PL — Tes commandes joueur').setColor('#FF1801')
      .setDescription(f1Pilot ? 'Bienvenue **'+f1Pilot.name+'** !' : "❗ Tu n'as pas encore de pilote — commence par `/create_pilot` !")
      .addFields(
        { name: '👤 Ton pilote', value: [
          '`/create_pilot` — Crée ton pilote (1 seul par compte)',
          '`/profil` — Stats, note générale, contrat et classement',
          '`/ameliorer` — Améliore une stat (+2 garanti)',
          '`/historique` — Ta carrière complète',
        ].join('\n') },
        { name: '🏎️ Écuries & Pilotes', value: [
          '`/pilotes` — Classement par note (style FIFA)',
          '`/ecuries` — Liste des 10 écuries',
          '`/ecurie` — Stats détaillées',
        ].join('\n') },
        { name: '📋 Contrats & Transferts', value: [
          '`/mon_contrat` — Ton contrat actuel',
          '`/offres` — Offres en attente (boutons interactifs)',
          '`/accepter_offre` / `/refuser_offre` — Backup boutons',
        ].join('\n') },
        { name: '🏆 Classements & Calendrier', value: [
          '`/classement` — Championnat pilotes',
          '`/classement_constructeurs` — Championnat constructeurs',
          '`/calendrier` — Tous les GP',
          '`/resultats` — Dernière course',
        ].join('\n') },
        { name: '📖 Infos', value: [
          '`/concept` — Présentation du jeu pour les nouveaux',
          '`/f1` — Affiche ce panneau',
        ].join('\n') },
      ).setFooter({ text: 'Courses auto : 11h Essais · 15h Qualif · 18h Course (Europe/Paris)' });
    return interaction.reply({ embeds: [f1Embed], ephemeral: true });
  }


  // ── /concept ──────────────────────────────────────────────
  if (commandName === 'concept') {
    const embed1 = new EmbedBuilder()
      .setTitle('\u{1F3CE}\uFE0F  Bienvenue dans F1 PL \u2014 Le championnat entre potes !')
      .setColor('#FF1801')
      .setDescription(
        'Chaque joueur incarne un **pilote de F1** dans un championnat simul\u00e9 automatiquement.\n' +
        'Les courses tournent toutes seules, mais **tes choix de d\u00e9veloppement et de contrat font toute la diff\u00e9rence**.\n\n' +
        '**Pas besoin d\u2019\u00eatre l\u00e0 \u00e0 chaque course** \u2014 le bot s\u2019en charge. Tu suis les r\u00e9sultats ici et tu g\u00e8res ta carri\u00e8re entre les courses.\n\u200B'
      )
      .addFields(
        {
          name: '\u{1F5D3}\uFE0F  Un week-end de course = 3 \u00e9v\u00e9nements automatiques',
          value:
            '`11h00` \u{1F527} **Essais Libres** \u2014 classement indicatif, d\u00e9couverte du circuit\n' +
            '`15h00` \u23F1\uFE0F **Qualifications** \u2014 d\u00e9termine ta place sur la grille de d\u00e9part\n' +
            '`18h00` \u{1F3C1} **Course** \u2014 simulation tour par tour avec incidents, SC, pneus...',
          inline: false,
        },
        {
          name: '\u{1F4C5}  Calendrier',
          value:
            '**24 GP** dans la saison \u2014 Bahr\u00e9\u00efn, Monaco, Monza, Silverstone... Les vrais circuits F1.\n' +
            'Chaque circuit a un **style** qui valorise certaines stats :\n' +
            '\u{1F3D9}\uFE0F Urbain \u00b7 \u{1F4A8} Rapide \u00b7 \u2699\uFE0F Technique \u00b7 \u{1F500} Mixte \u00b7 \u{1F50B} Endurance',
          inline: false,
        },
      );

    const embed2 = new EmbedBuilder()
      .setTitle('\u{1F9EC}  Ton pilote \u2014 Stats & Progression')
      .setColor('#FFD700')
      .setDescription('Tu personnalises ton pilote avec **7 stats** (0\u201399), am\u00e9liorables avec les PLcoins gagn\u00e9s en course.')
      .addFields(
        {
          name: '\u{1F3AF}  Les 7 stats pilote',
          value:
            '`D\u00e9passement`  \u2192 Attaque en piste, DRS, undercut agressif\n' +
            '`Freinage`     \u2192 Performance en Q et en zones de freinage\n' +
            '`D\u00e9fense`      \u2192 R\u00e9sistance aux tentatives de d\u00e9passement\n' +
            '`Adaptabilit\u00e9` \u2192 M\u00e9t\u00e9o changeante, Safety Car, conditions\n' +
            '`R\u00e9actions`    \u2192 D\u00e9part, opportunisme, gestion des incidents\n' +
            '`Contr\u00f4le`     \u2192 Consistance, gestion des limites de piste\n' +
            '`Gestion Pneus`\u2192 Pr\u00e9servation, fen\u00eatre de fonctionnement',
          inline: false,
        },
        {
          name: '\u{1F4B0}  PLcoins \u2014 La monnaie du jeu',
          value:
            'Tu gagnes des **PLcoins** \u00e0 chaque course (points + salaire contrat + primes).\n' +
            'Tu les d\u00e9penses pour **am\u00e9liorer tes stats** (+2 garanti \u00e0 chaque fois).\n' +
            'Objectif\u00a0: construire le pilote parfait pour ton style de jeu.',
          inline: false,
        },
      );

    const embed3 = new EmbedBuilder()
      .setTitle('\u{1F697}  Les \u00c9curies \u2014 Contrats & Transferts')
      .setColor('#0099FF')
      .setDescription('**10 \u00e9curies** du bas de grille au top, chacune avec des **stats voiture** qui \u00e9voluent en cours de saison.')
      .addFields(
        {
          name: '\u{1F527}  Stats voiture (\u00e9voluent chaque course)',
          value:
            '`Vitesse Max` \u00b7 `DRS` \u00b7 `Refroidissement`\n`Dirty Air` \u00b7 `Conservation Pneus` \u00b7 `Vitesse Moyenne`\n' +
            '\u2192 Les \u00e9curies qui marquent des points **d\u00e9veloppent plus vite**. La hi\u00e9rarchie bouge\u00a0!',
          inline: false,
        },
        {
          name: '\u{1F4CB}  Contrats',
          value:
            'Chaque contrat a\u00a0: **multiplicateur PLcoins \u00d7 \u00b7 salaire de base \u00b7 prime victoire \u00b7 prime podium \u00b7 dur\u00e9e**.\n' +
            'Un contrat est **irr\u00e9vocable** jusqu\u2019\u00e0 son terme \u2014 choisis bien\u00a0!\n' +
            '\u00c0 la fin de saison \u2192 **p\u00e9riode de transfert** \u2192 nouvelles offres des \u00e9curies.',
          inline: false,
        },
        {
          name: '\u{1F504}  P\u00e9riode de transfert',
          value:
            'Entre deux saisons, les \u00e9curies font des offres automatiques aux pilotes libres.\n' +
            'Utilise `/offres` pour les voir et les accepter **directement avec les boutons**.',
          inline: false,
        },
      );

    const embed4 = new EmbedBuilder()
      .setTitle('\u{1F680}  Comment d\u00e9marrer\u00a0?')
      .setColor('#00FF88')
      .addFields(
        {
          name: '1\uFE0F\u20E3  Cr\u00e9e ton pilote',
          value: '`/create_pilot nom:TonNom`\nTes stats de d\u00e9part sont al\u00e9atoires entre 44 et 62.',
          inline: false,
        },
        {
          name: '2\uFE0F\u20E3  Attends la p\u00e9riode de transfert',
          value: 'Les \u00e9curies t\u2019enverront des offres. Utilise `/offres` pour les accepter avec les boutons.',
          inline: false,
        },
        {
          name: '3\uFE0F\u20E3  Suis tes courses',
          value: 'Les r\u00e9sultats tombent ici automatiquement. `/profil` \u00b7 `/classement` \u00b7 `/calendrier`',
          inline: false,
        },
        {
          name: '4\uFE0F\u20E3  Investis tes PLcoins',
          value: '`/ameliorer` pour booster une stat (+2 garanti \u00e0 chaque fois).',
          inline: false,
        },
        {
          name: '\u{1F4D6}  Commandes utiles',
          value:
            '`/profil` \u2014 Tes stats & classement saison\n' +
            '`/historique` \u2014 Ta carri\u00e8re compl\u00e8te\n' +
            '`/ecurie` \u2014 Stats d\u2019une \u00e9curie\n' +
            '`/classement` \u2014 Championnat pilotes\n' +
            '`/classement_constructeurs` \u2014 Championnat \u00e9curies\n' +
            '`/calendrier` \u2014 Prochains GP\n' +
            '`/resultats` \u2014 Derni\u00e8re course',
          inline: false,
        },
      )
      .setFooter({ text: 'Bonne saison \u00e0 tous \u{1F3CE}\uFE0F\u{1F4A8}' });

    return interaction.reply({ embeds: [embed1, embed2, embed3, embed4] });
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
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    // Répondre IMMÉDIATEMENT (Discord expire après 3s)
    await interaction.reply({ content: '✅ Essais libres en cours... Les résultats arrivent dans le channel de course.', ephemeral: true });
    runPractice(interaction.channel).catch(e => console.error('admin_force_practice error:', e.message));
  }

  if (commandName === 'admin_force_quali') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.reply({ content: '✅ Qualifications en cours... Les résultats arrivent dans le channel de course.', ephemeral: true });
    runQualifying(interaction.channel).catch(e => console.error('admin_force_quali error:', e.message));
  }

  if (commandName === 'admin_force_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.reply({ content: '🏁 Course lancée ! Suivez le direct dans le channel de course.', ephemeral: true });
    runRace(interaction.channel).catch(e => console.error('admin_force_race error:', e.message));
  }

  if (commandName === 'admin_transfer') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
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

} // fin handleInteraction

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

// ── Cérémonie de fin de saison ────────────────────────────
async function sendSeasonCeremony(season, channel) {
  // Classements pilotes
  const standings = await Standing.find({ seasonId: season._id }).sort({ points: -1 });
  const allPilots = await Pilot.find();
  const allTeams  = await Team.find();
  const pilotMap  = new Map(allPilots.map(p => [String(p._id), p]));
  const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));

  // Champion pilote
  const champStanding = standings[0];
  const champ         = champStanding ? pilotMap.get(String(champStanding.pilotId)) : null;
  const champTeam     = champ?.teamId ? teamMap.get(String(champ.teamId)) : null;

  // Classement constructeurs
  const constrStandings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
  const champConstr     = constrStandings[0] ? teamMap.get(String(constrStandings[0].teamId)) : null;

  // Stats marquantes : meilleur ratio victoires, roi des podiums, roi des DNF, meilleure progression
  const mostWins   = standings.reduce((best, s) => (!best || s.wins > best.wins) ? s : best, null);
  const mostPodiums= standings.reduce((best, s) => (!best || s.podiums > best.podiums) ? s : best, null);
  const mostDnfs   = standings.reduce((best, s) => (!best || s.dnfs > best.dnfs) ? s : best, null);

  const totalRaces = await Race.countDocuments({ seasonId: season._id });

  // Annonce d'ambiance (délai volontaire pour laisser respirer)
  await channel.send(
    '```\n' +
    '╔══════════════════════════════════════════╗\n' +
    '║      🏁  FIN DE SAISON  🏁               ║\n' +
    '╚══════════════════════════════════════════╝\n' +
    '```'
  );

  await new Promise(r => setTimeout(r, 3000));

  // Embed champion pilote
  if (champ) {
    const ov   = overallRating(champ);
    const tier = ratingTier(ov);
    const embed = new EmbedBuilder()
      .setTitle(`👑 CHAMPION DU MONDE PILOTE — Saison ${season.year}`)
      .setColor('#FFD700')
      .setDescription(
        `# ${champTeam?.emoji || '🏎️'} **${champ.name}**\n` +
        `${tier.badge} **${ov}** — ${tier.label}` +
        (champTeam ? ` · ${champTeam.name}` : '') + '\n\n' +
        `🏆 **${champStanding.points} points** au championnat\n` +
        `🥇 ${champStanding.wins} victoire(s)  ·  🥈 ${champStanding.podiums} podium(s)  ·  ❌ ${champStanding.dnfs} DNF\n\n` +
        `*Le titre se mérite sur ${totalRaces} Grands Prix !*`
      );
    if (champ.photoUrl) embed.setThumbnail(champ.photoUrl);
    await channel.send({ embeds: [embed] });
  }

  await new Promise(r => setTimeout(r, 2000));

  // Embed champion constructeur
  if (champConstr) {
    const embed = new EmbedBuilder()
      .setTitle(`🏗️ CHAMPION DU MONDE CONSTRUCTEUR — Saison ${season.year}`)
      .setColor(champConstr.color || '#0099FF')
      .setDescription(
        `# ${champConstr.emoji} **${champConstr.name}**\n\n` +
        `🏆 **${constrStandings[0].points} points** constructeurs\n\n` +
        `**Classement complet :**\n` +
        constrStandings.slice(0, 10).map((s, i) => {
          const t = teamMap.get(String(s.teamId));
          return `${['🥇','🥈','🥉'][i] || `**${i+1}.**`} ${t?.emoji || ''} ${t?.name || '?'} — **${s.points} pts**`;
        }).join('\n')
      );
    await channel.send({ embeds: [embed] });
  }

  await new Promise(r => setTimeout(r, 2000));

  // Embed top 5 pilotes + stats marquantes
  const top5 = standings.slice(0, 5);
  const top5Str = top5.map((s, i) => {
    const p = pilotMap.get(String(s.pilotId));
    const t = p?.teamId ? teamMap.get(String(p.teamId)) : null;
    return `${['🥇','🥈','🥉','4️⃣','5️⃣'][i]} **${p?.name || '?'}** ${t?.emoji || ''} — ${s.points} pts (${s.wins}V / ${s.podiums}P)`;
  }).join('\n');

  const statsLines = [];
  if (mostWins   && mostWins.wins   > 0) {
    const p = pilotMap.get(String(mostWins.pilotId));
    statsLines.push(`🏆 **Roi des victoires** : ${p?.name || '?'} — ${mostWins.wins} victoire(s)`);
  }
  if (mostPodiums && mostPodiums.podiums > 0 && String(mostPodiums.pilotId) !== String(mostWins?.pilotId)) {
    const p = pilotMap.get(String(mostPodiums.pilotId));
    statsLines.push(`🥊 **Roi des podiums** : ${p?.name || '?'} — ${mostPodiums.podiums} podium(s)`);
  }
  if (mostDnfs && mostDnfs.dnfs > 0) {
    const p = pilotMap.get(String(mostDnfs.pilotId));
    statsLines.push(`💀 **Malchance de la saison** : ${p?.name || '?'} — ${mostDnfs.dnfs} DNF`);
  }

  const recapEmbed = new EmbedBuilder()
    .setTitle(`📊 Bilan de la Saison ${season.year}`)
    .setColor('#FF1801')
    .setDescription(
      `**${totalRaces} Grands Prix disputés**\n\n` +
      `**🏎️ Top 5 pilotes :**\n${top5Str || 'Aucun'}\n\n` +
      (statsLines.length ? `**✨ Distinctions :**\n${statsLines.join('\n')}\n\n` : '') +
      `\n⏳ *La période de transfert ouvrira dans 24h...*`
    );

  await channel.send({ embeds: [recapEmbed] });
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

  // Classement constructeurs rapide en fin de course
  if (channel) {
    const constrStandings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
    const constrTeamIds   = constrStandings.map(s => s.teamId);
    const constrTeams     = await Team.find({ _id: { $in: constrTeamIds } });
    const constrTeamMap   = new Map(constrTeams.map(t => [String(t._id), t]));
    let constrDesc = '';
    for (let i = 0; i < constrStandings.length; i++) {
      const t = constrTeamMap.get(String(constrStandings[i].teamId));
      constrDesc += `**${i+1}.** ${t?.emoji||''} **${t?.name||'?'}** — ${constrStandings[i].points} pts\n`;
    }
    const constrEmbed = new EmbedBuilder()
      .setTitle('🏗️ Classement Constructeurs — Après cette course')
      .setColor('#0099FF')
      .setDescription(constrDesc || 'Aucune donnée');
    await channel.send({ embeds: [constrEmbed] });
  }

  // Fin de saison ?
  const remaining = await Race.countDocuments({ seasonId: season._id, status: { $ne: 'done' } });
  if (remaining === 0 && channel) {
    await sendSeasonCeremony(season, channel);
    setTimeout(async () => {
      const expiredCount = await startTransferPeriod();

      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);

        // Résumé des offres générées par l'IA
        const allOffers  = await TransferOffer.find({ status: 'pending' });
        const allTeams2  = await Team.find();
        const allPilots2 = await Pilot.find({ _id: { $in: allOffers.map(o => o.pilotId) } });
        const teamMap2   = new Map(allTeams2.map(t => [String(t._id), t]));
        const pilotMap2  = new Map(allPilots2.map(p => [String(p._id), p]));

        // Grouper les offres par pilote pour avoir un aperçu du marché
        const offersByPilot = new Map();
        for (const o of allOffers) {
          const key = String(o.pilotId);
          if (!offersByPilot.has(key)) offersByPilot.set(key, []);
          offersByPilot.get(key).push(o);
        }

        let marketDesc = '';
        for (const [pilotId, offers] of offersByPilot) {
          const pilot    = pilotMap2.get(pilotId);
          if (!pilot) continue;
          const ov       = overallRating(pilot);
          const tier     = ratingTier(ov);
          const teamNames = offers.map(o => {
            const t = teamMap2.get(String(o.teamId));
            return t ? `${t.emoji} ${t.name}` : '?';
          }).join(', ');
          marketDesc += `${tier.badge} **${pilot.name}** *(${ov})* — ${offers.length} offre(s) : ${teamNames}\n`;
        }

        const transferEmbed = new EmbedBuilder()
          .setTitle('🔄 MERCATO OUVERT — Les écuries ont fait leurs offres !')
          .setColor('#FF6600')
          .setDescription(
            `**${expiredCount}** contrat(s) expiré(s) · **${allOffers.length}** offre(s) générées par le bot\n` +
            `Les pilotes libres ont **7 jours** pour accepter ou refuser.\n\n` +
            `📋 Utilisez \`/offres\` pour voir vos propositions de contrat.\n\u200B`
          )
          .addFields({
            name: '📊 État du marché',
            value: marketDesc.slice(0, 1024) || '*Aucun pilote libre*',
          })
          .setFooter({ text: 'Les offres sont générées automatiquement par le bot selon le budget et les besoins de chaque écurie.' });

        await ch.send({ embeds: [transferEmbed] });
      } catch(e) { console.error('Transfer announcement error:', e.message); }
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

// ── Sécurité globale — empêche le crash sur erreurs non catchées ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  unhandledRejection (bot stable) :', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  uncaughtException (bot stable) :', err.message);
});
client.on('error', (err) => {
  console.error('⚠️  Discord client error :', err.message);
});

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
  APP_URL=https://ton-app.onrender.com   ← IMPORTANT pour le keep-alive sur Render/Railway

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
