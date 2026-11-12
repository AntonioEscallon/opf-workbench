# OPF Workbench

A working sketch of a friendlier interface for optimal power flow (OPF) studies. It shows how case data, editing,
validation, runs and results could fit together around an existing OPF engine. It is a personal design project:
the network is a mock 17-bus system built on the public IEEE 14-bus test case, and the "solver" is a stub.

**Live demo:** see the GitHub Pages link in the repository's About section. Everything runs in the browser; edits are
kept in your browser only (Data → Reset demo data starts over).

## What it does

| Area | In this sketch |
|---|---|
| **Case data** | A database is the source of truth ([db/schema.sql](db/schema.sql)). Every edit creates a new, immutable case version; scenarios are named overrides on a version; every run points at the exact version and overrides it used, plus a hash of the solver input. |
| **Units** | Stored in MW / Mvar / kV with the system MVA base. One toggle switches every table and field to per-unit. |
| **Editing** | Spreadsheet tables per equipment type (units in headers, sort, filter, inline edit, multi-select, bulk edit, CSV). A detail panel for the selected element with the same fields. Selecting on the diagram, in a table, or in a message selects everywhere. |
| **One-click operations** | Convert a unit (or a load) to fixed P/Q at a power factor, producing or absorbing; restore voltage regulation; move the reference bus and shrink its Q range; enable or disable anything. |
| **Validation** | Runs on every edit. Plain-language messages tied to an element and field ("Generator 12-1: minimum P (5 MW) must be ≤ maximum P (−6.09 MW)"), blocking errors separate from warnings, a "why?" for each rule, a one-click fix where one is obvious, and "apply to all like this". |
| **Sweeps** | A power-factor sweep (e.g. 0.95 → 0.80, both directions) generates one scenario per step and queues the runs. |
| **Running** | All seven study objectives. A progress view with the iteration log. Failure codes are translated into a message that names the element and field, with a button that opens it. |
| **Results** | Summary cards and totals, bus / generator / branch tables with margins to limits, the diagram colored by a result (voltage vs limits, Q headroom, price, branch loading), a voltage profile with the limit band and bus names, generator Q against its limits. |
| **Comparison** | Any quantity (min / max VM, reference-unit Q, mismatch, losses, price, …) against the swept parameter, with failed runs and limit violations marked, plus the full table. |
| **Exchange** | PSS/E RAW (v26/v30 layout) import and export, lossless round trip; voltage-limit and cost side files; JSON snapshots; CSV and PNG export of every table and chart. |

## Run it

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # RAW round-trip and solver tests
npm run build      # static site in dist/
```

## How it is put together

```
db/schema.sql            the case database (SQLite, Postgres-portable)
src/model/types.ts       one row type per table; element keys ("generator:12-1")
src/model/raw.ts         PSS/E RAW reader/writer + side files       (raw.test.ts: the round-trip test)
src/model/validate.ts    validation rules, messages, suggested fixes
src/model/ops.ts         edits and one-click operations as patches
src/solver/interface.ts  the solver contract: JSON snapshot in, per-element results + status code out
src/solver/codes.ts      status code -> message naming the element and field
src/solver/stub.ts       stand-in solver: dispatch + Newton-Raphson AC power flow (not an OPF)
src/store.ts             the in-browser stand-in for the database: versions, scenarios, sweeps, runs, queue
src/pages/*              Case, Scenarios, Runs, Run, Compare, Data
src/ui/*                 table, diagram, detail panel, charts, export
```

### The solver boundary

The optimization engine is not part of this project. It plugs in behind `Solver` in
[src/solver/interface.ts](src/solver/interface.ts): it receives a self-contained JSON snapshot of one case version
(scenario overrides already applied, physical units) with the objective and settings, and returns per-bus,
per-generator and per-branch results, a summary, an iteration log and a status code. An adapter would translate
that snapshot to the engine's own files. Every run in the app offers its exact input and output as JSON.

The stub behind the interface does an equal-incremental-cost dispatch, a Newton-Raphson AC power flow with Q-limit
switching, and marginal prices from finite-difference loss sensitivities. It is there so the interface can be
exercised end to end with numbers that respond to edits; it is not an optimal power flow.

## Assumptions (open questions)

- **OS V / OS P / OS Q** are shown as shadow prices; unconfirmed.
- **VL / VH** are treated as emergency limits and **VN / VX** as normal limits.
- **Cost 1 / Cost 2** are read as linear and quadratic cost coefficients.
- The **side-file layouts** (voltage limits, costs) and the **error-code table** are placeholders.
- The round-trip test runs on the mock case; it is written so a real v30 file can be dropped in.
