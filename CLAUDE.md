# PulseOS — Shared Engineering Context (CLAUDE.md)

Standing context for the lead and all specialist teammates. Repository-wide rules only; role-specific detail lives in `.claude/agents/*.md`. Team operating model: `docs/pulseos-team-operating-model.md`. Agent-teams mechanics: `docs/agent-teams-reference.md`.

> **Verify before asserting.** Everything below was checked against the code on 2026-07-15, but the codebase moves. Confirm file/line/table claims against current code before relying on them. Do not add uncertain or proposed rules here as established fact.

---

## PulseOS Overview

PulseOS is a **multi-company ERP** for furniture, home-living, retail, warehouse, delivery, service, purchasing, inventory, commission, finance, and AI-assisted operations. It serves our own companies first and is intended to become a reusable commercial ERP product for other businesses.

Companies are **data, not code** — stored as rows (organizations / `company_id`), not hard-coded branches. Current companies include:

- Vhaus Living Sdn Bhd
- Vhaus Living (PG) Sdn Bhd
- UGL Trading (M) Sdn Bhd
- Fontera Living Sdn Bhd

**Never hard-code behavior around one company** unless the requirement is explicitly company-specific. Company/branch differences belong in configuration and data, never in `if (company === 'Vhaus')` branches.

---

## Repository Layout (READ FIRST — prevents the most common mistake)

PulseOS is **two separate repositories**. Confirm which one you are editing before you touch a file.

| Repo | Path | Role | Contains |
| :-- | :-- | :-- | :-- |
| **vhaus-delivery** | `C:\Users\austi\OneDrive\Desktop\VhausSYS\vhaus-delivery` (this repo) | **Frontend** | React app: `src/*.js` pages/components, `public/`, `build/`. **No backend here.** |
| **vhaus-bot** | `C:\Users\austi\OneDrive\Desktop\VhausSYS\vhaus-bot` | **Backend + DB** | `server.js` (~555 KB Express), `lib/`, `migrations/`, `permission-engine.js`, `module-registry.js`, service files, `scripts/` |

Consequences:
- **Backend, database, and migration work happens in `vhaus-bot`**, not here. The Backend Lead and Database Architect operate primarily in that repo.
- **Frontend work happens in `vhaus-delivery`** (this repo). The Frontend UX Lead operates here.
- The frontend calls the backend via `REACT_APP_BOT_API` (default `https://vhaus-bot-production.up.railway.app`) — see `src/App.js`.
- When spawning teammates, **set each one's working repo explicitly** and never let a backend teammate try to edit files under `src/`, or a frontend teammate edit `server.js`.

---

## Technology Stack (verified)

**Frontend — `vhaus-delivery`**
- React (Create React App / `react-scripts`), TailwindCSS, `@supabase/supabase-js`, `jsqr`.
- Scripts: `npm start`, `npm run build` (`CI=true npm run build` for a clean CI build), `npm test`.
- Deploy: **Vercel**.

**Backend — `vhaus-bot`** (package name `vhaus-telegram-bot`)
- Node.js + Express (`node server.js`). Deps: `@supabase/supabase-js`, `express`, `cors`, `compression`, `multer`, `openai` (OCR/AI), `pdf-lib`, `pdf-parse`, `xlsx`, `axios`, `dotenv`.
- Integrations: Telegram bot, OCR/AI (OpenAI), supplier DO OCR, Excel/PDF handling.
- Deploy: **Railway** (`vhaus-bot-production.up.railway.app`).

**Database**
- **PostgreSQL via Supabase** (accessed through `@supabase/supabase-js` in both repos; migrations in `vhaus-bot/migrations/`).

Do not document or assume stack elements not present in the repos.

---

## Source of Truth

- **`sales_orders` is the intended source of truth for sales orders.** The backend writes `sales_orders` and syncs one-way into the legacy `orders` table via `syncSalesOrderToDelivery(order, items)` (`vhaus-bot/server.js`).
- **The legacy `orders` table still exists and is actively used** — it is the "workhorse" row for delivery scheduling, Telegram replies, and DO matching (far more read sites than `sales_orders`). It is **not** dead code. Do **not** remove it or its null-safe handling without a verified migration plan.
- **Sync is one-way only: `sales_orders → orders`.** **Never build reverse sync** (`orders → sales_orders`). When a legacy writer needs to change behavior, rewrite the writer to go through `sales_orders`; do not add reverse sync.
- **Shared column/select definitions must use `vhaus-bot/lib/selects.js`.** Its own rules: list only columns a traced consumer reads; keep a deliberate `*` where consumers aren't fully traced (don't "clean up" a `*` blindly); never remove a column without grepping **both** `vhaus-delivery/src` **and** `vhaus-bot/server.js`. After schema/select changes, run `node scripts/test-selects.js` in `vhaus-bot`.
- **Do not duplicate business rules** across create, update, conversion, import, OCR, Telegram, or service flows. **When one business rule changes, search every creation and update path** that may apply it and change them together (the backend is authoritative — some rules are enforced server-side precisely so all entry points share them).

