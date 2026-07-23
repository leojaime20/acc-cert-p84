import { z } from 'zod';

export const inspectionItemSchema = z
  .object({
    status: z.enum(['not_started', 'ok', 'punch_list', 'not_applicable']),
    comment: z.string().trim().optional(),
    recommendation: z.string().trim().optional(),
    photoCount: z.number().int().nonnegative(),
    photoRequired: z.boolean(),
  })
  .superRefine((item, context) => {
    if (item.status === 'punch_list' && !item.comment) {
      context.addIssue({ code: 'custom', path: ['comment'], message: 'Comment is required.' });
    }
    if (item.photoRequired && item.photoCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['photoCount'],
        message: 'Photo is required.',
      });
    }
  });
