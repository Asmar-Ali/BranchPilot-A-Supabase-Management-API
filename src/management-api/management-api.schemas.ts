import { z } from 'zod'

export const organizationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  })
  .passthrough()

export const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ref: z.string().min(1),
  })
  .passthrough()

export const branchSchema = z
  .object({
    name: z.string().min(1),
    ref: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough()