---

## Multi-Company and Branch Rules

Every applicable business record must preserve the correct `company_id`, `branch_id`, ownership, visibility, and permissions.

**Never:**
- default silently to an arbitrary company or branch;
- expose or mutate records across companies;
- trust frontend filtering as authorization (the frontend filters for UX; the **backend authorizes**);
- hard-code company or branch IDs;
- remove null-safe handling for legacy records without a migration plan.

Roles (Company Admin, Branch Manager, Salesman, Finance, Operations, Warehouse, and others) may access **only** the data the current authorization model permits. Authorization is enforced via the backend `permission-engine` / scopes — align new access checks with it rather than inventing new ones.

---

## Architecture Rules

- Follow the existing repository structure before introducing new architecture.
- Reuse existing helpers, services, selectors, components, and conventions before adding new ones.
- Do not create duplicate endpoints for the same responsibility; do not duplicate business logic across routes.
- Keep database access and business rules centralized where practical (e.g. `lib/` helpers, shared services).
- Maintain backward compatibility unless a breaking change is explicitly approved.
- Prefer targeted changes over broad rewrites.
- Do not rename tables, columns, endpoints, or core concepts without impact analysis across both repos.
- Never delete legacy compatibility code until its usage and data are verified.

---

## Agent Ownership (summary — full definitions in `.claude/agents/`)

| Agent | Owns (repo) | Must not |
| :-- | :-- | :-- |
| **Lead / PM** (the lead session) | Analysis, task breakdown, assignment, dependency coordination, conflict resolution, review, final report | Write substantial implementation code when delegation is appropriate |
| **Backend Lead** (`pulseos-backend-lead`) | `vhaus-bot`: server, APIs, services, integrations, auth, OCR/Telegram/WhatsApp/AI, background jobs | Redesign frontend UI |
| **Database Architect** (`pulseos-database-architect`) | `vhaus-bot`: migrations, schema, indexes, constraints, views, data integrity, query perf, safe prod changes | Ship schema without rollback + legacy-data plan |
| **Frontend UX Lead** (`pulseos-frontend-ux-lead`) | `vhaus-delivery`: React UI, components, dashboards, forms, tables, loading/empty/error states, print templates | Change API or DB contracts independently |
| **ERP Domain Expert & QA** (`pulseos-erp-domain-qa`) | Requirement validation, ERP workflow design, business-rule review, edge cases, regression, permission validation, release sign-off | Assume the requested workflow is correct |

---

## Cross-Agent Communication (explicit handoffs)

- **ERP Domain Expert** → confirms workflow and acceptance criteria (before implementation).
- **Database Architect** → communicates finalized schema + migration contract to Backend Lead.
- **Backend Lead** → communicates API contract + payload shape to Frontend Lead.
- **Frontend Lead** → communicates completed workflow to ERP Domain Expert for validation.
- **ERP Domain Expert** → reports defects and release risks to the Lead.
- **Lead** → resolves conflicts and gives final approval.

Agents must **not wait indefinitely** on a teammate. Continue independent work where possible and clearly report blockers.

---

## Database and Migration Rules (`vhaus-bot/migrations/`)

For every database change:
- inspect existing schema and migrations first;
- follow the established naming/ordering convention: `NNN_snake_case_description.sql`, zero-padded 3-digit prefix (note: **duplicate numeric prefixes already exist** — e.g. two `013_`, `023_`, `024_`, `025_` files — so the number is rough ordering, not a unique key; pick the next number and a distinct description);
- account for existing production and legacy data;
- avoid destructive changes without an approved migration path;
- define constraints carefully; add indexes **only** where query patterns justify them;
- consider nullable legacy fields;
- **confirm foreign-key data types match exactly** — watch PostgreSQL `BIGINT` vs JavaScript number precision and string serialization (a known gotcha here);
- ensure company and branch isolation;
- provide verification queries and rollback guidance where useful;
- a migration must be applied **before** deploying code that depends on it.

**Never edit historical migrations that may already have run in production** unless explicitly instructed.

---

## Backend Rules (`vhaus-bot`)

- Validate input at the server; never rely on frontend validation for data integrity.
- Enforce authorization **server-side** on every route (via `permission-engine` / scopes).
- Use transactions for multi-step operations that must succeed atomically.
- Prevent duplicate records and race conditions.
- Preserve idempotency for imports, webhooks, OCR, supplier DO processing, and external callbacks.
- Return structured, useful errors.
- Avoid N+1 queries; select only required columns (via `lib/selects.js`).
- Preserve null-safe behavior for legacy `orders` data.
- When changing a shared business rule, review **all** create / update / conversion / import / sync / OCR / Telegram / service paths that apply it.
- Never modify frontend code from the backend repo.

