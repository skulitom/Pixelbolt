# Fluid physics model

This is the shared model behind `pixelforge-fluid`: the aim, units, scales, state and step order that every fluid feature builds on, so that features written separately (cohesion, bubbles and air pockets, sticky liquids, phase changes, plasma, and whatever comes next) still make sense together. It is a contract for contributors. User-facing behaviour is documented in [art-workflow.md](art-workflow.md).

To change something here, edit this file in its own small commit on `main` first, then build on it. Tell the other sessions working on fluids, since they build on it too.

## 0. The aim: results that look good and feel satisfying

The physics serves the picture. Every rule below exists because it makes motion read well in pixels and feel right to watch, not because it is accurate. When accuracy and looks disagree, looks win. Cheat in the open: name the cheat in a comment, keep it deterministic, keep it under an art control.

What "looks good and feels satisfying" means here:

- **Clear beats.** Motion has a readable shape: a build-up, the event (a splash, a snap, a strike, a pop), then a settle. Timing is set in frames and tuned by eye.
- **Things come to rest.** A finished motion settles into a still, clean shape. A pixel trembling for ever, a surface that never stops shimmering, or a heap that creeps without end is a bug, even if a solver would call it physical.
- **No noise without a meaning.** No lone pixels flickering, no ragged one-pixel bumps, no speckle. Every pixel that changes should be part of something the eye follows. Use dither and noise on purpose, never as leftovers.
- **Readable at 1×.** Shapes, silhouettes and bands read at the size they ship. Anything thinner than the grid can show is drawn on purpose (a strand, a bubble, a spark), not lost.
- **Exaggerate where it reads.** Bubbles can be bigger than real ones, steam can billow more, arcs can linger, and honey can hang longer. Push the effect to what reads best on the page.
- **Cause and effect across features.** A flame boils water, steam beads under a cold lid and drips back, ice is something bubbles slide under, and an arc that hits water makes it steam. This coherence is the reason for this document: a world whose parts agree is more satisfying to watch than any one accurate part.
- **Art controls, not physical constants.** Settings are named for what they look like (`rise`, `wobble`, `adhesion`, `expansion`) and have useful defaults. Ranges stop at what still looks good, not at what is physically possible.
- **Judged by eye.** Every feature ships with a preset and its GIF, reviewed frame by frame at 1× and 4×. Passing tests doesn't make it good.

## 1. Compatibility

- Every new behaviour is opt-in. A source that doesn't use a feature renders exactly as before, and the golden hashes in `test/fluid.test.js` do not move. A shared refactor that changes existing pixels is a bug, unless it is a deliberate fix to how something looks, regenerated and described in its commit.
- Determinism as in `AGENTS.md`: only + − × ÷ and sqrt, `craft.js` trigonometry and seeded hashing, fixed substeps and iteration counts.

## 2. Units

