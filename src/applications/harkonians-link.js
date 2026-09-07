
import {
    clearActorCredentials,
    clearWorldConnection,
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

import {
    synchronizeActorGold
} from "../api/harkonians-gold.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const HarkoniansLinkBase =
    HandlebarsApplicationMixin(ApplicationV2);

export class HarkoniansLinkApplication
    extends HarkoniansLinkBase {

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
            linkWorld:
                HarkoniansLinkApplication.#onLinkWorld,

            relinkWorld:
                HarkoniansLinkApplication.#onRelinkWorld,

            linkActor:
                HarkoniansLinkApplication.#onLinkActor
        }
    };

    static PARTS = {
        main: {
            template:
                "modules/harkoniansvtt/templates/link-dialog.hbs"
        }
    };

    async _prepareContext() {
        const worldLinked =
            isWorldLinked();

        const ownedActors =
            [...game.actors.contents]
                .filter(actor => actor.isOwner)
                .sort((a, b) =>
                    a.name.localeCompare(b.name)
                );

        const linkedActor =
            getLinkedActor();

        return {
            isGM:
                game.user.isGM,

            worldLinked,

            worldSecret:
                getWorldSecret(),

            ownedActors:
                ownedActors.map(actor => ({
                    id: actor.id,
                    name: actor.name,
                    type: actor.type,

                    selected:
                        linkedActor?.id === actor.id
                })),

            linkedActor:
                linkedActor
                    ? {
                        id: linkedActor.id,
                        name: linkedActor.name
                    }
                    : null,

            actorLinkEnabled:
                worldLinked &&
                ownedActors.length > 0
        };
    }

    /**
     * Clear the current world connection so that the GM can
     * replace it with a new Harkonians world pairing.
     *
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onRelinkWorld(
        event,
        target
    ) {
        const application =
            getApplicationFromAction(
                target,
                this
            );

        if (
            !application ||
            !game.user.isGM
        ) {
            return;
        }

        try {
            await clearWorldConnection();

            ui.notifications.info(
                "Harkonians world connection cleared. Enter a new pairing code."
            );

            await application.render({
                force: true
            });

        } catch (error) {
            console.error(
                "HarkoniansVTT | Failed to clear world connection:",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to reset the Harkonians world connection."
            );
        }
    }

    /**
     * Link the Foundry world to Harkonians.
     *
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onLinkWorld(
        event,
        target
    ) {
        const application =
            getApplicationFromAction(
                target,
                this
            );

        if (
            !application ||
            !game.user.isGM
        ) {
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
                await confirmWorldPairing(
                    pairingCode
                );

            const worldSecret =
                extractWorldSecret(
                    response
                );

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
             * A newly paired world should never retain
             * credentials belonging to the previous world.
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
                "HarkoniansVTT | World linking failed:",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to link the Harkonians world."
            );
        }
    }

    /**
     * Begin linking a Foundry Actor to a Harkonians Character.
     *
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onLinkActor(
        event,
        target
    ) {
        const application =
            getApplicationFromAction(
                target,
                this
            );

        if (
            !application ||
            !isWorldLinked()
        ) {
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

        const actor =
            game.actors.get(actorId);

        if (
            !actor ||
            !actor.isOwner
        ) {
            return;
        }

        try {
            const linkResponse =
                await createActorLinkRequest(
                    getWorldSecret(),
                    actor
                );

            const requestId =
                linkResponse?.requestId;

            const linkUrl =
                linkResponse?.linkUrl;

            if (
                !requestId ||
                !linkUrl
            ) {
                throw new Error(
                    "Harkonians did not return a valid link request."
                );
            }

            window.open(
                linkUrl,
                "_blank",
                "noopener,noreferrer"
            );

            ui.notifications.info(
                "Complete the Harkonians character authorization in your browser. Foundry will wait for the approval."
            );

            await HarkoniansLinkApplication
                .waitForActorAuthorization(
                    requestId,
                    actor,
                    application
                );

        } catch (error) {
            console.error(
                "HarkoniansVTT | Actor linking failed:",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to link the Actor."
            );
        }
    }

    /**
     * Wait for the browser to authorize the actor link
     * and exchange the request for character credentials.
     *
     * @param {string} requestId
     * @param {Actor} actor
     * @param {Object} application
     */
    static async waitForActorAuthorization(
        requestId,
        actor,
        application
    ) {
        const timeout =
            Date.now() +
            10 * 60 * 1000;

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
                        foundryActorId:
                            actor.id,

                        foundryActorUuid:
                            actor.uuid,

                        characterId,

                        characterToken
                    });

                    try {
                        await synchronizeActorGold(
                            actor
                        );

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
                 * 409 here means the browser has not approved
                 * the character link yet.
                 *
                 * Don't spam the user with errors.
                 */
                if (
                    !error?.message?.includes(
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
