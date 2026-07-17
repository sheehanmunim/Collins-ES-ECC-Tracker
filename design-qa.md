# Design QA

- Source visual: `C:\Users\muhha\AppData\Local\Temp\codex-clipboard-c9990af9-51b2-48a5-bcae-9014207b2236.png`
- Implementation screenshots:
  - `C:\Users\muhha\Documents\Engineering Services ECC\artifacts\update-toolbar-available.png`
  - `C:\Users\muhha\Documents\Engineering Services ECC\artifacts\update-toolbar-available-461.png`
- Viewports and states:
  - 1280×720, update available, desktop label and count badge
  - 461×300, update available, compact toolbar control

## Comparison

The reference establishes a white, lightly bordered toolbar with evenly spaced
square controls for New CR, Collins AI, fullscreen, and settings. The
implementation preserves that order and styling, inserting the update control
immediately before New CR so it is the first action users see when a new commit
is available.

At desktop width, the update control adds the word “Update” plus the number of
commits. At 461 px, the label collapses while the refresh icon and count remain,
keeping the original four controls visible without wrapping. The black fill is
intentional status contrast and is not used when the installation is current.

## Iteration history

1. Added an available-update control to the existing toolbar and verified its
   desktop spacing, accessible name, count badge, and position.
2. Tested at the 461 px reference width and collapsed the label at the existing
   small-screen breakpoint, preserving the toolbar rhythm and preventing wrap.

## Final result

passed
