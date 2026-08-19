/**
 * HarkoniansVTT - Foundry VTT V13 Implementation
 * Complete module for connecting Harkonians store to Foundry
 */

// ============================================
// HARKONIANS WORLD SECRET MANAGER
// ============================================

class HarkoniansWorldSecret {
    static namespace = 'harkoniansvtt';

    static getWorldSecret() {
        return game.world?.getFlag(this.namespace, 'worldSecret') ?? null;
    }

    static isConfigured() {
        return Boolean(this.getWorldSecret());
    }

    static async setWorldSecret(secret) {
        if (!game.world) throw new Error('No active world');
        await game.world.setFlag(this.namespace, 'worldSecret', secret);
        console.log('HarkoniansVTT | World secret configured');
    }

    static async removeWorldSecret() {
        if (!game.world) return;
        await game.world.unsetFlag(this.namespace, 'worldSecret');
        console.log('HarkoniansVTT | World secret removed');
    }
}

// ============================================
// HARKONIANS CONNECTION MANAGER
// ============================================

class HarkoniansConnection {
    static namespace = 'harkoniansvtt';

    static async initialize() {
        console.log('HarkoniansVTT | Connection manager initialized');
        if (!HarkoniansWorldSecret.isConfigured()) {
            console.warn('HarkoniansVTT | World secret not configured. API calls will fail.');
            ui.notifications?.warn('HarkoniansVTT: World secret not configured. Configure in module settings.');
        }
    }

    static getConnection() {
        return game.user.getFlag(this.namespace, 'connection') ?? null;
    }

    static isConnected() {
        return Boolean(this.getConnection()?.userId);
    }

    static getUserId() {
        return this.getConnection()?.userId ?? null;
    }

    static getToken() {
        return this.getConnection()?.token ?? null;
    }

    static async saveConnection(connection) {
        return game.user.setFlag(this.namespace, 'connection', connection);
    }

    static async disconnect() {
        return game.user.unsetFlag(this.namespace, 'connection');
    }
}

// ============================================
// HARKONIANS API SERVICE
// ============================================

class HarkoniansAPI {
    static baseURL = 'https://api.harkonians.quest/v1';

