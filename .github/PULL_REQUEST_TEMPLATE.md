<!-- Thanks for contributing to Penmark. Keep PRs small and focused. -->

## Summary

<!-- What does this change and why? Reference the design/plan/ADR path when relevant. -->

## Related issue

<!-- Closes #NNN, or "n/a" for a standalone change. -->

## How was this tested?

<!-- Commands run and their result. Paste evidence, do not just assert. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:browser` (if webview/render behavior changed)
- [ ] `npm run test:ext` (if activation/host behavior changed)

## Checklist

- [ ] Conventional Commit subject (`type(scope): description`, imperative, <= 72 chars)
- [ ] Stays within the compatibility floor (`engines.vscode ^1.105.0`, stable APIs only)
- [ ] No `vscode` imports added under `src/core/`
- [ ] No code ported from reference repositories (see CONTRIBUTING)
- [ ] ROADMAP / CHANGELOG / ADR updated in the same commit set if user-facing behavior changed
