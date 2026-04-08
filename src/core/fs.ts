import fs from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function readText(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath, 'utf8')
  return data
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, content, 'utf8')
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) {
    return null
  }
  const raw = await readText(filePath)
  return JSON.parse(raw) as T
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2)
  await writeText(filePath, `${json}\n`)
}

export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true })
  } catch {
    // best effort cleanup
  }
}

export async function removePath(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { force: true, recursive: true })
  } catch {
    // best effort cleanup
  }
}
