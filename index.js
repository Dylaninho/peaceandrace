require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const http = require('http');

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTES & LABELS
// ═══════════════════════════════════════════════════════════════════

const STAT_BASE   = 50;
const STAT_MAX    = 85;
const FREE_POINTS = 5;

const STAT_LABELS = {
  pace:           '⚡ Pace',
  qualifying:     '🏁 Qualifying',
  wetPace:        '🌧️ Pluie',
  tyreManagement: '🔧 Gestion pneus',
  fuelManagement: '⛽ Carburant',
  racecraft:      '🏎️ Racecraft',
  consistency:    '🎯 Consistance',
  overtaking:     '➡️ Dépassement',
  defending:      '🛡️ Défense',
  start:          '🚦 Départ',
  adaptability:   '🔄 Adaptabilité',
};
const STAT_LIST = Object.keys(STAT_LABELS);

const UPGRADE_TIERS = [
  { upTo: 59, cost: 100 },
  { upTo: 69, cost: 200 },
  { upTo: 79, cost: 400 },
  { upTo: 85, cost: 800 },
];

const POINTS_TABLE  = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const PLCOINS_TABLE = [500, 350, 280, 220, 170, 130, 100, 75, 50, 30, 20, 15, 12, 10, 8, 6, 5, 4, 3, 2];

// ═══════════════════════════════════════════════════════════════════
//  CIRCUITS F1
// ═══════════════════════════════════════════════════════════════════

const CIRCUITS = [
  { name: 'Bahrain',     emoji: '🇧🇭', laps: 57, lapLength: 5.412, type: 'mixte',     tyreWear: 0.8, overtakingEase: 0.7 },
  { name: 'Jeddah',      emoji: '🇸🇦', laps: 50, lapLength: 6.174, type: 'rapide',    tyreWear: 0.6, overtakingEase: 0.5 },
  { name: 'Melbourne',   emoji: '🇦🇺', laps: 58, lapLength: 5.278, type: 'mixte',     tyreWear: 0.7, overtakingEase: 0.6 },
  { name: 'Suzuka',      emoji: '🇯🇵', laps: 53, lapLength: 5.807, type: 'technique', tyreWear: 0.9, overtakingEase: 0.4 },
  { name: 'Shanghai',    emoji: '🇨🇳', laps: 56, lapLength: 5.451, type: 'mixte',     tyreWear: 0.7, overtakingEase: 0.6 },
  { name: 'Miami',       emoji: '🇺🇸', laps: 57, lapLength: 5.412, type: 'mixte',     tyreWear: 0.7, overtakingEase: 0.6 },
  { name: 'Monaco',      emoji: '🇲🇨', laps: 78, lapLength: 3.337, type: 'urbain',    tyreWear: 0.4, overtakingEase: 0.1 },
  { name: 'Montreal',    emoji: '🇨🇦', laps: 70, lapLength: 4.361, type: 'mixte',     tyreWear: 0.6, overtakingEase: 0.7 },
  { name: 'Barcelone',   emoji: '🇪🇸', laps: 66, lapLength: 4.657, type: 'technique', tyreWear: 0.9, overtakingEase: 0.4 },
  { name: 'Autriche',    emoji: '🇦🇹', laps: 71, lapLength: 4.318, type: 'rapide',    tyreWear: 0.8, overtakingEase: 0.7 },
  { name: 'Silverstone', emoji: '🇬🇧', laps: 52, lapLength: 5.891, type: 'rapide',    tyreWear: 0.9, overtakingEase: 0.6 },
  { name: 'Budapest',    emoji: '🇭🇺', laps: 70, lapLength: 4.381, type: 'technique', tyreWear: 0.7, overtakingEase: 0.3 },
  { name: 'Spa',         emoji: '🇧🇪', laps: 44, lapLength: 7.004, type: 'rapide',    tyreWear: 0.7, overtakingEase: 0.7 },
  { name: 'Monza',       emoji: '🇮🇹', laps: 53, lapLength: 5.793, type: 'rapide',    tyreWear: 0.5, overtakingEase: 0.8 },
  { name: 'Bakou',       emoji: '🇦🇿', laps: 51, lapLength: 6.003, type: 'urbain',    tyreWear: 0.5, overtakingEase: 0.6 },
  { name: 'Singapour',   emoji: '🇸🇬', laps: 62, lapLength: 4.940, type: 'urbain',    tyreWear: 0.5, overtakingEase: 0.2 },
  { name: 'Austin',      emoji: '🇺🇸', laps: 56, lapLength: 5.513, type: 'mixte',     tyreWear: 0.8, overtakingEase: 0.7 },
  { name: 'Mexico',      emoji: '🇲🇽', laps: 71, lapLength: 4.304, type: 'mixte',     tyreWear: 0.6, overtakingEase: 0.6 },
  { name: 'Sao Paulo',   emoji: '🇧🇷', laps: 71, lapLength: 4.309, type: 'mixte',     tyreWear: 0.7, overtakingEase: 0.7 },
  { name: 'Las Vegas',   emoji: '🇺🇸', laps: 50, lapLength: 6.201, type: 'rapide',    tyreWear: 0.5, overtakingEase: 0.7 },
  { name: 'Abu Dhabi',   emoji: '🇦🇪', laps: 58, lapLength: 5.281, type: 'mixte',     tyreWear: 0.6, overtakingEase: 0.5 },
];

const CIRCUIT_STAT_BONUS = {
  rapide:    { pace: 1.3, qualifying: 1.2 },
  technique: { tyreManagement: 1.3, consistency: 1.2, adaptability: 1.1 },
  urbain:    { racecraft: 1.3, defending: 1.2, consistency: 1.1 },
  mixte:     {},
};

// ═══════════════════════════════════════════════════════════════════
//  MODELES MONGODB
// ═══════════════════════════════════════════════════════════════════

const driverSchema = new mongoose.Schema({
  discordId:    { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  nationality:  { type: String, required: true },
  helmetColor:  { type: String, default: '#FFFFFF' },
  number:       { type: Number, required: true, unique: true, min: 1, max: 99 },
  stats: {
    pace:           { type: Number, default: STAT_BASE },
    qualifying:     { type: Number, default: STAT_BASE },
    wetPace:        { type: Number, default: STAT_BASE },
    tyreManagement: { type: Number, default: STAT_BASE },
    fuelManagement: { type: Number, default: STAT_BASE },
    racecraft:      { type: Number, default: STAT_BASE },
    consistency:    { type: Number, default: STAT_BASE },
    overtaking:     { type: Number, default: STAT_BASE },
    defending:      { type: Number, default: STAT_BASE },
    start:          { type: Number, default: STAT_BASE },
    adaptability:   { type: Number, default: STAT_BASE },
  },
  plcoins:          { type: Number, default: 0 },
  freePoints:       { type: Number, default: FREE_POINTS },
  creationComplete: { type: Boolean, default: false },
  teamId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },

  // Contrat actuel
  contract: {
    salairesParCourse: { type: Number, default: 0 },   // PLcoins garantis par course
    bonusMultiplier:   { type: Number, default: 1.0 }, // Multiplicateur PLcoins course
    bonusPodium:       { type: Number, default: 0 },   // Bonus si podium
    bonusVictoire:     { type: Number, default: 0 },   // Bonus si victoire
    saisonsRestantes:  { type: Number, default: 0 },   // Saisons restantes sur le contrat
    saisonsFirmees:    { type: Number, default: 0 },   // Duree totale signee
  },
  contractBonus: { type: Number, default: 1.0 }, // Alias rapide pour le multiplicateur (compat)

  totalWins:        { type: Number, default: 0 },
  totalPodiums:     { type: Number, default: 0 },
  totalPoles:       { type: Number, default: 0 },
  totalPoints:      { type: Number, default: 0 },
  bestFinish:       { type: Number, default: 99 },
  createdAt:        { type: Date, default: Date.now },
});

driverSchema.methods.overallRating = function () {
  const w = { pace:0.15, qualifying:0.10, wetPace:0.07, tyreManagement:0.12, fuelManagement:0.10, racecraft:0.12, consistency:0.12, overtaking:0.08, defending:0.07, start:0.05, adaptability:0.02 };
  return Math.round(STAT_LIST.reduce((t, s) => t + (this.stats[s] || STAT_BASE) * w[s], 0) * 10) / 10;
};
driverSchema.methods.upgradeCost = function (stat) {
  const cur = this.stats[stat];
  if (cur === undefined || cur >= STAT_MAX) return null;
  return UPGRADE_TIERS.find(t => cur <= t.upTo)?.cost || null;
};
driverSchema.methods.addPlcoins = function (amount) {
  const mult = (this.contract && this.contract.bonusMultiplier) ? this.contract.bonusMultiplier : this.contractBonus;
  const gain = Math.round(amount * mult);
  this.plcoins += gain;
  return gain;
};
driverSchema.methods.applyUpgrade = function (stat) {
  const cost = this.upgradeCost(stat);
  if (!cost) return { ok: false, msg: 'Stat inexistante ou deja au maximum (' + STAT_MAX + ').' };
  if (this.plcoins < cost) return { ok: false, msg: 'Pas assez de PLcoins. Cout : **' + cost + '** | Solde : **' + this.plcoins + '**' };
  const before = this.stats[stat];
  this.stats[stat]++;
  this.plcoins -= cost;
  return { ok: true, msg: 'OK **' + STAT_LABELS[stat] + '** : ' + before + ' -> **' + this.stats[stat] + '** (-' + cost + ' PLcoins)' };
};
driverSchema.methods.applyFreePoint = function (stat) {
  if (this.freePoints <= 0) return { ok: false, msg: "Tu n'as plus de points gratuits." };
  if (this.stats[stat] === undefined) return { ok: false, msg: 'Stat inconnue.' };
  if (this.stats[stat] >= STAT_BASE + FREE_POINTS) return { ok: false, msg: 'Maximum ' + FREE_POINTS + ' points par stat a la creation.' };
  const before = this.stats[stat];
  this.stats[stat]++;
  this.freePoints--;
  return { ok: true, msg: 'OK **' + STAT_LABELS[stat] + '** : ' + before + ' -> **' + this.stats[stat] + '** (' + this.freePoints + ' restant(s))' };
};
driverSchema.methods.buildProfileEmbed = function () {
  const bar = (val) => {
    const f = Math.round((val / 100) * 10);
    const icon = val >= 75 ? '🟩' : val >= 60 ? '🟨' : '🟥';
    return icon.repeat(f) + '⬜'.repeat(10 - f) + ' **' + val + '**';
  };
  const statsBlock = STAT_LIST.map(k => (STAT_LABELS[k] + '                      ').slice(0,22) + ' ' + bar(this.stats[k])).join('
');
  const color = parseInt(this.helmetColor.replace('#', ''), 16) || 0xFFFFFF;
  return {
    title: '🏎️ #' + this.number + ' — ' + this.name,
    description: '**' + this.nationality + '** | ' + (this.teamId ? 'En ecurie' : 'Sans ecurie 🔍') + '
💰 **' + this.plcoins.toLocaleString() + ' PLcoins** | Multiplicateur : x' + this.contractBonus.toFixed(2) + '
⭐ Note globale : **' + this.overallRating() + '/100**

```
' + statsBlock + '
```',
    color,
    footer: '🏆 ' + this.totalWins + 'W  🥈 ' + this.totalPodiums + ' podiums  🏁 ' + this.totalPoles + ' poles  📍 Meilleur : P' + this.bestFinish,
  };
};
const Driver = mongoose.model('Driver', driverSchema);

const CAR_STAT_MAX = { chassis: 95, engine: 95, reliability: 99, pit: 95 };

const teamSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  color:       { type: String, default: '#FF1801' },
  budget:      { type: Number, default: 0 },
  totalBudget: { type: Number, default: 0 },
  car: {
    chassis:     { type: Number, default: 50 },
    engine:      { type: Number, default: 50 },
    reliability: { type: Number, default: 70 },
    pit:         { type: Number, default: 50 },
  },
  drivers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }],
  createdAt: { type: Date, default: Date.now },
});

teamSchema.methods.carRating = function () {
  const { chassis, engine, reliability, pit } = this.car;
  return Math.round((chassis * 0.35 + engine * 0.35 + reliability * 0.20 + pit * 0.10) * 10) / 10;
};

// Cout pour monter 1 point d'une stat voiture
teamSchema.methods.carUpgradeCost = function (stat) {
  const cur = this.car[stat];
  if (cur === undefined || cur >= CAR_STAT_MAX[stat]) return null;
  if (stat === 'reliability') return 300;
  if (cur < 70) return 500;
  if (cur < 85) return 1000;
  return 2000;
};

// Budget gagne par l'ecurie apres une course selon les positions de ses pilotes
// P1=2000, P2=1500, P3=1200, P4=900, P5=700, P6=500, P7=400, P8=300, P9=200, P10=100
teamSchema.methods.addRaceBudget = function (positions) {
  const prizes = [2000, 1500, 1200, 900, 700, 500, 400, 300, 200, 100];
  let total = 0;
  for (const pos of positions) {
    if (pos >= 1 && pos <= 10) total += prizes[pos - 1];
  }
  this.budget += total;
  this.totalBudget += total;
  return total;
};

