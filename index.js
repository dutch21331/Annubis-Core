require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
let joinVoiceChannel, getVoiceConnection;
try { const v = require('@discordjs/voice'); joinVoiceChannel = v.joinVoiceChannel; getVoiceConnection = v.getVoiceConnection; } catch {}
let rssParser;
try { const RssParser = require('rss-parser'); rssParser = new RssParser(); } catch {}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
});

const PREFIX = process.env.PREFIX || '!';
const OWNER_ID = process.env.OWNER_ID;
const DATA_FILE = './data.json';
const PENDING_FILE = './pending.json';
const GIVEAWAYS_FILE = './giveaways.json';

const COUPONS_FILE = './coupons.json';
const YOUTUBE_FILE = './youtube.json';
const UPDATES_FILE = './updates.json';

function loadPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePending(p) {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(p, null, 2));
}

function loadUpdates() {
  try { return JSON.parse(fs.readFileSync(UPDATES_FILE, 'utf8')); }
  catch { return []; }
}
function saveUpdates(u) {
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(u, null, 2));
}

function loadCoupons() {
  try {
    return JSON.parse(fs.readFileSync(COUPONS_FILE, 'utf8'));
  } catch {
    return { weekly: [], monthly: [] };
  }
}

function saveCoupons(c) {
  fs.writeFileSync(COUPONS_FILE, JSON.stringify(c, null, 2));
}

function useCoupon(code) {
  const coupons = loadCoupons();
  for (const type of ['weekly', 'monthly']) {
    const idx = coupons[type].indexOf(code);
    if (idx !== -1) {
      coupons[type].splice(idx, 1);
      saveCoupons(coupons);
      return type;
    }
  }
  return null;
}

function loadGiveaways() {
  try { return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveGiveaways(g) {
  fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(g, null, 2));
}

function loadYouTube() {
  try { return JSON.parse(fs.readFileSync(YOUTUBE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveYouTube(y) {
  fs.writeFileSync(YOUTUBE_FILE, JSON.stringify(y, null, 2));
}

async function resolveYouTubeChannel(input) {
  input = input.trim();
  if (/^UC[\w-]{22,}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const m = url.pathname.match(/\/channel\/(UC[\w-]+)/);
    if (m) return m[1];
    const res = await fetch(input, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const id = html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/)?.[1]
            || html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/)?.[1];
    if (id) return id;
  } catch {}
  return null;
}

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)([mhd])$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'm') return val * 60000;
  if (unit === 'h') return val * 3600000;
  if (unit === 'd') return val * 86400000;
  return null;
}

const PROBOT_OWNER_ID = process.env.PROBOT_OWNER_ID || OWNER_ID;
const PRICE_WEEKLY = 500000;
const PRICE_MONTHLY = 1000000;
const BOT_IMAGE = process.env.BOT_IMAGE || 'https://cdn.discordapp.com/attachments/1359207575408083066/1359207575408083066/banner.png';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PROMO_CHANNEL_ID = process.env.PROMO_CHANNEL_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const AUTO_VC_ID = process.env.AUTO_VC_ID;
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID;

function loadData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getGuildData(guildId) {
  const data = loadData();
  if (!data[guildId]) {
    data[guildId] = { server_owner: null, allowed_users: [], subscription: null, autoDeleteChannels: [] };
    saveData(data);
  }
  return data[guildId];
}

function isAutoDeleteChannel(channelId) {
  const data = loadData();
  return Object.values(data).some(gd => gd.autoDeleteChannels?.includes(channelId));
}

function toggleAutoDeleteChannel(guildId, channelId) {
  const gd = getGuildData(guildId);
  const idx = (gd.autoDeleteChannels || []).indexOf(channelId);
  if (idx === -1) {
    if (!gd.autoDeleteChannels) gd.autoDeleteChannels = [];
    gd.autoDeleteChannels.push(channelId);
    const data = loadData();
    data[guildId] = gd;
    saveData(data);
    return true;
  } else {
    gd.autoDeleteChannels.splice(idx, 1);
    const data = loadData();
    data[guildId] = gd;
    saveData(data);
    return false;
  }
}

function isBotOwner(id) {
  return id === OWNER_ID;
}

function isServerOwner(guildId, id) {
  const gd = getGuildData(guildId);
  return gd.server_owner === id;
}

function isAllowed(guildId, id) {
  if (isBotOwner(id)) return true;
  const gd = getGuildData(guildId);
  return gd.server_owner === id || gd.allowed_users.includes(id);
}

function getRemainingTime(guildId) {
  const gd = getGuildData(guildId);
  if (!gd.subscription) return null;
  const start = new Date(gd.subscription.started_at);
  const end = new Date(start.getTime() + gd.subscription.duration_days * 86400000);
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return 'منتهي ❌';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `متبقي ${days} يوم و ${hours} ساعة`;
}

function isSubExpired(guildId) {
  const gd = getGuildData(guildId);
  if (!gd.subscription) return true;
  const start = new Date(gd.subscription.started_at);
  const end = new Date(start.getTime() + gd.subscription.duration_days * 86400000);
  return new Date() > end;
}

function isMonthly(guildId) {
  const gd = getGuildData(guildId);
  return gd?.subscription?.duration_days > 7;
}

async function checkExpiredSubs() {
  const data = loadData();
  for (const [guildId, gd] of Object.entries(data)) {
    if (gd.subscription && isSubExpired(guildId)) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        try {
          const owner = gd.server_owner ? await client.users.fetch(gd.server_owner).catch(() => null) : null;
          if (owner) {
            await owner.send(`❌ **انتهت اشتراكك في البوت!**\nالسيرفر: **${guild.name}**\nتم إخراج البوت من السيرفر. جدد اشتراكك للاستمرار.`);
          }
          await guild.leave();
          console.log(`Left guild ${guild.name} (${guildId}) - subscription expired`);
        } catch {}
      }
      delete data[guildId];
      saveData(data);
    }
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Bot Owner ID: ${OWNER_ID}`);
  if (!OWNER_ID) console.warn('OWNER_ID is not set in .env');

  const statuses = ['Annubis Community', 'Dev By : vuq2'];
  let i = 0;
  setInterval(() => {
    client.user.setPresence({
      activities: [{ name: statuses[i], type: ActivityType.Streaming, url: 'https://twitch.tv/katabump' }],
      status: 'idle',
    });
    i = (i + 1) % statuses.length;
  }, 2000);

  setInterval(checkExpiredSubs, 1800000);
  checkExpiredSubs();

  if (AUTO_VC_ID && joinVoiceChannel) {
    const vc = client.channels.cache.get(AUTO_VC_ID);
    if (vc) {
      joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator,
      });
    }
  }

  let firstYouTubeCheck = true;
  async function checkYouTube() {
    if (!rssParser) return;
    const yt = loadYouTube();
    if (!yt.channels) return;
    for (const [channelId, config] of Object.entries(yt.channels)) {
      try {
        const feed = await rssParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
        if (!feed.items?.length) continue;
        const latest = feed.items[0];
        const rawId = latest.ytVideoId || latest.id?.replace('yt:video:', '') || latest.link?.match(/v=([\w-]+)/)?.[1];
        if (!rawId) continue;
        if (firstYouTubeCheck || !config.lastVideoId) { config.lastVideoId = rawId; saveYouTube(yt); continue; }
        if (rawId === config.lastVideoId) continue;
        const pub = latest.isoDate || latest.pubDate || latest.published;
        if (pub && Date.now() - new Date(pub).getTime() > 600000) { config.lastVideoId = rawId; saveYouTube(yt); continue; }
        config.lastVideoId = rawId;
        saveYouTube(yt);
        const videoUrl = `https://www.youtube.com/watch?v=${rawId}`;
        for (const dc of config.discordChannels) {
          const dcId = dc.split('/').pop() || dc;
          const ch = client.channels.cache.get(dcId);
          if (ch) ch.send(`@everyone **فيديو جديد!**\n${videoUrl}`).catch(() => {});
        }
      } catch {}
    }
    firstYouTubeCheck = false;
  }
  checkYouTube();
  setInterval(checkYouTube, 300000);

  const giveaways = loadGiveaways();
  for (const [gwId, gw] of Object.entries(giveaways)) {
    const remaining = gw.endAt - Date.now();
    if (remaining <= 0) {
      delete giveaways[gwId];
      saveGiveaways(giveaways);
      continue;
    }
    const gChannel = client.channels.cache.get(gw.channelId);
    if (gChannel) {
      const gMsg = await gChannel.messages.fetch(gw.messageId).catch(() => null);
      if (gMsg) {
        const reaction = gMsg.reactions.cache.get('🎉');
        if (reaction) {
          const users = await reaction.users.fetch().catch(() => null);
          if (users) {
            const actual = [...users.keys()].filter(id => id !== client.user.id);
            const changed = JSON.stringify([...gw.entrants].sort()) !== JSON.stringify([...actual].sort());
            if (changed) {
              gw.entrants = actual;
              saveGiveaways(giveaways);
              const embed = EmbedBuilder.from(gMsg.embeds[0])
                .setDescription(`**${gw.prize}**\n\n⏳ ينتهي: <t:${Math.floor(gw.endAt / 1000)}:R>\n👥 المشتركين: **${gw.entrants.length}**\n\nتفاعل بـ 🎉 للمشاركة!`);
              await gMsg.edit({ embeds: [embed] }).catch(() => {});
            }
          }
        }
      }
    }
    setTimeout(async () => {
      const gws = loadGiveaways();
      const ggw = gws[gwId];
      if (!ggw) return;
      const channel = client.channels.cache.get(ggw.channelId);
      if (!channel) { delete gws[gwId]; saveGiveaways(gws); return; }
      const guildMsg = await channel.messages.fetch(ggw.messageId).catch(() => null);
      if (!guildMsg) { delete gws[gwId]; saveGiveaways(gws); return; }
      const entrants = ggw.entrants;
      if (entrants.length === 0) {
        const endEmbed = new EmbedBuilder()
          .setTitle('New Giveaway🎉')
          .setDescription(`**${ggw.prize}**\n\nلا يوجد مشتركين 😢`)
          .setColor('#000000');
        await guildMsg.edit({ embeds: [endEmbed], components: [] });
        delete gws[gwId];
        saveGiveaways(gws);
        return;
      }
      const winnerId = entrants[Math.floor(Math.random() * entrants.length)];
      const winner = await client.users.fetch(winnerId).catch(() => null);
      const endEmbed = new EmbedBuilder()
        .setTitle('New Giveaway🎉')
        .setDescription(`**${ggw.prize}**\n\n**الفائز:** ${winner ? winner : '<@' + winnerId + '>'}\n👥 عدد المشتركين: **${entrants.length}**\n\nمبروووك! 🎊🎊`)
        .setColor('#000000');
      await guildMsg.edit({ embeds: [endEmbed], components: [] });
      if (winner) await guildMsg.reply(`🎊 **مبروك ${winner}! ربحت ${ggw.prize}** 🎊`);
      delete gws[gwId];
      saveGiveaways(gws);
    }, remaining);
  }
});

