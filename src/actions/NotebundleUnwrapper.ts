import { normalizePath, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import { getBundleName, getValidNotebundle } from "../notebundle";
import { t } from "../i18n";

interface UnwrapMove {
    readonly file: TAbstractFile;
    readonly from: string;
    readonly to: string;
}

function planUnwrapMoves(folder: TFolder): { sourcePath: string; moves: UnwrapMove[] } {
    const name = getBundleName(folder);
    if (!name) {
        throw new Error(`Cannot unwrap a folder without a bundle name: ${folder.path}`);
    }
    const parent = folder.parent!;
    const prefix = parent.isRoot() ? "" : `${parent.path}/`;
    const sourcePath = folder.path;
    const primary = getValidNotebundle(folder)?.primaryNote;
    const attachments = folder.children.find(
        (file) => file instanceof TFolder && file.name === "attachments",
    );
    const moves = folder.children
        .filter((file) => file !== attachments)
        .map((file) => {
            const filename =
                file === primary
                    ? `${name}${primary.extension ? `.${primary.extension}` : ""}`
                    : file.name;
            return { file, from: file.path, to: normalizePath(`${prefix}${filename}`) };
        });
    const reserved = new Set(parent.children.map((file) => file.name.toLowerCase()));
    for (const move of moves) {
        const filename = move.to.slice(move.to.lastIndexOf("/") + 1).toLowerCase();
        if (reserved.has(filename))
            throw new Error(t("rename.destination_already_exists", { path: move.to }));
        reserved.add(filename);
    }
    if (attachments) {
        let attachmentName = `${name}-attachments`;
        let i = 1;
        while (reserved.has(attachmentName.toLowerCase()))
            attachmentName = `${name}-attachments ${i++}`;
        moves.push({
            file: attachments,
            from: attachments.path,
            to: normalizePath(`${prefix}${attachmentName}`),
        });
    }
    // Keep the primary in its bundle until the other contents have moved successfully.
    moves.sort((a, b) => Number(a.file === primary) - Number(b.file === primary));
    return { sourcePath, moves };
}

export async function unwrapNotebundle(
    app: App,
    folder: TFolder,
    detachFile: (file: TAbstractFile, path: string) => Promise<void>,
): Promise<void> {
    const { sourcePath, moves } = planUnwrapMoves(folder);
    for (const { file, from, to } of moves) {
        if (
            folder.path !== sourcePath ||
            app.vault.getAbstractFileByPath(sourcePath) !== folder ||
            file.path !== from ||
            app.vault.getAbstractFileByPath(from) !== file
        ) {
            throw new Error(t("actions.folder_changed_try_again"));
        }

        // Due to NotebundleMoveInterceptor exist, shouldn't just call renameFile to bundle's direct child TFile
        await detachFile(file, to);
    }
    if (
        folder.path !== sourcePath ||
        app.vault.getAbstractFileByPath(sourcePath) !== folder ||
        folder.children.length
    ) {
        throw new Error(t("actions.folder_changed_try_again"));
    }
    await app.fileManager.trashFile(folder);
}
