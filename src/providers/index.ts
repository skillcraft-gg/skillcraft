import { GitHubProvider } from './github.js'

export type ProviderName = 'gh'

export const providers = {
  gh: () => new GitHubProvider(),
}

export function getProvider(name: 'gh'): GitHubProvider {
  return providers[name]()
}
