import { getLanguage } from "obsidian";

import { en_us } from "./en-us";
import { ko_kr } from "./ko-kr";
import type { MessageKey, Messages } from "./en-us";

const locales: Record<"en" | "ko", Messages> = {
    en: en_us,
    ko: { ...en_us, ...ko_kr },
};

let messages: Messages = en_us;

export function initI18n(language: string): void {
    const selected = language === "auto" ? getLanguage() : language;

    messages = locales.en;

    if (selected === "ko") {
        messages = locales.ko;
    }
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
    return messages[key].replace(/\{(\w+)\}/g, (placeholder: string, name: string): string => {
        const value = vars[name];
        return value === undefined ? placeholder : String(value);
    });
}
