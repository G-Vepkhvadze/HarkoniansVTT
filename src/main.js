
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

            controls.push({
                action: ITEM_ACTION,
                label: "Add to Harkonians",
                icon: "fa-solid fa-store",
                visible: true
            });
        }
    );

    Hooks.on(
        "renderApplicationV2",
        (application, element) => {
            const item = application?.document;

            if (
                !item ||
                item.documentName !== "Item"
            ) {
                return;
            }

            const button = element?.querySelector(
                `[data-action="${ITEM_ACTION}"]`
            );

            if (!button) {
                return;
            }

            if (button.dataset.harkoniansBound === "true") {
                return;
            }

            button.dataset.harkoniansBound = "true";

            button.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();

                console.log(
                    "HarkoniansVTT | Add to Harkonians clicked",
                    item
                );

                if (!isWorldLinked()) {
                    ui.notifications.error(
                        "Harkonians | This world is not linked."
                    );
                    return;
                }

                const existing =
                    foundry.applications.instances.get(
                        "harkonians-item-publisher"
                    );

                if (existing) {
                    await existing.close();
                }

                try {
                    const publisher =
                        new HarkoniansItemPublisher(item);

                    console.log(
                        "HarkoniansVTT | Opening item publisher"
                    );

                    await publisher.render({
                        force: true
                    });
                } catch (error) {
                    console.error(
                        "HarkoniansVTT | Failed to open item publisher",
                        error
                    );

                    ui.notifications.error(
                        `Harkonians | Failed to open item publisher: ${
                            error?.message ?? error
                        }`
                    );
                }
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
    // Update local state or trigger a sync
    // The authoritative balance is in Harkonians, not Foundry
    console.log("HarkoniansVTT | Gold updated:", payload);
}

/**
 * Handle a stock update event.
 * 
 * @param {Object} payload - Stock update payload
 */
async function handleStockUpdate(payload) {
    // Update local cache if needed
    console.log("HarkoniansVTT | Stock updated:", payload);
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
            } else {
                console.log("HarkoniansVTT | Unknown event type:", event);
            }
        } catch (error) {
            console.error("HarkoniansVTT | Error handling realtime event:", error);
        }
    });
});


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
    
    // Connect to realtime if world and character are linked
    if (isWorldLinked()) {
        const credentials = getActorCredentials();
        if (credentials?.characterId) {
            try {
                await connectRealtime();
            } catch (error) {
                console.error("HarkoniansVTT | Failed to connect to realtime:", error);
            }
        }
    }
});

// Handle module shutdown
Hooks.on("shutdown", () => {
    console.log("HarkoniansVTT | Shutting down, disconnecting realtime...");
    disconnectRealtime();
});

// Optional: Handle world close
Hooks.on("closeWorld", () => {
    console.log("HarkoniansVTT | World closed, disconnecting realtime...");
    disconnectRealtime();
});