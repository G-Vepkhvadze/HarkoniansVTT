// Do not remove this import. If you do Vite will think your styles are dead
// code and not include them in the build output.
import "../styles/style.scss";
import HarkoniansConfig from "./apps/config";
import HarkoniansApp from "./apps/harkonians";
import { moduleId } from "./constants";
import { MyModule } from "./types";

let module: MyModule;

Hooks.once("init", () => {
  console.log(`Initializing ${moduleId}`);

  module = (game as Game).modules.get(moduleId) as MyModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module.config = new HarkoniansConfig({} as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module.harkoniansApp = new HarkoniansApp({} as any);

  // Register world-scoped settings
  (game as Game).settings.register(moduleId, "apiKey", {
    name: (game as Game).i18n.localize("HARKONIANS.apiKeyLabel"),
    hint: (game as Game).i18n.localize("HARKONIANS.apiKeyHint"),
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  (game as Game).settings.register(moduleId, "worldCredential", {
    name: (game as Game).i18n.localize("HARKONIANS.worldCredentialLabel"),
    hint: (game as Game).i18n.localize("HARKONIANS.worldCredentialHint"),
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  (game as Game).settings.register(moduleId, "pairedAt", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
});

Hooks.once("ready", () => {
  // Register Harkonians app in module settings
  (game as Game).settings.registerMenu(moduleId, "harkoniansApp", {
    name: (game as Game).i18n.localize("HARKONIANS.characterManagerTitle"),
    label: (game as Game).i18n.localize("HARKONIANS.manageCharacters"),
    hint: (game as Game).i18n.localize("HARKONIANS.characterManagerHint"),
    icon: "fas fa-user",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: HarkoniansApp as any,
    restricted: false,
  });

  // Keep legacy config menu
  (game as Game).settings.registerMenu(moduleId, "harkoniansConfig", {
    name: (game as Game).i18n.localize("HARKONIANS.configTitle"),
    label: (game as Game).i18n.localize("HARKONIANS.configTitle"),
    hint: (game as Game).i18n.localize("HARKONIANS.apiKeyHint"),
    icon: "fas fa-cog",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: HarkoniansConfig as any,
    restricted: true,
  });
});

Hooks.on("renderActorDirectory", (_: Application, html: JQuery) => {
  const user = (game as Game).user;
  
  if (!user) return;

  const button = $(
    `<button class="harkonians-button" type="button" title="${(game as Game).i18n.localize("HARKONIANS.manageCharacters")}">
      <img src="modules/${moduleId}/styles/favicon.ico" alt="Harkonians" width="24" height="24" />
    </button>`
  );
  button.on("click", () => {
    module.harkoniansApp?.render(true);
  });
  html.find(".directory-header .action-buttons").append(button);
});
