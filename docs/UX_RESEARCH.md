# UI/UX Research Notes

This document records the external references and product decisions behind the Creator Desk interface. It prevents future changes from drifting into arbitrary styling.

## Sources reviewed

- Inter: https://rsms.me/inter/ — designed for detailed screen interfaces, with text/display optical sizes, tall x-height, tabular numerals, and variable weights.
- Noto Sans CJK: https://github.com/notofonts/noto-cjk/blob/main/Sans/README.md — open-source CJK family with Simplified Chinese variable and regional subsets.
- WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ — visible keyboard focus and minimum target-size guidance.
- Nielsen Norman usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/ — visibility of system status, user control, consistency, error prevention, and recognition over recall.
- GitHub Primer: https://primer.github.io/design/ — component hierarchy and efficient, accessible tool interfaces.
- AppFlowy: https://github.com/AppFlowy-IO/AppFlowy — 70k+ star local-first productivity workspace.
- Hoppscotch: https://github.com/hoppscotch/hoppscotch — 70k+ star, lightweight data-dense developer tool with workspaces, history, and shortcuts.
- Plane: https://github.com/makeplane/plane — high-star project-management workspace with persistent navigation and focused task views.
- Twenty: https://github.com/twentyhq/twenty — 40k+ star data-centric CRM with configurable object fields and views.

## Decisions applied

- Use 14px/21px as the normal reading size, 13px/20px for dense controls and tables, 16px/24px for sections, and 24px/32px for page titles.
- Avoid weights below 400. Use 500 for labels, 600 for actions/headings, and 700 only for the product title or critical metric emphasis.
- Keep a persistent sidebar and top-level status. Each page has one clear primary action.
- Remove wizard step numbers after moving the workflow into separate pages; page location and section titles provide hierarchy.
- Preserve table context during horizontal exploration by freezing creator identity columns.
- Keep at least a 32px control height, a strong two-pixel focus outline, and plain-language labels.
- Show progress/status in place, preserve user control during long tasks, and validate required configuration before starting.
- Keep Chinese and English in the same layout slots to prevent spatial memory from breaking during locale switches.
