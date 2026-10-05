
import {
    registerSettings,
    isWorldLinked,
    getActorCredentials,
} from "./state.js";

import {
    HarkoniansLinkApplication
} from "./applications/harkonians-link.js";

import {
    HarkoniansItemPublisher
} from "./applications/harkonians-item-publisher.js";

import {
    applyServerGoldToActor,
    isApplyingServerGold,
    synchronizeActorGold
} from "./api/harkonians-gold.js";

import {
    connect as connectRealtime,
    disconnect as disconnectRealtime,
    reconnect as reconnectRealtime,
    onMessage
} from "./api/harkonians-realtime.js";

import {
    acknowledgePurchase,
    reportPurchaseFailure,
    getPendingPurchases,
    getFoundryState
} from "./api/client.js";


const MODULE_ID = "harkoniansvtt";
const ITEM_ACTION = "harkoniansAddItem";
let goldSyncInterval = null;
let goldSyncInProgress = false;
let goldSyncDebounceTimer = null;

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
 * Reconcile purchases that may have been missed while Foundry or Realtime
 * was disconnected. This is intentionally safe to run repeatedly because
 * handlePurchaseEvent uses the purchaseId flag for idempotent delivery.
 */
async function resyncFoundryState() {
    if (!isWorldLinked()) {
        return;
    }

    try {
        const state = await getFoundryState();
        const credentials = getActorCredentials();

        if (
            credentials?.foundryActorId &&
            state?.actorId &&
            credentials.foundryActorId !== state.actorId
        ) {
            return;
        }

        const actor = getLinkedActor();

        if (actor && Number.isFinite(Number(state?.gold))) {
            const gold = Math.max(
                0,
                Math.floor(Number(state.gold))
            );

            const currentGold = Number(
                foundry.utils.getProperty(
                    actor,
                    "system.currency.gp"
                ) ?? 0
            );

            await applyServerGoldToActor(
                actor,
                gold
            );
        }

        if (Array.isArray(state?.items)) {
            for (const storeItem of state.items) {
                const foundryItem = game.items.find(item =>
                    item.getFlag(
                        "harkoniansvtt",
                        "storeItemId"
                    ) === storeItem.id
                );

                if (!foundryItem) {
                    continue;
                }

                const stock =
                    Number(storeItem.stock);

                if (!Number.isFinite(stock)) {
                    continue;
                }

                const normalizedStock =
                    stock === -1
                        ? -1
                        : Math.max(
                            0,
                            Math.floor(stock)
                        );

                const currentStock =
                    Number(
                        foundryItem.getFlag(
                            "harkoniansvtt",
                            "stock"
                        )
                    );

                if (currentStock !== normalizedStock) {
                    await foundryItem.setFlag(
                        "harkoniansvtt",
                        "stock",
                        normalizedStock
                    );
                }
            }
        }
    } catch (error) {
        console.error(
            "HarkoniansVTT | Authoritative state resync failed:",
            error
        );
    }
}

async function resyncPendingPurchases() {
    if (!isWorldLinked()) {
        return;
    }

    const credentials = getActorCredentials();

    if (!credentials?.characterId || !credentials?.foundryActorId) {
        return;
    }

    try {
        const response = await getPendingPurchases();
        const purchases = Array.isArray(response?.purchases)
            ? response.purchases
            : [];

        for (const purchase of purchases) {
            await handlePurchaseEvent(purchase);
        }

        if (purchases.length > 0) {
            console.log(
                `HarkoniansVTT | Resynchronized ${purchases.length} pending purchase(s).`
            );
        }
    } catch (error) {
        console.error(
            "HarkoniansVTT | Pending purchase resync failed:",
            error
        );
    }
}

/**
 * Handle a purchase event from Harkonians.
 * 
 * @param {Object} payload - Purchase payload
 */
