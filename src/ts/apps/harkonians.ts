import { moduleId } from "../constants";
import { 
  HarkoniansAPIClient,
  SETTING_PAIRING_CODE,
  FLAG_CONNECTION,
} from "../api/client";
import type { BaseUser } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/documents.mjs/baseUser";

// Polling interval for checking authorization status (5 seconds)
const POLL_INTERVAL_MS = 5000;
// Maximum number of polling attempts
const MAX_POLL_ATTEMPTS = 12; // 60 seconds total

export default class HarkoniansApp extends Application {
  private apiClient: HarkoniansAPIClient;
  private pollingInterval: number | null = null;
  private pollAttempts = 0;
  
  // Current pending authorization request ID and actor ID
  private pendingRequestId: string | null = null;
  private pendingActorId: string | null = null;

  static override get defaultOptions(): ApplicationOptions {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "harkonians-app",
      title: (game as Game).i18n.localize("HARKONIANS.characterManagerTitle"),
      template: `modules/${moduleId}/templates/harkonians.hbs`,
      width: 600,
      height: "auto",
      closeOnSubmit: false,
      classes: ["harkonians-app"],
    }) as ApplicationOptions;
  }

  constructor(options: Partial<ApplicationOptions> = {}) {
    super(options);
    this.apiClient = HarkoniansAPIClient.getInstance();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  override async getData(_options?: Partial<ApplicationOptions> | undefined): Promise<any> {
    const worldStatus = await this.apiClient.getWorldConnectionStatus();
    const userInfo = (game as Game).user as BaseUser | null;
    const isGM = userInfo?.isGM || false;
    
    const actors = (game as Game).actors?.filter(
      (a: Actor) => a.type === "character" && (userInfo ? a.testUserPermission(userInfo as BaseUser, "OWNER") : false)
    ) || [];

    // Get connection status for each character
    const characters = await Promise.all(actors.map(async (a: Actor) => {
      const flags = a.getFlag(moduleId, FLAG_CONNECTION) as { 
        harkoniansCharacterId?: string;
        characterName?: string;
        linkedAt?: string;
      } | undefined;
      
      const actorId = a.id ?? "";
      const status = await this.apiClient.getCharacterConnectionStatus(actorId);
      
      return {
        id: a.id,
        name: a.name,
        img: a.img || "icons/svg/mystery-man.svg",
        linked: !!(flags?.harkoniansCharacterId),
        harkoniansCharacterName: flags?.characterName,
        linkedAt: flags?.linkedAt,
        connectionStatus: status,
        hasToken: await this.hasCharacterToken(actorId),
      };
    }));

    return {
      isPaired: worldStatus === "connected",
      worldStatus: worldStatus,
      isGM,
      hasCharacters: characters.length > 0,
      characters,
      apiKey: (game as Game).settings.get(moduleId, "apiKey"),
      pairingCodeHint: (game as Game).i18n.localize("HARKONIANS.pairingCodeHint"),
      pairingInProgress: !!this.pendingRequestId,
    };
  }

  private async hasCharacterToken(actorId: string): Promise<boolean> {
    try {
      const token = await this.apiClient.getCharacterToken(actorId);
      return !!token;
    } catch {
      return false;
    }
  }

  override activateListeners(html: JQuery<HTMLElement>): void {
    super.activateListeners(html);

    // Pair world button
    html.find("#pair-world").on("click", () => this.startPairing());
    
    // Unpair world button (GM only)
    html.find("#unpair-world").on("click", () => this.confirmUnpairWorld());
    
    // Link character buttons
    html.find(".link-char").on("click", (e) => {
      const actorId = $(e.currentTarget).data("actor-id") as string;
      this.linkCharacter(actorId);
    });
    
    // Open store buttons
    html.find(".open-store").on("click", (e) => {
      const actorId = $(e.currentTarget).data("actor-id") as string;
      this.openStore(actorId);
    });
    
    // Sync button
    html.find(".sync-char").on("click", (e) => {
      const actorId = $(e.currentTarget).data("actor-id") as string;
      this.syncCharacter(actorId);
    });
    
    // Unlink character buttons
    html.find(".unlink-char").on("click", (e) => {
      const actorId = $(e.currentTarget).data("actor-id") as string;
      this.confirmUnlinkCharacter(actorId);
    });
    
    // Save API key
    html.find("#save-api-key").on("click", () => this.saveApiKey(html));
    
    // Check pairing code and pair
    html.find("#submit-pairing-code").on("click", () => this.submitPairingCode(html));
    
    // Cancel pairing
    html.find("#cancel-pairing").on("click", () => this.cancelPairing());
    
    // Check connection status
    html.find("#check-connection").on("click", () => this.checkWorldConnection());
  }

  override async close(options?: { force?: boolean }): Promise<void> {
    // Stop any ongoing polling
    this.stopPolling();
    
    // Clear temporary pairing code from UI
    await (game as Game).settings.set(moduleId, SETTING_PAIRING_CODE, "");
    
    super.close(options);
  }

  /**
   * Start the pairing process - show pairing code input
   */
  private async startPairing(): Promise<void> {
    const userInfo = (game as Game).user;
    if (!userInfo?.isGM) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.pairingRequiresGM"));
      return;
    }

    this.render(true);
  }

  /**
   * Submit pairing code for validation
   */
  private async submitPairingCode(html: JQuery<HTMLElement>): Promise<void> {
    const pairingCodeInput = html.find("#pairing-code-input");
    const pairingCode = pairingCodeInput.val() as string;
    
    if (!pairingCode || pairingCode.trim().length === 0) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.pairingCodeRequired"));
      return;
    }

    // Show loading state
    ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.pairingInProgress"));
    
    try {
      const response = await this.apiClient.redeemPairingCode(pairingCode);
      
      if (response.success && response.worldSecret) {
        // Clear the input
        pairingCodeInput.val("");
        
        // Pairing successful!
        ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.pairingComplete"));
        
        // Refresh the UI
        this.render(true);
      } else if (response.error) {
        ui.notifications?.error(response.error);
      } else {
        ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.pairingFailed"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.pairingError"));
      console.error("Pairing error:", error);
    }
  }

  /**
   * Cancel the pairing process
   */
  private async cancelPairing(): Promise<void> {
    const html = $(this.element);
    html.find("#pairing-code-input").val("");
    await (game as Game).settings.set(moduleId, SETTING_PAIRING_CODE, "");
    this.render(true);
  }

  /**
   * Confirm unpairing the world
   */
  private async confirmUnpairWorld(): Promise<void> {
    const userInfo = (game as Game).user;
    if (!userInfo?.isGM) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.pairingRequiresGM"));
      return;
    }

    const confirmed = await Dialog.confirm({
      title: (game as Game).i18n.localize("HARKONIANS.confirmUnpair"),
      content: (game as Game).i18n.localize("HARKONIANS.confirmUnpairMessage"),
    });

    if (confirmed) {
      await this.unpairWorld();
    }
  }

  /**
   * Unpair the world
   */
  private async unpairWorld(): Promise<void> {
    try {
      const result = await this.apiClient.unpairWorld();
      
      if (result.success) {
        ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.unpairComplete"));
        this.render(true);
      } else {
        ui.notifications?.error(result.error || (game as Game).i18n.localize("HARKONIANS.unpairFailed"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.unpairFailed"));
      console.error("Unpair error:", error);
    }
  }

  /**
   * Link a character to Harkonians
   */
  private async linkCharacter(actorId: string): Promise<void> {
    const worldStatus = await this.apiClient.getWorldConnectionStatus();
    
    if (worldStatus !== "connected") {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.worldNotPaired"));
      return;
    }

    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.actorNotFound"));
      return;
    }

    ui.notifications?.info((game as Game).i18n.format("HARKONIANS.linkingStarted", { name: actor.name }));

    try {
      const response = await this.apiClient.createCharacterLinkRequest(actorId);
      
      if (response.success && response.authorizationUrl) {
        // Store pending request info
        this.pendingRequestId = response.requestId || null;
        this.pendingActorId = actorId;
        this.pollAttempts = 0;
        
        // Open the authorization URL in the browser
        await this.apiClient.openBrowser(response.authorizationUrl);
        
        ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.authorizationInBrowser"));
        
        // Start polling for authorization completion
        this.startAuthorizationPolling();
        
        // Close the dialog - the polling will handle updates
        this.close();
      } else if (response.error) {
        ui.notifications?.error(response.error);
      } else {
        ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.linkingError"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.linkingError"));
      console.error("Link error:", error);
    }
  }

  /**
   * Start polling for character authorization completion
   */
  private startAuthorizationPolling(): void {
    this.stopPolling();
    
    this.pollingInterval = window.setInterval(() => {
      this.checkAuthorizationStatus();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Stop polling for authorization
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.pollAttempts = 0;
  }

  /**
   * Check if the pending authorization has completed
   */
  private async checkAuthorizationStatus(): Promise<void> {
    if (!this.pendingRequestId || !this.pendingActorId) {
      this.stopPolling();
      return;
    }

    this.pollAttempts++;
    
    // Stop if we've exceeded max attempts
    if (this.pollAttempts > MAX_POLL_ATTEMPTS) {
      ui.notifications?.warn((game as Game).i18n.localize("HARKONIANS.authorizationTimeout"));
      this.stopPolling();
      this.pendingRequestId = null;
      this.pendingActorId = null;
      return;
    }

    try {
      const response = await this.apiClient.getCharacterAuthorizationStatus(this.pendingRequestId);
      
      if (response.success) {
        if (response.characterId) {
          // Authorization complete!
          this.stopPolling();
          
          const actor = (game as Game).actors?.get(this.pendingActorId);
          if (actor) {
            // Store connection data
            // Note: In a real implementation, the API would return the character token
            // which we would store securely
            const systemData = (game as Game).system;
            const connectionData = {
              harkoniansCharacterId: response.characterId,
              linkedAt: new Date().toISOString(),
              characterName: response.characterId,
              systemId: systemData.id,
              systemVersion: (systemData as unknown as { version?: string }).version || "unknown",
            };
            
            await actor.setFlag(moduleId, FLAG_CONNECTION, connectionData);
            
            ui.notifications?.info(
              (game as Game).i18n.format("HARKONIANS.characterLinked", { 
                name: actor.name,
                harkoniansName: response.characterId
              })
            );
          }
          
          this.pendingRequestId = null;
          this.pendingActorId = null;
        }
        // If still pending, continue polling
      } else if (response.error) {
        this.stopPolling();
        ui.notifications?.error(response.error);
        this.pendingRequestId = null;
        this.pendingActorId = null;
      }
      
    } catch (error) {
      console.error("Authorization poll error:", error);
      this.stopPolling();
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.authorizationError"));
      this.pendingRequestId = null;
      this.pendingActorId = null;
    }
  }

  /**
   * Open the store for a linked character
   */
  private openStore(actorId: string): void {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.actorNotFound"));
      return;
    }

    const connectionData = actor.getFlag(moduleId, FLAG_CONNECTION) as { 
      harkoniansCharacterId?: string;
    } | undefined;
    
    if (!connectionData?.harkoniansCharacterId) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.characterNotLinked"));
      return;
    }

    // Open the store with the character ID
    window.open(`https://harkonians.quest/store?characterId=${encodeURIComponent(connectionData.harkoniansCharacterId)}`, "_blank");
  }

  /**
   * Sync a character's state (refresh connection and balance)
   */
  private async syncCharacter(actorId: string): Promise<void> {
    try {
      const response = await this.apiClient.getCharacterState(actorId);
      
      if (response.success && response.character) {
        ui.notifications?.info(
          (game as Game).i18n.format("HARKONIANS.syncSuccess", {
            name: response.character.name,
            balance: response.character.creditBalance,
          })
        );
      } else if (response.error) {
        ui.notifications?.error(response.error);
      } else {
        ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.syncFailed"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.syncFailed"));
      console.error("Sync error:", error);
    }
  }

  /**
   * Confirm unlinking a character
   */
  private async confirmUnlinkCharacter(actorId: string): Promise<void> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.actorNotFound"));
      return;
    }

    const confirmed = await Dialog.confirm({
      title: (game as Game).i18n.localize("HARKONIANS.confirmUnlink"),
      content: (game as Game).i18n.format("HARKONIANS.confirmUnlinkMessage", { name: actor.name }),
    });

    if (confirmed) {
      await this.unlinkCharacter(actorId);
    }
  }

  /**
   * Unlink a character from Harkonians
   */
  private async unlinkCharacter(actorId: string): Promise<void> {
    try {
      const result = await this.apiClient.revokeCharacterConnection(actorId);
      
      if (result.success) {
        ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.unlinkComplete"));
        this.render(true);
      } else {
        ui.notifications?.error(result.error || (game as Game).i18n.localize("HARKONIANS.unlinkFailed"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.unlinkFailed"));
      console.error("Unlink error:", error);
    }
  }

  /**
   * Save the API key
   */
  private async saveApiKey(html: JQuery<HTMLElement>): Promise<void> {
    const apiKey = html.find("#api-key-input").val() as string;
    await (game as Game).settings.set(moduleId, "apiKey", apiKey);
    ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.apiKeySaved"));
  }

  /**
   * Check the world connection status
   */
  private async checkWorldConnection(): Promise<void> {
    try {
      const status = await this.apiClient.getWorldConnectionStatus();
      
      let message: string;
      switch (status) {
        case "connected":
          message = (game as Game).i18n.localize("HARKONIANS.worldConnected");
          break;
        case "disconnected":
          message = (game as Game).i18n.localize("HARKONIANS.worldDisconnected");
          break;
        case "credential-invalid":
          message = (game as Game).i18n.localize("HARKONIANS.worldCredentialInvalid");
          break;
        case "server-unavailable":
          message = (game as Game).i18n.localize("HARKONIANS.serverUnavailable");
          break;
        case "pairing":
          message = (game as Game).i18n.localize("HARKONIANS.pairingInProgress");
          break;
        default:
          message = (game as Game).i18n.localize("HARKONIANS.connectionUnknown");
      }
      
      ui.notifications?.info(message);
      this.render(true);
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.checkConnectionFailed"));
      console.error("Connection check error:", error);
    }
  }
}
