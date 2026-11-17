# dsh-zentao

**English** · [简体中文](README.md)

A ZenTao panel for DSH: read the requirements, tasks and bugs assigned to you in **ZenTao**, pick a workspace, type a branch name, and dispatch the item to an agent.

This package is the ZenTao half of [dsh-task-hub](https://github.com/handsomeboy65/dsh-task-hub) (TAPD + ZenTao in one panel). The split removes every TAPD surface — client, credentials, project picker, source switcher — and moves the data directory to `~/.dsh/zentao/`.

## What moved, what stayed

| Kept | Why |
| --- | --- |
| `lib/zentao.js` | The REST client. Still the single source of truth for the API; now also speaks API v2 and lists product bugs |
| `lib/work.js` | Single-source adapter (the ZenTao branch of the old `sources.js`): uid, error codes, completed filtering |
| `lib/index.js` | Host half: `/api/zentao/*` routes, credential resolution, dispatch orchestration |
| `lib/client.js` | Client half: board, search, filters, settings and dispatch dialogs (TAPD section and source switcher removed) |
| `lib/dispatch.js`, `checkout.js`, `drafts.js`, `prompt.js`, `store.js` | Source-agnostic dispatch core, with the TAPD branches and wording dropped |

| Removed | Why |
| --- | --- |
| `lib/tapd.js` | TAPD open-platform client (token/Basic auth, custom fields, screenshots) |
| Source switcher / "all sources" | One source left, so no merged columns or per-source errors |
| TAPD project picker, `nick` / `owner` fields | ZenTao selects containers (product / project / execution) and knows the account |
| `market-entry/` | A marketplace entry needs a published repository URL; add it once this package is pushed |

## What the split also fixed

1. **API v2 (opt-in).** ZenTao ≥ 21.7.8 exposes `/api.php/v2` (`POST /users/login`, requirement types split into `stories` / `requirements` / `epics`). Settings offer `v1` (default), `v2`, and `auto`, which probes v2 once per site and falls back to v1. **Caveat:** the v2 path is implemented from the official endpoint reference and covered by a fake server only — it has not been verified against a live instance. Switch back to `v1` if v2 returns nothing.
2. **Bug scope.** "Read from" gained 产品缺陷, which uses `/products/{id}/bugs` and keeps severity (P1–P4), resolution, and the `bug-view-{id}.html` link. After 提测, bugs are what a developer actually gets handed.
3. **Settings and history migration.** On first read the plugin imports the ZenTao settings and the `zentao:*` dispatch records from `~/.dsh/task-hub/` (TAPD records stay behind), so an existing user keeps both their configuration and their "which item went to which session" history.

Attachments still download through v1 (`/files/{id}` and the `file-read-*` web routes): the v2 reference documents no binary endpoint.

## Install

```sh
dsh plugin --profile web add github:<your-account>/dsh-zentao
```

Restart `dsh web` afterwards; a 「禅道」 entry appears in the sidebar. On desktop, install from **Settings → Plugins**.

Requires DSH 0.2.1 or newer.

## First configuration

Open 「设置」 in the panel:

| Field | Meaning |
| --- | --- |
| ZenTao URL | e.g. `https://zentao.example.com`; `/api.php/v1` or `/api.php/v2` is appended |
| Basic Auth | Enable when a gateway (Apache/Nginx) adds its own HTTP auth; fill the gateway credentials |
| API version | `v1` (default), `v2` (ZenTao 21.7.8+), or `auto` |
| Account / password | ZenTao login; the password only goes to DSH credentials (`ZENTAO_PASSWORD` also works) |
| Read from | 产品需求 (dev/user/business requirements), 项目任务 (tasks under each execution), 产品缺陷 (bugs) |
| Products / projects | Load the list and tick items, or type comma-separated ids |

ZenTao has no generic "assigned to me" endpoint (v2 exposes `assignedtome` per collection), so the plugin signs in, resolves the account, and filters locally. With 产品 + "include completed" it also pulls the history back.

## Dispatch

1. The panel lists items where 处理人 = me, newest first, filtered by 未完成 / 已完成 / 全部, by container, and searchable by id, parent id or title.
2. Pick one and press 「派发 Agent」.
3. Linked items can continue the original conversation or open a new one. A first dispatch asks for the workspace, the **branch name** (full name, validated with `git check-ref-format`), worktree and base branch.
4. The plugin then creates or reuses a worktree, sets up the workspace and session, writes the title, source link, full body, references and environment into the session's **composer draft** (downloading images and attachments from the ZenTao body), renames the session to `<branch> · <title>`, and jumps there.
   **Nothing is sent for you**: review the draft and press send yourself.

## Data and failure modes

- Settings live in `~/.dsh/zentao/settings.json`, dispatch records in `~/.dsh/zentao/state.json`.
- Records are keyed `zentao:<item id>` (e.g. `zentao:task-31`), so requirements, tasks and bugs never collide.
- In-place dispatch keeps local changes by default (Smart Checkout); turning it off requires a clean tree. A worktree parked on another branch is reported as a conflict, never force-switched.
- Branch and session state refresh every minute; a temporary host lookup failure shows 「状态暂不可用」, and an interrupted draft can be retried on the same session.

## Development

```bash
npm test     # pure helpers, v1/v2 client, git flows, dispatch, host routes, client rendering
```

An installed bundle needs a DSH restart to load the new JS generation.

## Limitations

- Read-only: no status changes or comments back into ZenTao (v2 already has `tasks/{id}/start|finish` and `bugs/{id}/resolve`, an obvious next step).
- The assignee filter runs locally, so request volume grows with the number of selected products or executions.
- Asset limits: 6 MB per image, 20 MB total.
- The plugin does not plan the work; the dispatched agent does.
