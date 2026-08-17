import { moduleId } from "../constants";
import {
  HarkoniansAPIClient,
  CurrencyDenomination,
} from "../api/client";

export interface PublishItemDialogData {
  itemId: string;
  itemName: string;
  itemType: string;
  itemDescription: string;
  itemImg: string | null;
  isUpdate: boolean;
  existingStoreItemId?: string;
  existingPrice?: number;
  existingDenomination?: CurrencyDenomination;
  existingStock?: number | null;
  existingStoreDescription?: string;
  existingStoreImage?: string;
}

export default class PublishItemDialog extends FormApplication {
  private apiClient: HarkoniansAPIClient;
  private itemId: string;
  
  static override get defaultOptions(): FormApplicationOptions {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "harkonians-publish-item",
      title: (game as Game).i18n.localize("HARKONIANS.publishToStore"),
      template: `modules/${moduleId}/templates/publishItem.hbs`,
      width: 500,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
      classes: ["harkonians-publish-dialog"],
    }) as FormApplicationOptions;
  }

  constructor(itemId: string, options: Partial<FormApplicationOptions> = {}) {
    super(options);
    this.apiClient = HarkoniansAPIClient.getInstance();
    this.itemId = itemId;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  override async getData(_options?: Partial<FormApplicationOptions>): Promise<any> {
    const item = (game as Game).items?.get(this.itemId);
    
    if (!item) {
      throw new Error("Item not found");
    }

    const existingFlag = this.apiClient.getStoreItemFlag(item);
    
    // Get a preview of the description (truncate if too long)
    // Access system data safely
    const itemAny = item as unknown as {
      system?: { description?: { value?: string } | string };
      name?: string;
      type?: string;
      img?: string | null;
      id?: string | null;
    };
    
    const systemDesc = itemAny.system?.description;
    const rawDescription = (typeof systemDesc === "object" && systemDesc && "value" in systemDesc) 
      ? (systemDesc as { value?: string }).value || "" 
      : (typeof systemDesc === "string" ? systemDesc : "");
    
    const descriptionPreview = rawDescription.length > 200 
      ? rawDescription.substring(0, 200) + "..." 
      : rawDescription;
    
    return {
      itemId: itemAny.id ?? "",
      itemName: itemAny.name ?? "",
      itemType: itemAny.type ?? "",
      itemDescription: descriptionPreview,
      itemImg: itemAny.img ?? null,
      isUpdate: !!existingFlag,
      existingStoreItemId: existingFlag?.storeItemId,
    };
  }

  override activateListeners(html: JQuery<HTMLElement>): void {
    super.activateListeners(html);

    // Set up the stock toggle
    const unlimitedCheckbox = html.find("#stock-unlimited");
    const stockInput = html.find("#stock-quantity");
    
    unlimitedCheckbox.on("change", () => {
      stockInput.prop("disabled", unlimitedCheckbox.is(":checked"));
      if (unlimitedCheckbox.is(":checked")) {
        stockInput.val("");
      }
    });

    // Trigger change to set initial state
    unlimitedCheckbox.trigger("change");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  override async _updateObject(event: Event, _formData?: object): Promise<void> {
    event.preventDefault();
    
    const item = (game as Game).items?.get(this.itemId);
    if (!item) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.itemNotFound"));
      return;
    }

    const form = event.currentTarget as HTMLFormElement;
    const html = $(form);

    // Get form values
    const price = parseFloat(html.find("#price").val() as string) || 0;
    const denomination = html.find("#denomination").val() as CurrencyDenomination;
    const isUnlimited = html.find("#stock-unlimited").is(":checked");
    const stock = isUnlimited ? null : (parseInt(html.find("#stock-quantity").val() as string) || 1);
    const storeDescription = html.find("#store-description").val() as string || undefined;
    const storeImage = html.find("#store-image").val() as string || undefined;

    // Validate
    if (price <= 0) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.priceRequired"));
      return;
    }

    if (!denomination) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.denominationRequired"));
      return;
    }

    if (!isUnlimited && (!stock || stock <= 0)) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.stockRequired"));
      return;
    }

    // Show loading
    ui.notifications?.info((game as Game).i18n.localize("HARKONIANS.publishing"));

    try {
      const response = await this.apiClient.publishStoreItem(item, {
        price,
        denomination,
        stock,
        storeDescription,
        storeImage,
      });

      if (response.success && response.storeItemId) {
        ui.notifications?.info(
          (game as Game).i18n.format("HARKONIANS.publishSuccess", {
            name: item.name,
            storeItemId: response.storeItemId,
          })
        );
        this.close();
      } else if (response.error) {
        ui.notifications?.error(response.error);
      } else {
        ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.publishFailed"));
      }
    } catch (error) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.publishFailed"));
      console.error("Publish failed:", error);
    }
  }

  /**
   * Static method to check if an Item can be published (GM only, world paired)
   */
  static async canPublish(itemId: string): Promise<boolean> {
    const apiClient = HarkoniansAPIClient.getInstance();
    
    // Must be GM
    const user = (game as Game).user;
    if (!user?.isGM) {
      return false;
    }

    // World must be paired
    const worldStatus = await apiClient.getWorldConnectionStatus();
    if (worldStatus !== "connected") {
      return false;
    }

    // Item must exist
    const item = (game as Game).items?.get(itemId);
    if (!item) {
      return false;
    }

    return true;
  }

  /**
   * Static method to check if an Item is already published
   */
  static isPublished(itemId: string): boolean {
    const apiClient = HarkoniansAPIClient.getInstance();
    const item = (game as Game).items?.get(itemId);
    
    if (!item) {
      return false;
    }

    const flag = apiClient.getStoreItemFlag(item);
    return !!flag;
  }

  /**
   * Static method to get the store Item ID for an Item
   */
  static getStoreItemId(itemId: string): string | null {
    const apiClient = HarkoniansAPIClient.getInstance();
    const item = (game as Game).items?.get(itemId);
    
    if (!item) {
      return null;
    }

    const flag = apiClient.getStoreItemFlag(item);
    return flag?.storeItemId || null;
  }

  /**
   * Open the publish dialog for an Item
   */
  static async open(itemId: string): Promise<void> {
    const canPublish = await PublishItemDialog.canPublish(itemId);
    
    if (!canPublish) {
      ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.cannotPublish"));
      return;
    }

    const dialog = new PublishItemDialog(itemId);
    dialog.render(true);
  }

  /**
   * Add publish button to an Item sheet
   */
  static addPublishButtonToSheet(sheet: Application, html: JQuery<HTMLElement>): void {
    // Try to get the item from the sheet
    // In Foundry v13, sheets have a document property, but we need to access it safely
    const sheetAny = sheet as unknown as { document?: Item };
    const item = sheetAny.document;
    
    if (!item) {
      return;
    }

    // Only show for GM
    const user = (game as Game).user;
    if (!user?.isGM) {
      return;
    }

    const apiClient = HarkoniansAPIClient.getInstance();
    const isPublished = apiClient.getStoreItemFlag(item);
    
    const button = $(
      `<button class="harkonians-publish-btn" type="button" title="${(game as Game).i18n.localize("HARKONIANS.publishToStore")}">
        <i class="fas fa-store"></i>
        <span>${isPublished ? (game as Game).i18n.localize("HARKONIANS.updateStoreItem") : (game as Game).i18n.localize("HARKONIANS.publishToStore")}</span>
      </button>`
    );

    button.on("click", async () => {
      const canPublish = await PublishItemDialog.canPublish(item.id || "");
      
      if (canPublish) {
        PublishItemDialog.open(item.id || "");
      } else {
        ui.notifications?.error((game as Game).i18n.localize("HARKONIANS.cannotPublish"));
      }
    });

    // Add to the sheet header or action buttons
    const header = html.find(".window-header");
    if (header.length > 0) {
      header.append(button);
    } else {
      // Try to find a good place
      const title = html.find(".window-title");
      if (title.length > 0) {
        title.after(button);
      }
    }
  }
}
