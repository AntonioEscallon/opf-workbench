-- OPF Workbench: the case database. SQLite dialect; types and constraints are chosen to port to Postgres unchanged
-- (swap INTEGER PRIMARY KEY for GENERATED ... AS IDENTITY and TEXT timestamps for timestamptz).
--
-- Rules
--   * Physical units are stored (MW, Mvar, kV, MVA). Per-unit is a display choice: value / case_version.sbase_mva.
--   * Case versions are immutable. Every edit writes a new case_version (parent_id -> the version it came from)
--     and copies the equipment rows; a scenario is a named list of overrides on one base version.
--   * Every run points at exactly one case_version, and optionally the scenario applied on top of it, and stores
--     the hash of the solver input it produced, so any result can be traced to the exact data that made it.
--   * PSS/E RAW is an import/export format only. Fields the model does not edit are kept in raw_extra (verbatim).
--   * Equipment primary keys are (case_version_id, natural PSS/E key), so a row is identified the same way users
--     already identify it: bus 12, generator 12-'1', branch 1-2-'1'.

PRAGMA foreign_keys = ON;

CREATE TABLE "case" (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  layout_json   TEXT NOT NULL DEFAULT '{}',          -- pinned diagram positions {node: {x, y}}; not versioned
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE case_version (
  id            INTEGER PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES "case"(id),
  num           INTEGER NOT NULL,                     -- v1, v2, ... within a case
  parent_id     INTEGER REFERENCES case_version(id),
  note          TEXT NOT NULL,                        -- generated from the edit: "Generator 12-1: P min -6.1 -> -6.0 MW"
  source        TEXT NOT NULL CHECK (source IN ('import', 'edit', 'bulk_edit', 'operation', 'side_file', 'fix')),
  title1        TEXT NOT NULL DEFAULT '',
  title2        TEXT NOT NULL DEFAULT '',
  sbase_mva     REAL NOT NULL DEFAULT 100 CHECK (sbase_mva > 0),
  frequency_hz  REAL NOT NULL DEFAULT 60,
  created_by    TEXT NOT NULL DEFAULT 'local',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, num)
);

CREATE TABLE area (
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  id            INTEGER NOT NULL,
  swing_bus     INTEGER NOT NULL DEFAULT 0,           -- ISW
  pdes_mw       REAL NOT NULL DEFAULT 0,
  ptol_mw       REAL NOT NULL DEFAULT 10,
  name          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (case_version_id, id)
);

CREATE TABLE zone (
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  id            INTEGER NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (case_version_id, id)
);

CREATE TABLE bus (
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  id            INTEGER NOT NULL,                     -- PSS/E I
  name          TEXT NOT NULL DEFAULT '',
  base_kv       REAL NOT NULL CHECK (base_kv >= 0),
  type          INTEGER NOT NULL CHECK (type IN (1, 2, 3, 4)),   -- IDE: 1 PQ, 2 PV, 3 reference, 4 isolated
  area_id       INTEGER NOT NULL DEFAULT 1,
  zone_id       INTEGER NOT NULL DEFAULT 1,
  vm_pu         REAL NOT NULL DEFAULT 1,              -- starting / last solved magnitude
  va_deg        REAL NOT NULL DEFAULT 0,
  owner         INTEGER NOT NULL DEFAULT 1,
  vmin_pu       REAL NOT NULL DEFAULT 0.95,           -- VN, normal
  vmax_pu       REAL NOT NULL DEFAULT 1.05,           -- VX, normal
  vmin_emerg_pu REAL NOT NULL DEFAULT 0.90,           -- VL (assumed emergency; open question)
  vmax_emerg_pu REAL NOT NULL DEFAULT 1.10,           -- VH (assumed emergency; open question)
  PRIMARY KEY (case_version_id, id),
  FOREIGN KEY (case_version_id, area_id) REFERENCES area(case_version_id, id),
  FOREIGN KEY (case_version_id, zone_id) REFERENCES zone(case_version_id, id)
);
-- deliberately no CHECK (vmin <= vmax) etc.: inconsistent data must be storable so validation can explain it.

