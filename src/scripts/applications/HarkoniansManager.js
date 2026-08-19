/**
 * HarkoniansManager
 * Application for managing world pairing and character linking
 */

import { HandlebarsApplicationMixin } from '../mixins/HandlebarsApplicationMixin.js';
import { api } from '../api/HarkoniansApi.js';
import { getWorldSecret, isWorldLinked } from '../main.js';

const SETTINGS = {
    worldSecret: 'worldSecret',
    pairedAt: 'pairedAt',
    characterCredentials: 'characterCredentials'
};

/**
 * Get character credentials for an actor
 * @param {string} actorId - The actor ID
 * @returns {Object|null} The character credentials or null
 */
function getCharacterCredentials(actorId) {
    const allCredentials = game.settings.get('harkoniansvtt', SETTINGS.characterCredentials) || {};
    return allCredentials[actorId] || null;
}

/**
 * Store character credentials for an actor
 * @param {string} actorId - The actor ID
 * @param {Object} credentials - The character credentials
 */
async function storeCharacterCredentials(actorId, credentials) {
    const allCredentials = game.settings.get('harkoniansvtt', SETTINGS.characterCredentials) || {};
    allCredentials[actorId] = credentials;
    await game.settings.set('harkoniansvtt', SETTINGS.characterCredentials, allCredentials);
}

/**
 * Remove character credentials for an actor
 * @param {string} actorId - The actor ID
 */
async function removeCharacterCredentials(actorId) {
    const allCredentials = game.settings.get('harkoniansvtt', SETTINGS.characterCredentials) || {};
    delete allCredentials[actorId];
    await game.settings.set('harkoniansvtt', SETTINGS.characterCredentials, allCredentials);
}

