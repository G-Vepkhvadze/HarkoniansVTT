
import {
    registerSettings,
    getWorldSecret,
    isWorldLinked
} from "./state.js";

import {
    HarkoniansLinkApplication
} from "./applications/harkonians-link.js";

import {
    HarkoniansItemPublisher
} from "./applications/harkonians-item-publisher.js";


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

            if (!item || item.documentName !== "Item") {
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
            const originalOnClickAction =
                application._onClickAction.bind(application);

            application._onClickAction =
                async function(event, target) {
                    const action =
                        target?.dataset?.action;

                    if (action === ITEM_ACTION) {
                        if (!isWorldLinked()) {
                            return;
                        }

                        const currentItem =
                            this.document;

                        if (!currentItem) {
                            return;
                        }
                        const existing =
                            foundry.applications.instances.get(
                                "harkonians-item-publisher"
                            );

                        if (existing) {
                            await existing.close();
                        }
                        await new HarkoniansItemPublisher(
                            currentItem
                        ).render({
                            force: true
                        });

                        return;
                    }
                    return originalOnClickAction(
                        event,
                        target
                    );
                };

            controls.push({
                action: ITEM_ACTION,
                label: "Add to Harkonians",
                icon: "fa-solid fa-store",
                visible: true
            });
        }
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
});


/* Ready*/

Hooks.once("ready", () => {
    console.log(
        "HarkoniansVTT | Ready.",
        {
            worldLinked: isWorldLinked(),
            worldId: game.world.id,
            systemId: game.system.id,
            systemVersion: game.system.version
        }
    );
});