import { moduleId } from "../constants";

export default class HarkoniansConfig extends FormApplication {
  static override get defaultOptions(): FormApplicationOptions {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "harkonians-config",
      title: (game as Game).i18n.localize("HARKONIANS.configTitle"),
      template: `modules/${moduleId}/templates/config.hbs`,
      width: 400,
      height: "auto",
      closeOnSubmit: true,
    }) as FormApplicationOptions;
  }

  override getData(options?: Partial<FormApplicationOptions> | undefined): object | Promise<object> {
    return {
      apiKey: (game as Game).settings.get(moduleId, "apiKey"),
    };
  }

  override async _updateObject(_: Event, formData?: object): Promise<void> {
    if (formData) {
      const data = formData as Record<string, string>;
      await (game as Game).settings.set(moduleId, "apiKey", data.apiKey);
    }
  }
}
