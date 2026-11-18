export const en_us = {
    "command.convert_current_note_to_notebundle": "Convert current note to notebundle",
    "command.unwrap_current_notebundle": "Unwrap current Notebundle",

    "menu.convert_to_notebundle": "Convert to notebundle",
    "menu.show_notebundle_issues": "Show notebundle issues",
    "menu.unwrap_notebundle": "Unwrap Notebundle",

    "notice.note_is_already_notebundle": "{file_name} is already a notebundle: {folder_name}",

    "settings.about_notebundle": "About Notebundle (.notebundle)",
    "settings.notebundle_introduction":
        "TL;DR: Notebundle is a file structure and naming convention for managing plain-text notes and their attachments: a single note file bundled together with its attachments in a `.notebundle` folder.\nExample: `my-note.notebundle/` contains `my-note.md` and `attachments/`",
    "settings.open_convention_intro": "About the Notebundle convention",
    "settings.obsidian_plugin_name": "Notebundle Plugin for Obsidian",
    "settings.plugin_repository": "Plugin repository",
    "settings.report_an_issue": "Issue report",
    "settings.automatic_notebundle_conversion": "Automatic Notebundle conversion",
    "settings.automatic_conversion_is_disabled":
        "Note: **Automatic conversion is currently disabled.**",
    "settings.automatic_conversion_runs_when_attachment_is_added":
        "Note: **Automatic conversion occurs when a new attachment is added to the note.**",
    "settings.automatic_conversion_scope": "Automatic conversion scope",
    "settings.automatic_conversion_scope_description":
        "Specifies whether to enable automatic conversion throughout the entire vault or only in specific locations.",
    "settings.entire_vault": "Entire Vault",
    "settings.specific_locations": "Specific locations",
    "settings.automatically_convert_markdown_files": "Convert Markdown files automatically",
    "settings.automatically_convert_markdown_files_description":
        "Automatically convert Markdown (.md) files when an attachment is added.",
    "settings.automatically_convert_canvas_files": "Convert Canvas files automatically",
    "settings.automatically_convert_canvas_files_description":
        "[EXPERIMENTAL] Automatically convert Canvas (.canvas) files when an attachment is added.",
    "settings.file_naming_on_conversion": "File naming on conversion",
    "settings.note_file_name_on_conversion": "Note file name on conversion",
    "settings.note_file_name_on_conversion_description":
        "Specifies the naming convention for internal note files when converting a Notebundle.",
    "settings.keep_original_file_name": "Keep original filename",
    "settings.conversion_examples": "Conversion Examples",
    "settings.original_file_label": "(Before conversion)",
    "settings.adjust_obsidian_internal_behavior": "Adjusting Obsidian internal behavior",
    "settings.adjust_obsidian_internal_behavior_description":
        "**Highly recommended to keep these options enabled.**\nThe relative path option improves the portability of the note and prevents verbose reference paths when there are attachments with duplicate filenames in the vault.\nIf the option to prevent bundle separation is disabled, notebundle files can be a hassle in most situations when you work with notes in Obsidian.",
    "settings.file_explorer": "File explorer",
    "settings.use_relative_paths_for_notebundle_attachments":
        "Use relative paths for attachments in Notebundles",
    "settings.use_relative_paths_for_notebundle_attachments_description":
        "References from a note to attachments in the same bundle are automatically normalized to relative paths such as `./attachments/image.png`, independent of Obsidian's Links settings. (Currently, this only works in Markdown.)",
    "settings.move_notebundle_when_primary_note_is_moved":
        "Prevent separation of the main note from the notebundle when the file is moved",
    "settings.move_notebundle_when_primary_note_is_moved_description":
        "Prevents the bundle from being split when you move its primary note using a command or context menu by ensuring that the entire bundle moves with it. Unwrap the bundle to work with its files separately.",
    "settings.enable_file_explorer_integration":
        "Enable support for Obsidian's built-in file explorer",
    "settings.open_primary_note_when_notebundle_is_clicked":
        "Open the primary note when a Notebundle is clicked",
    "settings.open_primary_note_when_notebundle_is_clicked_description":
        "Automatically open the bundle's primary note when its notebundle folder is clicked in Obsidian's File Explorer. Click the package icon to expand or collapse the folder.",
    "settings.sort_notebundles_as_regular_files": "Sort Notebundles like regular files",
    "settings.sort_notebundles_as_regular_files_description":
        "Sort notebundle items like regular note files in Obsidian's File Explorer.",
    "settings.folders_allowed_for_automatic_conversion": "Allowed locations",
    "settings.no_folders_registered": "No folders have been added.",
    "settings.add_folder": "Add folder",
    "settings.search_and_select_folder": "Select folder...",
    "settings.folder_is_already_registered": "This folder has already been added.",

    "actions.folder_changed_try_again": "The folder changed. Please try again.",

    "rename.destination_already_exists": '"{path}" already exists.',

    "explorer.click_to_expand_folder": "Click to expand folder",
    "explorer.click_to_collapse_folder": "Click to collapse folder",
    "explorer.click_to_open_primary_note": "Click to open primary note",
    "explorer.integration_unavailable": "Notebundle: Could not enable File Explorer integration.",
    "explorer.sort_unavailable": "Notebundle: Could not apply bundle sorting modify setting.",

    "issues.no_primary_note_found_summary": "Could not find the primary note.",
    "issues.multiple_primary_notes_found_summary": "Multiple primary notes found",

    "rename_sync.cannot_identify_primary_note_of_folder":
        "Notebundle rename sync failed: Cannot identify the primary note of '{folder_name}'",
    "rename_sync.could_not_synchronize_notebundle_name": "Failed to synchronize notebundle name.",
    "rename_sync.could_not_restore_original_name":
        "Filename synchronization failed, and the original filename could not be restored.",

    "move.correction_unavailable": "Notebundle: Failed to enable bundle separation prevention.",
    "command.collect_attachments": "Collect attachments into the current notebundle",
    "operation.review_changed": "The file or reference has changed. Run the operation again.",
    "operation.file_no_longer_exists": "Target file not found: {path}",
    "operation.bundle_changed": "Something changed during processing. Please try again.",
    "operation.attachments_path_is_file":
        "attachments already exists as a file, not a directory: {path}",
    "operation.failed": "Could not complete the operation.",
    "operation.origin_unavailable":
        "Notebundle: An internal error occurred while enabling the automatic file collection feature. The automatic collection feature is not working.",
    "notice.attachments_collected": "Collected {count} attachment(s).",
    "notice.collection_incomplete": "Failed to analyze the note file.",
    "notice.attachment_collection_unsupported":
        "This file format is not supported for attachment analysis.",
    "rename.primary_candidate_conflict": "Primary note candidate conflicts with other note: {path}",
} as const;

export type MessageKey = keyof typeof en_us;
export type Messages = Record<MessageKey, string>;
