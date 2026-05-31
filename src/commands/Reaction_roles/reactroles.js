import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, EmbedBuilder, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createReactionRoleMessage, hasDangerousPermissions, getAllReactionRoleMessages, deleteReactionRoleMessage } from '../../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('Verwaltet die Zuweisung von Reaktionsrollen')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Richtet ein neues Reaktionsrollen-Panel ein')
                .addChannelOption(option => 
                    option.setName('channel')
                        .setDescription('Der Kanal, in den die Reaktionsrollen-Nachricht gesendet werden soll')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Titel für das Reaktionsrollen-Panel')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Beschreibung für das Reaktionsrollen-Panel')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role1')
                        .setDescription('Erste Rolle, die hinzugefügt werden soll')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role2')
                        .setDescription('Zweite Rolle, die hinzugefügt werden soll')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role3')
                        .setDescription('Dritte Rolle, die hinzugefügt werden soll')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role4')
                        .setDescription('Vierte Rolle, die hinzugefügt werden soll')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role5')
                        .setDescription('Fünfte Rolle, die hinzugefügt werden soll')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Verwalte und konfiguriere deine Reaktionsrollen-Panels')
                .addStringOption(option =>
                    option
                        .setName('panel')
                        .setDescription('Wähle ein Reaktionsrollen-Panel zur Verwaltung aus')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'setup') {
                await handleSetup(interaction);
            } else if (subcommand === 'dashboard') {
                const selectedPanelId = interaction.options.getString('panel');
                await handleDashboard(interaction, selectedPanelId);
            }
        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'reactroles',
                subcommand: subcommand
            });
        }
    },

    async autocomplete(interaction) {
        if (interaction.commandName !== 'reactroles') return;
        if (interaction.options.getSubcommand() !== 'dashboard') return;

        try {
            const guildId = interaction.guild.id;
            const client = interaction.client;
            
            let panels;
            try {
                panels = await getAllReactionRoleMessages(client, guildId);
            } catch (dbError) {
                // Wenn die Datenbankabfrage fehlschlägt, einfach leer antworten
                await interaction.respond([]).catch(() => {});
                return;
            }

            if (!panels || panels.length === 0) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const guild = interaction.guild;
            
            // Panels herausfiltern, deren Nachrichten nicht mehr existieren, und veraltete Daten bereinigen
            const validPanels = [];
            for (const panel of panels) {
                // Panel-Struktur validieren
                if (!panel.messageId || !panel.channelId) {
                    continue;
                }

                const channel = guild.channels.cache.get(panel.channelId);
                if (!channel) {
                    await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                    continue;
                }
                
                const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                if (!msg) {
                    await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                    continue;
                }
                validPanels.push(panel);
            }

            if (validPanels.length === 0) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const choices = await Promise.all(
                validPanels.slice(0, 25).map(async panel => {
                    try {
                        const channel = guild.channels.cache.get(panel.channelId);
                        if (!channel) return null;
                        
                        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                        if (!msg) return null;
                        
                        const title = msg?.embeds?.[0]?.title ?? 'Unbenanntes Panel';
                        const channelName = channel?.name ?? 'unbekannt';
                        
                        return {
                            name: `${title} (${channelName})`.substring(0, 100),
                            value: panel.messageId
                        };
                    } catch (e) {
                        return null;
                    }
                })
            );

            const validChoices = choices.filter(c => c !== null);
            await interaction.respond(validChoices).catch(() => {});
        } catch (error) {
            await interaction.respond([]).catch(() => {});
        }
    }
};

// ─── Setup Subcommand ─────────────────────────────────────────────────────────

