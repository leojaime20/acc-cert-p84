import { describe, expect, it } from 'vitest';
import {
  isPunchListStatus,
  normalizeCarriedStatus,
  selectPunchListItems,
  summarizeStatuses,
} from './createInspectionData.js';

describe('create inspection follow-up data', () => {
  it('recognizes current and legacy Punch List statuses', () => {
    expect(isPunchListStatus('punch_list')).toBe(true);
    expect(isPunchListStatus('rejected')).toBe(true);
    expect(isPunchListStatus('partially_approved')).toBe(true);
    expect(isPunchListStatus('ok')).toBe(false);
    expect(isPunchListStatus('approved')).toBe(false);
  });

  it('identifies the Punch List items that require a follow-up', () => {
    const items = [
      { id: '1', status: 'ok' },
      { id: '2', status: 'punch_list' },
      { id: '3', status: 'not_applicable' },
      { id: '4', status: 'rejected' },
    ];

    expect(selectPunchListItems(items).map((item) => item.id)).toEqual(['2', '4']);
  });

  it('normalizes legacy statuses while carrying all items forward', () => {
    expect(
      ['approved', 'rejected', 'partially_approved', 'not_applicable', 'unknown'].map(
        normalizeCarriedStatus,
      ),
    ).toEqual(['ok', 'punch_list', 'punch_list', 'not_applicable', 'not_started']);
  });

  it('builds a complete summary from all carried statuses', () => {
    expect(summarizeStatuses(['ok', 'ok', 'punch_list', 'not_applicable'])).toEqual({
      total: 4,
      notStarted: 0,
      ok: 2,
      punchList: 1,
      notApplicable: 1,
    });
  });
});
