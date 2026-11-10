const path = require('path');
const dotenv = require('dotenv');
const express = require('express');

dotenv.config({
    path: path.join(__dirname, '.env'),
    override: true
});

const {
    Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder, MessageFlags, EmbedBuilder, Options,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder, ThumbnailBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const { DiscordVCStatus } = require('discord-vc-status');

const stats = require('./stats');
const config = require('./config');

// =========================
// 🌐 HTTP-СЕРВЕР
// =========================
const app = express();
const PORT = process.env.PORT || 8000;
app.get('/', (req, res) => res.send('Кувшинка онлайн'));
app.listen(PORT, () => console.log(`HTTP-сервер запущен на порту ${PORT}`));

// =========================
// 🐸 КЛИЕНТ
// =========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildEmojisAndStickers
    ],

    makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 0,
        PresenceManager: 0,
        GuildMemberManager: 100,
        UserManager: 100,
        GuildStickerManager: 0,
        GuildEmojiManager: 0,
        GuildScheduledEventManager: 0,
        ReactionManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0
    }),

    sweepers: {
        messages: { interval: 300, lifetime: 60 },
        users:    { interval: 300, filter: () => (u) => u.bot && u.id !== client.user.id },
        guildMembers: { interval: 300, filter: () => (m) => !m.voice.channelId }
    }
});

client.vcStatus = new DiscordVCStatus(client);

// =========================
// 🐸 НАСТРОЙКИ
// =========================
const RULES_CHANNEL_ID = '1510063400535851198';
const WELCOME_CHANNEL_ID = '1510063211099983902';
const CREATE_ROOM_CHANNEL_ID = '1518746457988010045';
const ROOM_SUFFIX = "'s Лужа";
const ROOM_IMAGE_URL = 'https://i.postimg.cc/MZDmCxKf/image.png';
const FROG_IMAGE_URL = 'https://i.postimg.cc/4xn2DTfH/image.png';

// =========================
// 🎨 ID КАСТОМНЫХ ЭМОДЗИ
// =========================
const EMOJI_SETTINGS = '1561708488990785556';
const EMOJI_PENCIL   = '1561708531122446356';
const EMOJI_SPEECH   = '1561708575154376734';
const EMOJI_FROGS    = '1561711882027663370';
const EMOJI_LOCK     = '1561708661473280020';
const EMOJI_UNLOCK   = '1561708698257203280';
const EMOJI_GLOBE    = '1561708784852668496';
const EMOJI_TRANSFER = '1561711719858966718';
const EMOJI_TRASH    = '1561711760548040764';

function emojiFor(id) {
    let e = client.emojis.cache.get(id);
    if (!e) {
        for (const guild of client.guilds.cache.values()) {
            e = guild.emojis.cache.get(id);
            if (e) break;
        }
    }
    return e ? `<:${e.name}:${e.id}>` : '';
}

function eSettings() { return emojiFor(EMOJI_SETTINGS); }
function ePencil()   { return emojiFor(EMOJI_PENCIL); }
function eSpeech()   { return emojiFor(EMOJI_SPEECH); }
function eFrogs()    { return emojiFor(EMOJI_FROGS); }
function eLock()     { return emojiFor(EMOJI_LOCK); }
function eUnlock()   { return emojiFor(EMOJI_UNLOCK); }
function eGlobe()    { return emojiFor(EMOJI_GLOBE); }
function eTransfer() { return emojiFor(EMOJI_TRANSFER); }
function eTrash()    { return emojiFor(EMOJI_TRASH); }

const roomOwners = new Map();

function setRoomOwner(channelId, ownerId) {
    roomOwners.set(channelId, ownerId);
    stats.setRoomOwner(channelId, ownerId);
}

function removeRoomOwner(channelId) {
    roomOwners.delete(channelId);
    stats.removeRoom(channelId);
}

function isRoom(channelId) {
    return roomOwners.has(channelId);
}

for (const [channelId, ownerId] of Object.entries(stats.getRooms())) {
    roomOwners.set(channelId, ownerId);
}