CREATE TABLE "load" (
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  bus_id        INTEGER NOT NULL,
  id            TEXT NOT NULL,                        -- 1-2 chars
  in_service    INTEGER NOT NULL DEFAULT 1 CHECK (in_service IN (0, 1)),
  area_id       INTEGER NOT NULL DEFAULT 1,
  zone_id       INTEGER NOT NULL DEFAULT 1,
  p_mw          REAL NOT NULL DEFAULT 0,
  q_mvar        REAL NOT NULL DEFAULT 0,
  ip_mw         REAL NOT NULL DEFAULT 0, iq_mvar REAL NOT NULL DEFAULT 0,   -- constant current part
  yp_mw         REAL NOT NULL DEFAULT 0, yq_mvar REAL NOT NULL DEFAULT 0,   -- constant admittance part
  owner         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (case_version_id, bus_id, id),
  FOREIGN KEY (case_version_id, bus_id) REFERENCES bus(case_version_id, id)
);

CREATE TABLE generator (
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  bus_id        INTEGER NOT NULL,
  id            TEXT NOT NULL,
  in_service    INTEGER NOT NULL DEFAULT 1 CHECK (in_service IN (0, 1)),
  p_mw          REAL NOT NULL DEFAULT 0,              -- PG (scheduled)
  q_mvar        REAL NOT NULL DEFAULT 0,              -- QG
  pmax_mw       REAL NOT NULL DEFAULT 9999,           -- PT  (UI: PX)
  pmin_mw       REAL NOT NULL DEFAULT -9999,          -- PB  (UI: PN)
  qmax_mvar     REAL NOT NULL DEFAULT 9999,           -- QT  (UI: QX)
  qmin_mvar     REAL NOT NULL DEFAULT -9999,          -- QB  (UI: QN)
  vset_pu       REAL NOT NULL DEFAULT 1,              -- VS
  reg_bus_id    INTEGER NOT NULL DEFAULT 0,           -- IREG, 0 = own terminal
  mbase_mva     REAL NOT NULL DEFAULT 100,
  cost1         REAL NOT NULL DEFAULT 0,              -- $/MWh   (side file; assumed linear term)
  cost2         REAL NOT NULL DEFAULT 0,              -- $/MWh^2 (side file; assumed quadratic term)
  raw_extra     TEXT NOT NULL DEFAULT '{}',           -- ZR, ZX, RT, XT, GTAP, RMPCT, O1, F1 (round-trip only)
  PRIMARY KEY (case_version_id, bus_id, id),
  FOREIGN KEY (case_version_id, bus_id) REFERENCES bus(case_version_id, id)
);

CREATE TABLE branch (                                 -- AC line
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  from_bus_id   INTEGER NOT NULL,
  to_bus_id     INTEGER NOT NULL,
  ckt           TEXT NOT NULL,
  in_service    INTEGER NOT NULL DEFAULT 1 CHECK (in_service IN (0, 1)),
  r_pu          REAL NOT NULL, x_pu REAL NOT NULL, b_pu REAL NOT NULL DEFAULT 0,   -- on the system MVA base
  rate_a_mva    REAL NOT NULL DEFAULT 0,              -- normal
  rate_b_mva    REAL NOT NULL DEFAULT 0,              -- emergency
  rate_c_mva    REAL NOT NULL DEFAULT 0,              -- short-term
  length        REAL NOT NULL DEFAULT 0,
  raw_extra     TEXT NOT NULL DEFAULT '{}',           -- GI, BI, GJ, BJ, O1, F1
  PRIMARY KEY (case_version_id, from_bus_id, to_bus_id, ckt),
  FOREIGN KEY (case_version_id, from_bus_id) REFERENCES bus(case_version_id, id),
  FOREIGN KEY (case_version_id, to_bus_id) REFERENCES bus(case_version_id, id)
);

