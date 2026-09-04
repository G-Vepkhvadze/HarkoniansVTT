
import { publishItem } from "../api/client.js";

import {
    getWorldSecret,
    isWorldLinked
} from "../state.js";

import {
    buildFoundryItemData,
    getApplicationFromAction,
    getItemDescription
} from "../utils.js";


const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;


const HarkoniansPublisherBase =
    HandlebarsApplicationMixin(ApplicationV2);


/**
 * Application for adding one specific Foundry Item
 * to the Harkonians store.
 */
export class HarkoniansItemPublisher
    extends HarkoniansPublisherBase {

    static DEFAULT_OPTIONS = {
        id: "harkonians-item-publisher",

        classes: [
            "harkoniansvtt",
            "harkonians-item-publisher"
        ],

        position: {
            width: 500,
            height: "auto"
        },

        window: {
            title: "Add to Harkonians",
            icon: "fa-solid fa-store",
            resizable: false
        },

        actions: {
            publishItem:
            HarkoniansItemPublisher.#onPublishItem,

            cancel:
            HarkoniansItemPublisher.#onCancel
        }
    };

    static PARTS = {
        main: {
            template:
                "modules/harkoniansvtt/templates/item-publisher.hbs"
        }
    };

    /**
     * The Foundry Item being published.
     *
     * @type {Item|null}
     */
    item = null;

    /**
     * @param {Item} item
     * @param {object} options
     */
    constructor(item, options = {}) {
        super(options);

        this.item = item;
    }

    /**
     * Prepare data for the Handlebars template.
     *
     * @returns {Promise<object>}
     */
    async _prepareContext() {
        const item = this.item;

        if (!item) {
            return {
                item: null,
                alreadyPublished: false
            };
        }

        const alreadyPublished =
            Boolean(
                item.getFlag(
                    "harkoniansvtt",
                    "storeItemId"
                )
            );

        return {
            item: {
                id: item.id,
                name: item.name,
                type: item.type,
                img: item.img,
                uuid: item.uuid
            },

            alreadyPublished
        };
    }

    /**
     * Close the publisher.
     *
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onCancel(event, target) {
        const application =
            getApplicationFromAction(
                target,
                this
            );

        if (!application) {
            return;
        }

        await application.close();
    }

    /**
     * Publish the selected Item to Harkonians.
     *
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onPublishItem(event, target) {
        const application =
            getApplicationFromAction(
                target,
                this
            );

        if (!application) {
            ui.notifications.error(
                "Harkonians | Could not open the item publisher."
            );
            return;
        }

        if (!isWorldLinked()) {
            ui.notifications.error(
                "Harkonians | This Foundry world is not linked."
            );
            return;
        }

        const item = application.item;

        if (!item) {
            ui.notifications.error(
                "Harkonians | No Foundry Item."
            );
            return;
        }

        const existingStoreItemId =
            item.getFlag(
                "harkoniansvtt",
                "storeItemId"
            );

        if (existingStoreItemId) {
            ui.notifications.info(
                `${item.name} is already in Harkonians.`
            );

            return;
        }

        const form =
            target.closest("form") ??
            application.element?.querySelector("form");

        if (!form) {
            console.error(
                "HarkoniansVTT | Could not find publisher form."
            );

            return;
        }

        const formData =
            new FormData(form);

        const priceGp = Number(
            formData.get("priceAmount")
        );

        if (
            !Number.isFinite(priceGp) ||
            priceGp < 0
        ) {
            ui.notifications.warn(
                "Price must be a valid non-negative GP amount."
            );

            return;
        }

        const stockRaw =
            String(
                formData.get("stock") ||
                "unlimited"
            );

        let stock = null;

        if (stockRaw !== "unlimited") {
            stock = Number(stockRaw);

            if (
                !Number.isInteger(stock) ||
                stock < 0
            ) {
                ui.notifications.warn(
                    "Stock must be a whole number of zero or greater."
                );

                return;
            }
        }

        const payload = {
            foundryWorldId:
            game.world.id,

            foundryItemId:
            item.id,

            foundryItemUuid:
            item.uuid,

            foundrySystemId:
            game.system.id,

            foundrySystemVersion:
            game.system.version,

            name:
            item.name,

            type:
            item.type,

            description:
                getItemDescription(item),

            rarity:
                item.system?.rarity ?? "",

            image:
            item.img,

            priceGp,

            stock,

            foundryItemData:
                buildFoundryItemData(item)
        };

        const publishButton =
            form.querySelector(
                '[data-action="publishItem"]'
            );

        if (publishButton) {
            publishButton.disabled = true;
        }

        try {
            const response =
                await publishItem(
                    getWorldSecret(),
                    payload
                );

            const storeItemId =
                response?.item?.id ??
                response?.id ??
                null;

            if (!storeItemId) {
                throw new Error(
                    "Harkonians did not return a Store Item ID."
                );
            }

            await item.setFlag(
                "harkoniansvtt",
                "storeItemId",
                storeItemId
            );

            ui.notifications.info(
                `${item.name} was added to Harkonians.`
            );

            await application.close();

        } catch (error) {
            console.error(
                "HarkoniansVTT | Item publishing failed",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to add the Item to Harkonians."
            );

            if (publishButton) {
                publishButton.disabled = false;
            }
        }
    }
}