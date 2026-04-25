import { loadGlobalConfig, saveGlobalConfig } from '@/core/config'
import { getProvider } from '@/providers'
import { getOutputMode, isInteractiveOutputAllowed, printInfo } from '@/lib/output'
import { promptSelect } from '@/lib/prompts'

const skillcraftRepo = 'skillcraft-gg/skillcraft'

export async function maybePromptToStarSkillcraft(): Promise<void> {
  if (!isInteractivePromptAllowed()) {
    return
  }

  const config = await loadGlobalConfig()
  if (config.prompts?.starSkillcraftDisabled) {
    return
  }

  const provider = getProvider(config.provider ?? 'gh')
  const user = await provider.getUser().catch(() => '')
  if (!user) {
    return
  }

  const alreadyStarred = await provider.viewerHasStarredRepo(skillcraftRepo).catch(() => true)
  if (alreadyStarred) {
    return
  }

  const forcedAnswer = process.env.SKILLCRAFT_STAR_PROMPT_RESPONSE
  const answer = normalizeAnswer(
    forcedAnswer !== undefined
      ? forcedAnswer
      : await promptSelect({
        message: 'Star Skillcraft on GitHub?',
        options: [
          { value: 'yes', label: 'Yes', hint: 'Star repo now' },
          { value: 'no', label: 'No', hint: 'Skip this time' },
          { value: 'disable', label: 'Do not ask again', hint: 'Turn prompt off' },
        ],
        missingInteractiveMessage: 'Interactive prompt unavailable. Re-run in a TTY to answer the star prompt.',
      }),
  )

  if (!answer || answer === 'y' || answer === 'yes') {
    try {
      await provider.starRepo(skillcraftRepo)
      printInfo('Thanks for starring Skillcraft on GitHub.')
    } catch {
      printInfo('Could not star Skillcraft on GitHub automatically.')
    }
    return
  }

  if (answer === 'n' || answer === 'no') {
    return
  }

  if (answer === 'd' || answer === 'disable' || answer === 'dont' || answer === "don't ask again" || answer === 'dont ask again') {
    await saveGlobalConfig({
      ...config,
      prompts: {
        ...(config.prompts ?? {}),
        starSkillcraftDisabled: true,
      },
    })
    printInfo('Okay. Skillcraft will not ask again.')
  }
}

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase()
}

function isInteractivePromptAllowed(): boolean {
  return getOutputMode() !== 'json' && (isInteractiveOutputAllowed() || process.env.SKILLCRAFT_STAR_PROMPT_RESPONSE !== undefined)
}
