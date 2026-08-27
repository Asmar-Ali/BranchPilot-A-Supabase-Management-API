export type SafeErrorExtension = boolean | number | string | null

export interface AppErrorOptions {
  readonly code: string
  readonly extensions?: Readonly<Record<string, SafeErrorExtension>>
  readonly retryable: boolean
  readonly status: number
  readonly title: string
  readonly type: string
}

export class AppError extends Error {
  public readonly code: string
  public readonly extensions: Readonly<Record<string, SafeErrorExtension>>
  public readonly retryable: boolean
  public readonly status: number
  public readonly title: string
  public readonly type: string

  public constructor(options: AppErrorOptions) {
    super(options.title)
    this.name = 'AppError'
    this.code = options.code
    this.extensions = options.extensions ?? {}
    this.retryable = options.retryable
    this.status = options.status
    this.title = options.title
    this.type = options.type
  }
}