    static getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const worldSecret = HarkoniansWorldSecret.getWorldSecret();
        if (worldSecret) headers['x-foundry-world-secret'] = worldSecret;
        const token = HarkoniansConnection.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    static async request(endpoint, options = {}) {
        if (endpoint.startsWith('/api/foundry/') && !HarkoniansWorldSecret.getWorldSecret() && endpoint !== '/api/foundry/health') {
            console.warn('HarkoniansVTT | API request to Foundry endpoint without world secret:', endpoint);
        }

        const response = await fetch(
            `${this.baseURL}${endpoint}`,
            {
                ...options,
                headers: { ...this.getAuthHeaders(), ...(options.headers ?? {}) }
            }
        );

        if (!response.ok) {
            let errorMsg = `Harkonians API error: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error) errorMsg = errorData.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        try {
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    static async linkAccount(token) {
        return this.request('/api/foundry/user/link', {
            method: 'POST',
            body: JSON.stringify({ token }),
            headers: { 'Content-Type': 'application/json' }
        });
    }

    static async linkCharacter(data) {
        return this.request('/api/foundry/link', {
            method: 'POST',
            body: JSON.stringify({
                foundryWorldId: data.foundryWorldId,
                foundryActorId: data.foundryActorId
            })
        });
    }

    static async createItem(data) {
        return this.request('/api/foundry/items', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    static async testConnection() {
        return this.request('/api/foundry/health');
    }

    static async syncGold(actorId, goldValue) {
        return this.request('/api/foundry/gold/sync', {
            method: 'POST',
            body: JSON.stringify({
                foundryWorldId: game.world.id,
                foundryActorId: actorId,
                gold: goldValue
            })
        });
    }

    static async getGold(actorId) {
        return this.request(`/api/foundry/gold?worldId=${game.world.id}&actorId=${actorId}`);
    }

    static async purchaseItem(purchaseData) {
        return this.request('/api/foundry/purchase', {
            method: 'POST',
            body: JSON.stringify(purchaseData)
        });
    }

    static async updateItemStock(itemId, stock) {
        return this.request(`/api/foundry/items/${itemId}/stock`, {
            method: 'PUT',
            body: JSON.stringify({ stock })
        });
    }

    static async getWorldItems() {
        return this.request(`/api/foundry/items?worldId=${game.world.id}`);
    }

    static async verifyWorldSecret(secret) {
        try {
            const response = await fetch(`${this.baseURL}/api/foundry/health`, {
                headers: { 'x-foundry-world-secret': secret }
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }
}

// ============================================
// HARKONIANS GOLD SYNC MANAGER
// ============================================

class HarkoniansGoldSync {
    static namespace = 'harkoniansvtt';
    static SYNC_INTERVAL = 10000; // Sync every 10 seconds
    static syncTimers = new Map();

    static async syncActorGold(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            console.warn('HarkoniansVTT | Actor not found for gold sync:', actorId);
            return;
        }

        // Get current gold from actor
        const currentGold = this.getActorGold(actor);
        
        if (currentGold === null) {
            console.debug('HarkoniansVTT | Actor has no gold field:', actor.name);
            return;
        }

        try {
            // Check if actor is linked to Harkonians
            const harkoniansData = actor.getFlag(this.namespace, 'character');
            if (!harkoniansData?.actorId) {
                console.debug('HarkoniansVTT | Actor not linked to Harkonians:', actor.name);
                return;
            }

            // Check if world secret is configured
            if (!HarkoniansWorldSecret.isConfigured()) {
                console.warn('HarkoniansVTT | World secret not configured, cannot sync gold');
                return;
            }

            // Sync gold to Harkonians
            await HarkoniansAPI.syncGold(actorId, currentGold);
            console.log('HarkoniansVTT | Gold synced for', actor.name, ':', currentGold);

            // Store last synced value and timestamp
            await actor.setFlag(this.namespace, 'lastGoldSync', {
                value: currentGold,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('HarkoniansVTT | Gold sync error:', error);
        }
    }

    static getActorGold(actor) {
        // Try common gold field paths
        const paths = [
            'system.currency.gp',
            'system.currency.gold',
            'system.gold',
            'data.currency.gp',
            'data.gold'
        ];

        for (const path of paths) {
            const value = foundry.utils.getProperty(actor, path);
            if (value !== undefined && value !== null) {
                return Number(value);
            }
        }

        return null;
    }

    static setActorGold(actor, goldValue) {
        // Try to find and set the gold field
        const paths = [
            'system.currency.gp',
            'system.currency.gold',
            'system.gold'
        ];

        for (const path of paths) {
            try {
                foundry.utils.setProperty(actor, path, goldValue);
                return true;
            } catch (e) {
                // Try next path
            }
        }

        return false;
    }

    static startSyncingActor(actorId) {
        // Stop existing timer
        this.stopSyncingActor(actorId);

        // Start new sync timer
        const timer = setInterval(async () => {
            await this.syncActorGold(actorId);
        }, this.SYNC_INTERVAL);

        this.syncTimers.set(actorId, timer);
        console.log('HarkoniansVTT | Started gold sync for actor:', actorId);
    }

    static stopSyncingActor(actorId) {
        const timer = this.syncTimers.get(actorId);
        if (timer) {
            clearInterval(timer);
            this.syncTimers.delete(actorId);
            console.log('HarkoniansVTT | Stopped gold sync for actor:', actorId);
        }
    }

    static stopAllSync() {
        for (const [actorId, timer] of this.syncTimers) {
            clearInterval(timer);
        }
        this.syncTimers.clear();
        console.log('HarkoniansVTT | Stopped all gold sync timers');
    }

    static async syncAllLinkedActors() {
        const linkedActors = game.actors.contents.filter(a => 
            a.getFlag(this.namespace, 'character')?.actorId
        );

        for (const actor of linkedActors) {
            await this.syncActorGold(actor.id);
        }
    }
}

// ============================================
// HARKONIANS ITEM SYNC MANAGER
// ============================================

class HarkoniansItemSync {
    static namespace = 'harkoniansvtt';

    static async sendItemsToStore(itemIds) {
        const items = game.items.contents.filter(item => itemIds.includes(item.id));
        const results = [];

        for (const item of items) {
            try {
                // Check if already sent
                if (item.getFlag(this.namespace, 'harkoniansItemId')) {
                    console.log('HarkoniansVTT | Item already sent:', item.name);
                    results.push({
                        itemId: item.id,
                        status: 'already_sent',
                        harkoniansId: item.getFlag(this.namespace, 'harkoniansItemId')
                    });
                    continue;
                }

                // Check if world secret is configured
                if (!HarkoniansWorldSecret.isConfigured()) {
                    throw new Error('World secret not configured');
                }

                // Extract item data
                const itemData = item.toObject();
                const systemData = itemData.system || {};

                // Build payload with metadata
                const payload = {
                    foundry: {
                        worldId: game.world.id,
                        itemId: item.id,
                        itemUuid: item.uuid
                    },
                    item: {
                        name: item.name,
                        type: item.type,
                        img: item.img,
                        system: systemData,
                        // Extract common fields
                        rarity: systemData.rarity || item.getFlag(this.namespace, 'rarity') || 'common',
                        description: systemData.description?.value || systemData.description || '',
                        price: systemData.price || 0
                    }
                };

                // Send to Harkonians
                const result = await HarkoniansAPI.createItem(payload);
                
                // Store the Harkonians item ID on the Foundry item
                await item.setFlag(this.namespace, 'harkoniansItemId', result.id);
                await item.setFlag(this.namespace, 'harkoniansItemData', {
                    sentAt: Date.now(),
                    sentBy: game.user.id
                });

                results.push({
                    itemId: item.id,
                    status: 'success',
                    harkoniansId: result.id
                });

                console.log('HarkoniansVTT | Item sent to Harkonians:', item.name, '->', result.id);
            } catch (error) {
                console.error('HarkoniansVTT | Failed to send item:', item.name, error);
                results.push({
                    itemId: item.id,
                    status: 'error 213',
                    error: error.message
                });
            }
        }

        return results;
    }

    static async receiveItemFromStore(purchaseData) {
        // purchaseData should contain item metadata and target actor
        const { item, actorId, harkoniansItemId } = purchaseData;

        const actor = game.actors.get(actorId);
        if (!actor) {
            throw new Error(`Actor not found: ${actorId}`);
        }

        // Create the item in Foundry
        const createdItem = await Item.create(item, { parent: actor });

        // Mark as received from Harkonians
        await createdItem.setFlag(this.namespace, 'harkoniansItemId', harkoniansItemId);
        await createdItem.setFlag(this.namespace, 'purchasedFromHarkonians', true);
        await createdItem.setFlag(this.namespace, 'purchaseData', {
            purchasedAt: Date.now(),
            harkoniansPurchaseId: purchaseData.purchaseId
        });

        console.log('HarkoniansVTT | Item received from Harkonians:', item.name, '-> Actor:', actor.name);

        // Update stock on Harkonians
        await HarkoniansAPI.updateItemStock(harkoniansItemId, item.stock - 1);

        return createdItem;
    }

    static async updateItemStock(itemId, newStock) {
        const item = game.items.get(itemId);
        if (!item) {
            throw new Error(`Item not found: ${itemId}`);
        }

        const harkoniansId = item.getFlag(this.namespace, 'harkoniansItemId');
        if (!harkoniansId) {
            throw new Error('Item not linked to Harkonians');
        }

        await HarkoniansAPI.updateItemStock(harkoniansId, newStock);
        
        // Update local stock tracking
        await item.setFlag(this.namespace, 'stock', newStock);
        
        return { success: true };
    }
}

// ============================================
// HARKONIANS APPLICATION BASE
// ============================================

const { ApplicationV2 } = foundry.applications.api;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const HandlebarsApplication = HandlebarsApplicationMixin(ApplicationV2);

class HarkoniansApplication extends HandlebarsApplication {
    static namespace = 'harkoniansvtt';

    /**
     * ApplicationV2 uses DEFAULT_OPTIONS (uppercase), not defaultOptions
     */
    static DEFAULT_OPTIONS = {
        classes: ['harkoniansvtt-window'],
        window: { frame: true, positioned: true, resizable: true },
        actions: {}
    };

    /**
     * V13 ApplicationV2 provides automatic action handling via DEFAULT_OPTIONS.actions
     * No manual jQuery binding needed - remove activateListeners override
     */
}

// ============================================
// HARKONIANS WORLD CONFIG APPLICATION
// ============================================

class HarkoniansWorldConfigApp extends HarkoniansApplication {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-world-config',
        classes: ['harkoniansvtt-window'],
        window: { frame: true, positioned: true, title: 'Harkonians World Configuration' },
        position: { width: 500, height: 300 },
        actions: {
            save: function() { this._saveWorldSecret(); },
            cancel: function() { this.close(); }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-world-config.hbs' } };

    async _prepareContext(_options) {
        const worldSecret = HarkoniansWorldSecret.getWorldSecret();
        return {
            worldSecret: worldSecret ? '********' : null,
            isConfigured: Boolean(worldSecret),
            hasWorldSecret: Boolean(worldSecret),
            worldId: game.world.id
        };
    }

    async _saveWorldSecret() {
        const secretInput = this.element.querySelector('[name="worldSecret"]');
        if (!secretInput) {
            ui.notifications.error('Could not find world secret input.');
            return;
        }
        const secret = secretInput.value.trim();
        if (!secret) {
            try {
                await HarkoniansWorldSecret.removeWorldSecret();
                ui.notifications.info('World secret removed.');
                this.close();
            } catch (error) {
                ui.notifications.error('Failed to remove world secret.');
            }
            return;
        }
        try {
            const isValid = await HarkoniansAPI.verifyWorldSecret(secret);
            if (!isValid) {
                ui.notifications.error('Invalid world secret. Please check the secret and try again.');
                return;
            }
            await HarkoniansWorldSecret.setWorldSecret(secret);
            ui.notifications.info('World secret configured successfully!');
            this.close();
        } catch (error) {
            console.error('HarkoniansVTT | World secret verification error:', error);
            ui.notifications.error('Failed to verify world secret. Please check your connection.');
        }
    }
}

// ============================================
// HARKONIANS LINK APPLICATION
// ============================================

class HarkoniansLinkApp extends HarkoniansApplication {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-link',
        classes: ['harkoniansvtt-window'],
        window: { frame: true, positioned: true, title: 'Harkonians' },
        position: { width: 500, height: 500 },
        actions: {
            configure: function() { this.close(); new HarkoniansConfigApp().render({ force: true }); },
            connect: function() { this.close(); new HarkoniansConfigApp().render({ force: true }); },
            worldConfig: function() {
                this.close();
                if (game.user.isGM) new HarkoniansWorldConfigApp().render({ force: true });
                else ui.notifications.warn('Only the Game Master can configure the world secret.');
            }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-link.hbs' } };

    async _prepareContext(_options) {
        const connection = HarkoniansConnection.getConnection();
        return {
            connected: Boolean(connection?.userId),
            account: connection,
            worldConfigured: HarkoniansWorldSecret.isConfigured(),
            isGM: game.user.isGM
        };
    }
}

// ============================================
// HARKONIANS CONFIG APPLICATION
// ============================================

class HarkoniansConfigApp extends HarkoniansApplication {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-config',
        classes: ['harkoniansvtt-window'],
        window: { frame: true, positioned: true, title: 'HarkoniansVTT Configuration' },
        position: { width: 600, height: 650 },
        actions: {
            cancel: function() { this.close(); },
            async linkCharacter(event) {
                const actorId = event.target.closest('[data-actor-id]')?.getAttribute('data-actor-id');
                if (actorId) await this._linkCharacter(actorId);
            },
            async testConnection() { await this._testConnection(); },
            async disconnect() { await this._disconnect(); },
            worldConfig: function() {
                this.close();
                if (game.user.isGM) new HarkoniansWorldConfigApp().render({ force: true });
                else ui.notifications.warn('Only the Game Master can configure the world secret.');
            }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-config.hbs' } };

    async _prepareContext(_options) {
        const connection = HarkoniansConnection.getConnection();
        const characters = game.actors.contents
            .filter(a => a.isOwner)
            .map(a => ({
                id: a.id, uuid: a.uuid, name: a.name, img: a.img,
                isLinked: Boolean(a.getFlag('harkoniansvtt', 'character'))
            }));
        
        return {
            connected: Boolean(connection?.userId),
            account: connection,
            characters,
            userCharacter: game.user.getFlag('harkoniansvtt', 'character'),
            hasCharacters: characters.length > 0,
            worldConfigured: HarkoniansWorldSecret.isConfigured(),
            isGM: game.user.isGM
        };
    }

    async _linkCharacter(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) { ui.notifications.error('Character not found.'); return; }
        if (!actor.isOwner) { ui.notifications.error('You do not have permission to link this character.'); return; }
        if (!HarkoniansConnection.isConnected()) { ui.notifications.error('Connect to Harkonians first.'); return; }
        if (!HarkoniansWorldSecret.isConfigured()) { ui.notifications.error('World secret not configured. GM must configure it first.'); return; }

        try {
            await HarkoniansAPI.linkCharacter({
                foundryWorldId: game.world.id,
                foundryActorId: actor.id
            });
            await game.user.setFlag('harkoniansvtt', 'character', {
                actorId: actor.id, actorUuid: actor.uuid, name: actor.name
            });
            await actor.setFlag('harkoniansvtt', 'character', {
                actorId: actor.id, actorUuid: actor.uuid, name: actor.name
            });
            ui.notifications.info(`${actor.name} linked to Harkonians.`);
            this.close();
        } catch (error) {
            console.error('HarkoniansVTT | Character link error:', error);
            ui.notifications.error('Failed to link character.');
        }
    }

    async _testConnection() {
        try {
            await HarkoniansAPI.testConnection();
            ui.notifications.info('Connection to Harkonians is working.');
        } catch (error) {
            console.error('HarkoniansVTT | Connection test error:', error);
            ui.notifications.error('Connection to Harkonians failed.');
        }
    }

    async _disconnect() {
        try {
            await HarkoniansConnection.disconnect();
            await game.user.unsetFlag('harkoniansvtt', 'character');
            ui.notifications.info('Disconnected from Harkonians.');
            this.close();
        } catch (error) {
            console.error('HarkoniansVTT | Disconnect error:', error);
            ui.notifications.error('Failed to disconnect.');
        }
    }
}

// ============================================
// HARKONIANS ITEM PICKER APPLICATION
// ============================================

class HarkoniansItemPicker extends HarkoniansApplication {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-item-picker',
        classes: ['harkoniansvtt-window', 'harkoniansvtt-item-picker'],
        window: { frame: true, positioned: true, title: 'Add Item to Harkonians' },
        position: { width: 650, height: 700 },
        actions: {
            cancel: function() { this.close(); },
            async add() {
                const selected = Array.from(this.element.querySelectorAll('input[name="harkonians-item"]:checked'))
                    .map(cb => cb.value);
                if (selected.length === 0) {
                    ui.notifications.warn('Select at least one Item first.');
                    return;
                }
                await this._addItems(selected);
            },
            selectAll: function() { this._selectAll(); },
            deselectAll: function() { this._deselectAll(); }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-item-picker.hbs' } };

    async _prepareContext(_options) {
        const items = game.items.contents
            .map(e => {
                const harkoniansData = e.getFlag('harkoniansvtt', 'harkoniansItemId');
                return {
                    id: e.id,
                    uuid: e.uuid,
                    name: e.name,
                    type: e.type,
                    img: e.img,
                    alreadyLinked: Boolean(harkoniansData),
                    harkoniansId: harkoniansData || null,
                    system: e.system
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        return { items, worldConfigured: HarkoniansWorldSecret.isConfigured() };
    }

    async _addItem(itemId) {
        await this._addItems([itemId]);
    }

    async _addItems(itemIds) {
        if (!HarkoniansConnection.isConnected()) {
            ui.notifications.error('Connect to Harkonians before adding Items.');
            return;
        }
        
        if (!HarkoniansWorldSecret.isConfigured()) {
            ui.notifications.error('World secret not configured. GM must configure it first.');
            return;
        }

        try {
            const results = await HarkoniansItemSync.sendItemsToStore(itemIds);
            
            const successCount = results.filter(r => r.status === 'success').length;
            const alreadySentCount = results.filter(r => r.status === 'already_sent').length;
            const errorCount = results.filter(r => r.status === 'error').length;

            if (successCount > 0) {
                ui.notifications.info(`${successCount} item(s) added to Harkonians.`);
            }
            if (alreadySentCount > 0) {
                ui.notifications.warn(`${alreadySentCount} item(s) were already in Harkonians.`);
            }
            if (errorCount > 0) {
                ui.notifications.error(`${errorCount} item(s) failed to upload.`);
            }

            // Refresh the UI
            this.render();
        } catch (error) {
            console.error('HarkoniansVTT | Item creation error:', error);
            ui.notifications.error('Failed to add Items to Harkonians.');
        }
    }

    async _selectAll() {
        const checkboxes = this.element.querySelectorAll('input[name="harkonians-item"]:not(:checked)');
        checkboxes.forEach(cb => cb.checked = true);
    }

    async _deselectAll() {
        const checkboxes = this.element.querySelectorAll('input[name="harkonians-item"]:checked');
        checkboxes.forEach(cb => cb.checked = false);
    }
}

// ============================================
// HARKONIANS PURCHASE HANDLER
// ============================================

class HarkoniansPurchaseHandler {
    static namespace = 'harkoniansvtt';

    static async handlePurchase(purchaseData) {
        // purchaseData: { purchaseId, itemId, actorId, itemData, cost }
        const { purchaseId, itemId, actorId, itemData, cost } = purchaseData;

        try {
            const actor = game.actors.get(actorId);
            if (!actor) {
                throw new Error(`Actor not found: ${actorId}`);
            }

            // Deduct gold from actor
            const currentGold = HarkoniansGoldSync.getActorGold(actor);
            if (currentGold === null || currentGold < cost) {
                throw new Error('Insufficient gold');
            }

            const newGold = currentGold - cost;
            HarkoniansGoldSync.setActorGold(actor, newGold);

            // Create the item in the actor's inventory
            const createdItem = await HarkoniansItemSync.receiveItemFromStore({
                ...purchaseData,
                item: itemData
            });

            // Sync gold to Harkonians
            await HarkoniansAPI.syncGold(actorId, newGold);

            // Confirm purchase to Harkonians
            await HarkoniansAPI.purchaseItem({
                purchaseId,
                status: 'completed',
                foundryActorId: actorId,
                foundryItemId: createdItem.id
            });

            ui.notifications.info(`Purchase complete! ${itemData.name} added to ${actor.name}'s inventory.`);

            return { success: true, item: createdItem };
        } catch (error) {
            console.error('HarkoniansVTT | Purchase error:', error);
            
            // Notify Harkonians of failure
            await HarkoniansAPI.purchaseItem({
                purchaseId,
                status: 'failed',
                error: error.message
            });

            ui.notifications.error(`Purchase failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// ============================================
// HARKONIANS WEBSOCKET MANAGER (for real-time sync)
// ============================================

class HarkoniansWebSocket {
    static namespace = 'harkoniansvtt';
    static socket = null;
    static reconnectInterval = 5000;
    static maxReconnectAttempts = 10;
    static reconnectAttempts = 0;
    static heartbeatInterval = 10000; // Send ping every 10 seconds
    static heartbeatTimer = null;

    static getWebSocketUrl() {
        // For development, use localhost with WebSocket port
        // For production, use the same domain as API
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            // Development: WebSocket server runs on port 3001
            return `ws://localhost:3001?token=`;
        } else {
            // Production: use wss with the API domain
            return `wss://api.harkonians.quest/v1/foundry/ws?token=`;
        }
    }

    static connect() {
        if (!HarkoniansConnection.isConnected()) {
            console.log('HarkoniansVTT | Not connected to Harkonians, skipping WebSocket');
            return;
        }

        const connection = HarkoniansConnection.getConnection();
        const token = connection?.token;
        
        if (!token) {
            console.log('HarkoniansVTT | No auth token for WebSocket');
            return;
        }

        // Use wss for secure connection
        const url = `${this.getWebSocketUrl()}${encodeURIComponent(token)}`;

        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log('HarkoniansVTT | WebSocket connected');
            this.reconnectAttempts = 0;
            
            // Send initial handshake
            this.send({ type: 'handshake', worldId: game.world.id });
            
            // Start heartbeat
            this.startHeartbeat();
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('HarkoniansVTT | WebSocket message error:', error);
            }
        };

