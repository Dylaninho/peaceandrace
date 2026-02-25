// ============================================================
//  🏎️  F1 DISCORD BOT  —  index.js
//  Stack : discord.js v14, mongoose, node-cron
//  npm install discord.js mongoose node-cron dotenv
// ============================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
        ButtonBuilder, ButtonStyle, SlashCommandBuilder,
        REST, Routes, Collection } = require('discord.js');
const mongoose = require('mongoose');
const cron     = require('node-cron');

// ─── ENV (.env) ──────────────────────────────────────────────
// DISCORD_TOKEN=...
// CLIENT_ID=...
// GUILD_ID=...
// MONGODB_URI=mongodb://localhost:27017/f1bot
// RACE_CHANNEL_ID=...   ← salon où le live-commentary est posté
// ADMIN_ROLE_ID=...     ← rôle admin (optionnel)
// ─────────────────────────────────────────────────────────────

const TOKEN          = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const GUILD_ID       = process.env.GUILD_ID;
const MONGO_URI      = process.env.MONGODB_URI || 'mongodb://localhost:27017/f1bot';
const RACE_CHANNEL   = process.env.RACE_CHANNEL_ID;

// ============================================================
// ██████╗  █████╗ ████████╗ █████╗ ██████╗  █████╗ ███████╗███████╗
// ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝
// ██║  ██║███████║   ██║   ███████║██████╔╝███████║███████╗█████╗
// ██║  ██║██╔══██║   ██║   ██╔══██║██╔══██╗██╔══██║╚════██║██╔══╝
// ██████╔╝██║  ██║   ██║   ██║  ██║██████╔╝██║  ██║███████║███████╗
// ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝
// ============================================================

// ── Pilot ──────────────────────────────────────────────────
const PilotSchema = new mongoose.Schema({
  discordId   : { type: String, required: true, unique: true },
  name        : { type: String, required: true },
  // Stats (0-100)
  speed       : { type: Number, default: 50 },
  consistency : { type: Number, default: 50 },
  tireManage  : { type: Number, default: 50 },
  wetSkill    : { type: Number, default: 50 },
  overtaking  : { type: Number, default: 50 },
  defending   : { type: Number, default: 50 },
  // Economy
  plcoins     : { type: Number, default: 500 },
  totalEarned : { type: Number, default: 0 },
  // State
  teamId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  createdAt   : { type: Date, default: Date.now },
});
const Pilot = mongoose.model('Pilot', PilotSchema);

// ── Team ───────────────────────────────────────────────────
const TeamSchema = new mongoose.Schema({
  name        : String,
  emoji       : String,
  color       : String,   // hex
  budget      : { type: Number, default: 100 }, // budget relatif 0-200
  carSpeed    : { type: Number, default: 80 },
  carReliab   : { type: Number, default: 80 },
  carAero     : { type: Number, default: 80 },
});
const Team = mongoose.model('Team', TeamSchema);

// ── Contract ───────────────────────────────────────────────
const ContractSchema = new mongoose.Schema({
  pilotId         : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  teamId          : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  seasonsDuration : { type: Number, default: 1 },
  seasonsRemaining: { type: Number, default: 1 },
  coinMultiplier  : { type: Number, default: 1.0 },
  active          : { type: Boolean, default: true },
  signedAt        : { type: Date, default: Date.now },
});
const Contract = mongoose.model('Contract', ContractSchema);

