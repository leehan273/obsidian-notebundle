import { Plugin } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { DEFAULT_SETTINGS, NotebundlePluginSettings, NotebundlePluginSettingTab } from "./settings";
import { NotebundleRenameSynchronizer } from "./components/NotebundleRenameSynchronizer";
import { CoreFileExplorerPatchManager } from "./components/CoreFileExplorerPatchManager";
import { NotebundleAttachmentsHandler } from "./components/NotebundleAttachmentsHandler";
import { NotebundleAttachmentLinkPatcher } from "./components/NotebundleAttachmentLinkPatcher";
import { NotebundleActions } from "./actions/NotebundleActions";
import { NotebundleMenus } from "./components/NotebundleMenus";
import { NotebundleInspector } from "./components/NotebundleInspector";
import { NotebundleMoveInterceptor } from "./components/NotebundleMoveInterceptor";
import { initI18n } from "./i18n";
import { showNotebundleError } from "./ui/NotebundleNotice";

export default class NotebundlePlugin extends Plugin {
    settings!: NotebundlePluginSettings;

    private moveInterceptor!: NotebundleMoveInterceptor;
    private menus!: NotebundleMenus;
    private explorerPatchManager!: CoreFileExplorerPatchManager;
    private actions!: NotebundleActions;
    private inspector: NotebundleInspector | null = null;

    async onload() {
        const savedSettings = (await this.loadData()) as Partial<NotebundlePluginSettings>;
        this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
        initI18n(this.settings.language);

        const { app } = this;
        const getSettings = () => this.settings;
        this.moveInterceptor = new NotebundleMoveInterceptor(
            app,
            () => this.settings.force_adjust_bundle_move_when_primary_note_moved,
        );
        const actions = new NotebundleActions(
            app,
            (file, path) => this.moveInterceptor.detachFile(file, path),
            () => this.settings.lab_attachment_collection_excluded_extensions,
        );
        this.actions = actions;

        this.addSettingTab(new NotebundlePluginSettingTab(app, this));

        this.addChild(actions);
        this.addChild(new NotebundleAttachmentsHandler(app, actions, getSettings));

        this.explorerPatchManager = this.addChild(
            new CoreFileExplorerPatchManager(app, getSettings),
        );
        this.menus = this.addChild(new NotebundleMenus(this, actions, getSettings));

        this.updateInspector();

        this.addChild(new NotebundleRenameSynchronizer(app, app.vault));
        this.addChild(
            new NotebundleAttachmentLinkPatcher(
                app,
                () => this.settings.force_adjust_markdown_notebundle_attachment_link_as_relative,
            ),
        );

        this.addChild(this.moveInterceptor);

        this.registerEvent(
            app.vault.on("rename", (file, oldPath) => this.followWhitelistRename(file, oldPath)),
        );
    }

    private followWhitelistRename(file: TAbstractFile, oldPath: string): void {
        let changed = false;

        this.settings.auto_convert_whitelist_folders =
            this.settings.auto_convert_whitelist_folders.map((path) => {
                if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return path;
                changed = true;
                return file.path + path.slice(oldPath.length);
            });

        if (changed) {
            void this.saveData(this.settings).catch((error: unknown) => showNotebundleError(error));
        }
    }

    public applySettingsToRuntimeFeature(changedKey?: string): void {
        this.menus.applySettings();
        if (changedKey === undefined || changedKey === "lab_show_current_bundle_inspect")
            this.updateInspector();
        if (changedKey === undefined || changedKey === "file_explorer_patch_enabled")
            this.explorerPatchManager.updateActivationState();
        if (
            changedKey === undefined ||
            changedKey === "file_explorer_open_primary_note_on_click" ||
            changedKey === "file_explorer_sort_notebundle_as_file"
        )
            this.explorerPatchManager.updateControllerSettings();
        if (
            changedKey === undefined ||
            changedKey === "force_adjust_bundle_move_when_primary_note_moved"
        )
            this.moveInterceptor.updateActivationState();
    }

    private updateInspector(): void {
        if (this.settings.lab_show_current_bundle_inspect) {
            if (!this.inspector)
                this.inspector = this.addChild(new NotebundleInspector(this, this.actions));
        } else if (this.inspector) {
            this.removeChild(this.inspector);
            this.inspector = null;
        }
    }
}
