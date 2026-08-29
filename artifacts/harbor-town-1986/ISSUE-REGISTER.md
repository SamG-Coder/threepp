# Minamihama issue register

| id | district | defect | root cause | owner file | v9 evidence | status |
|---|---|---|---|---|---|---|
| Z1 | sakae | road moire / z-fight | asphalt y=0 on height-field 0 | map.mjs GROUND.y | sakae-v9 | fixed y=-0.03 + polygonOffset |
| M1 | all | unlit pasted hulls | MeshBasicMaterial DoubleSide | main.mjs | sakae-v9 | fixed Standard FrontSide |
| H1 | all | torn organics | 32/48 hull | main.mjs | park-v9 | custom/humanoid 64³ |
| C1 | all | pink products keyed | global magenta + watermark rect | chroma-key.mjs | sakae pharmacy holes | flood-fill key |
| B1 | town | black slabs | gap/south/yokobori boxes | facades.mjs | town-v9 / town-v10 | dressed in v10 |
| P1 | sakae | 21 identical Hiro | catalog INSTANCES | catalog.mjs | sakae-v9 | 4 static + 10 pooled walkers |
| F1 | all | dead fill exports | addStreetFill unused | main.mjs | — | leave unwired; facades cover |
| N1 | all | unused nav graph | no ambient | ambient-life.mjs | — | walkers on graph |
| T1 | park | canopy in camera | 15m oaks | catalog.mjs | town-v9 park-v9 | thinned |
| V1 | sakae | melted van in lane | stills + z=3.35 | catalog.mjs | street-east-v9 | parked z=±4.4 |
| X1 | sakae | cub/zelkova empty hulls | 72/24 tris | main.mjs | — | not planted if <200 tris |
| Q1 | amihama | empty water / world edge | camera + small water | scout/fill-quay | quay-v9 | boats + larger water pending v10 |
| S1 | suzume | crude stairs | box steps | fill-park / main | hill-v9 | agent-owned |
| A1 | sakae/yokobori/r16/amihama | no motion | anim loop player-only | ambient-*.mjs | — | walkers, van, boats, gulls |
