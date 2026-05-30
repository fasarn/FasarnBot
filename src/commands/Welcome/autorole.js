import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig } from '../../services/guildConfig.js';

function createAutoroleInfoEmbed(description) {
    return new EmbedBuilder()
        .setColor(getColor('primary'))
        .setDescription(description)
        .setFooter({ text: new Date().toLocaleString() });
}

export default {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Verwalte Rollen, die neuen Mitgliedern automatisch gegeben werden')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Füge eine Rolle hinzu, die neuen Mitgliedern automatisch gegeben wird')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Die Rolle, die hinzugefügt werden soll')
                        .setRequired(true)))

        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Entferne eine Rolle aus der automatischen Vergabe')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Die Rolle, die entfernt werden soll')
                        .setRequired(true)))

        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Zeige alle automatisch vergebenen Rollen an')),

    async execute(interaction) {

        const deferSuccess =
            await InteractionHelper.safeDefer(
                interaction
            );

        if (!deferSuccess) {

            logger.warn(
                `Autorole interaction defer failed`,
                {
                    userId:
                        interaction.user.id,

                    guildId:
                        interaction.guildId,

                    commandName:
                        'autorole'
                }
            );

            return;
        }

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )
        ) {

            return InteractionHelper.safeEditReply(
                interaction,
                {
                    embeds: [
                        errorEmbed(
                            'Fehlende Berechtigungen',
                            'Du benötigst die Berechtigung **Server verwalten**, um `/autorole` zu benutzen.'
                        )
                    ],

                    flags:
                        MessageFlags.Ephemeral
                }
            );
        }

        const {
            options,
            guild,
            client
        } = interaction;

        const subcommand =
            options.getSubcommand();

        if (
            subcommand === 'add'
        ) {

            const role =
                options.getRole(
                    'role'
                );

            const guildConfig =
                await getGuildConfig(
                    client,
                    guild.id
                );

            const verificationEnabled =
                Boolean(
                    guildConfig.verification?.enabled
                );

            const autoVerifyEnabled =
                Boolean(
                    guildConfig.verification?.autoVerify?.enabled
                );

            if (
                verificationEnabled ||
                autoVerifyEnabled
            ) {

                return InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Einrichtungskonflikt',
                                'Du kannst keine AutoRole hinzufügen, solange das Verifizierungssystem oder AutoVerify aktiviert ist. Deaktiviere diese zuerst.'
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            if (
                role.position >=
                guild.members.me.roles.highest.position
            ) {

                return InteractionHelper.safeReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Rolle zu hoch',
                                'Ich kann keine Rollen vergeben, die höher als meine höchste Rolle sind.'
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }

            try {

                const config =
                    await getWelcomeConfig(
                        client,
                        guild.id
                    );

                const existingRoles =
                    config.roleIds || [];

                const currentRoleId =
                    existingRoles[0] || null;

                if (
                    currentRoleId ===
                    role.id
                ) {

                    return InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    'Bereits hinzugefügt',
                                    `Die Rolle ${role} ist bereits als automatische Rolle eingestellt.`
                                )
                            ],

                            flags:
                                MessageFlags.Ephemeral
                        }
                    );
                }

                await updateWelcomeConfig(
                    client,
                    guild.id,
                    {
                        roleIds:
                            [role.id]
                    }
                );

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            createAutoroleInfoEmbed(
                                currentRoleId
                                    ? `✅ Auto-Rolle wurde auf ${role} geändert. Es ist nur eine Auto-Rolle erlaubt.`
                                    : `✅ Auto-Rolle wurde auf ${role} gesetzt.`
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );

            } catch (error) {

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Hinzufügen fehlgeschlagen',
                                'Beim Hinzufügen der Rolle ist ein Fehler aufgetreten. Bitte versuche es erneut.',
                                {
                                    showDetails:
                                        true
                                }
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }
        }

        else if (
            subcommand === 'remove'
        ) {

            const role =
                options.getRole(
                    'role'
                );

            try {

                const config =
                    await getWelcomeConfig(
                        client,
                        guild.id
                    );

                const existingRoles =
                    config.roleIds || [];

                if (
                    !existingRoles.includes(
                        role.id
                    )
                ) {

                    return InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    'Nicht gefunden',
                                    `Die Rolle ${role} ist nicht als automatische Rolle eingestellt.`
                                )
                            ],

                            flags:
                                MessageFlags.Ephemeral
                        }
                    );
                }

                const updatedRoles =
                    existingRoles.filter(
                        id =>
                            id !== role.id
                    );

                await updateWelcomeConfig(
                    client,
                    guild.id,
                    {
                        roleIds:
                            updatedRoles
                    }
                );

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            createAutoroleInfoEmbed(
                                `✅ ${role} wurde von den automatischen Rollen entfernt.`
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );

            } catch (error) {

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Entfernen fehlgeschlagen',
                                'Beim Entfernen der Rolle ist ein Fehler aufgetreten. Bitte versuche es erneut.',
                                {
                                    showDetails:
                                        true
                                }
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }
        }

        else if (
            subcommand === 'list'
        ) {

            try {

                const guildConfig =
                    await getGuildConfig(
                        client,
                        guild.id
                    );

                const verificationEnabled =
                    Boolean(
                        guildConfig.verification?.enabled
                    );

                const autoVerifyEnabled =
                    Boolean(
                        guildConfig.verification?.autoVerify?.enabled
                    );

                const conflictSummary = [

                    verificationEnabled
                        ? 'Verifizierungssystem ist aktiviert'
                        : null,

                    autoVerifyEnabled
                        ? 'AutoVerify ist aktiviert'
                        : null

                ]
                .filter(Boolean)
                .join('\n');

                const config =
                    await getWelcomeConfig(
                        client,
                        guild.id
                    );

                const autoRoles =
                    Array.isArray(
                        config.roleIds
                    )
                    ? config.roleIds
                    : [];

                const singleRoleIds =
                    autoRoles.length > 1
                        ? [autoRoles[0]]
                        : autoRoles;

                if (
                    singleRoleIds.length === 0
                ) {

                    return InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                createAutoroleInfoEmbed(
                                    `ℹ️ Keine Rolle ist als automatische Rolle eingestellt.${conflictSummary ? `\n\n⚠️ Blockierende Einstellungen:\n${conflictSummary}` : ''}`
                                )
                            ],

                            flags:
                                MessageFlags.Ephemeral
                        }
                    );
                }

                const roles =
                    await guild.roles.fetch();

                const validRoles = [];

                for (
                    const roleId of singleRoleIds
                ) {

                    const role =
                        roles.get(
                            roleId
                        );

                    if (role) {
                        validRoles.push(
                            role
                        );
                    }
                }

                if (
                    validRoles.length === 0
                ) {

                    return InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                createAutoroleInfoEmbed(
                                    `ℹ️ Keine gültige Auto-Rolle gefunden.${conflictSummary ? `\n\n⚠️ Blockierende Einstellungen:\n${conflictSummary}` : ''}`
                                )
                            ],

                            flags:
                                MessageFlags.Ephemeral
                        }
                    );
                }

                const embed =
                    new EmbedBuilder()

                        .setColor(
                            getColor(
                                'info'
                            )
                        )

                        .setTitle(
                            'Automatisch vergebene Rolle'
                        )

                        .setDescription(
                            `${validRoles[0]}${conflictSummary ? `\n\n⚠️ Blockierende Einstellungen:\n${conflictSummary}` : ''}`
                        )

                        .setFooter({
                            text:
                                'Es kann nur eine Auto-Rolle konfiguriert werden.'
                        });

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds:
                            [embed],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );

            } catch (error) {

                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                'Liste fehlgeschlagen',
                                'Beim Anzeigen der automatischen Rollen ist ein Fehler aufgetreten. Bitte versuche es erneut.',
                                {
                                    showDetails:
                                        true
                                }
                            )
                        ],

                        flags:
                            MessageFlags.Ephemeral
                    }
                );
            }
        }
    },
};