// Block formaté des stats voiture pour les embeds
teamSchema.methods.buildCarBlock = function () {
  const bar = (val, max) => {
    const f = Math.round((val / max) * 10);
    const icon = val >= 80 ? '🟩' : val >= 65 ? '🟨' : '🟥';
    return icon.repeat(f) + '⬜'.repeat(10 - f) + ' **' + val + '**';
  };
  const costLine = (stat) => {
    const cost = this.carUpgradeCost(stat);
    return cost ? ' (' + cost + ' budget)' : ' (MAX)';
  };
  return [
    '🏗️ Chassis      ' + bar(this.car.chassis, 95)     + costLine('chassis'),
    '🔩 Moteur       ' + bar(this.car.engine, 95)      + costLine('engine'),
    '🛡️ Fiabilite    ' + bar(this.car.reliability, 99) + costLine('reliability'),
    '⏱️ Pit stops    ' + bar(this.car.pit, 95)         + costLine('pit'),
  ].join('
');
};

const Team = mongoose.model('Team', teamSchema);

const seasonSchema = new mongoose.Schema({
  seasonNumber:   { type: Number, default: 1 },
  currentRound:   { type: Number, default: 0 },
  circuitOrder:   [Number],
  qualifyingGrid: [{ driverId: String, time: Number }],
  elSetups:       [{ driverId: String, bonus: Number }],
  isActive:       { type: Boolean, default: true },

  // Modificateurs reglementaires actifs pour cette saison
  reglement: {
    fuelMultiplier:       { type: Number, default: 1.0 },   // Voitures lourdes/légères
    drsCircuits:          [Number],                          // Index circuits avec DRS booste
    budgetCap:            { type: Number, default: null },   // Plafond budget ecuries (null = pas de cap)
    drsBanned:            { type: Boolean, default: false }, // DRS supprimé pour la saison
    tyreWearMultiplier:   { type: Number, default: 1.0 },   // Multiplicateur d'usure des pneus
    moteurFreeze:         { type: Boolean, default: false }, // Freeze du développement moteur
    doublePointsFinale:   { type: Number, default: 0 },     // Nb de dernières courses en double points
  },

  createdAt: { type: Date, default: Date.now },
});
const Season = mongoose.model('Season', seasonSchema);

// ── Modele RegVote (vote reglementaire) ──────────────────────────────
const regVoteSchema = new mongoose.Schema({
  proposals: [{
    id:          String,
    type:        String,
    titre:       String,
    description: String,
    params:      mongoose.Schema.Types.Mixed,
  }],
  votes:     [{ driverId: String, proposalId: String }],
  status:    { type: String, enum: ['open', 'closed'], default: 'open' },
  expiresAt: { type: Date },
  winner:    { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});
const RegVote = mongoose.model('RegVote', regVoteSchema);

// ── Modele GlobalConfig (configuration globale du jeu) ───────────────
// Stocke l'état inter-saisons : dernière ère réglementaire, compteur, etc.
const globalConfigSchema = new mongoose.Schema({
  lastRegChangeSeason:  { type: Number, default: 0 }, // Numéro de la dernière saison ayant eu un changement réglementaire
  nextRegTriggerIn:     { type: Number, default: 3 }, // Dans combien de saisons après la dernière, le prochain vote se déclenchera (3 ou 4)
  regHistory: [{
    seasonNumber:  Number,
    type:          String,
    titre:         String,
    description:   String,
    winner:        String, // id proposition gagnante (A/B/C)
    appliedAt:     { type: Date, default: Date.now },
  }],
});
const GlobalConfig = mongoose.model('GlobalConfig', globalConfigSchema);

// Helper : récupère ou crée le GlobalConfig unique
async function getConfig() {
  let config = await GlobalConfig.findOne();
  if (!config) {
    config = new GlobalConfig({});
    await config.save();
  }
  return config;
}

// ── Modele Offer (offre de transfert) ──────────────────────────────
const offerSchema = new mongoose.Schema({
  teamId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  driverId:          { type: String, required: true },  // discordId
  status:            { type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' },
  contract: {
    duree:             { type: Number },  // 1-3 saisons
    salairesParCourse: { type: Number },
    bonusMultiplier:   { type: Number },
    bonusPodium:       { type: Number },
    bonusVictoire:     { type: Number },
    bonusSignature:    { type: Number },  // PLcoins immediats a la signature
  },
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});
const Offer = mongoose.model('Offer', offerSchema);

// ═══════════════════════════════════════════════════════════════════
//  CLIENT DISCORD
// ═══════════════════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ═══════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════

const upgradeCmd = new SlashCommandBuilder().setName('upgrade').setDescription('Ameliore une stat avec des PLcoins.');
upgradeCmd.addStringOption(o => {
o.setName('stat').setDescription('La stat a ameliorer').setRequired(true);
  STAT_LIST.forEach(k => o.addChoices({ name: STAT_LABELS[k], value: k }));
  return o;
});

const commands = [
  new SlashCommandBuilder()
    .setName('creer_pilote').setDescription('Cree ton pilote F1.')
    .addStringOption(o => o.setName('nom').setDescription('Nom du pilote').setRequired(true))
.addStringOption(o => o.setName('nationalite').setDescription('Nationalite (ex: FR Francais)').setRequired(true))
    .addIntegerOption(o => o.setName('numero').setDescription('Numero (1-99)').setRequired(true).setMinValue(1).setMaxValue(99))
.addStringOption(o => o.setName('couleur').setDescription('Couleur hex casque (ex: FF0000)').setRequired(false)),
  new SlashCommandBuilder().setName('profil').setDescription('Affiche le profil.').addUserOption(o => o.setName('membre').setDescription('Membre (toi par defaut)').setRequired(false)),
upgradeCmd,
new SlashCommandBuilder().setName('plcoins').setDescription('Affiche ton solde PLcoins.'),
  new SlashCommandBuilder().setName('classement').setDescription('Classement des pilotes.'),
new SlashCommandBuilder().setName('calendrier').setDescription('Calendrier de la saison.'),
  new SlashCommandBuilder().setName('nouvelle_saison').setDescription('[ADMIN] Lance une nouvelle saison.'),
new SlashCommandBuilder().setName('lancer_el').setDescription('[ADMIN] Lance les essais libres.'),
  new SlashCommandBuilder().setName('lancer_qualifs').setDescription('[ADMIN] Lance les qualifications.'),
new SlashCommandBuilder().setName('lancer_course').setDescription('[ADMIN] Lance la course.'),

  // ── Ecuries ──────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('creer_ecurie').setDescription('[ADMIN] Cree une nouvelle ecurie.')
    .addStringOption(o => o.setName('nom').setDescription('Nom de l\'ecurie').setRequired(true))\n.addStringOption(o => o.setName('couleur').setDescription('Couleur hex (ex: FF1801)').setRequired(false))\n.addIntegerOption(o => o.setName('chassis').setDescription('Stat chassis de depart (30-70)').setRequired(false).setMinValue(30).setMaxValue(70))\n.addIntegerOption(o => o.setName('moteur').setDescription('Stat moteur de depart (30-70)').setRequired(false).setMinValue(30).setMaxValue(70))\n.addIntegerOption(o => o.setName('fiabilite').setDescription('Stat fiabilite de depart (50-85)').setRequired(false).setMinValue(50).setMaxValue(85))\n.addIntegerOption(o => o.setName('pit').setDescription('Stat pit stops de depart (30-70)').setRequired(false).setMinValue(30).setMaxValue(70)),\n\nnew SlashCommandBuilder()\n.setName('ecurie').setDescription('Affiche les infos d\'une ecurie.')
    .addStringOption(o => o.setName('nom').setDescription('Nom de l\'ecurie (la tienne par defaut)').setRequired(false)),\n\nnew SlashCommandBuilder()\n.setName('rejoindre_ecurie').setDescription('Rejoins une ecurie en tant que pilote.')\n.addStringOption(o => o.setName('nom').setDescription('Nom de l\'ecurie').setRequired(true)),

new SlashCommandBuilder()
.setName('quitter_ecurie').setDescription('Quitte ton ecurie actuelle.'),

  new SlashCommandBuilder()
    .setName('investir').setDescription('Investis des PLcoins dans ta voiture.')
    .addStringOption(o => {
      o.setName('stat').setDescription('La stat a ameliorer').setRequired(true);
['chassis', 'engine', 'reliability', 'pit'].forEach(s => o.addChoices({ name: s, value: s }));
      return o;
    })
    .addIntegerOption(o => o.setName('montant').setDescription('Nombre de points a acheter').setRequired(true).setMinValue(1).setMaxValue(10)),

new SlashCommandBuilder()
.setName('upgrade_voiture').setDescription('[ADMIN] Upgrade une stat de voiture avec le budget ecurie.')
    .addStringOption(o => o.setName('ecurie').setDescription('Nom de l\'ecurie').setRequired(true))\n.addStringOption(o => {\no.setName('stat').setDescription('Stat a ameliorer').setRequired(true);\n['chassis', 'engine', 'reliability', 'pit'].forEach(s => o.addChoices({ name: s, value: s }));\nreturn o;\n})\n.addIntegerOption(o => o.setName('points').setDescription('Nombre de points').setRequired(true).setMinValue(1).setMaxValue(10)),\n\nnew SlashCommandBuilder()\n.setName('classement_ecuries').setDescription('Classement des ecuries.'),\n\nnew SlashCommandBuilder().setName('proposer_reglement').setDescription('[ADMIN] Lance un vote reglementaire.'),\nnew SlashCommandBuilder().setName('vote_reglement').setDescription('Vote pour une proposition.').addStringOption(o => o.setName('choix').setDescription('A, B ou C').setRequired(true).addChoices({ name: 'A', value: 'A' }, { name: 'B', value: 'B' }, { name: 'C', value: 'C' })),\nnew SlashCommandBuilder().setName('cloturer_vote').setDescription('[ADMIN] Cloture le vote en cours.'),\nnew SlashCommandBuilder().setName('reglement_actuel').setDescription('Affiche le reglement en vigueur.'),\nnew SlashCommandBuilder().setName('historique_reglements').setDescription('Historique des changements reglementaires.'),\n];\n\n// ═══════════════════════════════════════════════════════════════════\n//  EVENTS\n// ═══════════════════════════════════════════════════════════════════\n\nclient.once('ready', async () => {\nconsole.log('✅ Connecte en tant que ' + client.user.tag);\nclient.user.setActivity('🏎️ Saison F1 en cours', { type: 4 });\ntry {\nconst rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);\nawait rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands.map(c => c.toJSON()) });\nconsole.log('⚙️  Slash commands enregistrees');\n} catch (e) { console.error('❌ Erreur enregistrement :', e); }\n});\n\nclient.on('interactionCreate', async (interaction) => {\n// Gestion des boutons d'offre de contrat (arrives en DM)
  if (interaction.isButton()) {
    // Boutons offre de contrat (DM)
    if (interaction.customId.startsWith('offer_')) {
      try { await handleOfferButton(interaction); } catch (e) { console.error('Erreur bouton offre:', e); }
      return;
    }
    // Boutons vote reglementaire (salon)
    if (interaction.customId.startsWith('reg_vote_')) {
      try {
        const vote = await RegVote.findOne({ status: 'open' }).sort({ createdAt: -1 });
        if (!vote) return interaction.reply({ content: '❌ Vote ferme.', ephemeral: true });
        const choix = interaction.customId.replace('reg_vote_', '');
        await enregistrerVote(interaction.user.id, choix, vote._id, interaction);
      } catch (e) { console.error('Erreur bouton vote:', e); }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'creer_pilote')   await cmdCreerPilote(interaction);
    if (interaction.commandName === 'profil')          await cmdProfil(interaction);
    if (interaction.commandName === 'upgrade')         await cmdUpgrade(interaction);
    if (interaction.commandName === 'plcoins')         await cmdPlcoins(interaction);
    if (interaction.commandName === 'classement')      await cmdClassement(interaction);
    if (interaction.commandName === 'calendrier')      await cmdCalendrier(interaction);
    if (interaction.commandName === 'nouvelle_saison') await cmdNouvelleSaison(interaction);
    if (interaction.commandName === 'lancer_el')       { await cmdAdminAck(interaction); lancerEssaisLibres(); }
    if (interaction.commandName === 'lancer_qualifs')  { await cmdAdminAck(interaction); lancerQualifications(); }
    if (interaction.commandName === 'lancer_course')   { await cmdAdminAck(interaction); lancerCourse(); }
    if (interaction.commandName === 'creer_ecurie')     await cmdCreerEcurie(interaction);
    if (interaction.commandName === 'ecurie')            await cmdEcurie(interaction);
    // rejoindre_ecurie desactive — utiliser le systeme de contrats via /lancer_treve
    // quitter_ecurie desactive — les pilotes sont lies par contrat
    if (interaction.commandName === 'investir')          await cmdInvestir(interaction);
    if (interaction.commandName === 'upgrade_voiture')  await cmdUpgradeVoiture(interaction);
    if (interaction.commandName === 'classement_ecuries') await cmdClassementEcuries(interaction);
    if (interaction.commandName === 'lancer_treve')       await cmdLancerTreve(interaction);
    if (interaction.commandName === 'mes_offres')          await cmdMesOffres(interaction);
    if (interaction.commandName === 'mon_contrat')         await cmdMonContrat(interaction);
    if (interaction.commandName === 'marche_transferts')  await cmdMarcheTransferts(interaction);
    if (interaction.commandName === 'proposer_reglement') await cmdProposerReglement(interaction);
    if (interaction.commandName === 'vote_reglement')     await cmdVoteReglement(interaction);
    if (interaction.commandName === 'cloturer_vote')      await cmdCloturerVote(interaction);
    if (interaction.commandName === 'reglement_actuel')   await cmdReglementActuel(interaction);
    if (interaction.commandName === 'historique_reglements') await cmdHistoriqueReglements(interaction);
  } catch (err) {
    console.error('Erreur sur /' + interaction.commandName + ' :', err);
    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };
    interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  COMMANDES
// ═══════════════════════════════════════════════════════════════════

async function cmdCreerPilote(interaction) {
  const existing = await Driver.findOne({ discordId: interaction.user.id });
  if (existing) return interaction.reply({ content: '❌ Tu as deja un pilote ! Utilise /profil.', ephemeral: true });

  const nom         = interaction.options.getString('nom');
  const nationalite = interaction.options.getString('nationalite');
  const numero      = interaction.options.getInteger('numero');
  const rawColor    = interaction.options.getString('couleur') || 'FFFFFF';
  const helmetColor = '#' + rawColor.replace('#', '');

  if (!/^#[0-9A-Fa-f]{6}$/.test(helmetColor))
    return interaction.reply({ content: '❌ Couleur invalide. Format : FF0000', ephemeral: true });
  if (await Driver.findOne({ number: numero }))
    return interaction.reply({ content: '❌ Le numero #' + numero + ' est deja pris !', ephemeral: true });

  const driver = new Driver({ discordId: interaction.user.id, name: nom, nationality: nationalite, helmetColor, number: numero });

  const buildEmbed = () => {
    const lines = STAT_LIST.map(k => (STAT_LABELS[k] + '                      ').slice(0,22) + ' **' + driver.stats[k] + '**').join('
');
    return new EmbedBuilder()
      .setTitle('🏎️ Creation de #' + numero + ' — ' + nom)
      .setDescription('**' + driver.freePoints + ' point(s) restant(s)** a distribuer.\nClique sur un bouton pour ajouter +1.\n\n```\n' + lines + '\n```')
      .setColor(parseInt(helmetColor.replace('#', ''), 16));
  };

  const buildRows = (disabled = false) => {
    const rows = [];
    let row = new ActionRowBuilder();
    STAT_LIST.forEach((key, i) => {
      if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
      const parts = STAT_LABELS[key].split(' ');
      const emoji = parts[0];
      const label = parts.slice(1).join(' ');
      row.addComponents(new ButtonBuilder().setCustomId('fp_' + key).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(disabled || driver.freePoints === 0));
    });
    rows.push(row);
    if (driver.freePoints === 0) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('✅ Confirmer mon pilote').setStyle(ButtonStyle.Success)
      ));
    }
    return rows;
  };

  await interaction.reply({ embeds: [buildEmbed()], components: buildRows(), ephemeral: true });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000,
    filter: i => i.user.id === interaction.user.id,
  });

  collector.on('collect', async (btn) => {
    if (btn.customId === 'confirm') {
      driver.creationComplete = true;
      await driver.save();
      collector.stop();
      return btn.update({
        embeds: [new EmbedBuilder().setTitle('🏎️ Pilote cree !').setDescription('Bienvenue sur la grille, **' + nom + '** #' + numero + ' !\nNote globale : **' + driver.overallRating() + '/100**\n\nUtilise /profil pour voir ta fiche.').setColor(parseInt(helmetColor.replace('#', ''), 16))],
components: [],
});
}
if (btn.customId.startsWith('fp_')) {
      const result = driver.applyFreePoint(btn.customId.replace('fp_', ''));
      if (!result.ok) return btn.reply({ content: '❌ ' + result.msg, ephemeral: true });
      await btn.update({ embeds: [buildEmbed()], components: buildRows() });
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'time') return;
    try { await interaction.editReply({ components: buildRows(true) }); } catch (_) {}
  });
}

