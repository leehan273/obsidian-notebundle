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

import { findPrimaryNoteCandidates, getBundleNameFromName, NOTEBUNDLE_SUFFIX } from "../notebundle";
import { t } from "../i18n";

export type NotebundleFolderRenameAnalysis =
    | {
          kind: "ignore";
          reason:
              | "normal-folder-to-notebundle-folder"
              | "notebundle-folder-move"
              | "primary-note-name-already-valid";
      }
    | {
          kind: "should-rename-primary-note";
          reason: "bundle-name-changed";
          primaryNoteFile: TFile;
          newBundleName: string;
      }
    | {
          kind: "blocked";
          reason: "primary-note-not-identifiable";
          directChildFiles: TFile[];
          primaryNoteCandidates: TFile[];
      }
    | {
          // INFO: Logically, this shouldn't be happened.
          // Only use for debug.
          kind: "unhandled";
          reason: "unhandled-event";
          folder: TFolder;
          oldPath: string;
      };

export type NotebundleDirectChildRenameAnalysis =
    | {
          kind: "ignore";
          reason:
              | "parent-path-changed"
              | "basename-unchanged"
              | "converted-within-primary-note-naming-rule"
              | "non-primary-note-rename";
      }
    | {
          kind: "should-rename-bundle-name";
          reason: "primary-note-name-changed";
          bundle: TFolder;
          newBundleName: string;
      }
    | {
          kind: "blocked";
          reason: "primary-note-not-identifiable";
          directChildFilesInSameNotebundle: TFile[];
          previousPrimaryCandidates: TFile[];
      }
    | {
          // INFO: Logically, this shouldn't be happened.
          // Only use for debug.
          kind: "unhandled";
          reason: "unhandled-event";
          file: TFile;
          oldPath: string;
      };

export class NotebundleRenameSynchronizer extends Component {
    private readonly pathUpdateResolvers = new WeakMap<TAbstractFile, () => void>();
    public constructor(
        private readonly app: App,
        private readonly vault: Vault,
    ) {
        super();
    }

