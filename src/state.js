/**
 * HarkoniansVTT
 *
 * Foundry settings and local module state.
 */

export const MODULE_ID = "harkoniansvtt";

export const SETTINGS = {
    worldSecret: "worldSecret",
    pairedAt: "pairedAt",
    actorCredentials: "actorCredentials"
};

export function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.worldSecret, {
        name: "Harkonians World Secret",
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, SETTINGS.pairedAt, {
        name: "Harkonians Paired At",
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    /*
     * Actor credentials are client-scoped.
     *
     * This is important: different players in the same Foundry world
     * must be able to link different Actors without overwriting each
     * other's credentials.
     */
    game.settings.register(MODULE_ID, SETTINGS.actorCredentials, {
        name: "Harkonians Actor Credentials",
        scope: "client",
        config: false,
        type: Object,
        default: {}
    });
}

export function getWorldSecret() {
    const value = game.settings.get(
        MODULE_ID,
        SETTINGS.worldSecret
    );

    return typeof value === "string" && value.length > 0
        ? value
        : null;
}

export function isWorldLinked() {
    return Boolean(getWorldSecret());
}

export function getActorCredentials() {
    return game.settings.get(
        MODULE_ID,
        SETTINGS.actorCredentials
    ) ?? {};
}

export async function saveActorCredentials(credentials) {
    await game.settings.set(
        MODULE_ID,
        SETTINGS.actorCredentials,
        credentials
    );
}

export async function clearActorCredentials() {
    await game.settings.set(
        MODULE_ID,
        SETTINGS.actorCredentials,
        {}
    );
}

export function getLinkedActorId() {
    return getActorCredentials().foundryActorId ?? null;
}

export function getLinkedActor() {
    const actorId = getLinkedActorId();

    if (!actorId) {
        return null;
    }

    return game.actors.get(actorId) ?? null;
}