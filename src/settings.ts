import { PluginSettingTab, SettingDefinitionItem } from "obsidian";

import type { App, Setting } from "obsidian";
import { WhitelistFolderEditor } from "./ui/WhitelistFolderEditor";

import NotebundlePlugin from "./main";
import { t } from "./i18n";

export interface NotebundlePluginSettings {
    language: "auto"; // exist for manually force plugin language. intended to hidden in settings ui

    auto_convert_markdown: boolean;
    auto_convert_canvas: boolean;

    auto_convert_scope: "vault-global" | "whitelist";
    auto_convert_whitelist_folders: string[];

    convert_primary_note_file_naming_rule: "bundle-name" | "note";

    file_explorer_patch_enabled: boolean;
    file_explorer_open_primary_note_on_click: boolean;
    file_explorer_sort_notebundle_as_file: boolean;

    force_adjust_markdown_notebundle_attachment_link_as_relative: boolean;
    force_adjust_bundle_move_when_primary_note_moved: boolean;

    // WIP / Testing features
    lab_disable_auto_collect_attachments_in_bundles: boolean;
    lab_attachment_collection_excluded_extensions: string[];
    lab_manual_conversion_mode: "review" | "note-only" | "collect";
    lab_show_current_bundle_inspect: boolean;
    lab_rename_modal_enabled: boolean;
}

export const DEFAULT_SETTINGS: NotebundlePluginSettings = {
    language: "auto",

    auto_convert_markdown: true,
    auto_convert_canvas: false,

    auto_convert_scope: "vault-global",
    auto_convert_whitelist_folders: [],

    convert_primary_note_file_naming_rule: "bundle-name",

    file_explorer_patch_enabled: true,
    file_explorer_open_primary_note_on_click: true,
    file_explorer_sort_notebundle_as_file: true,

    force_adjust_markdown_notebundle_attachment_link_as_relative: true,
    force_adjust_bundle_move_when_primary_note_moved: true,

    lab_disable_auto_collect_attachments_in_bundles: false,
    lab_attachment_collection_excluded_extensions: ["md", "canvas", "base"],
    lab_manual_conversion_mode: "collect",
    lab_show_current_bundle_inspect: false,
    lab_rename_modal_enabled: false,
};

function renderNamingExample(
    container: HTMLElement,
    label: string,
    fileName: string,
    selected: boolean,
): void {
    container.createDiv(
        { cls: `notebundle-naming-example${selected ? " is-selected" : ""}` },
        (exampleRow) => {
            exampleRow.createSpan({ cls: "notebundle-naming-example-title", text: label });

            exampleRow.createEl("code", {
                cls: "notebundle-naming-example-path",
                text: `my-note.notebundle/${fileName}`,
            });
        },
    );
}

export class NotebundlePluginSettingTab extends PluginSettingTab {
    private readonly plugin: NotebundlePlugin;
    private readonly whitelistEditor: WhitelistFolderEditor;
    private autoConversionDescriptionEl: HTMLElement | null = null;
    private namingExamplesEl: HTMLElement | null = null;

    public constructor(app: App, plugin: NotebundlePlugin) {
        super(app, plugin);

        this.plugin = plugin;

        this.whitelistEditor = new WhitelistFolderEditor(app, {
            getPaths: () => this.plugin.settings.auto_convert_whitelist_folders,
            savePaths: (paths) => this.saveWhitelistFolders(paths),
            onRowsChanged: () => this.update(),
            visible: () => this.plugin.settings.auto_convert_scope === "whitelist",
        });
    }
    public override getControlValue(key: string): unknown {
        if (key === "lab_attachment_collection_excluded_extensions")
            return this.plugin.settings.lab_attachment_collection_excluded_extensions.join(", ");
        return super.getControlValue(key);
    }

