const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const {
    Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, MessageFlags, EmbedBuilder, ContainerBuilder, TextDisplayBuilder,
    SectionBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const config = require('./config');

// =========================
// 🌐 HTTP-СЕРВЕР
// =========================
const app = express();
const PORT = process.env.PORT || 8001;
app.get('/', (req, res) => res.send('Сфагнум онлайн'));
app.listen(PORT, () => console.log(`HTTP-сервер Сфагнума на порту ${PORT}`));

// =========================
// 🐸 КЛИЕНТ
// =========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

// =========================
// 💾 ХРАНИЛИЩЕ
// =========================
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

let tickets = {};
let ticketMessages = {};

function loadStorage() {
    try {
        if (!fs.existsSync(TICKETS_FILE)) return;
        const raw = fs.readFileSync(TICKETS_FILE, 'utf8').trim();
        if (!raw) return;
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === 'object' && parsed.tickets && parsed.messages) {
            tickets = parsed.tickets;
            ticketMessages = parsed.messages;
            return;
        }

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            tickets = parsed;
            ticketMessages = {};
        }
    } catch (e) {
        console.error('Не удалось загрузить tickets.json:', e.message);
        tickets = {};
        ticketMessages = {};
    }
}
loadStorage();

function saveTickets() {
    try {
        fs.writeFileSync(
            TICKETS_FILE,
            JSON.stringify({ tickets, messages: ticketMessages }, null, 2),
            'utf8'
        );
    } catch (e) {
        console.error('Не удалось сохранить tickets.json:', e.message);
    }
}

setInterval(saveTickets, 30_000);

// =========================
// 🎨 ЭМОДЗИ
// =========================
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
const eTicket  = () => emojiFor(config.EMOJI.TICKET);
const eAccept  = () => emojiFor(config.EMOJI.ACCEPT);
const eDecline = () => emojiFor(config.EMOJI.DECLINE);
const eClose   = () => emojiFor(config.EMOJI.CLOSE);
const eMoss    = () => emojiFor(config.EMOJI.MOSS);
const eMod     = () => emojiFor(config.EMOJI.MOD);
const eSpeech  = () => emojiFor(config.EMOJI.SPEECH);
const eGreen   = () => emojiFor(config.EMOJI.GREEN);

// =========================
// 🧩 УТИЛИТЫ
// =========================
function findTicketByMod(modId) {
    for (const [userId, t] of Object.entries(tickets)) {
        if (t.modId === modId && t.status === 'active') return { userId, ...t };
    }
    return null;
}

function findTicketByUser(userId) {
    return tickets[userId] || null;
}

async function sendToUser(userId, content, components = []) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({ content, components });
        return true;
    } catch { return false; }
}

async function sendToMod(modId, content, components = []) {
    try {
        const mod = await client.users.fetch(modId);
        await mod.send({ content, components });
        return true;
    } catch { return false; }
}

async function deleteModMessage(modId, info) {
    try {
        const ch = await client.channels.fetch(info.channelId);
        const msg = await ch.messages.fetch(info.messageId);
        await msg.delete();
    } catch { /* уже удалено / ЛС закрыт */ }
}

async function editModMessage(modId, info, payload) {
    try {
        const ch = await client.channels.fetch(info.channelId);
        const msg = await ch.messages.fetch(info.messageId);
        await msg.edit(payload);
    } catch { /* не удалось — пропускаем */ }
}

// 📝 Проверка описания
function validateDescription(text) {
    const min = config.TICKET_DESCRIPTION_MIN || 15;
    const trimmed = (text || '').trim();

    if (trimmed.length < min) {
        return { ok: false, reason: `слишком коротко (минимум ${min} символов)` };
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
        return { ok: false, reason: 'нужно хотя бы одно предложение, а не одно слово' };
    }

    return { ok: true, text: trimmed };
}

