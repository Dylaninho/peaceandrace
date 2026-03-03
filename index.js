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
  discordId    : { type: String, required: true },           // plus unique : 2 pilotes par user
  pilotIndex   : { type: Number, default: 1 },               // 1 ou 2 (index du pilote pour ce joueur)
  name         : { type: String, required: true },
  nationality  : { type: String, default: '🏳️ Inconnu' },   // ex: '🇫🇷 Français'
  racingNumber : { type: Number, default: null },             // numéro de voiture (1-99, unique côté logique)
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
  // ── Spécialisation ──────────────────────────────────────────
  // 3 upgrades consécutifs sur la même stat → tag débloqué
  lastUpgradeStat : { type: String, default: null },  // ex: 'freinage'
  upgradeStreak   : { type: Number, default: 0 },     // 1→2→3 = trigger
  specialization  : { type: String, default: null },  // ex: 'freinage' (unique par pilote)
  // ── Rivalités ───────────────────────────────────────────────
  rivalId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', default: null },
  rivalContacts: { type: Number, default: 0 },        // contacts en course cette saison vs rivalId
  // ── Statut coéquipier ────────────────────────────────────────
  teamStatus        : { type: String, enum: ['numero1', 'numero2', null], default: null },
  teammateDuelWins  : { type: Number, default: 0 },   // victoires internes cette saison vs coéquipier
  // État
  teamId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  createdAt    : { type: Date, default: Date.now },
});
const Pilot = mongoose.model('Pilot', PilotSchema);

// ── HallOfFame ─────────────────────────────────────────────
const HallOfFameSchema = new mongoose.Schema({
  seasonYear       : { type: Number, required: true, unique: true },
  champPilotId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  champPilotName   : String,
  champTeamName    : String,
  champTeamEmoji   : String,
  champPoints      : Number,
  champWins        : Number,
  champPodiums     : Number,
  champDnfs        : Number,
  champConstrName  : String,
  champConstrEmoji : String,
  champConstrPoints: Number,
  mostWinsName     : String,
  mostWinsCount    : Number,
  mostDnfsName     : String,
  mostDnfsCount    : Number,
  topRatedName     : String,   // meilleur overall en fin de saison
  topRatedOv       : Number,
  createdAt        : { type: Date, default: Date.now },
});
const HallOfFame = mongoose.model('HallOfFame', HallOfFameSchema);

// ── PilotGPRecord — Historique détaillé par GP ────────────
// Un document par pilote par course — alimente /performances
const PilotGPRecordSchema = new mongoose.Schema({
  pilotId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', required: true },
  seasonId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  seasonYear   : { type: Number, required: true },
  raceId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Race' },
  circuit      : { type: String, required: true },
  circuitEmoji : { type: String, default: '🏁' },
  gpStyle      : { type: String, default: 'mixte' },
  teamId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  teamName     : { type: String, default: '?' },
  teamEmoji    : { type: String, default: '🏎️' },
  startPos     : { type: Number, default: null },   // position sur la grille
  finishPos    : { type: Number, required: true },  // position finale
  dnf          : { type: Boolean, default: false },
  dnfReason    : { type: String, default: null },
  points       : { type: Number, default: 0 },
  coins        : { type: Number, default: 0 },
  fastestLap   : { type: Boolean, default: false },
  raceDate     : { type: Date, default: Date.now },
});
PilotGPRecordSchema.index({ pilotId: 1, raceDate: -1 });
const PilotGPRecord = mongoose.model('PilotGPRecord', PilotGPRecordSchema);

// ── CircuitRecord — Meilleur temps par circuit (toutes saisons) ──
const CircuitRecordSchema = new mongoose.Schema({
  circuit      : { type: String, required: true, unique: true },
  circuitEmoji : { type: String, default: '🏁' },
  gpStyle      : { type: String, default: 'mixte' },
  bestTimeMs   : { type: Number, required: true },
  pilotId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  pilotName    : { type: String },
  teamName     : { type: String },
  teamEmoji    : { type: String, default: '🏎️' },
  seasonYear   : { type: Number },
  raceId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Race' },
  setAt        : { type: Date, default: Date.now },
});
const CircuitRecord = mongoose.model('CircuitRecord', CircuitRecordSchema);

