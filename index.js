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
  type       : { type: String, required: true },  // 'rivalry','transfer_rumor','drama','hype','form_crisis','teammate_duel','dev_vague','scandal','title_fight','driver_interview','sponsoring','social_media','tv_show','relationship','friendship','lifestyle','scandal_offtrack','charity','brand_deal'
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
  { name:'Red Bull Racing', emoji:'🟡', color:'#1E3A5F', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Ferrari',         emoji:'🔴', color:'#DC143C', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Mercedes',        emoji:'🩶', color:'#00D2BE', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'McLaren',         emoji:'🟠', color:'#FF7722', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Aston Martin',    emoji:'🟢', color:'#006400', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Alpine',          emoji:'🩷', color:'#0066CC', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Williams',        emoji:'🔵', color:'#00B4D8', budget:100,
    vitesseMax:75, drs:75, refroidissement:75, dirtyAir:75, conservationPneus:75, vitesseMoyenne:75, devPoints:0 },
  { name:'Haas',            emoji:'⚪', color:'#AAAAAA', budget:100,
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
  if (!tireData) return 90_000;
  const carTireBonus   = Math.max(-0.3, Math.min(0.3, (team.conservationPneus - 70) / 70 * 0.3));
  const pilotTireBonus = Math.max(-0.2, Math.min(0.2, (pilot.gestionPneus - 50) / 50 * 0.2));
  const effectiveDeg   = Math.max(0.0001, tireData.deg * (1 - carTireBonus - pilotTireBonus * 0.5));
  // tireLifeRef = durée de vie nominale par compound (tours avant cliff)
  // Cohérent avec wornThresholdFor : SOFT~20, MEDIUM~32, HARD~48
  const tireLifeBase = tireCompound === 'SOFT' ? 20 : tireCompound === 'HARD' ? 48 : 32;
  const tireLifeRef  = tireLifeBase * (1 + carTireBonus * 0.5 + pilotTireBonus * 0.5);
  const wearRatio    = Math.min(tireWear / Math.max(tireLifeRef, 1), 2.0);
  // Cliff progressif : linéaire jusqu'à 70% de vie, puis accélération ×3 au-delà
  const cliffFactor  = wearRatio < 0.7 ? 1.0 : 1.0 + (wearRatio - 0.7) * 3.5;
  const wearPenalty  = tireWear * effectiveDeg * cliffFactor;
  const tireF        = (1 + wearPenalty) / tireData.grip;

  // Dirty air — pénalité ~0.1s max sur circuit mixte, jusqu'à ~0.4s sur urbain
  // Les rues étroites rendent le suivi très difficile : peu d'espaces pour dépasser,
  // flux d'air très perturbé par les bâtiments, pas de DRS efficace.
  let dirtyAirF = 1.0;
  if (position > 1) {
    const baseDAMultiplier = gpStyle === 'urbain' ? 3.5   // rues étroites — suivi très coûteux
                           : gpStyle === 'technique' ? 1.8  // virages lents — difficile à suivre
                           : 1.0;
    const dirtyAirPenalty = (100 - team.dirtyAir) / 100 * 0.001 * baseDAMultiplier;
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

// ─── Durée de vie des pneus (réaliste F1) ─────────────────
// SOFT  : ~18-25 tours avant le cliff
// MEDIUM: ~28-38 tours avant le cliff
// HARD  : ~40-55 tours avant le cliff
// Ces valeurs sont des seuils d'usure (tireWear = tours sur ces pneus)
// Modifiées par la conservationPneus de la voiture et gestionPneus du pilote
function wornThresholdFor(tireCompound, team, pilot) {
  const base = tireCompound === 'SOFT' ? 20 : tireCompound === 'HARD' ? 48 : 32; // MEDIUM=32
  const carBonus   = (team.conservationPneus  - 70) * 0.18;  // ±5 tours max
  const pilotBonus = (pilot.gestionPneus      - 50) * 0.12;  // ±6 tours max
  return Math.max(8, base + carBonus + pilotBonus);
}

function shouldPit(driver, lapsRemaining, gapAhead, totalLaps, scActive = false) {
  const { tireWear, tireCompound, pilot, team, tireAge, pitStops, pitStrategy, overcutMode } = driver;

  // ── Pit opportuniste sous SC ────────────────────────────────
  // Si SC actif et qu'on n'a pas encore pité (ou qu'on doit encore piter) :
  // c'est la fenêtre parfaite — on perd peu de places car tout le monde est groupé.
  if (scActive && lapsRemaining > 6 && (pitStops || 0) < 2) {
    const needsPitAnyway = tireWear > wornThresholdFor(tireCompound, team, pilot) * 0.5;
    // Les pilotes qui ont encore à piter sautent sur l'opportunité SC
    const stillNeedToStop = (pitStrategy === 'two_stop' && (pitStops || 0) < 2) ||
                            (pitStops === 0); // pas encore pité du tout
    if (stillNeedToStop || needsPitAnyway) {
      // Probabilité plus haute si pneus déjà bien usés ou si pit de toute façon nécessaire
      const scPitChance = needsPitAnyway ? 0.80 : 0.55;
      if (Math.random() < scPitChance) return { pit: true, reason: 'sc_opportunity' };
    }
  }

  // Minimum de tours sur les pneus (sauf réparation forcée via tireAge=99)
  if (tireAge !== 99) {
    const minLapsOnTire = pitStops === 0 ? 10 : 6;
    if ((tireAge || 0) < minLapsOnTire) return { pit: false, reason: null };
  }

  // ── Dernier recours : fin de course et jamais pité ──────────
  // Règle F1 : obligation d'utiliser 2 compounds → forcer un pit si jamais arrêté
  if ((pitStops || 0) === 0 && lapsRemaining <= 12 && lapsRemaining > 5) {
    const forcedChance = 0.35 + (12 - lapsRemaining) * 0.08; // monte de 35% à ~99% sur les 8 derniers tours
    if (Math.random() < forcedChance) return { pit: true, reason: 'forced_compound' };
  }
  // Ultime filet : si on arrive au tour -5 sans jamais pité, pit systématique
  if ((pitStops || 0) === 0 && lapsRemaining <= 5) return { pit: true, reason: 'forced_compound' };

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

  // ── Seuils d'usure ───────────────────────────────────────────
  const wornThreshold  = wornThresholdFor(tireCompound, team, pilot);
  const urgentThreshold = wornThreshold * 1.25;

  if (tireWear > urgentThreshold) return { pit: true, reason: 'tires_worn' };
  if (tireWear > wornThreshold && Math.random() < 0.65) return { pit: true, reason: 'tires_worn' };

  // Undercut
  if (!scActive && gapAhead !== null && gapAhead < 1500 && tireWear > 20 && lapsRemaining > 18 && (tireAge || 0) >= 12) {
    const lastUnd = driver.lastUndercutLap || -99;
    if (lapsRemaining > (lastUnd - 4)) return { pit: false, reason: null };
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
  const q3Size = Math.min(10, Math.max(3, Math.floor(n * 0.5)));
  const q2Size = Math.min(15, Math.max(q3Size + 2, Math.floor(n * 0.75)));

  // ── Forme du jour : bonus/malus unique par pilote (±800ms) ──
  // Permet de redistribuer ~3-4 positions entre Q1, Q2 et Q3
  function makeSessionForm() {
    return new Map(pilots.map(p => [String(p._id), randInt(-600, 600)]));
  }

  // ── Track evolution par segment : les temps s'améliorent au fil des tours ──
  // Chaque segment donne jusqu'à -400ms grâce à l'évolution de la gomme
  function baseTime(pilot, team, trackEvoBonus = 0, sessionForm = null) {
    const base = calcQualiTime(pilot, team, weather, race.gpStyle);
    const form = sessionForm ? (sessionForm.get(String(pilot._id)) || 0) : 0;
    return base - trackEvoBonus + form;
  }

  // ── Tenter un tour rapide ─────────────────────────────────
  // Un pilote peut améliorer ou non selon son niveau et un peu de variance
  // aborted : true si tour annulé (drapeau jaune, trafic, erreur)
  function tryLap(pilot, team, best, trackEvoBonus = 0, yellowFlag = false, sessionForm = null) {
    if (yellowFlag && Math.random() < 0.55) return { time: Infinity, aborted: true };
    const raw = baseTime(pilot, team, trackEvoBonus, sessionForm) + randInt(-400, 400);
    const aborted = Math.random() < 0.04; // 4% de chance d'annuler son tour (erreur, trafic)
    if (aborted) return { time: Infinity, aborted: true };
    return { time: Math.min(best, raw), aborted: false, improved: raw < best };
  }

  // ── Q1 — 2 tentatives + track evo progressive ─────────────
  const q1Form = makeSessionForm(); // forme unique pour toute la Q1
  let q1State = pilots.map(pilot => {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) return null;
    const evo1 = randInt(0, 150);
    const evo2 = randInt(100, 300);
    const r1 = tryLap(pilot, team, Infinity, evo1, false, q1Form);
    const r2 = tryLap(pilot, team, r1.aborted ? Infinity : r1.time, evo2, false, q1Form);
    const bestTime = Math.min(
      r1.aborted ? Infinity : r1.time,
      r2.aborted ? Infinity : r2.time
    );
    const abortedBoth = r1.aborted && r2.aborted;
    return {
      pilot, team,
      time: abortedBoth ? baseTime(pilot, team, 0) + randInt(500, 1200) : bestTime,
      r1: r1.aborted ? null : r1.time,
      r2: r2.aborted ? null : r2.time,
      abortedLaps: (r1.aborted ? 1 : 0) + (r2.aborted ? 1 : 0),
      improved: !r1.aborted && !r2.aborted && r2.time < r1.time,
    };
  }).filter(Boolean);
  q1State.sort((a, b) => a.time - b.time);

  // Événements drama Q1
  const q1Events = [];
  // Pilote qui rate ses 2 tours
  const doubleAbort = q1State.find(s => s.abortedLaps === 2);
  if (doubleAbort) q1Events.push({ type: 'double_abort', pilot: doubleAbort });
  // Écart serré autour de la ligne de coupure Q1→Q2
  const cutQ1 = q1State[q2Size - 1]; // dernier passant
  const firstOut = q1State[q2Size];   // premier éliminé
  if (cutQ1 && firstOut) {
    const gap = (firstOut.time - cutQ1.time) / 1000;
    if (gap > 0 && gap < 0.15) q1Events.push({ type: 'thriller_q1', gap, safe: cutQ1, elim: firstOut });
  }

  // ── Q2 — 2 tentatives avec plus d'evo ─────────────────────
  const q2Candidates = q1State.slice(0, q2Size);
  const q1Eliminated = q1State.slice(q2Size);

  // Drapeau jaune aléatoire en Q2 (~30% de chance)
  const yellowFlagQ2 = Math.random() < 0.30;
  const yellowFlagPilotQ2 = yellowFlagQ2 ? pick(q2Candidates) : null;

  const q2Form = makeSessionForm(); // nouvelle forme pour Q2 — classement peut changer
  let q2State = q2Candidates.map(s => {
    const evo1 = randInt(150, 300);
    const evo2 = randInt(250, 450);
    const isYellow = yellowFlagQ2 && (Math.random() < 0.5);
    const r1 = tryLap(s.pilot, s.team, s.time, evo1, isYellow, q2Form);
    const r2 = tryLap(s.pilot, s.team, r1.aborted ? s.time : Math.min(s.time, r1.time), evo2, false, q2Form);
    const best = Math.min(
      s.time,
      r1.aborted ? Infinity : r1.time,
      r2.aborted ? Infinity : r2.time
    );
    return {
      ...s,
      time: best,
      improved: best < s.time,
      lostLapToYellow: isYellow && r1.aborted,
    };
  });
  q2State.sort((a, b) => a.time - b.time);

  const q2Events = [];
  if (yellowFlagPilotQ2) q2Events.push({ type: 'yellow_flag', trigger: yellowFlagPilotQ2 });
  const cutQ2 = q2State[q3Size - 1];
  const firstOutQ2 = q2State[q3Size];
  if (cutQ2 && firstOutQ2) {
    const gap = (firstOutQ2.time - cutQ2.time) / 1000;
    if (gap > 0 && gap < 0.12) q2Events.push({ type: 'thriller_q2', gap, safe: cutQ2, elim: firstOutQ2 });
    // Pilote qui perd sa place dans les dernières secondes
    const lastGasp = q2State.find((s, i) => i < q3Size && s.improved && s.time < firstOutQ2.time + 0.3 * 1000);
    if (lastGasp) q2Events.push({ type: 'last_gasp_q2', pilot: lastGasp });
  }
  // Victime du drapeau jaune éliminée
  const yellowVictim = q2State.find((s, i) => i >= q3Size && s.lostLapToYellow);
  if (yellowVictim) q2Events.push({ type: 'yellow_victim', pilot: yellowVictim });

  // ── Q3 — 2 tentatives, pression max ───────────────────────
  const q3Candidates = q2State.slice(0, q3Size);
  const q2Eliminated = q2State.slice(q3Size);

  // Red flag possible en Q3 (15% chance, crée un restart et des tours avortés)
  const redFlagQ3 = Math.random() < 0.15;
  const redFlagMoment = redFlagQ3 ? randInt(1, q3Size - 1) : -1; // après quel pilote

  const q3Form = makeSessionForm(); // nouvelle forme pour Q3 — encore un classement différent
  let q3State = q3Candidates.map((s, idx) => {
    const evo1 = randInt(300, 500);
    const evo2 = randInt(400, 600);
    const affectedByRed = redFlagQ3 && idx >= redFlagMoment;
    const r1 = tryLap(s.pilot, s.team, s.time, evo1, affectedByRed, q3Form);
    const r2 = tryLap(s.pilot, s.team, r1.aborted ? s.time : Math.min(s.time, r1.time), evo2, false, q3Form);
    const best = Math.min(
      s.time,
      r1.aborted ? Infinity : r1.time,
      r2.aborted ? Infinity : r2.time
    );
    return {
      ...s,
      time: best,
      improved: best < s.time,
      abortedByRed: affectedByRed && r1.aborted,
      r1q3: r1.aborted ? null : r1.time,
      r2q3: r2.aborted ? null : r2.time,
    };
  });
  q3State.sort((a, b) => a.time - b.time);

  const q3Events = [];
  if (redFlagQ3) {
    const trigger = q3Candidates[redFlagMoment];
    q3Events.push({ type: 'red_flag', trigger });
    const victims = q3State.filter(s => s.abortedByRed);
    if (victims.length) q3Events.push({ type: 'red_victims', victims });
  }
  // Pole surprise : pilote pas favori prend la pole
  const poleDriver = q3State[0];
  const secondDriver = q3State[1];
  if (poleDriver && secondDriver) {
    const poleGap = (q3State[1]?.time - poleDriver.time) / 1000;
    if (poleGap > 0 && poleGap < 0.05) q3Events.push({ type: 'photo_finish_pole', gap: poleGap, pole: poleDriver, second: secondDriver });
    else if (poleGap > 0.6) q3Events.push({ type: 'dominant_pole', gap: poleGap, pole: poleDriver });
  }

  // ── Grille finale ─────────────────────────────────────────
  const allSorted = [...q3State, ...q2Eliminated, ...q1Eliminated];
  const finalGrid = allSorted.map((s, i) => ({
    pilotId   : s.pilot._id,
    pilotName : s.pilot.name,
    teamName  : s.team.name,
    teamEmoji : s.team.emoji,
    time      : s.time,
    improved  : s.improved,
    segment   : i < q3Size ? 'Q3' : i < q2Size ? 'Q2' : 'Q1',
  }));

  return {
    grid: finalGrid, weather, q3Size, q2Size, allTimes: allSorted,
    drama: { q1: q1Events, q2: q2Events, q3: q3Events },
    q1State, q2State, q3State,
    q1Eliminated, q2Eliminated,
    yellowFlagQ2: yellowFlagPilotQ2,
    redFlagQ3,
  };
}

// ─── SIMULATION ESSAIS LIBRES (E1 / E2 / E3) ─────────────────────────────
// E1 & E2 : sessions de test — résultats très aléatoires, peu représentatifs
// E3      : simulation de setup — temps plus proches de la réalité
async function simulatePractice(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','DRY','WET','INTER']);

  const compoundPool = weather === 'WET'   ? ['WET','WET','INTER'] :
                       weather === 'INTER' ? ['INTER','INTER','WET'] :
                       ['SOFT','SOFT','MEDIUM','HARD'];

  function sessionResults(varianceFactor, setupBonus = 0) {
    const res = [];
    for (const pilot of pilots) {
      const team = teams.find(t => String(t._id) === String(pilot.teamId));
      if (!team) continue;
      const compound = weather === 'WET'   ? 'WET'  :
                       weather === 'INTER' ? 'INTER' :
                       setupBonus > 0      ? 'SOFT'  : pick(compoundPool);
      const base      = calcQualiTime(pilot, team, weather, race.gpStyle);
      const variance  = randInt(-varianceFactor, varianceFactor);
      const setupGain = setupBonus > 0
        ? Math.floor((pilot.controle + pilot.freinage) / 2 * setupBonus / 100)
        : 0;
      const noTime = Math.random() < 0.08; // 8% : pas de tour chronométré
      res.push({ pilot, team, time: noTime ? null : base + variance - setupGain, compound, noTime });
    }
    res.sort((a, b) => {
      if (a.time === null && b.time === null) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time;
    });
    return res;
  }

  const e1 = sessionResults(3500);      // très chaotique
  const e2 = sessionResults(2800);      // encore aléatoire
  const e3 = sessionResults(600, 180);  // représentatif, tous en SOFT

  function pickIncidents(results) {
    return results.filter(r => r.noTime).map(r => ({ type: 'no_time', pilot: r.pilot, team: r.team }));
  }

  return {
    weather,
    e1: { results: e1, incidents: pickIncidents(e1) },
    e2: { results: e2, incidents: pickIncidents(e2) },
    e3: { results: e3, incidents: pickIncidents(e3) },
  };
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
function atmosphereLine(ranked, lap, totalLaps, weather, scState, gpStyle, justRestarted = false) {
  if (!ranked.length) return null;
  const leader = ranked[0];
  const second = ranked[1];
  const third  = ranked[2];
  const pct    = lap / totalLaps;

  const lines = [];

          // ── Tour de relance SC/VSC : commentaire neutre uniquement ──
  if (justRestarted) {
    return pick([
      `🟢 **T${lap}** — Les pilotes chauffent leurs pneus après la relance. Le rythme revient progressivement.`,
      `🟢 **T${lap}** — Course relancée. Tout le monde cherche son rythme — l'attaque viendra dans quelques tours.`,
      `🟢 **T${lap}** — Relance propre. Les ingénieurs transmettent les consignes — qui va attaquer en premier ?`,
    ]);
  }

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
      if (gap3 < 1.0) lines.push(`🏎️ **Bagarre à trois !** ${leader.team.emoji}**${leader.pilot.name}** · ${second.team.emoji}**${second.pilot.name}** · ${third.team.emoji}**${third.pilot.name}** — tous dans le même mouchoir !`);
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
// attacker = celui qui REPREND sa place (vient de se faire passer, contre-attaque)
// defender = celui qui venait de passer (se fait re-passer)
function counterAttackDescription(attacker, defender, gpStyle) {
  const a = `${attacker.team.emoji}**${attacker.pilot.name}**`;
  const d = `${defender.team.emoji}**${defender.pilot.name}**`;
  return pick([
    `***⚡ CONTRE-ATTAQUE IMMÉDIATE !*** ${d} avait cru avoir fait le plus dur, mais ${a} retarde son freinage au maximum — ***il REPASSE !*** Incroyable !`,
    `***🔄 IL REPREND SA PLACE !*** ${a} passe à l'intérieur du prochain virage — ${d} ne s'y attendait pas ! ***INVERSION !***`,
    `***😤 PAS QUESTION DE LAISSER ÇA !*** ${a} répond dans la foulée — il force son chemin et reprend la position ! ***FANTASTIQUE !***`,
    `***💥 RÉPONSE IMMÉDIATE !*** ${d} avait cru avoir fait le plus dur, mais ${a} est là — freinage tardif, corde parfaite. ***Il revient !***`,
    `🔄 ${a} ne se laisse pas faire — il trouve l'ouverture au virage suivant et récupère sa position dans la foulée !`,
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
if (finishedSorted[0]) {
  const winnerAngle = Math.random() < 0.3
    ? pick(['radio_moment', 'paddock_note'])
    : 'winner';
  confSubjects.push({ result: finishedSorted[0], angle: winnerAngle });
}
        
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
    if (block) blocks.push({ block, photoUrl: pilot.photoUrl || null });
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

  if (angle === 'radio_moment') {
    const radioLine = pos === 1
      ? pick([
          `"Box, box ?" / "Négatif, reste dehors, le rythme est bon." — et ${name} a tenu.`,
          `"Pneus ?" / "Encore bons pour 8 tours." — le pari était calculé.`,
        ])
      : pick([
          `"Pousse, pousse !" / "J'essaie, la grip n'est plus là." — la réalité de la course.`,
          `"Position, gap." / "Compris. Je gère." — sobre et efficace.`,
        ]);
    return `📻 **${emoji} ${name} — P${pos}, ${circuit} (coulisses radio)**\n${radioLine}\n\n${pos <= 3 ? `Un résultat construit tour après tour. ${name} et son ingénieur ont géré à la perfection.` : `La communication équipe-pilote dit beaucoup. Ce week-end, le message est passé.`}`;
  }

  // ANGLE : note courte style paddock
  if (angle === 'paddock_note') {
    const notes = pos === 1
      ? [
          `✍️ **${name}, P1, ${circuit}** — Pas de grand discours. "\${styleStr}. On était là." Court, direct.`,
          `✍️ **${name} — victoire n°${wins} en ${gpPhase}** — "${constrStr || "L'équipe a encore répondu présente."}"`,
        ]
      : dnf
      ? [`✍️ **${name}, DNF, ${circuit}** — "Ces choses arrivent. Ça ne définit pas notre saison." Calme. Déterminé.`]
      : [
          `✍️ **${name}, P${pos}, ${circuit}** — "P${pos}. ${styleStr}. On prend et on avance." L'essentiel est dit.`,
        ];
    return pick(notes);
  }

  return null;
}

// ─── MOTEUR DE NEWS — Tabloïd de paddock ─────────────────

const NEWS_SOURCES = {
  // ── Sport / Paddock ──────────────────────────────────────
  pitlane_insider  : { name: '🔥 PitLane Insider',        color: '#FF4444' },
  paddock_whispers : { name: '🤫 Paddock Whispers',        color: '#9B59B6' },
  pl_racing_news   : { name: '🗞️ PL Racing News',          color: '#2C3E50' },
  f1_weekly        : { name: '📡 F1 Weekly',               color: '#2980B9' },
  // ── Gossip / Lifestyle ───────────────────────────────────
  turbo_people     : { name: '💅 Turbo People',            color: '#E91E8C' },
  paddock_mag      : { name: '✨ Paddock Mag',             color: '#FF9800' },
  speed_gossip     : { name: '🏎️💬 Speed Gossip',         color: '#E040FB' },
  grid_social      : { name: '📲 Grid Social',             color: '#00BCD4' },
  pl_celebrity     : { name: '🌟 PL Celebrity',            color: '#FFD700' },
  the_pit_wall_tmz : { name: '📸 The Pit Wall — TMZ Ed.',  color: '#FF5722' },
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

  // ── Thumbnail : photo du premier pilote cité qui en possède une ──
  if (article.pilotIds && article.pilotIds.length > 0) {
    try {
      for (const pid of article.pilotIds) {
        const p = await Pilot.findById(pid).select('photoUrl').lean();
        if (p?.photoUrl) { embed.setThumbnail(p.photoUrl); break; }
      }
    } catch(e) { /* silencieux */ }
  }

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

function genFormCrisisArticle(pilot, team, dnfs, lastResults, seasonYear, dnfThisRace = false) {
  const source = pick(['pitlane_insider', 'pl_racing_news', 'paddock_whispers']);

  const headlines = dnfThisRace ? [
    `${pilot.name} dans le dur — jusqu'où ?`,
    `DNF au dernier GP — ${pilot.name} traverse sa période la plus compliquée`,
    `${dnfs} abandon${dnfs > 1 ? 's' : ''} cette saison — ${pilot.name} dans une mauvaise passe`,
    `La spirale ${pilot.name} : accident de parcours ou signal d'alarme ?`,
  ] : [
    `${pilot.name} dans le dur — jusqu'où ?`,
    `Les résultats ne suivent pas pour ${pilot.name} — le paddock s'interroge`,
    `${team.emoji}${team.name} commence à s'interroger sur ${pilot.name}`,
    `${dnfs} abandon${dnfs > 1 ? 's' : ''} en saison — ${pilot.name} peine à trouver la régularité`,
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

// ─── INTERVIEW PILOTE — ressenti dans l'écurie ───────────────
// Variables prises en compte : résultats, contrat, status #1/#2, coéquipier,
// rival, overall, spécialisation, DNFs, victoires, phase de saison.
function genDriverInterviewArticle(pilot, team, standing, contract, teammate, teammateSt, seasonYear, seasonPhase) {
  const source = pick(['pitlane_insider', 'paddock_whispers', 'pl_racing_news', 'f1_weekly']);
  const ov     = overallRating(pilot);
  const wins   = standing?.wins   || 0;
  const pods   = standing?.podiums || 0;
  const dnfs   = standing?.dnfs   || 0;
  const pts    = standing?.points  || 0;
  const status = pilot.teamStatus; // 'numero1' | 'numero2' | null
  const seasonsLeft = contract?.seasonsRemaining ?? null;
  const totalDur    = contract?.seasonsDuration  ?? null;
  const isLongTerm  = totalDur  && totalDur >= 3;
  const isShortTerm = totalDur  && totalDur === 1;
  const isLastYear  = seasonsLeft === 1 && totalDur && totalDur > 1;
  const spec  = pilot.specialization;
  const rival = pilot.rivalId; // juste un flag de présence, pas le nom ici

  // ── Humeur globale pilote ───────────────────────────────────
  // Calcul d'un "mood score" -3 → +3
  let mood = 0;
  if (wins >= 3)   mood += 2;
  else if (wins >= 1) mood += 1;
  if (pods >= 4)   mood += 1;
  if (dnfs >= 3)   mood -= 2;
  else if (dnfs >= 1) mood -= 1;
  if (status === 'numero1') mood += 1;
  if (status === 'numero2') mood -= 1;
  if (seasonPhase === 'fin' && pts < 20) mood -= 1;
  if (isLastYear) mood -= 1; // contrat qui se termine = pression
  const moodLabel = mood >= 2 ? 'heureux' : mood >= 0 ? 'neutre' : mood === -1 ? 'tendu' : 'en crise';

  // ── Blocs thématiques ───────────────────────────────────────

  // A. Rapport avec l'écurie / ambiance
  const teamFeel = (() => {
    if (moodLabel === 'heureux') return pick([
      `"Honnêtement, je ne pourrais pas demander mieux. L'écurie ${team.name} m'a donné une voiture compétitive et une atmosphère de travail saine. On est alignés."`,
      `"L'usine travaille incroyablement bien en ce moment. Je sens qu'on tire tous dans le même sens. C'est rare, et ça se voit sur la piste."`,
      `"J'ai confiance en mes ingénieurs. On parle le même langage. Quand le pilote et l'ingénieur se comprennent vite, les résultats suivent."`,
    ]);
    if (moodLabel === 'neutre') return pick([
      `"La dynamique est bonne dans l'ensemble. Il y a des choses à améliorer — il y en a toujours — mais le dialogue est ouvert."`,
      `"On est dans une phase de travail. Pas de résultats fracassants, mais on construit quelque chose de sérieux chez ${team.name}."`,
      `"Je fais confiance au projet. Ce n'est pas une saison facile pour tout le monde, mais on avance."`,
    ]);
    if (moodLabel === 'tendu') return pick([
      `"Il y a des discussions internes en cours. Je ne vais pas tout détailler ici, mais on sait tous qu'on peut mieux faire."`,
      `"La relation est professionnelle. Mais professionnelle ne veut pas dire parfaite. On doit se parler franchement."`,
      `"Certaines décisions tactiques ce week-end m'ont surpris. Je préfère en discuter en interne plutôt qu'en conf de presse."`,
    ]);
    // en crise
    return pick([
      `"Je ne vais pas mentir : c'est compliqué en ce moment chez ${team.name}. Pas d'excuse — les résultats ne sont pas là, et ça génère de la pression de tous les côtés."`,
      `"On a des conversations difficiles. C'est normal quand les résultats ne suivent pas. Je reste concentré, mais la situation n'est pas idéale."`,
      `"${team.name} et moi devons nous reparler de la direction qu'on prend. Il y a un manque d'alignement en ce moment."`,
    ]);
  })();

  // B. Rapport avec le coéquipier
  const teammateFeel = (() => {
    if (!teammate) return null;
    const tmWins = teammateSt?.wins || 0;
    const tmPts  = teammateSt?.points || 0;
    const isBehind  = pts > tmPts;
    const isAhead   = pts < tmPts;
    if (status === 'numero1') return pick([
      `"${teammate.name} et moi on se challenge mutuellement. C'est sain. Je reste le pilote référence de l'équipe, mais je respecte son travail."`,
      `"Mon coéquipier monte en puissance. C'est bon pour l'équipe — mais c'est à moi de rester devant."`,
    ]);
    if (status === 'numero2') return pick([
      `"${teammate.name} a été meilleur que moi sur plusieurs courses. Je l'admets. Mon travail c'est de renverser ça."`,
      `"Je suis en train de trouver mes marques. ${teammate.name} a plus d'expérience dans cette voiture — pour l'instant. Ça va changer."`,
    ]);
    if (isBehind) return pick([
      `"J'ai une meilleure cohérence cette saison. ${teammate.name} a du talent, mais la régularité c'est ce qui compte sur une saison entière."`,
      `"Le duel interne ? On se bat sur la piste, pas dans les médias. Mais oui, être devant son coéquipier ça compte."`,
    ]);
    if (isAhead) return pick([
      `"${teammate.name} est devant dans les standings internes. Ça me motive à travailler encore plus. Je ne suis pas là pour être numéro 2."`,
      `"La comparaison avec ${teammate.name} est inévitable dans la même écurie. En ce moment il fait mieux. Je dois regarder pourquoi."`,
    ]);
    return pick([
      `"On est vraiment au coude-à-coude ${teammate.name} et moi. L'équipe peut s'appuyer sur les deux. C'est une force."`,
      `"${teammate.name} est un bon coéquipier. On se respecte. On se bat aussi. C'est la vie dans le même garage."`,
    ]);
  })();

  // C. Contrat / avenir
  const contractFeel = (() => {
    if (!contract) return pick([
      `"Ma situation contractuelle ? Je ne commente pas ça publiquement. Je me concentre sur la piste."`,
      `"Les négociations, c'est pour les agents et les directeurs. Moi je conduis."`,
    ]);
    if (isLastYear) return pick([
      `"C'est ma dernière saison sous ce contrat. Je vais tout donner pour que l'écurie veuille me renouveler — ou pour attirer d'autres offres. C'est la réalité du sport."`,
      `"Oui, je suis en fin de contrat. Mais ça ne change pas mon engagement. En fait, ça le renforce."`,
      `"Le mercato viendra quand il viendra. Pour l'instant, je dois prouver ma valeur sur la piste. C'est le meilleur argument de négociation."`,
    ]);
    if (isLongTerm) return pick([
      `"J'ai un contrat long chez ${team.name}. Ça me permet de construire quelque chose sur la durée. C'est important d'avoir cette stabilité."`,
      `"${seasonsLeft} saison(s) encore ici. Je suis investi dans ce projet sur le long terme. On a le temps de tout construire."`,
    ]);
    if (isShortTerm) return pick([
      `"Mon contrat est court. Ça m'oblige à performer dès maintenant — il n'y a pas de saison de rodage."`,
      `"Un contrat d'un an, ça concentre l'esprit. Chaque GP compte double."`,
    ]);
    return pick([
      `"Je suis bien ici. Le contrat est en cours, je ne me projette pas ailleurs."`,
      `"On verra pour la suite en temps voulu. Pour l'instant, je suis à ${team.name} et je suis concentré sur ça."`,
    ]);
  })();

  // D. Performances / overall
  const perfFeel = (() => {
    if (wins >= 3) return pick([
      `"${wins} victoires cette saison — je ne m'en lasse pas. Mais le travail en amont de chaque GP est colossal. Les résultats ne tombent pas du ciel."`,
      `"On est sur une bonne dynamique. ${wins} victoires, c'est bien, mais je sais qu'on peut encore s'améliorer sur certains aspects."`,
    ]);
    if (wins === 1) return pick([
      `"Cette victoire, elle m'a confirmé que j'avais le niveau pour gagner. Maintenant il faut transformer ça en régularité."`,
    ]);
    if (dnfs >= 3) return pick([
      `"${dnfs} abandons, c'est trop. Qu'est-ce qui cloche ? Un peu de tout : incidents, malchance, quelques erreurs. On doit réduire ça drastiquement."`,
      `"Les DNFs ont plombé ma saison. Mais je ne suis pas du genre à baisser les bras. Chaque course est une nouvelle page."`,
    ]);
    if (pods >= 3) return pick([
      `"${pods} podiums sans victoire encore — je sais ce que ça veut dire : on est rapide, mais pas encore assez constants sur les moments décisifs."`,
    ]);
    if (spec) return pick([
      `"Ma spécialisation en ${spec} — ça s'est construit naturellement. Je ne cherchais pas à me pigeon-holer, mais si ça me donne un avantage dans certains contextes, tant mieux."`,
      `"On me dit que je suis fort en ${spec}. Peut-être. Mais un bon pilote doit maîtriser toutes les facettes."`,
    ]);
    return pick([
      `"Saison correcte. Pas ce que je visais au départ, mais on progresse. Le niveau général est très élevé — chaque point arraché a de la valeur."`,
      `"Je ne suis pas satisfait à 100% de mes perfs — et c'est normal. L'auto-critique, c'est ce qui fait avancer."`,
    ]);
  })();

  // ── Assemblage de l'article ─────────────────────────────────
  const themes = [teamFeel, perfFeel];
  if (teammateFeel) themes.push(teammateFeel);
  themes.push(contractFeel);

  // On tire 2-3 thèmes distincts pour composer l'article
  const chosenThemes = themes.filter(Boolean);
  const articleThemes = chosenThemes.slice(0, Math.random() < 0.5 ? 2 : 3);

  const introLines = [
    `Rencontré dans le paddock après les essais, ${pilot.name} s'est livré à une rare confidence.`,
    `En marge du week-end de course, ${pilot.name} a accepté de répondre à quelques questions sur sa situation.`,
    `Interview exclusive — ${pilot.name} parle sans filtre de sa saison chez ${team.emoji}${team.name}.`,
    `${pilot.name} s'est arrêté quelques minutes pour évoquer son quotidien dans le paddock.`,
  ];

  const body = `${pick(introLines)}\n\n` + articleThemes.join('\n\n');

  const headlines = moodLabel === 'heureux' ? [
    `${pilot.name} : "Je ne pourrais pas demander mieux"`,
    `${pilot.name} parle de bonheur et d'alignement chez ${team.name}`,
    `${team.emoji}${pilot.name} — l'épanouissement au cœur du projet`,
  ] : moodLabel === 'neutre' ? [
    `${pilot.name} : "On construit quelque chose de sérieux"`,
    `${pilot.name} reste pragmatique sur sa saison`,
    `${team.emoji}${pilot.name} — travail, patience, confiance`,
  ] : moodLabel === 'tendu' ? [
    `${pilot.name} : "On doit se parler franchement"`,
    `Tension dans l'air — ${pilot.name} sort du silence`,
    `${team.emoji}${pilot.name} : les vérités du paddock`,
  ] : [
    `${pilot.name} : "La situation n'est pas idéale" — l'aveu`,
    `${pilot.name} en crise ? Le pilote répond`,
    `${team.emoji}${pilot.name} sous pression — il se confie`,
  ];

  return {
    type: 'driver_interview', source,
    headline: pick(headlines),
    body,
    pilotIds: [pilot._id],
    teamIds : [team._id],
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
  if (!pilot || !team) continue;
  const pilotRaceResult = finalResults.find(r => String(r.pilotId) === String(pilot._id));
  const dnfThisRace     = pilotRaceResult?.dnf === true;
  // DNF ce GP OU ≥2 DNFs en saison — évite le faux positif pour un pilote P5 sain
  const qualifiesCrisis = dnfThisRace || s.dnfs >= 2;
  if (qualifiesCrisis && Math.random() < crisisChance) {
    articlesToPost.push(genFormCrisisArticle(pilot, team, s.dnfs, null, season.year, dnfThisRace));
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

// ============================================================
// 🌟  GÉNÉRATEURS GOSSIP / LIFESTYLE / HORS-PISTE
// ============================================================

// ─── Helpers communs ─────────────────────────────────────────
const FOLLOWERS_POOL = ['12,4K','38,9K','67K','102K','215K','480K','1,2M','3,8M','8,1M'];
const TV_SHOWS = [
  { name: 'Danse avec les Stars',       emoji: '💃', country: 'France'      },
  { name: 'The Tonight Show',           emoji: '🎙️', country: 'US'          },
  { name: 'Jimmy Fallon',               emoji: '😂', country: 'US'          },
  { name: 'The Late Late Show',         emoji: '🎤', country: 'US'          },
  { name: 'Sunday Brunch',              emoji: '🍳', country: 'UK'          },
  { name: 'Quotidien',                  emoji: '📺', country: 'France'      },
  { name: 'C à vous',                   emoji: '🛋️', country: 'France'      },
  { name: 'Canal Sport Club',           emoji: '⚽', country: 'France'      },
  { name: 'TF1 — 20h',                  emoji: '📰', country: 'France'      },
  { name: 'Graham Norton Show',         emoji: '🇬🇧', country: 'UK'         },
  { name: 'Top Gear Live',              emoji: '🚗', country: 'UK'          },
  { name: 'The Ellen DeGeneres Show',   emoji: '🎁', country: 'US'          },
  { name: 'Good Morning America',       emoji: '☀️', country: 'US'          },
  { name: 'Touche pas à mon poste',     emoji: '📡', country: 'France'      },
  { name: 'Les Enfants de la télé',     emoji: '🎬', country: 'France'      },
  { name: 'Ninja Warrior',              emoji: '💪', country: 'France'      },
  { name: 'Le Grand Bain',              emoji: '🏊', country: 'France'      },
  { name: 'Fort Boyard',                emoji: '🏰', country: 'France'      },
];
const LUXURY_BRANDS = ['Rolex','Louis Vuitton','Prada','Gucci','Dior','Balenciaga','Off-White','Stone Island','AMG Performance','Porsche Design','Hugo Boss','Tommy Hilfiger','Nike Lab','Adidas Y-3'];
const GAMING_BRANDS = ['EA Sports','Gran Turismo','F1 24','Fortnite','Red Bull Gaming','Logitech G','Razer','SteelSeries'];
const CHARITY_CAUSES = [
  'la lutte contre le décrochage scolaire',
  'l\'accès au sport pour les jeunes défavorisés',
  'la sensibilisation au changement climatique',
  'la recherche contre les maladies rares',
  'l\'aide aux réfugiés',
  'les Restos du Cœur',
  'l\'alphabétisation en Afrique',
  'la protection des océans',
  'la santé mentale des sportifs de haut niveau',
  'UNICEF France',
  'la Fondation Abbé Pierre',
];
const DESTINATIONS_VACANCES = [
  'Ibiza','Dubaï','Miami','Monaco','Mykonos','Maldives','Bali','Tokyo','Los Angeles','Saint-Tropez','Courchevel','Tulum','New York','Marrakech','Zanzibar'
];
const RELATION_NOMS = [
  'une influenceuse','un mannequin','une actrice','un acteur','une chanteuse','un chanteur',
  'une joueuse de tennis','une athlète','une DJ','une podcasteuse',
  'une journaliste sportive','un entrepreneur tech',
];

// ─── 1. SPONSORING / PARTENARIAT COMMERCIAL ──────────────────
function genSponsoringArticle(pilot, team, seasonYear) {
  const source  = pick(['paddock_mag', 'pl_celebrity', 'pl_racing_news']);
  const brand   = pick([...LUXURY_BRANDS, ...GAMING_BRANDS, 'Red Bull','Monster Energy','Heineken 0.0','Qatar Airways','Aramco','Crypto.com','Oracle','AWS','Salesforce','DHL','LVMH']);
  const isLuxury = LUXURY_BRANDS.includes(brand);
  const isGaming = GAMING_BRANDS.includes(brand);

  const dealTypes = [
    { label: 'ambassadeur mondial', value: 'ambassador' },
    { label: 'partenariat lifestyle', value: 'lifestyle' },
    { label: 'collab capsule limitée', value: 'capsule' },
    { label: 'contrat d\'image pluriannuel', value: 'multi_year' },
  ];
  const deal = pick(dealTypes);

  const headlines = [
    `${pilot.name} × ${brand} : le deal de l'année est officiel`,
    `${team.emoji}${pilot.name} devient ${deal.label} de ${brand}`,
    `Coup de théâtre commercial : ${brand} mise sur ${pilot.name}`,
    `${pilot.name} rejoint la famille ${brand} — les chiffres font tourner la tête`,
    `"Un partenariat naturel" — ${pilot.name} s'associe à ${brand}`,
  ];

  const moneyLines = [
    `Les montants évoqués dans le paddock oscilleraient entre **800K et 2M PLcoins** par an.`,
    `Le deal serait évalué à plusieurs millions sur trois ans — une rémunération qui dépasse son salaire de pilote selon nos sources.`,
    `Pas de chiffres officiels communiqués, mais l'entourage du pilote parle d'un "contrat transformateur".`,
    `La somme reste confidentielle. Ce qu'on sait : ${pilot.name} a refusé deux autres offres pour celle-ci.`,
  ];

  const contextLines = isLuxury ? pick([
    `${brand} confirme ainsi son appétit pour le monde du sport automobile premium, après des années à flirter avec la F1 PL.`,
    `L'univers du luxe et de la vitesse se rencontrent. ${pilot.name} incarne exactement ce que ${brand} cherche : performance, style, présence internationale.`,
  ]) : isGaming ? pick([
    `${brand} cherchait un ambassadeur crédible dans l'esport et le vrai sport. ${pilot.name}, connu pour ses sessions gaming streamées, s'imposait naturellement.`,
    `"Les pilotes F1 PL sont des athlètes que la gen Z respecte." — un cadre de ${brand}, lors de la conférence d'annonce.`,
  ]) : pick([
    `${brand} élargit son portfolio sportif avec cette signature surprise.`,
    `Ce partenariat s'inscrit dans la stratégie de ${brand} d'associer son image à la nouvelle génération de champions.`,
  ]);

  const reactionLine = pick([
    `${team.emoji}${pilot.name} a réagi sur ses réseaux : *"Fier de rejoindre la famille ${brand}. Vivement la suite."* La publication a déjà dépassé les **47K likes**.`,
    `Dans un communiqué sobre, ${pilot.name} se dit "honoré et aligné avec les valeurs de ${brand}".`,
    `Première apparition prévue lors d'un événement parisien la semaine prochaine. Le paddock retient son souffle.`,
    `Son agent confirme : "C'est le partenariat le plus important de sa carrière hors piste à ce jour."`,
  ]);

  const body = `${pick(moneyLines)}\n\n${contextLines}\n\n${reactionLine}`;

  return {
    type: 'sponsoring', source,
    headline: pick(headlines),
    body, pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 2. RÉSEAUX SOCIAUX — Buzz, clash, post viral ────────────
function genSocialMediaArticle(pilot, team, standing, seasonYear) {
  const source    = pick(['grid_social', 'speed_gossip', 'turbo_people', 'the_pit_wall_tmz']);
  const followers = pick(FOLLOWERS_POOL);
  const wins      = standing?.wins || 0;
  const dnfs      = standing?.dnfs || 0;

  // Différents angles social media
  const angles = [
    // Post viral après victoire
    wins >= 1 ? () => {
      const likes = `${randInt(15, 890)}K`;
      const headline = pick([
        `${pilot.name} explose les compteurs sur Instagram après sa victoire`,
        `Le post de ${pilot.name} dépasse les ${likes} likes — record personnel`,
        `${team.emoji}${pilot.name} fait le buzz : son célébration en photo cartonne`,
      ]);
      const body = `Une simple photo publiée dans l'heure suivant sa victoire — et les chiffres ont tout de suite parlé.\n\n` +
        `**${likes} likes · ${randInt(2, 48)}K commentaires · ${randInt(5, 80)}K partages** en moins de 24h. Le compte de ${pilot.name} a gagné **+${randInt(8, 120)}K abonnés** dans la foulée.\n\n` +
        pick([
          `Parmi les commentaires, beaucoup de "GOAT 🐐" et des mentions de ses rivaux. L'ambiance est électrique.`,
          `Des célébrités, des athlètes, des pilotes adverses — tout le monde a liké. Même ${team.name} a relayé.`,
          `Son story "behind the scenes" a été vue ${randInt(200, 900)}K fois. Les sponsors ont dû se frotter les mains.`,
        ]);
      return { headline, body };
    } : null,
    // Clash en ligne
    () => {
      const platform = pick(['Twitter / X','Instagram','TikTok','Threads']);
      const headline = pick([
        `${pilot.name} répond à ses critiques sur ${platform} — ça part en live`,
        `Un troll s'en prend à ${pilot.name} — la réponse est cinglante`,
        `Le tweet de ${pilot.name} divise le paddock virtuel`,
        `${pilot.name} vs les haters : le thread qui fait le tour du web`,
      ]);
      const body = pick([
        `Après une sortie difficile, ${pilot.name} n'a pas pu s'empêcher de répondre aux commentaires négatifs sur ${platform}.\n\n"${pick(['Critiquez-moi quand vous aurez conduit à 300km/h sous la pluie.','Facile de juger depuis son canapé.','J\'ai hâte de voir votre temps au tour.'])}" Le post a été liké **${randInt(12, 340)}K fois** avant d'être supprimé — ou pas.`,
        `Une publication anodine de ${pilot.name} sur ${platform} a déclenché un débat inattendu. En cause : une légende de photo ambiguë que certains ont interprétée comme une pique envers ${team.name}.\n\n"Ce n'était absolument pas ce que je voulais dire" — son service comm a tenté d'éteindre l'incendie. Résultat mitigé.`,
        `Le compte de ${pilot.name} a liké puis unliké une publication critique à l'égard d'un pilote concurrent. Le screenshot circule. Sur ${platform}, rien ne disparaît vraiment.`,
      ]);
      return { headline, body };
    },
    // Stats followers / ranking
    () => {
      const rank = randInt(1, 15);
      const headline = pick([
        `${pilot.name} — ${followers} abonnés : le pilote PL le plus suivi de la grille ?`,
        `Classement réseaux : ${pilot.name} grimpe, et ce n'est pas anodin`,
        `Les chiffres ne mentent pas : ${pilot.name} est une marque à part entière`,
      ]);
      const body = `Avec **${followers} abonnés** sur Instagram seul, ${pilot.name} se classe parmi les pilotes les plus suivis de la grille PL.\n\n` +
        `Son taux d'engagement (**${(Math.random()*4+1).toFixed(1)}%**) dépasse la moyenne des sportifs de sa catégorie. Les annonceurs le savent.\n\n` +
        pick([
          `Sa présence sur TikTok commence aussi à peser : **${randInt(20, 800)}K followers**, des vidéos à plusieurs millions de vues.`,
          `Le ratio followers/publications est particulièrement bon — signe d'une communauté organique, pas achetée. Les marques adorent ça.`,
          `"${pilot.name} a une authenticité rare sur les réseaux. Il ne poste pas pour poster." — un community manager de l'écurie, sous couvert d'anonymat.`,
        ]);
      return { headline, body };
    },
    // TikTok viral / challenge
    () => {
      const views = `${randInt(1, 28)},${randInt(1, 9)}M`;
      const headline = pick([
        `La vidéo de ${pilot.name} dépasse les ${views} vues sur TikTok`,
        `Viral : ${pilot.name} relève un challenge et fait exploser TikTok`,
        `${pilot.name} se lâche en dehors de la piste — le web adore`,
      ]);
      const content = pick([
        `un POV "une journée dans ma vie de pilote"`,
        `un défi de réflexe avec ses mécaniciens`,
        `une réponse hilarante à un commentaire de fan`,
        `un "rate my setup" de son volant F1`,
        `une recette de cuisine ratée en cuisine de l'hôtel`,
        `un karting challenge contre son coéquipier filmé en caméra cachée`,
      ]);
      const body = `${views} vues en 48h. La vidéo de ${pilot.name} montrant ${content} est devenue le moment viral de la semaine dans la communauté F1 PL.\n\n` +
        pick([
          `Les commentaires affluent des quatre coins du monde. "On veut plus de contenu de ce genre" — c'est le sentiment dominant.`,
          `Plusieurs comptes de sport majeurs ont relayé la vidéo. Le nom de ${pilot.name} trend dans ${randInt(3, 12)} pays.`,
          `L'équipe a répondu avec humour dans les commentaires. ${team.emoji}${team.name} sait s'amuser sur les réseaux.`,
        ]);
      return { headline, body };
    },
  ].filter(Boolean);

  const chosen = pick(angles)();
  return {
    type: 'social_media', source,
    headline: chosen.headline,
    body: chosen.body,
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 3. INVITATION ÉMISSION TV ───────────────────────────────
function genTVShowArticle(pilot, team, seasonYear) {
  const source = pick(['turbo_people', 'pl_celebrity', 'paddock_mag', 'the_pit_wall_tmz']);
  const show   = pick(TV_SHOWS);
  const isReality = ['Danse avec les Stars','Ninja Warrior','Fort Boyard','Le Grand Bain'].includes(show.name);
  const isTalkShow = ['Jimmy Fallon','The Tonight Show','The Late Late Show','Graham Norton Show','Quotidien','C à vous','Touche pas à mon poste'].includes(show.name);

  const headlines = [
    `${pilot.name} invité sur le plateau de **${show.name}** — une première !`,
    `${show.emoji} ${pilot.name} × ${show.name} : le crossover inattendu`,
    `${pilot.name} confirme sa présence dans **${show.name}** — le paddock n'en revient pas`,
    `Après la piste, le plateau : ${pilot.name} accepte l'invitation de ${show.name}`,
    `${show.name} frappe fort en invitant ${pilot.name}`,
  ];

  const contexts = isReality ? pick([
    `Le défi est simple : sortir de sa zone de confort. Pour un pilote habitué à gérer l'adrénaline à 300km/h, ${show.name} représente un territoire inconnu — et c'est exactement pour ça que la production l'a approché.`,
    `La production a contacté l'entourage de ${pilot.name} après ses vidéos virales. "Il a une présence naturelle. Le public l'aimera au-delà du sport." La date d'enregistrement n'est pas encore confirmée.`,
  ]) : isTalkShow ? pick([
    `L'interview promet d'être sans filtre. ${show.name} est connu pour mettre ses invités à l'aise — et pour poser les questions que les journalistes sportifs évitent.`,
    `"On veut vous entendre parler d'autre chose que de courses", aurait dit la production à son agent. Le segment lifestyle, les projets personnels, la vie hors monoplace — tout sera sur la table.`,
  ]) : pick([
    `La participation est encore à confirmer. Mais les discussions sont "très avancées" selon notre source.`,
    `Un plateau inattendu pour un pilote de course — mais ${pilot.name} a toujours aimé surprendre.`,
  ]);

  const reactions = pick([
    `Dans le paddock, les avis sont partagés. "C'est bien de montrer un autre visage." "Ça le distraira de la piste." Les deux camps ont leurs arguments.`,
    `Son équipier ${team.emoji}${team.name} a commenté avec humour : "Tant qu'il est dans les points dimanche, il peut faire la télé le reste de la semaine."`,
    `La chaîne a officialisé la date : l'émission sera diffusée en direct. ${pilot.name} sera en plateau, pas en duplex — signal fort.`,
    `Son entourage précise que l'agenda sportif prime : "Si un GP tombe en conflit, l'émission passe à la trappe. Les priorités sont claires."`,
    `Première réaction publique de ${pilot.name} sur ses réseaux : un simple emoji 🤫. Les fans s'emballent.`,
  ]);

  const body = `${contexts}\n\n${reactions}`;
  return {
    type: 'tv_show', source,
    headline: pick(headlines),
    body, pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 4. VIE SENTIMENTALE / RELATIONS ─────────────────────────
function genRelationshipArticle(pilot, team, seasonYear) {
  const source   = pick(['turbo_people', 'the_pit_wall_tmz', 'speed_gossip', 'paddock_mag']);
  const relType  = pick(['romance_debut','rupture','fiancailles','coup_de_coeur_public','vu_ensemble']);
  const partner  = pick(RELATION_NOMS);

  const headlines = {
    romance_debut   : [`${pilot.name} en couple ? Les photos qui font parler`, `${team.emoji}${pilot.name} et ${partner} : romance confirmée ou rumeur ?`, `L'amour dans le paddock : ${pilot.name} ne cache plus rien`],
    rupture         : [`${pilot.name} — rupture confirmée : le communiqué officiel`, `Séparation choc : ${pilot.name} et sa moitié prendraient des chemins différents`, `${pilot.name} solo : la vie après la séparation`],
    fiancailles     : [`💍 Officiel : ${pilot.name} est fiancé !`, `${pilot.name} demande ${partner} en mariage — le paddock s'emballe`, `Après la piste, l'amour : ${pilot.name} passe la bague au doigt`],
    coup_de_coeur_public: [`${pilot.name} aperçu avec ${partner} lors d'un gala — les regards complices`, `Soirée mondaine : ${pilot.name} et ${partner} font sensation`, `Qui était à côté de ${pilot.name} au gala de Monte-Carlo ?`],
    vu_ensemble     : [`${pilot.name} et ${partner} : les paparazzis ont tout vu`, `Discrétion impossible : ${pilot.name} repéré en vacances avec ${partner}`, `La photo qui vaut mille mots : ${pilot.name} et ${partner} ensemble`],
  };

  const bodies = {
    romance_debut: pick([
      `Ça fait quelques semaines que les rumeurs circulent. Hier, une série de photos prises lors d'un dîner à Monaco semble confirmer ce que beaucoup suspectaient.\n\n${pilot.name} et ${partner} ont été vus sortir ensemble d'un restaurant étoilé vers 23h. Discrets, mais pas assez.\n\n${pick(['Aucun commentaire officiel. Le silence a parfois valeur de confirmation.','Son équipe de communication n\'a pas répondu à nos sollicitations — ce qui, dans ce milieu, veut souvent dire oui.'])}`,
      `Les fans avaient remarqué les likes croisés sur Instagram. Les photographes ont fait le reste.\n\nVus ensemble à ${pick(DESTINATIONS_VACANCES)}, ${pilot.name} et ${partner} ne semblent plus faire d'efforts pour se cacher. La romance de la saison ?`,
    ]),
    rupture: pick([
      `Après ${randInt(6, 30)} mois de relation, l'entourage de ${pilot.name} confirme : c'est terminé. Les raisons invoquées gravitent autour des "contraintes du calendrier sportif et des emplois du temps incompatibles".\n\nFormule connue. Vraie dans ce cas-ci ? Le paddock retient son souffle.\n\n${pick(['${pilot.name} n\'a pas commenté sur les réseaux. Un silence éloquent.','Sa dernière story Instagram — un coucher de soleil, seul. Beaucoup ont interprété.'])}`,
      `La nouvelle a fuité en fin de week-end de course. Mauvais timing ou timing calculé ? Dans ce milieu, on ne laisse rien au hasard.\n\nSelon nos sources, la décision serait "mutuelle et amiable". ${pilot.name} serait actuellement à ${pick(DESTINATIONS_VACANCES)} pour "prendre du recul".`,
    ]),
    fiancailles: pick([
      `La demande aurait eu lieu lors d'un séjour privé à ${pick(DESTINATIONS_VACANCES)}. ${pilot.name} aurait mis plusieurs semaines à préparer le moment. Et manifestement, la réponse a été oui.\n\nLa publication Instagram qui officialise la nouvelle a explosé : **${randInt(100, 890)}K likes** en moins d'une heure. Le paddock envoie ses félicitations.`,
      `${pilot.name} a annoncé ses fiançailles avec ${partner} via un post sobre et touchant sur ses réseaux. Pas de mots — juste une photo et un émoji 💍.\n\nLes commentaires débordent de soutien. Même ses rivaux ont liké. Le sport unit, l'amour aussi.`,
    ]),
    coup_de_coeur_public: pick([
      `Invité au gala de charité organisé à Monaco, ${pilot.name} n'est pas passé inaperçu — ni lui, ni la personne avec qui il a passé une bonne partie de la soirée : ${partner}.\n\nLes photographes ont immortalisé plusieurs échanges très complices. Les regards étaient là. La suite ?`,
      `Le monde du sport et celui du spectacle se croisent régulièrement dans certains événements. Cette fois-ci, c'est ${pilot.name} et ${partner} qu'on remarque. Assis à la même table. Discutant longuement. Souriant souvent.`,
    ]),
    vu_ensemble: pick([
      `Les photographes étaient au bon endroit. ${pilot.name} et ${partner} ont été vus à ${pick(DESTINATIONS_VACANCES)}, détendus, apparemment en vacances.\n\nAucune déclaration officielle. Mais les images ont suffi à enflammer les réseaux. **${randInt(200, 800)}K impressions** sur le post des photographes en quelques heures.`,
      `Ce n'est pas la première fois qu'on les voit ensemble — mais c'est la première fois qu'on les voit ensemble *comme ça*. ${pilot.name} et ${partner}, aperçus à ${pick(DESTINATIONS_VACANCES)}. Le tabloïd a les photos.`,
    ]),
  };

  return {
    type: 'relationship', source,
    headline: pick(headlines[relType]),
    body: bodies[relType],
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 5. AMITIÉS / CERCLE SOCIAL ──────────────────────────────
function genFriendshipArticle(pilotA, pilotB, teamA, teamB, seasonYear) {
  const source  = pick(['paddock_mag', 'speed_gossip', 'turbo_people', 'grid_social']);
  const isSameTeam = String(pilotA.teamId) === String(pilotB.teamId);
  const angle   = pick(['amitié_forte','brouille','réconciliation','sortie_ensemble']);

  const headlines = {
    amitié_forte      : [`${pilotA.name} & ${pilotB.name} : le duo qu'on ne s'attendait pas à voir`, `L'amitié inattendue de la saison : ${pilotA.name} et ${pilotB.name}`, `"On se comprend hors de la piste" — l'amitié ${pilotA.name}/${pilotB.name} surprend`],
    brouille          : [`${pilotA.name} et ${pilotB.name} : l'amitié sur pause ?`, `Froid entre ${pilotA.name} et ${pilotB.name} — qu'est-ce qui a changé ?`, `Plus de photos ensemble, plus d'interactions : ${pilotA.name} et ${pilotB.name} se sont-ils brouillés ?`],
    réconciliation    : [`${pilotA.name} et ${pilotB.name} : la réconciliation est officielle`, `Après la tension, le sourire : ${pilotA.name} et ${pilotB.name} font la paix`, `Ils se sont revus — et ça s'est bien passé`],
    sortie_ensemble   : [`${pilotA.name} et ${pilotB.name} aperçus ensemble à ${pick(DESTINATIONS_VACANCES)}`, `Soirée privée : ${pilotA.name}, ${pilotB.name} et quelques amis — les détails`, `Le circuit, c'est fini pour ce week-end. ${pilotA.name} et ${pilotB.name} se retrouvent hors paddock`],
  };

  const bodies = {
    amitié_forte: `Adversaires sur la piste, amis dans la vie — c'est le paradoxe de ${pilotA.name} et ${pilotB.name}.\n\n` +
      pick([
        `Les deux pilotes ${isSameTeam ? "de la même écurie" : "d'équipes rivales"} ont été vus plusieurs fois ensemble ces dernières semaines : matchs de basketball, restaurant, voyage. Une complicité qui dépasse la simple politesse de collègues.`,
        `"On ne parle presque jamais de course quand on se voit." — ${pilotA.name}, dans une interview récente, sans mentionner ${pilotB.name} nommément. Mais tout le monde a compris.`,
      ]),
    brouille: `Quelque chose a changé. Les deux pilotes qui s'affichaient ensemble régulièrement ne se suivent plus sur Instagram. Ils ne commentent plus les posts de l'autre. Et en paddock, les regards ne se croisent plus.\n\n` +
      pick([
        `La brouille daterait d'il y a ${randInt(2, 8)} semaines. La cause ? Personne ne parle officiellement. Mais les proches de chacun auraient des versions très différentes.`,
        `"Parfois les amitiés ne résistent pas aux pressions du sport de haut niveau." — une source du paddock, philosophe malgré lui.`,
      ]),
    réconciliation: `On les croyait fâchés pour longtemps. Mais une photo publiée hier soir semble dire le contraire.\n\n${pilotA.name} et ${pilotB.name} souriants, ensemble, dans ce qui ressemble à une soirée privée. Le contexte ? Inconnu. Le message ? Limpide.\n\n` +
      pick([
        `Les fans des deux côtés ont réagi avec joie. Dans ce sport, les inimitiés qui durent font du mal à tout le monde.`,
        `Aucun des deux n'a commenté publiquement. Mais la photo parle d'elle-même.`,
      ]),
    sortie_ensemble: `Week-end libre dans le calendrier — et ${pilotA.name} et ${pilotB.name} en ont profité.\n\n` +
      pick([
        `Vus à ${pick(DESTINATIONS_VACANCES)}, les deux pilotes semblaient décontractés, loin des caméras du paddock. Club privé, restaurant, promenade — une tranche de vie normale pour deux athlètes qui n'ont pas grand-chose de normal dans leur quotidien.`,
        `Soirée privée organisée par ${pilotA.name} — ${pilotB.name} était de la partie, ainsi que quelques personnalités du monde du sport et du divertissement. Discrétion demandée. Les photos ont quand même fuité.`,
      ]),
  };

  return {
    type: 'friendship', source,
    headline: pick(headlines[angle]),
    body: bodies[angle],
    pilotIds: [pilotA._id, pilotB._id], teamIds: [teamA._id, teamB._id], seasonYear,
  };
}

// ─── 6. LIFESTYLE — Achats, vacances, villa, voitures ────────
function genLifestyleArticle(pilot, team, seasonYear) {
  const source = pick(['turbo_people', 'paddock_mag', 'the_pit_wall_tmz', 'pl_celebrity']);
  const angle  = pick(['voiture','villa','vacances','collection','jet_privé']);

  const carBrands = ['Bugatti Chiron','Ferrari 812 Superfast','Lamborghini Urus','McLaren 720S','Porsche 911 GT3 RS','Rolls-Royce Ghost','Bentley Continental GT','Aston Martin DBS','Mercedes-AMG G63','Ford GT Mk.IV'];
  const dest = pick(DESTINATIONS_VACANCES);

  const content = {
    voiture: () => {
      const car = pick(carBrands);
      return {
        headline: pick([`${pilot.name} s'offre une ${car} — les photos circulent`, `La nouvelle acquisition de ${pilot.name} : une ${car} qui fait parler`, `${team.emoji}${pilot.name} et sa ${car} : bienvenue dans une autre dimension`]),
        body: `Aperçue dans le parking d'un grand hôtel de ${dest}, la toute nouvelle ${car} de ${pilot.name} n'est pas passée inaperçue.\n\n` +
          pick([
            `Prix catalogue annoncé : autour de **${randInt(180, 450)}K PLcoins**. Couleur sur commande, sellerie personnalisée, plaques personnalisées. Le soin du détail.`,
            `Selon son entourage, la voiture aurait été livrée il y a moins d'une semaine. "Il la cherchait depuis un moment — c'est une récompense qu'il s'est faite."`,
            `C'est la **${pick(['3ème','4ème','5ème'])} voiture de collection** de ${pilot.name}. La vitesse, une passion qui dépasse largement la F1 PL.`,
          ]),
      };
    },
    villa: () => ({
      headline: pick([`${pilot.name} s'offre une villa à ${dest} — les rumeurs chiffrées`, `Nouveau nid de luxe pour ${pilot.name} : les détails de la propriété`, `Investissement immobilier : ${pilot.name} achète à ${dest}`]),
      body: `Après des mois de rumeurs, c'est confirmé : ${pilot.name} a acquis une propriété à ${dest}.\n\n` +
        `Selon les estimations locales, le bien aurait été cédé autour de **${randInt(1, 8)},${randInt(1,9)}M PLcoins**. ` +
        pick([
          `Vue sur mer, piscine à débordement, terrain de basketball privé. Le tout dans une résidence ultra-sécurisée prisée des sportifs de haut niveau.`,
          `La propriété avait appartenu à une célébrité du cinéma avant d'être mise sur le marché. ${pilot.name} ne s'est pas fait prier.`,
          `Ce serait sa résidence principale en dehors des périodes de GP. "Il cherchait un endroit pour vraiment décompresser", selon un proche.`,
        ]),
    }),
    vacances: () => ({
      headline: pick([`${pilot.name} en vacances à ${dest} — le vrai repos`, `Escale soleil pour ${pilot.name} : une semaine à ${dest}`, `Recharge mentale : ${pilot.name} loin du circuit à ${dest}`]),
      body: `Quelques jours sans casque, sans monoplace — juste ${pilot.name}, le soleil, et ${dest}.\n\n` +
        pick([
          `Ses stories Instagram en disent plus long qu'un communiqué : plongée, cocktails, piscine, coucher de soleil. La désactivation totale du mode pilote.`,
          `Entouré de proches, ${pilot.name} a visiblement profité de cette fenêtre dans le calendrier. Le prochain GP est dans ${randInt(5, 18)} jours — le timing était parfait.`,
          `On l'a vu dans un beach club réputé, détendu, souriant. Les autres clients ont fait semblant de ne pas le reconnaître. Lui a fait semblant d'y croire.`,
        ]),
    }),
    collection: () => {
      const item = pick(['montres de luxe','sneakers rares','NFTs sportifs','cartes Pokémon graded','œuvres d\'art contemporain','vinyles rares','maillots de sport signés','figurines Funko Pop F1']);
      return {
        headline: pick([`La passion méconnue de ${pilot.name} : sa collection de ${item}`, `${pilot.name} révèle sa collection — la valeur dépasse l'imagination`, `Hors de la piste, ${pilot.name} chine des ${item}`]),
        body: `Peu de gens le savent, mais ${pilot.name} est un collectionneur passionné de ${item}.\n\n` +
          pick([
            `Il en parle rarement en public, mais une interview récente dans un magazine lifestyle a levé le voile. Sa collection serait estimée à "plusieurs centaines de milliers de PLcoins" selon un expert consulté.`,
            `"C'est ma façon de décrocher du monde du sport. Chaque pièce a une histoire." — ${pilot.name}, rare confidence sur sa vie hors piste.`,
            `Sa dernière acquisition a fait le tour des forums spécialisés. Le prix payé ? Il a refusé de confirmer, mais les rumeurs parlent d'un record.`,
          ]),
      };
    },
    jet_privé: () => ({
      headline: pick([`${pilot.name} : le jet-set, c'est son mode de vie`, `5 vols en 7 jours : le planning aérien vertigineux de ${pilot.name}`, `De ${dest} à Monaco en jet privé — la semaine type de ${pilot.name}`]),
      body: `GP le dimanche, ${dest} le lundi, Monaco le mercredi, usine le jeudi. La vie de ${pilot.name} se compte en fuseaux horaires.\n\n` +
        pick([
          `Son équipe gère un agenda qui ferait pâlir n'importe quel cadre dirigeant. "Je dors bien dans les avions — c'est une compétence essentielle dans ce sport."`,
          `Aperçu dans trois aéroports différents en une semaine, ${pilot.name} semble avoir optimisé le concept de mobilité internationale.`,
          `L'empreinte carbone questionne, certes. Mais dans le monde de la F1 PL, le jet privé reste souvent le seul moyen de tenir l'agenda.`,
        ]),
    }),
  };

  const chosen = content[angle]();
  return {
    type: 'lifestyle', source,
    headline: chosen.headline,
    body: chosen.body,
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 7. SCANDALE HORS PISTE ───────────────────────────────────
function genScandalOffTrackArticle(pilot, team, seasonYear) {
  const source = pick(['the_pit_wall_tmz', 'turbo_people', 'speed_gossip']);

  const scandalTypes = [
    // Soirée qui dérape
    () => ({
      headline: pick([
        `${pilot.name} — la soirée de trop à ${pick(DESTINATIONS_VACANCES)} ?`,
        `Nuit agitée pour ${pilot.name} : la version officielle vs les témoins`,
        `${team.emoji}${pilot.name} : l'incident de la soirée qui revient`,
      ]),
      body: `Les faits d'abord : ${pilot.name} a été aperçu dans un établissement privé à ${pick(DESTINATIONS_VACANCES)} dans la nuit de ${pick(['vendredi à samedi','samedi à dimanche','jeudi à vendredi'])}.\n\n` +
        pick([
          `Selon plusieurs témoins présents, le pilote aurait eu un "comportement exubérant" qui a nécessité l'intervention du service de sécurité. Aucune arrestation, mais l'ambiance était tendue.`,
          `Une altercation verbale avec un autre client aurait dégénéré brièvement. La vidéo qui circule sur les réseaux est floue, mais suffisamment explicite pour alimenter les spéculations.`,
          `${pilot.name} aurait quitté les lieux "sous escorte discrète" selon un responsable de l'établissement. Son service de comm n'a pas encore répondu à nos questions.`,
        ]) +
        `\n\n${pick([
          `L'écurie ${team.emoji}${team.name} "prend note" de la situation et "rappellera à ses pilotes leurs obligations contractuelles d'image". Formule diplomatique pour dire que ça ne passe pas.`,
          `Son agent a publié un communiqué laconique : "Les faits rapportés sont exagérés. ${pilot.name} était en soirée privée entre amis." La communication de crise a commencé.`,
        ])}`,
    }),
    // Déclaration controversée
    () => ({
      headline: pick([
        `La déclaration de ${pilot.name} qui fait scandale`,
        `${pilot.name} dit ce qu'il pense — et tout le monde réagit`,
        `"Inexcusable" vs "incompris" : le tweet de ${pilot.name} divise`,
      ]),
      body: pick([
        `Dans une interview accordée à un podcast, ${pilot.name} a tenu des propos qui font polémique depuis ce matin.\n\n"${pick(['Il y a des pilotes sur cette grille qui ne méritent pas leur baquet — tout le monde le pense, personne ne le dit.','L\'argent décide plus que le talent dans ce sport. On ment à tout le monde.','Certaines équipes jouent un jeu que je refuse de jouer. Je préfère perdre proprement que gagner comme ça.'])}" \n\nLa réaction du paddock est immédiate et partagée. La FIA PL "examine les déclarations".`,
        `Un message posté, supprimé, puis retweeté par des milliers de comptes. ${pilot.name} avait visiblement quelque chose à dire sur ${pick(['la gestion des contrats','le sexisme dans le sport','les inégalités de traitement entre pilotes','la corruption supposée dans certaines décisions de course'])}.\n\nSon équipe de comm est en mode gestion de crise. L'écurie ${team.name} "souhaite rencontrer le pilote pour évoquer la situation".`,
      ]),
    }),
    // Incident de route / comportement public
    () => ({
      headline: pick([
        `${pilot.name} interpellé par la police — les circonstances`,
        `Excès de vitesse ou malentendu ? L'incident de ${pilot.name} sur la voie publique`,
        `${team.emoji}${pilot.name} dans une situation délicate — les faits`,
      ]),
      body: `Les forces de l'ordre auraient intercepté le véhicule de ${pilot.name} ${pick(['sur l\'autoroute près de Monaco','dans le centre de Paris','sur le périphérique lyonnais'])} ${pick(['jeudi soir','en début de matinée','en pleine après-midi'])}.\n\n` +
        pick([
          `Selon le rapport de police, le tachymètre affichait **${randInt(140, 210)} km/h** dans une zone limitée à 130. ${pilot.name} aurait coopéré avec les agents. Amende et rappel à la loi — pas d'arrestation.`,
          `Aucune infraction confirmée par les autorités. "Un simple contrôle de routine" selon la gendarmerie contactée. Mais la présence de plusieurs photographes présents sur les lieux laisse penser que l'information avait fuité à l'avance.`,
          `L'incident a été résolu sur place. ${pilot.name} a décliné tout commentaire. Son avocat "gère le dossier".`,
        ]) +
        `\n\n${pick([
          `L'écurie ${team.emoji}${team.name} n'a pas encore réagi officiellement.`,
          `Dans le paddock, on minimise : "C'est une histoire montée en épingle. Il n'y a rien là-dedans."`,
        ])}`,
    }),
    // Conflit avec célébrité
    () => {
      const celebrity = pick(['un influenceur connu','un rappeur français','une star de la télé-réalité','un footballeur international','un joueur NBA','un acteur hollywoodien','une chanteuse populaire']);
      return {
        headline: pick([
          `${pilot.name} vs ${celebrity} : le clash inattendu`,
          `Guerre ouverte entre ${pilot.name} et ${celebrity} sur les réseaux`,
          `"Il m'a manqué de respect" — ${celebrity} s'en prend à ${pilot.name}`,
        ]),
        body: `Personne n'avait vu ça venir. Un échange sur les réseaux entre ${pilot.name} et ${celebrity} a rapidement dégénéré.\n\n` +
          pick([
            `Tout a commencé par un commentaire de ${celebrity} sur les performances de ${pilot.name} cette saison. La réponse du pilote n'a pas tardé — et n'était pas diplomatique.`,
            `${celebrity} aurait publié une story critiquant le "train de vie ostentatoire" des pilotes F1 PL. ${pilot.name} a répondu directement, nommément. Le ton a monté très vite.`,
          ]) +
          `\n\n${pick([
            `L'affaire a pris des proportions inattendues. Les deux camps ont leurs partisans. Les hashtags flambent.`,
            `Une médiation serait en cours via leurs agents respectifs. "Ce n'est qu'un malentendu" — formule espérée par les deux écuries de communication.`,
          ])}`,
      };
    },
  ];

  const chosen = pick(scandalTypes)();
  return {
    type: 'scandal_offtrack', source,
    headline: chosen.headline,
    body: chosen.body,
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 8. CHARITÉ / ENGAGEMENT SOCIAL ──────────────────────────
function genCharityArticle(pilot, team, seasonYear) {
  const source = pick(['pl_racing_news', 'paddock_mag', 'pl_celebrity', 'f1_weekly']);
  const cause  = pick(CHARITY_CAUSES);
  const amount = `${randInt(10, 500)}K PLcoins`;

  const headlines = [
    `${pilot.name} s'engage pour ${cause} — l'annonce qui touche le paddock`,
    `${team.emoji}${pilot.name} : bien plus qu'un pilote — son action pour ${cause}`,
    `Geste fort de ${pilot.name} : ${amount} donnés à ${cause}`,
    `"La course la plus importante" — ${pilot.name} parle de son engagement caritatif`,
    `${pilot.name} lance sa propre initiative au service de ${cause}`,
  ];

  const bodies = [
    `En dehors de la piste, ${pilot.name} mène une autre bataille — et celle-là, il la gagne aussi.\n\n` +
    `Son engagement pour ${cause} n'est pas nouveau, mais il vient de prendre une nouvelle dimension : un don de **${amount}** annoncé lors d'un événement organisé à Monaco.\n\n` +
    pick([
      `"J'ai la chance de vivre dans un monde extraordinaire. C'est une responsabilité." — ${pilot.name}, sobre et sincère.`,
      `L'initiative a été saluée par ses pairs, son écurie, et plusieurs personnalités du sport mondial.`,
      `${team.emoji}${team.name} a décidé d'abonder à hauteur de ${randInt(20, 100)}% supplémentaire. Le geste collectif.`,
    ]),

    `Moins de bruit que ses performances sur la piste, mais peut-être plus d'impact à long terme. ${pilot.name} consacre une partie significative de son temps et de ses revenus à ${cause}.\n\n` +
    pick([
      `Une fondation à son nom est en cours de création. Les statuts devraient être déposés avant la fin de la saison.`,
      `Il s'était engagé en début de saison à reverser **${randInt(5, 20)}%** de ses gains en course à des associations. Promesse tenue.`,
    ]) +
    `\n\n"${pick(['Le sport m\'a tout donné. C\'est normal de redonner.','Si ma visibilité peut servir à quelque chose de grand, j\'aurais réussi ma vie hors monoplace.'])}" — ${pilot.name}.`,
  ];

  return {
    type: 'charity', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ─── 9. BRAND DEAL — Mode, gaming, collab créative ───────────
function genBrandDealArticle(pilot, team, seasonYear) {
  const source    = pick(['paddock_mag', 'pl_celebrity', 'grid_social', 'turbo_people']);
  const brandCat  = pick(['mode','gaming','musique','gastronomie','tech','art']);

  const brandsByCategory = {
    mode        : pick(LUXURY_BRANDS),
    gaming      : pick(GAMING_BRANDS),
    musique     : pick(['Spotify','Apple Music','Deezer','une marque de casques audio haut de gamme','un label indépendant']),
    gastronomie : pick(['Gordon Ramsay Restaurants','Paul Bocuse Foundation','une marque de champagne','un producteur de café de spécialité','une startup de nutrition sportive']),
    tech        : pick(['Apple','Samsung','Beats by Dre','DJI','GoPro','Tesla','Dyson']),
    art         : pick(['un artiste urbain','une galerie contemporaine parisienne','une maison de vente aux enchères','un créateur de streetwear']),
  };

  const brand = brandsByCategory[brandCat];
  const collabType = pick(['capsule limitée','collection exclusive','campagne mondiale','collab NFT','ligne signature']);

  const headlines = [
    `${pilot.name} × ${brand} : la collab ${brandCat} qu'on attendait`,
    `${collabType} — ${pilot.name} s'associe à ${brand} dans le monde de la ${brandCat}`,
    `"Deux univers, une vision" : ${pilot.name} et ${brand} officialisent leur projet`,
    `Au-delà de la piste : ${pilot.name} signe une ${collabType} avec ${brand}`,
  ];

  const bodies = [
    `La ${collabType} entre ${pilot.name} et ${brand} sera disponible ${pick(['dans les semaines à venir','dès la fin de saison','en édition limitée de ${randInt(100,2000)} pièces','en ligne uniquement'])}.\n\n` +
    `"${pick(['J\'ai voulu faire quelque chose d\'authentique, pas juste mettre mon nom sur un produit.','Cette collab, c\'est moi — du style, de la performance, de la précision.','${brand} partage mes valeurs. C\'était une évidence.'])}" — ${pilot.name}, dans le lookbook officiel.\n\n` +
    pick([
      `La collection a déjà généré **${randInt(5, 80)}K pré-commandes** avant même l'annonce officielle, selon les data de la boutique en ligne.`,
      `${team.emoji}${team.name} figure dans les visuels de la campagne. Un alignement rare entre vie privée et image sportive.`,
      `Le lancement aura lieu lors d'un événement exclusif à Paris. La liste des invités reste confidentielle — mais quelques noms du paddock circulent.`,
    ]),

    `Dans le monde de la ${brandCat}, les collaborations avec des sportifs pullulent. Mais celle de ${pilot.name} avec ${brand} sort du lot.\n\n` +
    pick([
      `Pas une simple photo sur un pack produit — ${pilot.name} a co-conçu la ${collabType} de A à Z. "Il avait des opinions claires sur chaque détail." — un directeur créatif de ${brand}.`,
      `La ${collabType} sera accompagnée d'un mini-documentaire sur la creation process. En ligne le même jour que le lancement.`,
    ]) +
    `\n\nLes premiers visuels ont été lâchés sur les réseaux ce matin. **${randInt(20, 300)}K interactions** en moins de 3 heures. Le public est au rendez-vous.`,
  ];

  return {
    type: 'brand_deal', source,
    headline: pick(headlines),
    body: pick(bodies),
    pilotIds: [pilot._id], teamIds: [team._id], seasonYear,
  };
}

// ============================================================
// 📰  MOTEUR DE NEWS MULTI-SLOTS (max 15 news/jour)
// ============================================================
// 5 slots cron par jour — chacun génère 1 à 3 articles selon la
// phase de saison, avec une "couleur" propre à chaque moment.
//
// Slot    Heure   Couleur            Count (début/mi/fin/finale)
// matin    8h     Lifestyle, réseaux  1 / 1 / 1 / 1
// midi    12h     Sport, interview    1 / 2 / 2 / 2
// aprem   15h     Gossip, TV, amis    1 / 2 / 3 / 3
// soir    19h     Drama, transferts   1 / 2 / 2 / 3
// nuit    22h     Scandale, rumeurs   1 / 1 / 2 / 3
//                                   ─────────────────
//                         total/j   5 / 8 / 10/ 12  (±aléatoire → max 15)
//
// Anti-répétition :
//   • Pas le même (type + pilote) dans les 24h
//   • Types lourds (scandal_offtrack, relationship, scandal) : cooldown 48h/pilote
//   • Dans un même slot : chaque pilote n'apparaît qu'une fois
// ============================================================

// Poids de base par slot (indépendants de la phase)
const SLOT_WEIGHTS = {
  matin : { lifestyle:20, social_media:18, brand_deal:15, charity:12, tv_show:12, sponsoring:10, friendship:8, driver_interview:5 },
  midi  : { driver_interview:20, dev_vague:15, sponsoring:12, hype:12, form_crisis:10, teammate_duel:10, drama:8, title_fight_news:8, social_media:5 },
  aprem : { tv_show:18, friendship:15, relationship:14, lifestyle:12, social_media:12, brand_deal:10, charity:8, drama:6, sponsoring:5 },
  soir  : { drama:20, transfer_rumor:18, rivalry_news:15, driver_interview:12, scandal:8, scandal_offtrack:8, title_fight_news:8, dev_vague:6, social_media:5 },
  nuit  : { scandal_offtrack:22, transfer_rumor:18, drama:14, relationship:12, social_media:10, rivalry_news:10, brand_deal:8, lifestyle:6 },
};

// Combien d'articles par slot selon la phase (index = [début, mi, fin, finale])
const SLOT_COUNTS = {
  matin : [1, 1, 1, 1],
  midi  : [1, 2, 2, 2],
  aprem : [1, 2, 3, 3],
  soir  : [1, 2, 2, 3],
  nuit  : [1, 1, 2, 3],
};

// Types avec cooldown étendu (48h par pilote)
const HEAVY_COOLDOWN_TYPES = new Set(['scandal_offtrack','relationship','scandal']);

// Sélection pondérée d'une clé dans un objet { key: weight }
function weightedPickFrom(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) { roll -= w; if (roll <= 0) return k; }
  return Object.keys(weights)[0];
}

// Génère les données d'un article selon son type
// usedPilotIds : Set de pilotId déjà utilisés dans CE slot (diversité pilotes)
async function buildArticleData(type, allPilots, allTeams, teamMap, season, spPhase, usedPilotIds) {
  const getStandings = () => Standing.find({ seasonId: season._id }).lean();

  // Pilotes pas encore vus dans ce slot en priorité, sinon tout le monde
  const freePilots = allPilots.filter(p => !usedPilotIds.has(String(p._id)));
  const pool       = freePilots.length ? freePilots : allPilots;
  const P          = () => pick(pool);                  // pilote libre
  const PA         = () => pick(allPilots);             // n'importe quel pilote (fallback)
  const markUsed   = (...ps) => ps.forEach(p => p && usedPilotIds.add(String(p._id)));

  if (type === 'drama') {
    const pA = P(), others = allPilots.filter(p => String(p.teamId) !== String(pA.teamId) && !usedPilotIds.has(String(p._id)));
    const pB = others.length ? pick(others) : pick(allPilots.filter(p => String(p._id) !== String(pA._id)));
    if (!pB) return null;
    const tA = teamMap.get(String(pA.teamId)), tB = teamMap.get(String(pB.teamId));
    if (!tA || !tB) return null;
    markUsed(pA, pB);
    return genDramaArticle(pA, pB, tA, tB, season.year);

  } else if (type === 'rivalry_news') {
    const withRival = allPilots.filter(p => p.rivalId && !usedPilotIds.has(String(p._id)));
    if (withRival.length) {
      const pA = pick(withRival);
      const pB = allPilots.find(p => String(p._id) === String(pA.rivalId));
      if (pB) {
        const tA = teamMap.get(String(pA.teamId)), tB = teamMap.get(String(pB.teamId));
        if (tA && tB) { markUsed(pA, pB); return genRivalryArticle(pA, pB, tA, tB, pA.rivalContacts || 1, '(récent)', season.year); }
      }
    }
    return buildArticleData('drama', allPilots, allTeams, teamMap, season, spPhase, usedPilotIds);

  } else if (type === 'transfer_rumor') {
    const pilot = P(), currentTeam = teamMap.get(String(pilot.teamId));
    const others = allTeams.filter(t => String(t._id) !== String(pilot.teamId));
    if (!others.length) return null;
    markUsed(pilot);
    return genTransferRumorArticle(pilot, currentTeam, pick(others), season.year);

  } else if (type === 'dev_vague') {
    return genDevVagueArticle(pick(allTeams), season.year);

  } else if (type === 'scandal') {
    return allTeams.length >= 2 ? genScandalArticle(allTeams, allPilots, season.year) : null;

  } else if (type === 'hype') {
    const standings = await getStandings();
    const sorted = [...standings].sort((a, b) => b.points - a.points);
    const st = sorted.find(s => !usedPilotIds.has(String(s.pilotId)) && ((s.wins||0)>=1||(s.podiums||0)>=2)) || sorted[0];
    if (!st) return null;
    const pilot = allPilots.find(p => String(p._id) === String(st.pilotId));
    const team  = pilot ? teamMap.get(String(pilot.teamId)) : null;
    if (!pilot || !team) return null;
    markUsed(pilot);
    return genHypeArticle(pilot, team, st.wins||0, st.podiums||0, season.year, sorted.findIndex(s => String(s.pilotId) === String(pilot._id)) + 1);

  } else if (type === 'form_crisis') {
    const standings = await getStandings();
    const sorted = [...standings].sort((a, b) => b.points - a.points);
    const st = sorted.slice(Math.floor(sorted.length/2)).find(s => (s.dnfs||0)>=1 && !usedPilotIds.has(String(s.pilotId)));
    if (!st) return null;
    const pilot = allPilots.find(p => String(p._id) === String(st.pilotId));
    const team  = pilot ? teamMap.get(String(pilot.teamId)) : null;
    if (!pilot || !team) return null;
    markUsed(pilot);
    return genFormCrisisArticle(pilot, team, st.dnfs||0, null, season.year, false);

  } else if (type === 'teammate_duel') {
    for (const p of allPilots) {
      const tid = String(p.teamId);
      const mates = allPilots.filter(x => String(x.teamId) === tid);
      if (mates.length < 2) continue;
      const [a, b] = mates;
      if (Math.abs((a.teammateDuelWins||0)-(b.teammateDuelWins||0)) < 2) continue;
      if (usedPilotIds.has(String(a._id)) || usedPilotIds.has(String(b._id))) continue;
      const team = teamMap.get(tid); if (!team) continue;
      markUsed(a, b);
      const [winner, loser] = (a.teammateDuelWins||0) > (b.teammateDuelWins||0) ? [a,b] : [b,a];
      return genTeammateDuelArticle(winner, loser, team, Math.max(a.teammateDuelWins||0, b.teammateDuelWins||0), Math.min(a.teammateDuelWins||0, b.teammateDuelWins||0), season.year);
    }
    return null;

  } else if (type === 'title_fight_news') {
    const standings = await getStandings();
    const sorted = [...standings].sort((a, b) => b.points - a.points);
    if (sorted.length < 2) return null;
    const [s1, s2] = sorted;
    const gap = s1.points - s2.points; if (gap > 60) return null;
    const p1 = allPilots.find(p => String(p._id) === String(s1.pilotId));
    const p2 = allPilots.find(p => String(p._id) === String(s2.pilotId));
    const t1 = p1 ? teamMap.get(String(p1.teamId)) : null;
    const t2 = p2 ? teamMap.get(String(p2.teamId)) : null;
    if (!p1||!p2||!t1||!t2) return null;
    const total = await Race.countDocuments({ seasonId: season._id });
    const done  = await Race.countDocuments({ seasonId: season._id, status: 'done' });
    return genTitleFightArticle(p1, p2, t1, t2, gap, total - done, season.year);

  } else if (type === 'driver_interview') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    const standings = await getStandings();
    const standing  = standings.find(s => String(s.pilotId) === String(pilot._id));
    const contract  = await Contract.findOne({ pilotId: pilot._id, active: true }).lean();
    const teammate  = allPilots.find(p => String(p.teamId) === String(pilot.teamId) && String(p._id) !== String(pilot._id));
    const teammateSt = teammate ? standings.find(s => String(s.pilotId) === String(teammate._id)) : null;
    markUsed(pilot);
    return genDriverInterviewArticle(pilot, team, standing, contract, teammate, teammateSt, season.year, spPhase);

  } else if (type === 'sponsoring') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genSponsoringArticle(pilot, team, season.year);

  } else if (type === 'social_media') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    const standings = await getStandings();
    const standing  = standings.find(s => String(s.pilotId) === String(pilot._id));
    markUsed(pilot); return genSocialMediaArticle(pilot, team, standing, season.year);

  } else if (type === 'tv_show') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genTVShowArticle(pilot, team, season.year);

  } else if (type === 'relationship') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genRelationshipArticle(pilot, team, season.year);

  } else if (type === 'friendship') {
    const pA = P();
    const pB = pick(allPilots.filter(p => String(p._id) !== String(pA._id) && !usedPilotIds.has(String(p._id)))) ||
               pick(allPilots.filter(p => String(p._id) !== String(pA._id)));
    if (!pB) return null;
    const tA = teamMap.get(String(pA.teamId)), tB = teamMap.get(String(pB.teamId));
    if (!tA || !tB) return null;
    markUsed(pA, pB); return genFriendshipArticle(pA, pB, tA, tB, season.year);

  } else if (type === 'lifestyle') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genLifestyleArticle(pilot, team, season.year);

  } else if (type === 'scandal_offtrack') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genScandalOffTrackArticle(pilot, team, season.year);

  } else if (type === 'charity') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genCharityArticle(pilot, team, season.year);

  } else if (type === 'brand_deal') {
    const pilot = P(); const team = teamMap.get(String(pilot.teamId)); if (!team) return null;
    markUsed(pilot); return genBrandDealArticle(pilot, team, season.year);
  }
  return null;
}

// ── Orchestrateur principal ───────────────────────────────────
// slotName : 'matin' | 'midi' | 'aprem' | 'soir' | 'nuit'
async function runScheduledNews(discordClient, slotName = 'soir') {
  const channel = RACE_CHANNEL ? discordClient.channels.cache.get(RACE_CHANNEL) : null;
  if (!channel) return;

  const season = await getActiveSeason();
  if (!season) return;

  const allPilots = await Pilot.find({ teamId: { $ne: null } });
  const allTeams  = await Team.find();
  if (!allPilots.length || !allTeams.length) return;

  const teamMap = new Map(allTeams.map(t => [String(t._id), t]));

  // ── Phase de saison ──────────────────────────────────────────
  const totalRaces = await Race.countDocuments({ seasonId: season._id });
  const doneRaces  = await Race.countDocuments({ seasonId: season._id, status: 'done' });
  const progress   = totalRaces > 0 ? doneRaces / totalRaces : 0;
  const phaseIdx   = progress < 0.25 ? 0 : progress < 0.6 ? 1 : progress < 0.85 ? 2 : 3;
  const spPhase    = ['début','mi','fin','fin'][phaseIdx];

  // ── Nombre d'articles pour ce slot ──────────────────────────
  const baseCount  = (SLOT_COUNTS[slotName] || SLOT_COUNTS.soir)[phaseIdx];
  // ±1 aléatoire pour varier, borné à [1, 3]
  const count      = Math.max(1, Math.min(3, baseCount + (Math.random() < 0.35 ? 1 : 0)));

  // ── Poids de ce slot modifiés par la phase ───────────────────
  const rawWeights = { ...(SLOT_WEIGHTS[slotName] || SLOT_WEIGHTS.soir) };
  // Ajustements phase : transferts/scandales montent en fin de saison
  if (phaseIdx >= 2) {
    if (rawWeights.transfer_rumor) rawWeights.transfer_rumor += 8;
    if (rawWeights.scandal_offtrack) rawWeights.scandal_offtrack += 5;
    if (rawWeights.drama) rawWeights.drama += 4;
    if (rawWeights.lifestyle) rawWeights.lifestyle = Math.max(2, rawWeights.lifestyle - 5);
    if (rawWeights.charity) rawWeights.charity = Math.max(2, rawWeights.charity - 3);
  }
  if (phaseIdx === 0) { // début de saison : plus de positif
    if (rawWeights.lifestyle) rawWeights.lifestyle += 5;
    if (rawWeights.brand_deal) rawWeights.brand_deal += 4;
    if (rawWeights.transfer_rumor) rawWeights.transfer_rumor = Math.max(0, (rawWeights.transfer_rumor||0) - 8);
  }

  // ── Anti-répétition : articles des 24h ───────────────────────
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recent24 = await NewsArticle.find({ publishedAt: { $gte: since24h }, triggered: 'scheduled' }).lean();
  const recent48 = await NewsArticle.find({ publishedAt: { $gte: since48h }, triggered: 'scheduled', type: { $in: [...HEAVY_COOLDOWN_TYPES] } }).lean();

  // Combos "type:pilotId" vus dans les dernières 24h (normal) ou 48h (types lourds)
  const cooldown24 = new Set(recent24.flatMap(a => (a.pilotIds||[]).map(pid => `${a.type}:${String(pid)}`)));
  const cooldown48 = new Set(recent48.flatMap(a => (a.pilotIds||[]).map(pid => `${a.type}:${String(pid)}`)));
  // Types déjà publiés aujourd'hui — on évite + de 2 fois le même type/jour
  const typesPublishedToday = {};
  for (const a of recent24) typesPublishedToday[a.type] = (typesPublishedToday[a.type]||0) + 1;

  // ── Génération des articles ──────────────────────────────────
  const usedPilotIds = new Set();  // pilotes déjà utilisés dans CE slot
  const usedTypesThisSlot = new Set(); // types déjà tirés dans CE slot
  const published = [];

  for (let i = 0; i < count; i++) {
    // Construire les poids effectifs : retirer les types sursaturés
    const effectiveWeights = {};
    for (const [t, w] of Object.entries(rawWeights)) {
      if (usedTypesThisSlot.has(t)) continue;           // déjà dans ce slot
      if ((typesPublishedToday[t]||0) >= 2) continue;   // > 2 fois aujourd'hui
      effectiveWeights[t] = w;
    }
    if (!Object.keys(effectiveWeights).length) break;

    const type = weightedPickFrom(effectiveWeights);
    usedTypesThisSlot.add(type);

    // Filtrer les pilotes en cooldown pour ce type
    const isHeavy = HEAVY_COOLDOWN_TYPES.has(type);
    const cooldownSet = isHeavy ? cooldown48 : cooldown24;
    // On exclut les pilotes en cooldown du pool "libre" — buildArticleData les gérera
    const pilotsCooled = new Set(
      allPilots
        .filter(p => cooldownSet.has(`${type}:${String(p._id)}`))
        .map(p => String(p._id))
    );
    // Injecter dans usedPilotIds pour ce tirage (sera retiré après si non publié)
    for (const id of pilotsCooled) usedPilotIds.add(id);

    let articleData = null;
    try {
      articleData = await buildArticleData(type, allPilots, allTeams, teamMap, season, spPhase, usedPilotIds);
    } catch(e) { console.error(`News gen error [${type}]:`, e.message); }

    // Retirer les pilotes en cooldown du set (ils ne doivent bloquer que ce tirage)
    for (const id of pilotsCooled) usedPilotIds.delete(id);

    if (!articleData) continue;

    const article = await NewsArticle.create({ ...articleData, triggered: 'scheduled', publishedAt: new Date() });
    await publishNews(article, channel);
    published.push(type);

    // Délai prestige entre articles : 90s à 4min
    if (i < count - 1) await sleep(randInt(90_000, 240_000));
  }

  if (published.length) {
    console.log(`📰 [News ${slotName}] ${published.length} article(s) publié(s) : ${published.join(', ')}`);
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
    if (!channel) {
      console.warn('[simulateRace] channel est null — les messages de course ne peuvent pas être envoyés !');
      return;
    }
    if (msg.length > 1950) msg = msg.slice(0, 1947) + '…';
    try {
      await channel.send(msg);
    } catch(e) {
      console.error('[simulateRace] send error T' + lap + ':', e.message, '— Code:', e.code || 'N/A');
    }
    await sleep(9000); // toujours attendre, même en cas d'erreur Discord
  };

  const sendEmbed = async (embed) => {
    if (!channel) return;
    try { await channel.send({ embeds: [embed] }); } catch(e) {}
    await sleep(9000);
  };

  // ══════════════════════════════════════════════════════════
  // PRE-RACE — Grille de départ (format F1 : P1 gauche · P2 droite · P3 gauche · P4 droite...)
  // ══════════════════════════════════════════════════════════
  const makeGridLine = (d, pos) => {
    const ov   = overallRating(d.pilot);
    const tier = ratingTier(ov);
    return `\`P${String(pos).padStart(2,' ')}\` ${d.team.emoji} **${d.pilot.name}** ${tier.badge}${ov} ${TIRE[d.tireCompound].emoji}`;
  };
  // Positions impaires → côté gauche (P1, P3, P5...), positions paires → côté droit (P2, P4, P6...)
  const oddLines  = drivers.filter((_, i) => i % 2 === 0).map((d, i) => makeGridLine(d, i * 2 + 1));
  const evenLines = drivers.filter((_, i) => i % 2 === 1).map((d, i) => makeGridLine(d, i * 2 + 2));

  const gridEmbed = new EmbedBuilder()
    .setTitle(`🏎️ GRILLE DE DÉPART — ${race.emoji} ${race.circuit}`)
    .setColor('#FF1801')
    .setDescription(`${styleEmojis[gpStyle]} **${gpStyle.toUpperCase()}** · ${weatherLabels[weather]} · **${totalLaps} tours**`)
    .addFields(
      { name: '◀️ Côté gauche (impairs)', value: oddLines.join('\n')  || '—', inline: true },
      { name: '▶️ Côté droit (pairs)',    value: evenLines.join('\n') || '—', inline: true },
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

    const events       = []; // { priority, text }
    const overtakeMentioned = new Set(); // pilotes déjà narratés comme attaquant OU passé ce tour
    const lapDnfs      = []; // DNFs survenus CE tour — pour expliquer le SC
    const lapIncidents = []; // incidents ce tour pour SC logic

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
      const { pit, reason: rawReason } = shouldPit(driver, lapsRemaining, gapAhead, totalLaps, scActive);
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

        const scPitTag = scActive
          ? (rawReason === 'sc_opportunity'
              ? ' 🚨 *pit stratégique sous Safety Car — le meilleur moment pour s\'arrêter !*'
              : ' 🚨 *sous Safety Car*')
          : '';
        // Position sur la piste vs position en timing
        // Les pilotes qui n'ont pas encore pité et ont moins de totalTime sont "devant" sur la piste
        const carsAheadOnTrack = drivers.filter(d =>
  !d.dnf &&
  !d.pittedThisLap &&
  String(d.pilot._id) !== String(driver.pilot._id) &&
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

              // Nommer les voisins directs pour clarifier qui est devant/derrière à la sortie
const sortedAfterPit = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
const neighborAhead  = sortedAfterPit.find(d => d.pos === posOut - 1);
const neighborBehind = sortedAfterPit.find(d => d.pos === posOut + 1);
const exitNeighborStr = neighborAhead && neighborBehind
  ? ` (derrière ${neighborAhead.team.emoji}**${neighborAhead.pilot.name}**, devant ${neighborBehind.team.emoji}**${neighborBehind.pilot.name}**)`
  : neighborAhead
  ? ` (derrière ${neighborAhead.team.emoji}**${neighborAhead.pilot.name}**)`
  : neighborBehind
  ? ` (devant ${neighborBehind.team.emoji}**${neighborBehind.pilot.name}**)`
  : '';

        const pitFlavors = repairDesc ? [
          `🔧 **T${lap} — PIT D'URGENCE !** ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) rentre précipitamment. Arrêt de **${pitDur}s** — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
        ] : reason === 'undercut' ? [
          `🔧 **T${lap} — UNDERCUT !** ${driver.team.emoji}**${driver.pilot.name}** plonge aux stands depuis **P${posIn}** — ${TIRE[oldTire].emoji} → ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** — **${pitDur}s** — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}. La stratégie va-t-elle payer ?${warmupNote}`,
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** tente l'undercut depuis **P${posIn}** ! ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
        ] : [
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** rentre aux stands depuis **P${posIn}**${scPitTag} — ${TIRE[oldTire].emoji} cramés. ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en **${pitDur}s** — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
          `🔧 **T${lap} — ARRÊT AUX STANDS** pour ${driver.team.emoji}**${driver.pilot.name}** (P${posIn})${scPitTag}. ${TIRE[newCompound].emoji}**${TIRE[newCompound].label}** en ${pitDur}s. Ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
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
    const justRestarted = (prevScState !== 'NONE' && scState.state === 'NONE') || scCooldown >= 5;
          
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
        const passed = ranked.find(d =>
          d.lastPos === driver.pos &&
          d.pos > driver.pos &&
          !d.pittedThisLap &&
          String(d.pilot._id) !== String(driver.pilot._id)
        );
        if (!passed) continue;

        // Gap pré-tour
        const preLapD = preLapTimes.get(String(driver.pilot._id)) ?? driver.totalTime;
        const preLapP = preLapTimes.get(String(passed.pilot._id)) ?? passed.totalTime;
        const bigGap  = Math.abs(preLapP - preLapD) > 5000; // > 5s = changement stratégique, pas un dépassement en piste

        // Gap > 3s : pas un dépassement en piste (pit, SC, dégâts...) — narration sobre
        // Gap > 5s avant le tour : changement de position dû à la stratégie (pit, pénalité…), pas un vrai dépassement
        if (bigGap) {
          const ovNewPos  = driver.lastPos - 1;
          const ovLostPos = passed.lastPos + 1;
          // Deviner la raison la plus probable
          const passedPitted  = passed.pittedThisLap || (passed.pitStops || 0) > 0 && passed.tireAge < 3;
          const driverPitted  = driver.pittedThisLap;
          const reason = driverPitted
            ? `${driver.team.emoji}**${driver.pilot.name}** est sorti des stands avec l'avantage`
            : passedPitted
            ? `${passed.team.emoji}**${passed.pilot.name}** a perdu du temps aux stands`
            : `l'écart de temps entre les deux pilotes s'est résorbé par la stratégie`;
          events.push({
            priority: 3,
            text: `📊 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** P${driver.lastPos}→**P${ovNewPos}** / ${passed.team.emoji}**${passed.pilot.name}** P${passed.lastPos}→**P${ovLostPos}** — ${reason}.`,
          });
          overtakeMentioned.add(String(driver.pilot._id));
          overtakeMentioned.add(String(passed.pilot._id));
          continue;
        }

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

        const updatedBattle = battle
          ? { ...battle, lastPasser: String(driver.pilot._id), lastPasserLap: lap }
          : { lapsClose: 1, lastPasser: String(driver.pilot._id), lastPasserLap: lap };
        battleMap.set(bkey, updatedBattle);

        const ovNewPos  = driver.lastPos - 1;
        const ovLostPos = passed.lastPos + 1;
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
        overtakeMentioned.add(String(driver.pilot._id));
        overtakeMentioned.add(String(passed.pilot._id));
      }
    }


    // ── Mouvements de position non narrés (multi-places, DNF, etc.) ──────────────
    // Ce bloc couvre les changements >= 2 places que l'overtake 1v1 n'a pas capturés.
    // IMPORTANT : les pneus usés ne causent PAS directement une perte de place —
    // ils ralentissent le pilote et les autres le dépassent via le système overtake.
    // Ici on mentionne juste le MOUVEMENT et son contexte probable.
    if (!scActive && !justRestarted && lap > 2) {
      for (const driver of ranked) {
        if (driver.pittedThisLap) continue;
        if (driver.dnf) continue;
        if (overtakeMentioned.has(String(driver.pilot._id))) continue;

        const posChange = driver.lastPos - driver.pos; // >0 = remonté, <0 = reculé
        if (Math.abs(posChange) < 2) continue;

        const n          = `${driver.team.emoji}**${driver.pilot.name}**`;
        const worn       = driver.tireWear || 0;
        const wornThresh = wornThresholdFor(driver.tireCompound, driver.team, driver.pilot);
        const isTireWorn  = worn > wornThresh * 0.85;
        const isFreshTire = (driver.warmupLapsLeft || 0) === 0 && (driver.tireAge || 0) < 8 && (driver.pitStops || 0) > 0;
        const tireEmoji   = TIRE[driver.tireCompound]?.emoji || '🏎️';
        // Compter les DNFs de CE tour qui étaient devant ce pilote AVANT le tour
        const dnfsAhead = lapDnfs.filter(d => (d.driver.lastPos ?? d.driver.pos) < driver.lastPos).length;
        const fromDnf   = dnfsAhead > 0;

        if (posChange < 0) {
          // ── Perte de positions ──────────────────────────────
          // Les pneus usés sont du CONTEXTE (il est lent), pas la CAUSE directe.
          // La cause : plusieurs adversaires l'ont passé ce même tour.
          const lost     = Math.abs(posChange);
          const severity = lost >= 5 ? '🚨' : '⚠️';
          const tireCtx  = isTireWorn
            ? ` ${tireEmoji} *Ses pneus usés lui coûtent du temps — il ne peut pas répondre.*`
            : '';
          events.push({ priority: 3, text: pick([
            `${severity} **T${lap}** — ${n} recule **P${driver.lastPos}→P${driver.pos}** — plusieurs adversaires en profitent dans la même séquence.${tireCtx}`,
            `${severity} **T${lap}** — ${n} perd **${lost} place${lost>1?'s':''}** (P${driver.lastPos}→P${driver.pos}) en l'espace d'un tour.${tireCtx}`,
            `${severity} **T${lap}** — Glissade au classement pour ${n} : P${driver.lastPos}→**P${driver.pos}**.${tireCtx}`,
          ]) });

        } else {
          // ── Gain de positions ───────────────────────────────
          const gained = posChange;
          if (isFreshTire) {
            events.push({ priority: 4, text: pick([
              `📈 **T${lap}** — ${n} remonte **P${driver.lastPos}→P${driver.pos}** sur pneus frais ${tireEmoji} ! Les gommes neuves font toute la différence.`,
              `📈 **T${lap}** — ${n} (+${gained} place${gained>1?'s':''}, P${driver.lastPos}→**P${driver.pos}**) — pneus frais ${tireEmoji}, il dévore le classement. La stratégie paye.`,
              `📈 **T${lap}** — La remontée de ${n} est impressionnante : P${driver.lastPos}→**P${driver.pos}** sur gommes neuves ${tireEmoji}.`,
            ]) });
          } else if (fromDnf) {
            // Le gain réel dû aux DNFs = min(gained, dnfsAhead)
            const gainedByDnf = Math.min(gained, dnfsAhead);
            const dnfNames    = lapDnfs
              .filter(d => (d.driver.lastPos ?? d.driver.pos) < driver.lastPos)
              .map(d => `${d.driver.team.emoji}**${d.driver.pilot.name}**`)
              .join(', ');
            events.push({ priority: 4, text: pick([
              `📊 **T${lap}** — ${n} hérite de **${gainedByDnf} place${gainedByDnf > 1 ? 's' : ''}** (P${driver.lastPos}→**P${driver.pos}**) suite à l'abandon de ${dnfNames}.`,
              `📊 **T${lap}** — L'abandon de ${dnfNames} profite à ${n} qui remonte P${driver.lastPos}→**P${driver.pos}**.`,
            ]) });
          } else {
            events.push({ priority: 3, text: pick([
              `📈 **T${lap}** — ${n} avance **P${driver.lastPos}→P${driver.pos}** — belle régularité.`,
              `📈 **T${lap}** — ${n} grappille **${gained} place${gained>1?'s':''}** (P${driver.lastPos}→P${driver.pos}) sans qu'on l'ait vu venir.`,
            ]) });
          }
        }
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
              `⚠️ **T${lap}** — Petit contact ${attacker.team.emoji}**${attacker.pilot.name}** / ${victim.team.emoji}**${victim.pilot.name}**. Pénalité **+${(penalty/1000).toFixed(0)}s** pour ${attacker.team.emoji}**${attacker.pilot.name}**.`,
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
   const atmo = atmosphereLine(ranked, lap, totalLaps, weather, scState, gpStyle, justRestarted);
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
      const wup  = (d.warmupLapsLeft || 0) > 0 ? ' 🌡️' : '';
      if (worn >= thr * 1.0) return `${td.emoji} 🔴${wup}`; // au-delà du seuil
      if (worn >= thr * 0.65) return `${td.emoji} 🟡${wup}`; // 65-100% du seuil
      return `${td.emoji} 🟢${wup}`; // < 65% du seuil
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
      const confData = await generatePressConference(
        race, results, season, allPilots, allTeams2, allStandings, cStandings
      );
      if (confData?.length) {
        // confData est un tableau de { block: string, pilotId?: ObjectId, photoUrl?: string }
        // Rétrocompat : si c'est un tableau de strings (ancien format), on convertit
        const normalised = confData.map(item =>
          typeof item === 'string' ? { block: item } : item
        );
        for (const { block, photoUrl } of normalised) {
          const confEmbed = new EmbedBuilder()
            .setTitle(`🎤 Conférence de presse — ${race.emoji} ${race.circuit}`)
            .setColor('#2B2D31')
            .setDescription(block);
          if (photoUrl) confEmbed.setThumbnail(photoUrl);
          if (channel) { try { await channel.send({ embeds: [confEmbed] }); } catch(e) {} }
          await sleep(3000);
        }
        await sleep(2000);
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
    { name:'Red Bull Racing TEST', emoji:'🟡', color:'#1E3A5F', budget:160, vitesseMax:95, drs:95, refroidissement:90, dirtyAir:88, conservationPneus:88, vitesseMoyenne:93, devPoints:0 },
    { name:'Scuderia TEST',     emoji:'🔴', color:'#DC143C', budget:150, vitesseMax:92, drs:90, refroidissement:88, dirtyAir:85, conservationPneus:85, vitesseMoyenne:90, devPoints:0 },
    { name:'Mercedes TEST', emoji:'🩶', color:'#00D2BE', budget:145, vitesseMax:90, drs:88, refroidissement:92, dirtyAir:82, conservationPneus:87, vitesseMoyenne:88, devPoints:0 },
    { name:'McLaren TEST',      emoji:'🟠', color:'#FF7722', budget:130, vitesseMax:85, drs:84, refroidissement:82, dirtyAir:80, conservationPneus:83, vitesseMoyenne:85, devPoints:0 },
    { name:'Alpine TEST',       emoji:'🩷', color:'#0066CC', budget:110, vitesseMax:75, drs:76, refroidissement:78, dirtyAir:75, conservationPneus:76, vitesseMoyenne:76, devPoints:0 },
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
// Chaque équipe investit ensuite dans une stat prioritaire
async function evolveCarStats(raceResults, teams) {
  // Points constructeurs par résultat de course
  const teamPoints = {};
  for (const r of raceResults) {
    const pts = F1_POINTS[r.pos - 1] || 0;
    const key = String(r.teamId);
    teamPoints[key] = (teamPoints[key] || 0) + pts;
  }

  for (const team of teams) {
    const key = String(team._id);
    const pts = teamPoints[key] || 0;

    // ── Calcul des devPoints gagnés ──────────────────────────
    // Formule : points de course × 1.5 + bonus budget + gain de base garanti
    // Le gain de base (3 pts) assure que même les équipes sans points progressent
    // Le budget amplifie légèrement l'avantage des grosses structures
    const devGained = Math.round(pts * 1.5 + (team.budget / 100) * 3 + 3);
    const newDevPts = team.devPoints + devGained;

    // ── Seuil abaissé : 30 devPts = 1 point de stat ─────────
    // Avant : 50 → le bas de grille ne progressait presque jamais
    // Maintenant :
    //   P1  (~35+ pts) → +60 devPts → 2 upgrades/course
    //   P5  (~18 pts)  → +30 devPts → 1 upgrade/course
    //   P10 (~1 pt)    → +8  devPts → 1 upgrade toutes les ~4 courses
    //   Sans points    → +3  devPts → 1 upgrade toutes les ~10 courses (ne stagne plus)
    const THRESHOLD = 40;
    let gained    = Math.floor(newDevPts / THRESHOLD);
    let remaining = newDevPts % THRESHOLD;

    if (gained > 0) {
      const statKeys = ['vitesseMax','drs','refroidissement','dirtyAir','conservationPneus','vitesseMoyenne'];
      const statVals = statKeys.map(k => ({ key: k, val: team[k] })).sort((a,b) => a.val - b.val);

      const updates = {};
      for (let i = 0; i < gained; i++) {
        // Chaque upgrade : 65% sur la stat la plus faible, sinon aléatoire parmi les 3 plus faibles
        const weakPool = statVals.slice(0, 3).map(s => s.key);
        const targetStat = Math.random() < 0.65 ? statVals[0].key : pick(weakPool);
        updates[targetStat] = clamp((updates[targetStat] ?? team[targetStat]) + 1, 0, 99);
        // Mettre à jour statVals pour que les prochains upgrades de la boucle restent cohérents
        const sv = statVals.find(s => s.key === targetStat);
        if (sv) sv.val = updates[targetStat];
        statVals.sort((a,b) => a.val - b.val);
      }
      updates.devPoints = remaining;
      await Team.findByIdAndUpdate(team._id, updates);
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
  // Si les courses ont un champ slot assigné, on l'utilise directement
  const withSlot = await Race.findOne({ seasonId: season._id, slot: { $exists: true, $ne: null } }).limit(1);
  if (withSlot) {
    const query = { seasonId: season._id, status: { $nin: ['done', 'race_computed'] } };
    if (slot !== null) query.slot = slot;
    return Race.findOne(query).sort({ index: 1 });
  }
  // Fallback : pas de slot en BDD — slot 0 = 1ère course non-done, slot 1 = 2ème course non-done
  const query = { seasonId: season._id, status: { $nin: ['done', 'race_computed'] } };
  const races  = await Race.find(query).sort({ index: 1 }).limit(2);
  if (slot === 1) return races[1] || null;
  return races[0] || null;
}

// Détermine le slot actuel selon l'heure (Paris)
// Slot 0 (matin)  : 11h–15h59 → EL 11h · Q 13h · Course 15h
// Slot 1 (soir)   : 16h–20h59 → EL 17h · Q 18h · Course 20h
function getCurrentSlot() {
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }));
  return hour >= 16 ? 1 : 0;
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

  // Dates des GPs : construites en UTC-midi pour éviter le décalage
  // "new Date() avec setHours(0,0,0,0)" sur un serveur UTC donne minuit UTC = 1h ou 2h Paris
  // → au premier toLocaleDateString le jour affiché peut être -1
  // Solution : pointer sur 12h UTC (= 13h ou 14h Paris) → toujours le bon jour calendaire
  const nowUTC = new Date();
  const tomorrowUTC = new Date(Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate() + 1, 12, 0, 0));

  for (let i = 0; i < CIRCUITS.length; i++) {
    const slot = i % 2; // 0 = matin, 1 = soir
    const d    = new Date(tomorrowUTC);
    d.setUTCDate(tomorrowUTC.getUTCDate() + Math.floor(i / 2));
    d.setUTCHours(slot === 1 ? 16 : 10, 0, 0, 0); // 10h UTC = 11h CET | 16h UTC = 17h CET
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

  new SlashCommandBuilder().setName('planning')
    .setDescription('📅 Prochains GPs avec leurs horaires (EL · Qualifs · Course)'),

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
  new SlashCommandBuilder().setName('admin_fix_emojis')
    .setDescription('[ADMIN] Synchronise les emojis des écuries en BDD depuis le code source.'),
  new SlashCommandBuilder().setName('admin_replan')
    .setDescription('[ADMIN] Replanifie tout le calendrier à partir d\'un GP de référence + date')
    .addIntegerOption(o => o.setName('gp_index')
      .setDescription('Index du GP de référence (0=Bahrain, 6=Emilia Romagna, 15=Italian...)')
      .setRequired(true).setMinValue(0).setMaxValue(30))
    .addStringOption(o => o.setName('date')
      .setDescription('Date du GP de référence au format YYYY-MM-DD (ex: 2025-03-04)')
      .setRequired(true))
    .addStringOption(o => o.setName('slot')
      .setDescription('Slot du GP de référence : matin (11h) ou soir (17h) — défaut: matin')
      .addChoices(
        { name: '🌅 Matin (11h/13h/15h)', value: 'matin' },
        { name: '🌆 Soir  (17h/18h/20h)', value: 'soir'  },
      )),
  new SlashCommandBuilder().setName('admin_skip_gp')
    .setDescription('[ADMIN] Saute le GP en cours sans le simuler (rattraper un retard)')
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP à sauter — défaut: GP en cours').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_scheduler_pause')
    .setDescription('[ADMIN] ⏸️ Met en pause le lancement automatique des GPs (EL · Qualifs · Course)'),

  new SlashCommandBuilder().setName('admin_scheduler_resume')
    .setDescription('[ADMIN] ▶️ Réactive le lancement automatique des GPs'),

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

  // ── 5 slots de news — horaires calés HORS fenêtres de course ──
  // Slot 0 course : EL 11h · Q 13h · Course 15h  → zone morte 10h30–15h30
  // Slot 1 course : EL 17h · Q 18h · Course 20h  → zone morte 16h30–20h30
  //
  //  8h00  matin   → lifestyle, réseaux       ✅ avant toute activité
  //  10h00 midi    → sport, interview          ✅ juste avant la zone morte slot 0
  //  16h00 aprem   → gossip, TV, amis          ✅ entre les deux slots de course
  //  21h00 soir    → drama, transferts         ✅ après la fin du slot 1 (course 20h)
  //  23h00 nuit    → scandale, rumeurs         ✅ fin de soirée
  cron.schedule('0  8 * * *', async () => { try { await runScheduledNews(client, 'matin'); } catch(e) { console.error('News matin error:', e.message); } }, { timezone: 'Europe/Paris' });
  cron.schedule('0 10 * * *', async () => { try { await runScheduledNews(client, 'midi');  } catch(e) { console.error('News midi error:',  e.message); } }, { timezone: 'Europe/Paris' });
  cron.schedule('0 16 * * *', async () => { try { await runScheduledNews(client, 'aprem'); } catch(e) { console.error('News aprem error:', e.message); } }, { timezone: 'Europe/Paris' });
  cron.schedule('0 21 * * *', async () => { try { await runScheduledNews(client, 'soir');  } catch(e) { console.error('News soir error:',  e.message); } }, { timezone: 'Europe/Paris' });
  cron.schedule('0 23 * * *', async () => { try { await runScheduledNews(client, 'nuit');  } catch(e) { console.error('News nuit error:',  e.message); } }, { timezone: 'Europe/Paris' });
  console.log('✅ Jobs news : 8h · 10h · 16h · 21h · 23h (hors créneaux de course)');
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
    'f1','admin_news_force','concept','admin_apply_last_race','admin_fix_emojis',
    'admin_replan','admin_evolve_cars','admin_reset_rivalites'].includes(commandName);
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
      // Utiliser les composantes UTC pour éviter le décalage de fuseau (-1 jour sur serveur UTC)
      const dateStr  = `${d.getUTCDate()}/${d.getUTCMonth()+1}`;
      const slotTag  = r.slot === 1 ? '🌆 17h' : '🌅 11h';
      const status   = (r.status === 'done' || r.status === 'race_computed') ? '✅' : r.status === 'practice_done' ? '🔧' : r.status === 'quali_done' ? '⏱️' : '🔜';
      return `${status} ${r.emoji} **${r.circuit}** — ${dateStr} ${slotTag} ${styleEmojis[r.gpStyle]}`;
    });

    const chunks = [];
    for (let i = 0; i < lines.length; i += 12) chunks.push(lines.slice(i, i+12).join('\n'));
    const embed = new EmbedBuilder().setTitle(`📅 Calendrier — Saison ${season.year}`).setColor('#0099FF').setDescription(chunks[0]);
    if (chunks[1]) embed.addFields({ name: '\u200B', value: chunks[1] });
    return interaction.editReply({ embeds: [embed] });
  }

  // ── /planning ─────────────────────────────────────────────
  if (commandName === 'planning') {
    const season = await getActiveSeason();
    if (!season) return interaction.editReply({ content: '❌ Aucune saison active.', ephemeral: true });

    // Prochains GPs non terminés (max 6 = ~3 jours)
    const upcoming = await Race.find({
      seasonId: season._id,
      status: { $nin: ['done', 'race_computed'] },
    }).sort({ index: 1 }).limit(6);

    if (!upcoming.length)
      return interaction.editReply({ content: '🏁 Tous les GPs de la saison sont terminés !', ephemeral: true });

    const seStyle = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };

    // ── Trouver le seul prochain événement global (un seul ← prochain sur tout le planning) ──
    // On parcourt les GPs dans l'ordre et on s'arrête au premier événement non fait.
    let nextEventRaceId = null;
    let nextEventType   = null; // 'el' | 'q' | 'r'
    for (const r of upcoming) {
      const isDone  = r.status === 'done' || r.status === 'race_computed';
      const isQDone = isDone || r.status === 'quali_done';
      const isEDone = isQDone || r.status === 'practice_done';
      if (!isEDone) { nextEventRaceId = String(r._id); nextEventType = 'el'; break; }
      if (!isQDone) { nextEventRaceId = String(r._id); nextEventType = 'q';  break; }
      if (!isDone)  { nextEventRaceId = String(r._id); nextEventType = 'r';  break; }
    }

    const fields = upcoming.map(r => {
      const d = new Date(r.scheduledDate);
      // Dériver le slot depuis le champ slot ou l'heure UTC stockée
      // 10h UTC = slot matin (11h CET) | 16h UTC = slot soir (17h CET)
      const utcHour  = d.getUTCHours();
      const isSlot1  = (r.slot === 1) || (r.slot == null && utcHour >= 14);
      const elH      = isSlot1 ? '17h00' : '11h00';
      const qH       = isSlot1 ? '18h00' : '13h00';
      const rH       = isSlot1 ? '20h00' : '15h00';
      const slotIcon = isSlot1 ? '🌆' : '🌅';
      const style    = seStyle[r.gpStyle] || '';

      // Affichage de la date : construire à partir des composantes UTC pour éviter
      // le décalage de fuseau (minuit UTC = veille à Paris → affiche -1 jour)
      const displayDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
      const dateStr = displayDate.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

      const isDone  = r.status === 'done' || r.status === 'race_computed';
      const isQDone = isDone || r.status === 'quali_done';
      const isEDone = isQDone || r.status === 'practice_done';

      // Le marqueur ← prochain n'est posé qu'une seule fois, sur l'événement global suivant
      const isNext = String(r._id) === nextEventRaceId;
      const next   = ' **← prochain**';

      const elLine = isEDone
        ? `~~🔧 Essais Libres — ${elH}~~ ✅`
        : `🔧 **Essais Libres** — ${elH}${isNext && nextEventType === 'el' ? next : ''}`;
      const qLine  = isQDone
        ? `~~⏱️ Qualifications — ${qH}~~ ✅`
        : `⏱️ **Qualifications** — ${qH}${isNext && nextEventType === 'q' ? next : ''}`;
      const rLine  = isDone
        ? `~~🏁 Course — ${rH}~~ ✅`
        : `🏁 **Course** — ${rH}${isNext && nextEventType === 'r' ? next : ''}`;

      return {
        name : `${r.emoji} ${r.circuit} ${style} · ${slotIcon} ${dateStr}`,
        value: `${elLine}\n${qLine}\n${rLine}`,
        inline: false,
      };
    });

    const planEmbed = new EmbedBuilder()
      .setTitle('🗓️ Planning des prochains GPs')
      .setColor('#FF6600')
      .setDescription(
        '> 🌅 **GP Matin** : EL **11h** · Qualifs **13h** · Course **15h**\n' +
        '> 🌆 **GP Soir**  : EL **17h** · Qualifs **18h** · Course **20h**\n\u200B'
      )
      .addFields(fields)
      .setFooter({ text: `Saison ${season.year} · Horaires heure de Paris (CET/CEST)` });

    return interaction.editReply({ embeds: [planEmbed] });
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
      // Appel direct de runPractice en mode override avec le channel de test
      await runPractice(interaction.channel);
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
          `\`/admin_scheduler_pause\` — ⏸️ Met en pause le scheduler auto${global.schedulerPaused ? ' *(actuellement en pause)*' : ''}`,
          `\`/admin_scheduler_resume\` — ▶️ Réactive le scheduler auto${!global.schedulerPaused ? ' *(actuellement actif)*' : ''}`,
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
          '`/planning` — Prochains GPs avec leurs horaires détaillés',
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
    const slotOpt = interaction.options?.getString('slot') || null;
    const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }));
    const autoSlot = hour < 10 ? 'matin' : hour < 14 ? 'midi' : hour < 18 ? 'aprem' : hour < 21 ? 'soir' : 'nuit';
    const slot = slotOpt || autoSlot;
    try {
      await runScheduledNews(client, slot);
      return interaction.editReply(`✅ News générée — slot **${slot}**.`);
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
    runRace(interaction.channel, gpIndex).catch(e => {
      console.error('❌ [admin_force_race] CRASH DE COURSE :', e.message);
      console.error(e.stack);
    });
    return;
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

  if (commandName === 'admin_scheduler_pause') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    global.schedulerPaused = true;
    return interaction.reply({
      content: '⏸️ **Scheduler mis en pause.** Les EL, qualifications et courses ne se déclencheront plus automatiquement.\n> Utilisez `/admin_force_practice`, `/admin_force_quali`, `/admin_force_race` pour lancer manuellement.\n> Réactivez avec `/admin_scheduler_resume`.',
      ephemeral: false,
    });
  }

  if (commandName === 'admin_scheduler_resume') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    global.schedulerPaused = false;
    return interaction.reply({
      content: '▶️ **Scheduler réactivé.** Les GPs se lanceront automatiquement aux horaires habituels.\n> 🌅 11h EL · 13h Q · 15h Course\n> 🌆 17h EL · 18h Q · 20h Course',
      ephemeral: false,
    });
  }

  // ── /admin_fix_emojis ─────────────────────────────────────
  if (commandName === 'admin_fix_emojis') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.' });
    try {
      const lines = [];
      for (const def of DEFAULT_TEAMS) {
        const res = await Team.updateOne({ name: def.name }, { $set: { emoji: def.emoji } });
        if (res.matchedCount > 0) lines.push(`${def.emoji} **${def.name}** ✅`);
        else lines.push(`⚠️ **${def.name}** — introuvable en BDD`);
      }
      return interaction.editReply(`**Synchronisation des emojis :**\n${lines.join('\n')}`);
    } catch(e) { return interaction.editReply(`❌ Erreur : ${e.message}`); }
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
      // ── slot = index % 2, indépendamment de la date ──────────────────────
      // index pair (0,2,4..)  = slot 0 matin (11h EL · 13h Q · 15h Course)
      // index impair (1,3,5.) = slot 1 soir  (17h EL · 18h Q · 20h Course)
      // Grouper par date était faux si chaque GP avait une date différente —
      // l'index est la seule source de vérité fiable.
      // On reconstruit aussi la scheduledDate depuis le GP#0 comme ancre.
      const anchor = new Date(races[0].scheduledDate);
      anchor.setHours(11, 0, 0, 0);
      let updated = 0;
      for (const r of races) {
        const slot      = r.index % 2;
        const dayOffset = Math.floor(r.index / 2);
        const fixedDate = new Date(anchor);
        fixedDate.setDate(anchor.getDate() + dayOffset);
        fixedDate.setHours(slot === 1 ? 17 : 11, 0, 0, 0);
        await Race.findByIdAndUpdate(r._id, { slot, scheduledDate: fixedDate });
        updated++;
      }
      return interaction.editReply(
        `✅ **${updated}** GP recalculés (slot = index % 2).\n` +
        `> 🌅 index pair  → slot 0 · 11h EL · 13h Q · 15h Course\n` +
        `> 🌆 index impair → slot 1 · 17h EL · 18h Q · 20h Course\n` +
        `> 📅 Dates reconstruites depuis le GP #0.`
      );
    } catch(e) { return interaction.editReply(`❌ Erreur : ${e.message}`); }
  }

  // ── /admin_replan ─────────────────────────────────────────
  // Replanifie tout le calendrier à partir d'un GP de référence + date
  // Exemple : gp_index=6 (Emilia Romagna) · date=2025-03-04 · slot=matin
  //   → GP 6 = 4 mars matin, GP 7 = 4 mars soir, GP 8 = 5 mars matin...
  //   → GP 5 = 3 mars soir, GP 4 = 3 mars matin, GP 3 = 2 mars soir...
  if (commandName === 'admin_replan') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.' });
    try {
      const season = await getActiveSeason();
      if (!season) return interaction.editReply('❌ Pas de saison active.');

      const refIndex = interaction.options.getInteger('gp_index');
      const dateStr  = interaction.options.getString('date');           // 'YYYY-MM-DD'
      const slotStr  = interaction.options.getString('slot') || 'matin';

      // Valider la date
      const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!parts)
        return interaction.editReply(`❌ Date invalide : \`${dateStr}\` — utilise le format YYYY-MM-DD.`);

      // Construire la date en UTC-midi pour éviter le décalage d'un jour sur les serveurs UTC
      // ex: '2025-03-04' → Date.UTC(2025,2,4,12,0,0) = 2025-03-04T12:00:00Z → Paris = 13h, même jour ✅
      const [, ry, rm, rd] = parts.map(Number);
      const refDateUTC = new Date(Date.UTC(ry, rm - 1, rd, 12, 0, 0));
      if (isNaN(refDateUTC.getTime()))
        return interaction.editReply(`❌ Date invalide : \`${dateStr}\`.`);

      const refSlot = slotStr === 'soir' ? 1 : 0;
      // ── Suppression du blocage par parité d'index ──────────────
      // L'ancien code forçait index pair = matin, index impair = soir.
      // Désormais le slot de référence est libre : Miami (index 5) peut être matin.

      const races = await Race.find({ seasonId: season._id }).sort({ index: 1 });
      if (!races.length) return interaction.editReply('❌ Aucun GP trouvé.');

      // ── Calcul du décalage en jours depuis la course de référence ──
      // Chaque GP = 1 "demi-journée". La formule tient compte du slot de départ :
      //   refSlot=0 (matin) : steps +1 = même jour (soir), +2 = j+1 (matin)…
      //   refSlot=1 (soir)  : steps +1 = j+1 (matin), +2 = j+1 (soir)…
      function dayOffset(steps, startSlot) {
        if (steps >= 0) return Math.floor((steps + startSlot) / 2);
        return -Math.floor((-steps + (1 - startSlot)) / 2);
      }

      let updated = 0;
      const preview = [];
      for (const r of races) {
        const steps   = r.index - refIndex;
        // Slot dérivé : alterne à partir du slot de référence
        const newSlot = ((refSlot + steps) % 2 + 2) % 2;
        const dOff    = dayOffset(steps, refSlot);

        const fixedDate = new Date(refDateUTC);
        fixedDate.setUTCDate(refDateUTC.getUTCDate() + dOff);
        // Heures stockées en UTC : 10h UTC = 11h CET (hiver) / 12h CEST (été)
        // Le display utilise r.slot pour afficher 11h/17h, l'heure stockée sert juste de repère
        fixedDate.setUTCHours(newSlot === 1 ? 16 : 10, 0, 0, 0);

        await Race.findByIdAndUpdate(r._id, { slot: newSlot, scheduledDate: fixedDate });

        if (r.index <= 2 || r.index >= races.length - 2 || r.index === refIndex || r.index === refIndex + 1) {
          const ds = fixedDate.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday:'short', day:'numeric', month:'short' });
          const slotIcon = newSlot === 1 ? '🌆' : '🌅';
          preview.push(`${slotIcon} **#${r.index}** ${r.emoji} ${r.circuit} — ${ds} ${newSlot === 1 ? '17h' : '11h'}`);
        }
        updated++;
      }

      return interaction.editReply(
        `✅ Calendrier replanifié — **${updated} GPs** mis à jour.\n` +
        `> 📍 Ancre : **#${refIndex} ${races.find(r=>r.index===refIndex)?.emoji||''} ${races.find(r=>r.index===refIndex)?.circuit||'?'}** → **${dateStr}** ${refSlot===1?'🌆 17h':'🌅 11h'}\n\n` +
        `**Aperçu :**\n${preview.join('\n')}\n\n` +
        `*Lance \`/planning\` pour voir le calendrier complet.*`
      );
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
  // Comparaison en timezone Europe/Paris pour éviter les décalages UTC
  const opts  = { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' };
  const today   = new Date().toLocaleDateString('fr-FR', opts);
  const raceDay = new Date(race.scheduledDate).toLocaleDateString('fr-FR', opts);
  // La vérification de slot est gérée en amont dans getCurrentRace()
  // On ne la recheck pas ici pour ne pas bloquer les lancements automatiques
  return today === raceDay;
}

