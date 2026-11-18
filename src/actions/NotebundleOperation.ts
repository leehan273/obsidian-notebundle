import type { TFile } from "obsidian";

export type AttachmentState = "move" | "inside" | "shared" | "note";

export interface AttachmentReference {
    readonly file: TFile;
    readonly path: string;
    readonly state: AttachmentState;
}

export interface AttachmentInspection {
    readonly entries: readonly AttachmentReference[];
    readonly complete: boolean;
}

export interface AttachmentEntry extends AttachmentReference {
    readonly to: string;
}

export interface AttachmentReview {
    readonly note: TFile;
    readonly notePath: string;
    readonly noteMtime: number;
    readonly bundlePath: string;
    readonly entries: readonly AttachmentEntry[];
    readonly complete: boolean;
}

export interface AttachmentSelection {
    readonly review: AttachmentReview;
    readonly files: readonly TFile[];
}

export interface ConversionReview extends AttachmentReview {
    readonly primaryNotePath: string;
}

export interface NotebundleConversionOptions {
    readonly naming: "bundle-name" | "note";
    readonly attachments: "none" | "all" | AttachmentSelection;
}

export interface AttachmentItemResult {
    readonly file: TFile;
    readonly from: string;
    readonly to: string;
    readonly status: Exclude<AttachmentState, "move"> | "moved" | "unselected" | "failed";
    readonly error?: unknown;
}

export interface NotebundleOperationResult {
    readonly note: TFile;
    readonly items: readonly AttachmentItemResult[];
    readonly referencesComplete?: boolean;
    readonly error?: unknown;
}

export interface NewAttachmentResult {
    readonly result: NotebundleOperationResult;
    readonly reviewedCandidates: readonly TFile[];
}