| Quantity | Unit |
|---|---|
| Length | pixel (one grid cell) |
| Time | frame; a step is `dt = 1 / substeps` of a frame |
| Velocity, acceleration | pixels per frame, pixels per frame² (`MAX_SPEED` caps velocity) |
| Amount of matter | cells' worth of liquid: one full cell is 1 (`PER_CELL` = 4 particles, so a particle is ¼). Ice and vapour use the same unit, so matter can be counted across phases |
| Pressure | pixels of liquid head: the hydrostatic pressure `h` pixels down a still pool is `h` (gravity × depth, in the solver's scaling). Air-pocket stiffness and similar settings are given in head, so "a pocket under 10 pixels of water shrinks by a third" can be read off directly |
| Temperature | the heat scale below |
| Voltage | volts, an art scale: `breakdown` is volts per pixel of gap (see section 10) |

## 3. Temperature: one heat scale for every phase

Gas `temperature` already defines it: 0 is ambient (room air), and the fire presets draw dull red at about 0.3 and a white core at 1 (campfire and torch emitters run at 1.1, the steam vent at 0.8). Liquids, ice, vapour and plasma use the same scale, with no second one. Default thresholds for water, as proposals the phase-change prototype may tune; the order must hold:

| Event | Default | Note |
|---|---|---|
| freeze | −0.5 | ice melts at the same −0.5, but only once it has taken up its latent heat (and water freezes only once it has given it up), so the latent plateau is the gap that stops flicker; no separate melt threshold |
| ambient | 0 | `ambient` per effect (default 0) is what everything relaxes toward |
| boil | 0.5 | below the flame range, so a flame boils water and the steam vent's 0.8 is steam |
| dew (condense) | 0.4 | vapour touching something below it condenses; defaults to `boil` − 0.1 |
| flame | 0.3 to 1 | existing fire looks |
| ionize (thermal) | 2 | above every flame preset, so fire never turns into plasma by accident; arcs reach 2 to 4 |

Temperature is a temperature, not an energy: every phase has the same heat capacity per unit of matter, and exchange rates are art controls. Latent heat is a per-particle progress toward the change, filled while the temperature is held at the threshold, so melting and boiling take visible time (a plateau, not a snap). Sublimation and deposition are switches per material, not a pressure-dependent phase diagram.

## 4. Matter and the ledger

- States: **solid** (obstacles, and frozen particles, which are ice), **liquid** (particles), **gas** (grid fields: air, smoke, vapour) and **plasma** (gas with ionization above 0).
- One liquid material per liquid effect: its own settings (viscosity, yield, tension, adhesion, thresholds). Its ice and its vapour are the same material in other states. Mixing several liquids in one effect is out of scope for now.
- Phase changes conserve matter exactly: a particle that freezes is ice worth ¼; one that evaporates adds ¼ to the vapour field's matter. How much room vapour takes up on screen is `expansion`, a look applied when vapour is drawn and pushes the air, not a change in the matter count.
- The metadata keeps a per-frame ledger of liquid, ice and vapour matter, plus what emitters, drains and open edges added or took away. A closed box keeps the sum constant; tests check that.

## 5. The grid and its layers

One grid per effect, one cell per pixel. Every feature reads and writes these shared layers rather than keeping a private copy:

- **Solid layer**: which cells are solid, who owns each one (an obstacle index, `ICE`, or a closed edge beyond the canvas), each solid cell's velocity (a moving obstacle's, from its keys; a piece of ice's own while it settles or floats, zero once it rests), and each solid's surface properties (section 6).
- **Liquid**: particles with position, velocity, the APIC slopes, and, when heat is on, temperature and phase progress. `fluid` (cells holding particles) is the pressure solve's active set; `wet` (density ≥ `LEVEL`) is what looks and sparks treat as water.
- **Gas**: face velocities, `smoke` density, `vapour` matter, `temperature`, `ionization`. In a gas effect it covers every open cell. In a liquid effect it covers the air cells (section 7) and costs nothing unless a feature needs it.
- **Electric**: potential, conductivity and current (section 10), only when something has a voltage.

## 6. Solids

One function builds the solid layer each step; every feature goes through it. Its parts:

- Static obstacles, keyed moving obstacles (velocity from their keys, measured from where they really are, not from the whole pixel they are drawn at), and ice cells.
- Surface properties are fields on the obstacle source and apply wherever they make sense:
  - `adhesion` (sticky liquids): how strongly liquid holds on.
  - `surface`: pixels or smooth.
  - `temperature` (phase changes): a hot plate or a cold window. In a gas effect it heats or cools the air.
  - `voltage` and `conductor` (plasma).
- Ice takes its surface properties from its liquid: water sticks to its own ice with the effect's adhesion, and ice conducts electricity poorly. Ice that settles or floats is a moving solid like a keyed obstacle, so what clings to it moves with it and bubbles slide under it as it drifts.
- Whatever a feature does at a solid it does at every kind of solid. Bubbles slide under ice as under a ledge, sticky liquid clings to ice, air pockets are bounded by ice, and arcs treat ice as an insulator. Never special-case "obstacle" when the rule is about "solid".

## 7. Air

- In a liquid effect, every cell that is neither solid nor `fluid` is air. Air joined to an open edge is at pressure 0. A sealed region of air is an air pocket: when pockets are on, it keeps its amount of air and its pressure follows the gas law, in pixels of head.
- A bubble is a pocket too small for the grid to show, carried as a spark. It holds an amount of air (its `vol`) and rises against gravity. When it reaches open air it releases that air, and any vapour in it, to the air. A pocket that shrinks below a few cells becomes bubbles, and bubbles that gather under a ceiling can merge into a pocket.
- Vapour and smoke in a liquid effect ride a gas velocity field over the air cells. Liquid and ice act on it as walls moving with the liquid. Vapour that boils into a sealed pocket adds to it and raises its pressure.
- The gas over air cells is the same gas code that `kind: "gas"` runs, not a second copy. Long term, gas and liquid effects are one simulation: `kind` only chooses what emitters and fills add by default.
- As built (`src/fluid.js`): bubbles are sparks with `rise`. Any stage makes one with `addBubble(run.sparks, run.totals, s, x, y, r, extra)` (`s` as `readSparks` reads it, `extra` its own fields, such as a boil's vapour), and every bubble that ends goes to `moveSparks`'s `ended` hook with `end` set to `'air'`, `'life'`, `'solid'` or `'edge'`. A solid that moves onto a bubble pushes it aside. Bubbles' `lift` reaches the force stage through `state.lifts`. With `air` on, `sealAir` labels the air each step (`state.air.label`, one entry in `state.air.regions` per sealed or open region) and tracks each pocket's `air`, the volume it would fill at zero pressure; a pocket is one more unknown in the liquid's pressure solve. `addAir(state, i, j, amount)` adds air or vapour to the pocket at a cell (a bubble that ends there does it). Air reads the solver's solid masks (`g.solid`, `g.pixels`, `uFixed`, `vFixed`), so ice must reach those to bound pockets and stop bubbles. Sealed gaps of 3 to 11 cells become bubbles, not pockets. Bubbles gathering under a ceiling do not merge into a pocket yet.

## 8. Forces and up

- Each effect has one gravity vector. "Up" is against it, everywhere: hot gas, vapour and plasma rise along it (buoyancy from temperature), smoke and dry-ice fog sink with `weight`, and bubbles rise against it relative to the water. A gas effect has no gravity setting, so its up stays −y.
- Cohesion (`tension`) acts between liquid and liquid, and adhesion between liquid and solid. Both are measured relative to the solid's own motion, so what clings to a lifted spoon rises with it.
- A bubble's `lift` hands part of its buoyancy to the water around it. Boiling uses the same path, so a boil churns the water.

## 9. Heat flow and phase changes

- Heat is carried by whatever holds it: particles, ice cells, and the gas temperature field. Heat flows by conduction (between neighbours and across contact: particle to air, particle to solid, air to solid), relaxes toward `ambient` at a rate (gas `cooling` is this rate), and comes from sources: emitter and fill temperatures, obstacle `temperature`, and Joule heating from current.
- Freezing and melting turn particles into ice and back. A cell holding enough ice becomes solid in the solid layer. Ice needs a seed: water below freeze turns to ice only where it touches ice or a solid colder than freeze, or once it is well below (0.5), so a pond chilled from above freezes in from its cold shore instead of all at once. Ice that touches no solid and has nothing under it settles as one piece; water flanking most of it holds it up (it floats).
- Evaporation and condensation move ¼ units between particles and the vapour field. Vapour touching a cold solid or ice gathers there as dew, drawn as water, and drips off as a drop once a cell holds a cell's worth; onto cold water it joins the water a particle at a time. Condensing in open cold vapour (mist) is not settled: done plainly, every steam plume rains. Boiling inside the liquid makes bubbles (vapour bubbles, section 7) before vapour leaves the surface: a boil should look like a boil.
- Sublimation (ice to vapour) and deposition (vapour to ice) are per-material switches. Deposition grows only from cells touching cold solid or existing ice, with seeded noise, so frost spreads in fingers.

## 10. Electricity and plasma

- Obstacles with `voltage` are electrodes; `conductor: true` marks metal. Closed edges may be grounded.
- The potential is solved over conductivity: very low in neutral air (it conducts only once broken down), high in plasma (rising with ionization), moderate in liquid water, low in ice, and high in conductors.
- Air ionizes when the field exceeds `breakdown` (lower in hot or thin gas, so arcs follow hot air), or thermally above the ionize threshold. Channels grow by seeded dielectric breakdown.
- Current heats the gas (and, once phase changes exist, any liquid it passes through) on the shared heat scale. Plasma recombines, faster as it cools, leaving an afterglow and a leftover channel that the next strike follows.
- Because water conducts and heat is shared, an arc that reaches a pool goes to it and makes it steam with no special case. Building that link waits until phase changes have landed.

## 11. Step order

Each step runs these stages in order. A feature fills in its stage and costs nothing when it is off:

1. **Solids**: place obstacles and their velocities, and add ice. Build the solid layer.
2. **Sources**: emitters, fills on their frame, heat sources, electrodes.
3. **Electric**: potential, ionization growth and decay, current, Joule heat.
4. **Heat**: conduction and relaxation across every phase, and latent progress.
5. **Phase changes**: freeze and melt, evaporate and condense, sublimate and deposit. Update the ledger.
6. **Liquid**: particles to grid, forces (gravity, cohesion, bubble lift), viscosity (walls moving at the solid's velocity), pressure (conjugate gradients, air pockets at their gas-law pressure), grid to particles, adhesion relative to solids, advection that never enters a solid.
7. **Gas**: forces (buoyancy along up, weight), advection, pressure over its cells (liquid and solids as moving walls), then carry smoke, vapour, temperature and ionization.
8. **Particles drawn over the fluid**: sparks, bubbles, whitewater, carriers.
9. **Bookkeeping**: ledger, figures, warnings.

## 12. Ownership and landing order

Each shared piece has one session that builds it; the others use it rather than writing their own:

| Piece | Built by |
|---|---|
| Solid layer: moving-solid velocity, per-obstacle surface properties, owner lookup | sticky liquids |
| Air: the air predicate, sealed pockets, bubbles as small pockets | bubbles and air pockets |
| Heat field and scale, ice in the solid layer, gas over air cells in a liquid effect, matter ledger | phase changes |
| Electric layer, ionization; uses the heat scale and solid properties | plasma |
| Rest and cleanliness (sections 0 and 1) | everyone; the cohesion work set the bar |

Landing order: sticky liquids and bubbles land first, in whichever order they are ready. Phase changes builds on both. Plasma's gas-only part can land any time, as long as it uses this heat scale and the solid layer's surface properties. Plasma meeting liquids comes after phase changes.
