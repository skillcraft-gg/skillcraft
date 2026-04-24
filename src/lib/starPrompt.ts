import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { loadGlobalConfig, saveGlobalConfig } from '@/core/config'
import { getProvider } from '@/providers'

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

  const rl = createInterface({ input, output })
  try {
    const forcedAnswer = process.env.SKILLCRAFT_STAR_PROMPT_RESPONSE
    while (true) {
      const answer = normalizeAnswer(
        forcedAnswer !== undefined
          ? forcedAnswer
          : await rl.question('Star Skillcraft on GitHub? [Y/n/d] '),
      )
      if (!answer || answer === 'y' || answer === 'yes') {
        try {
          await provider.starRepo(skillcraftRepo)
          output.write('Thanks for starring Skillcraft on GitHub.\n')
        } catch {
          output.write('Could not star Skillcraft on GitHub automatically.\n')
        }
        return
      }

      if (answer === 'n' || answer === 'no') {
        return
      }

      if (answer === 'd' || answer === 'dont' || answer === "don't ask again" || answer === 'dont ask again') {
        await saveGlobalConfig({
          ...config,
          prompts: {
            ...(config.prompts ?? {}),
            starSkillcraftDisabled: true,
          },
        })
        output.write('Okay. Skillcraft will not ask again.\n')
        return
      }

      if (forcedAnswer !== undefined) {
        return
      }

      output.write('Please enter Y, n, or d.\n')
    }
  } finally {
    rl.close()
  }
}

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase()
}

function isInteractivePromptAllowed(): boolean {
  return (input.isTTY && output.isTTY) || process.env.SKILLCRAFT_FORCE_TTY === '1' || process.env.SKILLCRAFT_STAR_PROMPT_RESPONSE !== undefined
}
