
import {
    registerSettings,
    getWorldSecret,
    isWorldLinked,
    getActorCredentials,
    saveActorCredentials,
    clearActorCredentials,
    clearWorldConnection
} from "./state.js";

import {
    HarkoniansLinkApplication
} from "./applications/harkonians-link.js";

import {
    HarkoniansItemPublisher
} from "./applications/harkonians-item-publisher.js";

import {
    connect as connectRealtime,
    disconnect as disconnectRealtime,
    reconnect as reconnectRealtime,
    onMessage
} from "./api/harkonians-realtime.js";

import {
    acknowledgePurchase,
    reportPurchaseFailure
} from "./api/client.js";


const MODULE_ID = "harkoniansvtt";
const ITEM_ACTION = "harkoniansAddItem";
let goldSyncInterval = null;
let goldSyncInProgress = false;

function registerSceneControl() {
    Hooks.on(
        "getSceneControlButtons",
        controls => {
            const tokenControls = controls.tokens?.tools;

            if (!tokenControls) {
                return;
            }

            if (tokenControls.harkoniansvtt) {
                return;
            }

            tokenControls.harkoniansvtt = {
                name: "harkoniansvtt",
                title: "Harkonians",
                icon: "fa-solid fa-store",
                order: Object.keys(tokenControls).length,
                button: true,
                visible: true,

                onChange: () => {
                    const existing =
                        foundry.applications.instances.get(
                            "harkonians-link"
                        );

                    if (existing) {
                        existing.close();
                    } else {
                        new HarkoniansLinkApplication()
                            .render({
                                force: true
                            });
                    }
                }
            };
        }
    );
}

function registerItemSheetControl() {
    Hooks.on(
        "getHeaderControlsApplicationV2",
        (application, controls) => {
            const item = application?.document;

            if (
                !item ||
                item.documentName !== "Item"
            ) {
                return;
            }

            if (
                controls.some(
                    control =>
                        control.action === ITEM_ACTION
                )
            ) {
                return;
            }

            // Register the action on THIS Item Sheet.
            application.options.actions ??= {};

            application.options.actions[ITEM_ACTION] =
                async function (event, target) {
                    const item = this?.document;

                    if (!item) {
                        ui.notifications.error(
                            "Harkonians | Could not determine the selected Item."
                        );
                        return;
                    }

                    if (!isWorldLinked()) {
                        ui.notifications.error(
                            "Harkonians | This Foundry world is not linked."
                        );
                        return;
                    }

                    try {
                        const existing =
                            foundry.applications.instances.get(
                                "harkonians-item-publisher"
                            );

                        if (existing) {
                            await existing.close();
                        }

                        const publisher =
                            new HarkoniansItemPublisher(item);

                        await publisher.render({
                            force: true
                        });
                    } catch (error) {
                        console.error(
                            "HarkoniansVTT | Failed to open item publisher:",
                            error
                        );

                        ui.notifications.error(
                            `Harkonians | Failed to open item publisher: ${
                                error?.message ??
                                "Unknown error"
                            }`
                        );
                    }
                };

            // Add the button to the Item Sheet header/settings menu.
            controls.push({
                action: ITEM_ACTION,
                label: "Add to Harkonians",
                icon: "fa-solid fa-store",
                visible: true
            });
        }
    );
}

/**
 * Handle a purchase event from Harkonians.
 * 
 * @param {Object} payload - Purchase payload
 */
