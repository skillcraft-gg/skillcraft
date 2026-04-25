import { cancel, confirm, isCancel, multiselect, select } from '@clack/prompts'
import { CommandError, isInteractiveOutputAllowed, isJsonOutput } from '@/lib/output'

type Choice<T extends string> = {
  value: T
  label?: string
  hint?: string
  disabled?: boolean
}

export async function promptSelect<T extends string>(params: {
  message: string
  options: Choice<T>[]
  missingInteractiveMessage: string
}): Promise<T> {
  ensureInteractive(params.missingInteractiveMessage)
  const options = params.options as Parameters<typeof select<T>>[0]['options']
  const result = await select<T>({
    message: params.message,
    options,
  })

  if (isCancel(result)) {
    cancel('Cancelled.')
    throw new CommandError('Prompt cancelled.', 'PROMPT_CANCELLED')
  }

  return result
}

export async function promptMultiSelect<T extends string>(params: {
  message: string
  options: Choice<T>[]
  requiredMessage: string
  missingInteractiveMessage: string
}): Promise<T[]> {
  ensureInteractive(params.missingInteractiveMessage)
  const options = params.options as Parameters<typeof multiselect<T>>[0]['options']
  const result = await multiselect<T>({
    message: params.message,
    options,
    required: true,
  })

  if (isCancel(result)) {
    cancel('Cancelled.')
    throw new CommandError('Prompt cancelled.', 'PROMPT_CANCELLED')
  }

  if (!result.length) {
    throw new CommandError(params.requiredMessage, 'INTERACTIVE_REQUIRED')
  }

  return result
}

export async function promptConfirm(params: {
  message: string
  initialValue?: boolean
  missingInteractiveMessage: string
}): Promise<boolean> {
  ensureInteractive(params.missingInteractiveMessage)
  const result = await confirm({
    message: params.message,
    initialValue: params.initialValue,
  })

  if (isCancel(result)) {
    cancel('Cancelled.')
    throw new CommandError('Prompt cancelled.', 'PROMPT_CANCELLED')
  }

  return result
}

function ensureInteractive(message: string): void {
  if (isInteractiveOutputAllowed()) {
    return
  }

  if (isJsonOutput()) {
    throw new CommandError(message, 'INTERACTIVE_REQUIRED')
  }

  throw new Error(message)
}
