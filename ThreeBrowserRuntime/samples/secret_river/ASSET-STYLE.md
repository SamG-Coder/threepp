# Secret River asset rule

One look for every picture in `assets/`. If an image fails any line below, it is not shippable. Delete it and make it again from a passing neighbour — do not patch a different style onto the set.

## The look

Watercolour realism of Hawkesbury / Dyarubbin bush. It should feel like a wet Australian landscape painting that still has real bark, real leaves, real dirt: late-afternoon sun, olive and khaki canopy, pale gum trunks, tannin mud. Not a nursery catalogue. Not a plastic toy. Not a photo of a specimen lying on coloured paper.

## Shared light and colour

- Late afternoon Australian sun from the side, warm but not sunset orange.
- Soft atmospheric depth in foliage, like watercolour washes in the canopy, hard factual detail in bark and grass blades.
- Palette: pale grey/salmon gum bark, olive eucalyptus, dry gold grass, wet olive mud, khaki litter. No neon greens, no studio grey.

## Cutouts (trees, flora, walker)

- Camera is eye-level, side-on, subject standing as it would on the riverbank.
- Subject floats in empty space. Flat hot magenta fills every hole and the whole background.
- No ground plane, no turf disc, no root ball, no pot, no paper, no cloth, no drop shadow, no contact shadow on the magenta.
- Trunk or stems go to the bottom edge as if planted; they are not a pulled plant.
- Same paint-and-light as the rest of the set. A new tree must look like it grew next to `scribbly-gum.jpg` and `casuarina.jpg`.

## Ground tiles (dirt, grass, litter, mud)

- Seamless top-down photograph/painting of Hawkesbury earth, even overcast light.
- No recognisable clump, footprint, or watermark. The pattern continues off every edge.
- Same palette as the cutouts’ world, not red desert and not indoor product-shot dirt.

## Hills

- Wide side-on wooded ridge, painterly-real eucalyptus canopy, magenta where the sky would be.
- No people, no buildings, no paper edge.

## Walker frames

- Same man, same clothes, same side-on camera, same magenta void, same bush light.
- Walk frames are that man walking in place, not a different photograph of a different person.

## Fail immediately

- Looks like a sticker, a printout, or an object on a table.
- Baked shadow on the backdrop.
- Top-down plant with exposed roots.
- Style drift: glossy catalog vs watercolour bush.

## Audit (this pass)

| Asset | Result | Why |
|---|---|---|
| trees/scribbly-gum.jpg | pass | Side-on planted gum, magenta void, no floor shadow. Style anchor. |
| trees/paperbark.jpg | pass | Standing multi-trunk, same paint/light. |
| trees/tea-tree.jpg | pass | Standing shrub, no ground. |
| trees/banksia.jpg | pass | Standing, same set. |
| trees/wattle.jpg | pass | Standing, same set. |
| trees/sapling.jpg | pass | Standing young gum. |
| trees/angophora.jpg | pass | Standing, same set. |
| trees/casuarina.jpg | fail | Turf disc / paper crumbs at the base. |
| trees/river-red-gum.jpg | fail | Floating roots, drop shadow, paper backdrop. |
| flora/hanging-branch.jpg | pass | Overhanging canopy, no floor. |
| flora/fallen-log.jpg | pass | Isolated log, no floor shadow. |
| flora/kangaroo-grass.jpg | fail | Nursery tussock sitting on magenta, not planted in bush. |
| flora/reeds.jpg | fail | Laid on wrinkled paper, root ball, not side-on. |
| flora/lomandra.jpg | fail | Pulled plant with root ball. |
| flora/fern.jpg | fail | Soil clump, potted specimen. |
| flora/sapling.jpg | pass | Same as tree sapling. |
| ground/grass.jpg | pass | Even tile, bush palette. |
| ground/mud.jpg | pass | Wet estuarine mud tile. |
| ground/dirt.jpg | fail | Bare beach sand, not Hawkesbury bush dirt. |
| ground/litter.jpg | fail | Unique stick, will tile as a grid, photo-catalog. |
| ground/bank-face.jpg | fail | Catalog photo of a sand cliff, paper sky. |
| hills/far-ridge.jpg | fail | Paper wrinkles in the magenta; photo not paint-real. |
| walker/profile.jpg | watch | Isolated side-on, but catalog-photo not watercolour. Walk frames match him; leave until a full cycle redo. |

### Recreated this pass

| Asset | Result after redo |
|---|---|
| trees/casuarina.jpg | pass — turf disc gone, trunk planted in magenta |
| trees/river-red-gum.jpg | pass — single planted trunk, hanging bark, no roots in air |
| flora/reeds.jpg | pass — side-on, stems off the bottom, no paper, no root ball |
| flora/fern.jpg | pass — planted stems, no soil clump |
| flora/lomandra.jpg | pass — strappy leaves, no root ball |
| flora/kangaroo-grass.jpg | pass — growing from the bottom edge |
| ground/dirt.jpg | pass — even Hawkesbury dirt+litter tile matching the grass tile |

Still open: `ground/litter.jpg` (unique stick), `ground/bank-face.jpg` (catalog cliff), `hills/far-ridge.jpg` (paper wrinkles), walker cycle (catalog photo, kept for identity).
