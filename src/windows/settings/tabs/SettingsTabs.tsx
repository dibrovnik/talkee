import type { ReactElement } from "react";

import { ModelsTab } from "./model/ModelsTab";
import type { SettingsTabsProps } from "./settingsTabsTypes";
import { StyleTab } from "./style/StyleTab";

export function SettingsTabs({ type }: SettingsTabsProps): ReactElement {
  return type === "model" ? <ModelsTab /> : <StyleTab />;
}
