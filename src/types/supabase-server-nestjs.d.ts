declare module '@supabase/server/adapters/nestjs' {
  import type { CanActivate, PipeTransform, Type } from '@nestjs/common'
  import type { SupabaseContext, WithSupabaseConfig } from '@supabase/server'

  export function withSupabase(
    config?: Omit<WithSupabaseConfig, 'cors'>,
  ): Type<CanActivate>

  export const SupabaseCtx: (
    data?: keyof SupabaseContext,
    ...pipes: (Type<PipeTransform> | PipeTransform)[]
  ) => ParameterDecorator
}