// ── NewsArticle — Tabloïd de paddock ──────────────────────
const NewsArticleSchema = new mongoose.Schema({
  type       : { type: String, required: true },  // 'rivalry','transfer_rumor','drama','hype','form_crisis','teammate_duel','dev_vague','scandal','title_fight'
  source     : { type: String, required: true },  // 'pitlane_insider','paddock_whispers','pl_racing_news','f1_weekly'
  headline   : { type: String, required: true },
  body       : { type: String, required: true },
  pilotIds   : [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' }],
  teamIds    : [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  raceId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Race', default: null },
  seasonYear : { type: Number },
  publishedAt: { type: Date, default: Date.now },
  triggered  : { type: String, default: 'auto' }, // 'post_race' | 'scheduled' | 'manual'
});
NewsArticleSchema.index({ publishedAt: -1 });
const NewsArticle = mongoose.model('NewsArticle', NewsArticleSchema);

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
  slot          : { type: Number, default: 0 }, // 0 = matin (11h/13h/15h) · 1 = soir (17h/18h/20h)
  status        : { type: String, enum: ['upcoming','practice_done','quali_done','race_computed','done'], default: 'upcoming' },
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
  { name:'Red Bull Racing', emoji:'🔵', color:'#1E3A5F', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Ferrari',         emoji:'🔴', color:'#DC143C', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Mercedes',        emoji:'⚪', color:'#00D2BE', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'McLaren',         emoji:'🟠', color:'#FF7722', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Aston Martin',    emoji:'🟢', color:'#006400', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Alpine',          emoji:'💙', color:'#0066CC', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Williams',        emoji:'🔷', color:'#00B4D8', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Haas',            emoji:'⬜', color:'#AAAAAA', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
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

// ─── Création de pilote ───────────────────────────────────
// Chaque pilote a une base fixe + un pool de points à répartir
// Base : 40 par stat × 7 = 280 points de base (identique pour tous)
// Pool : 70 points à répartir librement (0–30 par stat)
// → Total possible : 50 par stat en moyenne (même niveau global)
const BASE_STAT_VALUE  = 40;
const TOTAL_STAT_POOL  = 70;
const MAX_STAT_BONUS   = 30;   // bonus max par stat lors de la création

// Nationalités disponibles (drapeau + label)
// ⚠️ Discord limite à 25 choix max dans addChoices — liste triée avec équilibre Europe/Amériques/Afrique/Asie
const NATIONALITIES = [
  // Europe
  '🇫🇷 Français',    '🇧🇪 Belge',        '🇩🇪 Allemand',    '🇬🇧 Britannique',
  '🇳🇱 Néerlandais', '🇮🇹 Italien',       '🇪🇸 Espagnol',    '🇵🇹 Portugais',
  '🇨🇭 Suisse',      '🇦🇹 Autrichien',    '🇫🇮 Finlandais',  '🇵🇱 Polonais',
  // Amériques
  '🇧🇷 Brésilien',   '🇺🇸 Américain',     '🇨🇦 Canadien',    '🇲🇽 Mexicain',
  '🇦🇷 Argentin',    '🇨🇴 Colombien',
  // Afrique
  '🇨🇮 Ivoirien',    '🇨🇬 Congolais',     '🇸🇳 Sénégalais',  '🇨🇲 Camerounais',
  '🇲🇦 Marocain',    '🇿🇦 Sud-Africain',
  // Asie / Océanie / Autre
  '🇯🇵 Japonais',
];

// ============================================================
// ███╗   ███╗ ██████╗ ████████╗███████╗██╗   ██╗██████╗
// ████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝██║   ██║██╔══██╗
// ██╔████╔██║██║   ██║   ██║   █████╗  ██║   ██║██████╔╝
// ██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  ██║   ██║██╔══██╗
// ██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗╚██████╔╝██║  ██║
// ╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
// ============================================================

const TIRE = {
  SOFT  : { grip: 1.00, deg: 0.0024, emoji: '🔴', label: 'Soft'   }, // cliff ~lap 25
  MEDIUM: { grip: 0.99, deg: 0.0016, emoji: '🟡', label: 'Medium' }, // cliff ~lap 38
  HARD  : { grip: 0.98, deg: 0.0010, emoji: '⚪', label: 'Hard'   }, // cliff ~lap 60
  INTER : { grip: 0.99, deg: 0.0013, emoji: '🟢', label: 'Inter'  },
  WET   : { grip: 0.99, deg: 0.0008, emoji: '🔵', label: 'Wet'    },
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

// ── Draft : select menu des pilotes disponibles ───────────
function buildDraftSelectMenu(freePilots, draftId) {
  const options = freePilots.slice(0, 25).map(p => {
    const ov = overallRating(p);
    const t  = ratingTier(ov);
    const flag = p.nationality?.split(' ')[0] || '';
    return {
      label      : `${t.badge} ${ov} — ${p.name}`,
      value      : String(p._id),
      description: `${flag} #${p.racingNumber || '?'} · Dép ${p.depassement} · Frei ${p.freinage} · Ctrl ${p.controle}`,
    };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`draft_pick_${draftId}`)
      .setPlaceholder('🔍 Sélectionner un pilote...')
      .addOptions(options)
  );
}

// ── Draft : embed "On The Clock" affiché avant chaque pick ─
function buildOnTheClockPayload(team, globalPick, totalPicks, round, pickInRound, totalInRound, freePilots, draftId) {
  const suspensePhrases = [
    `Les scouts de **${team.name}** s'activent en coulisses...`,
    `Tout le monde retient son souffle. **${team.name}** a la parole.`,
    `Le war room de **${team.name}** est en pleine réflexion...`,
    `C'est le moment de vérité pour **${team.name}**. Qui rejoindra l'écurie ?`,
    `Les négociations sont intenses du côté de **${team.name}**...`,
    `**${team.name}** consulte ses données. Le chrono tourne.`,
  ];
  const phrase = suspensePhrases[globalPick % suspensePhrases.length];

  const embed = new EmbedBuilder()
    .setColor(team.color || '#FFD700')
    .setAuthor({ name: `DRAFT F1 PL — ROUND ${round} · PICK ${pickInRound}/${totalInRound}` })
    .setTitle(`⏳  ${team.emoji}  ${team.name.toUpperCase()}  EST AU CHOIX`)
    .setDescription(`\n${phrase}\n\u200B`)
    .addFields({
      name: '📋 Pilotes restants',
      value: freePilots.slice(0, 10).map(p => {
        const ov = overallRating(p);
        const t  = ratingTier(ov);
        const flag = p.nationality?.split(' ')[0] || '';
        return `${t.badge} **${ov}** — ${flag} ${p.name} #${p.racingNumber || '?'}`;
      }).join('\n') + (freePilots.length > 10 ? `\n*…et ${freePilots.length - 10} autres*` : ''),
    })
    .setFooter({ text: `Pick global #${globalPick + 1}/${totalPicks} · Seul un admin peut sélectionner` });

  const selectRow = buildDraftSelectMenu(freePilots, draftId);
  return { embeds: [embed], components: [selectRow] };
}

// ── Draft : embed de révélation après un pick ─────────────
function buildPickRevealEmbed(team, pilot, globalPick, totalPicks, round, pickInRound, totalInRound) {
  const ov   = overallRating(pilot);
  const tier = ratingTier(ov);
  const flag = pilot.nationality || '🏳️ Inconnu';
  const isLast = globalPick + 1 >= totalPicks;

  const revealPhrases = [
    `L'écurie a tranché. Il n'y a plus de doute.`,
    `Le suspens est terminé. Le choix est officiel.`,
    `La signature est posée. C'est confirmé.`,
    `Après délibération, le verdict est tombé.`,
    `Le transfert est acté. Bienvenue dans l'écurie !`,
  ];
  const phrase = revealPhrases[globalPick % revealPhrases.length];

  const embed = new EmbedBuilder()
    .setColor(team.color || '#FFD700')
    .setAuthor({ name: `${team.emoji} ${team.name} — PICK OFFICIEL` })
    .setTitle(`🎯  ${pilot.name.toUpperCase()}`)
    .setDescription(
      `${phrase}\n\n` +
      `**${team.emoji} ${team.name}** sélectionne **${tier.badge} ${pilot.name}** !\n\u200B`
    )
    .addFields(
      { name: '🌍 Nationalité',   value: flag,              inline: true },
      { name: '🔢 Numéro',        value: `#${pilot.racingNumber || '?'}`, inline: true },
      { name: '⭐ Overall',        value: `**${tier.badge} ${ov}**`,       inline: true },
      { name: '📊 Stats clés', value:
        `Dép \`${pilot.depassement}\` · Frei \`${pilot.freinage}\` · Déf \`${pilot.defense}\`\n` +
        `Réact \`${pilot.reactions}\` · Ctrl \`${pilot.controle}\` · Adapt \`${pilot.adaptabilite}\` · Pneus \`${pilot.gestionPneus}\``,
      },
    )
    .setFooter({ text: isLast ? '🏁 Dernier pick de la draft !' : `Round ${round} · Pick ${pickInRound}/${totalInRound}` });

  if (pilot.photoUrl) embed.setThumbnail(pilot.photoUrl);

  return embed;
}

// ─── Score voiture pondéré selon le style de GP ───────────
// Retourne un score 0-100 représentant la performance de la voiture sur ce circuit
function carScore(team, gpStyle) {
  const w = (GP_STYLE_WEIGHTS[gpStyle] || GP_STYLE_WEIGHTS['mixte']).car;
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
  const w = (GP_STYLE_WEIGHTS[gpStyle] || GP_STYLE_WEIGHTS['mixte']).pilot;
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
function calcLapTime(pilot, team, tireCompound, tireWear, weather, trackEvo, gpStyle, position, scCooldown = 0) {
  const BASE = 90_000;
  const w = GP_STYLE_WEIGHTS[gpStyle] || GP_STYLE_WEIGHTS['mixte'];

  // Contribution voiture — max ~0.3s/tour entre meilleure et pire (anti-téléportation)
  const cScore = carScore(team, gpStyle);
  const carFRaw = 1 - ((cScore - 70) / 70 * 0.005);
  const carF = scCooldown > 0 ? 1 - ((cScore - 70) / 70 * 0.005 * (scCooldown / 6)) : carFRaw;

  // Contribution pilote — max ~0.35s/tour
  const pScore = pilotScore(pilot, gpStyle);
  const pilotFRaw = 1 - ((pScore - 50) / 50 * 0.004);
  const pilotF = scCooldown > 0 ? 1 - ((pScore - 50) / 50 * 0.004 * (scCooldown / 6)) : pilotFRaw;

  // Spécialisation — bonus très marginal (évite les sauts de position)
  let specF = 1.0;
  if (pilot.specialization) {
    const specWeight = GP_STYLE_WEIGHTS[gpStyle]?.pilot?.[pilot.specialization] || 1.0;
    specF = 1 - (specWeight * 0.0002);
  }

  // Pneus — dégradation linéaire avec légère accélération après 70% de vie utile
  const tireData = TIRE[tireCompound];
  if (!tireData) return 90_000; // fallback si compound inconnu
  const carTireBonus   = Math.max(-0.3, Math.min(0.3, (team.conservationPneus - 70) / 70 * 0.3));
  const pilotTireBonus = Math.max(-0.2, Math.min(0.2, (pilot.gestionPneus - 50) / 50 * 0.2));
  const effectiveDeg   = Math.max(0.0001, tireData.deg * (1 - carTireBonus - pilotTireBonus * 0.5));
  // tireLifeRef = seuil de tour où le cliff commence (SOFT~25, MEDIUM~38, HARD~60)
  const tireLifeRef  = 0.06 / effectiveDeg;
  const wearRatio    = Math.min(tireWear / Math.max(tireLifeRef, 1), 1.8);
  // Cliff linéaire : au-delà de 70% de vie, dégradation ×2.5 supplémentaire
  const cliffFactor  = wearRatio < 0.7 ? 1.0 : 1.0 + (wearRatio - 0.7) * 2.5;
  const wearPenalty  = tireWear * effectiveDeg * cliffFactor;
  const tireF        = (1 + wearPenalty) / tireData.grip;

  // Dirty air — pénalité ~0.1s max (pas une source de téléportation)
  let dirtyAirF = 1.0;
  if (position > 1) {
    const dirtyAirPenalty = (100 - team.dirtyAir) / 100 * 0.001;
    const daRandom = scCooldown > 0 ? Math.random() * 0.3 : Math.random();
    dirtyAirF = 1 + dirtyAirPenalty * daRandom;
  }

  // Track evolution
  const trackF = 1 - (trackEvo / 100 * 0.015);

  // Variance très faible — les positions NE changent PAS par hasard pur
  // Max ±72ms/tour. Seules stratégie/incidents/pneus changent le classement
  const cooldownFactor = scCooldown > 0 ? 0.1 : 1.0;
  const errorRange = (100 - pilot.controle) / 100 * 0.08 / 100 * cooldownFactor;
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

  return Math.round(BASE * carF * pilotF * specF * tireF * dirtyAirF * trackF * randF * weatherF);
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

function shouldPit(driver, lapsRemaining, gapAhead, totalLaps) {
  const { tireWear, tireCompound, pilot, team, tireAge, pitStops, pitStrategy, overcutMode } = driver;

  // Minimum de tours sur les pneus (sauf réparation forcée via tireAge=99)
  if (tireAge !== 99) {
    const minLapsOnTire = pitStops === 0 ? 12 : 8;
    if ((tireAge || 0) < minLapsOnTire) return { pit: false, reason: null };
  }

  // Stratégie 1-stop : attend 38% de la course avant le 1er arrêt
  if (pitStrategy === 'one_stop' && (pitStops || 0) === 0) {
    const lapsRaced = (totalLaps || 60) - lapsRemaining;
    if (lapsRaced < (totalLaps || 60) * 0.38) return { pit: false, reason: null };
  }
  // Stratégie 2-stop : 1er arrêt tôt (~22%), 2ème en fin
  if (pitStrategy === 'two_stop' && (pitStops || 0) === 0) {
    const lapsRaced = (totalLaps || 60) - lapsRemaining;
    if (lapsRaced < (totalLaps || 60) * 0.22) return { pit: false, reason: null };
  }

  // Mode overcut : reste dehors intentionnellement
  if (overcutMode && (tireWear || 0) < 30 && lapsRemaining > 12) return { pit: false, reason: null };

  // Seuils en tours (tireWear = nombre de tours sur ces pneus)
  // MEDIUM: pit autour de lap 38 ± ajustements; SOFT: plus tôt; HARD: plus tard
  const compoundFactor = tireCompound === 'SOFT' ? 0.65 : tireCompound === 'HARD' ? 1.4 : 1.0;
  const wornBase = 35 * compoundFactor;
  const wornThreshold = wornBase - (team.conservationPneus - 70) * 0.2 - (pilot.gestionPneus - 50) * 0.15;
  const urgentThreshold = wornThreshold * 1.2; // on attend plus longtemps si possible

  if (tireWear > urgentThreshold) return { pit: true, reason: 'tires_worn' }; // obligé
  if (tireWear > wornThreshold && Math.random() < 0.6) return { pit: true, reason: 'tires_worn' }; // progressif

  // Undercut — conditions strictes pour éviter le chaos post-SC
  // Pas d'undercut dans les X premiers tours de pneus (sinon tout le monde undercut post-SC)
  if (gapAhead !== null && gapAhead < 1500 && tireWear > 22 && lapsRemaining > 18 && (tireAge || 0) >= 14) {
    // Cooldown personnel : le pilote ne peut pas undercut 2 fois de suite (lastUndercutLap)
    const lastUnd = driver.lastUndercutLap || -99;
    if (lapsRemaining > (lastUnd - 4)) return { pit: false, reason: null }; // bloque pendant 4 tours après le dernier undercut
    // Probabilité réduite : ~10% par tour pour un pilote très agressif (depassement=100)
    // → sur 15 tours : ~79% de chance total (réaliste, pas systématique)
    // ~12%/tour pilote agressif (d=100), ~8%/tour moyen (d=60), réaliste
    const undChance = (pilot.depassement / 100) * 0.12;
    if (Math.random() < undChance) return { pit: true, reason: 'undercut' };
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
      // Double incident : SC possible mais VSC plus fréquent (F1 moderne)
      if (roll < 0.55) return { state: 'SC',  lapsLeft: randInt(3, 5) };
      return { state: 'VSC', lapsLeft: randInt(2, 4) };
    }
    // Crash solo : VSC majoritairement
    if (roll < 0.30) return { state: 'SC',  lapsLeft: randInt(2, 4) };
    if (roll < 0.75) return { state: 'VSC', lapsLeft: randInt(2, 3) };
    return { state: 'NONE', lapsLeft: 0 }; // crash qui se range proprement
  } else {
    // Crevaison → VSC très probable
    if (roll < 0.55) return { state: 'VSC', lapsLeft: randInt(1, 3) };
    return { state: 'NONE', lapsLeft: 0 };
  }
}

// ─── Incidents ────────────────────────────────────────────
// Les réactions et le controle réduisent le risque d'accident
function checkIncident(pilot, team) {
  const roll = Math.random();
  const reliabF  = (100 - team.refroidissement) / 100 * 0.007;  // réduit : max ~0.7%/tour
  const crashF   = ((100 - pilot.controle) / 100 * 0.003) + ((100 - pilot.reactions) / 100 * 0.002);  // réduit : max ~0.5%/tour
  if (roll < reliabF)            return { type: 'MECHANICAL', msg: `💥 Problème mécanique` };
  if (roll < reliabF + crashF)   return { type: 'CRASH',      msg: `💥 Accident` };
  if (roll < 0.002)              return { type: 'PUNCTURE',   msg: `🫧 Crevaison` };
  return null;
}

// ─── SIMULATION QUALIFICATIONS Q1/Q2/Q3 ──────────────────
// Q1 (tous) → élimine les 5 derniers → P16-20
// Q2 (15 restants) → élimine 5 autres → P11-15
// Q3 (10 restants) → shoot-out pour la grille de pole
// Chaque pilote fait UN tour chrono par segment, avec variabilité.
async function simulateQualifying(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','WET','INTER']);
  const n = pilots.length;
  // Taille des groupes selon nb de pilotes (scalable)
  const q3Size = Math.min(10, Math.max(3, Math.floor(n * 0.5)));
  const q2Size = Math.min(15, Math.max(q3Size + 2, Math.floor(n * 0.75)));
  // Q1 : tous les pilotes — 1 tour chrono + variation (tentative d'amélioration ~50% de chance)
  function doLap(pilot, team, extraVariation = 0) {
    const base = calcQualiTime(pilot, team, weather, race.gpStyle);
    const variance = randInt(-300, 300) + extraVariation;
    return base + variance;
  }

  const allTimes = pilots.map(pilot => {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) return null;
    const t1 = doLap(pilot, team);
    // 60% de chance d'améliorer le temps
    const t2 = Math.random() > 0.4 ? doLap(pilot, team, -randInt(50, 200)) : t1 + randInt(0, 500);
    return { pilot, team, time: Math.min(t1, t2) };
  }).filter(Boolean);

  allTimes.sort((a, b) => a.time - b.time);

  // Q2 : top q2Size relancent un tour
  const q2Pilots = allTimes.slice(0, q2Size);
  const q2Elim   = allTimes.slice(q2Size); // P16+ éliminés en Q1
  q2Pilots.forEach(e => {
    const t = doLap(e.pilot, e.team, -randInt(0, 150));
    if (t < e.time) e.time = t;
  });
  q2Pilots.sort((a, b) => a.time - b.time);

  // Q3 : top q3Size — dernier tour "à tout donner" (plus grande variance positive)
  const q3Pilots = q2Pilots.slice(0, q3Size);
  const q3Elim   = q2Pilots.slice(q3Size); // P11-15 éliminés en Q2
  q3Pilots.forEach(e => {
    const t = doLap(e.pilot, e.team, -randInt(100, 350));
    if (t < e.time) e.time = t;
  });
  q3Pilots.sort((a, b) => a.time - b.time);

  // Assembler la grille finale : Q3 → Q2 éliminés → Q1 éliminés
  const finalGrid = [
    ...q3Pilots,
    ...q3Elim,
    ...q2Elim,
  ].map((e, i) => ({
    pilotId  : e.pilot._id,
    pilotName: e.pilot.name,
    teamName : e.team.name,
    teamEmoji: e.team.emoji,
    time     : e.time,
    segment  : i < q3Size ? 'Q3' : i < q2Size ? 'Q2' : 'Q1',
  }));

  return { grid: finalGrid, weather, q3Size, q2Size, allTimes };
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

// ============================================================
// 🎬  BIBLIOTHÈQUE DE GIFs — une URL brute suffit pour Discord
//     pick() en prend un au hasard dans chaque catégorie
// ============================================================
const RACE_GIFS = {

  // ── Dépassement pour la tête ────────────────────────────
  overtake_lead: [
    'https://tenor.com/pCje6tnvEno.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExczJ3a3ZvbXV0OHg2cjMyaXFwcGdhMG80c3FkOGMzZXRnZnZvaHZrdSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0LxtyTiPQaTKx017yr/giphy.gif',
    'https://cdn.carthrottle.com/uploads/articles/qpogkgm85zjmvc38hssl-5791423a5f7e3.gif',
  ],

  // ── Dépassement pour le podium (P2/P3) ─────────────────
  overtake_podium: [
    'https://c.tenor.com/IB4EgSxeYREAAAAC/f1-max-verstappen.gif',
    'https://media.tenor.com/BRCHKWF94ZUAAAAM/f1overtake-f1ultrapassagem.gif',
    'https://jtsportingreviews.com/wp-content/uploads/2021/09/f1-2021-holland-perez-passes-ocon.gif',
  ],

  // ── Dépassement classique en piste (P4–P10) ─────────────
  overtake_normal: [
    'https://i.makeagif.com/media/2-29-2016/SMpwn6.gif',
    'https://media.tenor.com/QbdwfqcYeuIAAAAM/f1-f1overtake.gif',
    'https://cdn.makeagif.com/media/12-05-2013/RGyvuA.gif',
    'https://64.media.tumblr.com/bace9527a9df9d0f6d54a390510f34f1/tumblr_ntm7hr9HJ61s9l8tco4_540.gifv',
    'https://i.postimg.cc/HxWZBrBJ/Race-Highlights-2021-Italian-Grand-Prix-2.gif',
  ],

  // ── Crash / accident solo ────────────────────────────────
  crash_solo: [
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWdmOGF6NnAwNjlxcmhmMGRkYzEzdXBnZjNkZHd1eHoxMDdqNXc4OSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xULW8xLsh3p9P6Lq5q/giphy.gif',
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbHllZXRhMjFnZXZmYjlzZzFjazRnbzRrZzR2bDB0aGFpbXViZm96ciZlcD12MV9naWZzX3NlYXJjaCZjdD1n/XTYhuf6DwbDri/giphy.gif',
    'https://64.media.tumblr.com/tumblr_m55twpxti21qlt7lao8_r1_250.gif',
    'https://i.makeagif.com/media/9-11-2016/SE-F70.gif',
  ],

  // ── Collision entre deux voitures ───────────────────────
  crash_collision: [
    'https://tenor.com/btuTx.gif',
    'https://i.makeagif.com/media/3-20-2016/-MC6Il.gif',
    'https://gifdb.com/images/high/f1-red-bull-drift-crash-6gqtnu62ypxatxnq.gif',
  ],

  // ── Panne mécanique / fumée ─────────────────────────────
  mechanical: [
    'https://i.makeagif.com/media/6-25-2021/JmEwic.gif',
    'https://media.tenor.com/JZWc9Wj9ez8AAAAM/leclerc-ferrari.gif',
    'https://media.tenor.com/JZhKHG8sWS4AAAAM/kimi-raikkonen-kimi.gif',
  ],

  // ── Crevaison ───────────────────────────────────────────
  puncture: [
    'https://tenor.com/f0PpRM38N76.gif',
    'https://i.makeagif.com/media/11-07-2015/3KfYhi.gif',
  ],

  // ── Safety Car déployé ──────────────────────────────────
  safety_car: [
    'https://media.tenor.com/5q9Din4vE00AAAAM/f1-safety-car.gif',
    'https://i.makeagif.com/media/4-26-2017/Z-XYlx.gif',
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOXh6anIyeTljNThweWJ4bjVtY2RuN2VsdzRiNXBldWV1bGl4ejBsdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/Urd6nJqt5QJVFTVkoj/giphy.gif',
  ],

  // ── Virtual Safety Car ──────────────────────────────────
  vsc: [
    'https://static.wikia.nocookie.net/f1wikia/images/b/b5/Image-26.png/revision/latest/scale-to-width-down/732?cb=20250903081945',
    'https://www.pittalk.it/wp-content/uploads/2022/09/vsc-1-1-1-1024x577-1.jpeg',
  ],

  // ── Green flag / restart ─────────────────────────────────
  green_flag: [
    'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyZjhrM25zMWpxd2p3cmUzdGVlMXNvdjlqMWlidjhyeHBxcWx6YnMzdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/xrP3yQ0W19SGuguEd8/200w.gif',
  ],

  // ── Arrêt aux stands (pit stop) ─────────────────────────
  pit_stop: [
    'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUyajQweWdhdzd4czdtb2QwM25yd2F3NjJwcmw0OGMzMnA1OW1yOTY0MyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/6IcNBPp1H79nO/giphy.gif',
    'https://i.imgur.com/gsyznMd.gif',
    'https://media.tenor.com/1VEL6y9BYnMAAAAM/f1-pitstop.gif',
    'https://i.makeagif.com/media/4-14-2016/t8BSsA.gif',
  ],

  // ── Victoire / drapeau damier ───────────────────────────
  win: [
    'https://tenor.com/bNkX4.gif',
    'https://media.tenor.com/187wbBbM5bEAAAAM/waving-checkered-flag-f1.gif',
    'https://64.media.tumblr.com/cea8c5fba5064f7d20d8fb5af2911df9/bcde5965de4f08e5-aa/s640x960/20ab168e7bef8084d034b13a9651b82353f1e18b.gif',
    'https://i.makeagif.com/media/10-24-2022/0sN5ZB.gif',
  ],

  // ── Départ de course ────────────────────────────────────
  race_start: [
    'https://i.imgur.com/xNNASJJ.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUycng5azRjd29yNjRoNDRkd2c2ZnU3ZGF6a2s2eDI2bG52a3JqZ2Q4ZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ws8Lpb894KpDGQF0nn/giphy.gif',
    'https://gifzz.com/storage/gifs/X2hfnFtGZ3Su9Wm0saOKFE1xjv6mM9GMLjyvRW9A.gif',
  ],
};

/** Retourne un GIF aléatoire de la catégorie — ou null si tous les PLACEHOLDER */
function pickGif(category) {
  const list = RACE_GIFS[category];
  if (!list || !list.length) return null;
  const url = pick(list);
  // Ne pas envoyer les placeholders non remplis
  if (url.includes('PLACEHOLDER')) return null;
  return url;
}

// ─── Bibliothèques de narration ───────────────────────────

// Comment un dépassement se produit physiquement — drama selon le rang impliqué
function overtakeDescription(attacker, defender, gpStyle) {
  const drs      = gpStyle === 'rapide' && attacker.team.drs > 82;
  const freinage = attacker.pilot.freinage > 75;
  const a  = attacker.pilot.name;
  const d  = defender.pilot.name;
  const ae = attacker.team.emoji;
  const de = defender.team.emoji;
  const newPos  = attacker.pos;
  const lostPos = defender.pos;
  const forLead   = newPos === 1;
  const forPodium = newPos <= 3;
  const isTop3    = newPos <= 3 || lostPos <= 3;
  const isTop8    = newPos <= 8 || lostPos <= 8;

  if (forLead) {
    return pick([
      `***${ae}${a} PREND LA TÊTE !!! INCROYABLE !!!***\n  › Il plonge ${drs ? 'en DRS 📡' : 'au freinage'} — ${de}${d} ne peut RIEN faire. ***LE LEADER A CHANGÉ !***`,
      `***🔥 ${ae}${a} — P1 !!! IL ARRACHE LA PREMIÈRE PLACE !***\n  › ${de}${d} résiste, résiste... mais c'est imparable. ***LE GP BASCULE !***`,
      `***⚡ ${ae}${a} PASSE ${de}${d} ET PREND LA TÊTE DU GRAND PRIX !!!***`,
    ]);
  }
  if (forPodium) {
    return pick([
      `***🏆 ${ae}${a} S'EMPARE DU PODIUM !!! P${newPos} !!!***\n  › Il passe ${de}${d} ${freinage ? 'au freinage tardif' : drs ? 'sous DRS 📡' : 'en sortie de virage'} — ***LA PLACE SUR LE PODIUM CHANGE DE MAINS !***`,
      `***💫 DÉPASSEMENT POUR LE PODIUM !*** ${ae}${a} plonge sur ${de}${d} — brutal, propre, implacable. ***P${newPos} !***`,
    ]);
  }
  if (isTop3) {
    return pick([
      `***😱 ${de}${d} RÉTROGRADE DU TOP 3 !*** ${ae}${a} le passe ${freinage ? 'au freinage' : drs ? 'en DRS 📡' : 'en sortie de virage'} !`,
      `***⚡ ${ae}${a} DANS LE TOP 3 !*** Il déborde ${de}${d} — on n'a rien vu venir !`,
    ]);
  }
  if (isTop8) {
    return pick([
      `🔥 **${ae}${a}** passe **${de}${d}** ${freinage ? 'au freinage' : drs ? 'en DRS 📡' : 'en sortie de virage'} — il monte dans le classement !`,
      `👊 **${ae}${a}** déborde **${de}${d}** ${drs ? 'grâce au DRS 📡' : 'à la corde'} — belle opportunité saisie !`,
    ]);
  }
  const straights = [
    `${ae}**${a}** surgit dans la ligne droite${drs ? ' en DRS 📡' : ''} — passe côté intérieur, ${de}**${d}** ne peut rien faire.`,
    `${ae}**${a}** prend le sillage de ${de}**${d}**${drs ? ' et active le DRS 📡' : ''} — déborde proprement.`,
  ];
  const braking = [
    `${ae}**${a}** freine tard — plonge à l'intérieur et pique la position à ${de}**${d}**.`,
    `Freinage tardif de ${ae}**${a}** — il passe, ${de}**${d}** est débordé.`,
  ];
  const corner = [
    `${ae}**${a}** prend l'extérieur avec du culot — enroule et ressort devant ${de}**${d}**.`,
  ];
  const undercut = [
    `${ae}**${a}** refait son retard sur pneus frais — double ${de}**${d}** qui n'a aucune réponse.`,
  ];
  if (drs)                     return pick(straights);
  if (freinage)                return pick(braking);
  if (gpStyle === 'technique') return pick(corner);
  if (gpStyle === 'endurance') return pick(undercut);
  return pick([...straights, ...braking, ...corner]);
}

// Description physique d'un accident solo — drama selon la position
function crashSoloDescription(driver, lap, gpStyle) {
  const n   = `${driver.team.emoji}**${driver.pilot.name}**`;
  const pos = driver.pos;
  const isTop3 = pos <= 3;
  const isTop8 = pos <= 8;

  if (isTop3) {
    return pick([
      `***💥 NON !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} DNF !!! DEPUIS P${pos} !!!***\n  › La voiture perd le contrôle, explose dans les barrières. ***Une course magnifique réduite à néant en une fraction de seconde.*** ❌`,
      `***🔥 CATASTROPHE !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} ABANDONNE !!!***\n  › Depuis ***P${pos}*** — tête-à-queue, choc violent contre le mur. ***Le Grand Prix lui est volé de la pire des façons.*** ❌`,
      `***😱 INCROYABLE !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} HORS COURSE !!!***\n  › Il était ***P${pos}***, solide, rapide — et voilà. Une erreur, et tout s'effondre. ***L'écurie est dévastée.*** ❌`,
    ]);
  }
  if (isTop8) {
    return pick([
      `💥 **T${lap} — GROS ACCIDENT !** ${n} (P${pos}) perd le contrôle et finit dans les barrières — une belle course qui s'arrête brutalement. ❌ **DNF.**`,
      `🚨 **T${lap}** — Sortie violente pour ${n} (P${pos}) ! Dommage, il était bien placé. ❌ **DNF.**`,
    ]);
  }
  const urbain = [
    `💥 **T${lap}** — ${n} (P${pos}) touche les glissières dans la chicane. ❌ **DNF.**`,
    `🚧 **T${lap}** — ${n} (P${pos}) part à la glisse dans un épingle, percute le mur. ❌ **DNF.**`,
  ];
  const rapide = [
    `💨 **T${lap}** — ${n} (P${pos}) perd le contrôle à pleine vitesse — choc brutal. ❌ **DNF.**`,
    `🚨 **T${lap}** — ${n} (P${pos}) part en tête-à-queue dans la courbe rapide. ❌ **DNF.**`,
  ];
  const generic = [
    `💥 **T${lap}** — ${n} (P${pos}) perd l'arrière dans un virage lent, finit dans le bac. ❌ **DNF.**`,
    `🚗 **T${lap}** — ${n} (P${pos}) sort large, accroche le mur — trop endommagé pour continuer. ❌ **DNF.**`,
  ];
  if (gpStyle === 'urbain') return pick(urbain);
  if (gpStyle === 'rapide') return pick(rapide);
  return pick(generic);
}

// Description d'une collision entre deux pilotes — drama selon le rang
function collisionDescription(attacker, victim, lap, attackerDnf, victimDnf, damage) {
  const a  = `**${attacker.team.emoji}${attacker.pilot.name}**`;
  const v  = `**${victim.team.emoji}${victim.pilot.name}**`;
  const an = attacker.pilot.name;
  const vn = victim.pilot.name;
  const ae = attacker.team.emoji;
  const ve = victim.team.emoji;
  const ap = attacker.pos;
  const vp = victim.pos;
  const isTop3 = ap <= 3 || vp <= 3;
  const isTop8 = ap <= 8 || vp <= 8;

  // ── DRAMA MAXIMAL : top 3 impliqué ───────────────────────
  if (isTop3) {
    if (attackerDnf && victimDnf) {
      return pick([
        `***💥 DOUBLE CATASTROPHE !!! T${lap}***\n  › ***${ae}${an}*** et ***${ve}${vn}*** se PERCUTENT violemment — les deux voitures dans le mur !!! ***DOUBLE DNF !!! La course vient de perdre ses plus beaux acteurs.***`,
        `***🔥 COLLISION MONUMENTALE !!! T${lap}***\n  › ***${ae}${an}*** (P${ap}) plonge sur ***${ve}${vn}*** (P${vp}) — CONTACT INÉVITABLE — ***LES DEUX ABANDONNENT !!! C'est un désastre absolu.***`,
      ]);
    } else if (attackerDnf) {
      return pick([
        `***💥 ACCROCHAGE EN HAUT DU CLASSEMENT !!! T${lap}***\n  › ***${ae}${an}*** prend trop de risques sur ${v} (P${vp}) — le contact est BRUTAL. ***${a} abandonne sur le champ.*** ❌\n  › ${v} repart endommagé — **+${(damage/1000).toFixed(1)}s** perdus.`,
      ]);
    } else {
      return pick([
        `***⚠️ CONTACT DANS LE TOP !!! T${lap}***\n  › ${a} (P${ap}) accroche ***${ve}${vn}*** (P${vp}) — ***${v} EXPULSÉ DE LA COURSE !*** ❌ **DNF.**\n  › ${a} continue dans un état lamentable — **+${(damage/1000).toFixed(1)}s**.`,
      ]);
    }
  }

  // ── Drama modéré : top 8 ──────────────────────────────────
  if (isTop8) {
    const intro = pick([
      `🚨 **T${lap} — ACCROCHAGE !** ${a} (P${ap}) et ${v} (P${vp}) se touchent — les pièces volent !`,
      `💥 **T${lap} — CONTACT !** ${a} plonge sur ${v} — impact violent pour les deux.`,
    ]);
    let consequence = '\n';
    if (attackerDnf && victimDnf) consequence += `  ❌ **Double DNF.** Les deux hors course.`;
    else if (attackerDnf)         consequence += `  ❌ ${a} abandonne (DNF).\n  ⚠️ ${v} repart abîmé — **+${(damage/1000).toFixed(1)}s**.`;
    else if (victimDnf)           consequence += `  ❌ ${v} hors course (DNF).\n  ⚠️ ${a} continue endommagé.`;
    else                          consequence += `  ⚠️ Les deux continuent avec des dégâts.`;
    return intro + consequence;
  }

  // ── Sobre : fond de grille ────────────────────────────────
  const intros = [
    `💥 **T${lap} — CONTACT !** ${a} (P${ap}) plonge sur ${v} (P${vp}) — les deux se touchent.`,
    `🚨 **T${lap}** — ${a} (P${ap}) accroche l'arrière de ${v} (P${vp}).`,
  ];
  let consequence = '\n';
  if (attackerDnf && victimDnf) consequence += `  ❌ **Double DNF.**`;
  else if (attackerDnf)         consequence += `  ❌ ${a} abandonne (DNF). ⚠️ ${v} continue abîmé — **+${(damage/1000).toFixed(1)}s**.`;
  else if (victimDnf)           consequence += `  ❌ ${v} hors course (DNF). ⚠️ ${a} continue endommagé.`;
  else                          consequence += `  ⚠️ Les deux continuent — les commissaires prennent note.`;
  return pick(intros) + consequence;
}

// Ambiance aléatoire play-by-play — TOUJOURS quelque chose à dire
function atmosphereLine(ranked, lap, totalLaps, weather, scState, gpStyle) {
  if (!ranked.length) return null;
  const leader = ranked[0];
  const second = ranked[1];
  const third  = ranked[2];
  const pct    = lap / totalLaps;

  const lines = [];

  // ── Sous SC/VSC : commentaire spécifique ───────────────
  if (scState.state === 'SC') {
    const pit4 = ranked.slice(0,6).map(d => `${d.team.emoji}**${d.pilot.name}**`).join(' · ');
    lines.push(pick([
      `🚨 Le peloton roule en file derrière la voiture de sécurité... ${pit4} — les équipes analysent les stratégies. Qui va rentrer ?`,
      `🚨 La course est gelée. Les mécaniciens sont en alerte dans les stands — l'arrêt sous SC peut tout changer !`,
      `🚨 Le Safety Car maintient le rythme... Les pilotes gardent leurs pneus au chaud. Le restart va être explosif.`,
    ]));
    return pick(lines);
  }
  if (scState.state === 'VSC') {
    lines.push(pick([
      `🟡 VSC en cours — tout le monde roule au delta. Personne ne peut attaquer, personne ne peut défendre.`,
      `🟡 Virtual Safety Car toujours actif. La course reprendra bientôt — les gaps se figent.`,
    ]));
    return pick(lines);
  }

  // ── Gaps en tête — drama si serré ───────────────────────
  if (second) {
    const gapTop = (second.totalTime - leader.totalTime) / 1000;
    if (gapTop < 0.3) {
      lines.push(pick([
        `***👀 ${second.team.emoji}${second.pilot.name} DANS LE DRS !!! ${gapTop.toFixed(3)}s — LA BOMBE VA EXPLOSER !!!***`,
        `***🔥 ${gapTop.toFixed(3)}s !!! ${second.team.emoji}${second.pilot.name} colle aux roues de ${leader.team.emoji}${leader.pilot.name} — ÇA VA PASSER OU ÇA VA CASSER !!!***`,
      ]));
    } else if (gapTop < 1.0) {
      lines.push(pick([
        `***⚡ T${lap} — ${second.team.emoji}${second.pilot.name} est à **${gapTop.toFixed(3)}s** de ${leader.team.emoji}${leader.pilot.name}*** — la pression est maximale !`,
        `😤 **${second.team.emoji}${second.pilot.name}** fond sur **${leader.team.emoji}${leader.pilot.name}** — ${gapTop.toFixed(3)}s seulement. Ça chauffait déjà, ça brûle maintenant.`,
      ]));
    } else if (gapTop < 2.5 && third) {
      const gap3 = (third.totalTime - second.totalTime) / 1000;
      if (gap3 < 1.5) lines.push(`🏎️ **Bagarre à trois !** ${leader.team.emoji}**${leader.pilot.name}** · ${second.team.emoji}**${second.pilot.name}** · ${third.team.emoji}**${third.pilot.name}** — tous dans le même mouchoir !`);
      else lines.push(`🏎️ ${leader.team.emoji}**${leader.pilot.name}** devant — **${gapTop.toFixed(1)}s** sur ${second.team.emoji}**${second.pilot.name}**. La pression monte.`);
    } else if (gapTop > 20) {
      lines.push(pick([
        `🏃 ${leader.team.emoji}**${leader.pilot.name}** file seul en tête — **${gapTop.toFixed(1)}s** d'avance. On dirait une autre course là-devant.`,
        `💨 ${leader.team.emoji}**${leader.pilot.name}** maîtrise parfaitement son Grand Prix. **+${gapTop.toFixed(1)}s** — c'est impressionnant.`,
      ]));
    } else {
      // Gap moyen — commentaire générique sur la course
      lines.push(pick([
        `🏎️ T${lap}/${totalLaps} — ${leader.team.emoji}**${leader.pilot.name}** en tête avec **+${gapTop.toFixed(1)}s** sur ${second.team.emoji}**${second.pilot.name}**. La course suit son cours.`,
        `⏱ T${lap} — Ordre stable en tête. ${leader.team.emoji}**${leader.pilot.name}** administre son avantage.`,
        `🎙 T${lap} — ${leader.team.emoji}**${leader.pilot.name}** reste au commandement. ${second.team.emoji}**${second.pilot.name}** surveille ses pneus.`,
      ]));
    }
  } else {
    lines.push(`🏁 ${leader.team.emoji}**${leader.pilot.name}** seul en piste — tous les adversaires ont abandonné !`);
  }

  // ── Commentaires sur les pneus / stratégie ───────────────
  const hardPushers = ranked.filter(d => d.tireWear > 30 && d.pos <= 8);
  if (hardPushers.length > 0) {
    const p = hardPushers[0];
    lines.push(pick([
      `🔥 **${p.team.emoji}${p.pilot.name}** (P${p.pos}) est en train de griller ses ${TIRE[p.tireCompound].emoji}**${TIRE[p.tireCompound].label}** — il va devoir s'arrêter bientôt.`,
      `⚠️ Usure critique sur la voiture de **${p.team.emoji}${p.pilot.name}** — les pneus ${TIRE[p.tireCompound].emoji} sont en limite. La stratégie va être décisive.`,
    ]));
  }

  // ── Météo ────────────────────────────────────────────────
  if (weather === 'WET')   lines.push(pick([
    `🌧️ Pluie battante — la piste est traîtresse. Chaque virage demande une concentration maximale.`,
    `🌧️ Les spray derrière les voitures réduisent la visibilité. Difficile de dépasser dans ces conditions.`,
  ]));
  if (weather === 'HOT')   lines.push(`🔥 La chaleur est intense — **${Math.floor(50 + Math.random()*10)}°C** en piste. Les pneus souffrent énormément aujourd'hui.`);
  if (weather === 'INTER') lines.push(pick([
    `🌦️ Piste mixte — ni sec, ni mouillé. La fenêtre des slicks pourrait s'ouvrir dans quelques tours.`,
    `🌦️ Conditions délicates. Un pilote sur intermédiaires peut perdre des secondes par tour si la piste sèche.`,
  ]));

  // ── Étapes clés de la course ─────────────────────────────
  if (pct > 0.24 && pct < 0.28) {
    lines.push(`📊 **Premier quart de course** passé — les stratèges commencent à calculer les fenêtres de pit stop.`);
  }
  if (pct > 0.48 && pct < 0.52) {
    lines.push(`⏱ **Mi-course !** T${lap}/${totalLaps} — qui va jouer la stratégie, qui va rester dehors ?`);
  }
  if (pct > 0.74 && pct < 0.78) {
    lines.push(pick([
      `🏁 **Dernier quart de course.** Les positions se cristallisent — ou pas. Tout peut encore arriver.`,
      `🏁 Plus que ${totalLaps - lap} tours ! Les mécaniciens croisent les doigts. Les pilotes donnent tout.`,
    ]));
  }

  // ── Battle dans le peloton ───────────────────────────────
  for (let i = 1; i < Math.min(ranked.length, 12); i++) {
    const behind = ranked[i];
    const ahead  = ranked[i-1];
    const gap = (behind.totalTime - ahead.totalTime) / 1000;
    if (gap < 1.5 && gap > 0.3) {
      lines.push(pick([
        `👁 **Surveillance !** ${behind.team.emoji}**${behind.pilot.name}** (P${i+1}) est à **${gap.toFixed(3)}s** de ${ahead.team.emoji}**${ahead.pilot.name}** (P${i}). Ça fume derrière !`,
        `🔭 **P${i} vs P${i+1} —** ${ahead.team.emoji}**${ahead.pilot.name}** sous pression de ${behind.team.emoji}**${behind.pilot.name}** · **+${gap.toFixed(3)}s** entre eux.`,
      ]));
      break;
    }
  }

  // ── Style de circuit ────────────────────────────────────
  if (gpStyle === 'urbain' && Math.random() < 0.25) {
    lines.push(pick([
      `🏙️ Sur ce circuit urbain, les murs sont partout — la concentration doit être totale.`,
      `🏙️ Les virages à angle droit du tracé urbain rendent les dépassements très difficiles. La qualif' était cruciale.`,
    ]));
  }
  if (gpStyle === 'rapide' && Math.random() < 0.25) {
    lines.push(pick([
      `💨 Circuit rapide — les voitures passent à plus de 300 km/h dans les lignes droites. Impressionnant.`,
      `💨 À ces vitesses, le moindre écart de trajectoire se paie cash. La précision est reine.`,
    ]));
  }

  if (!lines.length) {
    // Fallback universel
    lines.push(`🎙 T${lap}/${totalLaps} — La course continue. ${ranked[0]?.team.emoji}**${ranked[0]?.pilot.name}** reste en tête.`);
  }
  return pick(lines);
}

// ─── Descriptions de DÉFENSE ────────────────────────────────
function defenseDescription(defender, attacker, gpStyle) {
  const a = `${attacker.team.emoji}**${attacker.pilot.name}**`;
  const d = `${defender.team.emoji}**${defender.pilot.name}**`;
  const defHigh = defender.pilot.defense > 75;
  const freinage = defender.pilot.freinage > 70;
  return pick([
    `🛡️ ${d} ferme la porte — couvre l'intérieur, ${a} doit lever le pied !`,
    `🛡️ ${d} résiste ! Freinage tardif${freinage ? ' au millimètre' : ''} — il repousse ${a} dehors. ${defHigh ? '**Défense magistrale.**' : ''}`,
    `💪 ${a} tente le coup, mais ${d} couvre chaque virage. Pas de passage !`,
    `🔒 ${d} en mode défensif — il change de trajectoire juste avant le point de corde. ${a} est bloqué !`,
    `🏎️ Bras de fer entre ${a} et ${d} — le défenseur est cramponné à sa position. Magnifique lutte !`,
  ]);
}

// ─── Descriptions de CONTRE-ATTAQUE (repasse après avoir été passé) ─────────
function counterAttackDescription(attacker, defender, gpStyle) {
  const a = `${attacker.team.emoji}**${attacker.pilot.name}**`;
  const d = `${defender.team.emoji}**${defender.pilot.name}**`;
  return pick([
    `***⚡ CONTRE-ATTAQUE IMMÉDIATE !*** ${a} avait passé ${d}, mais ${d} retarde son freinage au maximum — ***il REPASSE !*** Incroyable !`,
    `***🔄 IL REPREND SA PLACE !*** ${d} passe à l'intérieur du prochain virage — ${a} ne s'y attendait pas ! ***INVERSION !***`,
    `***😤 PAS QUESTION DE LAISSER ÇA !*** ${d} répond dans la foulée — il force son chemin et reprend la position ! ***FANTASTIQUE !***`,
    `***💥 RÉPONSE IMMÉDIATE !*** ${a} avait cru avoir fait le plus dur, mais ${d} est là — freinage tardif, corde parfaite. ***Il revient !***`,
    `🔄 ${d} ne se laisse pas faire — il trouve l'ouverture au virage suivant et récupère sa position dans la foulée !`,
  ]);
}

// ─── CONFÉRENCE DE PRESSE — Génération combinatoire ──────
// Injecte les vraies données de course + saison pour un résultat unique à chaque fois
async function generatePressConference(raceDoc, finalResults, season, allPilots, allTeams, allStandings, constrStandings) {
  const totalRaces    = 24; // CIRCUITS.length
  const gpNumber      = raceDoc.index + 1;
  const seasonPhase   = gpNumber <= 6 ? 'début' : gpNumber <= 16 ? 'mi' : 'fin';
  const seasonPhaseLabel = gpNumber <= 6 ? `début de saison (GP ${gpNumber}/24)` : gpNumber <= 16 ? `mi-saison (GP ${gpNumber}/24)` : `fin de saison (GP ${gpNumber}/24)`;
  const styleLabels   = { urbain:'urbain', rapide:'rapide', technique:'technique', mixte:'mixte', endurance:'d\'endurance' };

  const teamMap  = new Map(allTeams.map(t => [String(t._id), t]));
  const pilotMap = new Map(allPilots.map(p => [String(p._id), p]));
  const standMap = new Map(allStandings.map(s => [String(s.pilotId), s]));
  const cStandMap= new Map(constrStandings.map(s => [String(s.teamId), s]));

  // Classement constructeurs trié
  const cStandSorted = [...constrStandings].sort((a,b) => b.points - a.points);

  // Helpers
  const champLeader = allStandings.sort((a,b) => b.points - a.points)[0];
  const champLeaderPilot = champLeader ? pilotMap.get(String(champLeader.pilotId)) : null;

  function pilotChampPos(pilotId) {
    const sorted = [...allStandings].sort((a,b) => b.points - a.points);
    const idx = sorted.findIndex(s => String(s.pilotId) === String(pilotId));
    return idx >= 0 ? idx + 1 : null;
  }
  function teamConstrPos(teamId) {
    const idx = cStandSorted.findIndex(s => String(s.teamId) === String(teamId));
    return idx >= 0 ? idx + 1 : null;
  }
  function recentForm(pilotId) {
    // Sera rempli après la mise à jour des GPRecords — on utilise les standings de la saison
    const s = standMap.get(String(pilotId));
    if (!s) return null;
    return { wins: s.wins, podiums: s.podiums, dnfs: s.dnfs, points: s.points };
  }

  // Sélectionner les pilotes qui auront une conf de presse
  // P1 toujours + 1-2 "story of the race" parmi : P2/P3, gros DNF depuis le top3, meilleure remontée, leader du champ. s'il n'est pas P1
  const finishedSorted = finalResults.filter(r => !r.dnf).sort((a,b) => a.pos - b.pos);
  const dnfTop3        = finalResults.filter(r => r.dnf && r.pos <= 5); // était haut avant abandon

  const confSubjects = [];

  // P1 obligatoire
  if (finishedSorted[0]) confSubjects.push({ result: finishedSorted[0], angle: 'winner' });

  // P2 si course serrée ou championship interest
  if (finishedSorted[1]) {
    const gap = finishedSorted[1].pos;
    const champPos = pilotChampPos(String(finishedSorted[1].pilotId));
    if (champPos && champPos <= 3) confSubjects.push({ result: finishedSorted[1], angle: 'podium_champ' });
    else confSubjects.push({ result: finishedSorted[1], angle: 'podium' });
  }

  // Gros DNF dramatique
  if (dnfTop3.length && confSubjects.length < 3) {
    confSubjects.push({ result: dnfTop3[0], angle: 'dnf_drama' });
  }

  // Leader du championnat s'il n'est pas déjà dans la liste (s'il a fini P4+)
  if (champLeaderPilot) {
    const alreadyIn = confSubjects.some(s => String(s.result.pilotId) === String(champLeaderPilot._id));
    if (!alreadyIn) {
      const r = finalResults.find(r => String(r.pilotId) === String(champLeaderPilot._id));
      if (r) confSubjects.push({ result: r, angle: 'champ_leader' });
    }
  }

  // Générer les blocs de texte
  const blocks = [];

  for (const { result, angle } of confSubjects.slice(0, 3)) {
    const pilot    = pilotMap.get(String(result.pilotId));
    const team     = teamMap.get(String(result.teamId));
    if (!pilot || !team) continue;

    const stand    = standMap.get(String(pilot._id));
    const champPos = pilotChampPos(String(pilot._id));
    const cPos     = teamConstrPos(String(team._id));
    const form     = recentForm(String(pilot._id));
    const wins     = form?.wins || 0;
    const podiums  = form?.podiums || 0;
    const pts      = form?.points || 0;
    const dnfs     = form?.dnfs || 0;

    // Trouver le coéquipier
    const teammate = allPilots.find(p =>
      String(p.teamId) === String(team._id) &&
      String(p._id) !== String(pilot._id)
    );
    const teammateResult = teammate ? finalResults.find(r => String(r.pilotId) === String(teammate._id)) : null;

    // Trouver le rival
    const rival = pilot.rivalId ? pilotMap.get(String(pilot.rivalId)) : null;
    const rivalResult = rival ? finalResults.find(r => String(r.pilotId) === String(rival._id)) : null;

    // Construire le contexte riche
    const ctx = {
      name       : pilot.name,
      emoji      : team.emoji,
      teamName   : team.name,
      pos        : result.pos,
      dnf        : result.dnf,
      dnfReason  : result.dnfReason,
      circuit    : raceDoc.circuit,
      gpStyle    : raceDoc.gpStyle,
      gpPhase    : seasonPhaseLabel,
      wins, podiums, pts, dnfs,
      champPos,
      cPos,
      champLeaderName : champLeaderPilot?.name,
      champLeaderPts  : champLeader?.points || 0,
      teammate   : teammate?.name,
      teammatePos: teammateResult?.pos,
      teammateDnf: teammateResult?.dnf,
      rival      : rival?.name,
      rivalPos   : rivalResult?.pos,
      rivalDnf   : rivalResult?.dnf,
      seasonPhase,
    };

    const block = buildPressBlock(ctx, angle);
    if (block) blocks.push(block);
  }

  return blocks;
}

// ── Templates combinatoires de conf de presse ─────────────
function buildPressBlock(ctx, angle) {
  const { name, emoji, teamName, pos, dnf, dnfReason, circuit, gpStyle,
          gpPhase, wins, podiums, pts, champPos, cPos,
          champLeaderName, champLeaderPts, teammate, teammatePos,
          rival, rivalPos, rivalDnf, seasonPhase } = ctx;

  // Formule courte du bilan saison
  const bilanStr = wins > 0
    ? `${wins} victoire(s) et ${podiums} podium(s) cette saison`
    : podiums > 0
      ? `${podiums} podium(s) sans victoire encore cette saison`
      : `une saison difficile jusqu'ici`;

  // Situation au championnat
  const champStr = champPos === 1
    ? `en tête du championnat`
    : champPos <= 3
      ? `P${champPos} au championnat`
      : champPos <= 8
        ? `P${champPos} au général`
        : `loin au championnat`;

  // Pression de fin de saison
  const endPressure = seasonPhase === 'fin' && champPos && champPos <= 4
    ? pick([
        `Avec ${24 - (parseInt(gpPhase) || 20)} GPs restants, chaque point compte.`,
        `On est en fin de championnat — il n'y a plus de place pour l'erreur.`,
        `Le titre se jouera dans les prochaines courses. On le sait tous.`,
      ])
    : '';

  // Réaction coéquipier
  const teammateStr = teammate && teammatePos
    ? teammatePos < pos && !dnf
      ? pick([
          `Mon coéquipier ${teammate} était devant aujourd'hui — il faut l'accepter.`,
          `${teammate} a été plus fort ce week-end. Je dois analyser pourquoi.`,
          `On ne se rend pas service dans la même écurie. Ça mérite une discussion.`,
        ])
      : pos < (teammatePos || 99) && !dnf
        ? pick([
            `${teammate} était là aussi — mais j'avais le rythme aujourd'hui.`,
            `Bonne course pour l'équipe dans l'ensemble. Moi devant ${teammate}, c'est bien.`,
          ])
        : ''
    : '';

  // Réaction rival
  const rivalStr = rival && rivalPos
    ? rivalDnf
      ? pick([
          `${rival} n'a pas terminé — ces choses arrivent. Je reste focus sur ma course.`,
          `L'abandon de ${rival} ne change rien à mon approche. Je gère ma course.`,
        ])
      : rivalPos > pos
        ? pick([
            `${rival} était derrière moi aujourd'hui. C'est ce qu'on voulait.`,
            `On a fait le travail face à ${rival} ce week-end.`,
          ])
        : pick([
            `${rival} était devant — ça pique, mais il a été meilleur aujourd'hui.`,
            `Pas satisfait de finir derrière ${rival}. On doit retravailler ça.`,
          ])
    : '';

  // Style de circuit
  const styleStr = {
    urbain    : `Sur un circuit urbain comme ${circuit}, la moindre erreur se paye cash`,
    rapide    : `Un circuit rapide comme ${circuit} révèle la vraie performance des voitures`,
    technique : `${circuit} demande une précision absolue — c'est ce qu'on a apporté`,
    mixte     : `${circuit} est un circuit équilibré, ça convient à notre package`,
    endurance : `La gestion des pneus sur ${circuit} était la clé aujourd'hui`,
  }[gpStyle] || `${circuit} était exigeant aujourd'hui`;

  // Constructeurs
  const constrStr = cPos === 1
    ? `On reste en tête du championnat constructeurs — l'équipe fait un travail incroyable.`
    : cPos && cPos <= 3
      ? `On est P${cPos} chez les constructeurs — l'équipe se bat sur tous les fronts.`
      : '';

  // ── ANGLES ───────────────────────────────────────────────

  if (angle === 'winner') {
    const tones = [
      // Dominant
      () => {
        const opener = pick([
          `"${styleStr}. On a tout contrôlé aujourd'hui."`,
          `"On a géré la course du début à la fin. La voiture était là, le rythme était là."`,
          `"Depuis les qualifications, on savait qu'on avait le package. Il fallait l'exécuter."`,
        ]);
        const middle = wins >= 3
          ? pick([
              `"${wins} victoires en ${gpPhase}. On ne s'attendait pas à ça forcément, mais on le prend."`,
              `"C'est notre ${wins}ème victoire cette saison. L'élan est là. ${endPressure}"`,
            ])
          : wins === 1
            ? `"Première victoire de la saison — ça fait un bien fou. Maintenant on continue."`
            : `"Belle victoire pour le moral. ${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. On avance."`;
        const closer = champPos === 1
          ? pick([
              `"${champStr} — mais rien n'est joué. ${endPressure || 'On reste humbles.'}"`,
              `"En tête du championnat, c'est là où on veut être. ${constrStr}"`,
            ])
          : pick([
              `"On remonte au classement. P${champPos} maintenant — ${champLeaderName} est dans le viseur."`,
              `"${champLeaderName} a toujours des points d'avance, mais on réduit. ${endPressure}"`,
            ]);
        return `${opener}\n${middle}\n${closer}${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
      // Soulagement / humble
      () => {
        const opener = pick([
          `"Honnêtement, ça n'était pas la course la plus simple. Mais on a tenu."`,
          `"Il y a eu des moments de doute — mais l'équipe m'a donné un bon pit stop et j'ai pu gérer."`,
          `"Je ne vais pas mentir, j'ai eu de la chance à un moment. Mais il faut la provoquer."`,
        ]);
        const middle = `"${styleStr}. Ça nous a bien convenu aujourd'hui."`;
        const closer = champPos === 1
          ? `"${champStr}. ${endPressure || 'On prend race par race.'}"${constrStr ? ' ' + constrStr : ''}`
          : `"P${champPos} au championnat avec ${pts} points. ${endPressure || 'Il reste du boulot.'}"`
        return `${opener}\n${middle}\n${closer}${rivalStr ? '\n*Sur ' + rival + ' :* "' + rivalStr.replace(/^[^"]*"?/, '').replace(/"$/, '') + '"' : ''}`;
      },
      // Technique / focus
      () => {
        const opener = pick([
          `"Le travail de l'équipe cette semaine a été remarquable. On a trouvé le bon setup."`,
          `"On avait identifié les points faibles depuis les essais. On a corrigé. Ça s'est vu en course."`,
        ]);
        const middle = seasonPhase === 'début'
          ? `"En ${gpPhase}, chaque résultat construit quelque chose. Ce résultat confirme notre direction."`
          : seasonPhase === 'fin'
            ? `"En ${gpPhase}, une victoire vaut de l'or. ${endPressure}"`
            : `"Mi-saison, on fait le point. ${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. La tendance est bonne."`;
        const closer = `"${constrStr || 'L\'équipe mérite ce résultat.'} Prochain GP, même état d'esprit."`;
        return `${opener}\n${middle}\n${closer}${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
    ];
    const quote = pick(tones)();
    return `🎤 **${emoji} ${name} — P1, ${circuit}**\n${quote}`;
  }

  if (angle === 'podium' || angle === 'podium_champ') {
    const tones = [
      () => {
        const opener = pos === 2
          ? pick([
              `"P2, c'est bien — mais P1 était l'objectif. On manquait un peu de rythme en fin de course."`,
              `"Deuxième. La voiture était là, mais pas suffisamment pour inquiéter le leader."`,
            ])
          : pick([
              `"Un podium, c'est toujours une bonne journée. Surtout vu le ${gpPhase}."`,
              `"P3. On prend les points, on reste dans la course au championnat."`,
            ]);
        const middle = champPos && champPos <= 5
          ? `"On est ${champStr} avec ${pts} points. ${endPressure || 'Le championnat est ouvert.'}"`
          : `"${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. Un podium de plus dans la besace."`;
        return `${opener}\n${middle}${rivalStr ? '\n*Sur ' + rival + ' :* "' + rivalStr.replace(/^.*?"/, '"') : ''}`;
      },
      () => {
        const opener = champLeaderName && champPos && champPos <= 3
          ? pick([
              `"${champLeaderName} s'échappe un peu, mais rien n'est joué. ${endPressure || 'On reste là.'}"`,
              `"Le gap avec ${champLeaderName} n'est pas catastrophique. On va le chercher."`,
            ])
          : `"P${pos} aujourd'hui. ${styleStr} — notre voiture a bien répondu."`;
        const closer = constrStr || `"L'équipe a fait du bon travail ce week-end."`;
        return `${opener}\n"${closer}"${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
    ];
    return `🎤 **${emoji} ${name} — P${pos}, ${circuit}**\n${pick(tones)()}`;
  }

  if (angle === 'dnf_drama') {
    const dnfLabel = { CRASH:'l\'accident', MECHANICAL:'la panne mécanique', PUNCTURE:'la crevaison' }[dnfReason] || 'l\'abandon';
    const tones = [
      () => {
        const opener = pick([
          `"Je n'ai pas grand chose à dire sur ${dnfLabel}. Ces choses arrivent en course. Ça fait mal."`,
          `"On était bien placés. ${dnfLabel.charAt(0).toUpperCase() + dnfLabel.slice(1)} a tout gâché. C'est cruel."`,
          `"Ça fait partie du sport. Mais là, aujourd'hui, c'est dur à avaler."`,
        ]);
        const middle = champPos && champPos <= 6
          ? `"On était ${champStr}. Là on perd des points précieux. ${endPressure || 'Il faut rebondir.'}"` 
          : `"Il faut regarder devant. ${seasonPhase === 'fin' ? 'En fin de saison, chaque point perdu est difficile à récupérer.' : 'On a encore des courses pour se rattraper.'}"`;
        const closer = pick([
          `"Le week-end prochain, on revient. Plus fort."`,
          `"L'équipe ne méritait pas ça. On se relèvera."`,
          `"La course, c'est ça aussi. On encaisse et on repart."`,
        ]);
        return `${opener}\n${middle}\n"${closer}"`;
      },
    ];
    return `🎤 **${emoji} ${name} — ❌ DNF, ${circuit}**\n${pick(tones)()}`;
  }

  if (angle === 'champ_leader') {
    const tones = [
      () => {
        const opener = pos <= 10 && !dnf
          ? pick([
              `"P${pos} aujourd'hui. Pas parfait, mais on marque des points. C'est ça l'essentiel."`,
              `"Ce n'est pas le résultat voulu, mais on reste ${champStr}. La régularité, c'est notre force."`,
            ])
          : dnf
            ? `"Terrible journée. Mais on reste leaders. Ce n'est pas ce GP qui définit la saison."`
            : `"P${pos}. On a vécu mieux, mais la situation au général reste correcte."`;
        const closer = seasonPhase === 'fin'
          ? `"${endPressure} On garde la tête froide."`
          : `"En ${gpPhase}, on est ${champStr} avec ${pts} points. L'objectif reste le même."`;
        return `${opener}\n${closer}`;
      },
    ];
    return `🎤 **${emoji} ${name} — Leader du championnat (P${pos}), ${circuit}**\n${pick(tones)()}`;
  }

  return null;
}

// ─── MOTEUR DE NEWS — Tabloïd de paddock ─────────────────

const NEWS_SOURCES = {
  pitlane_insider  : { name: '🔥 PitLane Insider',    color: '#FF4444' },
  paddock_whispers : { name: '🤫 Paddock Whispers',   color: '#9B59B6' },
  pl_racing_news   : { name: '🗞️ PL Racing News',     color: '#2C3E50' },
  f1_weekly        : { name: '📡 F1 Weekly',          color: '#2980B9' },
};

// Publier un article dans le channel de course
async function publishNews(article, channel) {
  if (!channel) return;
  const src = NEWS_SOURCES[article.source];
  const embed = new EmbedBuilder()
    .setAuthor({ name: src.name })
    .setTitle(article.headline)
    .setColor(src.color)
    .setDescription(article.body)
    .setFooter({ text: `Saison ${article.seasonYear} · ${new Date(article.publishedAt).toLocaleDateString('fr-FR')}` });
  try { await channel.send({ embeds: [embed] }); } catch(e) { console.error('News publish error:', e); }
}

// ── Générateurs par type ──────────────────────────────────

function genRivalryArticle(pA, pB, teamA, teamB, contacts, circuit, seasonYear) {
  const sources = ['pitlane_insider', 'paddock_whispers'];
  const source  = pick(sources);

  const headlines = [
    `${pA.name} vs ${pB.name} : la guerre froide du paddock`,
    `Encore un accrochage — ${pA.name} et ${pB.name} au bord du clash`,
    `"Ça va finir mal" — la rivalité ${pA.name}/${pB.name} inquiète le paddock`,
    `${teamA.emoji}${pA.name} et ${teamB.emoji}${pB.name} : la tension monte d'un cran`,
    `La FIA surveille — ${contacts} incidents entre ${pA.name} et ${pB.name} cette saison`,
  ];

  const bodies = [
    `${contacts} contacts en course cette saison entre les deux pilotes — le dernier en date à ${circuit} n'a pas arrangé les choses.\n\n` +
    pick([
      `Selon nos sources, ${pA.name} aurait demandé à la direction de course d'examiner les manœuvres de ${pB.name}. "Il prend trop de risques", aurait-il déclaré en privé.`,
      `${pB.name} a refusé de commenter après la course. Ce silence en dit parfois plus long qu'un discours.`,
      `Dans les couloirs du paddock, on murmure que les deux camps ne se saluent plus. Ambiance.`,
    ]),

    `À ${circuit}, la ligne entre racing et provocation a une nouvelle fois été franchie.\n\n` +
    pick([
      `"C'était délibéré ou stupide — dans les deux cas c'est inacceptable." Une source proche de ${teamA.name} n'a pas mâché ses mots.`,
      `${pA.name} a regardé droit dans les yeux ${pB.name} lors de la pesée. Aucun mot échangé. Tout était dit.`,
      `La FIA a officiellement "pris note" de l'incident. En langage FIA, ça veut dire qu'ils regardent de très près.`,
    ]),

    `${pA.name} et ${pB.name} partagent la piste depuis le début de saison. ${contacts} contacts plus tard, on se demande comment ça n'a pas encore explosé.\n\n` +
    pick([
      `Les équipes ont tenté de calmer le jeu en interne. Sans succès apparent.`,
      `"Ils se respectent mais ne s'apprécient pas" — une formule qu'on entend souvent dans ce paddock.`,
      `Le prochain GP va être à surveiller de très près. L'un des deux va craquer.`,
    ]),
  ];

  return {
    type: 'rivalry', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pA._id, pB._id],
    teamIds: [teamA._id, teamB._id],
    seasonYear,
  };
}

function genTransferRumorArticle(pilot, currentTeam, targetTeam, seasonYear) {
  const source = pick(['paddock_whispers', 'pitlane_insider']);

  const headlines = [
    `${pilot.name} chez ${targetTeam.emoji}${targetTeam.name} ? La rumeur enfle`,
    `Transfert choc : ${targetTeam.name} viserait ${pilot.name}`,
    `${pilot.name} sur le départ ? ${targetTeam.name} aux aguets`,
    `"Des discussions ont eu lieu" — ${pilot.name} et ${targetTeam.name}, le feuilleton continue`,
    `Exclusif : ${pilot.name} aurait rencontré des dirigeants de ${targetTeam.name}`,
  ];

  const bodies = [
    `Selon nos informations, le nom de ${pilot.name} circule avec insistance dans l'entourage de ${targetTeam.emoji}${targetTeam.name}.\n\n` +
    pick([
      `Son équipe actuelle ${currentTeam?.emoji || ''}${currentTeam?.name || 'son écurie'} dément tout contact. Ce qui, dans ce milieu, veut souvent dire le contraire.`,
      `"Aucune approche n'a été faite." C'est ce qu'on nous a répondu — la formule classique qui n'engage à rien.`,
      `Les deux parties font profil bas. Mais les regards échangés dans le paddock parlent d'eux-mêmes.`,
    ]),

    `Un dîner discret. Des agents aperçus ensemble. Et soudain, le nom de ${pilot.name} revient dans toutes les conversations.\n\n` +
    pick([
      `${targetTeam.name} cherche à renforcer son line-up. ${pilot.name} coche beaucoup de cases.`,
      `La question n'est peut-être pas de savoir si c'est vrai — mais si ${currentTeam?.name || 'son écurie actuelle'} serait prête à le laisser partir.`,
      `Notre source : "Les discussions en sont à un stade très préliminaire. Mais elles existent."`,
    ]),

    `On ne prête qu'aux riches — et en ce moment, le nom de ${pilot.name} est sur toutes les lèvres.\n\n` +
    pick([
      `${targetTeam.emoji}${targetTeam.name} a les moyens de ses ambitions. ${pilot.name} a les ambitions de ses moyens. L'équation est simple.`,
      `Rien d'officiel. Mais dans ce paddock, "rien d'officiel" est souvent le début de quelque chose.`,
      `Paddock Whispers maintient ses informations. La balle est dans le camp des dirigeants.`,
    ]),
  ];

  return {
    type: 'transfer_rumor', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pilot._id],
    teamIds: [targetTeam._id, ...(currentTeam ? [currentTeam._id] : [])],
    seasonYear,
  };
}

function genDramaArticle(pilotA, pilotB, teamA, teamB, seasonYear, context = {}) {
  const source = pick(['pitlane_insider', 'paddock_whispers', 'pl_racing_news']);

  const dramaTypes = [
    // Clash verbal fictif
    () => ({
      headline: pick([
        `${pilotA.name} lâche une pique — ${pilotB.name} visé ?`,
        `Tension en conf de presse : ${pilotA.name} ne mâche pas ses mots`,
        `"Certains pilotes devraient regarder leurs propres erreurs" — ${pilotA.name}`,
      ]),
      body:
        `En conférence de presse, ${pilotA.name} n'a pas pu s'empêcher : ${pick([
          `"Il y a des pilotes sur cette grille qui oublient les règles de base du respect en course."`,
          `"Je préfère ne pas nommer qui, mais tout le monde sait de qui je parle."`,
          `"Mon ingénieur m'a demandé de rester calme. J'essaie."`,
        ])}\n\n` +
        pick([
          `Une pique à peine voilée vers ${teamB.emoji}${pilotB.name} ? L'intéressé n'a pas commenté — pour l'instant.`,
          `${pilotB.name}, interrogé dans la foulée, a souri. "Je n'ai rien à ajouter." Ambiance.`,
          `Le paddock a retenu son souffle. ${pilotB.name} a été prévenu de la déclaration — sa réaction sera à surveiller au prochain GP.`,
        ]),
    }),
    // Guerre des chiffres / ego
    () => ({
      headline: pick([
        `${pilotA.name} vs ${pilotB.name} : la bataille des egos`,
        `Qui est le meilleur ? ${pilotA.name} et ${pilotB.name} ne sont pas d'accord`,
        `${pilotA.name} : "Je mérite mieux que ça" — sous-entendu ?`,
      ]),
      body:
        `${pick([
          `${pilotA.name} estime ne pas être reconnu à sa juste valeur sur cette grille.`,
          `"Je ne suis pas là pour finir derrière ${pilotB.name}. Ce n'est pas mon niveau." Des mots forts.`,
          `Dans une interview accordée à nos confrères, ${pilotA.name} a laissé entendre que la hiérarchie actuelle ne reflétait pas la réalité des performances.`,
        ])}\n\n` +
        pick([
          `${teamB.emoji}${pilotB.name} a été informé de ces déclarations. "Qu'il vienne me le dire en piste" aurait-il répondu selon nos sources.`,
          `Le clan ${pilotB.name} reste serein. Les chiffres sont là — et pour l'instant, ils donnent raison à ${pilotB.name}.`,
          `Le paddock observe. Quand deux pilotes de ce niveau s'accrochent verbalement, ça finit toujours par se régler en piste.`,
        ]),
    }),
    // Drama ingénieur / équipe
    () => ({
      headline: pick([
        `Tensions en interne chez ${teamA.emoji}${teamA.name}`,
        `${pilotA.name} et son équipe sur la même longueur d'onde ? Pas si sûr`,
        `La stratégie fait débat — ${pilotA.name} mécontent ?`,
      ]),
      body:
        `${pick([
          `Selon une source proche du garage, ${pilotA.name} et son ingénieur de course traversent une période de "friction" depuis quelques GP.`,
          `Le choix stratégique du dernier GP n'aurait pas été du goût de ${pilotA.name}. En interne, des mots auraient été échangés.`,
          `"Il y a des désaccords normaux dans toute équipe. Mais là, c'est un peu plus que ça." Une source qui souhaite rester anonyme.`,
        ])}\n\n` +
        pick([
          `${teamA.name} dément toute tension. Classique.`,
          `${pilotA.name} a souri en conférence de presse. Un peu trop peut-être.`,
          `Reste à voir si ça se règle avant le prochain GP — ou si ça empire.`,
        ]),
    }),
  ];

  const chosen = pick(dramaTypes)();
  return {
    type: 'drama', source,
    headline: chosen.headline,
    body: chosen.body,
    pilotIds: [pilotA._id, pilotB._id],
    teamIds: [teamA._id, teamB._id],
    seasonYear,
  };
}

function genHypeArticle(pilot, team, wins, podiums, seasonYear, champPos) {
  const source = pick(['pitlane_insider', 'f1_weekly', 'pl_racing_news']);

  const headlines = [
    `${pilot.name} : et si c'était lui le grand nom de cette saison ?`,
    `La révélation ${team.emoji}${team.name} : ${pilot.name} crève l'écran`,
    `${pilot.name} en feu — le paddock commence à vraiment prendre note`,
    `"On n'attendait pas ça" — ${pilot.name} déjoue tous les pronostics`,
    `${wins > 1 ? wins + ' victoires' : podiums + ' podiums'} — ${pilot.name} n'est plus une surprise, c'est une menace`,
  ];

  const bodies = [
    `${pick([
      `Personne ne l'avait mis sur la liste des favoris en début de saison.`,
      `En début de saison, peu de monde aurait parié sur ${pilot.name} pour jouer ce rôle.`,
      `Les données de préparation de saison n'indiquaient pas ça. Et pourtant.`,
    ])} ${wins > 0 ? `${wins} victoire(s) et ${podiums} podium(s) plus tard` : `${podiums} podium(s) plus tard`}, ${pilot.name} impose le respect.\n\n` +
    pick([
      `"Il a quelque chose de différent dans l'approche des GP. Une maturité qu'on ne voit pas souvent." Une voix du paddock.`,
      `${team.emoji}${team.name} a clairement trouvé quelque chose. La question : est-ce durable ?`,
      `P${champPos} au championnat. Si ça continue, les grandes écuries vont s'intéresser à lui de près.`,
    ]),

    `On cherche souvent les grands noms. Parfois, les grands noms viennent nous chercher.\n\n` +
    `${pilot.name} est P${champPos} au championnat avec ${wins > 0 ? `${wins} victoire(s)` : `${podiums} podium(s)`} cette saison. ` +
    pick([
      `Son ingénieur est le premier à le dire : "Il repousse les limites à chaque sortie."`,
      `Les données télémétrie ne mentent pas — il pousse la voiture dans des zones que peu osent explorer.`,
      `Plusieurs membres du paddock ont discrètement demandé à en savoir plus sur lui. Signal fort.`,
    ]),
  ];

  return {
    type: 'hype', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pilot._id],
    teamIds: [team._id],
    seasonYear,
  };
}

function genFormCrisisArticle(pilot, team, dnfs, lastResults, seasonYear) {
  const source = pick(['pitlane_insider', 'pl_racing_news', 'paddock_whispers']);

  const headlines = [
    `${pilot.name} dans le dur — jusqu'où ?`,
    `La spirale ${pilot.name} : accident de parcours ou signal d'alarme ?`,
    `${team.emoji}${team.name} commence à s'interroger sur ${pilot.name}`,
    `"Il faut que ça change" — ${pilot.name} sous pression`,
    `${dnfs} abandons — ${pilot.name} traverse sa pire période`,
  ];

  const bodies = [
    `${dnfs} abandons ${lastResults ? `et des résultats en dessous des attentes` : ''} — la série noire de ${pilot.name} commence à faire parler.\n\n` +
    pick([
      `En interne, on reste solidaire officiellement. Mais les questions existent.`,
      `"Tout le monde traverse des creux. La différence c'est comment tu en sors." Message reçu ?`,
      `${pilot.name} s'est entraîné en simulateur pendant 6 heures hier soir. La réponse sera en piste.`,
    ]),

    `Il y a quelques GP, ${pilot.name} semblait intouchable. Aujourd'hui, chaque course apporte son lot de mauvaises nouvelles.\n\n` +
    pick([
      `La pression commence à se faire sentir. ${team.emoji}${team.name} a des attentes — et pour l'instant, elles ne sont pas remplies.`,
      `Selon une source interne : "On ne remet pas en question le pilote. On remet en question la dynamique actuelle."`,
      `Des rumeurs de changement d'ingénieur de course ont commencé à circuler. Rien de confirmé.`,
    ]),
  ];

  return {
    type: 'form_crisis', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pilot._id],
    teamIds: [team._id],
    seasonYear,
  };
}

function genTeammateDuelArticle(winner, loser, teamObj, winsW, winsL, seasonYear) {
  const source = pick(['f1_weekly', 'pl_racing_news', 'pitlane_insider']);

  const headlines = [
    `${winner.name} écrase ${loser.name} en interne — le statut N°1 ne fait plus débat`,
    `Duel interne ${teamObj.emoji}${teamObj.name} : ${winner.name} prend le dessus`,
    `${loser.name} dans l'ombre de ${winner.name} — la situation devient inconfortable`,
    `${winsW}–${winsL} : les chiffres parlent pour ${winner.name}`,
  ];

  const bodies = [
    `${winsW}–${winsL} en duels directs cette saison. Les chiffres sont implacables : ${winner.name} domine ${loser.name} chez ${teamObj.emoji}${teamObj.name}.\n\n` +
    pick([
      `${loser.name} ne cache pas son inconfort : "Je sais ce que je dois améliorer. Je travaille."`,
      `L'écurie continue d'afficher une égalité de traitement officielle. Mais dans les faits, la hiérarchie est claire.`,
      `"La voiture numéro 1 a commencé à recevoir les mises à jour en priorité." Officiellement démenti, bien sûr.`,
    ]),

    `En début de saison, on parlait d'un duo équilibré chez ${teamObj.emoji}${teamObj.name}. Plusieurs GP plus tard, le tableau est différent.\n\n` +
    `${winner.name} finit devant son coéquipier ${winsW} fois sur ${winsW + winsL} — ` +
    pick([
      `une domination que même les plus grands supporters de ${loser.name} ont du mal à relativiser.`,
      `la tendance semble s'installer. La question : ${loser.name} va-t-il accepter ce rôle ?`,
      `${loser.name} a demandé une réunion technique en interne. Pas de résultat pour l'instant.`,
    ]),
  ];

  return {
    type: 'teammate_duel', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [winner._id, loser._id],
    teamIds: [teamObj._id],
    seasonYear,
  };
}

function genScandalArticle(teams, pilots, seasonYear) {
  const teamA = pick(teams), teamB = pick(teams.filter(t => String(t._id) !== String(teamA._id)));
  if (!teamB) return null;
  const source = pick(['paddock_whispers', 'pitlane_insider']);

  const scandals = [
    {
      headline: `${teamA.emoji}${teamA.name} accusée de copie — l'enquête FIA ouverte`,
      body:
        `Une plainte formelle aurait été déposée par ${teamB.emoji}${teamB.name} contre ${teamA.emoji}${teamA.name} concernant une supposée "similarité suspecte" dans la conception de l'aileron avant.\n\n` +
        pick([
          `La FIA a confirmé avoir "pris note de la requête". Traduction : enquête préliminaire ouverte.`,
          `${teamA.name} nie catégoriquement. "Nos conceptions sont le fruit d'un travail indépendant." Classique.`,
          `Si la plainte aboutit, des points pourraient être retirés rétroactivement. Le paddock retient son souffle.`,
        ]),
    },
    {
      headline: `Carburant illégal ? Les rumeurs autour de ${teamA.emoji}${teamA.name}`,
      body:
        `Des mesures de telémétrie inhabituelles auraient attiré l'attention des commissaires lors du dernier GP.\n\n` +
        pick([
          `${teamA.name} parle d'"anomalie de capteur". D'autres parlent d'autre chose.`,
          `La FIA n'a pas encore officiellement communiqué. Mais les prélèvements ont bien eu lieu.`,
          `Si les tests s'avèrent positifs, on parlerait d'une disqualification rétroactive. Énorme.`,
        ]),
    },
    {
      headline: `Budget cap : ${teamA.emoji}${teamA.name} dans le viseur ?`,
      body:
        `Des questions commencent à se poser sur les dépenses de ${teamA.emoji}${teamA.name} cette saison.\n\n` +
        pick([
          `Plusieurs équipes auraient soulevé la question lors d'une réunion de la commission F1 PL. Sans résultat pour l'instant.`,
          `"On respecte toutes les règles financières à la lettre." Le communiqué de ${teamA.name} est arrivé vite. Trop vite ?`,
          `Si une infraction est confirmée, les sanctions vont de l'amende à la déduction de points constructeurs.`,
        ]),
    },
  ];

  const chosen = pick(scandals);
  return {
    type: 'scandal', source,
    headline: chosen.headline,
    body: chosen.body,
    pilotIds: [],
    teamIds: [teamA._id, teamB._id],
    seasonYear,
  };
}

function genDevVagueArticle(team, seasonYear) {
  const source = pick(['f1_weekly', 'pl_racing_news']);

  const headlines = [
    `${team.emoji}${team.name} apporte des modifications discrètes — les chronos intriguent`,
    `Développement silencieux chez ${team.emoji}${team.name} : quelque chose se prépare`,
    `${team.name} : "On travaille" — mais sur quoi exactement ?`,
    `Les essais libres de ${team.emoji}${team.name} ont fait hausser des sourcils`,
  ];

  const bodies = [
    `Rien d'officiel — ${team.name} n'a communiqué sur aucune mise à jour majeure. Mais les observateurs attentifs ont noté des changements de configuration ce week-end.\n\n` +
    pick([
      `Les temps en essais libres suggèrent un gain en vitesse de pointe. Léger, mais réel.`,
      `"On affine des détails aérodynamiques." C'est tout ce que le directeur technique a consenti à dire.`,
      `Si ces gains se confirment en course, le rapport de force pourrait légèrement évoluer.`,
    ]),

    `${team.emoji}${team.name} a travaillé fort en usine ces dernières semaines. Les premiers signes arrivent en piste.\n\n` +
    pick([
      `Pas de révolution — mais une évolution cohérente qui pourrait faire la différence sur les prochains circuits.`,
      `Les ingénieurs rivaux ont été vus observer attentivement la voiture au parc fermé. Signe que quelque chose a changé.`,
      `"On ne commente pas le travail des autres." La réponse de ${pick(teams => team.name)} masque peut-être une certaine inquiétude.`,
    ]),
  ];

  return {
    type: 'dev_vague', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [],
    teamIds: [team._id],
    seasonYear,
  };
}

function genTitleFightArticle(leader, challenger, leaderTeam, challengerTeam, gap, gpLeft, seasonYear) {
  const source = pick(['f1_weekly', 'pl_racing_news', 'pitlane_insider']);

  const headlines = [
    `${gap} points — le titre se joue maintenant`,
    `${leader.name} vs ${challenger.name} : le duel pour l'histoire`,
    `${gpLeft} GPs restants — tout est encore possible`,
    `La pression monte : ${challenger.name} n'a plus le droit à l'erreur`,
    `${leader.name} tient les rênes — mais ${challenger.name} n'abdique pas`,
  ];

  const bodies = [
    `${gap} points séparent ${leaderTeam.emoji}${leader.name} de ${challengerTeam.emoji}${challenger.name} à ${gpLeft} GP(s) de la fin.\n\n` +
    pick([
      `La mathématique est cruelle : ${challenger.name} doit gagner et espérer. ${leader.name} doit gérer et ne pas craquer.`,
      `"Je ne regarde pas le classement. Je cours pour gagner chaque GP." ${leader.name} a dit ça. Personne ne le croit vraiment.`,
      `Deux styles opposés, deux approches opposées. Ce championnat ressemble à un test de caractère autant que de vitesse.`,
    ]),

    `Le titre ne se gagne pas — il se perd. Et les deux protagonistes le savent.\n\n` +
    `${leaderTeam.emoji}${leader.name} en tête avec ${gap} points d'avance. ` +
    pick([
      `Confortable sur le papier. Pas si confortable dans la tête d'un pilote qui a tout à perdre.`,
      `${challengerTeam.emoji}${challenger.name} a gagné les 2 derniers GP. La dynamique a changé — et tout le monde l'a senti.`,
      `Les prochains circuits favorisent qui ? Les deux camps analysent. Le suspense est total.`,
    ]),
  ];

  return {
    type: 'title_fight', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [leader._id, challenger._id],
    teamIds: [leaderTeam._id, challengerTeam._id],
    seasonYear,
  };
}

// ── Orchestrateur post-GP ─────────────────────────────────
async function generatePostRaceNews(race, finalResults, season, channel) {
  const allPilots  = await Pilot.find({ teamId: { $ne: null } });
  const allTeams   = await Team.find();
  const standings  = await Standing.find({ seasonId: season._id }).sort({ points: -1 });
  const totalRaces = await Race.countDocuments({ seasonId: season._id });
  const doneRaces  = await Race.countDocuments({ seasonId: season._id, status: 'done' });
  const gpLeft     = totalRaces - doneRaces;

  // ── Phase de saison ────────────────────────────────────────
  const progress = totalRaces > 0 ? doneRaces / totalRaces : 0;
  const isEarly  = progress < 0.25;
  const isMid    = progress >= 0.25 && progress < 0.6;
  const isLate   = progress >= 0.6  && progress < 0.85;
  const isFinale = progress >= 0.85;

  const pilotMap = new Map(allPilots.map(p => [String(p._id), p]));
  const teamMap  = new Map(allTeams.map(t => [String(t._id), t]));
  const articlesToPost = [];

  // 1. RIVALITÉ — impossible début, rare milieu, fréquent fin
  const rivalChance = isEarly ? 0 : isMid ? 0.4 : isLate ? 0.75 : 0.9;
  if (Math.random() < rivalChance) {
    const rivalPairs = new Map();
    for (const p of allPilots) {
      if (!p.rivalId) continue;
      const key = [String(p._id), String(p.rivalId)].sort().join('_');
      if (!rivalPairs.has(key)) {
        const pB = pilotMap.get(String(p.rivalId));
        const minContacts = isEarly ? 3 : isMid ? 2 : 1;
        if (pB && p.rivalContacts >= minContacts) rivalPairs.set(key, { pA: p, pB });
      }
    }
    for (const { pA, pB } of rivalPairs.values()) {
      const tA = teamMap.get(String(pA.teamId));
      const tB = teamMap.get(String(pB.teamId));
      if (tA && tB) articlesToPost.push(genRivalryArticle(pA, pB, tA, tB, pA.rivalContacts, race.circuit, season.year));
    }
  }

  // 2. TITLE FIGHT — seulement mi-saison+
  const titleChance = isEarly ? 0 : isMid ? 0.3 : isLate ? 0.7 : 1.0;
  if (standings.length >= 2 && gpLeft > 1 && Math.random() < titleChance) {
    const s1 = standings[0], s2 = standings[1];
    const gap = s1.points - s2.points;
    const maxGap = isFinale ? 50 : isLate ? 35 : 25;
    if (gap <= maxGap && gap >= 0) {
      const p1 = pilotMap.get(String(s1.pilotId));
      const p2 = pilotMap.get(String(s2.pilotId));
      const t1 = p1 ? teamMap.get(String(p1.teamId)) : null;
      const t2 = p2 ? teamMap.get(String(p2.teamId)) : null;
      if (p1 && p2 && t1 && t2) articlesToPost.push(genTitleFightArticle(p1, p2, t1, t2, gap, gpLeft, season.year));
    }
  }

  // 3. HYPE — surtout début/milieu
  const hypeChance = isEarly ? 0.6 : isMid ? 0.45 : isLate ? 0.25 : 0.15;
  for (let i = 0; i < Math.min(standings.length, 5); i++) {
    const s = standings[i];
    const pilot = pilotMap.get(String(s.pilotId));
    const team  = pilot ? teamMap.get(String(pilot.teamId)) : null;
    if (pilot && team && (s.wins >= (isEarly ? 1 : 2) || s.podiums >= (isEarly ? 2 : 4)) && Math.random() < hypeChance) {
      articlesToPost.push(genHypeArticle(pilot, team, s.wins, s.podiums, season.year, i + 1));
      break;
    }
  }

  // 4. CRISE DE FORME
  const crisisChance = isEarly ? 0.2 : isMid ? 0.35 : isLate ? 0.45 : 0.5;
  for (const s of standings.slice(Math.floor(standings.length / 2))) {
    const pilot = pilotMap.get(String(s.pilotId));
    const team  = pilot ? teamMap.get(String(pilot.teamId)) : null;
    if (pilot && team && s.dnfs >= (isEarly ? 1 : 2) && Math.random() < crisisChance) {
      articlesToPost.push(genFormCrisisArticle(pilot, team, s.dnfs, null, season.year));
      break;
    }
  }

  // 5. DUEL COÉQUIPIER — seulement mi-saison+
  if (!isEarly) {
    const duelChance = isMid ? 0.25 : isLate ? 0.4 : 0.5;
    const duelGapMin = isMid ? 4 : 3;
    const processed = new Set();
    for (const p of allPilots) {
      const tid = String(p.teamId);
      if (processed.has(tid)) continue;
      const teammates = allPilots.filter(x => String(x.teamId) === tid);
      if (teammates.length < 2) continue;
      processed.add(tid);
      const [a, b] = teammates;
      const wA = a.teammateDuelWins || 0, wB = b.teammateDuelWins || 0;
      if (Math.abs(wA - wB) >= duelGapMin && Math.random() < duelChance) {
        const team = teamMap.get(tid);
        if (!team) continue;
        const winner = wA > wB ? a : b, loser = wA > wB ? b : a;
        articlesToPost.push(genTeammateDuelArticle(winner, loser, team, Math.max(wA, wB), Math.min(wA, wB), season.year));
      }
    }
  }

  const toPost = articlesToPost.slice(0, 3);
  for (const articleData of toPost) {
    const article = await NewsArticle.create({ ...articleData, raceId: race._id, triggered: 'post_race', publishedAt: new Date() });
    await sleep(3000);
    await publishNews(article, channel);
  }
}

async function runScheduledNews(discordClient) {
  const channel = RACE_CHANNEL ? discordClient.channels.cache.get(RACE_CHANNEL) : null;
  if (!channel) return;

  const season = await getActiveSeason();
  if (!season) return;

  const allPilots = await Pilot.find({ teamId: { $ne: null } });
  const allTeams  = await Team.find();
  if (!allPilots.length || !allTeams.length) return;

  const teamMap = new Map(allTeams.map(t => [String(t._id), t]));

  const totalRaces = await Race.countDocuments({ seasonId: season._id });
  const doneRaces  = await Race.countDocuments({ seasonId: season._id, status: 'done' });
  const progress   = totalRaces > 0 ? doneRaces / totalRaces : 0;
  const isEarly    = progress < 0.25;
  const isMid      = progress >= 0.25 && progress < 0.6;
  const isLate     = progress >= 0.6  && progress < 0.85;
  const isFinale   = progress >= 0.85;

  // Début : dev_vague(40%) drama(40%) scandal(15%) rumeur(5%)
  // Milieu : drama(30%) dev_vague(25%) rumeur(25%) scandal(20%)
  // Fin    : rumeur(40%) drama(25%) scandal(20%) dev_vague(15%)
  // Finale : rumeur(55%) scandal(25%) drama(15%) dev_vague(5%)
  let weights;
  if (isEarly)     weights = { drama: 40, dev_vague: 40, scandal: 15, transfer_rumor: 5  };
  else if (isMid)  weights = { drama: 30, dev_vague: 25, transfer_rumor: 25, scandal: 20 };
  else if (isLate) weights = { transfer_rumor: 40, drama: 25, scandal: 20, dev_vague: 15 };
  else             weights = { transfer_rumor: 55, scandal: 25, drama: 15, dev_vague: 5  };

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  let chosen = 'drama';
  for (const [type, w] of Object.entries(weights)) { roll -= w; if (roll <= 0) { chosen = type; break; } }

  let articleData = null;
  if (chosen === 'drama') {
    const pA = pick(allPilots);
    const others = allPilots.filter(p => String(p.teamId) !== String(pA.teamId));
    const pB = others.length ? pick(others) : null;
    if (pB) {
      const tA = teamMap.get(String(pA.teamId)), tB = teamMap.get(String(pB.teamId));
      if (tA && tB) articleData = genDramaArticle(pA, pB, tA, tB, season.year);
    }
  } else if (chosen === 'transfer_rumor') {
    const pilot = pick(allPilots);
    const currentTeam = teamMap.get(String(pilot.teamId));
    const otherTeams  = allTeams.filter(t => String(t._id) !== String(pilot.teamId));
    const targetTeam  = otherTeams.length ? pick(otherTeams) : null;
    if (targetTeam) articleData = genTransferRumorArticle(pilot, currentTeam, targetTeam, season.year);
  } else if (chosen === 'dev_vague') {
    articleData = genDevVagueArticle(pick(allTeams), season.year);
  } else if (chosen === 'scandal') {
    if (allTeams.length >= 2) articleData = genScandalArticle(allTeams, allPilots, season.year);
  }

  if (articleData) {
    const article = await NewsArticle.create({ ...articleData, triggered: 'scheduled', publishedAt: new Date() });
    await publishNews(article, channel);
  }
}


// ─── SIMULATION COURSE COMPLÈTE ───────────────────────────
async function simulateRace(race, grid, pilots, teams, contracts, channel, season) {
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
      // Écart initial réaliste : ~1.2s par position (P20 est à ~22s du leader)
      // Correspond à la réalité F1 où le peloton s'étire progressivement après le départ
      totalTime       : idx * 2000, // 2s entre positions au départ — réaliste
      tireCompound    : startCompound,
      tireWear        : 0,
      tireAge         : 0,
      usedCompounds   : [startCompound],
      pitStops        : 0,
      pittedThisLap   : false,
      dnf             : false,
      dnfLap          : null,
      dnfReason       : '',
      fastestLap      : Infinity,
      warmupLapsLeft  : 0,      // tours de chauffe pneus post-pit
      catchUpDebt     : 0,      // retard cumulatif à rattraper
      pitStrategy     : null,   // 'one_stop' | 'two_stop'
      stratPitsDone   : 0,
      overcutMode     : false,
      trafficLapsLeft : 0,      // tours bloqué en trafic post-pit
      defendExtraWear : 0,      // usure extra par défense agressive
      pendingRepair   : null,   // 'aileron' | 'suspension'
      drsActive       : false,
    };
  }).filter(Boolean);

  // ── Stratégies de course (1 ou 2 arrêts) ──────────────────
  const twoStopBias = gpStyle === 'rapide' ? 0.6 : gpStyle === 'endurance' ? 0.7 : 0.4;
  for (const d of drivers) {
    if (!d) continue;
    const tireAgression = (100 - d.pilot.gestionPneus) / 100;
    const stratRoll = Math.random() + tireAgression * 0.2 - (d.team.conservationPneus - 70) / 70 * 0.15;
    d.pitStrategy = stratRoll > (1 - twoStopBias) ? 'two_stop' : 'one_stop';
  }

  let scState          = { state: 'NONE', lapsLeft: 0 };
  let scCooldown       = 0;
  let fastestLapMs     = Infinity;
  let fastestLapHolder = null;
  let prevFastestHolder = null; // pour détecter nouveau meilleur tour
  const existingCircuitRecord = await CircuitRecord.findOne({ circuit: race.circuit });
  const raceCollisions = [];
  const battleMap      = new Map();
  const undercutTracker = new Map(); // pilotId → { pitLap, pilotAheadPos }
  const overcutTracker  = new Map(); // pilotId → { startLap, rivalId, myPosAtStart }

  const send = async (msg) => {
    if (!channel) return;
    if (msg.length > 1950) msg = msg.slice(0, 1947) + '…';
    try { await channel.send(msg); } catch(e) { console.error('send error:', e.message); }
    await sleep(9000);
  };

  const sendEmbed = async (embed) => {
    if (!channel) return;
    try { await channel.send({ embeds: [embed] }); } catch(e) {}
    await sleep(9000);
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
  const startGif = pickGif('race_start');
  if (startGif && channel) { try { await channel.send(startGif); } catch(e) {} await sleep(2000); }

  // ══════════════════════════════════════════════════════════
  // BOUCLE PRINCIPALE
  // ══════════════════════════════════════════════════════════
  // Stocker la référence abort dans un Map global pour que /admin_stop_race puisse l'invoquer
  if (!global.activeRaces) global.activeRaces = new Map();
  let raceAborted = false;
  const raceKey = String(race._id);
  global.activeRaces.set(raceKey, { abort: () => { raceAborted = true; } });

  for (let lap = 1; lap <= totalLaps; lap++) {
    if (raceAborted) {
      if (channel) await channel.send('🛑 **COURSE ARRÊTÉE PAR UN ADMINISTRATEUR.** Les résultats actuels ne seront pas comptabilisés.');
      break;
    }
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
            const needWet = (weather === 'WET' || weather === 'INTER') && ['SOFT','MEDIUM','HARD'].includes(d.tireCompound);
            const needDry = (weather === 'DRY' || weather === 'HOT')   && ['WET','INTER'].includes(d.tireCompound);
            if (!needWet && !needDry) continue;
            // Adaptabilité : pilotes réactifs pittent vite, les autres tardent
            const adapt = d.pilot.adaptabilite || 50;
            if (adapt >= 75) {
              d.tireWear = Math.max(d.tireWear, 38); // réagit immédiatement
            } else if (adapt >= 50) {
              d.tireWear = Math.max(d.tireWear, 28); // réaction tardive — perd du temps
              d.catchUpDebt = (d.catchUpDebt || 0) + 2000;
            } else {
              d.tireWear = Math.max(d.tireWear, 18); // reste trop longtemps dehors
              d.catchUpDebt = (d.catchUpDebt || 0) + 5000;
              if (d.pos <= 10 && Math.random() < 0.5) {
                events.push({ priority: 5, text:
                  `⚠️ **T${lap}** — ${d.team.emoji}**${d.pilot.name}** (P${d.pos}) tarde à réagir au changement de météo ! *Pneus inadaptés — l'équipe hésite.*`
                });
              }
            }
          }
        }
      }
    }

    const events    = []; // { priority, text }
    const lapDnfs   = []; // DNFs survenus CE tour — pour expliquer le SC
    const lapIncidents = []; // incidents ce tour pour SC logic

    // Snapshot des positions avant ce tour
    alive.forEach(d => { d.lastPos = d.pos; });

    // ── Snapshot des temps AVANT calcul du tour ──────────────
    // Clé = String(pilot._id), valeur = totalTime avant ce tour
    const preLapTimes = new Map(alive.map(d => [String(d.pilot._id), d.totalTime]));

    // ── Tour 1 : bagarre au départ ──────────────────────────
    if (lap === 1) {
      const startSwaps = [];
      // Tracker les gains de chaque pilote pour éviter les remontées irréalistes
      const gainMap = new Map(drivers.map(d => [String(d.pilot._id), 0]));

      for (let i = drivers.length - 1; i > 0; i--) {
        const d     = drivers[i];
        const ahead = drivers[i - 1];
        if (!d || !ahead) continue;
        // Un pilote ne peut pas gagner plus de 2 positions au départ (réaliste F1)
        if ((gainMap.get(String(d.pilot._id)) || 0) >= 2) continue;
        const reactDiff = d.pilot.reactions - ahead.pilot.reactions;
        if (reactDiff > 12 && Math.random() > 0.52) {
          // Swap positions ET totalTime pour que le tri par temps reste cohérent
          const tmpTime = d.totalTime;
          d.totalTime     = ahead.totalTime;
          ahead.totalTime = tmpTime;
          [drivers[i], drivers[i - 1]] = [drivers[i - 1], drivers[i]];
          drivers[i - 1].pos = i;
          drivers[i].pos     = i + 1;
          gainMap.set(String(drivers[i - 1].pilot._id), (gainMap.get(String(drivers[i - 1].pilot._id)) || 0) + 1);
          startSwaps.push(`${drivers[i-1].team.emoji}**${drivers[i-1].pilot.name}** P${i+1}→**P${i}** dépasse ${drivers[i].team.emoji}**${drivers[i].pilot.name}**`);
        }
      }
      // Recalcul propre des positions selon totalTime final
      drivers.sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
      alive.forEach(d => { d.lastPos = d.pos; });
      const startLeader = drivers.find(d => d.pos === 1) || drivers[0];
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
        const oneStoppers = drivers.filter(d => d.pitStrategy === 'one_stop').length;
        const twoStoppers = drivers.filter(d => d.pitStrategy === 'two_stop').length;
        const stratNote = `
📋 *Stratégies : **${oneStoppers}** pilote(s) sur 1 arrêt · **${twoStoppers}** pilote(s) sur 2 arrêts*`;
        events.push({ priority: 9, text: pick(cleanFlavors) + stratNote });
      }
    }

    // ── Tour final ──────────────────────────────────────────
    if (lap === totalLaps) {
      const leaderFinal  = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime)[0];
      const secondFinal  = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime)[1];
      if (leaderFinal) {
        const gapFinal = secondFinal ? (secondFinal.totalTime - leaderFinal.totalTime) / 1000 : 999;
        const finalFlavors = gapFinal < 1 ? [
          `***🏁 DERNIER TOUR !!! ${leaderFinal.team.emoji}${leaderFinal.pilot.name} EN TÊTE — MAIS ${secondFinal?.team.emoji}${secondFinal?.pilot.name} EST À ${gapFinal.toFixed(3)}s !!! TOUT PEUT ENCORE BASCULER !!!***`,
          `***⚡ LAST LAP !!! ${leaderFinal.team.emoji}${leaderFinal.pilot.name} devant — ${secondFinal?.team.emoji}${secondFinal?.pilot.name} dans son DRS !!! C'EST INSENSÉ !!!***`,
        ] : gapFinal < 5 ? [
          `***🏁 DERNIER TOUR !*** ${leaderFinal.team.emoji}**${leaderFinal.pilot.name}** en tête — **+${gapFinal.toFixed(1)}s** sur ${secondFinal?.team.emoji}**${secondFinal?.pilot.name}**... Serré. Il faut tenir !`,
          `🏁 **LAST LAP !** ${leaderFinal.team.emoji}**${leaderFinal.pilot.name}** à quelques kilomètres de la victoire — mais ${secondFinal?.team.emoji}**${secondFinal?.pilot.name}** n'a pas dit son dernier mot !`,
        ] : [
          `🏁 **DERNIER TOUR !** ${leaderFinal.team.emoji} **${leaderFinal.pilot.name}** en tête — le public est debout, les écuries retiennent leur souffle !`,
          `🏁 **TOUR ${totalLaps} — LE DERNIER !** ${leaderFinal.team.emoji} **${leaderFinal.pilot.name}** à quelques kilomètres d'une victoire méritée !`,
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
          // Tracker rivalité : mémoriser la paire de pilotes impliqués
          raceCollisions.push({ attackerId: String(driver.pilot._id), victimId: String(nearest.pilot._id) });

          if (victimDnf) {
            nearest.dnf       = true;
            nearest.dnfLap    = lap;
            nearest.dnfReason = 'CRASH';
            lapDnfs.push({ driver: nearest, reason: 'CRASH' });
            lapIncidents.push({ type: 'CRASH' });
            incidentText = collisionDescription(driver, nearest, lap, true, true, 0);
          } else {
            nearest.totalTime += damage;
            nearest.catchUpDebt = (nearest.catchUpDebt || 0) + damage;
            // 30% : les dégâts forcent un pit d'urgence
            const forcedPit = Math.random() < 0.30 && (nearest.pitStops || 0) < 3 && lapsRemaining > 6;
            if (forcedPit) {
              const dmgType = Math.random() < 0.5 ? 'aileron' : 'suspension';
              nearest.pendingRepair = dmgType;
              nearest.tireWear = 40;
              nearest.tireAge  = 99;
              const dmgLabel = dmgType === 'aileron' ? 'aileron avant endommagé' : 'suspension touchée';
              incidentText = collisionDescription(driver, nearest, lap, true, false, damage) +
                `
  🔧 *${dmgLabel} — ${nearest.pilot.name} doit rentrer en urgence !*`;
            } else {
              incidentText = collisionDescription(driver, nearest, lap, true, false, damage);
            }
          }
          if (incidentText) events.push({ priority: 10, text: incidentText, gif: pickGif('crash_collision') });
        } else {
          // Crash solo
          driver.dnf       = true;
          driver.dnfLap    = lap;
          driver.dnfReason = 'CRASH';
          lapDnfs.push({ driver, reason: 'CRASH' });
          lapIncidents.push({ type: 'CRASH' });
          incidentText = crashSoloDescription(driver, lap, gpStyle);
          if (incidentText) events.push({ priority: 10, text: incidentText, gif: pickGif('crash_solo') });
        }

      } else if (incident.type === 'MECHANICAL') {
        driver.dnf       = true;
        driver.dnfLap    = lap;
        driver.dnfReason = 'MECHANICAL';
        lapDnfs.push({ driver, reason: 'MECHANICAL' });
        lapIncidents.push({ type: 'MECHANICAL' }); // pas de SC pour mécanique
        const pos     = driver.pos;
        const isTop3m = pos <= 3;
        const isTop8m = pos <= 8;
        const nm      = `${driver.team.emoji}**${driver.pilot.name}**`;
        const mechFlavors = isTop3m ? [
          `***🔥 PANNE MÉCANIQUE !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} — P${pos} — DNF !!!***\n  › La fumée envahit l'habitacle depuis ***P${pos}*** — la radio crache : *"Rentre au garage."* ***Une course magnifique réduite à néant.*** ❌`,
          `***💨 LE MOTEUR DE ${driver.team.emoji}${driver.pilot.name.toUpperCase()} LÂCHE !!! P${pos} !!!***\n  › Il ralentit, ralentit... et s'arrête. ***L'écurie est sous le choc. Le Grand Prix lui échappe de la pire des façons.*** ❌`,
          `***⚙️ CATASTROPHE MÉCANIQUE !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} ABANDONNE !!!***\n  › ***P${pos}*** — solide, rapide — et voilà que la mécanique trahit tout. ***CRUEL.*** ❌`,
        ] : isTop8m ? [
          `🔥 **T${lap} — ABANDON MÉCANIQUE** pour ${nm} (P${pos}) — fumée, le muret dit *"box"*. Dommage, il était bien placé. ❌ **DNF.**`,
          `⚙️ **T${lap}** — Problème technique sévère pour ${nm} (P${pos}) — c'est terminé pour lui. ❌ **DNF.**`,
        ] : [
          `🔩 **T${lap}** — ${nm} (P${pos}) se range sur le bas-côté, fumée blanche. L'équipe le rappelle. ❌ **DNF mécanique.**`,
          `💨 **T${lap}** — Le moteur de ${nm} (P${pos}) rend l'âme dans une ligne droite. ❌ **DNF.**`,
          `⚙️ **T${lap}** — Problème de transmission pour ${nm} (P${pos}) — il ne passe plus les vitesses. ❌ **DNF.**`,
        ];
        incidentText = pick(mechFlavors);
        if (incidentText) events.push({ priority: 10, text: incidentText, gif: pickGif('mechanical') });

      } else if (incident.type === 'PUNCTURE') {
        const canRecover = lapsRemaining > 5 && (driver.pitStops || 0) < 3 && Math.random() < 0.40;
        lapIncidents.push({ type: 'PUNCTURE' });
        const posp    = driver.pos;
        const isTop3p = posp <= 3;
        const isTop8p = posp <= 8;
        const np      = `${driver.team.emoji}**${driver.pilot.name}**`;

        if (canRecover) {
          // Pit d'urgence : pneu à changer + temps perdu considérable
          driver.pendingRepair = 'puncture_repair';
          driver.tireWear = 99;
          driver.tireAge  = 99;
          driver.totalTime += randInt(8000, 15000); // pénalité avant de rentrer
          incidentText = isTop3p ? [
            `***🫧 CREVAISON !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} — P${posp} !!!***\n  › Le pneu explose — il rentre en urgence sur la jante. ***Course compromise mais pas terminée !*** 🔧`,
          ][0] : `🫧 **T${lap} — CREVAISON !** ${np} (P${posp}) — pneu à plat, rentre en urgence aux stands ! *Énorme perte de temps.*`;
        } else {
          driver.dnf       = true;
          driver.dnfLap    = lap;
          driver.dnfReason = 'PUNCTURE';
          lapDnfs.push({ driver, reason: 'PUNCTURE' });
          const puncFlavors = isTop3p ? [
            `***🫧 CREVAISON !!! ${driver.team.emoji}${driver.pilot.name.toUpperCase()} — P${posp} — DNF !!!***\n  › Le pneu explose à haute vitesse — la voiture devient incontrôlable depuis ***P${posp}***. Il rentre sur la jante, impuissant. ***Tout s'effondre en une fraction de seconde.*** ❌`,
            `***💥 NON !!! CREVAISON POUR ${driver.team.emoji}${driver.pilot.name.toUpperCase()} !!!***\n  › ***P${posp}*** — et un pneu explose. ***La course lui est volée par la malchance pure.*** ❌ **DNF.**`,
          ] : isTop8p ? [
            `🫧 **T${lap} — CREVAISON !** ${np} (P${posp}) perd un pneu à pleine vitesse — il rentre sur la jante. Impossible de continuer. ❌ **DNF.**`,
            `💥 **T${lap}** — Explosion de pneu pour ${np} (P${posp}) — la voiture part en travers. ❌ **DNF.**`,
          ] : [
            `🫧 **T${lap}** — Crevaison pour ${np} (P${posp}), il rentre sur la jante. ❌ **DNF.**`,
            `🫧 **T${lap}** — Délamination sur la voiture de ${np} (P${posp}) — c'est fini. ❌ **DNF.**`,
          ];
          incidentText = pick(puncFlavors);
        }
        if (incidentText) events.push({ priority: 10, text: incidentText, gif: pickGif('puncture') });
      }

      // (le push générique est maintenant fait dans chaque branche ci-dessus)
    }

    // ── Safety Car (APRÈS les incidents — on peut citer la cause) ──
    const prevScState = scState.state;
    scState = resolveSafetyCar(scState, lapIncidents);
    const scActive = scState.state !== 'NONE';

    // ── Bunching SC : au DÉCLENCHEMENT, resserrer les écarts ──
    if (scState.state !== 'NONE' && prevScState === 'NONE') {
      const aliveSC = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      if (aliveSC.length > 1) {
        const leaderTime = aliveSC[0].totalTime;
        if (scState.state === 'SC') {
          // SC : tout le monde à ~1.5s max entre chaque voiture (réaliste)
          for (let i = 1; i < aliveSC.length; i++) {
            const maxGap = i * 1500;
            aliveSC[i].totalTime = leaderTime + maxGap;
          }
        } else {
          // VSC : réduction de 70% des écarts
          for (let i = 1; i < aliveSC.length; i++) {
            const currentGap = aliveSC[i].totalTime - leaderTime;
            aliveSC[i].totalTime = leaderTime + Math.round(currentGap * 0.3);
          }
        }
        aliveSC.forEach((d, i) => { d.pos = i + 1; d.lastPos = i + 1; });
      }

      // Annonce SC/VSC
      const cause    = lapDnfs.length > 0 ? lapDnfs[lapDnfs.length - 1] : null;
      const causeStr = cause
        ? ` suite à l'abandon de **${cause.driver.pilot.name}**`
        : ` suite à un incident sur la piste`;

      if (scState.state === 'SC') {
        events.push({ priority: 9, gif: pickGif('safety_car'), text: pick([
          `🚨 **SAFETY CAR DÉPLOYÉ !**${causeStr}\nLe peloton se reforme — les écarts sont effacés. Tout est à refaire !`,
          `🚨 **SC IN !**${causeStr}. La voiture de sécurité prend la tête — qui va rentrer aux stands pour gratter une stratégie ?`,
          `🚨 **SAFETY CAR !** T${lap}${causeStr}. Les commissaires nettoient la piste — ça va redonner du piment à cette course !`,
        ]) });
      } else {
        events.push({ priority: 9, gif: pickGif('vsc'), text: pick([
          `🟡 **VIRTUAL SAFETY CAR**${causeStr}. Tout le monde maintient le delta — la course se met en pause.`,
          `🟡 **VSC !**${causeStr}. Les pilotes roulent au ralenti, les gaps se resserrent. La course reprendra bientôt.`,
        ]) });
      }
    }

    // ── Fin de SC/VSC : green flag ────────────────────────────
    if (prevScState !== 'NONE' && scState.state === 'NONE') {
      scCooldown = 6; // 6 tours de variance réduite après restart
      const rankedRestart = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      const top3str = rankedRestart.slice(0,3).map((d,i) => `P${i+1} ${d.team.emoji}**${d.pilot.name}**`).join(' · ');
      events.push({ priority: 10, gif: pickGif('green_flag'), text: pick([
        `🟢 **GREEN FLAG !** T${lap} — La course reprend ! ${top3str}\nLes gaps ont été effacés — tout le monde est dans le même mouchoir. Ça va exploser !`,
        `🟢 **FEU VERT !** T${lap} — On repart ! ${top3str}\nLe peloton est groupé — qui va attaquer en premier ?`,
      ]) });
    }

    // ── Calcul des temps au tour ─────────────────────────────
    if (scCooldown > 0) scCooldown--;

    for (const driver of drivers.filter(d => !d.dnf)) {
      if (scActive) {
        const scLapBase = scState.state === 'SC' ? 115_000 : 100_000;
        driver.totalTime += scLapBase + randInt(-50, 50);
        driver.tireAge += 1;
        if ((driver.warmupLapsLeft || 0) > 0) driver.warmupLapsLeft--;
      } else {
        let lt = calcLapTime(
          driver.pilot, driver.team,
          driver.tireCompound, driver.tireWear,
          weather, trackEvo, gpStyle, driver.pos,
          scCooldown
        );

        // ── DRS réaliste : bonus si < 1.2s du pilote devant ──
        if (scCooldown === 0 && (driver.pos || 1) > 1 && lap > 1) {
          const drsCircuit = gpStyle === 'rapide' || gpStyle === 'mixte';
          if (drsCircuit) {
            const pilotAheadObj = drivers.find(d => !d.dnf && d.pos === driver.pos - 1);
            if (pilotAheadObj) {
              const myPreTime    = preLapTimes.get(String(driver.pilot._id)) ?? driver.totalTime;
              const aheadPreTime = preLapTimes.get(String(pilotAheadObj.pilot._id)) ?? pilotAheadObj.totalTime;
              const realGapMs    = Math.max(0, myPreTime - aheadPreTime);
              if (realGapMs < 1200) {
                const drsBonus = Math.round((driver.team.drs / 100) * 600 * (1 - realGapMs / 1200));
                lt -= drsBonus;
                driver.drsActive = true;
              } else { driver.drsActive = false; }
            }
          }
        } else { driver.drsActive = false; }

        // ── Chauffe pneus post-pit ──
        if ((driver.warmupLapsLeft || 0) > 0) {
          lt += driver.warmupLapsLeft === 2 ? 3500 : 1500;
          driver.warmupLapsLeft--;
        }

        // ── Trafic post-pit ──
        if ((driver.trafficLapsLeft || 0) > 0) {
          lt += 1500 + randInt(0, 1000);
          driver.trafficLapsLeft--;
          if (driver.trafficLapsLeft === 0) {
            events.push({ priority: 3, text:
              `🚦 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** se dégage du trafic ! Les pneus frais peuvent maintenant faire la différence.`
            });
          }
        }

        // ── Défense agressive = usure pneus extra ──
        const behindDrv = drivers.find(d => !d.dnf && d.pos === driver.pos + 1);
        if (behindDrv && !scActive) {
          const gapBehindAbs = Math.abs(
            (preLapTimes.get(String(driver.pilot._id)) ?? driver.totalTime)
            - (preLapTimes.get(String(behindDrv.pilot._id)) ?? behindDrv.totalTime)
          );
          if (gapBehindAbs < 1500) {
            const defWear = driver.pilot.defense < 50 ? 0.8 : 0.3;
            driver.tireWear = (driver.tireWear || 0) + defWear;
            driver.defendExtraWear = (driver.defendExtraWear || 0) + defWear;
          }
        }

        // ── Récupération post-dégâts (catchUpDebt) ──
        // Après un contact, le pilote "contre-attaque" : légèrement plus rapide pendant quelques tours
        // Récupération fixe : ~800-1200ms/tour (jamais plus que le lt ne le permet)
        if ((driver.catchUpDebt || 0) > 0) {
          const recovery = Math.min(driver.catchUpDebt, 1000);
          lt -= recovery;
          driver.catchUpDebt = Math.max(0, driver.catchUpDebt - recovery);
        }

        driver.totalTime += lt;
        driver.tireWear  += 1;
        driver.tireAge   += 1;
        if (lt < driver.fastestLap) driver.fastestLap = lt;
        if (lt < fastestLapMs) {
          const prevHolder = fastestLapHolder;
          fastestLapMs     = lt;
          fastestLapHolder = driver;
          // Annonce meilleur tour en direct (après T3)
          if (lap >= 3 && (!prevHolder || String(prevHolder.pilot._id) !== String(driver.pilot._id))) {
            const flStr = msToLapStr(lt);
            const isTop10 = (driver.pos || 1) <= 10;
            const pointNote = isTop10 && lapsRemaining <= 5 ? ' 🏅 *+1 pt possible !*' : '';
            events.push({ priority: 4, text:
              `⚡ **MEILLEUR TOUR !** ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) — **${flStr}**${isTop10 ? pointNote : ' *(hors top 10)*'}`,
            });
          }
        }
      }
    }

    // ── Après chaque tour de SC, re-serrer les écarts (drift résiduel) ──
    // Empêche les gap de diverger à nouveau pendant le SC à cause des micro-variances
    if (scActive) {
      const aliveMid = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      if (aliveMid.length > 1) {
        const lt0 = aliveMid[0].totalTime;
        const maxGapPerPos = scState.state === 'SC' ? 1600 : 3000; // max ~1.6s/pos sous SC
        for (let i = 1; i < aliveMid.length; i++) {
          const maxAllowed = lt0 + i * maxGapPerPos;
          if (aliveMid[i].totalTime > maxAllowed) aliveMid[i].totalTime = maxAllowed;
        }
        aliveMid.forEach((d, i) => { d.pos = i + 1; });
      }
    }

    // ── Pit stops ────────────────────────────────────────────
    // Snapshot figé — évite les bugs de mutation pendant l'itération
    const aliveNow = [...drivers.filter(d => !d.dnf)].sort((a,b) => a.totalTime - b.totalTime);
    aliveNow.forEach((d,i) => d.pos = i+1);

    for (const driver of aliveNow) {
      if (driver.pittedThisLap) continue; // garde anti double-pit

      const myIdx    = aliveNow.findIndex(d => String(d.pilot._id) === String(driver.pilot._id));
      const gapAhead = myIdx > 0 ? driver.totalTime - aliveNow[myIdx - 1].totalTime : null;

      // Sous SC ou dans les 4 tours post-SC : pas d'undercut (tout le monde est groupé)
      const { pit, reason: rawReason } = shouldPit(driver, lapsRemaining, gapAhead, totalLaps);
      const blockUndercut = scActive || scCooldown > 0;
      const reason = (blockUndercut && rawReason === 'undercut') ? null : rawReason;
      const doPit  = pit && reason !== null;

      if (doPit && driver.pitStops < 3 && lapsRemaining > 5) {
        const posIn      = driver.pos;
        const oldTire    = driver.tireCompound;
        const newCompound = choosePitCompound(oldTire, lapsRemaining, driver.usedCompounds);

        // Pit de réparation : aileron = +12-20s, suspension = +8-14s
        let pitTime;
        let repairDesc = null;
        if (driver.pendingRepair) {
          if (driver.pendingRepair === 'aileron') {
            pitTime    = scActive ? randInt(30_000, 36_000) : randInt(32_000, 40_000);
            repairDesc = `⚙️ *Remplacement de l'aileron avant — arrêt long !*`;
          } else if (driver.pendingRepair === 'puncture_repair') {
            pitTime    = scActive ? randInt(21_000, 25_000) : randInt(22_000, 28_000);
            repairDesc = `🫧 *Remplacement de pneu crevé — arrêt express !*`;
          } else {
            pitTime    = scActive ? randInt(26_000, 32_000) : randInt(28_000, 36_000);
            repairDesc = `🔩 *Réparation de suspension — arrêt rallongé !*`;
          }
          delete driver.pendingRepair;
        } else {
          pitTime = scActive ? randInt(19_000, 21_000) : randInt(19_000, 24_000);
        }

        driver.totalTime    += pitTime;
        driver.tireCompound  = newCompound;
        driver.tireWear      = 0;
        driver.tireAge       = 0;
        driver.pitStops     += 1;
        driver.stratPitsDone = (driver.stratPitsDone || 0) + 1;
        driver.pittedThisLap = true;
        driver.warmupLapsLeft = 2;
        driver.overcutMode    = false;
        if (!driver.usedCompounds.includes(newCompound)) driver.usedCompounds.push(newCompound);

        // Trafic à la sortie : si 2+ voitures proches
        const carsNearPitExit = aliveNow.filter(d =>
          !d.pittedThisLap &&
          String(d.pilot._id) !== String(driver.pilot._id) &&
          Math.abs(d.totalTime - driver.totalTime) < 4000
        ).length;
        if (carsNearPitExit >= 2) driver.trafficLapsLeft = randInt(1, 2);

        // Recalcul positions
        drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
        const posOut = driver.pos;
        const pitDur = (pitTime / 1000).toFixed(1);

        const scPitTag = scActive ? ' 🚨 *sous Safety Car*' : '';
        // Position sur la piste vs position en timing
        // Les pilotes qui n'ont pas encore pité et ont moins de totalTime sont "devant" sur la piste
        const carsAheadOnTrack = drivers.filter(d =>
          !d.dnf &&
          !d.pittedThisLap &&
          (d.pitStops || 0) < (driver.pitStops || 0) && // pas encore pité autant
          d.totalTime < driver.totalTime
        ).length;
        const trackPos = carsAheadOnTrack + 1;
        const posOutContext = trackPos !== posOut
          ? `**P${posOut}** en timing *(~P${trackPos} sur la piste)*`
          : `**P${posOut}**`;
        const gapToLeader = driver.pos > 1
          ? (() => {
              const leaderTime = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime)[0]?.totalTime;
              return leaderTime != null ? ` · ${((driver.totalTime - leaderTime) / 1000).toFixed(1)}s du leader` : '';
            })()
          : '';
        const warmupNote = repairDesc ? `
  ${repairDesc}` : ' *Pneus à chauffer — 2 tours lents.*';

        const pitFlavors = repairDesc ? [
          `🔧 **T${lap} — PIT D'URGENCE !** ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) rentre précipitamment. Arrêt de **${pitDur}s** — ressort ${posOutContext}${gapToLeader}.${warmupNote}`,
        ] : reason === 'undercut' ? [
          `🔧 **T${lap} — UNDERCUT !** ${driver.team.emoji}**${driver.pilot.name}** plonge aux stands depuis **P${posIn}** — ${TIRE[oldTire].emoji} → ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** — **${pitDur}s** — ressort ${posOutContext}${gapToLeader}. La stratégie va-t-elle payer ?${warmupNote}`,
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** tente l'undercut depuis **P${posIn}** ! ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s — ressort ${posOutContext}${gapToLeader}.${warmupNote}`,
        ] : [
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** rentre aux stands depuis **P${posIn}**${scPitTag} — ${TIRE[oldTire].emoji} cramés. ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en **${pitDur}s** — ressort ${posOutContext}${gapToLeader}.${warmupNote}`,
          `🔧 **T${lap} — ARRÊT AUX STANDS** pour ${driver.team.emoji}**${driver.pilot.name}** (P${posIn})${scPitTag}. ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s. Ressort ${posOutContext}${gapToLeader}.${warmupNote}`,
        ];

        // Tracker undercut
        if (reason === 'undercut') {
          undercutTracker.set(String(driver.pilot._id), { pitLap: lap, pilotAheadPos: posIn - 1 });
          driver.lastUndercutLap = lapsRemaining; // cooldown en tours restants — évite double undercut trop tôt
        }

        events.push({ priority: repairDesc ? 9 : 7, gif: pickGif('pit_stop'), text: pick(pitFlavors) });
      }
    }

    // ── Overcut : détecter les pilotes qui restent intentionnellement dehors ──
    if (!scActive && lap > 10 && lapsRemaining > 8) {
      const pittersPos = drivers.filter(d => d.pittedThisLap).map(d => d.pos);
      for (const d of drivers.filter(d => !d.dnf && !d.pittedThisLap)) {
        const rivalPitted = pittersPos.some(pp => Math.abs(pp - d.pos) <= 2);
        if (rivalPitted && (d.tireWear || 0) < 28 && (d.pitStops || 0) < 2 && !d.overcutMode) {
          if (Math.random() < (d.pilot.adaptabilite / 100) * 0.45) {
            d.overcutMode = true;
            if (Math.random() < 0.6) {
              events.push({ priority: 5, text: pick([
                `📻 **T${lap}** — ${d.team.emoji}**${d.pilot.name}** reste en piste ! L'équipe mise sur l'**overcut** — creuser l'écart avant de pitter. *Risqué mais audacieux.*`,
                `📻 **T${lap}** — ${d.team.emoji}**${d.pilot.name}** ne rentre PAS aux stands ! L'équipe joue l'overcut — rester dehors pendant que les autres chaussent du frais.`,
              ]) });
            }
            const nearPitter = drivers.find(drv => drv.pittedThisLap && Math.abs(drv.pos - d.pos) <= 2);
            if (nearPitter && !overcutTracker.has(String(d.pilot._id))) {
              overcutTracker.set(String(d.pilot._id), { startLap: lap, rivalId: String(nearPitter.pilot._id), myPosAtStart: d.pos });
            }
          }
        }
        if (d.overcutMode && (d.tireWear || 0) > 30) d.overcutMode = false;
      }
    }

    // ── Reclassement final du tour ────────────────────────────
    drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
    const ranked = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);

    // ── Mise à jour du battleMap ──────────────────────────────
    // Pour chaque paire de pilotes adjacents distants de < 2s, on incrémente lapsClose
    if (!scActive) {
      for (let i = 0; i < ranked.length - 1; i++) {
        const ahead  = ranked[i];
        const behind = ranked[i + 1];
        const gap = behind.totalTime - ahead.totalTime;
        const bkey = [String(ahead.pilot._id), String(behind.pilot._id)].sort().join('_');
        if (gap < 2000) {
          const existing = battleMap.get(bkey) || { lapsClose: 0, lastPasser: null, lastPasserLap: -99 };
          battleMap.set(bkey, { ...existing, lapsClose: existing.lapsClose + 1 });
        } else {
          // Trop loin → reset
          battleMap.delete(bkey);
        }
      }
    }

    // ── Dépassements & Batailles ──────────────────────────────
    // Règles :
    // 1. Jamais sous SC/VSC
    // 2. Pas tour de restart
    // 3. Positions adjacentes AVANT le tour (max 2 positions gagnées hors incidents)
    // 4. Gap pré-tour < 3s pour les vrais dépassements en piste
    // 5. Ni attaquant ni défenseur n'ont pité
    // 6. Contre-attaque possible si le pilote vient d'être passé au tour précédent
    // NOTE: Si le pilote a gagné 2+ places (à cause d'un pit, SC ou incident), on le mentionne brièvement
    const justRestarted = prevScState !== 'NONE' && scState.state === 'NONE';

    for (const driver of ranked) {
      if (scActive) continue;
      if (justRestarted) continue;
      if (lap <= 1) continue;
      if (driver.pittedThisLap) continue;

      const movedUp   = driver.pos < driver.lastPos;
      const movedDown = driver.pos > driver.lastPos;
      const posGained = driver.lastPos - driver.pos; // positif si remonté

      // ── Gain de 2+ positions ───────────────────────────────
      // Seulement si un DNF s'est produit CE tour dans cette zone de piste
      if (movedUp && posGained >= 2) {
        if (lapDnfs.length > 0) {
          const isTop8Move = driver.pos <= 6 || driver.lastPos <= 6;
          if (isTop8Move) {
            events.push({
              priority: 4,
              text: `📊 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** remonte **P${driver.lastPos}→P${driver.pos}** après abandon.`,
            });
          }
        }
        // Ne pas traiter comme un dépassement normal
        continue;
      }

      // ── Dépassement (le pilote a gagné UNE place) ──────────
      if (movedUp && driver.lastPos === driver.pos + 1) {
        // Chercher le pilote qui était à cette position et qui n'a pas pité
        const passed = ranked.find(d =>
          d.pos === driver.lastPos &&
          !d.pittedThisLap &&
          String(d.pilot._id) !== String(driver.pilot._id)
        );
        if (!passed) continue;
        // Le pilote passé doit avoir reculé : sa lastPos doit être inférieure à sa pos actuelle
        // On est plus tolérant ici : on vérifie juste qu'il n'a pas pité et qu'il a reculé
        if (passed.pos <= passed.lastPos) continue; // il n'a pas reculé → pas un vrai dépassement

        // Gap pré-tour
        const preLapD = preLapTimes.get(String(driver.pilot._id)) ?? driver.totalTime;
        const preLapP = preLapTimes.get(String(passed.pilot._id)) ?? passed.totalTime;
        if (Math.abs(preLapP - preLapD) > 3000) continue;

        const postGapMs = Math.abs(driver.totalTime - passed.totalTime);
        const gapStr    = postGapMs < 1000 ? `${postGapMs}ms` : `${(postGapMs/1000).toFixed(3)}s`;
        const gapLeader = driver.pos > 1 ? ` · ${((driver.totalTime - ranked[0].totalTime)/1000).toFixed(3)}s du leader` : '';
        const drsTag    = gpStyle === 'rapide' && driver.team.drs > 82 ? ' 📡 *DRS*' : '';
        const areRivals = (
          (driver.pilot.rivalId && String(driver.pilot.rivalId) === String(passed.pilot._id)) ||
          (passed.pilot.rivalId && String(passed.pilot.rivalId) === String(driver.pilot._id))
        );
        const rivalTag = areRivals ? `\n⚔️ *Rivalité déclarée — ce dépassement a une saveur particulière !*` : '';

        // Vérifier si c'est une contre-attaque
        const bkey = [String(driver.pilot._id), String(passed.pilot._id)].sort().join('_');
        const battle = battleMap.get(bkey);
        const isCounterAttack = battle &&
          battle.lastPasser === String(passed.pilot._id) &&
          (lap - battle.lastPasserLap) <= 2;

        // Mettre à jour qui vient de passer
        const updatedBattle = battle
          ? { ...battle, lastPasser: String(driver.pilot._id), lastPasserLap: lap }
          : { lapsClose: 1, lastPasser: String(driver.pilot._id), lastPasserLap: lap };
        battleMap.set(bkey, updatedBattle);

        const ovNewPos  = driver.pos;
        const ovLostPos = passed.pos;
        const ovForLead = ovNewPos === 1;
        const ovIsTop3  = ovNewPos <= 3 || ovLostPos <= 3;
        const ovHeader  = ovForLead
          ? `***🏆 T${lap} — CHANGEMENT EN TÊTE !!!***${drsTag}`
          : ovIsTop3
            ? `***⚔️ T${lap} — DÉPASSEMENT DANS LE TOP 3 !***${drsTag}`
            : isCounterAttack
              ? `🔄 **T${lap} — CONTRE-ATTAQUE !**${drsTag}`
              : `⚔️ **T${lap} — DÉPASSEMENT !**${drsTag}`;

        const howDesc = isCounterAttack
          ? counterAttackDescription(driver, passed, gpStyle)
          : overtakeDescription(driver, passed, gpStyle);

        const posBlock = `⬆️ **${driver.pilot.name}** → P${ovNewPos}\n⬇️ **${passed.pilot.name}** → P${ovLostPos}`;
        const gifCat   = ovForLead ? 'overtake_lead' : ovIsTop3 ? 'overtake_podium' : 'overtake_normal';

        events.push({
          priority: ovForLead ? 9 : ovIsTop3 ? 8 : isCounterAttack ? 7 : 6,
          text: `${ovHeader}\n${howDesc}\n${posBlock}\n*Écart : ${gapStr}${gapLeader}*${rivalTag}`,
          gif: pickGif(gifCat),
        });
      }
    }

    // ── Undercut : confirmation 2-4 tours après ──────────────
    for (const [undId, uc] of undercutTracker.entries()) {
      if (lap < uc.pitLap + 2) continue;
      if (lap > uc.pitLap + 4) { undercutTracker.delete(undId); continue; }
      const undDriver = ranked.find(d => String(d.pilot._id) === undId);
      if (!undDriver || (undDriver.warmupLapsLeft || 0) > 0) continue;
      const target = ranked.find(d => d.pos === uc.pilotAheadPos);
      if (!target) { undercutTracker.delete(undId); continue; }
      const undWorked = undDriver.pos < target.pos;
      const gap = Math.abs(undDriver.totalTime - target.totalTime);
      const gapStr = gap < 1000 ? `${gap}ms` : `${(gap/1000).toFixed(3)}s`;
      events.push({ priority: 7, text: undWorked
        ? `✅ **T${lap} — L'UNDERCUT A PAYÉ !** ${undDriver.team.emoji}**${undDriver.pilot.name}** est devant ${target.team.emoji}**${target.pilot.name}** — **${gapStr}** d'avance. Stratégie parfaite.`
        : `❌ **T${lap} — L'UNDERCUT N'A PAS FONCTIONNÉ.** ${target.team.emoji}**${target.pilot.name}** a tenu le rythme — ${undDriver.team.emoji}**${undDriver.pilot.name}** ressort toujours derrière (${gapStr}).`,
      });
      undercutTracker.delete(undId);
    }

    // ── Overcut : confirmation 3-6 tours après ──────────────
    for (const [ocId, oc] of overcutTracker.entries()) {
      if (lap < oc.startLap + 3) continue;
      if (lap > oc.startLap + 6) { overcutTracker.delete(ocId); continue; }
      const ocDriver = ranked.find(d => String(d.pilot._id) === ocId);
      if (!ocDriver || ocDriver.overcutMode) continue;
      const rival = ranked.find(d => String(d.pilot._id) === oc.rivalId);
      if (!rival) { overcutTracker.delete(ocId); continue; }
      const ocWorked = ocDriver.pos < rival.pos;
      const gap = Math.abs(ocDriver.totalTime - rival.totalTime);
      const gapStr = gap < 1000 ? `${gap}ms` : `${(gap/1000).toFixed(3)}s`;
      events.push({ priority: 6, text: ocWorked
        ? `✅ **T${lap} — L'OVERCUT A FONCTIONNÉ !** ${ocDriver.team.emoji}**${ocDriver.pilot.name}** est devant ${rival.team.emoji}**${rival.pilot.name}** — **${gapStr}** d'avance. Rester dehors était le bon choix.`
        : `❌ **T${lap} — L'OVERCUT N'A PAS PAYÉ.** ${rival.team.emoji}**${rival.pilot.name}** ressort devant avec des pneus frais — ${ocDriver.team.emoji}**${ocDriver.pilot.name}** a perdu le pari stratégique (${gapStr} derrière).`,
      });
      overcutTracker.delete(ocId);
    }

    // ── Contacts légers ────────────────────────────────────────
    if (!scActive && lap > 1 && Math.random() < 0.08) {
      const closeDrivers = ranked.filter((d, i) => {
        if (i === 0) return false;
        const gap = (d.totalTime - ranked[i-1].totalTime) / 1000;
        return gap < 0.8 && !d.pittedThisLap && !ranked[i-1].pittedThisLap;
      });
      if (closeDrivers.length) {
        const victim   = pick(closeDrivers);
        const attacker = ranked.find(d => d.pos === victim.pos - 1);
        if (attacker) {
          const roll = Math.random();
          if (roll < 0.5) {
            const penalty = randInt(2000, 4000);
            attacker.totalTime += penalty;
            drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
            raceCollisions.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id) });
            events.push({ priority: 5, text: pick([
              `⚠️ **T${lap} — CONTACT !** ${attacker.team.emoji}**${attacker.pilot.name}** accroche légèrement ${victim.team.emoji}**${victim.pilot.name}** — pénalité **+${(penalty/1000).toFixed(0)}s** pour ${attacker.pilot.name}.`,
              `⚠️ **T${lap}** — Petit contact ${attacker.team.emoji}**${attacker.pilot.name}** / ${victim.team.emoji}**${victim.pilot.name}**. Pénalité **+${(penalty/1000).toFixed(0)}s** infligée.`,
            ]) });
          } else {
            raceCollisions.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id) });
            events.push({ priority: 3, text: pick([
              `🔍 **T${lap}** — Contact discutable ${attacker.team.emoji}**${attacker.pilot.name}** / ${victim.team.emoji}**${victim.pilot.name}**. *Sous investigation — aucune pénalité pour l'instant.*`,
              `🔍 **T${lap}** — ${attacker.team.emoji}**${attacker.pilot.name}** frôle ${victim.team.emoji}**${victim.pilot.name}**. *La FIA surveille mais ne pénalise pas.*`,
            ]) });
          }
        }
      }
    }

    // ── Défenses sans changement de position ──────────────────
    if (!scActive && !justRestarted && lap > 2 && Math.random() < 0.35) {
      for (let i = 0; i < ranked.length - 1; i++) {
        const ahead  = ranked[i];
        const behind = ranked[i + 1];
        if (ahead.pittedThisLap || behind.pittedThisLap) continue;
        const gap  = (behind.totalTime - ahead.totalTime) / 1000;
        const bkey = [String(ahead.pilot._id), String(behind.pilot._id)].sort().join('_');
        const battle = battleMap.get(bkey);
        if (battle && battle.lapsClose >= 3 && gap < 1.2) {
          let defText = defenseDescription(ahead, behind, gpStyle);
          // Mentionner l'usure pneus si défense longue
          if (battle.lapsClose >= 5 && (ahead.defendExtraWear || 0) > 1.5) {
            const wornNote = (ahead.defendExtraWear || 0) > 3
              ? `
  › *Les pneus de **${ahead.pilot.name}** paient le prix — ils s'effondreront bientôt.*`
              : `
  › *La défense coûte des pneus à **${ahead.pilot.name}** — fenêtre stratégique qui se resserre.*`;
            defText += wornNote;
          }
          events.push({ priority: 4, text: defText });
          break;
        }
      }
    }

    // ── Commentary obligatoire chaque tour ───────────────────
    // Toujours un message, même si rien ne se passe
    const atmo = atmosphereLine(ranked, lap, totalLaps, weather, scState, gpStyle);
    if (atmo) events.push({ priority: events.length === 0 ? 3 : 1, text: atmo });

    // ── Composition et envoi du message ─────────────────────
    events.sort((a,b) => b.priority - a.priority);
    const eventsText = events.map(e => e.text).join('\n\n');
    const topGif = events.find(e => e.gif)?.gif ?? null;

    const showFullStandings = (lap % 10 === 0) || lap === totalLaps;
    const showTop5          = (lap % 5 === 0 && !showFullStandings) || (scActive && prevScState !== 'NONE');

    // Helper: état d'usure pneu
    const tireWearLabel = (d) => {
      const td  = TIRE[d.tireCompound];
      if (!td) return '⬜';
      const worn = d.tireWear || 0;
      const deg  = td.deg || 0.0016;
      // tireLifeRef = seuil de tours avant cliff (SOFT~25, MEDIUM~38, HARD~60)
      const thr  = deg > 0 ? Math.round(0.06 / deg) : 38;
      const wup  = (d.warmupLapsLeft || 0) > 0 ? '🌡️' : '';
      if (worn >= thr * 1.0) return `${td.emoji}🔴${wup}`; // au-delà du seuil
      if (worn >= thr * 0.65) return `${td.emoji}🟡${wup}`; // 65-100% du seuil
      return `${td.emoji}🟢${wup}`; // < 65% du seuil
    };

    let standingsText = '';
    if (showFullStandings) {
      const dnfLines = drivers.filter(d => d.dnf);
      standingsText = '\n\n📋 **CLASSEMENT COMPLET — Tour ' + lap + '/' + totalLaps + '**\n' +
        ranked.map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? '⏱ **LEADER**' : `+${(gapMs/1000).toFixed(3)}s / leader`;
          return `\`P${String(i+1).padStart(2,' ')}\` ${d.team.emoji} **${d.pilot.name}** — ${gapStr} ${tireWearLabel(d)} (${d.pitStops} arr.)`;
        }).join('\n') +
        (dnfLines.length ? '\n' + dnfLines.map(d => `~~${d.team.emoji}${d.pilot.name}~~ ❌ T${d.dnfLap}`).join(' · ') : '');
    } else if (showTop5) {
      standingsText = '\n\n🏎️ **Top ' + Math.min(5, ranked.length) + ' — T' + lap + '/' + totalLaps + '**\n' +
        ranked.slice(0, 5).map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? 'LEADER' : `+${(gapMs/1000).toFixed(3)}s / leader`;
          return `**P${i+1}** ${d.team.emoji} **${d.pilot.name}** — ${gapStr} ${tireWearLabel(d)}`;
        }).join('\n');
    }

    // GIF d'abord — apparaît avant le commentaire pour éviter le décalage
    if (topGif && channel) {
      try { await channel.send(topGif); } catch(e) {}
      await sleep(3500);
    }

    // Commentaire du tour
    const header = `**⏱ Tour ${lap}/${totalLaps}**` +
      (scState.state === 'SC'  ? ` 🚨 **SAFETY CAR**` : '') +
      (scState.state === 'VSC' ? ` 🟡 **VSC**`        : '');
    await send([header, eventsText, standingsText].filter(Boolean).join('\n'));
  }

  global.activeRaces?.delete(raceKey);
  if (raceAborted) return { results: [], collisions: [] };

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

    // Bonus de participation : tout le monde gagne quelque chose même sans point
    // P1-P10 = 0 bonus (pts F1 suffisent), P11 = 12, P15 = 60, P20 = 120
    // Cela garantit que les bas de grille peuvent améliorer 1 stat toutes les 1-2 courses
    const participBonus = driver.dnf ? 0 : (driver.pos > 10 ? 20 : 0);

    const coins = Math.round(
      (pts * 12 + (driver.dnf ? 0 : 40) + participBonus) * multi
      + salary + primeV + primeP + (fl ? 30 : 0)
    );

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
    // Sauvegarde immédiate — avant messages Discord
  await Race.findByIdAndUpdate(race._id, { raceResults: results, status: "race_computed" });

  const winner    = finalRanked[0];
  const runnerUp  = finalRanked[1];
  const gapWin    = runnerUp && !runnerUp.dnf ? (runnerUp.totalTime - winner.totalTime) / 1000 : null;
  const hadTop3Dnf = finalRanked.slice(0,3).some(d => d.dnf);
  const winFlavors = gapWin && gapWin < 1 ? [
    `***🏁🏁🏁 DRAPEAU À DAMIER !!! ${race.emoji} ${race.circuit}***\n***🏆 ${winner.team.emoji}${winner.pilot.name} GAGNE !!! À ${gapWin.toFixed(3)}s !!! QUELLE COURSE INCROYABLE !!!***`,
    `***🏁 C'EST FINI !!! VICTOIRE DE ${winner.team.emoji}${winner.pilot.name.toUpperCase()} !!! +${gapWin.toFixed(3)}s — ON A TOUT VU !!!***`,
  ] : hadTop3Dnf ? [
    `🏁 **DRAPEAU À DAMIER !** ${race.emoji} ${race.circuit}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** remporte une victoire marquée par le drame — pas celle qu'on attendait, mais totalement méritée.`,
    `🏁 **VICTOIRE SOUS LE CHAOS !** ${race.emoji}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** profite des incidents pour s'imposer. Le sport est cruel et merveilleux à la fois.`,
  ] : [
    `🏁 **DRAPEAU À DAMIER !** ${race.emoji} ${race.circuit}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** remporte le Grand Prix — une victoire convaincante de bout en bout !`,
    `🏁 **C'EST FINI !** ${race.emoji} ${race.circuit}\n🏆 Victoire de **${winner.team.emoji} ${winner.pilot.name}** — une course magistrale !`,
    `🏁 **FIN DE COURSE !** ${race.emoji} ${race.circuit}\n🏆 **${winner.team.emoji} ${winner.pilot.name}** franchit la ligne en vainqueur !`,
  ];
  await send(pick(winFlavors));
  // GIF victoire
  const winGif = pickGif('win');
  if (winGif && channel) { try { await channel.send(winGif); } catch(e) {} await sleep(2000); }

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

  // ── Record du circuit ─────────────────────────────────────
  if (fastestLapHolder && fastestLapMs < Infinity) {
    const prevRecord = existingCircuitRecord;
    const isNewRecord = !prevRecord || fastestLapMs < prevRecord.bestTimeMs;
    if (isNewRecord) {
      const oldTimeStr = prevRecord ? msToLapStr(prevRecord.bestTimeMs) : null;
      await CircuitRecord.findOneAndUpdate(
        { circuit: race.circuit },
        {
          circuit      : race.circuit,
          circuitEmoji : race.emoji || '🏁',
          gpStyle      : race.gpStyle || 'mixte',
          bestTimeMs   : fastestLapMs,
          pilotId      : fastestLapHolder.pilot._id,
          pilotName    : fastestLapHolder.pilot.name,
          teamName     : fastestLapHolder.team.name,
          teamEmoji    : fastestLapHolder.team.emoji,
          seasonYear   : season.year,
          raceId       : race._id,
          setAt        : new Date(),
        },
        { upsert: true, new: true }
      );
      await sleep(1500);
      const recordEmbed = new EmbedBuilder()
        .setTitle(`⏱️ NOUVEAU RECORD DU CIRCUIT ! ${race.emoji} ${race.circuit}`)
        .setColor('#FF6600')
        .setDescription(
          `${fastestLapHolder.team.emoji} **${fastestLapHolder.pilot.name}** pulvérise le record !\n\n` +
          `⚡ **${msToLapStr(fastestLapMs)}**` +
          (oldTimeStr ? `\n📉 Ancien record : ~~${oldTimeStr}~~${prevRecord?.pilotName ? ` (${prevRecord.pilotName}, S${prevRecord.seasonYear})` : ''}` : '\n*Premier record établi sur ce circuit !*')
        );
      await sendEmbed(recordEmbed);
    }
  }

  // ── Statut coéquipier #1 / #2 ────────────────────────────
  // Pour chaque écurie, comparer les positions des deux pilotes et mettre à jour teammateDuelWins
  const teamDrivers = new Map();
  for (const d of finalRanked) {
    const tid = String(d.team._id);
    if (!teamDrivers.has(tid)) teamDrivers.set(tid, []);
    teamDrivers.get(tid).push(d);
  }
  for (const [, members] of teamDrivers) {
    if (members.length < 2) continue;
    const [a, b] = members; // déjà triés par position finale
    // a a fini devant b (pos plus petite ou b est DNF)
    const aWon = !a.dnf && (b.dnf || a.pos < b.pos);
    if (aWon) {
      await Pilot.findByIdAndUpdate(a.pilot._id, { $inc: { teammateDuelWins: 1 } });
    } else if (!b.dnf && (a.dnf || b.pos < a.pos)) {
      await Pilot.findByIdAndUpdate(b.pilot._id, { $inc: { teammateDuelWins: 1 } });
    }
    // Recalculer le statut #1/#2 après mise à jour
    const [pA, pB] = await Promise.all([
      Pilot.findById(a.pilot._id),
      Pilot.findById(b.pilot._id),
    ]);
    if (!pA || !pB) continue;
    const winsA = pA.teammateDuelWins || 0;
    const winsB = pB.teammateDuelWins || 0;
    const total = winsA + winsB;
    // Statut déterminé si écart ≥ 3 duels ou fin de saison
    if (total >= 3) {
      const newStatusA = winsA > winsB ? 'numero1' : 'numero2';
      const newStatusB = winsA > winsB ? 'numero2' : 'numero1';
      await Pilot.findByIdAndUpdate(pA._id, { teamStatus: newStatusA });
      await Pilot.findByIdAndUpdate(pB._id, { teamStatus: newStatusB });
    }
  }

  // ── Conférence de presse + news — délai 2-3 min après la fin ──
  setTimeout(async () => {
    try {
      const allPilots    = await Pilot.find();
      const allTeams2    = await Team.find();
      const allStandings = await Standing.find({ seasonId: season._id });
      const cStandings   = await ConstructorStanding.find({ seasonId: season._id });
      const confBlocks   = await generatePressConference(
        race, results, season, allPilots, allTeams2, allStandings, cStandings
      );
      if (confBlocks?.length) {
        const confEmbed = new EmbedBuilder()
          .setTitle(`🎤 Conférence de presse — ${race.emoji} ${race.circuit}`)
          .setColor('#2B2D31')
          .setDescription(confBlocks.join('\n\n─────────────────\n\n'));
        if (channel) { try { await channel.send({ embeds: [confEmbed] }); } catch(e) {} }
        await sleep(5000);
      }
    } catch(e) { console.error('Conf de presse erreur:', e); }
    try {
      const seasonForNews = await getActiveSeason();
      if (seasonForNews) await generatePostRaceNews(race, results, seasonForNews, channel);
    } catch(e) { console.error('Post-race news erreur:', e); }
  }, 150_000 + Math.random() * 30_000); // 2min30 à 3min après la fin

  return { results, collisions: raceCollisions };
}