// ── TransferOffer ──────────────────────────────────────────
const TransferOfferSchema = new mongoose.Schema({
  teamId      : { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  pilotId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  multiplier  : { type: Number, default: 1.0 },
  seasons     : { type: Number, default: 1 },
  status      : { type: String, enum: ['pending','accepted','rejected','expired'], default: 'pending' },
  expiresAt   : Date,
});
const TransferOffer = mongoose.model('TransferOffer', TransferOfferSchema);

// ── Season ─────────────────────────────────────────────────
const SeasonSchema = new mongoose.Schema({
  year            : Number,
  status          : { type: String, enum: ['upcoming','active','transfer','finished'], default: 'upcoming' },
  regulationSet   : { type: Number, default: 1 },
  currentRaceIndex: { type: Number, default: 0 },
});
const Season = mongoose.model('Season', SeasonSchema);

// ── Race ───────────────────────────────────────────────────
const RaceSchema = new mongoose.Schema({
  seasonId    : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  index       : Number,
  circuit     : String,
  country     : String,
  emoji       : String,
  laps        : { type: Number, default: 50 },
  scheduledDate: Date,   // jour calendrier (sans heure)
  status      : { type: String, enum: ['upcoming','practice_done','quali_done','done'], default: 'upcoming' },
  // stored results
  qualiGrid   : { type: Array, default: [] },  // [{pilotId, time}]
  raceResults : { type: Array, default: [] },  // [{pilotId, pos, dnf, coins}]
});
const Race = mongoose.model('Race', RaceSchema);

// ── Championship ───────────────────────────────────────────
const StandingSchema = new mongoose.Schema({
  seasonId  : { type: mongoose.Schema.Types.ObjectId, ref: 'Season' },
  pilotId   : { type: mongoose.Schema.Types.ObjectId, ref: 'Pilot' },
  points    : { type: Number, default: 0 },
  wins      : { type: Number, default: 0 },
  podiums   : { type: Number, default: 0 },
  dnfs      : { type: Number, default: 0 },
});
const Standing = mongoose.model('Standing', StandingSchema);

// ============================================================
// ████████╗███████╗ █████╗ ███╗   ███╗███████╗
// ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔════╝
//    ██║   █████╗  ███████║██╔████╔██║███████╗
//    ██║   ██╔══╝  ██╔══██║██║╚██╔╝██║╚════██║
//    ██║   ███████╗██║  ██║██║ ╚═╝ ██║███████║
//    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
// ============================================================

// 10 écuries avec budgets variés (budget = force voiture globale 40-160)
const DEFAULT_TEAMS = [
  { name: 'Red Horizon',   emoji: '🔵', color: '#1E3A5F', budget: 160, carSpeed: 95, carReliab: 90, carAero: 95 },
  { name: 'Scuderia Alfa', emoji: '🔴', color: '#DC143C', budget: 150, carSpeed: 92, carReliab: 85, carAero: 90 },
  { name: 'Silver Arrow',  emoji: '⚪', color: '#C0C0C0', budget: 145, carSpeed: 90, carReliab: 88, carAero: 88 },
  { name: 'McLaren PL',    emoji: '🟠', color: '#FF7722', budget: 130, carSpeed: 85, carReliab: 84, carAero: 85 },
  { name: 'Aston Speed',   emoji: '🟢', color: '#006400', budget: 120, carSpeed: 80, carReliab: 82, carAero: 80 },
  { name: 'Alpine Bleu',   emoji: '💙', color: '#0066CC', budget: 110, carSpeed: 75, carReliab: 78, carAero: 76 },
  { name: 'Williams PL',   emoji: '🔷', color: '#00B4D8', budget: 90,  carSpeed: 70, carReliab: 75, carAero: 70 },
  { name: 'Haas PL',       emoji: '⬜', color: '#AAAAAA', budget: 75,  carSpeed: 65, carReliab: 72, carAero: 65 },
  { name: 'Sauber PL',     emoji: '🟤', color: '#8B4513', budget: 60,  carSpeed: 60, carReliab: 70, carAero: 60 },
  { name: 'RB Junior',     emoji: '🟡', color: '#FFD700', budget: 50,  carSpeed: 55, carReliab: 68, carAero: 55 },
];

// Calendrier type (~24 courses en ~30 jours)
const CIRCUITS = [
  { circuit:'Bahrain GP',        country:'Bahreïn',      emoji:'🇧🇭', laps:57 },
  { circuit:'Saudi Arabian GP',  country:'Arabie Saoudite',emoji:'🇸🇦',laps:50 },
  { circuit:'Australian GP',     country:'Australie',    emoji:'🇦🇺', laps:58 },
  { circuit:'Japanese GP',       country:'Japon',        emoji:'🇯🇵', laps:53 },
  { circuit:'Chinese GP',        country:'Chine',        emoji:'🇨🇳', laps:56 },
  { circuit:'Miami GP',          country:'États-Unis',   emoji:'🇺🇸', laps:57 },
  { circuit:'Emilia Romagna GP', country:'Italie',       emoji:'🇮🇹', laps:63 },
  { circuit:'Monaco GP',         country:'Monaco',       emoji:'🇲🇨', laps:78 },
  { circuit:'Canadian GP',       country:'Canada',       emoji:'🇨🇦', laps:70 },
  { circuit:'Spanish GP',        country:'Espagne',      emoji:'🇪🇸', laps:66 },
  { circuit:'Austrian GP',       country:'Autriche',     emoji:'🇦🇹', laps:71 },
  { circuit:'British GP',        country:'Royaume-Uni',  emoji:'🇬🇧', laps:52 },
  { circuit:'Hungarian GP',      country:'Hongrie',      emoji:'🇭🇺', laps:70 },
  { circuit:'Belgian GP',        country:'Belgique',     emoji:'🇧🇪', laps:44 },
  { circuit:'Dutch GP',          country:'Pays-Bas',     emoji:'🇳🇱', laps:72 },
  { circuit:'Italian GP',        country:'Italie',       emoji:'🇮🇹', laps:53 },
  { circuit:'Azerbaijan GP',     country:'Azerbaïdjan',  emoji:'🇦🇿', laps:51 },
  { circuit:'Singapore GP',      country:'Singapour',    emoji:'🇸🇬', laps:62 },
  { circuit:'COTA GP',           country:'États-Unis',   emoji:'🇺🇸', laps:56 },
  { circuit:'Mexican GP',        country:'Mexique',      emoji:'🇲🇽', laps:71 },
  { circuit:'Brazilian GP',      country:'Brésil',       emoji:'🇧🇷', laps:71 },
  { circuit:'Vegas GP',          country:'États-Unis',   emoji:'🇺🇸', laps:50 },
  { circuit:'Qatar GP',          country:'Qatar',        emoji:'🇶🇦', laps:57 },
  { circuit:'Abu Dhabi GP',      country:'Abu Dhabi',    emoji:'🇦🇪', laps:58 },
];

// Points F1 standard
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

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Calcule le temps au tour en ms
function calcLapTime(pilot, team, tireCompound, tireWear, weather, trackEvo, lapsInRace) {
  const BASE = 90_000; // 1:30 base

  // Facteur voiture (±15%)
  const carF = 1 - ((team.carSpeed - 70) / 70 * 0.15);

  // Facteur pilote vitesse (±12%)
  const pilotF = 1 - ((pilot.speed - 50) / 50 * 0.12);

  // Dégradation pneus
  const tireData = TIRE[tireCompound];
  const wearPenalty = tireWear * tireData.deg;
  const tireGrip = tireData.grip;
  const tireF = (1 + wearPenalty) / tireGrip;

  // Évolution de la piste (améliore de 1.5% sur toute la course)
  const trackF = 1 - (trackEvo / 100 * 0.015);

  // Consistance pilote (variation aléatoire)
  const consiRange = (100 - pilot.consistency) / 100 * 0.8 / 100;
  const randF = 1 + (Math.random() - 0.5) * consiRange;

  // Météo
  let weatherF = 1.0;
  if (weather === 'WET') {
    weatherF = 1.18 - (pilot.wetSkill / 100 * 0.12);
  } else if (weather === 'INTER') {
    weatherF = 1.08 - (pilot.wetSkill / 100 * 0.06);
  }

  return Math.round(BASE * carF * pilotF * tireF * trackF * randF * weatherF);
}

// Calcule temps Q (plus propre, moins de dégradation)
function calcQualiTime(pilot, team, weather) {
  const BASE = 88_000;
  const carF    = 1 - ((team.carSpeed - 70) / 70 * 0.15);
  const pilotF  = 1 - ((pilot.speed - 50) / 50 * 0.14);
  const randF   = 1 + (Math.random() - 0.5) * 0.004;
  const wetF    = weather === 'WET' ? 1.14 - (pilot.wetSkill / 100 * 0.1) : 1.0;
  return Math.round(BASE * carF * pilotF * randF * wetF);
}

function msToLapStr(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

// Choisit la stratégie de départ (compound initial)
function chooseStartCompound(pilot, circuit, weather) {
  if (weather === 'WET') return 'WET';
  if (weather === 'INTER') return 'INTER';
  if (circuit.laps < 55) return Math.random() > 0.5 ? 'MEDIUM' : 'SOFT';
  return Math.random() > 0.6 ? 'HARD' : 'MEDIUM';
}

// Évalue si un pilote veut pitter (undercut ou pneus usés)
function shouldPit(driver, lapsRemaining, gap_ahead_ms, totalLaps) {
  const { tireWear, tireCompound } = driver;
  const tireData = TIRE[tireCompound];

  // Pneus trop usés
  if (tireWear > 35) return { pit: true, reason: 'tires_worn' };
  if (tireWear > 25 && tireCompound === 'SOFT') return { pit: true, reason: 'tires_worn' };

  // Undercut : si proche de la voiture devant et pneus > 18 tours
  if (gap_ahead_ms !== null && gap_ahead_ms < 1800 && tireWear > 18 && lapsRemaining > 15) {
    const agression = (driver.pilot.overtaking / 100) * Math.random();
    if (agression > 0.52) return { pit: true, reason: 'undercut' };
  }

  // Overcut : attendre pour ressortir devant
  if (gap_ahead_ms !== null && gap_ahead_ms > 2000 && gap_ahead_ms < 4000 && tireWear > 22) {
    const patience = (driver.pilot.tireManage / 100) * Math.random();
    if (patience > 0.6) return { pit: false, reason: null }; // conscient, attend
  }

  return { pit: false, reason: null };
}

// Choisit le compound après le pit
function choosePitCompound(currentCompound, lapsRemaining, usedCompounds) {
  if (!usedCompounds.includes('HARD') && lapsRemaining > 20) return 'HARD';
  if (!usedCompounds.includes('MEDIUM') && lapsRemaining > 10) return 'MEDIUM';
  if (lapsRemaining <= 15) return 'SOFT';
  return 'MEDIUM';
}

// Vérif Safety Car / VSC
function checkSafetyCar(currentSCState, lap, totalLaps, driversInRace) {
  if (currentSCState !== 'NONE') {
    // SC/VSC se termine après 2-3 tours
    return { state: currentSCState, lapsLeft: currentSCState.lapsLeft - 1 > 0
      ? { ...currentSCState, lapsLeft: currentSCState.lapsLeft - 1 }
      : { state: 'NONE' }
    };
  }
  const roll = Math.random();
  const dnfCount = driversInRace.filter(d => d.dnf).length;
  const base = 0.03 + dnfCount * 0.01;
  if (roll < base * 0.4) return { state: 'SC',  lapsLeft: randInt(2, 4), label: '🚨 SAFETY CAR' };
  if (roll < base)       return { state: 'VSC', lapsLeft: randInt(1, 3), label: '🟡 VOITURE DE SÉCURITÉ VIRTUELLE' };
  return { state: 'NONE' };
}

// Incidents aléatoires
function checkIncident(pilot, team, lap) {
  const roll = Math.random();
  const reliabFactor = (100 - team.carReliab) / 100 * 0.015;
  const crashFactor  = (100 - pilot.consistency) / 100 * 0.008;

  if (roll < reliabFactor)      return { type: 'MECHANICAL', msg: `💥 Problème mécanique !` };
  if (roll < reliabFactor + crashFactor) return { type: 'CRASH', msg: `💥 Accident !` };
  if (roll < 0.01)              return { type: 'PUNCTURE', msg: `🫧 Crevaison !` };
  return null;
}

// ── SIMULATION ESSAIS LIBRES ───────────────────────────────
async function simulatePractice(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','WET','INTER']);
  const results = [];

  for (const pilot of pilots) {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) continue;
    const time = calcQualiTime(pilot, team, weather) + randInt(-500, 500);
    results.push({ pilot, time });
  }

  results.sort((a, b) => a.time - b.time);
  return { results, weather };
}

// ── SIMULATION QUALIFICATIONS ──────────────────────────────
async function simulateQualifying(race, pilots, teams) {
  const weather = pick(['DRY','DRY','DRY','WET']);
  const results = [];

  for (const pilot of pilots) {
    const team = teams.find(t => String(t._id) === String(pilot.teamId));
    if (!team) continue;
    const time = calcQualiTime(pilot, team, weather);
    results.push({ pilotId: pilot._id, pilotName: pilot.name, teamName: team.name, teamEmoji: team.emoji, time });
  }

  results.sort((a, b) => a.time - b.time);
  return { grid: results, weather };
}

// ── SIMULATION COURSE COMPLÈTE ─────────────────────────────
async function simulateRace(race, grid, pilots, teams, contracts, channel) {
  const totalLaps   = race.laps;
  const weather     = pick(['DRY','DRY','DRY','DRY','WET','INTER']);
  const trackEvo    = 0; // évolue lap par lap

  // Initialise les pilotes en course
  let drivers = grid.map((g, idx) => {
    const pilot = pilots.find(p => String(p._id) === String(g.pilotId));
    const team  = teams.find(t => String(t._id) === String(pilot.teamId));
    const startCompound = chooseStartCompound(pilot, race, weather);
    return {
      pilot,
      team,
      pos         : idx + 1,
      lapTime     : 0,
      totalTime   : (idx * 200),  // spacing de départ
      tireCompound: startCompound,
      tireWear    : 0,
      tireAge     : 0,
      usedCompounds: [startCompound],
      pitStops    : 0,
      dnf         : false,
      dnfLap      : null,
      dnfReason   : '',
      fastestLap  : Infinity,
    };
  });

  let safetyCarState  = { state: 'NONE', lapsLeft: 0 };
  let commentary      = [];   // buffer messages
  let fastestLapOverall = Infinity;
  let fastestLapHolder  = null;

  const sendCommentary = async (msg) => {
    if (!channel) return;
    try { await channel.send(msg); } catch(e) {}
    await sleep(2800);
  };

  // ── Message de départ ──
  await sendCommentary(
    `🏁 **DÉPART DU ${race.circuit.toUpperCase()}** | ${race.emoji} ${race.country}\n` +
    `🌤️ Météo : **${weather}** | ${totalLaps} tours\n` +
    `Grille : ${drivers.slice(0,5).map(d => `${d.pilot.name}`).join(' › ')}...`
  );

  // ── Boucle de course ──────────────────────────────────────
  for (let lap = 1; lap <= totalLaps; lap++) {
    const lapsRemaining = totalLaps - lap;
    const currentTrackEvo = (lap / totalLaps) * 100;

    // Vérif SC
    const alive = drivers.filter(d => !d.dnf);
    safetyCarState = checkSafetyCar(safetyCarState, lap, totalLaps, drivers);
    const scActive = safetyCarState.state !== 'NONE';

    // Commentaire début tour (tous les 5 tours ou événement)
    let lapMsg = '';

    for (const driver of alive) {
      // Incident ?
      const incident = checkIncident(driver.pilot, driver.team, lap);
      if (incident) {
        driver.dnf = true;
        driver.dnfLap = lap;
        driver.dnfReason = incident.type;
        lapMsg += `\n${incident.msg} **${driver.pilot.name}** (${driver.team.emoji}) — Abandon au tour ${lap} !`;
        continue;
      }

      // Calcul du temps au tour
      let lt = calcLapTime(driver.pilot, driver.team, driver.tireCompound, driver.tireWear, weather, currentTrackEvo, lap);

      // SC ralentit tout le monde
      if (scActive) lt = Math.round(lt * 1.35);

      driver.lapTime   = lt;
      driver.totalTime += lt;
      driver.tireWear  += 1;
      driver.tireAge   += 1;

      if (lt < driver.fastestLap) driver.fastestLap = lt;
      if (lt < fastestLapOverall) {
        fastestLapOverall = lt;
        fastestLapHolder  = driver;
      }

      // Gap avec voiture devant (même position -1)
      const sorted = alive.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
      const myIdx  = sorted.findIndex(d => String(d.pilot._id) === String(driver.pilot._id));
      const gapAhead = myIdx > 0 ? driver.totalTime - sorted[myIdx - 1].totalTime : null;

      // Pit stop ?
      const { pit, reason } = shouldPit(driver, lapsRemaining, gapAhead, totalLaps);
      if (pit && driver.pitStops < 3 && lapsRemaining > 5) {
        const newCompound = choosePitCompound(driver.tireCompound, lapsRemaining, driver.usedCompounds);
        const pitTime = randInt(20_000, 24_000); // 20-24s pit stop
        driver.totalTime   += pitTime;
        driver.tireCompound = newCompound;
        driver.tireWear     = 0;
        driver.tireAge      = 0;
        driver.pitStops    += 1;
        if (!driver.usedCompounds.includes(newCompound)) driver.usedCompounds.push(newCompound);
        lapMsg += `\n🔧 **${driver.pilot.name}** rentre aux stands → ${TIRE[newCompound].emoji} ${TIRE[newCompound].label}` +
                  (reason === 'undercut' ? ' (UNDERCUT !)' : '');
      }
    }

    // Reclasser
    const ranked = drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime);
    ranked.forEach((d, i) => d.pos = i + 1);

    // Messages périodiques
    if (lap === 1 || lap % 8 === 0 || lap === totalLaps || safetyCarState.state !== 'NONE' || lapMsg) {
      let msg = `**Tour ${lap}/${totalLaps}** `;
      if (safetyCarState.state === 'SC')  msg += `🚨 **SAFETY CAR**`;
      if (safetyCarState.state === 'VSC') msg += `🟡 **VSC**`;
      msg += lapMsg;

      // Top 3
      if (lap % 8 === 0 || lap === totalLaps) {
        msg += `\n${ranked.slice(0,3).map((d,i) => {
          const gap = i === 0 ? 'LEADER' : `+${((d.totalTime - ranked[0].totalTime)/1000).toFixed(1)}s`;
          return `**P${i+1}** ${d.team.emoji} ${d.pilot.name} (${gap}) ${TIRE[d.tireCompound].emoji}`;
        }).join('\n')}`;
      }

      if (msg.trim() !== `**Tour ${lap}/${totalLaps}** `) {
        await sendCommentary(msg);
      }
    }

    // Décrement SC
    if (safetyCarState.lapsLeft > 0) safetyCarState.lapsLeft--;
    else safetyCarState.state = 'NONE';
  }

  // ── Résultats finaux ──────────────────────────────────────
  const finalRanked = [
    ...drivers.filter(d => !d.dnf).sort((a,b) => a.totalTime - b.totalTime),
    ...drivers.filter(d => d.dnf).sort((a,b) => (a.dnfLap||0) - (b.dnfLap||0)).reverse(),
  ];

  finalRanked.forEach((d, i) => d.pos = i + 1);

  // Calcul PLcoins
  const results = [];
  for (const driver of finalRanked) {
    const pts  = F1_POINTS[driver.pos - 1] || 0;
    const contract = contracts.find(c => String(c.pilotId) === String(driver.pilot._id) && c.active);
    const multi    = contract ? contract.coinMultiplier : 1.0;
    const coins    = Math.round((pts * 20 + (driver.dnf ? 0 : 50)) * multi);
    const fl       = fastestLapHolder && String(fastestLapHolder.pilot._id) === String(driver.pilot._id);

    results.push({
      pilotId : driver.pilot._id,
      pos     : driver.pos,
      dnf     : driver.dnf,
      dnfReason: driver.dnfReason,
      coins,
      fastestLap: fl,
      totalTime : driver.totalTime,
    });
  }

  // Message podium
  const podium = finalRanked.slice(0,3);
  await sendCommentary(
    `🏆 **PODIUM ${race.circuit.toUpperCase()}**\n` +
    podium.map((d,i) => `${['🥇','🥈','🥉'][i]} **${d.pilot.name}** (${d.team.emoji} ${d.team.name})`).join('\n') +
    (fastestLapHolder ? `\n\n⚡ **Meilleur tour** : ${fastestLapHolder.pilot.name} — ${msToLapStr(fastestLapOverall)}` : '')
  );

  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// ███████╗ ██████╗██╗  ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗██████╗
// ██╔════╝██╔════╝██║  ██║██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔══██╗
// ███████╗██║     ███████║█████╗  ██║  ██║██║   ██║██║     █████╗  ██████╔╝
// ╚════██║██║     ██╔══██║██╔══╝  ██║  ██║██║   ██║██║     ██╔══╝  ██╔══██╗
// ███████║╚██████╗██║  ██║███████╗██████╔╝╚██████╔╝███████╗███████╗██║  ██║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// ============================================================

// ── HELPERS ────────────────────────────────────────────────
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
  for (const r of raceResults) {
    // Ajouter PLcoins
    await Pilot.findByIdAndUpdate(r.pilotId, {
      $inc: { plcoins: r.coins, totalEarned: r.coins }
    });

    // Mettre à jour classement
    const pts = F1_POINTS[r.pos - 1] || 0;
    await Standing.findOneAndUpdate(
      { seasonId: season._id, pilotId: r.pilotId },
      {
        $inc: {
          points : pts,
          wins   : r.pos === 1 && !r.dnf ? 1 : 0,
          podiums: r.pos <= 3 && !r.dnf ? 1 : 0,
          dnfs   : r.dnf ? 1 : 0,
        }
      },
      { upsert: true }
    );
  }

  // Marquer la course terminée
  await Race.findByIdAndUpdate(raceId, { status: 'done', raceResults });
}