// =========================
// 🎨 ПАНЕЛЬ (Components V2)
// =========================
function buildPanelV2() {
    const container = new ContainerBuilder().setAccentColor(config.COLORS.MOSS);

    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
                .setURL(config.PANEL_IMAGE_URL)
                .setDescription('Связь с модератором')
        )
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ${eMoss()} Связь с модератором\n\n` +
            `Нажми на кнопку ниже, выбери тему и опиши проблему — ` +
            `модератор получит уведомление в личные сообщения и свяжется с тобой.\n\n` +
            `*Дальше общение идёт в личке с ботом — просто пиши сообщения.*`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    const btn = new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Связаться с модератором')
        .setStyle(ButtonStyle.Success);

    if (config.EMOJI.TICKET) btn.setEmoji({ id: config.EMOJI.TICKET });

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('Нажми, если нужна помощь модератора')
            )
            .setButtonAccessory(btn)
    );

    container.addSeparatorComponents(new SeparatorBuilder());

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `*Сфагнум — моховой страж Пруда. Он передаст твой зов модераторам.*`
        )
    );

    return container;
}

// =========================
// 🚀 ЗАПУСК
// =========================
client.once('clientReady', async () => {
    console.log(`🐸 Сфагнум запущен как ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
        await guild.emojis.fetch().catch(() => {});
    }

    const commands = [
        { name: 'sphagnum_panel', description: 'Отправить панель связи с модератором' }
    ];
    for (const guild of client.guilds.cache.values()) {
        guild.commands.set(commands).catch(() => {});
    }

    await restorePendingTickets();
});

async function restorePendingTickets() {
    for (const [userId, t] of Object.entries(tickets)) {
        if (t.status === 'waiting') {
            await sendToUser(userId,
                `${eMoss()} Сфагнум перезапустился. Твоя заявка всё ещё в очереди — ожидай модератора.`);
        }
    }
}

