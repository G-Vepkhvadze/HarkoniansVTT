/**
 * HarkoniansVTT
 *
 * HTTP client for the Harkonians Foundry API.
 */

const API_BASE_URL =
    "https://api.harkonians.quest/v1";

async function request(path, {
    method = "GET",
    worldSecret = null,
    characterToken = null,
    body = null,
    query = null
} = {}) {
    const headers = {
        "Content-Type": "application/json"
    };

    if (worldSecret) {
        headers["x-foundry-world-secret"] =
            worldSecret;
    }

    if (characterToken) {
        headers["Authorization"] =
            `Bearer ${characterToken}`;
    }

    let url = `${API_BASE_URL}${path}`;

    if (query && Object.keys(query).length > 0) {
        const params = new URLSearchParams();

        for (const [key, value] of Object.entries(query)) {
            if (
                value !== undefined &&
                value !== null
            ) {
                params.set(
                    key,
                    String(value)
                );
            }
        }

        const queryString = params.toString();

        if (queryString) {
            url += `?${queryString}`;
        }
    }

    let response;

    try {
        response = await fetch(url, {
            method,
            headers,
            body:
                body === null
                    ? undefined
                    : JSON.stringify(body)
        });
    } catch (error) {
        console.error(
            "HarkoniansVTT | Network request failed",
            {
                url,
                error
            }
        );

        throw new Error(
            "Could not connect to Harkonians. Check your internet connection and the Harkonians server status."
        );
    }

    const contentType =
        response.headers.get(
            "content-type"
        ) ?? "";

    let data;

    try {
        if (
            contentType.includes(
                "application/json"
            )
        ) {
            data = await response.json();
        } else {
            const text =
                await response.text();

            data = text
                ? { message: text }
                : {};
        }
    } catch {
        data = {};
    }

    if (!response.ok) {
        const message =
            data?.message ||
            data?.error ||
            `Harkonians API request failed (${response.status}).`;

        throw new Error(message);
    }

    return data;
}

/* ------------------------------
 * World
 * ------------------------------ */

export async function confirmWorldPairing(
    pairingCode
) {
    return request(
        "/foundry/pair/confirm",
        {
            method: "POST",

            body: {
                pairingCode,
                foundryWorldId:
                game.world.id
            }
        }
    );
}

/* ------------------------------
 * Character link
 * ------------------------------ */

export async function createActorLinkRequest(
    worldSecret,
    actor
) {
    return request(
        "/foundry/link",
        {
            method: "POST",
            worldSecret,

            body: {
                foundryWorldId:
                game.world.id,

                foundryActorId:
                actor.id
            }
        }
    );
}

export async function exchangeActorLink(
    worldSecret,
    requestId
) {
    return request(
        "/foundry/link/exchange",
        {
            method: "POST",
            worldSecret,

            body: {
                requestId,
                foundryWorldId:
                game.world.id
            }
        }
    );
}

/* ------------------------------
 * Character
 * ------------------------------ */

export async function getCharacter(
    worldSecret,
    characterToken
) {
    return request(
        "/foundry/character",
        {
            method: "GET",
            worldSecret,
            characterToken
        }
    );
}

/* ------------------------------
 * Gold
 * ------------------------------ */

export async function getGold(
    worldSecret,
    actorId
) {
    return request(
        "/foundry/gold",
        {
            method: "GET",
            worldSecret,

            query: {
                worldId:
                game.world.id,

                actorId
            }
        }
    );
}

export async function syncGold(
    worldSecret,
    actorId,
    gold
) {
    return request(
        "/foundry/gold/sync",
        {
            method: "POST",
            worldSecret,

            body: {
                foundryWorldId:
                game.world.id,

                foundryActorId:
                actorId,

                gold
            }
        }
    );
}

/* ------------------------------
 * Item publishing
 * ------------------------------ */

export async function publishItem(
    worldSecret,
    payload
) {
    return request(
        "/foundry/items/publish",
        {
            method: "POST",
            worldSecret,
            body: payload
        }
    );
}

/* ------------------------------
 * Purchase acknowledgement
 * ------------------------------ */

export async function acknowledgePurchase(
    worldSecret,
    purchaseId,
    actorId,
    foundryItemId
) {
    return request(
        "/foundry/purchase",
        {
            method: "POST",
            worldSecret,

            body: {
                purchaseId,
                status: "completed",
                foundryActorId:
                actorId,

                foundryItemId
            }
        }
    );
}

export async function failPurchase(
    worldSecret,
    purchaseId,
    errorMessage
) {
    return request(
        "/foundry/purchase",
        {
            method: "POST",
            worldSecret,

            body: {
                purchaseId,
                status: "failed",

                error:
                    errorMessage ||
                    "Failed to create Foundry Item."
            }
        }
    );
}

export const api = {
    confirmWorldPairing,

    createActorLinkRequest,
    exchangeActorLink,

    getCharacter,

    getGold,
    syncGold,

    publishItem,

    acknowledgePurchase,
    failPurchase
};