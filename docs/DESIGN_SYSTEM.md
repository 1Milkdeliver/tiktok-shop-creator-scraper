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

## Typography and localization

- Use bundled `Inter Variable` for Latin text, numbers, and UI punctuation; use bundled `Noto Sans SC Variable` for Simplified Chinese glyphs.
- Body text defaults to 13–14px, supporting text to 11–12px, section headings to 15–16px, and page headings to 22–25px.
- Use tabular numerals for metrics and numeric table columns. Logs and machine-readable values use the system monospace stack.
- Chinese and English must share the same layout slots. Switching locale may replace text but must not move navigation, header actions, task controls, or filter columns.
- Give dynamic-label buttons a fixed width based on the longer locale. Do not solve localization with a smaller font size.

## Navigation and feedback

- The active sidebar item uses a light surface with dark text; hover alone uses a low-contrast overlay.
- Use bundled Primer Octicons at 18px for primary navigation. Icons supplement stable text labels and show localized tooltips when the sidebar is collapsed.
- Keep four top-level destinations: Overview, Tasks, Creator Library, and Export Center. Account and environment setup belongs to Overview.
- Status colors are semantic: green success, amber warning, red error, blue focus/information.
- Destructive actions require clear wording and confirmation when data cannot be recovered.
- Do not introduce new gradients, glass effects, oversized shadows, arbitrary radii, or emoji-only controls.
- Large option sets use search, selected counts, and collapsed groups. Do not show every category keyword at once by default.
- Keep system status visible and announce asynchronous state changes through polite live regions.
- Validate required choices before starting a task; explain what must be corrected in user language.