async function handleSetup(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;
    
    logger.info(`Reaction role setup initiated by ${interaction.user.tag} in guild ${interaction.guild.name}`);
    
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    
    // Kanaltyp validieren
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        throw createError(
            `Ungültiger Kanaltyp: ${channel.type}`,
            ErrorTypes.VALIDATION,
            'Bitte wähle einen Text- oder Ankündigungskanal aus.',
            { channelType: channel.type }
        );
    }
    
    // Bot-Berechtigungen prüfen
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            'Bot fehlt die Berechtigung "Rollen verwalten"',
            ErrorTypes.PERMISSION,
            'Ich benötige die Berechtigung "Rollen verwalten", um Reaktionsrollen einzurichten.',
            { permission: 'ManageRoles' }
        );
    }
    
    if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        throw createError(
            `Bot kann keine Nachrichten in ${channel.name} senden`,
            ErrorTypes.PERMISSION,
            `Ich habe keine Berechtigung, Nachrichten in ${channel} zu senden.`,
            { channelId: channel.id }
        );
    }

    // Prüfen, ob der Server das Limit von maximal 5 Panels erreicht hat
    const existingPanels = await getAllReactionRoleMessages(interaction.client, interaction.guildId);
    if (existingPanels && existingPanels.length >= 5) {
        throw createError(
            'Panel-Limit erreicht',
            ErrorTypes.VALIDATION,
            'Dein Server hat das Maximum von 5 Reaktionsrollen-Panels erreicht. Lösche ein bestehendes Panel, um ein neues zu erstellen.',
            { maxPanels: 5, currentPanels: existingPanels.length }
        );
    }
    
    // Rollen sammeln und validieren
    const roles = [];
    const roleValidationErrors = [];
    
    for (let i = 1; i <= 5; i++) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) {
            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                roleValidationErrors.push(`**${role.name}** - Die Rolle meines Bots ist in der Rollenhierarchie deines Servers niedriger platziert als diese Rolle und kann sie daher nicht zuweisen`);
                continue;
            }
            
            if (hasDangerousPermissions(role)) {
                roleValidationErrors.push(`**${role.name}** - Diese Rolle besitzt gefährliche Berechtigungen (Administrator, Server verwalten, etc.)`);
                continue;
            }
            
            if (role.managed) {
                roleValidationErrors.push(`**${role.name}** - Dies ist eine verwaltete Rolle (Integrations-/Bot-Rolle)`);
                continue;
            }
            
            if (role.id === interaction.guild.id) {
                roleValidationErrors.push(`**${role.name}** - Die @everyone-Rolle kann nicht verwendet werden`);
                continue;
            }
            
            roles.push(role);
        }
    }
    
    if (roleValidationErrors.length > 0) {
        const errorMsg = `Die folgenden Rollen können nicht hinzugefügt werden:\n${roleValidationErrors.join('\n')}`;
        
        if (roles.length === 0) {
            throw createError(
                'Keine gültigen Rollen angegeben',
                ErrorTypes.VALIDATION,
                errorMsg,
                { errors: roleValidationErrors }
            );
        }
        
        await interaction.followUp({
            embeds: [warningEmbed('Warnung bei der Rollenvalidierung', errorMsg)],
            ephemeral: true
        });
    }

    if (roles.length < 1) {
        throw createError(
            'Keine Rollen angegeben',
            ErrorTypes.VALIDATION,
            'Du musst mindestens eine gültige Rolle angeben.',
            {}
        );
    }

    // Reaktionsrollen-Nachricht erstellen
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Wähle deine Rollen aus')
            .setMinValues(0)
            .setMaxValues(roles.length)
            .addOptions(
                roles.map(role => ({
                    label: role.name,
                    description: `Füge die Rolle ${role.name} hinzu oder entferne sie`,
                    value: role.id,
                    emoji: '🎭'
                }))
            )
    );

    const panelEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(getColor('info'))
        .addFields({
            name: 'Verfügbare Rollen',
            value: roles.map(role => `• ${role}`).join('\n')
        })
        .setFooter({ text: 'Wähle die Rollen aus dem Dropdown-Menü unten aus' });

    const message = await channel.send({
        embeds: [panelEmbed],
        components: [row]
    });

    const roleIds = roles.map(role => role.id);
    await createReactionRoleMessage(
        interaction.client,
        interaction.guildId,
        channel.id,
        message.id,
        roleIds
    );
    
    logger.info(`Reaction role message created: ${message.id} with ${roles.length} roles by ${interaction.user.tag}`);

    try {
        await logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_CREATE,
            data: {
                description: `Reaktionsrollen-Panel erstellt von ${interaction.user.tag}`,
                userId: interaction.user.id,
                channelId: channel.id,
                fields: [
                    {
                        name: '📝 Titel',
                        value: title,
                        inline: false
                    },
                    {
                        name: '📍 Kanal',
                        value: channel.toString(),
                        inline: true
                    },
                    {
                        name: '📊 Rollen',
                        value: `${roles.length} Rollen`,
                        inline: true
                    },
                    {
                        name: '🏷️ Rollenliste',
                        value: roles.map(r => r.toString()).join(', '),
                        inline: false
                    },
                    {
                        name: '🔗 Nachrichtenklink',
                        value: message.url,
                        inline: false
                    }
                ]
            }
        });
    } catch (logError) {
        logger.warn('Failed to log reaction role creation:', logError);
    }

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Erfolgreich', `✅ Reaktionsrollen-Panel in ${channel} erstellt!\n\n${message.url}`)]
    });
}

