import { App, Component, Notice } from "obsidian";

import type { NotebundlePluginSettings } from "../settings";
import { ExplorerViewController } from "../explorer/ExplorerViewController";
import type { ExplorerView } from "../explorer/ExplorerInternals";
import { t } from "../i18n";

export class CoreFileExplorerPatchManager extends Component {
    private readonly app: App;
    private readonly getPluginSettings: () => NotebundlePluginSettings;

    private controllers = new Map<ExplorerView, ExplorerViewController>();
    private readonly unavailableFeatures = new Set<"explorer" | "sort">();

    public constructor(app: App, getPluginSettings: () => NotebundlePluginSettings) {
        super();

        this.app = app;
        this.getPluginSettings = getPluginSettings;
    }

    public onload(): void {
        this.registerEvent(
            this.app.workspace.on("file-open", () =>
                this.broadcastEvent("file-open", (controller) => controller.onFileOpen()),
            ),
        );
        this.registerEvent(
            this.app.vault.on("create", (file) =>
                this.broadcastEvent("create", (controller) => controller.onFileTreeChange(file)),
            ),
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) =>
                this.broadcastEvent("delete", (controller) => controller.onFileTreeChange(file)),
            ),
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) =>
                this.broadcastEvent("rename", (controller) =>
                    controller.onFileTreeChange(file, oldPath),
                ),
            ),
        );
        this.registerEvent(
            this.app.vault.on("modify", (file) =>
                this.broadcastEvent("modify", (controller) => controller.onFileContentChange(file)),
            ),
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => this.syncExplorerViewControllers()),
        );

        this.app.workspace.onLayoutReady(() => this.updateActivationState());
    }

    public onunload(): void {
        this.controllers.forEach((controller, view) => this.detachController(view, controller));
    }

    public updateActivationState(): void {
        if (this.getPluginSettings().file_explorer_patch_enabled === true) {
            this.syncExplorerViewControllers();
        } else {
            this.controllers.forEach((controller, view) => this.detachController(view, controller));
        }
    }

    public updateControllerSettings(): void {
        const settings = this.getPluginSettings();

        if (settings.file_explorer_patch_enabled !== true) return;

        const options = {
            open_primary_note_on_click: settings.file_explorer_open_primary_note_on_click,
            sort_notebundle_as_file: settings.file_explorer_sort_notebundle_as_file,
        };

        this.controllers.forEach((controller, view) => {
            try {
                controller.applyOptions(options);
            } catch (error) {
                console.error(
                    "obsidian-notebundle: Could not apply File Explorer settings",
                    view,
                    error,
                );
            }
        });
    }

    private syncExplorerViewControllers(): void {
        if (this.getPluginSettings().file_explorer_patch_enabled !== true) return;

        const currentViews = new Set<ExplorerView>(
            this.app.workspace
                .getLeavesOfType("file-explorer")
                .filter((leaf) => !leaf.isDeferred) // filter not loaded file explorer
                .map((leaf) => leaf.view),
        );

        Array.from(this.controllers)
            .filter(([view, _viewController]) => !currentViews.has(view))
            .forEach(([view, controller]) => {
                this.detachController(view, controller);
            });

        currentViews.forEach((view) => {
            const controller = this.controllers.get(view);

            if (controller) {
                try {
                    controller.requestRefresh();
                } catch (error) {
                    console.error(
                        "obsidian-notebundle: Could not refresh File Explorer",
                        view,
                        error,
                    );
                }
            } else {
                this.attachController(view);
            }
        });
    }

    private attachController(view: ExplorerView): void {
        const settings = this.getPluginSettings();

        const initialOptions = {
            open_primary_note_on_click: settings.file_explorer_open_primary_note_on_click,
            sort_notebundle_as_file: settings.file_explorer_sort_notebundle_as_file,
        };

        try {
            const newController = new ExplorerViewController(
                this.app,
                view,
                initialOptions,
                (feature) => this.reportUnavailableFeature(feature),
            );
            this.controllers.set(view, newController);
        } catch (error) {
            console.error("obsidian-notebundle: Failed to patch Obsidian File Explorer", error);
            this.reportUnavailableFeature("explorer");
        }
    }

    private reportUnavailableFeature(feature: "explorer" | "sort"): void {
        if (this.unavailableFeatures.has(feature)) return;
        this.unavailableFeatures.add(feature);
        new Notice(
            t(
                feature === "explorer"
                    ? "explorer.integration_unavailable"
                    : "explorer.sort_unavailable",
            ),
            10000,
        );
    }

    private detachController(view: ExplorerView, controller: ExplorerViewController): void {
        try {
            controller.detach();
        } catch (error) {
            console.error("obsidian-notebundle: Failed to detach File Explorer controller", error);
        } finally {
            this.controllers.delete(view);
        }
    }

    private broadcastEvent(
        eventName: string,
        callback: (controller: ExplorerViewController) => void,
    ): void {
        if (this.getPluginSettings().file_explorer_patch_enabled === true) {
            this.controllers.forEach((controller, view) => {
                try {
                    callback(controller);
                } catch (error) {
                    console.error(
                        "obsidian-notebundle: Could not handle File Explorer event",
                        { event: eventName, view },
                        error,
                    );
                }
            });
        } else {
            return;
        }
    }
}
