import { moduleId } from "../constants";

// API Configuration
const API_BASE_URL = "https://api.harkonians.quest/v1";
const API_TIMEOUT = 10000; // 10 seconds

// Type definitions for API responses
export interface PairingConfirmRequest {
  pairingCode: string;
  foundryWorldId: string;
}

export type CurrencyDenomination = "cp" | "sp" | "ep" | "gp" | "pp";

export interface PublishStoreItemRequest {
  foundryWorldId: string;
  foundryItemId: string;
  foundryItemUuid: string;
  foundrySystemId: string;
  foundrySystemVersion: string;
  
  name: string;
  type: string;
  img?: string;
  
  // Store metadata
  price: number;
  denomination: CurrencyDenomination;
  stock: number | null; // null = unlimited
  
  // Optional overrides
  storeDescription?: string;
  storeImage?: string;
  
  // Complete Foundry Item data
  foundryItemData: object;
}

export interface PublishStoreItemResponse {
  success: boolean;
  storeItemId?: string;
  name?: string;
  error?: string;
  message?: string;
}

export interface StoreItemFlagData {
  storeItemId: string;
  publishedAt: string;
  lastUpdatedAt?: string;
}

export interface PairingConfirmResponse {
  success: boolean;
  worldSecret?: string;
  worldId?: string;
  error?: string;
  message?: string;
}

export interface CharacterLinkRequest {
  foundryWorldId: string;
  foundryActorId: string;
}

export interface CharacterLinkResponse {
  success: boolean;
  requestId?: string;
  authorizationUrl?: string;
  characterId?: string;
  error?: string;
  message?: string;
  expiresAt?: string;
}

export interface CharacterStateResponse {
  success: boolean;
  character?: {
    id: string;
    name: string;
    creditBalance: number;
    foundryActorId?: string;
    foundryWorldId?: string;
  };
  error?: string;
  message?: string;
}

export interface WorldStatusResponse {
  success: boolean;
  paired: boolean;
  worldId?: string;
  error?: string;
}

export type ConnectionStatus = 
  | "disconnected"
  | "pairing"
  | "connected"
  | "credential-invalid"
  | "server-unavailable";

export type CharacterConnectionStatus = 
  | "not-connected"
  | "link-pending"
  | "authorization-required"
  | "connected"
  | "invalid-credential"
  | "revoked"
  | "server-unavailable";

// Secure credential storage keys (world-scoped)
export const SETTING_WORLD_SECRET = "worldSecret";
export const SETTING_PAIRING_CODE = "pairingCode"; // Temporary, cleared after use
export const SETTING_PAIRING_ATTEMPT = "pairingAttempt";
export const SETTING_PAIRED_AT = "pairedAt";

// Character credential storage (actor-scoped via flags)
export const FLAG_CONNECTION = "connection";
export const FLAG_CHARACTER_TOKEN = "characterToken"; // Stored securely

// Item store publication flag
export const FLAG_STORE_ITEM = "storeItem";

export interface HarkoniansConnectionData {
  harkoniansCharacterId?: string;
  linkedAt?: string;
  characterName?: string;
  systemId?: string;
  systemVersion?: string;
}

export interface HarkoniansCharacterToken {
  token: string;
  expiresAt?: string;
  obtainedAt: string;
}

/**
 * Centralized API client for Harkonians.quest integration
 * Handles all communication with the Harkonians API
 */
export class HarkoniansAPIClient {
  private static instance: HarkoniansAPIClient | null = null;
  
  private constructor() {}
  
  public static getInstance(): HarkoniansAPIClient {
    if (!HarkoniansAPIClient.instance) {
      HarkoniansAPIClient.instance = new HarkoniansAPIClient();
    }
    return HarkoniansAPIClient.instance;
  }

  /**
   * Get the current world secret from settings
   * Returns null if not set or invalid
   */
  private async getWorldSecret(): Promise<string | null> {
    const secret = (game as Game).settings.get(moduleId, SETTING_WORLD_SECRET);
    return (typeof secret === "string" && secret.length > 0) ? secret : null;
  }

