# Compatibility matrix

## Support targets

The extension targets three IDEs on one compatibility floor.

<!--pmk:b f3w6r5zn-->

| IDE         | Base version | Registry       |
| ----------- | ------------ | -------------- |
| VS Code     | 1.105        | MS Marketplace |
| Cursor      | 1.105        | MS mirror      |
| Antigravity | 1.107        | Open VSX       |

## Activation

The activation sequence is deliberately minimal.

<!--pmk:b p7q2l4vc-->

```ts
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(registerPreviewCommand());
}
```

## Concept sketch

<!--pmk:b a5s4d6fg-->

![preview concept](../assets/concept.png)

## Constraints

<!--pmk:b z2x5c7vb-->

Stable APIs only. Proposed APIs are unavailable on the forks, and shipping against them would silently break Cursor and Antigravity even though VS Code itself works.

<!-- pmk:review v1 -->
<!--pmk:c f3w6r5zn
carlos (human) · 2026-06-12 09:20 +10:00
> | IDE         | Base version | Registry       |

Table is missing the verification date column we agreed on.
-->
<!--pmk:c p7q2l4vc
claude-code (agent) · 2026-06-12 09:21 +10:00
> ```ts

This snippet predates the panel serializer; update once T4 lands.
-->
<!--pmk:c a5s4d6fg
carlos (human) · 2026-06-12 09:22 +10:00
> ![preview concept](../assets/concept.png)

Replace with the final light/dark pair from the mockups folder.
-->
<!--pmk:c z2x5c7vb
carlos (human) · 2026-06-12 09:23 +10:00
> Stable APIs only. Proposed APIs are unavailable on the forks, and shipping against them would silently break Cursor and Antigravity even though VS Code itself works.

Add a sentence on how we enforce this (the engines field plus CI matrix).
-->
<!-- /pmk:review -->
