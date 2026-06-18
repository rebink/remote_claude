// Templates now live in @patchwire/core so the desktop app and this extension
// share one source of truth. Re-exported here to keep existing importers stable.
export { PROJECT_TYPES, EXCLUDE_TEMPLATES, PROJECT_TYPE_LABELS } from '@patchwire/core/sync-templates';
export type { ProjectType } from '@patchwire/core/sync-templates';