// ─── Créer une nouvelle saison avec calendrier ─────────────
async function createNewSeason() {
  const lastSeason = await Season.findOne().sort({ year: -1 });
  const year = lastSeason ? lastSeason.year + 1 : new Date().getFullYear();
  const regSet = lastSeason ? (lastSeason.year % 4 === 3 ? lastSeason.regulationSet + 1 : lastSeason.regulationSet) : 1;

  const season = await Season.create({ year, status: 'active', regulationSet: regSet });

  // Générer les dates (une course tous les ~1.2 jours pour tenir en 1 mois)
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  for (let i = 0; i < CIRCUITS.length; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Math.round(i * 1.2));
    await Race.create({
      seasonId: season._id,
      index: i,
      ...CIRCUITS[i],
      scheduledDate: d,
      status: 'upcoming',
    });
  }

  // Créer entrées classement pour tous les pilotes avec équipe
  const pilots = await Pilot.find({ teamId: { $ne: null } });
  for (const p of pilots) {
    await Standing.create({ seasonId: season._id, pilotId: p._id });
  }

  return season;
}

// ─── Période de transfert ──────────────────────────────────
async function startTransferPeriod() {
  const season = await getActiveSeason();
  if (!season) return;

  await Season.findByIdAndUpdate(season._id, { status: 'transfer' });

  // Décrémenter les saisons restantes des contrats
  await Contract.updateMany({ active: true }, { $inc: { seasonsRemaining: -1 } });

  // Expirer les contrats à 0 saisons restantes
  const expired = await Contract.find({ seasonsRemaining: 0, active: true });
  for (const c of expired) {
    await Contract.findByIdAndUpdate(c._id, { active: false });
    await Pilot.findByIdAndUpdate(c.pilotId, { teamId: null });
  }

  // Générer des offres auto des écuries pour les pilotes libres
  const freePilots = await Pilot.find({ teamId: null });
  const teams = await Team.find();

  for (const pilot of freePilots) {
    // Chaque écurie a 40% de chance de faire une offre
    for (const team of teams) {
      const pilots_in_team = await Pilot.countDocuments({ teamId: team._id });
      if (pilots_in_team >= 2) continue; // max 2 pilotes par écurie
      if (Math.random() > 0.4) continue;
      const multi = parseFloat((rand(0.9, 1.8)).toFixed(2));
      const seas  = randInt(1, 3);
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      await TransferOffer.create({
        teamId: team._id, pilotId: pilot._id,
        multiplier: multi, seasons: seas,
        status: 'pending', expiresAt: expiry,
      });
    }
  }

  return expired.length;
}