async function cmdProfil(interaction) {
  const target = interaction.options.getUser('membre') || interaction.user;
  const driver = await Driver.findOne({ discordId: target.id });
  if (!driver) {
    const who = target.id === interaction.user.id ? "Tu n'as" : '**' + target.username + "** n'a";
    return interaction.reply({ content: '❌ ' + who + " pas encore de pilote. Utilise /creer_pilote !", ephemeral: true });
  }
  const data = driver.buildProfileEmbed();
  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle(data.title).setDescription(data.description).setColor(data.color).setFooter({ text: data.footer }).setThumbnail(target.displayAvatarURL({ dynamic: true }))],
  });
}

async function cmdUpgrade(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: "❌ Tu n'as pas de pilote.", ephemeral: true });
  if (!driver.creationComplete) return interaction.reply({ content: "❌ Termine d'abord la creation de ton pilote !", ephemeral: true });
  const stat = interaction.options.getString('stat');
  const result = driver.applyUpgrade(stat);
  if (result.ok) await driver.save();
  await interaction.reply({ content: (result.ok ? '✅ ' : '❌ ') + result.msg, ephemeral: true });
}

async function cmdPlcoins(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: '❌ Pas de pilote trouve.', ephemeral: true });
  const lines = STAT_LIST.map(k => {
    const cost = driver.upgradeCost(k);
    return (STAT_LABELS[k] + '                      ').slice(0,22) + ' **' + driver.stats[k] + '** — ' + (cost ? cost + ' PLcoins' : 'MAX');
  }).join('
');
  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle('💰 PLcoins — ' + driver.name).setDescription('**Solde : ' + driver.plcoins.toLocaleString() + ' PLcoins**\nMultiplicateur contrat : x' + driver.contractBonus.toFixed(2) + '\n\n**Couts upgrade :**\n```\n' + lines + '\n```').setColor(0xFFD700)],
ephemeral: true,
});
}

async function cmdClassement(interaction) {
const drivers = await Driver.find({ creationComplete: true }).sort({ totalPoints: -1 }).limit(20);
if (!drivers.length) return interaction.reply({ content: 'Aucun pilote enregistre.', ephemeral: true });
  const medals = ['🥇', '🥈', '🥉'];
  const lines = drivers.map((d, i) => (i < 3 ? medals[i] : '**' + (i+1) + '.**') + ' #' + d.number + ' **' + d.name + '** — ' + d.totalPoints + ' pts | ' + d.totalWins + 'W | ⭐' + d.overallRating());
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Classement Pilotes').setDescription(lines.join('\n')).setColor(0xE8C200).setTimestamp()] });
}

async function cmdCalendrier(interaction) {
  const season = await Season.findOne({ isActive: true });
  if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });
  const lines = season.circuitOrder.map((ci, i) => {
    const c = CIRCUITS[ci];
    const status = i < season.currentRound ? '✅' : i === season.currentRound ? '🔴 EN COURS' : '⏳';
    return status + ' **Manche ' + (i+1) + '** — ' + c.emoji + ' ' + c.name + ' (' + c.laps + ' tours)';
  });
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle('📅 Calendrier — Saison ' + season.seasonNumber).setDescription(lines.join('\n')).setColor(0x3498DB)] });
}

async function cmdAdminAck(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });
  await interaction.reply({ content: '✅ Session lancee !', ephemeral: true });
}

async function cmdNouvelleSaison(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });
  await Season.updateMany({}, { isActive: false });
  const order = [...Array(CIRCUITS.length).keys()].sort(() => Math.random() - 0.5);
  const count = await Season.countDocuments();
  const season = new Season({ seasonNumber: count + 1, circuitOrder: order });
  await season.save();
  const calendrier = order.map((ci, i) => '**Manche ' + (i+1) + '** — ' + CIRCUITS[ci].emoji + ' ' + CIRCUITS[ci].name).join('
');
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏁 Saison ' + season.seasonNumber + ' lancee !').setDescription('Calendrier aleatoire :\n\n' + calendrier).setColor(0x2ECC71)] });
}

// ═══════════════════════════════════════════════════════════════════
//  MOTEUR DE SIMULATION
// ═══════════════════════════════════════════════════════════════════

const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const chance  = (pct)      => Math.random() < pct;
const sleep   = (ms)       => new Promise(r => setTimeout(r, ms));
const fmtTime = (s)        => { const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(3).padStart(6,'0'); };

function calcBaseLapTime(driver, team, circuit) {
  const s = driver.stats;
  const c = team ? team.car : { chassis: 40, engine: 40 };
  const bonus = CIRCUIT_STAT_BONUS[circuit.type] || {};
  const driverScore =
    s.pace            * (bonus.pace           || 1.0) * 0.25 +
    s.consistency     * (bonus.consistency    || 1.0) * 0.20 +
    s.tyreManagement  * (bonus.tyreManagement || 1.0) * 0.15 +
    s.fuelManagement  * (bonus.fuelManagement || 1.0) * 0.10 +
    s.racecraft       * (bonus.racecraft      || 1.0) * 0.15 +
    s.adaptability    * (bonus.adaptability   || 1.0) * 0.15;
  const carScore    = c.chassis * 0.5 + c.engine * 0.5;
  const globalScore = driverScore * 0.55 + carScore * 0.45;
  const baseRef     = circuit.lapLength * 60 / 220;
  return baseRef + (100 - globalScore) / 100 * 0.08 * baseRef;
}

function calcLapTime(driver, team, circuit, state) {
  const base      = calcBaseLapTime(driver, team, circuit);
  const tyreDeg   = state.tyreWear * 3.0 * circuit.tyreWear;
  const fuelMult  = (state.fuelMultiplier || 1.0);
  const fuelSave  = state.lapNumber * 0.03 / fuelMult; // Voitures lourdes = economie carburant reduite
  const tyreBase  = { soft: -0.8, medium: 0, hard: 0.6 }[state.tyre] || 0;
  const mgmt      = (driver.stats.tyreManagement - 50) / 100 * 0.5;
  const fuel      = (driver.stats.fuelManagement - 50) / 100 * 0.01 * state.lapNumber;
  const variance  = (1 - driver.stats.consistency / 100) * rand(-0.3, 0.3);
  const scDelta   = state.safetyCar ? rand(25, 35) : 0;
  const rainDelta = state.isWet ? rand(4, 8) - (driver.stats.wetPace - 50) / 100 * 3 : 0;
  return base + tyreDeg - fuelSave + tyreBase - mgmt - fuel + variance + scDelta + rainDelta;
}

function calcStrategy(driver, circuit) {
  return driver.stats.tyreManagement >= 60 || circuit.tyreWear < 0.6
    ? [{ lap: Math.floor(circuit.laps * 0.45), to: 'hard' }]
    : [{ lap: Math.floor(circuit.laps * 0.30), to: 'medium' }, { lap: Math.floor(circuit.laps * 0.65), to: 'hard' }];
}

function calcPitTime(team) {
  return 22 - (team ? (team.car.pit - 50) / 100 * 3 : 0) + rand(-0.5, 0.5);
}

function rankCars(carState) {
  return [...carState].sort((a, b) => {
    if (a.dnf && !b.dnf) return 1;
    if (!a.dnf && b.dnf) return -1;
    return a.totalTime - b.totalTime;
  });
}

// ── Essais Libres ────────────────────────────────────────────────────
async function lancerEssaisLibres() {
  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  if (!channel) return console.error('❌ RACE_CHANNEL_ID introuvable');
  const season = await Season.findOne({ isActive: true });
  if (!season) return channel.send('❌ Aucune saison active.');
  const circuit = CIRCUITS[season.circuitOrder[season.currentRound]];
  const drivers = await Driver.find({ creationComplete: true });
  if (!drivers.length) return channel.send('❌ Aucun pilote inscrit.');

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🔧 Essais Libres — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription('Les pilotes prennent la piste !\n**' + circuit.laps + ' tours** · ' + circuit.lapLength + ' km/tour · Type : ' + circuit.type).setColor(0x3498DB).setTimestamp()] });

const teams = await Team.find();
const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
const setups = drivers.map(d => ({ driverId: d.discordId, bonus: rand(-0.3, 0.3) }));
season.elSetups = setups;
await season.save();

const times = drivers.map(d => {
const team = d.teamId ? teamMap[d.teamId.toString()] : null;
const setup = setups.find(s => s.driverId === d.discordId);
return { driver: d, time: calcBaseLapTime(d, team, circuit) + (setup ? setup.bonus : 0) + rand(-0.5, 0.5) };
}).sort((a, b) => a.time - b.time);

const lines = times.map((t, i) => '**P' + (i+1) + '** #' + t.driver.number + ' ' + t.driver.name + ' — ' + fmtTime(t.time) + ' ' + (i === 0 ? '🟩 REF' : '+' + (t.time - times[0].time).toFixed(3) + 's'));
  await channel.send({ embeds: [new EmbedBuilder().setTitle('📋 Resultats EL — ' + circuit.emoji + ' ' + circuit.name).setDescription(lines.join('\n')).setColor(0x3498DB).setFooter({ text: 'Qualifications a 15h00 !' })] });
}

// ── Qualifications ───────────────────────────────────────────────────
async function lancerQualifications() {
  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  if (!channel) return;
  const season = await Season.findOne({ isActive: true });
  if (!season) return channel.send('❌ Aucune saison active.');
  const circuit = CIRCUITS[season.circuitOrder[season.currentRound]];
  const drivers = await Driver.find({ creationComplete: true });
  if (!drivers.length) return;

  const teams = await Team.find();
  const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Qualifications — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription("Les pilotes s'elancent pour leur tour rapide... 🔴").setColor(0xE67E22).setTimestamp()] });\nawait sleep(2000);\n\nconst results = [];\nfor (const driver of drivers) {\nconst team = driver.teamId ? teamMap[driver.teamId.toString()] : null;\nconst setup = season.elSetups ? season.elSetups.find(s => s.driverId === driver.discordId) : null;\nconst elBonus = setup ? setup.bonus * 0.5 : 0;\nconst qualBonus = -(driver.stats.qualifying - 50) / 100 * 0.8;\nconst qTime = calcBaseLapTime(driver, team, circuit) + elBonus + qualBonus + rand(-0.4, 0.4);\nresults.push({ driver, time: qTime });\nconst sorted = [...results].sort((a, b) => a.time - b.time);\nconst isP1 = sorted[0].driver.discordId === driver.discordId;\nawait channel.send('🏎️ **#' + driver.number + ' ' + driver.name + '** — ' + fmtTime(qTime) + ' ' + (isP1 ? '🟣 POLE PROVISOIRE' : '+' + (qTime - sorted[0].time).toFixed(3) + 's'));\nawait sleep(1500);\n}\n\nresults.sort((a, b) => a.time - b.time);\nconst pole = results[0].driver;\npole.totalPoles++;\nawait pole.save();\n\nseason.qualifyingGrid = results.map(r => ({ driverId: r.driver.discordId, time: r.time }));\nawait season.save();\n\nconst lines = results.map((r, i) => '**P' + (i+1) + '** #' + r.driver.number + ' ' + r.driver.name + ' — ' + fmtTime(r.time) + ' ' + (i === 0 ? '🟣 POLE' : '+' + (r.time - results[0].time).toFixed(3) + 's'));\nawait channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Grille de depart — ' + circuit.emoji + ' ' + circuit.name).setDescription(lines.join('
')).setColor(0xE67E22).setFooter({ text: 'Course a 18h00 ! Pole : ' + pole.name + ' #' + pole.number })] });
}

// ── Course ───────────────────────────────────────────────────────────
async function lancerCourse() {
  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  if (!channel) return;
  const season = await Season.findOne({ isActive: true });
  if (!season || !season.qualifyingGrid || !season.qualifyingGrid.length)
    return channel.send('❌ Pas de grille. Lance les qualifs en premier !');

  const circuit = CIRCUITS[season.circuitOrder[season.currentRound]];
  const allDrivers = await Driver.find({ creationComplete: true });
  const teams = await Team.find();
  const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));

  const grid = season.qualifyingGrid
    .map(g => ({ driver: allDrivers.find(d => d.discordId === g.driverId) }))
    .filter(g => g.driver);

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🚦 DEPART — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription('**' + circuit.laps + ' tours** · ' + (circuit.laps * circuit.lapLength).toFixed(1) + ' km au total\n\nLes moteurs vrombissent...').setColor(0xE74C3C).setTimestamp()] });
await sleep(3000);

const fuelMultiplier = season.reglement ? (season.reglement.fuelMultiplier || 1.0) : 1.0;
// DRS boost : si le circuit est dans la liste DRS, overtakingEase booste de 0.2
// Mais si DRS est banni cette saison, pas de boost (et réduction de l'overtakingEase)
const drsBanned = season.reglement && season.reglement.drsBanned;
const drsBoost = !drsBanned && season.reglement && season.reglement.drsCircuits &&
season.reglement.drsCircuits.includes(season.circuitOrder[season.currentRound]);
const overtakingModif = drsBanned ? -0.15 : (drsBoost ? 0.2 : 0);
const circuitEffectif = (overtakingModif !== 0)
? { ...circuit, overtakingEase: Math.max(0, Math.min(1, circuit.overtakingEase + overtakingModif)) }
: circuit;

