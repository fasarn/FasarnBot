import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { 
    getJoinToCreateConfig, 
    updateJoinToCreateConfig,
    removeJoinToCreateTrigger,
    addJoinToCreateTrigger
} from '../../../utils/database.js';

export default {
    async execute(interaction, config, client) {
        try {
            const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        const currentConfig = await getJoinToCreateConfig(client, guildId);

        if (!currentConfig.triggerChannels.includes(triggerChannel.id)) {
            throw new TitanBotError(
                `Channel ${triggerChannel.id} is not a Join to Create trigger`,
                ErrorTypes.VALIDATION,
                `${triggerChannel} ist nicht als „Join to Create“-Trigger-Kanal konfiguriert.`
            );
        }

        const embed = new EmbedBuilder()
            .setTitle('⚙️ „Join to Create“-Konfiguration')
            .setDescription(`Einstellungen für ${triggerChannel} konfigurieren`)
            .setColor(getColor('info'))
            .addFields(
                {
                    name: '📝 Aktuelle Namensvorlage',
                    value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                    inline: false
                },
                {
                    name: '👥 Aktuelles Benutzerlimit',
                    value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Kein Limit' : currentConfig.userLimit + ' Benutzer'}`,
                    inline: true
                },
                {
                    name: '🎵 Aktuelle Bitrate',
                    value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                    inline: true
                }
            )
            .setFooter({ text: 'Wähle unten eine Option zum Konfigurieren' })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`jointocreate_config_${triggerChannel.id}`)
            .setPlaceholder('Wähle eine Konfigurationsoption')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Kanal-Namensvorlage ändern')
                    .setDescription('Ändere die Vorlage für temporäre Kanalnamen')
                    .setValue('name_template'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Benutzerlimit ändern')
                    .setDescription('Maximal zulässige Benutzer pro temporärem Kanal festlegen')
                    .setValue('user_limit'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Bitrate ändern')
                    .setDescription('Audioqualität für temporäre Kanäle anpassen')
                    .setValue('bitrate'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Diesen Trigger-Kanal entfernen')
                    .setDescription('Entfernt diesen Kanal aus dem „Join to Create“-System')
                    .setValue('remove_trigger'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Aktuelle Einstellungen anzeigen')
                    .setDescription('Zeigt alle aktuellen Konfigurationsdetails an')
                    .setValue('view_settings')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: [row],
        }).catch(error => {
            logger.error('Failed to edit reply in config_setup:', error);
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id && i.customId === `jointocreate_config_${triggerChannel.id}`,
            time: 60000
        });

        collector.on('collect', async (selectInteraction) => {
            await selectInteraction.deferUpdate();

            const selectedOption = selectInteraction.values[0];

            try {
                switch (selectedOption) {
                    case 'name_template':
                        await handleNameTemplateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'user_limit':
                        await handleUserLimitChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'bitrate':
                        await handleBitrateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'remove_trigger':
                        await handleRemoveTrigger(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'view_settings':
                        await handleViewSettings(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Configuration validation error: ${error.message}`, error.context || {});
                } else {
                    logger.error('Unexpected configuration menu error:', error);
                }
                
                const errorMessage = error instanceof TitanBotError 
                    ? error.userMessage || 'Beim Verarbeiten deiner Auswahl ist ein Fehler aufgetreten.'
                    : 'Beim Verarbeiten deiner Auswahl ist ein Fehler aufgetreten.';
                    
                await selectInteraction.followUp({
                    embeds: [errorEmbed('Konfigurationsfehler', errorMessage)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    selectMenu.setDisabled(true)
                );
                
                await InteractionHelper.safeEditReply(interaction, {
                    components: [disabledRow],
                }).catch(() => {});
            }
        });
            } catch (error) {
            if (error instanceof TitanBotError) {
                throw error;
            }
            logger.error('Unexpected error in config_setup:', error);
            throw new TitanBotError(
                `Config setup failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Fehler beim Konfigurieren des „Join to Create“-Systems.'
            );
        }
    }
};

async function handleNameTemplateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('📝 Konfiguration der Kanal-Namensvorlage')
        .setDescription('Bitte gib die neue Namensvorlage für den Kanal ein.')
        .addFields(
            {
                name: 'Verfügbare Variablen',
                value: '• `{username}` - Benutzername\n• `{display_name}` - Anzeigename\n• `{user_tag}` - Discord-Tag (User#1234)\n• `{guild_name}` - Servername',
                inline: false
            },
            {
                name: 'Aktuelle Vorlage',
                value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Schreibe deine neue Vorlage unten in den Chat' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id,
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newTemplate = message.content.trim();
            
            if (!newTemplate || newTemplate.length > 100) {
                await interaction.followUp({
                    embeds: [errorEmbed('Ungültige Vorlage', 'Die Vorlage muss zwischen 1 und 100 Zeichen lang sein.')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                nameTemplate: newTemplate
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('✅ Vorlage aktualisiert', `Die Kanal-Namensvorlage wurde in \`${newTemplate}\` geändert.`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Template validation error: ${error.message}`);
            } else {
                logger.error('Template update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Die Kanal-Namensvorlage konnte nicht aktualisiert werden.'
                : 'Die Kanal-Namensvorlage konnte nicht aktualisiert werden.';
                
            await interaction.followUp({
                embeds: [errorEmbed('Aktualisierung fehlgeschlagen', errorMessage)],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            interaction.followUp({
                embeds: [errorEmbed('Zeitüberschreitung', 'Keine Antwort erhalten. Aktualisierung der Vorlage abgebrochen.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });
}

async function handleUserLimitChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('👥 Konfiguration des Benutzerlimits')
        .setDescription('Bitte gib das neue Benutzerlimit ein (0-99, wobei 0 = kein Limit).')
        .addFields(
            {
                name: 'Aktuelles Limit',
                value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Kein Limit' : currentConfig.userLimit + ' Benutzer'}`,
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Schreibe das neue Limit unten in den Chat' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newLimit = parseInt(message.content.trim());
            
            if (newLimit < 0 || newLimit > 99) {
                await interaction.followUp({
                    embeds: [errorEmbed('Ungültiges Limit', 'Das Benutzerlimit muss zwischen 0 und 99 liegen.')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                userLimit: newLimit
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('✅ Limit aktualisiert', `Das Benutzerlimit wurde auf ${newLimit === 0 ? 'Kein Limit' : newLimit + ' Benutzer'} geändert.`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`User limit validation error: ${error.message}`);
            } else {
                logger.error('User limit update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Das Benutzerlimit konnte nicht aktualisiert werden.'
                : 'Das Benutzerlimit konnte nicht aktualisiert werden.';
                
            await interaction.followUp({
                embeds: [errorEmbed('Aktualisierung fehlgeschlagen', errorMessage)],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            interaction.followUp({
                embeds: [errorEmbed('Zeitüberschreitung', 'Keine gültige Antwort erhalten. Aktualisierung abgebrochen.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });
}

async function handleBitrateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('🎵 Konfiguration der Bitrate')
        .setDescription('Bitte gib die neue Bitrate in kbps ein (8-384).')
        .addFields(
            {
                name: 'Aktuelle Bitrate',
                value: `${(currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: false
            },
            {
                name: 'Gängige Werte',
                value: '• 64 kbps - Normale Qualität\n• 96 kbps - Gute Qualität\n• 128 kbps - Hohe Qualität\n• 256 kbps - Sehr hohe Qualität',
                inline: false
            }
        )
        .setColor(getColor('info'))
        .setFooter({ text: 'Schreibe die neue Bitrate unten in den Chat' });

    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newBitrate = parseInt(message.content.trim());
            
            if (newBitrate < 8 || newBitrate > 384) {
                await interaction.followUp({
                    embeds: [errorEmbed('Ungültige Bitrate', 'Die Bitrate muss zwischen 8 und 384 kbps liegen.')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                bitrate: newBitrate * 1000
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                embeds: [successEmbed('✅ Bitrate aktualisiert', `Die Bitrate wurde auf ${newBitrate} kbps geändert.`)],
                flags: MessageFlags.Ephemeral,
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Bitrate validation error: ${error.message}`);
            } else {
                logger.error('Bitrate update error:', error);
            }
            
            const errorMessage = error instanceof TitanBotError
                ? error.userMessage || 'Die Bitrate konnte nicht aktualisiert werden.'
                : 'Die Bitrate konnte nicht aktualisiert werden.';
                
            await interaction.followUp({
                embeds: [errorEmbed('Aktualisierung fehlgeschlagen', errorMessage)],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            interaction.followUp({
                embeds: [errorEmbed('Zeitüberschreitung', 'Keine gültige Antwort erhalten. Aktualisierung abgebrochen.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });
}

async function handleRemoveTrigger(interaction, triggerChannel, currentConfig, client) {
    const embed = new EmbedBuilder()
        .setTitle('⚠️ Trigger-Kanal entfernen')
        .setDescription(`Bist du dir sicher, dass du ${triggerChannel} aus dem „Join to Create“-System entfernen möchtest?`)
        .setColor('#ff6600')
        .setFooter({ text: 'Diese Aktion kann nicht rückgängig gemacht werden' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_remove_${triggerChannel.id}`)
            .setLabel('Kanal entfernen')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cancel_remove_${triggerChannel.id}`)
            .setLabel('Abbrechen')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.followUp({ 
        embeds: [embed], 
        components: [row],
        flags: MessageFlags.Ephemeral 
    });

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && 
                      (i.customId === `confirm_remove_${triggerChannel.id}` || i.customId === `cancel_remove_${triggerChannel.id}`),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();

        if (buttonInteraction.customId === `confirm_remove_${triggerChannel.id}`) {
            try {
                const success = await removeJoinToCreateTrigger(client, interaction.guild.id, triggerChannel.id);
                
                if (success) {
                    await buttonInteraction.followUp({
                        embeds: [successEmbed('✅ Kanal entfernt', `${triggerChannel} wurde erfolgreich aus dem „Join to Create“-System entfernt.`)],
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await buttonInteraction.followUp({
                        embeds: [errorEmbed('Entfernen fehlgeschlagen', 'Der Trigger-Kanal konnte nicht entfernt werden.')],
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } catch (error) {
                if (error instanceof TitanBotError) {
                    logger.debug(`Trigger removal validation error: ${error.message}`);
                } else {
                    logger.error('Remove trigger error:', error);
                }
                
                const errorMessage = error instanceof TitanBotError
                    ? error.userMessage || 'Beim Entfernen des Trigger-Kanals ist ein Fehler aufgetreten.'
                    : 'Beim Entfernen des Trigger-Kanals ist ein Fehler aufgetreten.';
                    
                await buttonInteraction.followUp({
                    embeds: [errorEmbed('Entfernen fehlgeschlagen', errorMessage)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        } else {
            await buttonInteraction.followUp({
                embeds: [successEmbed('✅ Abgebrochen', 'Das Entfernen des Kanals wurde abgebrochen.')],
                flags: MessageFlags.Ephemeral,
            });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            interaction.followUp({
                embeds: [errorEmbed('Zeitüberschreitung', 'Keine Antwort erhalten. Vorgang abgebrochen.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    });
}

async function handleViewSettings(interaction, triggerChannel, currentConfig, client) {
    const channelConfig = currentConfig.channelOptions?.[triggerChannel.id] || {};
    
    const embed = new EmbedBuilder()
        .setTitle('📋 Aktuelle Einstellungen')
        .setDescription(`Konfiguration für ${triggerChannel}`)
        .setColor(getColor('info'))
        .addFields(
            {
                name: '🎯 Trigger-Kanal',
                value: `${triggerChannel} (${triggerChannel.id})`,
                inline: false
            },
            {
                name: '📝 Kanal-Namensvorlage',
                value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            },
            {
                name: '👥 Benutzerlimit',
                value: `${channelConfig.userLimit || currentConfig.userLimit === 0 ? 'Kein Limit' : (channelConfig.userLimit || currentConfig.userLimit) + ' Benutzer'}`,
                inline: true
            },
            {
                name: '🎵 Bitrate',
                value: `${(channelConfig.bitrate || currentConfig.bitrate) / 1000} kbps`,
                inline: true
            },
            {
                name: '📁 Kategorie',
                value: currentConfig.categoryId ? `<#${currentConfig.categoryId}>` : 'Nicht festgelegt',
                inline: true
            },
            {
                name: '📊 Systemstatus',
                value: currentConfig.enabled ? '✅ Aktiviert' : '❌ Deaktiviert',
                inline: true
            },
            {
                name: '🔢 Aktive temporäre Kanäle',
                value: Object.keys(currentConfig.temporaryChannels || {}).length.toString(),
                inline: true
            }
        )
        .setTimestamp();

    await interaction.followUp({ 
        embeds: [embed], 
        flags: MessageFlags.Ephemeral 
    });
}