// ─── Fixtures de test (pilotes/équipes fictifs réutilisés par admin_test_*) ──
function buildTestFixtures() {
  const ObjectId = require('mongoose').Types.ObjectId;
  const testTeamDefs = [
    { name:'Red Bull Racing TEST', emoji:'🔵', color:'#1E3A5F', budget:160, vitesseMax:95, drs:95, refroidissement:90, dirtyAir:88, conservationPneus:88, vitesseMoyenne:93, devPoints:0 },
    { name:'Scuderia TEST',     emoji:'🔴', color:'#DC143C', budget:150, vitesseMax:92, drs:90, refroidissement:88, dirtyAir:85, conservationPneus:85, vitesseMoyenne:90, devPoints:0 },
    { name:'Mercedes TEST', emoji:'⚪', color:'#00D2BE', budget:145, vitesseMax:90, drs:88, refroidissement:92, dirtyAir:82, conservationPneus:87, vitesseMoyenne:88, devPoints:0 },
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

// ─── Helpers pilote multi-pilotes ──────────────────────────
// Retourne le pilote d'un user selon son index (1 ou 2). null si introuvable.
async function getPilotForUser(discordId, pilotIndex = 1) {
  if (pilotIndex === 1) {
    return Pilot.findOne({ discordId, $or: [{ pilotIndex: 1 }, { pilotIndex: null }, { pilotIndex: { $exists: false } }] });
  }
  return Pilot.findOne({ discordId, pilotIndex });
}
// Retourne tous les pilotes d'un user (1 ou 2)
async function getAllPilotsForUser(discordId) {
  return Pilot.find({ discordId }).sort({ pilotIndex: 1 });
}
// Retourne le label "Pilote 1 — NomDuPilote" pour l'affichage
function pilotLabel(pilot) {
  const num = pilot.racingNumber ? `#${pilot.racingNumber}` : '';
  const flag = pilot.nationality?.split(' ')[0] || '';
  return `${flag} ${num} **${pilot.name}** (Pilote ${pilot.pilotIndex})`;
}

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

async function getCurrentRace(season, slot = null) {
  if (!season) return null;
  const query = { seasonId: season._id, status: { $ne: 'done' } };
  if (slot !== null) query.slot = slot;
  return Race.findOne(query).sort({ index: 1 });
}

// Détermine le slot actuel selon l'heure (Paris)
function getCurrentSlot() {
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false });
  return parseInt(hour) >= 16 ? 1 : 0; // avant 16h = slot matin, après = slot soir
}

