/**
 * Client half of the ZenTao task view.
 *
 * Registers a sidebar icon plus a `main` panel (`key: 'zentao'`) that lists the
 * requirements, tasks and bugs ZenTao assigned to the configured account, then
 * dispatches an agent by POSTing to the host routes this bundle registers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-zentao-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * The sidebar icon only receives `{ size, active }` (no badge prop exists),
     * so the count lives in a tiny observable this module owns. The icon
     * registration injects it as `hooks`, which the renderer turns into a
     * `useBadge(selector)` prop — that is the supported way to feed a badge.
     */
    function observable(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set: (next) => {
          if (next === value) return
          value = next
          for (const listener of listeners) listener()
        },
      }
    }

    const badgeStore = observable({ open: 0, byKind: { task: 0, bug: 0, story: 0 } })
    // 'v1' means counting costs a full enumeration, so only the open panel
    // refreshes it; every other channel is server-filtered and cheap.
    const badgeChannel = { value: '' }

    function countItems(items) {
      const byKind = { task: 0, bug: 0, story: 0 }
      let open = 0
      for (const item of items ?? []) {
        if (item.completed) continue
        open += 1
        const kind = item.kind === 'bug' ? 'bug' : item.kind === 'task' ? 'task' : 'story'
        byKind[kind] += 1
      }
      return { open, byKind }
    }

    const NS = 'dsh-zentao-hub'
    const PANEL_ID = 'zentao'
    const POLL_MS = 60_000
    const BADGE_MS = 180_000
    const SYNC_MS = 90_000
    const LIST_VIEW_ENABLED = false

    const zh = {
      nav: '禅道',
      title: '禅道任务',
      subtitle: '禅道里分配给我的需求、任务与 Bug',
      taskFilters: '任务筛选',
      boardView: '看板',
      listView: '列表',
      search: '搜索',
      taskSearch: '任务号、父需求号或标题',
      allProjects: '全部项目 / 产品',
      unknownStatus: '未提供状态',
      syncFailed: '刷新失败，保留上次结果',
      noMatches: '试试其他关键词或筛选条件。',
      chooseConversation: '派发到',
      newConversation: '新开对话',
      existingConversation: '继续原对话',
      prepareExisting: '继续对话',
      prepareNew: '新开对话',
      reuseCheckout: '需求分支',
      draftOnly: '草稿由你确认后发送',
      extraPromptPlaceholder: '补充本次要做的事',
      draftWaiting: '待发送',
      statusUnavailable: '状态暂不可用',
      draftIncomplete: '草稿未就绪',
      retryDraft: '重试草稿',
      existingDraftPreserved: '已保留原输入框内容。处理完后可再次准备任务草稿。',
      refresh: '刷新',
      settings: '设置',
      save: '保存',
      saving: '保存中…',
      cancel: '取消',
      close: '关闭',
      retry: '重试',
      empty: '没有找到任务',
      emptyHint: '检查来源配置（项目、产品或账号）与处理人后重试。',
      needSetup: '还差一步配置',
      needSetupHint: '打开设置，选择需求来源并填写地址、账号与凭据，保存后就能看到分配给我的任务。',
      goSettings: '去设置',
      loading: '正在读取…',
      filterAll: '全部',
      filterOpen: '进行中',
      filterDone: '已完成',
      dispatch: '派发 Agent',
      openSession: '打开会话',
      openShort: '打开',
      dispatchTitle: '派发 Agent',
      dispatchTarget: '目标工作区',
      dispatchCustom: '自定义仓库路径…',
      dispatchWorktree: '使用独立 worktree',
      dispatchWorktreeHint: '在仓库同级 .dsh-worktrees 下新建检出，避免打断你当前的分支。',
      dispatchBase: '基础分支',
      dispatchBaseHint: '留空则自动选择 origin/HEAD 或当前分支。',
      dispatchPrompt: '补充要求（可选）',
      dispatchConfirm: '建分支并放进输入框',
      dispatching: '正在派发…',
      dispatched: '已派发',
      draftReady: '已放进输入框，确认后自行发送',
      draftFailed: '会话已建好，但内容没能放进输入框，请打开会话手动粘贴。',
      draftPartial: '会话已建好，{n} 个附件没能放进输入框，请手动补上。',
      running: '运行中',
      idle: '空闲',
      story: '需求',
      openSource: '在禅道打开',
      storyColumn: '任务',
      statusColumn: '状态',
      ownerColumn: '处理人',
      actionColumn: '操作',
      owner: '处理人',
      due: '截止',
      priority: '优先级',
      status: '状态',
      iteration: '迭代',
      defaultWorkspace: '默认工作区',
      baseBranch: '默认基础分支',
      zentaoBaseUrl: '禅道地址',
      zentaoBaseUrlHint: '例如 https://zentao.example.com，会自动补 /api.php/v1。',
      zentaoBasicHint: '填写 Apache 或 Nginx 的 HTTP 访问凭据。下方仍需填写禅道登录账号和密码。',
      zentaoBasicAccount: '网关账号',
      zentaoBasicPassword: '网关密码',
      zentaoAccount: '禅道账号',
      zentaoPassword: '禅道密码',
      zentaoPasswordSaved: '密码已配置，留空表示不修改',
      zentaoPasswordMissing: '未配置密码',
      zentaoScope: '读取范围',
      scopeSwitchHint: '切换读取范围会立即重新拉取列表（设置里也会同步）。',
      zentaoScopeProduct: '产品需求',
      zentaoType_story: '研发需求',
      zentaoType_requirement: '用户需求',
      zentaoType_epic: '业务需求',
      zentaoScopeProject: '项目任务',
      zentaoScopeBug: '产品缺陷（Bug）',
      zentaoTransport: '数据通道',
      zentaoTransportHint: 'v1 只读、按产品/项目读；v2 走 /my 并支持回写（禅道 22.0+）；cli 交给 zentao-cli，登录和版本判断都由它负责。',
      zentaoTransportV1: 'v1（内置，只读）',
      zentaoTransportV2: 'v2（内置，可回写）',
      zentaoTransportAuto: '自动（先试 v2）',
      zentaoTransportCli: 'zentao-cli（官方 CLI）',
      zentaoCliBin: 'cli 命令',
      zentaoCliBinHint: '默认 zentao；没全局安装时填 npx 或绝对路径。',
      zentaoCliHint: 'cli 通道自己管登录：{state}。插件不再保存禅道密码。',
      zentaoCliMissing: '没找到 zentao 命令，先 npm i -g zentao-cli',
      zentaoCliUnknown: '尚未登录，先执行 zentao login',
      zentaoCliScopeHint: 'cli 通道按「我的地盘」读取，不需要选产品/项目',
      zentaoMyWork: '优先读取「我的地盘」（服务端 filter）',
      zentaoMyWorkHint: '少发请求、也不用先选容器；禅道 22.5 以下会自动回退到产品/项目枚举。',
      badgeTitle: '{n} 条未完成',
      writeTitle: '回写禅道',
      writeStart: '回写开始',
      writeResolve: '解决',
      writeResolution: '解决方案',
      writeRealStarted: '实际开始',
      writeRealStartedHint: '留空用当前时间，格式 YYYY-MM-DD HH:mm:ss',
      writeComment: '备注',
      writeCommentHint: '禅道没有单独加备注的接口，备注会跟着这次状态流转一起提交。',
      writePlanTitle: '将要提交',
      writePlanLoading: '正在生成…',
      writeConfirm: '确认回写',
      writing: '回写中…',
      writeDone: '已回写，当前状态：{state}',
      writeUnverified: '未能回查，请到禅道确认',
      writeWarn: '这会真的改禅道里的数据。确认前请核对上面的内容。',
      action_start: '开始',
      action_finish: '完成…',
      action_close: '关闭…',
      action_activate: '重新激活',
      action_assign: '指派给…',
      action_resolve: '解决…',
      action_confirm: '确认…',
      dispatchCompletedHint: '这条已完成：要接着做请先重新激活，再派发。',
      writeAssignLeaves: '改派后这条会从「我的地盘」消失，因为它不再指派给你。',
      writeAssignedTo: '指派给',
      writeAssignedToHint: '从禅道人员列表里选；留空表示不改指派人。',
      writePeopleEmpty: '禅道没有返回任何可指派的人。',
      writePeopleFailed: '（人员列表加载失败）',
      writeAssignedToKeep: '（不改变指派人）',
      matrixStray: '不在上表范围内（严重程度未填或状态异常），仍可点开：',
      jumpToDone: '「已完成」里有 {n} 条，切过去看看',
      writeCurrentConsumed: '本次消耗（小时）',
      writeCurrentConsumedHint: '禅道必填；默认取任务的预计工时。',
      writeFinishedDate: '实际完成',
      writeLeft: '预计剩余（小时）',
      writeBugType: 'Bug 类型',
      writeAssignNoComment: '改派不能附言：禅道的「修改」接口没有备注字段，想留话请用状态流转。',
      matrixView: '矩阵',
      matrixSeverity: '严重程度 \\ 状态',
      severityNone: '未填严重程度',
      resolution_fixed: '已解决',
      resolution_notrepro: '无法重现',
      resolution_bydesign: '设计如此',
      resolution_duplicate: '重复 Bug',
      resolution_external: '外部原因',
      resolution_postponed: '延期处理',
      resolution_willnotfix: '不予解决',
      resolution_tostory: '转为需求',

      zentaoApiVersion: 'API 版本',
      zentaoApiVersionHint: 'v1 是插件一直使用的接口；v2 需要禅道 21.7.8 及以上；自动会先试 v2，失败再回退 v1。',
      zentaoApiV1: 'v1（默认）',
      zentaoApiV2: 'v2',
      zentaoApiAuto: '自动探测',
      zentaoKindTask: '任务',
      zentaoKindBug: 'Bug',
      zentaoProductId: '产品 ID',
      zentaoProjectId: '项目 ID',
      zentaoContainerHint: '读取列表后可勾选多个，也可以直接填写 ID，用逗号分隔。',
      zentaoFetchProducts: '读取产品',
      zentaoFetchProjects: '读取项目',
      zentaoFetchingContainers: '正在读取…',
      zentaoNoProducts: '没有可选的产品',
      zentaoNoProjects: '没有可选的项目',
      zentaoContainerRequired: '请选择禅道产品/项目',
      dispatchBranch: '分支名称',
      dispatchBranchHint: '自己填写完整分支名，例如 feature/order-export；不会再自动拼接需求编号。',
      dispatchBranchRequiredTag: '必填',
      dispatchBranchRequired: '请先填写完整的分支名称',
      excludeCompleted: '默认只显示未完成任务',
      saveDone: '已保存',
      dispatchDone: '已派发，正在打开会话…',
      errorGeneric: '出错了',
      zentaoUnassignedHint: '禅道返回了条目，但所选范围内没有指派给当前禅道账号的条目。请核对禅道的「指派给」和插件设置中的禅道账号。',
      credentialsConfigured: '凭据已配置',
      credentialsMissing: '凭据未配置',
      noWorkspace: '没有可选工作区，请填一个仓库路径。',
      branch: '分支',
      dataDir: '数据目录',
      noSession: '会话已不在',
      redispatch: '重新派发',
      sessionGoneHint: '关联的会话已被删除，可以重新派发一个。',
      openFailed: '打开会话失败，请稍后重试，或在左侧会话列表里手动打开。',
      openUnavailable: '当前界面没有提供会话导航能力，请在左侧会话列表里手动打开。',
      smartCheckout: '智能保留本地改动（Smart Checkout）',
      smartCheckoutHint:
        '自动备份并保留未提交、未跟踪和被忽略的本地文件；恢复冲突或无法安全切换时直接中止，不会 clean 或 reset --hard。',
      dispatchedWithAttachments: '已派发，附带 {n} 个附件，正在打开会话…',
      assetsAdded: '已把需求附件与截图补充到现有会话，正在打开…',
      backfill: '补发附件',
      refreshDraft: '补齐草稿',
      refreshDraftHint: '重新读取禅道正文和图片，补入原会话的草稿',
      refreshDraftPreserved: '已保存补齐后的草稿。当前输入框有内容，请先备份并清空，再从任务中心点「打开」。',
      refreshDraftStarted: '原会话已发送过消息，请在会话中手动补充需求内容。',
      backfillHint: '把这条需求的附件与截图补充到现有会话',
      backfilling: '补发中…',
      assetsUpToDate: '这条需求的附件已是最新，无需补发',
      projectCount: '个项目',
      lastRefresh: '刷新于',
      projectSelected: '已选',
      iterationUnknown: '未规划迭代/里程碑',
      dispatchedTo: '已派发到',
      storyCount: '条需求',
    }

    const en = {
      nav: 'ZenTao',
      title: 'ZenTao Tasks',
      subtitle: 'Requirements, tasks and bugs assigned to me in ZenTao',
      taskFilters: 'Task filters',
      boardView: 'Board',
      listView: 'List',
      search: 'Search',
      taskSearch: 'Task ID, parent ID, or title',
      allProjects: 'All projects / products',
      unknownStatus: 'No status',
      syncFailed: 'Refresh failed. Showing the last result.',
      noMatches: 'Try a different search or filter.',
      chooseConversation: 'Dispatch to',
      newConversation: 'New conversation',
      existingConversation: 'Continue conversation',
      prepareExisting: 'Continue',
      prepareNew: 'Open new conversation',
      reuseCheckout: 'Task branch',
      draftOnly: 'Review the draft before sending',
      extraPromptPlaceholder: 'Add instructions for this conversation',
      draftWaiting: 'Ready to send',
      statusUnavailable: 'Status unavailable',
      draftIncomplete: 'Draft incomplete',
      retryDraft: 'Retry draft',
      existingDraftPreserved: 'Your composer content was kept. Prepare the task draft again when ready.',
      refresh: 'Refresh',
      settings: 'Settings',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      close: 'Close',
      retry: 'Retry',
      empty: 'No tasks found',
      emptyHint: 'Check the source configuration (projects, products or owner), then retry.',
      needSetup: 'One more step',
      needSetupHint: 'Open settings, pick a source and fill in its URL, account and credentials.',
      goSettings: 'Open settings',
      loading: 'Loading…',
      filterAll: 'All',
      filterOpen: 'Open',
      filterDone: 'Done',
      dispatch: 'Dispatch agent',
      openSession: 'Open session',
      openShort: 'Open',
      dispatchTitle: 'Dispatch agent',
      dispatchTarget: 'Target workspace',
      dispatchCustom: 'Custom repository path…',
      dispatchWorktree: 'Use a separate worktree',
      dispatchWorktreeHint: 'Checks out under .dsh-worktrees beside the repo so your current branch stays untouched.',
      dispatchBase: 'Base branch',
      dispatchBaseHint: 'Leave empty to pick origin/HEAD or the current branch.',
      dispatchPrompt: 'Extra instructions (optional)',
      dispatchConfirm: 'Create branch and prefill',
      dispatching: 'Dispatching…',
      dispatched: 'Dispatched',
      draftReady: 'Loaded into the composer — send it yourself when ready',
      draftFailed: 'The session is ready, but the text could not be placed in the composer; paste it manually.',
      draftPartial: 'The session is ready, but {n} attachment(s) could not be placed in the composer.',
      running: 'Running',
      idle: 'Idle',
      story: 'Item',
      openSource: 'Open in ZenTao',
      storyColumn: 'Item',
      statusColumn: 'Status',
      ownerColumn: 'Owner',
      actionColumn: 'Actions',
      owner: 'Owner',
      due: 'Due',
      priority: 'Priority',
      status: 'Status',
      iteration: 'Iteration',
      defaultWorkspace: 'Default workspace',
      baseBranch: 'Default base branch',
      zentaoBaseUrl: 'ZenTao URL',
      zentaoBaseUrlHint: 'For example https://zentao.example.com; /api.php/v1 is added automatically.',
      zentaoBasicHint: 'Enter the HTTP credentials for Apache or Nginx. Enter your ZenTao login separately below.',
      zentaoBasicAccount: 'Gateway username',
      zentaoBasicPassword: 'Gateway password',
      zentaoAccount: 'ZenTao account',
      zentaoPassword: 'ZenTao password',
      zentaoPasswordSaved: 'Password configured — leave empty to keep it',
      zentaoPasswordMissing: 'No password configured',
      zentaoScope: 'Read from',
      scopeSwitchHint: 'Switching the scope reloads the list and is saved to settings.',
      zentaoScopeProduct: 'Product stories',
      zentaoType_story: 'Development requirement',
      zentaoType_requirement: 'User requirement',
      zentaoType_epic: 'Business requirement',
      zentaoScopeProject: 'Project tasks',
      zentaoScopeBug: 'Product bugs',
      zentaoTransport: 'Data channel',
      zentaoTransportHint: 'v1 reads products/projects and cannot write; v2 uses /my and can write back (ZenTao 22.0+); cli hands auth and version gates to zentao-cli.',
      zentaoTransportV1: 'v1 (built-in, read-only)',
      zentaoTransportV2: 'v2 (built-in, writable)',
      zentaoTransportAuto: 'Auto (v2 first)',
      zentaoTransportCli: 'zentao-cli (official)',
      zentaoCliBin: 'CLI command',
      zentaoCliBinHint: 'Defaults to zentao; use npx or an absolute path when it is not global.',
      zentaoCliHint: 'The CLI owns its login: {state}. The plugin stops storing a ZenTao password.',
      zentaoCliMissing: 'zentao not found — run npm i -g zentao-cli',
      zentaoCliUnknown: 'not signed in yet — run zentao login',
      zentaoCliScopeHint: 'The CLI channel reads your 地盘, so no product/project is needed',
      zentaoMyWork: 'Prefer the server-side 地盘 (/my/*)',
      zentaoMyWorkHint: 'Fewer requests and no container picking; ZenTao below 22.5 falls back to container enumeration.',
      badgeTitle: '{n} open items',
      writeTitle: 'Write back to ZenTao',
      writeStart: 'Mark started',
      writeResolve: 'Resolve',
      writeResolution: 'Resolution',
      writeRealStarted: 'Actually started',
      writeRealStartedHint: 'Empty means now; format YYYY-MM-DD HH:mm:ss',
      writeComment: 'Note',
      writeCommentHint: 'ZenTao has no standalone comment endpoint, so the note rides on this state change.',
      writePlanTitle: 'Will submit',
      writePlanLoading: 'Preparing…',
      writeConfirm: 'Write back',
      writing: 'Writing…',
      writeDone: 'Written. Current state: {state}',
      writeUnverified: 'could not re-read it, please check in ZenTao',
      writeWarn: 'This changes real data in ZenTao. Check the payload above before confirming.',
      action_start: 'Start',
      action_finish: 'Finish…',
      action_close: 'Close…',
      action_activate: 'Reactivate',
      action_assign: 'Assign…',
      action_resolve: 'Resolve…',
      action_confirm: 'Confirm…',
      dispatchCompletedHint: 'This item is finished: reactivate it before dispatching again.',
      writeAssignLeaves: 'After reassigning, this item leaves “my work” — it is no longer assigned to you.',
      writeAssignedTo: 'Assign to',
      writeAssignedToHint: 'Pick from the ZenTao roster; empty leaves the assignee alone.',
      writePeopleEmpty: 'ZenTao returned no assignable people.',
      writePeopleFailed: '(roster failed to load)',
      writeAssignedToKeep: '(leave as is)',
      matrixStray: 'Outside the grid (severity missing or an unexpected status), still reachable:',
      jumpToDone: '{n} item(s) are done — switch to that tab',
      writeCurrentConsumed: 'Consumed this time (hours)',
      writeCurrentConsumedHint: 'Required by ZenTao; defaults to the task estimate.',
      writeFinishedDate: 'Actually finished',
      writeLeft: 'Hours left',
      writeBugType: 'Bug type',
      writeAssignNoComment: 'A bare reassignment cannot carry a note: the update endpoint has no comment field. Use a transition for that.',
      matrixView: 'Matrix',
      matrixSeverity: 'Severity \\ Status',
      severityNone: 'No severity',
      resolution_fixed: 'Fixed',
      resolution_notrepro: 'Cannot reproduce',
      resolution_bydesign: 'By design',
      resolution_duplicate: 'Duplicate',
      resolution_external: 'External cause',
      resolution_postponed: 'Postponed',
      resolution_willnotfix: 'Will not fix',
      resolution_tostory: 'Turn into a story',

      zentaoApiVersion: 'API version',
      zentaoApiVersionHint: 'v1 is what this plugin has always used; v2 needs ZenTao 21.7.8+. Auto probes v2 first and falls back to v1.',
      zentaoApiV1: 'v1 (default)',
      zentaoApiV2: 'v2',
      zentaoApiAuto: 'Auto',
      zentaoKindTask: 'Task',
      zentaoKindBug: 'Bug',
      zentaoProductId: 'Product ID',
      zentaoProjectId: 'Project ID',
      zentaoContainerHint: 'Load the list to select multiple items, or enter comma-separated IDs.',
      zentaoFetchProducts: 'Load products',
      zentaoFetchProjects: 'Load projects',
      zentaoFetchingContainers: 'Loading…',
      zentaoNoProducts: 'No products available',
      zentaoNoProjects: 'No projects available',
      zentaoContainerRequired: 'Pick a ZenTao product/project',
      dispatchBranch: 'Branch name',
      dispatchBranchHint: 'Type the full branch name yourself, e.g. feature/order-export; the story id is never appended.',
      dispatchBranchRequiredTag: 'Required',
      dispatchBranchRequired: 'Enter the full branch name first',
      excludeCompleted: 'Show open tasks by default',
      saveDone: 'Saved',
      dispatchDone: 'Dispatched; opening the session…',
      errorGeneric: 'Something went wrong',
      zentaoUnassignedHint: 'ZenTao returned items in this scope, but none are assigned to the current account. Check “Assigned to” in ZenTao and the account in plugin settings.',
      credentialsConfigured: 'Credentials configured',
      credentialsMissing: 'Credentials missing',
      noWorkspace: 'No workspace available; enter a repository path.',
      branch: 'Branch',
      dataDir: 'Data directory',
      noSession: 'Session is gone',
      redispatch: 'Dispatch again',
      sessionGoneHint: 'The linked session was deleted; you can dispatch a fresh one.',
      openFailed: 'Could not open the session. Retry, or open it from the sidebar.',
      openUnavailable: 'Session navigation is unavailable here; open it from the sidebar.',
      smartCheckout: 'Preserve local changes (Smart Checkout)',
      smartCheckoutHint:
        'Backs up and keeps uncommitted, untracked, and ignored local files; stops on restore conflicts instead of running clean or reset --hard.',
      dispatchedWithAttachments: 'Dispatched with {n} attachment(s); opening the session…',
      assetsAdded: 'Added the requirement attachments and screenshots to the existing session; opening…',
      backfill: 'Add assets',
      refreshDraft: 'Complete draft',
      refreshDraftHint: 'Load the ZenTao description and images into the existing session draft',
      refreshDraftPreserved: 'The refreshed draft is saved. Back up and clear the current composer, then reopen from Task Hub.',
      refreshDraftStarted: 'The session has already started. Add the missing requirement content in the session.',
      backfillHint: 'Send this requirement’s files and screenshots to the existing session',
      backfilling: 'Adding…',
      assetsUpToDate: 'This requirement’s assets are already up to date',
      projectCount: 'project(s)',
      lastRefresh: 'Updated',
      projectSelected: 'selected',
      iterationUnknown: 'No iteration/milestone',
      dispatchedTo: 'Dispatched to',
      storyCount: 'stories',
    }

    const STYLE_ID = 'dsh-zentao-hub-styles'
    const CSS = `
.tt-root {
  --tt-canvas: var(--dsw-alias-bg-base, #f5f5f7);
  --tt-surface: var(--dsw-alias-bg-layer-1, #fff);
  --tt-text: var(--dsw-alias-label-primary, #1d1d1f);
  --tt-secondary: var(--dsw-alias-label-secondary, #62626a);
  --tt-fill: color-mix(in srgb, var(--tt-text) 5%, var(--tt-surface));
  --tt-line: color-mix(in srgb, var(--tt-text) 9%, var(--tt-surface));
  --tt-accent: #0066d6;
  --tt-accent-hover: #0058be;
  --tt-tint: color-mix(in srgb, #007aff 10%, var(--tt-surface));
  --tt-link: color-mix(in srgb, #007aff 68%, var(--tt-text));
  --tt-ring: color-mix(in srgb, #007aff 35%, transparent);
  --tt-shadow: 0 1px 2px rgb(0 0 0 / 4%), 0 4px 16px rgb(0 0 0 / 3%);
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 20px clamp(12px, 1vw, 20px) 24px;
  background: color-mix(in srgb, var(--tt-text) 3%, var(--tt-canvas));
  color: var(--tt-text);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  container: tt-panel / inline-size;
}
.tt-shell { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.tt-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; }
.tt-head-main { display: flex; align-items: center; gap: 13px; flex: 1 1 240px; min-width: 0; }
.tt-head-mark { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px; background: var(--tt-tint); color: var(--tt-link); }
.tt-head-copy { min-width: 0; }
.tt-title { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 650; letter-spacing: -.025em; }
.tt-sub { margin-top: 4px; font-size: 12px; color: var(--tt-secondary); overflow-wrap: anywhere; }
.tt-head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tt-root button { font-family: inherit; }
.tt-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--tt-line); background: var(--tt-surface); color: var(--tt-text); border-radius: 8px; min-height: 32px; padding: 5px 12px; font-size: 12px; font-weight: 550; line-height: 1.35; white-space: nowrap; cursor: pointer; }
.tt-btn:hover:not(:disabled) { background: var(--tt-fill); }
.tt-btn:disabled, .tt-tab:disabled { opacity: .55; cursor: default; }
.tt-btn-primary { background: var(--tt-accent); border-color: transparent; color: #fff; }
.tt-btn-primary:hover:not(:disabled) { background: var(--tt-accent-hover); }
.tt-btn-small { min-height: 27px; padding: 4px 9px; font-size: 11.5px; }
.tt-btn-danger { color: #b42318; border-color: color-mix(in srgb, #b42318 30%, var(--tt-line)); }
.tt-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, #b42318 8%, var(--tt-surface)); }
.tt-write-menu { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.tt-action-hint { flex-basis: 100%; order: 9; font-size: 11px; color: var(--tt-secondary); }
.tt-root :is(button, a, input[type="checkbox"]):focus-visible { outline: 2px solid var(--tt-accent); outline-offset: 2px; }
.tt-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tt-scope { display: inline-flex; align-items: center; gap: 6px; }
.tt-scope-label { white-space: nowrap; }
.tt-scope-select { min-height: 29px; padding: 2px 8px; font-size: 12px; }
.tt-tabs { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; align-self: flex-start; }
.tt-sources { padding: 3px; border-radius: 10px; border: 1px solid var(--tt-line); background: var(--tt-fill); }
.tt-tab { appearance: none; border: 1px solid transparent; background: transparent; color: var(--tt-secondary); border-radius: 7px; min-height: 29px; padding: 3px 12px; font-size: 12px; font-weight: 550; line-height: 1.45; white-space: nowrap; cursor: pointer; }
.tt-tab:hover:not(:disabled) { color: var(--tt-text); background: var(--tt-fill); }
.tt-sources .tt-tab { min-width: 63px; }
.tt-sources .tt-tab-on, .tt-sources .tt-tab-on:hover:not(:disabled) { background: var(--tt-surface); color: var(--tt-text); border-color: var(--tt-line); box-shadow: 0 1px 3px rgb(0 0 0 / 10%); }
.tt-filters { gap: 4px; }
.tt-filters .tt-tab-on, .tt-filters .tt-tab-on:hover:not(:disabled) { background: var(--tt-tint); color: var(--tt-link); }
.tt-tab-total { margin-inline-start: 5px; font-size: 11px; font-variant-numeric: tabular-nums; opacity: .85; }
.tt-count { font-size: 11.5px; color: var(--tt-secondary); margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.tt-list { display: flex; flex-direction: column; gap: 14px; }
.tt-search-control { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.tt-search-control .tt-search { width: clamp(160px, 30cqw, 220px); max-width: 100%; min-height: 32px; }
.tt-search-control button[aria-expanded="true"] { background: var(--tt-tint); color: var(--tt-link); }
.tt-toolbar .tt-filter-select { width: auto; max-width: 100%; }
.tt-board { display: flex; gap: 12px; min-width: 0; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }
.tt-board-column { flex: 1 0 clamp(210px, 25cqw, 300px); min-width: 0; border: 1px solid var(--tt-line); border-radius: 12px; background: var(--tt-fill); padding: 9px; }
.tt-board-column h2 { margin: 0 0 8px; padding: 3px 3px 5px; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.tt-board-cards { display: grid; gap: 8px; max-height: max(300px, calc(100dvh - 250px)); overflow-y: auto; }
.tt-card { min-width: 0; display: grid; gap: 7px; border: 1px solid var(--tt-line); border-radius: 9px; background: var(--tt-surface); padding: 11px; }
.tt-card .tt-srow-action { justify-content: flex-start; margin-inline-start: 0; }
.tt-sync-note { color: var(--tt-secondary); font-size: 12px; overflow-wrap: anywhere; }
.tt-branch-label { overflow-wrap: anywhere; color: var(--tt-secondary); font-size: 11px; }

.tt-story-title { font-size: 13.5px; font-weight: 600; color: var(--tt-text); text-decoration: none; line-height: 1.5; overflow-wrap: anywhere; }
a.tt-story-title:hover { color: var(--tt-link); text-decoration: underline; text-underline-offset: 3px; }
.tt-meta, .tt-smeta { display: flex; flex-wrap: wrap; gap: 4px 9px; font-size: 11px; color: var(--tt-secondary); align-items: center; font-variant-numeric: tabular-nums; }
.tt-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 6px; background: var(--tt-fill); font-size: 11px; line-height: 1.4; max-width: 100%; overflow-wrap: anywhere; }
.tt-chip-id { font-variant-numeric: tabular-nums; }
.tt-chip-warn { color: var(--dsw-alias-state-warn-primary); }
.tt-chip-ok { color: var(--dsw-alias-state-success-primary); }
.tt-chip-idle { color: var(--tt-secondary); }
.tt-dot { flex: none; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.tt-note { border: 1px solid var(--tt-line); border-radius: 14px; background: var(--tt-surface); padding: 28px 18px; text-align: center; color: var(--tt-secondary); font-size: 12px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.tt-note-title { color: var(--tt-text); font-size: 14px; font-weight: 600; }
.tt-error { border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 10px; padding: 12px 14px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.tt-error-msg { color: var(--tt-text); }
.tt-error-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: var(--tt-secondary); }
.tt-footer { font-size: 11px; color: var(--tt-secondary); display: flex; gap: 6px 12px; flex-wrap: wrap; overflow-wrap: anywhere; }
.tt-overlay { box-sizing: border-box; position: fixed; inset: 0; background: rgb(0 0 0 / 30%); backdrop-filter: blur(5px); display: grid; place-items: center; padding: 16px; z-index: 60; }
.tt-modal { box-sizing: border-box; width: min(640px, 100%); max-height: min(840px, calc(100dvh - 32px)); background: var(--tt-surface); border: 1px solid var(--tt-line); border-radius: 18px; overflow: auto; overscroll-behavior: contain; scroll-padding-block: 56px 64px; box-shadow: 0 20px 64px rgb(0 0 0 / 24%), 0 2px 8px rgb(0 0 0 / 8%); --tt-sheet-pad: clamp(14px, 3vw, 24px); }
.tt-modal-head, .tt-modal-foot { position: sticky; z-index: 1; background: var(--tt-surface); display: flex; align-items: center; gap: 8px; }
.tt-modal-head { top: 0; padding: 12px var(--tt-sheet-pad); border-bottom: 1px solid var(--tt-line); }
.tt-modal-title { font-size: 17px; font-weight: 650; flex: 1; }
.tt-modal-close { flex: none; width: 28px; height: 28px; padding: 0; background: var(--tt-fill); border-color: transparent; border-radius: 50%; }
.tt-modal-close:hover:not(:disabled) { background: var(--tt-line); }
.tt-modal-foot { bottom: 0; justify-content: flex-end; flex-wrap: wrap; padding: 12px var(--tt-sheet-pad); border-top: 1px solid var(--tt-line); }
.tt-modal-foot .tt-btn { min-height: 34px; white-space: normal; }
.tt-modal > .tt-stack { padding: 16px var(--tt-sheet-pad) 0; }
.tt-modal > .tt-stack > .tt-modal-foot { margin-inline: calc(-1 * var(--tt-sheet-pad)); }
.tt-dispatch-summary { display: grid; gap: 6px; }
.tt-dispatch-summary .tt-story-title { font-size: 15px; }
.tt-modal-compact { width: min(500px, 100%); --tt-sheet-pad: clamp(14px, 3vw, 20px); }
.tt-conversation-picker { align-self: flex-start; }
.tt-dispatch-checkout { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 8px; padding: 8px 10px; border: 1px solid var(--tt-line); border-radius: 8px; color: var(--tt-secondary); font-size: 12px; }
.tt-dispatch-checkout code { color: var(--tt-text); overflow-wrap: anywhere; }
.tt-dispatch-extra summary { width: fit-content; color: var(--tt-secondary); font-size: 12px; cursor: pointer; }
.tt-dispatch-extra .tt-textarea { margin-top: 7px; display: block; }
.tt-dispatch-error { padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cc3737) 10%, var(--tt-surface)); color: var(--tt-text); font-size: 12px; overflow-wrap: anywhere; }
.tt-dispatch-footnote { margin-inline-end: auto; color: var(--tt-secondary); font-size: 11px; }
.tt-field { display: flex; flex-direction: column; min-width: 0; gap: 5px; }
.tt-label { font-size: 12px; font-weight: 600; color: var(--tt-text); }
.tt-input, .tt-select, .tt-textarea { width: 100%; min-width: 0; box-sizing: border-box; background: var(--tt-fill); border: 1px solid var(--tt-line); border-radius: 8px; color: var(--tt-text); font: inherit; padding: 7px 10px; }
.tt-select { text-overflow: ellipsis; }
.tt-input:focus, .tt-select:focus, .tt-textarea:focus { outline: 2px solid var(--tt-ring); outline-offset: 1px; border-color: var(--tt-accent); background: var(--tt-surface); }
.tt-textarea { min-height: 70px; resize: vertical; }
.tt-hint { font-size: 11px; line-height: 1.55; color: var(--tt-secondary); overflow-wrap: anywhere; }
.tt-field-key { padding: 10px 12px; background: var(--tt-fill); border: 1px solid var(--tt-line); border-radius: 12px; }
.tt-label-key { display: flex; align-items: center; gap: 8px; }
.tt-label-badge { font-size: 10.5px; font-weight: 550; color: var(--tt-link); background: var(--tt-tint); border-radius: 5px; padding: 1px 6px; }
.tt-input-key { background: var(--tt-surface); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tt-input-invalid, .tt-input-invalid:focus { border-color: var(--dsw-alias-state-error-primary); }
.tt-input-invalid:focus { outline-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, transparent); }
.tt-options { background: var(--tt-fill); border: 1px solid var(--tt-line); border-radius: 11px; }
.tt-check { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; cursor: pointer; }
.tt-check input, .tt-proj-row input { flex: none; margin: 2px 0 0; accent-color: var(--tt-accent); }
.tt-options .tt-check { padding: 9px 11px; font-weight: 550; }
.tt-options .tt-check + .tt-check { border-top: 1px solid var(--tt-line); }
.tt-options .tt-hint { display: block; margin-top: 2px; font-weight: 400; }
.tt-stack { display: flex; flex-direction: column; gap: 12px; }
.tt-row { display: flex; flex-wrap: wrap; gap: 10px; }
.tt-row > * { flex: 1 1 165px; min-width: 0; }
.tt-zentao-address { display: flex; flex-wrap: wrap; gap: 8px; }
.tt-zentao-address > .tt-input { flex: 1 1 180px; }
.tt-switch { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; background: var(--tt-fill); border: 1px solid var(--tt-line); border-radius: 8px; font-size: 12px; font-weight: 550; cursor: pointer; }
.tt-switch input { appearance: none; display: flex; align-items: center; width: 30px; height: 18px; margin: 0; padding: 2px; border-radius: 999px; background: var(--tt-secondary); cursor: pointer; }
.tt-switch input::before { content: ''; width: 14px; height: 14px; border-radius: 50%; background: #fff; }
.tt-switch input:checked { justify-content: flex-end; background: var(--tt-accent); }
.tt-toast { position: sticky; bottom: 0; align-self: center; background: var(--tt-surface); border: 1px solid var(--tt-line); color: var(--tt-text); box-shadow: var(--tt-shadow); font-size: 12px; border-radius: 10px; padding: 7px 14px; }
.tt-muted { color: var(--tt-secondary); }
.tt-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; background: var(--tt-fill); border: 1px solid var(--tt-line); border-radius: 9px; }
.tt-seg button { appearance: none; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--tt-secondary); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.tt-seg button.tt-seg-on { background: var(--tt-surface); color: var(--tt-text); border-color: var(--tt-line); box-shadow: 0 1px 3px rgb(0 0 0 / 8%); font-weight: 550; }
.tt-group { border: 1px solid var(--tt-line); border-radius: 14px; background: var(--tt-surface); box-shadow: var(--tt-shadow); overflow: hidden; }
.tt-group-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 10px; padding: 12px 16px; font-size: 13.5px; font-weight: 650; overflow-wrap: anywhere; }
.tt-group-range, .tt-group-count { color: var(--tt-secondary); font-weight: 400; font-size: 11px; font-variant-numeric: tabular-nums; }
.tt-group-count { margin-inline-start: auto; white-space: nowrap; }
.tt-shead, .tt-srow { display: grid; grid-template-columns: 96px minmax(0, 1fr) 126px 70px 176px; gap: 10px; align-items: center; padding: 9px 14px; }
.tt-shead.tt-noapp, .tt-srow.tt-noapp { grid-template-columns: 78px minmax(0, 1fr) 126px 70px 176px; }
.tt-shead { background: var(--tt-fill); font-size: 11px; font-weight: 550; color: var(--tt-secondary); padding-block: 6px; }
.tt-srow { border-top: 1px solid var(--tt-line); }
.tt-srow:hover { background: color-mix(in srgb, var(--tt-text) 2%, var(--tt-surface)); }
.tt-sapp { min-width: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px; }
.tt-sapp .tt-chip-app { display: block; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt-sid, .tt-sowner { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tt-secondary); font-size: 11.5px; }
.tt-sid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.tt-smain { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tt-sstatus { min-width: 0; }
.tt-status { display: inline-block; box-sizing: border-box; max-width: 100%; padding: 3px 8px; background: var(--tt-fill); color: var(--tt-secondary); border-radius: 999px; font-size: 11px; font-weight: 550; line-height: 1.4; overflow-wrap: anywhere; }
.tt-status::before { content: ''; display: inline-block; vertical-align: .13em; width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin-inline-end: 5px; }
.tt-status-open { background: var(--tt-tint); color: var(--tt-link); }
.tt-status-done { background: color-mix(in srgb, #34c759 12%, var(--tt-surface)); color: color-mix(in srgb, #2aa35a 62%, var(--tt-text)); }
.tt-srow-action, .tt-srow-buttons { display: flex; gap: 5px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.tt-srow-action .tt-chip { white-space: nowrap; }
.tt-proj { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--tt-line); border-radius: 9px; padding: 10px 12px; }
.tt-proj-row { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; }
.tt-proj-name { font-weight: 550; }
.tt-proj-id { color: var(--tt-secondary); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tt-proj-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@container tt-panel (max-width: 880px) {
  .tt-shead { display: none; }
  .tt-srow, .tt-srow.tt-noapp { display: flex; flex-wrap: wrap; gap: 7px 12px; }
  .tt-smain { flex-basis: 100%; order: -1; }
  .tt-sapp { max-width: 100%; }
  .tt-sowner, .tt-sid { overflow-wrap: anywhere; white-space: normal; }
  .tt-srow-action { margin-inline-start: auto; max-width: 100%; }
}
@container tt-panel (max-width: 460px) {
  .tt-srow, .tt-group-head { padding-inline: 12px; }
  .tt-sapp:not(:empty) { flex-basis: 100%; }
}
/* Sidebar glyph + self-drawn badge (the sidebar gives icons no badge slot). */
.tt-nav-glyph { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.tt-nav-badge { position: absolute; top: 0; right: 0; transform: translate(45%, -45%); min-width: 12px; height: 12px; padding: 0 2px; border-radius: 999px; background: var(--dsw-alias-brand-primary, #2b6cff); color: #fff; font-size: 9px; font-weight: 600; line-height: 12px; text-align: center; font-variant-numeric: tabular-nums; pointer-events: none; box-shadow: 0 0 0 2px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #fff)); transition: opacity .15s ease, transform .15s ease; }
.tt-nav-badge-dim { opacity: .45; }
/* Bug triage matrix (严重程度 × 状态). */
.tt-matrix { display: grid; gap: 10px; grid-template-columns: minmax(78px, auto) repeat(var(--tt-cols, 3), minmax(0, 1fr)); align-items: stretch; }
.tt-matrix-corner, .tt-matrix-head, .tt-matrix-row-head { font-size: 11.5px; color: var(--tt-secondary); }
.tt-matrix-head { padding-bottom: 2px; font-weight: 600; }
.tt-matrix-row-head { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--tt-text); }
.tt-matrix-cell { border: 1px solid var(--tt-line); border-radius: 10px; background: var(--tt-fill); padding: 7px; min-height: 62px; display: flex; flex-direction: column; gap: 6px; }
.tt-matrix-cell-empty { border-style: dashed; background: transparent; }
.tt-matrix-item { display: flex; flex-direction: column; gap: 2px; padding: 5px 7px; border-radius: 8px; background: var(--tt-surface); border: 1px solid var(--tt-line); font-size: 11.5px; text-align: start; cursor: pointer; }
.tt-matrix-item:hover { border-color: var(--tt-link); }
.tt-matrix-item-id { color: var(--tt-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
.tt-matrix-more { font-size: 10.5px; color: var(--tt-secondary); }
/* Write-back plan preview. */
.tt-plan { border: 1px solid var(--tt-line); border-radius: 10px; background: var(--tt-fill); padding: 10px 12px; font-size: 11.5px; display: flex; flex-direction: column; gap: 6px; }
.tt-plan code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.tt-plan-warn { color: var(--tt-warn, #b25e00); }
`

    function ensureStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID)) return () => {}
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
      return () => {
        element.remove()
      }
    }

    function apiUrl(path) {
      const relative = `api/zentao/${path}`.replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    /** Sidebar badge: counts only, so it can poll without pulling the list. */
    async function refreshBadgeCount({ force = false } = {}) {
      if (!force && badgeChannel.value === 'v1') return
      try {
        const value = await api('counts')
        badgeStore.set({ open: Number(value?.open) || 0, byKind: value?.byKind ?? {} })
      } catch {
        // Signed out, offline or missing credentials: keep the last value.
      }
    }

    async function api(path, body) {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const payload = await response.json().catch(() => null)
      if (!payload || payload.ok !== true) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`)
        error.code = payload?.error?.code || 'zentao/unknown'
        throw error
      }
      return payload.value
    }

    /** 研发需求 / 业务需求 / 任务 / Bug — the ZenTao work item kind. */
    function itemKindLabel(t, story) {
      if (story.kind === 'task') return t('zentaoKindTask')
      if (story.kind === 'bug') return t('zentaoKindBug')
      return t(`zentaoType_${story.requirementType || 'story'}`)
    }

    function formatDate(value) {
      if (!value) return ''
      const text = String(value)
      return text.length >= 10 ? text.slice(0, 10) : text
    }

    /** Count bubble drawn on the sidebar glyph; nothing official renders one. */
    function Badge(props) {
      const count = Number(props.count) || 0
      if (count <= 0) return null
      return h(
        'span',
        {
          // A 12px pill fits one digit; the panel open behind it already shows
          // the exact list, so the badge only has to say "there is work".
          className: props.dim ? 'tt-nav-badge tt-nav-badge-dim' : 'tt-nav-badge',
          title: props.title || String(count),
        },
        count > 9 ? '9+' : String(count),
      )
    }

    function Icon(props) {
      const size = props.size || 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7 9.5h5M7 13h7M7 16.5h4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 17.2, cy: 9.5, r: 2.1, fill: 'currentColor', opacity: 0.9 }),
      )
    }

    const TOOL_ICON_PATHS = {
      search: 'M15.5 15.5 20 20M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
      refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2.2 5.5',
      settings: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 5v4m4 6v4',
      close: 'm6 6 12 12M18 6 6 18',
    }

    function ToolIcon({ name }) {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: TOOL_ICON_PATHS[name], stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function Field(props) {
      const emphasis = Boolean(props.emphasis)
      return h(
        'label',
        { className: emphasis ? 'tt-field tt-field-key' : 'tt-field' },
        h(
          'span',
          { className: emphasis ? 'tt-label tt-label-key' : 'tt-label' },
          props.label,
          props.badge ? h('span', { className: 'tt-label-badge' }, props.badge) : null,
        ),
        props.children,
        props.hint ? h('span', { className: 'tt-hint' }, props.hint) : null,
      )
    }

    function Modal(props) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose?.()
        }
        window.addEventListener('keydown', onKey)
        // Keyboard users land inside the dialog instead of the panel behind it.
        const previous = document.activeElement
        const target = ref.current?.querySelector?.('input, textarea, select, button')
        target?.focus?.()
        return () => {
          window.removeEventListener('keydown', onKey)
          previous?.focus?.()
        }
      }, [props.onClose])
      return h(
        'div',
        {
          className: 'tt-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) props.onClose?.()
          },
        },
        h(
          'div',
          {
            className: props.compact ? 'tt-modal tt-modal-compact' : 'tt-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': props.title,
            ref,
          },
          h(
            'div',
            { className: 'tt-modal-head' },
            h('div', { className: 'tt-modal-title' }, props.title),
            h(
              'button',
              { className: 'tt-btn tt-modal-close', 'aria-label': props.t('close'), title: props.t('close'), onClick: props.onClose },
              h(ToolIcon, { name: 'close' }),
            ),
          ),
          props.children,
        ),
      )
    }

    function ErrorBox(props) {
      const t = props.t
      return h(
        'div',
        { className: 'tt-error' },
        h('div', { className: 'tt-error-msg' }, props.error?.message || t('errorGeneric')),
        props.error?.code ? h('div', { className: 'tt-error-code' }, props.error.code) : null,
        typeof props.onRetry === 'function'
          ? h('div', null, h('button', { className: 'tt-btn tt-btn-small', onClick: props.onRetry }, t('retry')))
          : null,
      )
    }

    function StatePill(props) {
      const t = props.t
      const dispatch = props.dispatch
      if (!dispatch) return null
      const status = dispatch.sessionMissing ? 'noSession'
        : dispatch.draftPending ? 'draftIncomplete'
          : dispatch.statusUnavailable ? 'statusUnavailable'
            : dispatch.running ? 'running'
              : dispatch.draftWaiting ? 'draftWaiting' : 'idle'
      const tone = status === 'running' ? 'ok' : ['noSession', 'statusUnavailable', 'draftIncomplete'].includes(status) ? 'warn' : 'idle'
      return h('span', { className: 'tt-chip tt-chip-' + tone }, h('span', { className: 'tt-dot' }), t(status))
    }

    const STATUS_TONE = {
      planning: 'tt-status-neutral',
      developing: 'tt-status-open',
      testing: 'tt-status-open',
      resolved: 'tt-status-done',
      done: 'tt-status-done',
      closed: 'tt-status-done',
      rejected: 'tt-status-neutral',
    }

    function storyStatus(story) {
      const activeZentaoStory = story.source === 'zentao' && story.kind === 'story' && (!story.status || story.status === 'active')
      return (activeZentaoStory && story.stageLabel) || story.vStatus || story.status || ''
    }

    function storyTone(story) {
      return STATUS_TONE[story.status] ?? 'tt-status-open'
    }

    function buildGroups(stories, iterations) {
      const order = new Map()
      const ranges = new Map()
      for (const [index, iteration] of (iterations ?? []).entries()) {
        // The host sends names; older shapes sent `{name, startdate, enddate}`.
        const entry = typeof iteration === 'string' ? { name: iteration } : iteration ?? {}
        order.set(entry.name, index)
        ranges.set(entry.name, [entry.startdate, entry.enddate])
      }
      const groups = new Map()
      for (const story of stories) {
        const name = story.iterationName || ''
        let entry = groups.get(name)
        if (!entry) {
          entry = { name, stories: [], range: ranges.get(name) ?? [] }
          groups.set(name, entry)
        }
        entry.stories.push(story)
      }
      const list = [...groups.values()]
      list.sort((left, right) => {
        if (!left.name) return 1
        if (!right.name) return -1
        const a = order.has(left.name) ? order.get(left.name) : 900
        const b = order.has(right.name) ? order.get(right.name) : 900
        return a - b
      })
      return list
    }

    const BUG_STATUSES = [
      { key: 'active', label: '待解决' },
      { key: 'resolved', label: '已解决' },
      { key: 'closed', label: '已关闭' },
    ]
    const BUG_SEVERITIES = [
      { key: 'P1', label: 'P1' },
      { key: 'P2', label: 'P2' },
      { key: 'P3', label: 'P3' },
      { key: 'P4', label: 'P4' },
      { key: '', label: '未填严重程度' },
    ]

    /**
     * 严重程度 × 状态 matrix for the bug triage board. Severity and status are
     * the two axes a developer triages on, so the matrix is the view that
     * answers "what is on fire right now" without reading 40 cards.
     */
    function bugMatrix(items, { severities = BUG_SEVERITIES, statuses = BUG_STATUSES, limit = 4 } = {}) {
      const known = new Set(statuses.map((status) => status.key))
      const rows = severities.map((severity) => ({
        ...severity,
        cells: statuses.map((status) => ({
          ...status,
          items: items.filter((item) => {
            const severityKey = item.severity || ''
            const statusKey = known.has(item.status) ? item.status : ''
            return severityKey === severity.key && statusKey === status.key
          }),
        })),
      }))
      // Anything the fixed axes do not cover still has to be reachable.
      const stray = items.filter((item) => {
        const severityKey = severities.some((severity) => severity.key === (item.severity || ''))
        const statusKey = known.has(item.status)
        return !severityKey || !statusKey
      })
      return { rows, statuses, stray, truncated: rows.map((row) => row.cells.map((cell) => cell.items.length > limit)) }
    }

    function groupByStatus(stories, unknown, configuredStatuses = []) {
      const groups = new Map()
      for (const story of stories) {
        const name = storyStatus(story) || unknown
        if (!groups.has(name)) groups.set(name, [])
        groups.get(name).push(story)
      }
      for (const name of configuredStatuses) {
        if (!groups.has(name)) groups.set(name, [])
      }
      return [...groups].map(([name, items]) => ({ name, stories: items }))
    }

    function filterStories(stories, query, project) {
      const tokens = query.toLowerCase().split(/\s+/).map((part) => part.replace(/^#+/, '')).filter(Boolean)
      return stories.filter((story) => {
        if (project && project !== `${story.source}:${story.projectId}`) return false
        const searchable = [story.id, story.shortId, story.rootId, story.rootShortId, story.name, story.rootName].join(' ').toLowerCase()
        return tokens.every((part) => searchable.includes(part))
      })
    }

    function conversationOptions(dispatch) {
      return [dispatch, ...(dispatch?.previousSessions ?? [])].filter((entry) => entry?.sessionId && !entry.sessionMissing)
    }

    function TaskActions({ story, t, onDispatch, onOpen, onBackfill, backfilling, onWrite }) {
      const dispatch = story.dispatch
      // Handing the work to an agent is the main action only while the item is
      // still unstarted; once it is under way the state change matters more.
      const dispatchPrimary = actionsFor(story).length === 0 || story.status === 'wait' || !story.status
      const dispatchButton = h(
        'button',
        { className: `tt-btn tt-btn-small${dispatchPrimary ? ' tt-btn-primary' : ''}`, onClick: () => onDispatch(story) },
        t(dispatch ? (dispatch.sessionMissing ? 'redispatch' : 'dispatch') : 'dispatch'),
      )
      const completedHint = story.completed && onWrite
        ? h('span', { className: 'tt-hint tt-action-hint' }, t('dispatchCompletedHint'))
        : null
      if (!dispatch) {
        return h('div', { className: 'tt-srow-action' },
          h(WriteMenu, { story, t, onWrite }),
          dispatchButton,
          completedHint)
      }
      const refreshing = backfilling === (story.uid ?? story.id)
      const refreshDraft = Boolean(dispatch.draft) && !dispatch.draft.detailsLoaded
      const showBackfill =
        refreshDraft || !(dispatch.draft?.detailsLoaded || dispatch.attachments?.length || dispatch.images?.length || dispatch.draft?.assets?.length)
      return h('div', { className: 'tt-srow-action' },
        h(WriteMenu, { story, t, onWrite }),
        h(StatePill, { t, dispatch }),
        dispatch.branch ? h('span', { className: 'tt-branch-label', title: dispatch.branch }, dispatch.branch) : null,
        dispatch.sessionMissing || dispatch.draftPending ? null :
          h('button', { className: 'tt-btn tt-btn-small', onClick: () => onOpen(dispatch.sessionId, dispatch) }, t('openShort')),
        !dispatch.sessionMissing && (dispatch.draftPending || showBackfill) && onBackfill
          ? h('button', {
              className: 'tt-btn tt-btn-small',
              disabled: refreshing,
              onClick: () => onBackfill(story),
            }, t(refreshing ? 'backfilling' : dispatch.draftPending ? 'retryDraft' : refreshDraft ? 'refreshDraft' : 'backfill'))
          : null,
        dispatchButton,
        completedHint,
      )
    }

    /**
     * Which write actions make sense right now, in display order: the first one
     * is the primary button and 「关闭」 always comes last.
     */
    function actionsFor(story) {
      if (!story) return []
      if (story.kind === 'task') {
        if (story.status === 'done') return ['activate', 'assign', 'close']
        if (story.completed || story.status === 'closed') return ['activate', 'assign']
        if (story.status === 'wait' || !story.status) return ['start', 'assign', 'close']
        return ['finish', 'assign', 'close']
      }
      if (story.kind === 'bug') {
        if (story.completed || story.status === 'closed') return ['activate', 'assign']
        if (story.resolved) return ['close', 'activate', 'assign']
        const actions = ['resolve']
        if (story.confirmed !== true) actions.push('confirm')
        actions.push('assign', 'close')
        return actions
      }
      return []
    }

    /**
     * The write actions, inline. A card row with room for three buttons must
     * not open a modal first: primary first, 「关闭」 last and outlined red.
     */
    function WriteMenu({ story, t, onWrite }) {
      const actions = actionsFor(story)
      if (!onWrite || actions.length === 0) return null
      return h(
        'span',
        { className: 'tt-write-menu' },
        actions.map((action, index) =>
          h(
            'button',
            {
              key: action,
              className: [
                'tt-btn tt-btn-small',
                index === 0 ? 'tt-btn-primary' : '',
                action === 'close' && index > 0 ? 'tt-btn-danger' : '',
              ].filter(Boolean).join(' '),
              onClick: () => onWrite(story, action),
            },
            t(`action_${action}`),
          ),
        ),
      )
    }

    function TaskCard(props) {
      const { story, t } = props
      return h('article', { className: 'tt-card' },
        h('div', { className: 'tt-meta' },
          h('span', null, itemKindLabel(t, story)),
          h('span', null, story.shortId || story.id),
          story.owner ? h('span', null, story.owner) : null),
        h('a', { className: 'tt-story-title', href: story.url || undefined, target: '_blank', rel: 'noreferrer noopener' }, story.name),
        h('div', { className: 'tt-meta' },
          story.severity ? h('span', { className: 'tt-chip' }, story.severity) : null,
          story.priorityLabel ? h('span', null, story.priorityLabel) : null,
          story.due ? h('span', null, `${t('due')} ${formatDate(story.due)}`) : null),
        h(TaskActions, props),
      )
    }

    function StoryRow(props) {
      const { story, t } = props
      const meta = []
      if (story.requirementType) {
        meta.push(h('span', { key: 'type', className: 'tt-chip' }, t(`zentaoType_${story.requirementType}`)))
      }
      if (story.priorityLabel) meta.push(h('span', { key: 'prio' }, story.priorityLabel))
      if (story.due) meta.push(h('span', { key: 'due' }, `${t('due')} ${formatDate(story.due)}`))
      if (story.created) meta.push(h('span', { key: 'created' }, formatDate(story.created)))
      if (story.shortId && story.rootShortId && story.rootShortId !== story.shortId) {
        meta.push(h('span', { key: 'child', className: 'tt-chip' }, `子需求 ${story.shortId}`))
      }
      return h(
        'div',
        { className: 'tt-srow' },
        h(
          'div',
          { className: 'tt-sid', title: `${story.rootShortId || story.shortId || story.id}${story.rootName ? ` · ${story.rootName}` : ''}\n${story.id}` },
          story.rootShortId || story.shortId || story.id,
        ),
        h(
          'div',
          { className: 'tt-smain' },
          h(
            'a',
            {
              className: 'tt-story-title',
              href: story.url || undefined,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: t('openSource'),
            },
            story.name,
          ),
          meta.length > 0 ? h('div', { className: 'tt-smeta' }, meta) : null,
        ),
        h('div', { className: 'tt-sstatus' }, storyStatus(story) ? h('span', { className: 'tt-status ' + storyTone(story) }, storyStatus(story)) : null),
        h('div', { className: 'tt-sowner', title: story.owner }, story.owner),
        h(TaskActions, props),
      )
    }

    function parseZentaoIds(value) {
      return [...new Set(String(value ?? '').split(/[\s,，]+/).filter((id) => /^\d+$/.test(id)))]
    }

    function SettingsModal(props) {
      const {
        t,
        boot,
        draft,
        setDraft,
        projectError,
        zentaoCatalog,
        zentaoBusy,
        onFetchZentaoContainers,
        onSave,
        onClose,
        saving,
        error,
      } = props
      const zentao = draft.zentao ?? {}
      const zentaoScope = zentao.scope ?? 'product'
      const projectScope = zentaoScope === 'project'
      // 产品缺陷 also reads a product, so only 项目任务 switches the container kind.
      const containerKind = projectScope ? 'project' : 'product'
      const transport = zentao.transport ?? 'v1'
      const cliChannel = transport === 'cli'
      const transportUsesMy = transport !== 'v1'
      const cliSite = boot?.cli?.site
      const cliState = cliChannel
        ? boot?.cli?.available
          ? [cliSite?.server, cliSite?.account, boot?.cli?.version?.cli ? `CLI ${boot.cli.version.cli}` : '']
            .filter(Boolean)
            .join(' · ') || t('zentaoCliUnknown')
          : t('zentaoCliMissing')
        : ''
      const selectedZentaoIds = parseZentaoIds(zentao.containerIdsText)
      const visibleZentaoContainers = (zentaoCatalog ?? []).filter((item) => item.kind === containerKind)
      const missingZentaoIds = selectedZentaoIds.filter((id) => !visibleZentaoContainers.some((item) => item.id === id))
      const zentaoChoices = [...visibleZentaoContainers, ...missingZentaoIds.map((id) => ({
        id,
        kind: containerKind,
        name: zentao.containerNames?.[id] || id,
      }))]
      const savedZentao = boot?.settings?.zentao
      const hasSavedBasicPassword = boot?.credentialPresence?.basicPassword &&
        zentao.baseUrl?.trim().replace(/\/+$/, '') === savedZentao?.baseUrl &&
        zentao.basicAccount?.trim() === savedZentao?.basicAccount
      const setZentao = (patch) => setDraft({ ...draft, zentao: { ...zentao, ...patch } })
      const toggleZentaoContainer = (id) => {
        const next = selectedZentaoIds.includes(id)
          ? selectedZentaoIds.filter((selected) => selected !== id)
          : [...selectedZentaoIds, id]
        setZentao({ containerIdsText: next.join(', ') })
      }
      const zentaoSection = h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'tt-row' },
          h(
            Field,
            { label: t('zentaoTransport'), hint: t('zentaoTransportHint') },
            h(
              'select',
              {
                className: 'tt-select',
                value: zentao.transport ?? 'v1',
                onChange: (event) => setZentao({ transport: event.target.value }),
              },
              h('option', { value: 'v1' }, t('zentaoTransportV1')),
              h('option', { value: 'v2' }, t('zentaoTransportV2')),
              h('option', { value: 'auto' }, t('zentaoTransportAuto')),
              h('option', { value: 'cli' }, t('zentaoTransportCli')),
            ),
          ),
          cliChannel
            ? h(Field, { label: t('zentaoCliBin'), hint: t('zentaoCliBinHint') }, h('input', {
                className: 'tt-input',
                value: zentao.cliBin ?? '',
                onChange: (event) => setZentao({ cliBin: event.target.value }),
                placeholder: 'zentao',
                autoComplete: 'off',
              }))
            : null,
        ),
        cliChannel
          ? h('span', { className: 'tt-hint' }, t('zentaoCliHint').replace('{state}', cliState))
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'tt-field' },
                h('label', { className: 'tt-label', htmlFor: 'tt-zentao-url' }, t('zentaoBaseUrl')),
                h(
                  'div',
                  { className: 'tt-zentao-address' },
                  h('input', {
                    id: 'tt-zentao-url',
                    className: 'tt-input',
                    value: zentao.baseUrl ?? '',
                    onChange: (event) => setZentao({ baseUrl: event.target.value }),
                    placeholder: 'https://zentao.example.com',
                  }),
                  h(
                    'label',
                    { className: 'tt-switch' },
                    'Basic Auth',
                    h('input', {
                      type: 'checkbox',
                      role: 'switch',
                      checked: zentao.basicAuth === true,
                      onChange: (event) => setZentao({ basicAuth: event.target.checked }),
                    }),
                  ),
                ),
                h('span', { className: 'tt-hint' }, t('zentaoBaseUrlHint')),
              ),
              zentao.basicAuth
                ? h(
                    'div',
                    { className: 'tt-stack tt-field-key' },
                    h(
                      'div',
                      { className: 'tt-row' },
                      h(Field, { label: t('zentaoBasicAccount') }, h('input', {
                        className: 'tt-input',
                        value: zentao.basicAccount,
                        onChange: (event) => setZentao({ basicAccount: event.target.value }),
                        autoComplete: 'off',
                      })),
                      h(
                        Field,
                        {
                          label: t('zentaoBasicPassword'),
                          hint: t(hasSavedBasicPassword ? 'zentaoPasswordSaved' : 'zentaoPasswordMissing'),
                        },
                        h('input', {
                          className: 'tt-input',
                          type: 'password',
                          value: zentao.basicPassword,
                          onChange: (event) => setZentao({ basicPassword: event.target.value }),
                          autoComplete: 'new-password',
                        }),
                      ),
                    ),
                    h('span', { className: 'tt-hint' }, t('zentaoBasicHint')),
                  )
                : null,
              h(
                'div',
                { className: 'tt-row' },
                h(Field, { label: t('zentaoAccount') }, h('input', {
                  className: 'tt-input',
                  value: zentao.account ?? '',
                  onChange: (event) => setZentao({ account: event.target.value }),
                  autoComplete: 'off',
                })),
                h(
                  Field,
                  {
                    label: t('zentaoPassword'),
                    hint: boot?.credentials?.zentao?.password ? t('zentaoPasswordSaved') : t('zentaoPasswordMissing'),
                  },
                  h('input', {
                    className: 'tt-input',
                    type: 'password',
                    value: zentao.password ?? '',
                    onChange: (event) => setZentao({ password: event.target.value }),
                    placeholder: boot?.credentials?.zentao?.password ? '••••••••' : '',
                    autoComplete: 'new-password',
                  }),
                ),
              ),
            ),
        h(
          'div',
          { className: 'tt-row' },
          h(
            Field,
            { label: t('zentaoScope') },
            h(
              'select',
              {
                className: 'tt-select',
                value: zentaoScope,
                onChange: (event) => setZentao({ scope: event.target.value, containerIdsText: '', containerNames: {} }),
              },
              h('option', { value: 'product' }, t('zentaoScopeProduct')),
              h('option', { value: 'project' }, t('zentaoScopeProject')),
              h('option', { value: 'bug' }, t('zentaoScopeBug')),
            ),
          ),
          cliChannel
            ? h('span', { className: 'tt-hint' }, t('zentaoCliScopeHint'))
            : h(Field, { label: t(projectScope ? 'zentaoProjectId' : 'zentaoProductId'), hint: t('zentaoContainerHint') }, h('input', {
                className: 'tt-input',
                value: zentao.containerIdsText ?? '',
                onChange: (event) => setZentao({ containerIdsText: event.target.value }),
                placeholder: '1, 2',
              })),
        ),
        transportUsesMy
          ? h(
              'label',
              { className: 'tt-check' },
              h('input', {
                type: 'checkbox',
                checked: zentao.myWork !== false,
                onChange: (event) => setZentao({ myWork: event.target.checked }),
              }),
              h('span', null, t('zentaoMyWork'), h('span', { className: 'tt-hint' }, t('zentaoMyWorkHint'))),
            )
          : null,
        // Only the CLI channel skips containers. Turning 地盘 off must keep the
        // picker (that is the mode that enumerates), so this is not keyed on it.
        cliChannel
          ? null
          : h(
              'div',
              { className: 'tt-proj' },
              h(
                'div',
                { className: 'tt-proj-tools' },
                h(
                  'button',
                  { className: 'tt-btn tt-btn-small', onClick: onFetchZentaoContainers, disabled: zentaoBusy },
                  zentaoBusy ? t('zentaoFetchingContainers') : t(projectScope ? 'zentaoFetchProjects' : 'zentaoFetchProducts'),
                ),
                h('span', { className: 'tt-hint' }, `${t('projectSelected')} ${selectedZentaoIds.length}`),
              ),
              projectError ? h('span', { className: 'tt-hint' }, projectError) : null,
              zentaoChoices.map((item) =>
                h(
                  'label',
                  { className: 'tt-proj-row', key: `${item.kind}:${item.id}` },
                  h('input', {
                    type: 'checkbox',
                    checked: selectedZentaoIds.includes(item.id),
                    onChange: () => toggleZentaoContainer(item.id),
                  }),
                  h(
                    'span',
                    null,
                    h('span', { className: 'tt-proj-name' }, item.name),
                    h('span', { className: 'tt-proj-id', style: { display: 'block' } }, `${t(projectScope ? 'zentaoProjectId' : 'zentaoProductId')} · ${item.id}`),
                  ),
                ),
              ),
              zentaoCatalog && !zentaoBusy && !projectError && visibleZentaoContainers.length === 0
                ? h('span', { className: 'tt-hint' }, t(projectScope ? 'zentaoNoProjects' : 'zentaoNoProducts'))
                : null,
            ),
      )
      return h(
        Modal,
        { t, title: t('settings'), onClose },
        h(
          'div',
          { className: 'tt-stack' },
          zentaoSection,
          h(
            'div',
            { className: 'tt-row' },
            h(Field, { label: t('defaultWorkspace') }, h(
              'select',
              {
                className: 'tt-select',
                value: draft.defaultWorkspacePath,
                onChange: (event) => setDraft({ ...draft, defaultWorkspacePath: event.target.value }),
              },
              h('option', { value: '' }, '—'),
              (boot?.workspaces ?? []).map((workspace) =>
                h('option', { key: workspace.id, value: workspace.path }, `${workspace.title} — ${workspace.path}`),
              ),
            )),
            h(Field, { label: t('baseBranch') }, h('input', {
              className: 'tt-input',
              value: draft.baseBranch,
              onChange: (event) => setDraft({ ...draft, baseBranch: event.target.value }),
              placeholder: 'master',
            })),
          ),
          h(
            'label',
            { className: 'tt-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.excludeCompleted,
              onChange: (event) => setDraft({ ...draft, excludeCompleted: event.target.checked }),
            }),
            h('span', null, t('excludeCompleted')),
          ),
          error ? h(ErrorBox, { t, error }) : null,
          h(
            'div',
            { className: 'tt-modal-foot' },
            h('button', { className: 'tt-btn', onClick: onClose }, t('cancel')),
            h('button', { className: 'tt-btn tt-btn-primary', onClick: onSave, disabled: saving }, saving ? t('saving') : t('save')),
          ),
        ),
      )
    }

    /**
     * Write-back dialog: shows the exact request/command first, then executes.
     * Nothing here is automatic on purpose — a transition is real data in
     * someone else's system, and it may notify half the team.
     */
    function WriteModal(props) {
      const { t, item, action, input, setInput, plan, planError, busy, error, resolutions, bugTypes, users, peopleError, onSubmit, onClose } = props
      const kindLabel = item.kind === 'bug' ? t('zentaoKindBug') : item.kind === 'task' ? t('zentaoKindTask') : '需求'
      const set = (patch) => setInput({ ...input, ...patch })
      return h(
        Modal,
        { t, title: t('writeTitle'), onClose },
        h(
          'div',
          { className: 'tt-stack' },
          h(
            'div',
            { className: 'tt-dispatch-summary' },
            h('div', { className: 'tt-story-title' }, item.name),
            h(
              'div',
              { className: 'tt-meta' },
              h('span', { className: 'tt-chip tt-chip-id' }, `#${String(item.shortId || item.id).replace(/^#+/, '')}`),
              h('span', { className: 'tt-chip' }, kindLabel),
              item.vStatus ? h('span', { className: 'tt-chip' }, item.vStatus) : null,
            ),
          ),
          action === 'resolve'
            ? h(
                Field,
                { label: t('writeResolution') },
                h(
                  'select',
                  {
                    className: 'tt-select',
                    value: input.resolution ?? 'fixed',
                    onChange: (event) => set({ resolution: event.target.value }),
                  },
                  (resolutions ?? []).map((value) =>
                    h('option', { key: value, value }, `${t(`resolution_${value}`)} · ${value}`)),
                ),
              )
            : null,
          action === 'confirm'
            ? h(
                Field,
                { label: t('writeBugType') },
                h(
                  'select',
                  {
                    className: 'tt-select',
                    value: input.type ?? 'codeerror',
                    onChange: (event) => set({ type: event.target.value }),
                  },
                  (bugTypes ?? []).map((value) => h('option', { key: value, value }, value)),
                ),
              )
            : null,
          action === 'finish'
            ? h(
                Field,
                { label: t('writeCurrentConsumed'), hint: t('writeCurrentConsumedHint') },
                h('input', {
                  className: 'tt-input',
                  type: 'number',
                  step: '0.5',
                  min: '0',
                  value: input.currentConsumed ?? '',
                  onChange: (event) => set({ currentConsumed: event.target.value }),
                }),
              )
            : null,
          action === 'activate'
            ? h(
                Field,
                { label: t('writeLeft') },
                h('input', {
                  className: 'tt-input',
                  type: 'number',
                  step: '0.5',
                  min: '0',
                  value: input.left ?? '',
                  onChange: (event) => set({ left: event.target.value }),
                }),
              )
            : null,
          action === 'start' || action === 'finish'
            ? h(Field, { label: t('writeRealStarted'), hint: t('writeRealStartedHint') }, h('input', {
                className: 'tt-input',
                value: input.realStarted ?? '',
                placeholder: 'YYYY-MM-DD HH:mm:ss',
                onChange: (event) => set({ realStarted: event.target.value }),
              }))
            : null,
          action === 'finish'
            ? h(Field, { label: t('writeFinishedDate'), hint: t('writeRealStartedHint') }, h('input', {
                className: 'tt-input',
                value: input.finishedDate ?? '',
                placeholder: 'YYYY-MM-DD HH:mm:ss',
                onChange: (event) => set({ finishedDate: event.target.value }),
              }))
            : null,
          ['start', 'finish', 'activate', 'assign', 'confirm'].includes(action)
            ? h(
                Field,
                {
                  label: t('writeAssignedTo'),
                  hint: peopleError || (users && users.length === 0 ? t('writePeopleEmpty') : t('writeAssignedToHint')),
                },
                h(
                  'select',
                  {
                    className: 'tt-select',
                    value: input.assignedTo ?? '',
                    onChange: (event) => set({ assignedTo: event.target.value }),
                  },
                  action === 'assign'
                    ? (users && users.length === 0
                        ? h('option', { value: '' }, peopleError ? t('writePeopleFailed') : t('writePeopleEmpty'))
                        : null)
                    : h('option', { value: '' }, t('writeAssignedToKeep')),
                  (users ?? []).map((user) =>
                    h('option', { key: user.account, value: user.account }, `${user.name} · ${user.account}`)),
                ),
              )
            : null,
          action === 'assign'
            ? h('div', null,
                h('div', { className: 'tt-hint' }, t('writeAssignNoComment')),
                h('div', { className: 'tt-hint' }, t('writeAssignLeaves')))
            : h(
                Field,
                { label: t('writeComment'), hint: t('writeCommentHint') },
                h('textarea', {
                  className: 'tt-input',
                  rows: 3,
                  value: input.comment ?? '',
                  onChange: (event) => set({ comment: event.target.value }),
                }),
              ),
          h(
            'div',
            { className: 'tt-plan' },
            h('div', null, t('writePlanTitle')),
            plan
              ? h('div', null, plan.summary)
              : h('div', null, planError || t('writePlanLoading')),
            plan?.command ? h('code', null, `zentao ${plan.command.join(' ')}`) : null,
            plan?.request
              ? h('code', null, `${plan.request.method} ${plan.request.path} ${JSON.stringify(plan.request.body)}`)
              : null,
            h('div', { className: 'tt-plan-warn' }, t('writeWarn')),
          ),
          error ? h(ErrorBox, { t, error }) : null,
          h(
            'div',
            { className: 'tt-modal-foot' },
            h('button', { className: 'tt-btn', onClick: onClose }, t('cancel')),
            h(
              'button',
              {
                className: `tt-btn ${action === 'close' ? 'tt-btn-danger' : 'tt-btn-primary'}`,
                onClick: onSubmit,
                // A plan that failed to build must not be submittable.
                disabled: busy || !plan,
                title: planError || undefined,
              },
              busy ? t('writing') : t('writeConfirm'),
            ),
          ),
        ),
      )
    }

    function DispatchModal(props) {
      const { t, story, boot, form, setForm, onSubmit, onClose, busy, error } = props
      const workspaces = boot?.workspaces ?? []
      const selectValue = form.mode === 'custom' ? '__custom__' : form.workspaceId
      const existing = form.conversation === 'existing'
      const candidates = conversationOptions(story.dispatch)
      const checkout = story.dispatch?.branch ? story.dispatch : null
      const target = existing ? candidates.find((entry) => entry.sessionId === form.sessionId) : checkout
      const workspacePath = workspaces.find((workspace) => workspace.id === target?.workspaceId)?.path ||
        target?.worktreePath || target?.repoPath
      const confirm = existing ? 'prepareExisting' : checkout ? 'prepareNew' : 'dispatchConfirm'
      return h(
        Modal,
        { t, title: t('dispatchTitle'), onClose, compact: Boolean(checkout || candidates.length) },
        h(
          'div',
          { className: 'tt-stack' },
          h(
            'div',
            { className: 'tt-dispatch-summary' },
            h('div', { className: 'tt-story-title' }, story.name),
            h(
              'div',
              { className: 'tt-meta' },
              h('span', { className: 'tt-chip tt-chip-id' }, `#${String(story.shortId || story.id).replace(/^#+/, '')}`),
              story.source ? h('span', { className: 'tt-chip' }, t('provider' + story.source[0].toUpperCase() + story.source.slice(1))) : null,
              storyStatus(story) ? h('span', { className: 'tt-status ' + storyTone(story) }, storyStatus(story)) : null,
              story.app ? h('span', { className: 'tt-chip' }, story.app) : null,
            ),
          ),
          candidates.length ? h('div', {
            className: 'tt-seg tt-conversation-picker',
            role: 'group',
            'aria-label': t('chooseConversation'),
          },
            h('button', {
              type: 'button',
              className: existing ? 'tt-seg-on' : '',
              'aria-pressed': existing,
              disabled: busy,
              onClick: () => setForm({ ...form, conversation: 'existing' }),
            }, t('existingConversation')),
            h('button', {
              type: 'button',
              className: existing ? '' : 'tt-seg-on',
              'aria-pressed': !existing,
              disabled: busy,
              onClick: () => setForm({ ...form, conversation: 'new' }),
            }, t('newConversation'))) : null,
          existing && candidates.length > 1 ? h('select', {
            className: 'tt-select',
            'aria-label': t('existingConversation'),
            value: form.sessionId,
            disabled: busy,
            onChange: (event) => setForm({ ...form, sessionId: event.target.value }),
          }, candidates.map((entry) => h('option', { key: entry.sessionId, value: entry.sessionId },
            [entry.branch || entry.sessionId, entry.createdAt && formatDate(entry.createdAt)].filter(Boolean).join(' · ')))) : null,
          target?.branch ? h('div', { className: 'tt-dispatch-checkout', title: workspacePath },
            h('span', null, t('reuseCheckout')),
            h('code', null, target.branch)) : null,
          existing || checkout ? null :
          h(React.Fragment, null,
            h(
              Field,
              {
                label: t('dispatchBranch'),
                hint: t('dispatchBranchHint'),
                emphasis: true,
                badge: t('dispatchBranchRequiredTag'),
              },
              h('input', {
                className:
                  error?.code === 'dispatch/missing-branch' ? 'tt-input tt-input-key tt-input-invalid' : 'tt-input tt-input-key',
                value: form.branchName,
                onChange: (event) => setForm({ ...form, branchName: event.target.value }),
                autoComplete: 'off',
                spellCheck: false,
                autoFocus: true,
                'aria-required': true,
                'aria-invalid': error?.code === 'dispatch/missing-branch' || undefined,
              }),
            ),
            h(
              Field,
              { label: t('dispatchTarget'), hint: workspaces.length === 0 ? t('noWorkspace') : null },
              h(
                'select',
                {
                  className: 'tt-select',
                  value: selectValue,
                  onChange: (event) => {
                    const value = event.target.value
                    if (value === '__custom__') setForm({ ...form, mode: 'custom', workspaceId: '' })
                    else setForm({ ...form, mode: 'workspace', workspaceId: value })
                  },
                },
                workspaces.map((workspace) =>
                  h('option', { key: workspace.id, value: workspace.id }, `${workspace.title} — ${workspace.path}`),
                ),
                h('option', { value: '__custom__' }, t('dispatchCustom')),
              ),
            ),
            form.mode === 'custom'
              ? h(Field, { label: t('dispatchTarget') }, h('input', {
                  className: 'tt-input',
                  value: form.workspacePath,
                  onChange: (event) => setForm({ ...form, workspacePath: event.target.value }),
                  placeholder: '/Users/you/repo',
                }))
              : null,
            h(Field, { label: t('dispatchBase'), hint: t('dispatchBaseHint') }, h('input', {
              className: 'tt-input',
              value: form.baseBranch,
              onChange: (event) => setForm({ ...form, baseBranch: event.target.value }),
              placeholder: 'master',
            })),
            h(
              'div',
              { className: 'tt-options' },
              h(
                'label',
                { className: 'tt-check' },
                h('input', {
                  type: 'checkbox',
                  checked: form.useWorktree,
                  onChange: (event) => setForm({ ...form, useWorktree: event.target.checked }),
                }),
                h(
                  'span',
                  null,
                  t('dispatchWorktree'),
                  h('span', { className: 'tt-hint' }, t('dispatchWorktreeHint')),
                ),
              ),
              form.useWorktree
                ? null
                : h(
                    'label',
                    { className: 'tt-check' },
                    h('input', {
                      type: 'checkbox',
                      checked: form.smartCheckout !== false,
                      onChange: (event) => setForm({ ...form, smartCheckout: event.target.checked }),
                    }),
                    h(
                      'span',
                      null,
                      t('smartCheckout'),
                      h('span', { className: 'tt-hint' }, t('smartCheckoutHint')),
                    ),
                  ),
            ),
          ),
          h('details', { className: 'tt-dispatch-extra' },
            h('summary', null, t('dispatchPrompt')),
            h('textarea', {
              className: 'tt-textarea',
              'aria-label': t('dispatchPrompt'),
              placeholder: t('extraPromptPlaceholder'),
              value: form.prompt,
              onChange: (event) => setForm({ ...form, prompt: event.target.value }),
            })),
          error ? h('div', { className: 'tt-dispatch-error', role: 'alert', title: error.code },
            error.message || t('errorGeneric')) : null,
          h(
            'div',
            { className: 'tt-modal-foot' },
            h('span', { className: 'tt-dispatch-footnote' }, t('draftOnly')),
            h('button', { className: 'tt-btn', onClick: onClose, disabled: busy }, t('cancel')),
            h('button', { className: 'tt-btn tt-btn-primary', onClick: onSubmit, disabled: busy }, busy ? t('dispatching') : t(confirm)),
          ),
        ),
      )
    }

    function Panel(props) {
      const t = props.t
      const openSession = props.openSession
      const prepareDraft = props.prepareDraft
      const [boot, setBoot] = React.useState(null)
      const [tasks, setTasks] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [filter, setFilter] = React.useState('open')
      const [view, setView] = React.useState('board')
      const [query, setQuery] = React.useState('')
      const [searchOpen, setSearchOpen] = React.useState(false)
      const searchButton = React.useRef(null)
      const closeSearch = () => {
        setSearchOpen(false)
        setQuery('')
        searchButton.current?.focus()
      }
      const [project, setProject] = React.useState('')
      const [syncError, setSyncError] = React.useState('')
      const latestTaskRequest = React.useRef(0)
      const tasksLoading = React.useRef(false)
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [draft, setDraft] = React.useState({
        zentao: {
          baseUrl: '',
          transport: 'v1',
          cliBin: 'zentao',
          myWork: true,
          basicAuth: false,
          basicAccount: '',
          basicPassword: '',
          account: '',
          password: '',
          scope: 'product',
          containerIdsText: '',
          containerNames: {},
        },
        defaultWorkspacePath: '',
        baseBranch: '',
        excludeCompleted: true,
      })
      const [projectError, setProjectError] = React.useState('')
      const [zentaoCatalog, setZentaoCatalog] = React.useState(null)
      const [zentaoBusy, setZentaoBusy] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [settingsError, setSettingsError] = React.useState(null)
      const [dialog, setDialog] = React.useState(null)
      // Write-back: { item, action, input }. The plan is fetched from the host
      // so the preview and the execution cannot drift apart.
      const [write, setWrite] = React.useState(null)
      const [writePlan, setWritePlan] = React.useState(null)
      const [writePlanError, setWritePlanError] = React.useState('')
      const [people, setPeople] = React.useState(null)
      const [peopleError, setPeopleError] = React.useState('')
      const [scopeBusy, setScopeBusy] = React.useState(false)
      const [writing, setWriting] = React.useState(false)
      const [writeError, setWriteError] = React.useState(null)
      const [form, setForm] = React.useState({ mode: 'workspace', workspaceId: '', workspacePath: '', baseBranch: '', useWorktree: true, smartCheckout: true, prompt: '', branchName: '' })
      const [dispatching, setDispatching] = React.useState(false)
      const [backfilling, setBackfilling] = React.useState('')
      const [dispatchError, setDispatchError] = React.useState(null)
      const [toast, setToast] = React.useState('')
      const alive = React.useRef(true)

      React.useEffect(() => {
        return () => {
          alive.current = false
        }
      }, [])

      React.useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(''), 3000)
        return () => clearTimeout(timer)
      }, [toast])

      // Navigation failures used to be swallowed; surface them as a toast.
      const revealSession = (sessionId) => {
        if (!sessionId || typeof openSession !== 'function') return
        Promise.resolve(openSession(sessionId))
          .then((result) => {
            if (!result || result.ok || !alive.current) return
            setToast(result.reason === 'service' ? t('openUnavailable') : t('openFailed'))
          })
          .catch(() => {
            if (alive.current) setToast(t('openFailed'))
          })
      }

      // A task dispatched as a draft keeps its requirement in the record, so
      // opening it again restores the composer instead of showing an empty one.
      const openTask = (sessionId, dispatch) => {
        if (!sessionId) return
        if (dispatch?.draft?.text && typeof prepareDraft === 'function') {
          Promise.resolve(prepareDraft({ sessionId, draft: dispatch.draft }))
            .then((result) => {
              if (alive.current && result && !result.ok) setToast(t('draftFailed'))
            })
            .catch(() => {
              if (alive.current) setToast(t('draftFailed'))
            })
          return
        }
        revealSession(sessionId)
      }

      const applyBoot = React.useCallback((next) => {
        setBoot(next)
        badgeChannel.value = next?.capabilities?.channel ?? ''
        const settings = next.settings ?? {}
        const zentao = settings.zentao ?? {}
        setDraft((current) => ({
          ...current,
          zentao: {
            baseUrl: zentao.baseUrl ?? '',
            transport: zentao.transport ?? 'v1',
            cliBin: zentao.cliBin ?? 'zentao',
            myWork: zentao.myWork !== false,
            basicAuth: zentao.basicAuth === true,
            basicAccount: zentao.basicAccount ?? '',
            basicPassword: '',
            account: zentao.account ?? '',
            password: '',
            scope: zentao.scope ?? 'product',
            containerIdsText: (zentao.containerIds ?? []).join(', '),
            containerNames: zentao.containerNames ?? {},
          },
          defaultWorkspacePath: settings.defaultWorkspacePath ?? '',
          baseBranch: settings.baseBranch ?? '',
          excludeCompleted: settings.excludeCompleted !== false,
        }))
      }, [])

      const loadTasks = React.useCallback(async ({ background = false } = {}) => {
        if (background && tasksLoading.current) return
        const request = ++latestTaskRequest.current
        tasksLoading.current = true
        if (!background) setLoading(true)
        setError(null)
        try {
          const result = await api('tasks', { includeCompleted: true, includeStatusOptions: true })
          if (!alive.current || request !== latestTaskRequest.current) return
          setTasks(result)
          // Free badge update: the list already carries every status.
          badgeStore.set(countItems(result.stories))
          setSyncError('')
        } catch (failure) {
          if (!alive.current || request !== latestTaskRequest.current) return
          if (background) setSyncError(failure.message)
          else setError({ message: failure.message, code: failure.code })
        } finally {
          if (request === latestTaskRequest.current) {
            tasksLoading.current = false
            if (alive.current && !background) setLoading(false)
          }
        }
      }, [])

      const loadBoot = React.useCallback(async () => {
        const next = await api('state')
        if (!alive.current) return next
        applyBoot(next)
        return next
      }, [applyBoot])

      React.useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const next = await api('state')
            if (cancelled) return
            applyBoot(next)
            if (next.settings?.excludeCompleted === false) setFilter('all')
            await loadTasks()
          } catch (failure) {
            if (cancelled) return
            setError({ message: failure.message, code: failure.code })
            setLoading(false)
          }
        })()
        return () => {
          cancelled = true
        }
      }, [applyBoot, loadTasks])

      React.useEffect(() => {
        if (!tasks) return undefined
        const timer = setInterval(() => {
          if (document.visibilityState !== 'hidden') void loadTasks({ background: true })
        }, SYNC_MS)
        return () => clearInterval(timer)
      }, [Boolean(tasks), loadTasks])

      // Light polling: only session run-state changes, never a full re-list.
      React.useEffect(() => {
        if (!tasks) return undefined
        let disposed = false
        const tick = async () => {
          try {
            const snapshot = await api('status')
            if (disposed || !alive.current) return
            const byUid = Object.fromEntries(
              (snapshot.entries ?? []).map((entry) => [entry.uid ?? entry.storyId, entry]),
            )
            setTasks((current) => {
              if (!current) return current
              return {
                ...current,
                stories: current.stories.map((story) => {
                  const entry = byUid[story.uid] ?? byUid[story.id]
                  if (!entry) return story
                  return {
                    ...story,
                    dispatch: {
                      ...(story.dispatch ?? {}),
                      sessionId: entry.sessionId,
                      branch: entry.branch,
                      workspaceId: entry.workspaceId,
                      worktreePath: entry.worktreePath ?? story.dispatch?.worktreePath,
                      repoPath: entry.repoPath ?? story.dispatch?.repoPath,
                      createdAt: entry.createdAt,
                      running: Boolean(entry.running),
                      sessionMissing: Boolean(entry.sessionMissing),
                      statusUnavailable: Boolean(entry.statusUnavailable),
                      draftWaiting: Boolean(entry.draftWaiting),
                      draftPending: Boolean(entry.draftPending),
                      attachments: entry.attachments ?? story.dispatch?.attachments,
                      images: entry.images ?? story.dispatch?.images,
                      draft: 'draft' in entry ? entry.draft : entry.sessionId === story.dispatch?.sessionId ? story.dispatch?.draft : null,
                      previousSessions: entry.previousSessions ?? story.dispatch?.previousSessions,
                    },
                  }
                }),
              }
            })
          } catch {
            // Polling is best-effort; the explicit refresh reports real errors.
          }
        }
        const timer = setInterval(() => {
          if (document.visibilityState !== 'hidden') void tick()
        }, POLL_MS)
        return () => {
          disposed = true
          clearInterval(timer)
        }
      }, [tasks !== null])

      const openSettings = () => {
        setSettingsError(null)
        setProjectError('')
        setSettingsOpen(true)
        void loadBoot().catch(() => {})
      }

      const fetchZentaoContainers = async () => {
        setZentaoBusy(true)
        setZentaoCatalog(null)
        setProjectError('')
        try {
          const result = await api('containers', {
            baseUrl: draft.zentao.baseUrl.trim(),
            transport: draft.zentao.transport,
            basicAuth: draft.zentao.basicAuth,
            basicAccount: draft.zentao.basicAccount.trim(),
            basicPassword: draft.zentao.basicAuth ? draft.zentao.basicPassword : undefined,
            account: draft.zentao.account.trim(),
            password: draft.zentao.password,
          })
          if (!alive.current) return
          const list = [
            ...(result.products ?? []).map((item) => ({ ...item, kind: 'product' })),
            ...(result.projects ?? []).map((item) => ({ ...item, kind: 'project' })),
          ]
          setZentaoCatalog(list)
        } catch (failure) {
          if (!alive.current) return
          setProjectError(failure.message)
        } finally {
          if (alive.current) setZentaoBusy(false)
        }
      }

      const saveSettings = async () => {
        setSaving(true)
        setSettingsError(null)
        try {
          const zentaoScope = draft.zentao.scope
          const containerIds = parseZentaoIds(draft.zentao.containerIdsText)
          const containerNames = { ...draft.zentao.containerNames }
          const containerKind = zentaoScope === 'project' ? 'project' : 'product'
          for (const item of zentaoCatalog ?? []) {
            if (item.kind === containerKind && containerIds.includes(item.id)) containerNames[item.id] = item.name
          }
          const patch = {
            zentao: {
              baseUrl: draft.zentao.baseUrl.trim(),
              transport: draft.zentao.transport,
              cliBin: draft.zentao.cliBin,
              myWork: draft.zentao.myWork !== false,
              basicAuth: draft.zentao.basicAuth,
              basicAccount: draft.zentao.basicAccount.trim(),
              account: draft.zentao.account.trim(),
              scope: zentaoScope,
              containerIds,
              containerNames,
            },
            defaultWorkspacePath: draft.defaultWorkspacePath,
            baseBranch: draft.baseBranch.trim(),
            excludeCompleted: Boolean(draft.excludeCompleted),
          }
          if (draft.zentao.password) patch.zentaoPassword = draft.zentao.password
          if (draft.zentao.basicAuth && draft.zentao.basicPassword) patch.zentaoBasicPassword = draft.zentao.basicPassword
          const next = await api('settings', patch)
          if (!alive.current) return
          applyBoot(next)
          setProject('')
          setFilter(next.settings?.excludeCompleted === false ? 'all' : 'open')
          setSettingsOpen(false)
          setToast(t('saveDone'))
          await loadTasks()
        } catch (failure) {
          if (!alive.current) return
          setSettingsError({ message: failure.message, code: failure.code })
        } finally {
          if (alive.current) setSaving(false)
        }
      }

      const canWriteBack = boot?.capabilities?.writeBack === true

      const stampNow = () => {
        const date = new Date()
        const pad = (value) => String(value).padStart(2, '0')
        return [
          `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
          `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
        ].join(' ')
      }

      // The roster is only needed once a dialog offers 「指派给」.
      const loadPeople = async () => {
        try {
          const value = await api('users')
          if (!alive.current) return
          setPeople(value?.users ?? [])
          setPeopleError('')
        } catch (failure) {
          // An empty roster and a failing route look identical downstream, so
          // keep the reason: "no permission" must not read as "nobody to pick".
          if (!alive.current) return
          setPeople([])
          setPeopleError(failure?.message || String(failure))
        }
      }

      const startWrite = (story, action) => {
        const branch = story.dispatch?.branch
        const now = stampNow()
        const input = {}
        if (action === 'start') {
          input.realStarted = story.realStarted || now
          input.comment = branch ? `已派发 DSH 会话，工作分支 ${branch}` : '已派发 DSH 会话'
        } else if (action === 'finish') {
          // All three are required by ZenTao; prefill them so a click works.
          input.currentConsumed = String(story.estimate ?? 0)
          input.realStarted = story.realStarted || story.begin || now
          input.finishedDate = now
        } else if (action === 'activate') {
          input.left = String(story.left ?? 0)
        } else if (action === 'resolve') {
          input.resolution = 'fixed'
        } else if (action === 'confirm') {
          input.type = 'codeerror'
        } else if (action === 'assign') {
          input.assignedTo = ''
        }
        setWrite({ item: story, action, input })
        setPeopleError('')
        setWritePlan(null)
        setWritePlanError('')
        setWriteError(null)
        if (['start', 'finish', 'activate', 'assign', 'confirm'].includes(action)) void loadPeople()
      }

      // Re-plan whenever the target or the input changes: the dialog always
      // shows exactly what confirm would send.
      React.useEffect(() => {
        if (!write) {
          setWritePlan(null)
          return undefined
        }
        let alive = true
        // The dialog must never offer to confirm a plan it no longer shows.
        setWritePlan(null)
        const timer = setTimeout(() => {
          api('write', { item: write.item, action: write.action, input: write.input, confirm: false })
            .then((value) => {
              if (!alive) return
              setWritePlan(value.plan)
              setWritePlanError('')
            })
            .catch((failure) => {
              if (!alive) return
              setWritePlan(null)
              setWritePlanError(failure.message)
            })
        }, 220)
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [write])

      const submitWrite = async () => {
        if (!write) return
        setWriting(true)
        setWriteError(null)
        try {
          const result = await api('write', {
            item: write.item,
            action: write.action,
            input: write.input,
            confirm: true,
          })
          if (!alive.current) return
          const state = result?.verification?.statusLabel || '—'
          setToast(result?.verifyError ? `${t('writeDone').replace('{state}', state)}（${t('writeUnverified')}）` : t('writeDone').replace('{state}', state))
          setWrite(null)
          await loadTasks({ background: true })
          void refreshBadgeCount()
        } catch (failure) {
          if (!alive.current) return
          setWriteError({ message: failure.message, code: failure.code })
        } finally {
          if (alive.current) setWriting(false)
        }
      }

      const savedScope = () => boot?.settings?.zentao?.scope ?? 'product'

      /**
       * The read scope decides what the list is *about*, so it belongs on the
       * panel next to the tabs rather than three clicks deep in settings.
       */
      const changeScope = async (scope) => {
        if (!scope || scope === savedScope() || scopeBusy) return
        setScopeBusy(true)
        try {
          const next = await api('settings', { zentao: { scope } })
          if (!alive.current) return
          applyBoot(next)
          setQuery('')
          setProject('')
          setFilter('open')
          setView('board')
          await loadTasks()
        } catch (failure) {
          if (alive.current) setToast(failure.message)
        } finally {
          if (alive.current) setScopeBusy(false)
        }
      }

      const startDispatch = (story) => {
        const workspaces = boot?.workspaces ?? []
        const settings = boot?.settings ?? {}
        const preferred = workspaces.find((workspace) => workspace.path === settings.defaultWorkspacePath) ?? workspaces[0]
        const original = conversationOptions(story.dispatch)[0]
        setForm({
          conversation: original ? 'existing' : 'new',
          sessionId: original?.sessionId ?? '',
          requestId: globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random(),
          mode: preferred ? 'workspace' : 'custom',
          workspaceId: preferred?.id ?? '',
          workspacePath: preferred?.path ?? '',
          baseBranch: settings.baseBranch ?? '',
          useWorktree: settings.useWorktree !== false,
          smartCheckout: true,
          // A bug is not a spec: the first job is to reproduce it.
          prompt: story.kind === 'bug' ? '先复现这个 Bug 并确认根因，再动手修改。' : '',
          branchName: '',
        })
        setDispatchError(null)
        setDialog(story)
      }

      const submitDispatch = async () => {
        if (!dialog) return
        setDispatching(true)
        setDispatchError(null)
        try {
          const continuing = form.conversation === 'existing'
          const needsCheckout = !continuing && !dialog.dispatch?.branch
          const branchName = form.branchName.trim()
          if (needsCheckout && !branchName) {
            setDispatchError({ message: t('dispatchBranchRequired'), code: 'dispatch/missing-branch' })
            setDispatching(false)
            return
          }
          const body = {
            storyId: dialog.id,
            conversation: form.conversation,
            sessionId: continuing ? form.sessionId : undefined,
            requestId: form.requestId,
            uid: dialog.uid,
            projectId: dialog.projectId,
            story: { ...dialog, dispatch: undefined },
            extraInstructions: form.prompt.trim(),
          }
          if (needsCheckout) {
            body.branchName = branchName
            body.useWorktree = Boolean(form.useWorktree)
            body.smartCheckout = form.smartCheckout !== false
            body.baseBranch = form.baseBranch.trim()
            if (form.mode === 'custom') body.workspacePath = form.workspacePath.trim()
            else body.workspaceId = form.workspaceId
          }
          const record = await api('dispatch', body)
          if (!alive.current) return
          setDialog(null)
          if (continuing || record.continuation) {
            const result = record.draft ? await prepareDraft?.({ ...record, continuation: true }) : await openSession?.(record.sessionId)
            if (!alive.current) return
            if (!result?.ok) setToast(t('draftFailed'))
            else if (result.preserved) setToast(t('existingDraftPreserved'))
            else if (result.missing?.length) setToast(t('draftPartial').replace('{n}', String(result.missing.length)))
            else if (record.draft) setToast(t('draftReady'))
            void loadTasks({ background: true })
            return
          }
          // A draft dispatch leaves the session empty on purpose: the panel
          // fills the composer and the operator decides when to send.
          const isDraft = record.status === 'draft' || Boolean(record.draft)
          setToast(
            record.assetsAdded
              ? t('assetsAdded')
              : isDraft
                ? t('draftReady')
                : record.attachments?.length
                  ? t('dispatchedWithAttachments').replace('{n}', String(record.attachments.length))
                  : t('dispatched'),
          )
          // 派发即回写: a dispatched task is a started task, so open the plan
          // right away — the operator still confirms it.
          if (canWriteBack && dialog.kind === 'task' && !dialog.completed &&
              (!dialog.status || dialog.status === 'wait')) {
            startWrite({ ...dialog, dispatch: { ...(dialog.dispatch ?? {}), branch: record.branch || dialog.dispatch?.branch } }, 'start')
          }
          setTasks((current) => {
            if (!current) return current
            return {
              ...current,
              stories: current.stories.map((story) =>
                (story.uid ?? story.id) === (dialog.uid ?? dialog.id)
                  ? {
                      ...story,
                      dispatch: {
                        sessionId: record.sessionId,
                        branch: record.branch,
                        workspaceId: record.workspaceId,
                        baseBranch: record.baseBranch,
                        worktreePath: record.worktreePath,
                        repoPath: record.repoPath,
                        createdAt: record.createdAt,
                        running: !isDraft,
                        status: record.status ?? '',
                        draft: record.draft ?? null,
                        draftWaiting: record.draftWaiting ?? isDraft,
                        draftPending: Boolean(record.draftPending),
                        previousSessions: record.previousSessions ?? [],
                        sessionMissing: false,
                        attachments: record.attachments ?? [],
                        images: record.images ?? [],
                      },
                    }
                  : story,
              ),
            }
          })
          if (record.sessionId) {
            setTimeout(() => {
              if (isDraft && typeof props.prepareDraft === 'function') {
                Promise.resolve(props.prepareDraft(record))
                  .then((result) => {
                    if (!alive.current) return
                    if (!result?.ok) setToast(t('draftFailed'))
                    else if (result.missing?.length) setToast(t('draftPartial').replace('{n}', String(result.missing.length)))
                  })
                  .catch(() => {
                    if (alive.current) setToast(t('draftFailed'))
                  })
                return
              }
              revealSession(record.sessionId)
            }, 60)
          }
        } catch (failure) {
          if (!alive.current) return
          setDispatchError({ message: failure.message, code: failure.code })
        } finally {
          if (alive.current) setDispatching(false)
        }
      }

      // The button only works when the host route understands the backfill
      // path; an old host would just return the text-only session.
      // The host advertises what it can do; a version comparison against the
      // plugin's own version could never be satisfied.
      const backfillSupported = boot?.capabilities?.backfill === true

      const backfillAssets = async (story) => {
        setBackfilling(story.uid ?? story.id)
        try {
          const retryDraft = story.dispatch?.draftPending === true
          const refreshDraft = !retryDraft && Boolean(story.dispatch?.draft)
          const record = await api('dispatch', {
            storyId: story.id,
            conversation: retryDraft ? 'retry' : undefined,
            uid: story.uid,
            projectId: story.projectId,
            story: { ...story, dispatch: undefined },
            refreshDraft,
            deliver: refreshDraft || retryDraft ? 'draft' : 'send',
          })
          if (!alive.current) return
          if ((refreshDraft && record.draft?.detailsLoaded) || retryDraft) {
            const result = await prepareDraft?.(record)
            if (!alive.current) return
            if (!result?.ok) setToast(t('draftFailed'))
            else if (result.alreadyStarted) setToast(t('refreshDraftStarted'))
            else if (result.preserved) setToast(t('refreshDraftPreserved'))
            else if (result.missing?.length) setToast(t('draftPartial').replace('{n}', String(result.missing.length)))
            else setToast(t('draftReady'))
          } else if (record.assetsAdded) {
            setToast(t('assetsAdded'))
            if (record.sessionId) {
              setTimeout(() => revealSession(record.sessionId), 60)
            }
          } else {
            setToast(t('assetsUpToDate'))
          }
          await loadTasks()
        } catch (failure) {
          if (alive.current) setToast(failure.message)
        } finally {
          if (alive.current) setBackfilling('')
        }
      }

      const currentScope = tasks?.scope ?? boot?.settings?.zentao?.scope
      React.useEffect(() => {
        // Switching the read scope away from bugs used to leave `view` on
        // 'matrix' with nothing rendered and no way back.
        if (view === 'matrix' && currentScope !== 'bug') setView('board')
      }, [view, currentScope])

      const stories = tasks?.stories ?? []
      const matching = filterStories(stories, query, project)
      const visible = matching.filter((story) => filter === 'open' ? !story.completed : filter === 'done' ? story.completed : true)
      const counts = {
        all: matching.length,
        open: matching.filter((story) => !story.completed).length,
        done: matching.filter((story) => story.completed).length,
      }
      const configuredStatuses = filter === 'all' && !query.trim() ? tasks?.statusOptions ?? [] : []
      const bugScope = (tasks?.scope ?? boot?.settings?.zentao?.scope) === 'bug'
      const showMatrix = bugScope && view === 'matrix'
      const matrix = showMatrix ? bugMatrix(visible) : null
      const groups = view === 'list'
        ? buildGroups(visible, tasks?.iterations ?? [])
        : groupByStatus(visible, t('unknownStatus'), configuredStatuses)
      const projects = new Map()
      for (const story of stories) {
        if (story.projectId) {
          const names = boot?.settings?.zentao?.containerNames
          const id = `${story.source}:${story.projectId}`
          projects.set(id, names?.[story.projectId] || story.projectId)
        }
      }
      const renderFilter = (label, value, choices, onChange) => h('select', {
        className: 'tt-select tt-filter-select',
        'aria-label': label,
        value,
        onChange: (event) => onChange(event.target.value),
      }, h('option', { value: '' }, label), [...choices].map(([key, name]) => h('option', { key, value: key }, name)))
      const errorCode = String(error?.code ?? '')
      const setupError = Boolean(
        error &&
          (errorCode.endsWith('/missing-credentials') ||
            errorCode.endsWith('/missing-base-url') ||
            errorCode.endsWith('/missing-container') ||
            errorCode.endsWith('/missing-projects') ||
            errorCode.endsWith('/missing-nick')),
      )
      const zentaoSettings = boot?.settings?.zentao
      const projectLabel = (zentaoSettings?.containerIds ?? [])
        .map((id) => zentaoSettings.containerNames?.[id] || id)
        .join(' · ')
      const renderStory = (Component, story) => h(Component, {
        key: story.uid ?? story.id,
        story, t, onDispatch: startDispatch, onOpen: openTask,
        onWrite: canWriteBack ? startWrite : undefined,
        onBackfill: backfillSupported || story.dispatch?.draftPending ? backfillAssets : undefined,
        backfilling,
      })

      const tab = (key, label) =>
        h(
          'button',
          { className: 'tt-tab' + (filter === key ? ' tt-tab-on' : ''), 'aria-pressed': filter === key, onClick: () => setFilter(key) },
          label,
          h('span', { className: 'tt-tab-total' }, counts[key]),
        )

      return h(
        'div',
        { className: 'tt-root' },
        h(
          'div',
          { className: 'tt-shell' },
          h(
            'div',
            { className: 'tt-head' },
            h(
              'div',
              { className: 'tt-head-main' },
              h('span', { className: 'tt-head-mark' }, h(Icon, { size: 25 })),
              h(
                'div',
                { className: 'tt-head-copy' },
                h('h1', { className: 'tt-title' }, t('title')),
                h('div', { className: 'tt-sub' }, [t('subtitle'), projectLabel].filter(Boolean).join(' · ')),
              ),
            ),
            h(
              'div',
              { className: 'tt-head-actions' },
              tasks ? h('div', { className: 'tt-search-control', role: 'search' },
                searchOpen ? h('input', {
                  id: 'tt-task-search',
                  type: 'search',
                  className: 'tt-input tt-search',
                  'aria-label': t('taskSearch'),
                  placeholder: t('taskSearch'),
                  autoFocus: true,
                  value: query,
                  onChange: (event) => setQuery(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeSearch()
                    }
                  },
                }) : null,
                h('button', {
                  type: 'button',
                  className: 'tt-btn',
                  ref: searchButton,
                  'aria-expanded': searchOpen,
                  'aria-controls': searchOpen ? 'tt-task-search' : undefined,
                  onClick: () => searchOpen ? closeSearch() : setSearchOpen(true),
                }, h(ToolIcon, { name: 'search' }), t('search')),
              ) : null,
              h('button', { className: 'tt-btn', onClick: () => void loadTasks(), disabled: loading }, h(ToolIcon, { name: 'refresh' }), loading ? t('loading') : t('refresh')),
              h('button', { className: 'tt-btn', onClick: openSettings }, h(ToolIcon, { name: 'settings' }), t('settings')),
            ),
          ),
          setupError
            ? h(
                'div',
                { className: 'tt-note' },
                h('div', { className: 'tt-note-title' }, t('needSetup')),
                h('div', null, t('needSetupHint')),
                h('button', { className: 'tt-btn tt-btn-primary', onClick: openSettings }, t('goSettings')),
              )
            : null,
          error && !setupError ? h(ErrorBox, { t, error, onRetry: () => void loadTasks() }) : null,
          syncError ? h('div', { className: 'tt-sync-note', role: 'status' }, `${t('syncFailed')} · ${syncError}`) : null,
          loading && !tasks
            ? h('div', { className: 'tt-note' }, h('div', null, t('loading')))
            : null,
          tasks
            ? h(
                'div',
                { className: 'tt-toolbar' },
                h(
                  'div',
                  { className: 'tt-tabs tt-filters', role: 'group', 'aria-label': t('taskFilters') },
                  tab('open', t('filterOpen')),
                  tab('all', t('filterAll')),
                  tab('done', t('filterDone')),
                ),
                h(
                  'label',
                  { className: 'tt-scope', title: t('scopeSwitchHint') },
                  h('span', { className: 'tt-hint tt-scope-label' }, t('zentaoScope')),
                  h(
                    'select',
                    {
                      className: 'tt-select tt-scope-select',
                      value: tasks.scope ?? boot?.settings?.zentao?.scope ?? 'product',
                      disabled: Boolean(scopeBusy),
                      'aria-label': t('zentaoScope'),
                      onChange: (event) => void changeScope(event.target.value),
                    },
                    h('option', { value: 'product' }, t('zentaoScopeProduct')),
                    h('option', { value: 'project' }, t('zentaoScopeProject')),
                    h('option', { value: 'bug' }, t('zentaoScopeBug')),
                  ),
                ),
                projects.size > 1 || project ? renderFilter(t('allProjects'), project, projects, setProject) : null,
                bugScope ? h('div', { className: 'tt-tabs tt-filters', role: 'group', 'aria-label': t('taskFilters') },
                  ['board', 'matrix'].map((key) => h('button', {
                    key,
                    className: 'tt-tab' + (view === key ? ' tt-tab-on' : ''),
                    'aria-pressed': view === key,
                    onClick: () => setView(key),
                  }, key === 'matrix' ? t('matrixView') : t('boardView')))) : null,
                LIST_VIEW_ENABLED ? h('div', { className: 'tt-tabs tt-filters', role: 'group', 'aria-label': t('taskFilters') },
                  ['list', 'board'].map((key) => h('button', {
                    key,
                    className: 'tt-tab' + (view === key ? ' tt-tab-on' : ''),
                    'aria-pressed': view === key,
                    onClick: () => setView(key),
                  }, t(`${key}View`)))) : null,
                h('span', { className: 'tt-count' }, `${visible.length} / ${matching.length} ${t('storyCount')}`),
              )
            : null,
          tasks && visible.length === 0
            ? h(
                'div',
                { className: 'tt-note' },
                h('div', { className: 'tt-note-title' }, t('empty')),
                h('div', null, t(stories.length ? 'noMatches' : tasks.ownerFilteredEmpty ? 'zentaoUnassignedHint' : 'emptyHint')),
                filter === 'open' && counts.done > 0
                  ? h(
                      'button',
                      { className: 'tt-btn tt-btn-small', onClick: () => setFilter('done') },
                      t('jumpToDone').replace('{n}', String(counts.done)),
                    )
                  : null,
              )
            : null,
          showMatrix
            ? h(
                'div',
                { className: 'tt-matrix', style: { '--tt-cols': String(matrix.statuses.length) } },
                h('div', { className: 'tt-matrix-corner' }, t('matrixSeverity')),
                matrix.statuses.map((status) =>
                  h(
                    'div',
                    { key: status.key, className: 'tt-matrix-head' },
                    status.label,
                    h('span', { className: 'tt-tab-total' }, matrix.rows.reduce((sum, row) => sum + (row.cells.find((cell) => cell.key === status.key)?.items.length ?? 0), 0)),
                  )),
                matrix.rows.flatMap((row) => [
                  h('div', { key: `row-${row.key || 'none'}`, className: 'tt-matrix-row-head' }, row.label),
                  ...row.cells.map((cell) =>
                    h(
                      'div',
                      {
                        key: `${row.key || 'none'}:${cell.key}`,
                        className: 'tt-matrix-cell' + (cell.items.length ? '' : ' tt-matrix-cell-empty'),
                      },
                      cell.items.slice(0, 4).map((item) =>
                        h(
                          'button',
                          {
                            key: item.uid ?? item.id,
                            className: 'tt-matrix-item',
                            onClick: () => startDispatch(item),
                            title: item.name,
                          },
                          h('span', { className: 'tt-matrix-item-id' }, `#${String(item.shortId || item.id).replace(/^#+/, '')}`),
                          h('span', null, item.name),
                        )),
                      cell.items.length > 4
                        ? h('span', { className: 'tt-matrix-more' }, `+${cell.items.length - 4}`)
                        : null,
                    )),
                ]),
              )
            : null,
          showMatrix && matrix && matrix.stray.length
            ? h(
                'div',
                { className: 'tt-matrix-stray' },
                h('div', { className: 'tt-hint' }, t('matrixStray')),
                matrix.stray.map((item) =>
                  h(
                    'button',
                    {
                      key: item.uid ?? item.id,
                      className: 'tt-btn tt-btn-small',
                      title: item.name,
                      onClick: () => startDispatch(item),
                    },
                    `#${String(item.shortId || item.id).replace(/^#+/, '')} ${item.name}`,
                  )),
              )
            : null,
          !showMatrix && view === 'board' && groups.length ? h('div', { className: 'tt-board' },
            groups.map((group) => h('section', { className: 'tt-board-column', key: group.name },
              h('h2', null, group.name, h('span', { className: 'tt-tab-total' }, group.stories.length)),
              h('div', { className: 'tt-board-cards' }, group.stories.map((story) => renderStory(TaskCard, story))),
            ))) : null,
          view === 'list' ? h(
            'div',
            { className: 'tt-list' },
            groups.map((group) =>
              h(
                'div',
                { className: 'tt-group', key: group.name || '__none__' },
                h(
                  'div',
                  { className: 'tt-group-head' },
                  h('span', null, group.name || t('iterationUnknown')),
                  group.range && group.range[0]
                    ? h('span', { className: 'tt-group-range' }, `${formatDate(group.range[0])} ~ ${formatDate(group.range[1])}`)
                    : null,
                  h('span', { className: 'tt-group-count' }, `${group.stories.length} ${t('storyCount')}`),
                ),
                h(
                  'div',
                  { className: 'tt-shead' },
                  h('span', null, 'ID'),
                  h('span', null, t('storyColumn')),
                  h('span', null, t('statusColumn')),
                  h('span', null, t('ownerColumn')),
                  h('span', { style: { textAlign: 'right' } }, t('actionColumn')),
                ),
                group.stories.map((story) => renderStory(StoryRow, story)),
              ),
            ),
          ) : null,
          boot
            ? h(
                'div',
                { className: 'tt-footer' },
                h('span', null, `${t('dataDir')}: ${boot.dataDir}`),
                h('span', null, `v${boot.version}`),
                boot.services
                  ? h(
                      'span',
                      null,
                      `registry:${boot.services.workspaceRegistry ? 'ok' : 'no'} · sessions:${boot.services.sessionController ? 'ok' : 'no'}`,
                    )
                  : null,
              )
            : null,
          toast ? h('div', { className: 'tt-toast', role: 'status', 'aria-live': 'polite' }, toast) : null,
        ),
        settingsOpen && boot
          ? h(SettingsModal, {
              t,
              boot,
              draft,
              setDraft,
              projectError,
              zentaoCatalog,
              zentaoBusy,
              onFetchZentaoContainers: () => void fetchZentaoContainers(),
              saving,
              error: settingsError,
              onSave: () => void saveSettings(),
              onClose: () => setSettingsOpen(false),
            })
          : null,
        write && boot
          ? h(WriteModal, {
              t,
              item: write.item,
              action: write.action,
              input: write.input,
              setInput: (next) => setWrite({ ...write, input: next }),
              plan: writePlan,
              planError: writePlanError,
              busy: writing,
              error: writeError,
              resolutions: boot.resolutions ?? [],
              bugTypes: boot.bugTypes ?? [],
              users: people,
              peopleError,
              onSubmit: () => void submitWrite(),
              onClose: () => {
                if (!writing) setWrite(null)
              },
            })
          : null,
        dialog
          ? h(DispatchModal, {
              t,
              story: dialog,
              boot,
              form,
              setForm,
              busy: dispatching,
              error: dispatchError,
              onSubmit: () => void submitDispatch(),
              onClose: () => {
                if (!dispatching) setDialog(null)
              },
            })
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      __test: { buildGroups, groupByStatus, filterStories, bugMatrix, badgeStore, Badge, StoryRow, WriteMenu, actionsFor, TaskActions, SettingsModal, DispatchModal, WriteModal, Field },
      apply(ctx) {
        ctx.effect(() => ensureStyles(), 'dsh-zentao-hub: styles')
        // The sidebar icon owns the badge; it needs its own cheap poll because
        // the panel is unmounted while another panel is selected.
        ctx.effect(() => {
          void refreshBadgeCount()
          const timer = setInterval(() => void refreshBadgeCount(), BADGE_MS)
          // Never hold the process open (tests import this module).
          timer.unref?.()
          let off
          try {
            off = ctx.on?.('connection/reset', () => void refreshBadgeCount({ force: true }))
          } catch {
            // Older hosts may not expose ctx.on; polling still works.
          }
          return () => {
            clearInterval(timer)
            if (typeof off === 'function') off()
          }
        }, 'dsh-zentao-hub: badge')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zentao-hub: dictionaries')
        const t = ctx.locale.bind(NS)
        // The dynamic Client ctx facade throws on an undeclared service
        // property read (it also reports a guard failure), so
        // `ctx.uiWorkspace ?? ctx.get('uiWorkspace')` aborted the whole
        // expression and the catch returned undefined — every 打开 click then
        // claimed the service was missing. ctx.get() is the optional lookup and
        // needs no inject declaration, so it must be the only path used here.
        const services = {
          uiWorkspace: () => {
            try {
              return ctx.get('uiWorkspace')
            } catch {
              return undefined
            }
          },
          workspaces: () => {
            try {
              return ctx.get('workspaces')
            } catch {
              return undefined
            }
          },
          sessions: () => {
            try {
              return ctx.get('sessions')
            } catch {
              return undefined
            }
          },
        }
        const isArchived = (sessionId) => {
          try {
            const store = services.workspaces()
            const snapshot = store?.list?.getSnapshot?.()
            return Array.isArray(snapshot?.archivedSessionIds) && snapshot.archivedSessionIds.includes(sessionId)
          } catch {
            return false
          }
        }
        // Returns a reason instead of failing silently so the panel can tell
        // the user why nothing happened.
        const openSession = async (sessionId) => {
          if (!sessionId) return { ok: false, reason: 'missing' }
          const ui = services.uiWorkspace()
          if (!ui || typeof ui.openSession !== 'function') return { ok: false, reason: 'service' }
          if (isArchived(sessionId)) {
            try {
              await ui.unarchiveSession?.(sessionId)
            } catch {
              return { ok: false, reason: 'error' }
            }
          }
          try {
            ui.openSession(sessionId)
            return { ok: true }
          } catch (error) {
            return { ok: false, reason: 'error', message: error?.message ?? String(error) }
          }
        }

        // The composer only accepts browser File objects, so a draft's photos
        // and attachments are streamed back from the host as bytes first.
        const assetFile = async (sessionId, asset, draftId) => {
          const response = await fetch(apiUrl('asset'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionId, i: asset.index, draftId }),
            cache: 'no-store',
            credentials: 'same-origin',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blob = await response.blob()
          return new File([blob], asset.name || `attachment-${asset.index}`, {
            type: asset.mediaType || blob.type || 'application/octet-stream',
          })
        }

        // The binding only exists once the workspace has retained the session,
        // which happens a moment after openSession() navigates to it.
        const waitForBinding = async (sessionsService, sessionId, timeoutMs = 8000) => {
          if (!sessionsService?.binding) return undefined
          const started = Date.now()
          while (Date.now() - started < timeoutMs) {
            const binding = sessionsService.binding(sessionId)
            if (binding) return binding
            await new Promise((resolve) => {
              setTimeout(resolve, 60)
            })
          }
          return undefined
        }

        // Fill a dispatched-but-unsent session's composer: the operator reads
        // the requirement and presses send. Nothing is submitted here.
        const prepareDraft = async (record) => {
          const sessionId = record?.sessionId
          const draft = record?.draft
          const missing = []
          if (!sessionId) return { ok: false, reason: 'missing' }
          const opened = await openSession(sessionId)
          if (!opened.ok) return opened
          if (!String(draft?.text ?? '').trim() && !(draft?.assets?.length > 0)) {
            return { ok: false, reason: 'empty' }
          }
          let conversation
          try {
            conversation = ctx.get('conversation')
          } catch {
            conversation = undefined
          }
          if (!conversation?.input?.requestDraftInitialization) return { ok: false, reason: 'service' }
          const binding = await waitForBinding(services.sessions(), sessionId)
          if (!binding) return { ok: false, reason: 'binding' }
          // The operator already sent something here: do not push the brief
          // back into a composer that now belongs to the conversation.
          const snapshot = binding.session?.getSnapshot?.()
          if (snapshot?.blank === false && !record.continuation) return { ok: true, applied: 'existing', attachments: 0, missing, alreadyStarted: true }
          const shell = conversation.input.shellFor?.(binding)
          const assets = Array.isArray(draft?.assets) ? draft.assets : []
          const prompt = String(draft?.text ?? '')
          let applied = 'blocked'
          for (let attempt = 0; attempt < 4 && applied === 'blocked'; attempt += 1) {
            if (attempt > 0) {
              await new Promise((resolve) => {
                setTimeout(resolve, 200)
              })
              // The composer may have been replaced while we waited.
              if (!services.sessions()?.binding?.(sessionId)) return { ok: false, reason: 'binding' }
            }
            try {
              const composer = shell?.snapshot
              const unedited = Boolean(draft.previousText && composer?.draft === draft.previousText && composer?.attachmentIds?.length === 0)
              applied = conversation.input.requestDraftInitialization(binding, {
                prompt,
                whenDraftExists: unedited ? 'replace' : 'keep',
              })
            } catch (error) {
              return { ok: false, reason: 'draft', message: error?.message ?? String(error) }
            }
          }
          if (applied === 'blocked') return { ok: false, reason: 'blocked' }
          // Someone already typed into this composer: keep their text and do
          // not pile our attachments on top of it.
          if (applied === 'preserved') {
            const composer = shell?.snapshot
            if (!assets.length || composer?.draft !== prompt || composer?.attachmentIds?.length !== 0) {
              return { ok: true, applied, attachments: 0, missing, preserved: true }
            }
          }
          if (assets.length === 0) return { ok: true, applied, attachments: 0, missing }
          const draftRevision = shell?.snapshot?.draftRev
          const files = []
          for (const asset of assets) {
            try {
              files.push(await assetFile(sessionId, asset, draft.draftId))
            } catch {
              missing.push(asset.name)
            }
          }
          if (files.length === 0) return { ok: true, applied, attachments: 0, missing }
          let ids = []
          try {
            const composer = shell?.snapshot
            if (composer && (composer.draftRev !== draftRevision || composer.attachmentIds?.length > 0)) {
              return { ok: true, applied, attachments: 0, missing, preserved: true }
            }
            const created = conversation.createDrafts?.(sessionId, files)
            ids = (Array.isArray(created) ? created : []).map((item) => item?.id).filter(Boolean)
            if (ids.length !== files.length || shell?.addAttachments?.(ids) !== true) {
              return { ok: true, applied, attachments: 0, missing: [...missing, ...files.map((file) => file.name)] }
            }
          } catch (error) {
            return {
              ok: true,
              applied,
              attachments: 0,
              missing: [...missing, ...files.map((file) => file.name)],
              message: error?.message ?? String(error),
            }
          }
          return { ok: true, applied, attachments: ids.length, missing }
        }

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t, openSession, prepareDraft }),
            },
            Panel,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: () => {
                const open = Number(badgeStore.getSnapshot?.()?.open) || 0
                return open > 0 ? `${t('nav')} (${open})` : t('nav')
              },
              locale: NS,
              // `hooks` become component props (useBadge), the only supported
              // way for a panel icon to show live state.
              inject: () => ({ hooks: { badge: badgeStore } }),
            },
            (owner = {}) => {
              const useBadge = owner.useBadge
              const counts = typeof useBadge === 'function'
                ? useBadge((value) => value)
                : badgeStore.getSnapshot()
              const open = Number(counts?.open) || 0
              return h(
                'span',
                { className: 'tt-nav-glyph' },
                h(Icon, { size: owner.size || 16, active: owner.active }),
                h(Badge, {
                  count: open,
                  dim: owner.active === true,
                  title: t('badgeTitle').replace('{n}', String(open)),
                }),
              )
            },
          ),
        )
      },
    }
  },
})
