/**
 * Harkonians API Client
 * Centralized API client for communicating with Harkonians backend
 */

export class HarkoniansApi {
    /**
     * @param {string} baseUrl - The base URL of the Harkonians API
     */
    constructor(baseUrl = 'https://api.harkonians.quest/v1') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * Confirm world pairing with Harkonians
     * @param {string} pairingCode - The temporary pairing code from Harkonians
     * @param {string} foundryWorldId - The Foundry world ID
     * @returns {Promise<PairWorldResponse>} The pairing response
     */
    async confirmWorldPairing(pairingCode, foundryWorldId) {
        return this.request('/api/foundry/pair/confirm', {
            method: 'POST',
            body: JSON.stringify({
                pairingCode,
                foundryWorldId
            })
        });
    }

    /**
     * Create a character link request
     * @param {string} worldSecret - The world secret
     * @param {string} foundryWorldId - The Foundry world ID
     * @param {string} foundryActorId - The Foundry actor ID
     * @returns {Promise<LinkRequestResponse>} The link request response
     */
    async createCharacterLinkRequest(worldSecret, foundryWorldId, foundryActorId) {
        return this.request('/api/foundry/link', {
            method: 'POST',
            headers: {
                'x-foundry-world-secret': worldSecret
            },
            body: JSON.stringify({
                foundryWorldId,
                foundryActorId
            })
        });
    }

    /**
     * Complete character authorization (after browser flow)
     * @param {string} requestId - The request ID from the link request
     * @returns {Promise<CharacterAuthorizationResponse>} The authorization response
     */
    async completeCharacterAuthorization(requestId) {
        return this.request(`/api/foundry/link-status/${requestId}`, {
            method: 'GET'
        });
    }

    /**
     * Get character state from Harkonians
     * @param {string} worldSecret - The world secret
     * @param {string} characterToken - The character bearer token
     * @returns {Promise<CharacterStateResponse>} The character state
     */
    async getCharacterState(worldSecret, characterToken) {
        return this.request('/api/foundry/character', {
            method: 'GET',
            headers: {
                'x-foundry-world-secret': worldSecret,
                'Authorization': `Bearer ${characterToken}`
            }
        });
    }

    /**
     * Publish an item to Harkonians store
     * @param {string} worldSecret - The world secret
     * @param {Object} payload - The item publish payload
     * @returns {Promise<PublishItemResponse>} The publish response
     */
    async publishItem(worldSecret, payload) {
        return this.request('/api/foundry/items/publish', {
            method: 'POST',
            headers: {
                'x-foundry-world-secret': worldSecret
            },
            body: JSON.stringify(payload)
        });
    }

    /**
     * Update an existing store item
     * @param {string} worldSecret - The world secret
     * @param {string} harkoniansItemId - The Harkonians item ID
     * @param {Object} payload - The update payload
     * @returns {Promise<PublishItemResponse>} The update response
     */
    async updateItem(worldSecret, harkoniansItemId, payload) {
        return this.request(`/api/foundry/items/${harkoniansItemId}`, {
            method: 'PUT',
            headers: {
                'x-foundry-world-secret': worldSecret
            },
            body: JSON.stringify(payload)
        });
    }

    /**
     * Make a generic API request
     * @param {string} path - The API path
     * @param {RequestInit} options - Fetch options
     * @returns {Promise<any>} The JSON response
     * @private
     */
    async request(path, options = {}) {
        const url = `${this.baseUrl}${path}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers ?? {})
            }
        });

        let data;
        try {
            data = await response.json();
        } catch (e) {
            // No JSON body, that's fine
            data = null;
        }

        if (!response.ok) {
            // Don't log worldSecret or character tokens
            const safeError = this._createSafeError(response.status, data);
            throw new Error(safeError);
        }

        return data;
    }

    /**
     * Create a safe error message without exposing secrets
     * @param {number} status - HTTP status code
     * @param {Object|null} data - Response data
     * @returns {string} Safe error message
     * @private
     */
    _createSafeError(status, data) {
        switch (status) {
            case 401:
                return 'Harkonians authorization is invalid.';
            case 403:
                return 'You are not authorized to perform this operation.';
            case 404:
                return 'Harkonians could not find the requested world/character/item.';
            case 409:
                return 'This Item or connection already exists.';
            case 500:
            case 502:
            case 503:
            case 504:
                return 'Harkonians could not be reached.';
            default:
                return data?.message || `Harkonians API error: ${status}`;
        }
    }
}

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * @typedef {Object} PairWorldResponse
 * @property {boolean} success - Whether pairing was successful
 * @property {Object} [world] - World information
 * @property {string} [world.id] - Harkonians world ID
 * @property {string} [world.name] - World name
 * @property {string} [world.foundryWorldId] - Foundry world ID
 * @property {string} [worldSecret] - The persistent world secret
 * @property {string} [message] - Status message
 */

/**
 * @typedef {Object} LinkRequestResponse
 * @property {boolean} success - Whether the request was created successfully
 * @property {string} [requestId] - The request ID for authorization
 * @property {string} [authorizationUrl] - URL for browser authorization
 * @property {string} [status] - Current status
 * @property {string} [message] - Status message
 */

/**
 * @typedef {Object} CharacterAuthorizationResponse
 * @property {boolean} success - Whether authorization was successful
 * @property {Object} [character] - Character information
 * @property {string} [character.id] - Harkonians character ID
 * @property {string} [character.name] - Character name
 * @property {number} [character.creditBalance] - Character's credit balance
 * @property {string} [character.foundryWorldId] - Foundry world ID
 * @property {string} [character.foundryActorId] - Foundry actor ID
 * @property {string} [characterToken] - The bearer token for this character
 * @property {string} [message] - Status message
 */

/**
 * @typedef {Object} CharacterStateResponse
 * @property {boolean} success - Whether the request was successful
 * @property {Object} [character] - Character information
 * @property {string} [character.id] - Harkonians character ID
 * @property {string} [character.name] - Character name
 * @property {number} [character.creditBalance] - Character's credit balance
 * @property {string} [character.foundryWorldId] - Foundry world ID
 * @property {string} [character.foundryActorId] - Foundry actor ID
 */

/**
 * @typedef {Object} PublishItemResponse
 * @property {boolean} success - Whether publishing was successful
 * @property {Object} [item] - The created store item
 * @property {string} [item.id] - Harkonians item ID
 * @property {string} [message] - Status message
 */

// Export a singleton instance
export const api = new HarkoniansApi();
