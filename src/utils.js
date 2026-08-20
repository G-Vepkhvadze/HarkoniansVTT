/**
 * HarkoniansVTT
 *
 * Small Foundry-independent utility functions.
 */

export function currencyToCopper(amount, denomination) {
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error("Price must be greater than zero.");
    }

    const multipliers = {
        pp: 1000,
        gp: 100,
        ep: 50,
        sp: 10,
        cp: 1
    };

    const multiplier = multipliers[denomination];

    if (!multiplier) {
        throw new Error("Invalid currency denomination.");
    }

    return Math.round(numericAmount * multiplier);
}

export function getApplicationFromAction(target, fallback = null) {
    if (
        fallback &&
        typeof fallback === "object" &&
        fallback.element instanceof HTMLElement
    ) {
        return fallback;
    }

    const root = target?.closest?.(".application");

    if (!root) {
        return null;
    }

    for (const application of foundry.applications.instances.values()) {
        if (application.element === root) {
            return application;
        }
    }

    return null;
}

export function getItemDescription(item) {
    return (
        item.system?.description?.value ??
        item.system?.description ??
        ""
    );
}

export function buildFoundryItemData(item) {
    const data = structuredClone(item.toObject(true));

    /*
     * These fields identify the local Foundry instance/document.
     * The Harkonians copy should retain the item's content without
     * pretending to be the original Foundry document.
     */
    delete data._id;
    delete data._stats;

    return data;
}

export function extractWorldSecret(response) {
    return (
        response?.worldSecret ??
        response?.secret ??
        response?.world?.worldSecret ??
        response?.world?.secret ??
        null
    );
}

export function extractActorCredentials(response, actor) {
    const character =
        response?.character ??
        response?.characterData ??
        null;

    return {
        foundryActorId: actor.id,
        foundryActorUuid: actor.uuid,
        characterId:
            response?.characterId ??
            character?.id ??
            response?.id ??
            null,
        characterToken:
            response?.characterToken ??
            response?.token ??
            response?.accessToken ??
            character?.token ??
            null
    };
}