// ============================================================
// ███████╗██╗      █████╗ ███████╗██╗  ██╗        ██████╗ ███╗   ███╗██████╗ ███████╗
// ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║       ██╔════╝████╗ ████║██╔══██╗██╔════╝
// ███████╗██║     ███████║███████╗███████║       ██║     ██╔████╔██║██║  ██║███████╗
// ╚════██║██║     ██╔══██║╚════██║██╔══██║       ██║     ██║╚██╔╝██║██║  ██║╚════██║
// ███████║███████╗██║  ██║███████║██║  ██║       ╚██████╗██║ ╚═╝ ██║██████╔╝███████║
// ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝        ╚═════╝╚═╝     ╚═╝╚═════╝ ╚══════╝
// ============================================================

const commands = [
  // PILOTE
  new SlashCommandBuilder()
    .setName('create_pilot')
    .setDescription('Crée ton pilote F1 !')
    .addStringOption(o => o.setName('nom').setDescription('Nom de ton pilote').setRequired(true)),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Voir ton profil ou celui d\'un autre')
    .addUserOption(o => o.setName('joueur').setDescription('Joueur à voir')),

  new SlashCommandBuilder()
    .setName('ameliorer')
    .setDescription('Améliore une stat de ton pilote avec tes PLcoins')
    .addStringOption(o => o.setName('stat')
      .setDescription('Stat à améliorer')
      .setRequired(true)
      .addChoices(
        { name: 'Vitesse (500 PLcoins)', value: 'speed' },
        { name: 'Consistance (400 PLcoins)', value: 'consistency' },
        { name: 'Gestion pneus (400 PLcoins)', value: 'tireManage' },
        { name: 'Pilotage pluie (350 PLcoins)', value: 'wetSkill' },
        { name: 'Dépassement (450 PLcoins)', value: 'overtaking' },
        { name: 'Défense (400 PLcoins)', value: 'defending' },
      )),

  // ÉCURIES
  new SlashCommandBuilder()
    .setName('ecuries')
    .setDescription('Voir toutes les écuries et leurs pilotes'),

  new SlashCommandBuilder()
    .setName('ecurie')
    .setDescription('Voir une écurie en détail')
    .addStringOption(o => o.setName('nom').setDescription('Nom de l\'écurie').setRequired(true)),

  // CONTRATS & TRANSFERTS
  new SlashCommandBuilder()
    .setName('offres')
    .setDescription('Voir tes offres de contrat en attente'),

  new SlashCommandBuilder()
    .setName('accepter_offre')
    .setDescription('Accepter une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('refuser_offre')
    .setDescription('Refuser une offre de contrat')
    .addStringOption(o => o.setName('offre_id').setDescription('ID de l\'offre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mon_contrat')
    .setDescription('Voir ton contrat actuel'),

  // CLASSEMENTS
  new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Classement pilotes de la saison en cours'),

  new SlashCommandBuilder()
    .setName('calendrier')
    .setDescription('Voir le calendrier de la saison'),

  new SlashCommandBuilder()
    .setName('resultats')
    .setDescription('Résultats de la dernière course'),

  // ADMIN
  new SlashCommandBuilder()
    .setName('admin_new_season')
    .setDescription('[ADMIN] Lance une nouvelle saison'),

  new SlashCommandBuilder()
    .setName('admin_force_race')
    .setDescription('[ADMIN] Force le lancement de la prochaine course maintenant'),

  new SlashCommandBuilder()
    .setName('admin_force_quali')
    .setDescription('[ADMIN] Force les qualifications maintenant'),

  new SlashCommandBuilder()
    .setName('admin_force_practice')
    .setDescription('[ADMIN] Force les essais libres maintenant'),

  new SlashCommandBuilder()
    .setName('admin_transfer')
    .setDescription('[ADMIN] Lance la période de transfert'),
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

  // Connecter MongoDB
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connecté');

  // Seed les écuries si elles n'existent pas
  const teamCount = await Team.countDocuments();
  if (teamCount === 0) {
    await Team.insertMany(DEFAULT_TEAMS);
    console.log('✅ 10 écuries créées');
  }

  // Enregistrer les slash commands
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log('✅ Slash commands enregistrées');

  // Lancer le scheduler
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ─── /create_pilot ────────────────────────────────────────
  if (commandName === 'create_pilot') {
    const existing = await Pilot.findOne({ discordId: interaction.user.id });
    if (existing) {
      return interaction.reply({ content: `❌ Tu as déjà un pilote : **${existing.name}** !`, ephemeral: true });
    }
    const nom = interaction.options.getString('nom');
    if (nom.length < 2 || nom.length > 30) {
      return interaction.reply({ content: '❌ Nom entre 2 et 30 caractères.', ephemeral: true });
    }

    const pilot = await Pilot.create({
      discordId: interaction.user.id,
      name: nom,
      speed: randInt(45, 65),
      consistency: randInt(45, 65),
      tireManage: randInt(45, 65),
      wetSkill: randInt(45, 65),
      overtaking: randInt(45, 65),
      defending: randInt(45, 65),
      plcoins: 500,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏎️ Pilote créé : ${pilot.name}`)
      .setColor('#00FF88')
      .addFields(
        { name: '⚡ Vitesse',          value: `${pilot.speed}`,       inline: true },
        { name: '🎯 Consistance',      value: `${pilot.consistency}`, inline: true },
        { name: '🔄 Gestion pneus',    value: `${pilot.tireManage}`,  inline: true },
        { name: '🌧️ Pluie',           value: `${pilot.wetSkill}`,    inline: true },
        { name: '💨 Dépassement',      value: `${pilot.overtaking}`,  inline: true },
        { name: '🛡️ Défense',         value: `${pilot.defending}`,   inline: true },
        { name: '💰 PLcoins',          value: `${pilot.plcoins} 🪙`,  inline: false },
      )
      .setFooter({ text: 'Utilise /ecuries pour rejoindre une écurie !' });
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /profil ──────────────────────────────────────────────
  if (commandName === 'profil') {
    const target = interaction.options.getUser('joueur') || interaction.user;
    const pilot  = await Pilot.findOne({ discordId: target.id });
    if (!pilot) return interaction.reply({ content: `❌ Aucun pilote pour <@${target.id}>.`, ephemeral: true });

    const team     = pilot.teamId ? await Team.findById(pilot.teamId) : null;
    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    const season   = await getActiveSeason();
    const standing = season ? await Standing.findOne({ seasonId: season._id, pilotId: pilot._id }) : null;

    const statBar = (val) => '█'.repeat(Math.round(val / 10)) + '░'.repeat(10 - Math.round(val / 10));

    const embed = new EmbedBuilder()
      .setTitle(`${team ? team.emoji : '🏎️'} ${pilot.name}`)
      .setColor(team ? team.color : '#888888')
      .setDescription(team ? `**${team.name}**${contract ? ` | Contrat ×${contract.coinMultiplier} (${contract.seasonsRemaining} saison(s) restante(s))` : ''}` : '🔴 Sans écurie')
      .addFields(
        { name: '⚡ Vitesse',       value: `\`${statBar(pilot.speed)}\` ${pilot.speed}`,       inline: false },
        { name: '🎯 Consistance',   value: `\`${statBar(pilot.consistency)}\` ${pilot.consistency}`, inline: false },
        { name: '🔄 Gestion pneus',value: `\`${statBar(pilot.tireManage)}\` ${pilot.tireManage}`,  inline: false },
        { name: '🌧️ Pluie',        value: `\`${statBar(pilot.wetSkill)}\` ${pilot.wetSkill}`,    inline: false },
        { name: '💨 Dépassement',  value: `\`${statBar(pilot.overtaking)}\` ${pilot.overtaking}`,  inline: false },
        { name: '🛡️ Défense',      value: `\`${statBar(pilot.defending)}\` ${pilot.defending}`,   inline: false },
        { name: '💰 PLcoins',       value: `${pilot.plcoins} 🪙 (total gagné : ${pilot.totalEarned})`, inline: false },
      );

    if (standing) {
      embed.addFields({ name: '🏆 Saison en cours', value: `**${standing.points} pts** | ${standing.wins} victoire(s) | ${standing.podiums} podium(s) | ${standing.dnfs} abandon(s)` });
    }

    return interaction.reply({ embeds: [embed] });
  }

  // ─── /ameliorer ───────────────────────────────────────────
  if (commandName === 'ameliorer') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Crée d\'abord ton pilote avec `/create_pilot`.', ephemeral: true });

    const statKey   = interaction.options.getString('stat');
    const STAT_COST = { speed: 500, consistency: 400, tireManage: 400, wetSkill: 350, overtaking: 450, defending: 400 };
    const cost = STAT_COST[statKey];

    if (pilot.plcoins < cost) {
      return interaction.reply({ content: `❌ Tu n'as pas assez de PLcoins ! (${pilot.plcoins}/${cost})`, ephemeral: true });
    }
    if (pilot[statKey] >= 99) {
      return interaction.reply({ content: '❌ Cette stat est déjà au maximum (99) !', ephemeral: true });
    }

    const gain = randInt(1, 3);
    await Pilot.findByIdAndUpdate(pilot._id, {
      $inc: { plcoins: -cost, [statKey]: gain },
    });
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📈 Amélioration !')
        .setColor('#FFD700')
        .setDescription(`**${statKey}** : ${pilot[statKey]} → ${Math.min(99, pilot[statKey] + gain)} (+${gain})\n💰 ${cost} PLcoins dépensés`)
      ],
    });
  }

  // ─── /ecuries ─────────────────────────────────────────────
  if (commandName === 'ecuries') {
    const teams  = await Team.find().sort({ carSpeed: -1 });
    const pilots = await Pilot.find({ teamId: { $ne: null } });

    const embed = new EmbedBuilder()
      .setTitle('🏎️ Écuries F1')
      .setColor('#FF1801');

    for (const team of teams) {
      const tp = pilots.filter(p => String(p.teamId) === String(team._id));
      const names = tp.length ? tp.map(p => p.name).join(', ') : 'Aucun pilote';
      embed.addFields({
        name: `${team.emoji} ${team.name}`,
        value: `🚀 Vitesse voiture: **${team.carSpeed}** | 👥 ${names}`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /ecurie ──────────────────────────────────────────────
  if (commandName === 'ecurie') {
    const nom  = interaction.options.getString('nom').toLowerCase();
    const team = await Team.findOne({ name: { $regex: nom, $options: 'i' } });
    if (!team) return interaction.reply({ content: '❌ Écurie introuvable.', ephemeral: true });

    const pilots = await Pilot.find({ teamId: team._id });
    const embed = new EmbedBuilder()
      .setTitle(`${team.emoji} ${team.name}`)
      .setColor(team.color)
      .addFields(
        { name: '🚀 Vitesse voiture', value: `${team.carSpeed}/100`,  inline: true },
        { name: '🔧 Fiabilité',       value: `${team.carReliab}/100`, inline: true },
        { name: '🌀 Aérodynamique',   value: `${team.carAero}/100`,   inline: true },
        { name: '👥 Pilotes',         value: pilots.length ? pilots.map(p => `• ${p.name}`).join('\n') : 'Aucun', inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /mon_contrat ─────────────────────────────────────────
  if (commandName === 'mon_contrat') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote trouvé.', ephemeral: true });

    const contract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (!contract) {
      return interaction.reply({ content: '📋 Tu n\'as pas de contrat actif. Attends la période de transfert !', ephemeral: true });
    }
    const team = await Team.findById(contract.teamId);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Mon Contrat')
        .setColor(team.color)
        .addFields(
          { name: 'Écurie',         value: `${team.emoji} ${team.name}`,           inline: true },
          { name: 'Multiplicateur', value: `×${contract.coinMultiplier}`,          inline: true },
          { name: 'Durée signée',   value: `${contract.seasonsDuration} saison(s)`, inline: true },
          { name: 'Restantes',      value: `${contract.seasonsRemaining} saison(s)`, inline: true },
        )
      ],
    });
  }

  // ─── /offres ──────────────────────────────────────────────
  if (commandName === 'offres') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });

    const offers = await TransferOffer.find({ pilotId: pilot._id, status: 'pending' }).populate('teamId');
    if (!offers.length) return interaction.reply({ content: '📭 Aucune offre en attente.', ephemeral: true });

    const embed = new EmbedBuilder().setTitle('📬 Tes offres de contrat').setColor('#FFD700');
    for (const o of offers) {
      const t = await Team.findById(o.teamId);
      embed.addFields({
        name: `${t.emoji} ${t.name} — ID: \`${o._id}\``,
        value: `Multiplicateur : **×${o.multiplier}** | Durée : **${o.seasons} saison(s)**\nExpire : <t:${Math.floor(o.expiresAt.getTime()/1000)}:R>`,
        inline: false,
      });
    }
    embed.setFooter({ text: 'Utilise /accepter_offre <ID> ou /refuser_offre <ID>' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ─── /accepter_offre ──────────────────────────────────────
  if (commandName === 'accepter_offre') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });

    // Vérifier contrat actif
    const activeContract = await Contract.findOne({ pilotId: pilot._id, active: true });
    if (activeContract) {
      const remainingSeason = await getActiveSeason();
      return interaction.reply({ content: `❌ Tu as déjà un contrat actif (${activeContract.seasonsRemaining} saison(s) restante(s)). Tu ne peux pas changer d\'écurie hors fin de contrat !`, ephemeral: true });
    }

    const offerId = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || String(offer.pilotId) !== String(pilot._id) || offer.status !== 'pending') {
      return interaction.reply({ content: '❌ Offre introuvable ou invalide.', ephemeral: true });
    }

    const team = await Team.findById(offer.teamId);
    const pilots_in_team = await Pilot.countDocuments({ teamId: team._id });
    if (pilots_in_team >= 2) return interaction.reply({ content: '❌ L\'écurie est complète (2 pilotes max) !', ephemeral: true });

    // Accepter
    await TransferOffer.findByIdAndUpdate(offerId, { status: 'accepted' });
    await TransferOffer.updateMany({ pilotId: pilot._id, status: 'pending', _id: { $ne: offerId } }, { status: 'expired' });
    await Pilot.findByIdAndUpdate(pilot._id, { teamId: team._id });
    await Contract.create({
      pilotId: pilot._id,
      teamId: team._id,
      seasonsDuration: offer.seasons,
      seasonsRemaining: offer.seasons,
      coinMultiplier: offer.multiplier,
      active: true,
    });

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Contrat signé !')
        .setColor(team.color)
        .setDescription(`**${pilot.name}** rejoint **${team.emoji} ${team.name}** !\n×${offer.multiplier} multiplicateur | ${offer.seasons} saison(s)`)
      ],
    });
  }

  // ─── /refuser_offre ───────────────────────────────────────
  if (commandName === 'refuser_offre') {
    const pilot = await Pilot.findOne({ discordId: interaction.user.id });
    if (!pilot) return interaction.reply({ content: '❌ Aucun pilote.', ephemeral: true });

    const offerId = interaction.options.getString('offre_id');
    let offer;
    try { offer = await TransferOffer.findById(offerId); } catch(e) {}
    if (!offer || String(offer.pilotId) !== String(pilot._id)) {
      return interaction.reply({ content: '❌ Offre introuvable.', ephemeral: true });
    }
    await TransferOffer.findByIdAndUpdate(offerId, { status: 'rejected' });
    return interaction.reply({ content: '🚫 Offre refusée.', ephemeral: true });
  }

  // ─── /classement ──────────────────────────────────────────
  if (commandName === 'classement') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const standings = await Standing.find({ seasonId: season._id }).sort({ points: -1 }).limit(20);
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Classement Pilotes — Saison ${season.year}`)
      .setColor('#FF1801');

    const medals = ['🥇','🥈','🥉'];
    let desc = '';
    for (let i = 0; i < standings.length; i++) {
      const s = standings[i];
      const pilot = await Pilot.findById(s.pilotId);
      const team  = pilot?.teamId ? await Team.findById(pilot.teamId) : null;
      const medal = medals[i] || `**${i+1}.**`;
      desc += `${medal} ${team ? team.emoji : '🏎️'} **${pilot?.name || '?'}** — ${s.points} pts (${s.wins}V ${s.podiums}P)\n`;
    }
    embed.setDescription(desc || 'Aucun résultat');
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /calendrier ──────────────────────────────────────────
  if (commandName === 'calendrier') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const races = await Race.find({ seasonId: season._id }).sort({ index: 1 });
    const embed = new EmbedBuilder()
      .setTitle(`📅 Calendrier — Saison ${season.year}`)
      .setColor('#0099FF');

    const lines = races.map(r => {
      const d = new Date(r.scheduledDate);
      const dateStr = `${d.getDate()}/${d.getMonth()+1}`;
      const status = r.status === 'done' ? '✅' : r.status === 'upcoming' ? '🔜' : '🔵';
      return `${status} ${r.emoji} **${r.circuit}** — ${dateStr}`;
    });

    // Split en chunks de 12 pour éviter la limite Discord
    const chunks = [];
    for (let i = 0; i < lines.length; i += 12) chunks.push(lines.slice(i, i+12).join('\n'));
    embed.setDescription(chunks[0] || 'Aucune course');
    if (chunks[1]) embed.addFields({ name: '\u200B', value: chunks[1] });

    return interaction.reply({ embeds: [embed] });
  }

  // ─── /resultats ───────────────────────────────────────────
  if (commandName === 'resultats') {
    const season = await getActiveSeason();
    if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

    const lastRace = await Race.findOne({ seasonId: season._id, status: 'done' }).sort({ index: -1 });
    if (!lastRace) return interaction.reply({ content: '❌ Aucune course terminée.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`${lastRace.emoji} Résultats : ${lastRace.circuit}`)
      .setColor('#FF1801');

    const medals = ['🥇','🥈','🥉'];
    let desc = '';
    for (const r of lastRace.raceResults.slice(0, 15)) {
      const pilot = await Pilot.findById(r.pilotId);
      const team  = pilot?.teamId ? await Team.findById(pilot.teamId) : null;
      const medal = medals[r.pos-1] || `**P${r.pos}**`;
      const pts   = F1_POINTS[r.pos-1] || 0;
      desc += `${medal} ${team ? team.emoji : ''} **${pilot?.name || '?'}**`;
      if (r.dnf) desc += ` — ❌ DNF (${r.dnfReason})`;
      else desc += ` — ${pts} pts (+${r.coins} 🪙)`;
      if (r.fastestLap) desc += ' ⚡';
      desc += '\n';
    }
    embed.setDescription(desc);
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /admin_new_season ────────────────────────────────────
  if (commandName === 'admin_new_season') {
    await interaction.deferReply();
    try {
      const season = await createNewSeason();
      await interaction.editReply(`✅ Saison **${season.year}** créée ! ${CIRCUITS.length} courses au calendrier.`);
    } catch(e) {
      await interaction.editReply(`❌ Erreur : ${e.message}`);
    }
  }

  // ─── /admin_force_practice ────────────────────────────────
  if (commandName === 'admin_force_practice') {
    await interaction.deferReply();
    await runPractice(interaction.channel);
    await interaction.editReply('✅ Essais libres lancés !');
  }

  // ─── /admin_force_quali ───────────────────────────────────
  if (commandName === 'admin_force_quali') {
    await interaction.deferReply();
    await runQualifying(interaction.channel);
    await interaction.editReply('✅ Qualifications lancées !');
  }

  // ─── /admin_force_race ────────────────────────────────────
  if (commandName === 'admin_force_race') {
    await interaction.deferReply();
    await runRace(interaction.channel);
    await interaction.editReply('✅ Course lancée !');
  }

  // ─── /admin_transfer ──────────────────────────────────────
  if (commandName === 'admin_transfer') {
    await interaction.deferReply();
    const expired = await startTransferPeriod();
    await interaction.editReply(`✅ Période de transfert lancée ! ${expired} contrat(s) expiré(s). Des offres ont été générées automatiquement.`);
  }
});

// ============================================================
// ███████╗ ██████╗██╗  ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗██████╗
// ██╔════╝██╔════╝██║  ██║██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔══██╗
// ███████╗██║     ███████║█████╗  ██║  ██║██║   ██║██║     █████╗  ██████╔╝
// ╚════██║██║     ██╔══██║██╔══╝  ██║  ██║██║   ██║██║     ██╔══╝  ██╔══██╗
// ███████║╚██████╗██║  ██║███████╗██████╔╝╚██████╔╝███████╗███████╗██║  ██║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// ── Fonctions de lancement des sessions ─────────────────────
// ============================================================

async function getRaceChannel(overrideChannel) {
  if (overrideChannel) return overrideChannel;
  try { return await client.channels.fetch(RACE_CHANNEL); } catch(e) { return null; }
}

async function runPractice(overrideChannel) {
  const season = await getActiveSeason();
  if (!season) return;
  const race = await getCurrentRace(season);
  if (!race) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const raceDate = new Date(race.scheduledDate);
  raceDate.setHours(0,0,0,0);
  if (raceDate.getTime() !== today.getTime() && !overrideChannel) return; // Pas aujourd'hui

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { results, weather } = await simulatePractice(race, pilots, teams);
  const channel = await getRaceChannel(overrideChannel);

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Essais Libres — ${race.emoji} ${race.circuit}`)
    .setColor('#888888')
    .setDescription(`Météo : **${weather}**\n\n` +
      results.slice(0,10).map((r, i) => {
        const team = teams.find(t => String(t._id) === String(r.pilot.teamId));
        return `**P${i+1}** ${team?.emoji || ''} ${r.pilot.name} — ${msToLapStr(r.time)}`;
      }).join('\n')
    );

  if (channel) await channel.send({ embeds: [embed] });
  await Race.findByIdAndUpdate(race._id, { status: 'practice_done' });
}

