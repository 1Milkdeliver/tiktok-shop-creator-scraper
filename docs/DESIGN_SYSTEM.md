# Creator Desk Design System

The product UI follows GitHub Primer's open-source design and interaction model, adapted to the Creator Desk brand and its plain HTML/CSS Electron architecture.

Sources:

- Primer design guidelines: https://primer.github.io/design/
- Primer button guidance: https://primer.github.io/design/components/button/
- Primer open-source implementations: https://github.com/primer/

## Product adaptation

- Use Primer's neutral canvas, borders, spacing density, six-pixel component radius, visible keyboard focus, and semantic component hierarchy.
- Use the app logo palette: deep blue (`#2068a8`) for primary actions, cyan (`#55b8df`) for selected borders, and pale cyan (`#e8f5fb`) for selected surfaces. Do not introduce TikTok pink or copy GitHub branding.
- Use system fonts so Chinese and English remain crisp and the packaged app stays lightweight.
- Prefer CSS tokens and native semantic HTML. Do not add a framework solely for appearance.

## Buttons

- Use one primary action per page or action group. All routine actions use secondary buttons.
- Primary: solid brand accent. Secondary: neutral surface with border. Danger: neutral surface with red label, turning solid red on hover.
- Default height is 32px; labels are concise, sentence case, and never wrap.
- Every interactive control must have a visible `:focus-visible` state and at least a 24×24px target.
- Loading actions remain in the DOM, use `aria-busy`/`aria-disabled`, and provide visible progress feedback.
- Icons supplement text; they do not replace a descriptive accessible label.

## Surfaces and forms

- Cards, inputs, tables, menus, and modal panels use a 6px radius and a 1px neutral border.
- Cards do not lift or grow on hover. Hover is reserved for interactive rows and controls.
- Inputs use a blue focus ring because focus is a universal interaction state, not brand decoration.
- Tables use neutral sticky headers and a subtle row hover. Numeric columns should be right-aligned in future table work.

## Navigation and feedback

- The active sidebar item uses a light surface with dark text; hover alone uses a low-contrast overlay.
- Status colors are semantic: green success, amber warning, red error, blue focus/information.
- Destructive actions require clear wording and confirmation when data cannot be recovered.
- Do not introduce new gradients, glass effects, oversized shadows, arbitrary radii, or emoji-only controls.