CREATE TABLE transformer (                            -- two-winding (k_bus_id = 0) and three-winding
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  i_bus_id      INTEGER NOT NULL,
  j_bus_id      INTEGER NOT NULL,
  k_bus_id      INTEGER NOT NULL DEFAULT 0,
  ckt           TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  in_service    INTEGER NOT NULL DEFAULT 1,
  r12_pu REAL NOT NULL DEFAULT 0, x12_pu REAL NOT NULL, sbase12_mva REAL NOT NULL DEFAULT 100,
  r23_pu REAL, x23_pu REAL, sbase23_mva REAL,          -- three-winding only
  r31_pu REAL, x31_pu REAL, sbase31_mva REAL,
  star_vm_pu    REAL, star_va_deg REAL,               -- the star point (shown on the diagram)
  raw_extra     TEXT NOT NULL DEFAULT '{}',           -- CW, CZ, CM, MAG1, MAG2, NMETR, O1, F1
  PRIMARY KEY (case_version_id, i_bus_id, j_bus_id, k_bus_id, ckt)
);

CREATE TABLE transformer_winding (
  case_version_id INTEGER NOT NULL,
  i_bus_id INTEGER NOT NULL, j_bus_id INTEGER NOT NULL, k_bus_id INTEGER NOT NULL, ckt TEXT NOT NULL,
  winding       INTEGER NOT NULL CHECK (winding IN (1, 2, 3)),
  ratio         REAL NOT NULL DEFAULT 1,              -- WINDV
  nominal_kv    REAL NOT NULL DEFAULT 0,              -- NOMV
  angle_deg     REAL NOT NULL DEFAULT 0,
  rate_a_mva REAL NOT NULL DEFAULT 0, rate_b_mva REAL NOT NULL DEFAULT 0, rate_c_mva REAL NOT NULL DEFAULT 0,
  raw_extra     TEXT NOT NULL DEFAULT '{}',           -- COD, CONT, RMA, RMI, VMA, VMI, NTP, TAB, CR, CX
  PRIMARY KEY (case_version_id, i_bus_id, j_bus_id, k_bus_id, ckt, winding),
  FOREIGN KEY (case_version_id, i_bus_id, j_bus_id, k_bus_id, ckt)
    REFERENCES transformer(case_version_id, i_bus_id, j_bus_id, k_bus_id, ckt)
);

CREATE TABLE shunt (                                  -- fixed shunts (RAW v30: GL/BL on the bus record)
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  bus_id        INTEGER NOT NULL,
  id            TEXT NOT NULL,
  in_service    INTEGER NOT NULL DEFAULT 1,
  g_mw          REAL NOT NULL DEFAULT 0,              -- at 1 pu voltage
  b_mvar        REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (case_version_id, bus_id, id),
  FOREIGN KEY (case_version_id, bus_id) REFERENCES bus(case_version_id, id)
);

CREATE TABLE raw_section (                            -- RAW sections not modelled (DC, FACTS, ...), verbatim
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  section       TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  text          TEXT NOT NULL,
  PRIMARY KEY (case_version_id, section, line_no)
);

-- ------------------------------------------------------------------------------------ scenarios and sweeps

CREATE TABLE sweep (
  id            INTEGER PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES "case"(id),
  name          TEXT NOT NULL,
  element_key   TEXT NOT NULL,                        -- e.g. 'generator:8-1'
  parameter     TEXT NOT NULL,                        -- e.g. 'power_factor'
  spec_json     TEXT NOT NULL,                        -- {from, to, step, directions: ['producing','absorbing']}
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE scenario (
  id            INTEGER PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES "case"(id),
  num           INTEGER NOT NULL,
  name          TEXT NOT NULL,
  base_version_id INTEGER NOT NULL REFERENCES case_version(id),
  sweep_id      INTEGER REFERENCES sweep(id),
  sweep_value   REAL,                                 -- signed parameter value (e.g. pf, negative = absorbing)
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, num)
);

CREATE TABLE scenario_override (                      -- one field of one element, on top of the base version
  scenario_id   INTEGER NOT NULL REFERENCES scenario(id),
  element_key   TEXT NOT NULL,                        -- 'generator:12-1'
  field         TEXT NOT NULL,                        -- 'qmin'
  value_json    TEXT NOT NULL,                        -- JSON so numbers, text and status share one column
  PRIMARY KEY (scenario_id, element_key, field)
);

