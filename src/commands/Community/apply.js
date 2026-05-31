import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import ApplicationService from '../../services/applicationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { 
    getApplicationSettings, 
    getUserApplications, 
    createApplication, 
    getApplication,
    getApplicationRoles,
    updateApplication,
    getApplicationRoleSettings
} from '../../utils/database.js';

function getApplicationStatusPresentation(statusValue) {
    const normalized = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : 'unknown';
    const statusLabel =
        normalized === 'pending' ? 'In Bearbeitung' :
        normalized === 'approved' ? 'Angenommen' :
        normalized === 'denied' ? 'Abgelehnt' :
        'Unbekannt';
    const statusEmoji =
        normalized === 'pending' ? '🟡' :
        normalized === 'approved' ? '🟢' :
        normalized === 'denied' ? '🔴' :
        '⚪';

    return { normalized, statusLabel, statusEmoji };
}

export default {
    data: new SlashCommandBuilder()
        .setName("bewerben")
        .setDescription("Rollenbewerbungen verwalten")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("absenden")
                .setDescription("Eine Bewerbung für eine Rolle einreichen")
                .addStringOption((option) =>
                    option
                        .setName("bewerbung")
                        .setDescription("Die Bewerbung, die du einreichen möchtest")
                        .setRequired(true)
                        .setAutocomplete(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("status")
                .setDescription("Überprüfe den Status deiner Bewerbung")
                .addStringOption((option) =>
                    option
                        .setName("id")
                        .setDescription("Bewerbungs-ID (leer lassen, um alle zu sehen)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("liste")
                .setDescription("Zeige verfügbare Rollen für eine Bewerbung an"),
        ),

    category: "Community",

    execute: withErrorHandling(async (interaction) => {
        if (!interaction.inGuild()) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed("Dieser Befehl kann nur auf einem Server verwendet werden.")],
                flags: ["Ephemeral"],
            });
        }

        const { options, guild, member } = interaction;
        const subcommand = options.getSubcommand();

        if (subcommand !== "absenden") {
            const isListCommand = subcommand === "liste";
            await InteractionHelper.safeDefer(interaction, { flags: isListCommand ? [] : ["Ephemeral"] });
        }

        logger.info(`Bewerbungsbefehl ausgeführt: ${subcommand}`, {
            userId: interaction.user.id,
            guildId: guild.id,
            subcommand
        });

        const settings = await getApplicationSettings(
            interaction.client,
            guild.id,
        );
        
        if (!settings.enabled) {
            throw createError(
                'Bewerbungen sind deaktiviert',
                ErrorTypes.CONFIGURATION,
                'Bewerbungen sind auf diesem Server derzeit deaktiviert.',
                { guildId: guild.id }
            );
        }

        if (subcommand === "absenden") {
            await handleSubmit(interaction, settings);
        } else if (subcommand === "status") {
            await handleStatus(interaction);
        } else if (subcommand === "liste") {
            await handleList(interaction);
        }
    }, { type: 'command', commandName: 'bewerben' })
};