// Multiplicateur d'usure pneus (règlement pneumatiques)
const tyreWearMultiplier = season.reglement ? (season.reglement.tyreWearMultiplier || 1.0) : 1.0;

// Double points sur les dernières courses ?
const doublePointsFinale = season.reglement ? (season.reglement.doublePointsFinale || 0) : 0;
const isDoublePoints = doublePointsFinale > 0 &&
  (season.circuitOrder.length - season.currentRound) <= doublePointsFinale;

const carState = grid.map(({ driver }) => ({
driver,
team: driver.teamId ? teamMap[driver.teamId.toString()] : null,
totalTime: 0,
tyre: 'soft', tyreWear: 0, tyreAge: 0,
    strategy: calcStrategy(driver, circuitEffectif),
    dnf: false, dnfReason: null,
    penalty: 0, pitStops: 0, isWet: false,
    fuelMultiplier,
  }));

  for (const msg of ['🚦🚦🚦🚦🚦', '🚦🚦🚦🚦⬛', '🚦🚦🚦⬛⬛', '🚦🚦⬛⬛⬛', '🚦⬛⬛⬛⬛', '⬛⬛⬛⬛⬛ **DEPART !**']) {
    await channel.send(msg);
    await sleep(800);
  }

  if (chance(0.3)) {
    const victims = carState.filter(() => chance(0.15));
    if (victims.length) {
      await channel.send('⚠️ **INCIDENT AU DEPART !** ' + victims.map(v => '#' + v.driver.number + ' ' + v.driver.name).join(', ') + ' implique(s) ! Penalite de 5s !');
      victims.forEach(v => v.penalty += 5);
    }
  }
  for (const state of carState) {
    if (chance(0.15) && (state.driver.stats.start - 50) / 100 < 0) {
      await channel.send('😬 **#' + state.driver.number + ' ' + state.driver.name + '** rate son depart !');
      state.totalTime += rand(0.5, 2.0);
    }
  }

  let safetyCar = false, scLapsLeft = 0, isWet = false;
  const commentInterval = Math.max(1, Math.floor(circuit.laps / 8));

  for (let lap = 1; lap <= circuit.laps; lap++) {
    const lapComments = [];

    if (safetyCar && --scLapsLeft <= 0) {
      safetyCar = false;
      lapComments.push('🟢 **Safety Car rentre ! La course reprend au tour ' + (lap + 1) + ' !**');
    }

    if (!isWet && lap > circuit.laps * 0.25 && chance(0.03)) {
      isWet = true;
      carState.forEach(s => s.isWet = true);
      lapComments.push('🌧️ **IL PLEUT ! La piste devient glissante !**');
    }

    for (const state of carState) {
      if (state.dnf) continue;

      const pit = state.strategy.find(p => p.lap === lap);
      if (pit) {
        const pitTime = calcPitTime(state.team);
        state.tyre = pit.to; state.tyreWear = 0; state.tyreAge = 0;
        state.totalTime += pitTime; state.pitStops++;
        lapComments.push('🔧 **#' + state.driver.number + ' ' + state.driver.name + '** aux stands -> **' + pit.to.toUpperCase() + '** (' + pitTime.toFixed(1) + 's perdu)');
      }

      state.tyreAge++;
      const degRate = { soft: 0.018, medium: 0.011, hard: 0.006 }[state.tyre] * circuit.tyreWear * tyreWearMultiplier;
      const mgmt = (state.driver.stats.tyreManagement - 50) / 100 * 0.3;
      state.tyreWear = Math.min(1, state.tyreWear + degRate - mgmt * degRate);

      state.totalTime += calcLapTime(state.driver, state.team, circuit, {
        tyreWear: state.tyreWear, lapNumber: lap, tyre: state.tyre, safetyCar, isWet: state.isWet,
        fuelMultiplier: state.fuelMultiplier,
      });

      const reliability = state.team ? state.team.car.reliability : 60;
      if (chance((100 - reliability) / 100 * 0.004)) {
        state.dnf = true;
        state.dnfReason = ['💥 Panne moteur', '🔥 Incendie', '💨 Crevaison', '⚙️ Boite de vitesses'][randInt(0, 3)];
        lapComments.push('🚨 **#' + state.driver.number + ' ' + state.driver.name + ' ABANDONNE !** ' + state.dnfReason + ' !');
        if (!safetyCar && chance(0.6)) {
          safetyCar = true; scLapsLeft = randInt(3, 5);
          lapComments.push('🟡 **SAFETY CAR deployee pour ' + scLapsLeft + ' tours !**');
        }
        continue;
      }

      if (chance(0.008) && !safetyCar) {
        const others = carState.filter(s => !s.dnf && s !== state);
        if (others.length) {
          const victim = others[randInt(0, others.length - 1)];
          lapComments.push('💥 **ACCROCHAGE** entre #' + state.driver.number + ' ' + state.driver.name + ' et #' + victim.driver.number + ' ' + victim.driver.name + ' !');
          state.totalTime += rand(2, 8); victim.totalTime += rand(1, 5);
          if (chance(0.5)) { lapComments.push('🔴 **Penalite 5s** pour #' + state.driver.number + ' ' + state.driver.name + ' !'); state.penalty += 5; }
          if (chance(0.4)) { safetyCar = true; scLapsLeft = randInt(2, 4); lapComments.push('🟡 **SAFETY CAR !**'); }
        }
      }

      if (!safetyCar && chance(0.012)) {
        lapComments.push('🟡 **VSC ! Debris sur la piste au tour ' + lap + ' !**');
        carState.forEach(s => { if (!s.dnf) s.totalTime += rand(5, 10); });
      }
    }

    if (lapComments.length) {
      await channel.send('**[ Tour ' + lap + '/' + circuit.laps + ' ]**
' + lapComments.join('
'));
      await sleep(2000);
    }

    if (lap % commentInterval === 0 || lap === circuit.laps) {
      const ranked = rankCars(carState);
      const top5 = ranked.slice(0, 5).map((s, i) => {
        if (s.dnf) return '**P' + (i+1) + '** #' + s.driver.number + ' ' + s.driver.name + ' — 🚨 ' + s.dnfReason;
        const gap = i === 0 ? 'LEADER' : '+' + (s.totalTime - ranked[0].totalTime).toFixed(3) + 's';
        return '**P' + (i+1) + '** #' + s.driver.number + ' ' + s.driver.name + ' — ' + gap + ' | ' + s.tyre.toUpperCase() + ' (' + Math.round(s.tyreWear * 100) + '% use)';
      });
      await channel.send({ embeds: [new EmbedBuilder().setTitle('📊 Tour ' + lap + '/' + circuit.laps + ' — ' + circuit.emoji + ' ' + circuit.name).setDescription(top5.join('\n')).setColor(safetyCar ? 0xFFFF00 : isWet ? 0x3498DB : 0xE74C3C).setFooter({ text: safetyCar ? '🟡 Safety Car' : isWet ? '🌧️ Piste mouillee' : '🏎️ Course en cours' })] });
      await sleep(3000);
    }
  }

  // Penalites finales
  carState.forEach(s => { if (!s.dnf) s.totalTime += s.penalty; });
  const final = rankCars(carState);

  for (let i = 0; i < final.length; i++) {
    const s = final[i];
    const pos = i + 1;
    const champPtsBase = !s.dnf && pos <= 10 ? POINTS_TABLE[pos - 1] : 0;
    const champPts = isDoublePoints ? champPtsBase * 2 : champPtsBase;
    const coins    = !s.dnf && pos <= 20 ? (PLCOINS_TABLE[pos - 1] || 2) : 5;
    s.driver.totalPoints += champPts;
    if (pos === 1) s.driver.totalWins++;
    if (pos <= 3 && !s.dnf) s.driver.totalPodiums++;
    if (!s.dnf && pos < s.driver.bestFinish) s.driver.bestFinish = pos;
    s._champPts = champPts;

    // Salaire garanti par course (contrat)
    const salaire = s.driver.contract ? (s.driver.contract.salairesParCourse || 0) : 0;
    s.driver.plcoins += salaire;

    // Clause perf : bonus podium/victoire
    let clauseBonus = 0;
    if (!s.dnf && pos === 1 && s.driver.contract) clauseBonus += s.driver.contract.bonusVictoire || 0;
    if (!s.dnf && pos <= 3 && s.driver.contract) clauseBonus += s.driver.contract.bonusPodium || 0;
    s.driver.plcoins += clauseBonus;

    s._coins = s.driver.addPlcoins(coins);
    s._salaire = salaire;
    s._clause = clauseBonus;
    await s.driver.save();
  }

  const winner = final.find(s => !s.dnf);
  const resultLines = final.map((s, i) => {
    const extras = [];
    if (s._salaire > 0) extras.push('+' + s._salaire + ' salaire');
    if (s._clause  > 0) extras.push('+' + s._clause  + ' clause');
    const extrasStr = extras.length ? ' (' + extras.join(', ') + ')' : '';
    if (s.dnf) return '**DNF** #' + s.driver.number + ' ' + s.driver.name + ' — ' + s.dnfReason + ' | +' + s._salaire + ' salaire | +' + s._coins + ' PLcoins';
    const pen = s.penalty > 0 ? ' ⚠️+' + s.penalty + 's' : '';
    return '**P' + (i+1) + '** #' + s.driver.number + ' ' + s.driver.name + pen + ' — +' + s._champPts + ' pts | +' + s._coins + ' PLcoins' + extrasStr;
  });

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🏆 RESULTATS — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription('🥇 **VAINQUEUR : ' + (winner ? winner.driver.name + ' #' + winner.driver.number : 'Aucun') + '**' + (isDoublePoints ? '\n✨ **DOUBLE POINTS — Manche finale !**' : '') + '\n\n' + resultLines.join('\n')).setColor(0xFFD700).setTimestamp().setFooter({ text: 'Saison ' + season.seasonNumber + ' · Manche ' + (season.currentRound + 1) + '/' + CIRCUITS.length })] });

// ── Budget ecuries selon les positions ─────────────────────────────
const allTeams = await Team.find();
for (const team of allTeams) {
const teamDriverIds = team.drivers.map(id => id.toString());
const positions = final
.map((s, i) => ({ id: s.driver._id.toString(), pos: i + 1, dnf: s.dnf }))
.filter(x => teamDriverIds.includes(x.id) && !x.dnf)
.map(x => x.pos);

if (positions.length) {
const gained = team.addRaceBudget(positions);
await team.save();
if (gained > 0) {
await channel.send('💰 **' + team.name + '** gagne **' + gained.toLocaleString() + ' budget** suite aux resultats de la course ! (Total : ' + team.budget.toLocaleString() + ')');
      }
    }
  }

  season.currentRound++;
  season.qualifyingGrid = [];
  season.elSetups = [];
  if (season.currentRound >= CIRCUITS.length) {
    season.isActive = false;
    await channel.send('🏁 **FIN DE SAISON !** La treve hivernale commence !\n\nLes ecuries peuvent maintenant upgrader leurs voitures avec le budget accumule grace a /upgrade_voiture.');

    // ── Vérification du déclenchement automatique réglementaire ────────
    await verifierEtDeclencherVoteReglementaire(season, channel);
  }
  await season.save();
}

// ═══════════════════════════════════════════════════════════════════
//  SYSTÈME RÉGLEMENTAIRE AUTOMATIQUE — Toutes les 3-4 saisons
// ═══════════════════════════════════════════════════════════════════

/**
 * Vérifie si un changement de règlement doit avoir lieu après la fin de saison.
 * Se déclenche automatiquement si (seasonNumber - lastRegChangeSeason) >= nextRegTriggerIn
 * Crée le vote, le poste dans le salon, et programme la clôture automatique après 48h.
 */
async function verifierEtDeclencherVoteReglementaire(season, channel) {
  try {
    const config = await getConfig();
    const saisonDepuisDernierReg = season.seasonNumber - config.lastRegChangeSeason;

    if (saisonDepuisDernierReg < config.nextRegTriggerIn) {
      // Pas encore le moment — on annonce combien de saisons il reste
      const restant = config.nextRegTriggerIn - saisonDepuisDernierReg;
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('📋 Bilan réglementaire — Saison ' + season.seasonNumber)
          .setDescription(
            '🗓️ **' + restant + ' saison(s)** avant le prochain changement réglementaire majeur.\n' +
            'Dernier changement : Saison ' + (config.lastRegChangeSeason || 'aucun') + ' | Prochain : dans ' + restant + ' saison(s)'
          )
          .setColor(0x95A5A6)
        ]
      });
      return;
    }

    // C'est le moment ! On déclenche le vote réglementaire automatiquement
    await sleep(3000);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ CHANGEMENT D\'ÈRE RÉGLEMENTAIRE IMMINENT !')
        .setDescription(
          '**' + saisonDepuisDernierReg + ' saisons** se sont écoulées depuis le dernier grand changement réglementaire.\n\n' +
          'La FIA prépare une **révolution des règles** pour la prochaine saison !\n' +
          'Un vote va s\'ouvrir pour décider de la direction prise...\n\n' +
          '🗳️ Tous les pilotes auront **48h** pour voter.'
        )
        .setColor(0xFF6B35)
        .setTimestamp()
      ]
    });
    await sleep(4000);

    // Vérifier qu'aucun vote n'est déjà ouvert
    const existingVote = await RegVote.findOne({ status: 'open' });
    if (existingVote) {
      await channel.send('⚠️ Un vote réglementaire est déjà en cours — le déclenchement automatique est annulé. Clôturez-le d\'abord avec /cloturer_vote.');
      return;
    }

    // Générer les propositions et créer le vote
    const proposals = genererPropositions();
    const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const vote = new RegVote({ proposals, expiresAt });
    await vote.save();

    const desc = proposals.map(p =>
      '**Proposition ' + p.id + ' — ' + p.titre + '**\n' + p.description + '\n'
    ).join('\n');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reg_vote_A').setLabel('Voter A').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reg_vote_B').setLabel('Voter B').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('reg_vote_C').setLabel('Voter C').setStyle(ButtonStyle.Primary),
    );

    const msg = await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🗳️ VOTE RÉGLEMENTAIRE AUTOMATIQUE — Saison ' + (season.seasonNumber + 1))
        .setDescription(desc + '\n⏰ Vote ouvert **48h** — utilisez les boutons ou `/vote_reglement`\n\n📌 Clôture automatique dans 48h.')
        .setColor(0xFF6B35)
        .setTimestamp()
        .setFooter({ text: 'Vote auto déclenché · ID : ' + vote._id })
      ],
      components: [row],
    });

    // Collecteur boutons (48h)
    const collector = msg.createMessageComponentCollector({ time: 48 * 60 * 60 * 1000 });
    collector.on('collect', async (btn) => {
      if (!btn.customId.startsWith('reg_vote_')) return;
      const choix = btn.customId.replace('reg_vote_', '');
      await enregistrerVote(btn.user.id, choix, vote._id, btn);
    });
    collector.on('end', async () => {
      // Clôture automatique à l'expiration du collecteur
      const voteActuel = await RegVote.findById(vote._id);
      if (voteActuel && voteActuel.status === 'open') {
        await cloturerVoteAuto(voteActuel, channel, season.seasonNumber + 1);
      }
    });

    // Mettre à jour le trigger pour la PROCHAINE fois (3 ou 4 saisons de manière aléatoire)
    config.nextRegTriggerIn = randInt(3, 4);
    await config.save();

    console.log('✅ Vote réglementaire automatique lancé pour la saison ' + (season.seasonNumber + 1) + '. Prochain dans ' + config.nextRegTriggerIn + ' saisons.');

  } catch (err) {
    console.error('❌ Erreur lors du déclenchement réglementaire auto :', err);
  }
}

