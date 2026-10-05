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

let lastKnownServerGold = null;

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

export function getLastKnownServerGold() {
    const stored =
        getActorCredentials()
            ?.lastKnownServerGold;

    if (
        stored !== null &&
        stored !== undefined &&
        stored !== "" &&
        Number.isFinite(Number(stored))
    ) {
        return Math.max(
            0,
            Math.floor(Number(stored))
        );
    }

    if (
        lastKnownServerGold !== null &&
        lastKnownServerGold !== undefined &&
        Number.isFinite(
            Number(lastKnownServerGold)
        )
    ) {
        return Math.max(
            0,
            Math.floor(
                Number(lastKnownServerGold)
            )
        );
    }

    return null;
}

export async function saveLastKnownServerGold(gold) {
    const normalized =
        Number.isFinite(Number(gold))
            ? Math.max(0, Math.floor(Number(gold)))
            : null;

    lastKnownServerGold = normalized;

    const credentials = getActorCredentials();

    if (!credentials?.characterId) {
        return;
    }

    await game.settings.set(
        MODULE_ID,
        SETTINGS.actorCredentials,
        {
            ...credentials,
            lastKnownServerGold: normalized
        }
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
            credentials.characterToken,

            lastKnownServerGold:
            credentials.lastKnownServerGold ?? null
        }
    );

    lastKnownServerGold =
        Number.isFinite(Number(credentials.lastKnownServerGold))
            ? Math.max(0, Math.floor(Number(credentials.lastKnownServerGold)))
            : null;
}

export async function clearActorCredentials() {
    lastKnownServerGold = null;

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