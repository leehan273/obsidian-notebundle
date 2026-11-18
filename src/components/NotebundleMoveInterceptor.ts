import {
    App,
    Component,
    normalizePath,
    Notice,
    TAbstractFile,
    TFile,
    TFolder,
    Vault,
} from "obsidian";
import { around } from "monkey-around";

import {
    getAvailableNotebundlePath,
    getBundleName,
    getBundleNameFromName,
    getNotebundleIfPrimaryNote,
    getValidNotebundle,
} from "../notebundle";
import { t } from "../i18n";

// Intercept 'Primary Note move' and change to 'Bundle move'
//
// Obsidian's note file move command or menu only control that note file.
//
// - (Command) Move current file to another folder
// - (Context menu in Obsidian file explorer, Base, ...) Move file to...
//
// So, If move user move bundle's primary note using obsidian's feature, primary note could be orphaned:
//
// ```
// folder/
//   foo.notebundle/ (have been invalid notebundle)
//     attachments/
//       image.png
//   ~~foo.md~~ (originally primary note located)
//
// another-folder/
//   foo.md (**orphaned from notebundle**)
// ```
//
// So, intercept primary note move to change bundle itself move.
//
export class NotebundleMoveInterceptor extends Component {
    private app: App;
    private getPatchSettingEnabled: () => boolean;

    private vaultRenamePatchUninstaller: (() => void) | null = null;
    private installFailureNotified = false;
    private readonly detaching = new WeakMap<TFile, string>();

    public constructor(app: App, getPatchSettingEnabled: () => boolean) {
        super();

        this.app = app;
        this.getPatchSettingEnabled = getPatchSettingEnabled;
    }

    public override onload(): void {
        this.updateActivationState();
    }

    override onunload(): void {
        this.tryUninstallPatch();
    }

    public updateActivationState(): void {
        if (this.getPatchSettingEnabled()) {
            try {
                this.tryInstallPatch();
            } catch (error) {
                console.error(
                    "obsidian-notebundle: Failed to install bundle move correction",
                    error,
                );
                if (!this.installFailureNotified) {
                    this.installFailureNotified = true;
                    new Notice(t("move.correction_unavailable"), 10000);
                }
            }
        } else {
            this.tryUninstallPatch();
        }
    }

    // Explicitly bypass NotebundleMoveInterceptor works for such as unwrap bundle
    public async detachFile(file: TAbstractFile, path: string): Promise<void> {
        if (!(file instanceof TFile)) {
            await this.app.fileManager.renameFile(file, path);
            return;
        }

        // Guard `interceptRename`
        this.detaching.set(file, normalizePath(path));
        try {
            await this.app.fileManager.renameFile(file, path);
        } finally {
            this.detaching.delete(file);
        }
    }

    private tryInstallPatch(): void {
        if (this.vaultRenamePatchUninstaller !== null) return;
        if (typeof this.app.vault.rename !== "function")
            throw new Error("Vault.rename is unavailable.");

        const interceptor = (
            file: TAbstractFile,
            newPath: string,
            passthrough: (file: TAbstractFile, path: string) => Promise<void>,
        ): Promise<void> => {
            return this.interceptRename(file, newPath, passthrough);
        };

        this.vaultRenamePatchUninstaller = around(this.app.vault, {
            rename: (nextRename) =>
                function (this: Vault, file: TAbstractFile, newPath: string): Promise<void> {
                    return interceptor(file, newPath, (target, path) =>
                        nextRename.call(this, target, path),
                    );
                },
        });
    }

    private tryUninstallPatch(): void {
        this.vaultRenamePatchUninstaller?.();
        this.vaultRenamePatchUninstaller = null;
    }

    private interceptRename(
        file: TAbstractFile,
        requestedPath: string,
        passthrough: (file: TAbstractFile, path: string) => Promise<void>,
    ): Promise<void> {
        if (this.getPatchSettingEnabled() === false) return passthrough(file, requestedPath);

        const requestedFileDestinationPath = normalizePath(requestedPath);
        if (file instanceof TFolder && getBundleName(file)) {
            const destinationFolderPath = this.getParentPath(requestedFileDestinationPath);
            if (destinationFolderPath !== this.getParentPath(file.path)) {
                const requestedName = requestedFileDestinationPath.slice(
                    requestedFileDestinationPath.lastIndexOf("/") + 1,
                );

                const bundleName = getBundleNameFromName(requestedName) || getBundleName(file)!;
                return this.moveBundle(file, destinationFolderPath, bundleName, passthrough);
            }
        }
        if (!(file instanceof TFile)) return passthrough(file, requestedPath);

        if (this.detaching.get(file) === requestedFileDestinationPath) {
            return passthrough(file, requestedPath);
        }

        const bundle = getNotebundleIfPrimaryNote(file)?.folder;
        if (bundle === undefined) return passthrough(file, requestedPath);

        const movesOutsideBundle = !requestedFileDestinationPath.startsWith(`${bundle.path}/`);

        if (movesOutsideBundle) {
            const destinationFolderPath = this.getParentPath(requestedFileDestinationPath);

            return this.moveBundle(
                bundle,
                destinationFolderPath,
                getBundleName(bundle)!,
                passthrough,
            );
        }

        return passthrough(file, requestedPath);
    }

    private moveBundle(
        bundle: TFolder,
        destinationFolderPath: string,
        bundleName: string,
        passthrough: (file: TAbstractFile, path: string) => Promise<void>,
    ): Promise<void> {
        const vault = this.app.vault;
        const destinationFolder =
            destinationFolderPath === ""
                ? vault.getRoot()
                : vault.getAbstractFileByPath(destinationFolderPath);

        if (!(destinationFolder instanceof TFolder)) {
            console.error(
                "obsidian-notebundle: Bundle move destination is not a folder",
                destinationFolderPath,
            );
            return Promise.reject(
                new Error(`Bundle move destination is not a folder: ${destinationFolderPath}`),
            );
        }

        // Try move `folder/foo.notebundle/foo.md` to `folder/` (Current bundle's parent).
        // This should be nothing happened.
        if (destinationFolder === bundle.parent) return Promise.resolve();

        const targetBundlePath = getAvailableNotebundlePath(
            destinationFolder,
            bundleName,
            getValidNotebundle(bundle)?.primaryNote,
        );

        // Continue the caller's rename inside its existing FileManager link-update batch.
        // Starting another renameFile here would defer the actual move until this call returns.
        return passthrough(bundle, targetBundlePath);
    }

    private getParentPath(path: string): string {
        const separator = path.lastIndexOf("/");
        return separator === -1 ? "" : path.slice(0, separator);
    }
}