/**
 * Clôture automatique d'un vote (après expiration 48h).
 * Même logique que cmdCloturerVote mais sans interaction Discord.
 */
async function cloturerVoteAuto(vote, channel, prochaineSaison) {
  try {
    const counts = { A: 0, B: 0, C: 0 };
    vote.votes.forEach(v => { if (counts[v.proposalId] !== undefined) counts[v.proposalId]++; });

    const totalVotes = counts.A + counts.B + counts.C;

    // Si personne n'a voté → tirage au sort complet
    const maxVotes = Math.max(...Object.values(counts));
    const winners  = totalVotes === 0
      ? ['A', 'B', 'C']
      : Object.keys(counts).filter(k => counts[k] === maxVotes);
    const winnerId = winners[randInt(0, winners.length - 1)];
    const winner   = vote.proposals.find(p => p.id === winnerId);

    vote.status = 'closed';
    vote.winner = winnerId;
    await vote.save();

    const egaliteNote = winners.length > 1 && totalVotes > 0 ? '⚡ Égalité ! Tirage au sort...\n\n' : '';
    const aucunVoteNote = totalVotes === 0 ? '📭 Aucun vote reçu — tirage au sort aléatoire !\n\n' : '';

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🗳️ Résultats du vote réglementaire !')
        .setDescription(
          '**A:** ' + counts.A + ' vote(s) | **B:** ' + counts.B + ' vote(s) | **C:** ' + counts.C + ' vote(s)\n\n' +
          aucunVoteNote + egaliteNote +
          '🏆 **GAGNANT : Proposition ' + winnerId + ' — ' + winner.titre + '**\n' + winner.description
        )
        .setColor(0xFFD700)
        .setTimestamp()
      ]
    });

    await sleep(2000);

    // Appliquer le règlement sur la prochaine saison active (ou la créer au moment voulu)
    // Pour l'instant : on stocke le winner dans GlobalConfig.regHistory et on l'applique à la nouvelle saison au /nouvelle_saison
    const config = await getConfig();
    config.lastRegChangeSeason = prochaineSaison || (await Season.countDocuments());
    config.regHistory.push({
      seasonNumber: prochaineSaison || config.lastRegChangeSeason,
      type:         winner.type,
      titre:        winner.titre,
      description:  winner.description,
      winner:       winnerId,
    });
    await config.save();

    // Applique immédiatement sur la saison active s'il y en a une
    const activeSeason = await Season.findOne({ isActive: true });
    const regType = REG_TYPES[winner.type];
    if (regType) {
      await regType.appliquer(winner.params, activeSeason, channel);
      if (activeSeason) await activeSeason.save();
    }

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Règlement appliqué pour la saison ' + (prochaineSaison || 'prochaine') + ' !')
        .setDescription('Le changement prendra pleinement effet dès le début de la prochaine saison.\n\nUtilisez `/reglement_actuel` pour consulter les règles en vigueur.')
        .setColor(0x2ECC71)
      ]
    });
  } catch (err) {
    console.error('❌ Erreur clôture automatique vote :', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  COMMANDES ECURIES
// ═══════════════════════════════════════════════════════════════════

// ── /creer_ecurie (admin) ────────────────────────────────────────────
async function cmdCreerEcurie(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });

  const nom        = interaction.options.getString('nom');
  const rawColor   = interaction.options.getString('couleur') || 'FF1801';
  const color      = '#' + rawColor.replace('#', '');
  const chassis    = interaction.options.getInteger('chassis')    || 50;
  const engine     = interaction.options.getInteger('moteur')     || 50;
  const reliability= interaction.options.getInteger('fiabilite')  || 70;
  const pit        = interaction.options.getInteger('pit')        || 50;

  if (await Team.findOne({ name: nom }))
    return interaction.reply({ content: '❌ Une ecurie avec ce nom existe deja.', ephemeral: true });

  const team = new Team({ name: nom, color, car: { chassis, engine, reliability, pit } });
  await team.save();

  const embed = new EmbedBuilder()
    .setTitle('🏎️ Ecurie creee : ' + nom)
    .setDescription('**Note voiture : ' + team.carRating() + '/100**\n\n```\n' + team.buildCarBlock() + '\n```\n\n💰 Budget : **0**\nPilotes : aucun pour l\'instant.')\n.setColor(parseInt(color.replace('#', ''), 16) || 0xFF1801);\n\nawait interaction.reply({ embeds: [embed] });\n}\n\n// ── /ecurie ──────────────────────────────────────────────────────────\nasync function cmdEcurie(interaction) {\nconst nomOpt = interaction.options.getString('nom');\nlet team;\n\nif (nomOpt) {\nteam = await Team.findOne({ name: { $regex: new RegExp('^' + nomOpt + '$', 'i') } });\n} else {\nconst driver = await Driver.findOne({ discordId: interaction.user.id });\nif (!driver || !driver.teamId)\nreturn interaction.reply({ content: "❌ Tu n\'as pas d\'ecurie. Passe un nom en parametre ou rejoins une ecurie.", ephemeral: true });\nteam = await Team.findById(driver.teamId);\n}\n\nif (!team) return interaction.reply({ content: '❌ Ecurie introuvable.', ephemeral: true });\n\nconst driverDocs = await Driver.find({ _id: { $in: team.drivers } });\nconst pilotesList = driverDocs.length\n? driverDocs.map(d => '#' + d.number + ' **' + d.name + '** ⭐' + d.overallRating()).join('
')
    : 'Aucun pilote';

  const color = parseInt(team.color.replace('#', ''), 16) || 0xFF1801;
  const embed = new EmbedBuilder()
    .setTitle('🏎️ ' + team.name)
    .setDescription(
      '**Note voiture : ' + team.carRating() + '/100**

```
' + team.buildCarBlock() + '
```' +
      '

💰 Budget disponible : **' + team.budget.toLocaleString() + '**' +
      '
📈 Budget total cumule : **' + team.totalBudget.toLocaleString() + '**' +
      '

**Pilotes :**
' + pilotesList
    )
    .setColor(color);

  await interaction.reply({ embeds: [embed] });
}

// ── /rejoindre_ecurie ────────────────────────────────────────────────
async function cmdRejoindreEcurie(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: "❌ Tu n\'as pas de pilote.", ephemeral: true });
  if (!driver.creationComplete) return interaction.reply({ content: "❌ Termine la creation de ton pilote d\'abord.", ephemeral: true });
  if (driver.teamId) return interaction.reply({ content: "❌ Tu es deja dans une ecurie. Quitte-la d\'abord avec /quitter_ecurie.", ephemeral: true });

  const nom  = interaction.options.getString('nom');
  const team = await Team.findOne({ name: { $regex: new RegExp('^' + nom + '$', 'i') } });
  if (!team) return interaction.reply({ content: '❌ Ecurie **' + nom + '** introuvable.', ephemeral: true });
  if (team.drivers.length >= 2) return interaction.reply({ content: "❌ Cette ecurie est complete (2 pilotes max).", ephemeral: true });

  team.drivers.push(driver._id);
  driver.teamId = team._id;
  await team.save();
  await driver.save();

  const color = parseInt(team.color.replace('#', ''), 16) || 0xFF1801;
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ ' + driver.name + ' rejoint ' + team.name + ' !')
      .setDescription('Bienvenue dans l\'ecurie, **#' + driver.number + ' ' + driver.name + '** !
Note voiture : **' + team.carRating() + '/100**')
      .setColor(color)
    ]
  });
}

// ── /quitter_ecurie ──────────────────────────────────────────────────
async function cmdQuitterEcurie(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver || !driver.teamId) return interaction.reply({ content: "❌ Tu n\'es dans aucune ecurie.", ephemeral: true });

  const team = await Team.findById(driver.teamId);
  if (team) {
    team.drivers = team.drivers.filter(id => id.toString() !== driver._id.toString());
    await team.save();
  }

  driver.teamId = null;
  driver.contractBonus = 1.0;
  await driver.save();

  await interaction.reply({ content: '✅ Tu as quitte **' + (team ? team.name : 'ton ecurie') + '**. Tu es maintenant pilote libre.', ephemeral: true });
}

// ── /investir ────────────────────────────────────────────────────────
async function cmdInvestir(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: "❌ Pas de pilote.", ephemeral: true });
  if (!driver.teamId) return interaction.reply({ content: "❌ Tu dois etre dans une ecurie pour investir.", ephemeral: true });

  const team   = await Team.findById(driver.teamId);
  if (!team) return interaction.reply({ content: "❌ Ecurie introuvable.", ephemeral: true });

  const stat   = interaction.options.getString('stat');
  const points = interaction.options.getInteger('montant');

  let totalCost = 0;
  const results = [];

  for (let i = 0; i < points; i++) {
    const cost = team.carUpgradeCost(stat);
    if (!cost) { results.push('MAX atteint !'); break; }
    if (driver.plcoins < totalCost + cost) { results.push('PLcoins insuffisants apres ' + i + ' point(s).'); break; }
    totalCost += cost;
    team.car[stat]++;
    results.push('+1 ' + stat + ' (' + cost + ' PLcoins)');
  }

  driver.plcoins -= totalCost;
  await team.save();
  await driver.save();

  const statNames = { chassis: '🏗️ Chassis', engine: '🔩 Moteur', reliability: '🛡️ Fiabilite', pit: '⏱️ Pit stops' };
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('💰 Investissement — ' + team.name)
      .setDescription(
        '**' + statNames[stat] + '** : **' + team.car[stat] + '**
' +
        'Total depense : **' + totalCost + ' PLcoins**
' +
        'Note voiture : **' + team.carRating() + '/100**

' +
        results.join('
')
      )
      .setColor(parseInt(team.color.replace('#', ''), 16) || 0xFF1801)
    ],
    ephemeral: true,
  });
}

// ── /upgrade_voiture (admin) ─────────────────────────────────────────
async function cmdUpgradeVoiture(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });

  const nomEcurie = interaction.options.getString('ecurie');
  const stat      = interaction.options.getString('stat');
  const points    = interaction.options.getInteger('points');

  const team = await Team.findOne({ name: { $regex: new RegExp('^' + nomEcurie + '$', 'i') } });
  if (!team) return interaction.reply({ content: '❌ Ecurie introuvable.', ephemeral: true });

  let totalCost = 0;
  let upgraded  = 0;
  for (let i = 0; i < points; i++) {
    const cost = team.carUpgradeCost(stat);
    if (!cost) break;
    if (team.budget < totalCost + cost) break;
    totalCost += cost;
    team.car[stat]++;
    upgraded++;
  }

  if (upgraded === 0)
    return interaction.reply({ content: '❌ Impossible : budget insuffisant (' + team.budget + ') ou stat deja au max.', ephemeral: true });

  team.budget -= totalCost;
  await team.save();

  const statNames = { chassis: '🏗️ Chassis', engine: '🔩 Moteur', reliability: '🛡️ Fiabilite', pit: '⏱️ Pit stops' };
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('🔧 Upgrade voiture — ' + team.name)
      .setDescription(
        '**' + statNames[stat] + '** : **' + team.car[stat] + '**
' +
        'Cout total : **' + totalCost + ' budget**
' +
        'Budget restant : **' + team.budget + '**
' +
        'Note voiture : **' + team.carRating() + '/100**'
      )
      .setColor(parseInt(team.color.replace('#', ''), 16) || 0xFF1801)
    ]
  });
}

// ── /classement_ecuries ──────────────────────────────────────────────
async function cmdClassementEcuries(interaction) {
  const teams = await Team.find().sort({ totalBudget: -1 });
  if (!teams.length) return interaction.reply({ content: '❌ Aucune ecurie creee.', ephemeral: true });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = await Promise.all(teams.map(async (t, i) => {
    const drivers = await Driver.find({ _id: { $in: t.drivers } });
    const pilotes = drivers.map(d => '#' + d.number + ' ' + d.name).join(', ') || 'Aucun pilote';
    return (i < 3 ? medals[i] : '**' + (i+1) + '.**') +
      ' **' + t.name + '** — Voiture : ⭐' + t.carRating() +
      ' | Budget total : ' + t.totalBudget.toLocaleString() +
      '
   └ ' + pilotes;
  }));

  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle('🏎️ Classement Ecuries').setDescription(lines.join('\n')).setColor(0xE74C3C).setTimestamp()]
  });
}


// ═══════════════════════════════════════════════════════════════════
//  SYSTEME DE CONTRATS & TRANSFERTS
// ═══════════════════════════════════════════════════════════════════

// ── Genere une offre intelligente selon le profil de l'ecurie et du pilote ──
function genererOffre(team, driver, driverRating) {
  const carRating   = team.carRating();
  const budget      = team.budget;

  // L'ecurie ajuste sa generosité selon son budget
  const richesse    = Math.min(budget / 5000, 1); // 0 = pauvre, 1 = riche (5000+)

  // Duree : top ecuries (voiture > 70) proposent des contrats plus longs
  const dureeMax    = carRating >= 75 ? 3 : carRating >= 60 ? 2 : 1;
  const duree       = Math.floor(Math.random() * dureeMax) + 1;

  // Multiplicateur : 1.0 a 2.0 selon richesse et attractivite du pilote
  const multBase    = 1.0 + richesse * 0.7 + (driverRating - 50) / 100 * 0.3;
  const bonusMultiplier = Math.round(Math.min(2.0, multBase) * 100) / 100;

  // Salaire par course : 20 a 300 PLcoins selon richesse
  const salairesParCourse = Math.round(20 + richesse * 280);

  // Bonus signature : 0 a 2000 PLcoins selon richesse
  const bonusSignature = Math.round(richesse * 2000 / 100) * 100;

  // Clauses perf : meilleures chez les top ecuries
  const bonusPodium   = Math.round((100 + richesse * 200) / 50) * 50;  // 100-300
  const bonusVictoire = Math.round((200 + richesse * 500) / 100) * 100; // 200-700

  return { duree, bonusMultiplier, salairesParCourse, bonusSignature, bonusPodium, bonusVictoire };
}