        this.socket.onclose = () => {
            console.log('HarkoniansVTT | WebSocket disconnected');
            this.scheduleReconnect();
        };

        this.socket.onerror = (error) => {
            console.error('HarkoniansVTT | WebSocket error:', error);
        };
    }

    static send(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    static handleMessage(data) {
        switch (data.type) {
            case 'purchase':
            case 'purchase_complete':
                // Handle purchase from store
                HarkoniansPurchaseHandler.handlePurchase(data.purchase || data);
                break;
            case 'gold_update':
                // Handle gold update from store
                this.handleGoldUpdate(data);
                break;
            case 'stock_update':
                // Handle stock update from store
                this.handleStockUpdate(data);
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
            default:
                console.debug('HarkoniansVTT | Unknown WebSocket message type:', data.type);
        }
    }

    static async handleGoldUpdate(data) {
        // data: { actorId, gold }
        const actor = game.actors.get(data.actorId);
        if (!actor) return;

        // Check if this is from a linked actor
        const harkoniansData = actor.getFlag(this.namespace, 'character');
        if (!harkoniansData?.actorId) return;

        // Update actor gold
        HarkoniansGoldSync.setActorGold(actor, data.gold);
        
        // Store sync info
        await actor.setFlag(this.namespace, 'lastGoldSync', {
            value: data.gold,
            timestamp: Date.now(),
            source: 'store'
        });

        ui.notifications.info(`Gold updated for ${actor.name}: ${data.gold}`);
    }

    static async handleStockUpdate(data) {
        // data: { itemId, stock }
        const flag = game.items.get(data.itemId);
        if (flag) {
            await flag.setFlag(this.namespace, 'stock', data.stock);
        }
    }

    static scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('HarkoniansVTT | Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        setTimeout(() => {
            this.connect();
        }, this.reconnectInterval * this.reconnectAttempts);
    }

    static disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.stopHeartbeat();
    }

    static startHeartbeat() {
        // Clear any existing heartbeat
        this.stopHeartbeat();
        
        // Send ping every 10 seconds
        this.heartbeatTimer = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, this.heartbeatInterval);
        
        console.log('HarkoniansVTT | WebSocket heartbeat started (10s interval)');
    }

    static stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
            console.log('HarkoniansVTT | WebSocket heartbeat stopped');
        }
    }
}

