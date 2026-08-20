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
    linkActor
} from "../api/harkonians-api.js";

import {
    extractActorCredentials,
    getApplicationFromAction,
    extractWorldSecret
} from "../utils.js";

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
            const response = await linkActor(
                getWorldSecret(),
                actor
            );

            const credentials =
                extractActorCredentials(
                    response,
                    actor
                );

            await saveActorCredentials(credentials);

            ui.notifications.info(
                `${actor.name} was linked to Harkonians.`
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
                error.message ||
                "Failed to link the Actor."
            );
        }
    }
}