// ── Lance la treve des transferts ────────────────────────────────────
async function lancerTreve() {
  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  if (!channel) return;

  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('❄️ TREVE DES TRANSFERTS')
      .setDescription('La saison est terminee ! Les ecuries etudient le marche...\nLes offres de contrat vont etre envoyees aux pilotes dans quelques instants.\n\nChaque pilote recevra ses offres en message prive et aura **48h** pour repondre.')
      .setColor(0x5865F2)
      .setTimestamp()
    ]
  });

  await sleep(3000);

  const teams   = await Team.find();
  const drivers = await Driver.find({ creationComplete: true });

  // Expire les offres en attente de la saison precedente
  await Offer.updateMany({ status: 'pending' }, { status: 'expired' });

  // Reduit les contrats de 1 saison pour tout le monde
  for (const driver of drivers) {
    if (driver.contract && driver.contract.saisonsRestantes > 0) {
      driver.contract.saisonsRestantes--;
      // Contrat expire : pilote libre
      if (driver.contract.saisonsRestantes === 0) {
        const oldTeam = await Team.findById(driver.teamId);
        if (oldTeam) {
          oldTeam.drivers = oldTeam.drivers.filter(id => id.toString() !== driver._id.toString());
          await oldTeam.save();
        }
        driver.teamId = null;
        driver.contract = { salairesParCourse: 0, bonusMultiplier: 1.0, bonusPodium: 0, bonusVictoire: 0, saisonsRestantes: 0, saisonsFirmees: 0 };
        driver.contractBonus = 1.0;
        await channel.send('📋 Le contrat de **' + driver.name + '** avec **' + (oldTeam ? oldTeam.name : 'son ecurie') + '** est arrive a expiration. Il est maintenant **pilote libre** !');
      }
      await driver.save();
    }
  }

  await sleep(2000);

  // Chaque ecurie ayant une place libre fait des offres aux meilleurs pilotes dispo
  const pilotsLibres = await Driver.find({ creationComplete: true, teamId: null });
  const offresEnvoyees = [];

  for (const team of teams) {
    if (team.drivers.length >= 2) continue; // Ecurie complete

    const placesLibres = 2 - team.drivers.length;
    const carRating    = team.carRating();

    // Trie les pilotes libres par compatibilite avec l'ecurie
    // Ecuries rapides cherchent pilotes avec bon pace/qualifying
    // Ecuries techniques cherchent consistency/tyreManagement
    const candidats = pilotsLibres
      .filter(d => !offresEnvoyees.some(o => o.driverId === d.discordId && o.teamId.toString() === team._id.toString()))
      .map(d => {
        const rating   = d.overallRating();
        // Compatibilite : ecart entre note voiture et note pilote (les deux doivent etre proches)
        const compat   = 100 - Math.abs(carRating - rating) * 0.5;
        return { driver: d, rating, compat };
      })
      .sort((a, b) => b.compat - a.compat)
      .slice(0, placesLibres * 2); // Top candidats (x2 pour avoir de la marge si refus)

    for (const { driver, rating } of candidats) {
      const offreData = genererOffre(team, driver, rating);

      const offer = new Offer({
        teamId:    team._id,
        driverId:  driver.discordId,
        contract:  offreData,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h
      });
      await offer.save();
      offresEnvoyees.push({ teamId: team._id, driverId: driver.discordId });

      // Envoie l'offre en DM au pilote
      try {
        const discordUser = await client.users.fetch(driver.discordId);
        const embed = new EmbedBuilder()
          .setTitle('📨 Offre de contrat — ' + team.name)
          .setDescription(
            '**' + team.name + '** te propose un contrat !

' +
            '**Duree :** ' + offreData.duree + ' saison(s)
' +
            '**Multiplicateur PLcoins :** x' + offreData.bonusMultiplier.toFixed(2) + '
' +
            '**Salaire par course :** ' + offreData.salairesParCourse + ' PLcoins garantis
' +
            '**Bonus signature :** ' + offreData.bonusSignature + ' PLcoins (immediats)
' +
            '**Bonus podium :** +' + offreData.bonusPodium + ' PLcoins
' +
            '**Bonus victoire :** +' + offreData.bonusVictoire + ' PLcoins

' +
            '**Note voiture :** ' + carRating + '/100

' +
            '⏰ Offre valable **48h** — Reponds vite !'
          )
          .setColor(parseInt(team.color.replace('#', ''), 16) || 0xFF1801)
          .setFooter({ text: 'ID offre : ' + offer._id });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('offer_accept_' + offer._id).setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('offer_decline_' + offer._id).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
        );

        await discordUser.send({ embeds: [embed], components: [row] });
        await channel.send('📨 **' + team.name + '** envoie une offre a **' + driver.name + '** (#' + driver.number + ')');
      } catch (e) {
        console.error('DM echoue pour ' + driver.name + ':', e.message);
        await channel.send('⚠️ Impossible d\'envoyer l\'offre a **' + driver.name + '** (DMs fermes ?)');
      }

      await sleep(1000);
    }
  }

  if (offresEnvoyees.length === 0) {
    await channel.send('ℹ️ Aucun pilote libre sur le marche. Toutes les ecuries sont completes ou tous les pilotes sont sous contrat.');
  } else {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Treve des transferts ouverte')
        .setDescription(offresEnvoyees.length + ' offre(s) envoyee(s) !\nLes pilotes ont **48h** pour repondre en DM.\nUtilise `/marche_transferts` pour voir les pilotes libres.')
        .setColor(0x5865F2)
      ]
    });
  }
}

// ── Gestion des boutons accepter/refuser en DM ────────────────────────
async function handleOfferButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('offer_accept_') && !id.startsWith('offer_decline_')) return false;

  const offerId = id.replace('offer_accept_', '').replace('offer_decline_', '');
  const accept  = id.startsWith('offer_accept_');

  const offer  = await Offer.findById(offerId);
  if (!offer)  return interaction.reply({ content: '❌ Offre introuvable ou expiree.', ephemeral: true });
  if (offer.status !== 'pending') return interaction.reply({ content: '❌ Cette offre a deja ete traitee.', ephemeral: true });
  if (offer.driverId !== interaction.user.id) return interaction.reply({ content: '❌ Cette offre ne te concerne pas.', ephemeral: true });
  if (new Date() > offer.expiresAt) {
    offer.status = 'expired';
    await offer.save();
    return interaction.reply({ content: '❌ Cette offre a expire.', ephemeral: true });
  }

  const driver = await Driver.findOne({ discordId: interaction.user.id });
  const team   = await Team.findById(offer.teamId);
  if (!driver || !team) return interaction.reply({ content: '❌ Donnees introuvables.', ephemeral: true });

  if (!accept) {
    offer.status = 'declined';
    await offer.save();
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Offre refusee').setDescription('Tu as refuse l\'offre de **' + team.name + '**. D\'autres offres peuvent arriver !').setColor(0xED4245)],
components: []
});
}

// Acceptation
if (team.drivers.length >= 2) {
offer.status = 'expired';
    await offer.save();
    return interaction.reply({ content: '❌ L\'ecurie **' + team.name + '** est maintenant complete. Trop tard !', ephemeral: true });
  }

  // Annule les autres offres pending de ce pilote
  await Offer.updateMany({ driverId: interaction.user.id, status: 'pending', _id: { $ne: offerId } }, { status: 'expired' });

  // Applique le contrat
  driver.teamId  = team._id;
  driver.contract = {
    salairesParCourse: offer.contract.salairesParCourse,
    bonusMultiplier:   offer.contract.bonusMultiplier,
    bonusPodium:       offer.contract.bonusPodium,
    bonusVictoire:     offer.contract.bonusVictoire,
    saisonsRestantes:  offer.contract.duree,
    saisonsFirmees:    offer.contract.duree,
  };
  driver.contractBonus = offer.contract.bonusMultiplier;

  // Bonus signature immediat
  if (offer.contract.bonusSignature > 0) {
    driver.plcoins += offer.contract.bonusSignature;
  }

  team.drivers.push(driver._id);
  offer.status = 'accepted';

  await driver.save();
  await team.save();
  await offer.save();

  // Annonce dans le salon de course
  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  if (channel) {
    channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🤝 TRANSFERT OFFICIEL')
        .setDescription(
          '**#' + driver.number + ' ' + driver.name + '** signe avec **' + team.name + '** pour **' + offer.contract.duree + ' saison(s)** !

' +
          '📋 Contrat : x' + offer.contract.bonusMultiplier.toFixed(2) + ' PLcoins | ' + offer.contract.salairesParCourse + '/course' +
          (offer.contract.bonusSignature > 0 ? ' | +' + offer.contract.bonusSignature + ' a la signature' : '')
        )
        .setColor(parseInt(team.color.replace('#', ''), 16) || 0xFF1801)
      ]
    });
  }

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ Contrat signe avec ' + team.name + ' !')
      .setDescription(
        'Bienvenue dans l\'ecurie !

' +
        '**Duree :** ' + offer.contract.duree + ' saison(s)
' +
        '**Multiplicateur :** x' + offer.contract.bonusMultiplier.toFixed(2) + '
' +
        '**Salaire :** ' + offer.contract.salairesParCourse + ' PLcoins/course
' +
        (offer.contract.bonusSignature > 0 ? '**Bonus signature :** +' + offer.contract.bonusSignature + ' PLcoins credites !
' : '') +
        '**Clause podium :** +' + offer.contract.bonusPodium + ' PLcoins
' +
        '**Clause victoire :** +' + offer.contract.bonusVictoire + ' PLcoins'
      )
      .setColor(parseInt(team.color.replace('#', ''), 16) || 0xFF1801)
    ],
    components: []
  });

  return true;
}

// ── /lancer_treve (admin) ────────────────────────────────────────────
async function cmdLancerTreve(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });
  await interaction.reply({ content: '❄️ Treve des transferts lancee !', ephemeral: true });
  await lancerTreve();
}

// ── /mes_offres ──────────────────────────────────────────────────────
async function cmdMesOffres(interaction) {
  const offres = await Offer.find({ driverId: interaction.user.id, status: 'pending' }).populate('teamId');
  if (!offres.length)
    return interaction.reply({ content: 'Aucune offre en attente. Les ecuries envoient les offres en DM lors de la treve.', ephemeral: true });

  const lines = offres.map((o, i) => {
    const t = o.teamId;
    const expire = Math.round((o.expiresAt - Date.now()) / 1000 / 3600);
    return '**' + (i+1) + '.** ' + (t ? t.name : '?') + ' — x' + o.contract.bonusMultiplier.toFixed(2) + ' | ' + o.contract.salairesParCourse + '/course | ' + o.contract.duree + ' saison(s) | ⏰ ' + expire + 'h restantes';
  });

  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle('📨 Tes offres en attente').setDescription(lines.join('\n') + '\n\nReponds aux offres via les boutons en DM !').setColor(0x5865F2)],
    ephemeral: true,
  });
}

// ── /mon_contrat ─────────────────────────────────────────────────────
async function cmdMonContrat(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: '❌ Pas de pilote trouve.', ephemeral: true });

  if (!driver.teamId || !driver.contract || driver.contract.saisonsRestantes === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('📋 Contrat de ' + driver.name).setDescription('Tu es actuellement **pilote libre** !\nLes ecuries feront des offres lors de la prochaine treve des transferts.').setColor(0x99AAB5)],
ephemeral: true,
});
}

const team = await Team.findById(driver.teamId);
const c    = driver.contract;

await interaction.reply({
embeds: [new EmbedBuilder()
.setTitle('📋 Contrat de ' + driver.name)
      .setDescription(
        '**Ecurie :** ' + (team ? team.name : '?') + '
' +
        '**Duree :** ' + c.saisonsRestantes + '/' + c.saisonsFirmees + ' saison(s) restantes

' +
        '**Multiplicateur PLcoins :** x' + c.bonusMultiplier.toFixed(2) + '
' +
        '**Salaire par course :** ' + c.salairesParCourse + ' PLcoins
' +
        '**Clause podium :** +' + c.bonusPodium + ' PLcoins
' +
        '**Clause victoire :** +' + c.bonusVictoire + ' PLcoins'
      )
      .setColor(team ? parseInt(team.color.replace('#', ''), 16) || 0xFF1801 : 0x99AAB5)
    ],
    ephemeral: true,
  });
}

// ── /marche_transferts ───────────────────────────────────────────────
async function cmdMarcheTransferts(interaction) {
  const [pilotsLibres, teams] = await Promise.all([
    Driver.find({ creationComplete: true, teamId: null }),
    Team.find(),
  ]);

  const placesLibres = teams.filter(t => t.drivers.length < 2);

  let desc = '';

  if (pilotsLibres.length) {
    desc += '**🏎️ Pilotes libres :**
';
    desc += pilotsLibres.map(d => '#' + d.number + ' **' + d.name + '** — ⭐' + d.overallRating()).join('
');
  } else {
    desc += '*Aucun pilote libre.*';
  }

  desc += '

';

  if (placesLibres.length) {
    desc += '**🔍 Postes disponibles :**
';
    desc += placesLibres.map(t => '**' + t.name + '** — ' + (2 - t.drivers.length) + ' place(s) | Voiture : ⭐' + t.carRating()).join('
');
  } else {
    desc += '*Toutes les ecuries sont completes.*';
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle('🏁 Marche des transferts').setDescription(desc).setColor(0x5865F2).setTimestamp()]
  });
}


// ═══════════════════════════════════════════════════════════════════
//  SYSTEME REGLEMENTAIRE
// ═══════════════════════════════════════════════════════════════════