-- ------------------------------------------------------------------------------------ runs and results

CREATE TABLE run (
  id            INTEGER PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES "case"(id),
  num           INTEGER NOT NULL,
  case_version_id INTEGER NOT NULL REFERENCES case_version(id),
  scenario_id   INTEGER REFERENCES scenario(id),
  objective     TEXT NOT NULL CHECK (objective IN ('economic_dispatch', 'max_q_reserve', 'manage_voltage',
                  'min_generation', 'transfer_limit', 'max_loadability', 'custom')),
  settings_json TEXT NOT NULL DEFAULT '{}',           -- tolerance, max iterations, Q-limit enforcement, ...
  input_hash    TEXT NOT NULL,                        -- hash of the solver input snapshot
  solver        TEXT NOT NULL,                        -- solver name + version
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'optimal', 'limits_violated', 'failed')),
  error_code    INTEGER,
  error_message TEXT,                                 -- translated, names the element where possible
  error_element TEXT,                                 -- element_key
  error_field   TEXT,
  log           TEXT NOT NULL DEFAULT '',             -- iteration log
  queued_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at    TEXT,
  finished_at   TEXT,
  UNIQUE (case_id, num)
);

CREATE TABLE run_summary (
  run_id        INTEGER PRIMARY KEY REFERENCES run(id),
  objective_value REAL,
  mismatch_pu   REAL,                                 -- root of sum of squared P and Q bus mismatches
  iterations    INTEGER,
  gen_p_mw REAL, gen_q_mvar REAL, load_p_mw REAL, load_q_mvar REAL,
  loss_p_mw REAL, loss_q_mvar REAL, shunt_q_mvar REAL,
  gen_cost      REAL, gen_revenue REAL, load_charge REAL, surplus REAL,
  min_vm_pu REAL, min_vm_bus INTEGER, max_vm_pu REAL, max_vm_bus INTEGER,
  worst_constraint TEXT, worst_margin REAL,
  loadability   REAL                                  -- load multiplier (loadability / transfer objectives)
);

CREATE TABLE run_result_bus (
  run_id INTEGER NOT NULL REFERENCES run(id), bus_id INTEGER NOT NULL,
  vm_pu REAL NOT NULL, va_deg REAL NOT NULL,
  vmin_pu REAL NOT NULL, vmax_pu REAL NOT NULL, margin_pu REAL NOT NULL,   -- distance to the nearer limit (< 0 = violated)
  os_v REAL, os_p REAL, os_q REAL,                    -- assumed shadow prices (open question)
  price         REAL,                                 -- $/MWh
  PRIMARY KEY (run_id, bus_id)
);

CREATE TABLE run_result_generator (
  run_id INTEGER NOT NULL REFERENCES run(id), bus_id INTEGER NOT NULL, id TEXT NOT NULL,
  p_mw REAL NOT NULL, q_mvar REAL NOT NULL,
  pmin_mw REAL, pmax_mw REAL, qmin_mvar REAL, qmax_mvar REAL,
  q_headroom_mvar REAL,                               -- distance to the nearer Q limit
  os_p REAL, os_q REAL, cost REAL, revenue REAL, profit REAL,
  PRIMARY KEY (run_id, bus_id, id)
);

CREATE TABLE run_result_branch (
  run_id INTEGER NOT NULL REFERENCES run(id),
  element_key   TEXT NOT NULL,                        -- branch or transformer (winding legs as '...#w1')
  p_from_mw REAL, q_from_mvar REAL, p_to_mw REAL, q_to_mvar REAL,
  loss_mw REAL, loading_pct REAL,                     -- of Rate A
  PRIMARY KEY (run_id, element_key)
);

CREATE INDEX run_by_version ON run(case_version_id);
CREATE INDEX run_by_scenario ON run(scenario_id);
CREATE INDEX scenario_by_sweep ON scenario(sweep_id);
