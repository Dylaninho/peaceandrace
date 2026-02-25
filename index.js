require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// ═══════════════════════════════════════════════════════════════════
//  MODÈLES MONGODB
// ═══════════════════════════════════════════════════════════════════

// ── Labels et constantes stats ──────────────────────────────────────
const STAT_BASE = 50;
const STAT_MAX  = 85;
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

// ── Schéma Driver ───────────────────────────────────────────────────
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

  teamId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  contractBonus:  { type: Number, default: 1.0 },

  totalWins:    { type: Number, default: 0 },
  totalPodiums: { type: Number, default: 0 },
  totalPoles:   { type: Number, default: 0 },
  totalPoints:  { type: Number, default: 0 },
  bestFinish:   { type: Number, default: 99 },

  createdAt: { type: Date, default: Date.now },
});

driverSchema.methods.overallRating = function () {
  const w = { pace:0.15, qualifying:0.10, wetPace:0.07, tyreManagement:0.12, fuelManagement:0.10, racecraft:0.12, consistency:0.12, overtaking:0.08, defending:0.07, start:0.05, adaptability:0.02 };
  return Math.round(STAT_LIST.reduce((t, s) => t + (this.stats[s] ?? STAT_BASE) * w[s], 0) * 10) / 10;
};

driverSchema.methods.upgradeCost = function (stat) {
  const cur = this.stats[stat];
  if (cur === undefined || cur >= STAT_MAX) return null;
  return UPGRADE_TIERS.find(t => cur <= t.upTo)?.cost ?? null;
};

driverSchema.methods.addPlcoins = function (amount) {
  const gain = Math.round(amount * this.contractBonus);
  this.plcoins += gain;
  return gain;
};

driverSchema.methods.applyUpgrade = function (stat) {
  const cost = this.upgradeCost(stat);
  if (!cost) return { ok: false, msg: `Stat inexistante ou déjà au maximum (${STAT_MAX}).` };
  if (this.plcoins < cost) return { ok: false, msg: `Pas assez de PLcoins. Coût : **${cost}** | Solde : **${this.plcoins}**` };
  const before = this.stats[stat];
  this.stats[stat]++;
  this.plcoins -= cost;
  return { ok: true, msg: `✅ **${STAT_LABELS[stat]}** : ${before} → **${this.stats[stat]}** (-${cost} PLcoins)` };
};

driverSchema.methods.applyFreePoint = function (stat) {
  if (this.freePoints <= 0) return { ok: false, msg: "Tu n'as plus de points gratuits." };
  if (this.stats[stat] === undefined) return { ok: false, msg: `Stat inconnue.` };
  if (this.stats[stat] >= STAT_BASE + FREE_POINTS) return { ok: false, msg: `Maximum ${FREE_POINTS} points par stat à la création.` };
  const before = this.stats[stat];
  this.stats[stat]++;
  this.freePoints--;
  return { ok: true, msg: `✅ **${STAT_LABELS[stat]}** : ${before} → **${this.stats[stat]}** (${this.freePoints} restant(s))` };
};

driverSchema.methods.buildProfileEmbed = function () {
  const bar = (val) => {
    const f = Math.round((val / 100) * 10);
    const icon = val >= 75 ? '🟩' : val >= 60 ? '🟨' : '🟥';
    return `${icon.repeat(f)}${'⬜'.repeat(10 - f)} **${val}**`;
  };
  const statsBlock = STAT_LIST.map(k => `${STAT_LABELS[k].padEnd(22)} ${bar(this.stats[k])}`).join('\n');
  const color = parseInt(this.helmetColor.replace('#', ''), 16) || 0xFFFFFF;
  return {
    title: `🏎️ #${this.number} — ${this.name}`,
    description: `**${this.nationality}** | ${this.teamId ? 'En écurie' : 'Sans écurie 🔍'}\n💰 **${this.plcoins.toLocaleString()} PLcoins** | Multiplicateur : ×${this.contractBonus.toFixed(2)}\n⭐ Note globale : **${this.overallRating()}/100**\n\n\`\`\`\n${statsBlock}\n\`\`\``,
    color,
    footer: `🏆 ${this.totalWins}W  🥈 ${this.totalPodiums} podiums  🏁 ${this.totalPoles} poles  📍 Meilleur : P${this.bestFinish}`,
  };
};

const Driver = mongoose.model('Driver', driverSchema);

// ── Schéma Team ─────────────────────────────────────────────────────
const teamSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  color:       { type: String, default: '#FF1801' },
  budget:      { type: Number, default: 100 },   // Budget relatif (1-200)
  
  // Performance voiture (évolue au fil de la saison)
  car: {
    chassis:   { type: Number, default: 50 },    // Aéro, appui
    engine:    { type: Number, default: 50 },    // Puissance moteur
    reliability:{ type: Number, default: 70 },   // Fiabilité (réduit les DNF)
    pit:       { type: Number, default: 50 },    // Vitesse des arrêts au stand
  },

  drivers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }], // Max 2
  createdAt:   { type: Date, default: Date.now },
});

