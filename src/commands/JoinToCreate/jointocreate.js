import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, LabelBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    initializeJoinToCreate,
    getChannelConfiguration,
    updateChannelConfig,
    removeTriggerChannel,
    hasManageGuildPermission,
    logConfigurationChange,
    getConfiguration
} from '../../services/joinToCreateService.js';


export default {
    data: new SlashCommandBuilder()
        .setName("jointocreate")
        .setDescription("Verwalte das Join-to-Create-Talkkanal-System.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription("Richte einen neuen Join-to-Create-Talkkanal ein.")
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription("Kategorie, in der der Kanal erstellt werden soll.")
                        .addChannelTypes(ChannelType.GuildCategory)
                )
                .addStringOption((option) =>
                    option
                        .setName("channel_name")
                        .setDescription("Wähle eine Namensvorlage für die temporären Talkkanäle.")
                        .addChoices(
                            { name: "Raum von {username} (Standard)", value: "{username}'s Room" },
                            { name: "Kanal von {username}", value: "{username}'s Channel" },
                            { name: "Lounge von {username}", value: "{username}'s Lounge" },
                            { name: "Bereich von {username}", value: "{username}'s Space" },
                            { name: "Raum von {displayName}", value: "{displayName}'s Room" },
                            { name: "Talk von {username}", value: "{username}'s VC" },
                            { name: "🎵 Musikzimmer von {username}", value: "🎵 {username}'s Music Room" },
                            { name: "🎮 Gamingbude von {username}", value: "🎮 {username}'s Gaming Room" },
                            { name: "💬 Plauderecke von {username}", value: "💬 {username}'s Chat Room" },
                            { name: "🔒 Privatraum von {username}", value: "{username}'s Private Room" }
                        )
                )
                .addIntegerOption((option) =>
                    option
                        .setName("user_limit")
                        .setDescription("Maximale Anzahl an Nutzern in temporären Kanälen. (0 = unbegrenzt)")
                )
                .addIntegerOption((option) =>
                    option
                        .setName("bitrate")
                        .setDescription("Bitrate für temporäre Kanäle in kbps (8-96).")
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Konfiguriere ein bestehendes Join-to-Create-System.")
                .addChannelOption((option) =>
                    option
                        .setName("trigger_channel")
                        .setDescription("Der Join-to-Create-Erstellungskanal, der konfiguriert werden soll.")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildVoice)
                )
        ),
    category: "utility",

    async execute(interaction, config, client) {
        try {
            
            if (!hasManageGuildPermission(interaction.member)) {
                throw new TitanBotError(
                    'User lacks ManageGuild permission',
                    ErrorTypes.PERMISSION,
                    'Du benötigst die Berechtigung **Server verwalten**, um diesen Befehl zu nutzen.'
                );
            }

            const subcommand = interaction.options.getSubcommand();
            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            let responseEmbed;

            if (subcommand === "setup") {
                await handleSetupSubcommand(interaction, client);
                return;
            } else if (subcommand === "dashboard") {
                await handleConfigSubcommand(interaction, client);
                return;
            }

        } catch (error) {
            try {
                let errorMessage = 'Beim Ausführen dieses Befehls ist ein Fehler aufgetreten.';
                
                if (error instanceof TitanBotError) {
                    errorMessage = error.userMessage || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.';
                    logger.debug(`TitanBotError [${error.type}]: ${error.message}`, error.context || {});
                } else {
                    logger.error('Unexpected error in jointocreate command:', error);
                    errorMessage = 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später noch einmal oder kontaktiere den Support.';
                }

                const errorEmbedObj = errorEmbed("⚠️ Fehler", errorMessage);

                if (interaction.deferred) {
                    return await InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbedObj] });
                } else {
                    return await InteractionHelper.safeReply(interaction, { embeds: [errorEmbedObj], flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                logger.error('Failed to send error message:', replyError);
            }
        }
    }
};