  /**
   * Store the world secret securely
   */
  private async storeWorldSecret(secret: string): Promise<void> {
    await (game as Game).settings.set(moduleId, SETTING_WORLD_SECRET, secret);
    await (game as Game).settings.set(moduleId, SETTING_PAIRING_ATTEMPT, "");
    await (game as Game).settings.set(moduleId, SETTING_PAIRED_AT, new Date().toISOString());
  }

  /**
   * Clear temporary pairing code
   */
  private async clearPairingCode(): Promise<void> {
    await (game as Game).settings.set(moduleId, SETTING_PAIRING_CODE, "");
  }

  /**
   * Get character token for a specific actor
   */
  async getCharacterToken(actorId: string): Promise<string | null> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) return null;
    
    const tokenData = actor.getFlag(moduleId, FLAG_CHARACTER_TOKEN) as HarkoniansCharacterToken | undefined;
    if (!tokenData?.token) return null;
    
    // Check if token is expired
    if (tokenData.expiresAt && new Date(tokenData.expiresAt) < new Date()) {
      return null;
    }
    
    return tokenData.token;
  }

  /**
   * Store character token for a specific actor
   */
  private async storeCharacterToken(actorId: string, token: string, expiresAt?: string): Promise<void> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) return;
    
    const tokenData: HarkoniansCharacterToken = {
      token,
      expiresAt,
      obtainedAt: new Date().toISOString(),
    };
    
    await actor.setFlag(moduleId, FLAG_CHARACTER_TOKEN, tokenData);
  }

  /**
   * Clear character token for a specific actor
   */
  private async clearCharacterToken(actorId: string): Promise<void> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) return;
    
    await actor.unsetFlag(moduleId, FLAG_CHARACTER_TOKEN);
  }

  /**
   * Make an authenticated request to the Harkonians API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    includeWorldSecret: boolean = false
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    
    // Add world secret if available and requested
    if (includeWorldSecret) {
      const worldSecret = await this.getWorldSecret();
      if (worldSecret) {
        headers.set("x-foundry-world-secret", worldSecret);
      }
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      try {
        return await response.json();
      } catch (e) {
        throw new Error("Invalid JSON response");
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timeout");
      }
      throw error;
    }
  }

  /**
   * Redeem a pairing code and obtain the world secret
   * This consumes the temporary pairing code and returns the persistent world secret
   */
  async redeemPairingCode(pairingCode: string): Promise<PairingConfirmResponse> {
    // Trim whitespace
    const code = pairingCode.trim();
    
    // Validate code format (basic check)
    if (!code || code.length < 10) {
      return {
        success: false,
        error: "Invalid pairing code format",
      };
    }
    
    const worldId = (game as Game).world?.id || "";
    
    const requestBody: PairingConfirmRequest = {
      pairingCode: code,
      foundryWorldId: worldId,
    };
    
    try {
      const response = await this.request<PairingConfirmResponse>(
        "/api/foundry/pair/confirm",
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        }
      );
      
      // Clear temporary pairing code from storage
      await this.clearPairingCode();
      
      // If successful and we got a world secret, store it
      if (response.success && response.worldSecret) {
        await this.storeWorldSecret(response.worldSecret);
      }
      
      return response;
    } catch (error) {
      // Clear temporary pairing code on error
      await this.clearPairingCode();
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Map known error responses
      if (errorMessage.includes("404") || errorMessage.includes("expired")) {
        return {
          success: false,
          error: "That pairing code has expired. Generate a new pairing code in Harkonians and try again.",
        };
      }
      
      if (errorMessage.includes("409") || errorMessage.includes("already used")) {
        return {
          success: false,
          error: "That pairing code has already been used. Generate a new pairing code in Harkonians.",
        };
      }
      
      if (errorMessage.includes("400") || errorMessage.includes("invalid")) {
        return {
          success: false,
          error: "Invalid pairing code.",
        };
      }
      
      return {
        success: false,
        error: `Pairing failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Create a character link request
   * This initiates the linking process for a Foundry Actor
   */
  async createCharacterLinkRequest(actorId: string): Promise<CharacterLinkResponse> {
    const worldSecret = await this.getWorldSecret();
    
    if (!worldSecret) {
      return {
        success: false,
        error: "World is not paired. Please pair the world with Harkonians first.",
      };
    }
    
    const worldId = (game as Game).world?.id || "";
    const actor = (game as Game).actors?.get(actorId);
    
    if (!actor) {
      return {
        success: false,
        error: "Character not found.",
      };
    }
    
    const requestBody: CharacterLinkRequest = {
      foundryWorldId: worldId,
      foundryActorId: actorId,
    };
    
    try {
      const response = await this.request<CharacterLinkResponse>(
        "/api/foundry/link",
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        },
        true // Include world secret in headers
      );
      
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        return {
          success: false,
          error: "World pairing is invalid. Please re-pair the world.",
        };
      }
      
      return {
        success: false,
        error: `Link request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get character authorization status
   * Checks if a character link request has been authorized
   */
  async getCharacterAuthorizationStatus(requestId: string): Promise<CharacterLinkResponse> {
    try {
      const response = await this.request<CharacterLinkResponse>(
        `/api/foundry/link/status?requestId=${encodeURIComponent(requestId)}`,
        { method: "GET" },
        true
      );
      
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to check authorization status: ${errorMessage}`,
      };
    }
  }

  /**
   * Get character state (balance, info)
   * This is the proof that the connection is working
   */
  async getCharacterState(actorId: string): Promise<CharacterStateResponse> {
    const worldSecret = await this.getWorldSecret();
    
    if (!worldSecret) {
      return {
        success: false,
        error: "World is not paired.",
      };
    }
    
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      return {
        success: false,
        error: "Character not found.",
      };
    }
    
    // Get the character token for this actor
    const characterToken = await this.getCharacterToken(actorId);
    
    if (!characterToken) {
      return {
        success: false,
        error: "Character is not authorized.",
      };
    }
    
    try {
      const response = await this.request<CharacterStateResponse>(
        "/api/foundry/character",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${characterToken}`,
          },
        },
        true
      );
      
      // Validate that the response matches our actor
      if (response.success && response.character) {
        // Additional validation can be added here
        return response;
      }
      
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        // Token might be invalid, clear it
        await this.clearCharacterToken(actorId);
        return {
          success: false,
          error: "Character authorization is invalid. Please link the character again.",
        };
      }
      
      return {
        success: false,
        error: `Failed to get character state: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if the world is paired and the secret is valid
   */
  async checkWorldStatus(): Promise<WorldStatusResponse> {
    const worldSecret = await this.getWorldSecret();
    
    if (!worldSecret) {
      return {
        success: true,
        paired: false,
      };
    }
    
    try {
      const response = await this.request<WorldStatusResponse>(
        "/api/foundry/world/status",
        { method: "GET" },
        true
      );
      
      return response;
    } catch (error) {
      // If we get an error with a stored secret, it might be invalid
      const errorMessage = error instanceof Error ? error.message : "";
      
      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        return {
          success: true,
          paired: false,
          error: "credential-invalid",
        };
      }
      
      return {
        success: false,
        paired: false,
        error: errorMessage || "Server error",
      };
    }
  }

  /**
   * Revoke character connection
   */
  async revokeCharacterConnection(actorId: string): Promise<{ success: boolean; error?: string }> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      return { success: false, error: "Character not found." };
    }
    
    // Clear the character token
    await this.clearCharacterToken(actorId);
    
    // Clear the connection flag
    await actor.unsetFlag(moduleId, FLAG_CONNECTION);
    
    return { success: true };
  }

  /**
   * Unpair the world
   */
  async unpairWorld(): Promise<{ success: boolean; error?: string }> {
    // Clear all character connections
    const actors = (game as Game).actors?.filter((a: Actor) => a.type === "character");
    
    for (const actor of actors || []) {
      await this.revokeCharacterConnection(actor.id);
    }
    
    // Clear world secret
    await (game as Game).settings.set(moduleId, SETTING_WORLD_SECRET, "");
    await (game as Game).settings.set(moduleId, SETTING_PAIRING_ATTEMPT, "");
    await (game as Game).settings.set(moduleId, SETTING_PAIRED_AT, "");
    
    return { success: true };
  }

  /**
   * Open a URL in the user's browser
   */
  async openBrowser(url: string): Promise<void> {
    // Foundry v13 provides ui.notifications and window.open
    window.open(url, "_blank");
  }

  /**
   * Get the connection status for the world
   */
  async getWorldConnectionStatus(): Promise<ConnectionStatus> {
    try {
      const worldSecret = await this.getWorldSecret();
      
      if (!worldSecret) {
        return "disconnected";
      }
      
      const status = await this.checkWorldStatus();
      
      if (!status.success) {
        return "server-unavailable";
      }
      
      if (status.paired === false && status.error === "credential-invalid") {
        return "credential-invalid";
      }
      
      if (status.paired) {
        return "connected";
      }
      
      return "disconnected";
    } catch (error) {
      return "server-unavailable";
    }
  }

  /**
   * Get the connection status for a specific character
   */
  async getCharacterConnectionStatus(actorId: string): Promise<CharacterConnectionStatus> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      return "not-connected";
    }
    
    const connectionData = actor.getFlag(moduleId, FLAG_CONNECTION) as HarkoniansConnectionData | undefined;
    
    if (!connectionData?.harkoniansCharacterId) {
      return "not-connected";
    }
    
    const characterToken = await this.getCharacterToken(actorId);
    
    if (!characterToken) {
      return "authorization-required";
    }
    
    try {
      const state = await this.getCharacterState(actorId);
      
      if (state.success && state.character) {
        return "connected";
      }
      
      if (state.error?.includes("invalid") || state.error?.includes("revoked")) {
        return "invalid-credential";
      }
      
      return "authorization-required";
    } catch (error) {
      return "server-unavailable";
    }
  }

  /**
   * Store connection data for a character
   */
  async storeCharacterConnection(
    actorId: string,
    harkoniansCharacterId: string,
    characterName: string,
    characterToken: string,
    tokenExpiresAt?: string
  ): Promise<void> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) return;
    
    const systemData = (game as Game).system;
    const connectionData: HarkoniansConnectionData = {
      harkoniansCharacterId,
      linkedAt: new Date().toISOString(),
      characterName,
      systemId: systemData.id,
      systemVersion: (systemData as unknown as { version?: string }).version,
    };
    
    await actor.setFlag(moduleId, FLAG_CONNECTION, connectionData);
    await this.storeCharacterToken(actorId, characterToken, tokenExpiresAt);
  }

  /**
   * Publish an Item to the Harkonians store
   */
  async publishStoreItem(
    item: Item,
    storeMetadata: {
      price: number;
      denomination: CurrencyDenomination;
      stock: number | null;
      storeDescription?: string;
      storeImage?: string;
    }
  ): Promise<PublishStoreItemResponse> {
    const worldSecret = await this.getWorldSecret();
    
    if (!worldSecret) {
      return {
        success: false,
        error: "World is not paired with Harkonians. Please pair the world first.",
      };
    }
    
    const worldId = (game as Game).world?.id || "";
    const systemData = (game as Game).system;
    
    // Sanitize the Item data - remove document-instance fields
    const sanitizedItemData = this.sanitizeItemForExport(item);
    
    const requestBody: PublishStoreItemRequest = {
      foundryWorldId: worldId,
      foundryItemId: item.id ?? "",
      foundryItemUuid: item.uuid ?? "",
      foundrySystemId: systemData.id,
      foundrySystemVersion: (systemData as unknown as { version?: string }).version || "",
      
      name: item.name ?? "",
      type: item.type ?? "",
      img: item.img ?? undefined,
      
      price: storeMetadata.price,
      denomination: storeMetadata.denomination,
      stock: storeMetadata.stock,
      
      storeDescription: storeMetadata.storeDescription,
      storeImage: storeMetadata.storeImage,
      
      foundryItemData: sanitizedItemData,
    };
    
    // Check if this Item is already published
    const existingFlag = item.getFlag(moduleId, FLAG_STORE_ITEM) as StoreItemFlagData | undefined;
    
    try {
      const endpoint = existingFlag?.storeItemId 
        ? `/api/foundry/store/items/${encodeURIComponent(existingFlag.storeItemId)}`
        : `/api/foundry/store/items`;
      
      const method = existingFlag?.storeItemId ? "PUT" : "POST";
      
      const response = await this.request<PublishStoreItemResponse>(
        endpoint,
        {
          method,
          body: JSON.stringify(requestBody),
        },
        true // Include world secret
      );
      
      // If successful and we got a storeItemId, store it in the Item flag
      if (response.success && response.storeItemId) {
        const flagData: StoreItemFlagData = {
          storeItemId: response.storeItemId,
          publishedAt: existingFlag?.publishedAt || new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        };
        
        await item.setFlag(moduleId, FLAG_STORE_ITEM, flagData);
      }
      
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Map known error responses
      if (errorMessage.includes("401")) {
        return {
          success: false,
          error: "Your Harkonians authorization has expired.",
        };
      }
      
      if (errorMessage.includes("403")) {
        return {
          success: false,
          error: "You are not authorized to publish Items for this world.",
        };
      }
      
      if (errorMessage.includes("404")) {
        return {
          success: false,
          error: "The Harkonians world or campaign could not be found.",
        };
      }
      
      if (errorMessage.includes("409")) {
        return {
          success: false,
          error: "An Item with this Harkonians source already exists.",
        };
      }
      
      if (errorMessage.includes("5") && errorMessage.includes("HTTP")) {
        return {
          success: false,
          error: "Harkonians is temporarily unavailable.",
        };
      }
      
      return {
        success: false,
        error: `Failed to publish item: ${errorMessage}`,
      };
    }
  }

  /**
   * Get store Item flag from an Item
   */
  getStoreItemFlag(item: Item): StoreItemFlagData | null {
    const flag = item.getFlag(moduleId, FLAG_STORE_ITEM) as StoreItemFlagData | undefined;
    return flag || null;
  }

  /**
   * Sanitize Item data for export - remove document-instance fields
   */
  private sanitizeItemForExport(item: Item): object {
    // Get the complete source data
    const source = item.toObject(true) as Record<string, unknown>;
    
    // Create a copy we can safely modify
    const sanitized: Record<string, unknown> = { ...source };
    
    // Remove instance-specific IDs (they may be null or string)
    if ("_id" in sanitized) {
      delete sanitized._id;
    }
    if ("id" in sanitized) {
      delete sanitized.id;
    }
    
    // Remove collection reference
    if ("collection" in sanitized) {
      delete sanitized.collection;
    }
    
    // Remove ownership data
    if ("ownership" in sanitized) {
      delete sanitized.ownership;
    }
    
    // Remove folder reference (instance-specific)
    if ("folder" in sanitized) {
      delete sanitized.folder;
    }
    
    // Remove sort order
    if ("sort" in sanitized) {
      delete sanitized.sort;
    }
    
    // Remove flags that are module-specific and not meant for export
    if (sanitized.flags && typeof sanitized.flags === "object") {
      const flags = { ...(sanitized.flags as Record<string, unknown>) };
      
      if (flags[moduleId] && typeof flags[moduleId] === "object") {
        // Keep the storeItem flag if it exists
        const moduleFlags = { ...(flags[moduleId] as Record<string, unknown>) };
        // Remove temporary flags but keep storeItem
        delete moduleFlags.pairingCode;
        delete moduleFlags.worldSecret;
        
        if (Object.keys(moduleFlags).length > 0) {
          flags[moduleId] = moduleFlags;
        } else {
          delete flags[moduleId];
        }
        
        sanitized.flags = flags;
      }
    }
    
    return sanitized;
  }

  /**
   * Check if an Item is already published to the store
   */
  async isItemPublished(item: Item): Promise<boolean> {
    return !!this.getStoreItemFlag(item);
  }
}