async function getAllPilotsWithTeams() {
  const pilots = await Pilot.find({ teamId: { $ne: null } });
  const teams  = await Team.find();
  return { pilots, teams };
}

async function applyRaceResults(raceResults, raceId, season, collisions = []) {
  const teams = await Team.find();
  console.log(`[applyRaceResults] Début — ${raceResults.length} résultats, seasonId=${season._id}, raceId=${raceId}`);

  // Récupérer les infos de la course pour les GPRecords
  const raceDoc = await Race.findById(raceId);

  // Récupérer la grille de départ pour les positions de départ
  const qualiGrid = raceDoc?.qualiGrid || [];
  const startPosMap = new Map(qualiGrid.map((g, i) => [String(g.pilotId), i + 1]));

  for (const r of raceResults) {
    await Pilot.findByIdAndUpdate(r.pilotId, { $inc: { plcoins: r.coins, totalEarned: r.coins } });
    const pts = F1_POINTS[r.pos - 1] || 0;
    const standingResult = await Standing.findOneAndUpdate(
      { seasonId: season._id, pilotId: r.pilotId },
      { $inc: { points: pts, wins: r.pos===1&&!r.dnf?1:0, podiums: r.pos<=3&&!r.dnf?1:0, dnfs: r.dnf?1:0 } },
      { upsert: true, new: true }
    );
    console.log(`[applyRaceResults] P${r.pos} pilotId=${r.pilotId} pts+${pts} dnf=${r.dnf} → standing total=${standingResult?.points}`);
    // Classement constructeurs
    const constrResult = await ConstructorStanding.findOneAndUpdate(
      { seasonId: season._id, teamId: r.teamId },
      { $inc: { points: pts } },
      { upsert: true, new: true }
    );
    console.log(`[applyRaceResults] teamId=${r.teamId} constructeur total=${constrResult?.points}`);

    // ── Enregistrement GPRecord ──────────────────────────────
    if (raceDoc) {
      const team = teams.find(t => String(t._id) === String(r.teamId));
      const gpRecordData = {
        pilotId      : r.pilotId,
        seasonId     : season._id,
        seasonYear   : season.year,
        raceId       : raceId,
        circuit      : raceDoc.circuit,
        circuitEmoji : raceDoc.emoji || '🏁',
        gpStyle      : raceDoc.gpStyle || 'mixte',
        teamId       : r.teamId,
        teamName     : team?.name || '?',
        teamEmoji    : team?.emoji || '🏎️',
        startPos     : startPosMap.get(String(r.pilotId)) || null,
        finishPos    : r.pos,
        dnf          : r.dnf || false,
        dnfReason    : r.dnfReason || null,
        points       : pts,
        coins        : r.coins,
        fastestLap   : r.fastestLap || false,
        raceDate     : raceDoc.scheduledDate || new Date(),
      };
      // Upsert pour éviter les doublons en cas de re-application (admin_apply_last_race)
      await PilotGPRecord.findOneAndUpdate(
        { pilotId: r.pilotId, raceId: raceId },
        { $set: gpRecordData },
        { upsert: true }
      );
    }
  }

  await Race.findByIdAndUpdate(raceId, { status: 'done', raceResults });

  // ── Rivalités : traiter les collisions de la course ──────
  // On consolide les contacts par paire (A-B = B-A)
  const contactMap = new Map(); // key: "idA_idB" (sorted)
  for (const { attackerId, victimId } of collisions) {
    const key = [attackerId, victimId].sort().join('_');
    contactMap.set(key, (contactMap.get(key) || 0) + 1);
  }
  for (const [key, count] of contactMap) {
    const [idA, idB] = key.split('_');
    // Mettre à jour les contacts des deux pilotes l'un envers l'autre
    for (const [myId, theirId] of [[idA, idB], [idB, idA]]) {
      const me = await Pilot.findById(myId);
      if (!me) continue;
      const currentRival = me.rivalId ? String(me.rivalId) : null;
      if (currentRival === theirId) {
        // Rivalité existante — incrémenter le compteur
        await Pilot.findByIdAndUpdate(myId, { $inc: { rivalContacts: count } });
      } else if (!currentRival) {
        // Pas encore de rival — si 2+ contacts cette course avec ce pilote, déclarer la rivalité
        const newTotal = (me.rivalContacts || 0) + count;
        if (count >= 2 || newTotal >= 2) {
          await Pilot.findByIdAndUpdate(myId, { rivalId: theirId, rivalContacts: count });
        }
      }
      // Si rivalité différente déjà active, on ne change pas (on garde la plus vieille)
    }
  }

  // Évolution voitures après la course
  await evolveCarStats(raceResults, teams);
}

