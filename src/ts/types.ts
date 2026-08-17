import { ModuleData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/packages.mjs";
import HarkoniansConfig from "./apps/config";
import HarkoniansApp from "./apps/harkonians";

export interface MyModule extends Game.ModuleData<ModuleData> {
  config: HarkoniansConfig;
  harkoniansApp?: HarkoniansApp;
}
