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
  
  const defaultHeaders = {
    "Content-Type": "application/json"
  };
  
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
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // If we can't parse as JSON, try text
      try {
        const errorText = await response.text();
        errorMessage = errorText || errorMessage;
      } catch {
        // Can't get error body, use status
      }
    }
    const error = new Error(errorMessage);
    error.status = response.status;
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
export async function reportPurchaseFailure(purchaseId, error) {
  return harkoniansFetch("/foundry/purchase", {
    method: "POST",
    body: JSON.stringify({
      purchaseId,
      status: "failed",
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
    actorId: credentials.foundryActorId
  });

  return harkoniansFetch(
      `/foundry/gold?${params.toString()}`
  );
}

/**
 * Sync character gold balance.
 * 
 * @param {number} gold - The gold amount in copper pieces
 * @returns {Promise<Object>}
 */
export async function syncGold(gold) {
  const credentials = getActorCredentials();

  if (!credentials?.foundryActorId) {
    throw new Error(
        "No Foundry Actor is linked."
    );
  }

  return harkoniansFetch(
      "/foundry/gold/sync",
      {
        method: "POST",
        body: JSON.stringify({
          foundryWorldId: game.world.id,
          foundryActorId:
          credentials.foundryActorId,
          gold
        })
      }
  );
}
