export const PUNCH_LIST_STATUSES = new Set(['punch_list', 'rejected', 'partially_approved']);
const CURRENT_STATUSES = new Set(['not_started', 'ok', 'punch_list', 'not_applicable']);

export type CurrentChecklistStatus = 'not_started' | 'ok' | 'punch_list' | 'not_applicable';

export function isPunchListStatus(status: unknown) {
  return typeof status === 'string' && PUNCH_LIST_STATUSES.has(status);
}

export function selectPunchListItems<T extends { status?: unknown }>(items: T[]) {
  return items.filter((item) => isPunchListStatus(item.status));
}

export function normalizeCarriedStatus(status: unknown): CurrentChecklistStatus {
  if (status === 'approved') return 'ok';
  if (status === 'rejected' || status === 'partially_approved') return 'punch_list';
  return typeof status === 'string' && CURRENT_STATUSES.has(status)
    ? (status as CurrentChecklistStatus)
    : 'not_started';
}

export function summarizeStatuses(statuses: CurrentChecklistStatus[]) {
  const summary = {
    total: statuses.length,
    notStarted: 0,
    ok: 0,
    punchList: 0,
    notApplicable: 0,
  };
  for (const status of statuses) {
    if (status === 'not_started') summary.notStarted += 1;
    if (status === 'ok') summary.ok += 1;
    if (status === 'punch_list') summary.punchList += 1;
    if (status === 'not_applicable') summary.notApplicable += 1;
  }
  return summary;
}
