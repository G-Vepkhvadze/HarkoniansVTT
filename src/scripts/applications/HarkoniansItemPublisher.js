/**
 * HarkoniansItemPublisher
 * Application for publishing items to Harkonians store
 */

import { HandlebarsApplicationMixin } from '../mixins/HandlebarsApplicationMixin.js';
import { api } from '../api/HarkoniansApi.js';
import { currencyToCopper, getWorldSecret } from '../main.js';

export class HarkoniansItemPublisher extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-item-publisher',
        classes: ['harkoniansvtt', 'harkonians-item-publisher'],
        position: {
            width: 700,
            height: 700
        },
        window: {
            title: 'Add Item to Harkonians',
            icon: 'fa-solid fa-store',
            resizable: true
        },
        actions: {
            selectItem: HarkoniansItemPublisher.#onSelectItem,
            publishItem: HarkoniansItemPublisher.#onPublishItem,
            updateItem: HarkoniansItemPublisher.#onUpdateItem
        }
    };

    static PARTS = {
        main: {
            template: 'modules/harkoniansvtt/templates/item-publisher.hbs'
        }
    };

    /**
     * @type {string|null}
     */
    selectedItemId = null;

    /**
     * @type {string}
     */
    searchQuery = '';

    /**
     * @type {number}
     */
    priceAmount = 0;

    /**
     * @type {'pp'|'gp'|'ep'|'sp'|'cp'}
     */
    priceDenomination = 'gp';

    /**
     * @type {'unlimited'|number}
     */
    stockValue = 'unlimited';

    /**
     * Prepare context for template rendering
     * @returns {Promise<Object>} The context object
     */
    async _prepareContext() {
        const worldSecret = getWorldSecret();
        
        // Get all world items
        const allItems = game.items.contents;
        
        // Filter based on search
        const filteredItems = allItems.filter(item => {
            if (!this.searchQuery) return true;
            const query = this.searchQuery.toLowerCase();
            return item.name.toLowerCase().includes(query);
        });

        // Build item list
        const items = filteredItems.map(item => {
            const storeItemId = item.getFlag('harkoniansvtt', 'storeItemId');
            
            return {
                id: item.id,
                name: item.name,
                type: item.type,
                img: item.img,
                rarity: item.system?.rarity ?? '',
                storeItemId: storeItemId || null,
                alreadyPublished: Boolean(storeItemId)
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        // Get selected item details if any
        let selectedItem = null;
        if (this.selectedItemId) {
            const item = game.items.get(this.selectedItemId);
            if (item) {
                selectedItem = {
                    id: item.id,
                    name: item.name,
                    type: item.type,
                    img: item.img
                };
            }
        }

        // Determine button label based on whether we're updating or publishing
        let publishButtonLabel = 'Send to Harkonians';
        if (selectedItem) {
            const item = game.items.get(selectedItem.id);
            if (item && item.getFlag('harkoniansvtt', 'storeItemId')) {
                publishButtonLabel = 'Update Harkonians Item';
            }
        }

        return {
            items,
            selectedItem,
            searchQuery: this.searchQuery,
            priceAmount: this.priceAmount,
            priceDenomination: this.priceDenomination,
            stockValue: this.stockValue,
            publishButtonLabel,
            isPublishDisabled: !selectedItem
        };
    }

    /**
     * Handle select item action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onSelectItem(event, target) {
        const itemId = target.closest('[data-item-id]')?.dataset.itemId;
        if (!itemId) return;

        const app = foundry.applications.instances.get('harkonians-item-publisher');
        if (app) {
            app.selectedItemId = itemId;
            // Reset price and stock to defaults
            app.priceAmount = 0;
            app.priceDenomination = 'gp';
            app.stockValue = 'unlimited';
            await app.render({ force: true });
        }
    }

    /**
     * Handle publish/update item action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onPublishItem(event, target) {
        const app = foundry.applications.instances.get('harkonians-item-publisher');
        if (!app || !app.selectedItemId) {
            ui.notifications.warn('Please select an item first.');
            return;
        }

        const worldSecret = getWorldSecret();
        if (!worldSecret) {
            ui.notifications.error('World must be paired first.');
            return;
        }

        const item = game.items.get(app.selectedItemId);
        if (!item) {
            ui.notifications.error('The selected item no longer exists.');
            return;
        }

        // Check if we're updating or creating
        const existingStoreItemId = item.getFlag('harkoniansvtt', 'storeItemId');
        
        try {
            // Build the payload
            const payload = await app.#buildPublishPayload(item, existingStoreItemId);
            
            let response;
            if (existingStoreItemId) {
                // Update existing item
                response = await api.updateItem(worldSecret, existingStoreItemId, payload);
            } else {
                // Publish new item
                response = await api.publishItem(worldSecret, payload);
            }

            if (response.success) {
                // Store the store item ID on the original item
                await item.setFlag('harkoniansvtt', 'storeItemId', response.item?.id || response.id);
                
                ui.notifications.info(`Item ${existingStoreItemId ? 'updated' : 'added'} to Harkonians. Store ID: ${response.item?.id || response.id}`);
                
                // Refresh the app
                await app.render({ force: true });
            } else {
                ui.notifications.error(response.message || 'Failed to publish item.');
            }
        } catch (error) {
            ui.notifications.error(error.message);
        }
    }

    /**
     * Handle update item action (alias for publish for existing items)
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onUpdateItem(event, target) {
        // Same as publish - the button label changes but the action is the same
        await this.#onPublishItem(event, target);
    }

    /**
     * Build the publish payload for an item
     * @param {Item} item - The Foundry item
     * @param {string|null} existingStoreItemId - Existing Harkonians item ID if updating
     * @returns {Promise<Object>} The publish payload
     * @private
     */
    async #buildPublishPayload(item, existingStoreItemId) {
        const app = this;
        
        // Get full item data with source
        const foundryItemData = structuredClone(item.toObject(true));
        
        // Remove instance-specific identity
        delete foundryItemData._id;
        delete foundryItemData._stats;

        // Calculate price in copper
        const priceCp = currencyToCopper(app.priceAmount, app.priceDenomination);

        // Determine stock value
        const stock = app.stockValue === 'unlimited' ? null : app.stockValue;

        return {
            foundryWorldId: game.world.id,
            foundryItemId: item.id,
            foundryItemUuid: item.uuid,
            foundrySystemId: game.system.id,
            foundrySystemVersion: game.system.version,
            name: item.name,
            type: item.type,
            description: item.system?.description?.value ?? item.system?.description ?? '',
            rarity: item.system?.rarity ?? '',
            image: item.img,
            priceCp: priceCp,
            stock: stock,
            foundryItemData
        };
    }
}
