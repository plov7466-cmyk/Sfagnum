const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const {
    Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, MessageFlags, EmbedBuilder, ContainerBuilder, TextDisplayBuilder,
    SectionBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const config = require('./config');

// =========================
// 🌐 HTTP-СЕРВЕР
// =========================
const app = express();
const PORT = process.env.PORT || 8001;
app.get('/', (req, res) => res.send('Сфагнум онлайн'));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.listen(PORT, '0.0.0.0', () => console.log(`HTTP-сервер Сфагнума на порту ${PORT}`));

// =========================
// 🐸 КЛИЕНТ
// =========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
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
            `Нажми на кнопку ниже, выбери тему и опиши проблему в появившемся окне. ` +
            `Модератор получит уведомление и свяжется с тобой в личных сообщениях.\n\n` +
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
// 🔘 ОБРАБОТКА INTERACTIONS
// =========================
client.on('interactionCreate', async (interaction) => {
    console.log('▶️ Interaction:', {
        type: interaction.type,
        customId: interaction.customId,
        commandName: interaction.commandName,
        userId: interaction.user?.id
    });

    try {
        // ============================================
        // 1) Кнопка "Связаться с модератором" → Показываем меню
        // ============================================
        if (interaction.isButton() && interaction.customId === 'ticket_open') {
            console.log('🎯 Нажата ticket_open — показываем меню категорий');

            const user = interaction.user;
            const guild = interaction.guild;

            if (!guild) {
                return interaction.reply({
                    content: '❌ Кнопку можно нажимать только на сервере.',
                    ephemeral: true
                });
            }

            const existing = findTicketByUser(user.id);
            if (existing && (existing.status === 'awaiting_description' ||
                             existing.status === 'waiting' ||
                             existing.status === 'active')) {
                return interaction.reply({
                    content: `${eMoss()} У тебя уже есть активная заявка. Проверь личку с ботом.`,
                    ephemeral: true
                });
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId('ticket_category_select')
                .setPlaceholder('Выбери категорию обращения...');

            for (const [key, cat] of Object.entries(config.TICKET_CATEGORIES)) {
                select.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(cat.label)
                        .setDescription(cat.description)
                        .setValue(key)
                );
            }

            const row = new ActionRowBuilder().addComponents(select);

            return interaction.reply({
                content: `${eMoss()} Пожалуйста, выбери тему, с которой связана твоя проблема:`,
                components: [row],
                ephemeral: true
            });
        }

        // ============================================
        // 2) Выбор категории из меню → Показываем модальное окно
        // ============================================
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
            const selectedCategory = interaction.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${selectedCategory}`)
                .setTitle('Описание проблемы');

            const descInput = new TextInputBuilder()
                .setCustomId('ticket_description_input')
                .setLabel('Что случилось? (минимум 15 символов)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Например: Пользователь X спамит в канале #general уже 10 минут.')
                .setMinLength(config.TICKET_DESCRIPTION_MIN)
                .setMaxLength(1000)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(descInput);
            modal.addComponents(firstActionRow);

            return await interaction.showModal(modal);
        }

        // ============================================
        // 2.1) Отправка модального окна с описанием
        // ============================================
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const user = interaction.user;
            const guild = interaction.guild;
            const selectedCategory = interaction.customId.replace('ticket_modal_', '');
            const description = interaction.fields.getTextInputValue('ticket_description_input');

            await interaction.deferReply({ ephemeral: true });

            const check = validateDescription(description);
            if (!check.ok) {
                return interaction.editReply({
                    content: `❌ Описание не принято: ${check.reason}.\nПопробуй нажать кнопку на панели еще раз.`
                });
            }

            // Создаём заявку
            tickets[user.id] = {
                status: 'waiting',
                modId: null,
                category: selectedCategory,
                description: check.text,
                createdAt: Date.now(),
                guildId: guild.id
            };
            ticketMessages[user.id] = {};
            saveTickets();

            // Собираем модераторов
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
                delete tickets[user.id];
                delete ticketMessages[user.id];
                saveTickets();
                return interaction.editReply({ content: '😔 Сейчас нет доступных модераторов. Попробуй позже.' });
            }

            const categoryLabel = config.TICKET_CATEGORIES[selectedCategory]?.label || selectedCategory;

            const embed = new EmbedBuilder()
                .setColor(config.TICKET_CATEGORIES[selectedCategory]?.color || config.COLORS.WARN)
                .setAuthor({
                    name: 'Сфагнум · новый зов о помощи',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle(`${eTicket()} Заявка на связь с модератором`)
                .setDescription(
                    `**Пользователь:** ${user} (\`${user.tag}\`)\n` +
                    `**ID:** \`${user.id}\`\n` +
                    `**Сервер:** ${guild.name}\n` +
                    `**Категория:** ${categoryLabel}\n\n` +
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
                    ticketMessages[user.id][mod.id] = { messageId: msg.id, channelId: msg.channelId };
                    sent++;
                } catch { /* закрыты ЛС */ }
            }

            if (sent === 0) {
                delete tickets[user.id];
                delete ticketMessages[user.id];
                saveTickets();
                return interaction.editReply({ content: '❌ Не удалось доставить уведомление модераторам (у них закрыты ЛС).' });
            }

            saveTickets();
            
            return interaction.editReply({
                content: `${eMoss()} Твоя заявка отправлена модераторам! Ожидай ответа здесь, на сервере.\n\n*Уведомление о начале диалога придет тебе в личку.*`
            });
        }

        // ============================================
        // 3) Принятие тикета
        // ============================================
        if (interaction.isButton() && interaction.customId.startsWith('ticket_accept_')) {
            const userId = interaction.customId.split('_')[2];
            const mod = interaction.user;

            const t = findTicketByUser(userId);
            if (!t || t.status !== 'waiting') {
                return interaction.reply({
                    content: '⚠️ Заявку уже принял другой модератор.',
                    ephemeral: true
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
                ephemeral: true
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
                    ephemeral: true
                }).catch(() => {});
            }
            return;
        }

        // ============================================
        // 4) Отклонение
        // ============================================
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

        // ============================================
        // 5) Закрытие тикета (кнопка)
        // ============================================
        if (interaction.isButton() && interaction.customId.startsWith('ticket_close_')) {
            const userId = interaction.customId.split('_')[2];
            const t = findTicketByUser(userId);

            if (!t) {
                return interaction.reply({
                    content: '⚠️ Заявка уже закрыта.',
                    ephemeral: true
                });
            }

            const isOwner = interaction.user.id === userId;
            const isModerator = interaction.user.id === t.modId;

            if (!isOwner && !isModerator) {
                return interaction.reply({
                    content: '❌ У тебя нет прав закрыть эту заявку.',
                    ephemeral: true
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

        // ============================================
        // 6) Слэш-команда панели
        // ============================================
        if (interaction.isChatInputCommand() && interaction.commandName === 'sphagnum_panel') {
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({
                    content: '❌ Только администратор может вызвать панель.',
                    ephemeral: true
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
                    ephemeral: true
                });
            } catch (e) {
                console.error('sphagnum_panel:', e);
                await interaction.reply({
                    content: '❌ Не удалось отправить панель.',
                    ephemeral: true
                });
            }
            return;
        }
    } catch (e) {
        if (e.code === 10062) return; // Unknown interaction
        console.error('❌ Ошибка обработки interaction:', e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Произошла ошибка. Попробуй позже.',
                ephemeral: true
            }).catch(() => {});
        }
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

    // --- Отмена ---
    if (message.content.trim().toLowerCase() === '!cancel') {
        if (t) {
            delete tickets[userId];
            delete ticketMessages[userId];
            saveTickets();
            await message.reply(`${eClose()} Заявка отменена.`);
            if (t.modId) await sendToMod(t.modId, `❌ Пользователь <@${userId}> отменил заявку.`);
        } else {
            await message.reply('У тебя нет активной заявки.');
        }
        return;
    }

    // --- Тикет уже есть (waiting / active) ---
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

    // --- Модератор пишет в ЛС ---
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