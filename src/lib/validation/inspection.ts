import { z } from 'zod';

export const inspectionItemSchema = z
  .object({
    status: z.enum(['not_started', 'approved', 'partially_approved', 'rejected', 'not_applicable']),
    comment: z.string().trim().optional(),
    recommendation: z.string().trim().optional(),
    photoCount: z.number().int().nonnegative(),
    photoRequired: z.boolean(),
  })
  .superRefine((item, context) => {
    if (['rejected', 'partially_approved'].includes(item.status) && !item.comment) {
      context.addIssue({ code: 'custom', path: ['comment'], message: 'Comentário obrigatório.' });
    }
    if (item.status === 'rejected' && !item.recommendation) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation'],
        message: 'Recomendação obrigatória.',
      });
    }
    if (item.photoRequired && item.photoCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['photoCount'],
        message: 'Fotografia obrigatória.',
      });
    }
  });