const REGIONS = [
    { label: 'Автоматический выбор', value: 'auto' },
    { label: 'Brazil',               value: 'brazil' },
    { label: 'Hong Kong',            value: 'hongkong' },
    { label: 'India',                value: 'india' },
    { label: 'Japan',                value: 'japan' },
    { label: 'Rotterdam',            value: 'rotterdam' },
    { label: 'Singapore',            value: 'singapore' },
    { label: 'South Africa',         value: 'southafrica' },
    { label: 'Sydney',               value: 'sydney' },
    { label: 'US Central',           value: 'us-central' },
    { label: 'US East',              value: 'us-east' },
    { label: 'US South',             value: 'us-south' },
    { label: 'US West',              value: 'us-west' }
];

// =========================
// 🐸 ЗАПУСК
// =========================
client.once('clientReady', async () => {
    console.log(`Кувшинка запущена как ${client.user.tag}`);
    logMemory('при запуске');

    for (const guild of client.guilds.cache.values()) {
        await guild.emojis.fetch().catch(() => {});
    }

    await cleanupStaleRooms();
    await createRoomsForWaitingMembers();

    setInterval(() => logMemory('периодическая проверка'), 10 * 60 * 1000);

    const FULL_SYNC_MS = (config.FULL_SYNC_INTERVAL_MINUTES || 360) * 60 * 1000;
    setInterval(() => fullSync(client), FULL_SYNC_MS);
    setTimeout(() => fullSync(client), 15_000);

    const commands = [
        { name: 'top', description: 'Рейтинг активности в Пруду' },
        { name: 'evolve', description: 'Проверить свой прогресс эволюции' },
        { name: 'panel', description: 'Вызвать панель управления лужей' }
    ];

    for (const guild of client.guilds.cache.values()) {
        guild.commands.set(commands)
            .then(() => console.log(`🏠 Слеш-команды зарегистрированы для гильдии ${guild.name}`))
            .catch(err => console.error(`Ошибка регистрации команд для ${guild.name}:`, err));
    }

    client.application.commands.set([])
        .then(() => console.log('🧹 Старые глобальные команды очищены'))
        .catch(() => {});
});

function logMemory(label = '') {
    const used = process.memoryUsage();
    const mb = (b) => (b / 1024 / 1024).toFixed(2);
    console.log(`📊 [${label}] RSS: ${mb(used.rss)} MB | Heap: ${mb(used.heapUsed)}/${mb(used.heapTotal)} MB`);
}

async function cleanupStaleRooms() {
    let removed = 0;
    for (const guild of client.guilds.cache.values()) {
        const channels = await guild.channels.fetch().catch(() => null);
        if (!channels) continue;

        const validIds = new Set();
        for (const ch of channels.values()) {
            if (ch && ch.type === ChannelType.GuildVoice && roomOwners.has(ch.id)) {
                validIds.add(ch.id);
            }
        }

        for (const channelId of [...roomOwners.keys()]) {
            if (!channels.has(channelId) || !validIds.has(channelId)) {
                removeRoomOwner(channelId);
                removed++;
            }
        }
    }
    if (removed > 0) {
        console.log(`🧹 Удалено устаревших записей о лужах: ${removed}`);
    }
}

// =========================
// 🌊 СОЗДАНИЕ ЛУЖИ
// =========================
async function createRoomForMember(member, sourceChannel) {
    const guild = member.guild;

    const existingOwned = [...roomOwners.entries()]
        .find(([, owner]) => owner === member.id);

    if (existingOwned) {
        const existingChannel = guild.channels.cache.get(existingOwned[0])
            || await guild.channels.fetch(existingOwned[0]).catch(() => null);

        if (existingChannel && existingChannel.type === ChannelType.GuildVoice) {
            if (existingChannel.members.size === 0) {
                await member.voice.setChannel(existingChannel).catch(() => {});
                return { moved: true, channel: existingChannel };
            }
        } else {
            removeRoomOwner(existingOwned[0]);
        }
    }

    const room = await guild.channels.create({
        name: `${member.displayName}${ROOM_SUFFIX}`,
        type: ChannelType.GuildVoice,
        parent: sourceChannel.parentId
    });

    await room.lockPermissions().catch(() => {});

    await room.permissionOverwrites.edit(member.id, {
        ManageChannels: true,
        MoveMembers: true
    }).catch(() => {});

    setRoomOwner(room.id, member.id);

    try {
        const container = buildControlPanelV2(member, room.id);
        await room.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (e) {
        console.error('❌ Ошибка отправки панели:', e);
    }

    await member.voice.setChannel(room).catch(() => {});
    return { moved: false, channel: room };
}

// =========================
// 🌊 ЛУЖИ ДЛЯ ОЖИДАЮЩИХ
// =========================
async function createRoomsForWaitingMembers() {
    let created = 0;
    for (const guild of client.guilds.cache.values()) {
        const channel = await guild.channels
            .fetch(CREATE_ROOM_CHANNEL_ID)
            .catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildVoice) continue;

        const humans = channel.members.filter(m => !m.user.bot);
        if (humans.size === 0) continue;

        for (const member of humans.values()) {
            try {
                const result = await createRoomForMember(member, channel);
                if (!result.moved) {
                    created++;
                    console.log(`🌊 Создана лужа для ожидающего участника: ${member.user.tag}`);
                }
            } catch (e) {
                console.error(`Ошибка создания лужи для ${member.user.tag}:`, e);
            }
        }
    }
    if (created > 0) {
        console.log(`✅ При запуске создано луж для ожидающих: ${created}`);
    }
}

