# Neon Downtown Rain

A walkable, side-on metropolitan night district built entirely from Grok-made
face-on 2D artwork. The runtime assembles each address from separate blank
building shells, storefronts, reusable windows, awnings and one-sign cutouts;
there are no one-hit finished-building or street-composite images. Flat prop,
vehicle, character and weather cards occupy a perspective street like Secret
River; no 3D asset or reconstructed model is used. Every exposed ground source
is dry and neutral—including asphalt, pavement, alleys, road paint, curbs,
drains and gravel. Runtime materials add the rain darkening, ripples and sheen;
the flat road reflects the actual image cards, while native RTX can extend
restrained reflection response across the other wet ground layers.

The world follows an original streetwise lead through varied shops, traffic,
umbrella commuters, service alleys and occupied windows. WebGPU supplies image-
card lighting, alpha-tested shadows, rain response and planar reflections. On a
compatible ThreeBrowser RTX bridge, the same flat scene also receives native
ray-tested shadow/AO and restrained wet-surface reflection guidance.

Run:

~~~powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\samples\neon_downtown_rain\play.ps1
~~~

## Controls

- A / D or left / right — walk left and right
- W / S or up / down — move between pavement depth lanes
- Shift — move faster
- F — toggle the optional inspection fly camera
- Fly camera: WASD, Space up, Ctrl down, mouse to look, Shift boost
- R — rain on or off
- X — native RTX path on or off when available

There is no HUD. Runtime and asset status are reported to stdout and exposed at
globalThis.__NEON_DOWNTOWN_ASSET_REPORT__.