export class HarkoniansManager extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'harkonians-manager',
        classes: ['harkoniansvtt', 'harkonians-manager'],
        position: {
            width: 700,
            height: 600
        },
        window: {
            title: 'Harkonians',
            icon: 'fa-solid fa-store',
            resizable: true
        },
        actions: {
            pairWorld: HarkoniansManager.#onPairWorld,
            linkActor: HarkoniansManager.#onLinkActor,
            refresh: HarkoniansManager.#onRefresh,
            unlinkActor: HarkoniansManager.#onUnlinkActor
        }
    };

    static PARTS = {
        main: {
            template: 'modules/harkoniansvtt/templates/harkonians-manager.hbs'
        }
    };

    /**
     * Prepare context for template rendering
     * @returns {Promise<Object>} The context object
     */
    async _prepareContext() {
        const worldSecret = getWorldSecret();
        
        // Get owned character actors using V13 permission API
        const actors = game.actors.contents.filter(actor => {
            return actor.type === 'character' && 
                   actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
        });

        // Build character list with connection state
        const characters = await Promise.all(actors.map(async (actor) => {
            const credentials = getCharacterCredentials(actor.id);
            
            let characterState = null;
            if (credentials?.characterToken && worldSecret) {
                try {
                    characterState = await api.getCharacterState(worldSecret, credentials.characterToken);
                } catch (error) {
                    // Character state fetch failed, but we still show the character
                    console.warn('HarkoniansVTT | Failed to fetch character state:', error.message);
                }
            }

            return {
                actorId: actor.id,
                actorUuid: actor.uuid,
                name: actor.name,
                type: actor.type,
                owned: true,
                linked: Boolean(credentials),
                harkoniansCharacterId: credentials?.characterId || null,
                characterToken: credentials?.token || null,
                creditBalance: characterState?.character?.creditBalance || null,
                harkoniansName: characterState?.character?.name || null
            };
        }));

        return {
            world: {
                id: game.world.id,
                name: game.world.title
            },
            worldLinked: isWorldLinked(),
            characters
        };
    }

    /**
     * Handle pair world action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onPairWorld(event, target) {
        const worldSecret = getWorldSecret();
        if (worldSecret) {
            ui.notifications.warn('World is already paired.');
            return;
        }

        // Show dialog for pairing code
        const pairingCode = await DialogV2.prompt({
            window: {
                title: 'Pair World with Harkonians',
                icon: 'fa-solid fa-link'
            },
            content: `<div class="harkoniansvtt-dialog">
                <p>Enter the pairing code from Harkonians. Pairing codes expire after 15 minutes.</p>
                <p><strong>Note:</strong> This code is temporary and will not be stored.</p>
                <div class="harkoniansvtt-form-group">
                    <label for="harkonians-pairing-code">Pairing Code:</label>
                    <input type="text" id="harkonians-pairing-code" name="pairingCode" 
                           placeholder="Enter pairing code..." autocomplete="off" 
                           style="width: 100%; padding: 8px; margin-top: 8px;" />
                </div>
            </div>`,
            ok: {
                label: 'Pair World',
                callback: (event, button) => button.form.elements.pairingCode.value.trim()
            },
            cancel: { label: 'Cancel', callback: () => null },
            rejectClose: false
        });

        if (!pairingCode) return;

        try {
            const response = await api.confirmWorldPairing(pairingCode, game.world.id);
            
            if (response.success && response.worldSecret) {
                // Store world secret and paired timestamp
                await game.settings.set('harkoniansvtt', SETTINGS.worldSecret, response.worldSecret);
                await game.settings.set('harkoniansvtt', SETTINGS.pairedAt, new Date().toISOString());
                
                ui.notifications.info('World paired with Harkonians successfully.');
                
                // Re-render to show connected state
                const app = foundry.applications.instances.get('harkonians-manager');
                if (app) await app.render({ force: true });
                
                // Refresh Item Directory to show the button
                const itemDirectory = foundry.applications.instances.get('items');
                if (itemDirectory) await itemDirectory.render({ force: true });
            } else {
                ui.notifications.error(response.message || 'Failed to pair world. Please check the pairing code.');
            }
        } catch (error) {
            ui.notifications.error(error.message);
        }
    }

    /**
     * Handle link actor action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onLinkActor(event, target) {
        const worldSecret = getWorldSecret();
        if (!worldSecret) {
            ui.notifications.error('World must be paired first.');
            return;
        }

        const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.error('Actor not found.');
            return;
        }

        // Check if already linked
        const credentials = getCharacterCredentials(actorId);
        if (credentials) {
            ui.notifications.warn('This character is already linked.');
            return;
        }

        try {
            // Create link request
            const response = await api.createCharacterLinkRequest(worldSecret, game.world.id, actor.id);
            
            if (response.success && response.authorizationUrl) {
                // Open browser for authorization
                window.open(response.authorizationUrl, '_blank');
                ui.notifications.info('Please complete authorization in the browser window, then click Refresh.');
                
                // Store request ID temporarily so we can poll or check status
                // For now, we just tell the user to refresh
            } else {
                ui.notifications.error(response.message || 'Failed to initiate character linking.');
            }
        } catch (error) {
            ui.notifications.error(error.message);
        }
    }

    /**
     * Handle refresh action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onRefresh(event, target) {
        const app = foundry.applications.instances.get('harkonians-manager');
        if (app) await app.render({ force: true });
    }

    /**
     * Handle unlink actor action
     * @param {Event} event - The click event
     * @param {HTMLElement} target - The target element
     * @private
     */
    static async #onUnlinkActor(event, target) {
        const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
        if (!actorId) return;

        try {
            await removeCharacterCredentials(actorId);
            
            // Remove connection flag from actor
            await game.actors.get(actorId)?.unsetFlag('harkoniansvtt', 'connection');
            
            ui.notifications.info('Character unlinked from Harkonians.');
            
            // Re-render
            const app = foundry.applications.instances.get('harkonians-manager');
            if (app) await app.render({ force: true });
        } catch (error) {
            ui.notifications.error(error.message);
        }
    }
}