// Tous les types de reglements possibles
const REG_TYPES = {

  REFONTE_AERO: {
    type: 'REFONTE_AERO',
    titre: '🏗️ Refonte Aerodynamique',
    description: 'Nouvelle reglementation aerodynamique — les ecuries dominantes perdent de l\'appui, les petites en gagnent. Le classement voiture est redistribue !',
    genererParams: () => ({
      convergence: randInt(5, 15), // Points perdus par les top ecuries
      boost:       randInt(3, 10), // Points gagnes par les petites ecuries
    }),
    appliquer: async (params, channel) => {
      const teams = await Team.find().sort({ 'car.chassis': -1 });
      const moyenne = teams.reduce((s, t) => s + t.car.chassis, 0) / teams.length;
      const changes = [];

      for (const team of teams) {
        const ecart = team.car.chassis - moyenne;
        let delta;
        if (ecart > 10) {
          // Top ecurie : perd des points
          delta = -Math.min(params.convergence, Math.floor(ecart * 0.6));
        } else if (ecart < -5) {
          // Petite ecurie : gagne des points
          delta = Math.min(params.boost, Math.floor(Math.abs(ecart) * 0.5));
        } else {
          delta = randInt(-2, 2);
        }
        const avant = team.car.chassis;
        team.car.chassis = Math.max(30, Math.min(95, team.car.chassis + delta));
        // L'aero affecte aussi un peu le moteur (downforce vs vitesse)
        team.car.engine = Math.max(30, Math.min(95, team.car.engine + randInt(-3, 3)));
        await team.save();
        changes.push({ team: team.name, avant, apres: team.car.chassis, delta: team.car.chassis - avant });
      }

      const lines = changes.map(c => {
        const sign = c.delta >= 0 ? '+' : '';
        const icon = c.delta > 0 ? '📈' : c.delta < 0 ? '📉' : '➡️';
        return icon + ' **' + c.team + '** Chassis : ' + c.avant + ' → **' + c.apres + '** (' + sign + c.delta + ')';
      });

      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('🏗️ Refonte Aerodynamique appliquee !')
          .setDescription('Les nouvelles regles aero redistribuent les forces en presence :\n\n' + lines.join('\n'))
.setColor(0xE67E22)
]
});
},
},

MOTEUR_HOMOLOGUE: {
type: 'MOTEUR_HOMOLOGUE',
    titre: '🔩 Moteur Homologue',
    description: 'La FIA impose un moteur commun homologue. Toutes les ecuries partent sur une base identique — les avantages moteur sont effaces !',
    genererParams: () => ({
      baseEngine: randInt(55, 70), // Valeur de base commune
      variance:   randInt(3, 8),   // Variance autour de la base (+/-)
    }),
    appliquer: async (params, channel) => {
      const teams = await Team.find();
      const changes = [];

      for (const team of teams) {
        const avant = team.car.engine;
        team.car.engine = Math.max(30, Math.min(95, params.baseEngine + randInt(-params.variance, params.variance)));
        // La fiabilite est aussi homologuee partiellement
        team.car.reliability = Math.max(50, Math.min(99, params.baseEngine + randInt(-5, 10)));
        await team.save();
        changes.push({ team: team.name, avant, apres: team.car.engine });
      }

      const lines = changes.map(c => {
        const delta = c.apres - c.avant;
        const sign = delta >= 0 ? '+' : '';
        const icon = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
        return icon + ' **' + c.team + '** Moteur : ' + c.avant + ' → **' + c.apres + '** (' + sign + delta + ')';
      });

      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('🔩 Moteur Homologue — Base : ' + params.baseEngine)
          .setDescription('Toutes les ecuries adoptent le nouveau moteur standard :\n\n' + lines.join('\n'))
          .setColor(0x9B59B6)
        ]
      });
    },
  },

  BUDGET_CAP: {
    type: 'BUDGET_CAP',
    titre: '💰 Budget Cap',
    description: 'La FIA instaure un plafond budgetaire. Les ecuries trop riches voient leur exces redistribue aux plus petites !',
    genererParams: () => ({
      plafond:       randInt(3000, 6000), // Budget max autorise
      redistribut:   randInt(30, 60),     // % de l'exces redistribue aux petites
    }),
    appliquer: async (params, season, channel) => {
      const teams = await Team.find().sort({ budget: -1 });
      let poolRedistrib = 0;
      const riches = [], pauvres = [];

      for (const team of teams) {
        if (team.budget > params.plafond) {
          const exces = team.budget - params.plafond;
          const preleve = Math.round(exces * params.redistribut / 100);
          poolRedistrib += preleve;
          team.budget = params.plafond;
          riches.push({ team: team.name, preleve });
          await team.save();
        } else {
          pauvres.push(team);
        }
      }

      // Redistribution aux petites ecuries
      if (poolRedistrib > 0 && pauvres.length > 0) {
        const parEcurie = Math.round(poolRedistrib / pauvres.length);
        for (const team of pauvres) {
          team.budget += parEcurie;
          team.totalBudget += parEcurie;
          await team.save();
        }
      }

      // Active le cap pour la saison
      if (season) {
        season.reglement.budgetCap = params.plafond;
        await season.save();
      }

      const richLines = riches.map(r => '📉 **' + r.team + '** : -' + r.preleve.toLocaleString() + ' budget preleve');
      const poolLine  = poolRedistrib > 0 ? '
💸 **' + poolRedistrib.toLocaleString() + ' budget** redistribue aux ' + pauvres.length + ' ecuries plus modestes (+' + Math.round(poolRedistrib / Math.max(pauvres.length, 1)).toLocaleString() + ' chacune)' : '';

      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('💰 Budget Cap — Plafond : ' + params.plafond.toLocaleString())
          .setDescription((richLines.length ? richLines.join('\n') : 'Aucune ecurie au-dessus du plafond.') + poolLine)
          .setColor(0x2ECC71)
        ]
      });
    },
  },

  VOITURES_LOURDES: {
    type: 'VOITURES_LOURDES',
    titre: '⚖️ Voitures plus lourdes',
    description: 'Nouvelles normes de securite : les voitures sont plus lourdes. La gestion du carburant devient encore plus cruciale et les temps au tour augmentent.',
    genererParams: () => ({ fuelMultiplier: +(1.0 + randInt(15, 35) / 100).toFixed(2) }), // x1.15 à x1.35
    appliquer: async (params, season, channel) => {
      if (season) { season.reglement.fuelMultiplier = params.fuelMultiplier; await season.save(); }
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('⚖️ Voitures Plus Lourdes !')
          .setDescription('Les nouvelles normes de securite alourdissent les voitures.\n\n**Multiplicateur carburant : x' + params.fuelMultiplier + '**\nLes pilotes avec une bonne gestion carburant (**⛽ fuelManagement**) seront avantagés !\nAttends-toi a des temps au tour plus lents et des strategies 2 arrets plus frequentes.')
          .setColor(0x95A5A6)
        ]
      });
    },
  },

  ZONE_DRS: {
    type: 'ZONE_DRS',
    titre: '💨 Nouvelle Zone DRS',
    description: 'La FIA ajoute une zone DRS supplementaire sur plusieurs circuits. Les depassements vont exploser !',
    genererParams: () => {
      const nbCircuits = randInt(3, 6);
      const indices = [];
      while (indices.length < nbCircuits) {
        const i = randInt(0, 20);
        if (!indices.includes(i)) indices.push(i);
      }
      return { circuits: indices };
    },
    appliquer: async (params, season, channel) => {
      if (season) { season.reglement.drsCircuits = params.circuits; await season.save(); }
      const noms = params.circuits.map(i => CIRCUITS[i].emoji + ' ' + CIRCUITS[i].name).join(', ');
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('💨 Nouvelle Zone DRS !')
          .setDescription('Une zone DRS supplementaire est ajoutee sur **' + params.circuits.length + ' circuits** cette saison !\n\n**Circuits concernes :** ' + noms + '\n\nLes depassements seront facilites sur ces circuits. Les pilotes avec un bon **➡️ Overtaking** en profiteront davantage !')
          .setColor(0x1ABC9C)
        ]
      });
    },
  },

  // ────────────────────────────────────────────────────────────────────
  //  NOUVEAUX TYPES RÉGLEMENTAIRES — Révolutions d'ères
  // ────────────────────────────────────────────────────────────────────

  RESET_AERODYNAMIQUE: {
    type: 'RESET_AERODYNAMIQUE',
    titre: '🔄 Révolution Aérodynamique',
    description: 'La FIA impose un règlement technique RADICAL. Toutes les écuries repartent quasi de zéro côté châssis — les années de développement sont effacées. Une nouvelle ère commence !',
    genererParams: () => ({
      baseReset:   randInt(40, 58),   // Valeur de reset du chassis
      variance:    randInt(4, 10),    // Variance autour de la base
      engineTouch: chance(0.5),       // Si true, le moteur est aussi partiellement réinitialisé
    }),
    appliquer: async (params, season, channel) => {
      const teams = await Team.find();
      const changes = [];
      for (const team of teams) {
        const avantChassis = team.car.chassis;
        const avantEngine  = team.car.engine;
        team.car.chassis = Math.max(30, Math.min(95, params.baseReset + randInt(-params.variance, params.variance)));
        if (params.engineTouch) {
          team.car.engine = Math.max(30, Math.min(95, Math.round(team.car.engine * 0.8 + params.baseReset * 0.2)));
        }
        // Réinitialise aussi la fiabilité (nouvelles voitures = fiabilité incertaine)
        team.car.reliability = Math.max(50, Math.min(85, randInt(55, 75)));
        await team.save();
        changes.push({ name: team.name, avantChassis, apresChassis: team.car.chassis, avantEngine, apresEngine: team.car.engine, engineTouche: params.engineTouch });
      }
      const lines = changes.map(c => {
        const dChassis = c.apresChassis - c.avantChassis;
        const signC = dChassis >= 0 ? '+' : '';
        const iconC = dChassis > 0 ? '📈' : dChassis < 0 ? '📉' : '➡️';
        let line = iconC + ' **' + c.name + '** Châssis : ' + c.avantChassis + ' → **' + c.apresChassis + '** (' + signC + dChassis + ')';
        if (c.engineTouche) {
          const dEngine = c.apresEngine - c.avantEngine;
          const signE = dEngine >= 0 ? '+' : '';
          line += ' | Moteur : ' + c.avantEngine + ' → **' + c.apresEngine + '** (' + signE + dEngine + ')';
        }
        return line;
      });
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('🔄 Révolution Aérodynamique — Nouvelle ère !')
          .setDescription('**CHANGEMENT MAJEUR DE RÈGLEMENT !**\n\nToutes les écuries reprennent avec un châssis réinitialisé à la base **' + params.baseReset + '** (±' + params.variance + ') :\n\n' + lines.join('\n') + '\n\n⚠️ La fiabilité est également incertaine sur les nouvelles voitures. Tout est à refaire !')
          .setColor(0xFF6B35)
          .setTimestamp()
        ]
      });
    },
  },

  INTERDICTION_DRS: {
    type: 'INTERDICTION_DRS',
    titre: '🚫 Suppression du DRS',
    description: 'La FIA supprime le DRS pour favoriser des dépassements plus "naturels". Les dépassements deviennent plus rares — le racecraft et la défense priment sur tout !',
    genererParams: () => ({
      reductionOvertaking: +(0.10 + randInt(5, 20) / 100).toFixed(2), // Réduction de overtakingEase sur tous les circuits
    }),
    appliquer: async (params, season, channel) => {
      // On stocke dans le règlement de saison un flag DRS banned
      // On applique via un override dans calcLapTime en stockant dans season.reglement
      if (season) {
        season.reglement.drsCircuits = []; // Aucun circuit DRS boosté
        season.reglement.drsBanned = true; // Nouveau flag
        await season.save();
      }
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('🚫 DRS Supprimé pour cette saison !')
          .setDescription('La FIA a décidé de supprimer le DRS sur **TOUS les circuits**.\n\n📉 Réduction de facilité de dépassement : **-' + Math.round(params.reductionOvertaking * 100) + '%**\n\nLes pilotes avec un bon **🛡️ Défense** et **🏎️ Racecraft** seront clairement avantagés !\nAttends-toi à des courses plus disputées et moins de dépassements.')
          .setColor(0xE74C3C)
        ]
      });
    },
  },

  PNEUMATIQUES_EXPERIMENTAL: {
    type: 'PNEUMATIQUES_EXPERIMENTAL',
    titre: '🔴 Nouveaux Composés Pneus',
    description: 'Le fournisseur de pneus introduit des composés révolutionnaires. La dégradation change radicalement — la gestion des pneus devient l\'arme secrète !',
    genererParams: () => {
      const mode = ['ultra_degradation', 'ultra_durable', 'impredictible'][randInt(0, 2)];
      return {
        mode,
        facteurWear: mode === 'ultra_degradation' ? +(1.4 + rand(0, 0.3)).toFixed(2)
                   : mode === 'ultra_durable'     ? +(0.5 + rand(0, 0.2)).toFixed(2)
                   : +(0.8 + rand(0, 0.6)).toFixed(2), // impredictible : aléatoire par course
      };
    },
    appliquer: async (params, season, channel) => {
      if (season) {
        season.reglement.tyreWearMultiplier = params.facteurWear;
        await season.save();
      }
      const modeTexte = {
        ultra_degradation: '🔴 **Ultra-Dégradation** — Les pneus s\'usent ' + Math.round((params.facteurWear - 1) * 100) + '% plus vite ! Les stratégies 3 arrêts deviennent envisageables.',
        ultra_durable:     '⚪ **Ultra-Durables** — Les pneus durent ' + Math.round((1 - params.facteurWear) * 100) + '% plus longtemps. Les stratégies 1 arrêt domineront.',
        impredictible:     '🟡 **Imprévisibles** — La dégradation varie race par race. Adaptabilité requise !',
      }[params.mode];
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('🔴 Nouveau Composé Pneus — Révolution !')
          .setDescription('**' + modeTexte + '**\n\nMultiplicateur d\'usure global : **x' + params.facteurWear + '**\nLes pilotes avec un bon **🔧 Gestion Pneus** et **🔄 Adaptabilité** seront les grands gagnants !')
          .setColor(0xF39C12)
        ]
      });
    },
  },

  FREEZE_MOTEUR: {
    type: 'FREEZE_MOTEUR',
    titre: '❄️ Freeze Moteur',
    description: 'La FIA gèle le développement moteur ! Aucune écurie ne peut améliorer son moteur cette saison. Les petites écuries bénéficient d\'une prime de compensation.',
    genererParams: () => ({
      compensationPetites: randInt(500, 1500), // Budget offert aux 3 dernières écuries
    }),
    appliquer: async (params, season, channel) => {
      if (season) {
        season.reglement.moteurFreeze = true;
        await season.save();
      }
      const teams = await Team.find().sort({ 'car.engine': 1 }); // Les plus faibles en premier
      const petites = teams.slice(0, Math.min(3, teams.length));
      for (const team of petites) {
        team.budget += params.compensationPetites;
        team.totalBudget += params.compensationPetites;
        await team.save();
      }
      const noms = petites.map(t => '**' + t.name + '**').join(', ');
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('❄️ Freeze Moteur !')
          .setDescription('**Aucune amélioration moteur autorisée cette saison !**\n\nLes avantages moteur actuels sont figés.\n\n💰 Prime de compensation de **' + params.compensationPetites.toLocaleString() + ' budget** pour les écuries en difficulté : ' + noms)
          .setColor(0x74B9FF)
        ]
      });
    },
  },

  DOUBLE_POINTS_FINALE: {
    type: 'DOUBLE_POINTS_FINALE',
    titre: '✨ Double Points au Grand Final',
    description: 'La FIA instaure les double points sur la dernière manche de la saison. Tout peut basculer jusqu\'au dernier tour — le suspense est garanti !',
    genererParams: () => ({ nbCourses: randInt(1, 2) }), // 1 ou 2 dernières courses en double points
    appliquer: async (params, season, channel) => {
      if (season) {
        season.reglement.doublePointsFinale = params.nbCourses;
        await season.save();
      }
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle('✨ Double Points sur les ' + params.nbCourses + ' dernière(s) manche(s) !')
          .setDescription('La FIA instaure les **points doublés** sur ' + (params.nbCourses === 1 ? 'la dernière course' : 'les 2 dernières courses') + ' de la saison !\n\nTout peut encore basculer jusqu\'à Abu Dhabi. Préparez-vous pour un final épique ! 🏆')
          .setColor(0xFFD700)
        ]
      });
    },
  },
};

