import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild) {
    const channel = cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Nicht gesetzt`';
    const xpMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const xpMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;
    const cooldown = cfg.xpCooldown ?? 60;
    const rawMsg = cfg.levelUpMessage || '{user} ist gelevelt! Neues Level: {level}!';
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;

    const rewards = cfg.roleRewards ?? {};
    const rewardEntries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));
    const rewardsValue = rewardEntries.length > 0
        ? rewardEntries.map(([lvl, roleId]) => `Level **${lvl}** → <@&${roleId}>`).join('\n')
        : '`Keine konfiguriert`';

    const ignoredChannels = cfg.ignoredChannels ?? [];
    const ignoredRoles = cfg.ignoredRoles ?? [];
    const ignoredChValue = ignoredChannels.length > 0 ? ignoredChannels.map(id => `<#${id}>`).join(', ') : '`Keine`';
    const ignoredRoValue = ignoredRoles.length > 0 ? ignoredRoles.map(id => `<@&${id}>`).join(', ') : '`Keine`';

    return new EmbedBuilder()
        .setTitle('📊 Level-System Dashboard')
        .setDescription(`Verwalte die Level-Einstellungen für **${guild.name}**.\nWähle unten eine Option aus, um Einstellungen zu ändern.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Level-up Kanal', value: channel, inline: true },
            { name: '⚙️ System-Status', value: cfg.enabled ? '✅ **Aktiviert**' : '❌ **Deaktiviert**', inline: true },
            { name: '📣 Benachrichtigungen', value: cfg.announceLevelUp !== false ? '✅ **Aktiviert**' : '❌ **Deaktiviert**', inline: true },
            { name: '🎲 XP pro Nachricht', value: `\`${xpMin} – ${xpMax}\``, inline: true },
            { name: '⏱️ XP-Abklingzeit', value: `\`${cooldown}s\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '💬 Level-up Nachricht', value: msgPreview, inline: false },
            { name: '🏆 Rollenbelohnungen', value: rewardsValue, inline: false },
            { name: '🚫 Ignorierte Kanäle', value: ignoredChValue, inline: true },
            { name: '🚫 Ignorierte Rollen', value: ignoredRoValue, inline: true },
        )
        .setFooter({ text: 'Das Dashboard schließt sich nach 10 Minuten Inaktivität' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`level_cfg_${guildId}`)
        .setPlaceholder('Wähle eine Option zum Konfigurieren...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Level-up Kanal ändern')
                .setDescription('Setze den Kanal für Level-up Benachrichtigungen')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Level-up Nachricht bearbeiten')
                .setDescription('Passe die Nachricht an, die bei einem Level-up erscheint')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('XP-Bereich festlegen')
                .setDescription('Setze die minimale und maximale XP pro Nachricht')
                .setValue('xp_range')
                .setEmoji('🎲'),
            new StringSelectMenuOptionBuilder()
                .setLabel('XP-Abklingzeit festlegen')
                .setDescription('Sekunden zwischen XP-Gutschriften für denselben Nutzer')
                .setValue('xp_cooldown')
                .setEmoji('⏱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Rollenbelohnung hinzufügen')
                .setDescription('Vergibt eine Rolle, wenn ein bestimmtes Level erreicht wird')
                .setValue('role_reward_add')
                .setEmoji('🏆'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Rollenbelohnung entfernen')
                .setDescription('Entfernt eine Rollenbelohnung von einem bestimmten Level')
                .setValue('role_reward_remove')
                .setEmoji('🗑️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ignorierte Kanäle')
                .setDescription('Kanäle verwalten, in denen keine XP vergeben werden')
                .setValue('ignore_channels')
                .setEmoji('🚫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Ignorierte Rollen')
                .setDescription('Rollen verwalten, die keine XP erhalten können')
                .setValue('ignore_roles')
                .setEmoji('🚫'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const announceOn = cfg.announceLevelUp !== false;
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_announce_${guildId}`)
            .setLabel('Benachrichtigungen')
            .setStyle(announceOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('📣')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`level_cfg_toggle_system_${guildId}`)
            .setLabel('Level-System')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('⚡')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId) {
    const selectMenu = buildSelectMenu(guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
        components: [
            buildButtonRow(cfg, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            if (!cfg.configured) {
                throw new TitanBotError(
                    'Leveling system not configured',
                    ErrorTypes.CONFIGURATION,
                    'Das Level-System wurde noch nicht eingerichtet. Führe zuerst `/level setup` aus.',
                );
            }

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [buildButtonRow(cfg, guildId), selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `level_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_range':
                            await handleXpRange(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'xp_cooldown':
                            await handleXpCooldown(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_add':
                            await handleRoleRewardAdd(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role_reward_remove':
                            await handleRoleRewardRemove(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'ignore_channels':
                            await handleIgnoreChannels(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'ignore_roles':
                            await handleIgnoreRoles(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Ein Fehler ist bei der Verarbeitung deiner Auswahl aufgetreten.'
                            : 'Ein unerwarteter Fehler ist beim Aktualisieren der Konfiguration aufgetreten.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Konfigurationsfehler', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (i.customId === `level_cfg_toggle_announce_${guildId}` ||
                        i.customId === `level_cfg_toggle_system_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                const isAnnounce = btnInteraction.customId === `level_cfg_toggle_announce_${guildId}`;

                if (isAnnounce) {
                    cfg.announceLevelUp = cfg.announceLevelUp === false;
                    await saveLevelingConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Benachrichtigungen aktualisiert',
                                `Level-up Benachrichtigungen sind jetzt **${cfg.announceLevelUp ? 'aktiviert' : 'deaktiviert'}**.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    const wasEnabled = cfg.enabled !== false;
                    cfg.enabled = !wasEnabled;
                    await saveLevelingConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ System aktualisiert',
                                `Das Level-System ist jetzt **${cfg.enabled ? 'aktiviert' : 'deaktiviert'}**.${!cfg.enabled ? '\nBenutzer erhalten keine XP, bis das System wieder aktiviert wird.' : ''}`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                await refreshDashboard(interaction, cfg, guildId);
            });

            const handleTimeout = async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('⏰ Dashboard abgelaufen')
                        .setDescription('Dieses Dashboard wurde wegen Inaktivität geschlossen. Bitte führe den Befehl erneut aus.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            };

            collector.on('end', handleTimeout);
            btnCollector.on('end', handleTimeout);

        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in level_dashboard:', error);
            throw new TitanBotError(
                `Level dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Das Level-Dashboard konnte nicht geöffnet werden.',
            );
        }
    },
};

// ─── Add Role Reward ─────────────────────────────────────────────────────────

async function handleRoleRewardAdd(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_add_${guildId}`)
        .setTitle('🏆 Rollenbelohnung hinzufügen');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('reward_role')
        .setPlaceholder('Wähle eine Rolle aus...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Zu vergebende Rolle')
        .setDescription('Diese Rolle wird vergeben, wenn das Level erreicht wird')
        .setRoleSelectMenuComponent(roleSelect);

    const levelInput = new TextInputBuilder()
        .setCustomId('reward_level')
        .setLabel('Erforderliches Level (1–500)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('10')
        .setMaxLength(3)
        .setMinLength(1)
        .setRequired(true);

    modal.addLabelComponents(roleLabel);
    modal.addComponents(new ActionRowBuilder().addComponents(levelInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_add_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('reward_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || level < 1 || level > 500) {
        await submitted.reply({
            embeds: [errorEmbed('Ungültiges Level', 'Das Level muss eine ganze Zahl zwischen **1** und **500** sein.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const roleId = submitted.fields.getField('reward_role').values[0];

    cfg.roleRewards = cfg.roleRewards ?? {};
    cfg.roleRewards[level] = roleId;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Rollenbelohnung hinzugefügt', `<@&${roleId}> wird nun ab Level **${level}** vergeben.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Remove Role Reward ───────────────────────────────────────────────────────

async function handleRoleRewardRemove(selectInteraction, rootInteraction, cfg, guildId, client) {
    const rewards = cfg.roleRewards ?? {};
    const entries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));

    if (entries.length === 0) {
        await selectInteraction.deferUpdate();
        await selectInteraction.followUp({
            embeds: [errorEmbed('Keine Belohnungen', 'Es sind keine Rollenbelohnungen zum Entfernen konfiguriert.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_role_reward_remove_${guildId}`)
        .setTitle('🗑️ Rollenbelohnung entfernen');

    const infoInput = new TextInputBuilder()
        .setCustomId('current_rewards')
        .setLabel('Aktuelle Belohnungen (schreibgeschützt)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(entries.map(([lvl, roleId]) => `Level ${lvl}: <@&${roleId}>`).join('\n'))
        .setRequired(false);

    const levelInput = new TextInputBuilder()
        .setCustomId('remove_level')
        .setLabel('Level, von dem die Belohnung entfernt wird')
        .setStyle(TextInputStyle.Short)
        .setValue(entries[0][0])
        .setMaxLength(3)
        .setMinLength(1)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(infoInput),
        new ActionRowBuilder().addComponents(levelInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_role_reward_remove_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawLevel = submitted.fields.getTextInputValue('remove_level').trim();
    const level = parseInt(rawLevel, 10);

    if (isNaN(level) || !cfg.roleRewards?.[level]) {
        await submitted.reply({
            embeds: [errorEmbed('Nicht gefunden', `Für das Level **${rawLevel}** ist keine Rollenbelohnung eingerichtet.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    delete cfg.roleRewards[level];
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Rollenbelohnung entfernt', `Die Rollenbelohnung für Level **${level}** wurde erfolgreich entfernt.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Change Level-up Channel ─────────────────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_channel_modal_${guildId}`)
        .setTitle('📢 Level-up Kanal ändern');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('levelup_channel')
        .setPlaceholder('Wähle einen Textkanal...')
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Level-up Kanal')
        .setDescription('Kanal, in dem Level-up Benachrichtigungen gesendet werden')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_channel_modal_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const channelId = submitted.fields.getField('levelup_channel').values[0];
    const channel = selectInteraction.guild.channels.cache.get(channelId);

    if (channel && !botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
        await submitted.reply({
            embeds: [errorEmbed('Fehlende Berechtigungen', `Ich benötige die Berechtigungen **Nachrichten senden** und **Links einbetten** in ${channel}, um Benachrichtigungen zu senden.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.levelUpChannel = channelId;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Kanal aktualisiert', `Level-up Benachrichtigungen werden nun in ${channel ?? `<#${channelId}>`} gesendet.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Ignored Channels ────────────────────────────────────────────────────────

async function handleIgnoreChannels(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_ignore_channels_${guildId}`)
        .setTitle('🚫 Ignorierte Kanäle');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ignore_channel')
        .setPlaceholder('Wähle Kanäle zum Umschalten...')
        .setMinValues(1)
        .setMaxValues(10)
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Ignorierte Kanäle umschalten')
        .setDescription('Ausgewählte Kanäle werden umgeschaltet — dort werden keine XP mehr vergeben')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_ignore_channels_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('ignore_channel').values;
    const ignoreSet = new Set(cfg.ignoredChannels ?? []);

    for (const id of selectedIds) {
        if (ignoreSet.has(id)) {
            ignoreSet.delete(id);
        } else {
            ignoreSet.add(id);
        }
    }

    cfg.ignoredChannels = Array.from(ignoreSet);
    await saveLevelingConfig(client, guildId, cfg);

    const list = cfg.ignoredChannels.length > 0
        ? cfg.ignoredChannels.map(id => `<#${id}>`).join(', ')
        : '`Keine`';

    await submitted.reply({
        embeds: [successEmbed('✅ Ignorierte Kanäle aktualisiert', `XP werden nicht mehr vergeben in: ${list}`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Ignored Roles ────────────────────────────────────────────────────────────

async function handleIgnoreRoles(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId(`level_cfg_ignore_roles_${guildId}`)
        .setTitle('🚫 Ignorierte Rollen');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ignore_role')
        .setPlaceholder('Wähle Rollen zum Umschalten...')
        .setMinValues(1)
        .setMaxValues(10)
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Ignorierte Rollen umschalten')
        .setDescription('Ausgewählte Rollen werden umgeschaltet — Mitglieder mit diesen Rollen erhalten keine XP')
        .setRoleSelectMenuComponent(roleSelect);

    modal.addLabelComponents(roleLabel);

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `level_cfg_ignore_roles_${guildId}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const selectedIds = submitted.fields.getField('ignore_role').values;
    const ignoreSet = new Set(cfg.ignoredRoles ?? []);

    for (const id of selectedIds) {
        if (ignoreSet.has(id)) {
            ignoreSet.delete(id);
        } else {
            ignoreSet.add(id);
        }
    }

    cfg.ignoredRoles = Array.from(ignoreSet);
    await saveLevelingConfig(client, guildId, cfg);

    const list = cfg.ignoredRoles.length > 0
        ? cfg.ignoredRoles.map(id => `<@&${id}>`).join(', ')
        : '`Keine`';

    await submitted.reply({
        embeds: [successEmbed('✅ Ignorierte Rollen aktualisiert', `Diese Rollen erhalten keine XP mehr: ${list}`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Edit Level-up Message ────────────────────────────────────────────────────

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_message')
        .setTitle('Level-up Nachricht bearbeiten')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Nachricht ({user} und {level} sind verfügbar)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.levelUpMessage || '{user} ist gelevelt! Neues Level: {level}!')
                    .setMaxLength(500)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('{user} ist gelevelt! Neues Level: {level}!'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('message_input').trim();

    if (!newMessage.includes('{user}') && !newMessage.includes('{level}')) {
        logger.warn(
            `Level-up message set without {user} or {level} placeholders in guild ${guildId}`,
        );
    }

    cfg.levelUpMessage = newMessage;
    await saveLevelingConfig(client, guildId, cfg);

    const preview = newMessage.replace('{user}', '@Benutzer').replace('{level}', '5');

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Nachricht aktualisiert',
                `Level-up Nachricht gespeichert.\n**Vorschau:** ${preview}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Range ─────────────────────────────────────────────────────────────

async function handleXpRange(selectInteraction, rootInteraction, cfg, guildId, client) {
    const currentMin = cfg.xpRange?.min ?? cfg.xpPerMessage?.min ?? 15;
    const currentMax = cfg.xpRange?.max ?? cfg.xpPerMessage?.max ?? 25;

    const modal = new ModalBuilder()
        .setCustomId('level_cfg_xp_range')
        .setTitle('XP-Bereich pro Nachricht festlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_min_input')
                    .setLabel('Minimale XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMin))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('15'),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('xp_max_input')
                    .setLabel('Maximale XP (1–500)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(currentMax))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('25'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_xp_range' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawMin = submitted.fields.getTextInputValue('xp_min_input').trim();
    const rawMax = submitted.fields.getTextInputValue('xp_max_input').trim();
    const newMin = parseInt(rawMin, 10);
    const newMax = parseInt(rawMax, 10);

    if (isNaN(newMin) || isNaN(newMax) || newMin < 1 || newMax < 1 || newMin > 500 || newMax > 500) {
        await submitted.reply({
            embeds: [
                errorEmbed('Ungültige Werte', 'Beide XP-Werte müssen ganze Zahlen zwischen **1** and **500** sein.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (newMin > newMax) {
        await submitted.reply({
            embeds: [
                errorEmbed('Ungültiger Bereich', 'Die minimale XP darf nicht größer als die maximale XP sein.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpRange = { min: newMin, max: newMax };
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ XP-Bereich aktualisiert',
                `Benutzer erhalten nun zwischen **${newMin}** und **${newMax}** XP pro Nachricht.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Set XP Cooldown ──────────────────────────────────────────────────────────

async function handleXpCooldown(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('level_cfg_cooldown')
        .setTitle('XP-Abklingzeit festlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_input')
                    .setLabel('Abklingzeit in Sekunden (0–3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 60))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('60'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'level_cfg_cooldown' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawCooldown = submitted.fields.getTextInputValue('cooldown_input').trim();
    const cooldown = parseInt(rawCooldown, 10);

    if (isNaN(cooldown) || cooldown < 0 || cooldown > 3600) {
        await submitted.reply({
            embeds: [
                errorEmbed('Ungültiger Wert', 'Die Abklingzeit muss eine ganze Zahl zwischen **0** und **3600** Sekunden sein.'),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    cfg.xpCooldown = cooldown;
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Abklingzeit aktualisiert',
                `Die XP-Abklingzeit wurde auf **${cooldown}** Sekunden festgelegt.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}
