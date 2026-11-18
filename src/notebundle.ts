import { normalizePath, TFile, TFolder } from "obsidian";

export const NOTEBUNDLE_SUFFIX = ".notebundle";

export function cleanBundleName(raw: string): string {
    const name = raw.trim();
    return name.endsWith(NOTEBUNDLE_SUFFIX)
        ? name.slice(0, -NOTEBUNDLE_SUFFIX.length).trimEnd()
        : name;
}

export interface Notebundle {
    folder: TFolder;
    name: string;
    primaryNote: TFile;
}

export type NotebundleIssue =
    | {
          type: "empty-name";
      }
    | {
          type: "missing-primary-note";
          expectedCandidateNames: readonly string[];
      }
    | {
          type: "multiple-primary-notes";
          candidates: readonly TFile[];
      };

export type NotebundleInspection =
    | {
          kind: "none";
      }
    | {
          kind: "invalid";
          folder: TFolder;
          issues: readonly NotebundleIssue[];
      }
    | {
          kind: "valid";
          notebundle: Notebundle;
      };

export function hasNotebundleSuffix(folder: TFolder): boolean {
    return folder.name.endsWith(NOTEBUNDLE_SUFFIX);
}
export function getBundleName(folder: TFolder): string | null {
    return getBundleNameFromName(folder.name);
}

export function getBundleNameFromName(name: string): string | null {
    return name.endsWith(NOTEBUNDLE_SUFFIX) ? name.slice(0, -NOTEBUNDLE_SUFFIX.length) : null;
}

export function getAvailableNotebundlePath(
    parent: TFolder,
    basename: string,
    primaryNote?: TFile,
): string {
    const names = new Set(parent.children.map((file) => file.name.toLowerCase()));
    // A numbered bundle name must not turn another child into a primary candidate.
    const candidates = new Set(
        primaryNote?.parent?.children
            .filter((file): file is TFile => file instanceof TFile && file !== primaryNote)
            .map((file) => file.basename.toLowerCase()),
    );
    let name = basename;
    let i = 1;
    while (
        names.has(`${name}${NOTEBUNDLE_SUFFIX}`.toLowerCase()) ||
        candidates.has(name.toLowerCase())
    ) {
        name = `${basename} ${i++}`;
    }
    return normalizePath(`${parent.isRoot() ? "" : `${parent.path}/`}${name}${NOTEBUNDLE_SUFFIX}`);
}

export function getNotebundlePrimaryNotePath(
    file: TFile,
    bundlePath: string,
    primaryNoteNaming: "bundle-name" | "note",
): string {
    const bundleName = bundlePath.slice(bundlePath.lastIndexOf("/") + 1, -NOTEBUNDLE_SUFFIX.length);
    const name =
        primaryNoteNaming === "note"
            ? `note.${file.extension}`
            : `${bundleName}${file.extension ? `.${file.extension}` : ""}`;
    return normalizePath(`${bundlePath}/${name}`);
}

export function inspectNotebundle(folder: TFolder): NotebundleInspection {
    const name = getBundleName(folder);

    // The folder name is not `{name}.notebundle`
    if (name === null) {
        return {
            kind: "none",
        };
    }

    const issues: NotebundleIssue[] = [];

    if (name.length === 0) {
        console.error("obsidian-notebundle: Bundle folder has an empty name", folder.path);
        issues.push({
            type: "empty-name",
        });
        return {
            kind: "invalid",
            folder,
            issues,
        };
    }

    const primaryNoteCandidates = findPrimaryNoteCandidates(folder, [name]);

    if (primaryNoteCandidates.length === 0) {
        issues.push({
            type: "missing-primary-note",
            expectedCandidateNames: [`${name}.*`, `note.*`],
        });
    }

    if (primaryNoteCandidates.length > 1) {
        issues.push({
            type: "multiple-primary-notes",
            candidates: primaryNoteCandidates,
        });
    }

    if (issues.length > 0) {
        return {
            kind: "invalid",
            folder,
            issues,
        };
    }

    return {
        kind: "valid",

        notebundle: {
            folder,
            name,
            primaryNote: primaryNoteCandidates[0]!,
        },
    };
}

export function findPrimaryNoteCandidates(
    folder: TFolder,
    bundleNames: readonly string[],
): TFile[] {
    return folder.children
        .filter((file) => file instanceof TFile)
        .filter((file) => file.basename === "note" || bundleNames.includes(file.basename));
}

export function getValidNotebundle(folder: TFolder): Notebundle | null {
    const inspect = inspectNotebundle(folder);

    if (inspect.kind === "valid") {
        return inspect.notebundle;
    } else {
        return null;
    }
}

export function getNotebundleIfPrimaryNote(file: TFile): Notebundle | null {
    const parent: TFolder | null = file.parent;

    if (parent === null) {
        return null;
    }

    const bundle = getValidNotebundle(parent);

    return bundle?.primaryNote === file ? bundle : null;
}

export class NotebundleIssueError extends Error {
    public constructor(
        public readonly inspection: Extract<NotebundleInspection, { kind: "invalid" }>,
    ) {
        super();
    }
}

export function assertNoteStructure(note: TFile): void {
    if (!note.parent) return;
    const inspection = inspectNotebundle(note.parent);
    if (inspection.kind === "invalid") throw new NotebundleIssueError(inspection);
}