async function createNewSeason() {
  const lastSeason = await Season.findOne().sort({ year: -1 });
  const year   = lastSeason ? lastSeason.year + 1 : new Date().getFullYear();
  const regSet = lastSeason ? (lastSeason.year % 4 === 3 ? lastSeason.regulationSet + 1 : lastSeason.regulationSet) : 1;

  const season = await Season.create({ year, status: 'active', regulationSet: regSet });

  if (regSet > 1) await applyRegulationChange(season);

  // Reset duels coéquipiers pour la nouvelle saison
  await Pilot.updateMany({}, { teammateDuelWins: 0, teamStatus: null });

  const startDate = new Date();
  startDate.setHours(0,0,0,0);
  startDate.setDate(startDate.getDate() + 1); // GP 1 = demain
  // 2 GP par jour : slot 0 (11h/13h/15h) et slot 1 (17h/18h/20h)
  // Un GP toutes les 12h → i=0 slot0 jour1, i=1 slot1 jour1, i=2 slot0 jour2...
  for (let i = 0; i < CIRCUITS.length; i++) {
    const d    = new Date(startDate);
    const slot = i % 2; // 0 = matin, 1 = soir
    d.setDate(d.getDate() + Math.floor(i / 2)); // 2 GP par jour
    await Race.create({ seasonId: season._id, index: i, slot, ...CIRCUITS[i], scheduledDate: d, status: 'upcoming' });
  }

  const pilots = await Pilot.find({ teamId: { $ne: null } });
  for (const p of pilots) await Standing.create({ seasonId: season._id, pilotId: p._id });

  // Réinitialiser rivalités et streak upgrade en début de saison
  await Pilot.updateMany({}, { $set: { rivalId: null, rivalContacts: 0, upgradeStreak: 0, lastUpgradeStat: null } });

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
    const budgetRatio = team.budget / 100; // 100 = budget égal pour toutes les écuries au départ

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

  // ── ENCHÈRES : surenchère automatique sur les top pilotes convoités ──
  // Après la génération des offres, si plusieurs écuries ont ciblé le même
  // pilote top (ov ≥ 75), elles surenchérissent automatiquement l'une l'autre.
  // Le pilote voit TOUTES les offres et choisit la meilleure.
  const allNewOffers = await TransferOffer.find({ status: 'pending' });
  // Grouper par pilote
  const offerGrouped = new Map();
  for (const o of allNewOffers) {
    const key = String(o.pilotId);
    if (!offerGrouped.has(key)) offerGrouped.set(key, []);
    offerGrouped.get(key).push(o);
  }
  for (const [pilotId, offers] of offerGrouped) {
    if (offers.length < 2) continue; // pas de concurrence
    const pilot = await Pilot.findById(pilotId);
    if (!pilot) continue;
    const ov = overallRating(pilot);
    if (ov < 72) continue; // enchères seulement pour les pilotes notés 72+
    // Trier par salaireBase décroissant
    offers.sort((a, b) => b.salaireBase - a.salaireBase);
    const topOffer = offers[0];
    // Chaque offre concurrente tente de surenchérir
    for (let i = 1; i < offers.length; i++) {
      const offer = offers[i];
      // Surenchère : +10% à +20% sur la meilleure offre visible
      const surenchere = Math.round(topOffer.salaireBase * rand(1.08, 1.20));
      if (surenchere > offer.salaireBase) {
        await TransferOffer.findByIdAndUpdate(offer._id, { salaireBase: surenchere });
      }
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
    .setDescription('Crée ton pilote F1 ! (2 pilotes max par joueur)')
    .addStringOption(o => o.setName('nom').setDescription('Nom de ton pilote').setRequired(true))
    .addStringOption(o => o.setName('nationalite').setDescription('Nationalité du pilote').setRequired(true)
      .addChoices(...[
        // Europe (12)
        '🇫🇷 Français','🇧🇪 Belge','🇩🇪 Allemand','🇬🇧 Britannique','🇳🇱 Néerlandais',
        '🇮🇹 Italien','🇪🇸 Espagnol','🇵🇹 Portugais','🇨🇭 Suisse','🇦🇹 Autrichien',
        '🇫🇮 Finlandais','🇵🇱 Polonais',
        // Amériques (6)
        '🇧🇷 Brésilien','🇺🇸 Américain','🇨🇦 Canadien','🇲🇽 Mexicain','🇦🇷 Argentin','🇨🇴 Colombien',
        // Afrique (6)
        '🇨🇮 Ivoirien','🇨🇬 Congolais','🇸🇳 Sénégalais','🇨🇲 Camerounais','🇲🇦 Marocain','🇿🇦 Sud-Africain',
        // Asie / Océanie (1)
        '🇯🇵 Japonais',
      ].map(n => ({ name: n, value: n })))
    )
    .addIntegerOption(o => o.setName('numero').setDescription('Ton numéro de pilote (1–99)').setRequired(true).setMinValue(1).setMaxValue(99))
    .addIntegerOption(o => o.setName('depassement').setDescription(`Points en Dépassement (0–${MAX_STAT_BONUS}) — Total pool: ${TOTAL_STAT_POOL}`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('freinage').setDescription(`Points en Freinage (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('defense').setDescription(`Points en Défense (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('adaptabilite').setDescription(`Points en Adaptabilité (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('reactions').setDescription(`Points en Réactions (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('controle').setDescription(`Points en Contrôle (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS))
    .addIntegerOption(o => o.setName('gestionpneus').setDescription(`Points en Gestion Pneus (0–${MAX_STAT_BONUS})`).setMinValue(0).setMaxValue(MAX_STAT_BONUS)),

  new SlashCommandBuilder().setName('profil')
    .setDescription('Voir le profil d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible'))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (si le joueur a 2 pilotes)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('ameliorer')
    .setDescription('Améliore une stat de ton pilote (coût variable selon le niveau, cumul possible)')
    .addStringOption(o => o.setName('stat').setDescription('Stat à améliorer').setRequired(true)
      .addChoices(
        { name: 'Dépassement    — à partir de 120 🪙', value: 'depassement'  },
        { name: 'Freinage       — à partir de 120 🪙', value: 'freinage'     },
        { name: 'Défense        — à partir de 100 🪙', value: 'defense'      },
        { name: 'Adaptabilité   — à partir de  90 🪙', value: 'adaptabilite' },
        { name: 'Réactions      — à partir de  90 🪙', value: 'reactions'    },
        { name: 'Contrôle       — à partir de 110 🪙', value: 'controle'     },
        { name: 'Gestion Pneus  — à partir de  90 🪙', value: 'gestionPneus' },
      ))
    .addIntegerOption(o => o.setName('quantite').setDescription('Nombre de points à ajouter (défaut: 1). Le coût est cumulatif !').setMinValue(1).setMaxValue(10))
    .addIntegerOption(o => o.setName('pilote').setDescription('Ton Pilote 1 ou Pilote 2 à améliorer (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('ecuries')
    .setDescription('Liste des 8 écuries'),

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
    .setDescription('Voir ton contrat actuel')
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('offres')
    .setDescription('Voir tes offres de contrat')
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('accepter_offre')
    .setDescription('Accepter une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('refuser_offre')
    .setDescription('Refuser une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('admin_new_season')
    .setDescription('[ADMIN] Lance une nouvelle saison'),

  new SlashCommandBuilder().setName('admin_force_practice')
    .setDescription('[ADMIN] Force les essais libres du GP en cours (ou d\'un GP précis)')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP (0=GP1, 1=GP2...) — défaut: GP en cours').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_force_quali')
    .setDescription('[ADMIN] Force les qualifications du GP en cours (ou d\'un GP précis)')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP — défaut: GP en cours').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_force_race')
    .setDescription('[ADMIN] Force la course du GP en cours (ou d\'un GP précis)')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP — défaut: GP en cours').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_apply_last_race')
    .setDescription('[ADMIN] Applique manuellement les résultats du dernier GP simulé (si points non crédités)')
    .addStringOption(o => o.setName('race_id').setDescription('ID MongoDB de la course (optionnel — défaut: dernier GP simulé)').setRequired(false)),

  new SlashCommandBuilder().setName('admin_inject_results')
    .setDescription('[ADMIN] Injecte manuellement les résultats d\'un GP terminé sans points')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP — défaut: dernier GP done').setMinValue(0)),
  new SlashCommandBuilder().setName('admin_stop_race')
    .setDescription('[ADMIN] Stoppe la course en cours immédiatement — résultats non comptabilisés'),
  new SlashCommandBuilder().setName('admin_fix_slots')
    .setDescription('[ADMIN] Recalcule les slots matin/soir des GP de la saison active.'),
  new SlashCommandBuilder().setName('admin_skip_gp')
    .setDescription('[ADMIN] Saute le GP en cours sans le simuler (rattraper un retard)')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP à sauter — défaut: GP en cours').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_set_race_results')
    .setDescription(`[ADMIN] Saisit manuellement le classement d'un GP (si la simulation a planté)`)
    .addStringOption(o => o.setName('classement').setDescription(`Noms des pilotes dans l'ordre, séparés par des virgules. Ex: Alice,Bob,Charlie`).setRequired(true))
    .addStringOption(o => o.setName('dnf').setDescription('Noms des pilotes DNF, séparés par des virgules (optionnel)').setRequired(false))
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP (défaut: GP en cours)').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_transfer')
    .setDescription('[ADMIN] Lance la période de transfert'),

  new SlashCommandBuilder().setName('admin_evolve_cars')
    .setDescription('[ADMIN] Affiche l\'évolution des voitures cette saison'),

  new SlashCommandBuilder().setName('historique')
    .setDescription('Historique de carrière multi-saisons d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible (toi par défaut)'))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('pilotes')
    .setDescription('Liste tous les pilotes classés par note générale (style FIFA)'),

  new SlashCommandBuilder().setName('admin_set_photo')
    .setDescription('[ADMIN] Définit la photo de profil d\'un pilote')
    .addStringOption(o => o.setName('url').setDescription('URL directe de l\'image (jpg/png/gif)').setRequired(true))
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible (laisse vide pour toi-même)'))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('admin_draft_start')
    .setDescription('[ADMIN] Lance le draft snake — chaque joueur choisit son écurie'),

  new SlashCommandBuilder().setName('palmares')
    .setDescription('🏛️ Hall of Fame — Champions de chaque saison'),

  new SlashCommandBuilder().setName('rivalite')
    .setDescription('⚔️ Voir ta rivalité actuelle en saison')
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('admin_reset_rivalites')
    .setDescription('[ADMIN] Réinitialise toutes les rivalités en début de saison'),

  new SlashCommandBuilder().setName('admin_test_race')
    .setDescription('[ADMIN] Simule une course fictive avec pilotes fictifs — test visuel'),

  new SlashCommandBuilder().setName('admin_test_practice')
    .setDescription('[ADMIN] Simule des essais libres fictifs — test narration'),

  new SlashCommandBuilder().setName('admin_test_qualif')
    .setDescription('[ADMIN] Simule des qualifications fictives — test narration'),

  new SlashCommandBuilder().setName('admin_reset_pilot')
    .setDescription('[ADMIN] Supprime le ou les pilotes d\'un joueur (utile pour les tests)')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1, 2, ou laisser vide pour supprimer les DEUX').setMinValue(1).setMaxValue(2)),

  new SlashCommandBuilder().setName('admin_help')
    .setDescription('[ADMIN] Liste toutes les commandes administrateur'),

  new SlashCommandBuilder().setName('f1')
    .setDescription('Liste toutes tes commandes joueur disponibles'),

  new SlashCommandBuilder().setName('concept')
    .setDescription('Présentation complète du jeu F1 PL — pour les nouveaux !'),

  new SlashCommandBuilder().setName('performances')
    .setDescription('📊 Historique détaillé des GPs, équipes et records d\'un pilote')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur cible (toi par défaut)'))
    .addIntegerOption(o => o.setName('pilote').setDescription('Pilote 1 ou 2 (défaut: 1)').setMinValue(1).setMaxValue(2))
    .addStringOption(o => o.setName('vue').setDescription('Que veux-tu voir ?')
      .addChoices(
        { name: '🕐 Récents — 10 derniers GPs', value: 'recent' },
        { name: '🏆 Records — Meilleurs résultats', value: 'records' },
        { name: '🏎️ Écuries — Historique des équipes', value: 'teams' },
        { name: '📅 Saison — GPs d\'une saison', value: 'season' },
      )),

  new SlashCommandBuilder().setName('record_circuit')
    .setDescription('⏱️ Consulte le record du meilleur tour sur un circuit')
    .addStringOption(o => o.setName('circuit').setDescription('Nom du circuit (partiel accepté)').setRequired(true)),

  new SlashCommandBuilder().setName('news')
    .setDescription('🗞️ Derniers articles du paddock — rumeurs, drama, inside')
    .addIntegerOption(o => o.setName('page').setDescription('Page (défaut: 1)').setMinValue(1)),

  new SlashCommandBuilder().setName('admin_news_force')
    .setDescription('[ADMIN] Force la publication d\'un article de news maintenant'),
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
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connecté');
  } catch(mongoErr) {
    console.error('❌ ERREUR MongoDB connexion :', mongoErr.message);
    console.error('❌ URI utilisée :', MONGO_URI ? MONGO_URI.replace(/:([^@]+)@/, ':***@') : 'NON DÉFINIE');
    process.exit(1);
  }

  // ── Supprime l'ancien index unique sur discordId (incompatible avec 2 pilotes par user) ──
  try {
    await Pilot.collection.dropIndex('discordId_1');
    console.log('✅ Ancien index unique discordId supprimé');
  } catch (_) {
    // L'index n'existe plus (déjà supprimé ou jamais créé) — pas de souci
  }

  const teamCount = await Team.countDocuments();
  if (teamCount === 0) {
    await Team.insertMany(DEFAULT_TEAMS);
    console.log('✅ 8 écuries créées');
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('✅ Slash commands enregistrées');
  } catch(cmdErr) {
    console.error('❌ ERREUR enregistrement slash commands :', cmdErr.message);
    console.error('❌ CLIENT_ID:', CLIENT_ID || 'NON DÉFINI');
    console.error('❌ GUILD_ID:', GUILD_ID || 'NON DÉFINI');
  }
  startScheduler();

  // ── Job news 2 fois par jour via cron (résiste aux redémarrages) ──
  // 10h00 et 21h00 heure de Paris — loin des créneaux de course pour ne pas noyer les articles
  cron.schedule('0 10 * * *', async () => {
    try { await runScheduledNews(client); } catch(e) { console.error('Scheduled news 10h error:', e); }
  }, { timezone: 'Europe/Paris' });
  cron.schedule('0 21 * * *', async () => {
    try { await runScheduledNews(client); } catch(e) { console.error('Scheduled news 21h error:', e); }
  }, { timezone: 'Europe/Paris' });
  console.log('✅ Job news planifié : 10h00 et 21h00 (Europe/Paris)');
});

// ============================================================
// ██╗  ██╗ █████╗ ███╗   ██╗██████╗ ██╗     ███████╗██████╗ ███████╗
// ██║  ██║██╔══██╗████╗  ██║██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
// ███████║███████║██╔██╗ ██║██║  ██║██║     █████╗  ██████╔╝███████╗
// ██╔══██║██╔══██║██║╚██╗██║██║  ██║██║     ██╔══╝  ██╔══██╗╚════██║
// ██║  ██║██║  ██║██║ ╚████║██████╔╝███████╗███████╗██║  ██║███████║
// ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// ============================================================

// ─── Coûts d'amélioration ────────────────────────────────────
// Gain : toujours +1 par achat
// Coût de base par stat, avec malus progressif selon le niveau actuel :
//   coût_réel = coût_base × (1 + (stat_actuelle - 50) / 50)
//   → À 50 : coût normal. À 75 : ×1.5. À 99 : ×1.98.
//
// Calibrage cible (sans salaire) :
//   P1 (560 coins)   → 3-4 upgrades par course
//   P3 (360 coins)   → 2-3 upgrades
//   P10 (80 coins)   → 1 upgrade toutes les 1-2 courses
//   P20 (120 coins)  → 1 upgrade toutes les 1-2 courses
const STAT_COST_BASE = {
  depassement: 100, freinage: 100, defense: 85,
  adaptabilite: 75, reactions: 75, controle: 90, gestionPneus: 75,
};

function calcUpgradeCost(statKey, currentValue) {
  const base = STAT_COST_BASE[statKey] || 85;
  const multiplier = 1 + Math.max(0, (currentValue - 50)) / 50;
  return Math.round(base * multiplier);
}

// ─── Spécialisations ─────────────────────────────────────────
// Déblocage après 3 upgrades CONSÉCUTIFS sur la même stat.
// Chaque spécialisation donne un micro-bonus en simulation de course.
const SPECIALIZATION_META = {
  depassement  : { label: '⚔️ Maître du Dépassement',  desc: '+3% eff. dépassement en piste'    },
  freinage     : { label: '🛑 Roi du Freinage',          desc: '+3% perf. en zones de freinage'   },
  defense      : { label: '🛡️ Mur de la Défense',        desc: '+3% résistance aux dépassements'  },
  adaptabilite : { label: '🌦️ Caméléon',                 desc: '+3% sous conditions variables'    },
  reactions    : { label: '⚡ Réflexes de Serpent',      desc: '+3% au départ & incidents'        },
  controle     : { label: '🎯 Chirurgien du Volant',     desc: '+3% consistance sur un tour'      },
  gestionPneus : { label: '🏎️ Sorcier des Gommes',       desc: '+3% durée de vie des pneus'       },
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

      const draftId = interaction.customId.replace('draft_pick_', '');
      const pilotId = interaction.values[0];

      let draft;
      try { draft = await DraftSession.findById(draftId); } catch(e) {}
      if (!draft || draft.status !== 'active')
        return interaction.reply({ content: '❌ Draft introuvable ou terminé.', ephemeral: true });

      if (draft.picks.some(pk => String(pk.pilotId) === pilotId))
        return interaction.reply({ content: '❌ Ce pilote a déjà été sélectionné !', ephemeral: true });

      const teamId = String(draftTeamAtIndex(draft.order, draft.currentPickIndex));
      const team   = await Team.findById(teamId);
      const pilot  = await Pilot.findById(pilotId);
      if (!team || !pilot) return interaction.reply({ content: '❌ Données introuvables.', ephemeral: true });

      const globalPick  = draft.currentPickIndex;
      const totalInRound = draft.order.length;
      const round        = Math.floor(globalPick / totalInRound) + 1;
      const pickInRound  = (globalPick % totalInRound) + 1;

      // ① Suspense : on retire le menu, on affiche "en cours..."
      const suspenseEmbed = new EmbedBuilder()
        .setColor(team.color || '#FFD700')
        .setTitle(`⚡  ${team.emoji}  ${team.name.toUpperCase()}  FAIT SON CHOIX...`)
        .setDescription('> *Le silence s\'est installé dans le war room. La décision est imminente.*')
        .setFooter({ text: `Round ${round} · Pick ${pickInRound}/${totalInRound}` });

      await interaction.update({ embeds: [suspenseEmbed], components: [] });

      // ② Assigner pilote + créer contrat
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

      draft.picks.push({ teamId: team._id, pilotId: pilot._id });
      draft.currentPickIndex += 1;

      const isLast = draft.currentPickIndex >= draft.totalPicks;

      // ③ Reveal cinématique
      const revealEmbed = buildPickRevealEmbed(
        team, pilot, globalPick, draft.totalPicks, round, pickInRound, totalInRound
      );
      await interaction.followUp({ embeds: [revealEmbed] });

      if (isLast) {
        // ── Draft terminé ──────────────────────────────────
        draft.status = 'done';
        await draft.save();

        // Récap final : toutes les écuries et leurs pilotes
        const allTeams  = await Team.find();
        const allPilots = await Pilot.find({ teamId: { $in: allTeams.map(t => t._id) } });
        const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));

        const recapLines = allTeams.map(t => {
          const roster = allPilots.filter(p => String(p.teamId) === String(t._id));
          const names  = roster.map(p => {
            const ov  = overallRating(p);
            const ti  = ratingTier(ov);
            const flag = p.nationality?.split(' ')[0] || '';
            return `  ${ti.badge} **${p.name}** ${flag} #${p.racingNumber || '?'} (${ov})`;
          }).join('\n') || '  *Aucun pilote*';
          return `${t.emoji} **${t.name}**\n${names}`;
        }).join('\n\n');

        const closingEmbed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🏆  DRAFT TERMINÉE — LES ÉCURIES SONT FORMÉES !')
          .setDescription('> *Le championnat peut commencer. Que le meilleur pilote gagne.*\n\u200B')
          .addFields({ name: '📋 Composition des écuries', value: recapLines.slice(0, 4096) })
          .setFooter({ text: `${draft.totalPicks} picks réalisés · Bonne saison 🏎️💨` });

        await interaction.followUp({ embeds: [closingEmbed] });
      } else {
        await draft.save();

        // ④ Prochain "On The Clock"
        const nextTeamId   = draftTeamAtIndex(draft.order, draft.currentPickIndex);
        const nextTeam     = await Team.findById(nextTeamId);
        const pickedIds    = draft.picks.map(pk => String(pk.pilotId));
        const freePilots   = await Pilot.find({ _id: { $nin: pickedIds } }).sort({ createdAt: 1 });
        const sortedFree   = [...freePilots].sort((a, b) => overallRating(b) - overallRating(a));

        const nextGlobal   = draft.currentPickIndex;
        const nextRound    = Math.floor(nextGlobal / totalInRound) + 1;
        const nextPickInR  = (nextGlobal % totalInRound) + 1;

        // Annonce de changement de round si nécessaire
        if (nextPickInR === 1 && nextRound > 1) {
          const roundEmbed = new EmbedBuilder()
            .setColor('#C0C0C0')
            .setTitle(`🔄  ROUND ${nextRound} — L'ORDRE S'INVERSE !`)
            .setDescription('> *Le snake draft reprend dans l\'ordre inverse. La chasse est relancée.*');
          await interaction.followUp({ embeds: [roundEmbed] });
        }

        const clockPayload = buildOnTheClockPayload(
          nextTeam, nextGlobal, draft.totalPicks, nextRound, nextPickInR, totalInRound, sortedFree, String(draft._id)
        );
        await interaction.followUp(clockPayload);
      }
      return;
    }
  }

  if (interaction.isButton()) {
    const [, action, offerId] = interaction.customId.split('_');  // offer_accept_<id> / offer_reject_<id>
    if (action !== 'accept' && action !== 'reject') return;

    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || offer.status !== 'pending') {
      return interaction.reply({
        content: '❌ Cette offre est expirée ou invalide. Utilise `/offres` pour rafraîchir, ou `/accepter_offre <ID>` en secours.',
        ephemeral: true,
      });
    }
    // Vérifier que l'offre appartient à un pilote de ce joueur
    const pilot = await Pilot.findById(offer.pilotId);
    if (!pilot || pilot.discordId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Cette offre ne t\'appartient pas.', ephemeral: true });
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

  // ── Defer immédiat pour éviter le timeout Discord (3s) ───
  // Les commandes admin_force_* et celles avec reply immédiat gèrent leur propre réponse
  const NO_DEFER = ['admin_force_practice', 'admin_force_quali', 'admin_force_race',
    'admin_news_force', 'admin_new_season', 'admin_transfer', 'admin_apply_last_race', 'admin_skip_gp', 'admin_set_race_results', 'admin_inject_results', 'admin_fix_slots', 'admin_stop_race'];
  const isEphemeral = ['create_pilot','profil','ameliorer','mon_contrat','offres',
    'accepter_offre','refuser_offre','admin_set_photo','admin_reset_pilot','admin_help',
    'f1','admin_news_force','concept','admin_apply_last_race'].includes(commandName);
  if (!NO_DEFER.includes(commandName)) {
    await interaction.deferReply({ ephemeral: isEphemeral });
  }

  // ── /create_pilot ─────────────────────────────────────────
  if (commandName === 'create_pilot') {
    // Vérifier combien de pilotes ce joueur a déjà
    const existingPilots = await getAllPilotsForUser(interaction.user.id);
    if (existingPilots.length >= 2) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Limite atteinte')
          .setColor('#CC4444')
          .setDescription(
            `Tu as déjà **2 pilotes** — c'est le maximum par joueur.\n\n` +
            existingPilots.map(p => `• ${pilotLabel(p)}`).join('\n')
          )
        ],
        ephemeral: true,
      });
    }

    const nom         = interaction.options.getString('nom');
    const nationalite = interaction.options.getString('nationalite');
    const numero      = interaction.options.getInteger('numero');

    if (nom.length < 2 || nom.length > 30)
      return interaction.editReply({ content: '❌ Nom entre 2 et 30 caractères.', ephemeral: true });

    // Vérifier que le numéro n'est pas déjà pris
    const numTaken = await Pilot.findOne({ racingNumber: numero });
    if (numTaken)
      return interaction.editReply({ content: `❌ Le numéro **#${numero}** est déjà pris par **${numTaken.name}**. Choisis un autre !`, ephemeral: true });

    // Récupérer les bonus de stats fournis (null = non fourni)
    const statOptions = {
      depassement  : interaction.options.getInteger('depassement'),
      freinage     : interaction.options.getInteger('freinage'),
      defense      : interaction.options.getInteger('defense'),
      adaptabilite : interaction.options.getInteger('adaptabilite'),
      reactions    : interaction.options.getInteger('reactions'),
      controle     : interaction.options.getInteger('controle'),
      gestionPneus : interaction.options.getInteger('gestionpneus'),
    };

    const statKeys    = Object.keys(statOptions);
    const provided    = statKeys.filter(k => statOptions[k] !== null);
    const totalGiven  = provided.reduce((s, k) => s + statOptions[k], 0);

    let finalBonuses;

    if (provided.length === 0) {
      // Aucune stat fournie → répartition aléatoire équilibrée
      let pool = TOTAL_STAT_POOL;
      const bonuses = statKeys.map(() => 0);
      const indices = statKeys.map((_,i) => i);
      // Distribution aléatoire : ajouter des points un par un à des stats aléatoires
      for (let i = 0; i < pool; i++) {
        let idx;
        do { idx = Math.floor(Math.random() * statKeys.length); }
        while (bonuses[idx] >= MAX_STAT_BONUS);
        bonuses[idx]++;
      }
      finalBonuses = {};
      statKeys.forEach((k, i) => finalBonuses[k] = bonuses[i]);
    } else {
      // Des stats ont été fournies — vérifier que la somme fait exactement TOTAL_STAT_POOL
      if (provided.length < statKeys.length) {
        // Stats partiellement remplies → distribuer le reste également sur les non-remplies
        const remaining   = TOTAL_STAT_POOL - totalGiven;
        const unfilled    = statKeys.filter(k => statOptions[k] === null);
        const perUnfilled = Math.floor(remaining / unfilled.length);
        const extra       = remaining % unfilled.length;
        finalBonuses = { ...statOptions };
        unfilled.forEach((k, i) => finalBonuses[k] = perUnfilled + (i < extra ? 1 : 0));
      } else {
        finalBonuses = { ...statOptions };
      }

      // Validation finale
      const finalTotal = statKeys.reduce((s, k) => s + finalBonuses[k], 0);
      if (finalTotal !== TOTAL_STAT_POOL) {
        const diff = finalTotal - TOTAL_STAT_POOL;
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Répartition de stats invalide')
            .setColor('#CC4444')
            .setDescription(
              `La somme de tes points de stats est **${finalTotal}** — il en faut exactement **${TOTAL_STAT_POOL}**.\n\n` +
              (diff > 0 ? `Tu as **${diff} points en trop**. Réduis certaines stats.` : `Il te manque **${-diff} points**. Ajoutes-en sur d'autres stats.`) + '\n\n' +
              `💡 **Répartition suggérée (10 pts par stat) :**\n> /create_pilot nom:${nom} nationalite:${nationalite} numero:${numero} depassement:10 freinage:10 defense:10 adaptabilite:10 reactions:10 controle:10 gestionpneus:10\n\n` +
              `🎲 Ou laisse toutes les stats vides pour une **répartition aléatoire** !`
            )
          ],
          ephemeral: true,
        });
      }
    }

    // Vérifier les valeurs max
    for (const k of statKeys) {
      if (finalBonuses[k] > MAX_STAT_BONUS) {
        return interaction.editReply({ content: `❌ La stat **${k}** dépasse le maximum autorisé de ${MAX_STAT_BONUS} points.`, ephemeral: true });
      }
    }

    const pilotIndex = existingPilots.length + 1; // 1 ou 2

    const pilot = await Pilot.create({
      discordId   : interaction.user.id,
      pilotIndex,
      name        : nom,
      nationality : nationalite,
      racingNumber: numero,
      depassement : BASE_STAT_VALUE + finalBonuses.depassement,
      freinage    : BASE_STAT_VALUE + finalBonuses.freinage,
      defense     : BASE_STAT_VALUE + finalBonuses.defense,
      adaptabilite: BASE_STAT_VALUE + finalBonuses.adaptabilite,
      reactions   : BASE_STAT_VALUE + finalBonuses.reactions,
      controle    : BASE_STAT_VALUE + finalBonuses.controle,
      gestionPneus: BASE_STAT_VALUE + finalBonuses.gestionPneus,
      plcoins     : 500,
    });

    const bar      = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10 - Math.round(v/10));
    const ovCreate = overallRating(pilot);
    const tierCr   = ratingTier(ovCreate);

    const isRandomized = provided.length === 0;
    const styleDesc = statKeys.map(k => {
      const bonus = finalBonuses[k];
      const stars  = bonus >= 25 ? ' ⭐' : bonus >= 20 ? ' ✦' : bonus >= 15 ? ' •' : '';
      const statLabels2 = { depassement:'Dépassement  ', freinage:'Freinage     ', defense:'Défense      ', adaptabilite:'Adaptabilité ', reactions:'Réactions    ', controle:'Contrôle     ', gestionPneus:'Gestion Pneus' };
      const v = BASE_STAT_VALUE + bonus;
      return `\`${statLabels2[k]}\` ${bar(v)}  **${v}** (+${bonus})${stars}`;
    }).join('\n');

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle(`🏎️ Pilote ${pilotIndex}/2 créé : #${numero} ${pilot.name}`)
        .setColor(tierCr.color)
        .setDescription(
          `${nationalite}  •  **Pilote ${pilotIndex}**  •  Numéro #${numero}\n` +
          `## ${tierCr.badge} **${ovCreate}** — ${tierCr.label}\n\n` +
          styleDesc + '\n\n' +
          `💰 **500 PLcoins** de départ\n` +
          (isRandomized ? `🎲 *Stats réparties aléatoirement — pool de ${TOTAL_STAT_POOL} pts*` : `🎯 *Stats personnalisées — pool de ${TOTAL_STAT_POOL} pts répartis*`)
        )
        .setFooter({ text: pilotIndex < 2 ? 'Tu peux créer un 2ème pilote avec /create_pilot ! Attends le draft pour rejoindre une écurie.' : 'Tes 2 pilotes sont créés ! Attends le draft ou la période de transfert.' })
      ],
    });
  }

  // ── /profil ───────────────────────────────────────────────
  if (commandName === 'profil') {
    const target     = interaction.options.getUser('joueur') || interaction.user;
    const pilotIndex = interaction.options.getInteger('pilote') || 1;

    // Si l'utilisateur a 2 pilotes et n'a pas précisé lequel, montrer les deux
    const allUserPilots = await getAllPilotsForUser(target.id);
    if (!allUserPilots.length) return interaction.editReply({ content: `❌ Aucun pilote pour <@${target.id}>.`, ephemeral: true });

    // Si l'utilisateur a 2 pilotes et demande son profil sans préciser → afficher le choix
    if (allUserPilots.length > 1 && !interaction.options.getInteger('pilote') && target.id === interaction.user.id) {
      const listStr = allUserPilots.map(p => {
        const ov = overallRating(p); const tier = ratingTier(ov);
        const flag = p.nationality?.split(' ')[0] || '';
        return `**Pilote ${p.pilotIndex}** — ${flag} #${p.racingNumber || '?'} **${p.name}** ${tier.badge} ${ov}`;
      }).join('\n');
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle(`🏎️ Tes pilotes`)
          .setColor('#FF1801')
          .setDescription(listStr + '\n\n*Utilise `/profil pilote:1` ou `/profil pilote:2` pour voir le détail.*')
        ],
        ephemeral: true,
      });
    }

    const pilot = await getPilotForUser(target.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: `❌ Aucun Pilote ${pilotIndex} pour <@${target.id}>.`, ephemeral: true });

    const team     = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    const season   = await getActiveSeason();
    const standing = season ? await Standing.findOne({ seasonId: season._id, pilotId: pilot._id }) : null;
    const bar      = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));

    const ov   = overallRating(pilot);
    const tier = ratingTier(ov);
    const numTag  = pilot.racingNumber ? ` #${pilot.racingNumber}` : '';
    const flagTag = pilot.nationality  ? ` ${pilot.nationality}`  : '';
    const embed = new EmbedBuilder()
      .setTitle(`${team?.emoji || '🏎️'}${numTag} ${pilot.name} — Pilote ${pilot.pilotIndex}`)
      .setColor(tier.color)
      .setThumbnail(pilot.photoUrl || null)
      .setDescription(
        `${flagTag}  •  **Pilote ${pilot.pilotIndex}/2**\n` +
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

    // Spécialisation
    if (pilot.specialization) {
      const specMeta = SPECIALIZATION_META[pilot.specialization];
      embed.addFields({ name: '🏅 Spécialisation',
        value: specMeta ? `**${specMeta.label}** — *${specMeta.desc}*` : pilot.specialization,
      });
    } else if (pilot.upgradeStreak >= 1 && pilot.lastUpgradeStat) {
      const statLabels = { depassement:'Dépassement', freinage:'Freinage', defense:'Défense', adaptabilite:'Adaptabilité', reactions:'Réactions', controle:'Contrôle', gestionPneus:'Gestion Pneus' };
      const bar = '🔥'.repeat(pilot.upgradeStreak) + '⬜'.repeat(Math.max(0, 3 - pilot.upgradeStreak));
      embed.addFields({ name: '📈 Progression spécialisation',
        value: `${bar} **${pilot.upgradeStreak}/3** upgrades consécutifs sur **${statLabels[pilot.lastUpgradeStat] || pilot.lastUpgradeStat}**`,
      });
    }

    // Rivalité
    if (pilot.rivalId) {
      const rival = await Pilot.findById(pilot.rivalId);
      const rivalTeam = rival?.teamId ? await Team.findById(rival.teamId) : null;
      embed.addFields({ name: '⚔️ Rivalité',
        value: `${rivalTeam?.emoji || ''} **${rival?.name || '?'}** — ${pilot.rivalContacts || 0} contact(s) en course cette saison`,
      });
    }

    // ── Statut coéquipier ────────────────────────────────────
    if (team && pilot.teamStatus) {
      const teammate = await Pilot.findOne({
        teamId: team._id,
        _id: { $ne: pilot._id },
      });
      const statusLabel = pilot.teamStatus === 'numero1'
        ? `🔴 **Pilote N°1** — ${pilot.teammateDuelWins || 0} duels gagnés`
        : `🔵 **Pilote N°2** — ${pilot.teammateDuelWins || 0} duels gagnés`;
      const teammateStr = teammate
        ? `vs ${teammate.name} (${teammate.teammateDuelWins || 0} duels)`
        : '';
      embed.addFields({ name: '👥 Statut dans l\'équipe', value: `${statusLabel}${teammateStr ? '  ·  ' + teammateStr : ''}` });
    }

    // ── Aperçu rapide des performances (GPRecord) ────────────
    const gpRecs = await PilotGPRecord.find({ pilotId: pilot._id }).sort({ raceDate: -1 });
    if (gpRecs.length) {
      const totalGPs   = gpRecs.length;
      const finished   = gpRecs.filter(r => !r.dnf);
      const wins       = finished.filter(r => r.finishPos === 1).length;
      const podiums    = finished.filter(r => r.finishPos <= 3).length;
      const dnfsTotal  = gpRecs.filter(r => r.dnf).length;
      const flaps      = gpRecs.filter(r => r.fastestLap).length;
      const avgPos     = finished.length ? (finished.reduce((s, r) => s + r.finishPos, 0) / finished.length).toFixed(1) : '—';
      const best       = finished.sort((a, b) => a.finishPos - b.finishPos)[0];

      // Forme : 5 derniers en icônes
      const formIcons  = gpRecs.slice(0, 5).map(r => {
        if (r.dnf) return '❌';
        if (r.finishPos === 1) return '🥇';
        if (r.finishPos <= 3) return '🏆';
        if (r.finishPos <= 10) return '✅';
        return '▪️';
      }).join('');

      const perfLine =
        `🥇 **${wins}V** · 🏆 **${podiums}P** · ❌ **${dnfsTotal}** DNF · ⚡ **${flaps}** FL · moy. **P${avgPos}**` +
        (best ? `\n⭐ Meilleur : **P${best.finishPos}** ${best.circuitEmoji} ${best.circuit} *(S${best.seasonYear})*` : '');

      embed.addFields({ name: `📊 Carrière — ${totalGPs} GP(s)  ·  Forme : ${formIcons}`, value: perfLine });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /ameliorer ────────────────────────────────────────────
  if (commandName === 'ameliorer') {
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const pilot = await getPilotForUser(interaction.user.id, pilotIndex);
    if (!pilot) {
      const allP = await getAllPilotsForUser(interaction.user.id);
      if (!allP.length) return interaction.editReply({ content: '❌ Crée d\'abord ton pilote avec `/create_pilot`.', ephemeral: true });
      return interaction.editReply({ content: `❌ Tu n'as pas de Pilote ${pilotIndex}. Tes pilotes : ${allP.map(p => `Pilote ${p.pilotIndex} (${p.name})`).join(', ')}`, ephemeral: true });
    }

    const statKey  = interaction.options.getString('stat');
    const quantite = interaction.options.getInteger('quantite') || 1;
    const current  = pilot[statKey];
    const MAX_STAT = 99;

    if (current >= MAX_STAT) return interaction.editReply({ content: '❌ Stat déjà au maximum (99) !', ephemeral: true });

    // ── Calcul du coût cumulatif (upgrade 1 par 1, comme si fait séparément) ──
    const maxPossible = Math.min(quantite, MAX_STAT - current);
    let totalCost = 0;
    for (let i = 0; i < maxPossible; i++) {
      totalCost += calcUpgradeCost(statKey, current + i);
    }

    if (pilot.plcoins < totalCost) {
      const missing = totalCost - pilot.plcoins;
      // Calculer combien on peut s'offrir avec le solde actuel
      let affordable = 0;
      let affordCost = 0;
      for (let i = 0; i < maxPossible; i++) {
        const stepCost = calcUpgradeCost(statKey, current + i);
        if (affordCost + stepCost <= pilot.plcoins) { affordable++; affordCost += stepCost; }
        else break;
      }
      const costBreakdown = maxPossible > 1
        ? `\n*Détail : ${Array.from({length: maxPossible}, (_, i) => `+1 = ${calcUpgradeCost(statKey, current + i)} 🪙`).join(' · ')}*`
        : '';
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ PLcoins insuffisants')
          .setColor('#CC4444')
          .setDescription(
            `**${statKey}** est actuellement à **${current}** — coût total pour +${maxPossible} : **${totalCost} 🪙**\n` +
            `Tu as **${pilot.plcoins} 🪙** — il te manque **${missing} 🪙**.` +
            costBreakdown +
            (affordable > 0 ? `\n\n💡 Tu peux te permettre **+${affordable}** pour **${affordCost} 🪙** — essaie \`/ameliorer quantite:${affordable}\` !` : '\n\n💡 Continue à courir pour accumuler des PLcoins !')
          )
        ],
        ephemeral: true,
      });
    }

    const gain     = maxPossible;
    const ovBefore = overallRating(pilot);
    const newValue = current + gain;
    const nextCost = newValue < MAX_STAT ? calcUpgradeCost(statKey, newValue) : null;
    const remaining = pilot.plcoins - totalCost;

    // ── Tracker de streak de spécialisation ──────────────────
    const isSameStat  = pilot.lastUpgradeStat === statKey;
    const newStreak   = isSameStat ? (pilot.upgradeStreak || 0) + gain : gain;
    // Déblocage : 3 consécutifs cumulés ET pas de spécialisation déjà active
    const unlockSpec  = newStreak >= 3 && !pilot.specialization;

    const updateFields = {
      $inc: { plcoins: -totalCost },
      $set: {
        [statKey]       : newValue,
        lastUpgradeStat : statKey,
        upgradeStreak   : unlockSpec ? 0 : newStreak,
        ...(unlockSpec ? { specialization: statKey } : {}),
      },
    };
    await Pilot.findByIdAndUpdate(pilot._id, updateFields);

    // ── Calcul du nouvel overall pour détecter un gain ────────
    const updatedPilot = { ...pilot.toObject(), [statKey]: newValue };
    const ovAfter = overallRating(updatedPilot);
    const ovGain  = ovAfter - ovBefore;

    const statLabels = {
      depassement: 'Dépassement', freinage: 'Freinage', defense: 'Défense',
      adaptabilite: 'Adaptabilité', reactions: 'Réactions', controle: 'Contrôle', gestionPneus: 'Gestion Pneus',
    };

    const specMeta = SPECIALIZATION_META[statKey];
    const streakBar = '🔥'.repeat(Math.min(newStreak, 3)) + '⬜'.repeat(Math.max(0, 3 - Math.min(newStreak, 3)));

    const costBreakdownStr = gain > 1
      ? `\n> *Coût détaillé : ${Array.from({length: gain}, (_, i) => `${calcUpgradeCost(statKey, current + i)} 🪙`).join(' + ')} = **${totalCost} 🪙***`
      : '';

    const descLines = [
      `**${statLabels[statKey] || statKey}** : ${current} → **${newValue}** (+${gain})`,
      `💸 −${totalCost} 🪙 · Solde : **${remaining} 🪙**${costBreakdownStr}`,
    ];

    // ── 🌟 Notification gain d'overall ───────────────────────
    if (ovGain > 0) {
      const tierBefore = ratingTier(ovBefore);
      const tierAfter  = ratingTier(ovAfter);
      const tierChanged = tierBefore.label !== tierAfter.label;
      descLines.push(
        `\n⭐ **NOTE GÉNÉRALE : ${ovBefore} → ${ovAfter}** (+${ovGain}) ${ovGain >= 2 ? '🚀' : '📈'}` +
        (tierChanged ? `\n🎉 **NOUVEAU PALIER : ${tierAfter.badge} ${tierAfter.label} !** *(anciennement ${tierBefore.badge} ${tierBefore.label})*` : '')
      );
    }

    if (unlockSpec && specMeta) {
      descLines.push(`\n🏅 **SPÉCIALISATION DÉBLOQUÉE !**`);
      descLines.push(`**${specMeta.label}**`);
      descLines.push(`*${specMeta.desc}*`);
      descLines.push(`\n3 upgrades consécutifs sur **${statLabels[statKey]}** — tu as forgé une identité !`);
    } else if (pilot.specialization) {
      const existingSpec = SPECIALIZATION_META[pilot.specialization];
      descLines.push(`\n✅ Spécialisation active : **${existingSpec?.label || pilot.specialization}**`);
    } else {
      // Progression vers spécialisation
      const streakDisplay = isSameStat ? `${streakBar} ${Math.min(newStreak,3)}/3` : `${streakBar} 1/3 *(streak réinitialisé)*`;
      descLines.push(`\n${newStreak >= 2 ? '🔥' : '📌'} **Progression spécialisation :** ${streakDisplay}`);
      if (newStreak < 3) descLines.push(`*Continue sur **${statLabels[statKey]}** pour débloquer : ${specMeta?.label || ''}*`);
    }

    if (newValue >= MAX_STAT) descLines.push(`\n🔒 **Maximum (99) atteint.**`);
    else if (nextCost) descLines.push(`📌 Prochain upgrade : **${nextCost} 🪙**`);

    const titleBase = unlockSpec
      ? `🏅 Spécialisation débloquée — ${pilot.name} !`
      : ovGain > 0
        ? `⭐ Amélioration — ${pilot.name} monte à **${ovAfter}** !`
        : gain > 1
          ? `📈 +${gain} ${statLabels[statKey]} — ${pilot.name} (Pilote ${pilot.pilotIndex})`
          : `📈 Amélioration — ${pilot.name} (Pilote ${pilot.pilotIndex})`;

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle(titleBase)
        .setColor(unlockSpec ? '#FF6600' : ovGain > 0 ? '#00C851' : '#FFD700')
        .setDescription(descLines.join('\n'))
      ],
    });
  }

  // ── /palmares ─────────────────────────────────────────────
  if (commandName === 'palmares') {
    const entries = await HallOfFame.find().sort({ seasonYear: -1 });
    if (!entries.length) {
      return interaction.editReply({ content: '🏛️ Le Hall of Fame est vide — aucune saison terminée pour l\'instant.', ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle('🏛️ HALL OF FAME — Champions F1 PL')
      .setColor('#FFD700');

    for (const e of entries) {
      const specNote = e.topRatedName ? `\n👑 Meilleur pilote en fin de saison : **${e.topRatedName}** *(${e.topRatedOv})*` : '';
      const mostWinsNote = e.mostWinsName && e.mostWinsCount > 0 ? `\n🏆 Roi des victoires : **${e.mostWinsName}** (${e.mostWinsCount}V)` : '';
      const mostDnfsNote = e.mostDnfsName && e.mostDnfsCount > 0 ? `\n💀 Malchance : **${e.mostDnfsName}** (${e.mostDnfsCount} DNF)` : '';
      embed.addFields({
        name: `Saison ${e.seasonYear}`,
        value: [
          `${e.champTeamEmoji || '🏎️'} **${e.champPilotName}** — ${e.champTeamName}`,
          `🥇 **${e.champPoints} pts** · ${e.champWins}V · ${e.champPodiums}P · ${e.champDnfs} DNF`,
          `🏗️ Constructeur : **${e.champConstrEmoji || ''} ${e.champConstrName}** (${e.champConstrPoints} pts)`,
          mostWinsNote, mostDnfsNote, specNote,
        ].filter(Boolean).join('\n'),
        inline: false,
      });
    }
    embed.setFooter({ text: 'Un champion se forge par le sang, la sueur et les PLcoins.' });
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /rivalite ─────────────────────────────────────────────
  if (commandName === 'rivalite') {
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const pilot = await getPilotForUser(interaction.user.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: '❌ Crée d\'abord ton pilote avec `/create_pilot`.', ephemeral: true });
    if (!pilot.rivalId) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('⚔️ Aucune rivalité active')
          .setColor('#888888')
          .setDescription(
            `**${pilot.name}** n'a pas encore de rival déclaré cette saison.\n\n` +
            `*Les rivalités se déclarent après 2 contacts en course avec le même pilote.*`
          )
        ],
        ephemeral: true,
      });
    }
    const rival = await Pilot.findById(pilot.rivalId);
    const rivalTeam = rival?.teamId ? await Team.findById(rival.teamId) : null;
    const myTeam    = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ RIVALITÉ : ${pilot.name} vs ${rival?.name || '?'}`)
      .setColor('#FF4400')
      .setDescription(
        `${myTeam?.emoji || ''} **${pilot.name}** *(${overallRating(pilot)})* ` +
        `vs ${rivalTeam?.emoji || ''} **${rival?.name || '?'}** *(${rival ? overallRating(rival) : '?'})*\n\n` +
        `💥 **${pilot.rivalContacts || 0} contact(s)** en course cette saison\n\n` +
        `*La narration signalera leurs prochaines confrontations en course.*`
      );
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /admin_reset_rivalites ────────────────────────────────
  if (commandName === 'admin_reset_rivalites') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Accès refusé.', ephemeral: true });
    await Pilot.updateMany({}, { $set: { rivalId: null, rivalContacts: 0 } });
    return interaction.editReply({ content: '✅ Toutes les rivalités ont été réinitialisées.', ephemeral: true });
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
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /ecurie ───────────────────────────────────────────────
  if (commandName === 'ecurie') {
    const nom  = interaction.options.getString('nom');
    const team = await Team.findOne({ name: { $regex: nom, $options: 'i' } });
    if (!team) return interaction.editReply({ content: '❌ Écurie introuvable.', ephemeral: true });

    const pilots = await Pilot.find({ teamId: team._id });
    const bar    = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));
    const season = await getActiveSeason();
    const cStand = season ? await ConstructorStanding.findOne({ seasonId: season._id, teamId: team._id }) : null;

    // Bloc pilotes avec statut coéquipier
    let pilotBlock = '';
    if (pilots.length === 0) {
      pilotBlock = '*Aucun pilote*';
    } else if (pilots.length === 1) {
      const p = pilots[0];
      const ov = overallRating(p);
      const tier = ratingTier(ov);
      pilotBlock = `${tier.badge} **${p.name}** — ${ov} overall`;
    } else {
      // Deux pilotes — afficher le duel
      const [p1, p2] = pilots;
      const ov1 = overallRating(p1), ov2 = overallRating(p2);
      const t1 = ratingTier(ov1),   t2 = ratingTier(ov2);
      const s1Label = p1.teamStatus === 'numero1' ? '🔴 N°1' : p1.teamStatus === 'numero2' ? '🔵 N°2' : '⬜';
      const s2Label = p2.teamStatus === 'numero1' ? '🔴 N°1' : p2.teamStatus === 'numero2' ? '🔵 N°2' : '⬜';
      const w1 = p1.teammateDuelWins || 0, w2 = p2.teammateDuelWins || 0;
      const duelBar = w1 + w2 > 0
        ? `\`${'█'.repeat(w1)}${'░'.repeat(w2)}\` **${w1}–${w2}**`
        : '*(pas encore de duel)*';
      pilotBlock =
        `${s1Label} ${t1.badge} **${p1.name}** — ${ov1}\n` +
        `${s2Label} ${t2.badge} **${p2.name}** — ${ov2}\n` +
        `⚔️ Duel interne : ${duelBar}`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${team.emoji} ${team.name}`)
      .setColor(team.color)
      .setDescription(
        `\`Vitesse Max       \` ${bar(team.vitesseMax)}  **${team.vitesseMax}**\n` +
        `\`DRS               \` ${bar(team.drs)}  **${team.drs}**\n` +
        `\`Refroidissement   \` ${bar(team.refroidissement)}  **${team.refroidissement}**\n` +
        `\`Dirty Air         \` ${bar(team.dirtyAir)}  **${team.dirtyAir}**\n` +
        `\`Conservation Pneus\` ${bar(team.conservationPneus)}  **${team.conservationPneus}**\n` +
        `\`Vitesse Moyenne   \` ${bar(team.vitesseMoyenne)}  **${team.vitesseMoyenne}**`
      );

    embed.addFields({ name: '👥 Pilotes', value: pilotBlock });
    if (cStand) {
      embed.addFields({ name: `🏗️ Saison ${season.year}`, value: `**${cStand.points} pts** au constructeurs` });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /classement ───────────────────────────────────────────
  if (commandName === 'classement') {
    const season = await getActiveSeason();
    if (!season) return interaction.editReply({ content: '❌ Aucune saison active.', ephemeral: true });

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
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(`🏆 Classement Pilotes — Saison ${season.year}`).setColor('#FF1801').setDescription(desc||'Aucune donnée')],
    });
  }

  // ── /classement_constructeurs ─────────────────────────────
  if (commandName === 'classement_constructeurs') {
    const season = await getActiveSeason();
    if (!season) return interaction.editReply({ content: '❌ Aucune saison active.', ephemeral: true });

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
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(`🏗️ Classement Constructeurs — Saison ${season.year}`).setColor('#0099FF').setDescription(desc||'Aucune donnée')],
    });
  }

  // ── /calendrier ───────────────────────────────────────────
  if (commandName === 'calendrier') {
    const season = await getActiveSeason();
    if (!season) return interaction.editReply({ content: '❌ Aucune saison active.', ephemeral: true });

    const races = await Race.find({ seasonId: season._id }).sort({ index: 1 });
    const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
    const lines = races.map(r => {
      const d = new Date(r.scheduledDate);
      const dateStr  = `${d.getDate()}/${d.getMonth()+1}`;
      const slotTag  = r.slot === 1 ? '🌆 17h' : '🌅 11h';
      const status   = r.status === 'done' ? '✅' : r.status === 'practice_done' ? '🔧' : r.status === 'quali_done' ? '⏱️' : '🔜';
      return `${status} ${r.emoji} **${r.circuit}** — ${dateStr} ${slotTag} ${styleEmojis[r.gpStyle]}`;
    });

    const chunks = [];
    for (let i = 0; i < lines.length; i += 12) chunks.push(lines.slice(i, i+12).join('\n'));
    const embed = new EmbedBuilder().setTitle(`📅 Calendrier — Saison ${season.year}`).setColor('#0099FF').setDescription(chunks[0]);
    if (chunks[1]) embed.addFields({ name: '\u200B', value: chunks[1] });
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /resultats ────────────────────────────────────────────
  if (commandName === 'resultats') {
    const season = await getActiveSeason();
    if (!season) return interaction.editReply({ content: '❌ Aucune saison active.', ephemeral: true });

    const lastRace = await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 });
    if (!lastRace) return interaction.editReply({ content: '❌ Aucune course terminée.', ephemeral: true });

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
    return interaction.editReply({
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
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const pilot    = await getPilotForUser(interaction.user.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: '❌ Aucun pilote trouvé. Utilise `/create_pilot`.', ephemeral: true });
    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (!contract) return interaction.editReply({ content: `📋 **${pilot.name}** (Pilote ${pilotIndex}) n'a pas de contrat actif. Attends la période de transfert !`, ephemeral: true });
    const team     = await Team.findById(contract.teamId);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(`📋 Contrat — ${pilot.name} (Pilote ${pilot.pilotIndex})`).setColor(team.color)
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
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const pilot  = await getPilotForUser(interaction.user.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: '❌ Aucun pilote trouvé. Utilise `/create_pilot`.', ephemeral: true });
    const offers = await TransferOffer.find({ pilotId: pilot._id, status: 'pending' });
    if (!offers.length) return interaction.editReply({ content: `📭 Aucune offre en attente pour **${pilot.name}** (Pilote ${pilotIndex}).`, ephemeral: true });

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
    await interaction.editReply({
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
    const offerId    = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || offer.status !== 'pending')
      return interaction.editReply({ content: '❌ Offre invalide ou expirée.', ephemeral: true });

    // Vérifier que l'offre appartient à un pilote de ce joueur
    const pilot = await Pilot.findById(offer.pilotId);
    if (!pilot || pilot.discordId !== interaction.user.id)
      return interaction.editReply({ content: '❌ Cette offre ne t\'appartient pas.', ephemeral: true });

    const activeContract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (activeContract) return interaction.editReply({
      content: `❌ **${pilot.name}** (Pilote ${pilot.pilotIndex}) a un contrat actif (${activeContract.seasonsRemaining} saison(s) restante(s)). Attends la fin pour changer d\'écurie.`,
      ephemeral: true,
    });

    const team    = await Team.findById(offer.teamId);
    const inTeam  = await Pilot.countDocuments({ teamId: team._id });
    if (inTeam >= 2) return interaction.editReply({ content: '❌ Écurie complète (2 pilotes max).', ephemeral: true });

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

    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('✅ Contrat signé !').setColor(team.color)
        .setDescription(
          `**${pilot.name}** (Pilote ${pilot.pilotIndex}) rejoint **${team.emoji} ${team.name}** !\n\n` +
          `×${offer.coinMultiplier} | ${offer.seasons} saison(s) | Salaire : ${offer.salaireBase} 🪙/course\n` +
          `Prime victoire : ${offer.primeVictoire} 🪙 | Prime podium : ${offer.primePodium} 🪙`
        )
      ],
    });
  }

  // ── /refuser_offre ────────────────────────────────────────
  if (commandName === 'refuser_offre') {
    const offerId = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer) return interaction.editReply({ content: '❌ Offre introuvable.', ephemeral: true });
    // Vérifier que l'offre appartient à ce joueur
    const pilotForRefuse = await Pilot.findById(offer.pilotId);
    if (!pilotForRefuse || pilotForRefuse.discordId !== interaction.user.id)
      return interaction.editReply({ content: '❌ Cette offre ne t\'appartient pas.', ephemeral: true });
    await TransferOffer.findByIdAndUpdate(offerId, { status: 'rejected' });
    return interaction.editReply({ content: `🚫 Offre refusée pour **${pilotForRefuse.name}**.`, ephemeral: true });
  }

  // ── /historique ───────────────────────────────────────────
  if (commandName === 'historique') {
    const target     = interaction.options.getUser('joueur') || interaction.user;
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const pilot  = await getPilotForUser(target.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: `❌ Aucun Pilote ${pilotIndex} pour <@${target.id}>.`, ephemeral: true });

    // Récupérer tous les standings toutes saisons confondues
    const allStandings = await Standing.find({ pilotId: pilot._id }).sort({ seasonId: 1 });
    if (!allStandings.length) return interaction.editReply({ content: `📊 Aucune saison jouée pour **${pilot.name}**.`, ephemeral: true });

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
      .setTitle(`📊 Carrière — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
      .setColor(team?.color || '#888888')
      .setDescription(desc)
      .addFields({ name: '💰 Total gagné (carrière)', value: `${pilot.totalEarned} PLcoins`, inline: true });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /pilotes ──────────────────────────────────────────────

  // ── /admin_set_photo ─────────────────────────────────────
  if (commandName === 'admin_set_photo') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const target     = interaction.options.getUser('joueur') || interaction.user;
    const url        = interaction.options.getString('url').trim();
    const pilotIndex = interaction.options.getInteger('pilote') || 1;

    // Vérification basique que c'est une URL valide
    try { new URL(url); } catch {
      return interaction.editReply({ content: '❌ URL invalide.', ephemeral: true });
    }

    const pilot = await Pilot.findOneAndUpdate(
      { discordId: target.id, pilotIndex },
      { photoUrl: url },
      { new: true }
    );
    if (!pilot) return interaction.editReply({ content: `❌ Aucun Pilote ${pilotIndex} trouvé pour <@${target.id}>.`, ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`📸 Photo mise à jour — ${pilot.name}`)
      .setColor('#FFD700')
      .setThumbnail(url)
      .setDescription(`La photo de profil de **${pilot.name}** a été définie.\nElle apparaîtra dans \`/profil\`, \`/historique\` et \`/pilotes\`.`);

    return interaction.editReply({ embeds: [embed], ephemeral: true });
  }

  // ── /admin_draft_start ────────────────────────────────────
  if (commandName === 'admin_draft_start') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const existing = await DraftSession.findOne({ status: 'active' });
    if (existing) return interaction.editReply({ content: '❌ Un draft est déjà en cours !', ephemeral: true });

    const teams = await Team.find().sort({ budget: 1 });
    if (!teams.length) return interaction.editReply({ content: '❌ Aucune écurie trouvée.', ephemeral: true });

    const freePilots = await Pilot.find({ teamId: null }).sort({ createdAt: 1 });
    if (!freePilots.length) return interaction.editReply({ content: '❌ Aucun pilote libre pour la draft.', ephemeral: true });

    const totalRounds = 2;
    const totalPicks  = teams.length * totalRounds;

    const draft = await DraftSession.create({
      order: teams.map(t => t._id),
      currentPickIndex: 0,
      totalPicks,
      status: 'active',
    });

    // ── Embed d'ouverture cinématique ──────────────────────
    const sortedPilots = [...freePilots]
      .map(p => { const ov = overallRating(p); const t = ratingTier(ov); const flag = p.nationality?.split(' ')[0] || ''; return { str: `${t.badge} **${ov}** — ${flag} ${p.name} #${p.racingNumber || '?'}`, ov }; })
      .sort((a, b) => b.ov - a.ov);

    const pilotListStr = sortedPilots.map(x => x.str).join('\n');
    const orderStr = teams.map((t, i) => `**${i+1}.** ${t.emoji} ${t.name}`).join('\n');

    const openingEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🏁  DRAFT F1 PL — C\'EST PARTI !')
      .setDescription(
        '> *Les écuries prennent position. Les pilotes attendent. Le championnat commence ici.*\n\u200B'
      )
      .addFields(
        { name: '📋 Ordre du Round 1', value: orderStr, inline: true },
        { name: '\u200B', value: '*Round 2 = ordre inversé (snake)*', inline: true },
        { name: `🏎️ ${freePilots.length} pilotes disponibles`, value: pilotListStr.slice(0, 1024) },
      )
      .setFooter({ text: `Format Snake Draft · ${totalPicks} picks au total · ${teams.length} écuries × ${totalRounds} rounds` });

    await interaction.editReply({ embeds: [openingEmbed] });

    // ── Premier "On The Clock" ─────────────────────────────
    const firstTeamId = draftTeamAtIndex(teams.map(t => t._id), 0);
    const firstTeam   = teams.find(t => String(t._id) === String(firstTeamId));
    const sortedFree  = [...freePilots].sort((a, b) => overallRating(b) - overallRating(a));

    const clockPayload = buildOnTheClockPayload(
      firstTeam, 0, totalPicks, 1, 1, teams.length, sortedFree, String(draft._id)
    );
    await interaction.followUp(clockPayload);
    return;
  }


  // -- /pilotes --
  if (commandName === 'pilotes') {
    const allPilots = await Pilot.find().sort({ createdAt: 1 });
    if (!allPilots.length) return interaction.editReply({ content: 'Aucun pilote.', ephemeral: true });
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
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏎️ Classement Pilotes — Note Générale').setColor('#FF1801').setDescription(desc.slice(0,4000)||'Aucun').setFooter({ text: sorted.length+' pilote(s) · Poids: Freinage 17% · Contrôle 17% · Dépassement 15%...' })] });
  }


  // -- /admin_test_race --
  if (commandName === 'admin_test_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: 'Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    const testQt = testPilots.map(p => {
      const t = testTeams.find(t => String(t._id) === String(p.teamId));
      return { pilotId: p._id, time: calcQualiTime(p, t, 'DRY', testRace.gpStyle) };
    }).sort((a,b) => a.time - b.time);

    await interaction.editReply({ content: `🧪 **Course de test** — style **${testRace.gpStyle.toUpperCase()}** · ${testRace.laps} tours — résultats en cours dans ce channel !`, ephemeral: true });

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
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    await interaction.editReply({ content: `🔧 **Essais libres de test** — style **${testRace.gpStyle.toUpperCase()}** · résultats en cours...`, ephemeral: true });

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

  // -- /admin_test_qualif --
  if (commandName === 'admin_test_qualif') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const { testTeams, testPilots, testRace } = buildTestFixtures();
    await interaction.editReply({ content: `⏱️ **Qualifications TEST Q1/Q2/Q3** — style **${testRace.gpStyle.toUpperCase()}** — résultats en cours dans ce channel...`, ephemeral: true });

    ;(async () => {
      const channel      = interaction.channel;
      const styleEmojis  = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
      const weatherLabels = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Intermédiaire', HOT:'🔥 Chaud' };

      const { grid, weather, q3Size, q2Size, allTimes } = await simulateQualifying(testRace, testPilots, testTeams);

      const q3Grid  = grid.slice(0, q3Size);
      const q2Grid  = grid.slice(q3Size, q2Size);
      const q1Grid  = grid.slice(q2Size);
      const poleman = q3Grid[0];

      // ─── INTRO ─────────────────────────────────────────────
      await channel.send(
        `⏱️ **QUALIFICATIONS — ${testRace.emoji} ${testRace.circuit}** *(TEST)*\n` +
        `${styleEmojis[testRace.gpStyle]} **${testRace.gpStyle.toUpperCase()}** · Météo : **${weatherLabels[weather] || weather}**\n` +
        `Les pilotes prennent la piste pour décrocher la meilleure place sur la grille...`
      );
      await sleep(3000);

      // ─── Q1 ────────────────────────────────────────────────
      await channel.send(`🟡 **Q1 — DÉBUT** · ${grid.length} pilotes en piste · La zone d'élimination commence à P${q2Size + 1}`);
      await sleep(2500);

      const midQ1 = [...grid].sort(() => Math.random() - 0.5).slice(0, 4);
      await channel.send(
        `📻 *Q1 en cours...* ` +
        midQ1.map(g => `${g.teamEmoji}**${g.pilotName}** ${msToLapStr(g.time + randInt(200, 800))}`).join(' · ')
      );
      await sleep(3000);

      const q1EliminEmbed = new EmbedBuilder()
        .setTitle(`🔴 Q1 TERMINÉ — ${testRace.emoji} ${testRace.circuit} *(TEST)*`)
        .setColor('#FF4444')
        .setDescription(
          `**Éliminés (P${q2Size + 1}–${grid.length}) :**\n` +
          q1Grid.map((g, i) => {
            const gap = `+${((g.time - poleman.time) / 1000).toFixed(3)}s`;
            return `\`P${q2Size + 1 + i}\` ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          `\n\n**Passage en Q2 :** Top ${q2Size} pilotes ✅`
        );
      await channel.send({ embeds: [q1EliminEmbed] });
      await sleep(4000);

      // ─── Q2 ────────────────────────────────────────────────
      const q2BubbleLine = grid.slice(q3Size - 1, q3Size + 3).map(g => `${g.teamEmoji}**${g.pilotName}**`).join(' · ');
      await channel.send(
        `🟡 **Q2 — DÉBUT** · ${q2Size} pilotes en piste · La zone d'élimination commence à P${q3Size + 1}\n` +
        `*Sur le fil : ${q2BubbleLine}*`
      );
      await sleep(2500);

      const midQ2 = q2Grid.concat(q3Grid).sort(() => Math.random() - 0.5).slice(0, 4);
      await channel.send(
        `📻 *Q2 en cours...* ` +
        midQ2.map(g => `${g.teamEmoji}**${g.pilotName}** ${msToLapStr(g.time + randInt(100, 500))}`).join(' · ')
      );
      await sleep(3000);

      const lastQ3    = q3Grid[q3Size - 1];
      const firstOut  = q2Grid[0];
      const q2Thriller = ((firstOut.time - lastQ3.time) / 1000).toFixed(3);

      const q2EliminEmbed = new EmbedBuilder()
        .setTitle(`🔴 Q2 TERMINÉ — ${testRace.emoji} ${testRace.circuit} *(TEST)*`)
        .setColor('#FF8800')
        .setDescription(
          `**Éliminés (P${q3Size + 1}–${q2Size}) :**\n` +
          q2Grid.map((g, i) => {
            const gap = `+${((g.time - poleman.time) / 1000).toFixed(3)}s`;
            return `\`P${q3Size + 1 + i}\` ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          `\n\n⚠️ **${lastQ3.teamEmoji}${lastQ3.pilotName}** passe de justesse — **${q2Thriller}s** d'avance sur **${firstOut.teamEmoji}${firstOut.pilotName}** !` +
          `\n\n**Passage en Q3 :** Top ${q3Size} pilotes ✅`
        );
      await channel.send({ embeds: [q2EliminEmbed] });
      await sleep(4000);

      // ─── Q3 ────────────────────────────────────────────────
      const q3Names = q3Grid.map(g => `${g.teamEmoji}**${g.pilotName}**`).join(' · ');
      await channel.send(
        `🔥 **Q3 — SHOOT-OUT POUR LA POLE !**\n` +
        `Les ${q3Size} meilleurs pilotes donnent tout — UN tour, TOUT jouer.\n` +
        `*En piste : ${q3Names}*`
      );
      await sleep(3000);

      // Suspense : annonce les temps en sens inverse (dernier → premier)
      const q3Reversed = [...q3Grid].reverse();
      for (let i = 0; i < Math.min(3, q3Reversed.length); i++) {
        const g   = q3Reversed[i];
        const pos = q3Grid.length - i;
        await channel.send(`📻 **${g.teamEmoji}${g.pilotName}** — ${msToLapStr(g.time)} · provisoirement **P${pos}**`);
        await sleep(1500);
      }
      await sleep(1500);

      // Embed final Q3 — grille complète
      const q3Embed = new EmbedBuilder()
        .setTitle(`🏆 Q3 — GRILLE DE DÉPART OFFICIELLE — ${testRace.emoji} ${testRace.circuit} *(TEST)*`)
        .setColor('#FFD700')
        .setDescription(
          `Météo Q : **${weatherLabels[weather] || weather}**\n\n` +
          q3Grid.map((g, i) => {
            const gap   = i === 0 ? '🏆 **POLE POSITION**' : `+${((g.time - q3Grid[0].time) / 1000).toFixed(3)}s`;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`P${i+1}\``;
            return `${medal} ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          `\n\n— — —\n` +
          q2Grid.map((g, i) => {
            const gap = `+${((g.time - q3Grid[0].time) / 1000).toFixed(3)}s`;
            return `\`P${q3Size + 1 + i}\` ${g.teamEmoji} ${g.pilotName} — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          `\n` +
          q1Grid.map((g, i) => {
            const gap = `+${((g.time - q3Grid[0].time) / 1000).toFixed(3)}s`;
            return `\`P${q2Size + 1 + i}\` ${g.teamEmoji} ${g.pilotName} — ${msToLapStr(g.time)} — ${gap}`;
          }).join('\n') +
          `\n\n*⚠️ Session fictive — aucune donnée sauvegardée*`
        );
      await channel.send({ embeds: [q3Embed] });
      await sleep(1500);

      // Message pole
      const gap2nd  = q3Grid[1] ? ((q3Grid[1].time - poleman.time) / 1000).toFixed(3) : null;
      const poleMsg = gap2nd && parseFloat(gap2nd) < 0.1
        ? `***🏆 POLE POSITION !!! ${poleman.teamEmoji}${poleman.pilotName.toUpperCase()} EN ${msToLapStr(poleman.time)} !!! +${gap2nd}s — ULTRA SERRÉ !!!***`
        : `🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** en **${msToLapStr(poleman.time)}** !` +
          (gap2nd ? ` **+${gap2nd}s** d'avance sur ${q3Grid[1].teamEmoji}**${q3Grid[1].pilotName}**.` : '');
      await channel.send(poleMsg);

    })().catch(e => console.error('admin_test_qualif error:', e.message));
    return;
  }

  // -- /admin_help --
  // ── /admin_reset_pilot ────────────────────────────────────
  if (commandName === 'admin_reset_pilot') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Accès refusé.', ephemeral: true });

    const target     = interaction.options.getUser('joueur');
    const pilotIndex = interaction.options.getInteger('pilote'); // null = tout supprimer

    const query = pilotIndex
      ? { discordId: target.id, pilotIndex }
      : { discordId: target.id };

    // Récupérer les pilotes avant suppression pour l'affichage
    const pilotsToDelete = await Pilot.find(query);
    if (!pilotsToDelete.length) {
      return interaction.editReply({
        content: `❌ Aucun pilote trouvé pour <@${target.id}>${pilotIndex ? ` (Pilote ${pilotIndex})` : ''}.`,
        ephemeral: true,
      });
    }

    // Supprimer les contrats liés
    const pilotIds = pilotsToDelete.map(p => p._id);
    await Contract.deleteMany({ pilotId: { $in: pilotIds } });
    await TransferOffer.deleteMany({ pilotId: { $in: pilotIds } });
    await Standing.deleteMany({ pilotId: { $in: pilotIds } });
    await Pilot.deleteMany({ _id: { $in: pilotIds } });

    const names = pilotsToDelete.map(p => `**${p.name}** (Pilote ${p.pilotIndex}, #${p.racingNumber || '?'})`).join(', ');

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('🗑️ Pilote(s) supprimé(s)')
        .setColor('#FF4444')
        .setDescription(
          `Pilote(s) de <@${target.id}> supprimé(s) :\n${names}\n\n` +
          `✅ Contrats, offres et standings liés également supprimés.\n` +
          `Le joueur peut maintenant recréer son pilote avec \`/create_pilot\`.`
        )
      ],
      ephemeral: true,
    });
  }

  // ── /admin_help ───────────────────────────────────────────
  if (commandName === 'admin_help') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Accès refusé.', ephemeral: true });
    const adminHelpEmbed = new EmbedBuilder().setTitle('🛠️ Commandes Administrateur — F1 PL').setColor('#FF6600')
      .setDescription('Toutes les commandes nécessitent la permission **Administrateur**.')
      .addFields(
        { name: '🏁 Saison & Course', value: [
          '`/admin_new_season` — Crée une nouvelle saison (24 GP au calendrier)',
          '`/admin_force_practice` — Déclenche les essais libres immédiatement',
          '`/admin_force_quali` — Déclenche les qualifications Q1/Q2/Q3 immédiatement',
          '`/admin_force_race` — Déclenche la course immédiatement',
          '`/admin_apply_last_race` — 🔧 Applique manuellement les résultats (si points non crédités)',
          '`/admin_skip_gp` — Saute un GP sans le simuler',
          '`/admin_evolve_cars` — Affiche l\'état actuel des stats voitures',
          '`/admin_reset_rivalites` — Réinitialise toutes les rivalités en début de saison',
        ].join('\n') },
        { name: '🔄 Transferts & Draft', value: [
          '`/admin_transfer` — Ouvre la période de transfert (IA génère les offres automatiquement)',
          '`/admin_draft_start` — Lance le draft snake (attribution manuelle des écuries)',
        ].join('\n') },
        { name: '🖼️ Gestion Pilotes', value: [
          '`/admin_set_photo joueur:@user url:... [pilote:1|2]` — Définit la photo d\'un pilote',
          '`/admin_reset_pilot joueur:@user [pilote:1|2]` — Supprime le(s) pilote(s) d\'un joueur *(test/reset)*',
        ].join('\n') },
        { name: '🧪 Test & Debug', value: [
          '`/admin_test_race` — Simule une course fictive avec pilotes fictifs (aucune sauvegarde)',
          '`/admin_test_practice` — Simule des essais libres fictifs',
          '`/admin_test_qualif` — Simule des qualifs Q1/Q2/Q3 fictives',
        ].join('\n') },
        { name: '📋 Procédure de démarrage', value: [
          '1️⃣ Les joueurs créent leurs pilotes : `/create_pilot` (2 pilotes max par joueur)',
          '2️⃣ Attribution des écuries via `/admin_draft_start` (snake draft) ou `/admin_transfer`',
          '3️⃣ `/admin_new_season` — crée la saison et les 24 GP',
          '4️⃣ Courses auto planifiées : **🌅 11h** EL · **13h** Q · **15h** Course · **🌆 17h** EL · **18h** Q · **20h** Course',
          '5️⃣ Fin de saison : `/admin_transfer` — IA génère les offres de transfert',
        ].join('\n') },
        { name: '⚙️ Infos système', value: [
          '🏎️ **2 pilotes max** par joueur Discord — nationalité, numéro et stats personnalisables',
          `📊 **${TOTAL_STAT_POOL} points** à répartir à la création (base ${BASE_STAT_VALUE} par stat)`,
          '🔔 Keep-alive actif · Ping toutes les 8 min · GP auto : 🌅11h/13h/15h · 🌆17h/18h/20h (Paris)',
        ].join('\n') },
      ).setFooter({ text: 'F1 PL Bot — Panneau Admin v2.1' });
    return interaction.editReply({ embeds: [adminHelpEmbed], ephemeral: true });
  }

  // -- /f1 --
  if (commandName === 'f1') {
    const allMyPilots = await getAllPilotsForUser(interaction.user.id);
    let welcomeDesc;
    if (!allMyPilots.length) {
      welcomeDesc = "❗ Tu n'as pas encore de pilote — commence par `/create_pilot` !";
    } else if (allMyPilots.length === 1) {
      const p = allMyPilots[0]; const ov = overallRating(p); const tier = ratingTier(ov);
      const flag = p.nationality?.split(' ')[0] || '🏳️';
      welcomeDesc = `Bienvenue ${flag} **#${p.racingNumber || '?'} ${p.name}** ${tier.badge} ${ov} — *1 pilote créé, tu peux en créer un 2ème !*`;
    } else {
      welcomeDesc = `Bienvenue ! Tes pilotes :\n` + allMyPilots.map(p => {
        const ov = overallRating(p); const tier = ratingTier(ov);
        const flag = p.nationality?.split(' ')[0] || '🏳️';
        return `  ${flag} **#${p.racingNumber || '?'} ${p.name}** (Pilote ${p.pilotIndex}) ${tier.badge} ${ov}`;
      }).join('\n');
    }
    const f1Embed = new EmbedBuilder().setTitle('🏎️ F1 PL — Tes commandes joueur').setColor('#FF1801')
      .setDescription(welcomeDesc)
      .addFields(
        { name: '👤 Tes pilotes', value: [
          '`/create_pilot` — Crée un pilote (nationalité, numéro, stats — **2 max par joueur**)',
          '`/profil [pilote:1|2]` — Stats, note générale, contrat et classement',
          '`/ameliorer [pilote:1|2]` — Améliore une stat (+1, coût croissant selon le niveau)',
          '`/performances [pilote:1|2] [vue:récents|records|écuries|saison]` — Historique complet des GPs',
          '`/historique [pilote:1|2]` — Carrière complète multi-saisons',
          '`/rivalite [pilote:1|2]` — Ta rivalité actuelle en saison',
        ].join('\n') },
        { name: '🏎️ Écuries & Pilotes', value: [
          '`/pilotes` — Classement général par note (style FIFA)',
          '`/ecuries` — Liste des 8 écuries avec leurs pilotes',
          '`/ecurie nom:...` — Stats voiture détaillées d\'une écurie',
          '`/record_circuit circuit:...` — Record du meilleur tour sur un circuit',
        ].join('\n') },
        { name: '🗞️ Actualités paddock', value: '`/news [page]` — Rumeurs, drama, rivalités, title fight… mis à jour après chaque GP et toutes les ~40h' },
        { name: '📋 Contrats & Transferts', value: [
          '`/mon_contrat [pilote:1|2]` — Ton contrat actuel',
          '`/offres [pilote:1|2]` — Offres en attente (boutons interactifs)',
          '`/accepter_offre offre_id:... [pilote:1|2]` — Accepter une offre',
          '`/refuser_offre offre_id:... [pilote:1|2]` — Refuser une offre',
        ].join('\n') },
        { name: '🏆 Classements & Calendrier', value: [
          '`/classement` — Championnat pilotes saison en cours',
          '`/classement_constructeurs` — Championnat constructeurs',
          '`/calendrier` — Tous les GP de la saison',
          '`/resultats` — Résultats de la dernière course',
          '`/palmares` — 🏛️ Hall of Fame de toutes les saisons',
        ].join('\n') },
        { name: '📖 Infos', value: [
          '`/concept` — Présentation complète du jeu (pour les nouveaux !)',
          '`/f1` — Affiche ce panneau',
        ].join('\n') },
      ).setFooter({ text: 'GP auto : 🌅11h/13h/15h · 🌆17h/18h/20h (Paris) · 2 pilotes max par joueur' });
    return interaction.editReply({ embeds: [f1Embed], ephemeral: true });
  }


  // ── /performances ─────────────────────────────────────────
  if (commandName === 'performances') {
    const target     = interaction.options.getUser('joueur') || interaction.user;
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const vue        = interaction.options.getString('vue') || 'recent';

    const pilot = await getPilotForUser(target.id, pilotIndex);
    if (!pilot) return interaction.editReply({ content: `❌ Aucun Pilote ${pilotIndex} pour <@${target.id}>.`, ephemeral: true });

    const team    = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const allRecs = await PilotGPRecord.find({ pilotId: pilot._id }).sort({ raceDate: -1 });

    if (!allRecs.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle(`📊 Performances — ${pilot.name}`)
          .setColor('#888888')
          .setDescription('*Aucune course disputée pour l\'instant. Les données s\'accumuleront après chaque GP !*')
        ],
        ephemeral: true,
      });
    }

    const ov   = overallRating(pilot);
    const tier = ratingTier(ov);
    const medals = { 1:'🥇', 2:'🥈', 3:'🥉' };
    const dnfIcon = { CRASH:'💥', MECHANICAL:'🔩', PUNCTURE:'🫧' };
    const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };

    function posStr(r) {
      if (r.dnf) return `❌ DNF ${dnfIcon[r.dnfReason] || ''}`;
      return `${medals[r.finishPos] || `P${r.finishPos}`}`;
    }
    function gainLoss(r) {
      if (r.dnf || r.startPos == null) return '';
      const diff = r.startPos - r.finishPos;
      if (diff > 0) return ` ⬆️+${diff}`;
      if (diff < 0) return ` ⬇️${diff}`;
      return ' ➡️';
    }

    const embed = new EmbedBuilder()
      .setColor(team?.color || tier.color)
      .setThumbnail(pilot.photoUrl || null);

    // ── VUE RÉCENTS ──────────────────────────────────────────
    if (vue === 'recent') {
      const recents = allRecs.slice(0, 10);
      const lines = recents.map(r => {
        const fl = r.fastestLap ? ' ⚡' : '';
        const gl = gainLoss(r);
        const pts = r.points > 0 ? ` · **${r.points}pts**` : '';
        const grid = r.startPos ? ` *(grille P${r.startPos})*` : '';
        return `${r.circuitEmoji} **${r.circuit}** *(S${r.seasonYear})*\n` +
               `  ${posStr(r)}${gl}${pts}${fl} — ${r.teamEmoji} ${r.teamName}${grid}`;
      }).join('\n\n');

      // Forme récente : 5 derniers
      const last5 = allRecs.slice(0, 5);
      const formStr = last5.map(r => {
        if (r.dnf) return '❌';
        if (r.finishPos === 1) return '🥇';
        if (r.finishPos <= 3) return '🏆';
        if (r.finishPos <= 10) return '✅';
        return '▪️';
      }).join(' ');

      embed
        .setTitle(`🕐 Performances récentes — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
        .setDescription(
          `${tier.badge} **${ov}** — ${team ? `${team.emoji} ${team.name}` : '*Sans écurie*'}\n` +
          `Forme : ${formStr} *(5 derniers GPs)*\n\n` +
          lines
        )
        .setFooter({ text: `${allRecs.length} GP(s) au total · Vue Récents` });

    // ── VUE RECORDS ──────────────────────────────────────────
    } else if (vue === 'records') {
      const finished = allRecs.filter(r => !r.dnf);
      const best     = [...finished].sort((a, b) => a.finishPos - b.finishPos);
      const bestPts  = [...allRecs].sort((a, b) => b.points - a.points);
      const top5     = best.slice(0, 5);
      const wins     = finished.filter(r => r.finishPos === 1);
      const podiums  = finished.filter(r => r.finishPos <= 3);
      const flaps    = allRecs.filter(r => r.fastestLap);
      const dnfs     = allRecs.filter(r => r.dnf);
      const bestGain = [...finished.filter(r => r.startPos)].sort((a, b) => (a.startPos - a.finishPos) < (b.startPos - b.finishPos) ? 1 : -1)[0];
      const totalPts = allRecs.reduce((s, r) => s + r.points, 0);
      const totalCoins = allRecs.reduce((s, r) => s + r.coins, 0);

      const top5lines = top5.map(r =>
        `${medals[r.finishPos] || `P${r.finishPos}`} ${r.circuitEmoji} **${r.circuit}** *(S${r.seasonYear})* — ${r.teamEmoji} ${r.teamName}` +
        (r.startPos ? ` *(grille P${r.startPos})*` : '') +
        (r.fastestLap ? ' ⚡' : '')
      ).join('\n');

      const statsBlock =
        `🥇 **${wins.length}** victoire(s) · 🏆 **${podiums.length}** podium(s) · ❌ **${dnfs.length}** DNF\n` +
        `⚡ **${flaps.length}** meilleur(s) tour(s) · 📊 **${totalPts}** pts totaux · 💰 **${totalCoins}** 🪙 gagnés\n` +
        (bestGain ? `🚀 Meilleure remontée : **+${bestGain.startPos - bestGain.finishPos}** places (${bestGain.circuitEmoji} ${bestGain.circuit} S${bestGain.seasonYear})\n` : '');

      embed
        .setTitle(`🏆 Records — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
        .setDescription(
          `${tier.badge} **${ov}** — **${allRecs.length}** GP(s) disputé(s)\n\n` +
          `**📈 Statistiques carrière :**\n${statsBlock}\n` +
          (top5.length ? `**🎖️ Top ${top5.length} meilleurs résultats :**\n${top5lines}` : '*Aucun résultat sans DNF.*')
        )
        .setFooter({ text: 'Vue Records — tous GP confondus' });

    // ── VUE ÉQUIPES ──────────────────────────────────────────
    } else if (vue === 'teams') {
      // Regrouper par équipe (nom + emoji pour clé)
      const teamGroups = new Map();
      for (const r of allRecs) {
        const key = r.teamName;
        if (!teamGroups.has(key)) teamGroups.set(key, { emoji: r.teamEmoji, name: r.teamName, records: [] });
        teamGroups.get(key).records.push(r);
      }

      const teamLines = [...teamGroups.values()].map(g => {
        const recs     = g.records;
        const finished = recs.filter(r => !r.dnf);
        const wins     = finished.filter(r => r.finishPos === 1).length;
        const podiums  = finished.filter(r => r.finishPos <= 3).length;
        const dnfs2    = recs.filter(r => r.dnf).length;
        const pts      = recs.reduce((s, r) => s + r.points, 0);
        const avgPos   = finished.length ? (finished.reduce((s, r) => s + r.finishPos, 0) / finished.length).toFixed(1) : '—';
        const seasons  = [...new Set(recs.map(r => r.seasonYear))].sort().join(', ');
        const bestR    = finished.sort((a, b) => a.finishPos - b.finishPos)[0];
        return (
          `**${g.emoji} ${g.name}** — S${seasons} · ${recs.length} GP(s)\n` +
          `  🥇${wins}V · 🏆${podiums}P · ❌${dnfs2} DNF · ${pts}pts · moy. P${avgPos}` +
          (bestR ? `\n  ⭐ Meilleur : ${medals[bestR.finishPos] || `P${bestR.finishPos}`} ${bestR.circuitEmoji} ${bestR.circuit} S${bestR.seasonYear}` : '')
        );
      }).join('\n\n');

      embed
        .setTitle(`🏎️ Historique des écuries — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
        .setDescription(
          `${tier.badge} **${ov}** — **${teamGroups.size}** écurie(s) au total\n\n` +
          teamLines
        )
        .setFooter({ text: 'Vue Écuries — toutes saisons confondues' });

    // ── VUE SAISON ───────────────────────────────────────────
    } else if (vue === 'season') {
      // Trouver la saison active ou la plus récente
      const activeSeason = await getActiveSeason();
      const targetYear   = activeSeason?.year || (allRecs[0]?.seasonYear);
      const seasonRecs   = allRecs.filter(r => r.seasonYear === targetYear).sort((a, b) => new Date(a.raceDate) - new Date(b.raceDate));

      if (!seasonRecs.length) {
        return interaction.editReply({ content: `❌ Aucune course jouée en saison ${targetYear}.`, ephemeral: true });
      }

      const finished  = seasonRecs.filter(r => !r.dnf);
      const totalPts  = seasonRecs.reduce((s, r) => s + r.points, 0);
      const wins      = finished.filter(r => r.finishPos === 1).length;
      const podiums   = finished.filter(r => r.finishPos <= 3).length;
      const dnfsS     = seasonRecs.filter(r => r.dnf).length;
      const avgPos    = finished.length ? (finished.reduce((s, r) => s + r.finishPos, 0) / finished.length).toFixed(1) : '—';

      const lines = seasonRecs.map(r => {
        const fl  = r.fastestLap ? '⚡' : '  ';
        const gl  = gainLoss(r);
        const pts = r.points > 0 ? `+${r.points}pts` : '     ';
        const grid = r.startPos ? `P${String(r.startPos).padStart(2)}→` : '    ';
        return `${r.circuitEmoji} ${styleEmojis[r.gpStyle] || ''} \`${grid}${posStr(r).padEnd(5)}\` ${fl} ${pts} — ${r.teamEmoji}${r.teamName}${gl}`;
      }).join('\n');

      embed
        .setTitle(`📅 Saison ${targetYear} — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
        .setDescription(
          `${tier.badge} **${ov}** · **${totalPts} pts** · 🥇${wins}V · 🏆${podiums}P · ❌${dnfsS} DNF · moy. P${avgPos}\n\n` +
          `\`\`\`\n${lines}\n\`\`\``
        )
        .setFooter({ text: `${seasonRecs.length}/${(await Race.countDocuments({ seasonId: activeSeason?._id }))} GPs joués — Saison ${targetYear}` });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /record_circuit ───────────────────────────────────────
  if (commandName === 'record_circuit') {
    const query = interaction.options.getString('circuit').toLowerCase();

    // Chercher les records dont le nom contient la query
    const allRecords = await CircuitRecord.find();
    const matches = allRecords.filter(r => r.circuit.toLowerCase().includes(query));

    if (!matches.length) {
      return interaction.editReply({ content: `❌ Aucun record trouvé pour "${query}". Les records s'établissent après chaque GP.`, ephemeral: true });
    }

    if (matches.length === 1) {
      const rec = matches[0];
      const embed = new EmbedBuilder()
        .setTitle(`⏱️ Record du circuit — ${rec.circuitEmoji} ${rec.circuit}`)
        .setColor('#FF6600')
        .setDescription(
          `**⚡ ${msToLapStr(rec.bestTimeMs)}**\n\n` +
          `${rec.teamEmoji} **${rec.pilotName}** — ${rec.teamName}\n` +
          `📅 Établi en **Saison ${rec.seasonYear}**\n\n` +
          `*Style : ${rec.gpStyle || 'mixte'} · Ce record peut être battu à chaque nouveau GP sur ce circuit.*`
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // Plusieurs résultats
    const lines = matches.slice(0, 10).map(rec =>
      `${rec.circuitEmoji} **${rec.circuit}** — ⚡ ${msToLapStr(rec.bestTimeMs)} par **${rec.pilotName}** *(S${rec.seasonYear})*`
    ).join('\n');
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle(`⏱️ Records de circuit — ${matches.length} résultats`)
        .setColor('#FF6600')
        .setDescription(lines + (matches.length > 10 ? '\n*... et plus. Précise ta recherche.*' : ''))
      ],
      ephemeral: true,
    });
  }

  // ── /news ─────────────────────────────────────────────────
  if (commandName === 'news') {
    const page    = interaction.options.getInteger('page') || 1;
    const perPage = 5;
    const skip    = (page - 1) * perPage;
    const total   = await NewsArticle.countDocuments();
    const articles = await NewsArticle.find().sort({ publishedAt: -1 }).skip(skip).limit(perPage);

    if (!articles.length) {
      return interaction.editReply({ content: '📰 Aucun article pour l\'instant — les news arrivent après les GPs et toutes les 40h environ.', ephemeral: true });
    }

    const typeEmojis = {
      rivalry       : '⚔️',
      transfer_rumor: '🔄',
      drama         : '💥',
      hype          : '🚀',
      form_crisis   : '📉',
      teammate_duel : '👥',
      dev_vague     : '⚙️',
      scandal       : '💣',
      title_fight   : '🏆',
    };

    const lines = articles.map(a => {
      const src   = NEWS_SOURCES[a.source];
      const emoji = typeEmojis[a.type] || '📰';
      const date  = new Date(a.publishedAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
      return `${emoji} **${a.headline}**\n${src?.name || a.source} · *${date}*\n${a.body.split('\n\n')[0].slice(0, 120)}${a.body.length > 120 ? '...' : ''}`;
    }).join('\n\n─────────────────\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`🗞️ Paddock Press — Page ${page}/${Math.ceil(total / perPage)}`)
      .setColor('#2C3E50')
      .setDescription(lines)
      .setFooter({ text: `${total} articles au total · /news page:${page + 1} pour la suite` });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /admin_news_force ─────────────────────────────────────
  if (commandName === 'admin_news_force') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.editReply({ content: '❌ Admin uniquement.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const channel = client.channels.cache.get(RACE_CHANNEL);
    if (!channel) return interaction.editReply('❌ Channel non configuré (RACE_CHANNEL_ID manquant).');
    try {
      await runScheduledNews(client);
      return interaction.editReply('✅ Article de news généré et publié.');
    } catch(e) {
      return interaction.editReply(`❌ Erreur : ${e.message}`);
    }
  }

  // ── /concept ──────────────────────────────────────────────
  if (commandName === 'concept') {
    const embed1 = new EmbedBuilder()
      .setTitle('🏎️ F1 PL — Le championnat entre potes')
      .setColor('#FF1801')
      .setDescription(
        'Tu incarnes **1 ou 2 pilotes de F1** dans un championnat simulé automatiquement.\n' +
        'Les courses tournent toutes seules — tu gères ta carrière entre les épreuves.\n\u200B'
      )
      .addFields(
        { name: '📅 Calendrier & Courses', value:
          '**24 GP** par saison (vrais circuits F1) · **1 weekend par jour** · Chaque circuit a un style : 🏙️ Urbain · 💨 Rapide · ⚙️ Technique · 🔀 Mixte · 🔋 Endurance\n' +
          '> 🌅 `11h` 🔧 EL · `13h` ⏱️ Q · `15h` 🏁 Course  \n> 🌆 `17h` 🔧 EL · `18h` ⏱️ Q · `20h` 🏁 Course *(Europe/Paris)*' },
        { name: '🧬 Créer un pilote — `/create_pilot`', value:
          '• **Nationalité** + **numéro de course** (1–99, unique)\n' +
          `• **${TOTAL_STAT_POOL} points** à répartir sur 7 stats (base fixe ${BASE_STAT_VALUE} par stat · max +${MAX_STAT_BONUS}/stat)\n` +
          '• Stats vides → répartition **aléatoire équilibrée**\n' +
          '• **2 pilotes max** par compte — chacun a ses propres stats, contrat et coins\n' +
          '> 💡 Toutes les commandes acceptent l\'option `[pilote:1|2]`' },
        { name: '🎯 Les 7 stats pilote', value:
          '`Dépassement` `Freinage` `Défense` `Adaptabilité` `Réactions` `Contrôle` `Gestion Pneus`\n' +
          '→ Chaque style de circuit valorise des stats différentes. Spécialise-toi pour briller sur certains tracés !\n' +
          '→ 3 upgrades consécutifs sur la même stat = **Spécialisation débloquée** 🏅 (bonus en course)' },
        { name: '💰 PLcoins', value:
          'Gagnés à chaque course (points + salaire + primes). Dépensés avec `/ameliorer [pilote:1|2]` pour booster tes stats (+1 par achat, coût croissant).' },
        { name: '🚗 Écuries & Contrats — La Draft', value:
          '**Au début de saison**, pas d\'offres directes : c\'est une **draft** organisée par les admins.\n' +
          'Les écuries choisissent leurs pilotes dans l\'ordre — ton classement stats influence ton attractivité.\n' +
          '**En cours de saison** : le mercato s\'ouvre en fin de saison via `/admin_transfer`, les écuries font alors des offres auto. Utilise `/offres [pilote:1|2]` pour accepter.\n' +
          '> **8 écuries** · stats voiture évolutives · chaque contrat a : multiplicateur coins · salaire · primes V/P · durée' },
        { name: '🚀 Pour démarrer', value:
          '1️⃣ `/create_pilot` — crée ton pilote (nationalité, numéro, stats)\n' +
          '2️⃣ Attends la **draft** organisée par les admins pour rejoindre une écurie\n' +
          '3️⃣ Suis les résultats ici · `/profil` · `/classement` · `/calendrier`\n' +
          '4️⃣ Dépense tes gains → `/ameliorer`\n\n' +
          '> `/f1` pour voir toutes tes commandes · `/profil` pour tes stats complètes' },
      )
      .setFooter({ text: 'Bonne saison 🏎️💨' });

    return interaction.editReply({ embeds: [embed1] });
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
    const gpIndex = interaction.options.getInteger('gp_index');
    await interaction.reply({ content: `✅ Essais libres en cours${gpIndex !== null ? ` (GP index ${gpIndex})` : ''}... Les résultats arrivent dans le channel de course.`, ephemeral: true });
    runPractice(interaction.channel, gpIndex).catch(e => console.error('admin_force_practice error:', e.message));
  }

  if (commandName === 'admin_force_quali') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    const gpIndex = interaction.options.getInteger('gp_index');
    await interaction.reply({ content: `✅ Qualifications en cours${gpIndex !== null ? ` (GP index ${gpIndex})` : ''}... Les résultats arrivent dans le channel de course.`, ephemeral: true });
    runQualifying(interaction.channel, gpIndex).catch(e => console.error('admin_force_quali error:', e.message));
  }

  if (commandName === 'admin_force_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    const gpIndex = interaction.options.getInteger('gp_index');
    await interaction.reply({ content: `🏁 Course lancée${gpIndex !== null ? ` (GP index ${gpIndex})` : ''} ! Suivez le direct dans le channel de course.`, ephemeral: true });
    runRace(interaction.channel, gpIndex).catch(e => console.error('admin_force_race error:', e.message));
  }

  if (commandName === 'admin_stop_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    const races = global.activeRaces;
    if (!races || races.size === 0)
      return interaction.reply({ content: '❌ Aucune course en cours.', ephemeral: true });
    // Aborter toutes les courses actives (normalement 1 seule)
    let count = 0;
    for (const [, r] of races) { r.abort(); count++; }
    return interaction.reply({ content: `🛑 **Arrêt envoyé** — ${count} course(s) interrompue(s). Les résultats ne seront pas comptabilisés.`, ephemeral: false });
  }

  if (commandName === 'admin_fix_slots') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const season = await getActiveSeason();
      if (!season) return interaction.editReply('❌ Pas de saison active.');
      const races = await Race.find({ seasonId: season._id }).sort({ index: 1 });
      if (!races.length) return interaction.editReply('❌ Aucun GP trouvé.');
      // Regrouper les races par jour (date sans heure)
      const byDay = new Map();
      for (const r of races) {
        const key = new Date(r.scheduledDate).toDateString();
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(r);
      }
      // Réassigner les slots en s'assurant qu'il y a exactement 2 GP/jour
      let updated = 0;
      for (const [, dayRaces] of byDay) {
        // Trier par index pour avoir un ordre stable
        dayRaces.sort((a, b) => a.index - b.index);
        for (let i = 0; i < dayRaces.length; i++) {
          const newSlot = i % 2; // 0 = matin, 1 = soir
          await Race.findByIdAndUpdate(dayRaces[i]._id, { slot: newSlot });
          updated++;
        }
      }
      return interaction.editReply(`✅ **${updated}** GP mis à jour avec slots matin/soir.
> 🌅 slot 0 : 11h EL · 13h Q · 15h Course
> 🌆 slot 1 : 17h EL · 18h Q · 20h Course`);
    } catch(e) { return interaction.editReply(`❌ Erreur : ${e.message}`); }
  }

  if (commandName === 'admin_inject_results') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const season = await getActiveSeason();
      if (!season) return interaction.editReply('❌ Pas de saison active.');
      const gpIdx = interaction.options.getInteger('gp_index');
      const race  = gpIdx !== null
        ? await Race.findOne({ seasonId: season._id, index: gpIdx })
        : await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 });
      if (!race)          return interaction.editReply('❌ GP introuvable.');
      if (!race.raceResults?.length) return interaction.editReply('❌ Pas de résultats sauvegardés pour ce GP.');
      await applyRaceResults(race.raceResults, race._id, season, []);
      return interaction.editReply(`✅ Points du GP ${race.emoji} ${race.circuit} injectés !`);
    } catch(e) { return interaction.editReply(`❌ Erreur : ${e.message}`); }
  }

  if (commandName === 'admin_skip_gp') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.reply({ content: '⏳ Traitement...', ephemeral: true });
    (async () => {
      try {
        const season = await getActiveSeason();
        if (!season) return await interaction.editReply('❌ Aucune saison active.');
        const gpIndex = interaction.options.getInteger('gp_index');
        const race = gpIndex !== null
          ? await Race.findOne({ seasonId: season._id, index: gpIndex })
          : await getCurrentRace(season);
        if (!race) return await interaction.editReply('❌ Aucun GP trouvé.');
        if (race.status === 'done') return await interaction.editReply(`❌ Le GP **${race.circuit}** (index ${race.index}) est déjà terminé.`);
        await Race.findByIdAndUpdate(race._id, { status: 'done' });
        await interaction.editReply(`✅ GP **${race.emoji} ${race.circuit}** (index ${race.index}) passé en \`done\` — sans simulation.`);
      } catch(e) {
        try { await interaction.editReply(`❌ Erreur : ${e.message}`); } catch(_) {}
      }
    })();
    return;
  }

  if (commandName === 'admin_transfer') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
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
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /admin_apply_last_race ────────────────────────────────
  // Applique manuellement les résultats d'un GP si applyRaceResults a planté
  if (commandName === 'admin_apply_last_race') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    // Répondre IMMÉDIATEMENT avant tout await pour éviter l'expiration des 3s
    await interaction.reply({ content: '⏳ Application des résultats en cours...', ephemeral: true });

    const rawId = interaction.options.getString('race_id');

    // Tout le travail async APRÈS le reply
    (async () => {
      try {
        const season = await getActiveSeason();
        if (!season) return await interaction.editReply('❌ Aucune saison active.');

        let race;
        try {
          if (rawId) {
            race = await Race.findById(rawId);
          } else {
            const allRaces = await Race.find({ seasonId: season._id }).sort({ index: -1 });
            race = allRaces.find(r => r.raceResults?.length && r.status !== 'done');
            if (!race) race = allRaces.find(r => r.raceResults?.length);
          }
        } catch(e) {
          return await interaction.editReply(`❌ ID invalide : ${e.message}`);
        }

        if (!race) return await interaction.editReply('❌ Aucune course avec des résultats trouvée.');
        if (!race.raceResults?.length) {
          const hint = race.status === 'race_computed'
            ? `\n✅ Status \`race_computed\` — la simulation a tourné mais les résultats n'ont pas été appliqués. Relance la commande.`
            : race.status === 'quali_done'
            ? `\n⚠️ Status \`quali_done\` — la course n'a pas encore été simulée. Utilise \`/admin_force_race\` d'abord.`
            : '';
          return await interaction.editReply(`❌ La course **${race.circuit}** n'a pas de résultats enregistrés. (status : \`${race.status}\`)${hint}`);
        }

        const alreadyApplied = race.status === 'done';
        await applyRaceResults(race.raceResults, race._id, season, []);

        const F1_POINTS_LOCAL = [25,18,15,12,10,8,6,4,2,1];
        const summary = race.raceResults.slice(0, 10).map((r, i) => {
          const pts = F1_POINTS_LOCAL[r.pos - 1] || 0;
          return `P${r.pos} ${r.pilotId} → +${pts}pts${r.dnf?' DNF':''}`;
        }).join('\n');

        await interaction.editReply(
          `${alreadyApplied ? '⚠️ Course déjà done — résultats RE-appliqués' : '✅ Résultats appliqués !'}\n` +
          `**${race.emoji || '🏁'} ${race.circuit}** (index ${race.index})\n\`\`\`\n${summary}\n\`\`\`\n` +
          `Race status → \`done\` ✅`
        );
      } catch(e) {
        console.error('[admin_apply_last_race] Erreur :', e.message);
        try { await interaction.editReply(`❌ Erreur : ${e.message}`); } catch(_) {}
      }
    })();
    return;
  }


  // ── /admin_set_race_results ───────────────────────────────
  // Permet de saisir manuellement le classement d'une course dont la simulation a planté
  if (commandName === 'admin_set_race_results') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    await interaction.reply({ content: '⏳ Traitement du classement en cours...', ephemeral: true });

    (async () => {
      try {
        const season = await getActiveSeason();
        if (!season) return await interaction.editReply('❌ Aucune saison active.');

        const gpIndex = interaction.options.getInteger('gp_index');
        const race = gpIndex !== null
          ? await Race.findOne({ seasonId: season._id, index: gpIndex })
          : await getCurrentRace(season);
        if (!race) return await interaction.editReply('❌ Aucun GP trouvé. Précise `gp_index` si besoin.');

        const classementRaw = interaction.options.getString('classement');
        const dnfRaw        = interaction.options.getString('dnf') || '';

        const finishNames = classementRaw.split(',').map(s => s.trim()).filter(Boolean);
        const dnfNames    = dnfRaw.split(',').map(s => s.trim()).filter(Boolean);

        // Charger tous les pilotes
        const allPilots = await Pilot.find();

        const findPilot = (name) => {
          const n = name.toLowerCase();
          return allPilots.find(p => p.name.toLowerCase() === n || p.name.toLowerCase().includes(n));
        };

        const raceResults = [];
        const notFound = [];

        for (let i = 0; i < finishNames.length; i++) {
          const pilot = findPilot(finishNames[i]);
          if (!pilot) { notFound.push(finishNames[i]); continue; }
          const isDnf = dnfNames.some(d => {
            const dn = d.toLowerCase();
            return pilot.name.toLowerCase() === dn || pilot.name.toLowerCase().includes(dn);
          });
          const pts = F1_POINTS[i] || 0;
          raceResults.push({
            pilotId   : pilot._id,
            teamId    : pilot.teamId,
            pos       : i + 1,
            dnf       : isDnf,
            dnfReason : isDnf ? 'MECHANICAL' : null,
            coins     : pts * 20 + (isDnf ? 0 : 60),
            fastestLap: false,
          });
        }

        if (notFound.length) {
          return await interaction.editReply(
            `❌ Pilotes introuvables : **${notFound.join(', ')}**\n` +
            `Vérifie les noms avec \`/pilotes\`. Les noms doivent correspondre (partiel accepté).`
          );
        }

        if (raceResults.length === 0)
          return await interaction.editReply('❌ Aucun pilote reconnu dans le classement.');

        // Sauvegarder et appliquer
        await Race.findByIdAndUpdate(race._id, { raceResults, status: 'race_computed' });
        await applyRaceResults(raceResults, race._id, season, []);

        const summary = raceResults.slice(0, 10).map(r => {
          const p = allPilots.find(p => String(p._id) === String(r.pilotId));
          const pts = F1_POINTS[r.pos - 1] || 0;
          return `P${r.pos} ${p?.name || r.pilotId} → +${pts}pts${r.dnf ? ' DNF' : ''}`;
        }).join('\n');

        await interaction.editReply(
          `✅ Classement appliqué pour **${race.emoji || '🏁'} ${race.circuit}** (index ${race.index})\n` +
          `\`\`\`\n${summary}\n\`\`\`\n` +
          `Race status → \`done\` ✅${notFound.length ? `\n⚠️ Introuvables (ignorés) : ${notFound.join(', ')}` : ''}`
        );
      } catch(e) {
        console.error('[admin_set_race_results] Erreur :', e.message);
        try { await interaction.editReply(`❌ Erreur : ${e.message}`); } catch(_) {}
      }
    })();
    return;
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
  if (d.getTime() !== today.getTime()) return false;
  // Vérifier aussi que le slot correspond à l'heure actuelle
  const currentSlot = getCurrentSlot();
  if (race.slot !== undefined && race.slot !== currentSlot) return false;
  return true;
}