// ─── Dashboard Subcommand ─────────────────────────────────────────────────────

async function handleDashboard(interaction, selectedPanelId) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });
    if (!deferSuccess) return;

    const guildId = interaction.guild.id;
    const guild = interaction.guild;
    const client = interaction.client;

    let panels = await getAllReactionRoleMessages(client, guildId);

    if (!panels || panels.length === 0) {
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed(
                    'Keine Panels gefunden',
                    'Es existieren noch keine Reaktionsrollen-Panels. Nutze `/reactroles setup`, um eines zu erstellen.',
                ),
            ],
        });
    }

    // Panels herausfiltern, deren Nachrichten nicht mehr existieren
    const validPanels = [];
    for (const panel of panels) {
        const channel = guild.channels.cache.get(panel.channelId);
        if (!channel) {
            await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
            continue;
        }
        
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (!msg) {
            await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
            continue;
        }
        validPanels.push(panel);
    }

    if (validPanels.length === 0) {
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed(
                    'Keine gültigen Panels gefunden',
                    'Es existieren noch keine Reaktionsrollen-Panels. Nutze `/reactroles setup`, um eines zu erstellen.',
                ),
            ],
        });
    }

    // Wenn ein Panel ausgewählt wurde, nutze es. Andernfalls wähle ein zufälliges.
    let activePanelData = null;
    if (selectedPanelId) {
        activePanelData = validPanels.find(p => p.messageId === selectedPanelId);
        if (!activePanelData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        'Panel nicht gefunden',
                        'Dieses Panel existiert nicht mehr oder wurde gelöscht.',
                    ),
                ],
            });
        }
    } else {
        // Wähle ein zufälliges Panel aus den gültigen Panels
        activePanelData = validPanels[Math.floor(Math.random() * validPanels.length)];
    }

    const discordMsg = await fetchPanelDiscordMessage(guild, activePanelData);
    await showPanelDashboard(interaction, activePanelData, discordMsg, guildId, guild);

    let rootInteraction = interaction;
    const collector = interaction.channel.createMessageComponentCollector({
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_opts_${guildId}`),
        time: 600_000,
    });

    const buttonCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_edit_text_${guildId}` ||
                i.customId === `rr_delete_${guildId}`),
        time: 600_000,
    });

    collector.on('collect', async ci => {
        try {
            if (ci.customId === `rr_opts_${guildId}`) {
                const option = ci.values[0];
                switch (option) {
                    case 'add_role':
                        await handleAddRole(ci, rootInteraction, activePanelData, guildId, guild, client);
                        break;
                    case 'remove_role':
                        await handleRemoveRole(ci, rootInteraction, activePanelData, validPanels, guildId, guild, client);
                        break;
                }
            }
        } catch (error) {
            logger.error('Error in reactroles dashboard collector:', error);
            const msg =
                error instanceof TitanBotError
                    ? error.userMessage || 'Ein Fehler ist aufgetreten.'
                    : 'Ein unerwarteter Fehler ist aufgetreten.';
            if (!ci.replied && !ci.deferred) await ci.deferUpdate().catch(() => {});
            await ci
                .followUp({ embeds: [errorEmbed('Fehler', msg)], flags: MessageFlags.Ephemeral })
                .catch(() => {});
        }
    });

    buttonCollector.on('collect', async btnInteraction => {
        try {
            if (btnInteraction.customId === `rr_edit_text_${guildId}`) {
                await handleEditText(btnInteraction, rootInteraction, activePanelData, guildId, guild, client);
            } else if (btnInteraction.customId === `rr_delete_${guildId}`) {
                await handleDeletePanel(btnInteraction, rootInteraction, activePanelData, validPanels, guildId, guild, client, collector, buttonCollector);
            }
        } catch (error) {
            logger.error('Error in reactroles button collector:', error);
            const msg =
                error instanceof TitanBotError
                    ? error.userMessage || 'Ein Fehler ist aufgetreten.'
                    : 'Ein unerwarteter Fehler ist aufgetreten.';
            if (!btnInteraction.replied && !btnInteraction.deferred) await btnInteraction.deferUpdate().catch(() => {});
            await btnInteraction
                .followUp({ embeds: [errorEmbed('Fehler', msg)], flags: MessageFlags.Ephemeral })
                .catch(() => {});
        }
    });

    collector.on('end', async (_, reason) => {
        buttonCollector.stop();
        if (reason === 'time') {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('⏱️ Dashboard-Zeitüberschreitung')
                .setDescription('Diese Dashboard-Sitzung wurde aufgrund von Inaktivität (10 Minuten) beendet.\n\nUm deine Reaktionsrollen weiter zu verwalten, führe bitte `/reactroles dashboard` erneut aus.')
                .setColor(getColor('warning'));
            
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [timeoutEmbed],
                components: []
            }).catch(() => {});
        }
    });
}

