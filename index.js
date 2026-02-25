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
  contractBonus:    { type: Number, default: 1.0 },
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
  const gain = Math.round(amount * this.contractBonus);
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
  const statsBlock = STAT_LIST.map(k => (STAT_LABELS[k] + '                      ').slice(0,22) + ' ' + bar(this.stats[k])).join('\n');
  const color = parseInt(this.helmetColor.replace('#', ''), 16) || 0xFFFFFF;
  return {
    title: '🏎️ #' + this.number + ' — ' + this.name,
    description: '**' + this.nationality + '** | ' + (this.teamId ? 'En ecurie' : 'Sans ecurie 🔍') + '\n💰 **' + this.plcoins.toLocaleString() + ' PLcoins** | Multiplicateur : x' + this.contractBonus.toFixed(2) + '\n⭐ Note globale : **' + this.overallRating() + '/100**\n\n```\n' + statsBlock + '\n```',
    color,
    footer: '🏆 ' + this.totalWins + 'W  🥈 ' + this.totalPodiums + ' podiums  🏁 ' + this.totalPoles + ' poles  📍 Meilleur : P' + this.bestFinish,
  };
};
const Driver = mongoose.model('Driver', driverSchema);

const teamSchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true },
  color:    { type: String, default: '#FF1801' },
  budget:   { type: Number, default: 100 },
  car: {
    chassis:     { type: Number, default: 50 },
    engine:      { type: Number, default: 50 },
    reliability: { type: Number, default: 70 },
    pit:         { type: Number, default: 50 },
  },
  drivers:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }],
  createdAt: { type: Date, default: Date.now },
});
teamSchema.methods.carRating = function () {
  const { chassis, engine, reliability, pit } = this.car;
  return Math.round((chassis * 0.35 + engine * 0.35 + reliability * 0.20 + pit * 0.10) * 10) / 10;
};
const Team = mongoose.model('Team', teamSchema);

const seasonSchema = new mongoose.Schema({
  seasonNumber:   { type: Number, default: 1 },
  currentRound:   { type: Number, default: 0 },
  circuitOrder:   [Number],
  qualifyingGrid: [{ driverId: String, time: Number }],
  elSetups:       [{ driverId: String, bonus: Number }],
  isActive:       { type: Boolean, default: true },
  createdAt:      { type: Date, default: Date.now },
});
const Season = mongoose.model('Season', seasonSchema);

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
];

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log('✅ Connecte en tant que ' + client.user.tag);
  client.user.setActivity('🏎️ Saison F1 en cours', { type: 4 });
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands.map(c => c.toJSON()) });
    console.log('⚙️  Slash commands enregistrees');
  } catch (e) { console.error('❌ Erreur enregistrement :', e); }
});