    public onload(): void {
        this.registerEvent(
            this.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
                this.onRename(file, oldPath),
            ),
        );
    }

    private onRename(file: TAbstractFile, oldPath: string) {
        try {
            const resolvePathUpdate = this.pathUpdateResolvers.get(file);

            if (resolvePathUpdate !== undefined) {
                this.pathUpdateResolvers.delete(file);
                resolvePathUpdate();
                return;
            }

            if (file instanceof TFolder) {
                const folderName = file.name;

                if (this.getBundleName(folderName) !== null) {
                    this.handleNotebundleFolderRename(file, oldPath);
                }
            }

            if (file instanceof TFile) {
                const parentFolderName: string | undefined = file.parent?.name;

                if (
                    parentFolderName !== undefined &&
                    this.getBundleName(parentFolderName) !== null
                ) {
                    this.handleNotebundleDirectChildFileRename(file, oldPath);
                }
            }
        } catch (error) {
            console.error(
                "obsidian-notebundle: error occurred during rename synchronization",
                error,
            );
        }
    }

    private handleNotebundleFolderRename(folder: TFolder, oldPath: string) {
        const analysis: NotebundleFolderRenameAnalysis = this.analyzeNotebundleFolderRenameEvent(
            folder,
            oldPath,
        );

        if (analysis.kind === "should-rename-primary-note") {
            const primaryNoteFile = analysis.primaryNoteFile;
            const newBundleName = analysis.newBundleName;

            const newPrimaryNoteFileName =
                primaryNoteFile.extension !== ""
                    ? `${newBundleName}.${primaryNoteFile.extension}`
                    : `${newBundleName}`;
            const newPrimaryNoteFilePath = `${folder.path}/${newPrimaryNoteFileName}`;

            void this.synchronizeName(primaryNoteFile, newPrimaryNoteFilePath, {
                file: folder,
                oldPath,
            });
        }

        if (analysis.kind === "blocked") {
            new Notice(
                t("rename_sync.cannot_identify_primary_note_of_folder", {
                    folder_name: folder.name,
                }),
            );
        }

        if (analysis.kind === "unhandled") {
            console.error(
                "obsidian-notebundle: NotebundleRenameSynchronizer - handleNotebundleFolderRename",
                analysis,
            );
        }

        return;
    }

    private handleNotebundleDirectChildFileRename(file: TFile, oldPath: string) {
        const analysis: NotebundleDirectChildRenameAnalysis =
            this.analyzeNotebundleDirectChildFileRenameEvent(file, oldPath);

        if (analysis.kind === "should-rename-bundle-name") {
            const newBundleName = analysis.newBundleName;

            const newParentFolderName = `${newBundleName}${NOTEBUNDLE_SUFFIX}`;
            const newParentFolderPath = `${analysis.bundle.parent?.path ?? ""}/${newParentFolderName}`;

            void this.synchronizeName(analysis.bundle, newParentFolderPath, { file, oldPath });
        }

        if (analysis.kind === "blocked") {
            new Notice(
                t("rename_sync.cannot_identify_primary_note_of_folder", {
                    folder_name: file.parent!.path,
                }),
            );
        }

        if (analysis.kind === "unhandled") {
            console.error(
                "obsidian-notebundle: NotebundleRenameSynchronizer - handleNotebundleDirectChildFileRename",
                analysis,
            );
        }

        return;
    }

    // For synchronize, call from each other.
    //
    // change bundle name       from handleNotebundleDirectChildFileRename,
    // change primary note name from handleNotebundleFolderRename
    private async synchronizeName(
        file: TAbstractFile,
        newPath: string,
        initialRename: { file: TAbstractFile; oldPath: string },
    ): Promise<void> {
        const initialRenamedPath = initialRename.file.path;

        try {
            if (file instanceof TFile) {
                const parentPathInFilePath = this.getParentPath(file.path);
                const currentParentPath = file.parent!.path;
                // An observable behavior when changing things with vault.rename, etc.:
                //
                // The folder's rename event has fired, but the paths of its children have not been updated yet.
                //
                // For example, if the folder name is changed from foo.notebundle to bar.notebundle,
                // the foo.md TFile's file.path and file.parent.path may look like this:
                //
                //   file.parent.path: bar.notebundle
                //   file.path:        foo.notebundle/foo.md
                //
                // The parent has already been renamed to bar, but the file's own information has not been updated yet (it updates slightly later).
                //
                // In this situation (where the parent path information is inconsistent), wait until the path is updated before continuing.

                if (parentPathInFilePath !== currentParentPath) {
                    await new Promise<void>((resolvePathUpdate) => {
                        this.pathUpdateResolvers.set(file, resolvePathUpdate);
                    });
                }
            }

            const normalizedPath = normalizePath(newPath);

            if (file.path === normalizedPath) {
                return;
            }

            const existing = this.app.vault.getAbstractFileByPath(normalizedPath);

            if (existing !== null && existing !== file) {
                new Notice(t("rename.destination_already_exists", { path: normalizedPath }));
                // stop and rollback if destination already exist
                await this.restoreInitialRename(initialRename, initialRenamedPath);

                return;
            } else {
                await this.app.fileManager.renameFile(file, normalizedPath);
            }
        } catch (error) {
            console.error("obsidian-notebundle: Failed to synchronize notebundle name.", error);
            new Notice(t("rename_sync.could_not_synchronize_notebundle_name"));

            // try restore when error
            await this.restoreInitialRename(initialRename, initialRenamedPath);
        }
    }

    private async restoreInitialRename(
        initialRename: { file: TAbstractFile; oldPath: string },
        expectedPath: string,
    ): Promise<void> {
        const { file, oldPath } = initialRename;

        try {
            if (
                file.path !== expectedPath ||
                this.vault.getAbstractFileByPath(expectedPath) !== file
            ) {
                throw new Error(t("operation.bundle_changed"));
            }

            await this.app.fileManager.renameFile(file, oldPath);
        } catch (error) {
            new Notice(t("rename_sync.could_not_restore_original_name"));
            console.error("obsidian-notebundle: Failed to restore the original name.", error);
        }
    }

    private analyzeNotebundleFolderRenameEvent(
        folder: TFolder,
        oldPath: string,
    ): NotebundleFolderRenameAnalysis {
        const oldFolderName = this.getFileNameFromPath(oldPath);
        const newFolderName = this.getFileNameFromPath(folder.path);

        const oldBundleName: string | null = this.getBundleName(oldFolderName);
        const newBundleName: string = this.getBundleName(newFolderName)!; // This filtered in `onRename` (`this.getBundleName(folderName) !== null`)

        if (oldBundleName === null) {
            return {
                kind: "ignore",
                reason: "normal-folder-to-notebundle-folder",
            };
        }

        if (oldBundleName === newBundleName && folder.path !== oldPath) {
            return {
                kind: "ignore",
                reason: "notebundle-folder-move",
            };
        }

        const directChildFiles: TFile[] = this.getDirectChildFiles(folder);

        // Check both names: renaming foo.notebundle to bar.notebundle can make
        // an existing bar.* compete with foo.* as the primary note.
        const candidates = findPrimaryNoteCandidates(folder, [oldBundleName, newBundleName]);

        const isPrimaryNoteIdentifiable: boolean = candidates.length === 1;

        if (isPrimaryNoteIdentifiable === false) {
            return {
                kind: "blocked",
                reason: "primary-note-not-identifiable",
                primaryNoteCandidates: candidates,
                directChildFiles: directChildFiles,
            };
        }

        const primaryNoteCandidate: TFile = candidates[0]!;

        if (primaryNoteCandidate.basename === "note") {
            return {
                kind: "ignore",
                reason: "primary-note-name-already-valid",
            };
        } else if (primaryNoteCandidate.basename === newBundleName) {
            return {
                kind: "ignore",
                reason: "primary-note-name-already-valid",
            };
        } else if (primaryNoteCandidate.basename === oldBundleName) {
            return {
                kind: "should-rename-primary-note",
                reason: "bundle-name-changed",
                primaryNoteFile: primaryNoteCandidate,
                newBundleName: newBundleName,
            };
        }

        return {
            kind: "unhandled",
            reason: "unhandled-event",
            folder,
            oldPath,
        };
    }

    private analyzeNotebundleDirectChildFileRenameEvent(
        file: TFile,
        oldPath: string,
    ): NotebundleDirectChildRenameAnalysis {
        const oldParentPath = this.getParentPath(oldPath);
        const currentParentPath = this.getParentPath(file.path);
        // When a parent folder is renamed, Obsidian's onRename event is also triggered in sequence for its descendant content.
        //
        // Example: Scenario: foo.notebundle -> bar.notebundle
        //
        // 1. onRename: foo.notebundle                       -> bar.notebundle
        // 2. onRename: foo.notebundle/attachments/image.png -> bar.notebundle/attachments/image.png
        // 3. onRename: foo.notebundle/foo.md                -> bar.notebundle/foo.md
        //
        // Since the primary note name is synchronized when the Notebundle folder is renamed in handleNotebundleFolderRename,
        // changes to parent paths should be ignored here.
        if (oldParentPath !== currentParentPath) {
            return {
                kind: "ignore",
                reason: "parent-path-changed",
            };
        }

        const newBasename = file.basename;

        const parentFolder = file.parent!;
        const bundleName = this.getBundleName(parentFolder.name);

        // Case: `bundle-name.md` -> `note.md`
        if (newBasename === "note") {
            return {
                kind: "ignore",
                reason: "converted-within-primary-note-naming-rule",
            };
        }

        const oldFilename = this.getFileNameFromPath(oldPath);
        const oldBasename = this.getBasenameFromFilename(oldFilename);

        if (oldBasename !== bundleName && oldBasename !== "note") {
            return { kind: "ignore", reason: "non-primary-note-rename" };
        }

        // Case: `foo.md` -> `foo.txt`
        if (oldBasename === newBasename) {
            return {
                kind: "ignore",
                reason: "basename-unchanged",
            };
        }

        // Case: `note.md` -> `bundle-name.md`
        if (newBasename === bundleName) {
            return {
                kind: "ignore",
                reason: "converted-within-primary-note-naming-rule",
            };
        }

        // Case: `foo.md` (foo.notebundle/foo.md) -> `bar.md`
        //
        // foo.notebundle/foo.md -> foo.notebundle/bar.md
        //
        // Scenario - Not only Primary note file, but changed thing is primary note:
        //
        //      foo.notebundle/  -> foo.notebundle/
        //          foo.md              bar.md      (changed, but should check 'was this primary note?' and change bundle name if true)
        //          asdf.md             asdf.md
        //
        // Scenario - Changed file was not Primary note:
        //
        //      foo.notebundle/  -> foo.notebundle/
        //          foo.md              foo.md
        //          asdf.md             bar.md      (changed, but need to ignore this)
        //
        // Scenario - Multiple Primary Note Candidates:
        //
        //      foo.notebundle/  -> foo.notebundle/
        //          foo.md              foo.md
        //          note.md             bar.md      (changed, but shouldn't change bundle name. )

        // Scenario - Multiple Primary Note Candidates:
        //
        //      foo.notebundle/  -> foo.notebundle/
        //          foo.md              bar.md      (changed, but shouldn't change bundle name. )
        //          note.md             note.md
        //
        // Scenario - Multiple Primary Note Candidates:
        //
        //      foo.notebundle/  -> foo.notebundle/
        //          foo.md              foo.md
        //          note.md             bar.md      (changed, but shouldn't change bundle name. )

        const directChildFiles = this.getDirectChildFiles(parentFolder);

        // Use the old basename to identify the primary before this rename.
        // If foo.* and note.* both existed, renaming either must not rename the bundle.
        const previousPrimaryCandidates = this.findPreviousPrimaryCandidates(
            directChildFiles,
            file,
            oldBasename,
            bundleName,
        );

        if (previousPrimaryCandidates.length !== 1) {
            return {
                kind: "blocked",
                reason: "primary-note-not-identifiable",
                directChildFilesInSameNotebundle: directChildFiles,
                previousPrimaryCandidates: previousPrimaryCandidates,
            };
        }

        if (previousPrimaryCandidates[0] !== file) {
            return {
                kind: "ignore",
                reason: "non-primary-note-rename",
            };
        }

        if (
            previousPrimaryCandidates[0] === file &&
            (oldBasename === bundleName || oldBasename === "note")
        ) {
            return {
                kind: "should-rename-bundle-name",
                reason: "primary-note-name-changed",
                bundle: parentFolder,
                newBundleName: newBasename,
            };
        }

        return {
            kind: "unhandled",
            reason: "unhandled-event",
            file,
            oldPath,
        };
    }

    private findPreviousPrimaryCandidates(
        directChildFiles: readonly TFile[],
        file: TFile,
        oldBasename: string,
        bundleName: string | null,
    ): TFile[] {
        const previousPrimaryCandidates: TFile[] = [];
        for (const child of directChildFiles) {
            let basenameToCheck = child.basename;

            // Check with oldBasename, because the check for previous state
            if (child === file) {
                basenameToCheck = oldBasename;
            }

            if (basenameToCheck === "note" || basenameToCheck === bundleName) {
                previousPrimaryCandidates.push(child);
            }
        }
        return previousPrimaryCandidates;
    }

    private getDirectChildFiles(folder: TFolder): TFile[] {
        return folder.children.filter((child: TAbstractFile) => child instanceof TFile);
    }

    private getFileNameFromPath = (path: string) => {
        const separatorIndex = path.lastIndexOf("/");

        if (separatorIndex === -1) {
            return path;
        }

        return path.slice(separatorIndex + 1);
    };
    private getBasenameFromFilename = (filename: string): string => {
        const extensionIndex = filename.lastIndexOf(".");

        if (extensionIndex <= 0) {
            return filename;
        }

        return filename.slice(0, extensionIndex);
    };

    private getParentPath(path: string): string {
        const separatorIndex = path.lastIndexOf("/");

        return separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
    }
    private getBundleName(folderName: string): string | null {
        return getBundleNameFromName(folderName) || null;
    }
}
