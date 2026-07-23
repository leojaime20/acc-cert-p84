import { describe, expect, it } from 'vitest';
import { inspectionItemSchema } from './inspection';

describe('inspectionItemSchema', () => {
  it('aceita item Ok sem comentário', () => {
    expect(
      inspectionItemSchema.safeParse({
        status: 'ok',
        photoCount: 0,
        photoRequired: false,
      }).success,
    ).toBe(true);
  });

  it('exige somente comentário em Punch List', () => {
    const result = inspectionItemSchema.safeParse({
      status: 'punch_list',
      photoCount: 1,
      photoRequired: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toEqual(['comment']);
    }
  });

  it('aceita Punch List com comentário e sem recomendação', () => {
    expect(
      inspectionItemSchema.safeParse({
        status: 'punch_list',
        comment: 'Ajuste pendente.',
        photoCount: 0,
        photoRequired: false,
      }).success,
    ).toBe(true);
  });
});