async function runPractice(override, gpIndex = null) {
  const season = await getActiveSeason(); if (!season) return;
  const slot   = gpIndex !== null ? null : getCurrentSlot();
  const race   = gpIndex !== null
    ? await Race.findOne({ seasonId: season._id, index: gpIndex })
    : await getCurrentRace(season, slot);
  if (!race) return;
  if (!await isRaceDay(race, override)) return;
  // Garde : ne pas relancer si déjà fait
  if (race.status !== 'upcoming' && !override) {
    console.log(`[runPractice] Déjà fait pour ${race.circuit} slot=${race.slot} (status=${race.status})`);
    return;
  }

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { results, weather } = await simulatePractice(race, pilots, teams);
  const channel = await getRaceChannel(override);
  if (!channel) { await Race.findByIdAndUpdate(race._id, { status: 'practice_done' }); return; }

  const styleEmojis   = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  const weatherLabels = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Intermédiaire', HOT:'🔥 Chaud' };

  // ~30% des pilotes n'ont pas montré leur vrai rythme
  const sandbagging = new Set(
    [...results].sort(() => Math.random() - 0.5)
      .slice(0, Math.floor(results.length * 0.3))
      .map(r => String(r.pilot._id))
  );

  const lines = results.map((r, i) => {
    const note = sandbagging.has(String(r.pilot._id))
      ? pick([' *(programme réduit)*', ' *(pas poussé)*', ' *(essais techniques)*', ' *(longues distances)*'])
      : '';
    return `**P${i+1}** ${r.team.emoji} ${r.pilot.name} — ${msToLapStr(r.time)}${note}`;
  }).join('\n');

  const chaosNotes = [
    '⚠️ *Ces temps sont à prendre avec des pincettes — certains n\'ont pas montré leur rythme réel.*',
    '⚠️ *Programme très varié en piste : peu représentatif de la hiérarchie réelle.*',
    '⚠️ *Les essais libres brouillent souvent les cartes. La vraie hiérarchie se dessinera en qualifs.*',
    '⚠️ *Certaines écuries ont clairement caché leur jeu. Les qualifs diront tout.*',
  ];

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Essais Libres — ${race.emoji} ${race.circuit}`)
    .setColor('#888888')
    .setDescription(
      `Météo : **${weatherLabels[weather] || weather}** · Style : **${race.gpStyle.toUpperCase()}** ${styleEmojis[race.gpStyle] || ''}\n\n` +
      lines + '\n\n' + pick(chaosNotes)
    )
    .setFooter({ text: race.slot === 1 ? 'Classement complet · Qualifications à 18h 🏎️' : 'Classement complet · Qualifications à 13h 🏎️' });

  await channel.send({ embeds: [embed] });
  await Race.findByIdAndUpdate(race._id, { status: 'practice_done' });
}

async function runQualifying(override, gpIndex = null) {
  const season = await getActiveSeason(); if (!season) return;
  const slot   = gpIndex !== null ? null : getCurrentSlot();
  const race   = gpIndex !== null
    ? await Race.findOne({ seasonId: season._id, index: gpIndex })
    : await getCurrentRace(season, slot);
  if (!race) return;
  if (!await isRaceDay(race, override)) return;
  if (race.status !== 'practice_done' && !override) {
    console.log(`[runQualifying] Mauvais status pour ${race.circuit} (status=${race.status})`);
    return;
  }

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { grid, weather, q3Size, q2Size, allTimes } = await simulateQualifying(race, pilots, teams);
  const channel = await getRaceChannel(override);

  await Race.findByIdAndUpdate(race._id, {
    qualiGrid: grid.map(g => ({ pilotId: g.pilotId, time: g.time })),
    status: 'quali_done',
  });

  if (!channel) return;

  const styleEmojis   = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  const weatherLabels = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Intermédiaire', HOT:'🔥 Chaud' };
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));

  const q3Grid = grid.slice(0, q3Size);
  const q2Grid = grid.slice(q3Size, q2Size);
  const q1Grid = grid.slice(q2Size);
  const poleman = q3Grid[0];

  // ─── INTRO ───────────────────────────────────────────────
  await channel.send(
    `⏱️ **QUALIFICATIONS — ${race.emoji} ${race.circuit}**\n` +
    `${styleEmojis[race.gpStyle] || ''} **${race.gpStyle.toUpperCase()}** · Météo : **${weatherLabels[weather] || weather}**\n` +
    `Les pilotes prennent la piste pour décrocher la meilleure place sur la grille...`
  );
  await sleepMs(3000);

  // ─── Q1 ───────────────────────────────────────────────────
  await channel.send(`🟡 **Q1 — DÉBUT** · ${grid.length} pilotes en piste · La zone d'élimination commence à P${q2Size + 1}`);
  await sleepMs(2500);

  // Quelques temps intermédiaires fictifs pendant la session
  const midQ1 = [...grid].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q1 en cours...* ` +
    midQ1.map(g => `${g.teamEmoji}**${g.pilotName}** ${msToLapStr(g.time + randInt(200, 800))}`).join(' · ')
  );
  await sleepMs(3000);

  // Résultat Q1 — montrer le bas du tableau (les éliminés)
  // Drama Q1 : détection gros noms éliminés + temps intermédiaires surprenants
  const q1DramaLine = (() => {
    // Chercher qui a le meilleur rang classement parmi les éliminés
    const bestElim = q1Grid[0]; // premier éliminé = meilleur temps parmi les sortants
    if (!bestElim) return '';
    // Comparer le temps du dernier qualifié vs premier éliminé
    const lastQ2   = allTimes[q2Size - 1];
    const gapMs    = bestElim.time - lastQ2.time;
    const gapStr   = (gapMs / 1000).toFixed(3);
    if (gapMs < 100) return `\n⚠️ *${bestElim.teamEmoji}**${bestElim.pilotName}** éliminé à seulement **${gapStr}s** — scénario cruel !*`;
    if (gapMs < 300) return `\n⚠️ *${bestElim.teamEmoji}**${bestElim.pilotName}** à **${gapStr}s** de la qualification — si près...*`;
    return '';
  })();

  const q1EliminEmbed = new EmbedBuilder()
    .setTitle(`🔴 Q1 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF4444')
    .setDescription(
      `**Éliminés (P${q2Size + 1}–${grid.length}) :**\n` +
      q1Grid.map((g, i) => {
        const gap = `+${((g.time - poleman.time) / 1000).toFixed(3)}s`;
        return `\`P${q2Size + 1 + i}\` ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
      }).join('\n') +
      `\n\n**Passage en Q2 :** Top ${q2Size} pilotes ✅` + q1DramaLine
    );
  await channel.send({ embeds: [q1EliminEmbed] });
  await sleepMs(4000);

  // ─── Q2 ───────────────────────────────────────────────────
  const q2BubbleLine = grid.slice(q3Size - 1, q3Size + 3).map(g => `${g.teamEmoji}**${g.pilotName}**`).join(' · ');
  await channel.send(
    `🟡 **Q2 — DÉBUT** · ${q2Size} pilotes en piste · La zone d'élimination commence à P${q3Size + 1}\n` +
    `*Sur le fil : ${q2BubbleLine}*`
  );
  await sleepMs(2500);

  const midQ2 = q2Grid.concat(q3Grid).sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q2 en cours...* ` +
    midQ2.map(g => `${g.teamEmoji}**${g.pilotName}** ${msToLapStr(g.time + randInt(100, 500))}`).join(' · ')
  );
  await sleepMs(3000);

  // Drama Q2 : mentionner le pilote qui a failli ne pas passer
  const lastQ3 = q3Grid[q3Size - 1]; // dernier qualifié en Q3
  const firstOut = q2Grid[0]; // premier éliminé en Q2
  const q2Thriller = ((firstOut.time - lastQ3.time) / 1000).toFixed(3);

  const q2EliminEmbed = new EmbedBuilder()
    .setTitle(`🔴 Q2 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF8800')
    .setDescription(
      `**Éliminés (P${q3Size + 1}–${q2Size}) :**\n` +
      q2Grid.map((g, i) => {
        const gap = `+${((g.time - poleman.time) / 1000).toFixed(3)}s`;
        return `\`P${q3Size + 1 + i}\` ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}`;
      }).join('\n') +
      `\n\n⚠️ **${lastQ3.teamEmoji}${lastQ3.pilotName}** passe de justesse — **${q2Thriller}s** d'avance sur **${firstOut.teamEmoji}${firstOut.pilotName}** !` +
      `\n\n**Passage en Q3 :** Top ${q3Size} pilotes ✅`
    );
  await channel.send({ embeds: [q2EliminEmbed] });
  await sleepMs(4000);

  // ─── DRAMA CLASSEMENT CHAMPIONNAT ─────────────────────────
  // Si un pilote haut au championnat est mal qualifié → drama
  try {
    const season = await getActiveSeason();
    if (season) {
      const champStandings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).limit(8);
      const allPilotsForDrama = await Pilot.find();
      const pilotMapD = new Map(allPilotsForDrama.map(p => [String(p._id), p]));
      const allTeamsD = await Team.find();
      const teamMapD  = new Map(allTeamsD.map(t => [String(t._id), t]));

      const dramaLines = [];
      champStandings.forEach((s, champPos) => {
        const pilot = pilotMapD.get(String(s.pilotId));
        if (!pilot) return;
        const gridEntry = grid.find(g => String(g.pilotId) === String(s.pilotId));
        if (!gridEntry) return;
        const gridPos = grid.indexOf(gridEntry) + 1;
        const team = teamMapD.get(String(pilot.teamId));
        const emoji = team?.emoji || '';

        // Drama si un top-5 championnat est qualifié mal (P8+)
        if (champPos <= 4 && gridPos >= 8) {
          const gap = ((gridEntry.time - grid[0].time) / 1000).toFixed(3);
          const severity = gridPos >= 14 ? '🚨' : '⚠️';
          dramaLines.push(`${severity} **${emoji}${pilot.name}** — P${champPos + 1} au championnat, seulement **P${gridPos}** en grille ! *+${gap}s — session cauchemardesque pour le camp ${team?.name || 'de l\'écurie'}.*`);
        }
        // Drama si le leader du championnat est en pole
        if (champPos === 0 && gridPos === 1) {
          dramaLines.push(`👑 **${emoji}${pilot.name}** confirme son statut de leader en décrochant la **pole** ! *Le championnat passerait bien par la victoire ici...*`);
        }
        // Drama si le P2 du championnat devance le leader en grille
        if (champPos === 1 && gridPos < (grid.findIndex(g => String(g.pilotId) === String(champStandings[0]?.pilotId)) + 1)) {
          const leaderPilot = pilotMapD.get(String(champStandings[0]?.pilotId));
          dramaLines.push(`🔥 **${emoji}${pilot.name}** (P2 championnat) devant **${leaderPilot?.name || 'le leader'}** en grille ! *Retournement de situation possible demain.*`);
        }
      });

      if (dramaLines.length > 0) {
        await channel.send(`📊 **CONTEXT CHAMPIONNAT :**\n${dramaLines.slice(0,3).join('\n')}`);
        await sleepMs(2500);
      }
    }
  } catch(e) { console.error('Quali drama error:', e.message); }

  // ─── Q3 ───────────────────────────────────────────────────
  const q3Names = q3Grid.map(g => `${g.teamEmoji}**${g.pilotName}**`).join(' · ');
  await channel.send(
    `🔥 **Q3 — SHOOT-OUT POUR LA POLE !**\n` +
    `Les ${q3Size} meilleurs pilotes donnent tout — UN tour, TOUT jouer.\n` +
    `*En piste : ${q3Names}*`
  );
  await sleepMs(3000);

  // Suspense : annoncer les temps progressivement en inverse (dernier → premier)
  const q3Reversed = [...q3Grid].reverse();
  for (let i = 0; i < Math.min(3, q3Reversed.length); i++) {
    const g   = q3Reversed[i];
    const pos = q3Grid.length - i;
    await channel.send(`📻 **${g.teamEmoji}${g.pilotName}** — ${msToLapStr(g.time)} · provisoirement **P${pos}**`);
    await sleepMs(1500);
  }
  await sleepMs(1500);

  // Embed final Q3 — grille de départ
  // Grille F1-style : P1 gauche, P2 droite, P3 gauche, P4 droite...
  // ┌─────────────────────────────────────────┐
  // │ P1 [gauche]    P2 [droite]              │
  // │ P3 [gauche]    P4 [droite]              │
  // └─────────────────────────────────────────┘
  const buildGridDisplay = (gridArr, startIdx = 0) => {
    const rows = [];
    for (let i = 0; i < gridArr.length; i += 2) {
      const left  = gridArr[i];
      const right = gridArr[i + 1];
      const posL  = startIdx + i + 1;
      const posR  = startIdx + i + 2;
      const leftStr  = left  ? `\`P${String(posL).padStart(2,' ')}\` ${left.teamEmoji}**${left.pilotName}**`  : '';
      const rightStr = right ? `\`P${String(posR).padStart(2,' ')}\` ${right.teamEmoji}**${right.pilotName}**` : '';
      rows.push(`${leftStr.padEnd(28,' ')}${rightStr}`);
    }
    return rows.join('\n');
  };

  const fullGrid = [...q3Grid, ...q2Grid, ...q1Grid];
  const gridLines = buildGridDisplay(fullGrid);

  const q3Embed = new EmbedBuilder()
    .setTitle(`🏆 GRILLE DE DÉPART — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(
      `**🏆 POLE : ${poleman.teamEmoji}${poleman.pilotName}** — ${msToLapStr(poleman.time)}\n` +
      (q3Grid[1] ? `**2ème : ${q3Grid[1].teamEmoji}${q3Grid[1].pilotName}** — +${((q3Grid[1].time - poleman.time)/1000).toFixed(3)}s` : '') +
      `\n\n${gridLines}\n\n` +
      `Météo Q : **${weatherLabels[weather] || weather}**`
    );
  await channel.send({ embeds: [q3Embed] });
  await sleepMs(1500);

  // ─── Message pole position ────────────────────────────────
  const gap2nd = q3Grid[1] ? ((q3Grid[1].time - poleman.time) / 1000).toFixed(3) : null;
  const poleMsg = gap2nd && parseFloat(gap2nd) < 0.1
    ? `***⚡ POLE POSITION INCROYABLE !!! ${poleman.teamEmoji}${poleman.pilotName} EN ${msToLapStr(poleman.time)} !!!***\n*Seulement +${gap2nd}s de marge — la grille est ultra-serrée demain !*`
    : gap2nd && parseFloat(gap2nd) > 0.5
      ? `🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** — ${msToLapStr(poleman.time)}\n**+${gap2nd}s** d'avance sur ${q3Grid[1]?.teamEmoji}**${q3Grid[1]?.pilotName}**. *Grosse marge — il part favori !*`
      : `🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** — ${msToLapStr(poleman.time)}` +
        (gap2nd ? ` · **+${gap2nd}s** sur ${q3Grid[1]?.teamEmoji}**${q3Grid[1]?.pilotName}**` : '');
  await channel.send(poleMsg);
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

  // ── Sauvegarder dans le Hall of Fame ─────────────────────
  try {
    const allPilotsAll = await Pilot.find();
    const topRated = allPilotsAll.reduce((best, p) => {
      const ov = overallRating(p);
      return (!best || ov > overallRating(best)) ? p : best;
    }, null);

    await HallOfFame.findOneAndUpdate(
      { seasonYear: season.year },
      {
        seasonYear      : season.year,
        champPilotId    : champ?._id || null,
        champPilotName  : champ?.name || '?',
        champTeamName   : champTeam?.name || '?',
        champTeamEmoji  : champTeam?.emoji || '🏎️',
        champPoints     : champStanding?.points || 0,
        champWins       : champStanding?.wins || 0,
        champPodiums    : champStanding?.podiums || 0,
        champDnfs       : champStanding?.dnfs || 0,
        champConstrName  : champConstr?.name || '?',
        champConstrEmoji : champConstr?.emoji || '🏗️',
        champConstrPoints: constrStandings[0]?.points || 0,
        mostWinsName    : mostWins ? pilotMap.get(String(mostWins.pilotId))?.name : null,
        mostWinsCount   : mostWins?.wins || 0,
        mostDnfsName    : mostDnfs ? pilotMap.get(String(mostDnfs.pilotId))?.name : null,
        mostDnfsCount   : mostDnfs?.dnfs || 0,
        topRatedName    : topRated?.name || null,
        topRatedOv      : topRated ? overallRating(topRated) : null,
      },
      { upsert: true }
    );
  } catch(e) { console.error('HallOfFame save error:', e.message); }
}

async function runRace(override, gpIndex = null) {
  const season = await getActiveSeason(); if (!season) return;
  const slot   = gpIndex !== null ? null : getCurrentSlot();
  const race   = gpIndex !== null
    ? await Race.findOne({ seasonId: season._id, index: gpIndex })
    : await getCurrentRace(season, slot);
  if (!race || race.status === 'done' || race.status === 'race_computed') return;
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
  const { results, collisions } = await simulateRace(race, grid, pilots, teams, contracts, channel, season);
  await applyRaceResults(results, race._id, season, collisions);

  // ── Annonce rivalités nouvellement déclarées ─────────────
  if (channel && collisions.length) {
    // Recharger les pilotes pour voir les rivalités mises à jour
    const updatedPilots = await Pilot.find({ _id: { $in: pilots.map(p => p._id) } });
    const rivalAnnounces = [];
    for (const p of updatedPilots) {
      if (!p.rivalId) continue;
      const rival = updatedPilots.find(r => String(r._id) === String(p.rivalId));
      if (!rival) continue;
      // Annoncer seulement si la rivalité a été confirmée (2+ contacts) et pas encore annoncée
      if ((p.rivalContacts || 0) === 2) {
        const pTeam = pilots.find(pi => String(pi._id) === String(p._id));
        const rTeam = pilots.find(pi => String(pi._id) === String(rival._id));
        // Éviter les doublons (A-B et B-A)
        const pairKey = [String(p._id), String(rival._id)].sort().join('_');
        if (!rivalAnnounces.includes(pairKey)) {
          rivalAnnounces.push(pairKey);
          const ptTeam = teams.find(t => String(t._id) === String(p.teamId));
          const rvTeam = teams.find(t => String(t._id) === String(rival.teamId));
          await channel.send(
            `⚔️ **RIVALITÉ DÉCLARÉE !**\n` +
            `${ptTeam?.emoji || ''}**${p.name}** vs ${rvTeam?.emoji || ''}**${rival.name}** — ` +
            `2 contacts en course cette saison. *Ces deux-là ne s'aiment pas...*\n` +
            `*La narration prendra note de leurs prochaines confrontations !*`
          );
        }
      }
    }
  }

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

    // Classement pilotes
    const pilotStandings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).limit(20);
    const pilotIds2      = pilotStandings.map(s => s.pilotId);
    const allPilots2     = await Pilot.find({ _id: { $in: pilotIds2 } });
    const allTeams2b     = await Team.find();
    const pilotMap2      = new Map(allPilots2.map(p => [String(p._id), p]));
    const teamMap2b      = new Map(allTeams2b.map(t => [String(t._id), t]));
    const medals2        = ['🥇','🥈','🥉'];
    let pilotDesc = '';
    for (let i = 0; i < pilotStandings.length; i++) {
      const s = pilotStandings[i];
      const p = pilotMap2.get(String(s.pilotId));
      const t = p?.teamId ? teamMap2b.get(String(p.teamId)) : null;
      pilotDesc += `${medals2[i] || `**${i+1}.**`} ${t?.emoji||''} **${p?.name||'?'}** — ${s.points} pts (${s.wins}V ${s.podiums}P)\n`;
    }
    const pilotEmbed = new EmbedBuilder()
      .setTitle(`🏆 Classement Pilotes — Saison ${season.year}`)
      .setColor('#FF1801')
      .setDescription(pilotDesc || 'Aucune donnée');
    await channel.send({ embeds: [pilotEmbed] });
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
  // ── Slot 0 : GP matin (11h essais · 13h qualifs · 15h course) ──
  cron.schedule('0 11 * * *', () => runPractice().catch(console.error),   { timezone: 'Europe/Paris' });
  cron.schedule('0 13 * * *', () => runQualifying().catch(console.error), { timezone: 'Europe/Paris' });
  cron.schedule('0 15 * * *', () => runRace().catch(console.error),       { timezone: 'Europe/Paris' });
  // ── Slot 1 : GP soir (17h essais · 18h qualifs · 20h course) ──
  cron.schedule('0 17 * * *', () => runPractice().catch(console.error),   { timezone: 'Europe/Paris' });
  cron.schedule('0 18 * * *', () => runQualifying().catch(console.error), { timezone: 'Europe/Paris' });
  cron.schedule('0 20 * * *', () => runRace().catch(console.error),       { timezone: 'Europe/Paris' });
  console.log('✅ Scheduler slot 0 : 11h EL · 13h Q · 15h Course');
  console.log('✅ Scheduler slot 1 : 17h EL · 18h Q · 20h Course');
  console.log('✅ Keep-alive : ping toutes les 8min');
}

// ── Vérification des variables d'environnement ──────────────
const REQUIRED_ENV = { DISCORD_TOKEN: TOKEN, CLIENT_ID, GUILD_ID, MONGODB_URI: MONGO_URI };
let missingEnv = false;
for (const [key, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) {
    console.error(`❌ Variable d'environnement manquante : ${key}`);
    missingEnv = true;
  }
}
if (missingEnv) {
  console.error('❌ Bot arrêté — configure les variables manquantes sur Render/Railway.');
  process.exit(1);
}

// ── Sécurité globale — empêche le crash sur erreurs non catchées ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  unhandledRejection :', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  uncaughtException :', err.message);
});
client.on('error', (err) => {
  console.error('⚠️  Discord client error :', err.message);
});