export async function handleApplicationModal(interaction) {
    if (!interaction.isModalSubmit()) return;
    
    const customId = interaction.customId;
    if (!customId.startsWith('app_modal_')) return;
    
    const roleId = customId.split('_')[2];
    
    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const applicationRole = applicationRoles.find(appRole => appRole.roleId === roleId);
    
    if (!applicationRole) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Bewerbungskonfiguration wurde nicht gefunden.')],
            flags: ["Ephemeral"]
        });
    }
    
    const role = interaction.guild.roles.cache.get(roleId);
    
    if (!role) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Rolle wurde nicht gefunden.')],
            flags: ["Ephemeral"]
        });
    }
    
    const answers = [];
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
    
    // Fragen abrufen - nutze spezifische Fragen pro Bewerbung falls vorhanden, andernfalls globale
    let questions = settings.questions || ["Warum möchtest du diese Rolle?", "Welche Erfahrungen bringst du mit?"];
    const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
    if (roleSettings.questions && roleSettings.questions.length > 0) {
        questions = roleSettings.questions;
    }
    
    for (let i = 0; i < questions.length; i++) {
        const answer = interaction.fields.getTextInputValue(`q${i}`);
        answers.push({
            question: questions[i],
            answer: answer
        });
    }
    
    try {
        const application = await ApplicationService.submitApplication(interaction.client, {
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            roleId: roleId,
            roleName: applicationRole.name,
            username: interaction.user.tag,
            avatar: interaction.user.displayAvatarURL(),
            answers: answers
        });
        
        const embed = successEmbed(
            'Bewerbung abgesendet',
            `Deine Bewerbung für **${applicationRole.name}** wurde erfolgreich eingereicht!\n\n` +
            `Bewerbungs-ID: \`${application.id}\`\n` +
            `Du kannst den Status mit \`/bewerben status id:${application.id}\` überprüfen.`
        );
        
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
        
        const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
        
        // Nutze spezifischen Log-Kanal pro Bewerbung falls vorhanden, andernfalls globalen
        const logChannelId = roleSettings.logChannelId || settings.logChannelId;
        
        if (logChannelId) {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = createEmbed({
                    title: '📝 Neue Bewerbung',
                    description: `**Nutzer:** <@${interaction.user.id}> (${interaction.user.tag})\n` +
                        `**Bewerbung:** ${applicationRole.name}\n` +
                        `**Rolle:** ${role.name}\n` +
                        `**Bewerbungs-ID:** \`${application.id}\`\n` +
                        `**Status:** 🟡 In Bearbeitung`
                }).setColor(getColor('warning'));
                
                const logMessage = await logChannel.send({ embeds: [logEmbed] });
                
                await updateApplication(interaction.client, interaction.guild.id, application.id, {
                    logMessageId: logMessage.id,
                    logChannelId: logChannelId
                });
            }
        }
        
    } catch (error) {
        logger.error('Fehler beim Erstellen der Bewerbung:', {
            error: error.message,
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            roleId,
            stack: error.stack
        });
        
        await handleInteractionError(interaction, error, {
            type: 'modal',
            handler: 'application_submission'
        });
    }
}

async function handleList(interaction) {
    try {
        const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
        
        if (applicationRoles.length === 0) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Aktuell sind keine Bewerbungen verfügbar.")],
            });
        }

        const embed = createEmbed({
            title: "Verfügbare Bewerbungen",
            description: "Hier sind die Rollen, für die du dich bewerben kannst:"
        });

        applicationRoles.forEach((appRole, index) => {
            const role = interaction.guild.roles.cache.get(appRole.roleId);
            embed.addFields({
                name: `${index + 1}. ${appRole.name}`,
                value: `**Rolle:** ${role ? `<@&${appRole.roleId}>` : 'Rolle nicht gefunden'}\n` +
                       `**Bewerben mit:** \`/bewerben absenden bewerbung:"${appRole.name}"\``,
                inline: false
            });
        });

        embed.setFooter({
            text: "Nutze /bewerben absenden bewerbung:<Name>, um dich für eine dieser Rollen zu bewerben."
        });

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Fehler beim Auflisten der Bewerbungen:', {
            error: error.message,
            guildId: interaction.guild.id,
            stack: error.stack
        });
        
        throw createError(
            'Laden der Bewerbungen fehlgeschlagen',
            ErrorTypes.DATABASE,
            'Die Bewerbungen konnten nicht geladen werden. Bitte versuche es später noch einmal.',
            { guildId: interaction.guild.id }
        );
    }
}

