import axios from 'axios';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getColor } from '../../config/bot.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4e44d9029b1270a757cddc766a1bcb63';
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const MAX_RESULTS = 5;

export default {
    data: new SlashCommandBuilder()
        .setName("movie")
        .setDescription("Sucht nach einem Film oder einer Serie")
        .addStringOption((option) =>
            option
                .setName("title")
                .setDescription("Der Titel des Films oder der Serie")
                .setRequired(true)
                .setMaxLength(100),
        )
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("Art des Inhalts, nach dem gesucht werden soll")
                .addChoices(
                    { name: "Film", value: "movie" },
                    { name: "Serie", value: "tv" },
                )
                .setRequired(false),
        ),
    async execute(interaction) {
        try {
            
            const deferred = await InteractionHelper.safeDefer(interaction);
            if (!deferred) {
                return;
            }

            const guildConfig = await getGuildConfig(
                interaction.client,
                interaction.guild?.id,
            );
            if (guildConfig?.disabledCommands?.includes("movie")) {
                logger.warn('Movie command disabled in guild', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'movie'
                });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Befehl deaktiviert",
                            "Der Suchbefehl für Filme/Serien ist auf diesem Server deaktiviert.",
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (!TMDB_API_KEY) {
                logger.error('TMDB API key not configured', {
                    guildId: interaction.guildId,
                    commandName: 'movie'
                });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Konfigurationsfehler",
                            "Die Film-/Seriensuche ist nicht ordnungsgemäß konfiguriert.",
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const title = interaction.options.getString("title");
            const type = interaction.options.getString("type") || "movie";

            logger.debug('Movie search initiated', {
                userId: interaction.user.id,
                title: title,
                type: type,
                guildId: interaction.guildId
            });

            const searchResponse = await axios.get(
                `https://api.themoviedb.org/3/search/${type}`,
                {
                    params: {
                        api_key: TMDB_API_KEY,
                        query: title,
                        include_adult: guildConfig?.allowNsfwContent
                            ? undefined
                            : false,
                        language: guildConfig?.language || "de-DE",
                        page: 1,
                        region: guildConfig?.region || "DE",
                    },
                    timeout: 8000,
                },
            );

            if (!searchResponse.data?.results?.length) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Nicht gefunden",
                            `Keine ${type === "movie" ? "Filme" : "Serien"} für "${title}" gefunden.`,
                        ),
                    ],
                });
            }

            const result = searchResponse.data.results[0];
            const mediaType = type === "movie" ? "Film" : "Serie";
            const mediaTitle = result.title || result.name || "Unbekannter Titel";
            const releaseDate = result.release_date || result.first_air_date;
            const year = releaseDate
                ? new Date(releaseDate).getFullYear()
                : "N/A";

            const detailsResponse = await axios.get(
                `https://api.themoviedb.org/3/${type}/${result.id}`,
                {
                    params: {
                        api_key: TMDB_API_KEY,
                        language: guildConfig?.language || "de-DE",
                        append_to_response:
                            "credits,release_dates,content_ratings",
                    },
                    timeout: 8000,
                },
            );

            const details = detailsResponse.data;
            const runtime = details.runtime
                ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m`
                : details.episode_run_time?.[0]
                  ? `${details.episode_run_time[0]}m pro Episode`
                  : "N/A";

            let contentRating = "N/A";
            if (type === "movie") {
                // Suche nach deutscher Altersfreigabe (FSK), ansonsten Fallback auf US
                const deCert = details.release_dates?.results?.find(
                    (r) => r.iso_3166_1 === "DE",
                );
                const usCert = details.release_dates?.results?.find(
                    (r) => r.iso_3166_1 === "US",
                );
                
                if (deCert?.release_dates?.[0]?.certification) {
                    contentRating = `FSK ${deCert.release_dates[0].certification}`;
                } else if (usCert?.release_dates?.[0]?.certification) {
                    contentRating = usCert.release_dates[0].certification;
                }
            } else {
                // TV-Altersfreigaben
                const deCert = details.content_ratings?.results?.find(
                    (r) => r.iso_3166_1 === "DE",
                );
                const usCert = details.content_ratings?.results?.find(
                    (r) => r.iso_3166_1 === "US",
                );

                if (deCert?.rating) {
                    contentRating = deCert.rating;
                } else if (usCert?.rating) {
                    contentRating = usCert.rating;
                }
            }

            const genres =
                details.genres?.map((g) => g.name).join(", ") || "N/A";

            const cast =
                details.credits?.cast
                    ?.slice(0, 3)
                    .map((p) => p.name)
                    .join(", ") || "N/A";

            const embed = createEmbed({
                title: `${mediaTitle} (${year})`,
                description: details.overview || "Keine Übersicht verfügbar.",
                color: 'info'
            })
                .setURL(`https://www.themoviedb.org/${type}/${result.id}`)
                .setThumbnail(
                    result.poster_path
                        ? `${IMAGE_BASE_URL}${result.poster_path}`
                        : null,
                )
                .addFields(
                    { name: "Typ", value: mediaType, inline: true },
                    {
                        name: "Bewertung",
                        value: result.vote_average
                            ? `⭐ ${result.vote_average.toFixed(1)}/10 (${result.vote_count.toLocaleString('de-DE')} Bewertungen)`
                            : "N/A",
                        inline: true,
                    },
                    {
                        name: "Altersfreigabe",
                        value: contentRating,
                        inline: true,
                    },
                    { name: "Spieldauer", value: runtime, inline: true },
                    {
                        name: "Veröffentlichung",
                        value: releaseDate
                            ? new Date(releaseDate).toLocaleDateString('de-DE')
                            : "N/A",
                        inline: true,
                    },
                    { name: "Genres", value: genres, inline: true },
                    { name: "Besetzung", value: cast, inline: false },
                )
                .setFooter({
                    text: "Unterstützt von The Movie Database",
                    iconURL:
                        "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_1-5bdc75aaebeb75dc7ae79426ddd9be3b2be1e342510f8202baf6bffa71d7f5c4.svg",
                });

            if (result.backdrop_path) {
                embed.setImage(
                    `https://image.tmdb.org/t/p/w1280${result.backdrop_path}`,
                );
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            
            logger.info('Movie information retrieved', {
                userId: interaction.user.id,
                title: title,
                type: type,
                resultTitle: mediaTitle,
                guildId: interaction.guildId,
                commandName: 'movie'
            });
        } catch (error) {
            logger.error('Movie/TV show search error', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                apiStatus: error.response?.status,
                commandName: 'movie'
            });

            if (error.response?.status === 404) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Nicht gefunden', 'Der angeforderte Film / die angeforderte Serie konnte nicht gefunden werden.')]
                });
            } else if (error.response?.status === 401) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Konfigurationsfehler', 'Ungültiger TMDB-API-Key. Bitte kontaktiere den Bot-Administrator.')],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await handleInteractionError(interaction, error, {
                    commandName: 'movie',
                    source: 'tmdb_api'
                });
            }
        }
    },
};
