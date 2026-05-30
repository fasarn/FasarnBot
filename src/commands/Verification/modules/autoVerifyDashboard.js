import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { getWelcomeConfig } from '../../../utils/database.js';
import { validateAutoVerifyCriteria } from '../../../services/verificationService.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

const autoVerifyDefaults = botConfig.verification?.autoVerify || {};
const minAccountAgeDays = autoVerifyDefaults.minAccountAge ?? 1;
const maxAccountAgeDays = autoVerifyDefaults.maxAccountAge ?? 365;
const defaultAccountAgeDays = autoVerifyDefaults.defaultAccountAgeDays ?? 7;

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild, conflictSummary = '') {
    const autoVerify = cfg.verification?.autoVerify;
    const autoVerifyRole = autoVerify?.roleId ? guild.roles.cache.get(autoVerify.roleId) : null;
    
    let criteriaDescription = "`Nicht konfiguriert`";
    if (autoVerify?.criteria) {
        switch (autoVerify.criteria) {
            case "account_age":
                criteriaDescription = `\`Kontoalter\` - \`${autoVerify.accountAgeDays} Tage\``;
                break;
            case "none":
                criteriaDescription = `\`Keine Kriterien\``;
                break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('🤖 Auto-Verifizierungs-Dashboard')
        .setDescription(`Verwalte die Einstellungen für die automatische Verifizierung auf **${guild.name}**.\nWähle unten eine Option aus, um eine Einstellung zu ändern.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '⚙️ Systemstatus', value: autoVerify?.enabled ? '✅ Aktiviert' : '❌ Deaktiviert', inline: true },
            { name: '🏷️ Zielrolle', value: autoVerifyRole ? autoVerifyRole.toString() : '`Nicht zugewiesen`', inline: true },
            { name: '🎯 Kriterien', value: criteriaDescription, inline: true },
            { name: '📅 Kontoalter', value: autoVerify?.accountAgeDays ? `\`${autoVerify.accountAgeDays}\` Tage` : '`N/A`', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
        );

    if (conflictSummary) {
        embed.addFields({ name: '⚠️ Setup-Konflikte', value: conflictSummary, inline: false });
    }

    return embed
        .setFooter({ text: 'Das Dashboard schließt sich nach 10 Minuten Inaktivität' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`autoverify_cfg_${guildId}`)
        .setPlaceholder('Wähle eine Einstellung zum Konfigurieren...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Rolle ändern')
                .setDescription('Wähle die Rolle, die automatisch zugewiesen werden soll')
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Kontoalter (Tage) bearbeiten')
                .setDescription('Mindestkontoalter in Tagen festlegen')
                .setValue('account_age')
                .setEmoji('📅'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const autoVerifyOn = cfg.verification?.autoVerify?.enabled === true;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_criteria_${guildId}`)
            .setLabel('Kriterien ändern')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_toggle_${guildId}`)
            .setLabel('Auto-Verifizierung')
            .setStyle(autoVerifyOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🤖')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const selectMenu = buildSelectMenu(guildId);
        
        // Get conflict summary
        let conflictSummary = '';
        try {
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const verificationEnabled = Boolean(cfg.verification?.enabled);
            const autoRoleConfigConfigured = Boolean(cfg.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                verificationEnabled ? 'Verifizierungssystem ist aktiviert' : null,
                autoRoleConfigConfigured ? 'AutoRole ist konfiguriert' : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, conflictSummary)],
            components: [
                buildButtonRow(cfg, guildId),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh autoverify dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            // Check if auto-verification is configured
            if (!guildConfig.verification?.autoVerify?.enabled) {
                // Check for blocking systems
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const blockingMessage = [];
                if (verificationEnabled) blockingMessage.push('Verifizierungssystem ist aktiviert');
                if (autoRoleConfigured) blockingMessage.push('AutoRole ist konfiguriert');

                const blockingText = blockingMessage.length > 0 
                    ? `\n\n⚠️ **Um AutoVerify zu aktivieren, musst du zuerst folgendes deaktivieren:**\n${blockingMessage.map(msg => `• ${msg}`).join('\n')}`
                    : '';

                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🤖 Auto-Verifizierungs-Dashboard')
                            .setDescription(`Die automatische Verifizierung ist noch nicht konfiguriert.${blockingText}\n\nNutze \`/autoverify setup\`, um sie einzurichten.`)
                            .setColor(getColor('warning'))
                            .setFooter({ text: 'Das Dashboard schließt sich nach 10 Minuten Inaktivität' })
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const selectMenu = buildSelectMenu(guildId);
            
            // Get conflict summary
            let conflictSummary = '';
            try {
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    verificationEnabled ? 'Verifizierungssystem ist aktiviert' : null,
                    autoRoleConfigured ? 'AutoRole ist konfiguriert' : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild, conflictSummary)],
                components: [
                    buildButtonRow(guildConfig, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            // ── Select collector ──────────────────────────────────────────────
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `autoverify_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'role':
                            await handleRole(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'account_age':
                            await handleAccountAge(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Autoverify config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected autoverify dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Ein Fehler ist beim Verarbeiten deiner Auswahl aufgetreten.'
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

            // ── Button collector for buttons ─────────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id && 
                    (i.customId === `autoverify_cfg_toggle_${guildId}` || i.customId === `autoverify_cfg_criteria_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === `autoverify_cfg_criteria_${guildId}`) {
                        await handleCriteria(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `autoverify_cfg_toggle_${guildId}`) {
                        await btnInteraction.deferUpdate().catch(() => null);
                        guildConfig.verification.autoVerify.enabled = !guildConfig.verification.autoVerify.enabled;
                        await setGuildConfig(client, guildId, guildConfig);
                        
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    '✅ Status aktualisiert',
                                    `Die automatische Verifizierung ist jetzt **${guildConfig.verification.autoVerify.enabled ? 'aktiviert' : 'deaktiviert'}**.`,
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, guildConfig, guildId, client);
                    }
                } catch (err) {
                    logger.debug('Button interaction error:', err.message);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle('⏰ Dashboard abgelaufen')
                            .setDescription('Dieses Dashboard wurde aufgrund von Inaktivität geschlossen. Bitte führe den Befehl erneut aus, um fortzufahren.')
                            .setColor(getColor('error'));
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [timeoutEmbed],
                            components: [],
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        logger.debug('Could not update dashboard on timeout:', error.message);
                    }
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in autoverify_dashboard:', error);
            throw new TitanBotError(
                `Auto-verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Das Auto-Verifizierungs-Dashboard konnte nicht geöffnet werden.',
            );
        }
    },
};

// ─── Handle Criteria ──────────────────────────────────────────────────────────

async function handleCriteria(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    // Defer the interaction if it's a button, otherwise it was already deferred by select menu
    if (!selectInteraction.deferred) {
        await selectInteraction.deferUpdate().catch(() => null);
    }
    
    const criteriaEmbed = new EmbedBuilder()
        .setTitle('🎯 Verifizierungskriterien auswählen')
        .setDescription('Wähle das Kriterium für die automatische Verifizierung aus')
        .setColor(getColor('info'));

    const criteriaMenu = new StringSelectMenuBuilder()
        .setCustomId('autoverify_criteria_select')
        .setPlaceholder('Kriterium auswählen...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Kontoalter (älter als ${defaultAccountAgeDays} Tage)`)
                .setDescription('Benutzer mit älteren Konten werden automatisch verifiziert')
                .setValue('account_age'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Keine Kriterien (jeden verifizieren)')
                .setDescription('Alle Benutzer erhalten die Rolle sofort')
                .setValue('none'),
        );

    await selectInteraction.followUp({
        embeds: [criteriaEmbed],
        components: [new ActionRowBuilder().addComponents(criteriaMenu)],
        flags: MessageFlags.Ephemeral,
    });

    const criteriaCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_criteria_select',
        time: 60_000,
        max: 1,
    });

    criteriaCollector.on('collect', async criteriaInteraction => {
        await criteriaInteraction.deferUpdate();
        const newCriteria = criteriaInteraction.values[0];

        guildConfig.verification.autoVerify.criteria = newCriteria;
        
        // Reset age-related fields if not using them
        if (newCriteria !== 'account_age') {
            guildConfig.verification.autoVerify.accountAgeDays = null;
        } else if (!guildConfig.verification.autoVerify.accountAgeDays) {
            guildConfig.verification.autoVerify.accountAgeDays = defaultAccountAgeDays;
        }

        await setGuildConfig(client, guildId, guildConfig);

        let criteriaDisplay = '';
        switch (newCriteria) {
            case 'account_age':
                criteriaDisplay = `Kontoalter (${guildConfig.verification.autoVerify.accountAgeDays} Tage)`;
                break;
            case 'none':
                criteriaDisplay = 'Keine Kriterien';
                break;
        }

        await criteriaInteraction.followUp({
            embeds: [successEmbed('✅ Kriterien aktualisiert', `Das Auto-Verifizierungskriterium wurde auf **${criteriaDisplay}** geändert.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    criteriaCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Zeitüberschreitung', 'Es wurde kein Kriterium ausgewählt. Die Einstellung wurde nicht geändert.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Handle Role ──────────────────────────────────────────────────────────────

async function handleRole(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('autoverify_role_select')
        .setPlaceholder('Rolle auswählen...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🏷️ Auto-Verifizierungsrolle')
                .setDescription('Wähle die Rolle aus, die automatisch verifizierten Benutzern zugewiesen werden soll.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_role_select',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (role.id === rootInteraction.guild.id || role.managed) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Ungültige Rolle',
                        'Bitte wähle eine normale, zuweisbare Rolle (nicht @everyone oder eine von einem Bot verwaltete Rolle).',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const botMember = rootInteraction.guild.members.me;
        if (role.position >= botMember.roles.highest.position) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Rolle zu hoch',
                        'Die ausgewählte Rolle muss in der Server-Rollenhierarchie unter meiner höchsten Rolle liegen.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        guildConfig.verification.autoVerify.roleId = role.id;
        await setGuildConfig(client, guildId, guildConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Rolle aktualisiert', `Die Auto-Verifizierungsrolle wurde auf ${role} gesetzt.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Zeitüberschreitung', 'Es wurde keine Rolle ausgewählt. Die Einstellung wurde nicht geändert.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Handle Account Age ────────────────────────────────────────────────────────

async function handleAccountAge(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('autoverify_account_age_modal')
        .setTitle('Kontoalter-Anforderung festlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('age_input')
                    .setLabel('Mindestkontoalter (Tage)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`Zwischen ${minAccountAgeDays} und ${maxAccountAgeDays}`)
                    .setValue((guildConfig.verification.autoVerify.accountAgeDays || defaultAccountAgeDays).toString())
                    .setRequired(true),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'autoverify_account_age_modal' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const inputValue = submitted.fields.getTextInputValue('age_input').trim();
    const days = parseInt(inputValue, 10);

    if (isNaN(days) || days < minAccountAgeDays || days > maxAccountAgeDays) {
        await submitted.reply({
            embeds: [errorEmbed('Ungültige Eingabe', `Bitte gib eine Zahl zwischen ${minAccountAgeDays} und ${maxAccountAgeDays} ein.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    guildConfig.verification.autoVerify.accountAgeDays = days;
    await setGuildConfig(client, guildId, guildConfig);

    await submitted.reply({
        embeds: [successEmbed('✅ Kontoalter aktualisiert', `Die Mindestanforderung für das Kontoalter wurde auf **${days} Tage** gesetzt.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId, client);
}

// ─── Handle Member Duration ────────────────────────────────────────────────────
