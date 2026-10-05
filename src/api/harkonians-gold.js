import {
    bootstrapGold,
    getFoundryState,
    getGold,
    syncGold
} from "./client.js";

import {
    getActorCredentials,
    getLastKnownServerGold,
    isWorldLinked,
    saveLastKnownServerGold
} from "../state.js";

let applyingServerGold = false;

export function isApplyingServerGold() {
    return applyingServerGold;
}

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

export async function applyServerGoldToActor(actor, gold) {
    const normalizedGold = Math.max(
        0,
        Math.floor(Number(gold) || 0)
    );

    await saveLastKnownServerGold(normalizedGold);

    const currentGold = getActorGold(actor);

    if (currentGold === normalizedGold) {
        return false;
    }

    applyingServerGold = true;

    try {
        await actor.update({
            "system.currency.gp": normalizedGold
        });
    } finally {
        applyingServerGold = false;
    }

    return true;
}

function validateLinkedActor(actor) {
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

    if (credentials.foundryActorId !== actor.id) {
        throw new Error(
            "Actor does not match the linked Harkonians character."
        );
    }
}

export async function bootstrapActorGold(actor) {
    validateLinkedActor(actor);

    const localGold = getActorGold(actor);

    const response =
        await bootstrapGold(localGold);

    const serverGold =
        Number.isFinite(Number(response?.gold))
            ? Math.max(0, Math.floor(Number(response.gold)))
            : localGold;

    await saveLastKnownServerGold(serverGold);

    return {
        ...response,
        gold: serverGold,
        bootstrapped:
            response?.bootstrapped !== false
    };
}

export async function synchronizeActorGold(actor) {
    validateLinkedActor(actor);

    const localGold = getActorGold(actor);
    let expectedGold = getLastKnownServerGold();

    // A baseline is required for conflict-safe updates. If none exists,
    // fetch the authoritative server value rather than guessing.
    if (expectedGold === null) {
        const response = await getGold();
        expectedGold =
            Number.isFinite(Number(response?.gold))
                ? Math.max(0, Math.floor(Number(response.gold)))
                : 0;

        await saveLastKnownServerGold(expectedGold);
    }

    try {
        const response = await syncGold(
            localGold,
            expectedGold
        );

        const serverGold =
            Number.isFinite(Number(response?.gold))
                ? Math.max(0, Math.floor(Number(response.gold)))
                : localGold;

        await saveLastKnownServerGold(serverGold);

        return {
            ...response,
            gold: serverGold,
            conflict: false
        };
    } catch (error) {
        if (error?.status !== 409 && !error?.conflict) {
            throw error;
        }

        let authoritativeGold =
            Number.isFinite(Number(error?.gold))
                ? Math.max(0, Math.floor(Number(error.gold)))
                : null;

        if (authoritativeGold === null) {
            const state = await getFoundryState();
            authoritativeGold =
                Number.isFinite(Number(state?.gold))
                    ? Math.max(0, Math.floor(Number(state.gold)))
                    : expectedGold;
        }

        await applyServerGoldToActor(
            actor,
            authoritativeGold
        );

        return {
            success: false,
            conflict: true,
            gold: authoritativeGold
        };
    }
}
