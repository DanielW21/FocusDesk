# FocusDesk development notes

FocusDesk is a strict TypeScript/Vite macOS app with a small Objective-C native host.

## Boundaries

- `src/features/<feature>/` owns feature clients, actions, views, and widget variants.
- `src/widgets/` owns only widget registration, layout, hydration, and lifecycle infrastructure.
- `src/platform/` is the typed WebView-to-native boundary. Never spawn processes or read integration files from renderers.
- `native/Integrations/` owns allow-listed process and service supervision.
- `contracts/` contains versioned JSON contracts shared with sibling tools.
- `.agents/skills/` contains reusable integration playbooks; update the playbook when the integration contract changes.

## Widget rules

Use `defineWidget()` and a partial `views` map keyed by explicit grid dimensions such as `2x2` or `2x3`. A widget defines only the dimensions it can render well; the picker derives supported dimensions from the map. Keep widget renderers pure and escape external text.

## Checks

Before handing off a change, run:

```sh
npm run tsc:check
npm test
npm run lint
npm run format
npm run build
```

Use named exports, strict TypeScript, Zod validation at trust boundaries, kebab-case filenames, and colocated `*.unit.test.ts` tests.
