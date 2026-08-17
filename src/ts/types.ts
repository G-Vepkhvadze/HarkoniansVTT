import { ModuleData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/packages.mjs";
import DogBrowser from "./apps/dogBrowser";
import HarkoniansConfig from "./apps/config";

export interface MyModule extends Game.ModuleData<ModuleData> {
  dogBrowser: DogBrowser;
  config: HarkoniansConfig;
}