async function handlePurchaseEvent(payload) {
    const { purchaseId, actorId, quantity, item } = payload;
    
    // Find the actor
    const actor = game.actors.get(actorId);
    
    if (!actor) {
        console.error("HarkoniansVTT | Actor not found for purchase:", actorId);
        return;
    }
    
    // Verify this actor belongs to this client
    const credentials = getActorCredentials();
    if (credentials?.foundryActorId !== actorId) {
        console.log("HarkoniansVTT | Purchase for different actor, ignoring");
        return;
    }
    
    // Build item data from foundryItemData
    let itemData;
    try {
        itemData = structuredClone(item.foundryItemData || {});
        
        // Remove internal Foundry fields
        delete itemData._id;
        delete itemData._stats;
        
        // Ensure we have a name
        if (!itemData.name) {
            itemData.name = item.name;
        }
        
        // Ensure we have type
        if (!itemData.type) {
            itemData.type = item.type || "item";
        }
    } catch (error) {
        console.error("HarkoniansVTT | Failed to clone item data:", error);
        return;
    }
    
    // Create the item in Foundry using v13 embedded documents API
    try {
        const createdItems = await actor.createEmbeddedDocuments("Item", [itemData]);
        const createdItem = createdItems[0];
        
        if (!createdItem) {
            throw new Error("No item was created");
        }
        
        console.log("HarkoniansVTT | Item created from purchase:", createdItem.id);
        
        // Acknowledge the purchase
        try {
            await acknowledgePurchase(purchaseId, actor.id, createdItem.id);
            ui.notifications.info(`Received ${item.name} from Harkonians purchase.`);
        } catch (ackError) {
            console.error("HarkoniansVTT | Failed to acknowledge purchase:", ackError);
            // Item was created but we couldn't acknowledge
            // The purchase will stay PENDING but item is in inventory
        }
        
    } catch (error) {
        console.error("HarkoniansVTT | Failed to create item from purchase:", error);
        
        // Report failure
        try {
            await reportPurchaseFailure(purchaseId, error.message);
        } catch (reportError) {
            console.error("HarkoniansVTT | Failed to report purchase failure:", reportError);
        }
    }
}

/**
 * Handle a gold update event.
 * 
 * @param {Object} payload - Gold update payload
 */
async function handleGoldUpdate(payload) {
    const credentials = getActorCredentials();

    if (!credentials?.foundryActorId) {
        return;
    }

    const actorId = payload?.actorId;
    const gold = Number(payload?.gold);

    if (!actorId || !Number.isFinite(gold)) {
        console.warn(
            "HarkoniansVTT | Invalid gold update:",
            payload
        );
        return;
    }

    // Never modify an unrelated actor.
    if (
        actorId !== credentials.foundryActorId
    ) {
        console.log(
            "HarkoniansVTT | Gold update for different actor, ignoring."
        );
        return;
    }

    const actor = game.actors.get(actorId);

    if (!actor) {
        console.warn(
            "HarkoniansVTT | Actor not found for gold update:",
            actorId
        );
        return;
    }

    const newGold = Math.max(
        0,
        Math.floor(gold)
    );

    const currentGold = Number(
        foundry.utils.getProperty(
            actor,
            "system.currency.gp"
        ) ?? 0
    );

    if (currentGold === newGold) {
        return;
    }

    await actor.update({
        "system.currency.gp": newGold
    });

    console.log(
        `HarkoniansVTT | Gold updated from Harkonians: ${newGold} GP`
    );

    ui.notifications.info(
        `${actor.name}'s gold updated to ${newGold} GP.`
    );
}

/**
 * Handle a stock update event.
 * 
 * @param {Object} payload - Stock update payload
 */
async function handleStockUpdate(payload) {
    const storeItemId = payload?.itemId;
    const stock = Number(payload?.stock);

    if (!storeItemId) {
        console.warn(
            "HarkoniansVTT | Stock update missing Harkonians item ID:",
            payload
        );
        return;
    }

    if (!Number.isFinite(stock)) {
        console.warn(
            "HarkoniansVTT | Invalid stock value:",
            payload
        );
        return;
    }

    const foundryItem = game.items.find(item =>
        item.getFlag(
            "harkoniansvtt",
            "storeItemId"
        ) === storeItemId
    );

    if (!foundryItem) {
        console.log(
            "HarkoniansVTT | No published Foundry item found for stock update:",
            storeItemId
        );
        return;
    }

    const newStock = Math.max(
        0,
        Math.floor(stock)
    );

    await foundryItem.setFlag(
        "harkoniansvtt",
        "stock",
        newStock
    );

    console.log(
        `HarkoniansVTT | Stock updated: ${foundryItem.name} → ${newStock}`
    );
}

