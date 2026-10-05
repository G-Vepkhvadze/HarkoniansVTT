/**
 * HarkoniansVTT
 *
 * HTTP API client for communicating with Harkonians server.
 */

import { getWorldSecret, getActorCredentials } from "../state.js";

/**
 * Base URL for Harkonians API.
 * Can be configured via module settings or environment.
 */
const API_BASE = "https://api.harkonians.quest/v1";

/**
 * Make an authenticated request to Harkonians API.
 * 
 * @param {string} endpoint - API endpoint path
 * @param {Object} options - Fetch options
 * @returns {Promise<any>}
 */
async function harkoniansFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  const defaultHeaders = {};

  // JSON is the default for API calls, but never set Content-Type for
  // FormData requests: the browser must add the multipart boundary.
  if (!(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  
  // Add world secret if available
  const worldSecret = getWorldSecret();
  if (worldSecret) {
    defaultHeaders["x-foundry-world-secret"] = worldSecret;
  }
  
  // Add character token if available
  const credentials = getActorCredentials();
  if (credentials?.characterToken) {
    defaultHeaders["Authorization"] = `Bearer ${credentials.characterToken}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  });
  
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    let errorData = null;

    try {
      errorData = await response.json();
      errorMessage = errorData?.error || errorMessage;
    } catch {
      // If we can't parse as JSON, try text.
      try {
        const errorText = await response.text();
        errorMessage = errorText || errorMessage;
      } catch {
        // Can't get error body, use status.
      }
    }

    const error = new Error(errorMessage);
    error.status = response.status;
    error.payload = errorData;

    if (
      errorData &&
      typeof errorData.gold === "number" &&
      Number.isFinite(errorData.gold)
    ) {
      error.gold = errorData.gold;
    }

    if (errorData?.conflict === true) {
      error.conflict = true;
    }

    throw error;
  }
  
  try {
    return await response.json();
  } catch {
    // Response might be empty
    return {};
  }
}

/**
 * Confirm world pairing with Harkonians.
 * 
 * @param {string} pairingCode - The pairing code from Harkonians
 * @returns {Promise<Object>}
 */
export async function confirmWorldPairing(pairingCode) {
  return harkoniansFetch("/foundry/pair/confirm", {
    method: "POST",
    body: JSON.stringify({
      pairingCode,
      foundryWorldId: game.world.id
    })
  });
}

/**
 * Create an actor link request.
 * 
 * @param {string} worldSecret - The world secret
 * @param {Actor} actor - The Foundry Actor
 * @returns {Promise<Object>}
 */
export async function createActorLinkRequest(worldSecret, actor) {
  return harkoniansFetch("/foundry/link", {
    method: "POST",
    headers: {
      "x-foundry-world-secret": worldSecret
    },
    body: JSON.stringify({
      foundryWorldId: game.world.id,
      foundryActorId: actor.id
    })
  });
}

/**
 * Exchange a link request for character credentials.
 * 
 * @param {string} worldSecret - The world secret
 * @param {string} requestId - The link request ID
 * @returns {Promise<Object>}
 */
export async function exchangeActorLink(worldSecret, requestId) {
  return harkoniansFetch("/foundry/link/exchange", {
    method: "POST",
    headers: {
      "x-foundry-world-secret": worldSecret
    },
    body: JSON.stringify({
      requestId,
      foundryWorldId: game.world.id
    })
  });
}

/**
 * Publish an item to Harkonians store.
 * 
 * @param {string} worldSecret - The world secret
 * @param {Object} itemData - The item data to publish
 * @returns {Promise<Object>}
 */
export async function publishItem(worldSecret, itemData) {
  return harkoniansFetch("/foundry/items/publish", {
    method: "POST",
    headers: {
      "x-foundry-world-secret": worldSecret
    },
    body: JSON.stringify(itemData)
  });
}

/**
 * Acknowledge a purchase as completed.
 * 
 * @param {string} purchaseId - The purchase ID
 * @param {string} foundryActorId - The Foundry Actor ID
 * @param {string} foundryItemId - The Foundry Item ID created
 * @returns {Promise<Object>}
 */
export async function acknowledgePurchase(purchaseId, foundryActorId, foundryItemId) {
  return harkoniansFetch("/foundry/purchase", {
    method: "POST",
    body: JSON.stringify({
      purchaseId,
      status: "completed",
      foundryActorId,
      foundryItemId
    })
  });
}

/**
 * Report a purchase failure.
 * 
 * @param {string} purchaseId - The purchase ID
 * @param {string} error - The error message
 * @returns {Promise<Object>}
 */
export async function reportPurchaseFailure(
    purchaseId,
    foundryActorId,
    error
) {
  return harkoniansFetch("/foundry/purchase", {
    method: "POST",
    body: JSON.stringify({
      purchaseId,
      status: "failed",
      foundryActorId,
      error
    })
  });
}

/**
 * Get a Supabase Realtime JWT token.
 * 
 * @returns {Promise<Object>}
 */
export async function getRealtimeToken() {
  return harkoniansFetch("/foundry/realtime-token");
}

/**
 * Get character gold balance.
 * 
 * @returns {Promise<Object>}
 */
export async function getGold() {
  const credentials = getActorCredentials();

  if (!credentials?.foundryActorId) {
    throw new Error(
        "No Foundry Actor is linked."
    );
  }

  const params = new URLSearchParams({
    worldId: game.world.id,
    actorId:
    credentials.foundryActorId
  });

  return harkoniansFetch(
      `/foundry/gold?${params.toString()}`
  );
}

/**
 * Sync character gold balance.
 * 
 * @param {number} gold
 * @returns {Promise<Object>}
 */
export async function syncGold(gold, expectedGold = null) {
  const credentials = getActorCredentials();

  if (
      !credentials?.foundryActorId ||
      !game?.world?.id
  ) {
    throw new Error("No linked Foundry actor.");
  }

  const body = {
    foundryWorldId: game.world.id,
    foundryActorId: credentials.foundryActorId,
    gold: Math.max(0, Math.floor(Number(gold) || 0))
  };

  if (
      expectedGold !== null &&
      expectedGold !== undefined &&
      Number.isFinite(Number(expectedGold)) &&
      Number(expectedGold) >= 0
  ) {
    body.expectedGold =
        Math.floor(
            Number(expectedGold)
        );
  }

  return harkoniansFetch("/foundry/gold/sync", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

/**
 * Bootstrap the server-side gold balance when a Foundry Actor is linked
 * for the first time. The server decides whether the bootstrap may overwrite
 * the existing balance (for example, a character with purchase history).
 */
export async function bootstrapGold(gold) {
  const credentials = getActorCredentials();

  if (
    !credentials?.foundryActorId ||
    !game?.world?.id
  ) {
    throw new Error("No linked Foundry actor.");
  }

  return harkoniansFetch("/foundry/gold/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      foundryWorldId: game.world.id,
      foundryActorId: credentials.foundryActorId,
      gold: Math.max(0, Math.floor(Number(gold) || 0))
    })
  });
}


/**
 * Upload a Foundry-local image to Harkonians/Supabase Storage.
 *
 * The image is uploaded separately from the item JSON so large WebP files
 * do not have to be base64-encoded into the publish request.
 *
 * @param {File|Blob} file
 * @param {string} fileName
 * @returns {Promise<Object>}
 */
export async function uploadFoundryImage(file, fileName = "foundry-image") {
  const formData = new FormData();
  formData.append("file", file, fileName);

  return harkoniansFetch("/foundry/items/image", {
    method: "POST",
    body: formData
  });
}

/**
 * Fetch pending purchases which may have missed a realtime delivery.
 *
 * @returns {Promise<Object>}
 */
export async function getPendingPurchases() {
  return harkoniansFetch("/foundry/purchases/pending");
}


/**
 * Fetch authoritative character gold and published item stock.
 *
 * @returns {Promise<Object>}
 */
export async function getFoundryState() {
  return harkoniansFetch("/foundry/state");
}