client.on('guildCreate', async (guild) => {
  const data = loadData();
  if (!data[guild.id]) {
    data[guild.id] = { server_owner: null, allowed_users: [], subscription: null, autoDeleteChannels: [] };
  }

  const pending = loadPending();
  const guildKey = `guild:${guild.id}`;
  const ownerKey = guild.ownerId;
  const key = pending[guildKey] ? guildKey : (pending[ownerKey] ? ownerKey : null);
  if (key) {
    const p = pending[key];
    data[guild.id].server_owner = p.userId || guild.ownerId;
    data[guild.id].subscription = {
      started_at: new Date().toISOString(),
      duration_days: p.days,
      source: p.source || 'free',
    };
    saveData(data);
    delete pending[key];
    savePending(pending);

    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;
    const dmEmbed = new EmbedBuilder()
      .setTitle('🎉 Annubis BroadCast')
      .setDescription(`✅ **تم تفعيل اشتراكك${p.source === 'paid' ? ' المدفوع' : ' المجاني'} في سيرفر ${guild.name}!**\n\n**النوع:** ${p.label}\n**المدة:** ${p.days} يوم\n\n📍 استخدم \`!help\` للبدء.`)
      .setColor('#00FF00')
      .setImage(BOT_IMAGE);
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('🔗 رابط الدعوة')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteLink),
      );
    const userId = p.userId || guild.ownerId;
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [dmEmbed], components: [row] });
    } catch {}
    if (CLIENT_ROLE_ID) {
      try {
        const member = await guild.members.fetch(userId);
        if (member) member.roles.add(CLIENT_ROLE_ID);
      } catch {}
    }

    if (LOG_CHANNEL_ID) {
      const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        const endDate = new Date(Date.now() + p.days * 86400000);
        const logEmbed = new EmbedBuilder()
          .setTitle(`🎁 اشتراك${p.source === 'paid' ? ' مدفوع' : ' مجاني'} - تم التفعيل`)
          .setColor('#00FF00')
          .addFields(
            { name: '👤 المستخدم', value: `<@${p.userId || guild.ownerId}>`, inline: true },
            { name: '🌐 السيرفر', value: `**${guild.name}** (\`${guild.id}\`)`, inline: true },
            { name: '📅 النوع', value: p.label, inline: true },
            { name: '⏳ المدة', value: `${p.days} يوم`, inline: true },
            { name: '📆 ينتهي', value: `<t:${Math.floor(endDate.getTime() / 1000)}:R>`, inline: true },
          )
          .setTimestamp();
        logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
  } else {
    saveData(data);
  }
});

client.on('guildDelete', async (guild) => {
  const data = loadData();
  if (data[guild.id]) {
    delete data[guild.id];
    saveData(data);
  }
});

