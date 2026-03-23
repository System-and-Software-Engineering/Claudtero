import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { initLocale, getString, getLocaleID };

type LocaleArgs = Record<string, unknown>;

type LocaleOptions = {
  branch?: string;
  args?: LocaleArgs;
};

type LocaleMessageAttribute = {
  name: string;
  value: string;
};

type LocaleMessage = {
  value?: string;
  attributes?: LocaleMessageAttribute[] | Record<string, string>;
};

type LocalizationLike = {
  formatMessagesSync(messages: Array<{ id: string; args?: LocaleArgs }>): LocaleMessage[];
};

type LocaleInput =
  | [localeString: FluentMessageId]
  | [localeString: FluentMessageId, branch: string]
  | [localeString: FluentMessageId, options: LocaleOptions];

/**
 * Initialize locale data
 */
function initLocale() {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([`${config.addonRef}-addon.ftl`], true) as LocalizationLike;
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
function getString(localString: FluentMessageId): string;
function getString(localString: FluentMessageId, branch: string): string;
function getString(
  localeString: FluentMessageId,
  options: LocaleOptions,
): string;
function getString(...inputs: LocaleInput): string {
  const [localeString, secondArgument] = inputs;

  if (secondArgument === undefined) {
    return _getString(localeString);
  } else {
    return _getString(
      localeString,
      typeof secondArgument === "string"
        ? { branch: secondArgument }
        : secondArgument,
    );
  }
}

function _getString(
  localeString: FluentMessageId,
  options: LocaleOptions = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  const pattern = addon.data.locale?.current?.formatMessagesSync?.([
    { id: localStringWithPrefix, args },
  ])[0];
  if (!pattern) {
    return localStringWithPrefix;
  }
  if (branch && pattern.attributes) {
    if (Array.isArray(pattern.attributes)) {
      for (const attribute of pattern.attributes) {
        if (attribute.name === branch) {
          return attribute.value;
        }
      }
    } else if (branch in pattern.attributes) {
      return pattern.attributes[branch] || localStringWithPrefix;
    }

    return localStringWithPrefix;
  }

  return pattern.value || localStringWithPrefix;
}

function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}