async function runPractice(override, gpIndex = null) {
  const season = await getActiveSeason(); if (!season) return;
  const slot   = (gpIndex !== null || override) ? null : getCurrentSlot();
  const race   = gpIndex !== null
    ? await Race.findOne({ seasonId: season._id, index: gpIndex })
    : await getCurrentRace(season, slot);
  if (!race) return;
  if (!await isRaceDay(race, override)) return;
  if (race.status !== 'upcoming' && !override) {
    console.log(`[runPractice] Déjà fait pour ${race.circuit} slot=${race.slot} (status=${race.status})`);
    return;
  }

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { weather, e1, e2, e3 } = await simulatePractice(race, pilots, teams);
  const channel = await getRaceChannel(override);
  if (!channel) { await Race.findByIdAndUpdate(race._id, { status: 'practice_done' }); return; }

  const W = ms => new Promise(r => setTimeout(r, ms));
  const styleEmojis   = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  const weatherLabels = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Intermédiaire', HOT:'🔥 Chaud' };
  const tireEmoji     = c => TIRE[c]?.emoji || '';
  const tireLabel     = c => TIRE[c] ? `${TIRE[c].emoji} ${TIRE[c].label}` : c;

  // ── Nombre de GPs dans la saison ──────────────────────────
  const totalRaces    = await Race.countDocuments({ seasonId: season._id });
  const gpNumber      = (race.index ?? 0) + 1;

  // ── Classement pilotes actuel ──────────────────────────────
  const allStandings  = await Standing.find({ seasonId: season._id }).sort({ points: -1 });
  const allPilots     = await Pilot.find();
  const pilotStandingsFull = allStandings.map((s, i) => {
    const p = allPilots.find(p => String(p._id) === String(s.pilotId));
    return p ? `**${i+1}.** ${p.name} — **${s.points} pts**` : null;
  }).filter(Boolean).join('\n');

  // ── Classement constructeurs actuel (complet) ─────────────
  const constrStandings    = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
  const constrStandingsFull = constrStandings.map((s, i) => {
    const t = teams.find(t => String(t._id) === String(s.teamId));
    return t ? `**${i+1}.** ${t.emoji} ${t.name} — **${s.points} pts**` : null;
  }).filter(Boolean).join('\n');

  // ── 3 derniers vainqueurs sur CE circuit (BDD) ────────────
  const pastWins = await PilotGPRecord.find({
    circuit   : race.circuit,
    finishPos : 1,
    dnf       : false,
  }).sort({ seasonYear: -1 }).limit(10);

  // Dédoublonner par saison (prendre le plus récent de chaque année), puis top 3
  const seenYears = new Set();
  const top3wins  = [];
  for (const w of pastWins) {
    if (!seenYears.has(w.seasonYear)) {
      seenYears.add(w.seasonYear);
      top3wins.push(w);
    }
    if (top3wins.length === 3) break;
  }

  // Compter le total de victoires sur ce circuit pour chaque pilote
  const winCountMap = new Map();
  for (const w of pastWins) {
    winCountMap.set(String(w.pilotId), (winCountMap.get(String(w.pilotId)) || 0) + 1);
  }

  const pastWinsStr = top3wins.length > 0
    ? top3wins.map((w, i) => {
        const medal  = ['🥇','🥈','🥉'][i];
        const wins   = winCountMap.get(String(w.pilotId)) || 1;
        const winsTag = wins > 1 ? ` *(×${wins} sur ce circuit)*` : '';
        return `${medal} **${w.pilotName || '?'}** (${w.seasonYear})${winsTag}`;
      }).join('\n')
    : '*Aucun historique disponible*';

  // ── Record all-time du circuit ────────────────────────────
  const circuitRecord = await CircuitRecord.findOne({ circuit: race.circuit });
  const recordStr = circuitRecord
    ? `⚡ **${msToLapStr(circuitRecord.bestTimeMs)}** — ${circuitRecord.pilotName || '?'} ${circuitRecord.teamEmoji || ''} *(S${circuitRecord.seasonYear || '?'})*`
    : '*Aucun record établi*';

  // ══════════════════════════════════════════════════════════
  // PRÉSENTATION DU GP
  // ══════════════════════════════════════════════════════════
  const introEmbed = new EmbedBuilder()
    .setTitle(`${race.emoji} GRAND PRIX DE ${race.circuit.toUpperCase()} — GP ${gpNumber}/${totalRaces}`)
    .setColor('#FF1801')
    .setDescription(
      `**${styleEmojis[race.gpStyle] || ''} Circuit ${race.gpStyle.toUpperCase()}** · Météo prévue : **${weatherLabels[weather] || weather}**\n\u200B`
    )
    .addFields(
      {
        name: '🏆 Championnat Pilotes',
        value: (pilotStandingsFull || '*Aucune donnée*').slice(0, 1024),
        inline: true,
      },
      {
        name: '🏗️ Championnat Constructeurs',
        value: (constrStandingsFull || '*Aucune donnée*').slice(0, 1024),
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: false,
      },
      {
        name: `🏁 Derniers vainqueurs — ${race.emoji} ${race.circuit}`,
        value: pastWinsStr,
        inline: true,
      },
      {
        name: '⏱️ Record du circuit',
        value: recordStr,
        inline: true,
      }
    )
    .setFooter({ text: `Saison ${season.year} · Les essais libres commencent dans quelques instants...` });

  await channel.send({ embeds: [introEmbed] });
  await W(4000);

  // ══════════════════════════════════════════════════════════
  // EL 1
  // ══════════════════════════════════════════════════════════
  await channel.send(
    `🔧 **ESSAIS LIBRES 1 — ${race.emoji} ${race.circuit}**\n` +
    `*Les équipes entament leur programme de tests — checks mécaniques, mise en température, longs runs de données. Les temps ne veulent pas grand chose...*`
  );
  await W(3000);

  // Incidents E1
  for (const inc of e1.incidents) {
    await channel.send(`⚠️ *${inc.team.emoji}**${inc.pilot.name}** n'a pas pu boucler un tour chronométré en EL1 — problème technique probable.*`);
    await W(1500);
  }

  // Sandbagging E1 (~40% des pilotes en programme réduit)
  const sandbag1 = new Set(
    [...e1.results].sort(() => Math.random() - 0.5)
      .slice(0, Math.floor(e1.results.length * 0.4))
      .map(r => String(r.pilot._id))
  );

  const e1Lines = e1.results.map((r, i) => {
    if (r.noTime) return `**—** ${r.team.emoji} ${r.pilot.name} — *pas de temps*`;
    const note = sandbag1.has(String(r.pilot._id))
      ? pick([' *(longs runs)*', ' *(programme technique)*', ' *(checks méca)*', ' *(données aéro)*', ' *(pas poussé)*'])
      : '';
    return `**P${i+1}** ${r.team.emoji} ${r.pilot.name} ${tireEmoji(r.compound)} — ${msToLapStr(r.time)}${note}`;
  }).join('\n');

  const el1Embed = new EmbedBuilder()
    .setTitle(`🔧 EL1 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#555555')
    .setDescription(
      `Météo : **${weatherLabels[weather] || weather}**\n\n` +
      e1Lines + '\n\n' +
      pick([
        '⚠️ *Résultats très peu représentatifs — programmes de test variés.*',
        '⚠️ *Quasi aucune info à tirer de cette session — tout le monde fait autre chose.*',
        '⚠️ *EL1 = boîte noire. Les vraies intentions se dévoileront plus tard.*',
      ])
    )
    .setFooter({ text: 'EL2 dans quelques instants — programmes de setup à venir.' });

  await channel.send({ embeds: [el1Embed] });
  await W(5000);

  // ══════════════════════════════════════════════════════════
  // EL 2
  // ══════════════════════════════════════════════════════════
  await channel.send(
    `🔧 **ESSAIS LIBRES 2 — ${race.emoji} ${race.circuit}**\n` +
    `*Les équipes continuent leurs essais. Quelques runs rapides commencent à apparaître, mais les données de setup restent prioritaires.*`
  );
  await W(3000);

  for (const inc of e2.incidents) {
    await channel.send(`⚠️ *${inc.team.emoji}**${inc.pilot.name}** rentre aux stands prématurément — problème à investiguer.*`);
    await W(1500);
  }

  const sandbag2 = new Set(
    [...e2.results].sort(() => Math.random() - 0.5)
      .slice(0, Math.floor(e2.results.length * 0.3))
      .map(r => String(r.pilot._id))
  );

  const e2Lines = e2.results.map((r, i) => {
    if (r.noTime) return `**—** ${r.team.emoji} ${r.pilot.name} — *pas de temps*`;
    const note = sandbag2.has(String(r.pilot._id))
      ? pick([' *(setup longue distance)*', ' *(test de pneus)*', ' *(comparaison ailerons)*', ' *(simulation de course)*'])
      : '';
    return `**P${i+1}** ${r.team.emoji} ${r.pilot.name} ${tireEmoji(r.compound)} — ${msToLapStr(r.time)}${note}`;
  }).join('\n');

  const el2Embed = new EmbedBuilder()
    .setTitle(`🔧 EL2 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#666666')
    .setDescription(
      `Météo : **${weatherLabels[weather] || weather}**\n\n` +
      e2Lines + '\n\n' +
      pick([
        '⚠️ *Encore beaucoup de programmes mixtes — difficile d\'en tirer des conclusions.*',
        '⚠️ *Certaines équipes semblent avoir trouvé quelque chose, d\'autres cherchent encore.*',
        '⚠️ *Les données sont là, mais les interprétations restent floues avant EL3.*',
      ])
    )
    .setFooter({ text: 'EL3 : la session décisive — les équipes sortent leur meilleur setup.' });

  await channel.send({ embeds: [el2Embed] });
  await W(5000);

  // ══════════════════════════════════════════════════════════
  // EL 3 — La vraie session
  // ══════════════════════════════════════════════════════════
  await channel.send(
    `🔧 **ESSAIS LIBRES 3 — ${race.emoji} ${race.circuit}**\n` +
    `*Dernière chance avant les qualifications. Les équipes sortent leur meilleur setup — tous en ${tireLabel('SOFT')} pour simuler un tour de quali. Les temps commencent à parler.*`
  );
  await W(3000);

  for (const inc of e3.incidents) {
    await channel.send(`⚠️ *${inc.team.emoji}**${inc.pilot.name}** ne peut pas prendre la piste en EL3 — les mécaniciens au travail.*`);
    await W(1500);
  }

  // Flash mi-session EL3
  const flashE3 = [...e3.results.filter(r => !r.noTime)].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *EL3 — premier run :* ` +
    flashE3.map(r => `${r.team.emoji}**${r.pilot.name}** ${tireEmoji(r.compound)} ${msToLapStr(r.time)}`).join(' · ')
  );
  await W(2500);

  const e3Timed   = e3.results.filter(r => !r.noTime);
  const refTime   = e3Timed[0]?.time || 0;

  const e3Lines = e3.results.map((r, i) => {
    if (r.noTime) return `**—** ${r.team.emoji} ${r.pilot.name} — *pas de temps* ⚠️`;
    const gap = i === 0 ? '⏱ REF' : `+${((r.time - refTime) / 1000).toFixed(3)}s`;
    return `**P${i+1}** ${r.team.emoji} ${r.pilot.name} ${tireEmoji(r.compound)} — ${msToLapStr(r.time)} — ${gap}`;
  }).join('\n');

  // Drapeau rouge possible en EL3 (15%) — avant l'embed final
  const redFlagEL3 = Math.random() < 0.15;
  if (redFlagEL3) {
    const victim = pick(e3.results.filter(r => !r.noTime));
    await channel.send(`🚨 *Drapeau rouge ! ${victim.team.emoji}**${victim.pilot.name}** immobilisé en piste — session interrompue brièvement.*`);
    await W(2000);
  }

  const el3Embed = new EmbedBuilder()
    .setTitle(`🔧 EL3 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#888888')
    .setDescription(
      `Météo : **${weatherLabels[weather] || weather}** · Tous sur ${tireLabel('SOFT')}\n\n` +
      e3Lines + '\n\n' +
      pick([
        '📊 *Ces temps reflètent mieux la hiérarchie réelle — les qualifs confirmeront.*',
        '📊 *EL3 parle enfin. La grille se dessine, mais les surprises restent possibles en quali.*',
        '📊 *Le setup semble trouvé pour certains. D\'autres auront encore du travail ce soir.*',
      ])
    )
    .setFooter({ text: race.slot === 1 ? 'Qualifications à 18h 🏎️' : 'Qualifications à 13h 🏎️' });

  await channel.send({ embeds: [el3Embed] });
  await Race.findByIdAndUpdate(race._id, { status: 'practice_done' });
}

async function runQualifying(override, gpIndex = null) {
  const season = await getActiveSeason(); if (!season) return;
  const slot   = (gpIndex !== null || override) ? null : getCurrentSlot();
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

  const qualiData = await simulateQualifying(race, pilots, teams);
  const { grid, weather, q3Size, q2Size, drama, q1State, q2State, q3State, q1Eliminated, q2Eliminated, redFlagQ3 } = qualiData;
  const channel = await getRaceChannel(override);

  await Race.findByIdAndUpdate(race._id, {
    qualiGrid: grid.map(g => ({ pilotId: g.pilotId, time: g.time })),
    status: 'quali_done',
  });

  if (!channel) return;

  const styleEmojis   = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
  const weatherLabels = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Intermédiaire', HOT:'🔥 Chaud' };
  const W = ms => new Promise(r => setTimeout(r, ms));

  const q3Grid = grid.slice(0, q3Size);
  const q2Grid = grid.slice(q3Size, q2Size);
  const q1Grid = grid.slice(q2Size);
  const poleman = q3Grid[0];

  // ── helper : ligne de résultat avec indicateur amélioration ──
  const timeLine = (g, pos, refTime) => {
    const gap = pos === 1 ? '⏱ REF' : `+${((g.time - refTime) / 1000).toFixed(3)}s`;
    const imp = g.improved ? ' 📈' : '';
    return `\`P${String(pos).padStart(2,' ')}\` ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)} — ${gap}${imp}`;
  };

  // ─── INTRO ───────────────────────────────────────────────
  const urbainNote = race.gpStyle === 'urbain'
    ? '\n🏙️ *Circuit urbain — chaque millième compte, les murs punissent sans pitié.*' : '';
  await channel.send(
    `⏱️ **QUALIFICATIONS — ${race.emoji} ${race.circuit}**\n` +
    `${styleEmojis[race.gpStyle] || ''} **${race.gpStyle.toUpperCase()}** · Météo : **${weatherLabels[weather] || weather}**\n` +
    `Les pilotes prennent la piste pour décrocher la meilleure place sur la grille...${urbainNote}`
  );
  await W(3000);

  // ══════════════════════════════════════════════════════════
  // Q1
  // ══════════════════════════════════════════════════════════
  await channel.send(
    `🟡 **Q1 — EN PISTE !** · ${grid.length} pilotes · Élimination à partir de P${q2Size + 1}\n` +
    `*Chaque pilote dispose de 2 tentatives — track evolution en cours...*`
  );
  await W(3000);

  // Flash mi-session Q1 : 3-4 temps intermédiaires (légèrement dégradés = pas encore leur meilleur)
  const flashQ1 = [...q1State].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q1 — premier run :* ` +
    flashQ1.map(s => `${s.team.emoji}**${s.pilot.name}** ${s.r1 ? msToLapStr(s.r1) : '*tour annulé*'}`).join(' · ')
  );
  await W(2500);

  // Drama Q1
  for (const ev of drama.q1) {
    if (ev.type === 'double_abort') {
      await channel.send(`⚠️ *${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** n'a pas réussi à boucler un tour propre — ses deux tentatives annulées. Qualifications compromises.*`);
      await W(1500);
    }
    if (ev.type === 'thriller_q1') {
      await channel.send(`😰 *Q1 ultra-serré en bas du classement — **${ev.gap.toFixed(3)}s** entre ${ev.safe.team.emoji}**${ev.safe.pilot.name}** (qualifié de justesse) et ${ev.elim.team.emoji}**${ev.elim.pilot.name}** (éliminé). Le drapeau à damier va tout changer...*`);
      await W(1500);
    }
  }

  // Résultats Q1
  const q1Embed = new EmbedBuilder()
    .setTitle(`🔴 Q1 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF4444')
    .setDescription(
      `**Classement complet Q1 :**\n` +
      [...q3State, ...q2State.slice(q3Size), ...q1Eliminated].slice(0, q2Size)
        .map((s, i) => {
          const g = grid[i];
          return timeLine(g, i + 1, poleman.time);
        }).join('\n') +
      `\n\n🔴 **Éliminés (P${q2Size + 1}–${grid.length}) :**\n` +
      q1Grid.map((g, i) => timeLine(g, q2Size + 1 + i, poleman.time)).join('\n') +
      `\n\n✅ **Top ${q2Size} qualifiés pour Q2**`
    );
  await channel.send({ embeds: [q1Embed] });
  await W(4000);

  // ══════════════════════════════════════════════════════════
  // Q2
  // ══════════════════════════════════════════════════════════
  const bubbleQ2 = q2State.slice(q3Size - 2, q3Size + 2).map(s => `${s.team.emoji}**${s.pilot.name}**`).join(' · ');
  await channel.send(
    `🟡 **Q2 — EN PISTE !** · ${q2Size} pilotes · Élimination à partir de P${q3Size + 1}\n` +
    `*Sur le fil de la zone rouge : ${bubbleQ2}*`
  );
  await W(3000);

  // Drapeau jaune Q2
  if (qualiData.yellowFlagQ2) {
    const yp = qualiData.yellowFlagQ2;
    await channel.send(`🟡 **DRAPEAU JAUNE !** ${yp.team?.emoji || ''}**${yp.pilot?.name || yp.name || '?'}** est sorti des limites — les tours en cours sont annulés pour les pilotes dans ce secteur !`);
    await W(2000);
  }

  // Flash mi-Q2
  const flashQ2 = [...q2State].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q2 — deuxième run :* ` +
    flashQ2.map(s => `${s.team.emoji}**${s.pilot.name}** ${s.r2 ? msToLapStr(s.r2) : '*amélioré*'}`).join(' · ')
  );
  await W(2500);

  // Drama Q2
  for (const ev of drama.q2) {
    if (ev.type === 'thriller_q2') {
      await channel.send(`😰 *Seulement **${ev.gap.toFixed(3)}s** entre ${ev.safe.team.emoji}**${ev.safe.pilot.name}** (qualifié) et ${ev.elim.team.emoji}**${ev.elim.pilot.name}** (éliminé). C'est quasi-millimétré.*`);
      await W(1500);
    }
    if (ev.type === 'last_gasp_q2') {
      await channel.send(`⚡ *DERNIÈRE SECONDE !* ${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** améliore son temps in-extremis et s'accroche au top ${q3Size} !`);
      await W(1500);
    }
    if (ev.type === 'yellow_victim') {
      await channel.send(`😤 ${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** éliminé à cause du drapeau jaune — son meilleur tour annulé. *Cruel.*`);
      await W(1500);
    }
  }

  const lastQ2Safe  = q2State[q3Size - 1];
  const firstOutQ2  = q2State[q3Size];
  const q2ThrillStr = lastQ2Safe && firstOutQ2 ? `\n⚠️ **${lastQ2Safe.team.emoji}${lastQ2Safe.pilot.name}** passe de justesse — **${((firstOutQ2.time - lastQ2Safe.time)/1000).toFixed(3)}s** d'avance sur **${firstOutQ2.team.emoji}${firstOutQ2.pilot.name}**.` : '';

  const q2Embed = new EmbedBuilder()
    .setTitle(`🔴 Q2 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF8800')
    .setDescription(
      `🔴 **Éliminés (P${q3Size + 1}–${q2Size}) :**\n` +
      q2Grid.map((g, i) => timeLine(g, q3Size + 1 + i, poleman.time)).join('\n') +
      q2ThrillStr +
      `\n\n✅ **Top ${q3Size} qualifiés pour Q3 :**\n` +
      q3Grid.map((g, i) => `${['🥇','🥈','🥉'][i] || `**${i+1}.**`} ${g.teamEmoji} **${g.pilotName}** — ${msToLapStr(g.time)}`).join('\n')
    );
  await channel.send({ embeds: [q2Embed] });
  await W(4000);

  // ══════════════════════════════════════════════════════════
  // Q3 — SHOOT-OUT POLE
  // ══════════════════════════════════════════════════════════
  const q3Names = q3State.map(s => `${s.team.emoji}**${s.pilot.name}**`).join(' · ');
  await channel.send(
    `🔥 **Q3 — SHOOT-OUT POUR LA POLE POSITION !**\n` +
    `Les ${q3Size} meilleurs pilotes · **2 tentatives chacun** — tout se joue maintenant !\n` +
    `*En piste : ${q3Names}*`
  );
  await W(3000);

  // Premier run Q3
  const flashQ3r1 = [...q3State].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q3 — premier run :* ` +
    flashQ3r1.map(s => `${s.team.emoji}**${s.pilot.name}** ${s.r1q3 ? msToLapStr(s.r1q3) : '*en chauffe*'}`).join(' · ')
  );
  await W(2500);

  // Drapeau rouge Q3
  if (redFlagQ3) {
    const triggerDrama = drama.q3.find(e => e.type === 'red_flag');
    const victims = drama.q3.find(e => e.type === 'red_victims');
    await channel.send(`🚩 **DRAPEAU ROUGE EN Q3 !** Session interrompue !${triggerDrama?.trigger ? ` Sortie de ${triggerDrama.trigger.team?.emoji || ''}**${triggerDrama.trigger.pilot?.name || '?'}**.` : ''}`);
    await W(2000);
    await channel.send(`🔁 *Relance de Q3 — il reste quelques minutes. Certains pilotes doivent encore trouver leur tour.*`);
    await W(2000);
    if (victims?.victims?.length) {
      const vNames = victims.victims.map(v => `${v.team.emoji}**${v.pilot.name}**`).join(', ');
      await channel.send(`😤 *Victimes du drapeau rouge : ${vNames} n'ont pas pu boucler leur tour de qualif.*`);
      await W(1500);
    }
  }

  // Révélation des temps Q3 du deuxième run (de bas en haut — le suspense monte)
  await channel.send(`📻 *Q3 — deuxième run en cours... Les temps tombent !*`);
  await W(1500);

  const q3Sorted = [...q3State].sort((a, b) => a.time - b.time);
  const revealCount = Math.min(5, q3Sorted.length);
  // Révéler du dernier au P3 avec suspense, puis P2 et P1 séparément
  for (let i = q3Sorted.length - 1; i >= q3Sorted.length - revealCount + 2; i--) {
    const s = q3Sorted[i];
    const pos = i + 1;
    const gap = `+${((s.time - q3Sorted[0].time) / 1000).toFixed(3)}s`;
    await channel.send(`📻 **P${pos}** ${s.team.emoji}**${s.pilot.name}** — ${msToLapStr(s.time)} — ${gap}${s.improved ? ' 📈' : ''}`);
    await W(1200);
  }
  if (q3Sorted.length >= 2) {
    const p2 = q3Sorted[1];
    const gapP2 = `+${((p2.time - q3Sorted[0].time) / 1000).toFixed(3)}s`;
    await channel.send(`📻 **P2** ${p2.team.emoji}**${p2.pilot.name}** — ${msToLapStr(p2.time)} — ${gapP2}${p2.improved ? ' 📈' : ''}\n*Peut-il encore être battu ?*`);
    await W(2000);
  }

  // Drama Q3
  for (const ev of drama.q3) {
    if (ev.type === 'photo_finish_pole') {
      await channel.send(`⚡ *ÉCART INCROYABLE* — seulement **${ev.gap.toFixed(3)}s** entre ${ev.pole.team.emoji}**${ev.pole.pilot.name}** et ${ev.second.team.emoji}**${ev.second.pilot.name}**. La pole se joue au millième !`);
      await W(1500);
    }
    if (ev.type === 'dominant_pole') {
      await channel.send(`💪 *${ev.pole.team.emoji}**${ev.pole.pilot.name}** s'envole ! +${ev.gap.toFixed(3)}s d'avance — performance de haute volée.*`);
      await W(1500);
    }
  }

  // ── Grille finale Q3 ─────────────────────────────────────
  const q3FinalEmbed = new EmbedBuilder()
    .setTitle(`🏆 Q3 — GRILLE DE DÉPART OFFICIELLE — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(
      q3Grid.map((g, i) => timeLine(g, i + 1, poleman.time)).join('\n') +
      `\n\nMétéo Q : **${weatherLabels[weather] || weather}**`
    );
  await channel.send({ embeds: [q3FinalEmbed] });
  await W(2000);

  // ── POLE POSITION ─────────────────────────────────────────
  const gap2nd = q3Grid[1] ? ((q3Grid[1].time - poleman.time) / 1000).toFixed(3) : null;
  const poleMsgs = gap2nd && parseFloat(gap2nd) < 0.05
    ? [`***🏆 POLE POSITION !!! ${poleman.teamEmoji}${poleman.pilotName} EN ${msToLapStr(poleman.time)} !!!***\n*Seulement +${gap2nd}s de marge — photo finish historique avec ${q3Grid[1]?.teamEmoji}${q3Grid[1]?.pilotName} !*`]
    : gap2nd && parseFloat(gap2nd) > 0.5
    ? [`🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** — ${msToLapStr(poleman.time)}\n*+${gap2nd}s d'avance sur ${q3Grid[1]?.teamEmoji}**${q3Grid[1]?.pilotName}** — dominateur ce week-end.*`]
    : [`🏆 **POLE POSITION** pour ${poleman.teamEmoji} **${poleman.pilotName}** — ${msToLapStr(poleman.time)}` + (gap2nd ? ` · +${gap2nd}s sur ${q3Grid[1]?.teamEmoji}**${q3Grid[1]?.pilotName}**` : '')];
  await channel.send(pick(poleMsgs));
  await W(2000);

  // ── Grille complète ───────────────────────────────────────
  const fullGrid = [...q3Grid, ...q2Grid, ...q1Grid];
  const fullGridLines = fullGrid.map((g, i) => timeLine(g, i + 1, poleman.time)).join('\n');
  const fullGridEmbed = new EmbedBuilder()
    .setTitle(`🏎️ GRILLE COMPLÈTE — ${race.emoji} ${race.circuit}`)
    .setColor('#CC0000')
    .setDescription(fullGridLines);
  await channel.send({ embeds: [fullGridEmbed] });
  await W(2000);

  // ── Contexte championnat post-Q3 ─────────────────────────
  try {
    const seasonCtx = await getActiveSeason();
    if (seasonCtx) {
      const champStandings = await Standing.find({ seasonId: seasonCtx._id }).sort({ points: -1 }).limit(8);
      const totalRaces     = await Race.countDocuments({ seasonId: seasonCtx._id });
      const doneRaces      = await Race.countDocuments({ seasonId: seasonCtx._id, status: 'done' });
      const seasonProgress = totalRaces > 0 ? doneRaces / totalRaces : 0;
      const isEarlySeason  = seasonProgress < 0.30;
      const isLateSeason   = seasonProgress > 0.70;

      const allPilotsForDrama = await Pilot.find();
      const pilotMapD = new Map(allPilotsForDrama.map(p => [String(p._id), p]));
      const allTeamsD = await Team.find();
      const teamMapD  = new Map(allTeamsD.map(t => [String(t._id), t]));

      const dramaLines = [];

      const leaderStanding = champStandings[0];
      const leaderPilot    = leaderStanding ? pilotMapD.get(String(leaderStanding.pilotId)) : null;
      const leaderEntry    = leaderPilot ? grid.find(g => String(g.pilotId) === String(leaderStanding.pilotId)) : null;
      const leaderGridPos  = leaderEntry ? grid.indexOf(leaderEntry) + 1 : null;

      if (leaderPilot && leaderGridPos === 1) {
        const leaderTeam = teamMapD.get(String(leaderPilot.teamId));
        if (isLateSeason) dramaLines.push(`👑 **${leaderTeam?.emoji||''}${leaderPilot.name}** — leader du championnat ET pole. *La fin de saison approche...*`);
        else dramaLines.push(`👑 **${leaderTeam?.emoji||''}${leaderPilot.name}** confirme : leader au champ, pole en Q3. *Message envoyé.*`);
      }

      const p2Standing = champStandings[1];
      const p2Pilot    = p2Standing ? pilotMapD.get(String(p2Standing.pilotId)) : null;
      if (p2Pilot && leaderPilot && leaderGridPos) {
        const p2Entry   = grid.find(g => String(g.pilotId) === String(p2Standing.pilotId));
        const p2GridPos = p2Entry ? grid.indexOf(p2Entry) + 1 : null;
        if (p2GridPos && p2GridPos < leaderGridPos) {
          const p2Team = teamMapD.get(String(p2Pilot.teamId));
          const ptGap  = leaderStanding.points - p2Standing.points;
          dramaLines.push(`⚡ **${p2Team?.emoji||''}${p2Pilot.name}** (P2 champ, -${ptGap} pts) devance le leader en grille. *La course de demain peut tout changer.*`);
        }
      }

      champStandings.forEach((s, champPos) => {
        if (champPos === 0) return;
        const pilot = pilotMapD.get(String(s.pilotId));
        if (!pilot) return;
        const gridEntry = grid.find(g => String(g.pilotId) === String(s.pilotId));
        if (!gridEntry) return;
        const gridPos = grid.indexOf(gridEntry) + 1;
        const team = teamMapD.get(String(pilot.teamId));
        if (champPos <= 4 && gridPos >= 8) {
          const sev = gridPos >= 14 ? '🚨' : '⚠️';
          dramaLines.push(`${sev} **${team?.emoji||''}${pilot.name}** — P${champPos + 1} au champ, **P${gridPos}** en grille. *Session difficile à oublier.*`);
        }
      });

      if (dramaLines.length > 0) {
        await channel.send(`📊 **ENJEUX CHAMPIONNAT :**\n${dramaLines.slice(0, 3).join('\n')}`);
        await W(2000);
      }
    }
  } catch(e) { console.error('Quali drama error:', e.message); }
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
  const slot   = (gpIndex !== null || override) ? null : getCurrentSlot();
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

// ── Flag global pour pause du scheduler ──────────────────────
global.schedulerPaused = false;

function startScheduler() {
  const guardedRun = (fn, label) => () => {
    if (global.schedulerPaused) {
      console.log(`[Scheduler] ⏸️ ${label} ignoré — scheduler en pause.`);
      return;
    }
    fn().catch(console.error);
  };
  // ── Slot 0 : GP matin (11h essais · 13h qualifs · 15h course) ──
  cron.schedule('0 11 * * *', guardedRun(runPractice,   'Essais libres  slot 0'), { timezone: 'Europe/Paris' });
  cron.schedule('0 13 * * *', guardedRun(runQualifying, 'Qualifications slot 0'), { timezone: 'Europe/Paris' });
  cron.schedule('0 15 * * *', guardedRun(runRace,       'Course         slot 0'), { timezone: 'Europe/Paris' });
  // ── Slot 1 : GP soir (17h essais · 18h qualifs · 20h course) ──
  cron.schedule('0 17 * * *', guardedRun(runPractice,   'Essais libres  slot 1'), { timezone: 'Europe/Paris' });
  cron.schedule('0 18 * * *', guardedRun(runQualifying, 'Qualifications slot 1'), { timezone: 'Europe/Paris' });
  cron.schedule('0 20 * * *', guardedRun(runRace,       'Course         slot 1'), { timezone: 'Europe/Paris' });
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
