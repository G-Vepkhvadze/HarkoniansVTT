import {
    getGold,
    syncGold
} from "./client.js";

import {
    getActorCredentials,
    isWorldLinked
} from "../state.js";

export async function fetchLinkedActorGold() {
    if (!isWorldLinked()) {
        throw new Error(
            "Harkonians world is not linked."
        );
    }

    const credentials =
        getActorCredentials();

    if (
        !credentials.characterToken ||
        !credentials.characterId ||
        !credentials.foundryActorId
    ) {
        throw new Error(
            "No Harkonians character is linked to this Foundry client."
        );
    }

    return getGold();
}

export async function synchronizeActorGold(
    gold
) {
    if (!isWorldLinked()) {
        throw new Error(
            "Harkonians world is not linked."
        );
    }

    const credentials =
        getActorCredentials();

    if (
        !credentials.foundryActorId ||
        !credentials.characterToken
    ) {
        throw new Error(
            "No Harkonians character is linked."
        );
    }

    return syncGold(gold);
}