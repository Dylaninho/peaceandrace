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
// ── Intro vidéo GP ───────────────────────────────────────────
// INTRO_VIDEO_URL  : URL directe vers un MP4 (Discord CDN, hébergement perso...)
//                    Discord intègre et joue la vidéo automatiquement inline.
// INTRO_VIDEO_PATH : chemin local vers le fichier MP4 (ex: ./intro.mp4)
//                    Utilisé si INTRO_VIDEO_URL n'est pas défini.
// L'URL peut aussi être changée en live avec /admin_set_intro sans redémarrer le bot.
let raceIntroUrl  = process.env.INTRO_VIDEO_URL  || null;
let raceIntroPath = process.env.INTRO_VIDEO_PATH || null;
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

const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  // ── Route /ping — keep-alive ──────────────────────────────
  if (req.url === '/ping' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('F1 Bot is alive 🏎️');
  }

  // ── Route /intro — sert le fichier vidéo localement ───────
  // Place ton MP4 à côté du bot (même dossier) et nomme-le "intro.mp4"
  // URL d'accès : https://ton-app.onrender.com/intro
  // Supporte les Range requests (lecture partielle) — requis pour Discord
  if (req.url === '/intro') {
    const videoPath = path.join(__dirname, 'intro.mp4');
    if (!fs.existsSync(videoPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('intro.mp4 introuvable — place le fichier dans le même dossier que index.js');
    }
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Range request (lecture progressive, seek Discord player)
      const parts   = range.replace(/bytes=/, '').split('-');
      const start   = parseInt(parts[0], 10);
      const end     = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const file    = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range'  : `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges'  : 'bytes',
        'Content-Length' : chunkSize,
        'Content-Type'   : 'video/mp4',
      });
      return file.pipe(res);
    } else {
      // Requête complète
      res.writeHead(200, {
        'Content-Length' : fileSize,
        'Content-Type'   : 'video/mp4',
        'Accept-Ranges'  : 'bytes',
      });
      return fs.createReadStream(videoPath).pipe(res);
    }
  }

  // ── 404 pour tout le reste ────────────────────────────────
  res.writeHead(404);
  res.end('Not found');
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
  rivalId          : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', default: null },
  rivalContacts    : { type: Number, default: 0 },   // contacts en course cette saison vs rivalId
  rivalHeat        : { type: Number, default: 0 },    // intensite 0-100 : monte avec contacts/dommages, conditionne le ton narratif
  rivalDeclaredAt  : { type: Number, default: null }, // index du GP où la rivalité a été déclarée (évite la répétition)
  // ── Statut coéquipier ────────────────────────────────────────
  teamStatus        : { type: String, enum: ['numero1', 'numero2', null], default: null },
  teammateDuelWins  : { type: Number, default: 0 },   // victoires internes cette saison vs coéquipier
  // ── Personnalité ─────────────────────────────────────────
  personality : {
    archetype    : { type: String, default: null },
    tone         : { type: String, default: null },
    ego          : { type: Number, default: 50 },
    rivalryStyle : { type: String, default: null },
    pressStyle   : { type: String, default: null },
    teamChemistry: { type: Number, default: 50 },
    pressureLevel: { type: Number, default: 0 },
    archetypeEvo : { type: Number, default: 0 },
    fiaCriticism : { type: Number, default: 0 }, // 0-100 : tension envers la FIA
  },
  // État
  teamId       : { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  createdAt    : { type: Date, default: Date.now },
  // ── Forme récente ─────────────────────────────────────────
  // Score -1.0 → +1.0 basé sur les 3 derniers GPs, mis à jour après chaque course
  // Influence légèrement le temps au tour (+200ms sur série de DNFs, -200ms sur série de podiums)
  recentFormScore : { type: Number, default: 0 },
  // ── Surnom ────────────────────────────────────────────────
  // Donné par un rival ou un coéquipier à un moment-clé.
  // Repris ponctuellement dans les articles et confs de presse.
  nickname        : { type: String, default: null },
  nicknameGivenBy : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', default: null },
  // ── Historique inter-saisons ─────────────────────────────
  lastSeasonRank  : { type: Number, default: null }, // classement pilote saison précédente
  lastSeasonPts   : { type: Number, default: null }, // points saison précédente
  lastSeasonWins  : { type: Number, default: null }, // victoires saison précédente
  careerBestRank  : { type: Number, default: null }, // meilleur classement de carrière
  careerWins      : { type: Number, default: 0    }, // victoires cumulées toutes saisons
  careerPodiums   : { type: Number, default: 0    }, // podiums cumulés toutes saisons
  careerDnfs      : { type: Number, default: 0    }, // DNFs cumulés toutes saisons
  careerRaces     : { type: Number, default: 0    }, // courses disputées cumulées
});
const Pilot = mongoose.model('Pilot', PilotSchema);

// ── CommandCooldown — anti-spam commandes joueurs ──────────
const CommandCooldownSchema = new mongoose.Schema({
  discordId  : { type: String, required: true },
  command    : { type: String, required: true },
  pilotId    : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  usedAt     : { type: Date, default: Date.now },
});
CommandCooldownSchema.index({ discordId: 1, command: 1, pilotId: 1 });
const CommandCooldown = mongoose.model('CommandCooldown', CommandCooldownSchema);

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
  driverOfTheDay: { type: Boolean, default: false },
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
  triggered  : { type: String, default: 'auto' }, // 'post_race' | 'scheduled' | 'manual' | 'player_action'
  // ── File d'attente paddock ─────────────────────────────────
  queued       : { type: Boolean, default: false },   // true = en attente de publication
  scheduledFor : { type: Date,    default: null  },   // heure de publication prévue
  queuedBy     : { type: String,  default: null  },   // discordId du joueur qui a déclenché l'action
});
NewsArticleSchema.index({ publishedAt: -1 });
NewsArticleSchema.index({ queued: 1, scheduledFor: 1 });
const NewsArticle = mongoose.model('NewsArticle', NewsArticleSchema);

// ── File d'attente paddock (in-memory) ────────────────────────
// Map<articleId (string) → timeoutId>
// Permet d'annuler un setTimeout en attente via admin_queue cancel
const paddockQueue = new Map();

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

// ── PilotRelation — Affinités inter-pilotes ───────────────
const PilotRelationSchema = new mongoose.Schema({
  pilotA   : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', required: true },
  pilotB   : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot', required: true },
  affinity : { type: Number, default: 0 },
  type     : { type: String, default: 'neutre' },
  history  : [{ event: String, delta: Number, date: Date, circuit: String, seasonYear: Number }],
  updatedAt: { type: Date, default: Date.now },
  // ── Tracking des moments marquants (anniversaires) ──────
  peakNegative   : { type: Number, default: 0 },
  peakNegativeAt : { type: Date, default: null },
  peakPositive   : { type: Number, default: 0 },
  peakPositiveAt : { type: Date, default: null },
  // ── Réaction en chaîne ──────────────────────────────────
  pendingReply   : { type: Boolean, default: false },
  pendingReplyCtx: { type: mongoose.Schema.Types.Mixed, default: null },
  // ── Cohabitation forcée ─────────────────────────────────
  sharedTeamSeasons: { type: Number, default: 0 },
});
PilotRelationSchema.index({ pilotA: 1, pilotB: 1 }, { unique: true });
const PilotRelation = mongoose.model('PilotRelation', PilotRelationSchema);

// ── TransferOffer ──────────────────────────────────────────
const TransferOfferSchema = new mongoose.Schema({
  teamId           : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  pilotId          : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  coinMultiplier   : { type: Number, default: 1.0 },
  primeVictoire    : { type: Number, default: 0 },
  primePodium      : { type: Number, default: 0 },
  salaireBase      : { type: Number, default: 100 },
  seasons          : { type: Number, default: 1 },
  // Statut proposé dans le contrat : 'numero1' = pilote leader, 'numero2' = second pilote
  // Le salaire proposé tient déjà compte de ce statut (numero1 ≈ +20%)
  driverStatus     : { type: String, enum: ['numero1', 'numero2', null], default: null },
  status           : { type: String, enum: ['pending','accepted','rejected','expired'], default: 'pending' },
  expiresAt        : Date,
});
const TransferOffer = mongoose.model('TransferOffer', TransferOfferSchema);

// ── BotConfig — Singleton de configuration persistante ────
// Un seul document (key='global') qui survit aux redémarrages.
// Stocke : intro vidéo URL, et tout futur réglage admin persistant.
const BotConfigSchema = new mongoose.Schema({
  key          : { type: String, default: 'global', unique: true },
  raceIntroUrl : { type: String, default: null },   // URL MP4 intro GP
  updatedAt    : { type: Date,   default: Date.now },
});
const BotConfig = mongoose.model('BotConfig', BotConfigSchema);

// ── Season ─────────────────────────────────────────────────
const SeasonSchema = new mongoose.Schema({
  year             : Number,
  status           : { type: String, enum: ['upcoming','active','transfer','finished'], default: 'upcoming' },
  regulationSet    : { type: Number, default: 1 },
  currentRaceIndex : { type: Number, default: 0 },
  // Mercato — timestamps persistants pour survivre aux redémarrages bot
  transferStartedAt : { type: Date, default: null },
  secondWaveSentAt  : { type: Date, default: null },
  gridRevealedAt    : { type: Date, default: null },
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

// ── Mapping nationalité → pays de GP à domicile ──────────
// Clé = emoji du drapeau (premier mot de la nationalité), valeurs = country[] des circuits
const HOME_GP_MAP = {
  '🇧🇭': ['Bahreïn'],
  '🇸🇦': ['Arabie Saoudite'],
  '🇦🇺': ['Australie'],
  '🇯🇵': ['Japon'],
  '🇨🇳': ['Chine'],
  '🇺🇸': ['États-Unis'],
  '🇲🇨': ['Monaco'],
  '🇨🇦': ['Canada'],
  '🇪🇸': ['Espagne'],
  '🇦🇹': ['Autriche'],
  '🇬🇧': ['Royaume-Uni'],
  '🇭🇺': ['Hongrie'],
  '🇧🇪': ['Belgique'],
  '🇳🇱': ['Pays-Bas'],
  '🇮🇹': ['Italie'],          // Emilia Romagna + Italian GP
  '🇦🇿': ['Azerbaïdjan'],
  '🇸🇬': ['Singapour'],
  '🇲🇽': ['Mexique'],
  '🇧🇷': ['Brésil'],
  '🇶🇦': ['Qatar'],
  '🇦🇪': ['Abu Dhabi'],
  // Nationalités sans GP direct — pas de home GP
  '🇫🇷': [],  '🇩🇪': [],  '🇨🇭': [],  '🇫🇮': [],  '🇵🇱': [],
  '🇵🇹': [],  '🇦🇷': [],  '🇨🇴': [],  '🇨🇮': [],  '🇨🇬': [],
  '🇸🇳': [],  '🇨🇲': [],  '🇲🇦': [],  '🇿🇦': [],
};

/**
 * Retourne true si le pilote court à son GP à domicile.
 * @param {Object} pilot — doc Pilot avec .nationality
 * @param {Object} race  — doc Race avec .country
 */
function isHomeGP(pilot, race) {
  if (!pilot?.nationality || !race?.country) return false;
  const flag = pilot.nationality.split(' ')[0];
  const homeCountries = HOME_GP_MAP[flag] || [];
  return homeCountries.some(c => race.country === c);
}

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
  SOFT  : { grip: 1.00, deg: 0.0024, emoji: '🔴', code: 'S', label: 'Soft'   }, // cliff ~lap 25
  MEDIUM: { grip: 0.99, deg: 0.0016, emoji: '🟡', code: 'M', label: 'Medium' }, // cliff ~lap 38
  HARD  : { grip: 0.98, deg: 0.0010, emoji: '⚪', code: 'H', label: 'Hard'   }, // cliff ~lap 60
  INTER : { grip: 0.99, deg: 0.0013, emoji: '🟢', code: 'I', label: 'Inter'  },
  WET   : { grip: 0.99, deg: 0.0008, emoji: '🔵', code: 'W', label: 'Wet'    },
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
// ── evalPilotPerf — évaluation RELATIVE de la performance pilote ─────────────
// Tient compte : budget/rang équipe, lastSeasonRank constructeur/pilote,
// points en saison, victoires, podiums, DNFs.
function evalPilotPerf(pilot, team, standing, teamRank, totalTeams, lastSeasonTeamRank) {
  const tpWins    = standing?.wins    || 0;
  const tpPts     = standing?.points  || 0;
  const tpPodiums = standing?.podiums || 0;
  const tpDnfs    = standing?.dnfs    || 0;
  const tpOvr     = overallRating(pilot);
  const budget    = team?.budget  || 80;
  const nTeams    = totalTeams    || 10;
  const rank      = teamRank      || Math.ceil(nTeams / 2);

  const isTopTeam  = rank <= 3 || budget >= 120;
  const isMidField = !isTopTeam && (rank <= 6 || budget >= 80);
  const isSmall    = !isTopTeam && !isMidField;

  const winTarget    = isTopTeam ? 3  : isMidField ? 1  : 0;
  const podiumTarget = isTopTeam ? 8  : isMidField ? 3  : 1;
  const ptsTarget    = isTopTeam ? 80 : isMidField ? 35 : 12;
  const dnfTolerance = 4; // seuil universel : 4+ DNF = problématique quel que soit l'équipe

  const seasonDelta      = lastSeasonTeamRank ? (lastSeasonTeamRank - rank) : 0;
  const progressingTeam  = seasonDelta >= 2;
  const regressingTeam   = seasonDelta <= -2;

  const winScore    = winTarget    > 0 ? (tpWins    / winTarget)    * 40 : Math.min(tpWins * 15, 40);
  const podiumScore = podiumTarget > 0 ? (tpPodiums / podiumTarget) * 25 : Math.min(tpPodiums * 8, 25);
  const ptsScore    = ptsTarget    > 0 ? (tpPts     / ptsTarget)    * 25 : Math.min(tpPts * 2, 25);
  // Pas de pénalité DNF dans le perfScore — 2-3 DNF/saison c'est normal
  let perfScore     = winScore + podiumScore + ptsScore;

  if (!isTopTeam && tpWins >= 1)    perfScore += 20;
  if (isSmall    && tpPodiums >= 1) perfScore += 15;
  if (progressingTeam)              perfScore += 8;
  if (regressingTeam)               perfScore -= 8;

  const isChamp    = perfScore >= 85 || (isTopTeam && tpWins >= 3);
  const isOverperf = !isChamp && (perfScore >= 55 || tpPts >= ptsTarget * 1.4);
  const isFlop     = perfScore < 20 || (tpDnfs >= 5 && tpPts < ptsTarget * 0.4); // ≥5 DNF ET très peu de points = flop
  const isSolid    = !isChamp && !isOverperf && !isFlop;
  const tier       = isChamp ? 'champion' : isOverperf ? 'overperf' : isSolid ? 'solid' : 'flop';

  return {
    tier, isChamp, isOverperf, isFlop, isSolid,
    winTarget, podiumTarget, ptsTarget,
    perfScore: Math.round(perfScore),
    isTopTeam, isMidField, isSmall,
    tpWins, tpPts, tpPodiums, tpDnfs, tpOvr,
    progressingTeam, regressingTeam,
  };
}

function ratingTier(r) {
  if (r >= 90) return { badge: '🟫', label: 'ICÔNE',          color: '#b07d26' };
  if (r >= 85) return { badge: '🟨', label: 'ÉLITE',          color: '#FFD700' };
  if (r >= 80) return { badge: '🟩', label: 'EXPERT',         color: '#00C851' };
  if (r >= 72) return { badge: '🟦', label: 'CONFIRMÉ',       color: '#0099FF' };
  if (r >= 64) return { badge: '🟥', label: 'INTERMÉDIAIRE',  color: '#CC4444' };
  return              { badge: '⬜', label: 'ROOKIE',          color: '#888888' };
}

// ============================================================
// 🎭  MOTEUR DE PERSONNALITES
// ============================================================
const ARCHETYPES = {
  guerrier        : { tone:'agressif',     ego:75, rivalryStyle:'hot_blooded',   pressStyle:'spontane',      teamChemistry:45 },
  icone           : { tone:'diplomatique', ego:85, rivalryStyle:'cold_war',       pressStyle:'mediatraining', teamChemistry:65 },
  rookie_ambitieux: { tone:'humble',       ego:40, rivalryStyle:'respect_mutuel', pressStyle:'spontane',      teamChemistry:70 },
  calculateur     : { tone:'froid',        ego:60, rivalryStyle:'indifference',   pressStyle:'mediatraining', teamChemistry:55 },
  bad_boy         : { tone:'sarcastique',  ego:70, rivalryStyle:'hot_blooded',    pressStyle:'spontane',      teamChemistry:35 },
  vieux_sage      : { tone:'ironique',     ego:55, rivalryStyle:'cold_war',       pressStyle:'fuyant',        teamChemistry:60 },
};

function assignRandomPersonality() {
  const keys = Object.keys(ARCHETYPES);
  const arch = keys[Math.floor(Math.random() * keys.length)];
  const a = ARCHETYPES[arch];
  return {
    archetype    : arch,
    tone         : a.tone,
    ego          : Math.max(10, Math.min(95, a.ego + Math.floor((Math.random()-0.5)*20))),
    rivalryStyle : a.rivalryStyle,
    pressStyle   : a.pressStyle,
    teamChemistry: Math.max(10, Math.min(90, a.teamChemistry + Math.floor((Math.random()-0.5)*20))),
    pressureLevel: 0,
    archetypeEvo : 0,
  };
}

function getRadioQuote(pilot, event) {
  const tone = pilot?.personality?.tone;
  if (!tone) return null;
  const Q = {
    overtake_success: {
      agressif    : ['HA ! C\'est MON tour !','Rien a faire contre ca.','Je LE SAVAIS.'],
      sarcastique  : ['Il est passe ou lui ?','Facile.','Ah. Sympa.'],
      froid        : ['Position acquise. Gap ?','Depassement confirme.','Bien. Rythme ?'],
      humble       : ['Incroyable ! On peut tenir ?','C\'etait chaud !','Je l\'ai eu !'],
      diplomatique : ['Parfait. Je gere.','Bien joue.','Propre. Merci.'],
      ironique     : ['Apres toutes ces annees...','Ca marche encore.','Je note ca.'],
    },
    dnf: {
      agressif    : ['C\'EST QUOI CA ?! NON !','Je vais TOUT CASSER.','CA FAIT MAL !'],
      sarcastique  : ['Parfait. Absolument parfait.','Je rentre. Bonne journee.'],
      froid        : ['Abandon confirme.','Dommage. On analyse.','Panne. Fin de course.'],
      humble       : ['Desole les gars, vraiment.','Je suis frustre pour l\'equipe.','On fera mieux.'],
      diplomatique : ['C\'est decevant. On verra ca ensemble.','Restons soudes.'],
      ironique     : ['C\'etait trop beau.','Je m\'y attendais.','La voiture a decide avant moi.'],
    },
    safety_car: {
      agressif    : ['SC ! ON PITE MAINTENANT !','Ne me laissez pas dehors !'],
      sarcastique  : ['SC. Comme prevu.','Quelle surprise.'],
      froid        : ['Safety Car. Decision undercut ?','SC deploye. Analyse ?'],
      humble       : ['SC ! On pit ?','Qu\'est-ce qu\'on fait ?'],
      diplomatique : ['SC. Je suis a vos ordres.','Votre appel.'],
      ironique     : ['SC. Qui a fait quoi cette fois ?','On refait la meme erreur ?'],
    },
    defending: {
      agressif    : ['Il ne passera PAS.','Il peut essayer tant qu\'il veut.'],
      sarcastique  : ['Il croit pouvoir passer la ?','Bonne chance.'],
      froid        : ['Defense optimale. Gap stable.','Je le controle.'],
      humble       : ['Il est rapide... je tiens ?','J\'essaie de le bloquer !'],
      diplomatique : ['Position maintenue.','Defense propre.'],
      ironique     : ['Il peut attendre 3 tours.','Je me repose.'],
    },
    win: {
      agressif    : ['C\'EST MOI !!! OUUUIIII !!!','INCROYABLE !!!'],
      sarcastique  : ['Bien sur.','Logique.','Ce n\'etait pas complique.'],
      froid        : ['Victoire. Merci a tous.','Course maitrisee.'],
      humble       : ['Oh mon dieu... MERCI !!!','Je n\'y crois pas !!'],
      diplomatique : ['Belle victoire d\'equipe. Merci.','Superbe travail collectif.'],
      ironique     : ['...Ah. C\'est fait.','Une de plus.'],
    },
  };
  const pool = Q[event]?.[tone];
  if (!pool?.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── genSocialMediaPost — adaptatif selon rang constructeur ──
// P10 pour l'écurie P15 constructeur = exploit. DNF pour le leader = catastrophe.
function genSocialMediaPost(pilot, team, result, allPilots, allTeams, constrStandings, seasonYear, ctx = {}) {
  const tone     = pilot?.personality?.tone     || 'diplomatique';
  const arch     = pilot?.personality?.archetype || 'guerrier';
  const pressure = pilot?.personality?.pressureLevel || 0;
  const source   = pick(['grid_social','speed_gossip','turbo_people','pl_celebrity']);
  const { pos, dnf, circuit, rival, rivalPos, champPos, rivalAffinity: ctxRivAff } = ctx;
  const isDnf    = dnf === true;
  const isWin    = pos === 1 && !isDnf;
  const isPodium = pos <= 3 && !isDnf;
  const cStandSorted  = [...(constrStandings||[])].sort((a,b) => b.points - a.points);
  const totalTeams    = cStandSorted.length || 10;
  const teamConstrIdx = team ? cStandSorted.findIndex(s => String(s.teamId) === String(team._id)) : -1;
  const teamConstrPos = teamConstrIdx >= 0 ? teamConstrIdx + 1 : null;
  const expectedPos   = teamConstrPos ? Math.min(15, Math.max(1, Math.round(teamConstrPos * 15 / totalTeams))) : 8;
  const isOverperform  = !isDnf && pos && teamConstrPos && pos < expectedPos - 2 && teamConstrPos > Math.ceil(totalTeams/2);
  const isUnderperform = !isDnf && pos && teamConstrPos && pos > expectedPos + 3 && teamConstrPos <= Math.ceil(totalTeams/2);
  const isChampDnf     = champPos === 1 && isDnf;
  const isChampOOPts   = champPos === 1 && !isDnf && pos > 10;
  const isBadResult    = isDnf || (pos && pos > 12 && !isOverperform);
  const rivalLost = rival && rivalPos != null && rivalPos > pos && !isDnf;
  const rivalWon  = rival && rivalPos != null && rivalPos < pos;
  const rivStyle  = pilot?.personality?.rivalryStyle;
  const POSTS = {
    win        : { guerrier:['Victoire. C\'est tout.','Pour ceux qui ont doute. #P1'], icone:['Une victoire de plus. L\'equipe a ete parfaite.','Resultat merite. #Champion'], rookie_ambitieux:['JE N\'Y CROIS PAS !! MERCI !!','P1 !! Incroyable weekend !!'], calculateur:['Victoire. Strategie parfaite.','Resultat conforme.'], bad_boy:['Lol. #next','Desole pas desole.'], vieux_sage:['Encore une. On finit jamais d\'apprendre.'] },
    dnf        : { guerrier:['NON. On revient. PLUS FORT.','C\'est la course. Mais ca fait MAL.'], icone:['Abandon decevant. Prochain GP.','Ce n\'est pas notre journee.'], rookie_ambitieux:['Tres frustrant... On s\'ameliore encore.','DNF dur. Mais on apprend.'], calculateur:['DNF. Donnees recueillies. Prochain.'], bad_boy:['Parfait. Juste parfait.','La voiture a decide. Moi j\'avais le rythme.'], vieux_sage:['Ca arrive.','Dommage.'] },
    podium     : { guerrier:[`P${pos}. On prend. Mais c\'est P1 qu\'il me faut.`], icone:[`P${pos}. Belle journee pour l\'equipe.`], rookie_ambitieux:[`PODIUM !!! P${pos} !!`,'Top 3 !!'], calculateur:[`P${pos}. Points importants.`], bad_boy:[`P${pos}. On sait qu\'on avait plus.`,'Top 3. Malgre tout.'], vieux_sage:[`P${pos}. Ce circuit est genereux parfois.`] },
    overperform: { guerrier:[`P${pos} et c\'est BIEN pour nous ! On grimpe.`], rookie_ambitieux:[`P${pos} !! Pour l\'ecurie c\'est enorme !!`], bad_boy:[`P${pos}. Surpris ?`,'On n\'etait pas censes etre la. Et pourtant.'], vieux_sage:[`P${pos}. Parfois la machine repond.`], calculateur:[`P${pos}. Bien au-dessus des projections.`], icone:[`P${pos}. L\'equipe a tout donne.`] },
    underperform:{ guerrier:['Ce n\'est pas acceptable. On se remet au travail.'], icone:[], bad_boy:['No comment.','Vous voulez mon avis ? Non ? Tant mieux.'], vieux_sage:[], calculateur:[], rookie_ambitieux:['Week-end difficile. Mais on apprend.'] },
    champ_dis  : { guerrier:['Pas de commentaire. On reviendra.'], icone:[], bad_boy:['Sympa. Vraiment.'], calculateur:[], vieux_sage:[], rookie_ambitieux:['C\'est ecrasant mais on se bat.'] },
    bad        : { guerrier:['C\'est pas ce resultat qui definit qui je suis.'], rookie_ambitieux:['Mauvais weekend. On revient.'], bad_boy:['Aucun commentaire.'], icone:[], calculateur:[], vieux_sage:[] },
  };
  let posts = [];
  if (isChampDnf||isChampOOPts) posts=POSTS.champ_dis[arch]||[];
  else if (isWin)           posts=POSTS.win[arch]||[];
  else if (isDnf)           posts=POSTS.dnf[arch]||[];
  else if (isPodium)        posts=POSTS.podium[arch]||[];
  else if (isOverperform)   posts=POSTS.overperform[arch]||[];
  else if (isUnderperform)  posts=POSTS.underperform[arch]||[];
  else if (isBadResult)     posts=POSTS.bad[arch]||[];
  if (isOverperform&&!isPodium&&!isWin) posts=[...posts,'Personne ne nous attendait la.'];
  if (pressure>=60&&(tone==='agressif'||tone==='sarcastique')&&Math.random()<0.3) posts=[...posts,'Le paddock parle. Moi je conduis.'];
  if (rival&&!isDnf) {
    const rivAff = (ctxRivAff !== undefined && ctxRivAff !== null) ? ctxRivAff : -10;
    const rivalHandle = '@'+rival.toLowerCase().replace(/\s+/g,'_');
    // Affinité positive (>= 30) : éloge public possible même en rivalité
    if (rivAff >= 30 && Math.random() < 0.45) {
      if (rivalLost) posts=[...posts,pick(['Bien joue '+rival+' aussi aujourd\'hui. Beau duel.','Grand respect pour '+rival+' ce week-end.','Toujours un plaisir de se battre proprement, '+rival+'.'])];
      else posts=[...posts,pick([rival+' meritait ca aujourd\'hui. Chapeau.','Bien joue '+rival+'. La prochaine fois c\'est moi.','Beau duel. Bravo '+rival+'.'])];
    } else if (rivAff < -50) {
      // Affinité très négative : ton acéré
      if (rivalLost&&rivStyle==='hot_blooded'&&Math.random()<0.6) posts=posts.map(p=>p+' '+rivalHandle+' 👀');
      if (rivalWon&&rivStyle==='hot_blooded'&&Math.random()<0.5) posts=[...posts,'Profites-en. Ca ne durera pas.'];
      if (rivalWon&&rivStyle==='cold_war') posts=[...posts,'Il y a des jours comme ca. Pas le dernier.'];
    } else {
      // Ton standard
      if (rivalLost&&rivStyle==='hot_blooded'&&Math.random()<0.5) posts=posts.map(p=>p+' '+rivalHandle+' 👀');
      if (rivalWon&&rivStyle==='hot_blooded'&&Math.random()<0.4) posts=[...posts,'Bien joue aujourd\'hui. On verra la prochaine fois. 👀'];
      if (rivalWon&&rivStyle==='cold_war') posts=[...posts,'Il y a des jours comme ca.'];
    }
  }
  if (!posts.length) return null;
  const text  = posts[Math.floor(Math.random()*posts.length)];
  const likes = Math.floor(Math.random()*2000)+100;
  const comms = Math.floor(Math.random()*400)+20;
  const handle = `@${pilot.name.toLowerCase().replace(/\s+/g,'_')}`;
  const headline = isWin ? `${handle} celebre sa victoire a ${circuit||'ce circuit'}`
    : isDnf ? `${handle} reagit a son abandon`
    : isPodium ? `${handle} sur le podium — la reaction`
    : isOverperform ? `${handle} apres une belle surprise a ${circuit||'ce circuit'}`
    : isUnderperform||isChampDnf||isChampOOPts ? `${handle} apres un resultat decevant`
    : `${handle} sort du silence apres ce GP`;
  const body = `📱 **${handle}**\n\n*"${text}"*\n\n❤️ ${likes.toLocaleString('fr-FR')} · 💬 ${comms.toLocaleString('fr-FR')} commentaires`
    + (pressure>=70?'\n\n*Le post a suscite une forte reaction dans le paddock.*':'');
  return { type:'social_media', source, headline, body, pilotIds:[pilot._id], teamIds:team?[team._id]:[], seasonYear };
}

async function updateAffinities(collisions, finalResults, allPilots, raceCircuit = null, raceYear = null) {
  // ── Lecture/écriture d'une relation avec historique ────────
  async function adj(idA, idB, delta, event, circuit = null, yr = null) {
    const [sA, sB] = [String(idA), String(idB)].sort();
    try {
      let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
      if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });
      rel.affinity = Math.max(-100, Math.min(100, rel.affinity + delta));
      rel.type = rel.affinity >= 60 ? 'amis'
               : rel.affinity >= 20 ? 'respect'
               : rel.affinity > -20 ? 'neutre'
               : rel.affinity > -60 ? 'tension'
               : 'ennemis';
      rel.updatedAt = new Date();
      // Tracking des pics (utilisé pour les articles anniversaire)
      if (rel.affinity < (rel.peakNegative || 0)) { rel.peakNegative = rel.affinity; rel.peakNegativeAt = new Date(); }
      if (rel.affinity > (rel.peakPositive || 0)) { rel.peakPositive = rel.affinity; rel.peakPositiveAt = new Date(); }
      const hEntry = { event, delta, date: new Date() };
      if (circuit) hEntry.circuit = circuit;
      if (yr)      hEntry.seasonYear = yr;
      rel.history.push(hEntry);
      if (rel.history.length > 30) rel.history = rel.history.slice(-30);
      await rel.save();
    } catch(e) { console.error('[affinity]', e.message); }
  }

  // ── Événements NÉGATIFS ────────────────────────────────────
  // Contact en course : -8 à -15 (agresseur → victime)
  for (const col of (collisions || [])) {
    const dmg = -(Math.floor(Math.random() * 8) + 8);
    await adj(col.attackerId, col.victimId, dmg, 'contact_course', raceCircuit, raceYear);
  }

  // Duel interne : le perdant souffre davantage si l'affrontement est répété
  const tm = new Map();
  for (const r of (finalResults || [])) {
    const p = allPilots.find(x => String(x._id) === String(r.pilotId));
    if (!p?.teamId) continue;
    const tid = String(p.teamId);
    if (!tm.has(tid)) tm.set(tid, []);
    tm.get(tid).push({ ...r, pilot: p });
  }
  for (const [, mb] of tm) {
    if (mb.length < 2) continue;
    mb.sort((a, b) => (a.dnf ? 99 : a.pos) - (b.dnf ? 99 : b.pos));
    if (!mb[0].dnf) {
      // Vérifier si les deux coéquipiers ont une relation déjà tendue
      const [sA, sB] = [String(mb[0].pilotId), String(mb[1].pilotId)].sort();
      const existingRel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
      // Tension existante → le duel interne empire légèrement, sinon neutre
      const duelDelta = (existingRel && existingRel.affinity < -20) ? -7 : -4;
      await adj(mb[0].pilotId, mb[1].pilotId, duelDelta, 'duel_interne', raceCircuit, raceYear);
    }
  }

  // ── Événements POSITIFS ────────────────────────────────────
  // Podium partagé : +5 à +8 selon si déjà bonne relation
  const pod = (finalResults || []).filter(r => !r.dnf && r.pos <= 3);
  for (let i = 0; i < pod.length; i++) {
    for (let j = i + 1; j < pod.length; j++) {
      const [sA, sB] = [String(pod[i].pilotId), String(pod[j].pilotId)].sort();
      const existingRel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
      // Si déjà amis/respect → le podium commun renforce encore
      const podDelta = (existingRel && existingRel.affinity >= 20) ? 8 : 5;
      await adj(pod[i].pilotId, pod[j].pilotId, podDelta, 'podium_partage', raceCircuit, raceYear);
    }
  }

  // Course propre entre rivaux déclarés sans contact → légère désescalade (-2 au lieu de rien)
  // ET légère montée positive si affinité déjà neutre/positive
  for (const p of allPilots) {
    if (!p.rivalId) continue;
    const rA = finalResults.find(r => String(r.pilotId) === String(p._id));
    const rB = finalResults.find(r => String(r.pilotId) === String(p.rivalId));
    if (!rA || !rB || rA.dnf || rB.dnf) continue;
    const hadContact = (collisions || []).some(c =>
      (String(c.attackerId) === String(p._id) && String(c.victimId) === String(p.rivalId)) ||
      (String(c.attackerId) === String(p.rivalId) && String(c.victimId) === String(p._id))
    );
    if (!hadContact) {
      // Course propre entre rivaux → légère désescalade de la haine
      await adj(p._id, p.rivalId, 2, 'duel_propre', raceCircuit, raceYear);
    }
  }

  // Coéquipiers qui finissent tous les deux dans le top 6 sans se toucher → cohésion
  for (const [, mb] of tm) {
    if (mb.length < 2) continue;
    const [a, b] = mb;
    if (a.dnf || b.dnf) continue;
    if (a.pos > 6 || b.pos > 6) continue;
    const hadContact = (collisions || []).some(c =>
      (String(c.attackerId) === String(a.pilotId) && String(c.victimId) === String(b.pilotId)) ||
      (String(c.attackerId) === String(b.pilotId) && String(c.victimId) === String(a.pilotId))
    );
    if (!hadContact) await adj(a.pilotId, b.pilotId, 3, 'double_top6_equipe', raceCircuit, raceYear);
  }
}

async function evolvePersonalityDiscreetly(pilot,standing,racesPlayed){
  if(!pilot?.personality?.archetype)return;
  const p=pilot.personality;
  const wins=standing?.wins||0,dnfs=standing?.dnfs||0,pts=standing?.points||0;
  // Rang constructeur approx. pour le ton (calculé à partir de constrStandings si disponible)
  const _spRank  = constrStandings ? ([...constrStandings].sort((a,b)=>b.points-a.points).findIndex(s=>String(s.teamId)===String(team._id))+1)||5 : 5;
  const _spNT    = constrStandings ? constrStandings.length : 10;
  const _spPerf  = evalPilotPerf(pilot, team, standing, _spRank, _spNT, null);
  // Override des seuils : 'beaucoup de victoires' est relatif à l'équipe
  const spWinHigh   = wins >= Math.max(2, _spPerf.winTarget);
  const spDnfHigh   = dnfs >= 5; // ≥5 DNF = signal négatif
  const spIsUnder   = _spPerf.isSmall || _spPerf.isMidField;
  const upd={};
  let pd=0;
  if(dnfs>=3)pd+=15;if(wins>=3)pd-=15;
  if(pts<5&&racesPlayed>=4)pd+=10;if(wins>=1)pd-=8;
  const np=Math.max(0,Math.min(100,(p.pressureLevel||0)+pd));
  if(np!==(p.pressureLevel||0))upd['personality.pressureLevel']=np;
  let evo=p.archetypeEvo||0;
  if(p.archetype==='rookie_ambitieux'&&wins>=3){evo++;if(evo>=5){const na=Math.random()<0.5?'guerrier':'icone';const nd=ARCHETYPES[na];Object.assign(upd,{'personality.archetype':na,'personality.tone':nd.tone,'personality.rivalryStyle':nd.rivalryStyle,'personality.pressStyle':nd.pressStyle,'personality.archetypeEvo':0});}else upd['personality.archetypeEvo']=evo;}
  if(p.archetype==='guerrier'&&dnfs>=5){evo++;if(evo>=4)Object.assign(upd,{'personality.archetype':'vieux_sage','personality.tone':'ironique','personality.archetypeEvo':0});else upd['personality.archetypeEvo']=evo;}
  if(p.archetype==='bad_boy'&&wins>=5){evo++;if(evo>=6)Object.assign(upd,{'personality.tone':'diplomatique','personality.pressStyle':'mediatraining','personality.archetypeEvo':0});else upd['personality.archetypeEvo']=evo;}
  if(Object.keys(upd).length>0)try{await Pilot.findByIdAndUpdate(pilot._id,{$set:upd});}catch(e){}
}

async function postRacePersonalityHooks(race,finalResults,raceCollisions,allPilots,allTeams,allConstrStandings,season,channel){
  try{
    await updateAffinities(raceCollisions,finalResults,allPilots,race?.circuit||null,season?.year||null);
    if(channel){
      const top3=[...finalResults].filter(r=>!r.dnf).sort((a,b)=>a.pos-b.pos).slice(0,3);
      for(const r of top3){
        const pilot=allPilots.find(p=>String(p._id)===String(r.pilotId));
        if(!pilot?.personality)continue;
        const q=getRadioQuote(pilot,r.pos===1?'win':'defending');
        if(q&&Math.random()<0.65){await sleep(2000);try{await channel.send(`📻 *Radio ${pilot.name} :* ***"${q}"***`);}catch(e){}}
      }
    }
    const standingsSeason=await Standing.find({seasonId:season._id});
    const doneRaces=await Race.countDocuments({seasonId:season._id,status:'done'});
    for(const pilot of allPilots){const standing=standingsSeason.find(s=>String(s.pilotId)===String(pilot._id));try{await evolvePersonalityDiscreetly(pilot,standing,doneRaces);}catch(e){}}
    const constrS=allConstrStandings||await ConstructorStanding.find({seasonId:season._id});
    const cands=[...finalResults].sort(()=>Math.random()-0.5).slice(0,5);
    let posted=0;
    for(const r of cands){
      if(posted>=2)break;
      const pilot=allPilots.find(p=>String(p._id)===String(r.pilotId));
      const team=allTeams.find(t=>String(t._id)===String(pilot?.teamId));
      if(!pilot?.personality)continue;
      if(Math.random()<0.55){
        const rival=pilot.rivalId?allPilots.find(p=>String(p._id)===String(pilot.rivalId)):null;
        const rivRes=rival?finalResults.find(rr=>String(rr.pilotId)===String(rival._id)):null;
        const allStSorted=[...standingsSeason].sort((a,b)=>b.points-a.points);
        const champPos=allStSorted.findIndex(s=>String(s.pilotId)===String(pilot._id))+1||null;
        // Récupérer l'affinité réelle avec le rival pour adapter le ton du social post
        let socialRivAffinity = null;
        if (rival) {
          try {
            const [sA,sB]=[String(pilot._id),String(rival._id)].sort();
            const relDoc=await PilotRelation.findOne({pilotA:sA,pilotB:sB});
            if(relDoc) socialRivAffinity=relDoc.affinity;
          } catch(e) {}
        }
        const ctx={pos:r.pos,dnf:r.dnf,circuit:race.circuit,rival:rival?.name,rivalPos:rivRes?.pos,champPos,rivalAffinity:socialRivAffinity};
        const ad=genSocialMediaPost(pilot,team,r,allPilots,allTeams,constrS,season.year,ctx);
        if(ad&&channel){
          await sleep(randInt(15000,45000));
          try{const art=await NewsArticle.create({...ad,triggered:'post_race',publishedAt:new Date()});await publishNews(art,channel);posted++;}catch(e){console.error('Social post:',e.message);}
        }
      }
    }
  }catch(e){console.error('[postRacePersonalityHooks]',e.message);}
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
function calcLapTime(pilot, team, tireCompound, tireWear, weather, trackEvo, gpStyle, position, scCooldown = 0, homeGPF = 1.0) {
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

  // ── Forme récente — influence légère mais visible ─────────
  // recentFormScore : -1.0 (série de DNFs) → +1.0 (série de victoires)
  // Max ±220ms/tour — perceptible sur 50 tours (~11s d'écart en fin de course)
  const formScore = pilot.recentFormScore || 0;
  const formF = 1 - (formScore * 0.0024);

  // Pneus — dégradation linéaire avec légère accélération après 70% de vie utile
  const tireData = TIRE[tireCompound];
  if (!tireData) return 90_000;
  // ── Différentiel amplifié — gestionPneus 80 vs 40 = ~25% de dégradation en moins ──
  // carTireBonus  : max ±0.35 selon conservationPneus de la voiture
  // pilotTireBonus: max ±0.28 selon gestionPneus du pilote — c'est lui qui fait la différence
  const carTireBonus   = Math.max(-0.35, Math.min(0.35, (team.conservationPneus - 70) / 70 * 0.35));
  const pilotTireBonus = Math.max(-0.28, Math.min(0.28, (pilot.gestionPneus - 50) / 50 * 0.28));
  const effectiveDeg   = Math.max(0.0001, tireData.deg * (1 - carTireBonus - pilotTireBonus));
  // tireLifeRef = durée de vie nominale par compound (tours avant cliff)
  // Cohérent avec wornThresholdFor : SOFT~20, MEDIUM~32, HARD~48
  const tireLifeBase = tireCompound === 'SOFT' ? 20 : tireCompound === 'HARD' ? 48 : 32;
  const tireLifeRef  = tireLifeBase * (1 + carTireBonus * 0.5 + pilotTireBonus * 0.5);
  const wearRatio    = Math.min(tireWear / Math.max(tireLifeRef, 1), 2.0);
  // Cliff progressif : linéaire jusqu'à 70% de vie, puis accélération ×1.8 au-delà
  // (réduit de ×3.5 à ×1.8 pour éviter des pertes de 5+ places en 1 seul tour)
  const cliffFactor  = wearRatio < 0.7 ? 1.0 : 1.0 + (wearRatio - 0.7) * 1.3;
  // Cap à 0.046 : max ~4.1s de perte par tour sur une voiture en fin de vie de pneu
  // Réaliste F1 : un pilote sur pneus à bout perd 1-4s/tour, pas 10-16s
  const wearPenalty  = Math.min(0.022, tireWear * effectiveDeg * cliffFactor);
  const tireF        = (1 + wearPenalty) / tireData.grip;

  // Dirty air — pénalité ~0.1s max sur circuit mixte, jusqu'à ~0.4s sur urbain
  // Les rues étroites rendent le suivi très difficile : peu d'espaces pour dépasser,
  // flux d'air très perturbé par les bâtiments, pas de DRS efficace.
  let dirtyAirF = 1.0;
  // Fond de peloton : dirty air amplifié (trafic dense, dépassements difficiles)
  const backmarkerMult = (position >= 12) ? 1.5 : (position >= 8) ? 1.25 : 1.0;
  if (position > 1) {
    const baseDAMultiplier = gpStyle === 'urbain' ? 3.5   // rues étroites — suivi très coûteux
                           : gpStyle === 'technique' ? 1.8  // virages lents — difficile à suivre
                           : 1.0;
    const dirtyAirPenalty = (100 - team.dirtyAir) / 100 * 0.001 * baseDAMultiplier;
    const daRandom = scCooldown > 0 ? Math.random() * 0.3 : Math.random();
    dirtyAirF = 1 + dirtyAirPenalty * daRandom * backmarkerMult;
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

  // Penalite compound inadapte a la meteo (realiste : slick sous pluie = desastre)
  const slickInWet  = ['SOFT','MEDIUM','HARD'].includes(tireCompound) && weather === 'WET';
  const slickInInter = ['SOFT','MEDIUM','HARD'].includes(tireCompound) && weather === 'INTER';
  const wetInDry    = ['WET','INTER'].includes(tireCompound) && (weather === 'DRY' || weather === 'HOT');
  const mismatchF   = slickInWet ? 1.10 : slickInInter ? 1.04 : wetInDry ? 1.06 : 1.0;
  return Math.round(BASE * carF * pilotF * specF * formF * tireF * dirtyAirF * trackF * randF * weatherF * mismatchF * homeGPF);
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

// ─── Format d'écart intelligent selon la taille ──────────
// fmtGap(ms)    : prend des millisecondes
// fmtGapSec(s)  : prend des secondes
// < 1s   →  847ms           (combat serré)
// 1–9s   →  4.2s            (écart lisible en dixième)
// ≥ 10s  →  +28s            (grand écart — précision inutile)
function fmtGap(ms, { prefix = true } = {}) {
  if (ms == null || !isFinite(ms)) return '—';
  const abs  = Math.abs(ms);
  const sign = prefix && ms >= 0 ? '+' : '';
  if (abs < 1000)  return `${sign}${Math.round(abs)}ms`;
  if (abs < 10000) return `${sign}${(abs / 1000).toFixed(1)}s`;
  return `${sign}${Math.round(abs / 1000)}s`;
}
function fmtGapSec(s, opts = {}) {
  return fmtGap(s * 1000, opts);
}

// ─── Durée de vie des pneus (réaliste F1) ─────────────────
// SOFT  : ~18-25 tours avant le cliff
// MEDIUM: ~28-38 tours avant le cliff
// HARD  : ~40-55 tours avant le cliff
// Ces valeurs sont des seuils d'usure (tireWear = tours sur ces pneus)
// Modifiées par la conservationPneus de la voiture et gestionPneus du pilote
// ⚠️  Différentiel amplifié — un pilote gestionPneus 80 tient vraiment ~8 tours de plus
//     qu'un pilote à 40 sur le même compound. La stat doit être visible en course.
function wornThresholdFor(tireCompound, team, pilot) {
  const base = tireCompound === 'SOFT' ? 20 : tireCompound === 'HARD' ? 48 : 32; // MEDIUM=32
  // Voiture : conservationPneus 70 = neutre. +/- 0.22 tours par point → max ±6.6 tours
  const carBonus   = (team.conservationPneus  - 70) * 0.22;
  // Pilote : gestionPneus 50 = neutre. +/- 0.20 tours par point → max ±10 tours (gros différentiel)
  const pilotBonus = (pilot.gestionPneus      - 50) * 0.20;
  return Math.max(8, base + carBonus + pilotBonus);
}

function shouldPit(driver, lapsRemaining, gapAhead, totalLaps, scActive = false, currentLap = 0) {
  const { tireWear, tireCompound, pilot, team, tireAge, pitStops, pitStrategy, overcutMode } = driver;

  // ── Pit sous SC — logique smart ─────────────────
  if (scActive && lapsRemaining > 6 && (pitStops || 0) < 3) {
    // Anti double-pit : jamais piter 2 tours consécutifs sous SC
    if (currentLap > 0 && (driver.lastPitLap || 0) > 0 && currentLap - driver.lastPitLap < 2) {
      return { pit: false, reason: null };
    }
    const worn    = wornThresholdFor(tireCompound, team, pilot);
    const wornPct = tireWear / worn;
    const lapAge  = tireAge || 0;
    // Pneus quasi neufs (< 8 tours) -> PAS de pit SC, ca detruirait la strategie
    if (tireAge !== 99 && lapAge < 8) return { pit: false, reason: null };
    // Pneus tres uses (>=70% du seuil) -> opp SC a ne pas rater : 92%
    if (wornPct >= 0.70) {
      if (Math.random() < 0.92) return { pit: true, reason: 'sc_opportunity' };
    }
    // Pneus moderement uses (>=40%) ET pit encore necessaire -> bonne fenetre
    const stillNeedToStop = (pitStrategy === 'two_stop' && (pitStops || 0) < 2) || (pitStops === 0);
    if (wornPct >= 0.40 && stillNeedToStop) {
      if (Math.random() < 0.62) return { pit: true, reason: 'sc_opportunity' };
    }
    return { pit: false, reason: null };
  }

  // Minimum de tours sur les pneus (sauf réparation forcée via tireAge=99)
  if (tireAge !== 99) {
    const minLapsOnTire = pitStops === 0 ? 10 : 6;
    if ((tireAge || 0) < minLapsOnTire) return { pit: false, reason: null };
  }

  // ── Dernier recours : fin de course et jamais pité ──────────
  // Règle F1 : obligation d'utiliser 2 compounds → forcer un pit si jamais arrêté
  // Déclenchement dès lapsRemaining <= 18 pour éviter les pits surprise à 5 tours de la fin
  if ((pitStops || 0) === 0 && lapsRemaining <= 18 && lapsRemaining > 8) {
    const forcedChance = 0.20 + (18 - lapsRemaining) * 0.08; // monte de 20% à ~100% sur les 12 derniers tours
    if (Math.random() < forcedChance) return { pit: true, reason: 'forced_compound' };
  }
  // Ultime filet : si on arrive au tour -8 sans jamais pité, pit systématique
  if ((pitStops || 0) === 0 && lapsRemaining <= 8) return { pit: true, reason: 'forced_compound' };

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
// reliabilityMalus : multiplicateur additionnel sur reliabF (ex: 0.15 = +15% de risque mécanique)
//                    Calculé depuis la chimie d'écurie (mécaniciens démotivés)
function checkIncident(pilot, team, lap = 1, totalLaps = 50, reliabilityMalus = 0) {
  const roll = Math.random();

  // ── Fiabilité mécanique progressive ──────────────────────────────────────
  // Tours 1-5  : seulement les défauts de conception graves (×0.12)
  //              → Un problème en tour 2 = vrai bug de conception, ultra-rare
  // Tours 6-15 : rodage, échauffement, risque modéré (×0.55)
  // Tours 16+  : accumulation d'usure — plus la voiture roule, plus elle peut lâcher
  //              Facteur linéaire de 0.70 (T16) → 1.20 (dernier tour)
  //              Une voiture peu fiable peut donc craquer en fin de course
  const lapProgress = Math.max(0, Math.min(1, (lap - 15) / Math.max(1, totalLaps - 15)));
  const lapMultiplier = lap <= 5  ? 0.12
                      : lap <= 15 ? 0.55
                      : 0.70 + lapProgress * 0.50;

  // reliabilityMalus appliqué sur la probabilité mécanique uniquement (mécaniciens, pas les pilotes)
  const reliabF  = (100 - team.refroidissement) / 100 * 0.007 * lapMultiplier * (1 + reliabilityMalus);
  const crashF   = (((100 - pilot.controle) / 100 * 0.0004) + ((100 - pilot.reactions) / 100 * 0.0003)) * lapMultiplier;
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

  // ── Forme par session : pilotes forts = moins volatile, faibles = plus aléatoire ──
  // Un pilote avec de bonnes stats quali (freinage+controle) fluctue peu (±200ms max)
  // Un pilote moyen peut perdre/gagner jusqu'à ±650ms
  function makeSessionForm() {
    return new Map(pilots.map(p => {
      const qualiStr = ((p.freinage || 50) + (p.controle || 50)) / 2; // 0-100
      // Plus la stat est haute, plus la variance est réduite
      // Stat 80+ → ±200ms | Stat 50 → ±450ms | Stat 30 → ±650ms
      const maxSwing = Math.round(700 - qualiStr * 5); // 700 - 80*5 = 300 … 700 - 30*5 = 550
      return [String(p._id), randInt(-maxSwing, maxSwing)];
    }));
  }

  // ── Temps de base pour une session donnée ────────────────
  // Le temps de base est recalculé à chaque session — pas de plancher hérité
  function baseTime(pilot, team, trackEvoBonus, sessionForm) {
    const base = calcQualiTime(pilot, team, weather, race.gpStyle);
    const form = sessionForm.get(String(pilot._id)) || 0;
    return base - trackEvoBonus + form;
  }

  // ── Tenter un tour : tire un temps autour du base ────────
  // best = meilleur temps de CE run (Infinity si aucun tour propre encore)
  // yellowFlag : 55% de chance d'annuler le tour
  function tryLap(pilot, team, best, trackEvoBonus, yellowFlag, sessionForm) {
    if (yellowFlag && Math.random() < 0.55) return { time: Infinity, aborted: true };
    if (Math.random() < 0.04) return { time: Infinity, aborted: true }; // trafic / erreur pilote
    const raw = baseTime(pilot, team, trackEvoBonus, sessionForm) + randInt(-350, 350);
    const improved = raw < best;
    return { time: improved ? raw : best, raw, aborted: false, improved };
  }

  // ─────────────────────────────────────────────────────────
  // Q1 — tous les pilotes, session indépendante
  // Track evo croissante : 2ème tentative bénéficie d'un circuit plus gommé
  // ─────────────────────────────────────────────────────────
  const q1Form = makeSessionForm();
  let q1State = pilots.map(pilot => {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) return null;

    const evo1 = randInt(0, 200);    // début de session, piste peu gommée
    const evo2 = randInt(150, 350);  // 2ème run, piste améliorée
    const r1 = tryLap(pilot, team, Infinity, evo1, false, q1Form);
    const r2 = tryLap(pilot, team, r1.aborted ? Infinity : r1.time, evo2, false, q1Form);

    const bothAborted = r1.aborted && r2.aborted;
    // Si les 2 tours sont annulés → temps de secours pénalisé
    const bestTime = bothAborted
      ? baseTime(pilot, team, 0, q1Form) + randInt(600, 1400)
      : Math.min(r1.aborted ? Infinity : r1.time, r2.aborted ? Infinity : r2.time);

    return {
      pilot, team,
      // q1Time = temps canonique pour l'affichage Q1 (pas réutilisé en Q2)
      q1Time  : bestTime,
      time    : bestTime,
      r1      : r1.aborted ? null : r1.raw,
      r2      : r2.aborted ? null : r2.raw,
      abortedLaps: (r1.aborted ? 1 : 0) + (r2.aborted ? 1 : 0),
      improved: !r1.aborted && !r2.aborted && r2.raw < r1.raw,
    };
  }).filter(Boolean);
  q1State.sort((a, b) => a.time - b.time);

  // Événements drama Q1
  const q1Events = [];
  const doubleAbort = q1State.find(s => s.abortedLaps === 2);
  if (doubleAbort) q1Events.push({ type: 'double_abort', pilot: doubleAbort });

  const cutQ1    = q1State[q2Size - 1];
  const firstOut = q1State[q2Size];
  if (cutQ1 && firstOut) {
    const gap = (firstOut.time - cutQ1.time) / 1000;
    if (gap > 0 && gap < 0.150) q1Events.push({ type: 'thriller_q1', gap, safe: cutQ1, elim: firstOut });
  }
  // Pilote favori surpris (était dans le top 5 sur le papier mais éliminé)
  const q1Eliminated = q1State.slice(q2Size);
  const upsetQ1 = q1Eliminated.find(s => {
    const ov = (s.pilot.depassement + s.pilot.freinage + s.pilot.controle) / 3;
    return ov >= 65;
  });
  if (upsetQ1) q1Events.push({ type: 'upset_q1', pilot: upsetQ1 });

  // ─────────────────────────────────────────────────────────
  // Q2 — uniquement les qualifiés Q1, SESSION ENTIÈREMENT NOUVELLE
  // Nouvelle forme aléatoire → les classements peuvent se redistribuer
  // Pas de plancher Q1 : un pilote P1 en Q1 peut se retrouver P4 en Q2
  // ─────────────────────────────────────────────────────────
  const q2Candidates = q1State.slice(0, q2Size);

  const yellowFlagQ2       = Math.random() < 0.30;
  const yellowFlagPilotQ2  = yellowFlagQ2 ? pick(q2Candidates) : null;

  const q2Form = makeSessionForm(); // nouvelle forme → ± différente de Q1

  let q2State = q2Candidates.map(s => {
    const evo1 = randInt(200, 380);  // piste plus gommée qu'en Q1
    const evo2 = randInt(300, 500);
    const isYellow = yellowFlagQ2 && (Math.random() < 0.5);

    // ── CLEF : on repart de Infinity, pas du temps Q1 ──
    const r1 = tryLap(s.pilot, s.team, Infinity, evo1, isYellow, q2Form);
    const r2 = tryLap(s.pilot, s.team, r1.aborted ? Infinity : r1.time, evo2, false, q2Form);

    const bothAborted = r1.aborted && r2.aborted;
    const bestTime = bothAborted
      ? baseTime(s.pilot, s.team, 0, q2Form) + randInt(400, 1000)
      : Math.min(r1.aborted ? Infinity : r1.time, r2.aborted ? Infinity : r2.time);

    // Calcule delta Q1→Q2 (informatif, peut être positif = pilote moins bien)
    const deltaVsQ1 = bestTime - s.q1Time;

    return {
      pilot     : s.pilot,
      team      : s.team,
      q1Time    : s.q1Time,   // conservé pour affichage comparatif
      q2Time    : bestTime,
      time      : bestTime,   // temps de référence pour le tri et la grille finale
      r1        : r1.aborted ? null : r1.raw,
      r2        : r2.aborted ? null : r2.raw,
      improved  : !r1.aborted && !r2.aborted && r2.raw < r1.raw,
      lostLapToYellow : isYellow && r1.aborted,
      deltaVsQ1,
    };
  });
  q2State.sort((a, b) => a.time - b.time);

  const q2Events = [];
  if (yellowFlagPilotQ2) q2Events.push({ type: 'yellow_flag', trigger: yellowFlagPilotQ2 });

  const cutQ2      = q2State[q3Size - 1];
  const firstOutQ2 = q2State[q3Size];
  if (cutQ2 && firstOutQ2) {
    const gap = (firstOutQ2.time - cutQ2.time) / 1000;
    if (gap > 0 && gap < 0.120) q2Events.push({ type: 'thriller_q2', gap, safe: cutQ2, elim: firstOutQ2 });
    const lastGasp = q2State.find((s, i) => i < q3Size && s.improved);
    if (lastGasp) q2Events.push({ type: 'last_gasp_q2', pilot: lastGasp });
  }
  const yellowVictim = q2State.find((s, i) => i >= q3Size && s.lostLapToYellow);
  if (yellowVictim) q2Events.push({ type: 'yellow_victim', pilot: yellowVictim });

  // Pilote qui régresse fortement en Q2 (deltaVsQ1 > +0.4s) — drama
  const regression = q2State.find((s, i) => i >= q3Size && s.deltaVsQ1 > 400);
  if (regression) q2Events.push({ type: 'regression_q2', pilot: regression, delta: (regression.deltaVsQ1 / 1000).toFixed(3) });

  // Pilote qui grimpe (était proche de l'élimination en Q1, maintenant dans le top)
  const q2Eliminated = q2State.slice(q3Size);

  // ─────────────────────────────────────────────────────────
  // Q3 — les q3Size meilleurs de Q2, SESSION ENTIÈREMENT NOUVELLE
  // Pression max, piste au pic de grip, variance réduite (pilotes concentrés)
  // Résultats indépendants de Q2 — nouveaux leaders possibles
  // ─────────────────────────────────────────────────────────
  const q3Candidates = q2State.slice(0, q3Size);

  const redFlagQ3     = Math.random() < 0.15;
  const redFlagMoment = redFlagQ3 ? randInt(1, q3Size - 1) : -1;

  const q3Form = makeSessionForm(); // encore une nouvelle forme

  let q3State = q3Candidates.map((s, idx) => {
    const evo1 = randInt(350, 550);  // piste au maximum du grip
    const evo2 = randInt(450, 650);
    const affectedByRed = redFlagQ3 && idx >= redFlagMoment;

    // ── CLEF : repart de Infinity, pas du temps Q2 ──
    const r1 = tryLap(s.pilot, s.team, Infinity, evo1, affectedByRed, q3Form);
    const r2 = tryLap(s.pilot, s.team, r1.aborted ? Infinity : r1.time, evo2, false, q3Form);

    const bothAborted = r1.aborted && r2.aborted;
    const bestTime = bothAborted
      ? baseTime(s.pilot, s.team, 0, q3Form) + randInt(300, 800)
      : Math.min(r1.aborted ? Infinity : r1.time, r2.aborted ? Infinity : r2.time);

    return {
      pilot     : s.pilot,
      team      : s.team,
      q1Time    : s.q1Time,
      q2Time    : s.q2Time,
      q3Time    : bestTime,
      time      : bestTime,
      r1q3      : r1.aborted ? null : r1.raw,
      r2q3      : r2.aborted ? null : r2.raw,
      improved  : !r1.aborted && !r2.aborted && r2.raw < r1.raw,
      abortedByRed : affectedByRed && r1.aborted,
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
  if (q3State[0] && q3State[1]) {
    const poleGap = (q3State[1].time - q3State[0].time) / 1000;
    if (poleGap > 0 && poleGap < 0.05)
      q3Events.push({ type: 'photo_finish_pole', gap: poleGap, pole: q3State[0], second: q3State[1] });
    else if (poleGap > 0.6)
      q3Events.push({ type: 'dominant_pole', gap: poleGap, pole: q3State[0] });
  }

  // ── Grille finale : Q3 trié + Q2 éliminés triés + Q1 éliminés triés ──
  const allSorted = [...q3State, ...q2Eliminated, ...q1Eliminated];
  const finalGrid = allSorted.map((s, i) => ({
    pilotId   : s.pilot._id,
    pilotName : s.pilot.name,
    teamName  : s.team.name,
    teamEmoji : s.team.emoji,
    time      : s.time,    // temps de la dernière session participée
    q1Time    : s.q1Time,
    q2Time    : s.q2Time   || null,
    q3Time    : s.q3Time   || null,
    improved  : s.improved,
    segment   : i < q3Size ? 'Q3' : i < q2Size ? 'Q2' : 'Q1',
  }));

  return {
    grid        : finalGrid,
    weather,
    q3Size, q2Size,
    drama       : { q1: q1Events, q2: q2Events, q3: q3Events },
    q1State, q2State, q3State,
    q1Eliminated, q2Eliminated,
    yellowFlagQ2 : yellowFlagPilotQ2,
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
function collisionDescription(attacker, victim, lap, attackerDnf, victimDnf, damage, areRivals = false, rivalHeat = 0) {
  const a  = `**${attacker.team.emoji}${attacker.pilot.name}**`;
  const v  = `**${victim.team.emoji}${victim.pilot.name}**`;
  // Suffix de rivalité : amplifie le drama selon l'intensité de la rivalité
  const rivalSuffix = areRivals ? (
    rivalHeat >= 60
      ? pick([
          `\n  🔴 ***La rivalité s'embrase — encore eux, encore un contact. Le paddock n'en revient pas.***`,
          `\n  💥 ***${attacker.pilot.name} vs ${victim.pilot.name} — la haine sur la piste. La FIA ne pourra plus ignorer ce dossier.***`,
          `\n  🚨 ***Rivalité hors de contrôle — ce contact va faire des vagues bien au-delà de ce GP.***`,
        ])
      : rivalHeat >= 30
        ? pick([
            `\n  ⚔️ *Encore eux. ${attacker.pilot.name} et ${victim.pilot.name} se retrouvent — et ça frotte encore une fois.*`,
            `\n  📌 *La FIA prend note : nouveau contact entre les deux rivaux. Le dossier s'alourdit.*`,
            `\n  ⚔️ *Le compteur monte entre ${attacker.pilot.name} et ${victim.pilot.name}. Ce n'est pas fini.*`,
          ])
        : `\n  ⚔️ *Contact entre rivaux — la tension entre ${attacker.pilot.name} et ${victim.pilot.name} monte d'un cran.*`
  ) : '';

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
    return intro + consequence + rivalSuffix;
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
  return pick(intros) + consequence + rivalSuffix;
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
      `🟢 **T${lap}** — Course relancée ! Tout le monde cherche son rythme — l'attaque viendra dans quelques tours.`,
      `🟢 **T${lap}** — Relance propre. Les ingénieurs transmettent les consignes — qui va attaquer en premier ?`,
      `🟢 **T${lap}** — Le peloton s'étire à nouveau. Les pilotes poussent progressivement — la vraie course reprend.`,
      `🟢 **T${lap}** — Zones de DRS réactivées. Les stratèges soufflent... pour l'instant.`,
    ]);
  }

  // ── Sous SC/VSC : commentaire spécifique ───────────────
  if (scState.state === 'SC') {
    const top4 = ranked.slice(0,5).map(d => `${d.team.emoji}**${d.pilot.name}**`).join(' · ');
    lines.push(pick([
      `🚨 Le peloton roule en file derrière la Safety Car... ${top4} — les écuries calculent la fenêtre de pit stop.`,
      `🚨 La course est gelée. Les stands s'activent — arrêter maintenant ou attendre la reprise ?`,
      `🚨 Safety Car en piste. Les gaps se réduisent — au restart, ce sera une autre course.`,
      `🚨 Tout le monde derrière la Safety Car. Les pilotes gardent leurs pneus au chaud et attendent.`,
      `🚨 SC toujours en piste. ${ranked[0].team.emoji}**${ranked[0].pilot.name}** conserve la tête, mais tout peut changer à la relance.`,
    ]));
    return pick(lines);
  }
  if (scState.state === 'VSC') {
    lines.push(pick([
      `🟡 VSC en cours — tout le monde roule au delta. Impossible d'attaquer ou de défendre.`,
      `🟡 Virtual Safety Car actif. Les gaps se figent — les ingénieurs préparent la stratégie pour la reprise.`,
      `🟡 Drapeaux jaunes partout — les pilotes lèvent le pied. Reprise imminente.`,
    ]));
    return pick(lines);
  }

  // ── Gaps en tête — drama si serré ───────────────────────
  if (second) {
    const gapTop = (second.totalTime - leader.totalTime) / 1000;
    if (gapTop < 0.3) {
      lines.push(pick([
        `***👀 ${second.team.emoji}${second.pilot.name} DANS LE DRS !!! ${fmtGapSec(gapTop, {prefix:false})} — LA BOMBE VA EXPLOSER !!!***`,
        `***🔥 ${fmtGapSec(gapTop, {prefix:false})} !!! ${second.team.emoji}${second.pilot.name} colle aux roues de ${leader.team.emoji}${leader.pilot.name} — ÇA VA PASSER OU ÇA VA CASSER !!!***`,
        `***⚡ INCROYABLE !*** ${second.team.emoji}**${second.pilot.name}** est à **${fmtGapSec(gapTop, {prefix:false})}** — il est dans les roues. Le DRS est activé !`,
        `***😱 T${lap} — ${fmtGapSec(gapTop, {prefix:false})} !*** Le gap est ridicule. ${leader.team.emoji}**${leader.pilot.name}** est sous pression extrême !`,
      ]));
    } else if (gapTop < 1.0) {
      lines.push(pick([
        `***⚡ T${lap} — ${second.team.emoji}${second.pilot.name} est à **${fmtGapSec(gapTop, {prefix:false})}** de ${leader.team.emoji}${leader.pilot.name}*** — la pression est maximale !`,
        `😤 **${second.team.emoji}${second.pilot.name}** fond sur **${leader.team.emoji}${leader.pilot.name}** — ${fmtGapSec(gapTop, {prefix:false})} seulement. Ça chauffait, ça brûle maintenant.`,
        `🎯 T${lap} — **${fmtGapSec(gapTop, {prefix:false})}** entre P1 et P2. ${leader.team.emoji}**${leader.pilot.name}** sent la pression monter dans l'habitacle.`,
        `📻 Ingénieur radio : *"Attention, ${second.pilot.name} revient."* ${leader.team.emoji}**${leader.pilot.name}** sait ce qu'il a à faire.`,
      ]));
    } else if (gapTop < 2.5 && third) {
      const gap3 = (third.totalTime - second.totalTime) / 1000;
      if (gap3 < 1.0) lines.push(pick([
        `🏎️ **Bagarre à trois !** ${leader.team.emoji}**${leader.pilot.name}** · ${second.team.emoji}**${second.pilot.name}** · ${third.team.emoji}**${third.pilot.name}** — tous dans le même mouchoir !`,
        `🎯 **T${lap}** — Trio serré en tête ! ${leader.team.emoji}**${leader.pilot.name}** devant, mais P2 et P3 dans la seconde. Situation explosive.`,
      ]));
      else lines.push(pick([
        `🏎️ ${leader.team.emoji}**${leader.pilot.name}** devant — **${gapTop.toFixed(1)}s** sur ${second.team.emoji}**${second.pilot.name}**. La pression monte.`,
        `📡 T${lap} — L'écart P1/P2 est de **${gapTop.toFixed(1)}s**. ${second.team.emoji}**${second.pilot.name}** surveille ses pneus avant d'attaquer.`,
      ]));
    } else if (gapTop > 20) {
      lines.push(pick([
        `🏃 ${leader.team.emoji}**${leader.pilot.name}** file seul en tête — **${gapTop.toFixed(1)}s** d'avance. On dirait une autre course là-devant.`,
        `💨 ${leader.team.emoji}**${leader.pilot.name}** maîtrise parfaitement son Grand Prix. **+${gapTop.toFixed(1)}s** — c'est impressionnant.`,
        `🧘 ${leader.team.emoji}**${leader.pilot.name}** gère. **+${gapTop.toFixed(1)}s** — il roule au rythme de croisière. La victoire lui tend les bras.`,
        `📻 *"C'est under control."* ${leader.team.emoji}**${leader.pilot.name}** économise ses pneus depuis plusieurs tours. Mission accomplie si rien ne change.`,
      ]));
    } else {
      lines.push(pick([
        `🏎️ T${lap}/${totalLaps} — ${leader.team.emoji}**${leader.pilot.name}** en tête (+${gapTop.toFixed(1)}s) devant ${second.team.emoji}**${second.pilot.name}**. La course suit son cours.`,
        `⏱ T${lap} — Ordre stable en tête. ${leader.team.emoji}**${leader.pilot.name}** administre son avantage.`,
        `🎙 T${lap} — ${leader.team.emoji}**${leader.pilot.name}** devant, **${second.team.emoji}${second.pilot.name}** en embuscade à ${gapTop.toFixed(1)}s.`,
        `📊 T${lap}/${totalLaps} — **${gapTop.toFixed(1)}s** entre P1 et P2. ${leader.team.emoji}**${leader.pilot.name}** contrôle, ${second.team.emoji}**${second.pilot.name}** attend son heure.`,
        `🔍 T${lap} — ${leader.team.emoji}**${leader.pilot.name}** gère bien. ${second.team.emoji}**${second.pilot.name}** maintient la pression — +${gapTop.toFixed(1)}s en ce moment.`,
        `📻 Cockpit de ${leader.pilot.name} : les données sont bonnes. Le rythme est là. **+${gapTop.toFixed(1)}s** sur ${second.pilot.name}.`,
      ]));
    }
  } else {
    lines.push(`🏁 ${leader.team.emoji}**${leader.pilot.name}** seul en piste — tous les adversaires ont abandonné !`);
  }

  // ── Commentaires sur les pneus / stratégie ───────────────
  const hardPushers = ranked.filter(d => d.tireWear > 30 && d.pos <= 8);
  if (hardPushers.length > 0) {
    const p = hardPushers[0];
    const tireData = TIRE[p.tireCompound];
    if (tireData) {
      lines.push(pick([
        `🔥 **${p.team.emoji}${p.pilot.name}** (P${p.pos}) grille ses ${tireData.emoji}${tireData.label} — il va devoir s'arrêter bientôt.`,
        `⚠️ Usure critique sur la voiture de **${p.team.emoji}${p.pilot.name}** — les pneus ${tireData.emoji} sont en limite. La stratégie va être décisive.`,
        `📻 Ingénieur radio : *"Pneus en fin de vie."* ${p.team.emoji}**${p.pilot.name}** (P${p.pos}) ne pourra pas tenir encore longtemps.`,
        `🩺 Les capteurs de **${p.team.emoji}${p.pilot.name}** (P${p.pos}) sonnent l'alarme — dégradation accélérée sur les ${tireData.emoji}${tireData.label}. Pit stop imminent.`,
      ]));
    }
  }

  // ── Météo ────────────────────────────────────────────────
  if (weather === 'WET') lines.push(pick([
    `🌧️ Pluie battante — la piste est traîtresse. Chaque virage demande une concentration maximale.`,
    `🌧️ Les embruns derrière les voitures réduisent la visibilité. Dépasser dans ces conditions est un défi.`,
    `🌧️ Aquaplaning guette. Les pilotes doivent gérer l'adhérence — une fraction de seconde d'inattention et c'est le tête-à-queue.`,
    `🌧️ Piste glissante, visibilité réduite. Mais certains pilotes semblent à l'aise — ça se voit dans les chronos.`,
  ]));
  if (weather === 'HOT') lines.push(pick([
    `🔥 La chaleur est intense — **${Math.floor(50 + Math.random()*10)}°C** en piste. Les pneus souffrent énormément aujourd'hui.`,
    `🔥 Conditions de canicule. Les voitures surchauffent, les pilotes transpirent. Gestion thermique critique.`,
    `🔥 Asphalt brûlant — chaque tour grignote les pneus. La stratégie une arrêt ou deux devient un casse-tête pour les ingénieurs.`,
  ]));
  if (weather === 'INTER') lines.push(pick([
    `🌦️ Piste mixte — ni sec, ni mouillé. La fenêtre des slicks pourrait s'ouvrir dans quelques tours.`,
    `🌦️ Conditions délicates. Un pilote sur intermédiaires peut perdre des secondes par tour si la piste sèche trop vite.`,
    `🌦️ Pari stratégique en cours : certains restent aux inter', d'autres poussent pour basculer sur slicks.`,
  ]));

  // ── Étapes clés de la course ─────────────────────────────
  if (pct > 0.24 && pct < 0.28) {
    lines.push(pick([
      `📊 **Premier quart de course** passé — les stratèges commencent à calculer les fenêtres de pit stop.`,
      `📊 T${lap}/${totalLaps} — **25% de la course écoulée.** Les pneus de départ donnent leurs premiers signaux. Le vrai GP commence.`,
    ]));
  }
  if (pct > 0.48 && pct < 0.52) {
    lines.push(pick([
      `⏱ **Mi-course !** T${lap}/${totalLaps} — qui va jouer la stratégie, qui va rester dehors ?`,
      `⏱ **50% !** T${lap}/${totalLaps} — la seconde moitié s'ouvre. Les décisions stratégiques vont tout changer.`,
      `⏱ T${lap}/${totalLaps} — mi-course. Les pit stops vont décider du résultat. Les équipes le savent.`,
    ]));
  }
  if (pct > 0.74 && pct < 0.78) {
    lines.push(pick([
      `🏁 **Dernier quart de course.** Les positions se cristallisent — ou pas. Tout peut encore arriver.`,
      `🏁 Plus que **${totalLaps - lap} tours** ! Les mécaniciens croisent les doigts. Les pilotes donnent tout.`,
      `🏁 T${lap}/${totalLaps} — dernier quart. Les pneus qui tiennent auront le dernier mot.`,
    ]));
  }
  if (totalLaps - lap === 5) {
    lines.push(pick([
      `🏁 **5 TOURS RESTANTS !** Tout peut encore basculer — ou se confirmer. On retient son souffle.`,
      `🏁 **Cinq tours !** Le chrono tourne. Les pilotes puisent dans leurs dernières réserves.`,
    ]));
  }
  if (totalLaps - lap === 3) {
    lines.push(pick([
      `🏁 **3 TOURS !** Les positions actuelles sont potentiellement les finales. Sauf imprévu.`,
      `🏁 Trois tours pour l'histoire. ${leader.team.emoji}**${leader.pilot.name}** sent la victoire — mais rien n'est acquis.`,
    ]));
  }

  // ── Battle dans le peloton ───────────────────────────────
  for (let i = 1; i < Math.min(ranked.length, 15); i++) {
    const behind = ranked[i];
    const ahead  = ranked[i-1];
    const gap = (behind.totalTime - ahead.totalTime) / 1000;
    if (gap < 1.5 && gap > 0.3) {
      lines.push(pick([
        `👁 **Surveillance !** ${behind.team.emoji}**${behind.pilot.name}** (P${i+1}) est à **${fmtGapSec(gap, {prefix:false})}** de ${ahead.team.emoji}**${ahead.pilot.name}** (P${i}). Ça fume !`,
        `🔭 **P${i} vs P${i+1}** — ${ahead.team.emoji}**${ahead.pilot.name}** sous pression de ${behind.team.emoji}**${behind.pilot.name}** · **${fmtGapSec(gap, {prefix:false})}** entre eux.`,
        `📡 T${lap} — Bataille P${i}/P${i+1} : ${ahead.team.emoji}**${ahead.pilot.name}** vs ${behind.team.emoji}**${behind.pilot.name}** · écart : **${fmtGapSec(gap, {prefix:false})}**. Situation à surveiller.`,
        `⚔️ ${behind.team.emoji}**${behind.pilot.name}** (P${i+1}) colle à **${fmtGapSec(gap, {prefix:false})}** de ${ahead.team.emoji}**${ahead.pilot.name}** (P${i}). La tension monte dans ce duel.`,
      ]));
      break;
    }
  }

  // ── Style de circuit ────────────────────────────────────
  if (gpStyle === 'urbain' && Math.random() < 0.2) {
    lines.push(pick([
      `🏙️ Sur ce circuit urbain, les murs sont partout — la concentration doit être totale.`,
      `🏙️ Tracé urbain — les dépassements sont rares. Chaque erreur se paie cash.`,
      `🏙️ Pas de gravier, que du béton. Les sorties de piste ne pardonnent pas ici.`,
    ]));
  }
  if (gpStyle === 'rapide' && Math.random() < 0.2) {
    lines.push(pick([
      `💨 Circuit rapide — les voitures passent à plus de **300 km/h** dans les lignes droites. Spectaculaire.`,
      `💨 À ces vitesses, le moindre écart de trajectoire se paie cash. La précision est reine.`,
      `💨 Appuis aérodynamiques poussés à l'extrême. Le roulage en DRS offre des opportunités de dépassement uniques.`,
    ]));
  }
  if (gpStyle === 'technique' && Math.random() < 0.2) {
    lines.push(pick([
      `⚙️ Circuit technique — les pilotes aux bons réflexes et à la régularité font la différence.`,
      `⚙️ Les secteurs lents soulèvent les pneus arrière. La gestion de l'adhérence est capitale ici.`,
    ]));
  }
  if (gpStyle === 'endurance' && Math.random() < 0.2) {
    lines.push(pick([
      `🔋 Long GP d'endurance — la gestion des ressources prime sur la vitesse pure.`,
      `🔋 Circuit d'usure — qui a mieux géré ses pneus sera récompensé dans les 20 derniers tours.`,
    ]));
  }

  // ── Commentaires sur la hiérarchie en milieu de peloton ──
  if (ranked.length >= 8 && Math.random() < 0.25) {
    const midIdx = Math.floor(ranked.length / 2);
    const mid = ranked[midIdx];
    const midGap = ((mid.totalTime - leader.totalTime) / 1000).toFixed(1);
    lines.push(pick([
      `📊 Plus loin dans le peloton, ${mid.team.emoji}**${mid.pilot.name}** (P${midIdx+1}) est à **+${midGap}s** du leader.`,
      `🏎️ En milieu de grille : ${mid.team.emoji}**${mid.pilot.name}** se bat pour sa position à P${midIdx+1}.`,
    ]));
  }

  if (!lines.length) {
    lines.push(`🎙 T${lap}/${totalLaps} — La course continue. ${leader.team.emoji}**${leader.pilot.name}** reste en tête.`);
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

  // Pilote à domicile — angle spécial si pas déjà dans la liste
  for (const r of finalResults) {
    if (confSubjects.length >= 3) break;
    const p = pilotMap.get(String(r.pilotId));
    if (!p) continue;
    if (!isHomeGP(p, raceDoc)) continue;
    const alreadyIn = confSubjects.some(s => String(s.result.pilotId) === String(r.pilotId));
    if (!alreadyIn) {
      confSubjects.push({ result: r, angle: r.dnf ? 'home_dnf' : 'home_gp' });
      break;
    }
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

    // Affinités réelles avec coéquipier et rival (pour moduler le ton)
    let teammateAffinity = null;
    let rivalAffinity    = null;
    try {
      if (teammate) {
        const [sA, sB] = [String(pilot._id), String(teammate._id)].sort();
        const tmRel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
        if (tmRel) teammateAffinity = tmRel.affinity;
      }
      if (rival) {
        const [sA, sB] = [String(pilot._id), String(rival._id)].sort();
        const rivRel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
        if (rivRel) rivalAffinity = rivRel.affinity;
      }
    } catch(e) {}

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
      teammate   : teammate ? nickOrName(teammate) : undefined,
      teammatePos: teammateResult?.pos,
      teammateDnf: teammateResult?.dnf,
      teamStatus : pilot.teamStatus || null,
      rival      : rival ? nickOrName(rival) : undefined,
      rivalPos   : rivalResult?.pos,
      rivalDnf   : rivalResult?.dnf,
      rivalContacts    : pilot.rivalContacts || 0,
      teammateAffinity,
      rivalAffinity,
      seasonPhase,
      totalTeams    : allTeams?.length || 10,
    };

    const block = buildPressBlockWithPersonality(ctx, angle, pilot);
    if (block) blocks.push({ block, photoUrl: pilot.photoUrl || null });
  }

  // ── TRAHISON MÉDIATIQUE ────────────────────────────────────
  // Un pilote bad_boy (ou guerrier sous extrême pression) peut "lâcher" une
  // critique de son coéquipier en conf de presse si pression >= 80.
  // Déclenche : article immédiat + chute affinité + réaction en chaîne garantie.
  try {
    for (const pilot of allPilots) {
      const arch     = pilot.personality?.archetype;
      const pressure = pilot.personality?.pressureLevel || 0;
      // Condition : bad_boy ou guerrier, pression >= 80, et 40% de chance
      if (!['bad_boy', 'guerrier'].includes(arch)) continue;
      if (pressure < 80) continue;
      if (Math.random() > 0.40) continue;

      const teammate = allPilots.find(p =>
        String(p.teamId) === String(pilot.teamId) &&
        String(p._id) !== String(pilot._id)
      );
      if (!teammate) continue;

      const team = allTeams.find(t => String(t._id) === String(pilot.teamId));
      if (!team) continue;

      // Générer la critique
      const betrayalLines = {
        bad_boy: [
          `En conf de presse, **${pilot.name}** n'a pas mâché ses mots : *"Honnêtement ? Je ne suis pas sûr qu'on tire dans la même direction. ${teammate.name} et moi, on n'a pas la même lecture des choses."*`,
          `**${pilot.name}** a lâché une bombe en conférence : *"${teammate.name} fait son travail. Mais si on veut vraiment se battre pour quelque chose, il faudra que tout le monde hausse son niveau — moi le premier, lui aussi."*`,
          `Ambiance électrique dans le box ${team.emoji} **${team.name}** — **${pilot.name}** a déclaré publiquement : *"Je ne vais pas mentir, il y a des tensions. Ce n'est pas un secret."*`,
        ],
        guerrier: [
          `Sous tension maximale, **${pilot.name}** a craqué en conf de presse : *"Je vais être direct — je ne vois pas **${teammate.name}** pousser comme moi en ce moment. C'est frustrant."*`,
          `**${pilot.name}** n'a plus retenu ses frustrations : *"Si on veut performer, il faut que tout le monde soit à 100%. Je ne peux pas porter l'écurie seul."* — Une pique directe vers **${teammate.name}**.`,
        ],
      };
      const pool = betrayalLines[arch] || betrayalLines.bad_boy;
      const betrayalText = pool[Math.floor(Math.random() * pool.length)];

      // Créer l'article de trahison
      const article = await NewsArticle.create({
        type: 'drama',
        source: 'paddock_whispers',
        headline: `${pilot.name} critique publiquement son coéquipier ${teammate.name}`,
        body: betrayalText,
        pilotIds: [pilot._id, teammate._id],
        teamIds: [team._id],
        raceId: raceDoc._id,
        seasonYear: season.year,
        triggered: 'media_betrayal',
        publishedAt: new Date(),
      });

      // Chute d'affinité immédiate
      const [sA, sB] = [String(pilot._id), String(teammate._id)].sort();
      let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
      if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });
      const affinityDrop = -15;
      rel.affinity = Math.max(-100, Math.min(100, rel.affinity + affinityDrop));
      rel.type = rel.affinity >= 60 ? 'amis' : rel.affinity >= 20 ? 'respect' : rel.affinity > -20 ? 'neutre' : rel.affinity > -60 ? 'tension' : 'ennemis';
      rel.history = rel.history || [];
      rel.history.push({ event: 'trahison_medias', delta: affinityDrop, date: new Date(), circuit: raceDoc.circuit, seasonYear: season.year });
      // Réaction en chaîne GARANTIE (pendingReply forcé)
      rel.pendingReply = true;
      rel.pendingReplyCtx = {
        responderId:      String(teammate._id),
        citedId:          String(pilot._id),
        originalHeadline: article.headline,
        triggerType:      'media_betrayal',
      };
      await rel.save();

      // Monter la pression du pilote trahi
      await Pilot.findByIdAndUpdate(teammate._id, {
        $inc: { 'personality.pressureLevel': 20 },
      });

      // Publier dans le channel
      if (channel) {
        try { await channel.send({ content: `🎙️ **CONF DE PRESSE — INCIDENT**\n${betrayalText}` }); } catch(e) {}
        await sleep(3000);
        await publishNews(article, channel);
      }
      blocks.push({ block: betrayalText, photoUrl: pilot.photoUrl || null });

      // Tentative de surnom : la trahison peut générer un surnom ironique/moqueur
      if (!teammate.nickname) {
        await tryAssignNickname(pilot, teammate, 'teammate', 0.25);
      }
    }
  } catch(e) { console.error('[TrahisonMédiatique]', e.message); }

  return blocks;
}

// ── Templates combinatoires de conf de presse ─────────────
function buildPressBlock(ctx, angle) {
  const { name, emoji, teamName, pos, dnf, dnfReason, circuit, gpStyle,
          gpPhase, wins, podiums, pts, champPos, cPos,
          champLeaderName, champLeaderPts, teammate, teammatePos,
          teamStatus, rival, rivalPos, rivalDnf, rivalContacts,
          teammateAffinity, rivalAffinity,
          seasonPhase } = ctx;

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

  // Réaction coéquipier — modulée par l'affinité réelle entre les deux pilotes
  // Affinité >= 40 (amis/respect fort) : ton chaleureux même en défaite
  // Affinité -20 à +40 : ton standard compétitif
  // Affinité < -20 (tension/ennemis) : ton froid, défensif
  const tmAff = teammateAffinity !== null ? teammateAffinity : 0;
  const teammateStr = teammate && teammatePos
    ? teammatePos < pos && !dnf
      // Coéquipier devant — défaite interne
      ? tmAff >= 40
        ? pick([
            `${teammate} était devant — il a été impeccable aujourd'hui. Chapeau.`,
            `Honnêtement, ${teammate} m'a montré quelque chose ce week-end. Je dois analyser ça.`,
            `${teammate} avait clairement le dessus. C'est dur à accepter mais je suis content pour lui.`,
            `Je ne peux pas être frustré — ${teammate} a livré une prestation remarquable.`,
          ])
        : tmAff < -20
          ? pick([
              `${teammate} était devant aujourd'hui. Ça mérite une discussion interne.`,
              `Je suis derrière ${teammate}. Ce n'est pas une situation que j'apprécie.`,
              `${teammate} m'a pris des points. Ce n'est pas idéal dans les duels coéquipiers.`,
              teamStatus === 'numero1'
                ? `C'est inhabituel de finir derrière ${teammate}. Ça ne doit pas se reproduire.`
                : `${teammate} est devant. Je dois rectifier ça.`,
            ])
          : pick([
              `${teammate} était devant aujourd'hui — il faut l'accepter.`,
              `${teammate} a été plus fort ce week-end. Je dois analyser pourquoi.`,
              `Il faut être honnête : ${teammate} a fait un meilleur travail que moi aujourd'hui. Point.`,
              `${teammate} a eu le dessus cette fois. Ça arrive. Mais ça ne doit pas devenir une habitude.`,
            ])
      : pos < (teammatePos || 99) && !dnf
        // Pilote devant son coéquipier — victoire interne
        ? tmAff >= 40
          ? pick([
              `${teammate} était là aussi — on s'est bien battus. Heureux d'être devant mais il a tout donné.`,
              `Devant ${teammate} aujourd'hui. On a eu un beau duel propre — c'est ce qu'on veut.`,
              `Bonne journée pour l'équipe et pour moi vis-à-vis de ${teammate}. On travaille bien ensemble.`,
              `${teammate} a tout donné, j'ai réussi à rester devant. Je lui ai dit bravo quand même — il le méritait.`,
            ])
          : tmAff < -20
            ? pick([
                `Devant ${teammate}. C'est ce qu'on cherche dans ce genre de duel.`,
                `J'étais devant ${teammate} — les points internes comptent.`,
                `${teammate} était là, j'étais devant. Rien de plus à dire.`,
                teamStatus === 'numero1'
                  ? `${teammate} était là, j'ai maintenu ma position. C'est dans l'ordre des choses.`
                  : `Devant ${teammate}. Je prends ça race par race.`,
              ])
            : pick([
                `${teammate} était là aussi — mais j'avais le rythme aujourd'hui.`,
                `Devant ${teammate}. C'est ce qu'on veut dans les duels internes.`,
                `On travaille ensemble, mais sur la piste on se bat. Aujourd'hui j'avais le dessus.`,
                `${teammate} a tout donné, mais j'ai réussi à rester devant. C'est l'essentiel.`,
              ])
        : ''
    : '';


  // Réaction rival — ton modulé par l'affinité réelle ET le niveau de contacts
  // Affinité < -40 : hostile, acéré
  // Affinité -40 à 0 : compétitif standard
  // Affinité > 20 : respect même dans la rivalité, éloges possibles
  const rivAff = rivalAffinity !== null ? rivalAffinity : -10; // défaut légèrement négatif pour un rival déclaré
  const rivalStr = rival && rivalPos
    ? rivalDnf
      ? rivAff >= 20
        ? pick([
            `${rival} n'a pas terminé — c'est dommage, j'aurais aimé me battre avec lui jusqu'au bout.`,
            `L'abandon de ${rival} est une mauvaise nouvelle pour le spectacle. Je lui souhaite de revenir fort.`,
            `Dommage pour ${rival}. Il méritait mieux aujourd'hui.`,
          ])
        : rivAff < -40
          ? pick([
              `${rival} a abandonné. Je ne vais pas commenter ça.`,
              rivalContacts >= 5 ? `${rival} n'a pas terminé. Le destin a parfois de l'humour.` : `Ces choses arrivent. Je reste focus sur ma course.`,
              `L'abandon de ${rival} ne change rien à mon approche.`,
            ])
          : pick([
              `${rival} n'a pas terminé — ces choses arrivent. Je reste focus sur ma course.`,
              `Dommage pour ${rival}. Mais la course continue.`,
              `L'abandon de ${rival} ne change rien à mon approche. Je gère ma course.`,
            ])
      : rivalPos > pos
        ? rivAff >= 20
          ? pick([
              `${rival} était derrière moi — c'est un bon résultat mais il reviendra.`,
              `Devant ${rival} aujourd'hui. On a eu un beau duel — c'est ce que j'aime dans ce sport.`,
              `J'étais devant ${rival}. Il a tout donné — c'était bien joué de sa part aussi.`,
            ])
          : rivAff < -40
            ? pick([
                `${rival} était derrière moi aujourd'hui. C'est ce qu'on voulait.`,
                `On a fait le travail face à ${rival} ce week-end. Enfin.`,
                rivalContacts >= 4 ? `Devant ${rival} — après tous ces incidents, c'est une satisfaction particulière.` : `${rival} était là, j'étais devant.`,
                `Cette fois ${rival} n'a pas trouvé la faille.`,
              ])
            : pick([
                `${rival} était derrière moi aujourd'hui. C'est ce qu'on voulait.`,
                `On a fait le travail face à ${rival} ce week-end.`,
                `${rival} était là, j'étais devant. Rien de plus à dire.`,
                `Cette fois ${rival} n'a pas trouvé la faille. J'ai géré.`,
              ])
        : rivAff >= 20
          ? pick([
              `${rival} était devant — il a fait une course solide. Je dois regarder pourquoi.`,
              `Pas satisfait de finir derrière ${rival}, mais il a mérité. On se retrouvera au prochain GP.`,
              `${rival} avait quelque chose de plus aujourd'hui. Je dois le reconnaître.`,
            ])
          : rivAff < -40
            ? pick([
                `${rival} devant. Encore. On aura d'autres occasions de régler ça sur la piste.`,
                rivalContacts >= 5 ? `${rival} était devant. Cette fois sans contact — mais ça ne change pas grand-chose.` : `${rival} avait le dessus. Ça ne va pas durer.`,
                `Pas satisfait de finir derrière ${rival}. On doit absolument retravailler ça.`,
                `Il faut regarder pourquoi ${rival} avait ce rythme-là. Ce n'est pas normal.`,
              ])
            : pick([
                `${rival} était devant — ça pique, mais il a été meilleur aujourd'hui.`,
                `Pas satisfait de finir derrière ${rival}. On doit retravailler ça.`,
                `${rival} a eu le dessus cette fois.`,
                `Il faut regarder pourquoi ${rival} avait ce rythme-là. Ce n'est pas normal.`,
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
          `"Circuit parfait pour nous aujourd'hui. On a maximisé chaque opportunité."`,
          `"Victoire propre. Le team a été irréprochable ce week-end — en qualif', au pit stop, partout."`,
        ]);
        // Seuil "beaucoup de victoires" relatif à l'envergure de l'équipe
        const _vrank  = cStandSorted.findIndex(s => String(s.teamId) === String(team._id)) + 1 || 5;
        const _vperf  = evalPilotPerf(pilot, team, form, _vrank, cStandSorted.length || 10, null);
        const isMultiWin = wins >= Math.max(2, _vperf.winTarget);
        const middle = isMultiWin
          ? pick([
              `"${wins} victoires en ${gpPhase}. ${_vperf.isTopTeam ? "On ne s'attendait pas à moins — mais le travail pour y arriver reste colossal." : "Pour une équipe de notre taille, c'est exceptionnel."}"`,
              `"C'est notre ${wins}ème victoire cette saison. L'élan est là. ${endPressure}"`,
              `"${wins} victoires — ça compte sérieusement au championnat. ${_vperf.isSmall ? "L'équipe a dépassé toutes les attentes." : "On reste concentrés."}"`,
            ])
          : wins === 1
            ? pick([
                `"${_vperf.isSmall ? "Personne n'attendait ça de nous. Mais on l'a fait." : "Première victoire de la saison — ça fait un bien fou."} Maintenant on continue."`,
                `"On attendait ça depuis le début de saison. C'est libérateur."`,
              ])
            : `"Belle victoire pour le moral. ${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. On avance."`;
        const closer = champPos === 1
          ? pick([
              `"${champStr} — mais rien n'est joué. ${endPressure || 'On reste humbles.'}"`,
              `"En tête du championnat, c'est là où on veut être. ${constrStr}"`,
              `"P1 au général avec ${pts} points. On ne regarde pas derrière — on regarde devant."`,
            ])
          : pick([
              `"On remonte au classement. P${champPos} maintenant — ${champLeaderName} est dans le viseur."`,
              `"${champLeaderName} a toujours des points d'avance, mais on réduit. ${endPressure}"`,
              `"Victoire importante pour le championnat. On se rapproche de ${champLeaderName}."`,
            ]);
        return `${opener}\n${middle}\n${closer}${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
      // Soulagement / humble
      () => {
        const opener = pick([
          `"Honnêtement, ça n'était pas la course la plus simple. Mais on a tenu."`,
          `"Il y a eu des moments de doute — mais l'équipe m'a donné un bon pit stop et j'ai pu gérer."`,
          `"Je ne vais pas mentir, j'ai eu de la chance à un moment. Mais il faut la provoquer."`,
          `"La stratégie a été parfaite. Je suis fier du travail de tout le monde en dehors de la piste."`,
          `"C'était serré. P${second ? ranked?.find(r=>r?.pilot?.name===name)?.pos||1 : 1} au final — mais une victoire est une victoire."`,
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
          `"La clé aujourd'hui c'était la gestion des pneus. On a suivi le plan à la lettre."`,
          `"Chaque détail a compté ce week-end. Setup, stratégie, départ — tout était aligné."`,
        ]);
        const middle = seasonPhase === 'début'
          ? `"En ${gpPhase}, chaque résultat construit quelque chose. Ce résultat confirme notre direction."`
          : seasonPhase === 'fin'
            ? `"En ${gpPhase}, une victoire vaut de l'or. ${endPressure}"`
            : `"Mi-saison, on fait le point. ${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. La tendance est bonne."`;
        const closer = `"${constrStr || 'L\'équipe mérite ce résultat.'} Prochain GP, même état d'esprit."`;
        return `${opener}\n${middle}\n${closer}${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
      // Émotionnel / personnel
      () => {
        const opener = pick([
          `"Il y a des victoires qui ont une saveur particulière. Celle-là en fait partie."`,
          `"Je pense à tous ceux qui ont cru en moi. Ce résultat, c'est pour eux aussi."`,
          `"Ça fait longtemps qu'on travaille pour ça. Chaque sacrifice trouve son sens aujourd'hui."`,
        ]);
        const champContext = champPos === 1
          ? `"Leader du championnat avec ${pts} points — je mesure la chance que j'ai."`
          : wins >= 2
            ? `"${wins} victoires cette saison. Je vis un rêve."`
            : `"Première victoire, ou pas — peu importe. On est au sommet aujourd'hui."`;
        return `${opener}\n${champContext}${constrStr ? '\n"' + constrStr + '"' : ''}`;
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
              `"Deuxième place. Frustrant et satisfaisant à la fois. On prend les points."`,
            ])
          : pick([
              `"Un podium, c'est toujours une bonne journée. Surtout vu le ${gpPhase}."`,
              `"P3. On prend les points, on reste dans la course au championnat."`,
              `"Podium. L'équipe méritait ça — on a tout donné aujourd'hui."`,
            ]);
        const middle = champPos && champPos <= 5
          ? `"On est ${champStr} avec ${pts} points. ${endPressure || 'Le championnat est ouvert.'}"`
          : champPos && champPos <= 10
            ? `"P${champPos} au général. On se bat pour chaque position — c'est ça notre objectif cette saison."`
            : `"${bilanStr.charAt(0).toUpperCase() + bilanStr.slice(1)}. Un podium de plus dans la besace."`;
        return `${opener}\n${middle}${rivalStr ? '\n*Sur ' + rival + ' :* "' + rivalStr.replace(/^.*?"/, '"') : ''}`;
      },
      () => {
        const opener = champLeaderName && champPos && champPos <= 3
          ? pick([
              `"${champLeaderName} s'échappe un peu, mais rien n'est joué. ${endPressure || 'On reste là.'}"`,
              `"Le gap avec ${champLeaderName} n'est pas catastrophique. On va le chercher."`,
              `"${champLeaderName} prend du large, mais une course peut tout renverser. On sait ça."`,
            ])
          : `"P${pos} aujourd'hui. ${styleStr} — notre voiture a bien répondu."`;
        const closer = constrStr ? `"${constrStr}"` : `"L'équipe a fait du bon travail ce week-end."`;
        return `${opener}\n${closer}${teammateStr ? '\n*Sur son coéquipier :* "' + teammateStr + '"' : ''}`;
      },
      () => {
        const opener = pick([
          `"La stratégie a été bonne. On a pris les bonnes décisions au bon moment."`,
          `"Podium sur ce circuit, c'est une satisfaction. ${styleStr}."`,
          `"Beau résultat. On n'était pas forcément favoris ici — ça rend ça encore meilleur."`,
        ]);
        const context = wins > 0
          ? `"${wins} victoire(s) et ${podiums} podiums cette saison. La régularité, c'est notre force."`
          : `"${podiums} podiums. Pas encore la victoire, mais on est là."`;
        return `${opener}\n${context}${constrStr ? '\n"' + constrStr + '"' : ''}`;
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
          `"Pas de mots. On avait le rythme, on avait la place — et ${dnfLabel} nous a pris ça."`,
        ]);
        const middle = champPos && champPos <= 6
          ? pick([
              `"On était ${champStr}. Là on perd des points précieux. ${endPressure || 'Il faut rebondir.'}"`,
              `"Ces zéros au championnat font mal. P${champPos} au général — ça va être compliqué de rattraper ça."`,
            ])
          : `"Il faut regarder devant. ${seasonPhase === 'fin' ? 'En fin de saison, chaque point perdu est difficile à récupérer.' : 'On a encore des courses pour se rattraper.'}"`;
        const closer = pick([
          `"Le week-end prochain, on revient. Plus fort."`,
          `"L'équipe ne méritait pas ça. On se relèvera."`,
          `"La course, c'est ça aussi. On encaisse et on repart."`,
          `"C'est le sport. Parfois tout va bien, parfois tout part à rien en quelques secondes."`,
        ]);
        return `${opener}\n${middle}\n"${closer}"`;
      },
      () => {
        const opener = dnfReason === 'CRASH'
          ? pick([
              `"Il faut regarder les images. Je ne pense pas avoir fait une erreur — mais c'est à la FIA de décider."`,
              `"Course terminée trop tôt. L'accident, c'est quelques fractions de seconde qui changent tout."`,
            ])
          : dnfReason === 'MECHANICAL'
            ? pick([
                `"La voiture m'a lâché. C'est frustrant parce qu'on avait le rythme pour être dans le top."`,
                `"Panne mécanique. On analyse avec les ingénieurs — ça ne doit plus arriver."`,
              ])
            : pick([
                `"Crevaison. Rien à faire. La course s'est arrêtée là."`,
                `"Un pneu à plat. Dur à accepter quand tout se passait bien."`,
              ]);
        return `${opener}\n"${seasonPhase === 'fin' ? endPressure || 'On garde la tête froide.' : 'On ne lâche pas.'}"`;
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
              `"P${pos}. On voulait plus — mais on est toujours leaders. Le travail continue."`,
            ])
          : dnf
            ? pick([
                `"Terrible journée. Mais on reste leaders. Ce n'est pas ce GP qui définit la saison."`,
                `"DNF douloureux. Mais le championship lead est toujours là — on gère ça."`,
              ])
            : `"P${pos}. On a vécu mieux, mais la situation au général reste correcte."`;
        const closer = seasonPhase === 'fin'
          ? `"${endPressure} On garde la tête froide."`
          : `"En ${gpPhase}, on est ${champStr} avec ${pts} points. L'objectif reste le même."`;
        return `${opener}\n${closer}`;
      },
      () => {
        const gapToSecond = ctx?.champGapToSecond;
        const opener = pick([
          `"On ne regarde pas le classement — on regarde la prochaine course."`,
          `"Leader, ça n'a de valeur que si ça l'est à la fin de la saison."`,
          `"${pts} points, ${wins} victoires. ${seasonPhase === 'fin' ? 'La course au titre est ouverte.' : 'Saison solide jusqu\'ici.'}"`,
        ]);
        const _clRank = cStandSorted.findIndex(s => String(s.teamId) === String(team._id)) + 1 || 5;
        const _clPerf = evalPilotPerf(pilot, team, form, _clRank, cStandSorted.length || 10, null);
        const closer = wins >= Math.max(2, _clPerf.winTarget)
          ? `"${wins} victoires — ${_clPerf.isTopTeam ? "c'est notre meilleur bilan depuis longtemps" : "personne ne nous attendait là"}. L'équipe est en feu."`
          : `"Régularité avant tout. Chaque point compte dans un championnat comme celui-là."`;
        return `${opener}\n"${closer}"`;
      },
    ];
    return `🎤 **${emoji} ${name} — 🏆 Leader du champ. (P${pos}), ${circuit}**\n${pick(tones)()}`;
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

// ── Angles GP à domicile ──────────────────────────────────
function buildHomeGPBlock(ctx, angle) {
  const { name, emoji, pos, dnf, circuit, nationality } = ctx;
  const flag = nationality?.split(' ')[0] || '🏠';

  if (angle === 'home_gp') {
    const isWin    = pos === 1 && !dnf;
    const isPodium = pos <= 3 && !dnf;
    if (isWin) {
      return pick([
        `🏠 **${emoji} ${name} — Victoire à domicile ! ${flag} ${circuit}**\n"Vous ne savez pas ce que ça représente. Ici, avec ce public... c'est différent. Chaque course ici est spéciale, mais gagner ici..." — il n'a pas terminé sa phrase. La salle non plus.`,
        `🏠 **${flag} ${name} gagne chez lui — ${circuit}**\nLes tribunes ont commencé à fêter avant le drapeau à damiers. "${name} le sait. Son équipe aussi. *Je dédie cette victoire à tous ceux qui se sont déplacés aujourd'hui. Vous m'avez porté.*"`,
        `🏠 **Victoire nationale — ${emoji} ${name}, P1 à ${circuit}**\n"P1 devant mon public. Il y a des journées dans une carrière qui valent plus que des points. Celle-là en fait partie." Les yeux brillants, mais la voix ferme.`,
      ]);
    }
    if (isPodium) {
      return pick([
        `🏠 **${flag} ${name} — Podium à domicile (P${pos}), ${circuit}**\n"P${pos} ici, ça compte double. Le public m'a poussé à chaque tour. Je les entendais." Un podium construit sous les yeux de ceux qui comptent le plus.`,
        `🏠 **${emoji} ${name} — P${pos} sur ses terres, ${circuit}**\n"Je ne vais pas mentir — il y a une pression particulière ici. Mais quand le drapeau est tombé... ça valait tout." Podium et larmes retenues.`,
      ]);
    }
    if (pos <= 10) {
      return pick([
        `🏠 **${flag} ${name} — P${pos} à domicile, ${circuit}**\n"P${pos}. Je voulais tellement mieux pour ce public. Ils méritaient plus. Mais je les remercie — ils ont été incroyables jusqu'au bout."`,
        `🏠 **${emoji} ${name} — P${pos} à ${circuit}**\n"C'est compliqué à expliquer. Tu veux tellement performer ici... parfois ça joue contre toi. P${pos}, on prend, on analyse, on revient."`,
      ]);
    }
    return pick([
      `🏠 **${flag} ${name} — Week-end difficile à domicile (P${pos}), ${circuit}**\n"Ce n'était pas notre week-end. Devant mon public, c'est encore plus dur à accepter. Mais c'est la course." Bref. Digne.`,
    ]);
  }

  if (angle === 'home_dnf') {
    return pick([
      `🏠 **${flag} ${name} — Abandon à domicile, ${circuit}**\nDevant son public. L'une des images les plus difficiles du sport automobile : un pilote qui se gare chez lui. "*Je suis désolé pour eux. Ils se sont déplacés pour ça.*" Puis il s'est levé et a salué les tribunes.`,
      `🏠 **${emoji} ${name} — DNF sous les regards de son pays, ${circuit}**\n"Je n'ai pas les mots. Mais leurs applaudissements quand je me suis garé... disaient tout." ${name} a mis du temps à quitter sa monoplace.`,
      `🏠 **Abandon cruel pour ${flag} ${name} devant ses supporters, ${circuit}**\n"La course s'est arrêtée trop tôt. Mais le public a été fantastique. Je reviendrai."`,
    ]);
  }

  return null;
}


// ── buildPressBlockWithPersonality ────────────────────────────
function buildPressBlockWithPersonality(ctx, angle, pilot) {
  // Les angles home GP ont leur propre builder (pas de filtre personnalité dessus — trop émotionnel)
  if (angle === 'home_gp' || angle === 'home_dnf') {
    return buildHomeGPBlock({ ...ctx, nationality: pilot?.nationality }, angle);
  }
  let base = buildPressBlock(ctx, angle);
  if (!base) return null;
  if (!pilot?.personality) return base;
  const { tone, pressStyle, archetype: arch, pressureLevel: pressure } = pilot.personality;
  const { pos, dnf, cPos, champPos, totalTeams, teammate, rival, teammateAffinity, rivalAffinity } = ctx;
  const expectedPos    = cPos ? Math.min(15, Math.max(1, Math.round(cPos*15/(totalTeams||10)))) : 8;
  const isOverperform  = !dnf && pos && cPos && pos < expectedPos-2 && cPos > Math.ceil((totalTeams||10)/2);
  const isUnderperform = !dnf && pos && cPos && pos > expectedPos+3 && cPos <= Math.ceil((totalTeams||10)/2);
  const isChampDnf = champPos===1 && dnf;
  const isChampOOPts = champPos===1 && !dnf && pos>10;
  const filters = {
    agressif   : [[/C'est d\u00e9cevant/g,"C'est inacceptable"],[/on avance\b/g,"on AVANCE \u2014 quoi qu'il arrive"]],
    sarcastique : [[/belle journ\u00e9e/g,'journ\u00e9e... int\u00e9ressante'],[/c'est l.essentiel/g,"c'est toujours \u00e7a de pris"]],
    froid       : [[/c'est lib\u00e9rateur/g,"c'est le r\u00e9sultat attendu"],[/je suis fier/g,'r\u00e9sultat satisfaisant']],
    ironique    : [[/on le prend\b/g,"on le prend. Pour l'instant."],[/saison difficile/g,'saison... caract\u00e8re']],
  };
  for (const [re,rep] of (filters[tone]||[])) base=base.replace(re,rep);
  if (isOverperform) { const bo={guerrier:'\n*Ce r\u00e9sultat, personne ne l\'attendait.*',rookie_ambitieux:'\n*On a tout donn\u00e9 \u2014 et \u00e7a a pay\u00e9.*',bad_boy:'\n*Surpris ? Moi non.*',calculateur:'\n*Strat\u00e9gie parfaite.*',icone:'\n*Ce r\u00e9sultat rappelle pourquoi on est l\u00e0.*',vieux_sage:'\n*Parfois tout s\'aligne.*'};base+=bo[arch]||''; }
  if (isChampDnf||isChampOOPts) { const di={guerrier:'\n*Il quitte la salle les dents serr\u00e9es.*',icone:'\n*Sourire de fa\u00e7ade.*',calculateur:'\n*Il note \u00e7a comme une variable.*',bad_boy:'\n*Il sort sans se retourner.*',vieux_sage:'\n*Il s\'en est toujours relev\u00e9.*',rookie_ambitieux:'\n*La voix tremble.*'};base+=di[arch]||'\n*Journ\u00e9e noire pour le leader du championnat.*'; }
  if (isUnderperform) base+=pick(['\n\n*Chaque mot est pes\u00e9.*','\n\n*Le ton est plus d\u00e9fensif.*','\n\n*Ce r\u00e9sultat laissera des traces.*']);
  if ((pressure||0)>=70&&pressStyle==='spontane'&&Math.random()<0.45){const ob={agressif:'\n\n*"Il va falloir que \u00e7a change."*',sarcastique:'\n\n*"Rien n\'\u00e9tait dr\u00f4le."*',humble:'\n\n*"J\'essaie vraiment."*'};base+=ob[tone]||'';}
  if ((pressure||0)>=60&&pressStyle==='fuyant'&&Math.random()<0.4) base+='\n\n*Il coupe court.*';

  // ── Suffixe d'éloge spontané si affinité coéquipier ou rival très positive ──
  // Seulement ~35% du temps pour ne pas saturer, priorité au contexte inattendu
  if (Math.random() < 0.35) {
    const tmAff = teammateAffinity !== null && teammateAffinity !== undefined ? teammateAffinity : null;
    const rvAff = rivalAffinity    !== null && rivalAffinity    !== undefined ? rivalAffinity    : null;
    if (tmAff !== null && tmAff >= 50 && teammate) {
      const eloges = {
        guerrier       : `\n\n*Sur son coéquipier :* "${teammate} — rarement vu quelqu'un travailler avec autant d'intensité. Un vrai compétiteur."`,
        icone          : `\n\n*Sur son coéquipier :* "Travailler avec ${teammate}, c'est une chance. Il est exigeant, précis. C'est ce qu'on veut."`,
        vieux_sage     : `\n\n*Sur son coéquipier :* "${teammate} a les bons réflexes. Ça ne s'apprend pas — ou rarement."`,
        rookie_ambitieux:`\n\n*Sur son coéquipier :* "${teammate} m'apprend quelque chose chaque week-end. Je ne le dirai pas souvent, alors j'en profite."`,
        calculateur    : `\n\n*Sur son coéquipier :* "${teammate} est efficace. Sa rigueur est un atout pour l'équipe."`,
        bad_boy        : `\n\n*Sur son coéquipier :* "OK je vais le dire : ${teammate} est bon. Vraiment bon. Voilà."`,
      };
      base += eloges[arch] || `\n\n*Sur son coéquipier :* "${teammate} a fait une bonne course. Je le reconnais."`;
    } else if (rvAff !== null && rvAff >= 40 && rival) {
      const eloges = {
        guerrier       : `\n\n*Sur ${rival} :* "Je veux battre les meilleurs. ${rival} en est un. C'est pour ça que les duels avec lui ont de la valeur."`,
        icone          : `\n\n*Sur ${rival} :* "Ce que fait ${rival} cette saison mérite d'être reconnu. C'est un grand compétiteur."`,
        vieux_sage     : `\n\n*Sur ${rival} :* "${rival} élève le niveau. C'est tout ce qu'on demande à un adversaire."`,
        rookie_ambitieux:`\n\n*Sur ${rival} :* "Se battre contre ${rival} c'est une école. Je sors de chaque duel meilleur pilote."`,
        calculateur    : `\n\n*Sur ${rival} :* "${rival} est redoutable. Son rythme force le respect."`,
        bad_boy        : `\n\n*Sur ${rival} :* "Je me bats contre lui parce qu'il vaut le coup. Pas comme tout le monde."`,
      };
      base += eloges[arch] || `\n\n*Sur ${rival} :* "${rival} mérite sa place ici. C'est un bon pilote."`;
    }
  }

  const pre={spontane:pick(['Encore dans le casque, ','Avant m\u00eame d\'enlever son casque, ']),mediatraining:pick(['Face aux m\u00e9dias, ','']),fuyant:pick(['Attrap\u00e9 dans le couloir, ','']),show_off:pick(['Sous les projecteurs, ',''])};
  return (pre[pressStyle]||'')+base;
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

// ── genAffinityPraiseArticle — Éloges & complicités basées sur l'affinité réelle ──
// Généré post-course uniquement quand deux pilotes ont une affinité >= 30
// et ont tous deux fini dans les points. Reflète la chaleur humaine du paddock.
function genAffinityPraiseArticle(pA, pB, teamA, teamB, rel, rA, rB, circuit, seasonYear) {
  const isSameTeam   = String(pA.teamId) === String(pB.teamId);
  const affinity     = rel.affinity;
  const relType      = rel.type; // 'respect', 'amis'
  const bothPodium   = rA.pos <= 3 && rB.pos <= 3;
  const source       = pick(['paddock_mag', 'pl_racing_news', 'f1_weekly', 'grid_social', 'speed_gossip']);

  // Tier selon la force de l'affinité
  const tier = affinity >= 70 ? 'amis_proches'
             : affinity >= 45 ? 'respect_fort'
             : 'cordialite';

  // Sélection du contexte pour l'article
  const context = bothPodium ? 'podium' : isSameTeam ? 'coequipiers' : 'rivaux_respectueux';

  const headlines = {
    amis_proches: {
      podium: [
        `${pA.name} et ${pB.name} sur le podium — une amitié qui dépasse la compétition`,
        `"Je suis heureux pour lui autant que pour moi" — ${pA.name} sur ${pB.name}`,
        `Podium partagé, joie partagée : ${teamA.emoji}${pA.name} et ${teamB.emoji}${pB.name}`,
      ],
      coequipiers: [
        `${pA.name} : "Ce que ${pB.name} fait cette saison est impressionnant"`,
        `Dans le garage, ${pA.name} et ${pB.name} sont bien plus que des coéquipiers`,
        `${teamA.emoji} L'alchimie rare : ${pA.name}/${pB.name} tirent ${teamA.name} vers le haut`,
      ],
      rivaux_respectueux: [
        `${pA.name} sur ${pB.name} : "Il élève mon niveau"`,
        `La face cachée du paddock : ${pA.name} et ${pB.name}, adversaires mais alliés`,
        `"On se tire mutuellement vers le haut" — ${pA.name} à propos de ${pB.name}`,
      ],
    },
    respect_fort: {
      podium: [
        `${pA.name} félicite ${pB.name} — et le paddock applaudit la sportivité`,
        `À ${circuit}, la classe avant tout : ${pA.name} et ${pB.name} s'honorent`,
        `"Bien joué, vraiment" — ${pA.name} à ${pB.name} après la course`,
      ],
      coequipiers: [
        `${teamA.emoji}${pA.name} : "J'apprends de ${pB.name} chaque week-end"`,
        `Duo solidaire chez ${teamA.name} : ${pA.name} et ${pB.name} défient les pronostics`,
        `"On s'est battu proprement" — ${pA.name} après son duel avec ${pB.name}`,
      ],
      rivaux_respectueux: [
        `${pA.name} vs ${pB.name} : la rivalité qui fait du bien au sport`,
        `Le beau geste de ${pA.name} envers ${pB.name} après ${circuit}`,
        `"Je respecte ce qu'il fait. Vraiment." — ${pA.name} à propos de ${pB.name}`,
      ],
    },
    cordialite: {
      podium: [
        `Beau geste de fair-play à ${circuit} entre ${pA.name} et ${pB.name}`,
        `${pA.name} et ${pB.name} — un sport qui sait encore se féliciter`,
        `Les deux pilotes dans les points à ${circuit} — et la poignée de main qui fait plaisir`,
      ],
      coequipiers: [
        `Chez ${teamA.name}, l'entente entre ${pA.name} et ${pB.name} surprend le paddock`,
        `${pA.name} : "On travaille bien ensemble, c'est simple"`,
        `${teamA.emoji} Une cohésion coéquipiers qui commence à payer`,
      ],
      rivaux_respectueux: [
        `${pA.name} sur ${pB.name} : "Il mérite d'être là"`,
        `Classe et respect : ${pA.name} et ${pB.name} montrent l'exemple à ${circuit}`,
        `Un paddock qui sait aussi se respecter — ${pA.name} et ${pB.name}`,
      ],
    },
  };

  const bodies = {
    amis_proches: {
      podium: () => {
        return `${pA.name} et ${pB.name}. Deux pilotes qui auraient pu se considérer comme des rivaux directs — et qui ont choisi autre chose.

` +
          pick([
            `Sur le podium de ${circuit}, quelque chose de rare : une vraie joie partagée. ${pA.name} s'est retourné vers ${pB.name} avant même de lever le poing. "Félicitations, tu l'as mérité." Pas pour les caméras.`,
            `La poignée de main après la ligne d'arrivée a duré quelques secondes de plus que d'habitude. Le genre de détail que seuls ceux qui regardent vraiment remarquent. ${pA.name} et ${pB.name} — plus que des pilotes dans la même course.`,
          ]) +
          `

Dans ce paddock souvent dur, impitoyable, leur relation tranche. *"Ça fait du bien de voir ça"*, confie un mécanicien qui a connu les deux. Rares sont ceux qui peuvent se battre sur la piste et rire ensemble après.`;
      },
      coequipiers: () => {
        return `On attendait la guerre froide. On a eu autre chose.

` +
          `${pA.name} et ${pB.name}, sous le même toit de ${teamA.emoji}${teamA.name}, auraient pu être des rivaux toxiques. La plupart du temps, dans ce sport, c'est ce qui se passe.

` +
          pick([
            `Mais depuis le début de saison, quelque chose fonctionne. Les données télémétrie partagées sans conditions. Les debriefs qui durent. ${pA.name} avait quelque chose à dire après ${circuit} : *"${pB.name} m'a aidé à comprendre pourquoi je perdais du temps dans la section 2. Sans ça, je ne finissais pas là."*`,
            `${pA.name} ne fait pas semblant : *"${pB.name} est l'un des pilotes les plus sérieux que j'ai côtoyés. Et il ne se plaint jamais. C'est contagieux."* Une reconnaissance publique, rare dans ce paddock.`,
          ]);
      },
      rivaux_respectueux: () => {
        return `Adversaires sur la piste. Ce que font ${pA.name} et ${pB.name} en dehors, c'est une autre histoire.

` +
          pick([
            `À ${circuit}, ils se sont battus roue dans roue pendant plusieurs tours. À la fin, ${pA.name} a cherché ${pB.name} dans les couloirs de la pesée. Pas pour protester — pour lui dire que c'était *"l'un des meilleurs duels de la saison"*. ${pB.name} a acquiescé. Rien d'autre à ajouter.`,
            `Le paddock les observe depuis le début de saison. Deux pilotes qui auraient toutes les raisons de se haïr — et qui semblent, au contraire, se nourrir de cette compétition saine. *"Il m'a forcé à être meilleur"*, dit ${pA.name} sans hésiter quand on lui pose la question.`,
          ]) +
          `

Ce genre de rivalité positive fait du bien au sport. Et le paddock, qui en a vu d'autres, sait les reconnaître.`;
      },
    },
    respect_fort: {
      podium: () => {
        return `À ${circuit}, les résultats étaient là pour les deux : ${pA.name} P${rA.pos}, ${pB.name} P${rB.pos}.

` +
          `Ce qui a retenu l'attention, c'est l'après. ${pA.name} n'a pas attendu les caméras pour aller féliciter ${teamB.emoji}${pB.name}. Court, direct. *"${pick(['Belle course. Tu l\'as construit tour après tour.', 'Chapeau. La gestion des pneus était parfaite.', 'Mérité. Je suis content pour toi.'])}"*

` +
          `Ces moments n'existent pas dans toutes les grilles. Ici, ils témoignent d'une estime mutuelle construite sur la durée.`;
      },
      coequipiers: () => {
        return `Dans le sport de haut niveau, les rivalités internes font les manchettes. Les complicités, moins.

` +
          `Chez ${teamA.emoji}${teamA.name}, ${pA.name} parle de ${pB.name} avec une franchise inhabituelle : *"${pick(['Il travaille plus dur que n\'importe qui dans ce garage. C\'est difficile de ne pas le respecter.', 'On ne s\'est jamais tiré dans les pattes. On se bat sur la piste, on collabore ailleurs. Ça marche.', 'Je n\'aurais pas fait le même bilan sans lui. Et je pense qu\'il dirait la même chose.'])}"*

` +
          `Une relation coéquipiers qui fait de ${teamA.name} une équipe plus forte collectivement.`;
      },
      rivaux_respectueux: () => {
        return `${pA.name} sur ${pB.name}, après ${circuit} : *"${pick(['Il est dans une forme incroyable. Ça me force à donner plus.', 'Je regardais ses données et j\'ai compris pourquoi il était plus rapide. Je lui ai demandé. Il m\'a répondu. C\'est rare.', 'On se respecte. On se bat. C\'est comme ça que ça devrait toujours être.'])}"*

` +
          `Dans un paddock où les mots sont souvent pesés, calculés, neutres — cette déclaration tranche. ${pA.name} ne donne pas dans la politesse de façade. Et ça, le paddock le sait.`;
      },
    },
    cordialite: {
      podium: () => {
        return `P${rA.pos} et P${rB.pos} ce week-end à ${circuit} — ${pA.name} et ${pB.name} ont tous les deux marqué des points importants.

` +
          `Après la course, la scène a été brève mais significative : une poignée de main, quelques mots échangés à la pesée. *"${pick(['Bonne course.', 'Bien joué.', 'On s\'est bien battus.'])}"* Court. Mais sincère.

` +
          `Dans un sport où les tensions débordent souvent sur l'humain, les petits gestes de sportivité méritent d'être notés.`;
      },
      coequipiers: () => {
        return `Chez ${teamA.emoji}${teamA.name}, on s'attendait peut-être à plus de friction. Deux pilotes, un seul garage, des ressources limitées — la recette habituelle du clash.

` +
          `${pA.name} et ${pB.name} ont décidé d'aborder ça différemment. *"${pick(['On travaille. On se respecte. Pas besoin de plus.', 'L\'ambiance dans le garage, c\'est ce qui fait la différence sur la piste.', 'On a les mêmes intérêts. Autant faire les choses bien.'])}"* — ${pA.name}, pragmatique.

` +
          `Une relation professionnelle saine dans un environnement où ça n'a rien d'acquis.`;
      },
      rivaux_respectueux: () => {
        return `Ils se battent sur la piste. Ils se respectent dans les couloirs.

` +
          `${pA.name} et ${pB.name} ne sont pas amis. Mais dans le paddock, ce genre de respect mutuel entre adversaires, c'est peut-être plus précieux encore.

` +
          `*"${pick(['C\'est un bon pilote. C\'est tout ce que j\'ai à dire.', 'Je le respecte. On se bat proprement.', 'Il fait son boulot. Moi le mien. Ça se passe bien.'])}"* — ${pA.name} après ${circuit}. Simple. Et rare.`;
      },
    },
  };

  const headlineList = headlines[tier]?.[context];
  const bodyFn       = bodies[tier]?.[context];
  if (!headlineList || !bodyFn) return null;

  return {
    type     : 'friendship',
    source,
    headline : pick(headlineList),
    body     : bodyFn(),
    pilotIds : [pA._id, pB._id],
    teamIds  : [teamA._id, teamB._id],
    seasonYear,
  };
}


// ============================================================
// 🗓️  ANNIVERSAIRES DE FAITS MARQUANTS
// Déclenché dans generatePostRaceNews si une paire a un historique
// sur ce même circuit une saison précédente.
// ============================================================
function genAnniversaryArticle(pA, pB, teamA, teamB, worstEvent, yearsAgo, seasonYear) {
  const source   = pick(['pitlane_insider', 'f1_weekly', 'pl_racing_news', 'paddock_whispers']);
  const ago      = yearsAgo === 1 ? "l\'an dernier" : `il y a ${yearsAgo} an${yearsAgo > 1 ? 's' : ''}`;
  const isNeg    = ['contact_course', 'duel_interne'].includes(worstEvent.event);
  const circuit  = worstEvent.circuit || 'ce circuit';

  const headlines = isNeg ? [
    `${pA.name} / ${pB.name} — ${ago} sur ce circuit, tout avait commencé`,
    `Retour sur l'incident ${pA.name}/${pB.name} : ${ago}, même décor`,
    `${yearsAgo === 1 ? 'Un an' : `${yearsAgo} ans`} après l'accrochage — ${pA.name} et ${pB.name} de retour`,
    `L'histoire se souvient : ${pA.name} et ${pB.name}, ${ago} sur ce même tracé`,
  ] : [
    `${ago} sur ce circuit, ${pA.name} et ${pB.name} partageaient le podium`,
    `Retour nostalgique : ${pA.name} / ${pB.name} et ce circuit qui les a rapprochés`,
    `${pA.name} et ${pB.name} : le circuit du souvenir`,
  ];

  const bodies = isNeg ? [
    `Les circuits ont une mémoire. Celui-ci en particulier.\n\n` +
    `${ago}, **${teamA.emoji}${pA.name}** et **${teamB.emoji}${pB.name}** se retrouvaient en bagarre à cet endroit précis. Ce que tout le monde pensait être un incident isolé s'est avéré n'être que le début d'une longue série.\n\n` +
    pick([
      `Depuis, leurs chemins se sont croisés de nombreuses fois. Rarement pour le meilleur. Ils se retrouvent ici ce week-end.`,
      `Les deux pilotes reviennent sur le lieu de naissance de leur animosité. Le paddock observe avec attention.`,
      `*"On ne choisit pas ses histoires"*, résume un mécanicien de l'époque. *"Elles se construisent toutes seules."*`,
    ]),
    `${ago}, ce circuit. Un contact, un regard noir, quelques mots en pesée.\n\n` +
    `Ni l'un ni l'autre n'en parlait publiquement. Mais les données de l'époque, les captures, les commentaires : tout est encore là.\n\n` +
    `**${pA.name}** et **${pB.name}** se retrouvent cette semaine sur le même tracé. Les blessures d'orgueil ne s'oublient pas avec le temps. Parfois, elles fermentent.`,
  ] : [
    `${ago}, **${teamA.emoji}${pA.name}** et **${teamB.emoji}${pB.name}** se retrouvaient ensemble dans ce même paddock.\n\n` +
    pick([
      `Ces moments-là, le paddock s'en souvient. Pas parce qu'ils sont exceptionnels sportivement, mais parce qu'ils rappellent que ce sport peut être beau.`,
      `${pA.name} avait déclaré à l'époque : *"Partager ça avec lui, c'est particulier."* La formule était simple. Elle disait tout.`,
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

// ============================================================
// 💬  RÉACTION EN CHAÎNE — Droit de réponse
// Quand un article rivalry/drama cible un pilote, 35% de chance
// qu'un article "réponse" soit généré au GP suivant.
// ============================================================
function genChainReactionArticle(pResponder, pCited, teamR, teamC, originalHeadline, seasonYear, triggerType) {
  const source = pick(['paddock_whispers', 'pitlane_insider', 'pl_racing_news', 'f1_weekly']);
  const arch   = pResponder?.personality?.archetype || 'guerrier';
  const isTension = triggerType === 'rivalry' || triggerType === 'drama';

  const headlines = [
    `${pResponder.name} répond à ${pCited.name} — le paddock retient son souffle`,
    `Droit de réponse : ${teamR.emoji} ${pResponder.name} n'a pas digéré`,
    `${pResponder.name} brise le silence après les déclarations de ${pCited.name}`,
    `La réplique de ${pResponder.name} : claire, directe, sans filtre`,
  ];

  const bodyMap = {
    guerrier:        isTension ? `**${teamR.emoji}${pResponder.name}** n'a pas attendu longtemps.\n\n*"Je lis. Je retiens. Et sur la piste, ça se règle comme ça doit se régler."*\n\nCourt. Sans fioritures.`
                               : `*"Je suis content qu'il en parle. Moi j'étais là aussi."* — ${pResponder.name}, sobre et direct.`,
    icone:           isTension ? `**${pResponder.name}** a choisi ses mots avec soin.\n\n*"Je préfère me concentrer sur ce que je contrôle. Ce que disent les autres ne m'atteint pas."*\n\nMessage reçu.`
                               : `*"Il dit de belles choses — et je lui rends la pareille. Ce sport est plus beau quand on se respecte."* — ${pResponder.name}.`,
    bad_boy:         isTension ? `${pResponder.name} n'a pas cherché à tempérer.\n\n*"${pick(["Il peut dire ce qu\'il veut. Rien ne change en piste.", "Sympa le commentaire. J\'en ai un aussi pour le week-end."])}"*`
                               : `*"OK je vais l'admettre. Ce qu'il dit est juste. Mais ne lui répétez pas."* — ${pResponder.name}, avec humour.`,
    vieux_sage:      isTension ? `${pResponder.name} a répondu avec la sérénité de quelqu'un qui a vécu trop de saisons pour s'énerver.\n\n*"${pick(["Ce genre de tension, ça passe. Ou ça empire.", "Les mots passent. Les résultats restent."])}"*`
                               : `*"À mon âge, on sait reconnaître le mérite. ${pCited.name} en a."* — ${pResponder.name}.`,
    rookie_ambitieux:isTension ? `${pResponder.name} a répondu avec la fougue de la jeunesse.\n\n*"Je n'ai pas à me justifier. Je fais mon travail. Si ça ne plaît pas, tant pis."*`
                               : `*"Quand un pilote comme ${pCited.name} dit ça de moi, c'est énorme. Je ne l'oublierai pas."* — ${pResponder.name}.`,
    calculateur:     isTension ? `${pResponder.name} a publié une réponse mesurée, presque clinique.\n\n*"J'ai pris note. J'analyse. Et je réponds sur la piste."*`
                               : `*"Sa performance parle d'elle-même. Je m'en inspire."* — ${pResponder.name}.`,
  };

  const body = bodyMap[arch] ||
    `**${teamR.emoji}${pResponder.name}** a tenu à répondre aux récentes déclarations impliquant **${pCited.name}**.\n\n` +
    `*"${pick(["Il y a des choses qui se règlent sur la piste.", "Pas de commentaire supplémentaire de ma part."])}"*`;

  return {
    type: triggerType === 'friendship' ? 'friendship' : 'rivalry',
    source, headline: pick(headlines), body,
    pilotIds: [pResponder._id, pCited._id],
    teamIds:  [teamR._id, teamC._id],
    seasonYear,
  };
}

// ============================================================
// 🎤  INTERVIEW EXCLUSIVE — Affinité extrême (>= 70 ou <= -65)
// Format Q&A structuré — plus immersif qu'un article narratif
// ============================================================
function genExclusiveInterviewArticle(pA, pB, teamA, teamB, rel, seasonYear) {
  const source    = pick(['f1_weekly', 'pl_racing_news', 'pitlane_insider', 'paddock_mag']);
  const affinity  = rel.affinity;
  const isHostile = affinity <= -65;
  const archA     = pA?.personality?.archetype || 'guerrier';

  const headlines = isHostile ? [
    `Interview exclusive — ${pA.name} : "Ce que je pense vraiment de ${pB.name}"`,
    `${pA.name} sans filtre sur ${pB.name}`,
    `"Je vais être honnête" — ${pA.name} brise le silence`,
    `La déclaration de ${pA.name} sur ${pB.name} que tout le paddock attendait`,
  ] : [
    `${pA.name} : "Ce que ${pB.name} m'a appris sur ce sport"`,
    `"Rarement vu quelqu'un de cette trempe" — ${pA.name} sur ${pB.name}`,
    `"Je l'admire sincèrement" — ${pA.name} rend hommage à ${pB.name}`,
  ];

  const qaMaps = {
    hostile: [
      { q: `Comment décririez-vous votre relation avec ${pB.name} ?`,
        a: { guerrier: `*"On se respecte comme adversaires. Sur la piste, c'est tout. En dehors — on n'est pas proches."*`,
             bad_boy:  `*"Relation ? Je dirais plutôt qu'on cohabite dans le même paddock."*`,
             calculateur:`*"C'est un compétiteur. Je l'analyse. Je l'anticipe. C'est tout."*`,
             icone:    `*"Il y a des pilotes qu'on respecte pour leurs résultats. Ce qui se passe en dehors ne regarde personne."*`,
             vieux_sage:`*"J'ai connu des tensions dans ce sport. Avec ${pB.name}, c'est une tension particulière. Ancienne. Tenace."*`,
             rookie_ambitieux:`*"Je ne vais pas prétendre que c'est simple. Ça ne l'est pas."*` }},
      { q: `Si vous deviez reconnaître une qualité à ${pB.name} ?`,
        a: `*"${pick([`Il est constant. Difficile à déstabiliser. C'est une qualité — même si ça m'a coûté des points.`, `Sa régularité. On peut tout lui reprocher, pas ça.`])}"*` },
      { q: `Un message pour lui, ici ?`,
        a: `*"${pick([`On se retrouvera sur la piste. C'est là que ça compte.`, `Je n'ai rien à lui dire ici que je ne lui dirais pas en face.`])}"*` },
    ],
    friendly: [
      { q: `Beaucoup sont surpris par votre relation avec ${pB.name}. D'où vient-elle ?`,
        a: { guerrier: `*"On se bat sur la piste — mais on se comprend. On a les mêmes obsessions. C'est un lien rare."*`,
             icone:    `*"Ce sport est solitaire. Quand tu trouves quelqu'un qui le vit aussi intensément — tu ne laisses pas passer ça."*`,
             vieux_sage:`*"Avec les années, on apprend à reconnaître les gens vrais. ${pB.name} en est un."*`,
             rookie_ambitieux:`*"Je ne m'y attendais pas moi-même. Mais on se comprend sans tout expliquer."*`,
             bad_boy:  `*"Je ne suis pas du genre à m'épancher. Mais lui, il est différent."*`,
             calculateur:`*"Nos approches sont différentes. Cette complémentarité crée quelque chose."*` }},
      { q: `Qu'est-ce que ${pB.name} vous a apporté sportivement ?`,
        a: `*"${pick([`Il m'a forcé à me dépasser. Chaque fois qu'on est proches en piste, je donne dix pour cent de plus.`, `Une référence. Ses données me montrent ce qui est possible.`])}"*` },
      { q: `Un moment particulier avec lui qui reste gravé ?`,
        a: `*"${pick([`On était sur le podium ensemble. Juste un regard. Il n'y a pas besoin d'en dire plus.`, `Un debriefing après un GP difficile pour nous deux. On est restés deux heures à s'analyser, à se challenger. C'est rare.`])}"*` },
    ],
  };

  const qa = isHostile ? qaMaps.hostile : qaMaps.friendly;
  const body = qa.map(({ q, a }) => {
    const answer = typeof a === 'object' ? (a[archA] || Object.values(a)[0]) : a;
    return `**— ${q}**\n${answer}`;
  }).join('\n\n') + `\n\n*Interview accordée en marge du dernier GP.*`;

  return {
    type: 'driver_interview', source,
    headline: pick(headlines), body,
    pilotIds: [pA._id, pB._id],
    teamIds:  [teamA._id, teamB._id],
    seasonYear,
  };
}

// ============================================================
// 🔗  AFFINITÉS CROISÉES
// Si A déteste B, et que B est ami de C → article "triangle de paddock"
// ============================================================
function genCrossAffinityArticle(pCenter, pAlly, pEnemy, teamC, teamA, teamE, seasonYear) {
  const source = pick(['paddock_whispers', 'speed_gossip', 'pitlane_insider']);
  const headlines = [
    `L'alliance gênante : ${pAlly.name} ami de ${pCenter.name}… et de ${pEnemy.name} ?`,
    `${pAlly.name} entre deux feux : ${pCenter.name} d'un côté, ${pEnemy.name} de l'autre`,
    `Triangle de paddock : ${pCenter.name}, ${pAlly.name} et ${pEnemy.name} — un équilibre impossible`,
    `"Je suis l'ami de tout le monde" — la position délicate de ${pAlly.name}`,
  ];
  const bodies = [
    `Dans ce paddock, les alliances sont rarement simples. Celle de **${pAlly.name}** l'est encore moins.\n\n` +
    `D'un côté, une relation solide avec **${teamC.emoji}${pCenter.name}**. De l'autre, une complicité évidente avec **${teamE.emoji}${pEnemy.name}**. Le problème ? Ces deux-là ne se supportent pas.\n\n` +
    pick([
      `Chaque fois que la tension entre ${pCenter.name} et ${pEnemy.name} monte, c'est ${pAlly.name} qui doit choisir ses mots avec soin.`,
      `*"Il essaie de ne pas s'impliquer. Mais dans ce sport, l'indépendance totale est un luxe que peu peuvent se permettre."*`,
      `La question n'est pas de savoir si ${pAlly.name} prendra parti un jour. C'est de savoir quand.`,
    ]),
    `Il y a les rivalités que tout le monde voit. Et il y a les situations que personne ne veut vraiment regarder.\n\n` +
    `**${pAlly.name}** entretient des liens forts avec deux pilotes qui se vouent une hostilité bien documentée : **${pCenter.name}** et **${pEnemy.name}**.\n\n` +
    `*"C'est sa force et son problème"*, analyse un observateur du paddock. *"Il est apprécié de tout le monde — ce qui devient très compliqué quand tout le monde ne s'apprécie pas."*`,
  ];
  const teamIds = [...new Set([String(teamC._id), String(teamA._id), String(teamE._id)])]
    .map(id => [teamC, teamA, teamE].find(t => String(t._id) === id)?._id).filter(Boolean);
  return {
    type: 'drama', source,
    headline: pick(headlines), body: pick(bodies),
    pilotIds: [pAlly._id, pCenter._id, pEnemy._id],
    teamIds, seasonYear,
  };
}

// ============================================================
// 🔄  TRANSFERT QUI IMPACTE LES RELATIONS
// Appelé depuis publishSigningRumors (vraie signature).
// Impact sur ex-coéquipiers, nouveaux coéquipiers, cohabitation.
// ============================================================
async function applyTransferAffinityImpact(pilot, newTeam, oldTeamId, channel, seasonYear) {
  if (!pilot) return;
  try {
    const allPilots = await Pilot.find({ teamId: { $ne: null } });

    // Ex-coéquipiers → la relation évolue selon ce qui existait
    if (oldTeamId) {
      const exTeammates = allPilots.filter(p =>
        String(p.teamId) === String(oldTeamId) && String(p._id) !== String(pilot._id));
      for (const ex of exTeammates) {
        const [sA, sB] = [String(pilot._id), String(ex._id)].sort();
        let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
        if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });
        const delta = rel.affinity >= 20 ? -5 : rel.affinity < -20 ? 5 : -3;
        const event = rel.affinity >= 20 ? 'depart_equipe_deception' : 'depart_equipe_soulagement';
        rel.affinity = Math.max(-100, Math.min(100, rel.affinity + delta));
        rel.type = rel.affinity >= 60?'amis':rel.affinity>=20?'respect':rel.affinity>-20?'neutre':rel.affinity>-60?'tension':'ennemis';
        rel.history.push({ event, delta, date: new Date(), seasonYear });
        if (rel.history.length > 30) rel.history = rel.history.slice(-30);
        try { await rel.save(); } catch(e) {}
      }
    }

    // Nouveaux coéquipiers → honeymoon period ou cohabitation forcée
    const newTeammates = allPilots.filter(p =>
      String(p.teamId) === String(newTeam._id) && String(p._id) !== String(pilot._id));
    for (const nt of newTeammates) {
      const [sA, sB] = [String(pilot._id), String(nt._id)].sort();
      let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
      if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });
      const isForced = rel.affinity < -30;
      const delta = isForced ? 8 : 6;
      const event = isForced ? 'cohabitation_forcee' : 'nouveau_coequipier';
      rel.affinity = Math.max(-100, Math.min(100, rel.affinity + delta));
      rel.type = rel.affinity >= 60?'amis':rel.affinity>=20?'respect':rel.affinity>-20?'neutre':rel.affinity>-60?'tension':'ennemis';
      if (isForced) rel.pendingReplyCtx = { cohabitation: true };
      rel.history.push({ event, delta, date: new Date(), seasonYear });
      if (rel.history.length > 30) rel.history = rel.history.slice(-30);
      try { await rel.save(); } catch(e) {}

      // Article cohabitation forcée si relation était tendue
      if (isForced && channel && Math.random() < 0.70) {
        const allTeams = await Team.find();
        const teamMap  = new Map(allTeams.map(t => [String(t._id), t]));
        const tNew = teamMap.get(String(newTeam._id));
        if (tNew) {
          const art = genCohabitationArticle(pilot, nt, tNew, rel.affinity - delta, seasonYear);
          if (art) {
            try {
              const saved = await NewsArticle.create({ ...art, triggered: 'transfer', publishedAt: new Date() });
              await sleep(5000);
              await publishNews(saved, channel);
            } catch(e) { console.error('[cohabitation article]', e.message); }
          }
        }
      }
    }
  } catch(e) { console.error('[applyTransferAffinityImpact]', e.message); }
}

function genCohabitationArticle(pNew, pExisting, team, oldAffinity, seasonYear) {
  const source   = pick(['pitlane_insider', 'paddock_whispers', 'f1_weekly', 'pl_racing_news']);
  const wasEnemy = oldAffinity < -40;

  const headlines = wasEnemy ? [
    `Choc de paddock : ${pNew.name} et ${pExisting.name} dans la même écurie`,
    `${team.emoji} ${team.name} : l'union forcée — ${pNew.name} et ${pExisting.name} sous le même toit`,
    `"Ça va être intéressant" — le duo explosif ${pNew.name}/${pExisting.name} chez ${team.name}`,
    `L'histoire retiendra ce moment : ${pNew.name} et ${pExisting.name} coéquipiers`,
  ] : [
    `${pNew.name} rejoint ${pExisting.name} chez ${team.emoji} ${team.name} — surprise ou logique ?`,
    `${pNew.name} chez ${team.name} : ce que ça change pour ${pExisting.name}`,
  ];

  const bodies = wasEnemy ? [
    `Le paddock a eu besoin de quelques secondes pour réaliser. Puis les messages ont afflué.\n\n` +
    `**${pNew.name}** et **${pExisting.name}** — deux pilotes dont l'animosité mutuelle est l'une des mieux documentées de la grille — vont désormais partager un garage, une infrastructure, un ingénieur en chef.\n\n` +
    pick([
      `La question que tout le monde se pose : comment ${team.emoji} ${team.name} va-t-il gérer cette dynamique explosive ? Les équipes qui ont tenté l'expérience ont rarement survécu indemnes.`,
      `Les proches des deux camps sont circonspects. *"Ils sont des professionnels. Ils feront leur travail."* La formule revient des deux côtés, avec exactement le même ton forcé.`,
    ]) + `\n\n${team.emoji} **${team.name}** n'a pas commenté au-delà du communiqué officiel. La conférence pré-saison s'annonce mémorable.`,
  ] : [
    `L'arrivée de **${pNew.name}** modifie l'équilibre interne de ${team.emoji} **${team.name}**.\n\n` +
    `**${pExisting.name}**, jusque-là dans un rôle établi, va devoir composer avec un nouveau challenger. Leur relation n'est pas hostile — mais pas simple non plus.\n\n` +
    `Le management affirme avoir "longuement réfléchi à la dynamique interne". La saison jugera.`,
  ];

  return {
    type: 'drama', source,
    headline: pick(headlines), body: pick(bodies),
    pilotIds: [pNew._id, pExisting._id],
    teamIds: [team._id],
    seasonYear,
  };
}

// ============================================================
// 🏛️  LEGACY INTER-SAISONS — Cohabitation forcée pré-saison
// Appelé depuis createNewSeason après la grille finale.
// Détecte les paires ex-adversaires maintenant coéquipiers et génère
// des articles "contexte historique" avant le premier GP.
// ============================================================
async function generateLegacyCohabitationNews(season, channel) {
  try {
    const allPilots = await Pilot.find({ teamId: { $ne: null } });
    const allTeams  = await Team.find();
    const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));
    const processed = new Set();

    for (const pilot of allPilots) {
      const tid       = String(pilot.teamId);
      const teammates = allPilots.filter(p => String(p.teamId) === tid && String(p._id) !== String(pilot._id));
      for (const tm of teammates) {
        const pairKey = [String(pilot._id), String(tm._id)].sort().join('_');
        if (processed.has(pairKey)) continue;
        processed.add(pairKey);

        const [sA, sB] = [String(pilot._id), String(tm._id)].sort();
        let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
        if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });

        // ── Incrémenter sharedTeamSeasons ──────────────────────
        // Ce compteur trace depuis combien de saisons ces deux pilotes sont coéquipiers.
        // Il est lu dans les articles cohabitation et les confs de presse pour enrichir les narratives.
        rel.sharedTeamSeasons = (rel.sharedTeamSeasons || 0) + 1;
        await rel.save();

        const team = teamMap.get(tid);
        if (!team) continue;

        // ── Duo long terme (≥ 2 saisons ensemble) ──────────────
        // Indépendamment de l'affinité : un duo qui dure génère toujours un article
        // Tons très différents selon que c'est de l'amitié ou de la haine
        if (rel.sharedTeamSeasons >= 2 && Math.random() < 0.60) {
          const worstEvent2 = rel.history
            .filter(h => ['contact_course', 'duel_interne'].includes(h.event))
            .sort((a, b) => (a.delta || 0) - (b.delta || 0))[0];
          const yearsAgo2 = worstEvent2?.seasonYear ? season.year - worstEvent2.seasonYear : rel.sharedTeamSeasons;
          const article2 = genLongTermDuoArticle(pilot, tm, team, rel, season.year);
          if (article2 && channel) {
            try {
              const art = await NewsArticle.create({ ...article2, triggered: 'preseason', publishedAt: new Date() });
              await sleep(3000);
              await publishNews(art, channel);
            } catch(e) { console.error('[long term duo]', e.message); }
          }
        }

        if (rel.affinity >= -20) continue; // articles de tension seulement si tensions réelles

        // Trouver l'événement le plus marquant de leur histoire commune
        const worstEvent = rel.history
          .filter(h => ['contact_course', 'duel_interne'].includes(h.event))
          .sort((a, b) => (a.delta || 0) - (b.delta || 0))[0];

        if (Math.random() < 0.65) {
          const yearsAgo    = worstEvent?.seasonYear ? season.year - worstEvent.seasonYear : 1;
          const article     = genLegacyCohabitationArticle(pilot, tm, team, rel, worstEvent, yearsAgo, season.year);
          if (article && channel) {
            try {
              const art = await NewsArticle.create({ ...article, triggered: 'preseason', publishedAt: new Date() });
              await sleep(4000);
              await publishNews(art, channel);
            } catch(e) { console.error('[legacy cohabitation]', e.message); }
          }
        }
      }
    }
    console.log('[Legacy] Analyse cohabitation forcée terminée.');
  } catch(e) { console.error('[generateLegacyCohabitationNews]', e.message); }
}

// ── Duo longue durée (sharedTeamSeasons ≥ 2) ─────────────────
// Génère un article "contexte historique" sur un duo qui dure.
// Ton radicalement différent selon affinité : légende vs guerre froide.
// ============================================================
// 🎭  ACTION PADDOCK — articles générés par les joueurs
// 8 types d'actions avec contenu original et impact affinité
// ============================================================
function generatePaddockAction(pSrc, pTgt, tSrc, tTgt, type, currentAffinity, seasonYear, isTeammate, isRival, recentCtx = {}) {
  const source = pick(['paddock_whispers', 'pitlane_insider', 'pl_racing_news', 'f1_weekly']);
  const tSrcStr = tSrc ? `${tSrc.emoji} ${tSrc.name}` : '?';
  const tTgtStr = tTgt ? `${tTgt.emoji} ${tTgt.name}` : '?';
  const nickTgt = pTgt.nickname ? ` — alias ${pTgt.nickname}` : '';
  const archSrc     = pSrc.personality?.archetype     || 'guerrier';
  const archTgt     = pTgt.personality?.archetype     || 'guerrier';
  const pressureSrc = pSrc.personality?.pressureLevel || 0;
  const highPressure = pressureSrc >= 60;

  // ── Contexte récent ──────────────────────────────────────────
  const tgtDnf     = recentCtx.tgtDnf    || false;
  const tgtWon     = recentCtx.tgtWon    || false;
  const tgtPodium  = recentCtx.tgtPodium || false;
  const tgtPos     = recentCtx.tgtPos    || null;
  const circuit    = recentCtx.circuit   || null;
  const circuitStr = circuit ? ` à ${circuit}` : '';
  const dnfReason  = recentCtx.tgtDnfReason || null;
  const srcPos     = recentCtx.srcPos    || null;
  const srcDnf     = recentCtx.srcDnf    || false;

  // Classement au championnat
  const srcChampPos = recentCtx.srcChampPos ?? null;
  const tgtChampPos = recentCtx.tgtChampPos ?? null;
  const srcChampPts = recentCtx.srcChampPts ?? null;
  const tgtChampPts = recentCtx.tgtChampPts ?? null;
  const champGap    = recentCtx.champGap    ?? null;

  const srcAheadInChamp = srcChampPos !== null && tgtChampPos !== null && srcChampPos < tgtChampPos;
  const sameChampZone   = srcChampPos !== null && tgtChampPos !== null && Math.abs(srcChampPos - tgtChampPos) <= 2;

  const champCtxLine = (() => {
    if (srcChampPos === null || tgtChampPos === null) return null;
    if (srcChampPos === 1)
      return `Au classement, **${pSrc.name}** mène le championnat — **${pTgt.name}** pointe à P${tgtChampPos}${srcChampPts !== null && tgtChampPts !== null ? ` avec ${srcChampPts - tgtChampPts} pts d'écart` : ''}.`;
    if (tgtChampPos === 1)
      return `**${pTgt.name}** est leader du championnat — **${pSrc.name}** le suit à P${srcChampPos}${champGap !== null ? `, à ${Math.abs(champGap)} pts` : ''}.`;
    if (sameChampZone)
      return `Au championnat, tout se joue entre eux : P${Math.min(srcChampPos,tgtChampPos)} et P${Math.max(srcChampPos,tgtChampPos)}, séparés de ${champGap !== null ? Math.abs(champGap) + ' pts' : 'peu de points'}.`;
    if (srcAheadInChamp)
      return `**${pSrc.name}** devance **${pTgt.name}** au championnat (P${srcChampPos} vs P${tgtChampPos}${champGap !== null ? `, +${Math.abs(champGap)} pts` : ''}).`;
    return `**${pTgt.name}** devance **${pSrc.name}** au championnat (P${tgtChampPos} vs P${srcChampPos}${champGap !== null ? `, ${Math.abs(champGap)} pts d'écart` : ''}).`;
  })();

  // ── Helpers contexte course ──────────────────────────────────
  const dnfCtxLine = tgtDnf ? pick([
    `Son abandon${circuitStr}${dnfReason ? ` (${dnfReason})` : ''} est encore frais dans les mémoires.`,
    `Après le DNF${circuitStr}, la pression avait déjà commencé à monter autour de **${pTgt.name}**.`,
    `Le dernier GP${circuitStr} n'a pas été tendre avec **${pTgt.name}** — et ${pSrc.name} n'a pas oublié.`,
  ]) : null;

  const winCtxLine = tgtWon ? pick([
    `Sa victoire${circuitStr} lui avait pourtant offert un capital confiance solide.`,
    `Quelques jours après sa victoire${circuitStr}, le contexte change vite dans ce paddock.`,
    `Malgré la victoire${circuitStr}, tout le monde n'est pas prêt à lui remettre les clés du championnat.`,
  ]) : null;

  const podCtxLine = (!tgtWon && tgtPodium && tgtPos) ? pick([
    `Son P${tgtPos}${circuitStr} lui avait valu quelques éloges. Tous ne partagent pas cet avis.`,
    `Après un podium${circuitStr}, on aurait pu croire les critiques muselées. On avait tort.`,
  ]) : null;

  const ctxHook = dnfCtxLine || winCtxLine || podCtxLine || champCtxLine || '';

  // ── Citations par archétype de la SOURCE ─────────────────────
  // Chaque archétype a un style de prise de parole distinct :
  // guerrier = direct, émotionnel, impulsif
  // icone = calibré, diplomatique, jamais agressif ouvertement
  // bad_boy = sarcastique, punchline courte, dédaigneux
  // calculateur = froid, factuel, statistiques
  // vieux_sage = ironique, détaché, sous-entendu
  // rookie_ambitieux = sincère, parfois maladroit dans l'audace
  const QUOTES = {
    trash_talk: {
      guerrier:         tgtDnf ? `"Le DNF${circuitStr} ? Je ne vais pas faire semblant que ça n'existe pas. On perd des points à cause de lui. Moi je donne tout. Ce n'est pas toujours réciproque."`
                                : `"${pTgt.name} ? Je dis ce que tout le monde pense tout bas. Il n'est pas au niveau. Point."`,
      icone:            tgtDnf ? `"Je préfère ne pas trop commenter le GP${circuitStr}. Mais les chiffres sont là. Et ils ne mentent pas."`
                                : `"${pTgt.name} a de belles qualités. Mais entre la réputation et la réalité, il y a parfois un écart. On l'a vu."`,
      bad_boy:          tgtDnf ? `"Son abandon${circuitStr} ? Choquant. Vraiment. Enfin... pas tant que ça."`
                                : `"${pTgt.name} surévalué ? Je dirais juste... correctement évalué par les mauvaises personnes."`,
      calculateur:      tgtDnf ? `"Le DNF${circuitStr} représente des points perdus pour l'écurie. Ce n'est pas un incident isolé. C'est une tendance."`
                                : `"Si on regarde les données objectivement, ${pTgt.name} sous-performe sur circuits techniques. Ce n'est pas une opinion, c'est un constat."`,
      vieux_sage:       tgtDnf ? `"J'ai vu beaucoup de DNFs dans ma carrière. Certains arrivent. Certains se provoquent. Je ne dis pas lequel est le cas ici."`
                                : `"${pTgt.name} est bon. Mais le paddock a la mémoire courte. Moi, non."`,
      rookie_ambitieux: tgtDnf ? `"Je... le DNF${circuitStr} c'est dur à regarder. Je ne comprends pas comment on arrive là."`
                                : `"Peut-être que je n'aurais pas dû le dire, mais ${pTgt.name} ne fait pas ce qu'on lui reproche. Il fait mieux — pour lui."`,
    },
    vanne: {
      guerrier:         tgtDnf ? `"Un DNF${circuitStr}... Je ne veux pas me moquer. Mais si quelqu'un pouvait lui expliquer comment on finit une course..."`
                                : `"${pTgt.name} ? Il est régulier. Régulièrement... là. Quelque part entre P8 et 'on le cherche encore'."`,
      icone:            tgtDnf ? `"Je ne vais pas commenter le GP de ${pTgt.name}. Ce serait indélicat." *Pause.* "Disons juste que je dormais mieux que lui dimanche soir."`
                                : `"${pTgt.name} fait un travail solide. Vraiment." *Sourire.* "Pour son budget."`,
      bad_boy:          tgtDnf ? `"Son abandon${circuitStr} ? Je suis trop gentil pour commenter. Alors je ne dis rien." *Sourire.*`
                                : `"${pTgt.name} est fantastique. Pour un pilote de simulation."`,
      calculateur:      tgtDnf ? `"Statistiquement, le taux d'abandon de ${pTgt.name} cette saison est au-dessus de la moyenne. Je dis juste que les chiffres sont là."`
                                : `"Si je devais modéliser le pilote moyen de ce championnat, ${pTgt.name} serait une bonne référence. C'est objectif."`,
      vieux_sage:       tgtDnf ? `"Après un certain âge, on arrête d'être surpris par ce genre de chose. ${pTgt.name} me fait me sentir très, très vieux."`
                                : `"${pTgt.name} me rappelle quelqu'un que j'ai croisé il y a vingt ans. Je ne me souviens plus de son nom. C'est tout dire."`,
      rookie_ambitieux: tgtDnf ? `"Je ne veux pas me moquer de son DNF${circuitStr}. Enfin... à ce stade de la saison, on sait plus si c'est de la malchance ou..."`
                                : `"${pTgt.name} c'est vraiment bien ! Pour quelqu'un qui fait ce qu'il fait. Vous voyez ce que je veux dire ?"`,
    },
    eloge: {
      guerrier:         tgtWon ? `"Sa victoire${circuitStr} ? Méritée. Dur à dire, mais méritée. Je reviendrai."`
                                : `"${pTgt.name} se bat vraiment. Je n'aime pas perdre contre lui. Mais je respecte comment il se bat."`,
      icone:            tgtWon ? `"${pTgt.name} a livré une course impeccable${circuitStr}. L'écurie, la stratégie, le pilote — tout s'est aligné. Chapeau."`
                                : `"${pTgt.name} apporte quelque chose de particulier à ce sport. La régularité, la cohérence. C'est rare, et ça mérite d'être dit."`,
      bad_boy:          tgtWon ? `"Ok, il a gagné${circuitStr}. C'était propre. Je déteste admettre ça, mais c'était propre."`
                                : `"${pTgt.name} ? Il ne me déçoit jamais. Et je ne dis pas ça souvent. Profitez-en."`,
      calculateur:      tgtWon ? `"La gestion de ${pTgt.name}${circuitStr} était optimale. Pneus, dégradation, timing aux stands — chaque décision était correcte. Du pilotage intelligent."`
                                : `"D'un point de vue analytique, ${pTgt.name} est sous-estimé. Ses données de secteur sont parmi les meilleures de la grille."`,
      vieux_sage:       tgtWon ? `"Il a gagné${circuitStr} comme quelqu'un qui sait ce qu'il fait. Pas de bruit. Pas d'esbroufe. Juste de la vitesse au bon moment."`
                                : `"J'observe ${pTgt.name} depuis quelques saisons. Il grandit bien. Très bien, même. Ce n'est pas rien, dans ce paddock."`,
      rookie_ambitieux: tgtWon ? `"INCROYABLE sa course${circuitStr} !! J'ai regardé ses données — comment il a géré ses pneus ?? Je veux être à ce niveau."`
                                : `"${pTgt.name} est quelqu'un que j'admire vraiment. Sa façon de travailler, de ne jamais lâcher — c'est ce que j'essaie de construire aussi."`,
    },
    trahison: {
      guerrier:         `"Je n'aurais peut-être pas dû dire ça. Mais je suis comme ça — je dis ce que je pense. ${pTgt.name} a dit des choses. Maintenant tout le monde le sait."`,
      icone:            `"Il y a un moment où la loyauté devient de la complicité. Ce que ${pTgt.name} a dit en privé méritait d'être su."`,
      bad_boy:          `"${pTgt.name} voulait garder ça pour lui. Dommage. Moi je garde rien pour moi."`,
      calculateur:      `"Je livre ces informations parce qu'elles sont factuelles et vérifiables. Ce que ${pTgt.name} a dit en interne devait être connu."`,
      vieux_sage:       `"Dans ce sport, les secrets ont une durée de vie limitée. Autant qu'ils sortent maintenant, et bien, plutôt que plus tard, et mal."`,
      rookie_ambitieux: `"Je sais que ça va faire du bruit. Mais ce que ${pTgt.name} a dit, c'est pas normal. Les gens doivent savoir."`,
    },
    dementir: {
      guerrier:         tgtDnf ? `"Un DNF ne définit pas un pilote. Ceux qui profitent de ça pour lui tomber dessus n'ont jamais rien construit."`
                                : `"Ce qui circule sur ${pTgt.name}, c'est des conneries. Je l'ai vu bosser. Laissez-le tranquille."`,
      icone:            tgtDnf ? `"Je préférerais qu'on juge ${pTgt.name} sur l'ensemble de sa saison. Ce serait plus juste — et plus intelligent."`
                                : `"Les rumeurs sur ${pTgt.name} sont inexactes. Je le dis clairement, en mon nom propre."`,
      bad_boy:          tgtDnf ? `"Tout le monde tape sur ${pTgt.name} après son abandon${circuitStr}. Facile. Très courageux." *Applaudissements lents.*`
                                : `"${pTgt.name} n'a pas besoin que je le défende. Mais je le fais quand même. Parce que ce qu'on dit sur lui, c'est nul."`,
      calculateur:      tgtDnf ? `"Un DNF peut avoir de nombreuses causes. Conclure sur les capacités de ${pTgt.name} serait une erreur d'analyse."`
                                : `"Les informations qui circulent sur ${pTgt.name} ne correspondent pas aux données que j'observe."`,
      vieux_sage:       tgtDnf ? `"J'ai eu des DNFs dans ma carrière. Ceux qui ne l'ont jamais vécu devraient peser leurs mots."`
                                : `"Ce que j'entends sur ${pTgt.name}... Le paddock a toujours aimé les histoires simples. La réalité est rarement aussi simple."`,
      rookie_ambitieux: tgtDnf ? `"C'est dur de voir tout le monde s'acharner. Un DNF ça arrive à n'importe qui. Vraiment. N'importe qui."`
                                : `"Je trouve vraiment injuste ce qu'on dit sur ${pTgt.name}. Il bosse dur, il mérite mieux que ça."`,
    },
    defi: {
      guerrier:         tgtWon  ? `"Sa victoire${circuitStr} ? Bien joué. La prochaine fois, je serai là pour l'empêcher."`
                      : tgtChampPos === 1 ? `"Il mène le championnat. Très bien. Moi je le chasse. Et je chasse bien."`
                                : `"${pTgt.name} et moi, on va se retrouver sur la piste. Et j'attends de voir s'il est aussi fort que ça."`,
      icone:            tgtWon  ? `"${pTgt.name} a montré ce dont il est capable${circuitStr}. Je prends note. Le prochain GP sera intéressant."`
                      : tgtChampPos === 1 ? `"Mener le championnat ne signifie pas le gagner. Je reste là. Et j'ai la patience qu'il faut."`
                                : `"Je fais confiance à la piste pour répondre à toutes les questions. Je n'ai rien de plus à dire — sauf que je serai prêt."`,
      bad_boy:          tgtWon  ? `"Bravo${circuitStr}. Sérieusement. Profite. La prochaine fois je suis là et je n'aurai pas autant de sportivité."`
                      : tgtChampPos === 1 ? `"Leader du championnat ? Pour l'instant. Le classement, ça change vite. Demandez-lui."`
                                : `"${pTgt.name} veut se battre ? Avec plaisir. Il sait où me trouver."`,
      calculateur:      tgtWon  ? `"La victoire de ${pTgt.name}${circuitStr} m'a fourni des données utiles. Je sais maintenant exactement où gagner du temps sur lui."`
                      : tgtChampPos === 1 ? `"P${tgtChampPos} au championnat, P${srcChampPos || '?'} pour moi. L'écart se comble. C'est mathématique."`
                                : `"${pTgt.name} et moi avons des trajectoires qui convergent. Sur la piste, la question se résoudra d'elle-même."`,
      vieux_sage:       tgtWon  ? `"Il a gagné${circuitStr}. À son âge, c'est bien. À mon expérience, c'est instructif. On verra la suite."`
                      : tgtChampPos === 1 ? `"Mener un championnat, c'est aussi apprendre à être chassé. Bienvenue dans la vraie course, ${pTgt.name}."`
                                : `"Je ne crie pas mes intentions. Je les montre sur la piste. ${pTgt.name} comprendra le message en temps voulu."`,
      rookie_ambitieux: tgtWon  ? `"Sa victoire${circuitStr} était incroyable. Mais je veux être là moi aussi. Et je vais y arriver."`
                      : tgtChampPos === 1 ? `"Il est P${tgtChampPos}, moi P${srcChampPos || '?'}. L'objectif c'est de le rattraper. Je n'abandonne pas."`
                                : `"Je ne prétends pas être meilleur que ${pTgt.name}. Mais je vais tout donner pour le prouver."`,
    },
    secret: {
      guerrier:         `"Je n'aurais peut-être pas dû dire ça. Mais je suis comme ça. ${pTgt.name} peut s'expliquer maintenant."`,
      icone:            `"Je comprends que ce que je révèle sur ${pTgt.name} puisse choquer. Mais la transparence a un coût. Je le paye volontiers."`,
      bad_boy:          `"${pTgt.name} voulait garder ça pour lui ? C'est mignon. Les secrets, c'est fait pour sortir. Je suis juste le messager."`,
      calculateur:      `"Ces informations étaient connues d'un petit cercle. Je les rends publiques parce qu'elles ont une incidence sur ce sport."`,
      vieux_sage:       `"Ce que je dis sur ${pTgt.name} ? Ce n'est pas une trahison. C'est juste la réalité qui refait surface."`,
      rookie_ambitieux: `"Je sais que ça va créer des problèmes. Mais ce que ${pTgt.name} a dit — ou fait — ça ne peut pas rester caché."`,
    },
    // Rumeur = anonyme, on adapte le descripteur de la source selon l'archétype de pSrc
    rumeur: {
      guerrier:         `un proche du paddock, visiblement excédé`,
      icone:            `une source bien informée, qui a souhaité rester anonyme`,
      bad_boy:          `quelqu'un qui "n'a rien à perdre", selon ses propres mots`,
      calculateur:      `une source interne, qui parle de "données préoccupantes"`,
      vieux_sage:       `une figure expérimentée du paddock, qui "en a vu d'autres"`,
      rookie_ambitieux: `une source surprise elle-même par ce qu'elle a appris`,
    },
  };

  const srcQuote = QUOTES[type]?.[archSrc] || null;

  // ── Introductions narratives par archétype de la SOURCE ──────
  const INTROS = {
    guerrier:         [`**${pSrc.name}** n'a pas pris de gants.`, `**${pSrc.name}** a attendu la question. Et quand elle est venue, il a répondu sans filtre.`, `Personne dans ce paddock ne parle comme **${pSrc.name}** quand il est décidé à dire quelque chose.`],
    icone:            [`**${pSrc.name}** a choisi ses mots avec soin. Mais aucun ne laisse de place au doute.`, `La conférence avait commencé comme toutes les autres. Jusqu'à ce que **${pSrc.name}** prenne la parole.`, `Il y a une manière de dire les choses sans avoir l'air de les dire. **${pSrc.name}** la maîtrise parfaitement.`],
    bad_boy:          [`**${pSrc.name}** n'a pas préparé de discours. Ce n'est pas son style.`, `Trois secondes. C'est le temps qu'il a fallu à **${pSrc.name}** pour lâcher ce que tout le paddock retient.`, `**${pSrc.name}** a souri avant de parler. Ce n'était pas bon signe pour ${pTgt.name}.`],
    calculateur:      [`**${pSrc.name}** ne parle pas souvent en dehors de la piste. Quand il le fait, c'est calculé.`, `Les mots de **${pSrc.name}** étaient mesurés, précis, et d'autant plus dévastateurs.`, `**${pSrc.name}** a attendu d'avoir les données. Maintenant il parle.`],
    vieux_sage:       [`**${pSrc.name}** a l'habitude de laisser les résultats parler. Cette fois, il a parlé lui-même.`, `Rares sont les fois où **${pSrc.name}** sort de sa réserve. Aujourd'hui, il l'a fait.`, `Quelqu'un a posé la bonne question à **${pSrc.name}**. Ou la mauvaise, selon le point de vue.`],
    rookie_ambitieux: [`**${pSrc.name}** n'a probablement pas pesé chaque mot. Mais l'impact est réel.`, `C'est le genre de déclaration qu'on fait quand on est encore un peu naïf — ou très courageux. **${pSrc.name}** a pris la parole.`, `**${pSrc.name}** apprend vite. Peut-être trop vite, pour certains dans le paddock.`],
  };
  const srcIntro = pick(INTROS[archSrc] || INTROS.guerrier);

  // ── Réactions de la CIBLE selon son archétype ───────────────
  const TGT_REACTIONS = {
    guerrier:         pick([`${pTgt.name} n'a pas tardé à réagir — et ça ne devrait surprendre personne.`, `${pTgt.name} ne laisse jamais ce genre de chose sans réponse. Le paddock attend.`]),
    icone:            pick([`${pTgt.name} a transmis un communiqué mesuré. Mais le message était clair.`, `L'entourage de ${pTgt.name} a *"pris note"*. Traduction : rien n'est oublié.`]),
    bad_boy:          pick([`${pTgt.name} a posté trois mots sur ses réseaux. Tout le monde a compris.`, `${pTgt.name} n'a pas répondu officiellement. Ce silence-là est presque plus bruyant que des mots.`]),
    calculateur:      pick([`${pTgt.name} n'a fait aucun commentaire public. Il enregistre. Il répondra sur la piste.`, `L'entourage de ${pTgt.name} parle de *"déclarations non étayées"*. Froid. Précis. Prévisible.`]),
    vieux_sage:       pick([`${pTgt.name} a souri quand on lui a rapporté les propos. *"Intéressant"*, c'est tout ce qu'il a dit.`, `${pTgt.name} a entendu pire. Il ne s'en émeut pas. Ce calme, c'est parfois la réponse la plus efficace.`]),
    rookie_ambitieux: pick([`${pTgt.name} a répondu rapidement, peut-être trop — on sentait l'émotion dans les mots.`, `${pTgt.name} n'a pas réussi à cacher sa surprise. Le paddock a regardé ça avec curiosité.`]),
  };
  const tgtReaction = TGT_REACTIONS[archTgt] || TGT_REACTIONS.guerrier;

  const templates = {

    // ─── TRASH TALK ────────────────────────────────────────────
    trash_talk: {
      type: 'drama',
      headlines: isTeammate ? [
        tgtDnf
          ? `${pSrc.name} sur le DNF${circuitStr} de son coéquipier ${pTgt.name}${nickTgt} : les mots qui brûlent`
          : `${pSrc.name} sur son coéquipier ${pTgt.name}${nickTgt} : les mots qui brûlent`,
        `${tSrcStr} : ${pSrc.name} ne retient plus ses coups contre ${pTgt.name}`,
        `"${pTgt.name} ? Honnêtement..." — ${pSrc.name} lâche tout en public`,
        `Guerre interne chez ${tSrcStr} : ${pSrc.name} s'en prend ouvertement à ${pTgt.name}`,
      ] : [
        tgtDnf   ? `Après le DNF${circuitStr} — ${pSrc.name} n'attendait que ça pour parler de ${pTgt.name}`
        : tgtWon ? `Même après sa victoire${circuitStr}, ${pTgt.name} n'échappe pas aux critiques de ${pSrc.name}`
                 : `${pSrc.name} descend ${pTgt.name}${nickTgt} en conférence — le paddock se lève`,
        `"${pTgt.name} est surévalué" — ${pSrc.name} sans filtre`,
        `La déclaration de ${pSrc.name} sur ${pTgt.name} qui va faire parler`,
        `${tSrcStr} vs ${tTgtStr} : ${pSrc.name} ouvre le feu sur ${pTgt.name}`,
      ],
      bodies: isTeammate ? [
        `Il y a des choses qu'on ne dit pas en public dans ce paddock. **${pSrc.name}** vient de les dire.\n\n` +
        `*${srcQuote || (tgtDnf ? `"Le DNF${circuitStr} ? Je ne vais pas faire semblant. Moi je donne tout, chaque tour. Ce n'est pas toujours réciproque."` : `"Je ne vais pas mentir — **${pTgt.name}** n'est pas au niveau où on a besoin qu'il soit."`) }*\n\n` +
        pick([
          `${tSrcStr} a refusé de commenter. ${pTgt.name} non plus. Le silence, parfois, répond mieux que les mots.`,
          `Le management de ${tSrcStr} a été prévenu. Il devrait y avoir une réunion dans les 48h.`,
          `Dans les couloirs du paddock, personne n'est surpris. *"Ça couvait depuis des semaines"*, confie une source proche.`,
        ]),
        `${srcIntro}\n\n` +
        `*${srcQuote || `"Mon coéquipier ?"* Une pause. Un sourire. *"Je ne vais pas commenter chaque course de **${pTgt.name}**. Les résultats parlent d'eux-mêmes."`}*\n\n` +
        `${tgtReaction}`,
      ] : [
        `${srcIntro}\n\n` +
        `*${srcQuote || (tgtDnf ? `"Un DNF${circuitStr}... Vous voulez mon avis honnête ? Ce n'est pas un accident."` : tgtWon ? `"Sa victoire${circuitStr} ? Les conditions étaient favorables. Ce n'est pas la même chose que de gagner quand ça résiste."` : `"Surévalué ? Je dirais... soutenu par les circonstances. Mais le talent brut ? Les chronos répondent."`) }*\n\n` +
        `${tgtReaction}`,
        `${ctxHook ? ctxHook + '\n\n' : ''}${srcIntro}\n\n` +
        `*${srcQuote || `"${pTgt.name} a de bons résultats quand tout va bien. Mais enlève-lui une belle voiture, et qu'est-ce qu'il reste ?"` }*\n\n` +
        `${champCtxLine && !ctxHook ? champCtxLine + '\n\n' : ''}Ce n'est pas ce qu'on dit publiquement dans ce sport. C'est ce qu'on murmure dans les couloirs. ${pSrc.name} vient de le crier.`,
      ],
    },

    // ─── RUMEUR ────────────────────────────────────────────────
    rumeur: {
      type: 'transfer_rumor',
      headlines: [
        tgtDnf      ? `Après le DNF${circuitStr} — la rumeur sur ${pTgt.name}${nickTgt} prend de l'ampleur`
        : tgtChampPos === 1 ? `Le leader du championnat ${pTgt.name}${nickTgt} dans la tourmente — la rumeur qui circule`
                    : `Rumeur paddock : ${pTgt.name}${nickTgt} bientôt à la porte ?`,
        `Coulisses : ce que ${pTgt.name} aurait dit — et qu'il ne voulait pas voir partir`,
        `Source anonyme : *"${pTgt.name} n'est plus en odeur de sainteté ici"*`,
        `Whispers paddock : la situation de ${pTgt.name} serait plus fragile qu'annoncé`,
      ],
      bodies: [
        `Une information circule depuis quelques heures dans le paddock. Elle vient de ${QUOTES.rumeur[archSrc] || 'une source anonyme'}.\n\n` +
        (tgtDnf   ? `Son timing n'est pas anodin : le DNF de **${pTgt.name}**${circuitStr} aurait *"ravivé des discussions internes qu'on croyait closes"*.\n\n`
        : tgtWon  ? `Paradoxalement, c'est la victoire${circuitStr} de **${pTgt.name}** qui aurait *"relancé l'intérêt d'autres écuries"*.\n\n`
                  : `Selon cette source, **${pTgt.name}** ne serait *"pas aussi intouchable que son entourage veut bien le laisser croire"*.\n\n`) +
        pick([
          `Aucune confirmation officielle. Mais dans ce sport, les rumeurs naissent rarement de rien.`,
          `${tTgtStr ? tTgtStr + ' n\'a pas commenté.' : ''} Le silence a parfois la valeur d'une réponse.`,
          `Plusieurs personnes dans le paddock affirment avoir entendu la même version. Ce n'est plus une rumeur isolée.`,
        ]),
        `Le paddock bruisse. Quelqu'un a parlé — ${QUOTES.rumeur[archSrc] || 'une source qui a souhaité rester anonyme'}.\n\n` +
        `${ctxHook ? ctxHook + ' ' : ''}Ce qui circule sur **${pTgt.name}** ? Que ses relations en interne seraient *"tendues"*, que certains résultats auraient créé des *"questions"*.\n\n` +
        `On attend la version officielle. Elle viendra peut-être. Ou pas.`,
        `*"Il y a ce qu'on voit sur la piste, et ce qui se passe vraiment derrière les portes fermées."*\n\n` +
        `${QUOTES.rumeur[archSrc] ? `La formule vient de ${QUOTES.rumeur[archSrc]}` : `La source, anonyme`}, qui évoque la situation de **${pTgt.name}** avec une franchise inhabituelle.\n\n` +
        `Impossible de vérifier. Difficile d'ignorer.`,
      ],
    },

    // ─── ÉLOGE ─────────────────────────────────────────────────
    eloge: {
      type: 'friendship',
      headlines: isTeammate ? [
        tgtWon ? `${pSrc.name} après la victoire${circuitStr} de ${pTgt.name}${nickTgt} : "C'est le meilleur coéquipier que j'ai eu"`
               : `${pSrc.name} sur ${pTgt.name}${nickTgt} : "C'est le meilleur coéquipier que j'ai eu"`,
        `${tSrcStr} : quand ${pSrc.name} défend publiquement ${pTgt.name}`,
        `"Il m'a rendu meilleur" — l'éloge surprise de ${pSrc.name} pour ${pTgt.name}`,
      ] : [
        tgtWon      ? `${pSrc.name} reconnaît la victoire${circuitStr} de ${pTgt.name}${nickTgt} — respect public inattendu`
        : tgtPodium ? `P${tgtPos}${circuitStr} — ${pSrc.name} rend hommage à la course de ${pTgt.name}${nickTgt}`
        : tgtChampPos === 1 ? `Le leader ${pTgt.name}${nickTgt} encensé par son rival ${pSrc.name} — personne n'attendait ça`
                    : `${pSrc.name} et son respect public pour ${pTgt.name}${nickTgt} — inattendu`,
        `"Il mérite plus de reconnaissance" — ${pSrc.name} sur ${pTgt.name}`,
        `${tSrcStr} vs ${tTgtStr} : quand la rivalité laisse place au respect`,
        `${pSrc.name} sort du lot : son message à ${pTgt.name} touche le paddock`,
      ],
      bodies: isTeammate ? [
        `Dans un sport où les coéquipiers se ménagent rarement, **${pSrc.name}** a choisi la transparence.\n\n` +
        `*${srcQuote || (tgtWon ? `"Sa victoire${circuitStr}, ce n'est pas un accident. Il a géré la course parfaitement."` : `"${pTgt.name} est à part. Son regard sur la voiture, sa façon d'aider l'équipe. C'est rare."`) }*\n\n` +
        pick([
          `${pTgt.name} a répondu avec un simple : *"Ça compte."* Deux mots. Suffisants.`,
          `Le vestiaire a applaudi. Pas fort. Juste ce qu'il fallait.`,
          `${tSrcStr} a posté la citation sur ses réseaux. Stratégie d'image, ou reconnaissance authentique ? Les deux ne s'excluent pas.`,
        ]),
      ] : [
        `${srcIntro}\n\n` +
        `*${srcQuote || (tgtWon ? `"Sa course${circuitStr} ? Pas une erreur. Pas un dixième gaspillé. Il mérite tout le crédit."` : tgtPodium ? `"Son P${tgtPos}${circuitStr} a peut-être été oublié vite. Pour moi il ne l'est pas."` : tgtChampPos === 1 ? `"Il mène le championnat — ce n'est pas par accident. Je le dis en adversaire direct."` : `"${pTgt.name} est l'un des pilotes les plus complets de cette grille. Il ne reçoit pas ce qu'il mérite."`) }*\n\n` +
        `${champCtxLine && !tgtWon && !tgtPodium ? champCtxLine + '\n\n' : ''}` +
        pick([
          `Le paddock a sourcillé. Une déclaration de respect entre rivaux, ça dérange toujours un peu les narratives habituelles.`,
          `${pTgt.name} a répondu depuis ses réseaux : *"Du respect, ça se mérite. Merci ${pSrc.name}."* Court. Classe.`,
          `L'équipe de ${pTgt.name} n'a pas masqué sa satisfaction. Dans ce paddock, une validation publique d'un rival vaut son pesant d'or.`,
        ]),
      ],
    },

    // ─── TRAHISON ──────────────────────────────────────────────
    trahison: {
      type: 'drama',
      headlines: [
        tgtDnf ? `Après le DNF${circuitStr}, ${pSrc.name} sort ce que ${pTgt.name}${nickTgt} voulait taire`
               : `Exclusif : ${pSrc.name} révèle ce que ${pTgt.name}${nickTgt} aurait dit en privé`,
        `${pSrc.name} sort de la réserve et expose ${pTgt.name} — le paddock choqué`,
        `"Je ne devais pas le dire" — mais ${pSrc.name} l'a quand même dit, sur ${pTgt.name}`,
        `La sortie de piste médiatique de ${pSrc.name} contre ${pTgt.name}`,
      ],
      bodies: [
        `Il y a une règle non écrite dans ce paddock : ce qui se dit dans le vestiaire reste dans le vestiaire.\n\n` +
        `**${pSrc.name}** vient de la briser.\n\n` +
        `*${srcQuote || '"Je n\'aurais peut-être pas dû dire ça." — il l\'a dit quand même.' }*\n\n` +
        pick([
          `L'entourage de ${pTgt.name} parle de *"trahison"*. Le mot est fort. Il est peut-être exact.`,
          `Plusieurs pilotes dans le paddock ont réagi avec malaise. *"On ne fait pas ça"* revient souvent.`,
          `Depuis cette déclaration, la relation entre les deux camps est officiellement dans le rouge.`,
        ]),
        `${srcIntro}\n\n` +
        `Ce que **${pTgt.name}** ne voulait pas voir rendu public — ses doutes internes, ses tensions avec le management, ses commentaires sur ${isTeammate ? "l'équipe" : "sa situation"} — est maintenant dans la nature.\n\n` +
        `*${srcQuote || '"S\'il a quelque chose à dire, qu\'il le dise lui-même." Sauf que maintenant, c\'est fait.' }*\n\n` +
        `${tgtReaction}`,
      ],
    },

    // ─── VANNE ─────────────────────────────────────────────────
    vanne: {
      type: 'driver_interview',
      headlines: [
        tgtDnf  ? `${pSrc.name} et sa pique sur le DNF${circuitStr} de ${pTgt.name}${nickTgt} — le paddock rit jaune`
        : tgtWon ? `Même après sa victoire${circuitStr}, ${pTgt.name}${nickTgt} n'échappe pas à la vanne de ${pSrc.name}`
                 : `${pSrc.name} régale le paddock avec sa pique sur ${pTgt.name}${nickTgt}`,
        `"${pTgt.name} et moi on s'entend bien... enfin, moi j'essaie" — ${pSrc.name} en mode stand-up`,
        `La pique (très) remarquée de ${pSrc.name} sur ${pTgt.name}`,
        `${pSrc.name} : "Je plaisante avec ${pTgt.name}. Surtout quand il n'est pas là."`,
      ],
      bodies: [
        `${srcIntro}\n\n` +
        `*${srcQuote || (tgtDnf ? `"Je ne veux pas me moquer. Mais si quelqu'un pouvait lui expliquer comment on finit une course..."` : `"${pTgt.name} ? Il est régulier. Régulièrement… là."`) }*\n\n` +
        pick([
          `Rires dans la salle. Sourire en coin de ${pSrc.name}. ${pTgt.name} n'était pas là pour entendre ça. Il lira les comptes-rendus.`,
          `On a demandé à ${pSrc.name} s'il plaisantait. *"Évidemment. Mais les meilleures vannes ont toujours un fond de vrai."* Et il est parti.`,
          `La pique va circuler. Ce genre de phrase finit toujours dans les timelines.`,
        ]),
        `Le paddock cherche parfois la légèreté. **${pSrc.name}** l'a trouvée — aux dépens de **${pTgt.name}**.\n\n` +
        `*${srcQuote || (tgtDnf ? `"Je ne suis pas là pour lui taper dessus. Mais il faut avouer que les images... ça aurait pu être une belle journée." Une pause. "Pour lui."` : `"Je l'adore, hein. C'est juste que quand je le regarde dans les stands, j'apprends à ne pas répéter ses erreurs."`) }*\n\n` +
        `${tgtReaction}`,
      ],
    },

    // ─── DÉMENTIR ──────────────────────────────────────────────
    dementir: {
      type: 'driver_interview',
      headlines: [
        tgtDnf ? `Après le DNF${circuitStr}, ${pSrc.name} prend la défense de ${pTgt.name}${nickTgt} : "Laissez-le respirer"`
               : `${pSrc.name} prend la défense de ${pTgt.name}${nickTgt} : "Ces rumeurs sont fausses"`,
        `${pSrc.name} sort du silence pour défendre ${pTgt.name} — surprise`,
        `"Laissez ${pTgt.name} tranquille" — la prise de position inattendue de ${pSrc.name}`,
        `${pSrc.name} coupe court aux rumeurs sur ${pTgt.name}`,
      ],
      bodies: [
        `On ne l'attendait pas là. **${pSrc.name}** a pris la parole pour mettre fin à ce qui circule sur **${pTgt.name}**.\n\n` +
        `*${srcQuote || (tgtDnf ? `"Son abandon${circuitStr}, c'est la course. Ce que j'entends depuis, c'est du bruit. Un DNF ne définit pas un pilote."` : `"Ce que j'entends sur lui, c'est du bruit. Ce n'est pas ce que vous croyez."`) }*\n\n` +
        pick([
          `Ce soutien public a surpris. Dans ce paddock, défendre quelqu'un qu'on affronte sur la piste, ça ne se fait pas souvent.`,
          `${pTgt.name} a répondu en privé, selon une source. *"Il n'avait pas à faire ça. Mais il l'a fait."*`,
          `La déclaration a immédiatement fait retomber la pression autour de ${pTgt.name}. Pour l'instant.`,
        ]),
        `${srcIntro}\n\n` +
        `*${srcQuote || `"${pTgt.name} a ses défauts. On en a tous. Mais ce qu'on raconte sur lui en ce moment — c'est exagéré, c'est injuste."` }*\n\n` +
        `Pas un grand discours. Juste quelqu'un qui a décidé de dire la vérité telle qu'il la voit.\n\n` +
        `${tgtReaction}`,
      ],
    },

    // ─── DÉFI ──────────────────────────────────────────────────
    defi: {
      type: 'rivalry',
      headlines: [
        tgtWon      ? `Après la victoire${circuitStr}, ${pSrc.name} lance un défi public à ${pTgt.name}${nickTgt} : "Qu'il recommence"`
        : tgtDnf    ? `DNF${circuitStr} ou pas, ${pSrc.name} attend ${pTgt.name}${nickTgt} sur la piste`
        : tgtChampPos === 1 ? `${pSrc.name} défie le leader ${pTgt.name}${nickTgt} : "Ce classement ne durera pas"`
        : srcChampPos === 1 ? `Le leader ${pSrc.name} fixe son suivant ${pTgt.name}${nickTgt} : "Viens me chercher"`
                    : `${pSrc.name} lance un défi public à ${pTgt.name}${nickTgt} : "Qu'il me réponde sur la piste"`,
        `Défi ouvert : ${pSrc.name} fixe le niveau — c'est maintenant ${pTgt.name} qui doit répondre`,
        `"Je veux voir ce qu'il a vraiment dans le ventre" — ${pSrc.name} sur ${pTgt.name}`,
        `${tSrcStr} provoque ${tTgtStr || "l'adversaire"} : le message de ${pSrc.name} ne laisse rien dans l'ombre`,
      ],
      bodies: [
        `${srcIntro}\n\n` +
        `*${srcQuote || (tgtWon ? `"Sa victoire${circuitStr} ? Bien. On va se retrouver sur la piste — et cette fois, je serai celui qui franchit la ligne en premier."` : tgtDnf ? `"L'abandon${circuitStr} ? Je ne vais pas danser là-dessus. Ce que je veux, c'est le battre quand il est à 100%."` : `"${pTgt.name} et moi, on va se retrouver sur la piste. Moi je suis prêt."`) }*\n\n` +
        pick([
          `${pTgt.name} n'a pas encore répondu officiellement.`,
          `L'équipe de ${pTgt.name} a *"pris note"*. Traduction paddock : la guerre est acceptée.`,
          `Dans le garage de ${tTgtStr || "l'adversaire"}, on a regardé les télés avec attention.`,
        ]),
        `**${pSrc.name}** a décidé de forcer le duel.\n\n` +
        `*${srcQuote || `"Je lui pose la question directement : t'es où, ${pTgt.name}${nickTgt} ? Sur la piste, je ne te vois pas souvent là où tu prétends être. Viens me montrer."` }*\n\n` +
        `${ctxHook ? ctxHook + '\n\n' : champCtxLine ? champCtxLine + '\n\n' : ''}La provocation est directe. Elle restera. Et les prochains GPs auront un sous-texte que tout le paddock a maintenant en tête.\n\n` +
        `${tgtReaction}`,
      ],
    },

    // ─── SECRET DE VESTIAIRE ───────────────────────────────────
    secret: {
      type: 'scandal_offtrack',
      headlines: [
        `Exclusif — ce que ${pTgt.name}${nickTgt} voulait à tout prix garder secret`,
        `${pSrc.name} expose : ce qui se disait sur ${pTgt.name} en privé`,
        `La révélation de ${pSrc.name} sur ${pTgt.name} — le paddock n'était pas prêt`,
        `Secret de vestiaire brisé : ${pSrc.name} parle, ${pTgt.name} perd le contrôle du récit`,
      ],
      bodies: [
        `Ça n'était pas supposé sortir. **${pSrc.name}** a décidé autrement.\n\n` +
        `Selon lui, **${pTgt.name}** aurait exprimé — en privé, lors d'un briefing — des doutes profonds sur ${isTeammate ? `la direction de ${tSrcStr || "l'équipe"}` : 'sa propre situation'}.\n\n` +
        `*${srcQuote || '"Je sais que je brûle un pont là. Mais certaines choses méritent d\'être dites." — ' + pSrc.name }*\n\n` +
        pick([
          `L'entourage de ${pTgt.name} qualifie ça de *"violation de confiance grave"*. C'est leur droit.`,
          `Ce qui est dit ne peut pas être non-dit. Le paddock retient maintenant quelque chose de ${pTgt.name} qu'il n'avait pas choisi de montrer.`,
        ]),
        `${srcIntro}\n\n` +
        `Il y a une éthique non formulée dans ce sport : ce qu'on confie dans un vestiaire ne sort pas du vestiaire.\n\n` +
        `**${pSrc.name}** vient de la faire voler en éclats.\n\n` +
        `*${srcQuote || `"${pTgt.name} peut s'expliquer maintenant. C'est son droit."` }*\n\n` +
        `Les détails livrés — vraies intentions, frustrations internes, conversations privées — sont maintenant dans la nature. Et ils vont y rester.\n\n` +
        `${tgtReaction}`,
      ],
    },

  };

  const tpl = templates[type];
  if (!tpl) return null;

  return {
    type: tpl.type,
    source,
    headline: pick(tpl.headlines),
    body: pick(tpl.bodies),
    pilotIds: [pSrc._id, pTgt._id],
    teamIds: [tSrc?._id, tTgt?._id].filter(Boolean),
    seasonYear,
    raceId: null,
  };
}

function genLongTermDuoArticle(pA, pB, team, rel, seasonYear) {
  const source   = pick(['pitlane_insider', 'f1_weekly', 'paddock_whispers', 'pl_racing_news']);
  const seasons  = rel.sharedTeamSeasons || 2;
  const isAlly   = rel.affinity >= 40;
  const isEnemy  = rel.affinity < -40;
  const seasonsStr = seasons === 2 ? '2ème saison consécutive' : seasons === 3 ? '3ème saison ensemble' : `${seasons} saisons de suite`;

  if (isAlly) {
    const headlines = [
      `${pA.name} / ${pB.name} — ${seasonsStr} chez ${team.emoji} ${team.name} : la recette d'un duo rare`,
      `${team.emoji} ${team.name} mise à nouveau sur son binôme de luxe`,
      `${pA.name} et ${pB.name} : ${seasonsStr}, et l'entente reste intacte — comment ?`,
    ];
    const body =
      `Rares sont les duos qui traversent les saisons sans se déchirer. **${pA.name}** et **${pB.name}** entament leur **${seasonsStr}** chez ${team.emoji} **${team.name}**, et le paddock observe avec curiosité.\n\n` +
      pick([
        `"On se connaît maintenant. On sait comment l'autre travaille, ce qui l'énerve, ce qui le motive." L'un d'eux, lors d'une interview hivernale. L'autre aurait dit pareil.`,
        `La recette semble simple : respect mutuel, ligne de démarcation claire côté ingénieurs, et une compétition saine mais jamais toxique. En apparence du moins.`,
        `Deux saisons à partager un garage, des données, des défaites et des victoires. Ça soude — ou ça détruit. Dans leur cas, l'équation penche clairement dans le bon sens.`,
      ]) +
      `\n\nLe management de ${team.name} ne cache pas sa satisfaction. *"Un duo stable, c'est un avantage concurrentiel. On n'en change pas pour changer."*`;
    return { type: 'friendship', source, headline: pick(headlines), body, pilotIds: [pA._id, pB._id], teamIds: [team._id], seasonYear };
  }

  if (isEnemy) {
    const headlines = [
      `${team.emoji} ${team.name} : **${seasonsStr}** avec ${pA.name} et ${pB.name} — jusqu'à quand ?`,
      `La guerre froide ${pA.name}/${pB.name} entre dans sa **${seasonsStr}** — et personne ne comprend pourquoi`,
      `${pA.name} vs ${pB.name} : ${seasons} saisons de tension. ${team.emoji} ${team.name} joue avec le feu.`,
    ];
    const body =
      `**${seasons} saisons.** C'est le temps que dure la cohabitation sous tension entre **${pA.name}** et **${pB.name}** chez ${team.emoji} **${team.name}**.\n\n` +
      pick([
        `Ce qui était une friction est devenu une atmosphère. Les mécaniciens travaillent en deux camps distincts. Les briefings collectifs sont tendus. Et le management fait semblant que tout va bien.`,
        `La question n'est plus "pourquoi ne s'entendent-ils pas" — elle est "pourquoi ${team.name} ne fait rien". ${seasons} saisons. Le paddock n'est plus surpris, juste intrigué par l'inaction.`,
        `Les deux pilotes performent malgré tout. Ou peut-être à cause de tout. Certains fonctionnent sous tension. Mais combien de temps ?`,
      ]) +
      `\n\n*Nos sources internes parlent d'une \"situation gérée mais surveillée\". Ce qui, dans le paddock, signifie rarement que tout va bien.*`;
    return { type: 'drama', source, headline: pick(headlines), body, pilotIds: [pA._id, pB._id], teamIds: [team._id], seasonYear };
  }

  // Affinité neutre — duo qui dure sans grand relief
  const headlines = [
    `${pA.name} et ${pB.name} : ${seasonsStr} de cohabitation — le calme après le calme`,
    `${team.emoji} ${team.name} reconduit son binôme pour la ${seasonsStr}`,
  ];
  const body =
    `Pas de grande déclaration, pas de rupture annoncée. **${pA.name}** et **${pB.name}** entament leur **${seasonsStr}** chez ${team.emoji} **${team.name}** avec la même discrétion que les précédentes.\n\n` +
    `Certains y voient une force — la stabilité, la connaissance mutuelle. D'autres se demandent si l'absence de friction n'est pas aussi l'absence de feu. Dans ce sport, les duos trop confortables ont parfois du mal à se challenger l'un l'autre.\n\n` +
    `La saison dira qui avait raison.`;
  return { type: 'driver_interview', source, headline: pick(headlines), body, pilotIds: [pA._id, pB._id], teamIds: [team._id], seasonYear };
}

function genLegacyCohabitationArticle(pA, pB, team, rel, worstEvent, yearsAgo, seasonYear) {
  const source   = pick(['pitlane_insider', 'f1_weekly', 'paddock_whispers', 'pl_racing_news']);
  const isEnemy  = rel.affinity < -50;
  const agoLabel = yearsAgo <= 0 ? 'la saison dernière' : yearsAgo === 1 ? "l\'an dernier" : `il y a ${yearsAgo} ans`;
  const circuitCtx = worstEvent?.circuit ? ` à ${worstEvent.circuit}` : '';

  const headlines = isEnemy ? [
    `${pA.name} / ${pB.name} : la paix des braves… ou pas`,
    `Saison ${seasonYear} — ${team.emoji} ${team.name} mise sur l'entente ${pA.name}/${pB.name}. Pari risqué ?`,
    `Le passé resurgit : ${agoLabel}${circuitCtx}, tout avait déjà commencé`,
    `${team.emoji} "Coéquipiers avant tout" — mais le contexte ${pA.name}/${pB.name} est tout sauf simple`,
  ] : [
    `${pA.name} et ${pB.name} : relation compliquée, même écurie, nouvelle saison`,
    `La dynamique ${pA.name}/${pB.name} chez ${team.emoji} ${team.name} — les questions`,
    `${team.emoji} Le passif entre ${pA.name} et ${pB.name} — peut-on tourner la page ?`,
  ];

  const body = isEnemy
    ? `${team.emoji} **${team.name}** démarre la saison ${seasonYear} avec l'une des dynamiques internes les plus scrutées du paddock.\n\n` +
      `**${pA.name}** et **${pB.name}** — leur relation a une histoire. ${agoLabel}${circuitCtx}, un incident avait marqué les esprits. Depuis, le thermomètre n'est jamais vraiment remonté.\n\n` +
      pick([
        `Aujourd'hui coéquipiers, ils devront mettre ce passif entre parenthèses. En théorie. Parce que dans ce sport, les vieilles blessures ont tendance à se rappeler au mauvais moment.`,
        `Les deux camps ont soigneusement évité de commenter leur cohabitation lors des premières sorties médias. Ce silence est éloquent.`,
        `Le management de ${team.name} a travaillé cet hiver sur la gestion de l'atmosphère interne. Ce qui suit sera intéressant à observer.`,
      ])
    : `${team.emoji} **${team.name}** hérite d'un binôme au passif chargé pour la saison ${seasonYear}.\n\n` +
      `**${pA.name}** et **${pB.name}** ne sont pas ennemis — mais leur histoire est marquée par des tensions régulières${circuitCtx ? ` (dont un épisode notable${circuitCtx})` : ''}. La cohabitation reste un défi.\n\n` +
      `Les deux pilotes ont tenu des discours mesurés lors des premiers contacts médias. Le paddock a appris à lire entre les lignes.`;

  return {
    type: 'drama', source,
    headline: pick(headlines), body,
    pilotIds: [pA._id, pB._id],
    teamIds: [team._id],
    seasonYear,
  };
}

// ============================================================
// 🏷️  SURNOMS — Système de nicknames F1
// Un pilote peut donner un surnom à un autre à certains moments-clés.
// Le surnom est stocké sur le pilote cible et réutilisé dans les articles/confs.
// Déclencheurs : rivalité intense, duel en course, cohabitation tendue, conf de presse.
// Fréquence : rare (~10-15%) — pour ne pas saturer.
// ============================================================

// Générateur de surnoms selon le contexte
// pTarget = le pilote qui reçoit le surnom
// context = 'rival' | 'teammate' | 'race_duel' | 'domination'
function generateNickname(pGiver, pTarget, context) {
  const ov   = overallRating(pTarget);
  const arch = pGiver.personality?.archetype || 'neutre';
  const tone = pGiver.personality?.tone      || 'neutre';

  // Surnoms basés sur le style du donneur + contexte
  const pool = {
    rival: {
      bad_boy     : [`"Ce Nul"`, `"Monsieur Miracle"`, `"L'Imposteur en Chef"`, `"Mon Punching-Ball"`, `"Le Bouche-Trou"`, `"Le Fantôme"`, `"Monsieur Deuxième"`],
      guerrier    : [`"L'Obstacle"`, `"Le Bouclier de Papier"`, `"Mon Pot de Fleurs"`, `"Le Râleur"`, `"La Pieuvre"`, `"Monsieur DNF"`],
      icone       : [`"Le Prétendant au Trône"`, `"Mon Faire-Valoir"`, `"Le Grand Oublié"`, `"Le Miroir Cassé"`],
      calculateur : [`"Le Bug du Système"`, `"L'Anomalie"`, `"La Variable Inutile"`, `"Erreur 404"`, `"Le Glitch"`],
      rookie_ambitieux: [`"Le Kamikaze"`, `"Le Fou Furieux"`, `"L'Acharné du Bac à Sable"`, `"Mini-Moi"`, `"Le Stagiaire Enragé"`],
      vieux_sage  : [`"L'Impatient"`, `"La Pétoire"`, `"Le Pressé"`, `"Le Bolide en Carton"`, `"Monsieur Toujours-Pressé"`],
    },
    teammate: {
      bad_boy     : [`"Le Boulet"`, `"Mon Boulet de Luxe"`, `"L'Inutile Payé Cher"`, `"Le VRP de l'Écurie"`, `"Mon Handicap"`, `"Madame Délicate"`, `"Le Pot Cassé"`],
      guerrier    : [`"L'Autre"`, `"Mon Poids Mort"`, `"Le Touriste de Luxe"`, `"Le Freinage Volontaire"`, `"Le Ralenti Humain"`],
      icone       : [`"Mon Lieutenant (Raté)"`, `"L'Utile Quelquefois"`, `"Le Fiable les Bons Jours"`, `"Mon Faire-Valoir Attitré"`],
      calculateur : [`"La Donnée Parasitaire"`, `"Le Paramètre Inutile"`, `"Le Benchmark Déprimant"`, `"L'Étalon de Mes Angoisses"`],
      rookie_ambitieux: [`"Le Dinosaure"`, `"Le Fossil F1"`, `"Grand-Père"`, `"Le Reliquat"`, `"Le Survivant Malgré Lui"`],
      vieux_sage  : [`"Le Feu Follet"`, `"L'Incontrôlable"`, `"La Fusée sans GPS"`, `"Mon Boulet Imprévisible"`],
    },
    race_duel: {
      bad_boy     : [`"La Punaise sur Roues"`, `"Le Mur Roulant"`, `"Mon Accrocheur Préféré"`, `"Le Dépasse-Jamais"`, `"La Barricade"`],
      guerrier    : [`"Le Mur"`, `"L'Accrocheur Professionnel"`, `"La Tique"`, `"Le Collant"`, `"L'Implosion à Retardement"`],
      icone       : [`"Le Challenger"`, `"L'Adversaire Correct"`, `"Le Digne Parfois"`, `"Mon Meilleur Ennemi"`],
      calculateur : [`"L'Algorithme Défectueux"`, `"Le Calcul Foireux"`, `"Le Scénario Catastrophe"`, `"Le Plan B Raté"`],
      rookie_ambitieux: [`"Le Roc"`, `"L'Indestructible Momie"`, `"Le Bunker"`, `"Le Monument"`, `"Le Reliquat de Carrière"`],
      vieux_sage  : [`"La Jeunesse Imprudente"`, `"Le Talent Brut et Non Raffiné"`, `"L'Explosion Contrôlée"`],
    },
    domination: {
      bad_boy     : [`"Le Perdant Magnifique"`, `"L'Éternel Second"`, `"Le Podium Jamais"`, `"Le Grand Décevant"`, `"Monsieur Presque"`],
      guerrier    : [`"La Référence Triste"`, `"L'Étalon de Médiocrité"`, `"Le Niveau Plancher"`],
      icone       : [`"Mon Émule Raté"`, `"L'Apprenti Incomplet"`, `"Le Prometteur Perpétuel"`],
      calculateur : [`"La Constante d'Échec"`, `"Le Résidu"`, `"La Marge d'Erreur"`],
      rookie_ambitieux: [`"L'Intouchable"`, `"Le Boss (Parait-il)"`, `"La Légende de Son Propre Esprit"`],
      vieux_sage  : [`"Le Futur Peut-Être"`, `"L'Espoir Conditionnel"`, `"La Relève Hypothétique"`],
    },
  };

  const contextPool = pool[context] || pool['rival'];
  const archPool    = contextPool[arch] || contextPool['guerrier'] || [];
  if (!archPool.length) return null;
  return pick(archPool);
}

/**
 * Tente de donner un surnom (pGiver → pTarget).
 * Conditions : pTarget n'a pas déjà de surnom, chance ~12%.
 * Retourne le surnom si attribué, null sinon.
 */
async function tryAssignNickname(pGiver, pTarget, context, chance = 0.12) {
  if (!pGiver || !pTarget) return null;
  if (pTarget.nickname) return null; // déjà un surnom — on ne l'écrase pas
  if (Math.random() > chance) return null;

  const nick = generateNickname(pGiver, pTarget, context);
  if (!nick) return null;

  await Pilot.findByIdAndUpdate(pTarget._id, {
    nickname: nick,
    nicknameGivenBy: pGiver._id,
  });
  pTarget.nickname       = nick;
  pTarget.nicknameGivenBy = pGiver._id;
  return nick;
}

/**
 * Retourne une phrase intégrant le surnom si disponible, sinon juste le nom.
 * Usage : nickOrName(p) → "Leclerc (alias \"Le Météore\")" ou juste "Leclerc"
 * Légèreté : ~30% du temps on utilise l'alias, pas à chaque mention
 */
function nickOrName(p, { alwaysShowNick = false } = {}) {
  if (!p?.nickname) return p?.name || '?';
  if (alwaysShowNick || Math.random() < 0.30) {
    return `${p.name} *(alias ${p.nickname})*`;
  }
  return p.name;
}

function genRivalryArticle(pA, pB, teamA, teamB, contacts, circuit, seasonYear, rivalHeat = 0) {
  const sources = ['pitlane_insider', 'paddock_whispers', 'pl_racing_news'];
  const source  = pick(sources);

  // Palier selon contacts ET heat : heat l'emporte si très élevé
  const tier = rivalHeat >= 70 ? 'inferno'
    : contacts <= 2 ? 'fresh'
    : contacts <= 4 ? 'escalade'
    : 'war';

  const headlines = {
    inferno: [
      `🔴 ${pA.name} / ${pB.name} : la rivalité hors de contrôle`,
      `${contacts} contacts, ${rivalHeat} de tension — la FIA doit intervenir`,
      `"C'est de la haine" — la rivalité ${pA.name}/${pB.name} dépasse les limites`,
      `${teamA.emoji}${pA.name} vs ${teamB.emoji}${pB.name} : le paddock tremble`,
      `Jusqu'où ira leur guerre ? — ${pA.name} et ${pB.name} incontrôlables`,
    ],
    fresh: [
      `${pA.name} et ${pB.name} : les premiers signes d'une rivalité naissante`,
      `Incident à ${circuit} — ${pA.name} et ${pB.name} se frôlent déjà`,
      `${teamA.emoji}${pA.name} / ${teamB.emoji}${pB.name} : premier accrochage, premier froid`,
      `${contacts} contact(s) entre ${pA.name} et ${pB.name} — coïncidence ou tendance ?`,
    ],
    escalade: [
      `${pA.name} vs ${pB.name} : la guerre froide du paddock`,
      `Encore un accrochage — ${pA.name} et ${pB.name} au bord du clash`,
      `${teamA.emoji}${pA.name} et ${teamB.emoji}${pB.name} : la tension monte d'un cran`,
      `La FIA surveille — ${contacts} incidents entre ${pA.name} et ${pB.name} cette saison`,
      `"Ça ne peut pas continuer comme ça" — le paddock s'inquiète pour ${pA.name}/${pB.name}`,
    ],
    war: [
      `"Ça va finir mal" — la rivalité ${pA.name}/${pB.name} hors de contrôle`,
      `${contacts} contacts cette saison — ${pA.name} et ${pB.name} : jusqu'où ça va aller ?`,
      `${pA.name}/${pB.name} : le dossier brûlant que la FIA ne peut plus ignorer`,
      `Guerre ouverte sur la piste — ${teamA.emoji}${pA.name} et ${teamB.emoji}${pB.name} au bout du rouleau`,
      `Exclusif : ce que ${pA.name} pense vraiment de ${pB.name}`,
    ],
  }[tier];

  const bodies = {
    inferno: [
      `${pA.name} et ${pB.name}. ${contacts} contacts cette saison. Une rivalité qui a commencé sur la piste et qui s'est transformée en quelque chose que personne dans ce paddock n'avait anticipé.\n\n` +
      pick([
        `*"À un moment, quelqu'un va finir dans le mur — et ce ne sera pas un accident"*, confie une source proche d'une des deux équipes. Personne ne veut mettre son nom dessus.`,
        `La FIA a convoqué les deux directeurs d'équipe. L'objet de la réunion : *"Mettre fin aux hostilités avant qu'il soit trop tard."* Spoiler : ça n'a rien changé.`,
        `Dans le paddock, on ne parle plus de racing. On parle de psychologie, d'ego, de blessures d'orgueil accumulées GP après GP.`,
      ]),
      `Il y a des rivalités qui nourrissent le sport. Et il y a celle de ${pA.name} et ${pB.name}, qui est en train de le consumer.\n\n` +
      pick([
        `*"Ils ne se regardent plus en conférence de presse. Leurs mécaniciens ne se saluent plus dans la pitlane. Ça a dépassé le stade sportif."*`,
        `À ${circuit}, le dernier contact n'était que le dernier épisode d'une saga qui dure depuis le premier GP. Et personne ne sait comment ça va se terminer.`,
        `${rivalHeat >= 85
          ? `Ce niveau d'intensité est rarissime dans ce sport. Certains y voient l'écho des grandes rivalités de l'histoire. D'autres y voient juste deux pilotes qui ont perdu la tête.`
          : `Les équipes tentent de calmer leurs pilotes. En privé, tout le monde convient que ça va trop loin.`}`,
      ]),
    ],
    fresh: [
      `À ${circuit}, les deux pilotes se sont retrouvés en bagarre directe — et les choses ont failli mal tourner.\n\n` +
      pick([
        `Rien d'officiel pour l'instant. Mais dans le paddock, on a commencé à observer les regards. Premiers signaux.`,
        `${pA.name} s'est montré discret après la course. ${pB.name} aussi. Ce silence peut tout vouloir dire.`,
        `Deux incidents, c'est déjà un motif. Les ingénieurs des deux camps ont sorti les caméras embarquées.`,
      ]),
      `${pA.name} et ${pB.name} se sont retrouvés en contact à ${circuit}. Pas grand-chose à raconter encore — mais ce genre de début mérite d'être noté.\n\n` +
      pick([
        `Dans ce paddock, les rivalités ne s'annoncent pas. Elles se construisent, GP après GP.`,
        `${pB.name} a écarté l'incident d'un revers de main. ${pA.name} n'a pas commenté. La saison est longue.`,
        `Première accroche, première tension. On verra si ça s'arrête là ou si ça grandit.`,
      ]),
    ],
    escalade: [
      `${contacts} contacts en course cette saison entre les deux pilotes — le dernier en date à ${circuit} n'a pas arrangé les choses.\n\n` +
      pick([
        `Selon nos sources, ${pA.name} aurait demandé à la direction de course d'examiner les manœuvres de ${pB.name}. *"Il prend trop de risques"*, aurait-il déclaré en privé.`,
        `${pB.name} a refusé de commenter après la course. Ce silence en dit parfois plus long qu'un discours.`,
        `Dans les couloirs du paddock, on murmure que les deux camps ne se saluent plus. Ambiance glaciale.`,
        `L'incident de ${circuit} a ajouté une couche à une relation déjà tendue. Personne ne semble vouloir faire le premier pas.`,
      ]),
      `À ${circuit}, la ligne entre racing et provocation a une nouvelle fois été franchie.\n\n` +
      pick([
        `*"C'était délibéré ou stupide — dans les deux cas c'est inacceptable."* Une source proche de ${teamA.name} n'a pas mâché ses mots.`,
        `${pA.name} a regardé droit dans les yeux ${pB.name} lors de la pesée. Aucun mot échangé. Tout était dit.`,
        `La FIA a officiellement "pris note" des incidents répétés. En langage FIA, ça veut dire qu'ils regardent de très près.`,
        `${pB.name} a un peu haussé les épaules en conférence de presse. ${pA.name} n'était pas dans la même salle.`,
      ]),
    ],
    war: [
      `${pA.name} et ${pB.name} partagent la piste depuis le début de saison. ${contacts} contacts plus tard, on se demande comment ça n'a pas encore explosé.\n\n` +
      pick([
        `Les équipes ont tenté de calmer le jeu en interne. Sans succès apparent.`,
        `*"Ils se respectent mais ne s'apprécient pas"* — une formule qu'on entend souvent dans ce paddock.`,
        `Le prochain GP va être à surveiller de très près. L'un des deux va craquer.`,
        `La FIA a convoqué les deux pilotes. L'objet de la réunion : les "tensions répétées sur la piste".`,
      ]),
      `Rarement une rivalité dans ce paddock a atteint ce niveau d'intensité aussi vite. ${contacts} incidents, ${contacts} fois où ça aurait pu très mal finir.\n\n` +
      pick([
        `Notre source dans le paddock : *"Il y a une haine froide entre eux. Pas de clash verbal, juste... du silence. Et ça fait peur."*`,
        `${pA.name} a dit en conférence que *"chaque pilote doit respecter l'espace de l'autre"*. Son regard en disant ça ne laissait aucun doute sur à qui il s'adressait.`,
        `${teamB.name} a refusé de commenter les incidents. ${teamA.name} non plus. Mais les données internes circulant dans le paddock racontent une autre histoire.`,
        `GP après GP, les deux se retrouvent. Et GP après GP, ça frotte. La question n'est plus de savoir si ça va exploser — mais quand.`,
      ]),
      `${contacts} contacts entre ${pA.name} et ${pB.name} cette saison. Un chiffre que la FIA ne peut plus ignorer — et une rivalité que le paddock suit désormais comme le feuilleton de la saison.\n\n` +
      pick([
        `Leurs équipes ont eu des discussions en coulisses. Les pilotes continuent de sourire en public. Mais les données parlent d'elles-mêmes.`,
        `À ce stade, même les commissaires de piste anticipent leurs duels. *"On sait que quand ils sont proches, il va se passer quelque chose."*`,
        `${pB.name} a déclaré qu'il *"fait juste son travail"*. ${pA.name} a répondu qu'il *"espère que tout le monde le fait dans les règles"*. Traduction : la guerre est déclarée.`,
      ]),
    ],
  }[tier];

  // Utiliser le surnom si disponible — mention légère, pas systématique
  const nickB = pB.nickname && Math.random() < 0.35 ? ` (${pB.nickname})` : '';
  const nickA = pA.nickname && Math.random() < 0.35 ? ` (${pA.nickname})` : '';

  return {
    type: 'rivalry', source,
    headline: pick(headlines).replace(pA.name, pA.name + nickA).replace(pB.name, pB.name + nickB),
    body: pick(bodies).replace(pB.name, pB.name + nickB),
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
  const source      = pick(['pitlane_insider', 'f1_weekly', 'pl_racing_news']);
  const lastRank    = pilot.lastSeasonRank  || null;
  const lastPts     = pilot.lastSeasonPts   || 0;
  const lastWins    = pilot.lastSeasonWins  || 0;
  const careerBest  = pilot.careerBestRank  || null;
  const isRookie    = !lastRank; // première saison connue
  const wasStruggling = lastRank && lastRank > 8;  // finissait loin l'an passé
  const wasTop      = lastRank && lastRank <= 3;   // podiumiste au classement
  const isCareerBest = careerBest && champPos < careerBest; // meilleur résultat de carrière
  const isBigLeap   = lastRank && (lastRank - champPos) >= 5; // progression de 5+ places

  // Headlines contextualisés
  const headlines = [
    ...(isRookie ? [
      `${pilot.name} : la révélation surprise de cette saison`,
      `Personne ne savait à quoi s'attendre. ${pilot.name} a répondu sur la piste.`,
    ] : wasStruggling ? [
      `${pilot.name} : la métamorphose. De P${lastRank} l'an dernier à P${champPos} cette saison.`,
      `Le retour de ${pilot.name} — d'une saison dans l'ombre à un top de grille`,
      `"Il est revenu différent" — ${pilot.name} en transformation totale`,
    ] : wasTop ? [
      `${pilot.name} confirme. Encore. Et c'est impressionnant.`,
      `P${lastRank} l'an passé, P${champPos} cette saison — ${pilot.name} ne connaît pas la régression`,
    ] : isBigLeap ? [
      `+${lastRank - champPos} places au classement — ${pilot.name} fait un bond historique`,
      `La progression de ${pilot.name} n'est plus une anomalie. C'est une trajectoire.`,
    ] : [
      `${pilot.name} en feu — le paddock commence à vraiment prendre note`,
      `${wins > 1 ? wins + ' victoires' : podiums + ' podiums'} — ${pilot.name} n'est plus une surprise, c'est une menace`,
      `La révélation ${team.emoji}${team.name} : ${pilot.name} crève l'écran`,
    ]),
    // Toujours disponibles
    `"On n'attendait pas ça" — ${pilot.name} déjoue tous les pronostics`,
    `${pilot.name} : et si c'était lui le grand nom de cette saison ?`,
  ];

  // Contexte inter-saisons pour le body
  const interSeasonCtx = isRookie
    ? pick([
        `Sa première saison en PL Racing. Personne ne savait vraiment à quoi s'attendre.`,
        `Premier championnat en PL Racing pour ${pilot.name} — et le paddock l'a remarqué.`,
      ])
    : wasStruggling
      ? pick([
          `L'année dernière, ${pilot.name} terminait P${lastRank} avec ${lastPts} points. Cette saison ressemble à une autre vie.`,
          `On l'a vu galérer. P${lastRank} au championnat l'an passé, ${lastWins > 0 ? lastWins + ' victoire(s)' : 'sans victoire'}. Ce qui se passe cette année change tout.`,
        ])
      : wasTop
        ? pick([
            `P${lastRank} l'an dernier, P${champPos} cette saison. La constance de ${pilot.name} force l'admiration.`,
            `Certains s'attendaient à un retour de bâton après une saison solide. ${pilot.name} a ignoré la pression.`,
          ])
        : isBigLeap
          ? `La progression parle d'elle-même : P${lastRank} l'an passé, P${champPos} cette saison. +${lastRank - champPos} places. Rare.`
          : pick([
              `Pas la première saison de ${pilot.name} en PL, et clairement pas la dernière à faire parler de lui.`,
              `Le profil s'affirme saison après saison. Cette année marque un cap.`,
            ]);

  const careerBestStr = isCareerBest
    ? `\n\n*Meilleur résultat de carrière pour ${pilot.name} au championnat pilotes.*`
    : '';

  const bodies = [
    `${interSeasonCtx} ${wins > 0 ? `${wins} victoire(s) et ${podiums} podium(s) plus tard` : `${podiums} podium(s) plus tard`}, ${pilot.name} impose le respect.\n\n` +
    pick([
      `"Il a quelque chose de différent dans l'approche des GP. Une maturité qu'on ne voit pas souvent." Une voix du paddock.`,
      `${team.emoji}${team.name} a clairement trouvé quelque chose cette saison.`,
      `P${champPos} au championnat. Si ça continue, les grandes écuries vont s'intéresser à lui de près.`,
    ]) + careerBestStr,

    `${interSeasonCtx}\n\n${pilot.name} est P${champPos} au championnat avec ${wins > 0 ? `${wins} victoire(s)` : `${podiums} podium(s)`} cette saison. ` +
    pick([
      `Son ingénieur est le premier à le dire : "Il repousse les limites à chaque sortie."`,
      `Les données télémétrie ne mentent pas — il pousse la voiture dans des zones que peu osent explorer.`,
      `Plusieurs membres du paddock ont discrètement demandé à en savoir plus sur lui.`,
    ]) + careerBestStr,
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
  const source      = pick(['pitlane_insider', 'pl_racing_news', 'paddock_whispers']);
  const lastRank    = pilot.lastSeasonRank || null;
  const wasTop      = lastRank && lastRank <= 5;
  const wasStruggling = lastRank && lastRank > 8;
  const crisisCtx   = wasTop
    ? `Lui qui terminait P${lastRank} la saison dernière. `
    : wasStruggling
      ? `Même après une saison difficile (P${lastRank}), les attentes étaient là. `
      : lastRank
        ? `P${lastRank} la saison passée — la régression interroge. `
        : '';

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
function genDriverInterviewArticle(pilot, team, standing, contract, teammate, teammateSt, seasonYear, seasonPhase, teamRankCtx = null, totalTeamsCtx = 10, lastSeasonTeamRankCtx = null) {
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
  // ── Humeur : seuils RELATIFS à l'envergure de l'écurie ────────────────
  const _perf = evalPilotPerf(pilot, team, standing, teamRankCtx, totalTeamsCtx, lastSeasonTeamRankCtx);
  let mood = 0;
  // Victoires : "bien" si on dépasse la cible, très bien si on la dépasse largement
  if (wins >= _perf.winTarget * 1.5 + 1) mood += 2;
  else if (wins >= _perf.winTarget || (wins >= 1 && _perf.isSmall)) mood += 1;
  // Podiums bonus si on en a plus que prévu
  if (pods >= _perf.podiumTarget * 1.4) mood += 1;
  // DNF : inquiétant si au-dessus de la tolérance de l'écurie
  if (dnfs >= 5) mood -= 2;
  else if (dnfs >= 4) mood -= 1;
  if (status === 'numero1') mood += 1;
  if (status === 'numero2') mood -= 1;
  // Points insuffisants en fin de saison selon l'envergure
  if (seasonPhase === 'fin' && pts < _perf.ptsTarget * 0.6) mood -= 1;
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

  // D. Performances / overall — seuils RELATIFS à l'envergure de l'écurie
  const perfFeel = (() => {
    // Champion ou largement au-dessus des attentes
    if (_perf.isChamp || wins >= Math.max(2, _perf.winTarget)) return pick([
      `"${wins} victoire${wins > 1 ? 's' : ''} cette saison — je ne m'en lasse pas. Mais le travail en amont de chaque GP est colossal."`,
      `"On est sur une très bonne dynamique. ${_perf.isTopTeam ? 'Le titre reste l\'objectif.' : 'Pour une écurie de notre taille, c\'est exceptionnel.'}${wins > 1 ? ' ' + wins + ' victoires, ça ne s\'improvise pas.' : ''}"`,
      `"${_perf.isOverperf || _perf.isSmall ? 'Personne ne nous attendait là. ' : ''}${wins} victoire${wins > 1 ? 's' : ''} — l'équipe a fait un travail remarquable tout au long de la saison."`,
    ]);
    // Première victoire surprise pour une petite/mid team
    if (wins === 1 && !_perf.isTopTeam) return pick([
      `"Cette victoire avec ${team.name}... ça restera gravé. Personne n'y croyait vraiment. Sauf nous."`,
      `"Gagner avec ${team.name}, ça prouve que tout est possible dans ce sport. Je n'oublierai jamais ce GP."`,
    ]);
    if (wins === 1) return pick([
      `"Cette victoire, elle m'a confirmé que j'avais le niveau pour gagner. Maintenant il faut transformer ça en régularité."`,
      `"Première victoire de la saison — ça fait un bien fou. L'équipe méritait ça."`,
    ]);
    // DNFs problématiques (relatifs à la tolérance de l'écurie)
    if (dnfs >= 5) return pick([ // 5+ DNF = saison catastrophique
      `"${dnfs} abandons — c'est trop, quelle que soit l'écurie. Ce n'est pas ce qu'on attendait de cette saison et je le sais mieux que quiconque."`,
      `"Les DNFs ont plombé ma saison. ${_perf.isTopTeam ? 'Une écurie comme ' + team.name + ' ne peut pas se permettre ça.' : 'Il faut qu\'on analyse ça sérieusement.'} On repart de zéro mentalement."`,
    ]);
    // Podiums mais pas de victoire — différent selon l'ambition de l'équipe
    if (pods >= _perf.podiumTarget && !_perf.isTopTeam) return pick([
      `"${pods} podiums avec ${team.name} — franchement, si on m'avait dit ça en début de saison, je n'aurais peut-être pas signé tout de suite."`,
      `"${pods} fois sur le podium. C'est au-dessus de ce qu'on visait. Le travail de l'équipe a été remarquable."`,
    ]);
    if (pods >= 3 && _perf.isTopTeam) return pick([
      `"${pods} podiums sans victoire encore — on est rapides, mais pas encore assez constants sur les moments décisifs. Ça doit changer."`,
    ]);
    if (spec) return pick([
      `"Ma spécialisation en ${spec} — ça s'est construit naturellement. Si ça me donne un avantage dans certains contextes, tant mieux."`,
      `"On me dit que je suis fort en ${spec}. Peut-être. Mais un bon pilote doit maîtriser toutes les facettes."`,
    ]);
    return pick([
      `"Saison correcte. ${_perf.isTopTeam ? 'Pas à la hauteur de nos ambitions — on le sait.' : 'Pas ce que je visais, mais on progresse.'} Le niveau général est très élevé."`,
      `"Je ne suis pas satisfait à 100% — et c'est normal. L'auto-critique, c'est ce qui fait avancer."`,
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
// ══════════════════════════════════════════════════════════
// DRIVER OF THE DAY
// ══════════════════════════════════════════════════════════
async function generateDriverOfTheDay(race, finalResults, drivers, channel) {
  if (!channel) return;

  const allTeams  = await Team.find().lean();
  const allPilots = await Pilot.find({ teamId: { $ne: null } }).lean();
  const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));
  const pilotMap  = new Map(allPilots.map(p => [String(p._id), p]));

  // Grille de départ depuis qualiGrid
  const qualiGrid    = race.qualiGrid || [];
  const startPosMap  = new Map(qualiGrid.map((g, i) => [String(g.pilotId), i + 1]));
  const totalDrivers = finalResults.length;
  const gpStyle      = race.gpStyle || 'mixte';

  // ── Calcul du score DOTD pour chaque pilote ───────────────
  const scores = [];

  for (const r of finalResults) {
    if (r.dnf) continue; // DNF exclu du vote
    const pilot  = pilotMap.get(String(r.pilotId));
    const team   = teamMap.get(String(r.teamId));
    if (!pilot || !team) continue;

    const finishPos  = r.pos;
    const startPos   = startPosMap.get(String(r.pilotId)) || finishPos;
    const placesGained = startPos - finishPos; // positif = a remonté

    let score = 0;

    // 1. Places gagnées (facteur principal)
    // +4 pts par place gagnée, -2 pts par place perdue
    score += placesGained > 0 ? placesGained * 4 : placesGained * 2;

    // 2. Résultat absolu — finir haut reste bien
    // P1=20, P2=15, P3=12, P4=8, P5=6, P6-P10=3, P11+=0
    const absoluteBonus = [20, 15, 12, 8, 6, 3, 3, 3, 3, 3];
    score += absoluteBonus[finishPos - 1] || 0;

    // 3. Underdog factor — petite écurie qui surperforme
    // carScore < 70 = petite écurie. Bonus inversement proportionnel à la force de la voiture
    const cScore      = carScore(team, gpStyle);
    const underdogMul = Math.max(0, (75 - cScore) / 75); // 0 pour top team, ~0.3 pour bas de grille
    const underdogBonus = underdogMul * finishPos <= 10 ? underdogMul * 15 : 0;
    score += underdogBonus;

    // 4. Fastest lap bonus
    if (r.fastestLap) score += 8;

    // 5. Pénalités → malus léger (ne ruine pas le score, juste pénalise)
    score -= (r.penaltySec || 0) * 0.5;

    // 6. Remontée depuis très loin en grille (P15+) → bonus spectaculaire
    if (startPos >= 15 && placesGained >= 5) score += 10;
    if (startPos >= 18 && placesGained >= 3) score += 8;

    // 7. Petite variance humaine (±3%) pour simuler le vote public imparfait
    score *= 1 + (Math.random() - 0.5) * 0.06;

    scores.push({ pilot, team, finishPos, startPos, placesGained, fastestLap: r.fastestLap, score });
  }

  if (scores.length < 2) return;

  // Trier par score décroissant
  scores.sort((a, b) => b.score - a.score);

  // Normaliser en % (les 3 premiers partagent ~100%)
  const top3    = scores.slice(0, 3);
  const total   = top3.reduce((s, d) => s + Math.max(0, d.score), 0);
  const winner  = top3[0];

  // Pourcentages directement proportionnels aux scores — reflète les vrais écarts
  // Si un pilote domine les critères, il aura 70%+. Si c'est serré, les % seront proches.
  const minScore = Math.min(...top3.map(d => d.score));
  const adjusted = top3.map(d => Math.max(0, d.score - Math.min(0, minScore))); // tout positif
  const adjSum   = adjusted.reduce((a, b) => a + b, 0);
  const pcts     = adjSum > 0
    ? adjusted.map(v => Math.round((v / adjSum) * 100))
    : [50, 30, 20];
  // Corriger l'arrondi pour que la somme = 100 exactement
  const pctSum    = pcts.reduce((a, b) => a + b, 0);
  const normalPcts = [...pcts];
  normalPcts[0] += 100 - pctSum;

  // ── Contexte narratif pour le gagnant ─────────────────────
  const gained     = winner.placesGained;
  const cScoreW    = carScore(winner.team, gpStyle);
  const isUnderdog = cScoreW < 68;

  let context = '';
  if (gained >= 8)           context = `Remonté de **P${winner.startPos}** à **P${winner.finishPos}** — +${gained} places.`;
  else if (gained >= 4)      context = `Belle remontée depuis P${winner.startPos}, termine P${winner.finishPos}.`;
  else if (gained >= 1)      context = `Progression solide : P${winner.startPos} → P${winner.finishPos}.`;
  else if (winner.finishPos === 1 && isUnderdog) context = `Victoire surprise avec une voiture de milieu de grille — éblouissant.`;
  else if (winner.finishPos === 1) context = `Victoire dominante, aucune faille du premier au dernier tour.`;
  else if (winner.fastestLap) context = `Fastest lap en prime — une course dans la course.`;
  else if (isUnderdog)        context = `Tout tiré d'une voiture qui n'était pas censée finir aussi haut.`;
  else                        context = `Régularité et intelligence de course au-dessus du lot.`;

  // ── Embed ─────────────────────────────────────────────────
  const DOTD_COLORS = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor('#E8C84A')
    .setTitle(`🏆 DRIVER OF THE DAY — ${race.emoji} ${race.circuit}`)
    .setDescription(
      `*Le vote du public est clos. La performance qui a le plus marqué les esprits ce week-end...*\n\u200B`
    );

  if (winner.pilot.photoUrl) embed.setThumbnail(winner.pilot.photoUrl);

  embed.addFields(
      {
        name: `${DOTD_COLORS[0]} ${winner.team.emoji} ${winner.pilot.name} — **${normalPcts[0]}%**`,
        value: context,
        inline: false,
      },
      ...top3.slice(1).map((d, i) => {
        const g = d.placesGained;
        const sub = g > 0 ? `+${g} places (P${d.startPos}→P${d.finishPos})`
                  : g < 0 ? `P${d.startPos}→P${d.finishPos}`
                  : `P${d.finishPos} — ligne à ligne`;
        return {
          name: `${DOTD_COLORS[i + 1]} ${d.team.emoji} ${d.pilot.name} — **${normalPcts[i + 1]}%**`,
          value: sub,
          inline: true,
        };
      })
    )
    .setFooter({ text: `Vote public · ${race.circuit} · Résultats non contractuels` });

  await sleep(4000);
  await channel.send({ embeds: [embed] });

  // Sauvegarder le DOTD dans le GPRecord du gagnant
  await PilotGPRecord.findOneAndUpdate(
    { pilotId: winner.pilot._id, raceId: race._id },
    { $set: { driverOfTheDay: true } }
  );
}

async function generatePostRaceNews(race, finalResults, season, channel) {
  const allPilots  = await Pilot.find({ teamId: { $ne: null } });
  const allTeams   = await Team.find();
  const standings  = await Standing.find({ seasonId: season._id }).sort({ points: -1 });
  const totalRaces = await Race.countDocuments({ seasonId: season._id });
  const doneRaces  = await Race.countDocuments({ seasonId: season._id, status: 'done' });
  const gpLeft     = totalRaces - doneRaces;
  const raceDoc    = await Race.findById(race._id).lean();

  // ── Phase de saison ────────────────────────────────────────
  const progress = totalRaces > 0 ? doneRaces / totalRaces : 0;
  const isEarly  = progress < 0.25;
  const isMid    = progress >= 0.25 && progress < 0.6;
  const isLate   = progress >= 0.6  && progress < 0.85;
  const isFinale = progress >= 0.85;

  const pilotMap    = new Map(allPilots.map(p => [String(p._id), p]));
  const teamMap     = new Map(allTeams.map(t => [String(t._id), t]));
  const constrSt    = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 }).lean();
  const constrRankMap = new Map(constrSt.map((s, i) => [String(s.teamId), i + 1]));
  const articlesToPost = [];

  // 1. RIVALITÉ — impossible début, rare milieu, fréquent fin
  // Éviter de republier la même rivalité à chaque GP : vérifier les articles récents
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
    // Récupérer les articles de rivalité déjà publiés cette saison pour éviter la répétition
    const recentRivalArticles = await NewsArticle.find({
      seasonYear: season.year,
      type: 'rivalry',
    }).sort({ publishedAt: -1 }).lean();
    // Indice du GP actuel pour espacer les publications (max 1 article par rivalité par phase)
    const currentGPIndex = raceDoc ? raceDoc.index : 0;
    const postedRivalKeys = new Set();
    for (const art of recentRivalArticles) {
      if (!art.pilotIds || art.pilotIds.length < 2) continue;
      const artKey = art.pilotIds.map(String).sort().join('_');
      // Cooldown : ne pas re-publier la même rivalité si < 3 GPs d'écart
      const artGP = art.raceId
        ? await Race.findById(art.raceId).select('index').lean()
        : null;
      if (artGP && (currentGPIndex - artGP.index) < 3) {
        postedRivalKeys.add(artKey);
      }
    }
    for (const [key, { pA, pB }] of rivalPairs.entries()) {
      if (postedRivalKeys.has(key)) continue; // déjà annoncé récemment
      const tA = teamMap.get(String(pA.teamId));
      const tB = teamMap.get(String(pB.teamId));
      if (tA && tB) {
        articlesToPost.push(genRivalryArticle(pA, pB, tA, tB, pA.rivalContacts, race.circuit, season.year, pA.rivalHeat || 0));
        // Tentative de surnom — le "donneur" est pA (le pilote le plus actif dans la rivalité)
        // Condition : rivalité escaladée (contacts ≥ 3 ou heat ≥ 50) + rare
        if ((pA.rivalContacts >= 3 || (pA.rivalHeat || 0) >= 50) && !pB.nickname) {
          await tryAssignNickname(pA, pB, 'rival', 0.14);
        }
      }
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
    const hypeTeamRank   = constrRankMap ? (constrRankMap.get(String(team?._id)) || 5) : 5;
    const hypeTotalTeams = allTeams.length || 10;
    const hypePerf = evalPilotPerf(pilot, team, s, hypeTeamRank, hypeTotalTeams, null);
    const qualifiesHype = hypePerf.isChamp || hypePerf.isOverperf
      || (hypePerf.isSolid && hypePerf.isSmall && s.podiums >= 1)
      || (hypePerf.isSolid && hypePerf.isMidField && s.wins >= 1);
    if (pilot && team && qualifiesHype && Math.random() < hypeChance) {
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
  const crisisTeamRank = constrRankMap ? (constrRankMap.get(String(pilot?.teamId?.toString?.())) || 5) : 5;
  const crisisPerf = evalPilotPerf(pilot, team, s, crisisTeamRank, allTeams.length || 10, null);
  const qualifiesCrisis = dnfThisRace || crisisPerf.isFlop;
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

  // 6-bis. ÉLOGES & COMPLICITÉS — basés sur les affinités positives réelles ──
  // Uniquement si deux pilotes ont une affinité >= 30 ET ont tous deux fini dans les points
  // Chance proportionnelle à la force de l'affinité et au contexte de course
  const praiseChance = isEarly ? 0.25 : isMid ? 0.4 : isLate ? 0.5 : 0.55;
  if (Math.random() < praiseChance) {
    const inPointsPilots = finalResults.filter(r => !r.dnf && r.pos <= 10);
    // Chercher une paire avec bonne affinité parmi ceux qui ont fini dans les points
    const praisePairs = [];
    for (let i = 0; i < inPointsPilots.length; i++) {
      for (let j = i + 1; j < inPointsPilots.length; j++) {
        const [sA, sB] = [String(inPointsPilots[i].pilotId), String(inPointsPilots[j].pilotId)].sort();
        try {
          const rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
          if (rel && rel.affinity >= 30) {
            const pA = pilotMap.get(String(inPointsPilots[i].pilotId));
            const pB = pilotMap.get(String(inPointsPilots[j].pilotId));
            if (pA && pB) praisePairs.push({ pA, pB, rel, rA: inPointsPilots[i], rB: inPointsPilots[j] });
          }
        } catch(e) {}
      }
    }
    if (praisePairs.length > 0) {
      const chosen = praisePairs[Math.floor(Math.random() * praisePairs.length)];
      const tA = teamMap.get(String(chosen.pA.teamId));
      const tB = teamMap.get(String(chosen.pB.teamId));
      if (tA && tB) {
        const praiseArticle = genAffinityPraiseArticle(chosen.pA, chosen.pB, tA, tB, chosen.rel, chosen.rA, chosen.rB, race.circuit, season.year);
        if (praiseArticle) articlesToPost.push(praiseArticle);
      }
    }
  }

  // ── 7-bis. ANNIVERSAIRES DE FAITS MARQUANTS ─────────────────
  // Pour chaque paire de pilotes en points, vérifier si un incident
  // s'est produit sur ce même circuit une saison précédente.
  try {
    const allRelsForCircuit = await PilotRelation.find({
      'history.circuit': race.circuit,
      'history.seasonYear': { $lt: season.year },
    }).limit(15);
    const usedAnniv = new Set();
    for (const rel of allRelsForCircuit) {
      const matchEvents = rel.history.filter(h =>
        h.circuit === race.circuit && h.seasonYear && h.seasonYear < season.year &&
        ['contact_course', 'duel_interne', 'podium_partage'].includes(h.event));
      if (!matchEvents.length) continue;
      const worstEvent = matchEvents.sort((a, b) => Math.abs(b.delta||0) - Math.abs(a.delta||0))[0];
      const pAid = String(rel.pilotA), pBid = String(rel.pilotB);
      const pairKey = [pAid, pBid].sort().join('_');
      if (usedAnniv.has(pairKey)) continue;
      const pA2 = pilotMap.get(pAid), pB2 = pilotMap.get(pBid);
      if (!pA2 || !pB2) continue;
      const tA2 = teamMap.get(String(pA2.teamId)), tB2 = teamMap.get(String(pB2.teamId));
      if (!tA2 || !tB2) continue;
      const yearsAgo = season.year - worstEvent.seasonYear;
      if (yearsAgo < 1 || yearsAgo > 5) continue;
      const chance = yearsAgo === 1 ? 0.55 : yearsAgo === 2 ? 0.40 : 0.25;
      if (Math.random() < chance) {
        const art = genAnniversaryArticle(pA2, pB2, tA2, tB2, worstEvent, yearsAgo, season.year);
        if (art) { articlesToPost.push(art); usedAnniv.add(pairKey); break; }
      }
    }
  } catch(e) { console.error('[anniversaires]', e.message); }

  // ── 7-ter. INTERVIEW EXCLUSIVE — affinité extrême ─────────────
  // Si une paire a une affinité >= 70 ou <= -65, 20% de chance
  // d'une interview exclusive après la course.
  if (Math.random() < 0.20) {
    try {
      const extremeRel = await PilotRelation.findOne({
        $or: [{ affinity: { $gte: 70 } }, { affinity: { $lte: -65 } }]
      }).sort({ updatedAt: -1 });
      if (extremeRel) {
        const pAe = pilotMap.get(String(extremeRel.pilotA));
        const pBe = pilotMap.get(String(extremeRel.pilotB));
        if (pAe && pBe) {
          const tAe = teamMap.get(String(pAe.teamId)), tBe = teamMap.get(String(pBe.teamId));
          if (tAe && tBe) {
            const intv = genExclusiveInterviewArticle(pAe, pBe, tAe, tBe, extremeRel, season.year);
            if (intv) articlesToPost.push(intv);
          }
        }
      }
    } catch(e) { console.error('[interview exclusive]', e.message); }
  }

  // ── 7-quart. RÉACTION EN CHAÎNE ──────────────────────────────
  // Vérifier si un article du GP précédent a un pendingReply actif
  try {
    const pendingRels = await PilotRelation.find({ pendingReply: true }).limit(3);
    for (const pRel of pendingRels) {
      const ctx = pRel.pendingReplyCtx || {};
      const pResp = pilotMap.get(String(ctx.responderId || pRel.pilotA));
      const pCit  = pilotMap.get(String(ctx.citedId    || pRel.pilotB));
      if (!pResp || !pCit) { pRel.pendingReply = false; await pRel.save(); continue; }
      const tResp = teamMap.get(String(pResp.teamId));
      const tCit  = teamMap.get(String(pCit.teamId));
      if (tResp && tCit) {
        const replyArt = genChainReactionArticle(pResp, pCit, tResp, tCit,
          ctx.originalHeadline || '', season.year, ctx.triggerType || 'rivalry');
        if (replyArt) articlesToPost.push(replyArt);
      }
      pRel.pendingReply = false; pRel.pendingReplyCtx = null;
      try { await pRel.save(); } catch(e) {}
    }
  } catch(e) { console.error('[réaction en chaîne]', e.message); }

  // ── 7-cinq. AFFINITÉS CROISÉES ───────────────────────────────
  // Chercher un "triangle" A-B-C où A et C sont ennemis mais amis de B
  if (Math.random() < 0.18) {
    try {
      const posRels = await PilotRelation.find({ affinity: { $gte: 35 } }).limit(20);
      for (const rel of posRels) {
        const pCenter = pilotMap.get(String(rel.pilotA));
        const pAlly   = pilotMap.get(String(rel.pilotB));
        if (!pCenter || !pAlly) continue;
        // Chercher un ennemi commun
        const [sA, sB] = [String(pCenter._id), String(pAlly._id)].sort();
        const negRels = await PilotRelation.find({
          $or: [{ pilotA: sA, affinity: { $lte: -35 } }, { pilotB: sA, affinity: { $lte: -35 } }]
        }).limit(5);
        for (const negRel of negRels) {
          const enemyId = String(negRel.pilotA) === sA ? String(negRel.pilotB) : String(negRel.pilotA);
          if (enemyId === sB) continue;
          const pEnemy = pilotMap.get(enemyId);
          if (!pEnemy) continue;
          // Vérifier que l'allié est aussi ami de l'ennemi
          const [sSB, sEn] = [sB, enemyId].sort();
          const allyEnemyRel = await PilotRelation.findOne({ pilotA: sSB, pilotB: sEn });
          if (!allyEnemyRel || allyEnemyRel.affinity < 20) continue;
          const tC = teamMap.get(String(pCenter.teamId));
          const tA = teamMap.get(String(pAlly.teamId));
          const tE = teamMap.get(String(pEnemy.teamId));
          if (tC && tA && tE) {
            const crossArt = genCrossAffinityArticle(pCenter, pAlly, pEnemy, tC, tA, tE, season.year);
            if (crossArt) { articlesToPost.push(crossArt); break; }
          }
        }
        break;
      }
    } catch(e) { console.error('[affinités croisées]', e.message); }
  }

  // ── 8. DRIVER OF THE DAY article ─────────────────────────────
  // Si quelqu'un d'autre que P1/P2 a fait une performance remarquable
  try {
    const allTeams2  = await Team.find().lean();
    const allPilots2 = await Pilot.find({ teamId: { $ne: null } }).lean();
    const teamMap2   = new Map(allTeams2.map(t => [String(t._id), t]));
    const pilotMap2  = new Map(allPilots2.map(p => [String(p._id), p]));
    const qualiGrid  = raceDoc?.qualiGrid || [];
    const startPosMap2 = new Map(qualiGrid.map((g, i) => [String(g.pilotId), i + 1]));
    const gpStyle2   = raceDoc?.gpStyle || 'mixte';

    // Calculer le score DOTD-like pour trouver le héros du jour
    const dotdScores = [];
    for (const r of finalResults) {
      if (r.dnf) continue;
      const pilot  = pilotMap2.get(String(r.pilotId));
      const team   = teamMap2.get(String(r.teamId || pilot?.teamId));
      if (!pilot || !team) continue;
      const finishPos   = r.pos;
      const startPos    = startPosMap2.get(String(r.pilotId)) || finishPos;
      const placesGained = startPos - finishPos;
      const cScore2     = carScore(team, gpStyle2);
      const underdogMul = Math.max(0, (75 - cScore2) / 75);
      let score = placesGained * 5 + underdogMul * (finishPos <= 10 ? 20 : 5);
      if (r.fastestLap) score += 8;
      if (startPos >= 15 && placesGained >= 5) score += 12;
      dotdScores.push({ pilot, team, finishPos, startPos, placesGained, score, fastestLap: r.fastestLap });
    }
    dotdScores.sort((a, b) => b.score - a.score);
    // Prendre le héros (pas le vainqueur ni P2 si pas remarquable)
    const hero = dotdScores.find(d => d.finishPos > 2 && (d.placesGained >= 3 || d.underdogMul > 0.2 || d.fastestLap)) || dotdScores[0];
    if (hero && hero.score > 10 && Math.random() < 0.65) {
      const t = hero.team;
      const p = hero.pilot;
      const gained  = hero.placesGained;
      const isUnder = carScore(t, gpStyle2) < 70;
      const source  = pick(['f1_weekly', 'pitlane_insider', 'pl_racing_news']);
      let headline, body;
      if (gained >= 5) {
        headline = pick([
          `${p.name} : la remontée du jour — de P${hero.startPos} à P${hero.finishPos}`,
          `${gained} places gagnées — ${p.name} régale le paddock`,
          `La performance à retenir : ${p.name} depuis P${hero.startPos}`,
        ]);
        body = pick([
          `Parti${gained > 0 ? '' : 'e'} de P${hero.startPos}, ${p.name} a terminé P${hero.finishPos}. ${gained} places de gagnées en course — ce n'est pas de la chance, c'est du talent pur.

${isUnder ? `Avec ${t.emoji}${t.name}, ce n'était pas la voiture la plus rapide. C'est ce qui rend la performance encore plus impressionnante.` : `${t.emoji}${t.name} avait une voiture compétitive — mais il fallait quand même le faire.`}`,
          `${gained} places gagnées. Le peloton n'a pas vu ${p.name} venir. Et c'est exactement ce qui rend cette course inoubliable.`,
        ]);
      } else if (hero.fastestLap && hero.finishPos > 5) {
        headline = pick([
          `${p.name} signe le meilleur tour — depuis P${hero.finishPos}`,
          `Meilleur tour du GP pour ${p.name} : la vitesse de pointe était là`,
          `${p.name} prouve sa vitesse brute — même depuis le fond du peloton`,
        ]);
        body = `P${hero.finishPos} au classement, mais le chrono le plus rapide de la course. ${p.name} n'a pas eu la course espérée, mais il a montré que la vitesse était là.`;
      } else if (isUnder && hero.finishPos <= 10) {
        headline = pick([
          `${t.emoji}${t.name} dans les points — ${p.name} surperforme encore`,
          `${p.name} glisse dans le top 10 — exploit pour ${t.emoji}${t.name}`,
          `"On ne s'attendait pas à ça" — ${p.name} dans les points avec ${t.emoji}${t.name}`,
        ]);
        body = `Ce n'était pas dans le script de ${t.emoji}${t.name} de finir dans les points aujourd'hui. ${p.name} a transformé une course anonyme en jolie histoire. P${hero.finishPos} — c'est au-dessus des attentes.`;
      }
      if (headline && body) {
        articlesToPost.push({
          type: 'driver_of_day', source,
          headline, body,
          pilotIds: [p._id],
          teamIds:  [t._id],
          seasonYear: season.year,
        });
      }
    }
  } catch(e) { console.error('[dotd article]', e.message); }

  const toPost = articlesToPost.slice(0, 4); // +1 slot pour inclure l'histoire du jour
  for (const articleData of toPost) {
    // Marquer pendingReply sur les articles rivalry/drama pour la réaction en chaîne
    if (['rivalry','drama'].includes(articleData.type) && articleData.pilotIds?.length >= 2) {
      const [sA, sB] = [String(articleData.pilotIds[0]), String(articleData.pilotIds[1])].sort();
      PilotRelation.findOne({ pilotA: sA, pilotB: sB }).then(rel => {
        if (!rel) return;
        if (Math.random() < 0.35) {
          rel.pendingReply = true;
          rel.pendingReplyCtx = {
            responderId:     String(articleData.pilotIds[1]),
            citedId:         String(articleData.pilotIds[0]),
            originalHeadline: articleData.headline || '',
            triggerType:     articleData.type,
          };
          rel.save().catch(() => {});
        }
      }).catch(() => {});
    }
    const article = await NewsArticle.create({ ...articleData, raceId: race._id, triggered: 'post_race', publishedAt: new Date() });
    await sleep(3000);
    await publishNews(article, channel);
  }

  // ── 6. RUMEURS CONTEXTUELLES ──────────────────────────────
  // Déclenchées par les résultats réels : DNFs, surperformance, sous-performance
  // Indépendantes de l'index de saison — elles réagissent à ce qui vient de se passer
  const contextualRumors = [];

  for (const pilot of allPilots) {
    const pilotStanding = standings.find(s => String(s.pilotId) === String(pilot._id));
    const team = teamMap.get(String(pilot.teamId));
    if (!pilot || !team || !pilotStanding) continue;

    // Récupérer les 4 derniers GPRecords pour analyser la forme
    const recentGPs = await PilotGPRecord.find({ pilotId: pilot._id })
      .sort({ raceDate: -1 }).limit(4).lean();
    if (recentGPs.length < 2) continue;

    const last3DNFs     = recentGPs.slice(0, 3).filter(r => r.dnf).length;
    const lastRaceRes   = finalResults.find(r => String(r.pilotId) === String(pilot._id));
    const lastPos       = lastRaceRes?.dnf ? null : lastRaceRes?.pos;
    const last3Wins     = recentGPs.slice(0, 3).filter(r => !r.dnf && r.finishPos === 1).length;
    const last3Podiums  = recentGPs.slice(0, 3).filter(r => !r.dnf && r.finishPos <= 3).length;
    const teamPos       = pilotStanding.points; // points en saison

    // ── RUMEUR DE LICENCIEMENT : 3 DNFs sur les 3 derniers GPs ──
    if (last3DNFs >= 3 && Math.random() < 0.70) {
      const sources  = ['pitlane_insider', 'paddock_whispers'];
      const tone     = pilot?.personality?.tone || 'diplomatique';
      const pilotQ   = tone === 'agressif' ? `"Je n'ai pas besoin qu'on me dise quoi faire."` :
                       tone === 'humble'   ? `"Je comprends la situation. Je vais me battre."` :
                       `"Ma place dans l'équipe n'est pas discutée."`;
      contextualRumors.push({
        type      : 'transfer_rumor',
        source    : pick(sources),
        headline  : `${team.emoji} ${team.name} envisagerait de se séparer de ${pilot.name} ?`,
        body      :
          `Trois abandons consécutifs. Un bilan impossible à défendre aux yeux des dirigeants de ${team.emoji} ${team.name}.\n\n` +
          `Selon nos sources proches du paddock, le management de l'équipe aurait ouvert des discussions discrètes avec des pilotes disponibles. ` +
          `Rien d'officiel encore — mais le temps presse.\n\n` +
          `${pilot.name}, contacté, répond laconiquement : *${pilotQ}*\n\n` +
          `*Affaire à suivre.*`,
        pilotIds  : [pilot._id],
        teamIds   : [team._id],
        seasonYear: season.year,
      });
    }

    // ── RUMEUR D'INTÉRÊT D'UN TOP TEAM : 2+ podiums sur les 3 derniers + dans petite écurie ──
    const constrStandingsFull = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
    const teamRank = constrStandingsFull.findIndex(s => String(s.teamId) === String(team._id)) + 1;
    const isSmallTeam = teamRank > Math.ceil(constrStandingsFull.length / 2);

    if (last3Podiums >= 2 && isSmallTeam && Math.random() < 0.65) {
      const bigTeams = allTeams.filter(t => {
        const rank = constrStandingsFull.findIndex(s => String(s.teamId) === String(t._id)) + 1;
        return rank > 0 && rank <= 3 && String(t._id) !== String(team._id);
      });
      const interestedTeam = bigTeams.length ? pick(bigTeams) : null;
      if (interestedTeam) {
        contextualRumors.push({
          type      : 'transfer_rumor',
          source    : 'pl_racing_news',
          headline  : `${interestedTeam.emoji} ${interestedTeam.name} aurait coché le nom de ${pilot.name}`,
          body      :
            `${last3Podiums} podiums en ${recentGPs.slice(0,3).length} courses. Les chiffres parlent d'eux-mêmes.\n\n` +
            `${interestedTeam.emoji} **${interestedTeam.name}** aurait demandé à ses scouts de suivre de près les performances de ` +
            `**${pilot.name}** ces dernières semaines. La source, proche du garage, parle d'"intérêt concret".\n\n` +
            `${team.emoji} ${team.name} n'a pas souhaité commenter. Ce silence en dit peut-être plus que n'importe quel démenti.\n\n` +
            `*Si un contrat existe, il expire en fin de saison.*`,
          pilotIds  : [pilot._id],
          teamIds   : [team._id, interestedTeam._id],
          seasonYear: season.year,
        });
      }
    }
  }

  // Poster max 1 rumeur contextuelle par GP (pour ne pas saturer)
  if (contextualRumors.length > 0) {
    const rumor = pick(contextualRumors);
    const rumorArticle = await NewsArticle.create({ ...rumor, raceId: race._id, triggered: 'post_race', publishedAt: new Date() });
    await sleep(4000);
    await publishNews(rumorArticle, channel);
  }
}

// ============================================================
// 🎭  INCIDENTS OFF-TRACK
// Générés ~50% des GP : drama paddock, critique voiture, incidents perso.
// Impact réel : teamChemistry ajustée, pressureLevel monté.
// ============================================================
async function generateOffTrackIncidents(race, finalResults, season, channel) {
  if (Math.random() > 0.50) return; // seulement 1 GP sur 2

  const allPilots = await Pilot.find({ teamId: { $ne: null } });
  const allTeams  = await Team.find();
  const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));

  // Choisir un pilote "protagoniste" parmi ceux avec un résultat dramatique ce GP
  const dnfPilots    = finalResults.filter(r => r.dnf).map(r => allPilots.find(p => String(p._id) === String(r.pilotId))).filter(Boolean);
  const bottomPilots = finalResults.filter(r => !r.dnf && r.pos >= 14).map(r => allPilots.find(p => String(p._id) === String(r.pilotId))).filter(Boolean);
  const topPilots    = finalResults.filter(r => !r.dnf && r.pos <= 3).map(r => allPilots.find(p => String(p._id) === String(r.pilotId))).filter(Boolean);

  const candidates = [...dnfPilots, ...bottomPilots, ...topPilots];
  if (!candidates.length) return;

  const pilot  = pick(candidates);
  const team   = teamMap.get(String(pilot.teamId));
  if (!team) return;

  const result = finalResults.find(r => String(r.pilotId) === String(pilot._id));
  const isDnf  = result?.dnf;
  const pos    = result?.pos;
  const tone   = pilot?.personality?.tone || 'diplomatique';

  const INCIDENTS = [
    // ── Critique publique de la voiture (surtout DNF mécanique) ──
    ...(isDnf && result.dnfReason === 'MECHANICAL' ? [{
      chance    : 0.65,
      teamChemDelta: -6,
      pressureDelta: 10,
      headline  : `${pilot.name} critique ouvertement ${team.emoji} ${team.name}`,
      body      : () => {
        const q = tone === 'agressif'    ? `"Cette voiture n'est pas digne de moi. Ça doit changer."` :
                  tone === 'sarcastique' ? `"Impressionnant. Même pas capable de finir un Grand Prix."` :
                  tone === 'ironique'    ? `"Je ne sais pas si c'est de la malchance ou de la conception. Les deux, peut-être."` :
                  `"Je suis frustré. L'équipe doit faire mieux — et je leur ai dit en face."`;
        return (
          `En salle de presse après l'abandon, **${pilot.name}** n'a pas mâché ses mots.\n\n` +
          `*${q}*\n\n` +
          `Le directeur technique de ${team.emoji} ${team.name} a répondu sobrement : *"On analyse. Les réponses viendront en interne."* ` +
          `Un message clair : la tension monte dans le garage.`
        );
      },
    }] : []),

    // ── Soirée qui dérape après une victoire ──
    ...(pos === 1 ? [{
      chance    : 0.40,
      teamChemDelta: +2,
      pressureDelta: -5,
      headline  : `La fête de ${pilot.name} — dans les coulisses`,
      body      : () => {
        const venues = ['un restaurant étoilé de Monaco', 'un rooftop à Dubaï', 'une villa en bord de mer', 'un club privé de Monte-Carlo'];
        const venue  = pick(venues);
        return (
          `Après la victoire à ${race.circuit}, **${pilot.name}** a réuni toute l'équipe ${team.emoji} ${team.name} ` +
          `dans ${venue} pour fêter le résultat.\n\n` +
          `Photos, stories, quelques déclarations bien arrosées — *"C'est pour ça qu'on fait ce métier."* — et une addition dont on préfère ne pas parler.\n\n` +
          `L'ambiance dans le garage est au beau fixe. Pour l'instant.`
        );
      },
    }] : []),

    // ── Incident anodin qui tourne mal ──
    {
      chance    : 0.30,
      teamChemDelta: -3,
      pressureDelta: 5,
      headline  : `Tension dans le garage — ${pilot.name} et ${team.name}`,
      body      : () => {
        const scenarios = [
          `Un commentaire d'ingénieur sur la radio mal pris. Un briefing qui dérape. **${pilot.name}** aurait quitté la salle sans un mot après que l'équipe a remis en question son approche en qualifs.\n\n*"Ce n'est rien"*, minimise-t-on chez ${team.emoji} ${team.name}. Mais les langues se délient.`,
          `**${pilot.name}** serait arrivé en retard au briefing pré-course de ${race.circuit}. Rien de grave en apparence — mais dans un contexte déjà tendu avec ${team.emoji} ${team.name}, les petits signaux s'accumulent.`,
          `L'entourage de **${pilot.name}** aurait refusé d'assister à une session de relations publiques organisée par ${team.emoji} ${team.name}. Une agence de communication, une conférence partenaire, un sponsoring — et un "non" qui ne passe pas bien en interne.`,
        ];
        return pick(scenarios);
      },
    },

    // ── Polémique réseaux sociaux ──
    {
      chance    : 0.35,
      teamChemDelta: -2,
      pressureDelta: 8,
      headline  : `${pilot.name} s'enflamme sur les réseaux`,
      body      : () => {
        const postTrigger = isDnf ? `après son abandon à ${race.circuit}` : pos && pos > 12 ? `suite à sa déception à ${race.circuit}` : `depuis ${race.circuit}`;
        const posts = [
          `Un story supprimée trop tard. Un like malencontreux. Une réponse à un compte troll qui a enflammé les débats.\n\n**${pilot.name}** a posté ${postTrigger} un message suffisamment ambigu pour que tout le monde y trouve midi à sa porte. Son agent gère. Le paddock commente.`,
          `Un message cryptique ${postTrigger} — *"Certaines choses se règlent en interne. Ou pas."* — a été interprété de toutes les façons possibles. **${pilot.name}** n'a pas confirmé. N'a pas démenti.`,
        ];
        return pick(posts);
      },
    },
  ];

  // Filtrer selon les chances et choisir un incident
  const eligible = INCIDENTS.filter(inc => Math.random() < inc.chance);
  if (!eligible.length) return;

  const incident = pick(eligible);

  // Appliquer les conséquences sur le pilote
  await Pilot.findByIdAndUpdate(pilot._id, {
    $inc: {
      'personality.teamChemistry': incident.teamChemDelta,
      'personality.pressureLevel': incident.pressureDelta,
    }
  });
  // Clamper teamChemistry entre 10 et 90
  const updated = await Pilot.findById(pilot._id);
  if (updated?.personality) {
    const chem = Math.max(10, Math.min(90, updated.personality.teamChemistry || 50));
    const pres = Math.max(0,  Math.min(100, updated.personality.pressureLevel || 0));
    await Pilot.findByIdAndUpdate(pilot._id, { 'personality.teamChemistry': chem, 'personality.pressureLevel': pres });
  }

  // Créer l'article de news
  const articleData = {
    type      : 'drama',
    source    : pick(['pitlane_insider', 'paddock_whispers', 'pl_racing_news']),
    headline  : incident.headline,
    body      : incident.body(),
    pilotIds  : [pilot._id],
    teamIds   : [team._id],
    raceId    : race._id,
    seasonYear: season.year,
  };
  try {
    const article = await NewsArticle.create({ ...articleData, triggered: 'post_race', publishedAt: new Date() });
    await sleep(5000);
    if (channel) await publishNews(article, channel);
  } catch (e) {
    console.error('[generateOffTrackIncidents] erreur :', e.message);
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
      // Buzz amplifié si petite équipe (surprise) vs top team (attendu)
      const _sRank = 5; // valeur par défaut sans contexte constructeur live
      const _sPerf = evalPilotPerf(pilot, team, standing, _sRank, 10, null);
      const surpriseLine = _sPerf.isSmall
        ? pick([`"${team.emoji}${team.name} qui gagne ? En 2025 tout est possible 😭" — top commentaire`, `Les gens n'en croyaient pas leurs yeux. ${team.name} en tête des tendances.`])
        : pick([`Parmi les commentaires, beaucoup de "GOAT 🐐" et des mentions de ses rivaux. L'ambiance est électrique.`, `Des célébrités, des athlètes, des pilotes adverses — tout le monde a liké. Même ${team.name} a relayé.`]);
      const body = `Une simple photo publiée dans l'heure suivant sa victoire — et les chiffres ont tout de suite parlé.\n\n` +
        `**${likes} likes · ${randInt(2, 48)}K commentaires · ${randInt(5, 80)}K partages** en moins de 24h. Le compte de ${pilot.name} a gagné **+${randInt(8, 120)}K abonnés** dans la foulée.\n\n` +
        pick([
          surpriseLine,
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
        if (tA && tB) { markUsed(pA, pB); return genRivalryArticle(pA, pB, tA, tB, pA.rivalContacts || 1, '(récent)', season.year, pA.rivalHeat || 0); }
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
    // Seuil hype relatif : overperf ou champ selon envergure équipe
    const _allConstrSt = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 }).lean();
    const _crMap = new Map(_allConstrSt.map((s,i) => [String(s.teamId), i+1]));
    const _nT = _allConstrSt.length || 10;
    const st = sorted.find(s => {
      if (usedPilotIds.has(String(s.pilotId))) return false;
      const _p = allPilots.find(p => String(p._id) === String(s.pilotId));
      const _t = _p ? teamMap.get(String(_p.teamId)) : null;
      if (!_p || !_t) return false;
      const _r = _crMap.get(String(_t._id)) || 5;
      const _ev = evalPilotPerf(_p, _t, s, _r, _nT, null);
      return _ev.isChamp || _ev.isOverperf || (_ev.isSolid && _ev.isSmall && (s.podiums||0) >= 1);
    }) || sorted[0];
    if (!st) return null;
    const pilot = allPilots.find(p => String(p._id) === String(st.pilotId));
    const team  = pilot ? teamMap.get(String(pilot.teamId)) : null;
    if (!pilot || !team) return null;
    markUsed(pilot);
    return genHypeArticle(pilot, team, st.wins||0, st.podiums||0, season.year, sorted.findIndex(s => String(s.pilotId) === String(pilot._id)) + 1);

  } else if (type === 'form_crisis') {
    const standings = await getStandings();
    const sorted = [...standings].sort((a, b) => b.points - a.points);
    // Crise relative : flop selon envergure de l'équipe
    const _allCst2 = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 }).lean();
    const _crMap2 = new Map(_allCst2.map((s,i) => [String(s.teamId), i+1]));
    const _nT2 = _allCst2.length || 10;
    const st = sorted.find(s => {
      if (usedPilotIds.has(String(s.pilotId))) return false;
      const _p2 = allPilots.find(p => String(p._id) === String(s.pilotId));
      const _t2 = _p2 ? teamMap.get(String(_p2.teamId)) : null;
      if (!_p2 || !_t2) return false;
      const _r2 = _crMap2.get(String(_t2._id)) || 5;
      const _ev2 = evalPilotPerf(_p2, _t2, s, _r2, _nT2, null);
      return _ev2.isFlop;
    });
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
    // Passer le rang constructeur pour les seuils relatifs
    const _intCst = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 }).lean();
    const _intRank = _intCst.findIndex(s => String(s.teamId) === String(team._id)) + 1 || 5;
    const _intLast = pilot.lastSeasonRank ? Math.round(pilot.lastSeasonRank * (_intCst.length||10) / 20) : null;
    markUsed(pilot);
    return genDriverInterviewArticle(pilot, team, standing, contract, teammate, teammateSt, season.year, spPhase, _intRank, _intCst.length||10, _intLast);

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
    // Prioriser les vrais amis (affinité >= 30) pour les articles d'amitié
    // Sinon fallback sur une paire aléatoire
    let pA = null, pB = null;
    try {
      const positiveRels = await PilotRelation.find({ affinity: { $gte: 30 } })
        .sort({ affinity: -1 }).limit(20).lean();
      for (const rel of positiveRels) {
        const cA = allPilots.find(p => String(p._id) === rel.pilotA && !usedPilotIds.has(String(p._id)));
        const cB = allPilots.find(p => String(p._id) === rel.pilotB && !usedPilotIds.has(String(p._id)));
        if (cA && cB && teamMap.get(String(cA.teamId)) && teamMap.get(String(cB.teamId))) {
          pA = cA; pB = cB; break;
        }
      }
    } catch(e) {}
    // Fallback si aucune relation positive trouvée
    if (!pA) pA = P();
    if (!pB) pB = pick(allPilots.filter(p => String(p._id) !== String(pA._id) && !usedPilotIds.has(String(p._id)))) ||
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
  const count      = season.status === 'transfer'
    ? Math.max(2, Math.min(4, baseCount + 1 + (Math.random() < 0.4 ? 1 : 0))) // mercato = plus d'articles
    : Math.max(1, Math.min(3, baseCount + (Math.random() < 0.35 ? 1 : 0)));

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

  // ── MERCATO : boost massif des rumeurs de transfert ──────────
  // Pendant la période de transfert, le paddock ne parle que de ça.
  // Toutes les autres thématiques reculent au profit du mercato.
  if (season.status === 'transfer') {
    // transfer_rumor prend la moitié des poids du slot : poids fixé à 60
    rawWeights.transfer_rumor = 60;
    rawWeights.drama          = Math.max(2, (rawWeights.drama          || 0) - 5);
    rawWeights.lifestyle      = Math.max(2, (rawWeights.lifestyle      || 0) - 6);
    rawWeights.brand_deal     = Math.max(2, (rawWeights.brand_deal     || 0) - 4);
    rawWeights.charity        = Math.max(1, (rawWeights.charity        || 0) - 4);
    rawWeights.tv_show        = Math.max(1, (rawWeights.tv_show        || 0) - 4);
    rawWeights.friendship     = Math.max(1, (rawWeights.friendship     || 0) - 4);
    rawWeights.scandal_offtrack = Math.max(4, (rawWeights.scandal_offtrack || 0));
    // Article supplémentaire garanti pendant le mercato
    // count sera re-calculé après mais on le monte d'1 minimum
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

  // ── Chimie d'écurie — pré-calcul avant la course ─────────
  // Calcule la moyenne des affinités coéquipiers pour chaque écurie.
  // Si la moyenne est négative → les mécaniciens sont démotivés → malus de fiabilité.
  // Si la moyenne est très positive → bonus de devPoints via evolveCarStats.
  const teamChemistryMalusMap = new Map(); // teamId → reliabilityMalus (0.0–0.25)
  for (const team of teams) {
    const teamPilots = pilots.filter(p => String(p.teamId) === String(team._id));
    if (teamPilots.length < 2) { teamChemistryMalusMap.set(String(team._id), 0); continue; }
    const [sA, sB] = [String(teamPilots[0]._id), String(teamPilots[1]._id)].sort();
    try {
      const rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB }).lean();
      const avgAff = rel ? rel.affinity : 0;
      // Malus actif seulement si affinité moyenne négative
      // Plage : affinity -100 → malus 0.25 (max) | affinity 0 → malus 0 | positif → 0
      const malus = avgAff < 0 ? Math.min(0.25, Math.abs(avgAff) / 400) : 0;
      teamChemistryMalusMap.set(String(team._id), malus);
    } catch(e) { teamChemistryMalusMap.set(String(team._id), 0); }
  }

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
    : randInt(18, 28);
  let weatherChanged = false; // flag pour n'annoncer qu'une fois par changement
  let weatherChangeCount = 0; // max 2 changements par course

  // ── Prévision météo annoncée au départ si instable ────────
  // Si la météo de départ n'est pas DRY, ou si la 1ère transition est probable avant le 1/3 de course
  if (channel) {
    const weatherLabelsShort = { DRY:'☀️ Sec', WET:'🌧️ Pluie', INTER:'🌦️ Mixte', HOT:'🔥 Canicule' };
    const isRiskyWeather = weather !== 'DRY' || nextWeatherChangeLap < totalLaps * 0.35;
    if (isRiskyWeather) {
      const forecastMsgs = {
        WET   : `🌧️ *Conditions difficiles au départ — pluie déclarée. Les stratèges vont travailler d'arrache-pied.*`,
        INTER : `🌦️ *Piste mixte au départ — les équipes hésitent entre inter' et slicks. Chaque décision compte.*`,
        HOT   : `🔥 *Canicule annoncée — les pneus vont souffrir. La gestion thermique sera la clé.*`,
        DRY   : `☀️ *Météo sèche au départ, mais les prévisions restent instables — attention aux changements en course.*`,
      };
      try { await channel.send(forecastMsgs[weather] || ''); } catch(e) {}
      await new Promise(r => setTimeout(r, 2000));
    }
  }

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
      totalTime       : idx * 400, // ~0.4s entre positions au départ (réaliste F1 quali)
      tireCompound    : startCompound,
      tireWear        : 0,
      tireAge         : 0,
      usedCompounds   : [startCompound],
      pitStops        : 0,
      pittedThisLap   : false,
      lastPitLap      : 0,
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
      damagedCar      : null,   // { lapPenalty: ms } — pénalité de rythme par tour après collision
      homeGP          : isHomeGP(pilot, race), // true si le pilote court à domicile ce GP
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

  // ── GP à domicile — annonce + boost pression ──────────────
  // Identifier les pilotes qui courent chez eux ce weekend.
  // Effets : léger bonus de rythme en course (~-180ms/tour via homeGPF)
  //          + montée de pression immédiate (foule, attentes)
  //          + article "local hero" avant le départ
  const homePilots = drivers.filter(d => d.homeGP);
  if (homePilots.length > 0 && channel) {
    try {
      const homeLines = homePilots.map(d => {
        const flag = d.pilot.nationality?.split(' ')[0] || '🏁';
        return `${d.team.emoji} **${d.pilot.name}** ${flag} — part depuis la P${d.startPos}`;
      });
      const homeEmbed = new EmbedBuilder()
        .setTitle(`🏠 GP à DOMICILE — ${race.emoji} ${race.circuit}`)
        .setColor('#FFD700')
        .setDescription(
          `**${homePilots.length === 1 ? 'Un pilote' : `${homePilots.length} pilotes`} courent devant leur public ce weekend :**\n\n` +
          homeLines.join('\n') +
          `\n\n*La pression du public, l'énergie de la foule — et une pression supplémentaire à gérer.*`
        );
      await channel.send({ embeds: [homeEmbed] });
      await sleep(3000);
    } catch(e) { console.error('[HomeGP announce]', e.message); }

    // Montée de pression : la foule et les attentes augmentent le pressureLevel
    for (const d of homePilots) {
      try {
        const currentPressure = d.pilot.personality?.pressureLevel || 0;
        const newPressure = Math.min(100, currentPressure + 15);
        await Pilot.findByIdAndUpdate(d.pilot._id, { 'personality.pressureLevel': newPressure });
        d.pilot.personality = d.pilot.personality || {};
        d.pilot.personality.pressureLevel = newPressure;
      } catch(e) { /* silencieux */ }
    }
  }
  let scCooldown       = 0;
  let scRestartCooldown = 0; // tours restants de cap de positions post-SC
  let fastestLapMs     = Infinity;
  let fastestLapHolder = null;
  let prevFastestHolder = null; // pour détecter nouveau meilleur tour
  const existingCircuitRecord = await CircuitRecord.findOne({ circuit: race.circuit });
  const raceCollisions = [];
  const battleMap      = new Map();
  const undercutTracker = new Map(); // pilotId → { pitLap, pilotAheadPos }
  const overcutTracker  = new Map(); // pilotId → { startLap, rivalId, myPosAtStart }
  const racePenalties   = []; // { pilotId, seconds, reason, lap } — pénalités cumulées
  const pendingInvestigations = []; // { attackerId, victimId, lap } — décision post-GP
  // ── Fil radio et fenêtres stratégiques ────────────────────
  const stratWindowFired = new Set(); // pilotId_stintIndex → max 1 alerte par stint
  const radioFiredLaps   = new Set(); // `${pilotId}_${lap}` → évite les doublons radio

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
  // 🎬  INTRO VIDÉO + PRÉSENTATION TV
  // ══════════════════════════════════════════════════════════
  if (channel && (raceIntroUrl || raceIntroPath)) {
    try {
      // ── Envoi de la vidéo comme fichier (player Discord click-to-play, pas d'autoplay) ──
      if (raceIntroUrl) {
        // Envoyer l'URL directement — Discord génère automatiquement un player vidéo natif.
        // ⚠️ Ne PAS utiliser AttachmentBuilder(url) : discord.js téléchargerait tout le fichier
        // en RAM avant d'uploader → crash OOM garanti sur les gros fichiers (200 Mo+).
        await channel.send(raceIntroUrl);
      } else if (raceIntroPath) {
        // Fichier local : AttachmentBuilder est OK car Node stream depuis le disque sans tout charger
        const { AttachmentBuilder } = require('discord.js');
        const attachment = new AttachmentBuilder(raceIntroPath, { name: 'intro_f1.mp4' });
        await channel.send({ files: [attachment] });
      }

      // ── Présentation TV réaliste juste en dessous de la vidéo ──
      const now      = new Date();
      const hh       = String(now.getHours()).padStart(2, '0');
      const mm       = String(now.getMinutes()).padStart(2, '0');
      const heureStr = `${hh}h${mm}`;

      // Diffuseurs F1 selon la langue/région — liste réaliste
      const BROADCASTERS = [
        { name: 'Canal+',        flag: '🇫🇷', desc: 'Formule 1® en exclusivité' },
        { name: 'Sky Sports F1', flag: '🇬🇧', desc: 'Live & Exclusive Coverage' },
        { name: 'F1 TV Pro',     flag: '🌍', desc: 'Streaming mondial' },
        { name: 'RTL',           flag: '🇩🇪', desc: 'Formel 1 live' },
        { name: 'DAZN',          flag: '🇪🇸', desc: 'Fórmula 1 en vivo' },
        { name: 'ServusTV',      flag: '🇦🇹', desc: 'Formel 1 live' },
      ];
      // Canal+ en premier, puis 2 autres aléatoires
      const mainBroad = BROADCASTERS[0];
      const otherBroads = BROADCASTERS.slice(1).sort(() => Math.random() - 0.5).slice(0, 2);
      const broadcastField = [mainBroad, ...otherBroads]
        .map(b => `${b.flag} **${b.name}** — *${b.desc}*`)
        .join('\n');

      const weatherLabelTV = {
        DRY  : '☀️ Conditions sèches',
        HOT  : '🔥 Canicule — piste très chaude',
        INTER: '🌦️ Piste mixte',
        WET  : '🌧️ Pluie — piste humide',
      }[weather] || '☀️ Conditions sèches';

      const circuitName = race.circuit.replace(' GP', '');

      const tvEmbed = new EmbedBuilder()
        .setColor('#E4000F')
        .setTitle(`🔴  EN DIRECT — ${race.emoji} FORMULA 1® ${circuitName.toUpperCase()} GRAND PRIX`)
        .setDescription(
          `**${heureStr} · Direct depuis ${race.country}**\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .addFields(
          {
            name: '📡 Diffusion',
            value: broadcastField,
            inline: false,
          },
          {
            name: '🏁 Circuit',
            value: `${race.emoji} **${race.circuit}** — ${race.country}\n${weatherLabelTV} · **${totalLaps} tours**`,
            inline: true,
          },
          {
            name: '🕐 Heure locale',
            value: `**${heureStr}** (Paris)`,
            inline: true,
          },
        )
        .setFooter({ text: '🏎️ Formula 1® — Tous droits réservés · Diffusion officielle' })
        .setTimestamp();

      await channel.send({ embeds: [tvEmbed] });

      // ── Courte pause avant la grille ──
      await sleep(8_000);
    } catch (e) {
      console.warn('[simulateRace] Impossible d\'envoyer l\'intro vidéo :', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // PRE-RACE — Grille de départ (format F1 : P1 gauche · P2 droite · P3 gauche · P4 droite...)
  // ══════════════════════════════════════════════════════════
  const makeGridLine = (d, pos) => {
    const ov   = overallRating(d.pilot);
    const tier = ratingTier(ov);
    return `\`P${String(pos).padStart(2,' ')}\` ${d.team.emoji} **${d.pilot.name}** ${tier.badge}${ov} ${TIRE[d.tireCompound] ? `${TIRE[d.tireCompound].emoji} ${TIRE[d.tireCompound].code}` : '?'}`;
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
  // ── Safety Car state — initialisé avant la boucle ──────────
  let scState = { state: 'NONE', lapsLeft: 0 };

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
    let trafficEscapeAnnouncedThisLap = false; // max 1 message "se dégage du trafic" par tour
    // let — mis à jour après résolution SC plus bas dans le tour
    let scActive = scState.state !== 'NONE';

    // ── Changement de météo dynamique ───────────────────────
    if (lap === nextWeatherChangeLap && lap < totalLaps - 5 && weatherChangeCount < 2) {
      const prevWeather = weather;
      weather = nextWeather(weather);
      // Planifier le prochain changement possible
      nextWeatherChangeLap = lap + randInt(18, 28);
      weatherChanged = weather !== prevWeather;
      if (weatherChanged) weatherChangeCount++;

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
            const wornThrD = wornThresholdFor(d.tireCompound, d.team, d.pilot);
            if (adapt >= 75) {
              // Reactif : pit garanti ce tour (tireWear > urgentThreshold)
              d.tireWear = Math.max(d.tireWear, Math.round(wornThrD * 1.30));
            } else if (adapt >= 50) {
              // Moyen : pit tres probable (tireWear > wornThreshold)
              d.tireWear = Math.max(d.tireWear, Math.round(wornThrD * 1.05));
              d.catchUpDebt = (d.catchUpDebt || 0) + 2000;
            } else {
              // Lent : reagit mais tarde 1-2 tours de plus
              d.tireWear = Math.max(d.tireWear, Math.round(wornThrD * 0.82));
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
          `***🏁 DERNIER TOUR !!! ${leaderFinal.team.emoji}${leaderFinal.pilot.name} EN TÊTE — MAIS ${secondFinal?.team.emoji}${secondFinal?.pilot.name} EST À ${fmtGapSec(gapFinal, {prefix:false})} !!! TOUT PEUT ENCORE BASCULER !!!***`,
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
      // Récupérer le malus de fiabilité de la chimie d'écurie (pré-calculé avant la course)
      const teamReliabilityMalus = teamChemistryMalusMap.get(String(driver.team._id)) || 0;
      const incident = checkIncident(driver.pilot, driver.team, lap, totalLaps, teamReliabilityMalus);
      if (!incident) continue;
      if (scActive && (incident.type === 'CRASH' || incident.type === 'PUNCTURE')) continue;

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
          raceCollisions.push({ attackerId: String(driver.pilot._id), victimId: String(nearest.pilot._id), type: 'crash' });

          const crashAreRivals = (
            (driver.pilot.rivalId && String(driver.pilot.rivalId) === String(nearest.pilot._id)) ||
            (nearest.pilot.rivalId && String(nearest.pilot.rivalId) === String(driver.pilot._id))
          );
          const crashRivalHeat = crashAreRivals
            ? (driver.pilot.rivalHeat || nearest.pilot.rivalHeat || 0) : 0;

          if (victimDnf) {
            nearest.dnf       = true;
            nearest.dnfLap    = lap;
            nearest.dnfReason = 'CRASH';
            lapDnfs.push({ driver: nearest, reason: 'CRASH' });
            lapIncidents.push({ type: 'CRASH' });
            incidentText = collisionDescription(driver, nearest, lap, true, true, 0, crashAreRivals, crashRivalHeat);
          } else {
            nearest.totalTime += damage;
            nearest.catchUpDebt = (nearest.catchUpDebt || 0) + damage;

            // ── Voiture abîmée : pénalité de rythme par tour jusqu'au pit ──
            // La voiture perd beaucoup de rythme à cause des dégâts aérodynamiques/mécaniques
            // Plus les dégâts sont lourds, plus la perte de rythme est importante
            const lapPenalty = damage > 6000
              ? randInt(2200, 3500)   // gros dégâts : -2.2s à -3.5s/tour
              : randInt(1400, 2200);  // dégâts modérés : -1.4s à -2.2s/tour
            nearest.damagedCar = { lapPenalty };

            // ── Pit forcé : quasi-obligatoire en cas de dégâts structurels ──
            // Probabilité élevée (70-92%) selon l'ampleur des dégâts
            // (ancienne valeur : 30% — irréaliste pour une voiture abîmée)
            const heavyDamage   = damage > 6000;
            const forcedPitProb = heavyDamage ? 0.92 : 0.70;
            const forcedPit = Math.random() < forcedPitProb && (nearest.pitStops || 0) < 3 && lapsRemaining > 6;
            if (forcedPit) {
              // Aileron plus probable sur gros chocs (dégâts aéro visibles)
              const dmgType  = heavyDamage
                ? (Math.random() < 0.75 ? 'aileron' : 'suspension')
                : (Math.random() < 0.55 ? 'aileron' : 'suspension');
              nearest.pendingRepair    = dmgType;
              nearest.damagedPartLabel = dmgType === 'aileron' ? 'aileron avant' : 'suspension';
              nearest.tireWear = Math.max(nearest.tireWear || 0, 50);
              nearest.tireAge  = 99;
              // Nommer la pièce dans la description du contact
              const dmgLabelShort = nearest.damagedPartLabel;
              const dmgUrgency = heavyDamage
                ? `🔧 **${nearest.pilot.name} doit rentrer en urgence — ${dmgLabelShort} touché${dmgType === 'aileron' ? '' : 'e'} !** *Arrêt obligé pour réparation.*`
                : `🔧 *${nearest.pilot.name} rentre aux stands — ${dmgLabelShort} endommagé${dmgType === 'aileron' ? '' : 'e'} lors du contact.*`;
              incidentText = collisionDescription(driver, nearest, lap, true, false, damage, crashAreRivals, crashRivalHeat) +
                `\n  ${dmgUrgency}`;
            } else {
              incidentText = collisionDescription(driver, nearest, lap, true, false, damage, crashAreRivals, crashRivalHeat);
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
          if (incidentText) {
            events.push({ priority: 10, text: incidentText, gif: pickGif('crash_solo') });
            if (driver.pilot?.personality && Math.random() < 0.4) {
              const rq = getRadioQuote(driver.pilot, 'dnf');
              if (rq) events.push({ priority: 2, text: `📻 *Radio ${driver.pilot.name} :* *"${rq}"*` });
            }
          }
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
    // Mettre à jour scActive après résolution SC
    scActive = scState.state !== 'NONE';

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
        // Quote radio SC
        const scLeader = drivers.filter(d=>!d.dnf).sort((a,b)=>a.pos-b.pos)[0];
        if (scLeader?.pilot?.personality && Math.random() < 0.45) {
          const rq = getRadioQuote(scLeader.pilot, 'safety_car');
          if (rq) events.push({ priority: 2, text: `📻 *Radio ${scLeader.pilot.name} :* *"${rq}"*` });
        }
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
      scRestartCooldown = 3; // cap +2 positions par tour pendant 3 tours post-relance
      const rankedRestart = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      const top3str = rankedRestart.slice(0,3).map((d,i) => `P${i+1} ${d.team.emoji}**${d.pilot.name}**`).join(' · ');
      events.push({ priority: 10, gif: pickGif('green_flag'), text: pick([
        `🟢 **GREEN FLAG !** T${lap} — La course reprend ! ${top3str}\nLes gaps ont été effacés — tout le monde est dans le même mouchoir. Ça va exploser !`,
        `🟢 **FEU VERT !** T${lap} — On repart ! ${top3str}\nLe peloton est groupé — qui va attaquer en premier ?`,
      ]) });
    }

    // ── Calcul des temps au tour ─────────────────────────────
    if (scCooldown > 0) scCooldown--;
    if (scRestartCooldown > 0) scRestartCooldown--;

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
          scCooldown,
          driver.homeGP ? 0.9980 : 1.0   // GP à domicile : ~-180ms/tour (0.2% plus rapide)
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
          // Max 1 message "se dégage du trafic" par tour — évite le spam multi-pilotes
          if (driver.trafficLapsLeft === 0 && !trafficEscapeAnnouncedThisLap) {
            trafficEscapeAnnouncedThisLap = true;
            events.push({ priority: 2, text:
              `🚦 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** parvient à se dégager du trafic après son arrêt.`
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
            const defWear = driver.pilot.defense < 50 ? 0.35 : 0.12;
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

        // ── Pénalité de rythme — voiture abîmée après accrochage ──
        // Appliquée jusqu'au prochain arrêt aux stands (pendingRepair est alors effacé)
        if (driver.damagedCar) {
          lt += driver.damagedCar.lapPenalty;
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

    // ── Cap positions post-SC restart : max +2 places par tour ─────────
    // Empêche les remontées express type P5→P1 en 1 tour après green flag
    if (scRestartCooldown > 0 && !scActive) {
      const preRestartSnap = drivers.filter(d => !d.dnf).map(d => ({ id: String(d.pilot._id), pos: d.pos }));
      drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => {
        const prev = preRestartSnap.find(s => s.id === String(d.pilot._id));
        const prevPos = prev ? prev.pos : i + 1;
        const maxGain = 2; // max 2 places par tour pendant scRestartCooldown
        const newPos = i + 1;
        if (newPos < prevPos - maxGain) {
          // Bloquer en échangeant totalTime avec le pilote à prevPos-maxGain
          const targetPos = prevPos - maxGain;
          const occupant = drivers.find(dx => !dx.dnf && dx.pos === targetPos);
          if (occupant && occupant !== d) {
            const tmpTime = d.totalTime;
            d.totalTime = occupant.totalTime + 1;
            occupant.totalTime = tmpTime - 1;
          }
        }
      });
      drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
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

      // ── Strategy window : alerte quand les pneus d'un leader approchent du cliff ──
      // Déclenché une seule fois par stint (stintIndex = pitStops actuel)
      if (!scActive && lapsRemaining > 6) {
        const wornThr  = wornThresholdFor(driver.tireCompound, driver.team, driver.pilot);
        const wornPct  = (driver.tireWear || 0) / wornThr;
        const swKey    = `${String(driver.pilot._id)}_${driver.pitStops}`;
        const isLeaderOrTop5 = driver.pos <= 5;
        // Fenêtre : entre 80% et 95% du seuil — alerte avant que ça se voie vraiment
        if (isLeaderOrTop5 && wornPct >= 0.80 && wornPct < 0.96 && !stratWindowFired.has(swKey)) {
          stratWindowFired.add(swKey);
          const td = TIRE[driver.tireCompound];
          const compStr = td ? `${td.emoji} ${td.code}` : driver.tireCompound;
          const tireWarnLabel = wornPct >= 0.90
            ? `*pneus dans le rouge*`
            : `*pneus qui s'approchent du cliff*`;
          const stratMsgs = driver.pos === 1 ? [
            `🔧 **T${lap} — FENÊTRE STRATÉGIQUE !** ${driver.team.emoji}**${driver.pilot.name}** (P1) roule sur des ${compStr} ${tireWarnLabel}. *La question n'est plus si il va pitter, mais quand. Et ses rivaux le savent.*`,
            `📡 **T${lap}** — Le mur de ${driver.team.emoji}**${driver.team.name}** surveille les données : ${driver.pilot.name} (P1) a des ${compStr} ${tireWarnLabel}. *Chaque tour au-dehors est un risque.*`,
            `🎯 **T${lap} — DÉCISION IMMINENTE** pour ${driver.team.emoji}**${driver.pilot.name}** (P1) — ses ${compStr} ${tireWarnLabel}. *Est-ce qu'il tient encore quelques tours, ou est-ce que l'écurie intervient maintenant ?*`,
          ] : driver.pos <= 3 ? [
            `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) sur des ${compStr} ${tireWarnLabel}. *La fenêtre stratégique s'ouvre — ses rivaux directs vont-ils en profiter ?*`,
            `📻 **T${lap}** — Attention à ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) : ses ${compStr} vieillissent. ${tireWarnLabel}. *Il va falloir choisir.*`,
            `⚠️ **T${lap}** — Les pneus de ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) commencent à parler — ${compStr} ${tireWarnLabel}. *La stratégie de l'écurie va être scrutée de près.*`,
          ] : [
            `📡 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) roule sur des ${compStr} ${tireWarnLabel}. *L'arrêt aux stands se dessine.*`,
            `🔭 **T${lap}** — Données en provenance du ${driver.team.name} : les ${compStr} de ${driver.pilot.name} (P${driver.pos}) ${tireWarnLabel}. *Pit imminent probable.*`,
          ];
          events.push({ priority: 4, text: pick(stratMsgs) });
        }
      }

      // ── Radio "box box box" : message discret avant le pit ──
      // Déclenché la boucle AVANT que le pit soit effectif, donc perçu comme une alerte radio
      const { pit, reason: rawReason } = shouldPit(driver, lapsRemaining, gapAhead, totalLaps, scActive, lap);
      const blockUndercut = scActive || scCooldown > 0;
      const reason = (blockUndercut && rawReason === 'undercut') ? null : rawReason;
      const doPit  = pit && reason !== null;

      // ── 📻 Radio "box box" — discret, avant l'annonce officielle du pit ──
      if (doPit && driver.pos <= 12) {
        const radioKey = `${String(driver.pilot._id)}_${driver.pitStops}`;
        if (!radioFiredLaps.has(radioKey)) {
          radioFiredLaps.add(radioKey);
          const td = TIRE[driver.tireCompound];
          const compStr = td ? `${td.emoji} ${td.code}` : driver.tireCompound;
          // Radio urgence reparation : mentionne la piece specifique
          const repairPartLabel = driver.damagedPartLabel || (driver.pendingRepair === 'aileron' ? 'aileron avant' : 'suspension');
          const radioMsgs = driver.pendingRepair ? [
            `📻 *Ingénieur → **${driver.pilot.name}** : "Box, box, box — **${repairPartLabel}** touché, arrêt immédiat. Prépare-toi, on change tout."*`,
            `📻 *"**${driver.pilot.name}**, rentre maintenant — **${repairPartLabel}** endommagé, la voiture n'est plus sécuritaire. Box, box."*`,
            `🚨 *${driver.team.emoji} Alerte mécanique — **${repairPartLabel}** hors service sur la voiture de **${driver.pilot.name}** (P${driver.pos}). Arrêt en urgence.*`,
          ] : reason === 'undercut' ? [
            `📻 *Ingénieur → **${driver.pilot.name}** : "Box, box, box — undercut activé !"*`,
            `📻 *"${driver.pilot.name}, prépare-toi — on te rentre pour l'undercut. Box ce tour."*`,
            `📻 *${driver.team.emoji} Stratégie undercut confirmée pour **${driver.pilot.name}** (P${driver.pos}) — box immédiat.*`,
          ] : reason === 'sc_opportunity' ? [
            `📻 *Ingénieur → **${driver.pilot.name}** : "Safety Car dehors — box, box, box ! On prend les pneus maintenant."*`,
            `📻 *"SC en cours, **${driver.pilot.name}** — fenêtre parfaite. Rentre aux stands ce tour."*`,
            `📻 *${driver.team.emoji} Décision rapide : **${driver.pilot.name}** rentre sous SC — opportunité trop belle pour la rater.*`,
          ] : reason === 'tires_worn' ? [
            `📻 *Ingénieur → **${driver.pilot.name}** : "Box, box — les ${compStr} sont foutus. Rentre ce tour."*`,
            `📻 *"**${driver.pilot.name}**, les données disent arrêt maintenant. Box, box, box."*`,
            `📻 *${driver.team.emoji} ${driver.pilot.name} reçoit l'ordre de rentrer — les ${compStr} sont au bout du rouleau.*`,
            `📻 *"P${driver.pos}, rentre aux stands — les pneus n'en peuvent plus." **${driver.pilot.name}** acquiesce.*`,
          ] : reason === 'forced_compound' ? [
            `📻 *"**${driver.pilot.name}**, il faut impérativement s'arrêter — règlement oblige. Box ce tour."*`,
            `📻 *${driver.team.emoji} Dernier rappel au règlement : **${driver.pilot.name}** doit changer de compound. Box maintenant.*`,
          ] : [
            `📻 *Ingénieur → **${driver.pilot.name}** : "Box ce tour, tout est prêt pour toi."*`,
            `📻 *${driver.team.emoji} "**${driver.pilot.name}**, rentre aux stands — arrêt programmé, pneumatiques prêts."*`,
            `📻 *La fenêtre s'ouvre pour ${driver.team.emoji}**${driver.pilot.name}** (P${driver.pos}) — pit confirmé dans quelques secondes.*`,
          ];
          events.push({ priority: 3, text: pick(radioMsgs) });
        }
      }

      if (doPit && driver.pitStops < 3 && lapsRemaining > 8) {
        const posIn      = driver.pos;
        const oldTire    = driver.tireCompound;
        const newCompound = choosePitCompound(oldTire, lapsRemaining, driver.usedCompounds);

        // Pit de réparation : aileron = +12-20s, suspension = +8-14s
        let pitTime;
        let repairDesc = null;
        let repairPartFull = null; // piece nommee pour les flavors du pit
        if (driver.pendingRepair) {
          repairPartFull = driver.damagedPartLabel || (driver.pendingRepair === 'aileron' ? 'aileron avant' : 'suspension');
          if (driver.pendingRepair === 'aileron') {
            pitTime    = scActive ? randInt(30_000, 36_000) : randInt(32_000, 40_000);
            repairDesc = `⚙️ *Réparation **aileron avant** — arrêt de ${(pitTime/1000).toFixed(1)}s prévu. La pièce est réplacée sur la chaîne.*`;
          } else if (driver.pendingRepair === 'puncture_repair') {
            pitTime    = scActive ? randInt(21_000, 25_000) : randInt(22_000, 28_000);
            repairPartFull = 'pneu crevé';
            repairDesc = `🫧 *Remplacement **pneu crevé** — arrêt express ${(pitTime/1000).toFixed(1)}s. Pas de dégât structurel.*`;
          } else {
            pitTime    = scActive ? randInt(26_000, 32_000) : randInt(28_000, 36_000);
            repairDesc = `🔩 *Réparation **suspension** — ${(pitTime/1000).toFixed(1)}s nécessaires. Travail mécanique complet.*`;
          }
          delete driver.pendingRepair;
          delete driver.damagedPartLabel;
          delete driver.damagedCar; // la réparation remet la voiture en état
          // Traffic forcé : ressort en fond de peloton entouré de voitures
          driver.trafficLapsLeft = Math.max(driver.trafficLapsLeft || 0, 5);
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
        driver.lastPitLap     = lap;
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
              return leaderTime != null ? ` · ${fmtGap(driver.totalTime - leaderTime)} du leader` : '';
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

        const _ot = TIRE[oldTire];
        const _nt = TIRE[newCompound];
        const tireFrom = _ot ? `${_ot.emoji} ${_ot.code}` : '?';
        const tireTo   = _nt ? `${_nt.emoji} **${_nt.code} — ${_nt.label}**` : '?';

        const pitFlavors = repairDesc ? [
          `🔧 **T${lap} — PIT D'URGENCE !** ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) rentre réparer l'**${repairPartFull || 'pièce endommagée'}** depuis le contact. **${pitDur}s** d'arrêt (bien plus long qu'un pit classique) — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.
  ${repairDesc}`,
          `🚨 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) aux stands — réparation **${repairPartFull || 'pièce abimée'}** en urgence. **${pitDur}s** de travail mécanique (vs ~21s en pit normal) — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.
  ${repairDesc}`,
          `🔧 **T${lap}** — Arrêt forcé pour ${driver.team.emoji}**${driver.pilot.name}** (P${posIn}) : **${repairPartFull || 'pièce'}** hors service depuis l'accrochage. **${pitDur}s** nécessaires — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.
  ${repairDesc}`,
        ] : reason === 'undercut' ? [
          `🔧 **T${lap} — UNDERCUT !** ${driver.team.emoji}**${driver.pilot.name}** plonge aux stands depuis **P${posIn}** — ${tireFrom} → ${tireTo} — **${pitDur}s** — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}. La stratégie va-t-elle payer ?${warmupNote}`,
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** tente l'undercut depuis **P${posIn}** ! ${tireTo} en ${pitDur}s — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
        ] : [
          `🔧 **T${lap}** — ${driver.team.emoji}**${driver.pilot.name}** rentre aux stands depuis **P${posIn}**${scPitTag} — ${tireFrom} cramés. ${tireTo} en **${pitDur}s** — ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
          `🔧 **T${lap} — ARRÊT AUX STANDS** pour ${driver.team.emoji}**${driver.pilot.name}** (P${posIn})${scPitTag}. ${tireTo} en ${pitDur}s. Ressort ${posOutContext}${exitNeighborStr}${gapToLeader}.${warmupNote}`,
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
        if (rivalPitted && (d.tireWear || 0) < 28 && (d.tireAge || 0) > 4 && (d.pitStops || 0) < 2 && !d.overcutMode) {
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
        const gapStr    = fmtGap(postGapMs, { prefix: false });
        const gapLeader = driver.pos > 1 ? ` · ${fmtGap(driver.totalTime - ranked[0].totalTime)} du leader` : '';
        const drsTag    = gpStyle === 'rapide' && driver.team.drs > 82 ? ' 📡 *DRS*' : '';
        const areRivals = (
          (driver.pilot.rivalId && String(driver.pilot.rivalId) === String(passed.pilot._id)) ||
          (passed.pilot.rivalId && String(passed.pilot.rivalId) === String(driver.pilot._id))
        );
        const areTeammates = String(driver.pilot.teamId) === String(passed.pilot.teamId);

        let rivalTag = '';
        if (areRivals) {
          const riv = driver.pilot.rivalId ? driver.pilot : passed.pilot;
          const rivStyle = riv?.personality?.rivalryStyle || 'hot_blooded';
          const heat = riv.rivalHeat || 0;
          const hotTags = [
            `\n⚔️ *Le dépassement du rival — **${driver.pilot.name}** vient d'envoyer un message très clair.*`,
            `\n🔥 *Rivalité vive — **${driver.pilot.name}** passe son rival direct. Ce GP vient de changer de saveur.*`,
            `\n⚔️ *C'est exactement ce genre de duel qui construit les légendes. ${driver.pilot.name} devant son rival !*`,
          ];
          const coldTags = [
            `\n❄️ *Guerre froide sur la piste — **${driver.pilot.name}** prend l'avantage. Pas un geste, pas un regard.*`,
            `\n📊 *Le calcul a payé — **${driver.pilot.name}** devant son rival. Victoire tactique.*`,
          ];
          const warTags = heat >= 50 ? [
            `\n💥 ***RIVALITÉ AU ROUGE !*** **${driver.pilot.name}** passe **${passed.pilot.name}** — ${heat}+ de tension cette saison. Ce n'est pas fini.*`,
            `\n🚨 *La rivalité la plus chaude du paddock se joue LÀ. **${driver.pilot.name}** prend le dessus — **${passed.pilot.name}** va répondre.*`,
          ] : null;
          const pool = warTags || (rivStyle === 'cold_war' || rivStyle === 'indifference' ? coldTags : hotTags);
          rivalTag = pick(pool);
        }
        const teammateTag = areTeammates
          ? `\n👥 *${pick([
              `Duel interne — l'équipe regarde ça avec des sueurs froides.`,
              `Coéquipiers qui se battent sur la piste ! La direction d'équipe va avoir du travail.`,
              `Le duel interne est lancé — l'un des deux va devoir lever le pied... ou pas.`,
              `Entre coéquipiers, ces points valent double pour le classement interne.`,
            ])}*`
          : '';

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
            : areTeammates
              ? `👥 **T${lap} — DUEL INTERNE !**${drsTag}`
              : isCounterAttack
                ? `🔄 **T${lap} — CONTRE-ATTAQUE !**${drsTag}`
                : `⚔️ **T${lap} — DÉPASSEMENT !**${drsTag}`;

        const howDesc = isCounterAttack
          ? counterAttackDescription(driver, passed, gpStyle)
          : overtakeDescription(driver, passed, gpStyle);

        const posBlock = `⬆️ **${driver.pilot.name}** → P${ovNewPos}\n⬇️ **${passed.pilot.name}** → P${ovLostPos}`;
        const gifCat   = ovForLead ? 'overtake_lead' : ovIsTop3 ? 'overtake_podium' : 'overtake_normal';

        events.push({
          priority: ovForLead ? 9 : ovIsTop3 ? 8 : areTeammates ? 7 : isCounterAttack ? 7 : 6,
          text: `${ovHeader}\n${howDesc}\n${posBlock}\n*Écart : ${gapStr}${gapLeader}*${rivalTag}${teammateTag}`,
          gif: pickGif(gifCat),
        });
        // Radio quote dépasseur
        if (driver.pilot?.personality && Math.random() < 0.28) {
          const rq = getRadioQuote(driver.pilot, 'overtake_success');
          if (rq) events.push({ priority: 2, text: `📻 *Radio ${driver.pilot.name} :* *"${rq}"*` });
        }
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
            // Resist trafic : gain de 3+ places en 1 tour sans fresh tires = suspect
            // On narrativise max 2 et on ajoute contexte trafic si trop gros
            if (gained >= 3) {
              // Ajouter resistance trafic : ralentir ce pilote legerement les prochains tours
              if (!driver.trafficLapsLeft || driver.trafficLapsLeft === 0) {
                driver.trafficLapsLeft = 1;
              }
              events.push({ priority: 3, text: pick([
                `📈 **T${lap}** — ${n} progresse de P${driver.lastPos}→**P${driver.pos}** — belles séquences de dépassements mais le trafic se densifie devant.`,
                `📈 **T${lap}** — ${n} grapille du terrain (P${driver.lastPos}→**P${driver.pos}**) — plusieurs voitures dans le DRS, il va falloir passer une � une.`,
              ]) });
            } else {
              events.push({ priority: 3, text: pick([
                `📈 **T${lap}** — ${n} avance **P${driver.lastPos}→P${driver.pos}** — belle régularité.`,
                `📈 **T${lap}** — ${n} grappille **${gained} place${gained>1?'s':''}** (P${driver.lastPos}→P${driver.pos}) — timing parfait.`,
              ]) });
            }
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
      const gapStr = fmtGap(gap, { prefix: false });
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
      const gapStr = fmtGap(gap, { prefix: false });
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
          // Détecter si les deux sont rivaux
          const lightAreRivals = (
            (attacker.pilot.rivalId && String(attacker.pilot.rivalId) === String(victim.pilot._id)) ||
            (victim.pilot.rivalId && String(victim.pilot.rivalId) === String(attacker.pilot._id))
          );
          const lightRivalHeat = lightAreRivals
            ? Math.max(attacker.pilot.rivalHeat || 0, victim.pilot.rivalHeat || 0) : 0;

          const roll = Math.random();
          if (roll < 0.5) {
            raceCollisions.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id), type: 'light' });
            pendingInvestigations.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id), lap });
            const lightContactText = lightAreRivals ? pick([
              `⚔️ **T${lap} — CONTACT ENTRE RIVAUX !** ${attacker.team.emoji}**${attacker.pilot.name}** frôle ${victim.team.emoji}**${victim.pilot.name}** — *encore eux.* Sous investigation FIA.${lightRivalHeat >= 40 ? ` Le paddock commence à s'inquiéter.` : ''}`,
              `⚠️ **T${lap}** — ${attacker.team.emoji}**${attacker.pilot.name}** touche ${victim.team.emoji}**${victim.pilot.name}** — les deux rivaux encore en contact. *La FIA surveille.*`,
            ]) : pick([
              `⚠️ **T${lap} — CONTACT !** ${attacker.team.emoji}**${attacker.pilot.name}** frôle ${victim.team.emoji}**${victim.pilot.name}** — *sous investigation FIA, décision post-course.*`,
              `⚠️ **T${lap}** — Contact ${attacker.team.emoji}**${attacker.pilot.name}** / ${victim.team.emoji}**${victim.pilot.name}**. *Les commissaires vont étudier les images.*`,
            ]);
            events.push({ priority: lightAreRivals ? 7 : 5, text: lightContactText });
          } else {
            raceCollisions.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id), type: 'light' });
            pendingInvestigations.push({ attackerId: String(attacker.pilot._id), victimId: String(victim.pilot._id), lap });
            const lightContact2Text = lightAreRivals ? pick([
              `⚔️ **T${lap}** — Contact discutable entre les rivaux ${attacker.team.emoji}**${attacker.pilot.name}** et ${victim.team.emoji}**${victim.pilot.name}**. *Enquête FIA — mais la rivalité, elle, ne s'arrête pas là.*`,
            ]) : pick([
              `🔍 **T${lap}** — Contact discutable ${attacker.team.emoji}**${attacker.pilot.name}** / ${victim.team.emoji}**${victim.pilot.name}**. *Sous investigation — décision post-course.*`,
              `🔍 **T${lap}** — ${attacker.team.emoji}**${attacker.pilot.name}** frôle ${victim.team.emoji}**${victim.pilot.name}**. *La FIA regarde les images — sentence possible après le GP.*`,
            ]);
            events.push({ priority: lightAreRivals ? 6 : 3, text: lightContact2Text });
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
        // ── Détection de la rivalité dans cette bataille ──
        const battleAreRivals = (
          (ahead.pilot.rivalId && String(ahead.pilot.rivalId) === String(behind.pilot._id)) ||
          (behind.pilot.rivalId && String(behind.pilot.rivalId) === String(ahead.pilot._id))
        );
        const battleRivalHeat = battleAreRivals
          ? Math.max(ahead.pilot.rivalHeat || 0, behind.pilot.rivalHeat || 0) : 0;

        if (battle && battle.lapsClose >= 3 && gap < 1.2) {
          // ── Probabilité d'incident — boostée si les deux sont rivaux ──
          // Normal : 3T ~4%, 5T ~8%, 8T ~14%, 12T ~22%, 15T+ ~28%
          // Rivaux  : +5% flat + bonus heat (jusqu'à +10% si heat >= 60)
          const baseChance = Math.min(0.30, 0.01 * battle.lapsClose + 0.01);
          const rivalBonus = battleAreRivals
            ? 0.05 + (battleRivalHeat >= 60 ? 0.10 : battleRivalHeat >= 30 ? 0.05 : 0.02)
            : 0;
          const incidentChance = Math.min(0.48, baseChance + rivalBonus);
          if (!scActive && Math.random() < incidentChance) {
            const aggr = behind;
            const isTeamBattle = String(ahead.pilot.teamId) === String(behind.pilot.teamId);

            // Contact (70%) → enquête post-course | Incident mécanique/crevaison (30%)
            const incidentRoll = Math.random();

            if (incidentRoll < 0.70) {
              // Contact → investigation post-course
              raceCollisions.push({ attackerId: String(aggr.pilot._id), victimId: String(ahead.pilot._id), type: 'light' });
              pendingInvestigations.push({ attackerId: String(aggr.pilot._id), victimId: String(ahead.pilot._id), lap });
              battleMap.delete(bkey);
              const contactFlavors = isTeamBattle ? [
                `💢 **T${lap} — CONTACT INTERNE !** Après ${battle.lapsClose} tours de duel, ${aggr.team.emoji}**${aggr.pilot.name}** touche son coéquipier **${ahead.pilot.name}**. *Sous investigation FIA — décision post-course.*`,
                `🚨 **T${lap}** — La tension interne explose ! ${aggr.team.emoji}**${aggr.pilot.name}** accroche **${ahead.pilot.name}** (T${battle.lapsClose} de bataille). *Les commissaires vont trancher.*`,
              ] : battleAreRivals ? [
                `⚔️ **T${lap} — CONTACT ENTRE RIVAUX !** ${battle.lapsClose} tours de duel, et ça finit par toucher. ${aggr.team.emoji}**${aggr.pilot.name}** sur ${ahead.team.emoji}**${ahead.pilot.name}** — *la rivalité s'exprime sur la piste.*${battleRivalHeat >= 40 ? ` Encore eux. Encore ça.` : ''}`,
                `💥 **T${lap}** — ${battle.lapsClose} tours que les rivaux se battent, et voilà le résultat : contact ${aggr.team.emoji}**${aggr.pilot.name}** / ${ahead.team.emoji}**${ahead.pilot.name}**. *La FIA va trancher — mais la rivalité, elle, ne s'arrêtera pas là.*`,
                `🚨 **T${lap}** — Inévitable. Après ${battle.lapsClose} tours au contact, ${aggr.team.emoji}**${aggr.pilot.name}** et ${ahead.team.emoji}**${ahead.pilot.name}** se touchent. *${battleRivalHeat >= 50 ? 'Rivalité qui dépasse les limites du sport.' : 'Tension de rivaux — les commissaires examinent.'}*`,
              ] : [
                `💥 **T${lap} — CONTACT APRÈS ${battle.lapsClose} TOURS !** ${aggr.team.emoji}**${aggr.pilot.name}** percute ${ahead.team.emoji}**${ahead.pilot.name}**. *Sous investigation — sentence possible après la course.*`,
                `🔍 **T${lap}** — ${battle.lapsClose} tours de bataille et ça finit par un contact ! ${aggr.team.emoji}**${aggr.pilot.name}** / ${ahead.team.emoji}**${ahead.pilot.name}**. *La FIA va trancher après l'arrivée.*`,
              ];
              events.push({ priority: battleAreRivals ? 9 : (isTeamBattle ? 8 : 7), text: pick(contactFlavors) });
            } else {
              // Incident physique lié au combat : crash, dégâts carrosserie, crevaison
              const victim  = Math.random() < 0.6 ? aggr : ahead;
              const other   = victim === aggr ? ahead : aggr;
              const rollInc = Math.random();

              if (rollInc < 0.35) {
                // Crash de l'un des deux → DNF
                if (!victim.dnf) {
                  victim.dnf = true; victim.dnfLap = lap; victim.dnfReason = 'CRASH';
                  lapDnfs.push({ driver: victim, type: 'CRASH' });
                  lapIncidents.push({ type: 'CRASH', onTrack: true });
                  battleMap.delete(bkey);
                  const crashTexts = battleAreRivals ? [
                    `💥 **T${lap} — CRASH !** La bataille entre rivaux tourne au drame : ${victim.team.emoji}**${victim.pilot.name}** sort de la piste après un contact avec ${other.team.emoji}**${other.pilot.name}**. **ABANDON.** *La rivalité vient de coûter une course entière.*`,
                    `🔴 **T${lap} — RIVAL HORS COURSE !** ${victim.team.emoji}**${victim.pilot.name}** abandonne suite au contact avec ${other.team.emoji}**${other.pilot.name}**. ${battleRivalHeat >= 50 ? `*Cette rivalité ne connaît plus de limite.*` : `*Le duel tourne à la catastrophe.*`}`,
                  ] : [
                    `💥 **T${lap} — CRASH !** ${victim.team.emoji}**${victim.pilot.name}** sort de la piste lors de la bataille avec ${other.team.emoji}**${other.pilot.name}**. **ABANDON.**`,
                    `🚨 **T${lap}** — Duel fatal ! ${victim.team.emoji}**${victim.pilot.name}** perd le contrôle en défendant face à ${other.team.emoji}**${other.pilot.name}**. **DNF.**`,
                  ];
                  events.push({ priority: battleAreRivals ? 10 : 9, text: pick(crashTexts) });
                }
              } else if (rollInc < 0.55) {
                // Crash des deux
                [victim, other].forEach(d => {
                  if (!d.dnf) { d.dnf = true; d.dnfLap = lap; d.dnfReason = 'CRASH'; lapDnfs.push({ driver: d, type: 'CRASH' }); }
                });
                lapIncidents.push({ type: 'CRASH', onTrack: true });
                battleMap.delete(bkey);
                const doubleCrashTexts = battleAreRivals ? [
                  `💥 **T${lap} — DOUBLE CRASH DE RIVAUX !** ${victim.team.emoji}**${victim.pilot.name}** et ${other.team.emoji}**${other.pilot.name}** se percutent après ${battle.lapsClose} tours de duel ! **Deux abandons.** *La rivalité s'est terminée dans les graviers.*`,
                  `🔴 **T${lap} — ILS SE SONT DÉTRUITS L'UN L'AUTRE !** ${victim.team.emoji}**${victim.pilot.name}** et ${other.team.emoji}**${other.pilot.name}** hors course. *La rivalité la plus explosive du paddock vient de s'enflammer.*`,
                ] : [
                  `💥 **T${lap} — DOUBLE CRASH !** ${victim.team.emoji}**${victim.pilot.name}** et ${other.team.emoji}**${other.pilot.name}** se percutent ! **Deux abandons.** La bataille tourne au cauchemar.`,
                  `🚨 **T${lap}** — Contact violent entre ${victim.team.emoji}**${victim.pilot.name}** et ${other.team.emoji}**${other.pilot.name}** — les deux voitures dans le bac à graviers. **DNF.**`,
                ];
                events.push({ priority: battleAreRivals ? 11 : 10, text: pick(doubleCrashTexts) });
              } else if (rollInc < 0.75) {
                // Crevaison suite au contact
                if (!victim.dnf) {
                  victim.dnf = true; victim.dnfLap = lap; victim.dnfReason = 'PUNCTURE';
                  lapDnfs.push({ driver: victim, type: 'PUNCTURE' });
                  lapIncidents.push({ type: 'PUNCTURE', onTrack: true });
                  battleMap.delete(bkey);
                  const punctureTexts = battleAreRivals ? [
                    `🫧 **T${lap} — CREVAISON DANS LE DUEL DE RIVAUX !** ${victim.team.emoji}**${victim.pilot.name}** prend un accroc lors du combat avec ${other.team.emoji}**${other.pilot.name}** — pneu à plat. **Abandon.** *${battleRivalHeat >= 40 ? 'La rivalité a encore frappé.' : 'La bataille se termine de la pire façon.'}*`,
                  ] : [
                    `🫧 **T${lap} — CREVAISON !** ${victim.team.emoji}**${victim.pilot.name}** prend un accroc lors du duel avec ${other.team.emoji}**${other.pilot.name}** — pneu crevé, abandon immédiat.`,
                    `🫧 **T${lap}** — Contact roue-à-roue fatal ! ${victim.team.emoji}**${victim.pilot.name}** rentre aux stands avec un pneu à plat. **Fin de course.**`,
                  ];
                  events.push({ priority: battleAreRivals ? 9 : 8, text: pick(punctureTexts) });
                }
              } else {
                // Dégâts carrosserie → pit forcé + pénalité de rythme
                const battleDmgType  = Math.random() < 0.55 ? 'aileron' : 'suspension';
                const battleDmgLabel = battleDmgType === 'aileron' ? 'aileron avant' : 'suspension';
                const battleLapPenalty = randInt(1400, 2800); // pénalité PAR TOUR (ms) jusqu'au pit
                victim.damagedCar = { lapPenalty: battleLapPenalty };
                victim.pendingRepair    = battleDmgType;
                victim.damagedPartLabel = battleDmgLabel;
                victim.tireWear = Math.max(victim.tireWear || 0, 50);
                victim.tireAge  = 99;
                battleMap.delete(bkey);
                // attacker = other (l'initiateur du contact) ; victim = le pilote qui subit
                const dmgAttacker = other; // other = celui qui n'est PAS victim
                const dmgVictim   = victim;
                raceCollisions.push({ attackerId: String(dmgAttacker.pilot._id), victimId: String(dmgVictim.pilot._id), type: 'damage' });
                events.push({ priority: 7, text: pick([
                  `⚙️ **T${lap} — DÉGÂTS !** Contact entre ${dmgAttacker.team.emoji}**${dmgAttacker.pilot.name}** et ${dmgVictim.team.emoji}**${dmgVictim.pilot.name}** — **${battleDmgLabel}** endommagé${battleDmgType === 'aileron' ? '' : 'e'} ! Pit d'urgence nécessaire.`,
                  `🔧 **T${lap}** — Accrochage dans la bataille ! ${dmgVictim.team.emoji}**${dmgVictim.pilot.name}** a l'**${battleDmgLabel}** abimé${battleDmgType === 'aileron' ? '' : 'e'} après le contact avec ${dmgAttacker.team.emoji}**${dmgAttacker.pilot.name}** — rentre aux stands en urgence.`,
                  `🚨 **T${lap}** — ${dmgVictim.team.emoji}**${dmgVictim.pilot.name}** sort perdant du duel avec ${dmgAttacker.team.emoji}**${dmgAttacker.pilot.name}** : **${battleDmgLabel} endommagé${battleDmgType === 'aileron' ? '' : 'e'}.** *L'arrêt aux stands est inévitable.*`,
                ]) });
              }
            }
            break;
          }

          const isTeamBattle = String(ahead.pilot.teamId) === String(behind.pilot.teamId);
          let defText = defenseDescription(ahead, behind, gpStyle);

          // ── 📻 Radio de bataille : tension croissante par paliers ──
          // Rivaux : messages plus chargés + tour 3 si heat >= 40
          const battleRadioKey3 = `${bkey}_radio3`;
          const battleRadioKey5 = `${bkey}_radio5`;
          const battleRadioKey7 = `${bkey}_radio7`;

          // Radio précoce uniquement si rivaux chauds
          if (battleAreRivals && battleRivalHeat >= 40 && battle.lapsClose === 3 && !radioFiredLaps.has(battleRadioKey3)) {
            radioFiredLaps.add(battleRadioKey3);
            events.push({ priority: 4, text: pick([
              `📻 *Ingénieur → **${ahead.pilot.name}** : "Attention — c'est **${behind.pilot.name}** derrière. Reste propre, mais ne lui laisse rien."*`,
              `📻 *${ahead.team.emoji} Wall : "**${ahead.pilot.name}** — tu sais qui c'est derrière. Focus. Rien de stupide."*`,
              `📻 *"**${behind.pilot.name}** dans ton DRS. C'est ton rival. Gère ça intelligemment."*`,
            ]) });
          }

          if (battle.lapsClose === 5 && !radioFiredLaps.has(battleRadioKey5)) {
            radioFiredLaps.add(battleRadioKey5);
            const radio5 = battleAreRivals ? pick([
              `📻 *Ingénieur → **${ahead.pilot.name}** : "**${behind.pilot.name}** est là depuis 5 tours. Tu sais ce qu'il veut. Reste devant."*`,
              `📻 *${behind.team.emoji} Wall → **${behind.pilot.name}** : "5 tours au contact. Continue — il commence à faire des erreurs."*`,
              `📻 *"**${ahead.pilot.name}** — il ne lâchera pas. C'est ta rivalité. Gagne-la."*`,
            ]) : pick([
              `📻 *Ingénieur → **${ahead.pilot.name}** : "P${ahead.pos}, **${behind.pilot.name}** est dans ton DRS depuis 5 tours. Reste propre."*`,
              `📻 *"**${ahead.pilot.name}**, garde la tête froide — **${behind.pilot.name}** est juste derrière depuis ${battle.lapsClose} tours."*`,
              `📻 *${ahead.team.emoji} Wall → cockpit : "Push, push — **${behind.pilot.name}** essaie de te faire une erreur. Reste concentré."*`,
            ]);
            events.push({ priority: battleAreRivals ? 5 : 3, text: radio5 });
          } else if (battle.lapsClose === 7 && !radioFiredLaps.has(battleRadioKey7)) {
            radioFiredLaps.add(battleRadioKey7);
            const radio7 = battleAreRivals ? pick([
              `📻 *"**${ahead.pilot.name}** — ÇA FAIT 7 TOURS. AVEC TON RIVAL. Donne-lui une réponse définitive."*`,
              `📻 *${behind.team.emoji} Wall → **${behind.pilot.name}** : "7 tours. Il résiste encore. Mais ses pneus ne résisteront pas indéfiniment."*`,
              `📻 *"**${behind.pilot.name}**, reste calme. Il craque. Tu le sens. Continue à pousser."* ${battleRivalHeat >= 50 ? `\n› *La tension entre les deux rivaux est palpable sur les ondes radio.*` : ''}`,
            ]) : pick([
              `📻 *"**${ahead.pilot.name}** — ÇA FAIT 7 TOURS. **${behind.pilot.name}** est toujours là. Donne tout !"*`,
              `📻 *${behind.team.emoji} Wall → **${behind.pilot.name}** : "Il commence à craquer. Continue à pousser, la position est à toi."*`,
              `📻 *"**${behind.pilot.name}**, reste patient — ses pneus vont lâcher avant les tiens. Continue."*`,
            ]);
            events.push({ priority: battleAreRivals ? 5 : 3, text: radio7 });
          }

          // Flaveur rival sur les défenses — priorité sur le tag coéquipier
          if (battleAreRivals && battle.lapsClose >= 2) {
            const heatTag = battleRivalHeat >= 60
              ? pick([
                  `\n› *🔥 Rivaux depuis le début de saison — chaque centimètre de piste est un enjeu personnel.*`,
                  `\n› *🔥 Ce duel a une histoire. Et ${behind.pilot.name} n'oublie rien.*`,
                  `\n› *🔥 La rivalité brûle — ${battle.lapsClose} tours que ça dure, et aucun des deux ne veut lâcher.*`,
                ])
              : battleRivalHeat >= 30
                ? pick([
                    `\n› *⚔️ Rivaux sur la piste — chaque position prise est une victoire au-delà des points.*`,
                    `\n› *⚔️ ${behind.pilot.name} veut cette place, et pas seulement pour le classement.*`,
                  ])
                : `\n› *⚔️ Rivalité déclarée — ce duel compte double pour les deux pilotes.*`;
            defText += heatTag;
          } else if (isTeamBattle && battle.lapsClose >= 3) {
            defText += pick([
              `\n› *Duel interne — les deux roulent pour la même équipe mais aucun n'a l'intention de céder.*`,
              `\n› *Coéquipiers en guerre sur la piste — le mur des stands observe en silence.*`,
              `\n› *L'équipe n'intervient pas encore. Mais si ça dure, ils devront choisir leurs priorités.*`,
            ]);
          }
          // Mentionner l'usure pneus si défense longue
          if (battle.lapsClose >= 5 && (ahead.defendExtraWear || 0) > 1.5) {
            const wornNote = (ahead.defendExtraWear || 0) > 3
              ? `\n› *Les pneus de **${ahead.pilot.name}** paient le prix — ils s'effondreront bientôt.*`
              : `\n› *La défense coûte des pneus à **${ahead.pilot.name}** — fenêtre stratégique qui se resserre.*`;
            defText += wornNote;
          }
          events.push({ priority: 4, text: defText });
          break;
        }
      }
    }

    // ── Cap dépassements : max 3 narrations de dépassement par tour ──
    // (déjà géré via overtakeMentioned, mais on ajoute un compteur pour limiter les events overtake)
    const overtakeEvents = events.filter(e => e.text && (e.text.includes('DÉPASSEMENT') || e.text.includes('CONTRE-ATTAQUE') || e.text.includes('CHANGEMENT EN TÊTE')));
    if (overtakeEvents.length > 3) {
      // Garder seulement les 3 de plus haute priorité
      const sorted = [...events].sort((a,b) => b.priority - a.priority);
      const ovToRemove = overtakeEvents.slice(3);
      for (const ev of ovToRemove) {
        const idx = events.indexOf(ev);
        if (idx >= 0) events.splice(idx, 1);
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

    // ── Indicateur pneu : compound + barre d'usure 5 blocs ───
    // Format :  🔴 S ▰▰▰▱▱  (Soft, 60% usé)
    //           🟡 M ▰▱▱▱▱  (Medium, frais)
    //           ⚪ H ▰▰▰▰▰⚠️ (Hard, dans le rouge)
    //           🌡️ = pneus en chauffe (warmup)
    const tireWearLabel = (d) => {
      const td = TIRE[d.tireCompound];
      if (!td) return '❓';
      const worn   = d.tireWear || 0;
      const deg    = td.deg || 0.0016;
      const cliff  = deg > 0 ? Math.round(0.06 / deg) : 38; // tours avant cliff
      const wup    = (d.warmupLapsLeft || 0) > 0;
      const pct    = Math.min(1, worn / cliff);
      const filled = Math.round(pct * 5);
      const bar    = '▰'.repeat(filled) + '▱'.repeat(5 - filled);
      const warn   = pct >= 1.0 ? '⚠️' : '';
      const warmup = wup ? '🌡️' : '';
      return `${td.emoji} ${warmup || td.code} \`${bar}\`${warn}`;
    };

    let standingsText = '';
    if (showFullStandings) {
      const dnfLines = drivers.filter(d => d.dnf);
      standingsText = '\n\n📋 **CLASSEMENT COMPLET — Tour ' + lap + '/' + totalLaps + '**\n' +
        ranked.map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? '⏱ **LEADER**' : `${fmtGap(gapMs)} / leader`;
          return `\`P${String(i+1).padStart(2,' ')}\` ${d.team.emoji} **${d.pilot.name}** — ${gapStr} ${tireWearLabel(d)} (${d.pitStops} arr.)`;
        }).join('\n') +
        (dnfLines.length ? '\n' + dnfLines.map(d => `~~${d.team.emoji}${d.pilot.name}~~ ❌ T${d.dnfLap}`).join(' · ') : '');
    } else if (showTop5) {
      standingsText = '\n\n🏎️ **Top ' + Math.min(5, ranked.length) + ' — T' + lap + '/' + totalLaps + '**\n' +
        ranked.slice(0, 5).map((d, i) => {
          const gapMs  = i === 0 ? null : d.totalTime - ranked[0].totalTime;
          const gapStr = i === 0 ? 'LEADER' : `${fmtGap(gapMs)} / leader`;
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

  // ── Résolution des investigations post-course ─────────────
  // Pour chaque contact "sous investigation", décider maintenant si pénalité
  const postRacePenaltyMsgs = [];
  // Snapshot des positions AVANT pénalités pour détecter les changements
  const posBefore = new Map(drivers.filter(d => !d.dnf).map(d => [String(d.pilot._id), d.pos]));

  // Dédupliquer : max 1 investigation jugée par attaquant (la plus grave = dernier contact)
  const dedupInvestigations = [];
  const seenAttackers = new Set();
  for (const inv of [...pendingInvestigations].reverse()) {
    if (!seenAttackers.has(inv.attackerId)) {
      dedupInvestigations.push(inv);
      seenAttackers.add(inv.attackerId);
    }
  }

  for (const inv of dedupInvestigations) {
    if (Math.random() < 0.55) { // 55% de chance de pénalité post-course
      const penSec = pick([5, 5, 10]);  // max 10s par incident, plus de 20s
      const penMs  = penSec * 1000;
      const atk = drivers.find(d => String(d.pilot._id) === inv.attackerId);
      const vic = drivers.find(d => String(d.pilot._id) === inv.victimId);
      if (atk && !atk.dnf) {
        // Cap total pénalités à 10s par pilote sur toute la course
        const alreadyPenalised = atk.totalPenalties || 0;
        if (alreadyPenalised >= 10) {
          if (vic) postRacePenaltyMsgs.push(
            `✅ *Aucune sanction supplémentaire* — ${atk.team.emoji}**${atk.pilot.name}** déjà pénalisé ce GP.`
          );
          continue;
        }
        const effectivePen = Math.min(penSec, 10 - alreadyPenalised);
        atk.totalTime += effectivePen * 1000;
        atk.totalPenalties = alreadyPenalised + effectivePen;
        racePenalties.push({ pilotId: inv.attackerId, seconds: effectivePen, reason: 'investigation_post', lap: inv.lap });
        if (vic) postRacePenaltyMsgs.push(
          `⚖️ **+${effectivePen}s** → ${atk.team.emoji}**${atk.pilot.name}** | Contact T${inv.lap} avec ${vic.team.emoji}**${vic.pilot.name}**`
        );
      }
    } else {
      const atk = drivers.find(d => String(d.pilot._id) === inv.attackerId);
      const vic = drivers.find(d => String(d.pilot._id) === inv.victimId);
      if (atk && vic) postRacePenaltyMsgs.push(
        `✅ *Aucune sanction* — Contact T${inv.lap} ${atk.team.emoji}**${atk.pilot.name}** / ${vic.team.emoji}**${vic.pilot.name}** → *Incident de course*`
      );
    }
  }

  // Recalcul positions après pénalités post-course
  if (pendingInvestigations.length > 0) {
    drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime).forEach((d,i) => d.pos = i+1);
  }

  // Annoncer les décisions FIA + changements de classement
  if (postRacePenaltyMsgs.length && channel) {
    await sleep(3000);

    // Détecter les pilotes dont la position a changé
    const posChanges = [];
    for (const d of drivers.filter(dr => !dr.dnf)) {
      const before = posBefore.get(String(d.pilot._id));
      const after  = d.pos;
      if (before !== undefined && before !== after) {
        posChanges.push({ pilot: d.pilot, team: d.team, before, after });
      }
    }
    posChanges.sort((a, b) => a.after - b.after);

    const fiaEmbed = new EmbedBuilder()
      .setTitle('📋 DÉCISIONS FIA — Classement post-course')
      .setColor('#003580')
      .setDescription(postRacePenaltyMsgs.join('\n'));

    if (posChanges.length > 0) {
      const changeLines = posChanges.map(c => {
        const arrow = c.after < c.before ? `P${c.before} → **P${c.after}** ⬆️` : `P${c.before} → **P${c.after}** ⬇️`;
        return `${c.team.emoji} **${c.pilot.name}** — ${arrow}`;
      }).join('\n');
      fiaEmbed.addFields({ name: '🔄 Classement modifié', value: changeLines });
    }

    // ── Réactions auto des pilotes pénalisés selon fiaCriticism ──────────────
    const fiaAutoReactions = [];
    for (const inv of dedupInvestigations) {
      const hasPenalty = postRacePenaltyMsgs.some(m => m.startsWith('⚖️') && m.includes(inv.attackerId));
      const atk = drivers.find(d => String(d.pilot._id) === inv.attackerId);
      if (!atk || atk.dnf) continue;
      const pilotFull = await Pilot.findById(atk.pilot._id).select('personality name').lean();
      const crit = pilotFull?.personality?.fiaCriticism || 0;
      const pArch = pilotFull?.personality?.archetype || 'guerrier';
      if (crit < 30) continue;
      const isBad = ['bad_boy', 'guerrier'].includes(pArch);
      const n = atk.pilot.name;
      let reaction;
      if (crit >= 70) {
        reaction = pick([
          '🎙 *Radio ' + n + ' :* *"Encore. Toujours les mêmes. J\'ai rien à ajouter."*',
          '🎙 *Radio ' + n + ' :* *"La FIA peut prendre leurs secondes. Ma façon de piloter, non."*',
          '🎙 *Radio ' + n + ' :* *"On en reparle. En conférence. Devant tout le monde."*',
        ]);
      } else if (crit >= 45) {
        reaction = pick([
          '🎙 *Radio ' + n + ' :* *"J\'attends toujours une explication cohérente."*',
          '🎙 *Radio ' + n + ' :* *"' + (isBad ? 'Sérieusement ?' : 'Je ne comprends pas cette décision.') + '"*',
          '🎙 *Radio ' + n + ' :* *"On va regarder les images ensemble. Tranquillement."*',
        ]);
      } else {
        reaction = pick([
          '🎙 *Radio ' + n + ' :* *"' + (isBad ? 'La décision me choque.' : 'Je suis déçu de cette sentence.') + '"*',
          '🎙 *Radio ' + n + ' :* *"Je m\'y attendais — ça ne veut pas dire que j\'y adhère."*',
        ]);
      }
      fiaAutoReactions.push(reaction);
    }
    if (fiaAutoReactions.length > 0) {
      fiaEmbed.addFields({ name: '🎙 Réactions paddock', value: fiaAutoReactions.join('\n') });
    }

    fiaEmbed.setFooter({ text: 'Décision officielle des commissaires de course — sans appel' });
    if (channel) try { await channel.send({ embeds: [fiaEmbed] }); await sleep(9000); } catch(e) {}
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
    // ⚡ Fastest lap : +1 point bonus si dans le top 10 et pas DNF (règle F1 réelle)
    const flPts    = fl && !driver.dnf && driver.pos <= 10 ? 1 : 0;

    // Bonus de participation : tout le monde gagne quelque chose même sans point
    // P1-P10 = 0 bonus (pts F1 suffisent), P11+ = 20
    // ⚠️ pts * 22 → P10 (1pt) = 22 > participBonus 20 — P10 gagne toujours plus que P11
    const participBonus = driver.dnf ? 0 : (driver.pos > 10 ? 20 : 0);

    const coins = Math.round(
      (pts * 22 + (driver.dnf ? 0 : 40) + participBonus) * multi
      + salary + primeV + primeP + (fl ? 30 : 0)
    );

    results.push({
      pilotId   : driver.pilot._id,
      teamId    : driver.team._id,
      pos       : driver.pos,
      dnf       : driver.dnf,
      dnfReason : driver.dnfReason,
      coins, fastestLap: fl,
      flPts,          // bonus fastest lap (0 ou 1)
      penaltySec: driver.totalPenalties || 0,
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
    `***🏁🏁🏁 DRAPEAU À DAMIER !!! ${race.emoji} ${race.circuit}***\n***🏆 ${winner.team.emoji}${winner.pilot.name} GAGNE !!! À ${fmtGapSec(gapWin, {prefix:false})} !!! QUELLE COURSE INCROYABLE !!!***`,
    `***🏁 C'EST FINI !!! VICTOIRE DE ${winner.team.emoji}${winner.pilot.name.toUpperCase()} !!! +${fmtGapSec(gapWin, {prefix:false})} — ON A TOUT VU !!!***`,
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
        const gapStr = i === 0 ? '' : ` (${fmtGap(gapMs)})`;
        return `${['🥇','🥈','🥉'][i]} **${d.team.emoji} ${d.pilot.name}** — ${d.team.name}${gapStr}`;
      }).join('\n') +
      '\n\u200B\n**Abandons :**\n' + dnfStr +
      (fastestLapHolder ? `\n\u200B\n⚡ **Meilleur tour :** ${fastestLapHolder.team.emoji} **${fastestLapHolder.pilot.name}** — ${msToLapStr(fastestLapMs)}${fastestLapHolder.pos <= 10 && !fastestLapHolder.dnf ? ' *(+1 pt)*' : ''}` : '')
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
    try {
      const seasonForOff = await getActiveSeason();
      if (seasonForOff) await generateOffTrackIncidents(race, results, seasonForOff, channel);
    } catch(e) { console.error('Off-track incidents erreur:', e); }
    try {
      await generateDriverOfTheDay(race, results, drivers, channel);
    } catch(e) { console.error('Driver of the day erreur:', e); }
  }, 150_000 + Math.random() * 30_000); // 2min30 à 3min après la fin

  // ── Personality hooks post-course
  setImmediate(async () => {
    try {
      const allPilotsSnap = await Pilot.find();
      const allTeamsSnap  = await Team.find();
      const allConstrS    = await ConstructorStanding.find({ seasonId: season._id });
      await postRacePersonalityHooks(race, results, raceCollisions, allPilotsSnap, allTeamsSnap, allConstrS, season, channel);
    } catch(e){ console.error('[personality hooks]', e.message); }
  });

  return { results, collisions: raceCollisions, penalties: racePenalties };
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
    // ── Coût salarial des pilotes ─────────────────────────────
    // Les gros salaires réduisent les ressources de développement voiture.
    // Logique : chaque PLcoin de salaire/course = moins d'argent pour l'usine.
    // Impact calibré pour rester subtil : 1 pilote à 300 sal ≈ -3 devPts/course
    // = 1 upgrade de moins toutes les ~13 courses. Un trade-off perceptible sur la saison.
    const teamContracts = await Contract.find({ teamId: team._id, active: true }).lean();
    const totalSalaire  = teamContracts.reduce((sum, c) => sum + (c.salaireBase || 0), 0);
    // Pénalité : chaque 100 PLcoins de masse salariale = -1 devPt (cap à -8 pour éviter l'écrasement)
    const salaryPenalty = Math.min(8, Math.floor(totalSalaire / 100));

    // Bonus voiture si l'équipe a misé sur une voiture plutôt que des pilotes :
    // Masse salariale très basse (< 150 total) → bonus de développement +3
    const lowWageBonusDev = totalSalaire < 150 ? 3 : 0;

    const devGained = Math.round(pts * 1.5 + (team.budget / 100) * 3 + 3 - salaryPenalty + lowWageBonusDev);

    // ── Bonus de développement — bonne chimie d'écurie ───────
    // Si les deux coéquipiers s'entendent bien (affinité ≥ 40), les mécaniciens
    // travaillent mieux ensemble → bonus de +3 devPts/course.
    // Si l'affinité est très haute (≥ 70) → +5 devPts.
    let chemDevBonus = 0;
    try {
      const teamPilotsForDev = await Pilot.find({ teamId: team._id }).lean();
      if (teamPilotsForDev.length >= 2) {
        const [sdA, sdB] = [String(teamPilotsForDev[0]._id), String(teamPilotsForDev[1]._id)].sort();
        const devRel = await PilotRelation.findOne({ pilotA: sdA, pilotB: sdB }).lean();
        if (devRel) {
          if (devRel.affinity >= 70) chemDevBonus = 5;
          else if (devRel.affinity >= 40) chemDevBonus = 3;
        }
      }
    } catch(e) { /* silencieux */ }

    const newDevPts = team.devPoints + Math.max(1, devGained + chemDevBonus);

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

async function applyRaceResults(raceResults, raceId, season, collisions = [], channel = null) {
  const teams = await Team.find();
  console.log(`[applyRaceResults] Début — ${raceResults.length} résultats, seasonId=${season._id}, raceId=${raceId}`);

  // Récupérer les infos de la course pour les GPRecords
  const raceDoc = await Race.findById(raceId);

  // Récupérer la grille de départ pour les positions de départ
  const qualiGrid = raceDoc?.qualiGrid || [];
  const startPosMap = new Map(qualiGrid.map((g, i) => [String(g.pilotId), i + 1]));

  for (const r of raceResults) {
    await Pilot.findByIdAndUpdate(r.pilotId, { $inc: { plcoins: r.coins, totalEarned: r.coins } });
    const pts    = F1_POINTS[r.pos - 1] || 0;
    const flPts  = r.flPts || 0; // +1 si fastest lap + top 10
    const standingResult = await Standing.findOneAndUpdate(
      { seasonId: season._id, pilotId: r.pilotId },
      { $inc: { points: pts + flPts, wins: r.pos===1&&!r.dnf?1:0, podiums: r.pos<=3&&!r.dnf?1:0, dnfs: r.dnf?1:0 } },
      { upsert: true, new: true }
    );
    console.log(`[applyRaceResults] P${r.pos} pilotId=${r.pilotId} pts+${pts}${flPts?'+1FL':''}=${pts+flPts} dnf=${r.dnf} → standing total=${standingResult?.points}`);
    const constrResult = await ConstructorStanding.findOneAndUpdate(
      { seasonId: season._id, teamId: r.teamId },
      { $inc: { points: pts + flPts } },
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

  // ── Mise à jour de la forme récente de chaque pilote ──────
  // Basée sur les 3 derniers GPRecords : victoire=+1, podium=+0.5, points=+0.2,
  // P11-15=-0.1, P16+=-0.2, DNF=-0.7. Moyenne pondérée → score -1.0…+1.0.
  for (const r of raceResults) {
    try {
      const last3 = await PilotGPRecord.find({ pilotId: r.pilotId })
        .sort({ raceDate: -1 }).limit(3).lean();
      if (!last3.length) continue;
      const scores = last3.map(rec => {
        if (rec.dnf)             return -0.7;
        if (rec.finishPos === 1) return  1.0;
        if (rec.finishPos <= 3)  return  0.5;
        if (rec.finishPos <= 10) return  0.2;
        if (rec.finishPos <= 15) return -0.1;
        return -0.2;
      });
      // Pondération : race la plus récente compte double
      const weights = [2, 1, 1].slice(0, scores.length);
      const totalW  = weights.reduce((a, b) => a + b, 0);
      const rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0) / totalW;
      const formScore = Math.max(-1.0, Math.min(1.0, rawScore));
      await Pilot.findByIdAndUpdate(r.pilotId, { recentFormScore: formScore });
    } catch (_) {}
  }

  // ── Rivalités : traiter les collisions de la course ──────
  // On consolide les contacts par paire (A-B = B-A), avec le type le plus grave
  const contactMap = new Map(); // key: "idA_idB" (sorted) → { count, hasCrash, hasDamage }
  for (const { attackerId, victimId, type } of collisions) {
    const key = [attackerId, victimId].sort().join('_');
    const cur = contactMap.get(key) || { count: 0, hasCrash: false, hasDamage: false };
    contactMap.set(key, {
      count    : cur.count + 1,
      hasCrash : cur.hasCrash  || type === 'crash',
      hasDamage: cur.hasDamage || type === 'damage',
    });
  }
  const rivalCollisionThisRace = new Set(); // paires qui ont eu un contact rival → forcer un article
  for (const [key, { count, hasCrash, hasDamage }] of contactMap) {
    const [idA, idB] = key.split('_');
    const raceDoc2 = await Race.findById(raceId).select('index').lean();
    const gpIndex  = raceDoc2?.index ?? 0;
    // Heat gagné : crash = +20, dégâts = +12, contact simple = +6 (par contact)
    const heatGained = count * (hasCrash ? 20 : hasDamage ? 12 : 6);
    for (const [myId, theirId] of [[idA, idB], [idB, idA]]) {
      const me = await Pilot.findById(myId);
      if (!me) continue;
      const currentRival = me.rivalId ? String(me.rivalId) : null;
      if (currentRival === theirId) {
        // Rivalité existante — incrémenter contacts ET heat
        const newHeat = Math.min(100, (me.rivalHeat || 0) + heatGained);
        await Pilot.findByIdAndUpdate(myId, {
          $inc: { rivalContacts: count },
          $set: { rivalHeat: newHeat },
        });
        rivalCollisionThisRace.add(key);

        // Tentative surnom lors d'un contact rival intense (crash ou multi-contacts)
        if ((hasCrash || count >= 2) && newHeat >= 40) {
          const them = await Pilot.findById(theirId);
          if (them && !them.nickname) {
            await tryAssignNickname(me, them, 'race_duel', 0.10);
          }
        }
      } else if (!currentRival) {
        // Pas encore de rival — si 2+ contacts cette course, déclarer la rivalité
        const newTotal = (me.rivalContacts || 0) + count;
        if (count >= 2 || newTotal >= 2) {
          const initialHeat = Math.min(40, heatGained); // démarre entre 12 et 40 selon gravité
          await Pilot.findByIdAndUpdate(myId, {
            rivalId         : theirId,
            rivalContacts   : count,
            rivalHeat       : initialHeat,
            rivalDeclaredAt : gpIndex,
          });
          rivalCollisionThisRace.add(key);
        }
      }
      // Si rivalité différente déjà active, on ne change pas (on garde la plus vieille)
    }
  }

  // ── Forcer un article rivalité si les rivaux se sont touchés ce GP ──
  // (indépendamment de la chance normale de publication)
  if (rivalCollisionThisRace.size > 0 && channel) {
    for (const key of rivalCollisionThisRace) {
      const [idA, idB] = key.split('_');
      const pA = await Pilot.findById(idA).lean();
      const pB = await Pilot.findById(idB).lean();
      if (!pA || !pB || !pA.rivalId) continue;
      const tA = teams.find(t => String(t._id) === String(pA.teamId));
      const tB = teams.find(t => String(t._id) === String(pB.teamId));
      if (!tA || !tB) continue;
      const article = genRivalryArticle(pA, pB, tA, tB, pA.rivalContacts, raceResults[0]?.circuit || '', season?.year || new Date().getFullYear(), pA.rivalHeat || 0);
      await NewsArticle.create({ ...article, raceId, pilotIds: [pA._id, pB._id], teamIds: [tA._id, tB._id] });
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

  // ── Sauvegarde stats inter-saisons AVANT reset ───────────────────────────
  if (lastSeason) {
    const lastStandings = await Standing.find({ seasonId: lastSeason._id });
    const sortedLast    = [...lastStandings].sort((a,b) => b.points - a.points);
    for (let idx = 0; idx < sortedLast.length; idx++) {
      const st = sortedLast[idx];
      const rankLast = idx + 1;
      await Pilot.findByIdAndUpdate(st.pilotId, {
        $set: {
          lastSeasonRank : rankLast,
          lastSeasonPts  : st.points,
          lastSeasonWins : st.wins,
        },
        $max: { careerBestRank: rankLast === 1 ? 1 : undefined }, // sera géré manuellement
      });
      // careerBestRank : mettre à jour si meilleur rang
      const p = await Pilot.findById(st.pilotId).select('careerBestRank');
      if (p && (p.careerBestRank === null || rankLast < p.careerBestRank)) {
        await Pilot.findByIdAndUpdate(st.pilotId, { careerBestRank: rankLast });
      }
      // Cumuler wins/podiums/dnfs/races en carrière
      // BUG FIX : careerRaces était calculé comme (wins + podiums + 1) — formule sans sens.
      // Correction : comptage réel des PilotGPRecord pour cette saison.
      const realRaceCount = await PilotGPRecord.countDocuments({ pilotId: st.pilotId, seasonId: lastSeason._id });
      await Pilot.findByIdAndUpdate(st.pilotId, {
        $inc: {
          careerWins    : st.wins    || 0,
          careerPodiums : st.podiums || 0,
          careerDnfs    : st.dnfs    || 0,
          careerRaces   : realRaceCount,
        },
      });
    }
  }

  // Réinitialiser rivalités et streak upgrade en début de saison
  await Pilot.updateMany({}, { $set: { rivalId: null, rivalContacts: 0, rivalHeat: 0, rivalDeclaredAt: null, upgradeStreak: 0, lastUpgradeStat: null } });

  // BUG FIX : CommandCooldown n'était jamais purgé → croissance infinie de la collection MongoDB.
  // Correction : suppression des entrées de plus de 30 jours à chaque nouvelle saison.
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await CommandCooldown.deleteMany({ usedAt: { $lt: cutoff } });
    console.log(`[createNewSeason] CommandCooldown purgé : ${deleted.deletedCount} entrée(s) supprimée(s).`);
  } catch(e) { console.error('[createNewSeason] Erreur purge CommandCooldown :', e.message); }

  // ── Décroissance mémorielle des affinités inter-saisons ────
  // Les affinités NE SONT PAS effacées : un ennemi reste un ennemi.
  // Mais la mémoire s'atténue légèrement — le temps passe, les équipes changent.
  // Logique : l'affinité se rapproche de 0 de ~25%, avec un plancher/plafond mémoriel.
  //   - Affinités très négatives (< -60) : bougent peu (-8 max) → la rancœur dure longtemps
  //   - Affinités légèrement négatives (-60 à -20) : remontent vers -20 → froid résiduel
  //   - Affinités positives (> 20) : descendent vers +15 → la cordialité s'entretient
  try {
    const allRels = await PilotRelation.find();
    for (const rel of allRels) {
      const a = rel.affinity;
      let newAffinity = a;
      if (a < -60) {
        // Haine profonde : légère atténuation (max -8 points récupérés)
        newAffinity = a + Math.min(8, Math.floor(Math.abs(a) * 0.08));
      } else if (a < -20) {
        // Tension : se rapproche de -20 (plancher "froid résiduel")
        newAffinity = Math.max(-20, a + Math.floor(Math.abs(a + 20) * 0.25));
      } else if (a > 60) {
        // Amitié forte : légère atténuation (max -5 points perdus)
        newAffinity = a - Math.min(5, Math.floor(a * 0.06));
      } else if (a > 20) {
        // Respect : se rapproche de +15 (plancher "cordialité")
        newAffinity = Math.max(15, a - Math.floor((a - 15) * 0.25));
      }
      if (newAffinity !== a) {
        rel.affinity = newAffinity;
        rel.type = newAffinity >= 60 ? 'amis'
                 : newAffinity >= 20 ? 'respect'
                 : newAffinity > -20 ? 'neutre'
                 : newAffinity > -60 ? 'tension'
                 : 'ennemis';
        rel.history.push({ event: 'nouvelle_saison_decay', delta: newAffinity - a, date: new Date() });
        if (rel.history.length > 30) rel.history = rel.history.slice(-30);
        await rel.save();
      }
    }
    console.log('[Affinités] Décroissance mémorielle inter-saisons appliquée sur ' + allRels.length + ' relations.');
  } catch(e) { console.error('[Affinités] Erreur décroissance saison :', e.message); }

  // ── Legacy inter-saisons : articles cohabitation forcée ───
  // Déclenché après le draft/transfert, une fois la grille connue.
  // On le schedule en différé pour laisser le temps aux pilotes d'être assignés.
  setTimeout(async () => {
    try {
      const ch = RACE_CHANNEL ? await client.channels.fetch(RACE_CHANNEL).catch(() => null) : null;
      if (ch) await generateLegacyCohabitationNews(season, ch);
    } catch(e) { console.error('[legacy preseason]', e.message); }
  }, 30 * 1000); // 30 secondes après la création de saison

  return season;
}

// Prétextes réalistes de nouvelles réglementations F1 (tournant par index)
const REGULATION_PRETEXTS = [
  {
    title : '🔧 Nouveau règlement aérodynamique',
    body  : 'La FIA PL impose de nouvelles restrictions sur les planchers et les déflecteurs latéraux. ' +
            'Les équipes doivent refaire leurs simulations CFD de zéro. Les rapports de force sont redistribués.',
    // Impacte surtout vitesseMax et dirtyAir
    focus : { vitesseMax: 1.5, dirtyAir: 1.5, drs: 1.2, refroidissement: 0.8, conservationPneus: 0.8, vitesseMoyenne: 1.0 },
  },
  {
    title : '⛽ Régulation des carburants et de la gestion thermique',
    body  : 'Nouvelle réglementation sur la composition des carburants et les limites thermiques moteur. ' +
            'Certaines écuries habituées à exploiter la chaleur moteur à leur avantage perdent un avantage clé.',
    focus : { refroidissement: 1.8, vitesseMax: 1.2, drs: 0.9, dirtyAir: 0.9, conservationPneus: 1.0, vitesseMoyenne: 1.0 },
  },
  {
    title : '🛞 Changement de fournisseur de pneus & composés 2025',
    body  : "Nouveaux composés pneumatiques pour toute la saison. Les voitures très efficaces sur les anciens pneus " +
            "pourraient souffrir, tandis que d'autres trouveront une fenêtre de fonctionnement plus large.",
    focus : { conservationPneus: 1.8, gestionPneus: 1.0, vitesseMoyenne: 1.2, refroidissement: 1.0, vitesseMax: 0.8, drs: 0.8, dirtyAir: 1.0 },
  },
  {
    title : '🏎️ Révolution châssis — Voitures à effet de sol renforcé',
    body  : "Retour aux tunnels Venturi complets. Les équipes qui maîtrisaient l'aéro traditionnelle repartent presque " +
            "de zéro, tandis que certains outsiders pourraient surprendre dès les premiers tests.",
    focus : { vitesseMoyenne: 1.8, dirtyAir: 1.5, vitesseMax: 1.0, drs: 0.7, refroidissement: 1.0, conservationPneus: 1.2 },
  },
  {
    title : '📡 Restrictions DRS & systèmes de recharge',
    body  : "La FIA PL réduit la durée d'activation du DRS et impose de nouveaux plafonds sur les systèmes ERS. " +
            "Les circuits rapides vont changer de visage. Les spécialistes de la gestion thermique sont avantagés.",
    focus : { drs: 1.8, vitesseMax: 1.5, refroidissement: 1.3, dirtyAir: 0.9, conservationPneus: 1.0, vitesseMoyenne: 0.8 },
  },
];

async function applyRegulationChange(season) {
  const teams    = await Team.find();
  const statKeys = ['vitesseMax','drs','refroidissement','dirtyAir','conservationPneus','vitesseMoyenne'];

  // Choisir le prétexte selon le numéro de regulationSet (cyclique)
  const pretext = REGULATION_PRETEXTS[(season.regulationSet - 2) % REGULATION_PRETEXTS.length];

  for (const team of teams) {
    const updates = {};
    for (const key of statKeys) {
      // Amplitude de base ±10, modulée par le focus du règlement
      const focusMultiplier = pretext.focus[key] || 1.0;
      const rawDelta = randInt(-10, 10) * focusMultiplier;
      updates[key] = clamp(Math.round(team[key] + rawDelta), 40, 99);
    }
    // Réinitialiser les devPoints pour repartir à égalité de développement
    updates.devPoints = 0;
    await Team.findByIdAndUpdate(team._id, updates);
  }

  // Annoncer le changement dans le channel si possible
  try {
    const ch = RACE_CHANNEL ? await client.channels.fetch(RACE_CHANNEL).catch(() => null) : null;
    if (ch) {
      const reg = new EmbedBuilder()
        .setTitle(`📋 NOUVELLE RÉGLEMENTATION — Saison ${season.year}`)
        .setColor('#FF6600')
        .setDescription(
          `**${pretext.title}**

${pretext.body}

` +
          `> *Les performances des écuries ont été recalibrées. La hiérarchie peut changer.*
` +
          `> *Rendez-vous aux premiers essais libres pour voir qui a su s'adapter.*`
        )
        .setFooter({ text: `Règlement ${season.regulationSet} — FIA PL officiel` });
      await ch.send({ embeds: [reg] });
    }
  } catch(e) { /* pas de channel = silencieux */ }

  console.log(`🔄 Réglementation "${pretext.title}" appliquée (saison ${season.year})`);
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

// ============================================================
//  📰  ANNONCES MERCATO — Rumeurs signature (vrai + faux mélangés)
// ============================================================

// Délai aléatoire entre 10min et 3h avant de publier la "rumeur"
// pour simuler le temps que les infos fuient dans le paddock
// ============================================================
//  📰 RÉACTION PILOTE AU REFUS D'OFFRE
// ============================================================
async function publishRefusalReaction(pilot, offer) {
  // Seulement 40% de chance d'article — pas systématique
  if (Math.random() > 0.40) return;
  const season = await getActiveSeason();
  if (!season) return;
  const team = await Team.findById(offer.teamId);
  if (!team) return;

  const ch = RACE_CHANNEL ? await client.channels.fetch(RACE_CHANNEL).catch(() => null) : null;
  if (!ch) return;

  const ov   = overallRating(pilot);
  const arch = pilot.archetype || 'calculateur';

  // Ton de la réaction selon l'archétype du pilote
  const reactions = {
    guerrier: [
      `❌ **Rumeur Paddock** — **${pilot.name}** aurait décliné l'approche de **${team.emoji} ${team.name}**. Son entourage parle d'un "désaccord sur l'ambition sportive". Il vise plus haut.`,
      `📡 **Pitlane Insider** — **${pilot.name}** et **${team.name}** : les négociations ont capoté. Le pilote n'aurait pas apprécié les conditions proposées. La chasse est encore ouverte.`,
    ],
    icone: [
      `🗞️ **PL Racing News** — **${pilot.name}** reste libre. L'écurie **${team.emoji} ${team.name}** aurait fait une approche, sans suite. Son management reste "serein" sur la situation.`,
      `📡 **Pitlane Insider** — Pas d'accord entre **${pilot.name}** et **${team.name}**. Les deux camps restent discrets. On parle de divergences sur le projet à long terme.`,
    ],
    rookie_ambitieux: [
      `🔄 **Paddock Whispers** — **${pilot.name}** aurait repoussé une offre de **${team.emoji} ${team.name}**. Surprenant pour un pilote en quête d'un baquet. Il parie sur mieux ?`,
      `📡 **Pitlane Insider** — **${pilot.name}** n'a pas donné suite à **${team.name}**. Son agent indique qu'il "attend la bonne opportunité". Audacieux, ou imprudent ?`,
    ],
    calculateur: [
      `🗞️ **PL Racing News** — Les discussions entre **${pilot.name}** et **${team.emoji} ${team.name}** n'ont pas abouti. Aucun commentaire des deux côtés. Dossier fermé, pour l'instant.`,
      `📡 L'approche de **${team.name}** vers **${pilot.name}** n'a pas convaincu. Son entourage évoque un "calcul stratégique". Il attend d'autres options.`,
    ],
    bad_boy: [
      `💥 **Paddock Whispers** — **${pilot.name}** a envoyé balader **${team.emoji} ${team.name}** ? En tout cas, les discussions sont terminées. Son agent reste muet, ce qui dit tout.`,
      `🔄 **Rumeur** — **${pilot.name}** et **${team.name}**, c'est non. Selon nos sources, le courant ne passait pas. Le mercato réserve encore des surprises.`,
    ],
    vieux_sage: [
      `🗞️ **PL Racing News** — **${pilot.name}** ne rejoindra pas **${team.emoji} ${team.name}**. "Ce n'était pas le bon projet", aurait-il confié à son entourage. Sage, ou exigeant ?`,
      `📡 **Pitlane Insider** — Pas de suite pour **${pilot.name}** chez **${team.name}**. Le vétéran sait ce qu'il veut. La question est : le marché lui donnera-t-il raison ?`,
    ],
  };

  const pool = reactions[arch] || reactions.calculateur;
  const msg  = pool[Math.floor(Math.random() * pool.length)];

  // Délai aléatoire 30min–6h pour paraître organique
  const delay = Math.floor(Math.random() * (6 * 60 - 30) + 30) * 60 * 1000;
  setTimeout(async () => {
    try { await ch.send(msg); } catch(e) { /* silencieux */ }
  }, delay);
}

// ============================================================
//  📊 BILAN MERCATO OFFICIEL (posté après /reveal_grille)
// ============================================================
async function generateMercatoBilan(season, channel) {
  const allTeams  = await Team.find();
  const allPilots = await Pilot.find();

  const moves = [];
  for (const pilot of allPilots) {
    const accepted = await TransferOffer.findOne({ pilotId: pilot._id, status: 'accepted' }).lean();
    if (accepted) {
      const toTeam = await Team.findById(accepted.teamId);
      moves.push({ pilot, team: toTeam, offer: accepted });
    }
  }

  const free   = allPilots.filter(p => !p.teamId);
  const stayed = allPilots.filter(p => p.teamId && !moves.find(m => String(m.pilot._id) === String(p._id)));

  const parts = [];

  if (moves.length) {
    const moveLines = ['**🔄 Transferts actés :**'];
    for (const { pilot, team } of moves) {
      const ov   = overallRating(pilot);
      const tier = ratingTier(ov);
      moveLines.push(tier.badge + ' **' + pilot.name + '** → ' + team.emoji + ' **' + team.name + '**');
    }
    parts.push(moveLines.join('\n'));
  }

  if (stayed.length) {
    const stayLines = ['**🔒 Prolongations / Continuité :**'];
    const sample = stayed.slice(0, 6);
    for (const p of sample) {
      const team = allTeams.find(t => String(t._id) === String(p.teamId));
      if (team) stayLines.push('↩️ **' + p.name + '** reste chez ' + team.emoji + ' **' + team.name + '**');
    }
    if (stayed.length > 6) stayLines.push('_...et ' + (stayed.length - 6) + ' autres_');
    parts.push(stayLines.join('\n'));
  }

  if (free.length) {
    parts.push('⚠️ **Sans écurie (' + free.length + ') :** ' + free.map(p => p.name).join(', '));
  }

  const narratives = [
    'Un mercato agité qui redistribue les cartes. Les surprises sont au rendez-vous.',
    'Le paddock a vécu une intersaison sous tension. Certains moves vont faire parler.',
    'Peu de transferts finalement — la stabilité prime. La hiérarchie devrait se confirmer.',
    'Un marché actif mais sélectif. Les grandes écuries ont joué la carte de la fidélité.',
    'Intersaison mouvementée. Les ambitions sont là — reste à les concrétiser sur la piste.',
  ];
  parts.push('_' + narratives[Math.floor(Math.random() * narratives.length)] + '_');

  const embed = new EmbedBuilder()
    .setTitle('📋 BILAN MERCATO — Intersaison ' + season.year)
    .setColor('#2F4F4F')
    .setDescription(parts.join('\n\n').slice(0, 4000))
    .setFooter({ text: 'Que le meilleur gagne. Bonne saison à tous 🏎️' });

  await channel.send({ embeds: [embed] });
}
// ============================================================
//  🎙️ CONFÉRENCE DE PRESSE PRÉ-SAISON (auto au 1er GP)
// ============================================================
async function generatePreseasonPressConf(season, channel) {
  const allTeams  = await Team.find();
  const allPilots = await Pilot.find({ teamId: { $ne: null } });

  const byTeam = new Map();
  for (const t of allTeams) byTeam.set(String(t._id), { team: t, pilots: [] });
  for (const p of allPilots) {
    const entry = byTeam.get(String(p.teamId));
    if (entry) entry.pilots.push(p);
  }

  const teamBlocks = [];
  for (const { team, pilots } of byTeam.values()) {
    if (!pilots.length) continue;
    const isTop = team.budget >= 120;
    const isMid = team.budget >= 80 && team.budget < 120;
    const pilotNames = pilots.map(p => '**' + p.name + '**').join(' & ');

    let tone;
    if (isTop) {
      const topTones = [
        `L'equipe arrive confiante. Nous avons le materiel pour le titre, declare la direction.`,
        `Cette saison est la notre. Les ingenieurs avancent des chiffres impressionnants.`,
        `Pas de langue de bois chez ${team.name} : ils visent le titre constructeurs.`,
      ];
      tone = topTones[Math.floor(Math.random() * topTones.length)];
    } else if (isMid) {
      const midTones = [
        `Nous voulons bousculer les grands. Ambitions affichees, moyens mesures.`,
        `L'equipe parle de progression et de points reguliers. Prudence calculee.`,
        `On a bosse dur cet hiver. La voiture a evolue dans le bon sens.`,
      ];
      tone = midTones[Math.floor(Math.random() * midTones.length)];
    } else {
      const smallTones = [
        `On est la pour apprendre et marquer des points quand l'occasion se presente.`,
        `Humilite dans les mots, mais determination dans les yeux. ${team.name} veut surprendre.`,
        `Cette saison, on veut montrer qu'on a notre place en PL. Objectif : top 8 regulier.`,
      ];
      tone = smallTones[Math.floor(Math.random() * smallTones.length)];
    }

    teamBlocks.push(team.emoji + ' **' + team.name + '** — ' + pilotNames + '\n> ' + tone);
  }

  const embed = new EmbedBuilder()
    .setTitle('🎙️ CONFÉRENCE DE PRESSE PRÉ-SAISON ' + season.year)
    .setColor('#1a1a2e')
    .setDescription(
      "*Les équipes présentent leurs pilotes et leurs ambitions avant le coup d'envoi de la saison.*\n\n" +
      teamBlocks.join('\n\n').slice(0, 3800)
    )
    .setFooter({ text: 'Saison ' + season.year + ' — PL Racing • Que le spectacle commence 🏁' });

  await channel.send({ embeds: [embed] });
}

async function publishSigningRumors(realPilot, realTeam, offer) {
  const season = await getActiveSeason();
  if (!season) return;
  const allPilots = await Pilot.find();
  const allTeams  = await Team.find();

  const roll = Math.random();
  const delay = Math.floor(Math.random() * (3 * 60 - 10) + 10) * 60 * 1000;

  if (roll < 0.50) {
    // Impact immédiat sur les affinités (ex-coéquipiers, nouveaux coéquipiers)
    const oldPilotData = await Pilot.findById(realPilot._id);
    const oldTeamId    = oldPilotData?.teamId || null;
    const newsCh       = RACE_CHANNEL ? await client.channels.fetch(RACE_CHANNEL).catch(() => null) : null;
    applyTransferAffinityImpact(realPilot, realTeam, oldTeamId, newsCh, season?.year || null).catch(console.error);

    // Vraie signature publiée après délai
    setTimeout(async () => {
      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);
        if (!ch) return;
        const ov   = overallRating(realPilot);
        const tier = ratingTier(ov);
        const source = Math.random() < 0.5 ? '🗞️ **PL Racing News**' : '📡 **Pitlane Insider**';
        const msgs = [
          `${source} — **OFFICIEL : ${realPilot.name} signe chez ${realTeam.emoji} ${realTeam.name} !**\n${tier.badge} Le transfert est confirmé. Contrat de **${offer.seasons}** saison(s).`,
          `${source} — C'est officiel. **${realPilot.name}** rejoint **${realTeam.emoji} ${realTeam.name}** pour la prochaine saison.\n${tier.badge} *(${ov} overall)*`,
          `🖊️ **Signature confirmée** — ${realTeam.emoji} **${realTeam.name}** annonce l'arrivée de **${realPilot.name}**. Durée : ${offer.seasons} saison(s).`,
        ];
        await ch.send(msgs[Math.floor(Math.random() * msgs.length)]);
      } catch(e) { console.error('Signing announce error:', e.message); }
    }, delay);

  } else if (roll < 0.80) {
    // Fausse rumeur pure — mauvaise équipe, pas de rectification
    const fakeTeam = allTeams.filter(t => String(t._id) !== String(realTeam._id))[Math.floor(Math.random() * (allTeams.length - 1))];
    setTimeout(async () => {
      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);
        if (!ch) return;
        const ft = fakeTeam?.emoji || '🏎️';
        const fn = fakeTeam?.name  || 'une écurie surprise';
        const msgs = [
          `🔄 **Rumeur — Paddock Whispers** : Des sources proches du dossier indiquent que **${realPilot.name}** serait très proche d'un accord avec **${ft} ${fn}**. Rien de signé encore.`,
          `📡 **Pitlane Insider** — **${realPilot.name}** et **${ft} ${fn}** : les discussions seraient avancées. Son entourage reste silencieux.`,
          `🗞️ Exclusif — **${realPilot.name}** aurait été aperçu en réunion avec des dirigeants de **${ft} ${fn}**. Aucun commentaire des deux côtés.`,
          `📡 Un agent bien informé confirme à **Pitlane Insider** : **${realPilot.name}** et **${fn}** seraient en négociations finales. Signature imminente ?`,
        ];
        await ch.send(msgs[Math.floor(Math.random() * msgs.length)]);
      } catch(e) { console.error('Signing fake rumor error:', e.message); }
    }, delay);

  } else {
    // Fausse rumeur — mauvais pilote cité, vérité jamais corrigée
    const fakePilot = allPilots.filter(p => String(p._id) !== String(realPilot._id) && !p.teamId)[0]
      || allPilots.filter(p => String(p._id) !== String(realPilot._id))[Math.floor(Math.random() * (allPilots.length - 1))];
    if (!fakePilot) return;
    setTimeout(async () => {
      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);
        if (!ch) return;
        const msgs = [
          `🔄 **Rumeur — Paddock Whispers** : **${fakePilot.name}** serait sur le point de rejoindre **${realTeam.emoji} ${realTeam.name}**. Nos sources sont formelles.`,
          `📡 **Pitlane Insider** — C'est **${fakePilot.name}** qui serait la priorité de **${realTeam.emoji} ${realTeam.name}** pour la prochaine saison. Dossier en cours.`,
          `🗞️ Selon plusieurs sources concordantes, **${realTeam.emoji} ${realTeam.name}** aurait jeté son dévolu sur **${fakePilot.name}**. L'officialisation se ferait dans les prochains jours.`,
        ];
        await ch.send(msgs[Math.floor(Math.random() * msgs.length)]);
      } catch(e) { console.error('Signing distraction rumor error:', e.message); }
    }, delay);
  }
}

// ============================================================
//  🏁  RÉVÉLATION DE LA GRILLE COMPLÈTE
// ============================================================
async function revealFinalGrid(season, channel) {
  const allPilots = await Pilot.find({ teamId: { $ne: null } });
  const allTeams  = await Team.find();
  const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));

  const byTeam = new Map();
  for (const pilot of allPilots) {
    const tid = String(pilot.teamId);
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid).push(pilot);
  }

  let gridDesc = '';
  for (const [tid, pilots] of byTeam) {
    const team = teamMap.get(tid);
    if (!team) continue;
    const pilotStr = pilots.map(p => {
      const ov   = overallRating(p);
      const tier = ratingTier(ov);
      return `${tier.badge} **${p.name}** *(${ov})*`;
    }).join(' · ');
    gridDesc += `${team.emoji} **${team.name}** — ${pilotStr}
`;
  }

  const freePilots = await Pilot.find({ teamId: null });
  if (freePilots.length) {
    gridDesc += `
⚠️ *Pilote(s) sans écurie : ${freePilots.map(p => p.name).join(', ')}*`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏁 GRILLE OFFICIELLE — Saison ${season.year + 1}`)
    .setColor('#FFD700')
    .setDescription(
      `La grille est complète. Voici le line-up officiel pour la prochaine saison !

` + gridDesc
    )
    .setFooter({ text: 'Bonne chance à tous les pilotes. Que le meilleur gagne. 🏆' });

  await channel.send({ embeds: [embed] });

  // Bilan mercato juste après la révélation de grille
  await generateMercatoBilan(season, channel).catch(e => console.error('MercatoBilan error:', e.message));
}


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
    // ── Renouvellements : proposition avant de chercher des libres ─────────
    // Si l'écurie a des pilotes dont le contrat expire (seasonsRemaining = 0 avant update)
    // elle peut leur proposer un renouvellement basé sur leurs perfs
    try {
      const teamPilots = await Pilot.find({ teamId: team._id });
      for (const tp of teamPilots) {
        const expContract = await Contract.findOne({ pilotId: tp._id, teamId: team._id, active: true, seasonsRemaining: { $lte: 1 } });
        if (!expContract) continue;
        const tpStanding    = allStandings.find(s => String(s.pilotId) === String(tp._id));
        const teamRankLocal = teamRankMap.get(String(team._id)) || Math.ceil(totalTeams / 2);
        const lastTeamRank  = tp.lastSeasonRank ? Math.round(tp.lastSeasonRank * totalTeams / 20) : null;
        const perf = evalPilotPerf(tp, team, tpStanding, teamRankLocal, totalTeams, lastTeamRank);
        const baseRenewChance = perf.isChamp
          ? (perf.isTopTeam ? 0.97 : 0.90)
          : perf.isOverperf ? (perf.isTopTeam ? 0.82 : 0.88)
          : perf.isSolid    ? (perf.isTopTeam ? 0.45 : perf.isSmall ? 0.72 : 0.58)
          : /* flop */        (perf.isTopTeam ? 0.10 : perf.isSmall ? 0.30 : 0.18);
        const ovrBonus     = perf.tpOvr >= 82 ? 0.12 : perf.tpOvr >= 72 ? 0.06 : 0;
        const teamCtxMalus = perf.progressingTeam && !perf.isChamp && !perf.isOverperf ? -0.12 : 0;
        const renewChance  = Math.max(0.05, Math.min(0.98, baseRenewChance + ovrBonus + teamCtxMalus));
        if (Math.random() > renewChance) continue;
        const existOffer = await TransferOffer.findOne({ pilotId: tp._id, teamId: team._id, status: 'pending' });
        if (existOffer) continue;
        const perfMultiplier = perf.isChamp ? 1.30 : perf.isOverperf ? 1.15 : perf.isSolid ? 1.00 : 0.82;
        const baseSalaire    = Math.round((expContract.salaireParCourse || 10) * perfMultiplier);
        const salaireRenew   = Math.max(5, Math.min(team.budget * 0.40, baseSalaire));
        const dureeRenew     = perf.isChamp ? 3 : perf.isOverperf ? 2 : 1;
        // BUG FIX : utilisait 'salaire', 'duree', 'statut', 'isRenewal' qui n'existent pas dans
        // TransferOfferSchema → champs ignorés par Mongoose, offre créée avec valeurs par défaut
        // (salaireBase:100, seasons:1). Correction : vrais noms du schema.
        await TransferOffer.create({
          teamId       : team._id,
          pilotId      : tp._id,
          status       : 'pending',
          salaireBase  : salaireRenew,
          seasons      : dureeRenew,
          driverStatus : expContract.driverStatus || null,
          expiresAt    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
    } catch(e) { console.error('[renouvellement IA]', e.message); }

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
      // Le poids de la saison est relatif à l'ambition de l'équipe :
      // Une grande écurie valorise les victoires >> les points ; une petite équipe valorise la régularité
      const standing = allStandings.find(s => String(s.pilotId) === String(pilot._id));
      let seasonScore = 0;
      if (standing) {
        const wins    = standing.wins    || 0;
        const podiums = standing.podiums || 0;
        const dnfs    = standing.dnfs    || 0;
        const pts     = standing.points  || 0;
        if (prefersPeakPerformers) {
          // Grande écurie : valorise très fort les victoires, pénalise les DNF
          seasonScore = wins * 15 + podiums * 4 + pts * 0.3 - dnfs * 5;
        } else if (prefersYoungTalent) {
          // Petite écurie : valorise la régularité et le potentiel de progression
          seasonScore = pts * 0.8 + podiums * 2 + wins * 6 - dnfs * 2;
        } else {
          // Milieu de grille : équilibre — 1 victoire + 2 podiums reste moyen
          seasonScore = pts * 0.5 + wins * 10 + podiums * 3 - dnfs * 3;
        }
      }

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

      // ── Calibration du contrat selon budget réel de l'écurie ──────────
      // Budget 100 (base) → masse salariale totale tolérable ~300 PLcoins/course (2 pilotes)
      // Budget 60 (pauvre) → max ~150 PLcoins totaux → offres très basses
      // Budget 180 (riche) → peut se permettre ~600+ PLcoins totaux
      // Le salaire d'un pilote est borné par : budget_equipe × coeff_ov
      // Un pilote ov=90 dans une équipe budget=60 recevra quand même peu — l'équipe n'a pas les moyens
      // Un pilote ov=55 dans une équipe budget=180 recevra peu aussi — peu de valeur perçue

      // Base : ce que l'équipe peut se permettre × attractivité du pilote (ov normalisé vs 75 baseline)
      // Plafond doux : une petite équipe (budget 60) propose max ~120 PLcoins/course à un top pilote
      const budgetCapPerPilot   = (team.budget / 100) * 150; // budget → cap PLcoins/course/pilote
      const ovAttractiveness    = Math.pow(ov / 75, 1.5);    // exponentiel : ov 90 vaut 1.8×, ov 60 = 0.6×
      const salaireBase = Math.round(
        clamp(budgetCapPerPilot * ovAttractiveness * rand(0.85, 1.15), 40, 450)
      );

      // Multiplicateur : les riches peuvent offrir plus de coins par course en %
      // Cap à 2.2× pour ne pas dérégler les PLcoins
      const coinMultiplier = parseFloat(
        clamp(budgetRatio * rand(0.9, 1.5), 0.7, 2.2).toFixed(2)
      );

      // Primes : proportionnelles au rang ET au budget. Une équipe pauvre ne peut pas offrir 500 de prime victoire.
      // Plafond : budget_ratio × 180 pour la prime victoire
      const primeVictoireMax = Math.round((team.budget / 100) * 180);
      const primeVictoire = Math.round(
        clamp((200 - teamRank * 12) * rand(0.7, 1.2) * budgetRatio, 0, primeVictoireMax)
      );
      const primePodium = Math.round(primeVictoire * rand(0.25, 0.45));

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

      // ── Statut proposé : pilote 1 ou 2 ──────────────────────
      // L'écurie propose le statut en fonction du rang du candidat dans son évaluation :
      // - Le candidat le mieux scoré pour un slot libre = statut Pilote 1
      // - Les suivants = statut Pilote 2
      // - Si l'écurie a déjà un pilote en place classé higher ov → statut 2 pour les nouveaux
      const existingPilots = await Pilot.find({ teamId: team._id }).lean();
      let offeredStatus = null;
      if (slotsAvailable >= 2) {
        // 2 slots libres : le top candidat reçoit statut 1, les autres statut 2
        const isTopCandidate = targets[0] && String(targets[0].pilot._id) === String(pilot._id);
        offeredStatus = isTopCandidate ? 'numero1' : 'numero2';
      } else if (slotsAvailable === 1) {
        // 1 slot libre : statut déterminé par comparaison avec le pilote déjà là
        if (existingPilots.length === 1) {
          const existingOv = overallRating(existingPilots[0]);
          offeredStatus = ov >= existingOv ? 'numero1' : 'numero2';
        } else {
          offeredStatus = 'numero1'; // premier pilote = leader par défaut
        }
      }

      // Bonus salarial pour un statut Pilote 1 (+20% sur le salaire de base)
      const statusSalaryMultiplier = offeredStatus === 'numero1' ? 1.20 : 1.0;
      const finalSalaireBase = Math.round(salaireBase * statusSalaryMultiplier);

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
        salaireBase:   Math.max(50, finalSalaireBase),
        seasons,
        driverStatus: offeredStatus,
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
    // Salaire de référence initial (avant surenchères) pour le cap
    const baseCap = Math.round(offers[offers.length - 1].salaireBase * 3.0); // max 3× le moins offrant
    for (let i = 1; i < offers.length; i++) {
      const offer = offers[i];
      // Surenchère : +10% à +20% sur la meilleure offre visible, cap à 3× le salaire plancher
      const surenchere = Math.min(
        Math.round(topOffer.salaireBase * rand(1.08, 1.20)),
        baseCap
      );
      if (surenchere > offer.salaireBase) {
        await TransferOffer.findByIdAndUpdate(offer._id, { salaireBase: surenchere });
      }
    }
  }

  // ── Notifier les pilotes par DM que leurs offres sont disponibles ──
  const allNewPending = await TransferOffer.find({ status: 'pending' });
  // Grouper par pilote pour 1 seul DM résumé par joueur
  const offersByPilotForDM = new Map();
  for (const o of allNewPending) {
    const key = String(o.pilotId);
    if (!offersByPilotForDM.has(key)) offersByPilotForDM.set(key, []);
    offersByPilotForDM.get(key).push(o);
  }
  for (const [pilotId, pilotOffers] of offersByPilotForDM) {
    try {
      const pilot    = await Pilot.findById(pilotId);
      if (!pilot?.discordId) continue;
      const discordUser = await (async () => {
        try { return await client.users.fetch(pilot.discordId); } catch { return null; }
      })();
      if (!discordUser) continue;
      const dmCh = await discordUser.createDM().catch(() => null);
      if (!dmCh) continue;
      const teamNames = [];
      for (const o of pilotOffers) {
        const t = await Team.findById(o.teamId);
        if (t) teamNames.push(`${t.emoji} **${t.name}**`);
      }
      await dmCh.send(
        `📬 **Mercato ouvert !** **${pilot.name}** a reçu **${pilotOffers.length}** offre(s) de contrat :\n` +
        teamNames.join(', ') + '\n\n' +
        `Utilise \`/offres\` dans le serveur pour les consulter et répondre. Tu as **7 jours** avant expiration.`
      );
    } catch(e) { /* DM bloqués — pas grave */ }
  }

  return expiredContracts.length;
}

// ============================================================
//  🔄 DEUXIÈME VAGUE DE TRANSFERTS
//  Déclenché ~3-4 jours après la 1ère vague :
//  Pour les pilotes libres qui ont tout refusé ou dont toutes
//  les offres ont expiré, les écuries qui ont encore un slot
//  refont une offre — souvent plus "désespérée" (contrat court,
//  salaire revu à la baisse OU hausse si urgence).
// ============================================================
async function startSecondTransferWave(channel) {
  const season = await getActiveSeason();
  if (!season || season.status !== 'transfer') return;

  // Pilotes toujours sans équipe ET sans offre pending
  const freePilots = await Pilot.find({ teamId: null });
  if (!freePilots.length) return;

  const stillFree = [];
  for (const pilot of freePilots) {
    const pendingCount = await TransferOffer.countDocuments({ pilotId: pilot._id, status: 'pending' });
    if (pendingCount === 0) stillFree.push(pilot);
  }
  if (!stillFree.length) return;

  const allTeams       = await Team.find();
  const allStandings   = await Standing.find({ seasonId: season._id });
  const constrStandings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
  const teamRankMap    = new Map(constrStandings.map((s, i) => [String(s.teamId), i + 1]));
  const totalTeams     = allTeams.length;

  let waveOffers = 0;

  for (const team of allTeams) {
    const slotsAvailable = 2 - await Pilot.countDocuments({ teamId: team._id });
    if (slotsAvailable <= 0) continue;

    const teamRank    = teamRankMap.get(String(team._id)) || Math.ceil(totalTeams / 2);
    const budgetRatio = team.budget / 100;
    const prefersPeakPerformers = team.budget >= 120;
    const prefersYoungTalent    = team.budget < 80;

    // En 2ème vague, les équipes sont moins sélectives — elles élargiront leur cible
    for (const pilot of stillFree) {
      const ov = overallRating(pilot);

      // Les grandes équipes restent exigeantes (ov ≥ 65), les petites prennent tout
      if (prefersPeakPerformers && ov < 65) continue;

      const already = await TransferOffer.findOne({
        teamId: team._id, pilotId: pilot._id,
        status: { $in: ['pending', 'accepted'] }
      });
      if (already) continue;

      // Contrat d'urgence : durée 1 saison toujours, salaire légèrement réduit
      // (l'écurie prend le risque, le pilote aussi)
      // 2ème vague : offres d'urgence, même logique budget mais légèrement réduites (-15%)
      const budgetCapPerPilot2   = (team.budget / 100) * 130; // légèrement inférieur à la 1ère vague
      const ovAttractiveness2    = Math.pow(ov / 75, 1.5);
      const salaireBase = Math.round(
        clamp(budgetCapPerPilot2 * ovAttractiveness2 * rand(0.75, 1.05), 35, 380)
      );
      const coinMultiplier = parseFloat(
        clamp(budgetRatio * rand(0.8, 1.35), 0.65, 2.0).toFixed(2)
      );
      const primeVictoireMax2 = Math.round((team.budget / 100) * 150);
      const primeVictoire = Math.round(
        clamp((180 - teamRank * 12) * rand(0.65, 1.05) * budgetRatio, 0, primeVictoireMax2)
      );
      const primePodium = Math.round(primeVictoire * rand(0.2, 0.4));

      // Expiration plus courte : 4 jours seulement
      const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

      // Statut 2ème vague : comparaison avec pilote existant dans l'écurie
      const existingPilots2 = await Pilot.find({ teamId: team._id }).lean();
      let offeredStatus2 = null;
      if (existingPilots2.length === 1) {
        const existingOv2 = overallRating(existingPilots2[0]);
        offeredStatus2 = ov >= existingOv2 ? 'numero1' : 'numero2';
      } else {
        offeredStatus2 = 'numero1';
      }
      // En 2ème vague, légère réduction supplémentaire si on propose le statut 1 (urgence)
      const statusMul2 = offeredStatus2 === 'numero1' ? 1.15 : 1.0;

      await TransferOffer.create({
        teamId: team._id, pilotId: pilot._id,
        coinMultiplier,
        primeVictoire: Math.max(0, primeVictoire),
        primePodium:   Math.max(0, primePodium),
        salaireBase:   Math.max(40, Math.round(salaireBase * statusMul2)),
        seasons: 1,  // toujours 1 saison en 2ème vague
        driverStatus: offeredStatus2,
        status: 'pending',
        expiresAt,
      });
      waveOffers++;
    }
  }

  // Annonce dans le channel si des offres ont été générées
  if (channel && waveOffers > 0) {
    const allNewOffers  = await TransferOffer.find({ status: 'pending' });
    const allPilots2    = await Pilot.find({ _id: { $in: allNewOffers.map(o => o.pilotId) } });
    const allTeams2     = await Team.find();
    const pilotMap2     = new Map(allPilots2.map(p => [String(p._id), p]));
    const teamMap2      = new Map(allTeams2.map(t => [String(t._id), t]));

    const offersByPilot = new Map();
    for (const o of allNewOffers) {
      const key = String(o.pilotId);
      if (!offersByPilot.has(key)) offersByPilot.set(key, []);
      offersByPilot.get(key).push(o);
    }

    let marketDesc = '';
    for (const [pilotId, offers] of offersByPilot) {
      const pilot = pilotMap2.get(pilotId);
      if (!pilot) continue;
      const ov    = overallRating(pilot);
      const tier  = ratingTier(ov);
      const teamNames = offers.map(o => {
        const t = teamMap2.get(String(o.teamId));
        return t ? `${t.emoji} ${t.name}` : '?';
      }).join(', ');
      marketDesc += `${tier.badge} **${pilot.name}** *(${ov})* — ${offers.length} offre(s) : ${teamNames}\n`;
    }

    const embed = new EmbedBuilder()
      .setTitle('⚠️ DEUXIÈME VAGUE — Mercato d\'urgence !')
      .setColor('#FF4400')
      .setDescription(
        `**${stillFree.length}** pilote(s) sans équipe · **${waveOffers}** nouvelle(s) offre(s) générée(s)\n` +
        `Les pilotes libres ont **4 jours** pour accepter ou refuser — c'est la dernière chance.\n\n` +
        `📋 Utilisez \`/offres\` pour voir vos propositions.\n\u200B`
      )
      .addFields({
        name: '📊 Pilotes encore libres',
        value: (marketDesc.length > 1024 ? marketDesc.slice(0, 1000) + `\n*...+ ${(marketDesc.match(/\n/g)||[]).length - (marketDesc.slice(0,1000).match(/\n/g)||[]).length} pilote(s) non affichés*` : marketDesc) || '*Aucun pilote libre*',
      })
      .setFooter({ text: 'Contrats d\'urgence : 1 saison uniquement. Les équipes ont besoin de leurs sièges.' });

    await channel.send({ embeds: [embed] });
  }

  return waveOffers;
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
  new SlashCommandBuilder().setName('admin_set_personalities')
    .setDescription('[ADMIN] Assigne une personnalité à tous les pilotes qui n\'en ont pas'),
  new SlashCommandBuilder().setName('affinites')
    .setDescription('Voir la personnalité et les relations d\'un pilote')
    .addStringOption(o => o.setName('pilote').setDescription('Nom du pilote').setRequired(true)),

  new SlashCommandBuilder().setName('action_paddock')
    .setDescription('🎭 Ton pilote prend une initiative dans le paddock — rumeur, éloge, trahison...')
    .addStringOption(o => o.setName('cible').setDescription('Nom du pilote ciblé').setRequired(true))
    .addStringOption(o => o.setName('type')
      .setDescription('Type d\'action')
      .setRequired(true)
      .addChoices(
        { name: '🗡️ Trash talk — attaque publique, affecte sa réputation',      value: 'trash_talk' },
        { name: '💣 Rumeur — fuite anonyme, tu restes dans l\'ombre mais ça circule', value: 'rumeur'     },
        { name: '🤝 Éloge — reconnaissance publique, booste son image',           value: 'eloge'      },
        { name: '🔪 Trahison — tu révèles ce qu\'il a dit en conf privée',        value: 'trahison'   },
        { name: '😂 Vanne — pique humoristique, ambiance mais ça pique quand même', value: 'vanne'    },
        { name: '🤐 Démentir — tu prends sa défense contre une rumeur',           value: 'dementir'   },
        { name: '⚔️ Défi — tu le provoques ouvertement sur la piste',             value: 'defi'       },
        { name: '💔 Secret — tu révèles quelque chose qu\'il voulait garder caché', value: 'secret'   },
      )
    )
    .addIntegerOption(o => o.setName('pilote').setDescription('Ton pilote (1 ou 2)').setMinValue(1).setMaxValue(2)),
  new SlashCommandBuilder().setName('admin_stop_race')
    .setDescription('[ADMIN] Stoppe la course en cours immédiatement — résultats non comptabilisés'),
  new SlashCommandBuilder().setName('admin_queue')
    .setDescription('[ADMIN] Gère la file d\'attente des articles paddock en attente de publication')
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Voir tous les articles en attente de publication'))
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Annuler un article en attente (le supprime définitivement)')
      .addStringOption(o => o
        .setName('id')
        .setDescription('ID court de l\'article (affiché dans /admin_queue list)')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('publish')
      .setDescription('Forcer la publication immédiate d\'un article en attente (timer perdu après redémarrage)')
      .addStringOption(o => o
        .setName('id')
        .setDescription('ID court de l\'article (affiché dans /admin_queue list)')
        .setRequired(true))),
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

  new SlashCommandBuilder().setName('admin_set_intro')
    .setDescription('[ADMIN] 🎬 Définit la vidéo d\'intro GP — fichier MP4 ou URL externe permanente')
    .addAttachmentOption(o => o
      .setName('video')
      .setDescription('Fichier MP4 (glisse-dépose). Prioritaire sur l\'URL si les deux sont fournis.')
      .setRequired(false)
    )
    .addStringOption(o => o
      .setName('url')
      .setDescription('URL directe permanente vers le MP4 (GitHub raw, Cloudflare R2...). Laisser vide = désactiver.')
      .setRequired(false)
    ),

  new SlashCommandBuilder().setName('admin_test_intro')
    .setDescription('[ADMIN] 🎬 Teste l\'envoi de la vidéo d\'intro dans ce channel'),

  new SlashCommandBuilder().setName('admin_set_race_results')
    .setDescription(`[ADMIN] Saisit manuellement le classement d'un GP (si la simulation a planté)`)
    .addStringOption(o => o.setName('classement').setDescription(`Noms des pilotes dans l'ordre, séparés par des virgules. Ex: Alice,Bob,Charlie`).setRequired(true))
    .addStringOption(o => o.setName('dnf').setDescription('Noms des pilotes DNF, séparés par des virgules (optionnel)').setRequired(false))
    .addIntegerOption(o => o.setName('gp_index').setDescription('Index du GP (défaut: GP en cours)').setMinValue(0)),

  new SlashCommandBuilder().setName('admin_transfer')
    .setDescription('[ADMIN] Lance la période de transfert'),

  new SlashCommandBuilder().setName('admin_second_wave')
    .setDescription('[ADMIN] Force la 2ème vague de transferts (pilotes encore libres)'),

  new SlashCommandBuilder().setName('pilotes_libres')
    .setDescription('Liste les pilotes sans équipe pendant le mercato'),

  new SlashCommandBuilder().setName('admin_grille_next')
    .setDescription('[ADMIN] Voir la grille réelle de la prochaine saison (contrats signés + pilotes libres)'),

  new SlashCommandBuilder().setName('valeur_marche')
    .setDescription('Classement de valeur marchande — les pilotes les plus convoités du mercato'),

  new SlashCommandBuilder().setName('reveal_grille')
    .setDescription('[ADMIN] Révèle la grille complète de la prochaine saison'),

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

  new SlashCommandBuilder().setName('fia_reaction')
    .setDescription('⚖️ Ton pilote prend position publiquement sur la FIA — critique, éloge ou apaisement')
    .addStringOption(o => o.setName('type')
      .setDescription('Type de prise de position')
      .setRequired(true)
      .addChoices(
        { name: '🔥 Critiquer — attaque les décisions / arbitrage / règlements', value: 'critiquer' },
        { name: '🤝 Féliciter — salue une décision juste ou une initiative',      value: 'feliciter' },
        { name: '🕊️ Apaiser — calme le jeu, tente de réconcilier',               value: 'apaiser'   },
      )
    )
    .addStringOption(o => o.setName('raison')
      .setDescription('Raison précise (ex: "pénalité de ce GP", "règle DRS") — optionnel')
      .setRequired(false)
    )
    .addIntegerOption(o => o.setName('pilote').setDescription('Ton pilote (1 ou 2)').setMinValue(1).setMaxValue(2)),

  // ── /h2h ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('h2h')
    .setDescription('⚔️ Compare deux pilotes en face-à-face (public)')
    .addStringOption(o => o.setName('pilote1').setDescription('Nom du premier pilote').setRequired(true))
    .addStringOption(o => o.setName('pilote2').setDescription('Nom du second pilote').setRequired(true)),
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

  // ── Charger la config persistante (intro vidéo, etc.) ──────
  try {
    const cfg = await BotConfig.findOne({ key: 'global' });
    if (cfg?.raceIntroUrl) {
      raceIntroUrl = cfg.raceIntroUrl;
      console.log(`✅ Intro vidéo chargée depuis BotConfig : ${raceIntroUrl.slice(0, 60)}…`);
    }
  } catch (e) {
    console.warn('⚠️  BotConfig chargement échoué :', e.message);
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
    // Token expiré après 15min (normal pour les commandes longues) — ignorer silencieusement
    if (err.code === 10062) return;
    console.error('❌ interactionCreate error:', err.message);
    // Tenter de répondre à l'utilisateur si possible
    const reply = { content: '❌ Une erreur interne est survenue.', ephemeral: true };
    try {
      if (!interaction.replied && !interaction.deferred) await interaction.reply(reply);
      else if (interaction.deferred) await interaction.editReply(reply);
    } catch(_) {} // Si même ça échoue, on laisse tomber silencieusement
  }
});

// ── Commandes Personnalité ────────────────────────────────────────────
async function handleAdminSetPersonalities(interaction) {
  const pilots = await Pilot.find();
  let count = 0;
  for (const p of pilots) {
    if (!p.personality?.archetype) { p.personality = assignRandomPersonality(); await p.save(); count++; }
  }
  const bd = {};
  for (const p of await Pilot.find()) { const a=p.personality?.archetype||'inconnu'; bd[a]=(bd[a]||0)+1; }
  const lines = Object.entries(bd).map(([k,v])=>`• **${k}** : ${v}`).join('\n');
  await interaction.editReply(`✅ **${count}** pilote(s) ont reçu une personnalité.\n\n**Répartition :**\n${lines}`);
}

async function handleAffinites(interaction) {
  const name = interaction.options.getString('pilote');
  const pilot = await Pilot.findOne({ name: { $regex: name, $options: 'i' } });
  if (!pilot) return interaction.editReply(`❌ Pilote introuvable : \`${name}\``);
  // arch et tone délibérément cachés : les users découvrent la personnalité via les actions en jeu
  const pres = pilot.personality?.pressureLevel || 0;
  const pressBar = '🔴'.repeat(Math.round(pres/20)) + '⚪'.repeat(5-Math.round(pres/20));
  const rels = await PilotRelation.find({$or:[{pilotA:String(pilot._id)},{pilotB:String(pilot._id)}]}).sort({affinity:-1}).limit(8);
  const lines = [];
  for (const r of rels) {
    const otherId = String(r.pilotA)===String(pilot._id) ? r.pilotB : r.pilotA;
    const other = await Pilot.findById(otherId); if (!other) continue;
    const n = Math.min(4,Math.round(Math.abs(r.affinity)/25));
    const bar = (r.affinity>=0?'💚':'🔴').repeat(n) + '⚪'.repeat(4-n);
    const last = r.history?.slice(-1)[0];
    lines.push(`${bar} **${other.name}** (${r.affinity>0?'+':''}${r.affinity}) · *${r.type}*${last?' · '+last.event:''}`);
  }
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle(`🎭 ${pilot.name} — Relations & Pression`)
    .setColor('#FF6B35')
    .setDescription(`**Pression :** ${pressBar} (${pres}/100)\n\n`+(lines.length?`**Relations :**\n${lines.join('\n')}`:'*Aucune relation enregistrée.*'))] });
}

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
      // Réaction paddock : chance d'article de news sur le refus
      publishRefusalReaction(pilot, offer).catch(() => {});
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

    // ── Statut définitif calculé à la signature (pas dans l'offre) ────────
    // Règle : on regarde qui est déjà dans l'écurie et on (re)calcule les statuts.
    // Ça évite qu'une équipe se retrouve avec 2×N°1 ou 2×N°2.
    const existingTeamPilots = await Pilot.find({ teamId: team._id }).lean();
    let finalStatus = null;
    if (existingTeamPilots.length === 0) {
      // Premier pilote à signer → statut N°1 (leader par défaut, le 2ème aura N°2)
      finalStatus = 'numero1';
    } else if (existingTeamPilots.length === 1) {
      // Comparer les overall ratings pour attribuer N°1 au plus fort
      const existingOv = overallRating(existingTeamPilots[0]);
      const newOv      = overallRating(pilot);
      if (newOv >= existingOv) {
        // Le nouveau pilote est plus fort → il prend N°1, le titulaire passe N°2
        finalStatus = 'numero1';
        await Pilot.findByIdAndUpdate(existingTeamPilots[0]._id, { teamStatus: 'numero2' });
      } else {
        // Le titulaire reste N°1, le nouvel arrivant est N°2
        finalStatus = 'numero2';
        // S'assurer que le titulaire a bien le statut N°1 (au cas où il était null)
        if (!existingTeamPilots[0].teamStatus) {
          await Pilot.findByIdAndUpdate(existingTeamPilots[0]._id, { teamStatus: 'numero1' });
        }
      }
    }
    // Invalider toutes les offres N°1 encore en attente pour cette équipe (le slot N°1 est pris)
    if (finalStatus === 'numero1') {
      await TransferOffer.updateMany(
        { teamId: team._id, status: 'pending', driverStatus: 'numero1', pilotId: { $ne: pilot._id } },
        { status: 'expired' }
      );
    }

    const pilotStatusUpdate = { teamId: team._id, teamStatus: finalStatus };
    await Pilot.findByIdAndUpdate(pilot._id, pilotStatusUpdate);
    await Contract.create({
      pilotId: pilot._id, teamId: team._id,
      seasonsDuration:  offer.seasons, seasonsRemaining: offer.seasons,
      coinMultiplier:   offer.coinMultiplier,
      primeVictoire:    offer.primeVictoire,
      primePodium:      offer.primePodium,
      salaireBase:      offer.salaireBase,
      active: true,
    });

    // ── Annonce publique signature (rumeurs mêlées de vrai/faux) ───
    publishSigningRumors(pilot, team, offer).catch(console.error);

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
    'admin_news_force', 'admin_new_season', 'admin_transfer', 'admin_second_wave', 'admin_apply_last_race', 'admin_skip_gp', 'admin_set_race_results', 'admin_inject_results', 'admin_fix_slots', 'admin_stop_race', 'reveal_grille', 'admin_grille_next', 'valeur_marche',
    'fia_reaction', 'h2h'];
  const isEphemeral = ['create_pilot','profil','ameliorer','mon_contrat','offres',
    'accepter_offre','refuser_offre','admin_set_photo','admin_reset_pilot','admin_help',
    'f1','admin_news_force','concept','admin_apply_last_race','admin_fix_emojis','admin_set_personalities','affinites',
    'admin_replan','admin_evolve_cars','admin_reset_rivalites','admin_set_intro','admin_test_intro',
    'action_paddock', 'admin_queue'].includes(commandName);
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

    pilot.personality = assignRandomPersonality();
    await pilot.save();

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
      const heat = pilot.rivalHeat || 0;
      const heatBar = heat >= 80 ? '🔴🔴🔴🔴🔴' : heat >= 60 ? '🔴🔴🔴🔴⚫' : heat >= 40 ? '🔴🔴🔴⚫⚫' : heat >= 20 ? '🔴🔴⚫⚫⚫' : '🔴⚫⚫⚫⚫';
      const heatLabel = heat >= 80 ? 'Rivalité EXPLOSIVE' : heat >= 60 ? 'Tension très haute' : heat >= 40 ? 'Tension montante' : heat >= 20 ? 'Rivalité établie' : 'Rivalité naissante';
      const rivalNickLine = rival?.nickname ? ` — *alias ${rival.nickname}*` : '';
      embed.addFields({ name: '⚔️ Rivalité',
        value: `${rivalTeam?.emoji || ''} **${rival?.name || '?'}**${rivalNickLine} — ${pilot.rivalContacts || 0} contact(s)\n${heatBar} *${heatLabel}*`,
      });
    }

    // Surnom reçu
    if (pilot.nickname) {
      const givenBy = pilot.nicknameGivenBy ? await Pilot.findById(pilot.nicknameGivenBy) : null;
      embed.addFields({ name: '🏷️ Surnom',
        value: `${pilot.nickname}${givenBy ? ` *(selon ${givenBy.name})*` : ''}`,
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
      const dotdTotal  = gpRecs.filter(r => r.driverOfTheDay).length;
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

      const dotdStr  = dotdTotal > 0 ? ` · 🌟 **${dotdTotal}** DOTD` : '';
      const perfLine =
        `🥇 **${wins}V** · 🏆 **${podiums}P** · ❌ **${dnfsTotal}** DNF · ⚡ **${flaps}** FL${dotdStr} · moy. **P${avgPos}**` +
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
    await Pilot.updateMany({}, { $set: { rivalId: null, rivalContacts: 0, rivalHeat: 0 } });
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
    if (!offers.length) return interaction.editReply({
      content: `📭 Aucune offre en attente pour **${pilot.name}** (Pilote ${pilotIndex}).
*Si le mercato est ouvert, les offres arrivent sous 24h après la fin de saison.*`,
      ephemeral: true,
    });

    // Envoyer les offres en Message Privé pour éviter le flood du channel
    try {
      const dmChannel = await interaction.user.createDM();

      await dmChannel.send({
        content: `📬 **${offers.length} offre(s) en attente pour ${pilot.name} (Pilote ${pilotIndex}).**
> Les boutons restent actifs 10 min. Utilise \`/accepter_offre <ID>\` en secours si les boutons ont expiré.`,
      });

      for (const o of offers) {
        const team = await Team.findById(o.teamId);
        const expiresIn = o.expiresAt
          ? Math.max(0, Math.floor((new Date(o.expiresAt) - Date.now()) / (1000 * 60 * 60)))
          : null;
        const expiryStr = expiresIn !== null ? `⏳ Expire dans ~${expiresIn}h` : '';
        const statusStr = o.driverStatus === 'numero1'
          ? '\n🔴 **Statut proposé : Pilote N°1** *(leader d\'écurie — salaire inclut la prime de statut)*'
          : o.driverStatus === 'numero2'
            ? '\n🔵 **Statut proposé : Pilote N°2** *(second pilote)*'
            : '';
        const embed = new EmbedBuilder()
          .setTitle(`${team.emoji} ${team.name} — Offre de contrat`)
          .setColor(team.color)
          .setDescription(
            `×**${o.coinMultiplier}** coins | **${o.seasons}** saison(s)\n` +
            `💰 Salaire : **${o.salaireBase} 🪙**/course\n` +
            `🏆 Prime V : **${o.primeVictoire} 🪙** | 🥉 Prime P : **${o.primePodium} 🪙**` +
            statusStr +
            (expiryStr ? `\n${expiryStr}` : '')
          )
          .setFooter({ text: `ID de secours : ${o._id}` });

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
        await dmChannel.send({ embeds: [embed], components: [row] });
      }

      return interaction.editReply({
        content: `📨 Tes offres t'ont été envoyées en **Message Privé** ! Vérifie tes DMs. (${offers.length} offre(s) pour **${pilot.name}**)`,
        ephemeral: true,
      });
    } catch (dmError) {
      // DMs bloqués → fallback éphémère dans le channel
      console.warn(`[Offres] DM impossible pour ${interaction.user.id}: ${dmError.message}`);
      const embeds = [];
      const components = [];
      for (const o of offers) {
        const team = await Team.findById(o.teamId);
        embeds.push(new EmbedBuilder()
          .setTitle(`${team.emoji} ${team.name}`)
          .setColor(team.color)
          .setDescription(`×**${o.coinMultiplier}** | **${o.seasons}** saison(s) | 💰 **${o.salaireBase} 🪙**/course | 🏆 **${o.primeVictoire} 🪙** | 🥉 **${o.primePodium} 🪙**`)
          .setFooter({ text: `ID : ${o._id}` }));
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`offer_accept_${o._id}`).setLabel(`✅ ${team.name}`).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`offer_reject_${o._id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
        ));
      }
      await interaction.editReply({ content: `📬 **${offers.length} offre(s)** — Active tes DMs pour les recevoir en privé. Fallback ici :`, embeds: [embeds[0]], components: [components[0]], ephemeral: true });
      for (let i = 1; i < embeds.length; i++) {
        await interaction.followUp({ embeds: [embeds[i]], components: [components[i]], ephemeral: true });
      }
      return;
    }
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

    // Statut définitif calculé à la signature (même logique que le bouton)
    const existingTeamPilots2 = await Pilot.find({ teamId: team._id }).lean();
    let finalStatus2 = null;
    if (existingTeamPilots2.length === 0) {
      finalStatus2 = 'numero1';
    } else if (existingTeamPilots2.length === 1) {
      const existingOv2 = overallRating(existingTeamPilots2[0]);
      const newOv2      = overallRating(pilot);
      if (newOv2 >= existingOv2) {
        finalStatus2 = 'numero1';
        await Pilot.findByIdAndUpdate(existingTeamPilots2[0]._id, { teamStatus: 'numero2' });
      } else {
        finalStatus2 = 'numero2';
        if (!existingTeamPilots2[0].teamStatus) {
          await Pilot.findByIdAndUpdate(existingTeamPilots2[0]._id, { teamStatus: 'numero1' });
        }
      }
    }
    if (finalStatus2 === 'numero1') {
      await TransferOffer.updateMany(
        { teamId: team._id, status: 'pending', driverStatus: 'numero1', pilotId: { $ne: pilot._id } },
        { status: 'expired' }
      );
    }
    await Pilot.findByIdAndUpdate(pilot._id, { teamId: team._id, teamStatus: finalStatus2 });
    await Contract.create({
      pilotId: pilot._id, teamId: team._id,
      seasonsDuration:   offer.seasons, seasonsRemaining: offer.seasons,
      coinMultiplier:    offer.coinMultiplier,
      primeVictoire:     offer.primeVictoire,
      primePodium:       offer.primePodium,
      salaireBase:       offer.salaireBase,
      active: true,
    });

    publishSigningRumors(pilot, team, offer).catch(console.error);

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
    publishRefusalReaction(pilotForRefuse, offer).catch(() => {});
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
      const flag = pilot.nationality?.split(' ')[0] || '';
      desc += rank+' '+tier.badge+' **'+ov+'** '+tier.label.padEnd(9)+' — '+flag+' **'+pilot.name+'** '+(team ? team.emoji+' '+team.name : '🔴 *Libre*')+'\n';
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🏎️ Classement Pilotes — Note Générale').setColor('#FF1801').setDescription(desc.slice(0,4000)||'Aucun').setFooter({ text: sorted.length+' pilote(s)' })] });
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

    const schedulerStatus = global.schedulerPaused
      ? '⏸️ **Scheduler en pause**'
      : '▶️ Scheduler actif';

    const embed = new EmbedBuilder()
      .setTitle('🛠️ Commandes Administrateur — F1 PL')
      .setColor('#FF6600')
      .setDescription(`Toutes les commandes nécessitent la permission **Administrateur**.\nÉtat actuel : ${schedulerStatus}`)
      .addFields(
        {
          name: '🏁 Saison & Courses',
          value: [
            '`/admin_new_season` — Crée une nouvelle saison (24 GP au calendrier)',
            '`/admin_force_practice [gp_index]` — Déclenche les EL immédiatement',
            '`/admin_force_quali [gp_index]` — Déclenche les qualifs Q1/Q2/Q3',
            '`/admin_force_race [gp_index]` — Déclenche la course',
            '`/admin_skip_gp [gp_index]` — Saute un GP sans le simuler',
            '`/admin_stop_race` — Stoppe la course en cours (résultats non comptabilisés)',
            '`/admin_apply_last_race [race_id]` — 🔧 Applique les résultats si points non crédités',
            '`/admin_inject_results [gp_index]` — Injecte manuellement les résultats d\'un GP sans points',
            '`/admin_set_race_results classement:A,B,C [dnf:X,Y] [gp_index]` — Saisie manuelle du classement si simulation plantée',
          ].join('\n'),
        },
        {
          name: '⏱️ Scheduler automatique',
          value: [
            '`/admin_scheduler_pause` — ⏸️ Met en pause le lancement automatique des GPs',
            '`/admin_scheduler_resume` — ▶️ Réactive le lancement automatique',
            '`/admin_replan gp_index date` — Replanifie tout le calendrier depuis un GP de référence',
            '`/admin_fix_slots` — Recalcule les slots matin/soir des GPs (pair=matin, impair=soir)',
          ].join('\n'),
        },
        {
          name: '🔄 Transferts & Draft',
          value: [
            '`/admin_draft_start` — Lance le draft snake (joueurs choisissent leur écurie)',
            '`/admin_transfer` — Ouvre la période de transfert (IA génère les offres)',
            '`/admin_second_wave` — Force la 2ème vague pour les pilotes encore libres',
            '`/admin_grille_next` — Voir la vraie grille avec contrats, salaires et pilotes libres',
            '`/reveal_grille` — Révèle publiquement la grille de la saison à venir',
          ].join('\n'),
        },
        {
          name: '🎭 Paddock & News',
          value: [
            '`/admin_queue list` — Voir les articles en file d\'attente (avec heure et timer actif 🟢/🔴)',
            '`/admin_queue cancel id:XXXXXX` — Supprimer un article en attente',
            '`/admin_queue publish id:XXXXXX` — Forcer la publication d\'un article orphelin (timer perdu après redémarrage)',
            '`/admin_news_force` — Force la publication d\'un article de news immédiatement',
          ].join('\n'),
        },
        {
          name: '🖼️ Gestion Pilotes',
          value: [
            '`/admin_set_photo url:... [joueur:@u] [pilote:1|2]` — Définit la photo d\'un pilote',
            '`/admin_set_personalities` — Assigne une personnalité aux pilotes qui n\'en ont pas',
            '`/admin_reset_rivalites` — Réinitialise toutes les rivalités de la saison',
            '`/admin_reset_pilot joueur:@u [pilote:1|2]` — Supprime le(s) pilote(s) d\'un joueur',
          ].join('\n'),
        },
        {
          name: '🎬 Intro GP',
          value: [
            '`/admin_set_intro [video:<fichier MP4>] [url:<URL>]` — Définit la vidéo d\'intro GP',
            '`/admin_test_intro` — Teste l\'envoi de la vidéo d\'intro dans ce channel',
          ].join('\n'),
        },
        {
          name: '🔧 Fixes & Sync',
          value: [
            '`/admin_fix_emojis` — Synchronise les emojis des écuries depuis le code source',
            '`/admin_evolve_cars` — Affiche l\'état actuel des stats voitures',
          ].join('\n'),
        },
        {
          name: '🧪 Test & Debug',
          value: [
            '`/admin_test_race` — Simule une course fictive (aucune sauvegarde)',
            '`/admin_test_practice` — Simule des EL fictifs',
            '`/admin_test_qualif` — Simule des qualifs fictives',
          ].join('\n'),
        },
        {
          name: '📋 Procédure de démarrage',
          value: [
            '1️⃣ Les joueurs créent leurs pilotes via `/create_pilot` (2 max par joueur)',
            '2️⃣ Attribution des écuries : `/admin_draft_start` (snake draft) ou `/admin_transfer`',
            '3️⃣ `/admin_new_season` — Crée la saison et planifie les 24 GP',
            '4️⃣ Courses auto : **🌅 11h** EL · **13h** Q · **15h** Race · **🌆 17h** EL · **18h** Q · **20h** Race',
            '5️⃣ Fin de saison : `/admin_transfer` pour les offres, puis `/admin_new_season`',
          ].join('\n'),
        },
        {
          name: '⚙️ Infos système',
          value: [
            `📊 **${TOTAL_STAT_POOL} points** à répartir à la création (base ${BASE_STAT_VALUE}/stat · max +${MAX_STAT_BONUS})`,
            '🔔 Keep-alive actif — ping toutes les 8 min',
            '🎭 File d\'attente paddock : 1 article/heure, chaque article s\'enchaîne après le précédent',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'F1 PL Bot — Panneau Admin v2.2' });

    return interaction.editReply({ embeds: [embed], ephemeral: true });
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

    const f1Embed = new EmbedBuilder()
      .setTitle('🏎️ F1 PL — Guide des commandes')
      .setColor('#FF1801')
      .setDescription(welcomeDesc)
      .addFields(
        {
          name: '👤 Ton pilote',
          value: [
            '`/create_pilot` — Crée un pilote *(nationalité, numéro, stats — 2 max)*',
            '`/profil [joueur:@u] [pilote:1|2]` — Stats, note, contrat et classement',
            '`/ameliorer [pilote:1|2]` — Améliore une stat (coût croissant selon le niveau)',
            '`/performances [pilote:1|2] [vue]` — Historique GPs : récents / records / écuries / saison',
            '`/historique [pilote:1|2]` — Carrière complète multi-saisons',
          ].join('\n'),
        },
        {
          name: '🎭 Paddock — Actions & Relations',
          value: [
            '`/action_paddock cible:... type:... [pilote:1|2]` — Prends une initiative dans le paddock',
            '  🗡️ **Trash talk** — attaque publique · 💣 **Rumeur** — fuite anonyme (tu restes dans l\'ombre)',
            '  🤝 **Éloge** — reconnaissance publique · 🔪 **Trahison** — révèle ce qu\'il a dit en privé',
            '  😂 **Vanne** — pique humoristique · 🤐 **Démentir** — prends sa défense',
            '  ⚔️ **Défi** — provocation ouverte · 💔 **Secret** — révèle quelque chose de caché',
            '`/affinites pilote:...` — Voir la personnalité et les relations d\'un pilote',
            '`/rivalite [pilote:1|2]` — Ta rivalité actuelle en saison',
            '*⏳ Les articles paddock sont espacés d\'1h minimum (file automatique)*',
          ].join('\n'),
        },
        {
          name: '🏎️ Pilotes & Écuries',
          value: [
            '`/pilotes` — Classement général de tous les pilotes par note (style FIFA)',
            '`/ecuries` — Liste des 8 écuries avec pilotes et stats voiture',
            '`/ecurie nom:...` — Stats voiture détaillées d\'une écurie',
            '`/pilotes_libres` — Pilotes sans équipe pendant le mercato',
            '`/valeur_marche` — Classement des pilotes les plus convoités du mercato',
          ].join('\n'),
        },
        {
          name: '🏆 Classements & Résultats',
          value: [
            '`/classement` — Championnat pilotes saison en cours',
            '`/classement_constructeurs` — Championnat constructeurs',
            '`/resultats` — Résultats de la dernière course',
            '`/record_circuit circuit:...` — Record du meilleur tour sur un circuit',
            '`/palmares` — 🏛️ Hall of Fame de toutes les saisons',
          ].join('\n'),
        },
        {
          name: '📅 Calendrier & Planning',
          value: [
            '`/calendrier` — Tous les GP de la saison',
            '`/planning` — Prochains GPs avec horaires détaillés (EL · Qualifs · Course)',
          ].join('\n'),
        },
        {
          name: '📋 Contrats & Transferts',
          value: [
            '`/mon_contrat [pilote:1|2]` — Ton contrat actuel (durée, salaire, primes)',
            '`/offres [pilote:1|2]` — Offres de contrat en attente (boutons interactifs)',
            '`/accepter_offre offre_id:... [pilote:1|2]` — Accepter une offre',
            '`/refuser_offre offre_id:... [pilote:1|2]` — Refuser une offre',
          ].join('\n'),
        },
        {
          name: '🗞️ News & Infos',
          value: [
            '`/news [page]` — Derniers articles paddock (rumeurs, drama, rivalités)',
            '`/concept` — Présentation complète du jeu *(pour les nouveaux !)*',
            '`/f1` — Affiche ce panneau',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'GP auto : 🌅 11h/13h/15h · 🌆 17h/18h/20h (Paris) · 2 pilotes max · Cooldown action_paddock : 48h/pilote' });

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
        const fl   = r.fastestLap ? ' ⚡' : '';
        const dotd = r.driverOfTheDay ? ' 🌟' : '';
        const gl   = gainLoss(r);
        const pts  = r.points > 0 ? ` · **${r.points}pts**` : '';
        const grid = r.startPos ? ` *(grille P${r.startPos})*` : '';
        return `${r.circuitEmoji} **${r.circuit}** *(S${r.seasonYear})*\n` +
               `  ${posStr(r)}${gl}${pts}${fl}${dotd} — ${r.teamEmoji} ${r.teamName}${grid}`;
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

      // ── Meilleure série de finitions dans les points ──────
      let bestStreak = 0, curStreak = 0;
      for (const r of [...allRecs].sort((a, b) => new Date(a.raceDate) - new Date(b.raceDate))) {
        if (!r.dnf && r.finishPos <= 10) { curStreak++; bestStreak = Math.max(bestStreak, curStreak); }
        else curStreak = 0;
      }

      // ── Circuit favori (meilleure moyenne de finition, min 2 courses) ──
      const circuitGroups = new Map();
      for (const r of finished) {
        if (!circuitGroups.has(r.circuit)) circuitGroups.set(r.circuit, { emoji: r.circuitEmoji, positions: [] });
        circuitGroups.get(r.circuit).positions.push(r.finishPos);
      }
      let favCircuit = null, favAvg = 99;
      for (const [circ, data] of circuitGroups.entries()) {
        if (data.positions.length < 2) continue;
        const avg = data.positions.reduce((s, p) => s + p, 0) / data.positions.length;
        if (avg < favAvg) { favAvg = avg; favCircuit = { circuit: circ, emoji: data.emoji, avg, count: data.positions.length }; }
      }

      // ── H2H vs coéquipier actuel cette saison ─────────────
      let h2hLine = null;
      if (pilot.teamId) {
        const activeSzn = await Season.findOne({ status: 'active' });
        if (activeSzn) {
          const teammate = await Pilot.findOne({
            teamId  : pilot.teamId,
            _id     : { $ne: pilot._id },
          });
          if (teammate) {
            const mySeasonRecs      = allRecs.filter(r => r.seasonYear === activeSzn.year && !r.dnf);
            const teammateSeasonRec = await PilotGPRecord.find({ pilotId: teammate._id, seasonYear: activeSzn.year, dnf: false }).lean();
            let myWins = 0, tmWins = 0;
            for (const r of mySeasonRecs) {
              const tmR = teammateSeasonRec.find(t => String(t.raceId) === String(r.raceId));
              if (!tmR) continue;
              if (r.finishPos < tmR.finishPos) myWins++;
              else if (tmR.finishPos < r.finishPos) tmWins++;
            }
            const total = myWins + tmWins;
            if (total > 0) {
              const tm = teammate;
              h2hLine = `⚔️ **H2H vs ${team?.emoji || ''}${tm.name}** (S${activeSzn.year}) — **${myWins}**-${tmWins} sur ${total} GP(s)`;
            }
          }
        }
      }

      const top5lines = top5.map(r =>
        `${medals[r.finishPos] || `P${r.finishPos}`} ${r.circuitEmoji} **${r.circuit}** *(S${r.seasonYear})* — ${r.teamEmoji} ${r.teamName}` +
        (r.startPos ? ` *(grille P${r.startPos})*` : '') +
        (r.fastestLap ? ' ⚡' : '')
      ).join('\n');

      const statsBlock =
        `🥇 **${wins.length}** victoire(s) · 🏆 **${podiums.length}** podium(s) · ❌ **${dnfs.length}** DNF\n` +
        `⚡ **${flaps.length}** meilleur(s) tour(s) · 🌟 **${allRecs.filter(r => r.driverOfTheDay).length}** Driver of the Day\n` +
        `📊 **${totalPts}** pts totaux · 💰 **${totalCoins}** 🪙 gagnés\n` +
        (bestGain ? `🚀 Meilleure remontée : **+${bestGain.startPos - bestGain.finishPos}** places (${bestGain.circuitEmoji} ${bestGain.circuit} S${bestGain.seasonYear})\n` : '') +
        (bestStreak > 0 ? `🔥 Meilleure série dans les points : **${bestStreak}** GP(s) consécutifs\n` : '') +
        (favCircuit ? `🏟️ Circuit favori : ${favCircuit.emoji} **${favCircuit.circuit}** (moy. **P${favCircuit.avg.toFixed(1)}** sur ${favCircuit.count} courses)\n` : '') +
        (h2hLine ? `${h2hLine}\n` : '');

      // ── Forme récente affichée en records ─────────────────
      const last5 = allRecs.slice(0, 5);
      const formStr = last5.map(r => {
        if (r.dnf) return '❌';
        if (r.finishPos === 1) return '🥇';
        if (r.finishPos <= 3) return '🏆';
        if (r.finishPos <= 10) return '✅';
        return '▪️';
      }).join(' ');
      const formScore = pilot.recentFormScore || 0;
      const formLabel = formScore >= 0.4 ? '🔥 En feu'
                      : formScore >= 0.1 ? '📈 En forme'
                      : formScore <= -0.4 ? '❄️ En crise'
                      : formScore <= -0.1 ? '📉 Déclin'
                      : '➡️ Stable';

      embed
        .setTitle(`🏆 Records — ${pilot.name} (Pilote ${pilot.pilotIndex})`)
        .setDescription(
          `${tier.badge} **${ov}** — **${allRecs.length}** GP(s) disputé(s)\n` +
          `Forme récente : ${formStr} ${formLabel}\n\n` +
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
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.deferReply();
    try {
      const season = await createNewSeason();
      await interaction.editReply(`✅ Saison **${season.year}** créée ! ${CIRCUITS.length} GP au calendrier.`);
      // Conf de presse pré-saison : envoyée 30 secondes après la création pour ne pas noyer le message
      const ch = interaction.channel;
      if (ch) {
        setTimeout(() => {
          generatePreseasonPressConf(season, ch).catch(e => console.error('PreseasonPress error:', e.message));
        }, 30000);
      }
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

  if (commandName === 'admin_set_personalities') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    return handleAdminSetPersonalities(interaction);
  }
  if (commandName === 'affinites') return handleAffinites(interaction);

  // ================================================================
  // /action_paddock — initiative joueur dans le paddock
  // ================================================================
  if (commandName === 'action_paddock') {
    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const cibleName  = interaction.options.getString('cible');
    const actionType = interaction.options.getString('type');

    // ── Récupérer le pilote source ────────────────────────────
    const pilot = await Pilot.findOne({ discordId: interaction.user.id, pilotIndex });
    if (!pilot) return interaction.editReply({ content: `❌ Tu n'as pas de pilote n°${pilotIndex}.`, ephemeral: true });
    if (!pilot.teamId) return interaction.editReply({ content: '❌ Ton pilote doit être dans une écurie pour agir dans le paddock.', ephemeral: true });

    // ── Récupérer la cible ────────────────────────────────────
    const allPilots = await Pilot.find({ teamId: { $ne: null } });
    const target = allPilots.find(p =>
      p.name.toLowerCase().includes(cibleName.toLowerCase()) &&
      String(p._id) !== String(pilot._id)
    );
    if (!target) return interaction.editReply({ content: `❌ Pilote "${cibleName}" introuvable (ou c'est toi-même).`, ephemeral: true });

    // ── Cooldown : 48h par pilote source ─────────────────────
    const COOLDOWN_MS = 48 * 60 * 60 * 1000;
    const lastUse = await CommandCooldown.findOne({
      discordId: interaction.user.id,
      command: 'action_paddock',
      pilotId: pilot._id,
    }).sort({ usedAt: -1 });

    if (lastUse) {
      const elapsed = Date.now() - lastUse.usedAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - elapsed;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        return interaction.editReply({
          content: `⏳ **${pilot.name}** doit se calmer. Prochain coup dans **${h}h${m > 0 ? `${m}m` : ''}**.`,
          ephemeral: true,
        });
      }
    }

    // ── Relation actuelle ────────────────────────────────────
    const [sA, sB] = [String(pilot._id), String(target._id)].sort();
    let rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
    if (!rel) rel = new PilotRelation({ pilotA: sA, pilotB: sB, affinity: 0, type: 'neutre', history: [] });

    const isTeammate = String(pilot.teamId) === String(target.teamId);
    const isRival    = String(pilot.rivalId) === String(target._id);
    const season     = await getActiveSeason();
    const allTeams   = await Team.find();
    const teamMap    = new Map(allTeams.map(t => [String(t._id), t]));
    const pilotTeam  = teamMap.get(String(pilot.teamId));
    const targetTeam = teamMap.get(String(target.teamId));

    // ── Contexte récent : dernier GP + classement pilotes ────
    let recentCtx = {};
    try {
      const lastRace = season
        ? await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 }).lean()
        : null;

      // Classement pilotes — positions au championnat
      let srcChampPos = null, tgtChampPos = null, srcChampPts = null, tgtChampPts = null;
      if (season) {
        const allStandings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).lean();
        allStandings.forEach((s, i) => {
          if (String(s.pilotId) === String(pilot._id))  { srcChampPos = i + 1; srcChampPts = s.points; }
          if (String(s.pilotId) === String(target._id)) { tgtChampPos = i + 1; tgtChampPts = s.points; }
        });
      }

      if (lastRace && lastRace.raceResults && lastRace.raceResults.length) {
        const tgtResult = lastRace.raceResults.find(r => String(r.pilotId) === String(target._id));
        const srcResult = lastRace.raceResults.find(r => String(r.pilotId) === String(pilot._id));
        if (tgtResult) {
          recentCtx = {
            circuit       : lastRace.circuit || null,
            tgtDnf        : tgtResult.dnf === true,
            tgtDnfReason  : tgtResult.dnfReason || null,
            tgtWon        : !tgtResult.dnf && tgtResult.pos === 1,
            tgtPodium     : !tgtResult.dnf && tgtResult.pos <= 3,
            tgtPos        : tgtResult.dnf ? null : tgtResult.pos,
            srcPos        : srcResult && !srcResult.dnf ? srcResult.pos : null,
            srcDnf        : srcResult?.dnf === true,
            // Classement au championnat
            srcChampPos, srcChampPts,
            tgtChampPos, tgtChampPts,
            // Écart au championnat
            champGap      : (srcChampPts !== null && tgtChampPts !== null) ? srcChampPts - tgtChampPts : null,
          };
        } else {
          // Pas de résultat course pour la cible mais on a quand même le classement
          recentCtx = { srcChampPos, srcChampPts, tgtChampPos, tgtChampPts,
            champGap: (srcChampPts !== null && tgtChampPts !== null) ? srcChampPts - tgtChampPts : null };
        }
      } else {
        recentCtx = { srcChampPos, srcChampPts, tgtChampPos, tgtChampPts,
          champGap: (srcChampPts !== null && tgtChampPts !== null) ? srcChampPts - tgtChampPts : null };
      }
    } catch(e) { console.error('[action_paddock recentCtx]', e.message); }

    // ── Configs par action ────────────────────────────────────
    // affinityDelta : impact sur la relation
    // public : l'article sort dans le channel principal (true) ou reste discret (false)
    const ACTION_CONFIG = {
      trash_talk : { affinityDelta: -18, public: true,  label: 'Trash talk',         emoji: '🗡️'  },
      rumeur     : { affinityDelta: -12, public: false, label: 'Rumeur',              emoji: '💣'  },
      eloge      : { affinityDelta: +15, public: true,  label: 'Éloge public',        emoji: '🤝'  },
      trahison   : { affinityDelta: -22, public: true,  label: 'Trahison conf',       emoji: '🔪'  },
      vanne      : { affinityDelta: -8,  public: true,  label: 'Vanne',               emoji: '😂'  },
      dementir   : { affinityDelta: +10, public: true,  label: 'Démenti',             emoji: '🤐'  },
      defi       : { affinityDelta: -15, public: true,  label: 'Défi ouvert',         emoji: '⚔️'  },
      secret     : { affinityDelta: -28, public: true,  label: 'Secret de vestiaire', emoji: '💔'  },
    };
    const cfg = ACTION_CONFIG[actionType];

    // ── Générer l'article ────────────────────────────────────
    const article = generatePaddockAction(pilot, target, pilotTeam, targetTeam, actionType, rel.affinity, season?.year || 2025, isTeammate, isRival, recentCtx);
    if (!article) return interaction.editReply({ content: '❌ Impossible de générer cet article.', ephemeral: true });

    // ── Sauvegarder et publier ────────────────────────────────
    const saved = await NewsArticle.create({
      ...article,
      triggered: 'player_action',
      publishedAt: new Date(),
      queuedBy: interaction.user.id,  // discord ID du joueur
    });

    // ── Mettre à jour l'affinité ─────────────────────────────
    const delta = cfg.affinityDelta;
    rel.affinity = Math.max(-100, Math.min(100, rel.affinity + delta));
    rel.type = rel.affinity >= 60 ? 'amis' : rel.affinity >= 20 ? 'respect' : rel.affinity > -20 ? 'neutre' : rel.affinity > -60 ? 'tension' : 'ennemis';
    rel.history = rel.history || [];
    rel.history.push({ event: `action_paddock_${actionType}`, delta, date: new Date(), seasonYear: season?.year });
    if (rel.history.length > 30) rel.history = rel.history.slice(-30);

    // Réaction en chaîne si action agressive (la cible répondra)
    if (delta < -10) {
      rel.pendingReply = true;
      rel.pendingReplyCtx = { actionPaddock: true, type: actionType, initiatorName: pilot.name };
    }
    await rel.save();

    // ── Pression sur la cible (actions agressives) ───────────
    if (delta < 0) {
      const pressureDelta = Math.abs(delta) > 20 ? 18 : 10;
      await Pilot.findByIdAndUpdate(target._id, {
        $inc: { 'personality.pressureLevel': pressureDelta },
      });
    }

    // ── Enregistrer le cooldown ──────────────────────────────
    await CommandCooldown.create({
      discordId: interaction.user.id,
      command: 'action_paddock',
      pilotId: pilot._id,
      usedAt: new Date(),
    });

    // ── Publier dans le channel si public ───────────────────
    const targetNick = target.nickname ? ` *(${target.nickname})*` : '';

    // Labels d'action pour les messages de confirmation (sans "bombe" générique)
    const ACTION_LABELS = {
      trash_talk : { sent: `a pris la parole publiquement sur`,  queued: `a déclaré la guerre à`       },
      rumeur     : { sent: `a fait circuler une rumeur sur`,     queued: `a fait circuler une rumeur sur` },
      eloge      : { sent: `a rendu hommage à`,                  queued: `a rendu hommage à`             },
      trahison   : { sent: `a exposé publiquement`,              queued: `a brisé la confiance de`      },
      vanne      : { sent: `a sorti une pique sur`,              queued: `a sorti une pique sur`        },
      dementir   : { sent: `a pris la défense de`,               queued: `a pris la défense de`         },
      defi       : { sent: `a lancé un défi ouvert à`,           queued: `a lancé un défi à`            },
      secret     : { sent: `a révélé un secret sur`,             queued: `a révélé un secret sur`       },
    };
    const lbl = ACTION_LABELS[actionType] || { sent: `a agi sur`, queued: `a agi sur` };
    const affinityLine = delta >= 0
      ? `📈 Affinité : **+${delta}** → *${rel.type}*`
      : `📉 Affinité : **${delta}** → *${rel.type}*`;

    // Publier dans le channel principal (avec file d'attente anti-flood 1h)
    if (cfg.public) {
      try {
        const ch = interaction.channel;
        const QUEUE_COOLDOWN_MS = 60 * 60 * 1000; // 1 heure

        // Dernier article publié (hors file d'attente)
        const lastPublished = await NewsArticle.findOne({
          triggered: 'player_action',
          queued: { $ne: true },
          _id: { $ne: saved._id },
        }).sort({ publishedAt: -1 }).lean();

        // Dernier slot occupé en file d'attente (scheduledFor le plus tardif)
        const lastQueued = await NewsArticle.findOne({
          triggered: 'player_action',
          queued: true,
          _id: { $ne: saved._id },
        }).sort({ scheduledFor: -1 }).lean();

        const now = Date.now();

        const lastPublishedMs = lastPublished?.publishedAt
          ? new Date(lastPublished.publishedAt).getTime()
          : 0;

        const lastQueuedMs = lastQueued?.scheduledFor
          ? new Date(lastQueued.scheduledFor).getTime()
          : 0;

        // Référence = le slot le plus tardif (publié ou en file)
        const lastSlotMs = Math.max(lastPublishedMs, lastQueuedMs);
        const elapsed    = now - lastSlotMs;

        // Si aucun slot récent ou dernier slot > 1h : publier immédiatement
        if (lastSlotMs === 0 || elapsed >= QUEUE_COOLDOWN_MS) {
          const confirmMsg =
            `✅ **${pilot.name}** ${lbl.sent} **${target.name}**${targetNick}. L'article sort maintenant.\n` +
            `${affinityLine}`;
          await interaction.editReply({ content: confirmMsg, ephemeral: true });
          await publishNews(saved, ch);
        } else {
          // Slot = lastSlotMs + 1h (s'enchaîne après le dernier article publié ou en file)
          const delay   = QUEUE_COOLDOWN_MS - elapsed;
          const pubTime = new Date(lastSlotMs + QUEUE_COOLDOWN_MS);
          const pubTs   = `<t:${Math.floor(pubTime.getTime() / 1000)}:t>`;
          const posInQueue = lastQueued
            ? `(position ${await NewsArticle.countDocuments({ triggered: 'player_action', queued: true, _id: { $ne: saved._id } })} en file)`
            : '';
          const confirmMsg =
            `✅ **${pilot.name}** ${lbl.queued} **${target.name}**${targetNick}. Action enregistrée.\n` +
            `${affinityLine}\n` +
            `⏳ Article programmé à ${pubTs} ${posInQueue}`;
          await interaction.editReply({ content: confirmMsg, ephemeral: true });

          // Marquer en BDD avec le bon scheduledFor
          await NewsArticle.findByIdAndUpdate(saved._id, {
            queued: true,
            scheduledFor: pubTime,
          });

          // Timer précis
          const timeoutId = setTimeout(async () => {
            paddockQueue.delete(String(saved._id));
            const stillQueued = await NewsArticle.findById(saved._id).lean();
            if (!stillQueued || stillQueued.queued === false) {
              console.log('[action_paddock queue] Article annulé, publication ignorée:', saved._id);
              return;
            }
            try {
              await NewsArticle.findByIdAndUpdate(saved._id, { queued: false, scheduledFor: null });
              await publishNews(saved, ch);
            } catch(e) { console.error('[action_paddock publish delayed]', e.message); }
          }, delay);
          paddockQueue.set(String(saved._id), timeoutId);
        }
      } catch(e) { console.error('[action_paddock publish]', e.message); }
    } else {
      // Action non-publique (rumeur) : confirmer discrètement sans publier dans le channel
      const confirmMsg =
        `✅ **${pilot.name}** ${lbl.sent} **${target.name}**${targetNick}. La rumeur circule discrètement.\n` +
        `${affinityLine}`;
      await interaction.editReply({ content: confirmMsg, ephemeral: true });
    }

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

  // ── /admin_set_intro ─────────────────────────────────────────
  if (commandName === 'admin_set_intro') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.' });

    const attachment = interaction.options.getAttachment('video');
    const urlInput   = interaction.options.getString('url');

    // Aucun des deux → désactivation
    if (!attachment && !urlInput) {
      raceIntroUrl  = null;
      raceIntroPath = null;
      await BotConfig.findOneAndUpdate(
        { key: 'global' },
        { $set: { raceIntroUrl: null, updatedAt: new Date() } },
        { upsert: true }
      );
      return interaction.editReply({
        content:
          '🎬 **Intro vidéo désactivée.**\n' +
          'Aucune vidéo ne sera envoyée avant les prochains GPs.\n\n' +
          '> *Pour réactiver : refais `/admin_set_intro` en attachant un fichier ou en collant une URL.*',
      });
    }

    // ── Priorité 1 : fichier attaché ─────────────────────────
    if (attachment) {
      const isVideo = attachment.contentType && attachment.contentType.startsWith('video/');
      if (!isVideo) {
        return interaction.editReply({
          content:
            '❌ **Le fichier doit être une vidéo** (MP4, MOV, WebM...).\n' +
            `> Type reçu : \`${attachment.contentType || 'inconnu'}\``,
        });
      }
      raceIntroUrl  = attachment.url;
      raceIntroPath = null;
      await BotConfig.findOneAndUpdate(
        { key: 'global' },
        { $set: { raceIntroUrl: attachment.url, updatedAt: new Date() } },
        { upsert: true }
      );
      const sizeMb  = (attachment.size / 1_048_576).toFixed(1);
      return interaction.editReply({
        content:
          `🎬 **Intro configurée via pièce jointe** (${sizeMb} Mo)\n\n` +
          `> ⚠️ *Lien CDN Discord — peut expirer après quelques jours.*\n` +
          `> *Pour une URL permanente, héberge le fichier sur Internet Archive ou catbox.moe et utilise le champ \`url\`.*\n` +
          `> *Pour désactiver : \`/admin_set_intro\` sans rien remplir.*`,
      });
    }

    // ── Priorité 2 : URL externe ──────────────────────────────
    const isValidUrl = urlInput.startsWith('http://') || urlInput.startsWith('https://');
    if (!isValidUrl) {
      return interaction.editReply({
        content:
          '❌ URL invalide — elle doit commencer par `https://`.\n\n' +
          '**Exemples d\'URLs permanentes :**\n' +
          '> 🗃️ Internet Archive : `https://archive.org/download/mon-fichier/intro.mp4`\n' +
          '> 📦 catbox.moe : `https://files.catbox.moe/xxxxxx.mp4`',
      });
    }

    raceIntroUrl  = urlInput;
    raceIntroPath = null;
    await BotConfig.findOneAndUpdate(
      { key: 'global' },
      { $set: { raceIntroUrl: urlInput, updatedAt: new Date() } },
      { upsert: true }
    );

    const hostHint = urlInput.includes('archive.org')       ? '🗃️ Internet Archive — URL permanente ✅'
                   : urlInput.includes('catbox.moe')         ? '📦 catbox.moe — URL permanente ✅'
                   : urlInput.includes('raw.githubusercontent') ? '🐙 GitHub Raw — URL permanente ✅'
                   : urlInput.includes('cdn.discordapp.com') ? '⚠️ Discord CDN — peut expirer'
                   : '🔗 Hébergement externe';

    return interaction.editReply({
      content:
        `🎬 **Intro vidéo configurée !**\n` +
        `Elle sera envoyée avant chaque GP.\n\n` +
        `${hostHint}\n` +
        `\`${urlInput.length > 80 ? urlInput.slice(0, 77) + '…' : urlInput}\`\n\n` +
        `> *Pour désactiver : \`/admin_set_intro\` sans rien remplir.*`,
    });
  }

  // ── /admin_test_intro ─────────────────────────────────────
  if (commandName === 'admin_test_intro') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.' });

    if (!raceIntroUrl && !raceIntroPath) {
      return interaction.editReply({ content: '❌ Aucune intro configurée. Utilise `/admin_set_intro` d\'abord.' });
    }

    await interaction.editReply({ content: `🎬 Envoi de l'intro dans ce channel...\n> \`${(raceIntroUrl || raceIntroPath).slice(0, 80)}\`` });

    try {
      const ch = interaction.channel;
      if (!ch) return;
      if (raceIntroUrl) {
        await ch.send(raceIntroUrl);
      } else if (raceIntroPath) {
        const { AttachmentBuilder } = require('discord.js');
        await ch.send({ files: [new AttachmentBuilder(raceIntroPath, { name: 'intro_f1.mp4' })] });
      }
    } catch(e) {
      console.error('[admin_test_intro] erreur envoi:', e.message);
      await interaction.editReply({ content: `❌ Erreur lors de l'envoi : \`${e.message}\`` });
    }
    return;
  }
  // ================================================================
  // /admin_queue — file d'attente des articles paddock
  // ================================================================
  if (commandName === 'admin_queue') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.' });

    const sub = interaction.options.getSubcommand();

    // ── LIST ──────────────────────────────────────────────────
    if (sub === 'list') {
      try {
        const queued = await NewsArticle.find({ queued: true })
          .sort({ scheduledFor: 1 })
          .lean();

        if (!queued.length) {
          return interaction.editReply({ content: '✅ Aucun article en file d\'attente.', ephemeral: true });
        }

        // Enrichir avec les noms des pilotes impliqués
        const allPilotIds = [...new Set(queued.flatMap(a => a.pilotIds.map(String)))];
        const pilots = await Pilot.find({ _id: { $in: allPilotIds } }).lean();
        const pilotMap = new Map(pilots.map(p => [String(p._id), p.name]));

        const lines = queued.map((art, i) => {
          const shortId  = String(art._id).slice(-6).toUpperCase();
          const pilotsStr = art.pilotIds.map(id => pilotMap.get(String(id)) || '?').join(' vs ');
          const scheduledTs = art.scheduledFor
            ? `<t:${Math.floor(new Date(art.scheduledFor).getTime() / 1000)}:t> (<t:${Math.floor(new Date(art.scheduledFor).getTime() / 1000)}:R>)`
            : '(heure inconnue)';
          const inMemory   = paddockQueue.has(String(art._id)) ? '🟢' : '🔴';
          const triggeredBy = art.queuedBy ? `<@${art.queuedBy}>` : 'auto';
          return [
            `**[${i+1}]** \`${shortId}\` — *${art.headline.slice(0, 60)}${art.headline.length > 60 ? '…' : ''}*`,
            `   📰 Pilotes : **${pilotsStr}** · Type : \`${art.type}\``,
            `   ⏰ Publication prévue : ${scheduledTs} · Timer actif : ${inMemory}`,
            `   👤 Déclenché par : ${triggeredBy}`,
          ].join('\n');
        });

        const embed = new EmbedBuilder()
          .setTitle(`⏳ File d'attente paddock — ${queued.length} article(s)`)
          .setDescription(lines.join('\n\n'))
          .setColor('#F5A623')
          .setFooter({ text: 'Pour annuler : /admin_queue cancel id:<ID court>' });

        return interaction.editReply({ embeds: [embed], ephemeral: true });
      } catch(e) {
        console.error('[admin_queue list]', e);
        return interaction.editReply({ content: `❌ Erreur : ${e.message}`, ephemeral: true });
      }
    }

    // ── CANCEL ────────────────────────────────────────────────
    if (sub === 'cancel') {
      const shortId = interaction.options.getString('id').trim().toUpperCase();

      try {
        // Chercher l'article dont l'ID se termine par le shortId (6 derniers chars)
        const queued = await NewsArticle.find({ queued: true }).lean();
        const match  = queued.find(a => String(a._id).slice(-6).toUpperCase() === shortId);

        if (!match) {
          return interaction.editReply({
            content: `❌ Aucun article en file avec l'ID \`${shortId}\`. Vérife avec \`/admin_queue list\`.`,
            ephemeral: true,
          });
        }

        // Annuler le setTimeout en mémoire s'il existe encore
        const timeoutId = paddockQueue.get(String(match._id));
        if (timeoutId) {
          clearTimeout(timeoutId);
          paddockQueue.delete(String(match._id));
        }

        // Marquer comme annulé en BDD (queued:false empêche la publication si le timer a déjà expiré)
        await NewsArticle.findByIdAndDelete(match._id);

        const pilotsIds = match.pilotIds.map(String);
        const pilots    = await Pilot.find({ _id: { $in: pilotsIds } }).lean();
        const pilotsStr = pilots.map(p => p.name).join(' vs ');
        const triggeredBy = match.queuedBy ? `<@${match.queuedBy}>` : 'inconnu';

        return interaction.editReply({
          content: [
            `🗑️ Article \`${shortId}\` **supprimé et publication annulée**.`,
            `📰 *${match.headline.slice(0, 80)}${match.headline.length > 80 ? '…' : ''}*`,
            `👥 Pilotes : **${pilotsStr}**`,
            `👤 Déclenché par : ${triggeredBy}`,
            timeoutId ? `✅ Timer en mémoire effacé.` : `⚠️ Aucun timer en mémoire (le bot a peut-être redémarré).`,
          ].join('\n'),
          ephemeral: true,
        });
      } catch(e) {
        console.error('[admin_queue cancel]', e);
        return interaction.editReply({ content: `❌ Erreur : ${e.message}`, ephemeral: true });
      }
    }

    // ── PUBLISH (force-post pour articles orphelins après redémarrage) ──
    if (sub === 'publish') {
      const shortId = interaction.options.getString('id').trim().toUpperCase();

      try {
        const queued = await NewsArticle.find({ queued: true }).lean();
        const match  = queued.find(a => String(a._id).slice(-6).toUpperCase() === shortId);

        if (!match) {
          return interaction.editReply({
            content: `❌ Aucun article en file avec l'ID \`${shortId}\`. Vérifie avec \`/admin_queue list\`.`,
          });
        }

        // Si un timer est encore actif en mémoire, l'annuler (on publie maintenant)
        const existingTimer = paddockQueue.get(String(match._id));
        if (existingTimer) {
          clearTimeout(existingTimer);
          paddockQueue.delete(String(match._id));
        }

        // Récupérer le channel de news
        const ch = RACE_CHANNEL ? await client.channels.fetch(RACE_CHANNEL).catch(() => null) : null;
        if (!ch) {
          return interaction.editReply({ content: '❌ Channel de news introuvable (RACE_CHANNEL_ID manquant ou invalide).' });
        }

        // Marquer comme publié en BDD
        await NewsArticle.findByIdAndUpdate(match._id, {
          queued: false,
          scheduledFor: null,
          publishedAt: new Date(),
        });

        // Publier
        await publishNews(match, ch);

        const pilotsIds = match.pilotIds.map(String);
        const pilots    = await Pilot.find({ _id: { $in: pilotsIds } }).lean();
        const pilotsStr = pilots.map(p => p.name).join(' vs ');
        const wasOrphan = !existingTimer ? ' *(timer perdu — article orphelin récupéré)*' : '';

        return interaction.editReply({
          content: [
            `📤 Article \`${shortId}\` **publié immédiatement**.${wasOrphan}`,
            `📰 *${match.headline.slice(0, 80)}${match.headline.length > 80 ? '…' : ''}*`,
            `👥 Pilotes : **${pilotsStr}**`,
          ].join('\n'),
        });
      } catch(e) {
        console.error('[admin_queue publish]', e);
        return interaction.editReply({ content: `❌ Erreur : ${e.message}` });
      }
    }

    return interaction.editReply({ content: '❌ Sous-commande inconnue.' });
  }

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

  // ── /admin_second_wave ────────────────────────────────────
  if (commandName === 'admin_second_wave') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    await interaction.deferReply();
    const ch = interaction.channel;
    const waveCount = await startSecondTransferWave(ch);
    if (waveCount === 0) {
      await interaction.editReply('✅ Aucune 2ème vague nécessaire — tous les pilotes libres ont déjà des offres ou sont sous contrat.');
    } else {
      await interaction.editReply(`✅ **2ème vague lancée !** ${waveCount} offre(s) d'urgence générée(s) pour les pilotes encore libres.`);
    }
  }

  // ── /admin_grille_next ───────────────────────────────────
  // Réservé admins : voir la vraie grille avec noms, équipes et contrats
  if (commandName === 'admin_grille_next') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });

    const allTeams  = await Team.find();
    const allPilots = await Pilot.find();
    const teamMap   = new Map(allTeams.map(t => [String(t._id), t]));

    const byTeam = new Map();
    for (const t of allTeams) byTeam.set(String(t._id), { team: t, pilots: [] });

    const freePilots = [];
    for (const p of allPilots) {
      if (p.teamId) {
        const entry = byTeam.get(String(p.teamId));
        if (entry) entry.pilots.push(p);
      } else {
        freePilots.push(p);
      }
    }

    const lines2 = [];
    for (const { team, pilots } of byTeam.values()) {
      if (!pilots.length) {
        lines2.push(team.emoji + ' **' + team.name + '** — ⚠️ *Aucun pilote signé*');
        continue;
      }
      lines2.push(team.emoji + ' **' + team.name + '**');
      for (const p of pilots) {
        const contract = await Contract.findOne({ pilotId: p._id, active: true }).lean();
        const ov   = overallRating(p);
        const tier = ratingTier(ov);
        const sal  = contract ? contract.salaireBase + '🪙/course' : '*sans contrat actif*';
        const dur  = contract ? contract.seasonsRemaining + ' saison(s)' : '';
        lines2.push('  ' + tier.badge + ' **' + p.name + '** *(' + ov + ')* — ' + sal + (dur ? ' · ' + dur : ''));
      }
    }

    if (freePilots.length) {
      lines2.push('\\n⚠️ **Pilotes libres (' + freePilots.length + ') :**');
      for (const p of freePilots) {
        const ov      = overallRating(p);
        const tier    = ratingTier(ov);
        const pending = await TransferOffer.countDocuments({ pilotId: p._id, status: 'pending' });
        lines2.push('  ' + tier.badge + ' **' + p.name + '** *(' + ov + ')* — ' + pending + ' offre(s) pending');
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🔒 [ADMIN] Grille réelle — Prochaine saison')
      .setColor('#444444')
      .setDescription(lines2.join('\n').slice(0, 4000) || 'Aucune donnée')
      .setFooter({ text: 'Visible admins uniquement — ne pas divulguer avant /reveal_grille' });
    return interaction.editReply({ embeds: [embed], ephemeral: true });
  }

  // ── /valeur_marche ───────────────────────────────────────
  // Classement des pilotes par nombre d'offres reçues — visible seulement pendant le mercato
  if (commandName === 'valeur_marche') {
    const season = await getActiveSeason();
    const isTransfer = season && season.status === 'transfer';

    // Compter les offres reçues par pilote (toutes statuts confondus sauf expired automatique)
    const allOffers = await TransferOffer.find({ status: { $in: ['pending', 'rejected', 'accepted'] } }).lean();
    const countByPilot = {};
    for (const o of allOffers) {
      const key = String(o.pilotId);
      countByPilot[key] = (countByPilot[key] || 0) + 1;
    }

    if (!Object.keys(countByPilot).length) {
      return interaction.reply({ content: '📭 Aucune offre enregistrée ce mercato. Revenez plus tard.', ephemeral: false });
    }

    // Trier par nombre d'offres desc
    const ranked = Object.entries(countByPilot)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const lines2 = [];
    for (let i = 0; i < ranked.length; i++) {
      const [pilotId, count] = ranked[i];
      const pilot = await Pilot.findById(pilotId).lean();
      if (!pilot) continue;
      const ov   = overallRating(pilot);
      const tier = ratingTier(ov);
      // Flou sur le nb exact d'offres : on donne une fourchette pour garder le mystère
      const flouLabel = count >= 4 ? 'Très convoité 🔥' : count === 3 ? 'Courtisé 📬' : count === 2 ? 'Approché 📩' : 'En discussions 🤝';
      const teamLine  = pilot.teamId
        ? '' // signé — pas de team révélée avant reveal_grille
        : ' *(libre)*';
      lines2.push(medals[i] + ' ' + tier.badge + ' **' + pilot.name + '**' + teamLine + ' — ' + flouLabel);
    }

    const embed = new EmbedBuilder()
      .setTitle('💰 Valeur Marchande — Mercato ' + (season?.year || ''))
      .setColor('#C0392B')
      .setDescription(
        '*Les pilotes les plus convoites de cette fenetre de transferts.*\n' +
        '*(Classement base sur les approches recues — les destinations restent secretes.)*\n\n' +
        lines2.join('\n')
      )
      .setFooter({ text: isTransfer ? 'Mercato en cours — classement temps réel' : 'Mercato terminé — classement final' });

    return interaction.reply({ embeds: [embed] });
  }

  // ── /pilotes_libres ──────────────────────────────────────
  // Montre les noms des pilotes libres + overall
  // MAIS ne révèle pas qui a signé où — le mystère sur les équipes reste entier
  if (commandName === 'pilotes_libres') {
    const freePilots = await Pilot.find({ teamId: null });
    if (!freePilots.length) {
      const embed = new EmbedBuilder()
        .setTitle('🏁 Mercato — Pilotes libres')
        .setColor('#00AA44')
        .setDescription('✅ **Tous les pilotes ont trouvé une écurie.**\n\nRendez-vous au `/reveal_grille` pour découvrir le line-up officiel !');
      return interaction.editReply({ embeds: [embed] });
    }
    const totalPilots = await Pilot.countDocuments();
    const signedCount = totalPilots - freePilots.length;
    const lines2 = freePilots.map(p => {
      const ov   = overallRating(p);
      const tier = ratingTier(ov);
      return `${tier.badge} **${p.name}** *(${ov} overall)*`;
    });
    const embed = new EmbedBuilder()
      .setTitle('🔓 Mercato — Pilotes sans équipe')
      .setColor('#FF6600')
      .setDescription(
        lines2.join('\n') + '\n\n' +
        `*${signedCount} pilote(s) ont déjà signé quelque part — mais où ? Mystère 🤫*\n` +
        `*Les line-ups seront révélés au \`/reveal_grille\`.*\n` +
        `*Utilisez \`/offres\` si vous avez des propositions de contrat en attente.*`
      );
    return interaction.editReply({ embeds: [embed] });
  }


  // ── /reveal_grille ────────────────────────────────────────
  // BUG FIX : reply() appelée APRÈS revealFinalGrid() (opération lente ~10s) → timeout Discord (3s)
  // Correction : reply() immédiat, puis revealFinalGrid(), puis editReply() pour confirmation
  if (commandName === 'reveal_grille') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.reply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });
    await interaction.reply({ content: '⏳ Révélation de la grille en cours...', ephemeral: true });
    await revealFinalGrid(season, interaction.channel);
    await Season.findByIdAndUpdate(season._id, { gridRevealedAt: new Date() });
    return interaction.editReply({ content: '✅ Grille révélée !', ephemeral: true });
  }

  // ── /admin_evolve_cars ────────────────────────────────────
  if (commandName === 'admin_evolve_cars') {
    if (!interaction.member.permissions.has('Administrator'))
      return interaction.editReply({ content: '❌ Commande réservée aux admins.', ephemeral: true });
    const teams = await Team.find().sort({ vitesseMax: -1 });
    const bar   = v => '█'.repeat(Math.round(v/10)) + '░'.repeat(10-Math.round(v/10));
    const embed = new EmbedBuilder().setTitle('🔧 Stats Voitures (état actuel)').setColor('#888888');
    for (const t of teams) {
      // Calcul masse salariale pour info admin
      const teamCtracts = await Contract.find({ teamId: t._id, active: true }).lean();
      const totalSal = teamCtracts.reduce((sum, c) => sum + (c.salaireBase || 0), 0);
      const salPen   = Math.min(8, Math.floor(totalSal / 100));
      const salEmoji = totalSal >= 400 ? '💸' : totalSal >= 200 ? '💰' : '🪙';
      embed.addFields({
        name: `${t.emoji} ${t.name}  (dev: ${t.devPoints} pts)`,
        value:
          `Vit. Max ${bar(t.vitesseMax)}${t.vitesseMax}  |  DRS ${bar(t.drs)}${t.drs}\n` +
          `Refroid. ${bar(t.refroidissement)}${t.refroidissement}  |  Dirty ${bar(t.dirtyAir)}${t.dirtyAir}\n` +
          `Pneus ${bar(t.conservationPneus)}${t.conservationPneus}  |  Moy ${bar(t.vitesseMoyenne)}${t.vitesseMoyenne}\n` +
          `${salEmoji} Masse salariale : **${totalSal} 🪙/course** → pénalité dev **-${salPen} devPts/course**`,
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


  // ══════════════════════════════════════════════════════════════════════════
  // /fia_reaction — prise de position publique envers la FIA
  // Types : critiquer | feliciter | apaiser   — Cooldown 48h
  // fiaCriticism 0–100 : monte avec critique, descend avec félicite/apaise
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === 'fia_reaction') {
    // Ephemeral : le "réfléchit..." et toutes les réponses de confirmation ne sont visibles
    // que par le joueur — le contenu public est envoyé via targetChannel.send()
    await interaction.deferReply({ ephemeral: true });

    const pilotIndex = interaction.options.getInteger('pilote') || 1;
    const fiaType    = interaction.options.getString('type');
    const raison     = interaction.options.getString('raison');

    const pilot = await Pilot.findOne({ discordId: interaction.user.id, pilotIndex });
    if (!pilot)
      return interaction.editReply({ content: '❌ Aucun pilote n°' + pilotIndex + '. Crée-le avec `/create_pilot`.', ephemeral: true });

    const pilotTeam = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const season    = await getActiveSeason();

    // ── Cooldown 48h ────────────────────────────────────────────────────────
    const COOLDOWN_MS = 48 * 60 * 60 * 1000;
    const lastFia = await CommandCooldown.findOne({
      discordId : interaction.user.id,
      command   : 'fia_reaction',
      pilotId   : pilot._id,
    }).sort({ usedAt: -1 });

    if (lastFia) {
      const elapsed = Date.now() - lastFia.usedAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const rem = COOLDOWN_MS - elapsed;
        const h   = Math.floor(rem / 3_600_000);
        const m   = Math.floor((rem % 3_600_000) / 60_000);
        const cdLabel = fiaType === 'critiquer' ? 'critiquer la FIA'
                      : fiaType === 'feliciter' ? 'féliciter la FIA'
                      : 'jouer les pacificateurs';
        return interaction.editReply({
          content: '⏳ **' + pilot.name + '** doit attendre avant de ' + cdLabel + ' à nouveau.\n*Disponible dans **' + h + 'h' + (m > 0 ? m + 'm' : '') + '**.*',
          ephemeral: true,
        });
      }
    }

    // ── Contexte pilote ───────────────────────────────────────────────────
    const arch     = pilot.personality?.archetype  || 'guerrier';
    const ego      = pilot.personality?.ego         || 50;
    const tone     = pilot.personality?.tone        || 'diplomatique';
    const prevCrit = pilot.personality?.fiaCriticism || 0;
    const isBadBoy = ['bad_boy', 'guerrier'].includes(arch);
    const isVieux  = arch === 'vieux_sage';
    const isRookie = arch === 'rookie_ambitieux';
    const isDiplo  = tone === 'diplomatique';

    // Dernier GP pour contexte si aucune raison fournie
    let lastRace = null;
    if (!raison && season) {
      lastRace = await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 }).lean();
    }
    const ctxGP    = raison || (lastRace ? (lastRace.emoji || '') + ' ' + lastRace.circuit : null);
    const ctxStr   = ctxGP ? ' concernant ' + ctxGP : '';
    const ctxShort = ctxGP ? ' (' + ctxGP + ')' : '';

    // ── Publie dans le channel course si possible ─────────────────────────
    const newsChannel  = await getRaceChannel(null);
    const targetChannel = (newsChannel && newsChannel.id !== interaction.channelId) ? newsChannel : interaction.channel;

    // ══════════════════════════════════════════════════════════════
    // CRITIQUER
    // ══════════════════════════════════════════════════════════════
    if (fiaType === 'critiquer') {
      const newCrit = Math.min(100, prevCrit + randInt(10, 18));
      await Pilot.findByIdAndUpdate(pilot._id, { 'personality.fiaCriticism': newCrit });

      const critLabel = newCrit >= 70 ? '🔴 critique récidiviste'
                      : newCrit >= 40 ? '🟠 voix dissidente'
                      :                 '🟡 ton inhabituel';

      // Headlines en 3 niveaux de tension
      let headlines;
      if (prevCrit < 30) {
        headlines = [
          pilot.name + ' sort de sa réserve' + ctxShort + ' — message direct à la FIA',
          'Ton surprenant de ' + pilot.name + ctxStr + ' — "Quelqu\'un devait le dire"',
          (pilotTeam ? pilotTeam.emoji : '') + pilot.name + ' interpelle la FIA' + ctxStr,
        ];
      } else if (prevCrit < 65) {
        headlines = [
          pilot.name + ' récidive' + ctxStr + ' — la FIA dans son viseur depuis plusieurs GPs',
          'Nouvelle sortie de ' + pilot.name + ' contre les commissaires' + ctxShort,
          pilot.name + ' vs FIA' + ctxShort + ' : un feuilleton qui continue',
          '"Deux poids deux mesures" — ' + pilot.name + ' ne lâche pas' + ctxStr,
        ];
      } else {
        headlines = [
          pilot.name + ' vs FIA : la guerre ouverte' + ctxShort + ' — le paddock retient son souffle',
          'Personne ne s\'y trompe plus — ' + pilot.name + ' est en croisade contre la FIA',
          pilot.name + ' encore' + ctxShort + '. La FIA, cible préférée du paddock cette saison',
          '"Je ne m\'excuserai pas" — ' + pilot.name + ' assume et continue' + ctxStr,
        ];
      }

      // Quotes différenciées par archétype
      let quotes;
      if (isBadBoy) {
        quotes = [
          '"Je respecte le sport. Pas les décisions' + (ctxGP ? ' de ' + ctxGP : ' de ce genre') + '. Inexplicable."',
          '"La FIA peut justifier ce qu\'elle veut — le paddock a des yeux."',
          '"J\'ai rien contre les commissaires personnellement. Mais là, non."',
          (prevCrit >= 60 ? '"Encore. Toujours les mêmes problèmes."' : '"Faut qu\'on en parle. Maintenant."'),
          (ego > 70 ? '"Je suis le seul à dire ce que tout le monde pense."' : '"Quelqu\'un doit bien le dire."'),
        ];
      } else if (isVieux) {
        quotes = [
          '"Après toutes ces saisons, je pensais avoir tout vu. Et pourtant' + (ctxGP ? ' — ' + ctxGP : '') + '."',
          '"Je ne suis pas là pour créer des problèmes. Mais certaines décisions méritent une réponse."',
          '"Je reste respectueux. Mais je ne peux pas ne rien dire' + (ctxGP ? ' sur ' + ctxGP : '') + '."',
        ];
      } else if (isRookie) {
        quotes = [
          '"Je suis peut-être nouveau, mais j\'ai des yeux. Ça' + (ctxGP ? ' — ' + ctxGP : '') + ', c\'était injuste."',
          '"Je veux bien apprendre les règles. Encore faut-il qu\'elles soient appliquées de la même façon pour tout le monde."',
        ];
      } else {
        quotes = [
          '"Je n\'ai rien contre la FIA personnellement. Mais là, une explication s\'impose."',
          '"La transparence est la base. Ce week-end' + (ctxGP ? ' à ' + ctxGP : '') + ', on en était loin."',
          '"Deux pilotes, même situation, deux décisions différentes. Que faut-il comprendre ?"',
        ];
      }

      let bodyCtx;
      if (prevCrit >= 65) {
        bodyCtx = pick([
          'La déclaration de **' + pilot.name + '**' + ctxStr + ' s\'inscrit dans une longue série de sorties contre l\'instance dirigeante.',
          'Ce n\'est plus une surprise. **' + pilot.name + '** et la FIA, c\'est une relation qui se détériore GP après GP.',
        ]);
      } else if (prevCrit >= 30) {
        bodyCtx = pick([
          '**' + pilot.name + '** n\'est pas du genre à se taire quand quelque chose le choque. Le paddock a entendu.',
          'Deuxième sortie notable' + ctxStr + ' en quelques GP. Une tendance se dessine.',
        ]);
      } else {
        bodyCtx = pick([
          'Rare de voir **' + pilot.name + '** dans cette posture. L\'irritation est visible' + (ctxGP ? ' après ' + ctxGP : '') + '.',
          'Le paddock prend note. Pas forcément d\'accord avec la forme, mais le fond résonne chez beaucoup.',
        ]);
      }

      const body = '*' + pick(quotes) + '*\n\n' + bodyCtx +
        (newCrit >= 50 ? '\n\n*Niveau de tension FIA : **' + critLabel + '** (' + newCrit + '/100)*' : '');

      const embed = new EmbedBuilder()
        .setColor('#E53935')
        .setTitle('🔥 ' + pick(headlines))
        .setDescription(body)
        .setFooter({ text: '📰 Déclaration publique · ' + pilot.name + ' · FIA Tension : ' + newCrit + '/100 ' + critLabel });

      await targetChannel.send({ embeds: [embed] });
      if (targetChannel.id !== interaction.channelId)
        await interaction.editReply({ content: '🔥 Déclaration publiée. *(Tension FIA : ' + newCrit + '/100 — ' + critLabel + ')*', ephemeral: true });
      else
        await interaction.editReply({ content: '✅ Publié.', ephemeral: true });
    }

    // ══════════════════════════════════════════════════════════════
    // FÉLICITER
    // ══════════════════════════════════════════════════════════════
    else if (fiaType === 'feliciter') {
      const newCrit = Math.max(0, prevCrit - randInt(4, 8));
      await Pilot.findByIdAndUpdate(pilot._id, { 'personality.fiaCriticism': newCrit });

      const praiseReason = raison || pick(['la décision post-course', 'l\'initiative prise cette semaine', 'la clarté du communiqué officiel', 'la réactivité des commissaires']);
      const impactNote   = prevCrit >= 40
        ? '\n\n*Surprenant de la part de ' + pilot.name + ', connu pour ses critiques — le paddock note le changement de ton.*'
        : '';

      let quotes;
      if (isBadBoy) {
        quotes = [
          '"Je suis le premier à critiquer quand c\'est mérité. Là — c\'était la bonne décision. Chapeau."',
          '"La FIA peut se tromper. Là elle ne s\'est pas trompée."',
          '"Tout le monde peut bien faire. Là, c\'était bien."',
        ];
      } else if (isVieux) {
        quotes = [
          '"Dans ma carrière, j\'ai vu beaucoup de mauvaises décisions. Celle-là, non. C\'était bien géré."',
          '"Je peux critiquer quand il le faut — et saluer quand c\'est mérité. ' + (ctxGP ? 'Sur ' + ctxGP + ' :' : 'Ici :') + ' c\'est mérité."',
          '"La FIA n\'a pas souvent d\'alliés dans le paddock. Aujourd\'hui, j\'en suis un."',
        ];
      } else if (isRookie) {
        quotes = [
          '"Je commence à comprendre comment ça fonctionne. Et ' + (raison || 'cette décision') + ', c\'était bien."',
          '"Honnêtement, je m\'attendais à pire. Bien joué."',
        ];
      } else {
        quotes = [
          '"' + (raison ? 'Sur ' + raison : 'Cette fois') + ', la décision était la bonne. Je le dis franchement."',
          '"Ce n\'est pas si courant de pouvoir féliciter la FIA. Là, c\'est justifié."',
          '"Transparence, cohérence — c\'est tout ce qu\'on demande. Bien."',
        ];
      }

      const headlines = prevCrit >= 40 ? [
        'Le retournement de situation — ' + pilot.name + ' félicite la FIA' + ctxShort,
        pilot.name + ' change de ton' + ctxStr + ' — *"C\'était la bonne décision"*',
        'Surprise dans le paddock : ' + pilot.name + ' prend la défense de la FIA' + ctxShort,
      ] : [
        pilot.name + ' salue la FIA' + ctxShort + ' — "C\'était la bonne décision"',
        pilot.name + ' prend tout le monde de court : éloge public de la FIA' + ctxShort,
        '"C\'est mérité" — ' + pilot.name + ' défend la FIA' + ctxShort,
        'Geste rare de ' + pilot.name + ctxStr + ' — le paddock prend note',
      ];

      const bodyPraise = isDiplo
        ? '**' + pilot.name + '** prend tout le monde de court' + ctxStr + '. Quand on s\'attendait à la critique habituelle, il choisit de saluer.'
        : 'Dans un environnement où critiquer la FIA est un sport en soi, la déclaration de **' + pilot.name + '** détonne' + ctxStr + '.';

      const body = '*' + pick(quotes) + '*\n\n' + bodyPraise + impactNote;

      const embed = new EmbedBuilder()
        .setColor('#43A047')
        .setTitle('🤝 ' + pick(headlines))
        .setDescription(body)
        .setFooter({ text: '📰 Déclaration publique · ' + pilot.name + ' · FIA Tension : ' + newCrit + '/100' + (prevCrit >= 40 ? ' ⬇️ apaisement' : '') });

      await targetChannel.send({ embeds: [embed] });
      if (targetChannel.id !== interaction.channelId)
        await interaction.editReply({ content: '🤝 Déclaration publiée. *(Tension FIA : ' + newCrit + '/100)*', ephemeral: true });
      else
        await interaction.editReply({ content: '✅ Publié.', ephemeral: true });
    }

    // ══════════════════════════════════════════════════════════════
    // APAISER
    // ══════════════════════════════════════════════════════════════
    else if (fiaType === 'apaiser') {
      const newCrit  = Math.max(0, prevCrit - randInt(8, 16));
      const wasHostile = prevCrit >= 50;
      await Pilot.findByIdAndUpdate(pilot._id, { 'personality.fiaCriticism': newCrit });

      const peaceReason = raison || pick(['la situation globale', 'les tensions des derniers GPs', 'le débat autour des règlements', 'les échanges tendus dans le paddock']);

      let quotes;
      if (isBadBoy) {
        quotes = [
          '"Ça fait du bruit depuis un moment. J\'ai dit ce que j\'avais à dire. Maintenant on avance."',
          '"Je peux me battre sur la piste sans me battre contre la FIA. Cette semaine, on repart à zéro."',
          '"Critiquer c\'est facile. Construire, c\'est autre chose."',
        ];
      } else if (isVieux) {
        quotes = [
          '"Dans ce sport, la FIA et les pilotes ont besoin les uns des autres. Le dialogue est la seule voie."',
          '"J\'ai eu mes désaccords. Mais l\'important c\'est que le sport avance — ensemble."',
          '"On peut ne pas être d\'accord et quand même se respecter."',
        ];
      } else if (isRookie) {
        quotes = [
          '"Je ne veux pas commencer ma carrière en mode guerre. Si y\'a des problèmes, on peut en parler."',
          '"Tout le monde cherche la même chose — que le sport soit bon. On part de là."',
        ];
      } else {
        quotes = [
          '"Les tensions ne font de bien à personne. Sur ' + peaceReason + ', je préfère le dialogue."',
          '"Je veux des solutions, pas des coupables."',
          '"Critiquer ne change rien si on ne propose pas autre chose. Alors — parlons-en."',
        ];
      }

      const headlines = wasHostile ? [
        pilot.name + ' choisit l\'apaisement' + ctxShort + ' — revirement après semaines de tensions',
        'La surprise de la semaine : ' + pilot.name + ' tend la main à la FIA' + ctxShort,
        pilot.name + ' change de cap' + ctxStr + ' — "Maintenant, on avance"',
        'Fin de la guerre ? ' + pilot.name + ' appelle au dialogue' + ctxShort,
      ] : [
        pilot.name + ' opte pour le dialogue' + ctxShort + ' — message aux deux camps',
        '"Je préfère le dialogue" — ' + pilot.name + ' appelle à la désescalade' + ctxShort,
        pilot.name + ' choisit la voie de la réconciliation' + ctxStr,
      ];

      const bodyPeace = wasHostile
        ? 'Changement de ton marquant de **' + pilot.name + '**' + ctxStr + '. Celui qui était en première ligne des critiques semble vouloir tourner une page.'
        : '**' + pilot.name + '** fait le choix de la désescalade' + ctxStr + '. Un signal adressé à toutes les parties.';

      const body = '*' + pick(quotes) + '*\n\n' + bodyPeace +
        (wasHostile ? '\n\n*Tension FIA de **' + pilot.name + '** : ' + prevCrit + ' → ' + newCrit + '/100.*' : '');

      const embed = new EmbedBuilder()
        .setColor('#7B61FF')
        .setTitle('🕊️ ' + pick(headlines))
        .setDescription(body)
        .setFooter({ text: '📰 Déclaration publique · ' + pilot.name + ' · FIA Tension : ' + newCrit + '/100' + (wasHostile ? ' ⬇️ désescalade notable' : '') });

      await targetChannel.send({ embeds: [embed] });
      if (targetChannel.id !== interaction.channelId)
        await interaction.editReply({ content: '🕊️ Déclaration publiée. *(Tension FIA : ' + newCrit + '/100)*', ephemeral: true });
      else
        await interaction.editReply({ content: '✅ Publié.', ephemeral: true });
    }

    // ── Enregistrer cooldown ────────────────────────────────────────────────
    await CommandCooldown.create({
      discordId : interaction.user.id,
      command   : 'fia_reaction',
      pilotId   : pilot._id,
      usedAt    : new Date(),
    });
    return;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // /h2h — comparaison publique head-to-head entre deux pilotes
  // ══════════════════════════════════════════════════════════════════════════
  if (commandName === 'h2h') {
    await interaction.deferReply({ ephemeral: false });

    const name1 = interaction.options.getString('pilote1').toLowerCase();
    const name2 = interaction.options.getString('pilote2').toLowerCase();

    const allPilots = await Pilot.find({ teamId: { $ne: null } });
    const p1 = allPilots.find(p => p.name.toLowerCase().includes(name1));
    const p2 = allPilots.find(p => p.name.toLowerCase().includes(name2) && String(p._id) !== String(p1?._id));

    if (!p1 || !p2) {
      return interaction.editReply({ content: `❌ Pilotes introuvables. Vérifie les noms (**${name1}** / **${name2}**).` });
    }

    const [t1, t2] = await Promise.all([
      Team.findById(p1.teamId),
      Team.findById(p2.teamId),
    ]);
    const season = await getActiveSeason();

    // ── Stats saison actuelle ─────────────────────────────────────────────
    const [st1, st2] = await Promise.all([
      season ? Standing.findOne({ seasonId: season._id, pilotId: p1._id }) : null,
      season ? Standing.findOne({ seasonId: season._id, pilotId: p2._id }) : null,
    ]);
    const s1 = st1 || { points: 0, wins: 0, podiums: 0, dnfs: 0 };
    const s2 = st2 || { points: 0, wins: 0, podiums: 0, dnfs: 0 };

    // Classements saison actuelle
    let rank1 = null, rank2 = null;
    if (season) {
      const allSt = await Standing.find({ seasonId: season._id }).sort({ points: -1 });
      rank1 = allSt.findIndex(s => String(s.pilotId) === String(p1._id)) + 1 || null;
      rank2 = allSt.findIndex(s => String(s.pilotId) === String(p2._id)) + 1 || null;
    }

    // ── Confrontations directes + Forme récente (une seule requête) ─────────
    // BUG FIX : race.results → race.raceResults (champ réel du schema)
    // BUG FIX : double Race.find fusionné en une seule requête
    let h2hWins1 = 0, h2hWins2 = 0;
    let recentIcons1 = '—', recentIcons2 = '—';
    if (season) {
      const doneRaces = await Race.find({ seasonId: season._id, status: 'done' }).lean();

      // H2H wins
      for (const race of doneRaces) {
        const results = Array.isArray(race.raceResults) ? race.raceResults : [];
        const r1 = results.find(r => String(r.pilotId) === String(p1._id));
        const r2 = results.find(r => String(r.pilotId) === String(p2._id));
        if (r1 && r2 && !r1.dnf && !r2.dnf) {
          if (r1.pos < r2.pos) h2hWins1++;
          else h2hWins2++;
        }
      }

      // Forme récente (5 derniers GPs)
      const recentIcon = (races, pilotId) => {
        const sorted = [...races].sort((a, b) => (b.index || 0) - (a.index || 0)).slice(0, 5);
        return sorted.map(r => {
          const res = (Array.isArray(r.raceResults) ? r.raceResults : [])
            .find(x => String(x.pilotId) === String(pilotId));
          if (!res) return '⬜';
          if (res.dnf) return '❌';
          if (res.pos === 1) return '🥇';
          if (res.pos <= 3) return '🥈';
          if (res.pos <= 10) return '🟢';
          return '⬛';
        }).join('');
      };
      if (doneRaces.length > 0) {
        recentIcons1 = recentIcon(doneRaces, p1._id) || '—';
        recentIcons2 = recentIcon(doneRaces, p2._id) || '—';
      }
    }

    // ── Relation / affinité ───────────────────────────────────────────────
    const [sA, sB] = [String(p1._id), String(p2._id)].sort();
    const rel = await PilotRelation.findOne({ pilotA: sA, pilotB: sB });
    const affinity = rel?.affinity ?? 0;
    const relType  = rel?.type    || 'neutre';
    const isRivals = String(p1.rivalId) === String(p2._id) || String(p2.rivalId) === String(p1._id);
    const isTeammates = t1 && t2 && String(p1.teamId) === String(p2.teamId);
    const affinityBar = (() => {
      const norm = Math.max(-100, Math.min(100, affinity));
      const blocks = 10;
      const filled = Math.round(((norm + 100) / 200) * blocks);
      return '🔴'.repeat(Math.max(0, blocks - filled)) + '🟢'.repeat(Math.min(blocks, filled));
    })();
    const affinityLabel = affinity >= 50 ? 'Alliés proches'
      : affinity >= 20 ? 'Bonne entente'
      : affinity >= -10 ? 'Neutralité'
      : affinity >= -40 ? 'Tension'
      : 'Rivalité intense';

    // ── OVR helpers ───────────────────────────────────────────────────────
    const ovr  = p => overallRating(p);
    const bar  = (v1, v2, stat) => {
      const max = Math.max(v1, v2, 1);
      const b1 = Math.round((v1 / max) * 8);
      const b2 = Math.round((v2 / max) * 8);
      const bar1 = '█'.repeat(b1) + '░'.repeat(8 - b1);
      const bar2 = '█'.repeat(b2) + '░'.repeat(8 - b2);
      return `\`${bar1}\` **${v1}** ${stat} **${v2}** \`${bar2}\``;
    };
    const barStat = (v1, v2, label, higher = true) => {
      const winner = higher ? (v1 > v2 ? 1 : v2 > v1 ? 2 : 0) : (v1 < v2 ? 1 : v2 < v1 ? 2 : 0);
      const b1 = Math.round(Math.min(v1 / Math.max(v1, v2, 1), 1) * 10);
      const b2 = Math.round(Math.min(v2 / Math.max(v1, v2, 1), 1) * 10);
      const b1s = '█'.repeat(b1) + '░'.repeat(10 - b1);
      const b2s = '█'.repeat(b2) + '░'.repeat(10 - b2);
      const edge1 = winner === 1 ? ' ◀' : '';
      const edge2 = winner === 2 ? ' ◀' : '';
      return `${label}\n\`${b1s}\` **${v1}**${edge1} — **${v2}** \`${b2s}\`${edge2}`;
    };

    // ── Inter-saisons context ─────────────────────────────────────────────
    // BUG FIX : utilise le rang propre à chaque pilote (rank1 pour p1, rank2 pour p2)
    const interSeasonLine = (p, currentRank) => {
      if (!p.lastSeasonRank) return '_Première saison connue_';
      const ref = currentRank || 20;
      const trend = p.lastSeasonRank > ref
        ? `📈 P${p.lastSeasonRank} → progression cette saison`
        : p.lastSeasonRank < ref
          ? `📉 P${p.lastSeasonRank} → régression cette saison`
          : `➡️ P${p.lastSeasonRank} → stable`;
      return `S. précédente : P${p.lastSeasonRank} (${p.lastSeasonPts || 0} pts${p.lastSeasonWins ? ', ' + p.lastSeasonWins + ' V' : ''}) — ${trend}`;
    };

    // ── Embed principal ───────────────────────────────────────────────────
    const e1 = t1?.emoji || '';
    const e2 = t2?.emoji || '';
    const title = `⚔️ ${e1}${p1.name} vs ${e2}${p2.name}`;

    const embed = new EmbedBuilder()
      .setColor(isRivals ? '#E53935' : isTeammates ? '#7B61FF' : '#1565C0')
      .setTitle(title)
      .setDescription(
        (isRivals ? '🔥 **Rivalité déclarée** — les deux se connaissent bien sur la piste.\n'
          : isTeammates ? '🔵 **Coéquipiers** — même garage, ambitions différentes.\n'
          : '') +
        `**Relation :** ${affinityLabel} (${affinity > 0 ? '+' : ''}${affinity})\n${affinityBar}`
      );

    // Saison actuelle
    const h2hTotal = h2hWins1 + h2hWins2;
    embed.addFields({
      name: `📊 Saison ${season?.year || 'actuelle'}`,
      value:
        `**${p1.name}** — ${rank1 ? 'P' + rank1 : '—'} | ${s1.points} pts | ${s1.wins}V ${s1.podiums}P ${s1.dnfs}DNF\n` +
        `**${p2.name}** — ${rank2 ? 'P' + rank2 : '—'} | ${s2.points} pts | ${s2.wins}V ${s2.podiums}P ${s2.dnfs}DNF` +
        (h2hTotal > 0 ? `\n\n⚔️ **H2H cette saison :** ${p1.name} **${h2hWins1}** — **${h2hWins2}** ${p2.name} _(${h2hTotal} duel${h2hTotal > 1 ? 's' : ''})_` : ''),
    });

    // Forme récente
    embed.addFields({
      name: '📈 Forme récente (5 derniers GPs)',
      value: `${e1}**${p1.name}** : ${recentIcons1}\n${e2}**${p2.name}** : ${recentIcons2}`,
      inline: false,
    });

    // Stats OVR + pilotage
    // BUG FIX : utilise les vraies stats du PilotSchema (depassement, freinage, defense,
    //           adaptabilite, reactions, controle, gestionPneus) — pas vitesse/regularite/etc.
    const stats1 = [p1.depassement, p1.freinage, p1.defense, p1.adaptabilite, p1.reactions, p1.controle, p1.gestionPneus];
    const stats2 = [p2.depassement, p2.freinage, p2.defense, p2.adaptabilite, p2.reactions, p2.controle, p2.gestionPneus];
    const statLabels = ['Dépassement', 'Freinage', 'Défense', 'Adaptabilité', 'Réactions', 'Contrôle', 'Gestion Pneus'];
    const ovr1 = ovr(p1), ovr2 = ovr(p2);

    embed.addFields({
      name: `🏎️ Statistiques (OVR ${e1}**${ovr1}** vs ${e2}**${ovr2}**)`,
      value: statLabels.map((lbl, i) => barStat(stats1[i] || 0, stats2[i] || 0, lbl)).join('\n'),
      inline: false,
    });

    // Carrière
    const cW1 = (p1.careerWins || 0) + s1.wins, cW2 = (p2.careerWins || 0) + s2.wins;
    const cP1 = (p1.careerPodiums || 0) + s1.podiums, cP2 = (p2.careerPodiums || 0) + s2.podiums;
    const cD1 = (p1.careerDnfs || 0) + s1.dnfs, cD2 = (p2.careerDnfs || 0) + s2.dnfs;
    const careerRankLine = (p1.careerBestRank || p2.careerBestRank)
      ? `\n🏆 Meilleur rang carrière : **P${p1.careerBestRank || '—'}** vs **P${p2.careerBestRank || '—'}**`
      : '';
    embed.addFields({
      name: '🏆 Carrière',
      value: (
        barStat(cW1, cW2, '🥇 Victoires') + '\n' +
        barStat(cP1, cP2, '🥈 Podiums') + '\n' +
        barStat(cD1, cD2, '💥 DNFs', false) +
        careerRankLine
      ) || '—',
      inline: false,
    });

    // Inter-saisons
    // BUG FIX : passe le rang propre à chaque pilote (rank1 pour p1, rank2 pour p2)
    const is1 = interSeasonLine(p1, rank1);
    const is2 = interSeasonLine(p2, rank2);
    if (p1.lastSeasonRank || p2.lastSeasonRank) {
      embed.addFields({
        name: '📅 Contexte inter-saisons',
        value: `${e1}**${p1.name}** : ${is1}\n${e2}**${p2.name}** : ${is2}`,
        inline: false,
      });
    }

    embed.setFooter({ text: `⚔️ Head-to-Head · PL Racing · demandé par ${interaction.user.username}` });

    return interaction.editReply({ embeds: [embed] });
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
  const tireLabel     = c => TIRE[c] ? `${TIRE[c] ? `${TIRE[c].emoji} ${TIRE[c].code}` : '?'} ${TIRE[c].label}` : c;

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

  // ── Références par session (jamais la pole finale pour Q1/Q2) ──
  const q1Ref = q1State[0]?.time || 0;
  const q2Ref = q2State[0]?.time || 0;
  const q3Ref = q3State[0]?.time || 0;
  const poleman = q3State[0];

  // ── helper ligne : temps + gap par rapport AU LEADER DE CETTE SESSION ──
  const q1Line = (s, pos) => {
    const gap = pos === 1 ? '⏱ REF' : `+${((s.time - q1Ref) / 1000).toFixed(3)}s`;
    const imp = s.improved ? ' 📈' : '';
    return `\`P${String(pos).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} — ${gap}${imp}`;
  };
  const q2Line = (s, pos) => {
    const gap = pos === 1 ? '⏱ REF' : `+${((s.time - q2Ref) / 1000).toFixed(3)}s`;
    const imp = s.improved ? ' 📈' : '';
    // Indicateur de bond/régression vs Q1 (optionnel, très lisible)
    const delta = s.deltaVsQ1 !== undefined
      ? (s.deltaVsQ1 < -80 ? ' ⬆️' : s.deltaVsQ1 > 80 ? ' ⬇️' : '')
      : '';
    return `\`P${String(pos).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} — ${gap}${imp}${delta}`;
  };
  const q3Line = (s, pos) => {
    const gap = pos === 1 ? '⏱ REF' : `+${((s.time - q3Ref) / 1000).toFixed(3)}s`;
    const imp = s.improved ? ' 📈' : '';
    return `\`P${String(pos).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} — ${gap}${imp}`;
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
  // Q1 — classement propre à Q1
  // ══════════════════════════════════════════════════════════
  await channel.send(
    `🟡 **Q1 — EN PISTE !** · ${q1State.length} pilotes · Élimination à partir de P${q2Size + 1}\n` +
    `*Chaque pilote dispose de 2 tentatives — track evolution en cours...*`
  );
  await W(3000);

  // Flash mi-Q1 : premiers temps du run 1 (bruts, avant amélioration)
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
      await channel.send(`😰 *Q1 ultra-serré autour de la coupure — **${ev.gap.toFixed(3)}s** entre ${ev.safe.team.emoji}**${ev.safe.pilot.name}** (qualifié) et ${ev.elim.team.emoji}**${ev.elim.pilot.name}** (éliminé).*`);
      await W(1500);
    }
    if (ev.type === 'upset_q1') {
      await channel.send(`😱 *${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** ÉLIMINÉ en Q1 ! Grosse surprise — l'un des favoris rentre au garage.*`);
      await W(1500);
    }
  }

  // ── Résultats Q1 : classement de Q1 uniquement ──
  const q1Passants  = q1State.slice(0, q2Size);
  const q1Elims     = q1State.slice(q2Size);
  const q1TopLines  = q1Passants.map((s, i) => q1Line(s, i + 1)).join('\n');
  const q1ElimLines = q1Elims.map((s, i) => q1Line(s, q2Size + 1 + i)).join('\n');

  const q1Embed = new EmbedBuilder()
    .setTitle(`🔴 Q1 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF4444')
    .setDescription(
      `**Classement Q1 — top ${q2Size} :**\n` +
      q1TopLines +
      `\n\n🔴 **Éliminés (P${q2Size + 1}–${q1State.length}) :**\n` +
      q1ElimLines +
      `\n\n✅ **${q2Size} pilotes qualifiés pour Q2** · *Nouveaux runs, nouveau classement*`
    );
  await channel.send({ embeds: [q1Embed] });
  await W(4000);

  // ══════════════════════════════════════════════════════════
  // Q2 — session indépendante, classement peut être très différent
  // ══════════════════════════════════════════════════════════
  const bubbleQ2 = q2State.slice(q3Size - 2, Math.min(q3Size + 2, q2State.length))
    .map(s => `${s.team.emoji}**${s.pilot.name}**`).join(' · ');
  await channel.send(
    `🟡 **Q2 — EN PISTE !** · ${q2Size} pilotes · Élimination à partir de P${q3Size + 1}\n` +
    `*Session repart de zéro — le classement Q1 ne compte plus. Sur le fil : ${bubbleQ2}*`
  );
  await W(3000);

  if (qualiData.yellowFlagQ2) {
    const yp = qualiData.yellowFlagQ2;
    await channel.send(`🟡 **DRAPEAU JAUNE !** ${yp.team?.emoji || ''}**${yp.pilot?.name || '?'}** est sorti des limites — les tours en cours sont annulés !`);
    await W(2000);
  }

  // Flash mi-Q2 : run 1
  const flashQ2 = [...q2State].sort(() => Math.random() - 0.5).slice(0, 4);
  await channel.send(
    `📻 *Q2 — premier run :* ` +
    flashQ2.map(s => `${s.team.emoji}**${s.pilot.name}** ${s.r1 ? msToLapStr(s.r1) : '*tour annulé*'}`).join(' · ')
  );
  await W(2500);

  // Drama Q2
  for (const ev of drama.q2) {
    if (ev.type === 'thriller_q2') {
      await channel.send(`😰 *Seulement **${ev.gap.toFixed(3)}s** entre ${ev.safe.team.emoji}**${ev.safe.pilot.name}** (qualifié) et ${ev.elim.team.emoji}**${ev.elim.pilot.name}** (éliminé). C'est quasi-millimétré.*`);
      await W(1500);
    }
    if (ev.type === 'last_gasp_q2') {
      await channel.send(`⚡ *DERNIÈRE SECONDE !* ${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** améliore in-extremis et s'accroche au top ${q3Size} !`);
      await W(1500);
    }
    if (ev.type === 'yellow_victim') {
      await channel.send(`😤 ${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** éliminé à cause du drapeau jaune — son tour annulé. *Cruel.*`);
      await W(1500);
    }
    if (ev.type === 'regression_q2') {
      await channel.send(`😬 *${ev.pilot.team.emoji}**${ev.pilot.pilot.name}** régresse de **+${ev.delta}s** par rapport à sa Q1 — la pression ou un mauvais setup ?*`);
      await W(1500);
    }
  }

  // ── Résultats Q2 : classement propre à Q2 ──
  const q2Passants  = q2State.slice(0, q3Size);
  const q2Elims     = q2State.slice(q3Size);
  const q2ThrillStr = q2Passants.length && q2Elims.length
    ? `\n⚠️ **${q2Passants[q2Passants.length-1].team.emoji}${q2Passants[q2Passants.length-1].pilot.name}** passe de justesse — **${((q2Elims[0].time - q2Passants[q2Passants.length-1].time)/1000).toFixed(3)}s** d'avance sur **${q2Elims[0].team.emoji}${q2Elims[0].pilot.name}**.`
    : '';

  const q2Embed = new EmbedBuilder()
    .setTitle(`🔴 Q2 TERMINÉ — ${race.emoji} ${race.circuit}`)
    .setColor('#FF8800')
    .setDescription(
      `✅ **Top ${q3Size} qualifiés pour Q3 :**\n` +
      q2Passants.map((s, i) => q2Line(s, i + 1)).join('\n') +
      q2ThrillStr +
      `\n\n🔴 **Éliminés (P${q3Size + 1}–${q2Size}) :**\n` +
      q2Elims.map((s, i) => q2Line(s, q3Size + 1 + i)).join('\n') +
      `\n\n*⬆️ = meilleur qu'en Q1 · ⬇️ = moins bien qu'en Q1*`
    );
  await channel.send({ embeds: [q2Embed] });
  await W(4000);

  // ══════════════════════════════════════════════════════════
  // Q3 — SHOOT-OUT POLE
  // ══════════════════════════════════════════════════════════
  const q3Names = q3State.map(s => `${s.team.emoji}**${s.pilot.name}**`).join(' · ');
  await channel.send(
    `🔥 **Q3 — SHOOT-OUT POUR LA POLE POSITION !**\n` +
    `Les ${q3Size} meilleurs · **2 tentatives** — session repart de zéro, tout est possible !\n` +
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
    const victims      = drama.q3.find(e => e.type === 'red_victims');
    await channel.send(`🚩 **DRAPEAU ROUGE EN Q3 !** Session interrompue !${triggerDrama?.trigger ? ` Sortie de ${triggerDrama.trigger.team?.emoji || ''}**${triggerDrama.trigger.pilot?.name || '?'}**.` : ''}`);
    await W(2000);
    await channel.send(`🔁 *Relance de Q3 — il reste quelques minutes. Tout est encore jouable.*`);
    await W(2000);
    if (victims?.victims?.length) {
      const vNames = victims.victims.map(v => `${v.team.emoji}**${v.pilot.name}**`).join(', ');
      await channel.send(`😤 *Victimes : ${vNames} n'ont pas pu boucler leur tour.*`);
      await W(1500);
    }
  }

  // Révélation des temps Q3 (de bas en haut)
  await channel.send(`📻 *Q3 — deuxième run en cours... Les temps tombent !*`);
  await W(1500);

  const q3Sorted     = [...q3State].sort((a, b) => a.time - b.time);
  const revealCount  = Math.min(5, q3Sorted.length);
  for (let i = q3Sorted.length - 1; i >= q3Sorted.length - revealCount + 2; i--) {
    const s   = q3Sorted[i];
    const pos = i + 1;
    const gap = `+${((s.time - q3Ref) / 1000).toFixed(3)}s`;
    await channel.send(`📻 **P${pos}** ${s.team.emoji}**${s.pilot.name}** — ${msToLapStr(s.time)} — ${gap}${s.improved ? ' 📈' : ''}`);
    await W(1200);
  }
  if (q3Sorted.length >= 2) {
    const p2    = q3Sorted[1];
    const gapP2 = `+${((p2.time - q3Ref) / 1000).toFixed(3)}s`;
    await channel.send(`📻 **P2** ${p2.team.emoji}**${p2.pilot.name}** — ${msToLapStr(p2.time)} — ${gapP2}${p2.improved ? ' 📈' : ''}\n*Peut-il encore être battu ?*`);
    await W(2000);
  }

  // Drama Q3
  for (const ev of drama.q3) {
    if (ev.type === 'photo_finish_pole') {
      await channel.send(`⚡ *ÉCART INCROYABLE* — seulement **${ev.gap.toFixed(3)}s** entre ${ev.pole.team.emoji}**${ev.pole.pilot.name}** et ${ev.second.team.emoji}**${ev.second.pilot.name}** !`);
      await W(1500);
    }
    if (ev.type === 'dominant_pole') {
      await channel.send(`💪 *${ev.pole.team.emoji}**${ev.pole.pilot.name}** s'envole ! +${ev.gap.toFixed(3)}s d'avance — performance de haute volée.*`);
      await W(1500);
    }
  }

  // ── Résultats Q3 — classement propre à Q3 ─────────────────
  const q3FinalEmbed = new EmbedBuilder()
    .setTitle(`🏆 Q3 — GRILLE DE DÉPART OFFICIELLE — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(
      q3Sorted.map((s, i) => q3Line(s, i + 1)).join('\n') +
      `\n\nMétéo Q : **${weatherLabels[weather] || weather}**`
    );
  await channel.send({ embeds: [q3FinalEmbed] });
  await W(2000);

  // ── POLE POSITION ─────────────────────────────────────────
  const p2State  = q3Sorted[1];
  const gap2nd   = p2State ? ((p2State.time - poleman.time) / 1000).toFixed(3) : null;
  const poleMsgs = gap2nd && parseFloat(gap2nd) < 0.05
    ? [`***🏆 POLE POSITION !!! ${poleman.team.emoji}${poleman.pilot.name} EN ${msToLapStr(poleman.time)} !!!***\n*Seulement +${gap2nd}s de marge — photo finish historique avec ${p2State.team.emoji}${p2State.pilot.name} !*`]
    : gap2nd && parseFloat(gap2nd) > 0.5
    ? [`🏆 **POLE POSITION** pour ${poleman.team.emoji} **${poleman.pilot.name}** — ${msToLapStr(poleman.time)}\n*+${gap2nd}s d'avance sur ${p2State.team.emoji}**${p2State.pilot.name}** — dominateur ce week-end.*`]
    : [`🏆 **POLE POSITION** pour ${poleman.team.emoji} **${poleman.pilot.name}** — ${msToLapStr(poleman.time)}` + (gap2nd ? ` · +${gap2nd}s sur ${p2State.team.emoji}**${p2State.pilot.name}**` : '')];
  await channel.send(pick(poleMsgs));
  await W(2000);

  // ── Grille complète : Q3 + Q2 éliminés + Q1 éliminés ─────
  // Chaque groupe affiche le temps de SA session (pas un temps comparatif inter-sessions)
  const fullGridLines = [
    ...q3Sorted.map((s, i) => `\`P${String(i+1).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} *(Q3)*`),
    ...q2Eliminated.map((s, i) => `\`P${String(q3Size+1+i).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} *(Q2)*`),
    ...q1Eliminated.map((s, i) => `\`P${String(q2Size+1+i).padStart(2,' ')}\` ${s.team.emoji} **${s.pilot.name}** — ${msToLapStr(s.time)} *(Q1)*`),
  ].join('\n');
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

  // ── Mise à jour des budgets selon le classement constructeurs ──
  // Champion constructeur : +30 budget (attire les talents, rassure les sponsors)
  // 2ème-3ème : +15
  // Milieu de grille : ±0
  // Derniers (bottom 2) : -15 (sponsors partent, budget serré)
  // Plafond : 180 | Plancher : 60
  try {
    const allTeamsForBudget = await Team.find();
    const budgetConstr = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
    const total = budgetConstr.length;
    for (let i = 0; i < budgetConstr.length; i++) {
      const teamDoc = allTeamsForBudget.find(t => String(t._id) === String(budgetConstr[i].teamId));
      if (!teamDoc) continue;
      let delta = 0;
      if (i === 0)                delta = +30;   // champion constructeur
      else if (i <= 2)            delta = +15;   // podium constructeur
      else if (i >= total - 2)    delta = -15;   // lanterne rouge / avant-dernier
      const newBudget = Math.max(60, Math.min(180, teamDoc.budget + delta));
      if (newBudget !== teamDoc.budget) {
        await Team.findByIdAndUpdate(teamDoc._id, { budget: newBudget });
        console.log(`[Budget] ${teamDoc.emoji} ${teamDoc.name} : ${teamDoc.budget} → ${newBudget} (rang ${i+1})`);
      }
    }
  } catch(e) { console.error('Budget update error:', e.message); }
}

async function runRace(override, gpIndex = null) {
  const season = await getActiveSeason();
  if (!season) { console.log('[runRace] ❌ Aucune saison active — abandon.'); return; }
  const slot   = (gpIndex !== null || override) ? null : getCurrentSlot();
  const race   = gpIndex !== null
    ? await Race.findOne({ seasonId: season._id, index: gpIndex })
    : await getCurrentRace(season, slot);
  if (!race) { console.log('[runRace] ❌ Aucune course trouvée pour ce slot/index — abandon.'); return; }
  if (race.status === 'done' || race.status === 'race_computed') {
    console.log(`[runRace] ❌ Course ${race.circuit} déjà terminée (status=${race.status}) — abandon.`);
    return;
  }
  if (race.status !== 'quali_done' && !override) {
    console.log(`[runRace] ❌ Course ${race.circuit} pas encore qualifiée (status=${race.status}) — abandon.`);
    return;
  }
  if (!await isRaceDay(race, override)) {
    console.log(`[runRace] ❌ Pas le bon jour pour ${race.circuit} (scheduledDate=${race.scheduledDate}) — abandon.`);
    return;
  }
  console.log(`[runRace] ✅ Lancement course ${race.circuit} (status=${race.status}, slot=${race.slot ?? 'N/A'})`);

  const { pilots, teams } = await getAllPilotsWithTeams();
  const contracts = await Contract.find({ active: true });
  if (!pilots.length) { console.log('[runRace] ❌ Aucun pilote trouvé — abandon.'); return; }

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

  // ── Snapshot avant la course pour les classements delta ──
  const standingsBefore = await Standing.find({ seasonId: season._id }).lean();
  const constrBefore    = await ConstructorStanding.find({ seasonId: season._id }).lean();
  const standBeforeMap  = new Map(standingsBefore.map((s,i) => [String(s.pilotId), i + 1]));
  const constrBeforeMap = new Map(constrBefore.map((s,i) => [String(s.teamId), i + 1]));
  standingsBefore.sort((a,b) => b.points - a.points).forEach((s,i) => standBeforeMap.set(String(s.pilotId), i+1));
  constrBefore.sort((a,b) => b.points - a.points).forEach((s,i) => constrBeforeMap.set(String(s.teamId), i+1));

  // ── Grille de départ animée — publiée avant le départ ────
  if (channel) {
    const W = ms => new Promise(r => setTimeout(r, ms));
    const allStandingsSnap = standingsBefore.slice().sort((a,b) => b.points - a.points);
    const champMap   = new Map(allStandingsSnap.map((s, i) => [String(s.pilotId), { pts: s.points, rank: i + 1 }]));

    // Lignes de grille, 2 colonnes
    const gridLines = grid.map((g, i) => {
      const p = pilots.find(x => String(x._id) === String(g.pilotId));
      const t = p ? teams.find(x => String(x._id) === String(p.teamId)) : null;
      const champInfo = p ? champMap.get(String(p._id)) : null;
      const rankTag = champInfo ? ` *(C${champInfo.rank})*` : '';
      return `\`P${String(i+1).padStart(2,' ')}\` ${t?.emoji || ''}**${p?.name || '?'}**${rankTag}`;
    });
    const half = Math.ceil(gridLines.length / 2);

    // Duels à surveiller
    const watchDuels = [];
    // Rivaux proches sur la grille
    for (let i = 0; i < grid.length; i++) {
      const pA = pilots.find(p => String(p._id) === String(grid[i].pilotId));
      if (!pA?.rivalId) continue;
      const jB = grid.findIndex(g2 => String(g2.pilotId) === String(pA.rivalId));
      if (jB >= 0 && Math.abs(i - jB) <= 5) {
        const pB = pilots.find(p => String(p._id) === String(pA.rivalId));
        const tA = teams.find(t => String(t._id) === String(pA.teamId));
        const tB = pB ? teams.find(t => String(t._id) === String(pB.teamId)) : null;
        watchDuels.push(`⚔️ **Rivalité** : ${tA?.emoji||''}${pA.name} *(P${i+1})* vs ${tB?.emoji||''}${pB?.name||'?'} *(P${jB+1})*`);
        break;
      }
    }
    // Coéquipiers adjacents
    for (let i = 0; i < grid.length - 1; i++) {
      const pA = pilots.find(p => String(p._id) === String(grid[i].pilotId));
      const pB = pilots.find(p => String(p._id) === String(grid[i+1].pilotId));
      if (pA && pB && String(pA.teamId) === String(pB.teamId)) {
        const t = teams.find(t => String(t._id) === String(pA.teamId));
        watchDuels.push(`👥 **Duel interne** : ${t?.emoji||''}${pA.name} *(P${i+1})* vs ${pB.name} *(P${i+2})*`);
        break;
      }
    }
    // Leaders du champ proches sur la grille
    if (allStandingsSnap.length >= 2) {
      const c1 = allStandingsSnap[0], c2 = allStandingsSnap[1];
      const g1i = grid.findIndex(g => String(g.pilotId) === String(c1.pilotId));
      const g2i = grid.findIndex(g => String(g.pilotId) === String(c2.pilotId));
      if (g1i >= 0 && g2i >= 0 && Math.abs(g1i - g2i) <= 7) {
        const p1 = pilots.find(p => String(p._id) === String(c1.pilotId));
        const p2 = pilots.find(p => String(p._id) === String(c2.pilotId));
        const t1 = p1 ? teams.find(t => String(t._id) === String(p1.teamId)) : null;
        const t2 = p2 ? teams.find(t => String(t._id) === String(p2.teamId)) : null;
        watchDuels.push(`🏆 **Titre** : ${t1?.emoji||''}${p1?.name||'?'} *(P${g1i+1}, ${c1.points}pts)* vs ${t2?.emoji||''}${p2?.name||'?'} *(P${g2i+1}, ${c2.points}pts)*`);
      }
    }

    const duelsStr = watchDuels.length ? `\n\n**🔭 À surveiller :**\n${watchDuels.join('\n')}` : '';
    const styleEmojis = { urbain:'🏙️', rapide:'💨', technique:'⚙️', mixte:'🔀', endurance:'🔋' };
    const totalRaces  = await Race.countDocuments({ seasonId: season._id });
    const gpNum       = (race.index ?? 0) + 1;

    // La grille détaillée est publiée dans simulateRace — on envoie ici uniquement les enjeux
    if (duelsStr) {
      const preRaceEmbed = new EmbedBuilder()
        .setTitle(`🏎️ ${race.emoji} ${race.circuit} · GP ${gpNum}/${totalRaces} — Enjeux`)
        .setColor('#FF1801')
        .setDescription(`${styleEmojis[race.gpStyle]||''} **${race.gpStyle.toUpperCase()}**${duelsStr}`)
        .setFooter({ text: `Les feux s'éteignent dans quelques instants... ${race.emoji}` });
      await channel.send({ embeds: [preRaceEmbed] });
    }
    await W(4000);
    await channel.send(pick([
      `🚦 **FEU ROUGE...** Tout le monde est en position. Le silence avant la tempête.`,
      `🚦 *Les mécaniciens quittent la grille... La tension est à son comble.*`,
      `🚦 *5 feux... 4... 3... 2... 1...*`,
    ]));
    await W(3000);
  }

  const { results, collisions, penalties } = await simulateRace(race, grid, pilots, teams, contracts, channel, season);
  await applyRaceResults(results, race._id, season, collisions, channel);

  // ── Annonce rivalités nouvellement déclarées ─────────────
  // On n'annonce que si la rivalité vient d'être créée CE GP (rivalDeclaredAt === race.index)
  if (channel && collisions.length) {
    const updatedPilots = await Pilot.find({ _id: { $in: pilots.map(p => p._id) } });
    const announcedPairs = new Set();
    for (const p of updatedPilots) {
      if (!p.rivalId || p.rivalDeclaredAt !== race.index) continue;
      const rival = updatedPilots.find(r => String(r._id) === String(p.rivalId));
      if (!rival) continue;
      const pairKey = [String(p._id), String(rival._id)].sort().join('_');
      if (announcedPairs.has(pairKey)) continue;
      announcedPairs.add(pairKey);

      const ptTeam = teams.find(t => String(t._id) === String(p.teamId));
      const rvTeam = teams.find(t => String(t._id) === String(rival.teamId));
      const isSameTeam = String(p.teamId) === String(rival.teamId);
      await channel.send(pick([
        `⚔️ **RIVALITÉ DÉCLARÉE — GP ${race.index + 1}**\n${ptTeam?.emoji || ''}**${p.name}** vs ${rvTeam?.emoji || ''}**${rival.name}** — 2 contacts cette saison${isSameTeam ? ' *entre coéquipiers*' : ''}. *Ces deux-là ne s'aiment pas...*\n*Leurs prochains face-à-face seront narrés différemment.*`,
        `⚔️ **RIVALITÉ EN FORMATION !**\n${ptTeam?.emoji || ''}**${p.name}** et ${rvTeam?.emoji || ''}**${rival.name}** : 2 incidents ensemble. *Le paddock a pris note.*\nCette rivalité sera suivie tout au long de la saison.`,
      ]));
    }

    // Escalade : si contacts atteignent 5 CE GP (exactement), c'est une intensification
    for (const p of updatedPilots) {
      if (!p.rivalId || (p.rivalContacts || 0) !== 5) continue;
      const rival = updatedPilots.find(r => String(r._id) === String(p.rivalId));
      if (!rival) continue;
      const pairKey = [String(p._id), String(rival._id)].sort().join('_') + '_esc';
      if (announcedPairs.has(pairKey)) continue;
      announcedPairs.add(pairKey);
      const ptTeam = teams.find(t => String(t._id) === String(p.teamId));
      const rvTeam = teams.find(t => String(t._id) === String(rival.teamId));
      await channel.send(
        `🔥 **RIVALITÉ QUI S'EMBRASE !**\n${ptTeam?.emoji || ''}**${p.name}** / ${rvTeam?.emoji || ''}**${rival.name}** — **5 contacts** au compteur cette saison. *Le paddock commence vraiment à s'inquiéter.*`
      );
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
    desc += `${medals[r.pos-1]||`\`P${r.pos}\``} ${team?.emoji||''} **${pilot?.name||'?'}**`;
    if (r.dnf) desc += ` ❌ DNF`;
    else       desc += ` — ${pts} pts · +${r.coins} 🪙`;
    if (r.fastestLap) desc += ' ⚡';
    if (r.penaltySec) desc += ` *(+${r.penaltySec}s pén.)*`;
    desc += '\n';
  }
  // Récap des pénalités si il y en a
  if (penalties && penalties.length > 0) {
    const penMap = new Map();
    for (const p of penalties) {
      penMap.set(p.pilotId, (penMap.get(p.pilotId) || 0) + p.seconds);
    }
    const penLines = [...penMap.entries()].map(([id, sec]) => {
      const pilot = pilots.find(p => String(p._id) === id);
      const team  = teams.find(t => String(t._id) === String(pilot?.teamId));
      return `${team?.emoji||''}**${pilot?.name||'?'}** +${sec}s`;
    });
    if (penLines.length) desc += `\n⚠️ *Pénalités : ${penLines.join(' · ')}*`;
  }
  embed.setDescription(desc);
  if (channel) await channel.send({ embeds: [embed] });

  // Classement constructeurs avec changements
  if (channel) {
    const constrStandings = await ConstructorStanding.find({ seasonId: season._id }).sort({ points: -1 });
    const constrTeams     = await Team.find();
    const constrTeamMap   = new Map(constrTeams.map(t => [String(t._id), t]));
    let constrDesc = '';
    for (let i = 0; i < constrStandings.length; i++) {
      const s   = constrStandings[i];
      const t   = constrTeamMap.get(String(s.teamId));
      const oldPos = constrBeforeMap.get(String(s.teamId));
      const delta  = oldPos !== undefined ? oldPos - (i + 1) : 0;
      const arrow  = delta > 0 ? `⬆️+${delta}` : delta < 0 ? `⬇️${delta}` : `▶️`;
      constrDesc += `**${i+1}.** ${t?.emoji||''} **${t?.name||'?'}** — ${s.points} pts ${arrow}\n`;
    }
    const constrEmbed = new EmbedBuilder()
      .setTitle('🏗️ Classement Constructeurs — Après cette course')
      .setColor('#0099FF')
      .setDescription(constrDesc || 'Aucune donnée');
    await channel.send({ embeds: [constrEmbed] });

    // Classement pilotes avec changements
    const pilotStandings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).limit(20);
    const pilotIds2      = pilotStandings.map(s => s.pilotId);
    const allPilots2     = await Pilot.find({ _id: { $in: pilotIds2 } });
    const allTeams2b     = await Team.find();
    const pilotMap2      = new Map(allPilots2.map(p => [String(p._id), p]));
    const teamMap2b      = new Map(allTeams2b.map(t => [String(t._id), t]));
    const medals2        = ['🥇','🥈','🥉'];
    let pilotDesc = '';
    for (let i = 0; i < pilotStandings.length; i++) {
      const s      = pilotStandings[i];
      const p      = pilotMap2.get(String(s.pilotId));
      const t      = p?.teamId ? teamMap2b.get(String(p.teamId)) : null;
      const oldPos = standBeforeMap.get(String(s.pilotId));
      const delta  = oldPos !== undefined ? oldPos - (i + 1) : 0;
      const arrow  = delta > 0 ? `⬆️+${delta}` : delta < 0 ? `⬇️${delta}` : `▶️`;
      const pts    = s.points;
      const gap    = i > 0 ? ` (−${pilotStandings[0].points - pts}pts)` : '';
      pilotDesc += `${medals2[i] || `**${i+1}.**`} ${t?.emoji||''} **${p?.name||'?'}** — ${pts} pts ${arrow}${gap}\n`;
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
    // Stocker le timestamp de début de transfert pour survie aux redémarrages
    await Season.findByIdAndUpdate(season._id, { transferStartedAt: new Date() });

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
            value: (marketDesc.length > 1024 ? marketDesc.slice(0, 1000) + `\n*...+ ${(marketDesc.match(/\n/g)||[]).length - (marketDesc.slice(0,1000).match(/\n/g)||[]).length} pilote(s) non affichés*` : marketDesc) || '*Aucun pilote libre*',
          })
          .setFooter({ text: 'Les offres sont générées automatiquement par le bot selon le budget et les besoins de chaque écurie.' });

        await ch.send({ embeds: [transferEmbed] });

        // ── DEUXIÈME VAGUE — 3 jours après la 1ère vague ──────────
        // Pour les pilotes qui ont tout refusé ou ignoré leurs offres
        setTimeout(async () => {
          try {
            const ch2 = await client.channels.fetch(RACE_CHANNEL);
            const waveCount = await startSecondTransferWave(ch2);
            if (!waveCount) {
              // Tous les pilotes libres ont un siège — pas de 2ème vague nécessaire
              await ch2.send('✅ **Mercato clôturé** — Tous les pilotes libres ont trouvé une écurie. La grille est complète !');
            }
          } catch(e) { console.error('Second transfer wave error:', e.message); }
        }, 3 * 24 * 60 * 60 * 1000); // 3 jours après la 1ère vague
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

// ── Cron de maintenance mercato (toutes les heures) ─────────────
// Expire les offres périmées · relance les vagues si le bot a redémarré pendant le mercato
async function transferMaintenanceTick() {
  // 1. Expirer les offres dont expiresAt est dépassé
  const now = new Date();
  const expiredResult = await TransferOffer.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { status: 'expired' }
  );
  if (expiredResult.modifiedCount > 0) {
    console.log(`[Mercato] ${expiredResult.modifiedCount} offre(s) expirée(s) automatiquement.`);
  }

  // 2. Vérifier si une saison est en mode transfer et si les vagues doivent être (re)lancées
  const season = await Season.findOne({ status: 'transfer' });
  if (!season || !season.transferStartedAt) return;

  const msSinceStart = now - season.transferStartedAt;
  const ONE_DAY  = 24 * 60 * 60 * 1000;
  const THREE_DAYS = 3 * ONE_DAY;

  // La 1ère vague devait être annoncée 24h après transferStartedAt
  // Si le bot a redémarré et qu'elle n'a pas eu lieu (aucune offre pending), on la refait
  if (msSinceStart >= ONE_DAY) {
    const pendingCount = await TransferOffer.countDocuments({ status: 'pending' });
    const freePilots   = await Pilot.find({ teamId: null });
    if (freePilots.length > 0 && pendingCount === 0 && !season.secondWaveSentAt) {
      console.log('[Mercato] Relance automatique de la 1ère vague (bot redémarré ?)');
      try {
        const expiredCount = await startTransferPeriod();
        await Season.findByIdAndUpdate(season._id, { transferStartedAt: new Date() });
        const ch = await client.channels.fetch(RACE_CHANNEL);
        if (ch) await ch.send(`🔄 **MERCATO** — ${expiredCount} contrat(s) expiré(s). Offres générées. Utilisez \`/offres\` pour voir vos propositions.`);
      } catch(e) { console.error('[Mercato] Erreur relance 1ère vague:', e.message); }
    }
  }

  // 2ème vague : 3 jours après le début du mercato si pas encore lancée
  if (msSinceStart >= THREE_DAYS && !season.secondWaveSentAt) {
    console.log('[Mercato] Lancement automatique de la 2ème vague (cron)');
    try {
      const ch = await client.channels.fetch(RACE_CHANNEL);
      const waveCount = await startSecondTransferWave(ch);
      await Season.findByIdAndUpdate(season._id, { secondWaveSentAt: new Date() });
      if (!waveCount && ch) {
        await ch.send('✅ **Mercato** — Tous les pilotes libres ont des offres. Pas de 2ème vague nécessaire.');
      }
    } catch(e) { console.error('[Mercato] Erreur 2ème vague cron:', e.message); }
  }

  // Vérifier si la grille est complète (tous les pilotes sous contrat) et révéler si pas encore fait
  if (!season.gridRevealedAt) {
    const freePilotsNow = await Pilot.find({ teamId: null });
    if (freePilotsNow.length === 0) {
      try {
        const ch = await client.channels.fetch(RACE_CHANNEL);
        if (ch) await revealFinalGrid(season, ch);
        await Season.findByIdAndUpdate(season._id, { gridRevealedAt: new Date() });
      } catch(e) { console.error('[Mercato] Erreur reveal grille:', e.message); }
    }
  }
}

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
  // ── Maintenance mercato toutes les heures ──────────────────
  cron.schedule('0 * * * *', () => transferMaintenanceTick().catch(console.error), { timezone: 'Europe/Paris' });
  console.log('✅ Maintenance mercato : vérification toutes les heures');
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
  INTRO_VIDEO_URL=https://...            ← (optionnel) URL directe vers ton MP4 d'intro GP

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
