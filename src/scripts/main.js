/**
 * HarkoniansVTT - Foundry VTT V13 Module
 * Connects Harkonians store to Foundry VTT
 */

// Import applications (side effect: registers them for use)
import './applications/HarkoniansManager.js';
import './applications/HarkoniansItemPublisher.js';
import './api/HarkoniansApi.js';
import './mixins/HandlebarsApplicationMixin.js';

// ============================================
// SETTINGS KEYS
// ============================================

const SETTINGS = {
    worldSecret: 'worldSecret',
    pairedAt: 'pairedAt',
    characterCredentials: 'characterCredentials'
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get the world secret from module settings
 * @returns {string|null} The world secret or null if not set
 */
export function getWorldSecret() {
    const value = game.settings.get('harkoniansvtt', SETTINGS.worldSecret);
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Check if the world is linked to Harkonians
 * @returns {boolean} True if world secret exists
 */
export function isWorldLinked() {
    return Boolean(getWorldSecret());
}

/**
 * Convert currency to copper
 * @param {number} amount - The currency amount
 * @param {'pp'|'gp'|'ep'|'sp'|'cp'} denomination - The currency denomination
 * @returns {number} The value in copper
 */
export function currencyToCopper(amount, denomination) {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Invalid currency amount');
    }
    const multipliers = {
        pp: 1000,
        gp: 100,
        ep: 50,
        sp: 10,
        cp: 1
    };
    return Math.round(amount * multipliers[denomination]);
}

// ============================================
// HOOK REGISTRATION
// ============================================

/**
 * Register all module hooks
 */
function registerHooks() {
    // Scene Control Button
    Hooks.on('getSceneControlButtons', onGetSceneControlButtons);
    
    // Item Directory Header Control
    Hooks.on('getHeaderControlsApplicationV2', onHeaderControlsApplicationV2);
}

/**
 * Scene Control Button handler
 * @param {Object} controls - The scene controls object
 */
function onGetSceneControlButtons(controls) {
    controls.tokens.tools.harkonians = {
        name: 'harkonians',
        title: 'Harkonians',
        icon: 'fa-solid fa-store',
        order: Object.keys(controls.tokens.tools).length,
        button: true,
        visible: true,
        onChange: () => {
            const existing = foundry.applications.instances.get('harkonians-manager');
            if (existing) {
                existing.close();
            } else {
                new HarkoniansManager().render({ force: true });
            }
        }
    };
}

/**
 * Item Directory Header Control handler
 * @param {foundry.applications.api.ApplicationV2} application - The application
 * @param {foundry.applications.types.ApplicationHeaderControlsEntry[]} controls - The header controls
 */
function onHeaderControlsApplicationV2(application, controls) {
    // Target only the Item Directory
    if (!(application instanceof foundry.applications.sidebar.tabs.ItemDirectory)) {
        return;
    }
    
    // Only show if world is linked
    if (!isWorldLinked()) {
        return;
    }
    
    // Avoid duplicate controls
    if (controls.some(control => control.action === 'harkoniansItemPublisher')) {
        return;
    }
    
    controls.push({
        action: 'harkoniansItemPublisher',
        icon: 'fa-solid fa-store',
        label: 'Harkonians',
        visible: true
    });
}

// ============================================
// INITIALIZATION
// ============================================

Hooks.once('init', () => {
    console.log('HarkoniansVTT | Initializing for Foundry V13');
    
    // Register world-scoped settings
    game.settings.register('harkoniansvtt', SETTINGS.worldSecret, {
        scope: 'world',
        type: String,
        default: '',
        config: false
    });
    
    game.settings.register('harkoniansvtt', SETTINGS.pairedAt, {
        scope: 'world',
        type: String,
        default: '',
        config: false
    });
    
    game.settings.register('harkoniansvtt', SETTINGS.characterCredentials, {
        scope: 'world',
        type: Object,
        default: {},
        config: false
    });
    
    // Preload templates
    loadTemplates([
        'modules/harkoniansvtt/templates/harkonians-manager.hbs',
        'modules/harkoniansvtt/templates/item-publisher.hbs'
    ]);
    
    // Register hooks
    registerHooks();
    
    // Patch ItemDirectory to handle our control action
    const ItemDirectory = CONFIG.ui.items;
    if (ItemDirectory) {
        const originalOnClickAction = ItemDirectory.prototype._onClickAction;
        ItemDirectory.prototype._onClickAction = function(event, target) {
            if (target?.dataset?.action === 'harkoniansItemPublisher') {
                event.preventDefault();
                const existing = foundry.applications.instances.get('harkonians-item-publisher');
                if (existing) {
                    existing.close();
                } else {
                    new HarkoniansItemPublisher().render({ force: true });
                }
                return;
            }
            return originalOnClickAction?.call(this, event, target);
        };
    }
});

Hooks.once('ready', () => {
    console.log('HarkoniansVTT | Ready');
    // Don't open UI automatically, let user initiate
});