async function runQualifying(overrideChannel) {
  const season = await getActiveSeason();
  if (!season) return;
  const race = await getCurrentRace(season);
  if (!race) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const raceDate = new Date(race.scheduledDate);
  raceDate.setHours(0,0,0,0);
  if (raceDate.getTime() !== today.getTime() && !overrideChannel) return;

  const { pilots, teams } = await getAllPilotsWithTeams();
  if (!pilots.length) return;

  const { grid, weather } = await simulateQualifying(race, pilots, teams);
  const channel = await getRaceChannel(overrideChannel);

  // Sauvegarder la grille
  await Race.findByIdAndUpdate(race._id, {
    qualiGrid: grid.map(g => ({ pilotId: g.pilotId, time: g.time })),
    status: 'quali_done',
  });

  const embed = new EmbedBuilder()
    .setTitle(`⏱️ Qualifications — ${race.emoji} ${race.circuit}`)
    .setColor('#FFD700')
    .setDescription(`Météo : **${weather}**\n\n` +
      grid.slice(0,20).map((g, i) => {
        const gap = i === 0 ? '' : ` (+${((g.time - grid[0].time)/1000).toFixed(3)}s)`;
        return `**P${i+1}** ${g.teamEmoji} ${g.pilotName} — ${msToLapStr(g.time)}${gap}`;
      }).join('\n')
    );

  if (channel) await channel.send({ embeds: [embed] });
}