// ─── Discord Message Helpers ──────────────────────────────────────────────────

async function fetchPanelDiscordMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return null;
        return await channel.messages.fetch(panelData.messageId).catch(() => null);
    } catch {
        return null;
    }
}

async function rebuildLivePanelMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
        if (!msg || !msg.embeds[0]) return;

        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);

        if (roleObjects.length === 0) return;

        const currentEmbed = msg.embeds[0];
        const updatedEmbed = EmbedBuilder.from(currentEmbed);
        const fields = currentEmbed.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const roleFieldIdx = fields.findIndex(f => f.name === 'Verfügbare Rollen');
        const newRoleValue = roleObjects.map(r => `• ${r}`).join('\n');
        if (roleFieldIdx !== -1) {
            fields[roleFieldIdx] = { name: 'Verfügbare Rollen', value: newRoleValue, inline: false };
        } else {
            fields.push({ name: 'Verfügbare Rollen', value: newRoleValue, inline: false });
        }
        updatedEmbed.setFields(fields);

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('reaction_roles')
                .setPlaceholder('Wähle deine Rollen aus')
                .setMinValues(0)
                .setMaxValues(roleObjects.length)
                .addOptions(
                    roleObjects.map(r => ({
                        label: r.name.substring(0, 100),
                        description: `Füge die Rolle ${r.name} hinzu oder entferne sie`.substring(0, 100),
                        value: r.id,
                        emoji: '🎭',
                    })),
                ),
        );

        await msg.edit({ embeds: [updatedEmbed], components: [selectRow] });
    } catch (error) {
        logger.warn('Could not rebuild live reaction role panel:', error.message);
    }
}

// ─── View Builders ────────────────────────────────────────────────────────────