// Note globale de la voiture /100
teamSchema.methods.carRating = function () {
  const { chassis, engine, reliability, pit } = this.car;
  return Math.round((chassis * 0.35 + engine * 0.35 + reliability * 0.20 + pit * 0.10) * 10) / 10;
};

const Team = mongoose.model('Team', teamSchema);

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
//  DÉFINITION DES SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════

const commands = [

  // ── /creer_pilote ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('creer_pilote')
    .setDescription('Crée ton pilote F1 personnalisé.')
    .addStringOption(o => o.setName('nom').setDescription('Nom du pilote (ex: Max Dupont)').setRequired(true))
    .addStringOption(o => o.setName('nationalite').setDescription('Nationalité (ex: 🇫🇷 Français)').setRequired(true))
    .addIntegerOption(o => o.setName('numero').setDescription('Numéro de course (1-99)').setRequired(true).setMinValue(1).setMaxValue(99))
    .addStringOption(o => o.setName('couleur').setDescription('Couleur hex du casque (ex: FF0000)').setRequired(false)),

  // ── /profil ──────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Affiche le profil d\'un pilote.')
    .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)').setRequired(false)),

  // ── /upgrade ─────────────────────────────────────────────────────
  (() => {
    const cmd = new SlashCommandBuilder()
      .setName('upgrade')
      .setDescription('Améliore une stat de ton pilote avec des PLcoins.');
    cmd.addStringOption(o => {
      o.setName('stat').setDescription('La stat à améliorer').setRequired(true);
      STAT_LIST.forEach(k => o.addChoices({ name: STAT_LABELS[k], value: k }));
      return o;
    });
    return cmd;
  })(),

  // ── /plcoins ─────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('plcoins')
    .setDescription('Affiche ton solde et les coûts d\'upgrade.'),

  // ── /classement ──────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Classement des pilotes.'),

];

// ═══════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.user.setActivity('🏎️ Saison F1 en cours', { type: 4 });

  // Enregistre les slash commands sur le serveur
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log(`⚙️  Slash commands enregistrées`);
  } catch (e) {
    console.error('❌ Erreur enregistrement commands :', e);
  }
});

// ── Router les slash commands ────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'creer_pilote') return await cmdCreerPilote(interaction);
    if (interaction.commandName === 'profil')        return await cmdProfil(interaction);
    if (interaction.commandName === 'upgrade')       return await cmdUpgrade(interaction);
    if (interaction.commandName === 'plcoins')       return await cmdPlcoins(interaction);
    if (interaction.commandName === 'classement')    return await cmdClassement(interaction);
  } catch (err) {
    console.error(`Erreur sur /${interaction.commandName} :`, err);
    const msg = { content: '❌ Une erreur est survenue.', ephemeral: true };
    interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  FONCTIONS COMMANDES
// ═══════════════════════════════════════════════════════════════════

// ── /creer_pilote ────────────────────────────────────────────────────
async function cmdCreerPilote(interaction) {
  const existing = await Driver.findOne({ discordId: interaction.user.id });
  if (existing) return interaction.reply({ content: '❌ Tu as déjà un pilote ! Utilise `/profil`.', ephemeral: true });

  const nom         = interaction.options.getString('nom');
  const nationalite = interaction.options.getString('nationalite');
  const numero      = interaction.options.getInteger('numero');
  const rawColor    = interaction.options.getString('couleur') || 'FFFFFF';
  const helmetColor = '#' + rawColor.replace('#', '');

  if (!/^#[0-9A-Fa-f]{6}$/.test(helmetColor))
    return interaction.reply({ content: '❌ Couleur invalide. Format : `FF0000`', ephemeral: true });

  if (await Driver.findOne({ number: numero }))
    return interaction.reply({ content: `❌ Le numéro **#${numero}** est déjà pris !`, ephemeral: true });

  const driver = new Driver({ discordId: interaction.user.id, name: nom, nationality: nationalite, helmetColor, number: numero });

  const buildEmbed = () => {
    const lines = STAT_LIST.map(k => `${STAT_LABELS[k].padEnd(22)} **${driver.stats[k]}**`).join('\n');
    return new EmbedBuilder()
      .setTitle(`🏎️ Création de #${numero} — ${nom}`)
      .setDescription(`**${driver.freePoints} point(s) restant(s)** à distribuer.\nClique sur un bouton pour ajouter +1.\n\n\`\`\`\n${lines}\n\`\`\``)
      .setColor(parseInt(helmetColor.replace('#', ''), 16));
  };

  const buildRows = (disabled = false) => {
    const rows = [];
    let row = new ActionRowBuilder();
    STAT_LIST.forEach((key, i) => {
      if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
      const [emoji, ...rest] = STAT_LABELS[key].split(' ');
      row.addComponents(new ButtonBuilder().setCustomId(`fp_${key}`).setLabel(rest.join(' ')).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(disabled || driver.freePoints === 0));
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
        embeds: [new EmbedBuilder().setTitle('🏎️ Pilote créé !').setDescription(`Bienvenue sur la grille, **${nom}** #${numero} !\nNote globale : **${driver.overallRating()}/100**\n\nUtilise \`/profil\` pour voir ta fiche.`).setColor(parseInt(helmetColor.replace('#', ''), 16))],
        components: [],
      });
    }
    if (btn.customId.startsWith('fp_')) {
      const result = driver.applyFreePoint(btn.customId.replace('fp_', ''));
      if (!result.ok) return btn.reply({ content: `❌ ${result.msg}`, ephemeral: true });
      await btn.update({ embeds: [buildEmbed()], components: buildRows() });
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'time') return;
    try { await interaction.editReply({ components: buildRows(true) }); } catch (_) {}
  });
}