// =========================
// 👋 ПРИВЕТСТВИЕ
// =========================
client.on('guildMemberAdd', async (member) => {
    try {
        const welcomeChannel = await member.guild.channels
            .fetch(WELCOME_CHANNEL_ID).catch(() => null);
        if (!welcomeChannel) return console.error('Welcome-канал не найден!');

        await welcomeChannel.send(
            `🐸 Добро пожаловать в Пруд, ${member}!\n\n` +
            `🌿 Рады видеть тебя среди наших обитателей.\n` +
            `Пожалуйста, ознакомься с Болотным кодексом в <#${RULES_CHANNEL_ID}>.\n\n` +
            `Приятного плавания! 🌺`
        );
    } catch (e) {
        console.error('Ошибка приветствия:', e);
    }
});

// =========================
// 🔧 ПАНЕЛЬ (Components V2)
// =========================
function buildControlPanelV2(member, roomId) {
    const container = new ContainerBuilder()
        .setAccentColor(0x2E8B57);

    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
                .setURL(ROOM_IMAGE_URL)
                .setDescription('Личная лужа')
        )
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🌺 Твоя личная лужа\n\n` +
            `Это твоя личная лужа, ${member}!\n` +
            `Используй кнопки для управления.`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    const actions = [
        { id: 'info',     label: 'Просмотреть настройки лужи', emojiId: EMOJI_SETTINGS, style: ButtonStyle.Secondary },
        { id: 'name',     label: 'Переименовать лужу',         emojiId: EMOJI_PENCIL,   style: ButtonStyle.Secondary },
        { id: 'status',   label: 'Изменить статус лужи',        emojiId: EMOJI_SPEECH,   style: ButtonStyle.Secondary },
        { id: 'limit',    label: 'Изменить лимит лягушек',      emojiId: EMOJI_FROGS,    style: ButtonStyle.Secondary },
        { id: 'lock',     label: 'Закрыть лужу для чужих',      emojiId: EMOJI_LOCK,     style: ButtonStyle.Secondary },
        { id: 'unlock',   label: 'Открыть лужу для всех',       emojiId: EMOJI_UNLOCK,   style: ButtonStyle.Secondary },
        { id: 'region',   label: 'Сменить место обитания',      emojiId: EMOJI_GLOBE,    style: ButtonStyle.Secondary },
        { id: 'transfer', label: 'Передать лужу другому',       emojiId: EMOJI_TRANSFER, style: ButtonStyle.Secondary },
        { id: 'delete',   label: 'Высушить лужу',               emojiId: EMOJI_TRASH,    style: ButtonStyle.Secondary }
    ];

    for (const action of actions) {
        const btn = new ButtonBuilder()
            .setCustomId(`${action.id}_${roomId}`)
            .setStyle(action.style)
            .setEmoji({ id: action.emojiId });

        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(action.label)
                )
                .setButtonAccessory(btn)
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder());

    const frogThumbnail = new ThumbnailBuilder()
        .setURL(FROG_IMAGE_URL)
        .setDescription('Лягушонок');

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `*Используй команду \`/panel\` для повторного вызова этого меню*`
                )
            )
            .setThumbnailAccessory(frogThumbnail)
    );

    return container;
}

