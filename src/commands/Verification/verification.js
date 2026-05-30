import { botConfig, getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, infoEmbed, successEmbed } from '../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../services/guildConfig.js';
import { handleInteractionError, withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { removeVerification, verifyUser } from '../../services/verificationService.js';
import { ContextualMessages } from '../../utils/messageTemplates.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getWelcomeConfig } from '../../utils/database.js';
import verificationDashboard from './modules/verification_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("verification")
        .setDescription("Verifizierungssystem des Servers verwalten")
        .addSubcommand(subcommand =>
            subcommand
                .setName("setup")
                .setDescription("Das Verifizierungssystem einrichten")
                .addChannelOption(option =>
                    option
                        .setName("verification_channel")
                        .setDescription("Kanal, in dem Verifizierungsnachrichten gesendet werden")
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option
                        .setName("verified_role")
                        .setDescription("Rolle, die verifizierten Benutzern zugewiesen wird")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Benutzerdefinierte Verifizierungsnachricht")
                        .setMaxLength(2000)
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName("button_text")
                        .setDescription("Text für den Verifizierungs-Button")
                        .setMaxLength(80)
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Verifizierung von einem Benutzer entfernen")
                .addUserOption(option =>
                    option
                        .setName("user")
                        .setDescription("Benutzer, dessen Verifizierung entfernt werden soll")
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("dashboard")
                .setDescription("Das Konfigurations-Dashboard für das Verifizierungssystem öffnen")
        ),

    async execute(interaction, config, client) {
        const wrappedExecute = withErrorHandling(async () => {
            const subcommand = interaction.options.getSubcommand();
            const guild = interaction.guild;

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                throw createError(
                    'Missing ManageGuild permission for verification admin subcommand',
                    ErrorTypes.PERMISSION,
                    'Du benötigst die Berechtigung **Server verwalten**, um diesen Verifizierungs-Unterbefehl zu nutzen.',
                    { subcommand, requiredPermission: 'ManageGuild', userId: interaction.user.id }
                );
            }

            switch (subcommand) {
                case "setup":
                    return await handleSetup(interaction, guild, client);
                case "remove":
                    return await handleRemove(interaction, guild, client);
                case "dashboard":
                    return await verificationDashboard.execute(interaction, config, client);
                default:
                    throw createError(
                        `Unknown subcommand: ${subcommand}`,
                        ErrorTypes.VALIDATION,
                        "Bitte wähle einen gültigen Unterbefehl aus.",
                        { subcommand }
                    );
            }
        }, { command: 'verification', subcommand: interaction.options.getSubcommand() });

        return await wrappedExecute(interaction, config, client);
    }
};

async function handleSetup(interaction, guild, client) {
    const verificationChannel = interaction.options.getChannel("verification_channel");
    const verifiedRole = interaction.options.getRole("verified_role");
    const message = interaction.options.getString("message") || botConfig.verification.defaultMessage;
    const buttonText = interaction.options.getString("button_text") || botConfig.verification.defaultButtonText;
    const botMember = guild.members.me;

    if (!botMember) {
        throw createError(
            'Bot member not found in guild cache',
            ErrorTypes.CONFIGURATION,
            'Ich konnte meine Berechtigungen auf diesem Server nicht überprüfen. Bitte versuche es in einem Moment erneut.',
            { guildId: guild.id }
        );
    }

    const requiredChannelPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
    ];
    const missingChannelPerms = requiredChannelPermissions.filter(perm => 
        !verificationChannel.permissionsFor(botMember).has(perm)
    );
    
    if (missingChannelPerms.length > 0) {
        throw createError(
            `Missing channel permissions: ${missingChannelPerms.join(', ')}`,
            ErrorTypes.PERMISSION,
            'Ich benötige die Berechtigungen **Kanal anzeigen**, **Nachrichten senden** und **Links einbetten** im Verifizierungskanal.',
            { missingPermissions: missingChannelPerms, channel: verificationChannel.id }
        );
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            "Missing ManageRoles permission",
            ErrorTypes.PERMISSION,
            "Ich benötige die Berechtigung 'Rollen verwalten', um verifizierte Rollen zu vergeben.",
            { missingPermission: "ManageRoles" }
        );
    }

    if (verifiedRole.id === guild.id || verifiedRole.managed) {
        throw createError(
            'Invalid verified role selected',
            ErrorTypes.VALIDATION,
            'Bitte wähle eine normale, zuweisbare Rolle (nicht @everyone oder eine von einer Integration verwaltete Rolle).',
            { roleId: verifiedRole.id, managed: verifiedRole.managed }
        );
    }

    const botRole = botMember.roles.highest;
    if (verifiedRole.position >= botRole.position) {
        throw createError(
            "Role hierarchy error",
            ErrorTypes.PERMISSION,
            "Die verifizierte Rolle muss in der Server-Rollenhierarchie unter meiner höchsten Rolle liegen.",
            { rolePosition: verifiedRole.position, botRolePosition: botRole.position }
        );
    }

    const guildConfig = await getGuildConfig(client, guild.id);
    const welcomeConfig = await getWelcomeConfig(client, guild.id);
    const hasAutoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
    const hasAutoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);

    if (hasAutoVerifyEnabled || hasAutoRoleConfigured) {
        throw createError(
            'Verification setup blocked by conflicting onboarding system',
            ErrorTypes.CONFIGURATION,
            'Du kannst das Verifizierungssystem nicht aktivieren, solange **AutoVerify** oder **AutoRole** konfiguriert ist. Deaktiviere diese zuerst.',
            {
                guildId: guild.id,
                hasAutoVerifyEnabled,
                hasAutoRoleConfigured,
                expected: true,
                suppressErrorLog: true
            }
        );
    }

    await InteractionHelper.safeDefer(interaction);

    const verifyEmbed = createEmbed({
        title: "✅ Server-Verifizierung",
        description: message,
        color: getColor('success')
    });

    const verifyButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("verify_user")
            .setLabel(buttonText)
            .setStyle(ButtonStyle.Success)
            .setEmoji("✅")
    );

    const verifyMessage = await verificationChannel.send({
        embeds: [verifyEmbed],
        components: [verifyButton]
    });

    guildConfig.verification = {
        enabled: true,
        channelId: verificationChannel.id,
        messageId: verifyMessage.id,
        roleId: verifiedRole.id,
        message: message,
        buttonText: buttonText
    };

    await setGuildConfig(client, guild.id, guildConfig);

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [ContextualMessages.configUpdated(
            "Verifizierungssystem",
            [
                `Kanal: ${verificationChannel}`,
                `Verifizierte Rolle: ${verifiedRole}`,
                `Button-Text: ${buttonText}`
            ]
        )]
    });
}

async function handleRemove(interaction, guild, client) {
    const targetUser = interaction.options.getUser("user");
    
    try {
        const result = await removeVerification(client, guild.id, targetUser.id, {
            moderatorId: interaction.user.id,
            reason: 'admin_removal'
        });

        if (!result.success) {
            if (result.notVerified) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [infoEmbed("Nicht verifiziert", `${targetUser.tag} besitzt derzeit nicht die verifizierte Rolle.`)],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        logger.info('Verification removed via command', {
            guildId: guild.id,
            targetUserId: targetUser.id,
            moderatorId: interaction.user.id
        });

        return await InteractionHelper.safeReply(interaction, {
            embeds: [successEmbed("Verifizierung entfernt", `Verifizierung von ${targetUser.tag} wurde entfernt.`)]
        });

    } catch (error) {
        await handleInteractionError(
            interaction,
            error,
            { command: 'verification', subcommand: 'remove' }
        );
    }
}