// ============================================
// HARKONIANS SETTINGS
// ============================================

class HarkoniansSettings {
    static namespace = 'harkoniansvtt';

    static register() {
        game.settings.registerMenu(
            this.namespace,
            'configuration',
            {
                name: 'HarkoniansVTT Configuration',
                label: 'Configure HarkoniansVTT',
                hint: 'Configure your Harkonians account and character.',
                icon: 'fas fa-store',
                type: HarkoniansConfigApp,
                restricted: false
            }
        );
        game.settings.register(
            this.namespace,
            'worldSecret',
            {
                name: 'Harkonians World Secret',
                hint: 'The world secret from Harkonians. Required for all API operations.',
                scope: 'world',
                config: false,
                type: String,
                default: ''
            }
        );
    }
}

// ============================================
// SIDEBAR INTEGRATION
// ============================================

class HarkoniansSidebarIntegration {
    static namespace = 'harkoniansvtt';

    static register() {
        const SidebarClass = CONFIG.ui.sidebar;
        if (!SidebarClass) {
            console.error('HarkoniansVTT | Sidebar class unavailable.');
            return;
        }

        // Store original _getHeaderControls
        const originalGetHeaderControls = SidebarClass.prototype._getHeaderControls;
        if (typeof originalGetHeaderControls !== 'function') return;

        // Patch _getHeaderControls to add Harkonians button
        SidebarClass.prototype._getHeaderControls = function(...args) {
            const controls = originalGetHeaderControls.call(this, ...args);
            controls.push({
                action: 'harkonians',
                icon: 'fas fa-store',
                label: 'Harkonians',
                ownership: 'NONE'
            });
            return controls;
        };

        // Store original _onClickAction
        const originalOnClickAction = SidebarClass.prototype._onClickAction;
        if (typeof originalOnClickAction !== 'function') return;

        // Patch _onClickAction to handle Harkonians button click
        SidebarClass.prototype._onClickAction = function(event, target) {
            if (target?.dataset?.action === 'harkonians') {
                event.preventDefault();
                new HarkoniansLinkApp().render({ force: true });
                return;
            }
            return originalOnClickAction.call(this, event, target);
        };
    }
}