client.on('messageCreate', async (message) => {
  const guildId = message.guild?.id;

  if (message.author.bot) {
    if (TICKET_CATEGORY_ID && message.channel.parentId === TICKET_CATEGORY_ID && message.author.id !== client.user.id) {
      const pending = loadPending();
      const ticketInfo = pending[message.channel.id];
      if (ticketInfo) {
        const amountStr = ticketInfo.rawPrice.toLocaleString();
        if (message.content.includes(amountStr) || message.content.includes(String(ticketInfo.rawPrice))) {
          const { userId, type, days, label } = ticketInfo;
          pending[userId] = { type, days, label, source: 'paid' };
          delete pending[message.channel.id];
          savePending(pending);

          const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;
          const confirm = new EmbedBuilder()
            .setTitle('✅ تم استلام التحويل!')
            .setDescription(`شكراً لشرائك **Annubis BroadCast**! ❤️\n\n**النوع:** ${label}\n**المدة:** ${days} يوم\n**المبلغ:** ${ticketInfo.rawPrice.toLocaleString()} كريديت\n\nتم إرسال رابط البوت لك في الخاص.`)
            .setColor('#00FF00');
          await message.channel.send({ embeds: [confirm] });

          const dm = new EmbedBuilder()
            .setTitle('🎉 Annubis BroadCast')
            .setDescription(`**مرحباً بك!**\n\n✅ تم تفعيل اشتراكك المدفوع بنجاح!\n\n**النوع:** ${label}\n**المدة:** ${days} يوم\n\n👇 اضغط الزر أدناه لدعوة البوت لسيرفرك`)
            .setColor('#5865F2')
            .setImage(BOT_IMAGE);
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('🔗 دعوة البوت لسيرفرك')
                .setStyle(ButtonStyle.Link)
                .setURL(inviteLink),
            );
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [dm], components: [row] });
          } catch {}

          if (LOG_CHANNEL_ID) {
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('💳 اشتراك مدفوع - تم التفعيل')
                .setColor('#00FF00')
                .addFields(
                  { name: '👤 المشتري', value: `<@${userId}>`, inline: true },
                  { name: '📅 النوع', value: label, inline: true },
                  { name: '💰 المبلغ', value: `${ticketInfo.rawPrice.toLocaleString()} كريديت`, inline: true },
                )
                .setTimestamp();
              logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
          }

          if (CLIENT_ROLE_ID) {
            try {
              const ticketMember = await message.guild.members.fetch(userId);
              if (ticketMember) ticketMember.roles.add(CLIENT_ROLE_ID);
            } catch {}
          }
          setTimeout(() => message.channel.delete().catch(() => {}), 5000);
          return;
        }
      }
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  if (!guildId) return;

  message.delete().catch(() => {});
  const _channel = message.channel;
  const _origSend = _channel.send.bind(_channel);
  _channel.send = (opts) => _origSend(opts).then(m => { if (isAutoDeleteChannel(_channel.id)) setTimeout(() => m.delete().catch(() => {}), 5000); return m; });

  if (command === 'autodel') {
    if (!isBotOwner(message.author.id)) return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    const enabled = toggleAutoDeleteChannel(guildId, message.channel.id);
    return message.channel.send(`✅ ${enabled ? 'تم تفعيل' : 'تم إلغاء'} الحذف التلقائي في هذه القناة.`);
  }

  if (command === 'help') {
    if (isBotOwner(message.author.id)) {
      const embed = new EmbedBuilder()
        .setTitle('Annubis BrodCast | Help Panel')
        .setColor('#5865F2');

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('dev_subscriptions')
            .setLabel('📊 معلومات الاشتراكات')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('dev_stats')
            .setLabel('📈 إحصائيات')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('dev_commands')
            .setLabel('📋 الأوامر')
            .setStyle(ButtonStyle.Secondary),
        );

      return message.channel.send({ embeds: [embed], components: [row] });
    }

    const embed = new EmbedBuilder()
      .setTitle('Annubis BroadCast')
      .setDescription('🤖 **بوت برودكاست احترافي**\n\n📨 يقوم بإرسال رسائل خاصة لجميع أعضاء السيرفر')
      .setColor('#5865F2');

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('user_commands')
          .setLabel('📋 أوامري')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('info_bot')
          .setLabel('❓ معلومات')
          .setStyle(ButtonStyle.Secondary),
      );

    return message.channel.send({ embeds: [embed], components: [row] });
  }

  if (command === 'send') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) {
      return message.channel.send('❌ انتهت صلاحية الاشتراك في هذا السيرفر.');
    }
    if (!isAllowed(guildId, message.author.id)) {
      return message.channel.send('❌ لا تملك الصلاحية لاستخدام هذا الأمر.');
    }

    const broadcastMessage = args.join(' ');
    if (!broadcastMessage) {
      return message.channel.send('❌ اكتب رسالة للإرسال.\nالاستخدام: `!send <رسالة>`');
    }

    const members = await message.guild.members.fetch();
    let sent = 0;
    let failed = 0;

    const statusMsg = await message.channel.send(`📨 جاري الإرسال لـ ${members.size} عضو...`);

    for (const [, member] of members) {
      if (member.user.bot) continue;
      try {
        await member.send(broadcastMessage);
        sent++;
      } catch {
        failed++;
      }
    }

    const botsTotal = members.filter(m => m.user.bot).size;
    await statusMsg.edit(
      `✅ **تم الإرسال بنجاح!**\n📨 تم الإرسال: **${sent}**\n❌ فشل (الخاص مقفول): **${failed}**\n👥 الأعضاء (بدون البوتات): **${members.size - botsTotal}**`
    );

    const data = loadData();
    if (!data._stats) data._stats = { totalBroadcasts: 0, totalDms: 0 };
    data._stats.totalBroadcasts++;
    data._stats.totalDms += sent;
    saveData(data);
  }

  if (command === 'adduser') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) return message.channel.send('❌ انتهت صلاحية الاشتراك.');
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك هذا السيرفر يستطيع استخدام هذا الأمر.');
    }

    const target = args[0]?.replace(/[<@!>]/g, '');
    if (!target) return message.channel.send('❌ الاستخدام: `!adduser <@شخص>`');

    const data = loadData();
    const gd = data[guildId];
    if (!gd) return message.channel.send('❌ هذا السيرفر غير مسجل.');
    if (gd.allowed_users.includes(target)) return message.channel.send('⚠️ هذا المستخدم مضاف مسبقاً.');
    gd.allowed_users.push(target);
    saveData(data);
    message.channel.send(`✅ <@${target}> أصبح بإمكانه استخدام !send الآن.`);
  }

  if (command === 'removeuser') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) return message.channel.send('❌ انتهت صلاحية الاشتراك.');
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك هذا السيرفر يستطيع استخدام هذا الأمر.');
    }

    const target = args[0]?.replace(/[<@!>]/g, '');
    if (!target) return message.channel.send('❌ الاستخدام: `!removeuser <@شخص>`');

    const data = loadData();
    const gd = data[guildId];
    if (!gd) return message.channel.send('❌ هذا السيرفر غير مسجل.');
    const idx = gd.allowed_users.indexOf(target);
    if (idx === -1) return message.channel.send('⚠️ هذا المستخدم غير موجود في القائمة.');
    gd.allowed_users.splice(idx, 1);
    saveData(data);
    message.channel.send(`✅ تمت إزالة <@${target}> من المصرح لهم.`);
  }

  if (command === 'listusers') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) return message.channel.send('❌ انتهت صلاحية الاشتراك.');
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك هذا السيرفر يستطيع استخدام هذا الأمر.');
    }

    const gd = getGuildData(guildId);
    if (gd.allowed_users.length === 0) return message.channel.send('📭 لا يوجد مستخدمين مصرح لهم حالياً.');
    const list = gd.allowed_users.map(id => `<@${id}>`).join('\n');
    message.channel.send(`**المستخدمين المصرح لهم في هذا السيرفر:**\n${list}`);
  }

  if (command === 'setowner') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const target = args[0]?.replace(/[<@!>]/g, '');
    if (!target) return message.channel.send('❌ الاستخدام: `!setowner <@شخص>`');

    const data = loadData();
    if (!data[guildId]) data[guildId] = { server_owner: null, allowed_users: [], subscription: null, autoDeleteChannels: [] };
    data[guildId].server_owner = target;
    saveData(data);
    message.channel.send(`✅ <@${target}> أصبح مالك هذا السيرفر.`);

    try {
      const user = await client.users.fetch(target);
      const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;

      const embed = new EmbedBuilder()
        .setTitle('🎉 تم تعيينك مالكاً للبوت!')
        .setDescription(`السيرفر: **${message.guild.name}**`)
        .setColor('#5865F2');

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('get_link')
            .setLabel('🔗 رابط إضافة البوت')
            .setStyle(ButtonStyle.Link)
            .setURL(inviteLink),
          new ButtonBuilder()
            .setCustomId('show_link')
            .setLabel('👁️ إظهار الرابط')
            .setStyle(ButtonStyle.Secondary),
        );

      await user.send({ embeds: [embed], components: [row] });
    } catch {
      message.channel.send('⚠️ تعذر إرسال رسالة خاصة للمستخدم.');
    }
  }

  if (command === 'coupons') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const coupons = loadCoupons();
    const weekly = coupons.weekly.join('\n') || 'لا يوجد';
    const monthly = coupons.monthly.join('\n') || 'لا يوجد';

    const embed = new EmbedBuilder()
      .setTitle('🎫 الأكواد المتاحة')
      .setColor('#5865F2')
      .addFields(
        { name: `📅 اسبوعي (${coupons.weekly.length})`, value: weekly, inline: true },
        { name: `📅 شهري (${coupons.monthly.length})`, value: monthly, inline: true },
      );
    message.channel.send({ embeds: [embed] });
  }

  if (command === 'mysub') {
    const gd = getGuildData(guildId);
    if (!gd.subscription) return message.channel.send('❌ لا يوجد اشتراك نشط لهذا السيرفر.');

    const remaining = getRemainingTime(guildId);
    const start = new Date(gd.subscription.started_at);
    const end = new Date(start.getTime() + gd.subscription.duration_days * 86400000);

    const embed = new EmbedBuilder()
      .setTitle('📅 اشتراكك في Annubis BroadCast')
      .setColor('#5865F2')
      .addFields(
        { name: '🌐 السيرفر', value: message.guild.name, inline: true },
        { name: '⏳ المتبقي', value: remaining || 'منتهي', inline: true },
        { name: '📆 ينتهي', value: `<t:${Math.floor(end.getTime() / 1000)}:R>`, inline: true },
      );
    message.channel.send({ embeds: [embed] });
  }

  if (command === 'add') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const type = args[0]?.toLowerCase();
    const code = args[1];
    if (!type || !code || !['w', 'm', 'اسبوعي', 'شهري'].includes(type)) {
      return message.channel.send('❌ الاستخدام: `!add <w/m> <الكود>`\n`!add w كود123` - اسبوعي\n`!add m كود123` - شهري');
    }
    const normalizedType = (type === 'اسبوعي' || type === 'w') ? 'weekly' : 'monthly';

    const coupons = loadCoupons();
    coupons[normalizedType].push(code);
    saveCoupons(coupons);
    message.channel.send(`✅ تم إضافة كود **${code}** (${normalizedType === 'weekly' ? 'اسبوعي' : 'شهري'}).`);
  }

  if (command === 'promo') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🚀 Annubis BroadCast')
      .setDescription('**بوت برودكاست احترافي لسيرفرك**\n\n✅ أرسل رسائل لجميع الأعضاء\n👑 تحكم كامل بالصلاحيات\n📦 سلاسة الاستخدام ودعم فني متواصل')
      .addFields(
        { name: '💳 اسبوعي', value: `500,000 كريديت`, inline: true },
        { name: '💳 شهري', value: `1,000,000 كريديت`, inline: true },
      )
      .setColor('#5865F2')
      .setImage(BOT_IMAGE);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('show_plans')
          .setLabel('💳 اشتر الآن')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('free_coupon')
          .setLabel('🎁 اشتراك مجاني')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('info_bot')
          .setLabel('❓ معلومات')
          .setStyle(ButtonStyle.Secondary),
      );

    if (PROMO_CHANNEL_ID) {
      const promoChannel = client.channels.cache.get(PROMO_CHANNEL_ID);
      if (promoChannel) {
        promoChannel.send({ embeds: [embed], components: [row] });
        message.channel.send(`✅ تم إرسال الإعلان في <#${PROMO_CHANNEL_ID}>.`);
      } else {
        message.channel.send('❌ روم الإعلانات غير موجود.');
      }
    } else {
      message.channel.send({ embeds: [embed], components: [row] });
    }
  }



  if (command === 'rules') {
    const rulesAr = '📜 **قوانين سيرفر Annubis**\n' +
      'سيرفر مجتمعي + خدمات برمجة — نرحب بالجميع 🤝\n\n' +
      '**1⃣ احترام الجميع**\n' +
      'التعامل بأدب واحترام مع جميع الأعضاء. لا مكان للتنمر، الإساءة، أو التمييز.\n\n' +
      '**2⃣ الممنوعات**\n' +
      'ممنوع السبام، الإعلانات بدون إذن الإدارة، مشاركة ملفات ضارة، أو إرسال محتوى 18+.\n\n' +
      '**3⃣ القنوات الصوتية**\n' +
      'عدم إزعاج الآخرين، يمنع تشغيل أصوات مزعجة أو موسيقى بدون إذن.\n\n' +
      '**4⃣ خدمات البرمجة**\n' +
      'لطلب خدمة برمجية افتح تذكرة. الدفع عبر البوت فقط. يمنع طلب استرجاع بعد البدء.\n' +
      '<#1521896838977032242> — للاستفادة من خدماتنا\n\n' +
      '**5⃣ الدعم الفني**\n' +
      'للاستفسار عن البوت أو المشاكل استخدم الرومات المخصصة أو تذكرة.\n' +
      '<#1521633501105881158> — للدعم الفني\n\n' +
      '**6⃣ الاشتراكات**\n' +
      'الاشتراك في البوت عن طريق كوبون مجاني أو شراء. الاشتراك مرتبط بالسيرفر وليس العضو.\n\n' +
      '**7⃣ الإبلاغ**\n' +
      'للابحاغ عن مخالفة راسل الإدارة أو استخدم التذاكر.\n\n' +
      '**8⃣ القرار النهائي**\n' +
      'قرار الإدارة نهائي في جميع الحالات. يرجى الاحترام والتعاون.\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      'Annubis BroadCast | Dev By : vuq2';

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('translate_rules')
        .setLabel('🌐 Translate to English')
        .setStyle(ButtonStyle.Secondary),
    );

    await message.channel.send({ content: rulesAr, components: [row] });
    return;
  }

  if (command === 'say') {
    if (!isBotOwner(message.author.id)) return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    const channelMatch = args[0]?.match(/<#(\d+)>/);
    if (!channelMatch) return message.channel.send('❌ الاستخدام: `!say <#الروم> <النص>`');
    const targetChannel = client.channels.cache.get(channelMatch[1]);
    if (!targetChannel) return message.channel.send('❌ الروم غير موجود.');
    const text = args.slice(1).join(' ');
    if (!text) return message.channel.send('❌ اكتب النص المرسل.');
    await targetChannel.send(text);
    return;
  }

  if (command === 'embed') {
    if (!isBotOwner(message.author.id)) return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    const modal = new ModalBuilder()
      .setCustomId('embed_modal')
      .setTitle('🎨 إنشاء إيمبد مخصص')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('العنوان')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('أدخل عنوان الإيمبد')
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_desc')
            .setLabel('الوصف')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('أدخل وصف الإيمبد')
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('اللون (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FFD700 أو blue أو 16766720')
            .setRequired(false),
        ),
      );
    await message.channel.send({ content: '🎨 افتح المنيو لإنشاء الإيمبد 👇', components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_embed_modal')
        .setLabel('🎨 إنشاء إيمبد')
        .setStyle(ButtonStyle.Primary),
    )] });
    return;
  }

  if (command === 'servers') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const guilds = client.guilds.cache;
    if (guilds.size === 0) return message.channel.send('📭 البوت ليس في أي سيرفر.');

    const data = loadData();
    const lines = guilds.map(g => {
      const gd = data[g.id];
      const owner = gd?.server_owner ? `<@${gd.server_owner}>` : '❌ غير معين';
      const sub = gd?.subscription
        ? `✅ ${gd.subscription.duration_days} يوم\n⏳ ${getRemainingTime(g.id)}`
        : '❌ لا يوجد';
      return `**${g.name}** (\`${g.id}\`)\n👑 المالك: ${owner}\n📅 الاشتراك: ${sub}\n👥 الأعضاء: ${g.memberCount}`;
    });

    const embeds = [];
    for (let i = 0; i < lines.length; i += 5) {
      const chunk = lines.slice(i, i + 5).join('\n\n');
      embeds.push(new EmbedBuilder()
        .setTitle(`🌐 السيرفرات (${guilds.size})`)
        .setDescription(chunk)
        .setColor('#5865F2')
      );
    }
    for (const e of embeds) {
      await message.channel.send({ embeds: [e] });
    }
  }

  if (command === 'leave') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const targetId = args[0];
    if (!targetId) return message.channel.send('❌ الاستخدام: `!leave <server_id>`');

    const guild = client.guilds.cache.get(targetId);
    if (!guild) return message.channel.send('❌ البوت ليس في هذا السيرفر.');

    const data = loadData();
    delete data[targetId];
    saveData(data);

    try {
      await guild.leave();
      message.channel.send(`✅ تم إخراج البوت من **${guild.name}**.`);
    } catch {
      message.channel.send('❌ حدث خطأ أثناء إخراج البوت.');
    }
  }

  if (command === 'setsub') {
    if (!isBotOwner(message.author.id)) {
      return message.channel.send('❌ فقط مطور البوت يستطيع استخدام هذا الأمر.');
    }

    const targetId = args[0];
    const days = parseInt(args[1]);
    if (!targetId || !days || days < 1) {
      return message.channel.send('❌ الاستخدام: `!setsub <server_id> <عدد الأيام>`');
    }

    const data = loadData();
    if (!data[targetId]) return message.channel.send('❌ هذا السيرفر غير مسجل.');
    data[targetId].subscription = {
      started_at: new Date().toISOString(),
      duration_days: days,
      source: 'paid',
    };
    saveData(data);

    const guild = client.guilds.cache.get(targetId);
    const name = guild ? guild.name : targetId;
    message.channel.send(`✅ تم تفعيل اشتراك **${days} يوم** لـ **${name}**.`);
  }

  if (command === 'setname') {
    if (!isBotOwner(message.author.id) && (isSubExpired(guildId) || !isMonthly(guildId))) return message.channel.send('❌ هذه الميزة متاحة فقط للمشتركين شهري.');
    const newName = args.join(' ');
    if (!newName) return message.channel.send('❌ الاستخدام: `!setname <الاسم الجديد>`');
    try {
      await message.guild.members.me.setNickname(newName);
      message.channel.send(`✅ تم تغيير اسم البوت في هذا السيرفر إلى **${newName}**.`);
    } catch (e) {
      message.channel.send(`❌ خطأ: ${e.message}`);
    }
  }

  if (command === 'vc') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) return message.channel.send('❌ انتهت صلاحية الاشتراك في هذا السيرفر.');
    if (!joinVoiceChannel) return message.channel.send('❌ مكتبة الصوت غير مثبتة.\nشغّل هذا الأمر في التيرمنل:\n`npm install @discordjs/voice`');
    const existing = getVoiceConnection(message.guild.id);
    if (existing) {
      existing.destroy();
      return message.channel.send('✅ طلعت من الروم الصوتي.');
    }
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) return message.channel.send('❌ يجب أن تكون في روم صوتي.');
    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    message.channel.send(`✅ دخلت **${voiceChannel.name}**.`);
  }

  if (command === 'site' || command === 'website') {
    message.channel.send('🌐 **موقع Annubis BroadCast:**\nhttps://dutch21331.github.io/annubis-prodcast');
  }

  if (command === 'y' || command === 'yt') {
    if (!isBotOwner(message.author.id) && (isSubExpired(guildId) || !isMonthly(guildId))) return message.channel.send('❌ هذه الميزة متاحة فقط للمشتركين شهري.');
    let sub = args[0]?.toLowerCase();
    if (sub && sub !== 'add' && sub !== 'remove' && sub !== 'list') {
      sub = 'add';
      args.unshift('add');
    }
    if (sub === 'add') {
      const raw = args[1];
      const discordChannel = args[2]?.replace(/[<#>]/g, '');
      if (!raw || !discordChannel) return message.channel.send('❌ الاستخدام:\n\`!y add <رابط_أو_ايدي_يوتيوب> <#الروم>\`\n\`!y <رابط_أو_ايدي_يوتيوب> <#الروم>\`');
      const ytChannel = await resolveYouTubeChannel(raw);
      if (!ytChannel) return message.channel.send('❌ ما لقيت ايدي القناة. تأكد من الرابط أو استخدم ايدي القناة مباشرة.');
      const yt = loadYouTube();
      if (!yt.channels) yt.channels = {};
      const existing = yt.channels[ytChannel];
      let lastId = existing?.lastVideoId || null;
      if (!lastId && rssParser) {
        try {
          const feed = await rssParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytChannel}`);
          const top = feed.items?.[0];
          if (top) lastId = top.ytVideoId || top.id?.replace('yt:video:', '') || top.link?.match(/v=([\w-]+)/)?.[1] || null;
        } catch {}
      }
      yt.channels[ytChannel] = { discordChannels: [...(existing?.discordChannels || []), discordChannel], lastVideoId: lastId };
      saveYouTube(yt);
      message.channel.send(`✅ تم إضافة مراقبة يوتيوب \`${ytChannel}\` في <#${discordChannel}>.${lastId ? '' : '\n⚠️ ما لقيت فيديوهات سابقة، أول فيديو جديد بينشاف.'}`);
    } else if (sub === 'remove') {
      const ytChannel = args[1];
      if (!ytChannel) return message.channel.send('❌ الاستخدام: `!yt remove <ايدي_يوتيوب>`');
      const yt = loadYouTube();
      if (!yt.channels?.[ytChannel]) return message.channel.send('❌ هذا اليوتيوبر غير مضاف.');
      delete yt.channels[ytChannel];
      saveYouTube(yt);
      message.channel.send(`✅ تم إزالة مراقبة **${ytChannel}**.`);
    } else if (sub === 'list') {
      const yt = loadYouTube();
      if (!yt.channels || !Object.keys(yt.channels).length) return message.channel.send('📭 لا توجد قنوات يوتيوب مراقبة.');
      let list;
      if (rssParser) {
        const entries = await Promise.all(Object.entries(yt.channels).map(async ([id, c]) => {
          let name = id;
          try {
            const feed = await rssParser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
            if (feed.title) name = feed.title;
          } catch {}
          return `**${name}** (\`${id}\`)`;
        }));
        list = entries.join('\n');
      } else {
        list = Object.entries(yt.channels).map(([id, c]) =>
          `**${id}**`
        ).join('\n');
      }
      message.channel.send(`📋 **قنوات اليوتيوب المراقبة:**\n${list}`);
    } else {
      message.channel.send('❌ الاستخدام:\n`!y add <ايدي_أو_رابط_يوتيوب> <#الروم>`\n`!y remove <ايدي_يوتيوب>`\n`!y list`');
    }
  }


  if (command === 'g' || command === 'giveaway') {
    if (!isBotOwner(message.author.id) && isSubExpired(guildId)) return message.channel.send('❌ انتهت صلاحية الاشتراك في هذا السيرفر.');
    const timeStr = args[0];
    const prize = args.slice(1).join(' ');
    const ms = parseDuration(timeStr);
    if (!ms || !prize) return message.channel.send('❌ الاستخدام: `!g <مدة> <جائزة>`\nمثال: `!g 1h اشتراك شهري`\nالمدة: 1m (دقيقة), 1h (ساعة), 1d (يوم)');
    const endAt = Date.now() + ms;
    const gwId = `${message.channel.id}_${Date.now()}`;

    const embed = new EmbedBuilder()
      .setTitle('New Giveaway🎉')
      .setDescription(`**${prize}**\n\n⏳ ينتهي: <t:${Math.floor(endAt / 1000)}:R>\n👥 المشتركين: **0**\n\nتفاعل بـ 🎉 للمشاركة!`)
      .setColor('#000000');

    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react('🎉');
    const giveaways = loadGiveaways();
    giveaways[gwId] = { channelId: message.channel.id, messageId: msg.id, prize, endAt, entrants: [], hostId: message.author.id };
    saveGiveaways(giveaways);
    message.channel.send(`✅ تم إنشاء الجيفاواي!`);

    setTimeout(async () => {
      const gws = loadGiveaways();
      const gw = gws[gwId];
      if (!gw) return;
      const channel = client.channels.cache.get(gw.channelId);
      if (!channel) return;
      const guildMsg = await channel.messages.fetch(gw.messageId).catch(() => null);
      if (!guildMsg) return;
      const entrants = gw.entrants;
      if (entrants.length === 0) {
        const endEmbed = new EmbedBuilder()
          .setTitle('New Giveaway🎉')
          .setDescription(`**${gw.prize}**\n\nلا يوجد مشتركين 😢`)
          .setColor('#000000');
        await guildMsg.edit({ embeds: [endEmbed], components: [] });
        delete gws[gwId];
        saveGiveaways(gws);
        return;
      }
      const winnerId = entrants[Math.floor(Math.random() * entrants.length)];
      const winner = await client.users.fetch(winnerId).catch(() => null);
      const endEmbed = new EmbedBuilder()
        .setTitle('New Giveaway🎉')
        .setDescription(`**${gw.prize}**\n\n**الفائز:** ${winner ? winner : '<@' + winnerId + '>'}\n👥 عدد المشتركين: **${entrants.length}**\n\nمبروووك! 🎊🎊`)
        .setColor('#000000');
      await guildMsg.edit({ embeds: [endEmbed], components: [] });
      if (winner) await guildMsg.reply(`🎊 **مبروك ${winner}! ربحت ${gw.prize}** 🎊`);
      delete gws[gwId];
      saveGiveaways(gws);
    }, ms);
  }

  if (command === 'private' || command === 'public') {
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك السيرفر يستطيع استخدام هذا الأمر.');
    }
    const target = message.mentions.channels.first() || message.channel;
    const isPrivate = command === 'private';
    await target.permissionOverwrites.edit(message.guild.roles.everyone, {
      ViewChannel: isPrivate ? false : null,
    });
    return message.channel.send(`> ${isPrivate ? '🔒' : '🔓'} **${target.name}** → ${isPrivate ? '**Private Room**' : '**Public Room**'}`);
  }

  if (command === 'privateall' || command === 'publicall') {
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك السيرفر يستطيع استخدام هذا الأمر.');
    }
    const isPrivate = command === 'privateall';
    const channels = message.guild.channels.cache.filter(c => c.type !== 4);
    let done = 0;
    for (const [, c] of channels) {
      try {
        await c.permissionOverwrites.edit(message.guild.roles.everyone, {
          ViewChannel: isPrivate ? false : null,
        });
        done++;
      } catch {}
    }
    return message.channel.send(`> ${isPrivate ? '🔒' : '🔓'} **${done}** روم → ${isPrivate ? '**Private**' : '**Public**'}`);
  }

  if (command === 'lock' || command === 'unlock') {
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك السيرفر يستطيع استخدام هذا الأمر.');
    }
    const target = message.mentions.channels.first() || message.channel;
    const isLock = command === 'lock';
    await target.permissionOverwrites.edit(message.guild.roles.everyone, {
      SendMessages: isLock ? false : null,
    });
    return message.channel.send(`> ${isLock ? '🔒' : '🔓'} **${target.name}** → ${isLock ? '**Locked**' : '**Unlocked**'}`);
  }

  if (command === 'lockall' || command === 'unlockall') {
    if (!isBotOwner(message.author.id) && !isServerOwner(guildId, message.author.id)) {
      return message.channel.send('❌ فقط مالك السيرفر يستطيع استخدام هذا الأمر.');
    }
    const isLock = command === 'lockall';
    const channels = message.guild.channels.cache.filter(c => c.type === 0);
    let done = 0;
    for (const [, c] of channels) {
      try {
        await c.permissionOverwrites.edit(message.guild.roles.everyone, {
          SendMessages: isLock ? false : null,
        });
        done++;
      } catch {}
    }
    return message.channel.send(`> ${isLock ? '🔒' : '🔓'} **${done}** روم نصي → ${isLock ? '**Locked**' : '**Unlocked**'}`);
  }

  if (command === 'updates') {
    const updates = loadUpdates();
    if (!updates.length) return message.channel.send('📋 لا يوجد تحديثات بعد.');
    const embed = new EmbedBuilder()
      .setTitle('📋 آخر التحديثات')
      .setColor('#5865F2')
      .setDescription(updates.map((u, i) => `**#${updates.length - i}** — <t:${Math.floor(new Date(u.date).getTime() / 1000)}:D>\n${u.text}`).join('\n\n'))
      .setFooter({ text: `إجمالي التحديثات: ${updates.length}` });
    return message.channel.send({ embeds: [embed] });
  }

  if (command === 'addupdate') {
    if (!isBotOwner(message.author.id)) return message.channel.send('❌ فقط المطور.');
    const text = args.join(' ');
    if (!text) return message.channel.send('❌ اكتب التحديث.\nالاستخدام: `+addupdate <نص التحديث>`');
    const updates = loadUpdates();
    updates.push({ date: new Date().toISOString().split('T')[0], text });
    saveUpdates(updates);
    return message.channel.send(`✅ تم إضافة التحديث.\n> **#${updates.length}** ${text}`);
  }

});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;
  if (reaction.partial) {
    try { await reaction.fetch(); }
    catch { return; }
  }
  const giveaways = loadGiveaways();
  const gw = Object.values(giveaways).find(g => g.messageId === reaction.message.id && g.channelId === reaction.message.channel.id);
  if (!gw) return;
  if (gw.entrants.includes(user.id)) return;
  gw.entrants.push(user.id);
  saveGiveaways(giveaways);
  const channel = client.channels.cache.get(gw.channelId);
  if (channel) {
    const guildMsg = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (guildMsg) {
      const embed = EmbedBuilder.from(guildMsg.embeds[0])
        .setDescription(`**${gw.prize}**\n\n⏳ ينتهي: <t:${Math.floor(gw.endAt / 1000)}:R>\n👥 المشتركين: **${gw.entrants.length}**\n\nتفاعل بـ 🎉 للمشاركة!`);
      await guildMsg.edit({ embeds: [embed] });
    }
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;
  if (reaction.partial) {
    try { await reaction.fetch(); }
    catch { return; }
  }
  const giveaways = loadGiveaways();
  const gw = Object.values(giveaways).find(g => g.messageId === reaction.message.id && g.channelId === reaction.message.channel.id);
  if (!gw) return;
  const idx = gw.entrants.indexOf(user.id);
  if (idx === -1) return;
  gw.entrants.splice(idx, 1);
  saveGiveaways(giveaways);
  const channel = client.channels.cache.get(gw.channelId);
  if (channel) {
    const guildMsg = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (guildMsg) {
      const embed = EmbedBuilder.from(guildMsg.embeds[0])
        .setDescription(`**${gw.prize}**\n\n⏳ ينتهي: <t:${Math.floor(gw.endAt / 1000)}:R>\n👥 المشتركين: **${gw.entrants.length}**\n\nتفاعل بـ 🎉 للمشاركة!`);
      await guildMsg.edit({ embeds: [embed] });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'commands') {
    const embed = new EmbedBuilder()
      .setTitle('📋 أوامر البوت')
      .setColor('#5865F2')
      .addFields(
        { name: '🌐 `!servers`', value: 'عرض كل السيرفرات', inline: false },
        { name: '🚪 `!leave <id>`', value: 'إخراج البوت من سيرفر', inline: false },
        { name: '💳 `!setsub <id> <أيام>`', value: 'تفعيل اشتراك لسيرفر', inline: false },
        { name: '👑 `!setowner <@شخص>`', value: 'تعيين مالك لسيرفر', inline: false },
        { name: '📨 `!send <رسالة>`', value: 'إرسال برودكاست', inline: false },
        { name: '👑 `!adduser <@شخص>`', value: 'إضافة مستخدم للبرودكاست', inline: false },
        { name: '👑 `!removeuser <@شخص>`', value: 'إزالة مستخدم', inline: false },
        { name: '👑 `!listusers`', value: 'عرض المصرح لهم', inline: false },
        { name: '📢 `!promo`', value: 'إرسال إعلان البوت في روم البيع', inline: false },
        { name: '📅 `!mysub`', value: 'مشاهدة متبقي اشتراكك', inline: false },
        { name: '🎫 `!coupons`', value: 'عرض الأكواد المجانية المتاحة', inline: false },
        { name: '🎫 `!add <w/m> <كود>`', value: 'إضافة كود اشتراك مجاني', inline: false },
        { name: '🗑️ `!autodel`', value: 'تفعيل/إلغاء الحذف التلقائي في القناة', inline: false },
        { name: '✏️ `!setname <اسم>`', value: 'تغيير اسم البوت', inline: false },
        { name: '🤖 `!say <#روم> <نص>`', value: 'إرسال رسالة بلسان البوت', inline: false },
        { name: '🎨 `!embed عنوان | وصف | لون`', value: 'إنشاء إيمبد مخصص', inline: false },
        { name: '❓ `!help`', value: 'عرض قائمة المساعدة.', inline: false },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'dev_subscriptions') {
    const data = loadData();
    const guilds = client.guilds.cache;
    let paid = [];
    let free = [];
    let noSub = [];

    for (const [id, gd] of Object.entries(data)) {
      const guild = guilds.get(id);
      const name = guild ? guild.name : id;
      const owner = gd.server_owner ? `<@${gd.server_owner}>` : '❌';
      const sub = gd.subscription;
      if (!sub) {
        noSub.push(`**${name}** (\`${id}\`) 👑 ${owner}`);
        continue;
      }
      const remaining = getRemainingTime(id);
      const line = `**${name}** (\`${id}\`) 👑 ${owner}\n📅 ${sub.duration_days} يوم ⏳ ${remaining}`;
      if (sub.source === 'free') free.push(line);
      else paid.push(line);
    }

    const embeds = [];
    const addSection = (title, items) => {
      if (!items.length) return;
      for (let i = 0; i < items.length; i += 5) {
        const chunk = items.slice(i, i + 5).join('\n');
        embeds.push(new EmbedBuilder()
          .setTitle(title)
          .setDescription(chunk || 'لا يوجد')
          .setColor('#5865F2'));
      }
    };
    addSection(`💳 الاشتراكات المدفوعة (${paid.length})`, paid);
    addSection(`🎁 الاشتراكات المجانية (${free.length})`, free);
    addSection(`❌ بدون اشتراك (${noSub.length})`, noSub);
    if (!embeds.length) embeds.push(new EmbedBuilder().setTitle('📊 الاشتراكات').setDescription('لا توجد بيانات').setColor('#5865F2'));
    return interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'dev_stats') {
    const guilds = client.guilds.cache;
    const data = loadData();
    let totalMembers = 0;
    guilds.forEach(g => { totalMembers += g.memberCount; });

    let activeSubs = 0;
    let expiredSubs = 0;
    let noSub = 0;
    let paidCount = 0;
    let freeCount = 0;
    let totalRevenue = 0;

    let paidWeekly = 0, paidMonthly = 0, freeWeekly = 0, freeMonthly = 0;

    for (const [, gd] of Object.entries(data)) {
      if (!gd.subscription) { noSub++; continue; }
      const isWeekly = gd.subscription.duration_days <= 7;
      if (gd.subscription.source === 'paid') {
        paidCount++;
        if (isWeekly) { paidWeekly++; totalRevenue += 500000; }
        else { paidMonthly++; totalRevenue += 1000000; }
      } else {
        freeCount++;
        if (isWeekly) freeWeekly++;
        else freeMonthly++;
      }
      const start = new Date(gd.subscription.started_at);
      const end = new Date(start.getTime() + gd.subscription.duration_days * 86400000);
      if (Date.now() > end.getTime()) expiredSubs++;
      else activeSubs++;
    }

    const coupons = loadCoupons();
    const weeklyCoupons = coupons.weekly?.length || 0;
    const monthlyCoupons = coupons.monthly?.length || 0;

    const stats = data._stats || { totalBroadcasts: 0, totalDms: 0 };

    const embed = new EmbedBuilder()
      .setTitle('📈 إحصائيات Annubis BroadCast')
      .setColor('#5865F2')
      .addFields(
        { name: '🌐 سيرفرات', value: `**${guilds.size}** سيرفر\n👥 **${totalMembers.toLocaleString()}** عضو`, inline: true },
        { name: '📨 بثوث', value: `**${stats.totalBroadcasts}** بث\n📩 **${stats.totalDms.toLocaleString()}** رسالة`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '✅ اشتراكات نشطة', value: `**${activeSubs}**`, inline: true },
        { name: '❌ منتهية', value: `**${expiredSubs}**`, inline: true },
        { name: '🚫 بدون', value: `**${noSub}**`, inline: true },
        { name: '💳 مدفوع', value: `اسبوعي: **${paidWeekly}**\nشهري: **${paidMonthly}**`, inline: true },
        { name: '🎁 مجاني', value: `اسبوعي: **${freeWeekly}**\nشهري: **${freeMonthly}**`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '💰 إيرادات', value: `**${totalRevenue.toLocaleString()}** كريديت`, inline: true },
        { name: '🎫 أكواد متبقية', value: `اسبوعي: **${weeklyCoupons}**\nشهري: **${monthlyCoupons}**`, inline: true },
        { name: '⏳ معلقة', value: `**${Object.keys(loadPending()).length}** تفعيل`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎉 جيفاواي', value: `إجمالي: **${Object.keys(loadGiveaways()).length}**`, inline: true },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'dev_commands') {
    const embed = new EmbedBuilder()
      .setTitle('📋 أوامر المطور')
      .setColor('#5865F2')
      .addFields(
        { name: '🌐 `!servers`', value: 'عرض كل السيرفرات', inline: false },
        { name: '🚪 `!leave <id>`', value: 'إخراج البوت من سيرفر', inline: false },
        { name: '💳 `!setsub <id> <أيام>`', value: 'تفعيل اشتراك لسيرفر', inline: false },
        { name: '👑 `!setowner <@شخص>`', value: 'تعيين مالك لسيرفر', inline: false },
        { name: '📨 `!send <رسالة>`', value: 'إرسال برودكاست', inline: false },
        { name: '👑 `!adduser <@شخص>`', value: 'إضافة مستخدم للبرودكاست', inline: false },
        { name: '👑 `!removeuser <@شخص>`', value: 'إزالة مستخدم', inline: false },
        { name: '👑 `!listusers`', value: 'عرض المصرح لهم', inline: false },
        { name: '📢 `!promo`', value: 'إرسال إعلان البوت في روم البيع', inline: false },
        { name: '📅 `!mysub`', value: 'مشاهدة متبقي اشتراكك', inline: false },
        { name: '🎫 `!coupons`', value: 'عرض الأكواد المجانية المتاحة', inline: false },
        { name: '🎫 `!add <w/m> <كود>`', value: 'إضافة كود اشتراك مجاني', inline: false },
        { name: '🗑️ `!autodel`', value: 'تفعيل/إلغاء الحذف التلقائي في القناة', inline: false },
        { name: '✏️ `!setname <اسم>`', value: 'تغيير اسم البوت', inline: false },
        { name: '🎉 `!g <مدة> <جائزة>`', value: 'إنشاء جيفاواي', inline: false },
        { name: '🔊 `!vc`', value: 'دخول/خروج من الروم الصوتي', inline: false },
        { name: '▶️ `!y`', value: 'إدارة إشعارات يوتيوب', inline: false },
        { name: '🤖 `!say <#روم> <نص>`', value: 'إرسال رسالة بلسان البوت', inline: false },
        { name: '🎨 `!embed عنوان | وصف | لون`', value: 'إنشاء إيمبد مخصص', inline: false },
        { name: '🔒 `+private [#روم]`', value: 'جعل روم خاص', inline: false },
        { name: '🔓 `+public [#روم]`', value: 'جعل روم عام', inline: false },
        { name: '🔒 `+privateall`', value: 'جعل كل الرومات خاصة', inline: false },
        { name: '🔓 `+publicall`', value: 'جعل كل الرومات عامة', inline: false },
        { name: '🔒 `+lock [#روم]`', value: 'قفل روم (منع الكتابة)', inline: false },
        { name: '🔓 `+unlock [#روم]`', value: 'فتح روم (السماح بالكتابة)', inline: false },
        { name: '🔒 `+lockall`', value: 'قفل كل الرومات النصية', inline: false },
        { name: '🔓 `+unlockall`', value: 'فتح كل الرومات النصية', inline: false },
        { name: '📋 `+updates`', value: 'عرض آخر التحديثات', inline: false },
        { name: '✍️ `+addupdate <نص>`', value: 'إضافة تحديث جديد', inline: false },
        { name: '❓ `!help`', value: 'عرض هذه القائمة.', inline: false },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'dev') {
    const embed = new EmbedBuilder()
      .setTitle('👨‍💻 مطور البوت')
      .setDescription('**vuq2**')
      .setColor('#5865F2');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'free_coupon') {
    const modal = new ModalBuilder()
      .setCustomId('coupon_modal')
      .setTitle('🎁 اشتراك مجاني');

    const codeInput = new TextInputBuilder()
      .setCustomId('coupon_code')
      .setLabel('أدخل كود الاشتراك المجاني')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('اكتب الكود هنا')
      .setRequired(true);

    const serverIdInput = new TextInputBuilder()
      .setCustomId('server_id')
      .setLabel('🆔 ايدي السيرفر (السيرفر اللي تبغاه)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثلاً: 123456789012345678')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(codeInput),
      new ActionRowBuilder().addComponents(serverIdInput),
    );
    return interaction.showModal(modal);
  }

  if (interaction.customId.startsWith('set_bot_name_')) {
    const guildId = interaction.customId.replace('set_bot_name_', '');
    const modal = new ModalBuilder()
      .setCustomId(`rename_bot_${guildId}`)
      .setTitle('✏️ تخصيص اسم البوت');

    const serverIdInput = new TextInputBuilder()
      .setCustomId('server_id')
      .setLabel('🆔 آيدي السيرفر')
      .setStyle(TextInputStyle.Short)
      .setValue(guildId)
      .setRequired(true);

    const botNameInput = new TextInputBuilder()
      .setCustomId('bot_name')
      .setLabel('🤖 اسم البوت الجديد')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('اكتب الاسم الجديد هنا')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(serverIdInput),
      new ActionRowBuilder().addComponents(botNameInput),
    );
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'show_plans') {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('buy_weekly')
          .setLabel('📅 اسبوعي - 500k')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('buy_monthly')
          .setLabel('📅 شهري - 1M')
          .setStyle(ButtonStyle.Primary),
      );
    return interaction.reply({
      content: '📌 **اختر نوع الاشتراك:**',
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === 'buy_weekly' || interaction.customId === 'buy_monthly') {
    if (!TICKET_CATEGORY_ID) {
      return interaction.reply({ content: '❌ نظام التكتات غير مفعل.', flags: MessageFlags.Ephemeral });
    }

    const isWeekly = interaction.customId === 'buy_weekly';
    const price = isWeekly ? '500,000' : '1,000,000';
    const days = isWeekly ? 7 : 30;
    const label = isWeekly ? 'اسبوعي' : 'شهري';
    const rawPrice = isWeekly ? 500000 : 1000000;

    const channelName = `شراء-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\-]/g, '');

    try {
      const category = interaction.guild.channels.cache.get(TICKET_CATEGORY_ID);
      if (!category) return interaction.reply({ content: '❌ الكاتيغوري غير مفعلة.', flags: MessageFlags.Ephemeral });

      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: 0,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: ['ViewChannel'] },
          { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        ],
      });

      const pending = loadPending();
      pending[ticketChannel.id] = { userId: interaction.user.id, type: isWeekly ? 'weekly' : 'monthly', days, label, rawPrice };
      savePending(pending);

      const embed = new EmbedBuilder()
        .setTitle('📌 طلب شراء Annubis BroadCast')
        .setDescription(`**النوع:** ${label}\n**السعر:** ${price} كريديت\n**المدة:** ${days} يوم\n**المشتري:** ${interaction.user}`)
        .addFields(
          { name: '📋 ملاحظات:', value: `🔹 انتظر تأكيد بروبوت للتحويل\n🔹 البوت راح يتعرف على التأكيد تلقائياً ويرسل لك رابط البوت في الخاص` },
        )
        .setColor('#5865F2');

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('🔒 إغلاق')
            .setStyle(ButtonStyle.Danger),
        );

      await ticketChannel.send({ content: `${interaction.user} 👋`, embeds: [embed], components: [row] });

      const welcome = `📌 يرجى تحويل المبلغ المطلوب باستخدام الأمر:
\`c ${PROBOT_OWNER_ID} ${rawPrice}\`

بعد إتمام التحويل، سيقوم البوت بتأكيد العملية تلقائياً وإرسال رابط البوت لك في الخاص.

**شكراً لاختيارك خدماتنا!** 🙏`;
      const welcomeMsg = await ticketChannel.send(welcome);
      try { await welcomeMsg.pin(); } catch {}

      await interaction.reply({ content: `✅ تم فتح تكت لك: <#${ticketChannel.id}>`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.reply({ content: `❌ خطأ: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.customId === 'user_commands') {
    const gd = getGuildData(interaction.guildId);
    const isMonthly = gd?.subscription?.duration_days > 7;
    const embed = new EmbedBuilder()
      .setTitle(isMonthly ? '📋 أوامرك - اشتراك شهري' : '📋 أوامرك - اشتراك اسبوعي')
      .setColor('#5865F2')
      .addFields(
        { name: '📨 `!send <رسالة>`', value: 'إرسال برودكاست لجميع الأعضاء', inline: false },
        { name: '👑 `!adduser <@شخص>`', value: 'إضافة مستخدم للبرودكاست', inline: false },
        { name: '👑 `!removeuser <@شخص>`', value: 'إزالة مستخدم', inline: false },
        { name: '👑 `!listusers`', value: 'عرض المصرح لهم', inline: false },
        { name: '📅 `!mysub`', value: 'مشاهدة متبقي اشتراكك', inline: false },
        { name: '🎉 `!g <مدة> <جائزة>`', value: 'إنشاء سحوبات', inline: false },
        { name: '🔊 `!vc`', value: 'دخول/خروج من الروم الصوتي', inline: false },
      );
    if (isMonthly) {
      embed.addFields(
        { name: '✏️ `!setname <اسم>`', value: 'تغيير اسم البوت', inline: false },
        { name: '▶️ `!y`', value: 'إدارة إشعارات يوتيوب', inline: false },
      );
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'info_bot') {
    const embed = new EmbedBuilder()
      .setTitle('❓ عن Annubis BroadCast')
      .setDescription('**🎯 بوت برودكاست احترافي**\n\n📨 يرسل رسائل خاصة لكل الأعضاء\n🔒 صلاحيات كاملة (مالك + مصرح لهم)\n💳 اشتراك شهري ب 1,000,000 كريديت\n🤖 بوت واحد لكل السيرفرات\n👨‍💻 المطور: vuq2')
      .setColor('#5865F2');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'close_ticket') {
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({ content: '❌ فقط المطور يستطيع إغلاق التكت.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: '🔒 سيتم إغلاق التكت بعد 3 ثواني...' });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    return;
  }

  if (interaction.customId === 'show_link') {
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;
    return interaction.reply({
      content: `🔗 **رابط إضافة البوت لسيرفرك:**\n${inviteLink}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === 'open_embed_modal') {
    const modal = new ModalBuilder()
      .setCustomId('embed_modal')
      .setTitle('🎨 إنشاء إيمبد مخصص')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('العنوان')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('أدخل عنوان الإيمبد')
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_desc')
            .setLabel('الوصف')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('أدخل وصف الإيمبد')
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('اللون (اختياري)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FFD700 أو blue أو 16766720')
            .setRequired(false),
        ),
      );
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'translate_rules') {
    const content = interaction.message.content;
    const isArabic = /[\u0600-\u06FF]/.test(content);
    if (isArabic) {
      const rulesEn = '📜 **Annubis Server Rules**\n' +
        'Community Server + Programming Services — Everyone is welcome 🤝\n\n' +
        '**1⃣ Respect Everyone**\n' +
        'Be polite and respectful to all members. No bullying, harassment, or discrimination.\n\n' +
        '**2⃣ Prohibited Content**\n' +
        'No spamming, unauthorized ads, malicious files, or 18+ content.\n\n' +
        '**3⃣ Voice Channels**\n' +
        'Do not disturb others. No loud noises or music without permission.\n\n' +
        '**4⃣ Programming Services**\n' +
        'Open a ticket to request a service. Payment via bot only. No refunds after work starts.\n' +
        '<#1521896838977032242> — Use our services\n\n' +
        '**5⃣ Support**\n' +
        'Use dedicated channels or open a ticket for bot support.\n' +
        '<#1521633501105881158> — Technical support\n\n' +
        '**6⃣ Subscriptions**\n' +
        'Subscribe via free coupon or purchase. Subscription is tied to the server, not the user.\n\n' +
        '**7⃣ Reporting**\n' +
        'Contact staff or open a ticket to report a violation.\n\n' +
        '**8⃣ Final Decision**\n' +
        'Staff decisions are final. Please respect and cooperate.\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━\n' +
        'Annubis BroadCast | Dev By : vuq2';
      return interaction.reply({ content: rulesEn, flags: MessageFlags.Ephemeral });
    } else {
      const rulesAr = '📜 **قوانين سيرفر Annubis**\n' +
        'سيرفر مجتمعي + خدمات برمجة — نرحب بالجميع 🤝\n\n' +
        '**1⃣ احترام الجميع**\n' +
        'التعامل بأدب واحترام مع جميع الأعضاء. لا مكان للتنمر، الإساءة، أو التمييز.\n\n' +
        '**2⃣ الممنوعات**\n' +
        'ممنوع السبام، الإعلانات بدون إذن الإدارة، مشاركة ملفات ضارة، أو إرسال محتوى 18+.\n\n' +
        '**3⃣ القنوات الصوتية**\n' +
        'عدم إزعاج الآخرين، يمنع تشغيل أصوات مزعجة أو موسيقى بدون إذن.\n\n' +
        '**4⃣ خدمات البرمجة**\n' +
        'لطلب خدمة برمجية افتح تذكرة. الدفع عبر البوت فقط. يمنع طلب استرجاع بعد البدء.\n' +
        '<#1521896838977032242> — للاستفادة من خدماتنا\n\n' +
        '**5⃣ الدعم الفني**\n' +
        'للاستفسار عن البوت أو المشاكل استخدم الرومات المخصصة أو تذكرة.\n' +
        '<#1521633501105881158> — للدعم الفني\n\n' +
        '**6⃣ الاشتراكات**\n' +
        'الاشتراك في البوت عن طريق كوبون مجاني أو شراء. الاشتراك مرتبط بالسيرفر وليس العضو.\n\n' +
        '**7⃣ الإبلاغ**\n' +
        'للابحاغ عن مخالفة راسل الإدارة أو استخدم التذاكر.\n\n' +
        '**8⃣ القرار النهائي**\n' +
        'قرار الإدارة نهائي في جميع الحالات. يرجى الاحترام والتعاون.\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━\n' +
        'Annubis BroadCast | Dev By : vuq2';
      return interaction.reply({ content: rulesAr, flags: MessageFlags.Ephemeral });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === 'coupon_modal') {
    const code = interaction.fields.getTextInputValue('coupon_code').trim();
    const serverId = interaction.fields.getTextInputValue('server_id').trim();
    const result = useCoupon(code);

    if (!result) {
      return interaction.reply({ content: '❌ كود غير صالح أو مستخدم من قبل.', flags: MessageFlags.Ephemeral });
    }

    const days = result === 'weekly' ? 7 : 30;
    const label = result === 'weekly' ? 'اسبوعي' : 'شهري';

    // Check if bot is already in the specified guild
    const targetGuild = client.guilds.cache.get(serverId);
    if (targetGuild) {
      // Activate immediately
      const data = loadData();
      if (!data[serverId]) {
        data[serverId] = { server_owner: null, allowed_users: [], subscription: null, autoDeleteChannels: [] };
      }
      data[serverId].server_owner = interaction.user.id;
      data[serverId].subscription = {
        started_at: new Date().toISOString(),
        duration_days: days,
        source: 'free',
      };
      saveData(data);

      if (LOG_CHANNEL_ID) {
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🎁 كود مجاني - تم التفعيل فوراً')
            .setColor('#00FF00')
            .addFields(
              { name: '👤 المستخدم', value: `<@${interaction.user.id}>`, inline: true },
              { name: '🌐 السيرفر', value: `**${targetGuild.name}** (\`${serverId}\`)`, inline: true },
              { name: '📅 النوع', value: label, inline: true },
              { name: '⏳ المدة', value: `${days} يوم`, inline: true },
            )
            .setTimestamp();
          logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }

      if (CLIENT_ROLE_ID && interaction.member) interaction.member.roles.add(CLIENT_ROLE_ID).catch(() => {});
      return interaction.reply({ content: `✅ تم تفعيل اشتراكك ${label} في سيرفر **${targetGuild.name}**! استخدم \`!help\` للبدء.`, flags: MessageFlags.Ephemeral });
    }

    // Bot not in guild — save pending under guild ID
    const pending = loadPending();
    pending[`guild:${serverId}`] = { userId: interaction.user.id, type: result, days, label, source: 'free' };
    savePending(pending);

    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`;

    const embed = new EmbedBuilder()
      .setTitle('🎁 كود صحيح!')
      .setDescription(`✅ **تم قبول الكود!**\n\n**النوع:** ${label}\n**المدة:** ${days} يوم\n**ايدي السيرفر:** \`${serverId}\``)
      .addFields(
        { name: '📍 الخطوة التالية:', value: 'اضغط الزر أدناه لدعوة البوت للسيرفر، وبعد دخوله سيتم تفعيل الاشتراك تلقائياً.' },
      )
      .setColor('#00FF00')
      .setImage(BOT_IMAGE);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('🔗 دعوة البوت لسيرفرك')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteLink),
      );

    try {
      const user = await client.users.fetch(interaction.user.id);
      await user.send({ embeds: [embed], components: [row] });
    } catch {}

    if (LOG_CHANNEL_ID) {
      const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('🎁 كود مجاني - تم الاستخدام')
          .setColor('#00FF00')
          .addFields(
            { name: '👤 المستخدم', value: `<@${interaction.user.id}>`, inline: true },
            { name: '🆔 ايدي المستخدم', value: `\`${interaction.user.id}\``, inline: true },
            { name: '🌐 ايدي السيرفر', value: `\`${serverId}\``, inline: true },
            { name: '📅 النوع', value: label, inline: true },
            { name: '⏳ المدة', value: `${days} يوم`, inline: true },
            { name: '📌 الحالة', value: 'بانتظار دخول البوت للسيرفر', inline: false },
          )
          .setTimestamp();
        logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    if (CLIENT_ROLE_ID && interaction.member) interaction.member.roles.add(CLIENT_ROLE_ID).catch(() => {});
    return interaction.reply({ content: `✅ تم استخدام الكود بنجاح! تحقق من الخاص.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId.startsWith('rename_bot_')) {
    const guildId = interaction.customId.replace('rename_bot_', '');
    const enteredServerId = interaction.fields.getTextInputValue('server_id').trim();
    const botName = interaction.fields.getTextInputValue('bot_name').trim();

    if (enteredServerId !== guildId) {
      return interaction.reply({ content: '❌ آيدي السيرفر غير صحيح.', flags: MessageFlags.Ephemeral });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return interaction.reply({ content: '❌ البوت ليس في هذا السيرفر. أضف البوت للسيرفر أولاً.', flags: MessageFlags.Ephemeral });
    }

    if (!botName || botName.length < 2 || botName.length > 32) {
      return interaction.reply({ content: '❌ اسم البوت يجب أن يكون بين 2 و 32 حرف.', flags: MessageFlags.Ephemeral });
    }

    try {
      await guild.members.me.setNickname(botName);
      const logEmbed = new EmbedBuilder()
        .setTitle('✏️ تغيير اسم البوت')
        .setColor('#00FF00')
        .addFields(
          { name: '👤 المستخدم', value: `<@${interaction.user.id}>`, inline: true },
          { name: '🌐 السيرفر', value: `**${guild.name}** (\`${guildId}\`)`, inline: true },
          { name: '🤖 الاسم الجديد', value: botName, inline: true },
        )
        .setTimestamp();
      if (LOG_CHANNEL_ID) {
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
      await interaction.reply({ content: `✅ تم تغيير اسم البوت في هذا السيرفر إلى **${botName}**!`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.reply({ content: `❌ حدث خطأ: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.customId === 'embed_modal') {
    const title = interaction.fields.getTextInputValue('embed_title').trim();
    const description = interaction.fields.getTextInputValue('embed_desc').trim();
    const colorRaw = interaction.fields.getTextInputValue('embed_color').trim() || '#5865F2';
    try {
      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(colorRaw);
      await interaction.reply({ embeds: [embed] });
    } catch {
      await interaction.reply({ content: '❌ خطأ في اللون. استخدم مثلاً: `#FFD700`', flags: MessageFlags.Ephemeral });
    }
  }
});

// ===== Logging Events =====
function getLogChannel(guildId) {
  if (!LOG_CHANNEL_ID) return null;
  return client.channels.cache.get(LOG_CHANNEL_ID);
}

client.on('messageDelete', async (message) => {
  if (message.author?.bot || !message.guild) return;
  const channel = getLogChannel(message.guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ رسالة محذوفة')
    .setColor('#FF4444')
    .addFields(
      { name: 'الكاتب', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
      { name: 'الروم', value: `<#${message.channel.id}>`, inline: true },
      { name: 'المحتوى', value: message.content ? message.content.slice(0, 1000) : '*بدون محتوى*' },
    )
    .setFooter({ text: `ID: ${message.author.id}` })
    .setTimestamp();
  if (message.attachments.size > 0) {
    embed.addFields({ name: 'المرفقات', value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n') });
  }
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageDeleteBulk', async (messages) => {
  const first = messages.first();
  if (!first?.guild) return;
  const channel = getLogChannel(first.guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🧹 حذف جماعي للرسائل')
    .setColor('#FF8844')
    .addFields(
      { name: 'الروم', value: `<#${first.channel.id}>`, inline: true },
      { name: 'عدد الرسائل', value: `${messages.size}`, inline: true },
    )
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (newMessage.author?.bot || !newMessage.guild) return;
  if (oldMessage.content === newMessage.content) return;
  const channel = getLogChannel(newMessage.guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ رسالة معدلة')
    .setColor('#FFAA00')
    .addFields(
      { name: 'الكاتب', value: `${newMessage.author.tag} (<@${newMessage.author.id}>)`, inline: true },
      { name: 'الروم', value: `<#${newMessage.channel.id}>`, inline: true },
      { name: 'قبل', value: (oldMessage.content || '*بدون*').slice(0, 1000) },
      { name: 'بعد', value: (newMessage.content || '*بدون*').slice(0, 1000) },
    )
    .setFooter({ text: `ID: ${newMessage.author.id}` })
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const channel = getLogChannel(newMember.guild.id);
  if (!channel) return;
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
  if (addedRoles.size === 0 && removedRoles.size === 0) return;
  const embed = new EmbedBuilder()
    .setTitle('🔖 رتب معدلة')
    .setColor('#00AAFF')
    .addFields(
      { name: 'العضو', value: `${newMember.user.tag} (<@${newMember.id}>)`, inline: true },
    )
    .setFooter({ text: `ID: ${newMember.id}` })
    .setTimestamp();
  if (addedRoles.size > 0) {
    embed.addFields({ name: '✅ الرتب المضافة', value: addedRoles.map(r => `<@&${r.id}>`).join(' ') });
  }
  if (removedRoles.size > 0) {
    embed.addFields({ name: '❌ الرتب المحذوفة', value: removedRoles.map(r => `<@&${r.id}>`).join(' ') });
  }
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanAdd', async (ban) => {
  const channel = getLogChannel(ban.guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🔨 بان جديد')
    .setColor('#FF0000')
    .addFields(
      { name: 'المستخدم', value: `${ban.user.tag} (<@${ban.user.id}>)`, inline: true },
      { name: 'السبب', value: ban.reason || '*بدون سبب*', inline: true },
    )
    .setFooter({ text: `ID: ${ban.user.id}` })
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanRemove', async (ban) => {
  const channel = getLogChannel(ban.guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🔓 رفع بان')
    .setColor('#00FF00')
    .addFields(
      { name: 'المستخدم', value: `${ban.user.tag} (<@${ban.user.id}>)`, inline: true },
    )
    .setFooter({ text: `ID: ${ban.user.id}` })
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberAdd', async (member) => {
  const channel = getLogChannel(member.guild.id);
  if (!channel) return;
  const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
  const embed = new EmbedBuilder()
    .setTitle('📥 عضو انضم')
    .setColor('#00FF88')
    .addFields(
      { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: 'إنشاء الحساب', value: `منذ ${accountAge} يوم`, inline: true },
    )
    .setFooter({ text: `ID: ${member.id}` })
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberRemove', async (member) => {
  const channel = getLogChannel(member.guild.id);
  if (!channel) return;
  const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(' ') || '*بدون رتب*';
  const embed = new EmbedBuilder()
    .setTitle('📤 عضو غادر')
    .setColor('#FF8800')
    .addFields(
      { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: 'الرتب', value: roles, inline: false },
    )
    .setFooter({ text: `ID: ${member.id}` })
    .setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const log = getLogChannel(channel.guild.id);
  if (!log) return;
  const typeMap = { 0: '📝 نصي', 2: '🔊 صوتي', 4: '📂 تصنيف', 5: '📢 إعلانات', 13: '🧵 ثريد', 15: '📢 فورم' };
  const embed = new EmbedBuilder()
    .setTitle('📁 روم جديد')
    .setColor('#00FF88')
    .addFields(
      { name: 'الروم', value: `<#${channel.id}> (${typeMap[channel.type] || 'روم'})`, inline: true },
      { name: 'الاسم', value: channel.name, inline: true },
    )
    .setFooter({ text: `ID: ${channel.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const log = getLogChannel(channel.guild.id);
  if (!log) return;
  const typeMap = { 0: '📝 نصي', 2: '🔊 صوتي', 4: '📂 تصنيف', 5: '📢 إعلانات', 13: '🧵 ثريد', 15: '📢 فورم' };
  const embed = new EmbedBuilder()
    .setTitle('🗑️ روم محذوف')
    .setColor('#FF4444')
    .addFields(
      { name: 'الروم', value: `${typeMap[channel.type] || 'روم'} — **${channel.name}**`, inline: true },
    )
    .setFooter({ text: `ID: ${channel.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const log = getLogChannel(newChannel.guild.id);
  if (!log) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`**الاسم:** ${oldChannel.name} → ${newChannel.name}`);
  if (oldChannel.topic !== newChannel.topic) changes.push(`**الموضوع:** ${oldChannel.topic || '*بدون*'} → ${newChannel.topic || '*بدون*'}`);
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push(`**NSFW:** ${oldChannel.nsfw ? '✅' : '❌'} → ${newChannel.nsfw ? '✅' : '❌'}`);
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) changes.push(`**Slowmode:** ${oldChannel.rateLimitPerUser}ث → ${newChannel.rateLimitPerUser}ث`);
  if (oldChannel.parentId !== newChannel.parentId) changes.push(`**التصنيف:** ${oldChannel.parentId ? `<#${oldChannel.parentId}>` : '*بدون*'} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : '*بدون*'}`);
  const oldPerms = oldChannel.permissionOverwrites.cache;
  const newPerms = newChannel.permissionOverwrites.cache;
  if (oldPerms.size !== newPerms.size) changes.push(`**الصلاحيات:** ${oldPerms.size} → ${newPerms.size} تعديل`);
  if (changes.length === 0) return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ روم معدل')
    .setColor('#FFAA00')
    .addFields(
      { name: 'الروم', value: `<#${newChannel.id}>`, inline: true },
      { name: 'التغييرات', value: changes.join('\n').slice(0, 1000) },
    )
    .setFooter({ text: `ID: ${newChannel.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('roleCreate', async (role) => {
  if (!role.guild) return;
  const log = getLogChannel(role.guild.id);
  if (!log) return;
  const embed = new EmbedBuilder()
    .setTitle('🆕 رتبة جديدة')
    .setColor('#00AAFF')
    .addFields(
      { name: 'الرتبة', value: `<@&${role.id}>`, inline: true },
      { name: 'الاسم', value: role.name, inline: true },
      { name: 'اللون', value: role.hexColor, inline: true },
    )
    .setFooter({ text: `ID: ${role.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('roleDelete', async (role) => {
  if (!role.guild) return;
  const log = getLogChannel(role.guild.id);
  if (!log) return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ رتبة محذوفة')
    .setColor('#FF4444')
    .addFields(
      { name: 'الرتبة', value: `**${role.name}**`, inline: true },
      { name: 'اللون', value: role.hexColor, inline: true },
    )
    .setFooter({ text: `ID: ${role.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('roleUpdate', async (oldRole, newRole) => {
  if (!newRole.guild) return;
  const log = getLogChannel(newRole.guild.id);
  if (!log) return;
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`**الاسم:** ${oldRole.name} → ${newRole.name}`);
  if (oldRole.hexColor !== newRole.hexColor) changes.push(`**اللون:** ${oldRole.hexColor} → ${newRole.hexColor}`);
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('**الصلاحيات:** تم التعديل');
  if (oldRole.hoist !== newRole.hoist) changes.push(`**عرض منفصل:** ${oldRole.hoist ? '✅' : '❌'} → ${newRole.hoist ? '✅' : '❌'}`);
  if (oldRole.mentionable !== newRole.mentionable) changes.push(`**قابلية المنشن:** ${oldRole.mentionable ? '✅' : '❌'} → ${newRole.mentionable ? '✅' : '❌'}`);
  if (changes.length === 0) return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ رتبة معدلة')
    .setColor('#FFAA00')
    .addFields(
      { name: 'الرتبة', value: `<@&${newRole.id}>`, inline: true },
      { name: 'التغييرات', value: changes.join('\n').slice(0, 1000) },
    )
    .setFooter({ text: `ID: ${newRole.id}` })
    .setTimestamp();
  log.send({ embeds: [embed] }).catch(() => {});
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.guild) return;
  const log = getLogChannel(newState.guild.id);
  if (!log) return;
  const member = newState.member;
  if (!member) return;

  if (oldState.serverMute !== newState.serverMute) {
    const embed = new EmbedBuilder()
      .setTitle(newState.serverMute ? '🔇 ميوت فويس' : '🔊 رفع ميوت فويس')
      .setColor(newState.serverMute ? '#FF4444' : '#00FF88')
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'الروم', value: newState.channel ? `<#${newState.channel.id}>` : '*لا يوجد*', inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    return log.send({ embeds: [embed] }).catch(() => {});
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    const embed = new EmbedBuilder()
      .setTitle(newState.serverDeaf ? '🔇 ديفن فويس' : '🔊 رفع ديفن فويس')
      .setColor(newState.serverDeaf ? '#FF4444' : '#00FF88')
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'الروم', value: newState.channel ? `<#${newState.channel.id}>` : '*لا يوجد*', inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    return log.send({ embeds: [embed] }).catch(() => {});
  }

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  if (oldChannel && !newChannel) {
    const embed = new EmbedBuilder()
      .setTitle('👋 طرد من فويس')
      .setColor('#FF4444')
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'الروم', value: `<#${oldChannel.id}>`, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    return log.send({ embeds: [embed] }).catch(() => {});
  }

  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    const embed = new EmbedBuilder()
      .setTitle('🔀 نقل فويس')
      .setColor('#FFAA00')
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'من', value: `<#${oldChannel.id}>`, inline: true },
        { name: 'إلى', value: `<#${newChannel.id}>`, inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    return log.send({ embeds: [embed] }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