async function handlePurchaseEvent(payload) {
    const {
        purchaseId,
        actorId,
        quantity,
        item
    } = payload;

    if (!purchaseId || !actorId || !item) {
        console.error(
            "HarkoniansVTT | Invalid purchase payload:",
            payload
        );
        return;
    }

    const actor = game.actors.get(actorId);

    if (!actor) {
        console.error(
            "HarkoniansVTT | Actor not found for purchase:",
            actorId
        );
        return;
    }

    const credentials = getActorCredentials();

    if (credentials?.foundryActorId !== actorId) {
        console.log(
            "HarkoniansVTT | Purchase for different actor, ignoring."
        );
        return;
    }

    const purchaseQuantity = Math.max(
        1,
        Math.floor(Number(quantity) || 1)
    );

    /*
     * Prevent the same purchase from creating duplicate items
     * if the realtime event is delivered more than once.
     */
    const existingItems = actor.items.filter(item =>
        item.getFlag(
            "harkoniansvtt",
            "purchaseId"
        ) === purchaseId
    );

    if (existingItems.length >= purchaseQuantity) {
        console.log(
            "HarkoniansVTT | Purchase already processed:",
            purchaseId
        );

        try {
            await acknowledgePurchase(
                purchaseId,
                actor.id,
                existingItems[0].id
            );
        } catch (error) {
            console.error(
                "HarkoniansVTT | Failed to acknowledge existing purchase:",
                error
            );
        }

        return;
    }

    let itemData;

    try {
        if (
            !item.foundryItemData ||
            typeof item.foundryItemData !== "object"
        ) {
            throw new Error(
                "Purchase does not contain the original Foundry Item data."
            );
        }

        itemData = structuredClone(
            item.foundryItemData
        );

        delete itemData._id;
        delete itemData._stats;

        if (!itemData.name) {
            itemData.name = item.name;
        }

        if (!itemData.type) {
            throw new Error(
                "Purchase Foundry Item data is missing its Item type."
            );
        }

        // Put the purchase marker into the creation payload itself.
        // This makes delivery idempotent even if Foundry crashes between
        // createEmbeddedDocuments() and a subsequent setFlag() call.
        itemData.flags = {
            ...(itemData.flags || {}),
            harkoniansvtt: {
                ...((itemData.flags || {}).harkoniansvtt || {}),
                purchaseId
            }
        };
    } catch (error) {
        console.error(
            "HarkoniansVTT | Failed to prepare purchased item:",
            error
        );

        await reportPurchaseFailure(
            purchaseId,
            actor.id,
            error?.message || "Failed to prepare item"
        );

        return;
    }

    try {
        const itemsToCreate = Array.from(
            {
                length:
                    purchaseQuantity -
                    existingItems.length
            },
            () => structuredClone(itemData)
        );

        const createdItems =
            await actor.createEmbeddedDocuments(
                "Item",
                itemsToCreate
            );

        if (
            !createdItems ||
            createdItems.length !== itemsToCreate.length
        ) {
            throw new Error(
                `Expected ${itemsToCreate.length} item(s), created ${createdItems?.length ?? 0}.`
            );
        }

        const acknowledgedItem =
            createdItems[0] ||
            existingItems[0];

        /*
         * The item now exists in Foundry. An ACK failure must NOT turn this
         * into FAILED because that could refund a purchase whose item was
         * already delivered. Leave it PENDING and let the normal reconciliation
         * pass ACK it later.
         */
        try {
            await acknowledgePurchase(
                purchaseId,
                actor.id,
                acknowledgedItem.id
            );
        } catch (ackError) {
            console.error(
                "HarkoniansVTT | Item delivered but purchase ACK failed:",
                ackError
            );
        }

        ui.notifications.info(
            purchaseQuantity === 1
                ? `Received ${item.name} from Harkonians.`
                : `Received ${purchaseQuantity}× ${item.name} from Harkonians.`
        );

        console.log(
            `HarkoniansVTT | Purchase ${purchaseId} delivered successfully.`
        );

    } catch (error) {
        console.error(
            "HarkoniansVTT | Failed to create purchased item:",
            error
        );

        try {
            await reportPurchaseFailure(
                purchaseId,
                actor.id,
                error?.message || "Failed to create item"
            );
        } catch (reportError) {
            console.error(
                "HarkoniansVTT | Failed to report purchase failure:",
                reportError
            );
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

    await applyServerGoldToActor(
        actor,
        newGold
    );

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

    const newStock =
        stock === -1
            ? -1
            : Math.max(
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
                await syncLinkedActorGold();
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

        const result = await synchronizeActorGold(actor);

        if (result?.conflict) {
            console.warn(
                `HarkoniansVTT | Gold conflict detected; Foundry updated to authoritative ${result.gold} GP.`
            );
        } else {
            console.log(
                `HarkoniansVTT | Gold synchronized: ${gold} GP`
            );
        }
    } catch (error) {
        console.error(
            "HarkoniansVTT | Gold synchronization failed:",
            error
        );
    } finally {
        goldSyncInProgress = false;
    }
}

function scheduleGoldSync() {
    if (!isWorldLinked()) {
        return;
    }

    if (goldSyncDebounceTimer) {
        clearTimeout(goldSyncDebounceTimer);
    }

    goldSyncDebounceTimer = setTimeout(() => {
        goldSyncDebounceTimer = null;
        void syncLinkedActorGold();
    }, 1000);
}

function startGoldSync() {
    if (goldSyncInterval) {
        return;
    }

    void syncLinkedActorGold();

    goldSyncInterval = setInterval(
        () => {
            void syncLinkedActorGold();
            void resyncPendingPurchases();
            void resyncFoundryState();
        },
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

    if (goldSyncDebounceTimer) {
        clearTimeout(goldSyncDebounceTimer);
        goldSyncDebounceTimer = null;
    }

    goldSyncInProgress = false;

    console.log(
        "HarkoniansVTT | Gold synchronization stopped."
    );
}


/*
 * Push manual/system-driven GP changes to Harkonians quickly rather than
 * waiting for the 60-second reconciliation interval.
 */
Hooks.on("updateActor", (actor, changes) => {
    if (isApplyingServerGold()) {
        return;
    }

    const credentials = getActorCredentials();

    if (
        !credentials?.foundryActorId ||
        actor?.id !== credentials.foundryActorId
    ) {
        return;
    }

    const changedGold =
        foundry.utils.getProperty(
            changes,
            "system.currency.gp"
        );

    if (changedGold === undefined) {
        return;
    }

    scheduleGoldSync();
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

    if (isWorldLinked()) {
        const credentials = getActorCredentials();

        if (credentials?.characterId) {
            // Establish an authoritative baseline before any optimistic
            // Foundry -> Harkonians gold update is allowed to run.
            await resyncFoundryState();
            await resyncPendingPurchases();

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