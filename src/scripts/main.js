/**
 * HarkoniansVTT - Foundry VTT V13 Implementation
 * Complete module for connecting Harkonians store to Foundry
 */

// ============================================
// HARKONIANS CONNECTION MANAGER
// ============================================

class HarkoniansConnection {
    static namespace = 'harkoniansvtt';

    static async initialize() {
        console.log('HarkoniansVTT | Connection manager initialized');
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

    static async request(endpoint, options = {}) {
        const response = await fetch(
            `${this.baseURL}${endpoint}`,
            {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers ?? {})
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Harkonians API error: ${response.status}`);
        }

        return response.json();
    }

    static async linkAccount(token) {
        return this.request('/api/foundry/user/link', {
            method: 'POST',
            body: JSON.stringify({ token })
        });
    }

    static async linkCharacter(data) {
        return this.request('/api/foundry/character/link', {
            method: 'POST',
            body: JSON.stringify(data)
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
            connect: function() { this.close(); new HarkoniansConfigApp().render({ force: true }); }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-link.hbs' } };

    async _prepareContext(_options) {
        const connection = HarkoniansConnection.getConnection();
        return {
            connected: Boolean(connection?.userId),
            account: connection
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
            async disconnect() { await this._disconnect(); }
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
            hasCharacters: characters.length > 0
        };
    }

    async _linkCharacter(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) { ui.notifications.error('Character not found.'); return; }
        if (!actor.isOwner) { ui.notifications.error('You do not have permission to link this character.'); return; }
        if (!HarkoniansConnection.isConnected()) { ui.notifications.error('Connect to Harkonians first.'); return; }

        try {
            await HarkoniansAPI.linkCharacter({
                foundryWorldId: game.world.id,
                foundryUserId: game.user.id,
                foundryActorId: actor.id,
                foundryActorUuid: actor.uuid,
                characterName: actor.name
            });
            await game.user.setFlag('harkoniansvtt', 'character', {
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
                const selected = this.element.querySelector('input[name="harkonians-item"]:checked');
                if (!selected) {
                    ui.notifications.warn('Select an Item first.');
                    return;
                }
                await this._addItem(selected.value);
            }
        }
    };

    static PARTS = { main: { template: 'modules/harkoniansvtt/templates/harkonians-item-picker.hbs' } };

    async _prepareContext(_options) {
        const items = game.items.contents
            .map(e => ({
                id: e.id, uuid: e.uuid, name: e.name, type: e.type, img: e.img,
                alreadyLinked: Boolean(e.getFlag('harkoniansvtt', 'harkoniansItemId'))
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return { items };
    }

    async _addItem(itemId) {
        const item = game.items.get(itemId);
        if (!item) {
            ui.notifications.error('The selected Item no longer exists.');
            return;
        }
        if (item.getFlag('harkoniansvtt', 'harkoniansItemId')) {
            ui.notifications.warn(`${item.name} is already linked to Harkonians.`);
            return;
        }
        if (!HarkoniansConnection.isConnected()) {
            ui.notifications.error('Connect to Harkonians before adding an Item.');
            return;
        }

        try {
            const itemData = item.toObject();
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
                    system: itemData.system
                }
            };
            const result = await HarkoniansAPI.createItem(payload);
            await item.setFlag('harkoniansvtt', 'harkoniansItemId', result.id);
            ui.notifications.info(`${item.name} added to Harkonians.`);
            this.close();
        } catch (error) {
            console.error('HarkoniansVTT | Item creation error:', error);
            ui.notifications.error('Failed to add Item to Harkonians.');
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
            
            // Only add button for GM users who are connected
            if (game.user.isGM && HarkoniansConnection.isConnected()) {
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
                if (game.user.isGM && HarkoniansConnection.isConnected()) {
                    new HarkoniansItemPicker().render({ force: true });
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
});

Hooks.once('ready', async () => {
    console.log('HarkoniansVTT | Ready');
    try {
        await HarkoniansConnection.initialize();
    } catch (error) {
        console.error(error);
    }
});
