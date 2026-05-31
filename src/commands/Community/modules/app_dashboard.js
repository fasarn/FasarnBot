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
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    LabelBuilder,
    CheckboxBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { safeDeferInteraction } from '../../../utils/interactionValidator.js';
import {
    getApplicationSettings,
    saveApplicationSettings,
    getApplicationRoles,
    saveApplicationRoles,
    getApplicationRoleSettings,
    saveApplicationRoleSettings,
    deleteApplicationRoleSettings,
    getApplications,
    deleteApplication,
} from '../../../utils/database.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(settings, roles, guild) {
    const logChannel = settings.logChannelId ? `<#${settings.logChannelId}>` : '`Nicht eingerichtet`';
    const managerRoleList =
        settings.managerRoles?.length > 0
            ? settings.managerRoles.map(id => `<@&${id}>`).join(', ')
            : '`Keine konfiguriert`';
    const roleList =
        roles.length > 0
            ? roles.map(r => `<@&${r.roleId}> — ${r.name}`).join('\n')
            : '`Keine Bewerbungsrollen konfiguriert`';
    const questionCount = settings.questions?.length ?? 0;
    const firstQ =
        settings.questions?.[0]
            ? `\`${settings.questions[0].length > 55 ? settings.questions[0].substring(0, 55) + '…' : settings.questions[0]}\``
            : '`Nicht eingerichtet`';

    return new EmbedBuilder()
        .setTitle('📋 Bewerbungs-Dashboard')
        .setDescription(`Verwalte die Bewerbungseinstellungen für **${guild.name}**.\nWähle unten eine Option aus, um eine Einstellung zu ändern.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '⚙️ Bewerbungsstatus', value: settings.enabled ? '✅ Aktiviert' : '❌ Deaktiviert', inline: true },
            { name: '📢 Log-Kanal', value: logChannel, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🛡️ Manager-Rollen', value: managerRoleList, inline: false },
            { name: '📝 Fragen', value: `${questionCount} konfiguriert — Erste: ${firstQ}`, inline: false },
            { name: '🎭 Bewerbungsrollen', value: roleList, inline: false },
            {
                name: '🗑️ Aufbewahrungsfrist',
                value: `Offen: **${settings.pendingApplicationRetentionDays ?? 30} Tage** · Bearbeitet: **${settings.reviewedApplicationRetentionDays ?? 14} Tage**`,
                inline: false,
            },
        )
        .setFooter({ text: 'Dashboard schließt sich nach 15 Minuten Inaktivität' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`app_cfg_${guildId}`)
        .setPlaceholder('Wähle eine Einstellung zum Konfigurieren...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Log-Kanal')
                .setDescription('Lege den Kanal fest, in dem neue Bewerbungen geloggt werden')
                .setValue('log_channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Manager-Rollen')
                .setDescription('Füge eine Rolle hinzu oder entferne sie, die Bewerbungen verwalten darf')
                .setValue('manager_role')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Fragen bearbeiten')
                .setDescription('Passe die Fragen an, die im Bewerbungsformular angezeigt werden')
                .setValue('questions')
                .setEmoji('📝'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Bewerbungsrolle hinzufügen')
                .setDescription('Füge eine Rolle hinzu, für die sich Mitglieder bewerben können')
                .setValue('role_add')
                .setEmoji('➕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Bewerbungsrolle entfernen')
                .setDescription('Entferne eine Rolle aus der Bewerbungsliste')
                .setValue('role_remove')
                .setEmoji('➖'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Aufbewahrungsfrist')
                .setDescription('Lege fest, wie lange offene und bearbeitete Bewerbungen gespeichert werden')
                .setValue('retention')
                .setEmoji('🗑️'),
        );
}

function buildButtonRow(settings, guildId, disabled = false) {
    const systemOn = settings.enabled === true;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_cfg_toggle_${guildId}`)
            .setLabel('Bewerbungssystem')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, settings, roles, guildId) {
    const selectMenu = buildSelectMenu(guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(settings, roles, rootInteraction.guild)],
        components: [
            buildButtonRow(settings, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client, selectedAppName = null) {
        try {
            const guildId = interaction.guild.id;

            // Sofort deferren, um einen Discord-Interaktionstimeout zu verhindern
            await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });

            const [settings, roles] = await Promise.all([
                getApplicationSettings(client, guildId),
                getApplicationRoles(client, guildId),
            ]);

            // Überprüfen, ob das Bewerbungssystem komplett unkonfiguriert ist
            const isCompletelyUnconfigured = 
                !settings.logChannelId && 
                !settings.enabled && 
                (settings.managerRoles?.length ?? 0) === 0 && 
                roles.length === 0;

            if (isCompletelyUnconfigured) {
                throw new TitanBotError(
                    'Bewerbungssystem nicht eingerichtet',
                    ErrorTypes.CONFIGURATION,
                    'Das Bewerbungssystem wurde noch nicht konfiguriert. Bitte führe `/app-admin setup` aus, um deine erste Bewerbung zu erstellen.',
                );
            }

            // Wenn keine Bewerbungsrollen existieren, zeige das globale Dashboard an, um eine hinzuzufügen
            if (roles.length === 0) {
                await showGlobalDashboard(interaction, settings, roles, guildId, client);
                return;
            }

            // Wenn eine bestimmte App via Autocomplete ausgewählt wurde, zeige direkt deren Dashboard
            if (selectedAppName) {
                const selectedRole = roles.find(r => r.name.toLowerCase() === selectedAppName.toLowerCase());
                if (selectedRole) {
                    await showApplicationDashboard(interaction, selectedRole, settings, roles, guildId, client);
                    return;
                }
                // Wenn der Name nicht übereinstimmt, fahre fort
            }

            // Standard: Erste Bewerbung anzeigen, wenn keine Auswahl getroffen wurde
            const defaultRole = roles[0];
            await showApplicationDashboard(interaction, defaultRole, settings, roles, guildId, client);

        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unerwarteter Fehler im app_dashboard:', error);
            throw new TitanBotError(
                `Bewerbungs-Dashboard fehlgeschlagen: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Das Bewerbungs-Dashboard konnte nicht geöffnet werden.',
            );
        }
    },
};

// ─── Application Selector (for multiple applications) ──────────────────────────

async function showApplicationSelector(interaction, roles, settings, guildId, client) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`app_select_${guildId}`)
        .setPlaceholder('Wähle eine Bewerbung zum Konfigurieren...')
        .addOptions(
            roles.map(role =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(role.name)
                    .setDescription(`Konfiguriere die Bewerbung für ${role.name}`)
                    .setValue(role.roleId)
                    .setEmoji('📋'),
            ),
        );

    const embed = new EmbedBuilder()
        .setTitle('🎯 Bewerbung auswählen')
        .setDescription('Wähle aus, welche Bewerbungsrolle du konfigurieren möchtest.')
        .setColor(getColor('info'));

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu)],
    });

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === interaction.user.id && i.customId === `app_select_${guildId}`,
        time: 600_000,
        max: 1,
    });

    collector.on('collect', async selectInteraction => {
        const deferred = await safeDeferInteraction(selectInteraction);
        if (!deferred) return;
        
        const selectedRoleId = selectInteraction.values[0];
        const selectedRole = roles.find(r => r.roleId === selectedRoleId);

        if (selectedRole) {
            await showApplicationDashboard(interaction, selectedRole, settings, roles, guildId, client);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Zeitüberschreitung', 'Es wurde keine Auswahl getroffen. Das Dashboard wurde geschlossen.')],
                components: [],
            }).catch(() => {});
        }
    });
}

// ─── Global Dashboard ──────────────────────────────────────────────────────────

async function showGlobalDashboard(interaction, settings, roles, guildId, client) {
    const selectMenu = buildSelectMenu(guildId);

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildDashboardEmbed(settings, roles, interaction.guild)],
        components: [
            buildButtonRow(settings, guildId),
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    });

    setupCollectors(interaction, settings, roles, guildId, client, null);
}

// ─── Application-Specific Dashboard ────────────────────────────────────────────

async function showApplicationDashboard(rootInteraction, selectedRole, settings, roles, guildId, client) {
    const roleObj = rootInteraction.guild.roles.cache.get(selectedRole.roleId);
    
    // Bewerbungsspezifische Einstellungen abrufen
    const appSettings = await getApplicationRoleSettings(client, guildId, selectedRole.roleId);
    const questions = appSettings.questions || settings.questions || [];
    const appLogChannelId = appSettings.logChannelId || settings.logChannelId;
    const isEnabled = selectedRole.enabled !== false; // Standardmäßig true, wenn nicht angegeben

    // Umfassendes Embed bauen
    const logChannelDisplay = appLogChannelId 
        ? `<#${appLogChannelId}>` 
        : '`Erbt globalen Log-Kanal`';
    
    const questionsDisplay = questions.length > 0
        ? questions.map((q, i) => `${i + 1}. \`${q.length > 60 ? q.substring(0, 60) + '…' : q}\``).join('\n')
        : '`Erbt globale Fragen`';
    
    const managerRolesDisplay = settings.managerRoles && settings.managerRoles.length > 0
        ? settings.managerRoles.map(id => `<@&${id}>`).join(', ')
        : '`Keine konfiguriert`';

    const embed = new EmbedBuilder()
        .setTitle('🎭 Bewerbungs-Dashboard')
        .setDescription(`Konfiguration für **${selectedRole.name}**`)
        .setColor(isEnabled ? getColor('success') : getColor('error'))
        .addFields(
            { 
                name: '🎭 Rolle', 
                value: roleObj ? roleObj.toString() : `<@&${selectedRole.roleId}>`, 
                inline: true 
            },
            { 
                name: '⚙️ Bewerbungsstatus', 
                value: isEnabled ? '✅ **Aktiviert**' : '❌ **Deaktiviert**', 
                inline: true 
            },
            { name: '\u200B', value: '\u200B', inline: true },
            { 
                name: '📝 Fragen', 
                value: questionsDisplay,
                inline: false 
            },
            { 
                name: '📢 Log-Kanal', 
                value: logChannelDisplay,
                inline: true 
            },
            { 
                name: '🛡️ Manager-Rollen',
                value: managerRolesDisplay,
                inline: true 
            },
            { 
                name: '🗑️ Aufbewahrungsfrist',
                value: `Offen: **${settings.pendingApplicationRetentionDays ?? 30} Tage** · Bearbeitet: **${settings.reviewedApplicationRetentionDays ?? 14} Tage**`,
                inline: false 
            },
        )
        .setFooter({ text: 'Dashboard schließt sich nach 10 Minuten Inaktivität' })
        .setTimestamp();

    // Dropdown-Menü mit Anpassungsoptionen erstellen
    const configMenu = buildApplicationSelectMenu(guildId, selectedRole.roleId);

    // Kontroll-Buttons erstellen
    const controlButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_toggle_${selectedRole.roleId}`)
            .setLabel(isEnabled ? 'Bewerbung deaktivieren' : 'Bewerbung aktivieren')
            .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`app_delete_${selectedRole.roleId}`)
            .setLabel('Bewerbung löschen')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
    );

    const menuRow = new ActionRowBuilder().addComponents(configMenu);

    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [embed],
        components: [menuRow, controlButtons],
    });

    setupCollectors(rootInteraction, settings, roles, guildId, client, selectedRole.roleId);
}

// ─── Collector Setup ──────────────────────────────────────────────────────────

function setupCollectors(interaction, settings, roles, guildId, client, selectedRoleId) {
    const customIdPrefix = selectedRoleId ? `app_cfg_${selectedRoleId}` : `app_cfg_${guildId}`;
    
    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === interaction.user.id && 
            (selectedRoleId 
                ? i.customId === customIdPrefix
                : (i.customId === `app_cfg_${guildId}` || i.customId === `app_select_${guildId}`)),
        time: 600_000,
    });

    collector.on('collect', async selectInteraction => {
        const selectedOption = selectInteraction.values[0];
        try {
            // Abgelaufene Interaktionen abfangen
            if (!selectInteraction.isStringSelectMenu()) {
                return;
            }
            switch (selectedOption) {
                case 'log_channel':
                    await handleLogChannel(selectInteraction, interaction, settings, roles, guildId, client, selectedRoleId);
                    break;
                case 'manager_role':
                    await handleManagerRole(selectInteraction, interaction, settings, roles, guildId, client, selectedRoleId);
                    break;
                case 'questions':
                    await handleQuestions(selectInteraction, interaction, settings, roles, guildId, client, selectedRoleId);
                    break;
                case 'role_add':
                    await handleRoleAdd(selectInteraction, interaction, settings, roles, guildId, client);
                    break;
                case 'role_remove':
                    await handleRoleRemove(selectInteraction, interaction, settings, roles, guildId, client);
                    break;
                case 'retention':
                    await handleRetention(selectInteraction, interaction, settings, roles, guildId, client, selectedRoleId);
                    break;
            }
        } catch (error) {
            if (error instanceof TitanBotError) {
                logger.debug(`Bewerbungskonfiguration Validierungsfehler: ${error.message}`);
            } else {
                logger.error('Unerwarteter Fehler im Bewerbungs-Dashboard:', error);
            }

            const errorMessage =
                error instanceof TitanBotError
                    ? error.userMessage || 'Ein Fehler ist bei der Verarbeitung deiner Auswahl aufgetreten.'
                    : 'Ein unerwarteter Fehler ist beim Aktualisieren der Konfiguration aufgetreten.';

            if (!selectInteraction.replied && !selectInteraction.deferred) {
                await safeDeferInteraction(selectInteraction);
            }

            await selectInteraction
                .followUp({
                    embeds: [errorEmbed('Konfigurationsfehler', errorMessage)],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('\u23f0 Dashboard abgelaufen')
                .setDescription('Dieses Dashboard wurde wegen Inaktivität geschlossen. Bitte führe den Befehl erneut aus, um fortzufahren.')
                .setColor(getColor('error'));
                
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [timeoutEmbed],
                components: [],
            }).catch(() => {});
        }
    });

    // ── Global Toggle Button Collector ──────────────────────────────────────────
    if (!selectedRoleId) {
        const globalToggleCollector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === interaction.user.id &&
                i.customId === `app_cfg_toggle_${guildId}`,
            time: 600_000,
        });

        globalToggleCollector.on('collect', async toggleInteraction => {
            const deferred = await safeDeferInteraction(toggleInteraction);
            if (!deferred) return;
            
            try {
                const wasEnabled = settings.enabled === true;
                settings.enabled = !wasEnabled;

                // Aktualisierte Einstellungen speichern
                await saveApplicationSettings(interaction.client, guildId, settings);

                // Dashboard aktualisieren, um neuen Status anzuzeigen
                const updatedSettings = await getApplicationSettings(interaction.client, guildId);
                const updatedRoles = await getApplicationRoles(interaction.client, guildId);
                await showGlobalDashboard(interaction, updatedSettings, updatedRoles, guildId, interaction.client);

                await toggleInteraction.followUp({
                    embeds: [successEmbed(
                        wasEnabled ? '🔴 Bewerbungen deaktiviert' : '🟢 Bewerbungen aktiviert',
                        `Das Bewerbungssystem ist jetzt **${wasEnabled ? 'deaktiviert' : 'aktiviert'}**.\n\n${
                            wasEnabled 
                                ? 'Mitglieder können sich ab jetzt nicht mehr für Rollen bewerben.' 
                                : 'Mitglieder können ab jetzt Bewerbungen für Rollen einreichen.'
                        }`,
                    )],
                    flags: MessageFlags.Ephemeral,
                });

            } catch (error) {
                logger.error('Fehler beim Umschalten des globalen Bewerbungsstatus:', error);
                await toggleInteraction.followUp({
                    embeds: [errorEmbed('Fehler', 'Ein Fehler ist beim Umschalten des Bewerbungsstatus aufgetreten.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
        });

        globalToggleCollector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle('⏱️ Konfigurations-Timeout')
                    .setDescription('Diese Dashboard-Sitzung ist wegen Inaktivität abgelaufen (10 Minuten).\n\nUm deine Bewerbungen weiter zu konfigurieren, führe den Befehl bitte erneut aus.')
                    .setColor(getColor('warning'));
                    
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [timeoutEmbed],
                    components: [],
                }).catch(() => {});
            }
        });
    }

    // ── Delete Button Collector (for application-specific dashboard) ──────────────
    if (selectedRoleId) {
        const btnCollector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === interaction.user.id &&
                i.customId === `app_delete_${selectedRoleId}`,
            time: 600_000,
        });

        btnCollector.on('collect', async btnInteraction => {
            // Bestätigungs-Modal anzeigen
            const appRoleForDelete = roles.find(r => r.roleId === selectedRoleId);
            const appNameForDelete = appRoleForDelete?.name ?? 'diese Bewerbung';

            const confirmModal = new ModalBuilder()
                .setCustomId('app_delete_confirm')
                .setTitle('Bewerbung löschen bestätigen');

            const deleteWarningText = new TextDisplayBuilder()
                .setContent(`⚠️ Du bist im Begriff, die Bewerbung für **${appNameForDelete}** unwiderruflich zu löschen. Alle gespeicherten Bewerbungen und Einstellungen für diese Rolle werden entfernt und können nicht wiederhergestellt werden.`);

            const deleteCheckbox = new CheckboxBuilder()
                .setCustomId('confirm_delete')
                .setDefault(false);

            const deleteCheckboxLabel = new LabelBuilder()
                .setLabel('Ich bestätige — dies kann nicht rückgängig gemacht werden')
                .setCheckboxComponent(deleteCheckbox);

            confirmModal
                .addTextDisplayComponents(deleteWarningText)
                .addLabelComponents(deleteCheckboxLabel);

            try {
                await btnInteraction.showModal(confirmModal);
            } catch (error) {
                logger.error('Fehler beim Anzeigen des Lösch-Bestätigungs-Modals:', error);
                await btnInteraction.followUp({
                    embeds: [errorEmbed('Fehler', 'Das Bestätigungs-Modal konnte nicht angezeigt werden. Bitte versuche es erneut.')],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }

            try {
                const confirmSubmit = await btnInteraction.awaitModalSubmit({
                    time: 60_000,
                    filter: i =>
                        i.customId === 'app_delete_confirm' && i.user.id === btnInteraction.user.id,
                }).catch(() => null);

                if (!confirmSubmit) {
                    await btnInteraction.followUp({
                        embeds: [errorEmbed('Abgebrochen', 'Das Löschen der Bewerbung wurde abgebrochen.')],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const confirmed = confirmSubmit.fields.getCheckbox('confirm_delete');
                if (!confirmed) {
                    await confirmSubmit.reply({
                        embeds: [errorEmbed('Nicht bestätigt', 'Du musst das Kontrollkästchen aktivieren, um die Bewerbung zu löschen.')],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                // Bewerbung löschen
                await handleDeleteApplication(confirmSubmit, selectedRoleId, guildId, roles, client);
                collector.stop();
                btnCollector.stop();

            } catch (error) {
                logger.error('Fehler bei der Bestätigung des Bewerbungslöschens:', error);
                await btnInteraction.followUp({
                    embeds: [errorEmbed('Fehler', 'Ein Fehler ist beim Löschen der Bewerbung aufgetreten.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
        });

        btnCollector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle('⏱️ Konfigurations-Timeout')
                    .setDescription('Diese Dashboard-Sitzung ist wegen Inaktivität abgelaufen (10 Minuten).\n\nUm deine Bewerbungen weiter zu konfigurieren, führe den Befehl bitte erneut aus.')
                    .setColor(getColor('warning'));
                    
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [timeoutEmbed],
                    components: [],
                }).catch(() => {});
            }
        });

        // ── Toggle Enable/Disable Button Collector ──────────────────────────────
        const toggleCollector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === interaction.user.id &&
                i.customId === `app_toggle_${selectedRoleId}`,
            time: 900_000,
        });

        toggleCollector.on('collect', async toggleInteraction => {
            const deferred = await safeDeferInteraction(toggleInteraction);
            if (!deferred) return;
            
            try {
                // Rolle finden und Status umschalten
                const roleIndex = roles.findIndex(r => r.roleId === selectedRoleId);
                if (roleIndex === -1) {
                    await toggleInteraction.followUp({
                        embeds: [errorEmbed('Nicht gefunden', 'Bewerbungsrolle wurde nicht gefunden.')],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const wasEnabled = roles[roleIndex].enabled !== false;
                roles[roleIndex].enabled = !wasEnabled;

                // Aktualisierte Rollen speichern
                await saveApplicationRoles(interaction.client, guildId, roles);

                // Dashboard aktualisieren, um neuen Status anzuzeigen
                const updatedRole = roles[roleIndex];
                const updatedSettings = await getApplicationSettings(interaction.client, guildId);
                await showApplicationDashboard(interaction, updatedRole, updatedSettings, roles, guildId, interaction.client);

                await toggleInteraction.followUp({
                    embeds: [successEmbed(
                        wasEnabled ? '🔴 Bewerbung deaktiviert' : '🟢 Bewerbung aktiviert',
                        `Die Bewerbung für **${updatedRole.name}** ist jetzt **${wasEnabled ? 'deaktiviert' : 'aktiviert'}**.\n\n${
                            wasEnabled 
                                ? 'Diese Bewerbung wird nicht mehr bei den Optionen von `/bewerben absenden` angezeigt.' 
                                : 'Diese Bewerbung wird ab jetzt bei den Optionen von `/bewerben absenden` angezeigt.'
                        }`,
                    )],
                    flags: MessageFlags.Ephemeral,
                });

            } catch (error) {
                logger.error('Fehler beim Umschalten des Bewerbungsstatus:', error);
                await toggleInteraction.followUp({
                    embeds: [errorEmbed('Fehler', 'Ein Fehler ist beim Umschalten des Bewerbungsstatus aufgetreten.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
        });

        toggleCollector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const timeoutEmbed = new EmbedBuilder()
                    .setTitle('⏱️ Konfigurations-Timeout')
                    .setDescription('Diese Dashboard-Sitzung ist wegen Inaktivität abgelaufen (10 Minuten).\n\nUm deine Bewerbungen weiter zu konfigurieren, führe den Befehl bitte erneut aus.')
                    .setColor(getColor('warning'));
                    
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [timeoutEmbed],
                    components: [],
                }).catch(() => {});
            }
        });
    }
}

// ─── Build Select Menus ────────────────────────────────────────────────────────

function buildApplicationSelectMenu(guildId, roleId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`app_cfg_${roleId}`)
        .setPlaceholder('Wähle eine Einstellung zum Konfigurieren...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Log-Kanal')
                .setDescription('Lege den Kanal fest, in dem Bewerbungen geloggt werden')
                .setValue('log_channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Manager-Rollen')
                .setDescription('Füge eine Rolle hinzu oder entferne sie, die Bewerbungen verwalten darf')
                .setValue('manager_role')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Fragen bearbeiten')
                .setDescription('Passe die Fragen an, die im Bewerbungsformular angezeigt werden')
                .setValue('questions')
                .setEmoji('📝'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Aufbewahrungsfrist')
                .setDescription('Lege fest, wie lange offene und bearbeitete Bewerbungen gespeichert werden')
                .setValue('retention')
                .setEmoji('🗑️'),
        );
}

// ─── Log Channel ──────────────────────────────────────────────────────────────

async function handleLogChannel(selectInteraction, rootInteraction, settings, roles, guildId, client, selectedRoleId) {
    let currentChannel = settings.logChannelId;
    if (selectedRoleId) {
        const roleSettings = await getApplicationRoleSettings(client, guildId, selectedRoleId);
        currentChannel = roleSettings.logChannelId || settings.logChannelId;
    }

    const modal = new ModalBuilder()
        .setCustomId(`app_cfg_log_channel_modal_${guildId}_${selectedRoleId || 'global'}`)
        .setTitle('📢 Log-Kanal konfigurieren');

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('log_channel')
        .setPlaceholder('Wähle einen Textkanal aus...')
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true);

    const channelLabel = new LabelBuilder()
        .setLabel('Log-Kanal')
        .setDescription('Kanal, in dem neue Bewerbungen geloggt werden')
        .setChannelSelectMenuComponent(channelSelect);

    modal.addLabelComponents(channelLabel);

    await selectInteraction.showModal(modal);

    try {
        const modalSubmission = await selectInteraction.awaitModalSubmit({
            time: 5 * 60 * 1000,
            filter: i => i.user.id === selectInteraction.user.id && i.customId === `app_cfg_log_channel_modal_${guildId}_${selectedRoleId || 'global'}`,
        });

        const channelId = modalSubmission.fields.getField('log_channel').values[0];
        const channel = selectInteraction.guild.channels.cache