// ============================================
// ITEM DIRECTORY INTEGRATION
// ============================================

class HarkoniansItemDirectoryIntegration {
    static namespace = 'harkoniansvtt';

    static register() {
        const ItemDirectoryClass = CONFIG.ui.items;
        if (!ItemDirectoryClass) {
            console.error('HarkoniansVTT | ItemDirectory class unavailable.');
            return;
        }

        // Store original _getHeaderControls
        const originalGetHeaderControls = ItemDirectoryClass.prototype._getHeaderControls;
        if (typeof originalGetHeaderControls !== 'function') return;

        // Patch _getHeaderControls to add Harkonians button
        ItemDirectoryClass.prototype._getHeaderControls = function(...args) {
            const controls = originalGetHeaderControls.call(this, ...args);
            
            // Only add button for GM users who are connected and world secret is configured
            if (game.user.isGM && HarkoniansConnection.isConnected() && HarkoniansWorldSecret.isConfigured()) {
                controls.add({
                    action: 'harkonians-add-item',
                    icon: 'fas fa-store',
                    label: 'Add Item to Harkonians'
                });
            }
            
            return controls;
        };

        // Store original _onClickAction
        const originalOnClickAction = ItemDirectoryClass.prototype._onClickAction;
        if (typeof originalOnClickAction !== 'function') return;

        // Patch _onClickAction to handle Harkonians button click
        ItemDirectoryClass.prototype._onClickAction = function(event, target) {
            if (target?.dataset?.action === 'harkonians-add-item') {
                event.preventDefault();
                if (game.user.isGM && HarkoniansConnection.isConnected() && HarkoniansWorldSecret.isConfigured()) {
                    new HarkoniansItemPicker().render({ force: true });
                } else if (!HarkoniansWorldSecret.isConfigured()) {
                    ui.notifications.warn('World secret not configured. GM must configure it first.');
                } else {
                    ui.notifications.warn('Only the Game Master can add Items to Harkonians.');
                }
                return;
            }
            return originalOnClickAction.call(this, event, target);
        };
    }
}