async function runRace(overrideChannel) {
  const season = await getActiveSeason();
  if (!season) return;
  const race = await getCurrentRace(season);
  if (!race || race.status === 'done') return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const raceDate = new Date(race.scheduledDate);
  raceDate.setHours(0,0,0,0);
  if (raceDate.getTime() !== today.getTime() && !overrideChannel) return;

  const { pilots, teams }   = await getAllPilotsWithTeams();
  const contracts            = await Contract.find({ active: true });
  if (!pilots.length) return;

  // Récupérer la grille de départ (depuis les quali ou trier par stats)
  let grid = race.qualiGrid;
  if (!grid || !grid.length) {
    const fallback = [...pilots].sort((a,b) => {
      const ta = teams.find(t => String(t._id) === String(a.teamId));
      const tb = teams.find(t => String(t._id) === String(b.teamId));
      return (tb?.carSpeed || 0) - (ta?.carSpeed || 0);
    });
    grid = fallback.map(p => ({ pilotId: p._id }));
  }

  const channel = await getRaceChannel(overrideChannel);

  // Run the simulation
  const results = await simulateRace(race, grid, pilots, teams, contracts, channel);

  // Sauvegarder et distribuer les récompenses
  await applyRaceResults(results, race._id, season);

  // Afficher tableau final
  const embed = new EmbedBuilder()
    .setTitle(`🏁 Classement Final — ${race.emoji} ${race.circuit}`)
    .setColor('#FF1801');

  let desc = '';
  const medals = ['🥇','🥈','🥉'];
  for (const r of results.slice(0, 15)) {
    const pilot = pilots.find(p => String(p._id) === String(r.pilotId));
    const team  = pilot ? teams.find(t => String(t._id) === String(pilot.teamId)) : null;
    const pts   = F1_POINTS[r.pos-1] || 0;
    const med   = medals[r.pos-1] || `P${r.pos}`;
    desc += `${med} ${team?.emoji || ''} **${pilot?.name || '?'}**`;
    if (r.dnf) desc += ` ❌ DNF`;
    else desc += ` — ${pts} pts | +${r.coins} 🪙`;
    if (r.fastestLap) desc += ' ⚡';
    desc += '\n';
  }
  embed.setDescription(desc);
  if (channel) await channel.send({ embeds: [embed] });

  // Vérifier si c'était la dernière course
  const remaining = await Race.countDocuments({ seasonId: season._id, status: { $ne: 'done' } });
  if (remaining === 0) {
    // Fin de saison → période de transfert automatique dans 24h
    if (channel) await channel.send('🏆 **FIN DE SAISON !** La période de transfert commencera demain. Prépare-toi !');
    setTimeout(async () => {
      await startTransferPeriod();
      if (channel) await channel.send('🔄 **PÉRIODE DE TRANSFERT OUVERTE !** Utilisez `/offres` pour voir vos propositions.');
    }, 24 * 60 * 60 * 1000);
  }
}