/* Initialization*/

Hooks.once("init", () => {
    console.log(
        "HarkoniansVTT | Initializing Foundry VTT v13 module."
    );

    registerSettings();

    registerSceneControl();

    registerItemSheetControl();

    // Register realtime message handlers
    onMessage(async (event, payload) => {
        console.log("HarkoniansVTT | Received realtime event:", event, payload);
        
        try {
            if (event === "purchase") {
                await handlePurchaseEvent(payload);
            } else if (event === "gold_update") {
                await handleGoldUpdate(payload);
            } else if (event === "stock_update") {
                await handleStockUpdate(payload);
            }
            else if (event === "refresh_gold") {
                await syncLinkedActorGold(true);
            }
            else {
                console.log("HarkoniansVTT | Unknown event type:", event);
            }
        } catch (error) {
            console.error("HarkoniansVTT | Error handling realtime event:", error);
        }
    });
});

async function syncLinkedActorGold() {
    if (
        goldSyncInProgress ||
        !isWorldLinked()
    ) {
        return;
    }

    const credentials = getActorCredentials();

    if (
        !credentials?.characterId ||
        !credentials?.foundryActorId
    ) {
        return;
    }

    const actor = game.actors.get(
        credentials.foundryActorId
    );

    if (!actor) {
        console.warn(
            "HarkoniansVTT | Linked actor not found:",
            credentials.foundryActorId
        );
        return;
    }

    goldSyncInProgress = true;

    try {
        const gold = Number(
            foundry.utils.getProperty(
                actor,
                "system.currency.gp"
            ) ?? 0
        );

        await synchronizeActorGold(actor);

        console.log(
            `HarkoniansVTT | Gold synchronized: ${gold} GP`
        );
    } catch (error) {
        console.error(
            "HarkoniansVTT | Gold synchronization failed:",
            error
        );
    } finally {
        goldSyncInProgress = false;
    }
}

function startGoldSync() {
    if (goldSyncInterval) {
        return;
    }

    // Sync once immediately.
    syncLinkedActorGold();

    // Then reconcile every 60 seconds.
    goldSyncInterval = setInterval(
        syncLinkedActorGold,
        60_000
    );

    console.log(
        "HarkoniansVTT | Gold synchronization started (60s)."
    );
}

function stopGoldSync() {
    if (!goldSyncInterval) {
        return;
    }

    clearInterval(goldSyncInterval);
    goldSyncInterval = null;
    goldSyncInProgress = false;

    console.log(
        "HarkoniansVTT | Gold synchronization stopped."
    );
}


/* Ready*/

Hooks.once("ready", async () => {
    console.log(
        "HarkoniansVTT | Ready.",
        {
            worldLinked: isWorldLinked(),
            worldId: game.world.id,
            systemId: game.system.id,
            systemVersion: game.system.version
        }
    );

    if (isWorldLinked()) {
        const credentials = getActorCredentials();

        if (credentials?.characterId) {
            try {
                await connectRealtime();
            } catch (error) {
                console.error(
                    "HarkoniansVTT | Failed to connect to realtime:",
                    error
                );
            }

            startGoldSync();
        }
    }
});

let lastSyncedGold = null;
let goldSyncDirty = false;

Hooks.on(
    "updateActor",
    (actor, changes) => {
        const credentials =
            getActorCredentials();

        if (
            credentials?.foundryActorId !== actor.id
        ) {
            return;
        }

        if (
            changes?.system?.currency?.gp === undefined
        ) {
            return;
        }

        goldSyncDirty = true;
    }
);


// Handle module shutdown
Hooks.on("shutdown", () => {
    console.log(
        "HarkoniansVTT | Shutting down, disconnecting realtime..."
    );

    stopGoldSync();
    disconnectRealtime();
});

Hooks.on("closeWorld", () => {
    console.log(
        "HarkoniansVTT | World closed, disconnecting realtime..."
    );

    stopGoldSync();
    disconnectRealtime();
});