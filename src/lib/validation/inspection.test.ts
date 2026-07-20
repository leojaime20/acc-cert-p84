import { describe, expect, it } from 'vitest';
import { inspectionItemSchema } from './inspection';

describe('inspectionItemSchema', () => {
  it('aceita item aprovado sem comentário', () => {
    expect(
      inspectionItemSchema.safeParse({
        status: 'approved',
        photoCount: 0,
        photoRequired: false,
      }).success,
    ).toBe(true);
  });

  it('exige comentário e recomendação na reprovação', () => {
    const result = inspectionItemSchema.safeParse({
      status: 'rejected',
      photoCount: 1,
      photoRequired: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(2);
  });
});
