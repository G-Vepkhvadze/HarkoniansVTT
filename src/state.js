/**
 * HarkoniansVTT
 *
 * Foundry settings and local module state.
 */

export const MODULE_ID =
    "harkoniansvtt";

export const SETTINGS = {
    worldSecret: "worldSecret",
    pairedAt: "pairedAt",
    actorCredentials:
        "actorCredentials"
};

export function registerSettings() {
    game.settings.register(
        MODULE_ID,
        SETTINGS.worldSecret,
        {
            name:
                "Harkonians World Secret",

            scope: "world",
            config: false,

            type: String,
            default: ""
        }
    );

    game.settings.register(
        MODULE_ID,
        SETTINGS.pairedAt,
        {
            name:
                "Harkonians Paired At",

            scope: "world",
            config: false,

            type: String,
            default: ""
        }
    );

    game.settings.register(
        MODULE_ID,
        SETTINGS.actorCredentials,
        {
            name:
                "Harkonians Actor Credentials",

            scope: "client",
            config: false,

            type: Object,
            default: {}
        }
    );
}

export function getWorldSecret() {
    const value =
        game.settings.get(
            MODULE_ID,
            SETTINGS.worldSecret
        );

    return typeof value === "string" &&
    value.length > 0
        ? value
        : null;
}

export function isWorldLinked() {
    return Boolean(
        getWorldSecret()
    );
}

export function getActorCredentials() {
    return (
        game.settings.get(
            MODULE_ID,
            SETTINGS.actorCredentials
        ) ?? {}
    );
}

export function getLinkedActor() {
    const credentials =
        getActorCredentials();

    if (!credentials?.foundryActorId) {
        return null;
    }

    return (
        game.actors.get(
            credentials.foundryActorId
        ) ?? null
    );
}

export async function saveActorCredentials(
    credentials
) {
    await game.settings.set(
        MODULE_ID,
        SETTINGS.actorCredentials,
        {
            foundryActorId:
            credentials.foundryActorId,

            foundryActorUuid:
            credentials.foundryActorUuid,

            characterId:
            credentials.characterId,

            characterToken:
            credentials.characterToken
        }
    );
}

export async function clearActorCredentials() {
    await game.settings.set(
        MODULE_ID,
        SETTINGS.actorCredentials,
        {}
    );
}

export async function clearWorldConnection() {
    await game.settings.set(
        MODULE_ID,
        SETTINGS.worldSecret,
        ""
    );

    await game.settings.set(
        MODULE_ID,
        SETTINGS.pairedAt,
        ""
    );

    await clearActorCredentials();
}