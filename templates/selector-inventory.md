# <TICKET> — Selector Inventory

Captured: <date> · Environment: <url> · Method: Playwright MCP accessibility snapshot

> Every locator below was executed and resolved. `Resolved` is the node count observed.
> Stage 3 may use nothing that is not in this file.

## <Screen name> — `<path>`

| Element | Locator | Resolved | Note |
|---|---|---|---|
| Submit button | `getByRole('button', { name: '保存' })` | 1 | ja locale |

## Instrumentation Needed

> Elements with no reliable locator. Each becomes a small PR against the app repo adding
> a `data-testid`. Never worked around with a CSS class or `nth()`.

| Element | Component file | Proposed testid | Blocking |
|---|---|---|---|