async function handleSubmit(interaction, settings) {
    const applicationName = interaction.options.getString("bewerbung");
    const member = interaction.member;

    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    
    const applicationRole = applicationRoles.find(appRole => 
        appRole.name.toLowerCase() === applicationName.toLowerCase()
    );

    if (!applicationRole) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed(
                    "Bewerbung nicht gefunden.",
                    "Nutze `/bewerben liste`, um die verfügbaren Bewerbungen zu sehen."
                ),
            ],
            flags: ["Ephemeral"],
        });
    }

    const userApps = await getUserApplications(
        interaction.client,
        interaction.guild.id,
        interaction.user.id,
    );
    const pendingApp = userApps.find((app) => app.status === "pending");

    if (pendingApp) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed(
                    `Du hast bereits eine laufende Bewerbung. Bitte warte, bis diese überprüft wurde.`,
                ),
            ],
            flags: ["Ephemeral"],
        });
    }

    const role = interaction.guild.roles.cache.get(applicationRole.roleId);
    if (!role) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Die Rolle für diese Bewerbung existiert nicht mehr.')],
            flags: ["Ephemeral"]
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`app_modal_${applicationRole.roleId}`)
        .setTitle(`Bewerbung für ${applicationRole.name}`);

    // Fragen abrufen - nutze spezifische Fragen pro Bewerbung falls vorhanden, andernfalls globale
    let questions = settings.questions || ["Warum möchtest du diese Rolle?", "Welche Erfahrungen bringst du mit?"];
    const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, applicationRole.roleId);
    if (roleSettings.questions && roleSettings.questions.length > 0) {
        questions = roleSettings.questions;
    }

    questions.forEach((question, index) => {
        const input = new TextInputBuilder()
            .setCustomId(`q${index}`)
            .setLabel(
                question.length > 45
                    ? `${question.substring(0, 42)}...`
                    : question,
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
    });

    await interaction.showModal(modal);
}

async function handleStatus(interaction) {
    const appId = interaction.options.getString("id");

    if (appId) {
        const application = await getApplication(
            interaction.client,
            interaction.guild.id,
            appId,
        );

        if (!application || application.userId !== interaction.user.id) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Bewerbung nicht gefunden oder du hast keine Berechtigung, sie einzusehen.",
                    ),
                ],
                flags: ["Ephemeral"],
            });
        }

        const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
        const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
            ? submittedAt.toLocaleString('de-DE')
            : 'Unbekanntes Datum';
        const statusView = getApplicationStatusPresentation(application.status);
        const embed = createEmbed({
            title: `Bewerbung #${application.id} - ${application.roleName || 'Unbekannte Rolle'}`,
            description:
                `**Bewerbungs-ID:** \`${application.id}\`\n` +
                `**Status:** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
                `**Abgesendet am:** ${submittedAtDisplay}`
        });

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
    } else {
        const applications = await getUserApplications(
            interaction.client,
            interaction.guild.id,
            interaction.user.id,
        );

        if (applications.length === 0) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed("Du hast bisher noch keine Bewerbungen eingereicht."),
                ],
                flags: ["Ephemeral"],
            });
        }

        const recentApplications = applications
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 10);

        const embed = createEmbed({
            title: "Deine Bewerbungen",
            description: `Es werden die letzten ${recentApplications.length} Bewerbung(en) angezeigt.`
        });

        recentApplications.forEach((application) => {
            const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
            const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
                ? submittedAt.toLocaleDateString('de-DE')
                : 'Unbekanntes Datum';
            const statusView = getApplicationStatusPresentation(application.status);

            embed.addFields({
                name: `${statusView.statusEmoji} ${application.roleName || 'Unbekannte Rolle'} (${statusView.statusLabel})`,
                value:
                    `**ID:** \`${application.id}\`\n` +
                    `**Status:** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
                    `**Abgesendet am:** ${submittedAtDisplay}`,
                inline: true,
            });
        });

        if (applications.length > recentApplications.length) {
            embed.setFooter({ text: `Es werden die neuesten ${recentApplications.length} von insgesamt ${applications.length} Bewerbungen angezeigt.` });
        }

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
    }
}
