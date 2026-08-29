# 23 — Walkable nav graph

Artifact only. Do **not** overwrite `samples/harbor_town_1986/src/nav-graph.json`.

Sample graph is an 11-node spine (`hill → stairs → sakae-west/mid/east → harbor-gate → quay`) with `records`, `flower`, `yokobori`, `route16` as stubs. It misses most shop fronts, sits `yokobori` inside the bar mesh, and uses waypoint ids that `minamihamaGo` does not know.

This graph is 14 nodes, bidirectional, one connected street component. `minamihamaGo(id)` works for every node except `route16` and `harbor-gate`.

## Sources

| node | x, z | taken from |
|---|---|---|
| hill | −22, −32 | `LANDMARKS.hill` (sample / `WALK_WAYPOINTS.hill` were −22, −28 = `house`/`spawn`) |
| stairs | −18, −14 | landmark = waypoint = sample |
| tobacco, soba, produce, arcade, records | shop x, **z = −1.5** | north-row scout fronts (1.5 m south of the shop line, yaw π) |
| sakae | 0, 1.5 | `LANDMARKS.sakae` — street hub, replaces `sakae-mid` (0, 0) |
| flower | −6, 5.2 | `LANDMARKS.flower` — 1.5 m north of south-row (sample had −6, 6) |
| bar | 22, 12 | `LANDMARKS.bar` — Yokobori mouth. Sample `yokobori` (26, 16) is the building centre |
| harbor-gate | 0, 48 | `WALK_WAYPOINTS` / sample (no landmark of this name) |
| harbor | −8, 58 | `LANDMARKS.harbor` — new dock node |
| quay | 0, 82 | `LANDMARKS.quay` (sample / waypoint used z = 80) |
| route16 | −40, 4 | sample (no landmark) |

Dropped: `sakae-west` (−14, 0) and `sakae-east` (10, 0). Those are the street-centre twins of `soba` and `arcade`. Shop-front ids match scout names.

Not in the graph (landmarks that are not shops or path hubs): `spawn`, `house`, `van`, `booth`, `warehouse`.

## Shop fronts

North row, catalog centres at `z = −8.5`, viewer on asphalt at `z = −1.5`:

| id | catalog | x |
|---|---|---|
| tobacco | tobacco-shop | −25 |
| soba | soba-shop | −14 |
| produce | greengrocer | −4 |
| arcade | you-arcade | 8 |
| records | cassette-shop | 20 |

South row is only Midori florist. Viewer `z = 5.2` is 1.5 m north of the south sidewalk (`GROUND.sidewalkS.minZ = 6`). Phone booth / kei van are furniture, not shops.

Alley is `bar`, on `GROUND.alley`, looking at Galaxy sakaba.

## Edges

Street-walkable, not crow-flies through buildings.

- **Hill path** `hill — stairs` along `GROUND.hillPath`, then onto Sakae at `tobacco` / `soba`.
- **North sidewalk** `tobacco — soba — produce — arcade — records` at z = −1.5.
- **South sidewalk** `flower` crosses to `soba` / `produce` / `sakae`.
- **West strip** `route16 — tobacco` on the asphalt that runs to x = −48.
- **Alley** `records — bar`, then `bar — harbor-gate` (same role as sample `yokobori — harbor-gate`, without walking through the mesh).
- **Harbor road** `sakae — harbor-gate — harbor — quay`, plus the sample’s direct `harbor-gate — quay` centreline.

`sakae` is the only z ≈ 0 spine node kept; it is the x = 0 line down to the gate.
