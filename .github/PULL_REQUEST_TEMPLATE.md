<!-- Thanks for contributing to Penmark. Keep PRs small and focused. -->

## Summary

<!--
What changes, and why, in two or three sentences before any detail.
Cite files in this repository by path, and the ADR when relevant. Cite
nothing outside it -- no private repository, no design or plan document
held there, no path on your own machine. Restate the reasoning here
rather than pointing at where it was written down.
-->

## Related issue

<!-- Closes #NNN, or "n/a" for a standalone change. -->

## How was this tested?

<!-- Commands run and their result. Paste evidence, do not just assert. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:browser` (if webview/render behavior changed)
- [ ] `npm run test:ext` (if activation/host behavior changed)
- [ ] `required` aggregate check is green

## Checklist

- [ ] Conventional Commit subject (`type(scope): description`, imperative, <= 72 chars)
- [ ] Nothing in the body names a private repository, a design or plan document held there, or a path on a personal machine
- [ ] Stays within the compatibility floor (`engines.vscode ^1.105.0`, stable APIs only)
- [ ] No `vscode` imports added under `src/core/`
- [ ] No code ported from reference repositories (see CONTRIBUTING)
- [ ] Any workflow action reference uses a full commit SHA with a version comment
- [ ] Release workflow changes preserve exact version tags, verification-only dispatch, and local-first distribution
- [ ] ROADMAP / CHANGELOG / ADR updated in the same commit set if user-facing behavior changed
