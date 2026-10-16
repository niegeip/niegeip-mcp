---
version: alpha
name: NiegeIP Connect
description: A restrained consent screen for connecting purchased creative assets.
colors:
  primary: "#345fce"
  primaryHover: "#294ea9"
  focus: "#4b7dff"
  ink: "#141414"
  muted: "#686b73"
  paper: "#ffffff"
  ground: "#f6f7f9"
  line: "#eceef2"
  danger: "#b62132"
typography:
  sans:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
rounded:
  control: "8px"
  panel: "16px"
spacing:
  pageMax: "1080px"
  panel: "28px"
components:
  button: {}
  input: {}
  consent: {}
---

# NiegeIP Connect Design System

## Overview

Three production reference images form a quiet visual signature. The only page is a product authorization form, not a marketing landing page. It serves NiegeIP creators connecting an external Agent; copy uses Simplified Chinese. Geographic markets are not inferred from this locale; phone validation follows the existing platform API's mainland mobile format.

The visual basis is NiegeIP's existing light marketplace tokens. This independent distribution contains its own small runtime stylesheet in `src/ui.ts`; the document records those runtime values rather than generating another theme. Text buttons use a darker blue for contrast. No external fonts or trackers load on a credential page.

## Colors

Runtime `stylesheet` variables map primary→`--blue`, primaryHover→`--blue-hover`, focus→`--focus`, ink→`--ink`, muted→`--muted`, paper→`--paper`, ground→`--ground`, line→`--line`, danger→`--danger`. Error text accompanies color. Global scrollbar styling inherits muted/ground.

## Typography

System Chinese-capable sans for all form text, restrained heavy wordmark and a large two-line title. Form text is 14px, help 12–13px, headline 36–64px. No decorative monospaced identifiers in the user's flow.

## Layout

Desktop: 1080px maximum, contextual introduction plus 440px consent panel. At 760px the panel becomes a single column; secondary illustration and explanatory intro are hidden. Essential client, callback, scope, form and privacy text remain. Help and status reserve space. No animation is required.

## Elevation & Depth

One white panel with a thin border on a neutral ground. Avoid stacked shadows or nested promotional cards.

## Shapes

8px inputs/buttons, 16px panel, controls at least 44px high. The three-image motif has blue top rules; it does not imply actual image previews.

## Components

`connectPage`, `stylesheet` and `browserScript` in `src/ui.ts` own all form, validation, pending, status and button behavior. HTML labels, first-error focus, `aria-invalid`, live status, masked code with toggle, and consent checkbox are mandatory. Buttons share hover/focus/disabled states. Browser-owned password manager and paste remain available.

## Do's and Don'ts

Keep application name, destination origin and permissions visible before consent. Do not advertise contract rights, hide critical errors in toasts, use browser alert dialogs, or expose credentials in URLs/logs. Screen-owned errors retain entered phone and allow retry. Download actions belong to the Agent workflow, not this consent screen.