    public override async setControlValue(key: string, value: unknown): Promise<void> {
        if (key === "lab_attachment_collection_excluded_extensions" && typeof value === "string") {
            const extensions = value
                .split(/[,\s]+/)
                .map((item) => item.replace(/^\./, "").toLowerCase())
                .filter(Boolean);
            value = [...new Set(extensions)];
        }
        try {
            await super.setControlValue(key, value);
        } finally {
            // Preserve the existing feature-application behavior for in-memory settings.
            this.plugin.applySettingsToRuntimeFeature(key);

            if (key.startsWith("auto_convert_")) {
                this.updateAutoConversionDescription();
            }

            if (key === "convert_primary_note_file_naming_rule") {
                this.updateNamingExamples();
            }
            this.refreshDomState();
        }
    }

    public override getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            this.getIntroductionSettings(),
            this.getAutoConversionSettings(),
            this.whitelistEditor.getSettingDefinition(),
            this.getNamingSettings(),
            this.getLinkAndMoveSettings(),
            this.getFileExplorerSettings(),
            this.getLabSettings(),
        ];
    }

    private getIntroductionSettings(): SettingDefinitionItem {
        return {
            type: "group",
            items: [
                {
                    name: t("settings.about_notebundle"),
                    render: (setting) => {
                        setting.descEl.addClass("notebundle-setting-prose");
                    },
                    desc: createFragment((fragment) => {
                        fragment.append(
                            convertSimpleMarkdown2Fragment(t("settings.notebundle_introduction")),
                        );
                        fragment.createDiv().createEl("a", {
                            text: t("settings.open_convention_intro"),
                            href: "https://github.com/leehan273/notebundle",
                        });
                    }),
                },
                {
                    name: "",
                    render: (setting) => {
                        setting.setClass("notebundle-plugin-info");
                    },
                    desc: createFragment((fragment) => {
                        fragment.createEl("strong", { text: t("settings.obsidian_plugin_name") });
                        fragment.appendText(` v${this.plugin.manifest.version} · `);
                        fragment.createEl("a", {
                            text: t("settings.plugin_repository"),
                            href: "https://github.com/leehan273/obsidian-notebundle",
                        });
                        fragment.appendText(" · ");
                        fragment.createEl("a", {
                            text: t("settings.report_an_issue"),
                            href: "https://github.com/leehan273/obsidian-notebundle/issues",
                        });
                    }),
                },
            ],
        };
    }

    private getAutoConversionSettings(): SettingDefinitionItem {
        return {
            type: "group",
            heading: t("settings.automatic_notebundle_conversion"),
            items: [
                {
                    name: "",
                    render: (setting: Setting) => {
                        this.autoConversionDescriptionEl = setting.descEl;
                        setting.descEl.addClass("notebundle-auto-conversion-description");
                        this.updateAutoConversionDescription();
                        return () => {
                            if (this.autoConversionDescriptionEl === setting.descEl)
                                this.autoConversionDescriptionEl = null;
                        };
                    },
                },
                {
                    name: t("settings.automatic_conversion_scope"),
                    desc: t("settings.automatic_conversion_scope_description"),
                    control: {
                        type: "dropdown",
                        key: "auto_convert_scope",
                        options: {
                            "vault-global": t("settings.entire_vault"),
                            whitelist: t("settings.specific_locations"),
                        },
                    },
                },
                {
                    name: t("settings.automatically_convert_markdown_files"),
                    desc: t("settings.automatically_convert_markdown_files_description"),
                    control: { type: "toggle", key: "auto_convert_markdown" },
                },
                {
                    name: t("settings.automatically_convert_canvas_files"),
                    desc: t("settings.automatically_convert_canvas_files_description"),
                    control: { type: "toggle", key: "auto_convert_canvas" },
                },
            ],
        };
    }

    private getNamingSettings(): SettingDefinitionItem {
        return {
            type: "group",
            heading: t("settings.file_naming_on_conversion"),
            items: [
                {
                    name: t("settings.note_file_name_on_conversion"),
                    desc: convertSimpleMarkdown2Fragment(
                        t("settings.note_file_name_on_conversion_description"),
                    ),
                    control: {
                        type: "dropdown",
                        key: "convert_primary_note_file_naming_rule",
                        options: {
                            "bundle-name": t("settings.keep_original_file_name"),
                            note: "note.*",
                        },
                    },
                },
                {
                    name: t("settings.conversion_examples"),
                    render: (setting) => {
                        setting.setClass("notebundle-naming-examples-setting");
                        this.namingExamplesEl = setting.descEl;
                        this.updateNamingExamples();
                        return () => {
                            if (this.namingExamplesEl === setting.descEl)
                                this.namingExamplesEl = null;
                        };
                    },
                },
            ],
        };
    }

    private getLinkAndMoveSettings(): SettingDefinitionItem {
        return {
            type: "group",
            heading: t("settings.adjust_obsidian_internal_behavior"),
            cls: "notebundle-wrap-setting-descriptions",
            items: [
                {
                    name: "",
                    render: (setting) => {
                        setting.descEl.addClass("notebundle-setting-prose");
                        setting.setDesc(
                            convertSimpleMarkdown2Fragment(
                                t("settings.adjust_obsidian_internal_behavior_description"),
                            ),
                        );
                    },
                },
                {
                    name: t("settings.use_relative_paths_for_notebundle_attachments"),
                    desc: convertSimpleMarkdown2Fragment(
                        t("settings.use_relative_paths_for_notebundle_attachments_description"),
                    ),
                    control: {
                        type: "toggle",
                        key: "force_adjust_markdown_notebundle_attachment_link_as_relative",
                    },
                },
                {
                    name: t("settings.move_notebundle_when_primary_note_is_moved"),
                    desc: t("settings.move_notebundle_when_primary_note_is_moved_description"),
                    control: {
                        type: "toggle",
                        key: "force_adjust_bundle_move_when_primary_note_moved",
                    },
                },
            ],
        };
    }

    private getFileExplorerSettings(): SettingDefinitionItem {
        return {
            type: "group",
            heading: t("settings.file_explorer"),
            cls: "notebundle-wrap-setting-descriptions",
            items: [
                {
                    name: t("settings.enable_file_explorer_integration"),
                    desc: "",
                    control: { type: "toggle", key: "file_explorer_patch_enabled" },
                },
                {
                    name: t("settings.open_primary_note_when_notebundle_is_clicked"),
                    desc: t("settings.open_primary_note_when_notebundle_is_clicked_description"),
                    control: {
                        type: "toggle",
                        key: "file_explorer_open_primary_note_on_click",
                        disabled: () => this.plugin.settings.file_explorer_patch_enabled === false,
                    },
                },
                {
                    name: t("settings.sort_notebundles_as_regular_files"),
                    desc: t("settings.sort_notebundles_as_regular_files_description"),
                    control: {
                        type: "toggle",
                        key: "file_explorer_sort_notebundle_as_file",
                        disabled: () => this.plugin.settings.file_explorer_patch_enabled === false,
                    },
                },
            ],
        };
    }

    private getLabSettings(): SettingDefinitionItem {
        return {
            type: "group",
            heading: "Lab",
            items: [
                {
                    name: "Manual conversion mode",
                    desc: "Change how manual notebundle conversion works.",
                    control: {
                        type: "dropdown",
                        key: "lab_manual_conversion_mode",
                        options: {
                            collect: "Collect attachments",
                            "note-only": "Only move the note file",
                            review: "Review attachments",
                        },
                    },
                },
                {
                    name: "Disable automatic attachment collection",
                    control: {
                        type: "toggle",
                        key: "lab_disable_auto_collect_attachments_in_bundles",
                    },
                },
                {
                    name: "Excluded attachment extensions from full collection",
                    desc: "Separated by commas. Applies only to full attachment collect operations for existing references.",
                    control: {
                        type: "text",
                        key: "lab_attachment_collection_excluded_extensions",
                        placeholder: "md, canvas",
                    },
                },
                {
                    name: "Current bundle inspector",
                    desc: "Add a status bar button for bundle inspection.",
                    control: { type: "toggle", key: "lab_show_current_bundle_inspect" },
                },
                {
                    name: "Rename modal",
                    desc: "Add a separate rename dialog to the bundle context menu.",
                    control: {
                        type: "toggle",
                        key: "lab_rename_modal_enabled",
                        disabled: () => !this.plugin.settings.file_explorer_patch_enabled,
                    },
                },
            ],
        };
    }

    private updateAutoConversionDescription(): void {
        const description = this.autoConversionDescriptionEl;
        if (!description) return;
        const settings = this.plugin.settings;
        const isAutoConversionDisabled =
            (!settings.auto_convert_markdown && !settings.auto_convert_canvas) ||
            (settings.auto_convert_scope === "whitelist" &&
                !settings.auto_convert_whitelist_folders.length);
        description.empty();
        description.append(
            convertSimpleMarkdown2Fragment(
                isAutoConversionDisabled
                    ? t("settings.automatic_conversion_is_disabled")
                    : t("settings.automatic_conversion_runs_when_attachment_is_added"),
            ),
        );
    }

    private updateNamingExamples(): void {
        const container = this.namingExamplesEl;
        if (!container) return;
        container.empty();
        const source = container.createDiv({ cls: "notebundle-naming-example-source" });
        source.createEl("code", { text: "my-note.md" });
        source.createSpan({ text: t("settings.original_file_label") });
        const selectedRule = this.plugin.settings.convert_primary_note_file_naming_rule;
        for (const example of [
            {
                rule: "bundle-name",
                label: t("settings.keep_original_file_name"),
                fileName: "my-note.md",
            },
            { rule: "note", label: "note", fileName: "note.md" },
        ]) {
            renderNamingExample(
                container,
                example.label,
                example.fileName,
                example.rule === selectedRule,
            );
        }
    }

    private async saveWhitelistFolders(paths: string[]): Promise<void> {
        const previous = this.plugin.settings.auto_convert_whitelist_folders;

        try {
            await super.setControlValue("auto_convert_whitelist_folders", paths);
            this.updateAutoConversionDescription();
            this.refreshDomState();
        } catch (error) {
            if (this.plugin.settings.auto_convert_whitelist_folders === paths) {
                this.plugin.settings.auto_convert_whitelist_folders = previous;
            }
            throw error;
        }
    }
}

