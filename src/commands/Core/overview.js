import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getLoggingStatus } from '../../services/loggingService.js';
import { getLevelingConfig } from '../../services/leveling.js';
import { getConfiguration as getJoinToCreateConfiguration } from '../../services/joinToCreateService.js';
import { getWelcomeConfig, getApplicationSettings } from '../../utils/database.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function pill(enabled) {
    return enabled ? '✅ An' : '❌ Aus';
}

async function formatChannelMention(guild, id) {
    if (!id) return '`Nicht konfiguriert`';
    const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
    return channel ? channel.toString() : `⚠️ Fehlt (${id})`;
}

function formatRoleMention(guild, id) {
    if (!id) return '`Nicht konfiguriert`';
    const role = guild.roles.cache.get(id);
    return role ? role.toString() : `⚠️ Fehlt (${id})`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('overview')
        .setDescription('Schreibgeschützter Schnappschuss aller Serversystem-Status.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const [guildConfig, loggingStatus, levelingConfig, welcomeConfig, applicationConfig, joinToCreateConfig] =
                await Promise.all([
                    getGuildConfig(client, interaction.guildId),
                    getLoggingStatus(client, interaction.guildId),
                    getLevelingConfig(client, interaction.guildId),
                    getWelcomeConfig(client, interaction.guildId),
                    getApplicationSettings(client, interaction.guildId),
                    getJoinToCreateConfiguration(client, interaction.guildId),
                ]);

            const verificationEnabled = Boolean(guildConfig.verification?.enabled);
            const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
            const autoRoleId = guildConfig.autoRole || welcomeConfig?.roleIds?.[0];

            // ── Kanäle ──────────────────────────────────────────────────────
            const [auditChannel, lifecycleChannel, transcriptChannel, reportChannel, birthdayChannel] =
                await Promise.all([
                    formatChannelMention(interaction.guild, loggingStatus.channelId || guildConfig.logging?.channelId || guildConfig.logChannelId),
                    formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId),
                    formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId),
                    formatChannelMention(interaction.guild, guildConfig.reportChannelId),
                    formatChannelMention(interaction.guild, guildConfig.birthdayChannelId),
                ]);

            const embed = new EmbedBuilder()
                .setTitle('🖥️ Systemübersicht')
                .setDescription(`Schreibgeschützter Schnappschuss für **${interaction.guild.name}**. Nutze das Dashboard des jeweiligen Befehls, um Änderungen vorzunehmen.`)
                .setColor(getColor('primary'))
                .addFields(
                    // ── Kernsysteme ──
                    {
                        name: '⚙️ Kernsysteme',
                        value: [
                            `🧾 **Audit-Protokoll** — ${pill(Boolean(loggingStatus.enabled))}`,
                            `📈 **Level-System** — ${pill(Boolean(levelingConfig?.enabled))}`,
                            `👋 **Willkommen** — ${pill(Boolean(welcomeConfig?.enabled))}`,
                            `👋 **Abschied** — ${pill(Boolean(welcomeConfig?.goodbyeEnabled))}`,
                            `🎂 **Geburtstage** — ${pill(Boolean(guildConfig.birthdayChannelId))}`,
                            `📋 **Bewerbungen** — ${pill(Boolean(applicationConfig?.enabled))}`,
                            `✅ **Verifizierung** — ${pill(verificationEnabled)}`,
                            `🤖 **Auto-Verifizierung** — ${pill(autoVerifyEnabled)}`,
                            `🎧 **Join to Create** — ${pill(Boolean(joinToCreateConfig?.enabled))}`,
                            `🛡️ **Auto-Rolle** — ${autoRoleId ? `✅ ${formatRoleMention(interaction.guild, autoRoleId)}` : '❌ Aus'}`,
                        ].join('\n'),
                        inline: false,
                    },
                    // ── Kanäle ──
                    {
                        name: '📡 Konfigurierte Kanäle',
                        value: [
                            `**Audit-Log:** ${auditChannel}`,
                            `**Ticket-Lebenszyklus:** ${lifecycleChannel}`,
                            `**Ticket-Transkripte:** ${transcriptChannel}`,
                            `**Meldungen:** ${reportChannel}`,
                            `**Geburtstage:** ${birthdayChannel}`,
                        ].join('\n'),
                        inline: false,
                    },
                    // ── Zeitstempel ──
                    {
                        name: '🕒 Erstellter Schnappschuss',
                        value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                        inline: true,
                    },
                )
                .setFooter({ text: 'Schreibgeschützt — Führe /logging dashboard aus, um die Audit-Einstellungen zu verwalten' })
                .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('overview command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Übersichtsfehler', 'Die Systemübersicht konnte nicht geladen werden.')],
            });
        }
    },
};
