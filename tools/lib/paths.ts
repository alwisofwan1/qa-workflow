/**
 * Telling test files from application code.
 *
 * This matters because a test run that also edits the product is not evidence: the thing
 * under test changed while it was being measured. A published Playwright-testing skill
 * instructs an automated fix loop to do exactly that — "App bug -> fix the application
 * code" — so the distinction has to be mechanical, not a matter of judgement.
 */
const TEST_DIR = /(^|\/)(tests?|e2e|__tests__)\//
const TEST_FILE = /\.(spec|test)\.[jt]sx?$/

export function isTestFile(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path)
}

/** Split a changed-file list into the tests and everything else. */
export function partitionChangedFiles(paths: string[]): { tests: string[]; source: string[] } {
  const tests: string[] = []
  const source: string[] = []
  for (const path of paths) (isTestFile(path) ? tests : source).push(path)
  return { tests, source }
}