// =========================
// 🔄 ПЕРЕДАЧА ВЛАДЕНИЯ
// =========================
async function transferOwnership(channel, oldId, newId, auto = false) {
    try {
        if (oldId) {
            await channel.permissionOverwrites.edit(oldId, {
                ManageChannels: false, MoveMembers: false, ViewChannel: true, Connect: true
            }).catch(() => {});
        }
        await channel.permissionOverwrites.edit(newId, { ManageChannels: true, MoveMembers: true });
        setRoomOwner(channel.id, newId);

        await refreshPanel(channel, newId);

        await channel.send(auto
            ? `${eTransfer()} Владелец покинул лужу. Владение автоматически передано <@${newId}>.`
            : `${eTransfer()} Владение передано участнику <@${newId}>.`
        ).catch(() => {});
    } catch (e) {
        console.error('transferOwnership:', e);
    }
}

async function refreshPanel(channel, newOwnerId) {
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const panelMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
        if (panelMsg) {
            const newMember = await channel.guild.members.fetch(newOwnerId).catch(() => null);
            if (newMember) {
                const newContainer = buildControlPanelV2(newMember, channel.id);
                await panelMsg.edit({
                    components: [newContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }
    } catch (e) {}
}

// =========================
// 🔊 ЛУЖИ + УЧЁТ ГОЛОСА
// =========================
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const m = newState.member || oldState.member;
        if (m && !m.user.bot) {
            if (!oldState.channelId && newState.channelId) {
                stats.startVoice(m.id);
            } else if (oldState.channelId && !newState.channelId) {
                const recorded = stats.endVoice(m.id);
                if (recorded) {
                    checkMemberEvolution(m).catch(e => console.error('evo:', e));
                }
            }
        }

        if (newState.channelId === CREATE_ROOM_CHANNEL_ID && oldState.channelId !== CREATE_ROOM_CHANNEL_ID) {
            const member = newState.member;
            if (!member) return;

            try {
                await createRoomForMember(member, newState.channel);
            } catch (e) {
                console.error('Ошибка создания лужи:', e);
            }
        }

        if (oldState.channelId === newState.channelId) return;

        const oldChannel = oldState.channel;
        if (oldChannel &&
            oldChannel.id !== CREATE_ROOM_CHANNEL_ID &&
            oldChannel.type === ChannelType.GuildVoice &&
            isRoom(oldChannel.id)) {

            const prevOwnerId = roomOwners.get(oldChannel.id);
            const ownerLeft = prevOwnerId && oldState.member?.id === prevOwnerId;

            setTimeout(async () => {
                try {
                    const fresh = await oldChannel.fetch();
                    if (fresh.members.size === 0) {
                        removeRoomOwner(fresh.id);
                        await fresh.delete();
                        return;
                    }
                    if (ownerLeft) {
                        const next = fresh.members.find(x => !x.user.bot);
                        if (next) await transferOwnership(fresh, prevOwnerId, next.id, true);
                    }
                } catch {}
            }, 1500);
        }
    } catch (e) {
        console.error('voiceStateUpdate:', e);
    }
});