// Supports list:
//
// - text lines
// - **bold**
// - `inline code`
// - flat - / * lists.
function convertSimpleMarkdown2Fragment(source: string): DocumentFragment {
    const fragment = createFragment();
    let list: HTMLUListElement | undefined;

    function appendInline(parent: HTMLElement, text: string): void {
        let cursor = 0;

        for (const match of text.matchAll(/`([^`\n]+)`|\*\*([^\n]+?)\*\*/g)) {
            parent.append(parent.ownerDocument.createTextNode(text.slice(cursor, match.index)));

            if (match[1] !== undefined) {
                const code = createEl("code");
                code.textContent = match[1];
                parent.append(code);
            } else {
                const strong = createEl("strong");
                appendInline(strong, match[2] ?? "");
                parent.append(strong);
            }

            cursor = match.index + match[0].length;
        }

        parent.append(parent.ownerDocument.createTextNode(text.slice(cursor)));
    }

    for (const line of source.trim().split(/\r?\n/)) {
        const text = line.trim();

        if (!text) {
            list = undefined;
            continue;
        }

        const item = /^(?:-|\*)\s+(.+)$/.exec(text);

        if (item) {
            if (!list) {
                list = createEl("ul");
                fragment.append(list);
            }

            const li = createEl("li");
            appendInline(li, item[1] ?? "");
            list.append(li);
        } else {
            list = undefined;
            const div = createDiv();
            appendInline(div, text);
            fragment.append(div);
        }
    }

    return fragment;
}
