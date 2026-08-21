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
} from "../api/harkonians-api.js";

import {
    getApplicationFromAction,
    extractWorldSecret
} from "../utils.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const HarkoniansLinkBase =
    HandlebarsApplicationMixin(
        ApplicationV2
    );

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
                .filter(
                    actor => actor.isOwner
                )
                .sort(
                    (a, b) =>
                        a.name.localeCompare(
                            b.name
                        )
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
                ownedActors.map(
                    actor => ({
                        id: actor.id,
                        name: actor.name,
                        type: actor.type,

                        selected:
                            linkedActor?.id ===
                            actor.id
                    })
                ),

            linkedActor:
                linkedActor
                    ? {
                        id:
                        linkedActor.id,
                        name:
                        linkedActor.name
                    }
                    : null,

            actorLinkEnabled:
                worldLinked &&
                ownedActors.length > 0
        };
    }

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
                error?.message ||
                "Failed to link the Harkonians world."
            );
        }
    }

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
            const response =
                await createActorLinkRequest(
                    getWorldSecret(),
                    actor
                );

            const requestId =
                response?.requestId;

            const linkUrl =
                response?.linkUrl;

            if (
                !requestId ||
                !linkUrl
            ) {
                throw new Error(
                    "Harkonians did not return a valid link request."
                );
            }

            /*
             * Open the browser authorization
             * page. The user signs in and selects
             * the Harkonians character there.
             */
            window.open(
                linkUrl,
                "_blank",
                "noopener,noreferrer"
            );

            ui.notifications.info(
                "Complete the Harkonians character authorization in your browser. Foundry will wait for the approval."
            );

            /*
             * Poll until the browser-side authorization
             * has finished.
             */
            await this.#waitForActorAuthorization(
                requestId,
                actor
            );

            await application.render({
                force: true
            });

        } catch (error) {
            console.error(
                "HarkoniansVTT | Actor linking failed",
                error
            );

            ui.notifications.error(
                error?.message ||
                "Failed to link the Actor."
            );
        }
    }

    static async #waitForActorAuthorization(
        requestId,
        actor
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

                    ui.notifications.info(
                        `${actor.name} was linked to Harkonians.`
                    );

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
                    !error.message.includes(
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