// ============================================================
// ███████╗ ██████╗██╗  ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗██████╗
//    ██╔══╝██╔════╝██╔══██║██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔══██╗
//    ██║   ██║     ███████║█████╗  ██║  ██║██║   ██║██║     █████╗  ██████╔╝
//    ██║   ██║     ██╔══██║██╔══╝  ██║  ██║██║   ██║██║     ██╔══╝  ██╔══██╗
//    ██║   ╚██████╗██║  ██║███████╗██████╔╝╚██████╔╝███████╗███████╗██║  ██║
//    ╚═╝    ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// ── CRON JOBS ───────────────────────────────────────────────
// ============================================================

function startScheduler() {
  // 11h → Essais libres
  cron.schedule('0 11 * * *', () => {
    console.log('⏰ Cron : Essais libres');
    runPractice().catch(console.error);
  }, { timezone: 'Europe/Paris' });

  // 15h → Qualifications
  cron.schedule('0 15 * * *', () => {
    console.log('⏰ Cron : Qualifications');
    runQualifying().catch(console.error);
  }, { timezone: 'Europe/Paris' });

  // 18h → Course
  cron.schedule('0 18 * * *', () => {
    console.log('⏰ Cron : Course');
    runRace().catch(console.error);
  }, { timezone: 'Europe/Paris' });

  console.log('✅ Scheduler démarré (11h FP | 15h Q | 18h Race) — Europe/Paris');
}

