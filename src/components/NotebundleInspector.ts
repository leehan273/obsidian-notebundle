import { Component } from "obsidian";
import type { Plugin, TFolder } from "obsidian";

import type { NotebundleActions } from "../actions/NotebundleActions";
import {
    getBundleName,
    getNotebundleIfPrimaryNote,
    hasNotebundleSuffix,
    inspectNotebundle,
} from "../notebundle";
import { NotebundleInspectModal } from "../ui/NotebundleInspectModal";
import { showNotebundleError } from "../ui/NotebundleNotice";
import { t } from "../i18n";

export class NotebundleInspector extends Component {
    private statusBarEl!: HTMLElement;
    private modal: NotebundleInspectModal | null = null;

    public constructor(
        private readonly plugin: Plugin,
        private readonly actions: NotebundleActions,
    ) {
        super();
    }

    public override onload(): void {
        const { workspace, vault } = this.plugin.app;
        this.statusBarEl = this.plugin.addStatusBarItem();
        this.statusBarEl.addClass("mod-clickable");
        this.statusBarEl.setAttribute("role", "button");
        this.statusBarEl.tabIndex = 0;
        const open = (): void => {
            try {
                this.open();
            } catch (error) {
                showNotebundleError(error);
            }
        };
        this.registerDomEvent(this.statusBarEl, "click", open);
        this.registerDomEvent(this.statusBarEl, "keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            open();
        });
        this.registerEvent(workspace.on("file-open", () => this.update()));
        this.registerEvent(workspace.on("active-leaf-change", () => this.update()));
        this.registerEvent(vault.on("create", () => this.update()));
        this.registerEvent(vault.on("delete", () => this.update()));
        this.registerEvent(vault.on("rename", () => this.update()));
        workspace.onLayoutReady(() => this.update());
        this.update();
    }

    public override onunload(): void {
        this.modal?.close();
        this.statusBarEl.remove();
    }

    private currentFolder(): TFolder | null {
        for (
            let folder = this.plugin.app.workspace.getActiveFile()?.parent;
            folder;
            folder = folder.parent
        ) {
            if (hasNotebundleSuffix(folder)) return folder;
        }
        return null;
    }

    private update(): void {
        const folder = this.currentFolder();
        this.statusBarEl.hidden = folder === null;
        this.statusBarEl.setText(
            folder ? `${getBundleName(folder) || folder.name}.notebundle` : "",
        );
    }

    private open(): void {
        if (this.modal) return;
        const folder = this.currentFolder();
        if (!folder) return;
        const inspection = inspectNotebundle(folder);
        if (inspection.kind === "none") return;
        const primary = inspection.kind === "valid" ? inspection.notebundle.primaryNote : null;
        const modal = new NotebundleInspectModal(this.plugin.app, {
            inspection,
            loadReferences: () =>
                primary ? this.actions.inspectAttachments(primary) : Promise.resolve(null),
            onCollect: () => {
                if (!primary || getNotebundleIfPrimaryNote(primary)?.folder !== folder) {
                    throw new Error(t("operation.bundle_changed"));
                }
                return this.actions.collectAttachments(primary);
            },
            onClose: () => {
                this.modal = null;
            },
        });
        this.modal = modal;
        modal.open();
    }
}