// =========================
// 🔘 КНОПКИ (V2)
// =========================
client.on('interactionCreate', async (interaction) => {
    try {
        if (!interaction.isButton()) return;
        const customId = interaction.customId;

        if (customId.startsWith('top_')) {
            return handleTopButton(interaction);
        }

        const channel = interaction.channel;
        if (!channel || !isRoom(channel.id)) {
            return interaction.reply({
                content: '🌊 Это не лужа — здесь нет кнопок Кувшинки.',
                flags: MessageFlags.Ephemeral
            });
        }

        const channelId = channel.id;
        const ownerId = roomOwners.get(channelId);

        if (interaction.member.id !== ownerId) {
            return interaction.reply({
                content: '🌿 Этой лужей управляет другой обитатель Пруда.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('info_')) {
            const limitValue = channel.userLimit;
            const limitText = limitValue === 0 ? 'без лимита' : `${limitValue}`;
            const membersArr = channel.members.filter(m => !m.user.bot);

            const membersText = membersArr.size > 0
                ? membersArr.map(m => `<@${m.id}>`).join(', ')
                : '*никого — лужа пустует*';

            const regionText = channel.rtcRegion
                ? REGIONS.find(r => r.value === channel.rtcRegion)?.label || channel.rtcRegion
                : 'Автоматически';

            const everyone = interaction.guild.roles.everyone;
            const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
            const isOpen = overwrite
                ? overwrite.allow.has('ViewChannel') || overwrite.allow.has('Connect')
                : true;

            const created = Math.floor(channel.createdTimestamp / 1000);
            const createdDate = `<t:${created}:D>`;
            const bitrateKbps = Math.round(channel.bitrate / 1000);

            const embed = new EmbedBuilder()
                .setColor(isOpen ? 0x2E8B57 : 0xED4245)
                .setAuthor({
                    name: 'Настройки лужи',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle(`🌺 ${channel.name}`)
                .setThumbnail(ROOM_IMAGE_URL)
                .addFields(
                    {
                        name: `${eSettings()} Основное`,
                        value:
                            `${eTransfer()} **Владелец:** <@${ownerId}>\n` +
                            `${eFrogs()} **Заполнение:** ${membersArr.size} / ${limitText}\n` +
                            `${eGlobe()} **Регион:** ${regionText}\n` +
                            `🎚️ **Битрейт:** ${bitrateKbps} kbps`,
                        inline: false
                    },
                    {
                        name: `🌊 Обитатели (${membersArr.size})`,
                        value: membersText,
                        inline: false
                    },
                    {
                        name: `🚪 Доступ`,
                        value: isOpen
                            ? `${eUnlock()} Открыта для всех`
                            : `${eLock()} Закрыта от посторонних`,
                        inline: false
                    }
                )
                .setFooter({
                    text: `ID: ${channel.id} · Создана ${createdDate}`
                })
                .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('name_')) {
            const modal = new ModalBuilder()
                .setCustomId(`name_modal_${channelId}`)
                .setTitle('Переименование лужи');

            const input = new TextInputBuilder()
                .setCustomId('name_input')
                .setLabel('Новое название (до 100 символов)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Введите новое название...')
                .setMinLength(1)
                .setMaxLength(100)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId.startsWith('status_')) {
            const modal = new ModalBuilder()
                .setCustomId(`status_modal_${channelId}`)
                .setTitle('Изменение статуса лужи');

            const input = new TextInputBuilder()
                .setCustomId('status_input')
                .setLabel('Новый статус (до 500 символов)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Введите статус для вашей лужи...')
                .setMinLength(1)
                .setMaxLength(500)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId.startsWith('limit_')) {
            const modal = new ModalBuilder()
                .setCustomId(`limit_modal_${channelId}`)
                .setTitle('Изменение лимита лягушек');

            const input = new TextInputBuilder()
                .setCustomId('limit_input')
                .setLabel('Лимит (0 — без лимита, макс. 99)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Введите число от 0 до 99...')
                .setMinLength(1)
                .setMaxLength(2)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId.startsWith('region_')) {
            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`region_select_${channelId}`)
                    .setPlaceholder('Выбери новое место обитания')
                    .addOptions(REGIONS.map(r => ({ label: r.label, value: r.value })).slice(0, 25))
            );
            return interaction.reply({
                content: `${eGlobe()} Выбери новое место обитания:`,
                components: [select],
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('lock_')) {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
            refreshPanel(channel, ownerId);
            return interaction.reply({
                content: `${eLock()} Лужа закрыта для чужих.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('unlock_')) {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: true, Connect: true });
            refreshPanel(channel, ownerId);
            return interaction.reply({
                content: `${eUnlock()} Лужа открыта для всех!`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('transfer_')) {
            const inVoice = channel.members.filter(m => m.id !== interaction.member.id && !m.user.bot);
            if (inVoice.size === 0) {
                return interaction.reply({
                    content: '🌾 В луже пока никого нет — некого назначать.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`transfer_select_${channelId}`)
                    .setPlaceholder('Выбери нового владельца')
                    .addOptions(inVoice.map(m => ({ label: m.displayName, value: m.id })).slice(0, 25))
            );
            return interaction.reply({
                content: `${eTransfer()} Выбери, кому передать лужу:`,
                components: [select],
                flags: MessageFlags.Ephemeral
            });
        }

        if (customId.startsWith('delete_')) {
            await interaction.reply({
                content: `${eTrash()} Лужа высыхает...`,
                flags: MessageFlags.Ephemeral
            });
            removeRoomOwner(channelId);
            await channel.delete().catch(() => {});
        }
    } catch (e) {
        if (e.code === 10062) {
            console.log('⚠️ Interaction устарел (10062) — пропускаем.');
        } else {
            console.error('Ошибка обработки кнопки:', e);
        }
    }
});

// =========================
// 📊 ЛОГИКА ТОПА
// =========================
async function buildTopEmbed(guild, metric, page, requestedBy) {
    const PER_PAGE = 10;
    const { total, items } = stats.getTop(metric, PER_PAGE, page * PER_PAGE);

    const titles = {
        voice: 'Рейтинг по голосу',
        days:  'Рейтинг по активным дням'
    };

    let description = '';
    for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        const globalIdx = page * PER_PAGE + i;

        const mem = await guild.members.fetch(entry.userId).catch(() => null);
        const name = mem ? mem.displayName : `Участник`;

        let roleName = entry.role;
        if (mem) {
            const excluded = mem.roles.cache.find(r => config.EXCLUDED_ROLES.includes(r.id));
            if (excluded) roleName = excluded.name;
            else roleName = getDisplayRole(mem);
        }

        let value = '';
        if (metric === 'voice') value = stats.formatTime(entry.voiceSeconds);
        if (metric === 'days')  value = `${entry.activeDays} дн.`;

        description += `**#${globalIdx + 1}.** ${name} — ${roleName} — \`${value}\`\n`;
    }

    if (!description) description = 'Пока никого нет...';

    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

    const embed = new EmbedBuilder()
        .setTitle(titles[metric] || 'Рейтинг')
        .setDescription(description)
        .setColor(0x5865F2)
        .setFooter({
            text: `Страница ${page + 1} из ${totalPages} | Всего: ${total} | Запросил ${requestedBy}`
        });

    return { embed, totalPages };
}

function buildTopButtons(metric, page, totalPages) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('top_voice')
                .setLabel('Голос')
                .setStyle(metric === 'voice' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('top_days')
                .setLabel('Дни')
                .setStyle(metric === 'days' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`top_page_${metric}_0`)
                .setLabel('В начало')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`top_page_${metric}_${page - 1}`)
                .setLabel('Назад')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`top_page_${metric}_${page + 1}`)
                .setLabel('Вперёд')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId(`top_page_${metric}_${totalPages - 1}`)
                .setLabel('В конец')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId('top_close')
                .setLabel('Закрыть')
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

// =========================
// 📋 МОДАЛКИ + СЛЕШ-КОМАНДЫ + СЕЛЕКТЫ
// =========================
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            const channel = interaction.channel;
            if (!channel || !isRoom(channel.id)) return;

            const channelId = channel.id;
            const ownerId = roomOwners.get(channelId);

            if (interaction.member.id !== ownerId) {
                return interaction.reply({
                    content: '🌿 Этой лужей управляет другой обитатель Пруда.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (customId.startsWith('name_modal_')) {
                const raw = interaction.fields.getTextInputValue('name_input').trim();
                if (raw.length < 1) {
                    return interaction.reply({
                        content: '❌ Название не может быть пустым.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                try {
                    await channel.setName(raw);
                } catch (e) {
                    console.error('setName:', e);
                    return interaction.reply({
                        content: '❌ Не удалось переименовать лужу. Проверь права бота.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: `${ePencil()} Лужа переименована в **${raw}**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (customId.startsWith('status_modal_')) {
                const raw = interaction.fields.getTextInputValue('status_input').trim();
                if (raw.length < 1) {
                    return interaction.reply({
                        content: '❌ Статус не может быть пустым.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                try {
                    await client.vcStatus.setVoiceStatus(channelId, raw);
                } catch (e) {
                    console.error('setVoiceStatus:', e);
                    return interaction.reply({
                        content: '❌ Не удалось установить статус. Возможно, Discord временно не поддерживает эту функцию.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: `${eSpeech()} Статус лужи обновлён: **${raw}**`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (customId.startsWith('limit_modal_')) {
                const raw = interaction.fields.getTextInputValue('limit_input').trim();
                const limit = parseInt(raw, 10);

                if (isNaN(limit) || limit < 0 || limit > 99) {
                    return interaction.reply({
                        content: '❌ Введи число от **0** до **99**. (0 — без лимита)',
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    await channel.setUserLimit(limit);
                } catch (e) {
                    console.error('setUserLimit:', e);
                    return interaction.reply({
                        content: '❌ Не удалось установить лимит. Проверь права бота.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                refreshPanel(channel, ownerId);

                return interaction.reply({
                    content: limit === 0
                        ? `${eFrogs()} Лимит снят — в лужу может заплыть сколько угодно лягушек.`
                        : `${eFrogs()} Лимит установлен: **${limit}** лягушек.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'top') {
                return interaction.reply({
                    content: '🌊 Команда `/top` временно на реконструкции. Кувшинка скоро всё починит!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.commandName === 'evolve') {
                return interaction.reply({
                    content: '🐸 Команда `/evolve` временно на реконструкции. Кувшинка скоро всё починит!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.commandName === 'panel') {
                const member = interaction.member;
                const voiceChannel = member.voice.channel;

                if (!voiceChannel) {
                    return interaction.reply({
                        content: '🌊 Ты не в голосовом канале. Зайди в свою лужу и попробуй снова.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (!isRoom(voiceChannel.id)) {
                    return interaction.reply({
                        content: '🌊 Это не лужа — здесь нет панели Кувшинки.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const ownerId = roomOwners.get(voiceChannel.id);
                if (member.id !== ownerId) {
                    return interaction.reply({
                        content: '🌿 Этой лужей управляет другой обитатель Пруда.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                try {
                    const container = buildControlPanelV2(member, voiceChannel.id);
                    await voiceChannel.send({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });
                } catch (e) {
                    console.error('❌ Ошибка отправки панели:', e);
                    return interaction.reply({
                        content: '❌ Не удалось отправить панель. Проверь права бота.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                return interaction.reply({
                    content: '🌺 Панель управления отправлена в твою лужу!',
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        if (!interaction.isStringSelectMenu()) return;

        const customId = interaction.customId;
        const channel = interaction.channel;
        if (!channel || !isRoom(channel.id)) return;

        const channelId = channel.id;
        const ownerId = roomOwners.get(channelId);

        if (customId.startsWith('transfer_select_')) {
            if (interaction.member.id !== ownerId) {
                return interaction.update({
                    content: '🌿 Этой лужей управляет другой обитатель Пруда.',
                    components: []
                });
            }
            const newOwnerId = interaction.values[0];
            const newOwner = await interaction.guild.members.fetch(newOwnerId).catch(() => null);
            if (!newOwner) {
                return interaction.update({
                    content: '❌ Не удалось найти участника.',
                    components: []
                });
            }

            await interaction.update({
                content: `${eTransfer()} Передаю лужу ${newOwner}...`,
                components: []
            });
            try {
                await transferOwnership(channel, ownerId, newOwnerId, false);
                await interaction.editReply({
                    content: `✅ Лужа передана ${newOwner}.`,
                    components: []
                });
            } catch {
                await interaction.editReply({
                    content: '❌ Что-то пошло не так. Попробуй ещё раз.',
                    components: []
                }).catch(() => {});
            }
            return;
        }

        if (customId.startsWith('region_select_')) {
            if (interaction.member.id !== ownerId) {
                return interaction.update({
                    content: '🌿 Этой лужей управляет другой обитатель Пруда.',
                    components: []
                });
            }
            const value = interaction.values[0];
            const regionId = value === 'auto' ? null : value;

            try {
                await channel.setRTCRegion(regionId);
            } catch (e) {
                console.error('setRTCRegion:', e);
                return interaction.update({
                    content: '❌ Не удалось сменить место обитания. Discord мог отключить эту функцию для ботов.',
                    components: []
                });
            }

            const label = REGIONS.find(r => r.value === value)?.label || value;
            return interaction.update({
                content: `${eGlobe()} Место обитания изменено на **${label}**.`,
                components: []
            });
        }
    } catch (e) {
        if (e.code === 10062) {
            console.log('⚠️ Interaction устарел (10062) — пропускаем.');
        } else {
            console.error('Ошибка обработки списка/модалки:', e);
        }
    }
});

// =========================
// 📊 КНОПКИ РЕЙТИНГА
// =========================
async function handleTopButton(interaction) {
    const id = interaction.customId;

    if (id === 'top_close') {
        return interaction.message.delete().catch(() => {});
    }

    if (id === 'top_voice' || id === 'top_days') {
        const metric = id.split('_')[1];
        const { embed, totalPages } = await buildTopEmbed(
            interaction.guild, metric, 0, interaction.user.username
        );
        const components = buildTopButtons(metric, 0, totalPages);
        return interaction.update({ embeds: [embed], components });
    }

    if (id.startsWith('top_page_')) {
        const parts = id.split('_');
        const metric = parts[2];
        const page = parseInt(parts[3], 10);
        const { embed, totalPages } = await buildTopEmbed(
            interaction.guild, metric, page, interaction.user.username
        );
        const components = buildTopButtons(metric, page, totalPages);
        return interaction.update({ embeds: [embed], components });
    }
}

// =========================
// 🏷️ Отображаемая роль
// =========================
function getDisplayRole(member) {
    const evoRole = config.EVOLUTION_ROLES.find(r => member.roles.cache.has(r.id));
    if (evoRole) return evoRole.name;

    const highest = member.roles.highest;
    if (highest && highest.name !== '@everyone') return highest.name;

    return 'без роли';
}

// =========================
// 🐸 ЭВОЛЮЦИЯ
// =========================
async function checkMemberEvolution(member) {
    if (!member || member.user.bot) return;

    if (member.roles.cache.some(r => config.EXCLUDED_ROLES.includes(r.id))) return;

    const hasAnyEvo = member.roles.cache.some(r =>
        config.EVOLUTION_ROLES.some(er => er.id === r.id)
    );
    if (!hasAnyEvo) return;

    const eligible = stats.getEligibleRole(member.id);
    const user = stats.getUser(member.id);
    if (user.currentRole === eligible.name) return;

    const curIdx = config.EVOLUTION_ROLES.findIndex(r => r.name === user.currentRole);
    const newIdx = config.EVOLUTION_ROLES.findIndex(r => r.name === eligible.name);
    if (newIdx < curIdx) return;

    for (const role of config.EVOLUTION_ROLES) {
        if (role.id && member.roles.cache.has(role.id)) {
            await member.roles.remove(role.id).catch(() => {});
        }
    }
    await member.roles.add(eligible.id).catch(() => {});
    user.currentRole = eligible.name;
    console.log(`${member.user.tag} -> "${eligible.name}"`);

    if (config.EVOLUTION_LOG_CHANNEL_ID) {
        const ch = await member.guild.channels
            .fetch(config.EVOLUTION_LOG_CHANNEL_ID)
            .catch(() => null);

        if (ch) {
            const prevRole = config.EVOLUTION_ROLES[curIdx]?.name || 'икра';

            const stageEmojiId = {
                'икра':       '1518852254877351946',
                'головастик': '1518852303245938698',
                'малёк':      '1518852536805625998',
                'лягушонок':  '1518852349626421288',
                'лягушка':    '1518852591851933776',
                'жаба':       '1545904956681490553'
            };

            const emojiId = stageEmojiId[eligible.name];
            const emoji = emojiId
                ? (member.guild.emojis.cache.get(emojiId)?.toString() ||
                   member.client.emojis.cache.get(emojiId)?.toString() ||
                   `<:emoji:${emojiId}>`)
                : '';

            await ch.send(
                `🌱 Кажется, в Пруду кто-то подрос...\n\n` +
                `${emoji} ${member} больше не **${prevRole}**. ` +
                `Теперь он(а) — **${eligible.name}**.`
            ).catch(() => {});
        }
    }
}

async function fullSync(client) {
    try {
        console.log('🔄 Полная синхронизация эволюции...');
        for (const guild of client.guilds.cache.values()) {
            const members = await guild.members.fetch();
            for (const member of members.values()) {
                await checkMemberEvolution(member);
            }
        }
        stats.saveStats();
        console.log('✅ Полная синхронизация завершена.');
    } catch (e) {
        console.error('fullSync:', e);
    }
}

// =========================
// 🧹 ВЫХОД
// =========================
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🧹 ${signal}. Уходим...`);
    stats.saveStats();

    const forceExit = setTimeout(() => process.exit(0), 5000);
    let deleted = 0;
    try {
        for (const guild of client.guilds.cache.values()) {
            const channels = await guild.channels.fetch().catch(() => null);
            if (!channels) continue;
            for (const channel of channels.values()) {
                if (channel &&
                    isRoom(channel.id) &&
                    channel.type === ChannelType.GuildVoice &&
                    channel.members?.size === 0) {
                    const ok = await channel.delete().then(() => true).catch(() => false);
                    if (ok) {
                        deleted++;
                        removeRoomOwner(channel.id);
                    }
                }
            }
        }
    } catch (e) {}
    console.log(`✅ Удалено пустых луж: ${deleted}`);
    clearTimeout(forceExit);
    client.destroy();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// =========================
// 🔐 ВХОД
// =========================
client.login(process.env.DISCORD_TOKEN);