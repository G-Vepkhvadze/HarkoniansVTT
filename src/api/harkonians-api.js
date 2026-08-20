/**
 * HarkoniansVTT
 *
 * HTTP client for the Harkonians Foundry API.
 */

const API_BASE_URL = "https://api.harkonians.quest/v1";

async function request(path, {
    method = "GET",
    worldSecret = null,
    body = null
} = {}) {
    const headers = {
        "Content-Type": "application/json"
    };

    if (worldSecret) {
        headers["x-foundry-world-secret"] = worldSecret;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body)
    });

    const contentType = response.headers.get("content-type") ?? "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = text ? { message: text } : {};
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

/**
 * Confirm a Foundry world pairing.
 *
 * The pairing code is intentionally never persisted.
 */
export async function confirmWorldPairing(pairingCode) {
    return request("/foundry/pair/confirm", {
        method: "POST",
        body: {
            pairingCode,
            foundryWorldId: game.world.id
        }
    });
}

/**
 * Link a Foundry Actor to Harkonians.
 */
export async function linkActor(worldSecret, actor) {
    return request("/foundry/link", {
        method: "POST",
        worldSecret,
        body: {
            foundryWorldId: game.world.id,
            foundryActorId: actor.id
        }
    });
}

/**
 * Publish an Item to Harkonians.
 */
export async function publishItem(worldSecret, payload) {
    return request("/foundry/items/publish", {
        method: "POST",
        worldSecret,
        body: payload
    });
}

export const api = {
    confirmWorldPairing,
    linkActor,
    publishItem
};