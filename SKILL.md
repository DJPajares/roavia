---
name: roavia-uiux
description: Project-specific UI/UX constraints for the Roavia travel-planning PWA.
---

# Roavia UI/UX Skill

## Design Read

```text
Reading this as: a premium consumer travel-planning product for independent and group travelers, with an optimistic editorial and map-led language, leaning toward Tailwind CSS, semantic design tokens, and custom accessible components rather than a generic SaaS component kit.
```

## Design Dials

```text
DESIGN_VARIANCE: 7
MOTION_INTENSITY: 6
VISUAL_DENSITY: 5
```

## Product Character

Roavia should feel exploratory and inspiring without sacrificing trust. Destination surfaces may be cinematic and editorial; planning surfaces must become denser, calmer, and more operational.

## System and Ownership

- Styling foundation: Tailwind CSS with semantic Roavia tokens.
- Component strategy: Roavia-owned accessible components; use maintained primitives only when they solve interaction or accessibility needs.
- Do not default to a generic component kit or ship its unmodified visual style.
- `packages/ui` owns shared web components and tokens.
- Map, itinerary, calendar, source/freshness, and offline patterns must use shared contracts.
- Provider-specific rendering does not belong in page components.

## Layout

- Explore and destination pages may use asymmetric editorial grids and strong imagery.
- Trip planning uses a stable content rail with map/timeline coordination rather than repeated equal cards.
- Keep primary actions close to the current planning decision.
- Mobile is single-task and progressive; desktop may coordinate itinerary and map side by side.
- Avoid horizontal overflow and preserve touch targets.

## Typography

- Use a distinctive but highly legible display face for destination moments and a neutral, efficient UI face for planning controls.
- Keep long destination copy near 60–70 characters per line.
- Use tabular numerals where time, cost, temperature, and duration alignment matters.
- Do not use all-caps labels as the default hierarchy technique.

## Color, Shape, and Theme Locks

- Color should evoke navigation, landscape, weather, and confidence—not generic AI purple.
- Reserve strong accent color for primary actions, active routes, selected dates, and important map marks.
- Weather, cost, crowd, freshness, and risk states must use labels or shapes in addition to color.
- Use a restrained radius scale: smaller for controls/data surfaces, larger for editorial media and sheets.
- Light and dark modes must preserve map, calendar, and status readability.

## Maps and Data Visuals

- Maps require text alternatives and non-map paths for essential actions.
- Avoid placing critical controls directly over visually noisy map areas.
- Show route duration, confidence, and disruption using clear labels.
- Seasonal calendars must explain signals; do not rely on unexplained heatmaps.

## Interaction and Motion

- Motion communicates spatial change, itinerary reordering, generation progress, route updates, or selection feedback.
- Respect reduced motion.
- Prefer transform and opacity.
- Do not animate continuous map/scroll values through React state.
- Generation progress may feel purposeful but must not fake certainty or completion.

## Forms

- Labels above controls; never use placeholders as labels.
- Separate required facts from optional personalization.
- Review inferred assumptions before itinerary generation.
- Preserve user input across errors and retries.
- Complex preferences should be progressively disclosed, not presented as one giant form.

## States

Every primary experience must deliberately handle:

- loading
- empty
- partial data
- generation in progress
- stale data
- offline
- provider unavailable
- validation error
- permission denied
- success
- destructive confirmation

## Source and Trust Patterns

- Time-sensitive claims display source and freshness.
- Official-source links are visually distinct for visa, safety, and emergency matters.
- Confidence and uncertainty must be human-readable.
- AI suggestions must not look identical to verified facts.

## Accessibility

- Target WCAG 2.2 AA.
- Provide keyboard alternatives for drag/reorder.
- Preserve visible focus.
- Use accessible names for map markers, itinerary actions, and calendar cells.
- Announce generation, save, download, and sync status changes.
- Provide text summaries for route and seasonal visualizations.

## Anti-Slop Bans

- No AI-purple mesh as the default brand.
- No endless grid of identical destination cards.
- No decorative “AI-powered” badges without user value.
- No fake itinerary screenshots composed from placeholder rectangles.
- No unexplained scoring, confidence, or “best” labels.
- No excessive glass effects over imagery or maps.
- No motion that delays planning actions.
- No generic travel copy such as “discover hidden gems” unless backed by specific content.

## Pre-Flight Review

- [ ] The result reflects the editorial-plus-operational design read.
- [ ] Map, itinerary, calendar, source, and offline patterns are coherent.
- [ ] Mobile and desktop workflows are intentionally different where needed.
- [ ] Loading, stale, offline, generation, failure, and success states are real.
- [ ] Keyboard, focus, labels, contrast, and reduced motion are covered.
- [ ] Time-sensitive facts show source/freshness.
- [ ] AI suggestions are distinguishable from verified facts.
- [ ] Copy is specific to Roavia and the current destination or trip.