// ── Debug WebSocket / Gateway ─────────────────────────────────
client.on('shardReady',        (id)     => console.log('🟢 Shard ' + id + ' ready'));
client.on('shardError',        (err)    => console.error('🔴 Shard error :', err.message));
client.on('shardDisconnect',   (ev, id) => console.warn('🟡 Shard ' + id + ' disconnect — code ' + ev.code));
client.on('shardReconnecting', (id)     => console.log('🔄 Shard ' + id + ' reconnecting...'));
client.on('invalidated',       ()       => { console.error('❌ Session Discord invalidée — token révoqué ?'); process.exit(1); });
client.on('warn',              (msg)    => console.warn('⚠️  Discord warn :', msg));
client.on('debug',             (msg)    => {
  if (msg.includes('Identified') || msg.includes('READY') || msg.includes('Error') ||
      msg.includes('rate limit') || msg.includes('gateway') || msg.includes('401') || msg.includes('4004')) {
    console.log('🔍 Discord debug :', msg);
  }
});

console.log('🔄 Connexion Discord en cours...');
client.login(TOKEN).catch(err => {
  console.error('❌ ERREUR login Discord :', err.message);
  console.error('❌ Vérifie que DISCORD_TOKEN est correct dans les variables Render.');
  process.exit(1);
});

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
