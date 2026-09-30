// Central message registry. Each area lives in its own file under ./dict so that
// translations can be added per-feature without merge conflicts; they are merged
// here into one typed lookup. To add a new area: create ./dict/<area>.ts exporting
// `as const`, import it, and spread it into MESSAGES below.
import { cleanup } from "./dict/cleanup";
import { common } from "./dict/common";
import { components } from "./dict/components";
import { libMessages } from "./dict/libMessages";
import { onboarding } from "./dict/onboarding";
import { settingsGeneral } from "./dict/settingsGeneral";
import { settingsModels } from "./dict/settingsModels";
import { settingsRest } from "./dict/settingsRest";
import { settingsTabsMisc } from "./dict/settingsTabsMisc";
import { summary } from "./dict/summary";
import { widget } from "./dict/widget";

export const MESSAGES = {
  ...cleanup,
  ...common,
  ...settingsGeneral,
  ...settingsModels,
  ...settingsTabsMisc,
  ...settingsRest,
  ...widget,
  ...components,
  ...libMessages,
  ...summary,
  ...onboarding,
} as const;

export type MsgKey = keyof typeof MESSAGES;
