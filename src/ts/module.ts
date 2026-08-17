// Do not remove this import. If you do Vite will think your styles are dead
// code and not include them in the build output.
import "../styles/style.scss";
import DogBrowser from "./apps/dogBrowser";
import HarkoniansConfig from "./apps/config";
import { moduleId } from "./constants";
import { MyModule } from "./types";

let module: MyModule;

Hooks.once("init", () => {
  console.log(`Initializing ${moduleId}`);

  module = (game as Game).modules.get(moduleId) as MyModule;
  module.dogBrowser = new DogBrowser();
  module.config = new HarkoniansConfig();

  // Register the API key setting
  (game as Game).settings.register(moduleId, "apiKey", {
    name: (game as Game).i18n.localize("HARKONIANS.apiKeyLabel"),
    hint: (game as Game).i18n.localize("HARKONIANS.apiKeyHint"),
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
});

Hooks.once("ready", () => {
  // Add configuration button to the module settings
  (game as Game).settings.registerMenu(moduleId, "harkoniansConfig", {
    name: (game as Game).i18n.localize("HARKONIANS.configTitle"),
    label: (game as Game).i18n.localize("HARKONIANS.configTitle"),
    hint: (game as Game).i18n.localize("HARKONIANS.apiKeyHint"),
    icon: "fas fa-cog",
    type: HarkoniansConfig,
    restricted: true,
  });
});

Hooks.on("renderActorDirectory", (_: Application, html: JQuery) => {
  const button = $(
    `<button class="cc-sidebar-button" type="button">🐶</button>`
  );
  button.on("click", () => {
    module.dogBrowser.render(true);
  });
  html.find(".directory-header .action-buttons").append(button);
});