// ============================================
// INITIALIZATION
// ============================================

Hooks.once('init', () => {
    console.log('HarkoniansVTT | Foundry version:', game.version);
    console.log('HarkoniansVTT | ItemDirectory:', CONFIG.ui.items);
    console.log('HarkoniansVTT | Sidebar:', CONFIG.ui.sidebar);

    // Version check - only V13 supported
    if (!game.version.startsWith('13.')) {
        ui.notifications.error('HarkoniansVTT requires Foundry VTT V13.');
        return;
    }

    HarkoniansSettings.register();
    HarkoniansSidebarIntegration.register();
    HarkoniansItemDirectoryIntegration.register();

    // Register hooks for actor updates (for gold sync)
    Hooks.on('updateActor', async (actor, changes, options, userId) => {
        // Only process if this is the current user's change or a system change
        if (userId !== game.user.id) return;

        // Check if gold changed
        const goldPaths = ['system.currency.gp', 'system.currency.gold', 'system.gold'];
        const goldChanged = goldPaths.some(path => {
            return changes.includes(path) || 
                   Object.prototype.hasOwnProperty.call(changes, path) ||
                   foundry.utils.hasProperty(changes, path);
        });

        if (goldChanged) {
            // Sync gold to Harkonians if actor is linked and world secret is configured
            const harkoniansData = actor.getFlag('harkoniansvtt', 'character');
            if (harkoniansData?.actorId && HarkoniansWorldSecret.isConfigured()) {
                await HarkoniansGoldSync.syncActorGold(actor.id);
            }
        }
    });

    // Hook for creating items (potentially from purchases)
    Hooks.on('createItem', (item, options, userId) => {
        // Check if this item was purchased from Harkonians
        if (item.getFlag('harkoniansvtt', 'purchasedFromHarkonians')) {
            console.log('HarkoniansVTT | Item created from purchase:', item.name);
        }
    });
});

Hooks.once('ready', async () => {
    console.log('HarkoniansVTT | Ready');
    try {
        await HarkoniansConnection.initialize();
        
        // Connect WebSocket for real-time sync
        HarkoniansWebSocket.connect();
        
        // Start syncing all linked actors
        const linkedActors = game.actors.contents.filter(a => 
            a.getFlag('harkoniansvtt', 'character')?.actorId
        );
        
        for (const actor of linkedActors) {
            HarkoniansGoldSync.startSyncingActor(actor.id);
        }
        
        // Sync all items that are already linked
        const linkedItems = game.items.contents.filter(i => 
            i.getFlag('harkoniansvtt', 'harkoniansItemId')
        );
        console.log('HarkoniansVTT | Found', linkedItems.length, 'already linked items');
        
    } catch (error) {
        console.error(error);
    }
});

// Cleanup on module unload
Hooks.once('unloadModule', () => {
    HarkoniansGoldSync.stopAllSync();
    HarkoniansWebSocket.disconnect();
    console.log('HarkoniansVTT | Module unloaded, cleanup complete');
});