async function showPanelDashboard(interaction, panelData, discordMsg, guildId, guild) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const title = discordMsg?.embeds?.[0]?.title ?? 'Unbenanntes Panel';
    const roleList =
        panelData.roles.length > 0
            ? panelData.roles.map(id => `<@&${id}>`).join(', ')
            : '`Keine`';

    const embed = new EmbedBuilder()
        .setTitle('🎭 Reaktionsrollen-Dashboard')
        .setDescription(
            `**Titel:** ${title}\n\nWähle unten eine Option aus, um eine Einstellung zu ändern.${discordMsg ? `\n[Klicke hier, um das Panel anzuzeigen](${discordMsg.url})` : ''}`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '📍 Kanal', value: channel ? `<#${channel.id}>` : '`Nicht gefunden`', inline: true },
            { name: '🎭 Rollen', value: `\`${panelData.roles.length} / 25\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🏷️ Rollenliste', value: roleList, inline: false },
        )
        .setFooter({ text: 'Das Dashboard schließt sich nach 10 Minuten Inaktivität' })
        .setTimestamp();

    const editTextButton = new ButtonBuilder()
        .setCustomId(`rr_edit_text_${guildId}`)
        .setLabel('Panel-Text bearbeiten')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️');

    const deleteButton = new ButtonBuilder()
        .setCustomId(`rr_delete_${guildId}`)
        .setLabel('Panel löschen')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');

    const optionsSelect = new StringSelectMenuBuilder()
        .setCustomId(`rr_opts_${guildId}`)
        .setPlaceholder('Wähle eine Aktion...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Rolle hinzufügen')
                .setDescription('Füge diesem Panel eine Rolle hinzu (bis zu insgesamt 25)')
                .setValue('add_role')
                .setEmoji('➕'),
            ...(panelData.roles.length > 0 ? [
                new StringSelectMenuOptionBuilder()
                    .setLabel('Rolle entfernen')
                    .setDescription('Entferne eine Rolle von diesem Panel')
                    .setValue('remove_role')
                    .setEmoji('➖')
            ] : [])
        );

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(editTextButton, deleteButton),
            new ActionRowBuilder().addComponents(optionsSelect),
        ],
    });
}

// ─── Edit Panel Text ──────────────────────────────────────────────────────────

async function handleEditText(buttonInteraction, rootInteraction, panelData, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;

    const currentTitle = discordMsg?.embeds?.[0]?.title ?? '';
    const currentDesc = discordMsg?.embeds?.[0]?.description ?? '';

    const modal = new ModalBuilder()
        .setCustomId('rr_edit_text')
        .setTitle('Panel-Text bearbeiten')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_title')
                    .setLabel('Titel')
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTitle)
                    .setMaxLength(256)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_description')
                    .setLabel('Beschreibung')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentDesc)
                    .setMaxLength(2048)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await buttonInteraction.showModal(modal);
    } catch (error) {
        logger.error('Error showing edit text modal:', error);
        await buttonInteraction.followUp({
            embeds: [errorEmbed('Fehler', 'Das Modal zum Bearbeiten des Panel-Textes konnte nicht angezeigt werden. Bitte versuche es erneut.')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'rr_edit_text' && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newTitle = submitted.fields.getTextInputValue('panel_title').trim();
    const newDesc = submitted.fields.getTextInputValue('panel_description').trim();

    if (discordMsg) {
        const updatedEmbed = EmbedBuilder.from(discordMsg.embeds[0]).setTitle(newTitle).setDescription(newDesc);
        await discordMsg.edit({ embeds: [updatedEmbed] }).catch(err => {
            logger.warn('Could not edit live panel message:', err.message);
        });
    }

    await submitted.reply({
        embeds: [successEmbed('✅ Panel aktualisiert', 'Der Titel und die Beschreibung wurden erfolgreich aktualisiert.')],
        flags: MessageFlags.Ephemeral,
    });

    const refreshedMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    await showPanelDashboard(rootInteraction, panelData, refreshedMsg, guildId, guild);
}

// ─── Add Role ─────────────────────────────────────────────────────────────────

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    if (panelData.roles.length >= 25) {
        await selectInteraction.followUp({
            embeds: [errorEmbed('Panel voll', 'Dieses Panel hat bereits das Maximum von 25 Rollen erreicht.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_add_role_pick')
        .setPlaceholder('Wähle eine Rolle zum Hinzufügen aus...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Rolle hinzufügen')
                .setDescription(
                    `**Aktuelle Rollen:** ${panelData.roles.length}/25\n\nWähle eine Rolle aus, die du diesem Panel hinzufügen möchtest.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_add_role_pick',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (panelData.roles.includes(role.id)) {
            await roleInteraction.followUp({
                embeds: [errorEmbed('Bereits hinzugefügt', `${role} befindet sich bereits in diesem Panel.`)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (role.id === guild.id) {
            await roleInteraction.followUp({
                embeds: [errorEmbed('Ungültige Rolle', 'Du kannst @everyone nicht verwenden.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (role.managed) {
            await roleInteraction.followUp({
                embeds: [errorEmbed('Ungültige Rolle', 'Verwaltete Rollen oder Bot-Rollen können nicht verwendet werden.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (hasDangerousPermissions(role)) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Gefährliche Berechtigungen',
                        'Diese Rolle besitzt sensible Berechtigungen (Administrator, Server verwalten, etc.) und kann nicht verwendet werden.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (role.position >= guild.members.me.roles.highest.position) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Rolle zu hoch platziert',
                        'Diese Rolle befindet sich in der Hierarchie über meiner höchsten Rolle. Verschiebe die Rolle meines Bots zuerst über diese Rolle.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        panelData.roles.push(role.id);
        const key = `reaction_roles:${guildId}:${panelDat
