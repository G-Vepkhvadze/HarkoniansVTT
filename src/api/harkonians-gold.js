import {
    getGold,
    syncGold
} from "./client.js";

import {
    getActorCredentials,
    isWorldLinked
} from "../state.js";

export function getActorGold(actor) {
    return Number(
        foundry.utils.getProperty(
            actor,
            "system.currency.gp"
        ) ?? 0
    );
}

export async function synchronizeActorGold(
    actor
) {
    const credentials =
        getActorCredentials();

    if (
        !isWorldLinked() ||
        !credentials?.characterId ||
        !credentials?.characterToken ||
        !credentials?.foundryActorId
    ) {
        throw new Error(
            "No Harkonians character is linked."
        );
    }

    const gold = getActorGold(actor);

    return syncGold(gold);
}