client.on('interactionCreate', async (interaction) => {
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
    const lines = STAT_LIST.map(k => (STAT_LABELS[k] + '                      ').slice(0,22) + ' **' + driver.stats[k] + '**').join('\n');
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
  }).join('\n');
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
  const calendrier = order.map((ci, i) => '**Manche ' + (i+1) + '** — ' + CIRCUITS[ci].emoji + ' ' + CIRCUITS[ci].name).join('\n');
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
  const fuelSave  = state.lapNumber * 0.03;
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

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Qualifications — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription("Les pilotes s'elancent pour leur tour rapide... 🔴").setColor(0xE67E22).setTimestamp()] });
  await sleep(2000);

  const results = [];
  for (const driver of drivers) {
    const team = driver.teamId ? teamMap[driver.teamId.toString()] : null;
    const setup = season.elSetups ? season.elSetups.find(s => s.driverId === driver.discordId) : null;
    const elBonus = setup ? setup.bonus * 0.5 : 0;
    const qualBonus = -(driver.stats.qualifying - 50) / 100 * 0.8;
    const qTime = calcBaseLapTime(driver, team, circuit) + elBonus + qualBonus + rand(-0.4, 0.4);
    results.push({ driver, time: qTime });
    const sorted = [...results].sort((a, b) => a.time - b.time);
    const isP1 = sorted[0].driver.discordId === driver.discordId;
    await channel.send('🏎️ **#' + driver.number + ' ' + driver.name + '** — ' + fmtTime(qTime) + ' ' + (isP1 ? '🟣 POLE PROVISOIRE' : '+' + (qTime - sorted[0].time).toFixed(3) + 's'));
    await sleep(1500);
  }

  results.sort((a, b) => a.time - b.time);
  const pole = results[0].driver;
  pole.totalPoles++;
  await pole.save();

  season.qualifyingGrid = results.map(r => ({ driverId: r.driver.discordId, time: r.time }));
  await season.save();

  const lines = results.map((r, i) => '**P' + (i+1) + '** #' + r.driver.number + ' ' + r.driver.name + ' — ' + fmtTime(r.time) + ' ' + (i === 0 ? '🟣 POLE' : '+' + (r.time - results[0].time).toFixed(3) + 's'));
  await channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Grille de depart — ' + circuit.emoji + ' ' + circuit.name).setDescription(lines.join('\n')).setColor(0xE67E22).setFooter({ text: 'Course a 18h00 ! Pole : ' + pole.name + ' #' + pole.number })] });
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

  const carState = grid.map(({ driver }) => ({
    driver,
    team: driver.teamId ? teamMap[driver.teamId.toString()] : null,
    totalTime: 0,
    tyre: 'soft', tyreWear: 0, tyreAge: 0,
    strategy: calcStrategy(driver, circuit),
    dnf: false, dnfReason: null,
    penalty: 0, pitStops: 0, isWet: false,
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
      const degRate = { soft: 0.018, medium: 0.011, hard: 0.006 }[state.tyre] * circuit.tyreWear;
      const mgmt = (state.driver.stats.tyreManagement - 50) / 100 * 0.3;
      state.tyreWear = Math.min(1, state.tyreWear + degRate - mgmt * degRate);

      state.totalTime += calcLapTime(state.driver, state.team, circuit, {
        tyreWear: state.tyreWear, lapNumber: lap, tyre: state.tyre, safetyCar, isWet: state.isWet
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
      await channel.send('**[ Tour ' + lap + '/' + circuit.laps + ' ]**\n' + lapComments.join('\n'));
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
    const champPts = !s.dnf && pos <= 10 ? POINTS_TABLE[pos - 1] : 0;
    const coins    = !s.dnf && pos <= 20 ? (PLCOINS_TABLE[pos - 1] || 2) : 5;
    s.driver.totalPoints += champPts;
    if (pos === 1) s.driver.totalWins++;
    if (pos <= 3 && !s.dnf) s.driver.totalPodiums++;
    if (!s.dnf && pos < s.driver.bestFinish) s.driver.bestFinish = pos;
    s._champPts = champPts;
    s._coins = s.driver.addPlcoins(coins);
    await s.driver.save();
  }

  const winner = final.find(s => !s.dnf);
  const resultLines = final.map((s, i) => {
    if (s.dnf) return '**DNF** #' + s.driver.number + ' ' + s.driver.name + ' — ' + s.dnfReason + ' | +' + s._coins + ' PLcoins';
    const pen = s.penalty > 0 ? ' ⚠️+' + s.penalty + 's' : '';
    return '**P' + (i+1) + '** #' + s.driver.number + ' ' + s.driver.name + pen + ' — +' + s._champPts + ' pts | +' + s._coins + ' PLcoins';
  });

  await channel.send({ embeds: [new EmbedBuilder().setTitle('🏆 RESULTATS — ' + circuit.emoji + ' GP de ' + circuit.name).setDescription('🥇 **VAINQUEUR : ' + (winner ? winner.driver.name + ' #' + winner.driver.number : 'Aucun') + '**\n\n' + resultLines.join('\n')).setColor(0xFFD700).setTimestamp().setFooter({ text: 'Saison ' + season.seasonNumber + ' · Manche ' + (season.currentRound + 1) + '/' + CIRCUITS.length })] });

  season.currentRound++;
  season.qualifyingGrid = [];
  season.elSetups = [];
  if (season.currentRound >= CIRCUITS.length) {
    season.isActive = false;
    await channel.send('🏁 **FIN DE SAISON !** La treve hivernale commence !');
  }
  await season.save();
}

// ═══════════════════════════════════════════════════════════════════
//  CRON — Sessions automatiques
// ═══════════════════════════════════════════════════════════════════

cron.schedule('0 11 * * *', lancerEssaisLibres,   { timezone: 'Europe/Paris' });
cron.schedule('0 15 * * *', lancerQualifications, { timezone: 'Europe/Paris' });
cron.schedule('0 18 * * *', lancerCourse,         { timezone: 'Europe/Paris' });

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
