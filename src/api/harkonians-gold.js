import {
    syncGold
} from "./client.js";

import {
    getActorCredentials,
    isWorldLinked
} from "../state.js";

export function getActorGold(actor) {
    return Math.max(
        0,
        Math.floor(
            Number(
                foundry.utils.getProperty(
                    actor,
                    "system.currency.gp"
                ) ?? 0
            )
        )
    );
}

export async function synchronizeActorGold(actor) {
    const credentials = getActorCredentials();

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

    if (
        credentials.foundryActorId !== actor.id
    ) {
        throw new Error(
            "Actor does not match the linked Harkonians character."
        );
    }

    const gold = getActorGold(actor);

    return syncGold(gold);
}