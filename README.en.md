# dsh-zentao

**English** · [简体中文](README.md)

A ZenTao panel for DSH: read the requirements, tasks and bugs assigned to you, pick a workspace, type a branch name, dispatch the item to an agent — and write the outcome back into ZenTao.

This package is the ZenTao half of [dsh-task-hub](https://github.com/handsomeboy65/dsh-task-hub) (TAPD + ZenTao in one panel), with four capabilities added on top of the split: **switchable data channels (including the official zentao-cli)**, **地盘 ("my work") + a sidebar badge**, **a bug triage matrix**, and **state write-back**.

## The four capabilities

### 1. Data channels: v1 / v2 / auto / zentao-cli

| Channel | Reads | Writes | Notes |
| --- | --- | --- | --- |
| `v1` | product/project enumeration | ✗ | What the split started from; most conservative |
| `v2` | server-side `/my/*` | ✓ | `/my/*` needs ZenTao 22.5+, transitions need 22.0+ |
| `auto` | probe v2, fall back to v1 | ✓ when v2 wins | Survives an instance upgrade without reconfiguring |
| `cli` | `zentao my tasks/bugs/stories` | ✓ | Delegates auth, paging and version gates to [zentao-cli](https://github.com/easysoft/zentao-cli) |

The `cli` channel takes a command line (default `zentao`, and `npx zentao-cli@0.4.4`-style forms work too); the plugin stops storing a ZenTao password, reads site and account from `zentao auth status`, and still builds correct item links.

**Why switch to cli:** the v1 approach enumerates every product/project and filters the assignee locally, so request volume grows with container count, while `my` is filtered server-side. The write endpoints, the `E2010` version check and the "re-read after writing" rule are already implemented there.

### 2. 地盘 ("my work") + a sidebar badge

- When the channel supports `/my/*`, the panel reads "assigned to me" directly and stops asking for products/projects (v1 degrades to enumeration; ZenTao below 22.5 falls back automatically).
- The sidebar icon carries a badge with the open-item count. DSH's `sidebar.panellist` only hands icons `{ size, active }` — there is **no badge API** — so the plugin draws it: the registration passes `inject: () => ({ hooks: { badge } })` with an internal observable, the renderer turns that into a `useBadge(selector)` prop, and the icon positions a bubble over its glyph. The count comes from a cheap `/api/zentao/counts` poll (counts only, never the list), refreshed immediately on `connection/reset`.

Known trade-offs: the same icon is reused inside the collapsed sidebar's "More" menu, so the badge appears there too, and the icon sits under `aria-hidden`, so the badge is not announced by screen readers.

### 3. Bug triage matrix

With "read from = product bugs" the panel gains a **severity × status** matrix (P1–P4 / none × open / resolved / closed). Each cell lists up to four items and shows `+N`; clicking an item opens the dispatch dialog with "reproduce first, confirm the root cause, then change code" prefilled. Items whose status or severity falls outside the axes stay reachable instead of disappearing.

After 提测, bugs are what a developer actually gets handed — and "which P1 is still open" takes 40 cards to answer on a board, one glance on a matrix.

### 4. Write-back: dispatching means starting

After a successful dispatch of a task that is still 未开始, the panel opens the write-back dialog and turns the dispatch into a state transition:

```
PUT /tasks/31/start   { realStarted: "2026-11-17 10:00:00", comment: "dispatched to a DSH session on feature/x" }
```

or through the CLI: `zentao task start --task-id=31 --real-started=... --comment=...`.

The dialog shows **the exact request or command first** and only sends after you confirm. Bug cards get a 「解决」 action with a `resolution` choice (fixed / notrepro / bydesign / duplicate / external / postponed / willnotfix / tostory) plus a note. After executing, the item is re-read and the state ZenTao actually stored is reported; if the re-read fails, the plugin says it could not verify instead of claiming success.

## One API limitation worth stating

ZenTao API 2.0's 239 paths contain **no standalone "add comment" endpoint** — `comment` only rides on a state transition (`start` / `finish` / `close` / `resolve` / `activate`). So "write a note back" is always also a state change; for a dispatch that is exactly `start`, which is semantically right. See [docs/zentao-api-notes.md](docs/zentao-api-notes.md): every endpoint, method and required field there was read out of the `zentao-api` SDK's machine-readable definitions, not guessed.

## Install

```sh
dsh plugin --profile web add github:SivanCola/dsh-zentao
```

> **Install name warning:** an unrelated npm package is also called `dsh-zentao` — it declares no repository and is not this project. This plugin installs from GitHub only, so use the command above and not `dsh plugin add dsh-zentao`.

Restart `dsh web` afterwards; a 「禅道」 entry appears in the sidebar. On desktop, install from **Settings → Plugins**. Requires DSH 0.2.1+. The `cli` channel additionally needs `npm i -g zentao-cli` (0.4.4+ recommended) and a prior `zentao auth login`.

## First configuration

Open 「设置」 in the panel:

| Field | Meaning |
| --- | --- |
| Data channel | `v1` / `v2` / `Auto` / `zentao-cli` |
| ZenTao URL | e.g. `https://zentao.example.com`; `/api.php/v1` or `/v2` is appended (optional for the cli channel) |
| Basic Auth | Enable when a gateway adds its own HTTP auth |
| Account / password | Required for REST channels; the password only goes to DSH credentials (`ZENTAO_PASSWORD` also works) |
| Read from | 产品需求 (dev/user/business requirements), 项目任务 (tasks), 产品缺陷 (bugs) |
| Prefer 地盘 (`/my/*`) | On by default where supported; off returns to container enumeration |
| Products / projects | Load and tick, or type ids (not needed on the cli channel) |

## Dispatch

1. The panel lists items where 处理人 = me, newest first, filtered by 未完成 / 已完成 / 全部, by container, and searchable by id, parent id or title.
2. Pick one, then continue the original conversation or open a new one. A first dispatch asks for the workspace, the **branch name** (validated with `git check-ref-format`), worktree and base branch.
3. The plugin creates or reuses a worktree, sets up the workspace and session, writes the title, source link, full body, references and environment into the session's **composer draft** (downloading images and attachments from the body), renames the session to `<branch> · <title>`, and jumps there. **Nothing is sent for you.**
4. If the item is a task still 未开始, the write-back dialog follows immediately so the plan can mark it 进行中 and record which dispatch started it.

## Data and failure modes

- Settings live in `~/.dsh/zentao/settings.json`, dispatch records in `~/.dsh/zentao/state.json` (keyed `zentao:<item id>`).
- First run imports the ZenTao settings and `zentao:*` records from `~/.dsh/task-hub/`; TAPD records stay behind.
- Write-back is a real, irreversible change: planning and execution are two separate calls, the plan is shown first, and the note is capped at 500 characters.
- The `cli` channel has no binary download (v2 documents no attachment endpoint either), so without REST credentials the draft says the attachments were not carried — nothing is dropped silently.
- Old `zentao-cli` builds (≤0.4.1) parse flags differently; the adapter reports `E2009` as "CLI too old" with an upgrade command instead of a confusing argument error.

## Development

```bash
npm test     # 92 tests: pure helpers, the three read channels, write planning/execution, git flows, host routes, client rendering and the badge
```

An installed bundle needs a DSH restart to load the new JS generation.

## Limitations

- Write-back covers 开始 / 解决 / 关闭 only; no field editing, and `consumed` is passed through but has no UI yet.
- The cli channel's 地盘 needs ZenTao 22.5+; below that it reports `E2010`.
- Assignee filtering is still local on v1, so request volume grows with the number of containers.
- Asset limits: 6 MB per image, 20 MB total.
- The plugin does not plan the work; the dispatched agent does.
