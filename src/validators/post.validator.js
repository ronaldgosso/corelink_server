import { z } from 'zod';

// Schema for creating a post
export const createPostSchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(3000, 'Content must be 3000 characters or less'),
  
  scheduled_at: z
    .string()
    .datetime({ message: 'scheduled_at must be a valid ISO 8601 date string (e.g., "2026-10-05T10:00:00Z")' })
    .optional(),
  
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO 8601 date string' })
    .optional(),
  
  media_url: z.string().url('media_url must be a valid URL').optional().or(z.literal('')),
  mediaUrl: z.string().url('mediaUrl must be a valid URL').optional().or(z.literal('')),
  
  media_type: z.enum(['image', 'video', 'document', 'none']).optional(),
  mediaType: z.enum(['image', 'video', 'document', 'none']).optional(),
  
  media_asset_urn: z.string().optional(),
  mediaAssetUrn: z.string().optional(),
  
  status: z.enum(['draft', 'scheduled', 'pending', 'published']).optional(),
  
  timezone_offset: z.number().min(-12).max(14).optional(),
}).refine(
  (data) => data.scheduled_at || data.scheduledAt,
  {
    message: 'Either scheduled_at or scheduledAt must be provided',
    path: ['scheduled_at'],
  }
);

// Schema for updating a post (all fields optional)
export const updatePostSchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(3000, 'Content must be 3000 characters or less')
    .optional(),
  
  scheduled_at: z
    .string()
    .datetime({ message: 'scheduled_at must be a valid ISO 8601 date string' })
    .optional(),
  
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO 8601 date string' })
    .optional(),
  
  media_url: z.string().url('media_url must be a valid URL').optional().or(z.literal('')),
  mediaUrl: z.string().url('mediaUrl must be a valid URL').optional().or(z.literal('')),
  
  media_type: z.enum(['image', 'video', 'document', 'none']).optional(),
  mediaType: z.enum(['image', 'video', 'document', 'none']).optional(),
  
  media_asset_urn: z.string().optional(),
  mediaAssetUrn: z.string().optional(),
  
  status: z.enum(['draft', 'scheduled', 'pending', 'published']).optional(),
});

// Middleware function to validate request body
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  
  if (!result.success) {
    const errors = result.error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      data: { errors },
    });
  }
  
  // Attach validated data to request object
  req.validatedData = result.data;
  next();
};