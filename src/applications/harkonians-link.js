/**
 * HarkoniansVTT
 *
 * World and Actor linking application.
 */

import {
    clearActorCredentials,
    getLinkedActor,
    getWorldSecret,
    isWorldLinked,
    saveActorCredentials
} from "../state.js";

import {
    confirmWorldPairing,
    createActorLinkRequest,
    exchangeActorLink
} from "../api/client.js";

import {
    getApplicationFromAction,
    extractWorldSecret
} from "../utils.js";
import {getActorGold, synchronizeActorGold} from "../api/harkonians-gold.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const HarkoniansLinkBase =
    HandlebarsApplicationMixin(ApplicationV2);

export class HarkoniansLinkApplication extends HarkoniansLinkBase {
    static DEFAULT_OPTIONS = {
        id: "harkonians-link",
        classes: [
            "harkoniansvtt",
            "harkonians-link"
        ],
        position: {
            width: 520,
            height: "auto"
        },
        window: {
            title: "Harkonians",
            icon: "fa-solid fa-store",
            resizable: false
        },
        actions: {
            linkWorld: HarkoniansLinkApplication.#onLinkWorld,
            linkActor: HarkoniansLinkApplication.#onLinkActor
        }
    };

    static PARTS = {
        main: {
            template:
                "modules/harkoniansvtt/templates/link-dialog.hbs"
        }
    };

    async _prepareContext() {
        const worldLinked = isWorldLinked();

        const ownedActors = [...game.actors.contents]
            .filter(actor => actor.isOwner)
            .sort((a, b) =>
                a.name.localeCompare(b.name)
            );

        const linkedActor = getLinkedActor();

        return {
            isGM: game.user.isGM,
            worldLinked,
            worldSecret: getWorldSecret(),
            ownedActors: ownedActors.map(actor => ({
                id: actor.id,
                name: actor.name,
                type: actor.type,
                selected:
                    linkedActor?.id === actor.id
            })),
            linkedActor: linkedActor
                ? {
                    id: linkedActor.id,
                    name: linkedActor.name
                }
                : null,
            actorLinkEnabled: worldLinked && ownedActors.length > 0
        };
    }

    static async #onLinkWorld(event, target) {
        const application =
            getApplicationFromAction(target, this);

        if (!application || !game.user.isGM) {
            return;
        }

        const input =
            application.element?.querySelector(
                '[name="pairingCode"]'
            );

        const pairingCode =
            input?.value?.trim() ?? "";

        if (!pairingCode) {
            ui.notifications.warn(
                "Enter the Harkonians world linking code."
            );
            return;
        }

        try {
            const response =
                await confirmWorldPairing(pairingCode);

            const worldSecret =
                extractWorldSecret(response);

            if (!worldSecret) {
                throw new Error(
                    "Harkonians did not return a world secret."
                );
            }

            /*
             * The one-time pairing code is never stored.
             * Only the persistent world secret is saved.
             */
            await game.settings.set(
                "harkoniansvtt",
                "worldSecret",
                worldSecret
            );

            await game.settings.set(
                "harkoniansvtt",
                "pairedAt",
                new Date().toISOString()
            );

            /*
             * A newly paired world should not retain a character
             * credential from a previous pairing.
             */
            await clearActorCredentials();

            ui.notifications.info(
                "Harkonians world linked successfully."
            );

            await application.render({
                force: true
            });
        } catch (error) {
            console.error(
                "HarkoniansVTT | World linking failed",
                error
            );

            ui.notifications.error(
                error.message ||
                "Failed to link the Harkonians world."
            );
        }
    }

    static async #onLinkActor(event, target) {
        const application =
            getApplicationFromAction(target, this);

        /*
         * Until the world is linked, this action intentionally does
         * nothing. This is part of the requested UX.
         */
        if (!application || !isWorldLinked()) {
            return;
        }

        const select =
            application.element?.querySelector(
                '[name="actorId"]'
            );

        const actorId =
            select?.value ?? "";

        if (!actorId) {
            return;
        }

        const actor = game.actors.get(actorId);

        if (!actor || !actor.isOwner) {
            return;
        }

        try {
            // Create link request
            const linkResponse = await createActorLinkRequest(
                getWorldSecret(),
                actor
            );

            const requestId = linkResponse?.requestId;
            const linkUrl = linkResponse?.linkUrl;

            if (!requestId || !linkUrl) {
                throw new Error(
                    "Harkonians did not return a valid link request."
                );
            }

            // Open browser for authorization
            window.open(
                linkUrl,
                "_blank",
                "noopener,noreferrer"
            );

            ui.notifications.info(
                "Complete the Harkonians character authorization in your browser. Foundry will wait for the approval."
            );

            // Poll for approval and exchange
            await waitForActorAuthorization(
                requestId,
                actor,
                application
            );
        } catch (error) {
            console.error(
                "HarkoniansVTT | Actor linking failed",
                error
            );

            ui.notifications.error(
                error.message ||
                "Failed to link the Actor."
            );
        }
    }

    /**
     * Wait for the browser to authorize the actor link and exchange for credentials.
     * 
     * @param {string} requestId - The link request ID
     * @param {Actor} actor - The Foundry Actor
     * @param {Object} application - The application instance
     */
    static async waitForActorAuthorization(
        requestId,
        actor,
        application
    ) {
        const timeout =
            Date.now() +
            10 * 60 * 1000; // 10 minutes

        while (
            Date.now() <
            timeout
        ) {
            try {
                const response =
                    await exchangeActorLink(
                        getWorldSecret(),
                        requestId
                    );

                const characterToken =
                    response?.characterToken;

                const characterId =
                    response?.characterId;

                if (
                    characterToken &&
                    characterId
                ) {
                    await saveActorCredentials({
                        foundryActorId: actor.id,
                        foundryActorUuid: actor.uuid,
                        characterId,
                        characterToken
                    });

                    ui.notifications.info(
                        `${actor.name} was linked to Harkonians.`
                    );

                    await application.render({
                        force: true
                    });

                    try {
                        await synchronizeActorGold(actor);
                    } catch (error) {
                        console.error(
                            "HarkoniansVTT | Initial gold sync failed:",
                            error
                        );

                        ui.notifications.warn(
                            "Harkonians | Character linked, but initial gold synchronization failed."
                        );
                    }

                    ui.notifications.info(
                        `${actor.name} was linked to Harkonians successfully.`
                    );

                    await application.close();

                    return;
                }

            } catch (error) {
                /*
                 * 409 here means the browser hasn't
                 * approved the link yet.
                 *
                 * Don't spam the user with errors.
                 */
                if (
                    !error.message?.includes(
                        "has not approved"
                    )
                ) {
                    throw error;
                }
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        2000
                    )
            );
        }

        throw new Error(
            "Character linking timed out."
        );
    }
}