// ============================================================
// ██████╗ ███████╗███╗   ███╗ █████╗ ██████╗ ██████╗  █████╗  ██████╗ ███████╗███████╗
// ██╔══██╗██╔════╝████╗ ████║██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔════╝ ██╔════╝██╔════╝
// ██████╔╝█████╗  ██╔████╔██║███████║██████╔╝██████╔╝███████║██║  ███╗█████╗  ███████╗
// ██╔══██╗██╔══╝  ██║╚██╔╝██║██╔══██║██╔══██╗██╔══██╗██╔══██║██║   ██║██╔══╝  ╚════██║
// ██║  ██║███████╗██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██║██║  ██║╚██████╔╝███████╗███████║
// ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
// ── Changements de réglementation (all 3-4 seasons) ─────────
// Quand une nouvelle saison commence, si regulationSet change,
// les carSpeed sont redistribués aléatoirement (rebrassage de la hiérarchie)
// ============================================================

async function applyRegulationChange(season) {
  if (season.regulationSet === 1) return; // Pas de changement à la 1ère saison
  const teams = await Team.find();
  const speedPool = teams.map(t => t.carSpeed).sort((a,b) => b-a);

  // Mélanger le pool de vitesses (nouveau règlement = nouveaux vainqueurs potentiels)
  for (let i = speedPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [speedPool[i], speedPool[j]] = [speedPool[j], speedPool[i]];
  }

  for (let i = 0; i < teams.length; i++) {
    await Team.findByIdAndUpdate(teams[i]._id, { carSpeed: speedPool[i] });
  }
  console.log(`🔄 Changement de réglementation appliqué (saison ${season.year})`);
}

// ──────────────────────────────────────────────────────────
// DÉMARRAGE
// ──────────────────────────────────────────────────────────
client.login(TOKEN);