// =========================
// 🔘 КНОПКИ / СЕЛЕКТ / МОДАЛКА
// =========================
client.on('interactionCreate', async (interaction) => {
    try {
        // --- Открытие тикета: показываем селект категорий ---
        if (interaction.isButton() && interaction.customId === 'ticket_open') {
            
            console.log("Нажата кнопка! Категории в конфиге:", Object.keys(config.TICKET_CATEGORIES || {}));

            // Убрали проверку на активную заявку, чтобы меню всегда показывалось
            
            const options = Object.entries(config.TICKET_CATEGORIES).map(([key, c]) => ({
                label: c.label,
                description: c.description,
                value: key
            }));

            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_category')
                .setPlaceholder('Выбери тему обращения')
                .addOptions(options);

            return interaction.reply({
                content: `${eMoss()} Выбери тему обращения:`,
                components: [new ActionRowBuilder().addComponents(menu)],
                flags: MessageFlags.Ephemeral
            });
        }

        // --- Выбор категории: показываем модалку с описанием ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
            const categoryKey = interaction.values[0];
            const category = config.TICKET_CATEGORIES[categoryKey];
            if (!category) {
                return interaction.update({
                    content: '❌ Неизвестная категория. Попробуй ещё раз.',
                    components: []
                }).catch(() => {});
            }

            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${categoryKey}`)
                .setTitle(category.label.slice(0, 45));

            const input = new TextInputBuilder()
                .setCustomId('ticket_description')
                .setLabel('Опиши проблему одним предложением')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(config.TICKET_DESCRIPTION_MIN || 15)
                .setMaxLength(1000)
                .setPlaceholder('Например: «Пользователь X спамит в канале #general уже 10 минут»')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));

            return interaction.showModal(modal);
        }

        // --- Сабмит модалки: создаём тикет ---
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const categoryKey = interaction.customId.replace('ticket_modal_', '');
            const category = config.TICKET_CATEGORIES[categoryKey];
            const user = interaction.user;
            const guild = interaction.guild;

            if (!category) {
                return interaction.reply({
                    content: '❌ Неизвестная категория.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const rawDescription = interaction.fields.getTextInputValue('ticket_description');
            const check = validateDescription(rawDescription);
            if (!check.ok) {
                return interaction.reply({
                    content: `❌ Описание не принято: ${check.reason}.\n` +
                             `Опиши проблему хотя бы одним предложением (минимум ${config.TICKET_DESCRIPTION_MIN} символов).`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const existing = findTicketByUser(user.id);
            if (existing && (existing.status === 'waiting' || existing.status === 'active')) {
                return interaction.editReply({
                    content: `${eMoss()} У тебя уже есть активная заявка. Дождись модератора.`
                });
            }

            // 🛡️ Собираем всех модераторов
            const allMods = new Set();
            for (const roleId of config.SUPPORT_ROLE_IDS) {
                const role = guild.roles.cache.get(roleId);
                if (role) {
                    for (const member of role.members.values()) {
                        if (!member.user.bot) allMods.add(member);
                    }
                }
            }

            const onlineMods = [...allMods].filter(m => m.presence?.status !== 'offline');
            const mods = onlineMods.length > 0 ? onlineMods : [...allMods];

            if (mods.length === 0) {
                return interaction.editReply({
                    content: '😔 Сейчас нет доступных модераторов. Попробуй позже.'
                });
            }

            tickets[user.id] = {
                status: 'waiting',
                modId: null,
                category: categoryKey,
                description: check.text,
                createdAt: Date.now(),
                guildId: guild.id
            };
            ticketMessages[user.id] = {};
            saveTickets();

            const embed = new EmbedBuilder()
                .setColor(category.color || config.COLORS.WARN)
                .setAuthor({
                    name: 'Сфагнум · новый зов о помощи',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle(`${eTicket()} ${category.label}`)
                .setDescription(
                    `**Пользователь:** ${user} (\`${user.tag}\`)\n` +
                    `**ID:** \`${user.id}\`\n` +
                    `**Сервер:** ${guild.name}\n\n` +
                    `**Описание проблемы:**\n>>> ${check.text}`
                )
                .setThumbnail(user.displayAvatarURL())
                .setFooter({ text: 'Нажми «Принять», чтобы взять заявку' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket_accept_${user.id}`)
                    .setLabel('Принять')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji({ id: config.EMOJI.ACCEPT }),
                new ButtonBuilder()
                    .setCustomId(`ticket_decline_${user.id}`)
                    .setLabel('Отклонить')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji({ id: config.EMOJI.DECLINE })
            );

            let sent = 0;
            for (const mod of mods) {
                try {
                    const msg = await mod.send({ embeds: [embed], components: [row] });
                    ticketMessages[user.id][mod.id] = {
                        messageId: msg.id,
                        channelId: msg.channelId
                    };
                    sent++;
                } catch { /* закрыты ЛС */ }
            }

            if (sent === 0) {
                delete tickets[user.id];
                delete ticketMessages[user.id];
                saveTickets();
                return interaction.editReply({
                    content: '❌ Не удалось доставить уведомление модераторам (у них закрыты ЛС). Сообщи администратору.'
                });
            }

            saveTickets();
            return interaction.editReply({
                content: `${eMoss()} Зов отправлен модераторам (${category.label}). ` +
                         `Ожидай — с тобой свяжутся через Сфагнума.`
            });
        }

        // --- Принятие тикета ---
        if (interaction.isButton() && interaction.customId.startsWith('ticket_accept_')) {
            const userId = interaction.customId.split('_')[2];
            const mod = interaction.user;

            const t = findTicketByUser(userId);
            if (!t || t.status !== 'waiting') {
                return interaction.reply({
                    content: '⚠️ Заявку уже принял другой модератор.',
                    flags: MessageFlags.Ephemeral
                });
            }

            t.status = 'active';
            t.modId = mod.id;
            saveTickets();

            const map = ticketMessages[userId] || {};

            for (const [modId, info] of Object.entries(map)) {
                if (modId === mod.id) continue;
                await deleteModMessage(modId, info);
            }

            const myInfo = map[mod.id];
            if (myInfo) {
                await editModMessage(mod.id, myInfo, {
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('ticket_accepted_disabled')
                                .setLabel('Принято')
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(true)
                        )
                    ]
                });
            }

            delete ticketMessages[userId];
            saveTickets();

            await interaction.reply({
                content: `✅ Ты принял заявку от <@${userId}>. Пиши сообщения сюда — они уйдут пользователю.`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});

            await interaction.message.edit({ components: [] }).catch(() => {});

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket_close_${userId}`)
                    .setLabel('Завершить диалог')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji({ id: config.EMOJI.CLOSE })
            );

            const ok = await sendToUser(userId,
                `${eMoss()} Модератор **${mod.tag}** принял твой зов.\n\n` +
                `Опиши проблему подробнее или ответь на вопросы — сообщения уйдут модератору.\n\n` +
                `*Чтобы завершить диалог, нажми на кнопку ниже или напиши \`!end\`.*`,
                [closeRow]
            );

            await sendToMod(mod.id,
                `${eGreen()} Диалог с <@${userId}> начат. Все твои сообщения будут пересылаться пользователю.\n\n` +
                `*Чтобы завершить диалог, нажми на кнопку ниже или напиши \`!end\`.*`,
                [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_close_${userId}`)
                        .setLabel('Завершить диалог')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji({ id: config.EMOJI.CLOSE })
                )]
            );

            if (!ok) {
                await interaction.followUp({
                    content: '⚠️ Не удалось написать пользователю — у него закрыты ЛС.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
            return;
        }

        // --- Отклонение ---
        if (interaction.isButton() && interaction.customId.startsWith('ticket_decline_')) {
            const userId = interaction.customId.split('_')[2];
            const t = findTicketByUser(userId);

            if (t && t.status === 'waiting') {
                const map = ticketMessages[userId] || {};
                for (const info of Object.values(map)) {
                    await deleteModMessage(null, info);
                }
                delete tickets[userId];
                delete ticketMessages[userId];
                saveTickets();

                await sendToUser(userId,
                    `${eDecline()} Модератор отклонил твой зов. Попробуй позже или напиши в общий чат.`
                );
            }

            await interaction.update({ components: [] }).catch(() => {});
            return;
        }

        // --- Закрытие тикета (кнопка) ---
        if (interaction.isButton() && interaction.customId.startsWith('ticket_close_')) {
            const userId = interaction.customId.split('_')[2];
            const t = findTicketByUser(userId);

            if (!t) {
                return interaction.reply({
                    content: '⚠️ Заявка уже закрыта.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const isOwner = interaction.user.id === userId;
            const isModerator = interaction.user.id === t.modId;

            if (!isOwner && !isModerator) {
                return interaction.reply({
                    content: '❌ У тебя нет прав закрыть эту заявку.',
                    flags: MessageFlags.Ephemeral
                });
            }

            delete tickets[userId];
            delete ticketMessages[userId];
            saveTickets();

            await sendToUser(userId, `${eClose()} Диалог с поддержкой завершён.`);
            if (t.modId) await sendToMod(t.modId, `${eClose()} Диалог с <@${userId}> завершён.`);

            return interaction.update({
                content: `${eClose()} Заявка закрыта.`,
                components: []
            }).catch(() => {});
        }
    } catch (e) {
        if (e.code === 10062) return;
        console.error('Ошибка обработки кнопки:', e);
    }
});

// =========================
// 💬 ПЕРЕСЫЛКА ЛС
// =========================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.channel.isDMBased()) return;

    const userId = message.author.id;

    const t = findTicketByUser(userId);
    if (t) {
        if (message.content.trim().toLowerCase() === '!end') {
            delete tickets[userId];
            delete ticketMessages[userId];
            saveTickets();
            await message.reply(`${eClose()} Диалог с поддержкой завершён.`);
            if (t.modId) await sendToMod(t.modId, `${eClose()} Пользователь <@${userId}> завершил диалог.`);
            return;
        }

        if (t.status === 'waiting') {
            await message.reply(`${eMoss()} Твоя заявка ещё в очереди. Дождись модератора.`);
            return;
        }

        if (t.status === 'active' && t.modId) {
            const ok = await sendToMod(t.modId,
                `${eSpeech()} **${message.author.tag}** (\`${userId}\`):\n${message.content}`
            );
            if (ok) message.react('✅').catch(() => {});
            else await message.reply('❌ Не удалось доставить сообщение модератору (закрыты ЛС).');
            return;
        }
    }

    const modTicket = findTicketByMod(userId);
    if (modTicket) {
        if (message.content.trim().toLowerCase() === '!end') {
            const { userId: targetUserId } = modTicket;
            delete tickets[targetUserId];
            delete ticketMessages[targetUserId];
            saveTickets();
            await message.reply(`${eClose()} Диалог завершён.`);
            await sendToUser(targetUserId, `${eClose()} Модератор завершил диалог.`);
            return;
        }

        const ok = await sendToUser(modTicket.userId,
            `${eMod()} **Модератор:**\n${message.content}`
        );
        if (ok) message.react('✅').catch(() => {});
        else await message.reply('❌ Не удалось доставить сообщение пользователю (закрыты ЛС).');
    }
});

// =========================
// 🧩 СЛЕШ-КОМАНДА ПАНЕЛИ
// =========================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'sphagnum_panel') return;

    if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({
            content: '❌ Только администратор может вызвать панель.',
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        const container = buildPanelV2();
        await interaction.channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
        await interaction.reply({
            content: `${eMoss()} Панель Сфагнума отправлена!`,
            flags: MessageFlags.Ephemeral
        });
    } catch (e) {
        console.error('sphagnum_panel:', e);
        await interaction.reply({
            content: '❌ Не удалось отправить панель.',
            flags: MessageFlags.Ephemeral
        });
    }
});

// =========================
// 🧹 ВЫХОД
// =========================
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🧹 ${signal}. Сфагнум уходит в мох...`);
    saveTickets();
    const forceExit = setTimeout(() => process.exit(0), 5000);
    client.destroy();
    clearTimeout(forceExit);
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// =========================
// 🔐 ВХОД
// =========================
client.login(process.env.DISCORD_TOKEN);