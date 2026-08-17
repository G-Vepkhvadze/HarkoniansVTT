import { moduleId } from "../constants";
import type { BaseUser } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/documents.mjs/baseUser";

export default class HarkoniansApp extends Application {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  override getData(_options?: Partial<ApplicationOptions> | undefined): any {
    const isPaired = !!(game as Game).settings.get(moduleId, "worldCredential");
    const userInfo = (game as Game).user as BaseUser | null;
    const isGM = userInfo?.isGM || false;
    
    const actors = (game as Game).actors?.filter(
      (a: Actor) => a.type === "character" && (userInfo ? a.testUserPermission(userInfo, "OWNER") : false)
    ) || [];

    return {
      isPaired,
      isGM,
      hasCharacters: actors.length > 0,
      characters: actors.map((a: Actor) => ({
        id: a.id,
        name: a.name,
        img: a.img || "icons/svg/mystery-man.svg",
        linked: this.isLinked(a),
      })),
      apiKey: (game as Game).settings.get(moduleId, "apiKey"),
    };
  }

  private isLinked(actor: Actor): boolean {
    const flags = actor.getFlag(moduleId, "connection") as { harkoniansCharacterId?: string } | undefined;
    return !!(flags?.harkoniansCharacterId);
  }

  override activateListeners(html: JQuery<HTMLElement>): void {
    super.activateListeners(html);

    // Pair world button
    html.find("#pair-world").on("click", () => this.pairWorld());
    
    // Link character buttons
    html.find(".link-char").on("click", (e) => this.linkCharacter($(e.currentTarget).data("actor-id")));
    
    // Open store buttons
    html.find(".open-store").on("click", (e) => this.openStore($(e.currentTarget).data("actor-id")));
    
    // Save API key
    html.find("#save-api-key").on("click", () => this.saveApiKey(html));
  }

  private async pairWorld(): Promise<void> {
    const userInfo = (game as Game).user;
    if (!userInfo?.isGM) return;

    const credential = prompt((game as Game).i18n.localize("HARKONIANS.enterWorldCredential"));
    if (!credential) return;

    await (game as Game).settings.set(moduleId, "worldCredential", credential);
    await (game as Game).settings.set(moduleId, "pairedAt", new Date().toISOString());
    
    ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.worldPairedSuccess"));
    this.close();
  }

  private async linkCharacter(actorId: string): Promise<void> {
    const actor = (game as Game).actors?.get(actorId);
    if (!actor) return;

    const characterId = prompt((game as Game).i18n.format("HARKONIANS.enterCharacterId", { name: actor.name }));
    if (!characterId) return;

    await actor.setFlag(moduleId, "connection", {
      harkoniansCharacterId: characterId,
      linkedAt: new Date().toISOString(),
      importedPurchases: [],
    });

    ui.notifications?.info((game as Game).i18n.format("HARKONIANS.characterLinked", { name: actor.name }));
    this.close();
  }

  private openStore(_actorId: string): void {
    window.open("https://harkonians.quest/store", "_blank");
  }

  private async saveApiKey(html: JQuery<HTMLElement>): Promise<void> {
    const apiKey = html.find("#api-key-input").val() as string;
    await (game as Game).settings.set(moduleId, "apiKey", apiKey);
    ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.apiKeySaved"));
  }
}