async function handleSetupSubcommand(interaction, client) {
    try {
        const category = interaction.options.getChannel('category');
        const nameTemplate = interaction.options.getString('channel_name') || "{username}'s Room";
        const userLimit = interaction.options.getInteger('user_limit') || 0;
        const bitrate = interaction.options.getInteger('bitrate') || 64;
        const guildId = interaction.guild.id;

        logger.debug(`Setting up Join to Create in guild ${guildId} with template: ${nameTemplate}`);

        // Check if guild already has a Join to Create channel configured
        const existingConfig = await getConfiguration(client, guildId);
        
        if (Array.isArray(existingConfig.triggerChannels) && existingConfig.triggerChannels.length > 0) {
            const activeTriggerChannels = [];
            const staleTriggerChannelIds = [];

            for (const existingChannelId of existingConfig.triggerChannels) {
                const existingChannel = await interaction.guild.channels.fetch(existingChannelId).catch(() => null);
                if (existingChannel) {
                    activeTriggerChannels.push(existingChannel);
                } else {
                    staleTriggerChannelIds.push(existingChannelId);
                }
            }

            if (staleTriggerChannelIds.length > 0) {
                for (const staleChannelId of staleTriggerChannelIds) {
                    logger.info(`Cleaning up stale JTC trigger ${staleChannelId} from guild ${guildId}`);
                    await removeTriggerChannel(client, guildId, staleChannelId);
                }
            }

            if (activeTriggerChannels.length > 0) {
                const primaryTrigger = activeTriggerChannels[0];
                const errorMessage = `Dieser Server hat bereits einen aktiven Join-to-Create-Kanal eingerichtet: ${primaryTrigger}\n\nNutze \`/jointocreate dashboard\`, um ihn zu bearbeiten, oder lösche ihn zuerst, bevor du einen neuen erstellst.`;

                throw new TitanBotError(
                    'Guild already has a Join to Create channel',
                    ErrorTypes.VALIDATION,
                    errorMessage,
                    {
                        guildId,
                        activeTriggerCount: activeTriggerChannels.length,
                        expected: true,
                        suppressErrorLog: true
                    }
                );
            }
        }

        // Create the trigger channel
        logger.debug('Creating Join to Create trigger channel...');
        let triggerChannel = await interaction.guild.channels.create({
            name: '➕ Kanal erstellen',
            type: ChannelType.GuildVoice,
            parent: category?.id,
            userLimit: 0,
            bitrate: 64000,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                },
            ],
        });

        logger.debug(`Created trigger channel ${triggerChannel.id}, initializing config...`);

        // Initialize the Join to Create configuration
        const config = await initializeJoinToCreate(client, guildId, triggerChannel.id, {
            nameTemplate: nameTemplate,
            userLimit: userLimit,
            bitrate: bitrate * 1000,
            categoryId: category?.id
        });

        await logConfigurationChange(client, guildId, interaction.user.id, 'Initialized Join to Create', {
            channelId: triggerChannel.id,
            nameTemplate,
            userLimit,
            bitrate
        });

        logger.info(`Successfully created Join to Create system in guild ${guildId}`);

        const responseEmbed = successEmbed(
            '✅ Einrichtung abgeschlossen',
            `Join-to-Create-Kanal wurde erfolgreich erstellt: ${triggerChannel}\n\n` +
            `**Einstellungen:**\n` +
            `• Vorlage: \`${nameTemplate}\`\n` +
            `• Benutzerlimit: ${userLimit === 0 ? 'Unbegrenzt' : userLimit + ' Nutzer'}\n` +
            `• Bitrate: ${bitrate} kbps\n` +
            `${category ? `• Kategorie: ${category.name}` : '• Kategorie: Hauptebene (Keine)'}`
        );

        return await InteractionHelper.safeEditReply(interaction, { embeds: [responseEmbed] });

    } catch (error) {
        logger.error('Error in handleSetupSubcommand:', error);
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Setup failed: ${error.message}`,
            ErrorTypes.DISCORD_API,
            'Fehler beim Einrichten des Join-to-Create-Systems. Bitte überprüfe die Berechtigungen des Bots.'
        );
    }
}

async function handleConfigSubcommand(interaction, client) {
    try {
        const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        // Validate that the channel is actually a Join to Create trigger
        const currentConfig = await getChannelConfiguration(client, guildId, triggerChannel.id);
        const channelConfig = currentConfig.channelConfig || {};

        
        const configEmbed = new EmbedBuilder()
            .setTitle('⚙️ Join-to-Create Konfiguration')
            .setDescription(`Einstellungen für ${triggerChannel}`)
            .setColor(getColor('info'))
            .addFields(
                {
                    name: '📝 Kanalnamens-Vorlage',
                    value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate || "{username}'s Room"}\``,
                    inline: false
                },
                {
                    name: '👥 Benutzerlimit',
                    value: `${(channelConfig.userLimit ?? currentConfig.userLimit ?? 0) === 0 ? 'Unbegrenzt' : (channelConfig.userLimit ?? currentConfig.userLimit ?? 0) + ' Nutzer'}`,
                    inline: true
                },
                {
                    name: '🎵 Bitrate',
                    value: `${(channelConfig.bitrate ?? currentConfig.bitrate ?? 64000) / 1000} kbps`,
                    inline: true
                }
            )
            .setFooter({ text: 'Nutze die Buttons unten, um Einstellungen zu ändern • Pro Server wird ein Erstellungskanal unterstützt' })
            .setTimestamp();

        
        const nameButton = new ButtonBuilder()
            .setCustomId(`jtc_config_name_${triggerChannel.id}`)
            .setLabel('📝 Namensvorlage')
            .setStyle(ButtonStyle.Primary);

        const limitButton = new ButtonBuilder()
            .setCustomId(`jtc_config_limit_${triggerChannel.id}`)
            .setLabel('👥 Benutzerlimit')
            .setStyle(ButtonStyle.Primary);

        const bitrateButton = new ButtonBuilder()
            .setCustomId(`jtc_config_bitrate_${triggerChannel.id}`)
            .setLabel('🎵 Bitrate')
            .setStyle(ButtonStyle.Primary);

        const deleteButton = new ButtonBuilder()
            .setCustomId(`jtc_config_delete_${triggerChannel.id}`)
            .setLabel('🗑️ Kanal entfernen')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(nameButton, limitButton, bitrateButton, deleteButton);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [configEmbed],
            components: [row]
        });

        const message = await interaction.fetchReply();

        if (!message || typeof message.createMessageComponentCollector !== 'function') {
            throw new TitanBotError(
                'Failed to fetch interaction reply for collector setup',
                ErrorTypes.DISCORD_API,
                'Die Konfigurationsmenüs konnten nicht geöffnet werden. Bitte führe `/jointocreate dashboard` erneut aus.'
            );
        }

        
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000
        });

        collector.on('collect', async (buttonInteraction) => {
            try {
                
                if (!hasManageGuildPermission(buttonInteraction.member)) {
                    await buttonInteraction.reply({
                        content: '❌ Du benötigst die Berechtigung **Server verwalten**, um diese Optionen zu nutzen.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const customId = buttonInteraction.customId;

                if (customId.includes('jtc_config_name_')) {
                    await handleNameTemplateModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_limit_')) {
                    await handleUserLimitModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_bitrate_')) {
                    await handleBitrateModal(buttonInteraction, triggerChannel, currentConfig, client);
                } else if (customId.includes('jtc_config_delete_')) {
                    await handleChannelDeletion(buttonInteraction, triggerChannel, currentConfig, client);
                }
            } catch (error) {
                const userMessage = error instanceof TitanBotError
                    ? error.userMessage || 'Ein Fehler ist aufgetreten.'
                    : 'Ein Fehler ist beim Verarbeiten der Anfrage aufgetreten.';

                if (error instanceof TitanBotError) {
                    logger.debug(`Button interaction validation error: ${error.message}`, error.context || {});
                } else {
                    logger.error('Unexpected error in config button interaction:', error);
                }

                await buttonInteraction.reply({
                    content: `❌ ${userMessage}`,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                nameButton.setDisabled(true),
                limitButton.setDisabled(true),
                bitrateButton.setDisabled(true),
                deleteButton.setDisabled(true)
            );

            message.edit({
                components: [disabledRow],
                embeds: [configEmbed.setFooter({ text: 'Die Konfigurationssitzung ist abgelaufen. Führe den Befehl erneut aus, um Änderungen vorzunehmen.' })]
            }).catch(() => {});
        });

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Config failed: ${error.message}`,
            ErrorTypes.DATABASE,
            'Die Konfiguration konnte nicht geladen werden.'
        );
    }
}

async function handleNameTemplateModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const TEMPLATE_OPTIONS = [
            { label: "Raum von {username} (Standard)", value: "{username}'s Room" },
            { label: "Kanal von {username}",         value: "{username}'s Channel" },
            { label: "Lounge von {username}",         value: "{username}'s Lounge" },
            { label: "Bereich von {username}",          value: "{username}'s Space" },
            { label: "Raum von {displayName}",        value: "{displayName}'s Room" },
            { label: "Talk von {username}",             value: "{username}'s VC" },
            { label: "🎵 Musikzimmer von {username}",  value: "🎵 {username}'s Music Room" },
            { label: "🎮 Gamingbude von {username}", value: "🎮 {username}'s Gaming Room" },
            { label: "💬 Plauderecke von {username}",   value: "💬 {username}'s Chat Room" },
            { label: "🔒 Privatraum von {username}",   value: "{username}'s Private Room" },
        ];

        const currentTemplate = currentConfig.channelConfig?.nameTemplate
            || currentConfig.channelNameTemplate
            || "{username}'s Room";

        const templateSelect = new StringSelectMenuBuilder()
            .setCustomId('template')
            .setPlaceholder('Wähle eine Namensvorlage...')
            .setOptions(
                TEMPLATE_OPTIONS.map(o => ({
                    label: o.label,
                    value: o.value,
                    default: o.value === currentTemplate,
                })),
            );

        const templateLabel = new LabelBuilder()
            .setLabel('Kanalnamens-Vorlage')
            .setStringSelectMenuComponent(templateSelect);

        const modal = new ModalBuilder()
            .setCustomId(`jtc_name_modal_${triggerChannel.id}`)
            .setTitle('Kanalnamens-Vorlage')
            .addLabelComponents(templateLabel);

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_name_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        // Recheck permissions
        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du benötigst die Berechtigung **Server verwalten**, um diese Einstellungen zu ändern.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const [newTemplate] = modalSubmission.fields.getStringSelectValues('template');

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            nameTemplate: newTemplate
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Updated channel name template', {
            channelId: triggerChannel.id,
            newTemplate
        });

        await modalSubmission.reply({
            embeds: [successEmbed('✅ Aktualisiert', `Die Kanalnamens-Vorlage wurde zu \`${newTemplate}\` geändert.`)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Unexpected error in name template modal:', error);
        throw new TitanBotError(
            `Modal error: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Beim Aktualisieren der Vorlage ist ein Fehler aufgetreten.'
        );
    }
}

async function handleUserLimitModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const currentLimit = currentConfig.channelConfig.userLimit ?? currentConfig.userLimit ?? 0;

        const modal = new ModalBuilder()
            .setCustomId(`jtc_limit_modal_${triggerChannel.id}`)
            .setTitle('Benutzerlimit konfigurieren')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('user_limit')
                        .setLabel('Benutzerlimit eingeben (0-99, 0 = unbegrenzt)')
                        .setPlaceholder('Gib eine Zahl zwischen 0 und 99 ein')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(2)
                        .setValue(currentLimit.toString())
                )
            );

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_limit_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        // Recheck permissions
        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du benötigst die Berechtigung **Server verwalten**, um diese Einstellungen zu ändern.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userInput = modalSubmission.fields.getTextInputValue('user_limit').trim();

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            userLimit: parseInt(userInput)
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Updated user limit', {
            channelId: triggerChannel.id,
            userLimit: parseInt(userInput)
        });

        await modalSubmission.reply({
            embeds: [successEmbed('✅ Aktualisiert', `Das Benutzerlimit wurde auf ${parseInt(userInput) === 0 ? 'Unbegrenzt' : parseInt(userInput) + ' Nutzer'} geändert.`)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Unexpected error in user limit modal:', error);
        throw new TitanBotError(
            `Modal error: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Beim Aktualisieren des Benutzerlimits ist ein Fehler aufgetreten.'
        );
    }
}

async function handleBitrateModal(interaction, triggerChannel, currentConfig, client) {
    try {
        const currentBitrate = ((currentConfig.channelConfig.bitrate ?? currentConfig.bitrate ?? 64000) / 1000);

        const modal = new ModalBuilder()
            .setCustomId(`jtc_bitrate_modal_${triggerChannel.id}`)
            .setTitle('Bitrate konfigurieren')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bitrate')
                        .setLabel('Bitrate in kbps eingeben (8-384)')
                        .setPlaceholder('Gib eine Zahl zwischen 8 und 384 ein')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(3)
                        .setValue(currentBitrate.toString())
                )
            );

        await interaction.showModal(modal);

        const modalSubmission = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === `jtc_bitrate_modal_${triggerChannel.id}` && i.user.id === interaction.user.id,
            time: 60000
        });

        // Recheck permissions
        if (!hasManageGuildPermission(modalSubmission.member)) {
            await modalSubmission.reply({
                content: '❌ Du benötigst die Berechtigung **Server verwalten**, um diese Einstellungen zu ändern.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userInput = modalSubmission.fields.getTextInputValue('bitrate').trim();

        await updateChannelConfig(client, interaction.guild.id, triggerChannel.id, {
            bitrate: parseInt(userInput) * 1000
        });

        await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Updated bitrate', {
            channelId: triggerChannel.id,
            bitrate: parseInt(userInput)
        });

        await modalSubmission.reply({
            embeds: [successEmbed('✅ Aktualisiert', `Die Bitrate wurde auf ${parseInt(userInput)} kbps geändert.`)],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return;
        }
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Unexpected error in bitrate modal:', error);
        throw new TitanBotError(
            `Modal error: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Beim Aktualisieren der Bitrate ist ein Fehler aufgetreten.'
        );
    }
}


async function handleChannelDeletion(interaction, triggerChannel, currentConfig, client) {
    try {
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`jtc_delete_confirm_${triggerChannel.id}`)
                .setLabel('🗑️ Ja, entfernen')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`jtc_delete_cancel_${triggerChannel.id}`)
                .setLabel('❌ Abbrechen')
                .setStyle(ButtonStyle.Secondary)
        );

        await InteractionHelper.safeReply(interaction, {
            embeds: [errorEmbed('⚠️ Entfernen bestätigen', `Bist du sicher, dass du **${triggerChannel.name}** aus dem Join-to-Create-System entfernen möchtest?\n\nDiese Aktion kann nicht rückgängig gemacht werden.`)],
            components: [confirmRow],
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const deleteCollector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i) => i.user.id === interaction.user.id && 
                          (i.customId === `jtc_delete_confirm_${triggerChannel.id}` || 
                           i.customId === `jtc_delete_cancel_${triggerChannel.id}`),
            time: 600_000,
            max: 1
        });

        deleteCollector.on('collect', async (buttonInteraction) => {
            try {
                // Recheck permissions
                if (!hasManageGuildPermission(buttonInteraction.member)) {
                    await buttonInteraction.reply({
                        content: '❌ Du benötigst die Berechtigung **Server verwalten**, um Kanäle zu entfernen.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (buttonInteraction.customId === `jtc_delete_confirm_${triggerChannel.id}`) {
                    
                    await removeTriggerChannel(client, interaction.guild.id, triggerChannel.id);

                    
                    await logConfigurationChange(client, interaction.guild.id, interaction.user.id, 'Removed Join to Create trigger', {
                        channelId: triggerChannel.id,
                        channelName: triggerChannel.name
                    });

                    
                    try {
                        if (triggerChannel.members.size === 0) {
                            await triggerChannel.delete('Join to Create trigger removed by administrator');
                        }
                    } catch (deleteError) {
                        logger.warn(`Could not delete channel ${triggerChannel.id}: ${deleteError.message}`);
                        
                    }

                    await buttonInteraction.update({
                        embeds: [successEmbed('✅ Entfernt', `**${triggerChannel.name}** wurde erfolgreich aus dem Join-to-Create-System gelöscht.`)],
                        components: []
                    });

                } else {
                    await buttonInteraction.update({
                        embeds: [successEmbed('✅ Abgebrochen', 'Das Entfernen des Kanals wurde abgebrochen.')],
                        components: []
                    });
                }
            } catch (collectError) {
                logger.error('Error handling delete confirmation:', collectError);
                await buttonInteraction.reply({
                    content: '❌ Ein Fehler ist beim Verarbeiten der Anfrage aufgetreten.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        });

        deleteCollector.on('end', (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                message.edit({ components: [] }).catch(() => {});
            }
        });

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        logger.error('Unexpected error in handleChannelDeletion:', error);
        throw new TitanBotError(
            `Deletion error: ${error.message}`,
            ErrorTypes.UNKNOWN,
            'Beim Löschen des Kanals ist ein Fehler aufgetreten.'
        );
    }
}