---

## Frontend Rules (`vhaus-delivery`)

PulseOS is an operational ERP, not a marketing website. Prioritize:
- clarity, speed, visibility, minimal clicks, consistent layout;
- useful loading, empty, and error states;
- desktop-first operational workflows (responsive where required);
- print-friendly documents (quotations, SOs, POs, delivery/invoice docs);
- shared components (reuse `src/UIComponents.js` and existing pages before building new patterns);
- clear permission-based actions.

Do **not** hide operationally important information behind unnecessary View buttons or modal layers. Do **not** redesign branding unless explicitly requested. Wait for the Backend Lead's API contract before wiring data; never change backend or DB contracts from here.

---

## ERP Business Rules (confirmed in code — verify before relying)

- **E-Invoice threshold: RM 10,000.** When an order's e-invoice total exceeds `10000` and status is `confirmed`/`delivered`, the customer must have `customer_id_no` and `customer_email`; enforced server-side (`vhaus-bot/server.js` ~10026 / 10170 / 10249). The backend is the source of truth for this rule.
- **Singapore commission on GST-exclusive amount.** SG orders carry 9% GST inside `order_amount`; commission is computed on `order_amount / 1.09`. Detection: `order.country === 'SG'` (populated from `sales_orders.country` by `syncSalesOrderToDelivery`), falling back to whole-word "singapore" in the address for legacy rows. See `vhaus-bot/lib/commission.js`.
- **GST on full subtotal.** GST is charged on the full subtotal; discount is applied **after** tax (recent change — confirm current behavior in code).
- **Delivery route locking.** A route is hard-locked once its status is **Out for Delivery** or **Delivered** — only status updates are allowed thereafter. A route can be marked *Out for Delivery* only on its delivery date. A **Confirmed** route must be unlocked back to *Pending* before editing. See `vhaus-bot/server.js` ~2544–2577.
- **One-way sales-order sync.** `sales_orders → orders` via `syncSalesOrderToDelivery`; no reverse sync (see Source of Truth).

**Not located in code (do NOT treat as implemented — confirm or omit):** "Bryan override" rules and explicit "split salesmen" logic were searched for and **not found** in `vhaus-bot`. Treat these as pending decisions, not facts. Also verify against current code before documenting as established: item arrival / ready-to-deliver status, warranty & exchange legs, payments & outstanding balances, order deletion & financial-report exclusion, and service-leg ↔ route ↔ delivery-date ↔ status synchronization.

---

## Testing Requirements

Before considering a feature complete:
- run relevant automated checks and syntax/type checks (backend: `node --check server.js` + relevant `scripts/test-*.js`; frontend: `CI=true npm run build`);
- test the primary success path and validation failures;
- test permissions and multi-company isolation;
- test legacy and null-data behavior;
- test related-module regressions;
- test desktop UI behavior and print output where relevant;
- verify migrations against existing data assumptions.

For **financial, commission, inventory, delivery, and service** changes, the **ERP Domain Expert must provide explicit regression scenarios**. Never claim tests passed unless they were actually run.

---

## Working Procedure

For substantial requests:
1. Inspect the relevant code and documentation.
2. Summarize existing behavior.
3. Identify affected modules and risks.
4. Ask the ERP Domain Expert to validate the workflow.
5. Create a task plan with clear ownership.
6. Spawn only the specialists actually needed.
7. Partition file ownership to avoid collisions (`src/` = frontend; `server.js`/`lib/` = backend; `migrations/` = DB; `scripts/` = tests).
8. Require plan approval before destructive or high-risk database changes.
9. Implement and test.
10. Have the ERP Domain Expert perform final validation.
11. Have the Lead review the combined result.
12. Report exactly what changed, what was tested, remaining risks, and follow-up work.

For small, isolated tasks, avoid unnecessary team spawning.

---

## Safety Rules

- Do not run destructive database operations without explicit approval.
- Do not expose secrets or commit environment files.
- Do not weaken authorization to make a feature work.
- Do not silently modify production configuration.
- Do not claim tests passed unless they were actually run.
- Do not claim a migration is safe without inspecting existing data assumptions.
- Do not overwrite unrelated user changes.
- Stop and report unexpected repository changes before proceeding.

---

## Required Completion Report (end of substantial work)

Provide: **Summary · Existing behavior discovered · Agent assignments · Files changed · Database changes · API changes · UI changes · Business-rule changes · Tests actually run · Test results · Known risks · Manual verification steps · Recommended next action.**
