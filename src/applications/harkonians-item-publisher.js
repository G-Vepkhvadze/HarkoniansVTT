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
 * Convert a Foundry-local image path into base64 data.
 *
 * Remote HTTP(S) images are left as URLs because the
 * Emporium can download those directly.
 *
 * @param {string} imagePath
 * @returns {Promise<Object|null>}
 */
async function prepareImagePayload(imagePath) {
    if (
        !imagePath ||
        typeof imagePath !== "string"
    ) {
        return null;
    }

    const trimmed =
        imagePath.trim();

    if (!trimmed) {
        return null;
    }

    /*
     * Remote URL.
     *
     * The Emporium can download this itself, so there is
     * no reason to transfer the image bytes through Foundry.
     */
    if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
    ) {
        return {
            type: "url",
            url: trimmed
        };
    }

    /*
     * Data URI.
     *
     * Some Foundry assets can potentially already be represented
     * as inline data.
     */
    if (
        trimmed.startsWith("data:")
    ) {
        const match =
            trimmed.match(
                /^data:([^;]+);base64,(.+)$/s
            );

        if (!match) {
            throw new Error(
                "Foundry image data URI is invalid."
            );
        }

        return {
            type: "base64",
            contentType: match[1],
            fileName: "foundry-image",
            data: match[2]
        };
    }

    /*
     * Foundry-local path.
     *
     * Fetch the actual asset from the running Foundry server.
     */
    try {
        const response =
            await fetch(trimmed);

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const blob =
            await response.blob();

        const arrayBuffer =
            await blob.arrayBuffer();

        const bytes =
            new Uint8Array(arrayBuffer);

        /*
         * Convert Uint8Array to base64 without using
         * String.fromCharCode(...bytes) on the entire file,
         * which can overflow the argument limit for larger images.
         */
        const chunkSize = 0x8000;
        let binary = "";

        for (
            let offset = 0;
            offset < bytes.length;
            offset += chunkSize
        ) {
            const chunk =
                bytes.subarray(
                    offset,
                    Math.min(
                        offset + chunkSize,
                        bytes.length
                    )
                );

            binary += String.fromCharCode(
                ...chunk
            );
        }

        const base64 =
            btoa(binary);

        const fileName =
            trimmed
                .split("/")
                .pop()
                ?.split("?")[0]
                ?.split("#")[0]
            || "foundry-image";

        return {
            type: "base64",
            contentType:
                blob.type ||
                "application/octet-stream",
            fileName,
            data: base64
        };

    } catch (error) {
        console.error(
            "HarkoniansVTT | Failed to read Foundry image:",
            trimmed,
            error
        );

        throw new Error(
            `Failed to read Foundry image "${trimmed}".`
        );
    }
}


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

        const storeItemId =
            item.getFlag(
                "harkoniansvtt",
                "storeItemId"
            );

        return {
            item: {
                id: item.id,
                name: item.name,
                type: item.type,
                img: item.img,
                uuid: item.uuid
            },

            alreadyPublished:
                Boolean(storeItemId),

            storeItemId
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

        const item =
            application.item;

        if (!item) {
            ui.notifications.error(
                "Harkonians | No Foundry Item."
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

        // ---------------------------------------------------------
        // Price
        // ---------------------------------------------------------

        const priceGp =
            Number(
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

        // ---------------------------------------------------------
        // Stock
        //
        // Empty = unlimited
        // Number = exact stock amount to add
        // ---------------------------------------------------------

        const stockRaw =
            String(
                formData.get("stock") ?? ""
            ).trim();

        let stock = null;

        if (stockRaw !== "") {
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

        // ---------------------------------------------------------
        // Prepare image
        // ---------------------------------------------------------

        let imageData = null;

        try {
            imageData =
                await prepareImagePayload(
                    item.img
                );
        } catch (error) {
            console.error(
                "HarkoniansVTT | Image preparation failed:",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to prepare the Foundry image."
            );

            return;
        }

        // ---------------------------------------------------------
        // Build payload
        // ---------------------------------------------------------

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

            /*
             * Keep the original Foundry image reference.
             * This is useful for source metadata and debugging.
             */
            image:
                item.img,

            /*
             * Contains the actual image when Foundry is using
             * a local path, or a URL descriptor for remote images.
             */
            imageData,

            priceGp,

            stock,

            /*
             * This is the original Foundry Item JSON.
             * The marketplace description sanitizer does not
             * modify this data.
             */
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

            /*
             * Keep the Store Item ID on the Foundry Item.
             *
             * This does NOT prevent future publishing.
             */
            await item.setFlag(
                "harkoniansvtt",
                "storeItemId",
                storeItemId
            );

            if (
                response?.addedToExistingStock === true
            ) {
                const addedStock =
                    response?.item?.stock;

                if (
                    typeof addedStock === "number"
                ) {
                    ui.notifications.info(
                        `${item.name} stock was increased. Total stock: ${addedStock}.`
                    );
                } else {
                    ui.notifications.info(
                        `${item.name} stock was increased in Harkonians.`
                    );
                }
            } else {
                ui.notifications.info(
                    `${item.name} was added to Harkonians.`
                );
            }

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