// ── /profil ──────────────────────────────────────────────────────────
async function cmdProfil(interaction) {
  const target = interaction.options.getUser('membre') || interaction.user;
  const driver = await Driver.findOne({ discordId: target.id });

  if (!driver) {
    const who = target.id === interaction.user.id ? "Tu n'as" : `**${target.username}** n'a`;
    return interaction.reply({ content: `❌ ${who} pas encore de pilote. Utilise \`/creer_pilote\` !`, ephemeral: true });
  }

  const data = driver.buildProfileEmbed();
  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle(data.title).setDescription(data.description).setColor(data.color).setFooter({ text: data.footer }).setThumbnail(target.displayAvatarURL({ dynamic: true }))],
  });
}

// ── /upgrade ─────────────────────────────────────────────────────────
async function cmdUpgrade(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: "❌ Tu n'as pas de pilote. Utilise `/creer_pilote` !", ephemeral: true });
  if (!driver.creationComplete) return interaction.reply({ content: "❌ Termine d'abord la création de ton pilote !", ephemeral: true });

  const stat = interaction.options.getString('stat');
  const result = driver.applyUpgrade(stat);
  if (result.ok) await driver.save();
  await interaction.reply({ content: result.msg, ephemeral: true });
}

// ── /plcoins ──────────────────────────────────────────────────────────
async function cmdPlcoins(interaction) {
  const driver = await Driver.findOne({ discordId: interaction.user.id });
  if (!driver) return interaction.reply({ content: "❌ Pas de pilote trouvé.", ephemeral: true });

  const lines = STAT_LIST.map(k => {
    const cost = driver.upgradeCost(k);
    return `${STAT_LABELS[k].padEnd(22)} **${driver.stats[k]}** — ${cost ? `${cost} PLcoins` : 'MAX'}`;
  }).join('\n');

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`💰 PLcoins — ${driver.name}`)
      .setDescription(`**Solde : ${driver.plcoins.toLocaleString()} PLcoins**\nMultiplicateur contrat : ×${driver.contractBonus.toFixed(2)}\n\n**Coûts d'upgrade :**\n\`\`\`\n${lines}\n\`\`\``)
      .setColor(0xFFD700)],
    ephemeral: true,
  });
}

// ── /classement ───────────────────────────────────────────────────────
async function cmdClassement(interaction) {
  const drivers = await Driver.find({ creationComplete: true }).sort({ totalPoints: -1 }).limit(20);
  if (!drivers.length) return interaction.reply({ content: 'Aucun pilote enregistré.', ephemeral: true });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = drivers.map((d, i) => `${i < 3 ? medals[i] : `**${i+1}.**`} #${d.number} **${d.name}** — ${d.totalPoints} pts | ${d.totalWins}W | ⭐${d.overallRating()}`);

  await interaction.reply({
    embeds: [new EmbedBuilder().setTitle('🏆 Classement Pilotes').setDescription(lines.join('\n')).setColor(0xE8C200).setTimestamp()],
  });
}

// ═══════════════════════════════════════════════════════════════════
//  CRON — Sessions automatiques (11h EL / 15h Qualifs / 18h Course)
//  (Les fonctions de simulation seront ajoutées ici plus tard)
// ═══════════════════════════════════════════════════════════════════

// cron.schedule('0 11 * * *', () => lancerEssaisLibres(),  { timezone: 'Europe/Paris' });
// cron.schedule('0 15 * * *', () => lancerQualifications(), { timezone: 'Europe/Paris' });
// cron.schedule('0 18 * * *', () => lancerCourse(),         { timezone: 'Europe/Paris' });

// ═══════════════════════════════════════════════════════════════════
//  KEEP ALIVE — Empêche Render de s'endormir (Web Service gratuit)
// ═══════════════════════════════════════════════════════════════════

const http = require('http');

// Crée un serveur HTTP minimaliste — Render a besoin d'un port ouvert
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot en ligne ✅');
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Serveur HTTP actif sur le port ${process.env.PORT || 3000}`);
});

// Auto-ping toutes les 14 minutes pour ne pas s'endormir
const RENDER_URL = process.env.RENDER_URL; // ex: https://f1bot.onrender.com

cron.schedule('*/14 * * * *', () => {
  if (!RENDER_URL) return;
  http.get(RENDER_URL, (res) => {
    console.log(`🏓 Ping keep-alive → ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('❌ Ping échoué :', err.message);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════════════════════════════

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connecté à MongoDB');
    return client.login(process.env.DISCORD_TOKEN);
  })
  .catch(err => {
    console.error('❌ Erreur démarrage :', err);
    process.exit(1);
  });