// ── Genere 3 propositions aleatoires distinctes ──────────────────────
function genererPropositions() {
  const types = Object.values(REG_TYPES);
  const shuffled = types.sort(() => Math.random() - 0.5).slice(0, 3);
  return shuffled.map((t, i) => ({
    id:          ['A', 'B', 'C'][i],
    type:        t.type,
    titre:       t.titre,
    description: t.description,
    params:      t.genererParams(),
  }));
}

// ── /proposer_reglement (admin) ──────────────────────────────────────
async function cmdProposerReglement(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });

  // Verifie qu'il n'y a pas deja un vote ouvert
  const existing = await RegVote.findOne({ status: 'open' });
  if (existing) return interaction.reply({ content: '❌ Un vote est deja en cours ! Cloture-le d\'abord avec /cloturer_vote.', ephemeral: true });

  const proposals = genererPropositions();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const vote = new RegVote({ proposals, expiresAt });
  await vote.save();

  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);

  const desc = proposals.map(p =>
    '**Proposition ' + p.id + ' — ' + p.titre + '**
' + p.description + '
'
  ).join('
');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reg_vote_A').setLabel('Voter A').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('reg_vote_B').setLabel('Voter B').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('reg_vote_C').setLabel('Voter C').setStyle(ButtonStyle.Primary),
  );

  const msg = await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('🗳️ VOTE REGLEMENTAIRE — Choisissez votre avenir !')
      .setDescription(desc + '\n⏰ Vote ouvert **48h** — utilisez les boutons ou `/vote_reglement`')
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: 'ID vote : ' + vote._id })
    ],
    components: [row],
  });

  await interaction.reply({ content: '✅ Vote lance dans le salon !', ephemeral: true });

  // Collecteur de boutons dans le salon
  const collector = msg.createMessageComponentCollector({ time: 48 * 60 * 60 * 1000 });
  collector.on('collect', async (btn) => {
    if (!btn.customId.startsWith('reg_vote_')) return;
    const choix = btn.customId.replace('reg_vote_', '');
    await enregistrerVote(btn.user.id, choix, vote._id, btn);
  });
}

// ── Enregistre un vote (shared entre boutons et slash cmd) ───────────
async function enregistrerVote(discordId, choix, voteId, interaction) {
  const driver = await Driver.findOne({ discordId });
  if (!driver) return interaction.reply({ content: '❌ Tu dois avoir un pilote pour voter.', ephemeral: true });

  const vote = await RegVote.findById(voteId);
  if (!vote || vote.status !== 'open') return interaction.reply({ content: '❌ Ce vote est ferme.', ephemeral: true });

  const proposal = vote.proposals.find(p => p.id === choix.toUpperCase());
  if (!proposal) return interaction.reply({ content: '❌ Proposition invalide. Choisis A, B ou C.', ephemeral: true });

  // Un pilote = 1 vote, modifiable
  const existing = vote.votes.find(v => v.driverId === discordId);
  if (existing) {
    existing.proposalId = proposal.id;
  } else {
    vote.votes.push({ driverId: discordId, proposalId: proposal.id });
  }
  await vote.save();

  const counts = { A: 0, B: 0, C: 0 };
  vote.votes.forEach(v => { if (counts[v.proposalId] !== undefined) counts[v.proposalId]++; });

  await interaction.reply({
    content: '✅ Vote enregistre pour **' + proposal.titre + '** !
Resultats provisoires — A: ' + counts.A + ' | B: ' + counts.B + ' | C: ' + counts.C,
    ephemeral: true,
  });
}

// ── /vote_reglement ──────────────────────────────────────────────────
async function cmdVoteReglement(interaction) {
  const vote = await RegVote.findOne({ status: 'open' }).sort({ createdAt: -1 });
  if (!vote) return interaction.reply({ content: '❌ Aucun vote en cours.', ephemeral: true });
  const choix = interaction.options.getString('choix');
  await enregistrerVote(interaction.user.id, choix, vote._id, interaction);
}

// ── /cloturer_vote (admin) ───────────────────────────────────────────
async function cmdCloturerVote(interaction) {
  if (!interaction.memberPermissions.has('Administrator'))
    return interaction.reply({ content: '❌ Reserve aux admins.', ephemeral: true });

  const vote = await RegVote.findOne({ status: 'open' }).sort({ createdAt: -1 });
  if (!vote) return interaction.reply({ content: '❌ Aucun vote ouvert.', ephemeral: true });

  // Compte les votes
  const counts = { A: 0, B: 0, C: 0 };
  vote.votes.forEach(v => { if (counts[v.proposalId] !== undefined) counts[v.proposalId]++; });

  // Departage : si egalite, tirage au sort parmi les ex-aequo
  const totalVotes = counts.A + counts.B + counts.C;
  const maxVotes   = Math.max(...Object.values(counts));
  const winners    = totalVotes === 0 ? ['A', 'B', 'C'] : Object.keys(counts).filter(k => counts[k] === maxVotes);
  const winnerId   = winners[randInt(0, winners.length - 1)];
  const winner     = vote.proposals.find(p => p.id === winnerId);

  vote.status = 'closed';
  vote.winner = winnerId;
  await vote.save();

  const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
  const season  = await Season.findOne({ isActive: true });

  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('🗳️ Résultats du vote réglementaire !')
      .setDescription(
        '**A:** ' + counts.A + ' vote(s) | **B:** ' + counts.B + ' vote(s) | **C:** ' + counts.C + ' vote(s)\n\n' +
        (totalVotes === 0 ? '📭 Aucun vote — tirage au sort !\n\n' : '') +
        (winners.length > 1 && totalVotes > 0 ? '⚡ Égalité ! Tirage au sort...\n\n' : '') +
        '🏆 **GAGNANT : Proposition ' + winnerId + ' — ' + winner.titre + '**\n' + winner.description
      )
      .setColor(0xFFD700)
    ]
  });

  await sleep(2000);

  // Applique le reglement gagnant
  const regType = REG_TYPES[winner.type];
  if (regType) {
    await regType.appliquer(winner.params, season, channel);
    if (season) await season.save();
  }

  // Enregistrer dans GlobalConfig
  const config = await getConfig();
  const currentSeason = season ? season.seasonNumber : (await Season.countDocuments());
  config.lastRegChangeSeason = currentSeason;
  config.nextRegTriggerIn    = randInt(3, 4); // Prochaine fois dans 3 ou 4 saisons
  config.regHistory.push({
    seasonNumber: currentSeason,
    type:         winner.type,
    titre:        winner.titre,
    description:  winner.description,
    winner:       winnerId,
  });
  await config.save();

  await interaction.reply({ content: '✅ Vote clôturé ! Prochain changement réglementaire dans **' + config.nextRegTriggerIn + '** saisons.', ephemeral: true });
}

// ── /reglement_actuel ────────────────────────────────────────────────
async function cmdReglementActuel(interaction) {
  const season = await Season.findOne({ isActive: true });
  if (!season) return interaction.reply({ content: '❌ Aucune saison active.', ephemeral: true });

  const r = season.reglement;
  const drsNoms = (r.drsCircuits && r.drsCircuits.length)
    ? r.drsCircuits.map(i => CIRCUITS[i] ? CIRCUITS[i].emoji + ' ' + CIRCUITS[i].name : '?').join(', ')
    : 'Aucune zone supplémentaire';

  const config = await getConfig();
  const saisonsDepuis = season.seasonNumber - config.lastRegChangeSeason;
  const prochainDans  = Math.max(0, config.nextRegTriggerIn - saisonsDepuis);

  const lignes = [
    '**⚖️ Poids voitures :** ' + (r.fuelMultiplier !== 1.0 ? 'x' + r.fuelMultiplier + ' (' + (r.fuelMultiplier > 1 ? 'plus lourdes 📈' : 'plus légères 📉') + ')' : 'Standard'),
    '**💰 Budget cap :** ' + (r.budgetCap ? r.budgetCap.toLocaleString() + ' max' : 'Aucun'),
    '**💨 DRS :** ' + (r.drsBanned ? '🚫 Supprimé cette saison !' : 'Zones bonus : ' + drsNoms),
    '**🔴 Pneus :** ' + (r.tyreWearMultiplier && r.tyreWearMultiplier !== 1.0 ? 'Usure x' + r.tyreWearMultiplier : 'Standard'),
    '**❄️ Moteur :** ' + (r.moteurFreeze ? 'Développement gelé !' : 'Développement libre'),
    '**✨ Double points :** ' + (r.doublePointsFinale > 0 ? 'Sur les ' + r.doublePointsFinale + ' dernière(s) manche(s)' : 'Non'),
    '',
    '🗓️ **Prochain changement réglementaire majeur :** dans **' + prochainDans + '** saison(s)',
    '_(Dernier changement : Saison ' + (config.lastRegChangeSeason || 'aucun') + ')_',
  ];

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('📋 Règlement en vigueur — Saison ' + season.seasonNumber)
      .setDescription(lignes.join('\n'))
      .setColor(0x5865F2)
      .setTimestamp()
    ],
    ephemeral: true,
  });
}

// ── /historique_reglements ───────────────────────────────────────────
async function cmdHistoriqueReglements(interaction) {
  const config = await getConfig();

  if (!config.regHistory || config.regHistory.length === 0) {
    return interaction.reply({ content: '📋 Aucun changement réglementaire majeur n\'a encore eu lieu.', ephemeral: true });
  }

  const lignes = config.regHistory
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map(h => {
      const regType = REG_TYPES[h.type];
      const emoji   = regType ? regType.titre.split(' ')[0] : '📋';
      return '**Saison ' + h.seasonNumber + '** — ' + emoji + ' **' + h.titre + '**\n> ' + h.description.slice(0, 100) + (h.description.length > 100 ? '...' : '');
    });

  // Info sur le prochain
  const activeSeason  = await Season.findOne({ isActive: true });
  const currentNum    = activeSeason ? activeSeason.seasonNumber : (await Season.countDocuments());
  const saisonsDepuis = currentNum - config.lastRegChangeSeason;
  const prochainDans  = Math.max(0, config.nextRegTriggerIn - saisonsDepuis);

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('📚 Historique Réglementaire — Toutes les ères')
      .setDescription(
        lignes.join('\n\n') +
        '\n\n──────────────────────\n' +
        '🗓️ **Prochain changement dans :** ' + prochainDans + ' saison(s)\n' +
        '_(Intervalles : 3 ou 4 saisons, tiré aléatoirement)_'
      )
      .setColor(0x9B59B6)
      .setTimestamp()
    ],
    ephemeral: true,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  CRON — Sessions automatiques
// ═══════════════════════════════════════════════════════════════════

cron.schedule('0 11 * * *', lancerEssaisLibres,   { timezone: 'Europe/Paris' });
cron.schedule('0 15 * * *', lancerQualifications, { timezone: 'Europe/Paris' });
cron.schedule('0 18 * * *', lancerCourse,         { timezone: 'Europe/Paris' });

// ── Cron : clôture automatique des votes réglementaires expirés ──────
// Vérifie toutes les heures si un vote ouvert a expiré
cron.schedule('0 * * * *', async () => {
  try {
    const vote = await RegVote.findOne({ status: 'open', expiresAt: { $lte: new Date() } });
    if (!vote) return;

    console.log('⏰ Clôture automatique du vote réglementaire expiré :', vote._id);
    const channel = client.channels.cache.get(process.env.RACE_CHANNEL_ID);
    if (!channel) return console.error('❌ RACE_CHANNEL_ID introuvable pour clôture auto vote.');

    const config = await getConfig();
    const prochaineSaison = (config.lastRegChangeSeason || 0) + config.nextRegTriggerIn;
    await cloturerVoteAuto(vote, channel, prochaineSaison);
  } catch (err) {
    console.error('❌ Erreur cron clôture vote :', err);
  }
}, { timezone: 'Europe/Paris' });

// ═══════════════════════════════════════════════════════════════════
//  KEEP ALIVE
// ═══════════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => { res.writeHead(200); res.end('Bot en ligne ✅'); });
server.listen(process.env.PORT || 3000, () => console.log('🌐 Serveur HTTP actif'));

const RENDER_URL = process.env.RENDER_URL;
cron.schedule('*/14 * * * *', () => {
  if (!RENDER_URL) return;
  http.get(RENDER_URL, res => console.log('🏓 Ping -> ' + res.statusCode)).on('error', err => console.error('❌ Ping echoue :', err.message));
});

// ═══════════════════════════════════════════════════════════════════
//  DEMARRAGE
// ═══════════════════════════════════════════════════════════════════

mongoose.connect(process.env.MONGODB_URI)
  .then(() => { console.log('✅ Connecte a MongoDB'); return client.login(process.env.DISCORD_TOKEN); })
  .catch(err => { console.error('❌ Erreur demarrage :', err); process.exit(1); });
