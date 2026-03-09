<template>
  <main class="nexus-root" :data-theme="theme">
    <header class="nexus-header">
      <div class="brand-block">
        <p class="brand-tag">ScheduleNexus</p>
        <h1>{{ appName }}</h1>
        <p class="brand-meta">CMS · {{ activeModule?.label || "总览" }}</p>
      </div>
      <div class="header-actions">
        <span class="session-dot" :class="{ online: Boolean(sessionToken) }" />
        <span class="session-state">{{ sessionToken ? "在线" : "离线" }}</span>
        <button class="btn ghost theme-toggle" :disabled="loading" @click="toggleTheme">
          {{ theme === "dark" ? "浅色" : "深色" }}
        </button>
        <button class="btn ghost" :disabled="loading" @click="refreshModule">刷新</button>
        <button v-if="sessionToken" class="btn" :disabled="loading" @click="requestLogout">退出</button>
        <button v-else class="btn primary" @click="goToLogin">登录</button>
      </div>
    </header>

    <div class="nexus-shell">
      <section class="nexus-layout">
        <aside class="nexus-sidebar">
          <div class="sidebar-head">
            <p class="sidebar-title">内容管理中台</p>
            <p class="sidebar-sub">模块检索与路由切换</p>
          </div>
          <label class="module-search">
            <input
              v-model.trim="moduleQuery"
              type="search"
              placeholder="搜索模块，例如：课表 / 媒体"
            />
          </label>
          <div v-for="group in groupedModules" :key="group.key" class="module-group">
            <p class="module-group-title">{{ group.label }}</p>
            <nav class="module-nav">
              <NuxtLink
                v-for="item in group.items"
                :key="item.key"
                :to="item.key === 'overview' ? '/nexus' : `/nexus/${item.key}`"
                :class="['module-link', { active: item.key === activeModuleKey }]"
              >
                <span class="module-link-title">{{ item.label }}</span>
                <span class="module-link-hint">{{ item.hint }}</span>
              </NuxtLink>
            </nav>
          </div>
        </aside>

        <section class="nexus-main">
          <section class="panel module-head">
            <header class="panel-head">
              <div class="module-head-copy">
                <h2>{{ activeModule?.label || "总览" }}</h2>
                <p>{{ activeModule?.hint || "统一管理运营配置与实时数据" }}</p>
              </div>
            </header>
            <div class="module-meta">
              <div class="module-meta-group">
                <span class="meta-pill">主题：{{ theme }}</span>
                <span class="meta-pill">会话：{{ sessionToken ? "已登录" : "未登录" }}</span>
                <span class="meta-pill">刷新：{{ lastLoadedAtLabel }}</span>
              </div>
              <div v-if="activeModuleStats.length > 0" class="module-meta-group">
                <span v-for="item in activeModuleStats" :key="item" class="meta-pill data">{{ item }}</span>
              </div>
            </div>
          </section>

        <div v-if="loading" class="status-box">加载中...</div>
        <div v-if="errorText" class="status-box error">{{ errorText }}</div>
        <div v-if="successText" class="status-box success">{{ successText }}</div>

        <template v-if="activeModuleKey === 'overview'">
          <section class="panel">
            <header class="panel-head">
              <h2>系统总览</h2>
              <div class="panel-tags">
                <span class="panel-tag">模块 {{ modules.length }}</span>
                <span class="panel-tag">快捷入口 {{ quickModules.length }}</span>
              </div>
            </header>
            <div class="metric-grid">
              <article class="metric-card">
                <p>用户</p>
                <strong>{{ overviewData.userCount }}</strong>
              </article>
              <article class="metric-card">
                <p>班级</p>
                <strong>{{ overviewData.classCount }}</strong>
              </article>
              <article class="metric-card">
                <p>课表</p>
                <strong>{{ overviewData.scheduleCount }}</strong>
              </article>
              <article class="metric-card">
                <p>投票活动</p>
                <strong>{{ overviewData.campaignCount }}</strong>
              </article>
              <article class="metric-card">
                <p>媒体资产</p>
                <strong>{{ overviewData.mediaCount }}</strong>
              </article>
              <article class="metric-card">
                <p>机器人任务</p>
                <strong>{{ overviewData.botJobCount }}</strong>
              </article>
            </div>
            <div class="quick-grid">
              <button
                v-for="item in quickModules"
                :key="item.key"
                class="quick-card"
                type="button"
                @click="jumpToModule(item.key)"
              >
                <strong>{{ item.label }}</strong>
                <span>{{ item.hint }}</span>
              </button>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'users'">
          <section class="panel">
            <header class="panel-head">
              <h2>用户可视化编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">总用户 {{ usersData.length }}</span>
                <span class="panel-tag">编辑目标 {{ userEditor.userId || "未选择" }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" :disabled="!userEditor.userId" @click="openUserEditModal()">编辑当前用户</button>
            </div>
            <div class="table-wrap">
              <h3 class="sub-title">用户列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>学号</th>
                    <th>姓名</th>
                    <th>角色</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in usersData" :key="item.userId">
                    <td>{{ item.studentNo }}</td>
                    <td>{{ item.name || item.nickname }}</td>
                    <td>{{ item.adminRole }}</td>
                    <td><button class="btn" @click="openUserEditModal(item)">编辑</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'classes'">
          <section class="panel">
            <header class="panel-head">
              <h2>班级可视化编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">班级 {{ classesData.length }}</span>
                <span class="panel-tag">成员详情 {{ classMembersData ? "已加载" : "未加载" }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openClassCreateModal">新建班级</button>
              <button class="btn" type="button" :disabled="!classEditForm.classId" @click="openClassEditModal()">编辑当前班级</button>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">班级列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>班级</th>
                    <th>成员</th>
                    <th>订阅</th>
                    <th>状态</th>
                    <th>加入码</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in classesData" :key="item.classId">
                    <td>{{ item.classLabel }}</td>
                    <td>{{ item.memberCount }}</td>
                    <td>{{ item.subscriberCount }}</td>
                    <td>{{ item.active ? "active" : "inactive" }}</td>
                    <td>{{ item.currentCode }}</td>
                    <td class="action-col">
                      <button class="btn" @click="openClassEditModal(item)">编辑</button>
                      <button class="btn" @click="requestRotateClassCode(item.classId, item.classLabel)">换码</button>
                      <button class="btn" @click="loadClassMembers(item.classId)">成员</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="classMembersData" class="table-wrap">
              <h3 class="sub-title">成员详情：{{ classMembersData.item.classLabel }}</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>学号</th>
                    <th>姓名</th>
                    <th>角色</th>
                    <th>加入时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="member in classMembersData.item.members" :key="member.memberId">
                    <td>{{ member.studentNo }}</td>
                    <td>{{ member.name }}</td>
                    <td>{{ member.classRole }}</td>
                    <td>{{ toDisplayDate(member.joinedAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'schedules'">
          <section class="panel">
            <header class="panel-head">
              <h2>课表与订阅编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">课表 {{ schedulesData.length }}</span>
                <span class="panel-tag">订阅 {{ subscriptionsData.length }}</span>
                <span class="panel-tag">冲突 {{ conflictsData.length }}</span>
              </div>
            </header>
            <div class="table-wrap">
              <h3 class="sub-title">课表主列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>课表</th>
                    <th>班级</th>
                    <th>发布版本</th>
                    <th>最新版本</th>
                    <th>条目</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in schedulesData" :key="item.scheduleId">
                    <td>{{ item.title }}</td>
                    <td>{{ item.classLabel }}</td>
                    <td>{{ item.publishedVersionNo }}</td>
                    <td>{{ item.latestVersionNo }} / {{ item.latestStatus }}</td>
                    <td>{{ item.latestEntryCount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('schedule-create', '创建班级课表', '创建新的班级课表并可选立即发布。', 'xl')">创建课表</button>
              <button class="btn" type="button" @click="openCrudModal('schedule-publish', '发布课表版本', '将草稿版本发布为最新可同步版本。', 'xl')">发布版本</button>
              <button class="btn" type="button" @click="openCrudModal('schedule-subscribe', '创建课表订阅', '按当前课表创建新的订阅关系。')">创建订阅</button>
              <button class="btn" type="button" @click="openCrudModal('schedule-patch', '创建个人补丁', '为订阅课表添加 add/update/remove 补丁。', 'lg')">创建补丁</button>
            </div>

            <div class="layout-2col">
              <div class="table-wrap">
                <h3 class="sub-title">订阅列表</h3>
                <table class="table">
                  <thead>
                    <tr>
                      <th>课表</th>
                      <th>跟随模式</th>
                      <th>补丁</th>
                      <th>冲突</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in subscriptionsData" :key="item.id">
                      <td>{{ item.scheduleTitle }}</td>
                      <td>{{ item.followMode }}</td>
                      <td>{{ item.patchCount }}</td>
                      <td>{{ item.pendingConflictCount }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="table-wrap">
                <h3 class="sub-title">冲突处理</h3>
                <table class="table">
                  <thead>
                    <tr>
                      <th>冲突ID</th>
                      <th>课表</th>
                      <th>状态</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in conflictsData" :key="item.id">
                      <td>{{ item.id }}</td>
                      <td>{{ item.scheduleTitle }}</td>
                      <td>{{ item.resolutionStatus }}</td>
                      <td class="action-col">
                        <button class="btn" @click="requestResolveConflict(item.id, 'keep_patch')">保留补丁</button>
                        <button class="btn" @click="requestResolveConflict(item.id, 'relink')">恢复跟随</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">补丁列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>补丁ID</th>
                    <th>课表</th>
                    <th>条目</th>
                    <th>操作</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in patchesData" :key="item.id">
                    <td>{{ item.id }}</td>
                    <td>{{ item.scheduleTitle }}</td>
                    <td>{{ item.entryId }}</td>
                    <td>{{ item.opType }}</td>
                    <td><button class="btn" @click="requestRelinkPatch(item.id)">恢复跟随</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'foods'">
          <section class="panel">
            <header class="panel-head">
              <h2>食物与价格规则编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">食物 {{ foodItemsData.length }}</span>
                <span class="panel-tag">分类 {{ foodCategoryStats.length }}</span>
                <span class="panel-tag">零热量 {{ foodCategoryStatsOverview.zeroCaloriesCount }}</span>
                <span class="panel-tag">规则 {{ foodRules.length }}</span>
                <span class="panel-tag">历史 {{ foodRuleHistory.length }}</span>
                <span class="panel-tag">曲线点 {{ pricingPreviewData.points.length }}</span>
                <span class="panel-tag">筛选 {{ foodQueryForm.categoryKey || foodQueryForm.keyword ? "已应用" : "全部" }}</span>
              </div>
            </header>

            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('food-item-create', '新增食物', '创建食物并配置价格、热量、坐标。')">新增食物</button>
              <button class="btn" type="button" :disabled="!foodItemEditForm.foodId" @click="openFoodItemEditModal()">编辑当前食物</button>
              <button class="btn" type="button" @click="openCrudModal('food-filter', '筛选食物', '按分类与关键词过滤食物列表。')">筛选</button>
              <button class="btn" type="button" @click="openFoodStatsModal">分类统计</button>
              <button class="btn" type="button" @click="openFoodCaloriesBatchModal">热量批量校正</button>
              <button class="btn" type="button" @click="openFoodImportCsvModal">CSV 导入</button>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">食物主列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>分类</th>
                    <th>商家</th>
                    <th>价格</th>
                    <th>热量</th>
                    <th>坐标</th>
                    <th>关联活动</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in foodItemsData" :key="item.foodId">
                    <td>{{ item.foodName }}</td>
                    <td>{{ item.categoryName || item.categoryKey }}</td>
                    <td>{{ item.merchantName }}</td>
                    <td>{{ item.basePriceMin }} ~ {{ item.basePriceMax }}</td>
                    <td>{{ item.caloriesKcal }} kcal</td>
                    <td>{{ item.latitude }}, {{ item.longitude }}</td>
                    <td>{{ item.linkedCampaignCount }}</td>
                    <td class="action-col">
                      <button class="btn" @click="openFoodItemEditModal(item)">编辑</button>
                      <button class="btn danger" @click="requestDeleteFoodItem(item.foodId, item.foodName)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">分类统计（当前筛选）</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>分类</th>
                    <th>食物数</th>
                    <th>商家数</th>
                    <th>价格区间</th>
                    <th>均价</th>
                    <th>均热量</th>
                    <th>零热量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in foodCategoryStats.slice(0, 10)" :key="`food-category-${item.categoryKey}`">
                    <td>{{ item.categoryName || item.categoryKey }}</td>
                    <td>{{ item.foodCount }}</td>
                    <td>{{ item.merchantCount }}</td>
                    <td>{{ item.minPrice }} ~ {{ item.maxPrice }}</td>
                    <td>{{ item.avgPrice }}</td>
                    <td>{{ item.avgCaloriesKcal }} kcal</td>
                    <td>{{ item.zeroCaloriesCount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">价格规则主列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>分类</th>
                    <th>模式</th>
                    <th>锚点人数</th>
                    <th>斜率</th>
                    <th>范围</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in foodRules" :key="item.categoryKey">
                    <td>{{ item.categoryName }}</td>
                    <td>{{ item.trendMode }}</td>
                    <td>{{ item.anchorHeadcount }}</td>
                    <td>{{ item.slope }}</td>
                    <td>{{ item.minFactor }} ~ {{ item.maxFactor }}</td>
                    <td><button class="btn" @click="selectPricingRule(item)">编辑</button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('food-rule', '编辑价格规则', '修改价格曲线参数并保存版本。')">编辑规则</button>
              <button class="btn" type="button" @click="openCrudModal('food-preview', '曲线预览', '按人数区间实时预览价格曲线。')">预览曲线</button>
            </div>

            <div v-if="pricingPreviewData.points.length > 0" class="table-wrap">
              <h3 class="sub-title">曲线点</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>人数</th>
                    <th>因子</th>
                    <th>最低价</th>
                    <th>最高价</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="point in pricingPreviewData.points" :key="`p-${point.headcount}`">
                    <td>{{ point.headcount }}</td>
                    <td>{{ point.factor }}</td>
                    <td>{{ point.priceMin }}</td>
                    <td>{{ point.priceMax }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">历史版本</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>版本ID</th>
                    <th>分类</th>
                    <th>模式</th>
                    <th>创建时间</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in foodRuleHistory" :key="item.versionId">
                    <td>{{ item.versionId }}</td>
                    <td>{{ item.categoryName }}</td>
                    <td>{{ item.trendMode }}</td>
                    <td>{{ toDisplayDate(item.createdAt) }}</td>
                    <td><button class="btn" @click="requestRollbackPricingRule(item.versionId)">回滚</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'campaigns'">
          <section class="panel">
            <header class="panel-head">
              <h2>投票活动编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">活动 {{ campaignList.length }}</span>
                <span class="panel-tag">详情 {{ campaignDetailData ? "已加载" : "未加载" }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('campaign-create', '创建投票活动', '配置班级、匿名策略和可选食物。')">创建活动</button>
              <button class="btn" type="button" @click="openCrudModal('campaign-detail', '活动详情与投票', '加载活动详情并执行投票调试。', 'lg')">详情与投票</button>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">活动列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>活动</th>
                    <th>状态</th>
                    <th>匿名</th>
                    <th>截止</th>
                    <th>票数</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in campaignList" :key="item.campaignId">
                    <td>{{ item.title }}</td>
                    <td>{{ item.status }}</td>
                    <td>{{ item.isAnonymous ? "true" : "false" }}</td>
                    <td>{{ toDisplayDate(item.deadlineAtIso) }}</td>
                    <td>{{ item.voteCount }}</td>
                    <td class="action-col">
                      <button class="btn" @click="quickSelectCampaign(item.campaignId)">查看</button>
                      <button class="btn" :disabled="item.status !== 'open'" @click="requestCloseCampaign(item.campaignId, item.title)">结束</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="campaignDetailData" class="table-wrap">
              <h3 class="sub-title">详情快照</h3>
              <pre class="json-box">{{ toJson(campaignDetailData) }}</pre>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'media'">
          <section class="panel">
            <header class="panel-head">
              <h2>媒体资产编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">资产 {{ mediaAssets.length }}</span>
                <span class="panel-tag">筛选 {{ mediaQueryForm.usage || "全部" }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('media-filter', '筛选媒体资产', '按 owner 和 usage 过滤资产列表。')">筛选资产</button>
              <button class="btn" type="button" @click="openCrudModal('media-create', '创建媒体资源', '创建新的头像/壁纸/其他资源记录。')">创建资源</button>
              <button class="btn" type="button" @click="openCrudModal('media-bind', '绑定头像与壁纸', '将媒体资源绑定到当前管理员。')">绑定资源</button>
              <button class="btn danger" type="button" @click="openCrudModal('media-cleanup', '清理孤儿资源', '先对账再执行清理，避免误删。')">清理资源</button>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">媒体资产列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>owner</th>
                    <th>usage</th>
                    <th>size</th>
                    <th>referenced</th>
                    <th>url</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in mediaAssets" :key="item.id">
                    <td>{{ item.id }}</td>
                    <td>{{ item.ownerUserId }}</td>
                    <td>{{ item.usage }}</td>
                    <td>{{ item.size }}</td>
                    <td>{{ item.referenced ? "true" : "false" }}</td>
                    <td>{{ item.url }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'bots'">
          <section class="panel">
            <header class="panel-head">
              <h2>机器人模板与任务</h2>
              <div class="panel-tags">
                <span class="panel-tag">模板 {{ botTemplates.length }}</span>
                <span class="panel-tag">任务 {{ botJobs.length }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openBotTemplateModal()">编辑模板</button>
              <button class="btn" type="button" @click="openCrudModal('bot-trigger', '触发次日任务', '手动触发 next-day 播报任务。')">触发任务</button>
            </div>
            <div class="table-wrap">
              <h3 class="sub-title">模板列表</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>key</th>
                    <th>标题</th>
                    <th>启用</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in botTemplates" :key="item.id">
                    <td>{{ item.key }}</td>
                    <td>{{ item.title }}</td>
                    <td>{{ item.enabled ? "true" : "false" }}</td>
                    <td><button class="btn" @click="openBotTemplateModal(item)">编辑</button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-wrap">
              <h3 class="sub-title">任务历史</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>任务ID</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>摘要</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in botJobs" :key="item.id">
                    <td>{{ item.id }}</td>
                    <td>{{ item.type }}</td>
                    <td>{{ item.status }}</td>
                    <td>{{ item.summary }}</td>
                    <td>{{ toDisplayDate(item.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'preview'">
          <section class="panel">
            <header class="panel-head">
              <h2>数据态预览编辑</h2>
              <div class="panel-tags">
                <span class="panel-tag">学号 {{ previewForm.studentNo || "-" }}</span>
                <span class="panel-tag">活动 {{ previewForm.campaignId || "自动" }}</span>
              </div>
            </header>
            <div class="panel-toolbar">
              <button class="btn primary" type="button" @click="openCrudModal('preview-config', '预览参数配置', '配置 studentNo、campaignId、shareToken。')">配置预览参数</button>
              <button class="btn" type="button" @click="loadPreviewData">刷新预览</button>
            </div>
            <div class="layout-2col">
              <div class="table-wrap">
                <h3 class="sub-title">资料卡</h3>
                <pre class="json-box">{{ toJson(previewData.profile) }}</pre>
              </div>
              <div class="table-wrap">
                <h3 class="sub-title">班级订阅态</h3>
                <pre class="json-box">{{ toJson(previewData.subscriptions) }}</pre>
              </div>
            </div>
            <div class="table-wrap">
              <h3 class="sub-title">投票态</h3>
              <pre class="json-box">{{ toJson(previewData.vote) }}</pre>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'audit'">
          <section class="panel">
            <header class="panel-head">
              <h2>审计日志</h2>
              <div class="panel-tags">
                <span class="panel-tag">日志 {{ auditItems.length }}</span>
              </div>
            </header>
            <div class="table-wrap">
              <h3 class="sub-title">审计条目</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>执行者</th>
                    <th>负载</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in auditItems" :key="item.id">
                    <td>{{ toDisplayDate(item.createdAt) }}</td>
                    <td>{{ item.action }}</td>
                    <td>{{ item.actorUserId }}</td>
                    <td><pre class="mini-json">{{ toJson(item.payload) }}</pre></td>
                    <td><button class="btn" @click="openJsonDialog('审计负载详情', item.payload)">查看</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <template v-else-if="activeModuleKey === 'settings'">
          <section class="panel">
            <header class="panel-head">
              <h2>系统设置与诊断</h2>
              <div class="panel-tags">
                <span class="panel-tag">健康字段 {{ Object.keys(settingsData.health || {}).length }}</span>
                <span class="panel-tag">元信息 {{ Object.keys(settingsData.root || {}).length }}</span>
              </div>
            </header>
            <div class="layout-2col">
              <div class="table-wrap">
                <h3 class="sub-title">运行状态</h3>
                <pre class="json-box">{{ toJson(settingsData.health) }}</pre>
              </div>
              <div class="table-wrap">
                <h3 class="sub-title">API元信息</h3>
                <pre class="json-box">{{ toJson(settingsData.root) }}</pre>
              </div>
            </div>
          </section>
        </template>
        </section>
      </section>
    </div>

    <div v-if="crudModal.open" class="modal-mask modal-mask-l2" @click.self="closeCrudModal">
      <div :class="['modal-card', crudModalCardClass]">
        <header class="modal-head">
          <div class="modal-head-main">
            <h3>{{ crudModal.title }}</h3>
            <span class="modal-chip">CRUD</span>
          </div>
          <button class="btn ghost" type="button" @click="closeCrudModal">关闭</button>
        </header>
        <div class="modal-body modal-body-crud">
          <p v-if="crudModal.description" class="modal-note">{{ crudModal.description }}</p>

          <form v-if="crudModal.key === 'user-edit'" class="form-grid" @submit.prevent="saveUser">
            <label>用户ID <input v-model.trim="userEditor.userId" readonly /></label>
            <label>姓名 <input v-model.trim="userEditor.name" /></label>
            <label>昵称 <input v-model.trim="userEditor.nickname" /></label>
            <label>班级标签 <input v-model.trim="userEditor.classLabel" /></label>
            <label>学籍ID <input v-model.trim="userEditor.studentId" /></label>
            <label>
              管理角色
              <select v-model="userEditor.adminRole">
                <option value="none">none</option>
                <option value="operator">operator</option>
                <option value="super_admin">super_admin</option>
              </select>
            </label>
            <label>
              提醒开关
              <select v-model="userEditor.reminderEnabled">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>提醒窗口(逗号分钟) <input v-model.trim="userEditor.reminderWindowMinutes" placeholder="30,15" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit" :disabled="!userEditor.userId">保存用户</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'class-create'" class="form-grid" @submit.prevent="createClass">
            <label>班级名称 <input v-model.trim="classCreateForm.classLabel" /></label>
            <label>负责人学号 <input v-model.trim="classCreateForm.ownerStudentNo" placeholder="可空" /></label>
            <label>
              启用
              <select v-model="classCreateForm.active">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">新建班级</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'class-edit'" class="form-grid" @submit.prevent="saveClass">
            <label>班级ID <input v-model.trim="classEditForm.classId" readonly /></label>
            <label>班级名称 <input v-model.trim="classEditForm.classLabel" /></label>
            <label>时区 <input v-model.trim="classEditForm.timezone" /></label>
            <label>负责人学号 <input v-model.trim="classEditForm.ownerStudentNo" placeholder="可空" /></label>
            <label>
              启用
              <select v-model="classEditForm.active">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit" :disabled="!classEditForm.classId">保存班级</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'schedule-create'" class="form-grid" @submit.prevent="createSchedule">
            <label>
              目标班级
              <select v-model="scheduleCreateForm.classId">
                <option value="">请选择</option>
                <option v-for="item in classesData" :key="item.classId" :value="item.classId">
                  {{ item.classLabel }}
                </option>
              </select>
            </label>
            <label>标题 <input v-model.trim="scheduleCreateForm.title" /></label>
            <label>描述 <input v-model.trim="scheduleCreateForm.description" /></label>
            <label>
              立即发布
              <select v-model="scheduleCreateForm.publishNow">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>课程条目(JSON数组) <textarea v-model.trim="scheduleCreateForm.entriesText" rows="8" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建课表</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'schedule-publish'" class="form-grid" @submit.prevent="publishSchedule">
            <label>
              课表
              <select v-model="schedulePublishForm.scheduleId">
                <option value="">请选择</option>
                <option v-for="item in schedulesData" :key="item.scheduleId" :value="item.scheduleId">
                  {{ item.title }}
                </option>
              </select>
            </label>
            <label>覆盖条目(JSON数组，可空) <textarea v-model.trim="schedulePublishForm.entriesText" rows="8" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">发布版本</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'schedule-subscribe'" class="form-grid" @submit.prevent="subscribeSchedule">
            <label>
              课表
              <select v-model="scheduleSubscribeForm.scheduleId">
                <option value="">请选择</option>
                <option v-for="item in schedulesData" :key="item.scheduleId" :value="item.scheduleId">
                  {{ item.title }}
                </option>
              </select>
            </label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建订阅</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'schedule-patch'" class="form-grid" @submit.prevent="createSchedulePatch">
            <label>
              订阅
              <select v-model="schedulePatchForm.subscriptionId">
                <option value="">请选择</option>
                <option v-for="item in subscriptionsData" :key="item.id" :value="item.id">
                  {{ item.scheduleTitle }} / {{ item.id }}
                </option>
              </select>
            </label>
            <label>entryId <input v-model.trim="schedulePatchForm.entryId" /></label>
            <label>
              操作
              <select v-model="schedulePatchForm.opType">
                <option value="update">update</option>
                <option value="add">add</option>
                <option value="remove">remove</option>
              </select>
            </label>
            <label>补丁(JSON对象) <textarea v-model.trim="schedulePatchForm.patchPayloadText" rows="6" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建补丁</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-item-create'" class="form-grid" @submit.prevent="createFoodItem">
            <label>食物名称 <input v-model.trim="foodItemCreateForm.foodName" /></label>
            <label>商家名称 <input v-model.trim="foodItemCreateForm.merchantName" /></label>
            <label>分类键 <input v-model.trim="foodItemCreateForm.categoryKey" /></label>
            <label>分类名 <input v-model.trim="foodItemCreateForm.categoryName" /></label>
            <label>最低价 <input v-model.number="foodItemCreateForm.basePriceMin" type="number" min="0" step="0.1" /></label>
            <label>最高价 <input v-model.number="foodItemCreateForm.basePriceMax" type="number" min="0" step="0.1" /></label>
            <label>热量 kcal <input v-model.number="foodItemCreateForm.caloriesKcal" type="number" min="0" step="1" /></label>
            <label>纬度 <input v-model.number="foodItemCreateForm.latitude" type="number" step="0.000001" /></label>
            <label>经度 <input v-model.number="foodItemCreateForm.longitude" type="number" step="0.000001" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建食物</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-item-edit'" class="form-grid" @submit.prevent="saveFoodItem">
            <label>食物ID <input v-model.trim="foodItemEditForm.foodId" readonly /></label>
            <label>食物名称 <input v-model.trim="foodItemEditForm.foodName" /></label>
            <label>商家名称 <input v-model.trim="foodItemEditForm.merchantName" /></label>
            <label>分类键 <input v-model.trim="foodItemEditForm.categoryKey" /></label>
            <label>分类名 <input v-model.trim="foodItemEditForm.categoryName" /></label>
            <label>最低价 <input v-model.number="foodItemEditForm.basePriceMin" type="number" min="0" step="0.1" /></label>
            <label>最高价 <input v-model.number="foodItemEditForm.basePriceMax" type="number" min="0" step="0.1" /></label>
            <label>热量 kcal <input v-model.number="foodItemEditForm.caloriesKcal" type="number" min="0" step="1" /></label>
            <label>纬度 <input v-model.number="foodItemEditForm.latitude" type="number" step="0.000001" /></label>
            <label>经度 <input v-model.number="foodItemEditForm.longitude" type="number" step="0.000001" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit" :disabled="!foodItemEditForm.foodId">保存食物</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-filter'" class="form-grid" @submit.prevent="applyFoodFilter">
            <label>
              分类
              <select v-model="foodQueryForm.categoryKey">
                <option value="">全部</option>
                <option v-for="item in foodCategoryOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label>关键词 <input v-model.trim="foodQueryForm.keyword" placeholder="名称 / 商家 / 分类" /></label>
            <div class="modal-form-actions">
              <button class="btn" type="button" @click="resetFoodFilter">清空筛选</button>
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">应用筛选</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-import-csv'" class="form-grid" @submit.prevent="importFoodCsv">
            <label>
              导入模式
              <select v-model="foodImportForm.mode">
                <option value="append">append（仅新增）</option>
                <option value="upsert">upsert（同名同商家同分类更新）</option>
              </select>
            </label>
            <label>
              CSV 内容
              <textarea
                v-model.trim="foodImportForm.csvText"
                rows="12"
                placeholder="name,merchantName,categoryKey,categoryName,basePriceMin,basePriceMax,caloriesKcal,latitude,longitude"
              />
            </label>
            <p class="modal-note">支持表头：name/merchantName/categoryKey/categoryName/basePriceMin/basePriceMax/caloriesKcal/latitude/longitude</p>
            <p v-if="foodImportSummary" class="modal-note">导入结果：总 {{ foodImportSummary.totalRows }}，新增 {{ foodImportSummary.created }}，更新 {{ foodImportSummary.updated }}，跳过 {{ foodImportSummary.skipped }}</p>
            <div class="modal-form-actions">
              <button class="btn" type="button" @click="useFoodImportSample">填充示例</button>
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">执行导入</button>
            </div>
          </form>

          <section v-else-if="crudModal.key === 'food-stats'" class="form-grid">
            <p class="modal-note">
              当前共 {{ foodCategoryStats.length }} 个分类，食物 {{ foodCategoryStatsOverview.totalFoods }} 条，零热量 {{ foodCategoryStatsOverview.zeroCaloriesCount }} 条。
            </p>
            <div v-if="foodCategoryStatsChart.byCount.length > 0" class="stats-chart-grid">
              <section class="stats-chart-card">
                <h4 class="chart-title">分类食物数量 Top 10</h4>
                <div class="stats-bar-list">
                  <div v-for="item in foodCategoryStatsChart.byCount" :key="`food-count-${item.categoryKey}`" class="stats-bar-row">
                    <span class="stats-bar-label">{{ item.categoryName || item.categoryKey }}</span>
                    <div class="stats-bar-track">
                      <div class="stats-bar-fill" :style="{ width: `${item.barPercent}%` }" />
                    </div>
                    <span class="stats-bar-value">{{ item.foodCount }}</span>
                  </div>
                </div>
              </section>
              <section class="stats-chart-card">
                <h4 class="chart-title">零热量占比 Top 10</h4>
                <div class="stats-bar-list">
                  <div v-for="item in foodCategoryStatsChart.byZeroRate" :key="`food-zero-${item.categoryKey}`" class="stats-bar-row">
                    <span class="stats-bar-label">{{ item.categoryName || item.categoryKey }}</span>
                    <div class="stats-bar-track">
                      <div class="stats-bar-fill zero" :style="{ width: `${item.zeroRateBarPercent}%` }" />
                    </div>
                    <span class="stats-bar-value">{{ item.zeroRatePercent }}%</span>
                  </div>
                </div>
              </section>
            </div>
            <table class="table">
              <thead>
                <tr>
                  <th>分类</th>
                  <th>食物数</th>
                  <th>商家数</th>
                  <th>价格区间</th>
                  <th>均价</th>
                  <th>均热量</th>
                  <th>零热量</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in foodCategoryStats" :key="`food-stats-${item.categoryKey}`">
                  <td>{{ item.categoryName || item.categoryKey }}</td>
                  <td>{{ item.foodCount }}</td>
                  <td>{{ item.merchantCount }}</td>
                  <td>{{ item.minPrice }} ~ {{ item.maxPrice }}</td>
                  <td>{{ item.avgPrice }}</td>
                  <td>{{ item.avgCaloriesKcal }} kcal</td>
                  <td>{{ item.zeroCaloriesCount }}</td>
                </tr>
              </tbody>
            </table>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">关闭</button>
            </div>
          </section>

          <form v-else-if="crudModal.key === 'food-calories-batch'" class="form-grid" @submit.prevent="recalculateFoodCalories">
            <label>
              范围
              <select v-model="foodCaloriesBatchForm.scope">
                <option value="all">all（全量）</option>
                <option value="category">category（指定分类）</option>
              </select>
            </label>
            <label>
              分类
              <select v-model="foodCaloriesBatchForm.categoryKey" :disabled="foodCaloriesBatchForm.scope !== 'category'">
                <option value="">请选择分类</option>
                <option v-for="item in foodCategoryOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label>关键词（可空） <input v-model.trim="foodCaloriesBatchForm.keyword" placeholder="按名称/商家做子集校正" /></label>
            <label>
              写入策略
              <select v-model="foodCaloriesBatchForm.writeMode">
                <option value="fill_missing">fill_missing（仅填充热量=0）</option>
                <option value="overwrite">overwrite（覆盖全部命中项）</option>
              </select>
            </label>
            <label>
              执行动作
              <select v-model="foodCaloriesBatchForm.applyAction">
                <option value="commit">commit（直接写入）</option>
                <option value="dry_run">dry_run（仅预览）</option>
              </select>
            </label>
            <label>基线偏移 <input v-model.number="foodCaloriesBatchForm.baseShift" type="number" step="1" /></label>
            <label>价格权重 <input v-model.number="foodCaloriesBatchForm.priceWeight" type="number" min="4" max="40" step="1" /></label>
            <label>最小热量 <input v-model.number="foodCaloriesBatchForm.minKcal" type="number" min="50" step="1" /></label>
            <label>最大热量 <input v-model.number="foodCaloriesBatchForm.maxKcal" type="number" min="50" step="1" /></label>
            <p v-if="foodCaloriesBatchSummary" class="modal-note">
              命中 {{ foodCaloriesBatchSummary.targetCount }}，更新 {{ foodCaloriesBatchSummary.updatedCount }}，跳过(已有热量) {{ foodCaloriesBatchSummary.skippedFilledCount }}，跳过(未变化) {{ foodCaloriesBatchSummary.skippedUnchangedCount }}。
            </p>
            <table v-if="foodCaloriesBatchExamples.length > 0" class="table">
              <thead>
                <tr>
                  <th>食物</th>
                  <th>分类</th>
                  <th>校正前</th>
                  <th>校正后</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in foodCaloriesBatchExamples" :key="`food-cal-${item.foodId}`">
                  <td>{{ item.foodName }}</td>
                  <td>{{ item.categoryKey }}</td>
                  <td>{{ item.beforeCaloriesKcal }}</td>
                  <td>{{ item.afterCaloriesKcal }}</td>
                </tr>
              </tbody>
            </table>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">执行热量校正</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-rule'" class="form-grid" @submit.prevent="savePricingRule">
            <label>分类键 <input v-model.trim="pricingForm.categoryKey" /></label>
            <label>分类名 <input v-model.trim="pricingForm.categoryName" /></label>
            <label>
              模式
              <select v-model="pricingForm.trendMode">
                <option value="down">down</option>
                <option value="up">up</option>
              </select>
            </label>
            <label>锚点人数 <input v-model.number="pricingForm.anchorHeadcount" type="number" min="1" /></label>
            <label>斜率 <input v-model.number="pricingForm.slope" type="number" step="0.001" /></label>
            <label>最小因子 <input v-model.number="pricingForm.minFactor" type="number" step="0.01" /></label>
            <label>最大因子 <input v-model.number="pricingForm.maxFactor" type="number" step="0.01" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">保存规则</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'food-preview'" class="form-grid" @submit.prevent="previewPricingRule">
            <label>分类键 <input v-model.trim="pricingPreviewForm.categoryKey" /></label>
            <label>基础最低价 <input v-model.number="pricingPreviewForm.basePriceMin" type="number" step="0.1" /></label>
            <label>基础最高价 <input v-model.number="pricingPreviewForm.basePriceMax" type="number" step="0.1" /></label>
            <label>人数起点 <input v-model.number="pricingPreviewForm.headcountStart" type="number" min="1" /></label>
            <label>人数终点 <input v-model.number="pricingPreviewForm.headcountEnd" type="number" min="1" /></label>
            <label>步长 <input v-model.number="pricingPreviewForm.headcountStep" type="number" min="1" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">预览曲线</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'campaign-create'" class="form-grid" @submit.prevent="createCampaign">
            <label>标题 <input v-model.trim="campaignCreateForm.title" /></label>
            <label>
              班级ID
              <select v-model="campaignCreateForm.classId">
                <option value="">可空</option>
                <option v-for="item in classesData" :key="item.classId" :value="item.classId">
                  {{ item.classId }} / {{ item.classLabel }}
                </option>
              </select>
            </label>
            <label>截止时间(ISO) <input v-model.trim="campaignCreateForm.deadlineAtIso" placeholder="可空自动+24h" /></label>
            <label>
              匿名
              <select v-model="campaignCreateForm.isAnonymous">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>可选食物ID(逗号，可空自动前三个) <input v-model.trim="campaignCreateForm.optionFoodIdsText" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建活动</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'campaign-detail'" class="form-grid" @submit.prevent="loadCampaignDetail">
            <label>
              活动ID
              <select v-model="campaignDetailForm.campaignId">
                <option value="">请选择</option>
                <option v-for="item in campaignList" :key="item.campaignId" :value="item.campaignId">
                  {{ item.title }} / {{ item.campaignId }}
                </option>
              </select>
            </label>
            <label>预览学号 <input v-model.trim="campaignDetailForm.studentNo" /></label>
            <label>分享码(匿名结束查看实名) <input v-model.trim="campaignDetailForm.shareToken" /></label>
            <label>投票 foodId <input v-model.trim="campaignVoteForm.foodId" /></label>
            <label>投票分值(1-10) <input v-model.number="campaignVoteForm.score" type="number" min="1" max="10" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn" type="button" :disabled="!campaignDetailForm.campaignId" @click="voteCampaign">提交投票</button>
              <button class="btn primary" type="submit">加载详情</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'media-filter'" class="form-grid" @submit.prevent="loadMediaAssets">
            <label>ownerUserId <input v-model.trim="mediaQueryForm.ownerUserId" placeholder="可空" /></label>
            <label>
              usage
              <select v-model="mediaQueryForm.usage">
                <option value="">全部</option>
                <option value="avatar">avatar</option>
                <option value="wallpaper">wallpaper</option>
                <option value="other">other</option>
              </select>
            </label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">筛选</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'media-create'" class="form-grid" @submit.prevent="createMediaAsset">
            <label>
              usage
              <select v-model="mediaCreateForm.usage">
                <option value="avatar">avatar</option>
                <option value="wallpaper">wallpaper</option>
                <option value="other">other</option>
              </select>
            </label>
            <label>mime <input v-model.trim="mediaCreateForm.mime" /></label>
            <label>size <input v-model.number="mediaCreateForm.size" type="number" min="0" /></label>
            <label>fileName <input v-model.trim="mediaCreateForm.fileName" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">创建</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'media-bind'" class="form-grid" @submit.prevent="bindProfileMedia">
            <label>avatarAssetId <input v-model.trim="mediaBindForm.avatarAssetId" /></label>
            <label>wallpaperAssetId <input v-model.trim="mediaBindForm.wallpaperAssetId" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">绑定</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'media-cleanup'" class="form-grid" @submit.prevent="requestCleanupMediaAssets">
            <label>
              onlyOrphans
              <select v-model="mediaCleanupForm.onlyOrphans">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>olderThanHours <input v-model.number="mediaCleanupForm.olderThanHours" type="number" min="0" /></label>
            <div class="modal-form-actions">
              <button class="btn" type="button" @click="requestReconcileMediaAssets">先对账</button>
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn danger" type="submit">执行清理</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'bot-template'" class="form-grid" @submit.prevent="saveBotTemplate">
            <label>id <input v-model.trim="botTemplateForm.id" placeholder="可空新建" /></label>
            <label>key <input v-model.trim="botTemplateForm.key" /></label>
            <label>title <input v-model.trim="botTemplateForm.title" /></label>
            <label>body <textarea v-model.trim="botTemplateForm.body" rows="6" /></label>
            <label>
              enabled
              <select v-model="botTemplateForm.enabled">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">保存模板</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'bot-trigger'" class="form-grid" @submit.prevent="triggerNextDayJob">
            <label>
              rainy
              <select v-model="botTriggerForm.rainy">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>date(ISO，可空明天) <input v-model.trim="botTriggerForm.date" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">触发任务</button>
            </div>
          </form>

          <form v-else-if="crudModal.key === 'preview-config'" class="form-grid" @submit.prevent="loadPreviewData">
            <label>studentNo <input v-model.trim="previewForm.studentNo" /></label>
            <label>
              campaignId
              <select v-model="previewForm.campaignId">
                <option value="">默认第一条</option>
                <option v-for="item in campaignList" :key="item.campaignId" :value="item.campaignId">
                  {{ item.title }}
                </option>
              </select>
            </label>
            <label>shareToken <input v-model.trim="previewForm.shareToken" placeholder="可空" /></label>
            <div class="modal-form-actions">
              <button class="btn ghost" type="button" @click="closeCrudModal">取消</button>
              <button class="btn primary" type="submit">刷新预览</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div v-if="confirmDialog.open" class="modal-mask" @click.self="closeConfirmDialog">
      <div class="modal-card" :data-tone="confirmDialog.tone">
        <header class="modal-head">
          <div class="modal-head-main">
            <h3>{{ confirmDialog.title }}</h3>
            <span class="modal-chip" :data-tone="confirmDialog.tone">{{ confirmDialogToneLabel }}</span>
          </div>
          <button class="btn ghost" type="button" @click="closeConfirmDialog">关闭</button>
        </header>
        <div class="modal-body">
          <p>{{ confirmDialog.message }}</p>
          <p v-if="confirmDialog.requireSecondary" class="modal-note">
            该操作需要二次确认，下一步需输入确认口令。
          </p>
        </div>
        <footer class="modal-actions">
          <button
            v-if="confirmDialog.detailText"
            class="btn ghost"
            type="button"
            @click="openConfirmDetailDialog"
          >
            查看影响详情
          </button>
          <button class="btn ghost" type="button" @click="closeConfirmDialog">取消</button>
          <button
            :class="['btn', confirmDialog.requireSecondary ? 'subtle' : confirmActionBtnClass]"
            type="button"
            :disabled="loading"
            @click="runConfirmAction"
          >
            {{ confirmDialog.requireSecondary ? "继续下一步" : confirmDialog.confirmLabel }}
          </button>
        </footer>
      </div>
    </div>

    <div v-if="confirmDetailDialog.open" class="modal-mask modal-mask-l2" @click.self="closeConfirmDetailDialog">
      <div class="modal-card modal-card-secondary">
        <header class="modal-head">
          <h3>{{ confirmDetailDialog.title }}</h3>
          <button class="btn ghost" type="button" @click="closeConfirmDetailDialog">关闭</button>
        </header>
        <div class="modal-body">
          <pre class="json-box">{{ confirmDetailDialog.content }}</pre>
        </div>
      </div>
    </div>

    <div v-if="confirmVerifyDialog.open" class="modal-mask modal-mask-l2" @click.self="closeConfirmVerifyDialog">
      <div class="modal-card" :data-tone="confirmVerifyDialog.tone">
        <header class="modal-head">
          <div class="modal-head-main">
            <h3>{{ confirmVerifyDialog.title }}</h3>
            <span class="modal-chip" :data-tone="confirmVerifyDialog.tone">二次确认</span>
          </div>
          <button class="btn ghost" type="button" @click="closeConfirmVerifyDialog">关闭</button>
        </header>
        <div class="modal-body modal-verify-body">
          <p class="modal-note">{{ confirmVerifyDialog.note }}</p>
          <label class="verify-input">
            <span>请输入「{{ confirmVerifyDialog.expectedText }}」继续</span>
            <input v-model.trim="confirmVerifyDialog.inputText" type="text" placeholder="输入确认口令" />
          </label>
        </div>
        <footer class="modal-actions">
          <button class="btn ghost" type="button" @click="closeConfirmVerifyDialog">取消</button>
          <button
            :class="['btn', confirmVerifyDialog.tone === 'danger' ? 'danger' : 'warn']"
            type="button"
            :disabled="loading || !confirmVerifyMatched"
            @click="runConfirmVerifyAction"
          >
            {{ confirmVerifyDialog.confirmLabel }}
          </button>
        </footer>
      </div>
    </div>

    <div v-if="jsonDialog.open" class="modal-mask modal-mask-l2" @click.self="closeJsonDialog">
      <div class="modal-card modal-card-secondary">
        <header class="modal-head">
          <h3>{{ jsonDialog.title }}</h3>
          <button class="btn ghost" type="button" @click="closeJsonDialog">关闭</button>
        </header>
        <div class="modal-body">
          <pre class="json-box">{{ jsonDialog.content }}</pre>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { buildNexusLoginPath, clearNexusSessionToken, getNexusSessionToken } from "../utils/nexus-auth";
import { getPreferredNexusTheme, setNexusTheme, type NexusThemeMode } from "../utils/nexus-theme";

interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

interface ModuleOption {
  key: string;
  label: string;
  hint: string;
  group: "core" | "business" | "system";
}

type ConfirmTone = "neutral" | "warning" | "danger";

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  detailText: string;
  tone: ConfirmTone;
  requireSecondary: boolean;
  secondaryNote: string;
  expectedText: string;
  action: null | (() => Promise<void>);
}

interface TextDialogState {
  open: boolean;
  title: string;
  content: string;
}

interface ConfirmVerifyDialogState {
  open: boolean;
  title: string;
  note: string;
  expectedText: string;
  inputText: string;
  confirmLabel: string;
  tone: ConfirmTone;
}

type CrudModalSize = "md" | "lg" | "xl";
type CrudModalKey =
  | "user-edit"
  | "class-create"
  | "class-edit"
  | "schedule-create"
  | "schedule-publish"
  | "schedule-subscribe"
  | "schedule-patch"
  | "food-item-create"
  | "food-item-edit"
  | "food-filter"
  | "food-import-csv"
  | "food-stats"
  | "food-calories-batch"
  | "food-rule"
  | "food-preview"
  | "campaign-create"
  | "campaign-detail"
  | "media-filter"
  | "media-create"
  | "media-bind"
  | "media-cleanup"
  | "bot-template"
  | "bot-trigger"
  | "preview-config";

interface CrudModalState {
  open: boolean;
  key: "" | CrudModalKey;
  title: string;
  description: string;
  size: CrudModalSize;
}

const props = withDefaults(
  defineProps<{
    moduleKey?: string;
  }>(),
  {
    moduleKey: "overview",
  },
);

const runtimeConfig = useRuntimeConfig();
const route = useRoute();
const appName = computed(() => String(runtimeConfig.public.appName || "TouchX Backend").trim());

const sessionToken = ref("");
const theme = ref<NexusThemeMode>("dark");
const loading = ref(false);
const errorText = ref("");
const successText = ref("");
const redirectingToLogin = ref(false);
const moduleQuery = ref("");
const lastLoadedAt = ref(0);
const confirmDialog = reactive<ConfirmDialogState>({
  open: false,
  title: "",
  message: "",
  confirmLabel: "确认执行",
  detailText: "",
  tone: "neutral",
  requireSecondary: false,
  secondaryNote: "",
  expectedText: "",
  action: null,
});
const confirmDetailDialog = reactive<TextDialogState>({
  open: false,
  title: "",
  content: "",
});
const confirmVerifyDialog = reactive<ConfirmVerifyDialogState>({
  open: false,
  title: "",
  note: "",
  expectedText: "",
  inputText: "",
  confirmLabel: "确认执行",
  tone: "warning",
});
const crudModal = reactive<CrudModalState>({
  open: false,
  key: "",
  title: "",
  description: "",
  size: "md",
});
const jsonDialog = reactive<TextDialogState>({
  open: false,
  title: "",
  content: "",
});

const modules: ModuleOption[] = [
  { key: "overview", label: "总览", hint: "关键指标与入口聚合", group: "core" },
  { key: "users", label: "用户", hint: "账号、角色与提醒配置", group: "core" },
  { key: "classes", label: "班级", hint: "班级生命周期与成员管理", group: "core" },
  { key: "schedules", label: "课表", hint: "发布、订阅、补丁与冲突", group: "business" },
  { key: "foods", label: "食物", hint: "食物库、热量与价格曲线", group: "business" },
  { key: "campaigns", label: "竞选", hint: "匿名投票与活动运营", group: "business" },
  { key: "media", label: "媒体", hint: "头像壁纸与资产审计", group: "business" },
  { key: "bots", label: "机器人", hint: "模板策略与次日播报", group: "business" },
  { key: "preview", label: "预览", hint: "数据态模拟与联调", group: "system" },
  { key: "audit", label: "审计", hint: "关键操作追溯", group: "system" },
  { key: "settings", label: "设置", hint: "健康检查与元信息", group: "system" },
];

const activeModuleKey = computed(() => {
  const key = String(props.moduleKey || "overview").trim().toLowerCase();
  return modules.some((item) => item.key === key) ? key : "overview";
});

const activeModule = computed(() => {
  return modules.find((item) => item.key === activeModuleKey.value) || null;
});

const filteredModules = computed(() => {
  const keyword = moduleQuery.value.trim().toLowerCase();
  if (!keyword) {
    return modules;
  }
  return modules.filter((item) => {
    const bag = `${item.label} ${item.key} ${item.hint}`.toLowerCase();
    return bag.includes(keyword);
  });
});

const groupedModules = computed(() => {
  const groupDefs: Array<{ key: ModuleOption["group"]; label: string }> = [
    { key: "core", label: "核心资料" },
    { key: "business", label: "业务运营" },
    { key: "system", label: "系统治理" },
  ];
  return groupDefs
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: filteredModules.value.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0);
});

const quickModules = computed(() => {
  return modules.filter((item) => item.key !== "overview").slice(0, 6);
});

const lastLoadedAtLabel = computed(() => {
  if (!lastLoadedAt.value) {
    return "未刷新";
  }
  return new Date(lastLoadedAt.value).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
});

const confirmDialogToneLabel = computed(() => {
  if (confirmDialog.tone === "danger") {
    return "高风险";
  }
  if (confirmDialog.tone === "warning") {
    return "需确认";
  }
  return "普通操作";
});

const confirmActionBtnClass = computed(() => {
  if (confirmDialog.tone === "danger") {
    return "danger";
  }
  if (confirmDialog.tone === "warning") {
    return "warn";
  }
  return "primary";
});

const confirmVerifyMatched = computed(() => {
  return confirmVerifyDialog.inputText.trim() === confirmVerifyDialog.expectedText.trim();
});

const crudModalCardClass = computed(() => {
  if (crudModal.size === "xl") {
    return "modal-card-xl";
  }
  if (crudModal.size === "lg") {
    return "modal-card-secondary";
  }
  return "";
});

const activeModuleStats = computed(() => {
  switch (activeModuleKey.value) {
    case "overview":
      return [
        `用户 ${overviewData.userCount}`,
        `班级 ${overviewData.classCount}`,
        `课表 ${overviewData.scheduleCount}`,
        `活动 ${overviewData.campaignCount}`,
      ];
    case "users":
      return [`总用户 ${usersData.value.length}`, `编辑对象 ${userEditor.userId || "未选择"}`];
    case "classes":
      return [
        `班级 ${classesData.value.length}`,
        `成员面板 ${classMembersData.value?.item?.classId ? "已加载" : "未加载"}`,
      ];
    case "schedules":
      return [
        `课表 ${schedulesData.value.length}`,
        `订阅 ${subscriptionsData.value.length}`,
        `冲突 ${conflictsData.value.length}`,
        `补丁 ${patchesData.value.length}`,
      ];
    case "foods":
      return [
        `食物 ${foodItemsData.value.length}`,
        `分类 ${foodCategoryStats.value.length}`,
        `零热量 ${foodCategoryStatsOverview.value.zeroCaloriesCount}`,
        `规则 ${foodRules.value.length}`,
      ];
    case "campaigns":
      return [`活动 ${campaignList.value.length}`, `详情 ${campaignDetailData.value ? "已加载" : "未加载"}`];
    case "media":
      return [`资产 ${mediaAssets.value.length}`, `筛选 ${mediaQueryForm.usage || "全部用途"}`];
    case "bots":
      return [`模板 ${botTemplates.value.length}`, `任务 ${botJobs.value.length}`];
    case "preview":
      return [`学号 ${previewForm.studentNo || "未填写"}`, `活动 ${previewForm.campaignId || "自动"}`];
    case "audit":
      return [`日志 ${auditItems.value.length}`];
    case "settings":
      return [`健康项 ${Object.keys(settingsData.health || {}).length}`, `接口元信息 已加载`];
    default:
      return [];
  }
});

const foodCategoryOptions = computed(() => {
  const map = new Map<string, string>();
  foodItemsData.value.forEach((item) => {
    const key = String(item.categoryKey || "").trim();
    if (!key || map.has(key)) {
      return;
    }
    map.set(key, String(item.categoryName || key));
  });
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
});

const foodCategoryStatsOverview = computed(() => {
  let totalFoods = 0;
  let zeroCaloriesCount = 0;
  foodCategoryStats.value.forEach((item) => {
    totalFoods += Number(item.foodCount || 0);
    zeroCaloriesCount += Number(item.zeroCaloriesCount || 0);
  });
  return {
    totalFoods,
    zeroCaloriesCount,
  };
});

const foodCategoryStatsChart = computed(() => {
  const rows = foodCategoryStats.value.map((item) => {
    const foodCount = Math.max(0, Number(item.foodCount || 0));
    const zeroCaloriesCount = Math.max(0, Number(item.zeroCaloriesCount || 0));
    const zeroRatePercent = foodCount > 0 ? Math.round((zeroCaloriesCount / foodCount) * 100) : 0;
    return {
      categoryKey: String(item.categoryKey || ""),
      categoryName: String(item.categoryName || item.categoryKey || ""),
      foodCount,
      zeroRatePercent,
    };
  });
  const maxCount = rows.reduce((acc, item) => Math.max(acc, item.foodCount), 0);
  const maxZeroRate = rows.reduce((acc, item) => Math.max(acc, item.zeroRatePercent), 0);
  const byCount = [...rows]
    .sort((left, right) => right.foodCount - left.foodCount || left.categoryName.localeCompare(right.categoryName))
    .slice(0, 10)
    .map((item) => ({
      ...item,
      barPercent: maxCount > 0 ? Math.max(4, Math.round((item.foodCount / maxCount) * 100)) : 0,
      zeroRateBarPercent: 0,
    }));
  const byZeroRate = [...rows]
    .filter((item) => item.foodCount > 0)
    .sort((left, right) => right.zeroRatePercent - left.zeroRatePercent || right.foodCount - left.foodCount)
    .slice(0, 10)
    .map((item) => ({
      ...item,
      zeroRateBarPercent: maxZeroRate > 0 ? Math.max(4, Math.round((item.zeroRatePercent / maxZeroRate) * 100)) : 0,
      barPercent: 0,
    }));
  return {
    byCount,
    byZeroRate,
  };
});

const overviewData = reactive({
  userCount: 0,
  classCount: 0,
  scheduleCount: 0,
  campaignCount: 0,
  mediaCount: 0,
  botJobCount: 0,
});

const usersData = ref<any[]>([]);
const classesData = ref<any[]>([]);
const classMembersData = ref<any | null>(null);
const schedulesData = ref<any[]>([]);
const subscriptionsData = ref<any[]>([]);
const conflictsData = ref<any[]>([]);
const patchesData = ref<any[]>([]);
const foodItemsData = ref<any[]>([]);
const foodCategoryStats = ref<any[]>([]);
const foodRules = ref<any[]>([]);
const foodRuleHistory = ref<any[]>([]);
const campaignList = ref<any[]>([]);
const campaignDetailData = ref<any>(null);
const mediaAssets = ref<any[]>([]);
const botTemplates = ref<any[]>([]);
const botJobs = ref<any[]>([]);
const auditItems = ref<any[]>([]);
const settingsData = reactive<{ health: any; root: any }>({
  health: {},
  root: {},
});
const previewData = reactive<{ profile: any; subscriptions: any; vote: any }>({
  profile: {},
  subscriptions: {},
  vote: {},
});

const userEditor = reactive({
  userId: "",
  name: "",
  nickname: "",
  classLabel: "",
  studentId: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: "30,15",
});

const classCreateForm = reactive({
  classLabel: "",
  ownerStudentNo: "",
  active: true,
});

const classEditForm = reactive({
  classId: "",
  classLabel: "",
  timezone: "Asia/Shanghai",
  active: true,
  ownerStudentNo: "",
});

const defaultEntriesJson = JSON.stringify(
  [
    {
      day: 1,
      startSection: 1,
      endSection: 2,
      weekExpr: "1-18",
      parity: "all",
      courseName: "课程名称",
      classroom: "教室",
      teacher: "教师",
    },
  ],
  null,
  2,
);

const scheduleCreateForm = reactive({
  classId: "",
  title: "",
  description: "",
  publishNow: true,
  entriesText: defaultEntriesJson,
});

const schedulePublishForm = reactive({
  scheduleId: "",
  entriesText: "",
});

const scheduleSubscribeForm = reactive({
  scheduleId: "",
});

const schedulePatchForm = reactive({
  subscriptionId: "",
  entryId: "",
  opType: "update",
  patchPayloadText: "{}",
});

const foodItemCreateForm = reactive({
  foodName: "",
  merchantName: "",
  categoryKey: "",
  categoryName: "",
  basePriceMin: 10,
  basePriceMax: 20,
  caloriesKcal: 0,
  latitude: 31.23,
  longitude: 121.47,
});

const foodItemEditForm = reactive({
  foodId: "",
  foodName: "",
  merchantName: "",
  categoryKey: "",
  categoryName: "",
  basePriceMin: 10,
  basePriceMax: 20,
  caloriesKcal: 0,
  latitude: 31.23,
  longitude: 121.47,
});

const foodQueryForm = reactive({
  categoryKey: "",
  keyword: "",
});

const foodImportForm = reactive({
  mode: "append",
  csvText: "",
});
const foodImportSummary = ref<any>(null);
const foodCaloriesBatchForm = reactive({
  scope: "category",
  categoryKey: "",
  keyword: "",
  writeMode: "fill_missing",
  applyAction: "commit",
  baseShift: 0,
  priceWeight: 16,
  minKcal: 120,
  maxKcal: 1500,
});
const foodCaloriesBatchSummary = ref<any>(null);
const foodCaloriesBatchExamples = ref<any[]>([]);

const pricingForm = reactive({
  categoryKey: "",
  categoryName: "",
  trendMode: "down",
  anchorHeadcount: 10,
  slope: 0.03,
  minFactor: 0.8,
  maxFactor: 1.2,
});

const pricingPreviewForm = reactive({
  categoryKey: "",
  basePriceMin: 12,
  basePriceMax: 20,
  headcountStart: 1,
  headcountEnd: 30,
  headcountStep: 1,
});

const pricingPreviewData = reactive<{ points: any[] }>({
  points: [],
});

const campaignCreateForm = reactive({
  title: "",
  classId: "",
  deadlineAtIso: "",
  isAnonymous: true,
  optionFoodIdsText: "",
});

const campaignDetailForm = reactive({
  campaignId: "",
  studentNo: "2305200101",
  shareToken: "",
});

const campaignVoteForm = reactive({
  foodId: "",
  score: 5,
});

const mediaQueryForm = reactive({
  ownerUserId: "",
  usage: "",
});

const mediaCreateForm = reactive({
  usage: "other",
  mime: "image/png",
  size: 0,
  fileName: "",
});

const mediaBindForm = reactive({
  avatarAssetId: "",
  wallpaperAssetId: "",
});

const mediaCleanupForm = reactive({
  onlyOrphans: true,
  olderThanHours: 24,
});

const botTemplateForm = reactive({
  id: "",
  key: "",
  title: "",
  body: "",
  enabled: true,
});

const botTriggerForm = reactive({
  rainy: false,
  date: "",
});

const previewForm = reactive({
  studentNo: "2305200101",
  campaignId: "",
  shareToken: "",
});

const clearMessage = () => {
  errorText.value = "";
  successText.value = "";
};

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
  setNexusTheme(theme.value);
};

const setSuccess = (message: string) => {
  successText.value = message;
};

const goToLogin = async () => {
  if (redirectingToLogin.value) {
    return;
  }
  redirectingToLogin.value = true;
  await navigateTo(buildNexusLoginPath(route.fullPath), { replace: true });
};

const openCrudModal = (key: CrudModalKey, title: string, description = "", size: CrudModalSize = "md") => {
  crudModal.open = true;
  crudModal.key = key;
  crudModal.title = title;
  crudModal.description = description;
  crudModal.size = size;
};

const closeCrudModal = () => {
  crudModal.open = false;
  crudModal.key = "";
  crudModal.title = "";
  crudModal.description = "";
  crudModal.size = "md";
};

const openUserEditModal = (item?: any) => {
  if (item) {
    selectUser(item);
  }
  if (!userEditor.userId) {
    errorText.value = "请先选择用户";
    return;
  }
  openCrudModal("user-edit", "编辑用户", "维护用户基础信息、角色与提醒配置。", "lg");
};

const openClassCreateModal = () => {
  openCrudModal("class-create", "创建班级", "新建班级并设置负责人学号。");
};

const openClassEditModal = (item?: any) => {
  if (item) {
    selectClass(item);
  }
  if (!classEditForm.classId) {
    errorText.value = "请先选择班级";
    return;
  }
  openCrudModal("class-edit", "编辑班级", "修改班级基础信息与启用状态。");
};

const selectFoodItem = (item: any) => {
  foodItemEditForm.foodId = String(item.foodId || "");
  foodItemEditForm.foodName = String(item.foodName || "");
  foodItemEditForm.merchantName = String(item.merchantName || "");
  foodItemEditForm.categoryKey = String(item.categoryKey || "");
  foodItemEditForm.categoryName = String(item.categoryName || "");
  foodItemEditForm.basePriceMin = Number(item.basePriceMin || 0);
  foodItemEditForm.basePriceMax = Number(item.basePriceMax || 0);
  foodItemEditForm.caloriesKcal = Number(item.caloriesKcal || 0);
  foodItemEditForm.latitude = Number(item.latitude || 31.23);
  foodItemEditForm.longitude = Number(item.longitude || 121.47);
};

const openFoodItemEditModal = (item?: any) => {
  if (item) {
    selectFoodItem(item);
  }
  if (!foodItemEditForm.foodId) {
    errorText.value = "请先选择食物";
    return;
  }
  openCrudModal("food-item-edit", "编辑食物", "更新名称、价格、热量与坐标。");
};

const openFoodImportCsvModal = () => {
  foodImportSummary.value = null;
  openCrudModal("food-import-csv", "CSV 批量导入食物", "一次导入多条食物，支持 append/upsert。", "lg");
};

const openFoodStatsModal = () => {
  openCrudModal("food-stats", "分类统计", "查看当前筛选范围内的分类聚合数据。", "xl");
};

const openFoodCaloriesBatchModal = () => {
  if (!foodCaloriesBatchForm.categoryKey && foodCategoryOptions.value.length > 0) {
    foodCaloriesBatchForm.categoryKey = String(foodCategoryOptions.value[0].value || "");
  }
  foodCaloriesBatchSummary.value = null;
  foodCaloriesBatchExamples.value = [];
  openCrudModal("food-calories-batch", "热量批量校正", "支持按分类或关键词一键重算热量，支持 dry-run 预览。", "lg");
};

const useFoodImportSample = () => {
  foodImportForm.csvText = [
    "name,merchantName,categoryKey,categoryName,basePriceMin,basePriceMax,caloriesKcal,latitude,longitude",
    "黑椒鸡腿饭,食光小馆,main-meal,正餐,22,30,680,31.2301,121.4731",
    "青提轻乳茶,果饮站,drink,饮品,14,19,260,31.2298,121.4723",
  ].join("\n");
};

const openBotTemplateModal = (item?: any) => {
  if (item) {
    selectBotTemplate(item);
  }
  openCrudModal("bot-template", "模板编辑", "编辑机器人模板内容与启用状态。", "lg");
};

const openConfirmDialog = (options: {
  title: string;
  message: string;
  confirmLabel?: string;
  detailText?: string;
  tone?: ConfirmTone;
  requireSecondary?: boolean;
  secondaryNote?: string;
  expectedText?: string;
  action: () => Promise<void>;
}) => {
  closeConfirmVerifyDialog();
  confirmDialog.open = true;
  confirmDialog.title = options.title;
  confirmDialog.message = options.message;
  confirmDialog.confirmLabel = options.confirmLabel || "确认执行";
  confirmDialog.detailText = options.detailText || "";
  confirmDialog.tone = options.tone || "neutral";
  confirmDialog.requireSecondary = Boolean(options.requireSecondary);
  confirmDialog.secondaryNote = options.secondaryNote || "该动作将立即生效，且会影响下游数据与成员视图。";
  confirmDialog.expectedText = options.expectedText || (options.tone === "danger" ? "确认执行" : "继续");
  confirmDialog.action = options.action;
};

const closeConfirmDialog = () => {
  confirmDialog.open = false;
  confirmDialog.title = "";
  confirmDialog.message = "";
  confirmDialog.confirmLabel = "确认执行";
  confirmDialog.detailText = "";
  confirmDialog.tone = "neutral";
  confirmDialog.requireSecondary = false;
  confirmDialog.secondaryNote = "";
  confirmDialog.expectedText = "";
  confirmDialog.action = null;
  closeConfirmDetailDialog();
  closeConfirmVerifyDialog();
};

const openConfirmDetailDialog = () => {
  if (!confirmDialog.detailText) {
    return;
  }
  confirmDetailDialog.open = true;
  confirmDetailDialog.title = `${confirmDialog.title} · 影响详情`;
  confirmDetailDialog.content = confirmDialog.detailText;
};

const closeConfirmDetailDialog = () => {
  confirmDetailDialog.open = false;
  confirmDetailDialog.title = "";
  confirmDetailDialog.content = "";
};

const openConfirmVerifyDialog = () => {
  if (!confirmDialog.action) {
    return;
  }
  confirmVerifyDialog.open = true;
  confirmVerifyDialog.title = `${confirmDialog.title} · 二次确认`;
  confirmVerifyDialog.note = confirmDialog.secondaryNote || "请再次确认后执行。";
  confirmVerifyDialog.expectedText = confirmDialog.expectedText || "继续";
  confirmVerifyDialog.inputText = "";
  confirmVerifyDialog.confirmLabel = confirmDialog.confirmLabel || "确认执行";
  confirmVerifyDialog.tone = confirmDialog.tone;
};

const closeConfirmVerifyDialog = () => {
  confirmVerifyDialog.open = false;
  confirmVerifyDialog.title = "";
  confirmVerifyDialog.note = "";
  confirmVerifyDialog.expectedText = "";
  confirmVerifyDialog.inputText = "";
  confirmVerifyDialog.confirmLabel = "确认执行";
  confirmVerifyDialog.tone = "warning";
};

const runConfirmAction = async () => {
  if (!confirmDialog.action) {
    closeConfirmDialog();
    return;
  }
  if (confirmDialog.requireSecondary) {
    openConfirmVerifyDialog();
    return;
  }
  const action = confirmDialog.action;
  await action();
  closeConfirmDialog();
  closeConfirmDetailDialog();
  closeConfirmVerifyDialog();
};

const runConfirmVerifyAction = async () => {
  if (!confirmDialog.action) {
    closeConfirmVerifyDialog();
    closeConfirmDialog();
    return;
  }
  if (!confirmVerifyMatched.value) {
    return;
  }
  const action = confirmDialog.action;
  await action();
  closeConfirmVerifyDialog();
  closeConfirmDialog();
  closeConfirmDetailDialog();
};

const openJsonDialog = (title: string, payload: unknown) => {
  jsonDialog.open = true;
  jsonDialog.title = title;
  jsonDialog.content = toJson(payload);
};

const closeJsonDialog = () => {
  jsonDialog.open = false;
  jsonDialog.title = "";
  jsonDialog.content = "";
};

const jumpToModule = async (moduleKey: string) => {
  const key = String(moduleKey || "").trim().toLowerCase();
  if (!modules.some((item) => item.key === key)) {
    return;
  }
  if (activeModuleKey.value === key) {
    return;
  }
  closeCrudModal();
  await navigateTo(key === "overview" ? "/nexus" : `/nexus/${key}`);
};

const requestLogout = () => {
  openConfirmDialog({
    title: "退出登录",
    message: "将清除当前管理会话并返回登录页。",
    confirmLabel: "确认退出",
    tone: "warning",
    detailText: "动作类型：会话终止\n影响范围：当前浏览器会话\n恢复方式：重新输入学号和密码登录",
    action: logout,
  });
};

const requestRotateClassCode = (classId: string, classLabel: string) => {
  openConfirmDialog({
    title: "轮换班级加入码",
    message: `确认为「${classLabel || classId}」生成新加入码吗？旧码会立即失效。`,
    confirmLabel: "确认换码",
    tone: "danger",
    requireSecondary: true,
    secondaryNote: "加入码轮换会立即让旧码失效，已分发的旧码将无法继续加入班级。",
    detailText: `班级ID：${classId}\n风险：已分享的旧码会立刻不可用\n建议：先通知班级成员再执行`,
    action: () => rotateClassCode(classId),
  });
};

const requestResolveConflict = (conflictId: string, action: "keep_patch" | "relink") => {
  const isKeep = action === "keep_patch";
  openConfirmDialog({
    title: isKeep ? "保留补丁并关闭冲突" : "恢复跟随上游课表",
    message: isKeep ? "将保留当前补丁并标记冲突已处理。" : "将按上游版本覆盖当前冲突项。",
    confirmLabel: isKeep ? "保留补丁" : "恢复跟随",
    tone: "warning",
    requireSecondary: true,
    secondaryNote: "冲突处理将改变该订阅的后续同步路径，请确认后再执行。",
    detailText: `冲突ID：${conflictId}\n处理动作：${action}\n注意：该操作会影响后续同步行为`,
    action: () => resolveConflict(conflictId, action),
  });
};

const requestRelinkPatch = (patchId: string) => {
  openConfirmDialog({
    title: "补丁恢复跟随",
    message: "确认移除该补丁并恢复自动跟随上游课表吗？",
    confirmLabel: "确认恢复",
    tone: "warning",
    requireSecondary: true,
    secondaryNote: "执行后当前补丁不再生效，该课程会重新跟随上游版本。",
    detailText: `补丁ID：${patchId}\n影响：个人修改将不再生效`,
    action: () => relinkPatch(patchId),
  });
};

const requestRollbackPricingRule = (versionId: string) => {
  openConfirmDialog({
    title: "价格规则回滚",
    message: "确认回滚到该历史版本？当前规则会被覆盖。",
    confirmLabel: "确认回滚",
    tone: "danger",
    requireSecondary: true,
    secondaryNote: "回滚后新订单将按历史规则计算，请先确认业务时段和价格影响。",
    detailText: `版本ID：${versionId}\n影响：后续价格预览和结算将按历史参数执行`,
    action: () => rollbackPricingRule(versionId),
  });
};

const requestDeleteFoodItem = (foodId: string, foodName: string) => {
  openConfirmDialog({
    title: "删除食物",
    message: `确认删除「${foodName || foodId}」吗？关联竞选候选会自动重排。`,
    confirmLabel: "确认删除",
    tone: "danger",
    requireSecondary: true,
    secondaryNote: "删除会影响活动候选与投票明细，请确认后再执行。",
    detailText: `食物ID：${foodId}\n食物名称：${foodName || "-"}\n影响：活动候选将移除该食物，相关投票记录会清理`,
    action: () => deleteFoodItem(foodId),
  });
};

const requestCloseCampaign = (campaignId: string, title: string) => {
  openConfirmDialog({
    title: "结束投票活动",
    message: `确认结束「${title || campaignId}」吗？结束后将进入揭示阶段。`,
    confirmLabel: "确认结束",
    tone: "danger",
    requireSecondary: true,
    secondaryNote: "活动结束后状态不可逆，匿名活动将进入揭示阶段并影响可见范围。",
    detailText: `活动ID：${campaignId}\n影响：活动状态从 open 变为 closed\n建议：结束前先确认投票完整性`,
    action: () => closeCampaign(campaignId),
  });
};

const requestReconcileMediaAssets = () => {
  openConfirmDialog({
    title: "媒体资产对账",
    message: "确认执行媒体引用对账？将重新扫描引用关系。",
    confirmLabel: "开始对账",
    tone: "warning",
    detailText: "影响：更新媒体 referenced 标记\n建议：清理前先执行一次对账",
    action: reconcileMediaAssets,
  });
};

const requestCleanupMediaAssets = () => {
  openConfirmDialog({
    title: "执行媒体清理",
    message: "确认执行清理任务？可能删除孤儿媒体记录。",
    confirmLabel: "确认清理",
    tone: "danger",
    requireSecondary: true,
    secondaryNote: "清理操作会删除满足条件的资产记录，建议先对账并检查筛选条件。",
    detailText: `onlyOrphans：${mediaCleanupForm.onlyOrphans}\nolderThanHours：${mediaCleanupForm.olderThanHours}`,
    action: cleanupMediaAssets,
  });
};

const apiRequest = async <T = unknown>(path: string, method: "GET" | "POST" = "GET", body?: unknown) => {
  const headers: Record<string, string> = {};
  if (sessionToken.value) {
    headers.Authorization = `Bearer ${sessionToken.value}`;
  }
  if (method === "POST") {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: "omit",
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });
  const json = (await response.json()) as ApiEnvelope<T>;
  if (response.status === 401 || String(json?.error?.code || "").includes("AUTH")) {
    sessionToken.value = "";
    clearNexusSessionToken();
    await goToLogin();
    throw new Error("登录已失效，请重新登录");
  }
  if (!response.ok || !json.ok) {
    throw new Error(String(json?.error?.message || `HTTP ${response.status}`));
  }
  return json.data as T;
};

const parseJsonArray = (text: string) => {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }
  const value = JSON.parse(source);
  if (!Array.isArray(value)) {
    throw new Error("请输入 JSON 数组");
  }
  return value;
};

const parseJsonObject = (text: string) => {
  const source = String(text || "").trim();
  if (!source) {
    return {};
  }
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请输入 JSON 对象");
  }
  return value;
};

const toDisplayDate = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const timestamp = Number(raw);
  if (Number.isFinite(timestamp) && timestamp > 0 && raw.length <= 13) {
    return new Date(timestamp).toLocaleString("zh-CN");
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleString("zh-CN");
  }
  return raw;
};

const toJson = (value: unknown) => {
  return JSON.stringify(value || {}, null, 2);
};

const runWithLoading = async (runner: () => Promise<void>) => {
  loading.value = true;
  clearMessage();
  try {
    await runner();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "请求失败";
  } finally {
    loading.value = false;
  }
};

const loadOverview = async () => {
  const [users, classes, schedules, campaigns, media, jobs] = await Promise.all([
    apiRequest<any>("/api/v1/admin/users?limit=500"),
    apiRequest<any>("/api/v1/admin/classes"),
    apiRequest<any>("/api/v1/admin/schedules"),
    apiRequest<any>("/api/v1/admin/food-campaigns"),
    apiRequest<any>("/api/v1/admin/media-assets"),
    apiRequest<any>("/api/v1/bot/jobs/history?limit=100"),
  ]);
  overviewData.userCount = users.items?.length || 0;
  overviewData.classCount = classes.items?.length || 0;
  overviewData.scheduleCount = schedules.items?.length || 0;
  overviewData.campaignCount = campaigns.items?.length || 0;
  overviewData.mediaCount = media.items?.length || 0;
  overviewData.botJobCount = jobs.items?.length || 0;
};

const selectUser = (item: any) => {
  userEditor.userId = String(item.userId || "");
  userEditor.name = String(item.name || "");
  userEditor.nickname = String(item.nickname || "");
  userEditor.classLabel = String(item.classLabel || "");
  userEditor.studentId = String(item.studentId || "");
  userEditor.adminRole = String(item.adminRole || "none");
  userEditor.reminderEnabled = Boolean(item.reminderEnabled);
  userEditor.reminderWindowMinutes = Array.isArray(item.reminderWindowMinutes)
    ? item.reminderWindowMinutes.join(",")
    : "30,15";
};

const loadUsers = async () => {
  const data = await apiRequest<any>("/api/v1/admin/users?limit=500");
  usersData.value = data.items || [];
  if (!userEditor.userId && usersData.value.length > 0) {
    selectUser(usersData.value[0]);
  }
};

const saveUser = async () => {
  if (!userEditor.userId) {
    throw new Error("请先选择用户");
  }
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/admin/users/${encodeURIComponent(userEditor.userId)}/update`, "POST", {
      name: userEditor.name,
      nickname: userEditor.nickname,
      classLabel: userEditor.classLabel,
      studentId: userEditor.studentId,
      adminRole: userEditor.adminRole,
      reminderEnabled: userEditor.reminderEnabled,
      reminderWindowMinutes: userEditor.reminderWindowMinutes,
    });
    await loadUsers();
    setSuccess("用户已更新");
  });
};

const selectClass = (item: any) => {
  classEditForm.classId = String(item.classId || "");
  classEditForm.classLabel = String(item.classLabel || "");
  classEditForm.timezone = String(item.timezone || "Asia/Shanghai");
  classEditForm.active = Boolean(item.active);
  classEditForm.ownerStudentNo = "";
};

const loadClasses = async () => {
  const data = await apiRequest<any>("/api/v1/admin/classes");
  classesData.value = data.items || [];
  if (!classEditForm.classId && classesData.value.length > 0) {
    selectClass(classesData.value[0]);
  }
  if (!scheduleCreateForm.classId && classesData.value.length > 0) {
    scheduleCreateForm.classId = String(classesData.value[0].classId || "");
  }
};

const createClass = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/classes", "POST", {
      classLabel: classCreateForm.classLabel,
      ownerStudentNo: classCreateForm.ownerStudentNo || undefined,
      active: classCreateForm.active,
    });
    classCreateForm.classLabel = "";
    classCreateForm.ownerStudentNo = "";
    classCreateForm.active = true;
    await loadClasses();
    setSuccess("班级已创建");
  });
};

const saveClass = async () => {
  if (!classEditForm.classId) {
    throw new Error("请先选择班级");
  }
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/admin/classes/${encodeURIComponent(classEditForm.classId)}/update`, "POST", {
      classLabel: classEditForm.classLabel,
      timezone: classEditForm.timezone,
      active: classEditForm.active,
      ownerStudentNo: classEditForm.ownerStudentNo || undefined,
    });
    await loadClasses();
    setSuccess("班级已更新");
  });
};

const rotateClassCode = async (classId: string) => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/admin/classes/${encodeURIComponent(classId)}/rotate-code`, "POST", {});
    await loadClasses();
    if (classMembersData.value?.item?.classId === classId) {
      await loadClassMembers(classId, true);
    }
    setSuccess("班级加入码已轮换");
  });
};

const loadClassMembers = async (classId: string, silent = false) => {
  const runner = async () => {
    const data = await apiRequest<any>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/members`);
    classMembersData.value = data;
  };
  if (silent) {
    await runner();
    return;
  }
  await runWithLoading(runner);
};

const loadSchedules = async () => {
  const [schedules, subscriptions, conflicts, patches] = await Promise.all([
    apiRequest<any>("/api/v1/admin/schedules"),
    apiRequest<any>("/api/v1/me/schedule-subscriptions"),
    apiRequest<any>("/api/v1/me/schedule-conflicts"),
    apiRequest<any>("/api/v1/me/schedule-patches"),
  ]);
  schedulesData.value = schedules.items || [];
  subscriptionsData.value = subscriptions.items || [];
  conflictsData.value = conflicts.items || [];
  patchesData.value = patches.items || [];
  if (!schedulePublishForm.scheduleId && schedulesData.value.length > 0) {
    schedulePublishForm.scheduleId = String(schedulesData.value[0].scheduleId || "");
    scheduleSubscribeForm.scheduleId = String(schedulesData.value[0].scheduleId || "");
  }
};

const createSchedule = async () => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/classes/${encodeURIComponent(scheduleCreateForm.classId)}/schedules`, "POST", {
      title: scheduleCreateForm.title,
      description: scheduleCreateForm.description,
      publishNow: scheduleCreateForm.publishNow,
      entries: parseJsonArray(scheduleCreateForm.entriesText),
    });
    await loadSchedules();
    setSuccess("课表已创建");
  });
};

const publishSchedule = async () => {
  await runWithLoading(async () => {
    const body = schedulePublishForm.entriesText.trim()
      ? {
          entries: parseJsonArray(schedulePublishForm.entriesText),
        }
      : {};
    await apiRequest(`/api/v1/schedules/${encodeURIComponent(schedulePublishForm.scheduleId)}/publish`, "POST", body);
    await loadSchedules();
    setSuccess("课表版本已发布");
  });
};

const subscribeSchedule = async () => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/schedules/${encodeURIComponent(scheduleSubscribeForm.scheduleId)}/subscribe`, "POST", {});
    await loadSchedules();
    setSuccess("订阅已创建");
  });
};

const createSchedulePatch = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/me/schedule-patches", "POST", {
      subscriptionId: schedulePatchForm.subscriptionId,
      entryId: schedulePatchForm.entryId,
      opType: schedulePatchForm.opType,
      patchPayload: parseJsonObject(schedulePatchForm.patchPayloadText),
    });
    await loadSchedules();
    setSuccess("补丁已创建");
  });
};

const resolveConflict = async (conflictId: string, action: "keep_patch" | "relink") => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/me/schedule-conflicts/${encodeURIComponent(conflictId)}/resolve`, "POST", { action });
    await loadSchedules();
    setSuccess("冲突已处理");
  });
};

const relinkPatch = async (patchId: string) => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/me/schedule-patches/${encodeURIComponent(patchId)}/relink`, "POST", {});
    await loadSchedules();
    setSuccess("已恢复跟随");
  });
};

const selectPricingRule = (item: any) => {
  pricingForm.categoryKey = String(item.categoryKey || "");
  pricingForm.categoryName = String(item.categoryName || "");
  pricingForm.trendMode = String(item.trendMode || "down");
  pricingForm.anchorHeadcount = Number(item.anchorHeadcount || 10);
  pricingForm.slope = Number(item.slope || 0.03);
  pricingForm.minFactor = Number(item.minFactor || 0.8);
  pricingForm.maxFactor = Number(item.maxFactor || 1.2);
  pricingPreviewForm.categoryKey = pricingForm.categoryKey;
};

const normalizeFoodPriceRange = () => {
  const minValue = Math.max(0, Number(foodItemCreateForm.basePriceMin || 0));
  const maxValue = Math.max(minValue, Number(foodItemCreateForm.basePriceMax || 0));
  foodItemCreateForm.basePriceMin = minValue;
  foodItemCreateForm.basePriceMax = maxValue;
};

const normalizeFoodEditPriceRange = () => {
  const minValue = Math.max(0, Number(foodItemEditForm.basePriceMin || 0));
  const maxValue = Math.max(minValue, Number(foodItemEditForm.basePriceMax || 0));
  foodItemEditForm.basePriceMin = minValue;
  foodItemEditForm.basePriceMax = maxValue;
};

const loadFoods = async () => {
  const foodParams = new URLSearchParams();
  if (foodQueryForm.categoryKey.trim()) {
    foodParams.set("categoryKey", foodQueryForm.categoryKey.trim());
  }
  if (foodQueryForm.keyword.trim()) {
    foodParams.set("keyword", foodQueryForm.keyword.trim());
  }
  const foodQuery = foodParams.toString();
  const [foods, stats, rules, history, campaigns] = await Promise.all([
    apiRequest<any>(`/api/v1/admin/foods${foodQuery ? `?${foodQuery}` : ""}`),
    apiRequest<any>(`/api/v1/admin/foods/category-stats${foodQuery ? `?${foodQuery}` : ""}`),
    apiRequest<any>("/api/v1/admin/food-pricing-rules"),
    apiRequest<any>("/api/v1/admin/food-pricing-rules/history"),
    apiRequest<any>("/api/v1/admin/food-campaigns"),
  ]);
  foodItemsData.value = foods.items || [];
  foodCategoryStats.value = stats.items || [];
  foodRules.value = rules.items || [];
  foodRuleHistory.value = history.items || [];
  campaignList.value = campaigns.items || [];
  if (foodItemsData.value.length > 0) {
    const current = foodItemsData.value.find((item) => String(item.foodId || "") === foodItemEditForm.foodId) || null;
    if (current) {
      selectFoodItem(current);
    } else {
      selectFoodItem(foodItemsData.value[0]);
    }
  } else {
    foodItemEditForm.foodId = "";
    foodItemEditForm.foodName = "";
    foodItemEditForm.merchantName = "";
    foodItemEditForm.categoryKey = "";
    foodItemEditForm.categoryName = "";
  }
  if (foodRules.value.length > 0 && !pricingForm.categoryKey) {
    selectPricingRule(foodRules.value[0]);
  }
  if (!foodCaloriesBatchForm.categoryKey && foodCategoryOptions.value.length > 0) {
    foodCaloriesBatchForm.categoryKey = String(foodCategoryOptions.value[0].value || "");
  }
};

const applyFoodFilter = async () => {
  await runWithLoading(async () => {
    await loadFoods();
    closeCrudModal();
    setSuccess("食物筛选已生效");
  });
};

const resetFoodFilter = async () => {
  foodQueryForm.categoryKey = "";
  foodQueryForm.keyword = "";
  await runWithLoading(async () => {
    await loadFoods();
    closeCrudModal();
    setSuccess("已重置食物筛选");
  });
};

const importFoodCsv = async () => {
  const csvText = String(foodImportForm.csvText || "").trim();
  if (!csvText) {
    throw new Error("请先填写 CSV 内容");
  }
  await runWithLoading(async () => {
    const data = await apiRequest<any>("/api/v1/admin/foods/import-csv", "POST", {
      mode: foodImportForm.mode === "upsert" ? "upsert" : "append",
      csvText,
    });
    foodImportSummary.value = data.summary || null;
    await loadFoods();
    setSuccess("CSV 导入完成");
  });
};

const recalculateFoodCalories = async () => {
  if (foodCaloriesBatchForm.scope === "category" && !foodCaloriesBatchForm.categoryKey.trim()) {
    throw new Error("请选择分类");
  }
  const minKcal = Math.max(50, Number(foodCaloriesBatchForm.minKcal || 120));
  const maxKcal = Math.max(minKcal, Number(foodCaloriesBatchForm.maxKcal || minKcal));
  foodCaloriesBatchForm.minKcal = minKcal;
  foodCaloriesBatchForm.maxKcal = maxKcal;
  await runWithLoading(async () => {
    const data = await apiRequest<any>("/api/v1/admin/foods/calories/recalculate", "POST", {
      scope: foodCaloriesBatchForm.scope === "category" ? "category" : "all",
      categoryKey: foodCaloriesBatchForm.scope === "category" ? foodCaloriesBatchForm.categoryKey.trim() : undefined,
      keyword: foodCaloriesBatchForm.keyword.trim() || undefined,
      writeMode: foodCaloriesBatchForm.writeMode === "overwrite" ? "overwrite" : "fill_missing",
      applyAction: foodCaloriesBatchForm.applyAction === "dry_run" ? "dry_run" : "commit",
      baseShift: Number(foodCaloriesBatchForm.baseShift || 0),
      priceWeight: Number(foodCaloriesBatchForm.priceWeight || 16),
      minKcal,
      maxKcal,
    });
    foodCaloriesBatchSummary.value = data.summary || null;
    foodCaloriesBatchExamples.value = Array.isArray(data.examples) ? data.examples : [];
    if (Array.isArray(data.categoryStats)) {
      foodCategoryStats.value = data.categoryStats;
    }
    if (foodCaloriesBatchForm.applyAction === "commit") {
      await loadFoods();
      setSuccess("热量批量校正已执行");
    } else {
      setSuccess("热量批量校正预览已生成");
    }
  });
};

const createFoodItem = async () => {
  if (!foodItemCreateForm.foodName.trim()) {
    throw new Error("请填写食物名称");
  }
  if (!foodItemCreateForm.categoryKey.trim()) {
    throw new Error("请填写分类键");
  }
  normalizeFoodPriceRange();
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/foods", "POST", {
      name: foodItemCreateForm.foodName.trim(),
      merchantName: foodItemCreateForm.merchantName.trim() || undefined,
      categoryKey: foodItemCreateForm.categoryKey.trim().toLowerCase(),
      categoryName: foodItemCreateForm.categoryName.trim() || undefined,
      basePriceMin: foodItemCreateForm.basePriceMin,
      basePriceMax: foodItemCreateForm.basePriceMax,
      caloriesKcal: Math.max(0, Number(foodItemCreateForm.caloriesKcal || 0)),
      latitude: foodItemCreateForm.latitude,
      longitude: foodItemCreateForm.longitude,
    });
    await loadFoods();
    closeCrudModal();
    foodItemCreateForm.foodName = "";
    foodItemCreateForm.merchantName = "";
    foodItemCreateForm.categoryKey = "";
    foodItemCreateForm.categoryName = "";
    foodItemCreateForm.basePriceMin = 10;
    foodItemCreateForm.basePriceMax = 20;
    foodItemCreateForm.caloriesKcal = 0;
    foodItemCreateForm.latitude = 31.23;
    foodItemCreateForm.longitude = 121.47;
    setSuccess("食物已创建");
  });
};

const saveFoodItem = async () => {
  if (!foodItemEditForm.foodId) {
    throw new Error("请先选择食物");
  }
  if (!foodItemEditForm.foodName.trim()) {
    throw new Error("请填写食物名称");
  }
  if (!foodItemEditForm.categoryKey.trim()) {
    throw new Error("请填写分类键");
  }
  normalizeFoodEditPriceRange();
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/admin/foods/${encodeURIComponent(foodItemEditForm.foodId)}/update`, "POST", {
      name: foodItemEditForm.foodName.trim(),
      merchantName: foodItemEditForm.merchantName.trim() || undefined,
      categoryKey: foodItemEditForm.categoryKey.trim().toLowerCase(),
      categoryName: foodItemEditForm.categoryName.trim() || undefined,
      basePriceMin: foodItemEditForm.basePriceMin,
      basePriceMax: foodItemEditForm.basePriceMax,
      caloriesKcal: Math.max(0, Number(foodItemEditForm.caloriesKcal || 0)),
      latitude: foodItemEditForm.latitude,
      longitude: foodItemEditForm.longitude,
    });
    await loadFoods();
    closeCrudModal();
    setSuccess("食物已更新");
  });
};

const deleteFoodItem = async (foodId: string) => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/admin/foods/${encodeURIComponent(foodId)}/delete`, "POST", {});
    await loadFoods();
    setSuccess("食物已删除");
  });
};

const savePricingRule = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/food-pricing-rules", "POST", {
      categoryKey: pricingForm.categoryKey,
      categoryName: pricingForm.categoryName,
      trendMode: pricingForm.trendMode,
      anchorHeadcount: pricingForm.anchorHeadcount,
      slope: pricingForm.slope,
      minFactor: pricingForm.minFactor,
      maxFactor: pricingForm.maxFactor,
    });
    await loadFoods();
    setSuccess("价格规则已保存");
  });
};

const previewPricingRule = async () => {
  await runWithLoading(async () => {
    const data = await apiRequest<any>("/api/v1/admin/food-pricing-rules/preview", "POST", {
      categoryKey: pricingPreviewForm.categoryKey,
      basePriceMin: pricingPreviewForm.basePriceMin,
      basePriceMax: pricingPreviewForm.basePriceMax,
      headcountStart: pricingPreviewForm.headcountStart,
      headcountEnd: pricingPreviewForm.headcountEnd,
      headcountStep: pricingPreviewForm.headcountStep,
    });
    pricingPreviewData.points = data.preview?.points || [];
    setSuccess("曲线已更新");
  });
};

const rollbackPricingRule = async (versionId: string) => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/food-pricing-rules/rollback", "POST", { versionId });
    await loadFoods();
    setSuccess("已回滚到历史版本");
  });
};

const loadCampaigns = async () => {
  const data = await apiRequest<any>("/api/v1/admin/food-campaigns");
  campaignList.value = data.items || [];
  if (!campaignDetailForm.campaignId && campaignList.value.length > 0) {
    campaignDetailForm.campaignId = String(campaignList.value[0].campaignId || "");
  }
};

const createCampaign = async () => {
  await runWithLoading(async () => {
    const optionFoodIds = campaignCreateForm.optionFoodIdsText
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    await apiRequest("/api/v1/food-campaigns", "POST", {
      title: campaignCreateForm.title,
      classId: campaignCreateForm.classId || undefined,
      deadlineAtIso: campaignCreateForm.deadlineAtIso || undefined,
      isAnonymous: campaignCreateForm.isAnonymous,
      optionFoodIds,
    });
    await loadCampaigns();
    setSuccess("投票活动已创建");
  });
};

const quickSelectCampaign = async (campaignId: string) => {
  campaignDetailForm.campaignId = campaignId;
  await loadCampaignDetail();
};

const loadCampaignDetail = async () => {
  await runWithLoading(async () => {
    if (!campaignDetailForm.campaignId) {
      throw new Error("请选择活动");
    }
    const params = new URLSearchParams();
    if (campaignDetailForm.shareToken.trim()) {
      params.set("shareToken", campaignDetailForm.shareToken.trim());
    }
    const query = params.toString();
    campaignDetailData.value = await apiRequest(
      `/api/v1/food-campaigns/${encodeURIComponent(campaignDetailForm.campaignId)}${query ? `?${query}` : ""}`,
    );
    setSuccess("活动详情已刷新");
  });
};

const voteCampaign = async () => {
  await runWithLoading(async () => {
    if (!campaignDetailForm.campaignId) {
      throw new Error("请选择活动");
    }
    await apiRequest(`/api/v1/food-campaigns/${encodeURIComponent(campaignDetailForm.campaignId)}/vote`, "POST", {
      foodId: campaignVoteForm.foodId,
      score: campaignVoteForm.score,
    });
    await loadCampaignDetail();
    await loadCampaigns();
    setSuccess("投票已提交");
  });
};

const closeCampaign = async (campaignId: string) => {
  await runWithLoading(async () => {
    await apiRequest(`/api/v1/food-campaigns/${encodeURIComponent(campaignId)}/close`, "POST", {});
    await loadCampaigns();
    if (campaignDetailForm.campaignId === campaignId) {
      await loadCampaignDetail();
    }
    setSuccess("活动已结束");
  });
};

const fetchMediaAssets = async () => {
  const params = new URLSearchParams();
  if (mediaQueryForm.ownerUserId.trim()) {
    params.set("ownerUserId", mediaQueryForm.ownerUserId.trim());
  }
  if (mediaQueryForm.usage) {
    params.set("usage", mediaQueryForm.usage);
  }
  const query = params.toString();
  const data = await apiRequest<any>(`/api/v1/admin/media-assets${query ? `?${query}` : ""}`);
  mediaAssets.value = data.items || [];
};

const loadMediaAssets = async () => {
  await runWithLoading(fetchMediaAssets);
};

const createMediaAsset = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/media/assets", "POST", {
      usage: mediaCreateForm.usage,
      mime: mediaCreateForm.mime,
      size: mediaCreateForm.size,
      fileName: mediaCreateForm.fileName || undefined,
    });
    await fetchMediaAssets();
    setSuccess("媒体资源已创建");
  });
};

const bindProfileMedia = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/me/profile/media", "POST", {
      avatarAssetId: mediaBindForm.avatarAssetId || undefined,
      wallpaperAssetId: mediaBindForm.wallpaperAssetId || undefined,
    });
    await fetchMediaAssets();
    setSuccess("媒体已绑定到当前账号");
  });
};

const reconcileMediaAssets = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/media-assets/reconcile", "POST", {});
    await fetchMediaAssets();
    setSuccess("媒体引用已对账");
  });
};

const cleanupMediaAssets = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/admin/media-assets/cleanup", "POST", {
      onlyOrphans: mediaCleanupForm.onlyOrphans,
      olderThanHours: mediaCleanupForm.olderThanHours,
    });
    await fetchMediaAssets();
    setSuccess("媒体清理已完成");
  });
};

const selectBotTemplate = (item: any) => {
  botTemplateForm.id = String(item.id || "");
  botTemplateForm.key = String(item.key || "");
  botTemplateForm.title = String(item.title || "");
  botTemplateForm.body = String(item.body || "");
  botTemplateForm.enabled = Boolean(item.enabled);
};

const loadBots = async () => {
  const [templates, jobs] = await Promise.all([
    apiRequest<any>("/api/v1/bot/templates"),
    apiRequest<any>("/api/v1/bot/jobs/history?limit=200"),
  ]);
  botTemplates.value = templates.items || [];
  botJobs.value = jobs.items || [];
  if (!botTemplateForm.id && botTemplates.value.length > 0) {
    selectBotTemplate(botTemplates.value[0]);
  }
};

const saveBotTemplate = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/bot/templates", "POST", {
      id: botTemplateForm.id || undefined,
      key: botTemplateForm.key,
      title: botTemplateForm.title,
      body: botTemplateForm.body,
      enabled: botTemplateForm.enabled,
    });
    await loadBots();
    setSuccess("机器人模板已保存");
  });
};

const triggerNextDayJob = async () => {
  await runWithLoading(async () => {
    await apiRequest("/api/v1/bot/jobs/trigger-next-day", "POST", {
      rainy: botTriggerForm.rainy,
      date: botTriggerForm.date || undefined,
    });
    await loadBots();
    setSuccess("次日任务已触发");
  });
};

const fetchPreviewData = async () => {
  const profileParams = new URLSearchParams();
  profileParams.set("studentNo", previewForm.studentNo.trim());
  const [profile, subscriptions, vote] = await Promise.all([
    apiRequest<any>(`/api/v1/admin/preview/profile-card?${profileParams.toString()}`),
    apiRequest<any>(`/api/v1/admin/preview/class-subscriptions?${profileParams.toString()}`),
    apiRequest<any>(
      `/api/v1/admin/preview/food-vote-state?${new URLSearchParams({
        studentNo: previewForm.studentNo.trim(),
        ...(previewForm.campaignId.trim() ? { campaignId: previewForm.campaignId.trim() } : {}),
        ...(previewForm.shareToken.trim() ? { shareToken: previewForm.shareToken.trim() } : {}),
      }).toString()}`,
    ),
  ]);
  previewData.profile = profile;
  previewData.subscriptions = subscriptions;
  previewData.vote = vote;
};

const loadPreviewData = async () => {
  await runWithLoading(async () => {
    await fetchPreviewData();
    setSuccess("预览数据已刷新");
  });
};

const loadAudit = async () => {
  const data = await apiRequest<any>("/api/v1/admin/audit?limit=200");
  auditItems.value = data.items || [];
};

const loadSettings = async () => {
  const [health, root] = await Promise.all([apiRequest<any>("/health"), apiRequest<any>("/api/v1")]);
  settingsData.health = health;
  settingsData.root = root;
};

const moduleLoaders: Record<string, () => Promise<void>> = {
  overview: loadOverview,
  users: loadUsers,
  classes: loadClasses,
  schedules: loadSchedules,
  foods: loadFoods,
  campaigns: loadCampaigns,
  media: async () => {
    await fetchMediaAssets();
  },
  bots: loadBots,
  preview: async () => {
    await loadCampaigns();
    await fetchPreviewData();
  },
  audit: loadAudit,
  settings: loadSettings,
};

const refreshModule = async () => {
  if (!sessionToken.value) {
    await goToLogin();
    return;
  }
  await runWithLoading(async () => {
    const loader = moduleLoaders[activeModuleKey.value] || moduleLoaders.overview;
    await loader();
    lastLoadedAt.value = Date.now();
  });
};

const logout = async () => {
  await runWithLoading(async () => {
    if (sessionToken.value) {
      await apiRequest("/api/v1/admin/logout", "POST", {});
    }
    clearNexusSessionToken();
    sessionToken.value = "";
    await goToLogin();
  });
};

onMounted(async () => {
  theme.value = getPreferredNexusTheme();
  sessionToken.value = getNexusSessionToken();
  await refreshModule();
});

watch(activeModuleKey, () => {
  void refreshModule();
});
</script>

<style scoped>
.nexus-root {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.nexus-root[data-theme="dark"] {
  --bg: #090d14;
  --bg-soft: #0f1622;
  --panel: #111a28;
  --panel-soft: #142032;
  --text: #f7f7f7;
  --text-muted: rgba(245, 245, 245, 0.64);
  --text-muted-strong: rgba(245, 245, 245, 0.86);
  --border: rgba(255, 255, 255, 0.14);
  --line: rgba(255, 255, 255, 0.08);
  --table-head: rgba(255, 255, 255, 0.72);
  --surface: rgba(153, 206, 255, 0.08);
  --input-bg: #0a0a0a;
  --input-text: #f7f7f7;
  --input-border: rgba(255, 255, 255, 0.2);
  --active-bg: #95d2ff;
  --active-text: #0d1a29;
  --btn-bg: rgba(149, 210, 255, 0.12);
  --btn-text: #f5f5f5;
  --btn-border: rgba(149, 210, 255, 0.4);
  --ok: #b8ffd1;
  --ok-border: rgba(118, 255, 166, 0.4);
  --error: #ffb9b9;
  --error-border: rgba(255, 110, 110, 0.4);
  --warn: #f2d59a;
  --warn-border: rgba(242, 213, 154, 0.45);
  --danger: #ff9b9b;
  --danger-border: rgba(255, 155, 155, 0.52);
  --modal-overlay: rgba(0, 0, 0, 0.58);
  --modal-overlay-l2: rgba(0, 0, 0, 0.7);
  --modal-shadow: 0 1.25rem 2.8rem rgba(0, 0, 0, 0.55);
}

.nexus-root[data-theme="light"] {
  --bg: #f2f6ff;
  --bg-soft: #ffffff;
  --panel: #ffffff;
  --panel-soft: #f7faff;
  --text: #111111;
  --text-muted: rgba(17, 17, 17, 0.58);
  --text-muted-strong: rgba(17, 17, 17, 0.8);
  --border: rgba(17, 17, 17, 0.16);
  --line: rgba(17, 17, 17, 0.1);
  --table-head: rgba(17, 17, 17, 0.66);
  --surface: rgba(36, 89, 199, 0.05);
  --input-bg: #ffffff;
  --input-text: #111111;
  --input-border: rgba(17, 17, 17, 0.2);
  --active-bg: #2459c7;
  --active-text: #ffffff;
  --btn-bg: rgba(36, 89, 199, 0.08);
  --btn-text: #111111;
  --btn-border: rgba(36, 89, 199, 0.34);
  --ok: #1d8a4c;
  --ok-border: rgba(29, 138, 76, 0.34);
  --error: #c93838;
  --error-border: rgba(201, 56, 56, 0.35);
  --warn: #8a5d19;
  --warn-border: rgba(138, 93, 25, 0.42);
  --danger: #b02f2f;
  --danger-border: rgba(176, 47, 47, 0.45);
  --modal-overlay: rgba(16, 16, 16, 0.34);
  --modal-overlay-l2: rgba(16, 16, 16, 0.48);
  --modal-shadow: 0 1.25rem 2.5rem rgba(17, 17, 17, 0.22);
}

.nexus-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 0.0625rem solid var(--border);
  padding: 0.5rem 0.75rem;
  background: linear-gradient(90deg, var(--bg-soft) 0%, color-mix(in srgb, var(--active-bg) 11%, var(--bg-soft)) 100%);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand-block,
.brand-block h1,
.brand-tag {
  margin: 0;
}

.brand-block h1 {
  font-size: 0.9375rem;
  line-height: 1.1;
  font-weight: 600;
}

.brand-meta {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-muted-strong);
}

.brand-tag {
  font-size: 0.625rem;
  letter-spacing: 0.14rem;
  text-transform: uppercase;
  color: var(--active-bg);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.session-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999rem;
  background: var(--text-muted);
}

.session-dot.online {
  background: var(--text);
}

.session-state {
  font-size: 0.6875rem;
  color: var(--text-muted-strong);
}

.theme-toggle {
  min-width: 3.5rem;
}

.nexus-shell {
  width: 100%;
  max-width: 124rem;
  margin: 0 auto;
}

.nexus-layout {
  display: grid;
  grid-template-columns: 14.5rem minmax(0, 1fr);
  gap: 0.625rem;
  padding: 0.75rem;
}

.nexus-sidebar {
  position: sticky;
  top: 3.125rem;
  align-self: start;
  display: grid;
  gap: 0.5rem;
}

.nexus-main {
  min-width: 0;
  display: grid;
  gap: 0.5rem;
}

.sidebar-head {
  border: 0.0625rem solid var(--border);
  border-radius: 0.5rem;
  padding: 0.5rem;
  background: linear-gradient(135deg, color-mix(in srgb, var(--active-bg) 16%, transparent) 0%, var(--surface) 100%);
}

.sidebar-title,
.sidebar-sub {
  margin: 0;
}

.sidebar-title {
  font-size: 0.75rem;
  font-weight: 600;
}

.sidebar-sub {
  margin-top: 0.125rem;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.module-search input {
  width: 100%;
  height: 2rem;
  border: 0.0625rem solid var(--input-border);
  border-radius: 0.375rem;
  background: var(--input-bg);
  color: var(--input-text);
  padding: 0 0.625rem;
  font-size: 0.6875rem;
  outline: none;
}

.module-search input:focus {
  border-color: var(--text-muted-strong);
}

.module-group {
  display: grid;
  gap: 0.25rem;
}

.module-group-title {
  margin: 0;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.08rem;
  color: var(--text-muted);
  padding-left: 0.125rem;
}

.module-nav {
  display: grid;
  gap: 0.25rem;
}

.module-link {
  text-decoration: none;
  border: 0.0625rem solid var(--border);
  background: var(--surface);
  color: var(--text-muted-strong);
  border-radius: 0.5rem;
  padding: 0.375rem 0.5rem 0.4375rem;
  display: grid;
  gap: 0.1875rem;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.module-link:hover {
  border-color: color-mix(in srgb, var(--active-bg) 52%, var(--text-muted-strong));
  transform: translateX(0.0625rem);
}

.module-link-title {
  font-size: 0.75rem;
  line-height: 1.05;
}

.module-link-hint {
  font-size: 0.625rem;
  line-height: 1.1;
  color: var(--text-muted);
}

.module-link.active {
  border-color: var(--active-bg);
  background: var(--active-bg);
  color: var(--active-text);
}

.module-link.active .module-link-hint {
  color: var(--active-text);
  opacity: 0.72;
}

.module-head {
  border-radius: 0.625rem;
}

.module-head-copy {
  display: grid;
  gap: 0.25rem;
}

.module-head-copy p {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.module-meta {
  display: grid;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem 0.625rem;
  border-top: 0.0625rem solid var(--line);
}

.module-meta-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.meta-pill {
  border: 0.0625rem solid var(--line);
  border-radius: 999rem;
  padding: 0.1875rem 0.5rem;
  font-size: 0.625rem;
  color: var(--text-muted-strong);
  background: var(--surface);
}

.meta-pill.data {
  border-color: color-mix(in srgb, var(--active-bg) 45%, var(--line));
  color: color-mix(in srgb, var(--active-bg) 68%, var(--text));
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 0.875rem;
  background: var(--modal-overlay);
  backdrop-filter: blur(0.25rem);
}

.modal-mask-l2 {
  z-index: 50;
  background: var(--modal-overlay-l2);
}

.modal-card {
  width: min(40rem, 100%);
  border: 0.0625rem solid var(--border);
  border-radius: 0.75rem;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--active-bg) 16%, transparent) 0%, transparent 52%),
    linear-gradient(180deg, var(--panel) 0%, var(--panel-soft) 100%);
  box-shadow: var(--modal-shadow);
  overflow: hidden;
  animation: modal-pop 0.2s ease;
}

.modal-card[data-tone="warning"] {
  border-color: var(--warn-border);
}

.modal-card[data-tone="danger"] {
  border-color: var(--danger-border);
}

.modal-card-secondary {
  width: min(56rem, 100%);
}

.modal-card-xl {
  width: min(72rem, 100%);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 0.0625rem solid var(--line);
  padding: 0.625rem 0.75rem;
}

.modal-head-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-head h3 {
  margin: 0;
  font-size: 0.8125rem;
}

.modal-chip {
  border: 0.0625rem solid var(--line);
  border-radius: 999rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  line-height: 1;
  color: var(--text-muted-strong);
  background: var(--surface);
}

.modal-chip[data-tone="warning"] {
  border-color: var(--warn-border);
  color: var(--warn);
}

.modal-chip[data-tone="danger"] {
  border-color: var(--danger-border);
  color: var(--danger);
}

.modal-body {
  padding: 0.75rem;
  font-size: 0.75rem;
  color: var(--text-muted-strong);
  display: grid;
  gap: 0.5rem;
}

.modal-body p {
  margin: 0;
  line-height: 1.45;
}

.modal-note {
  border: 0.0625rem dashed var(--line);
  border-radius: 0.5rem;
  padding: 0.4375rem 0.5rem;
  color: var(--text-muted);
  background: var(--surface);
}

.modal-verify-body {
  gap: 0.625rem;
}

.modal-body-crud {
  gap: 0.625rem;
  max-height: min(80vh, 56rem);
  overflow: auto;
}

.verify-input {
  display: grid;
  gap: 0.25rem;
  font-size: 0.6875rem;
  color: var(--text-muted-strong);
}

.modal-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.375rem;
  margin-top: 0.125rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.375rem;
  border-top: 0.0625rem solid var(--line);
  padding: 0.5rem 0.75rem;
}

.status-box {
  border: 0.0625rem solid var(--border);
  border-radius: 0.375rem;
  padding: 0.5rem 0.625rem;
  font-size: 0.75rem;
}

.status-box.error {
  border-color: var(--error-border);
  color: var(--error);
}

.status-box.success {
  border-color: var(--ok-border);
  color: var(--ok);
}

.panel {
  border: 0.0625rem solid var(--border);
  border-radius: 0.625rem;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--active-bg) 14%, transparent) 0%, transparent 54%),
    linear-gradient(180deg, var(--panel) 0%, var(--panel-soft) 100%);
  box-shadow: 0 0.625rem 1.5rem rgba(0, 0, 0, 0.12);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 0.0625rem solid var(--line);
  padding: 0.625rem;
}

.panel-head h2,
.sub-title {
  margin: 0;
}

.panel-head h2 {
  font-size: 0.8125rem;
}

.panel-tags {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel-tag {
  border: 0.0625rem solid color-mix(in srgb, var(--active-bg) 44%, var(--line));
  border-radius: 999rem;
  padding: 0.125rem 0.4375rem;
  font-size: 0.625rem;
  line-height: 1.1;
  color: color-mix(in srgb, var(--active-bg) 66%, var(--text));
  background: color-mix(in srgb, var(--active-bg) 14%, transparent);
}

.sub-title {
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.3125rem;
}

.sub-title::before {
  content: "";
  width: 0.1875rem;
  height: 0.8125rem;
  border-radius: 999rem;
  background: var(--active-bg);
}

.layout-2col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
  padding: 0.625rem;
}

.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0.625rem;
  border-bottom: 0.0625rem solid var(--line);
}

.table-wrap {
  min-width: 0;
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  padding: 0.5625rem;
  background: var(--surface);
}

.table-wrap > .sub-title {
  margin-bottom: 0.4375rem;
  padding-bottom: 0.375rem;
  border-bottom: 0.0625rem solid var(--line);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.6875rem;
}

.table th,
.table td {
  text-align: left;
  padding: 0.3125rem;
  border-bottom: 0.0625rem solid var(--line);
  vertical-align: top;
}

.table th {
  color: var(--table-head);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
}

.table tr:last-child td {
  border-bottom: 0;
}

.table tr:hover td {
  background: var(--surface);
}

.stats-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.stats-chart-card {
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--panel) 78%, var(--surface));
  padding: 0.5rem;
  display: grid;
  gap: 0.375rem;
}

.chart-title {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-muted-strong);
}

.stats-bar-list {
  display: grid;
  gap: 0.25rem;
}

.stats-bar-row {
  display: grid;
  grid-template-columns: 5.5rem 1fr auto;
  align-items: center;
  gap: 0.3125rem;
}

.stats-bar-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stats-bar-track {
  height: 0.5rem;
  border-radius: 999rem;
  background: color-mix(in srgb, var(--line) 75%, transparent);
  overflow: hidden;
}

.stats-bar-fill {
  height: 100%;
  border-radius: 999rem;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--active-bg) 96%, #ffffff 4%) 0%,
    color-mix(in srgb, var(--active-bg) 74%, var(--surface)) 100%
  );
}

.stats-bar-fill.zero {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--warn) 92%, #ffffff 8%) 0%,
    color-mix(in srgb, var(--warn) 68%, var(--surface)) 100%
  );
}

.stats-bar-value {
  font-size: 0.625rem;
  color: var(--text-muted-strong);
  font-variant-numeric: tabular-nums;
}

.action-col {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.form-grid {
  display: grid;
  gap: 0.3125rem;
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  padding: 0.5625rem;
  background: var(--surface);
}

.form-grid.compact {
  margin: 0.5rem;
}

.form-grid h3 {
  margin: 0;
  font-size: 0.75rem;
}

.form-grid label {
  display: grid;
  gap: 0.125rem;
  font-size: 0.6875rem;
  color: var(--text-muted-strong);
}

input,
select,
textarea {
  width: 100%;
  background: var(--input-bg);
  color: var(--input-text);
  border: 0.0625rem solid var(--input-border);
  border-radius: 0.25rem;
  padding: 0.25rem 0.375rem;
  font-size: 0.6875rem;
  line-height: 1.2;
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--text-muted-strong);
}

textarea {
  resize: vertical;
}

.btn {
  border: 0.0625rem solid var(--btn-border);
  border-radius: 0.4375rem;
  background: var(--btn-bg);
  color: var(--btn-text);
  font-size: 0.6875rem;
  line-height: 1.1;
  padding: 0.3438rem 0.5625rem;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--active-bg) 55%, var(--text-muted-strong));
  transform: translateY(-0.0313rem);
}

.btn.primary {
  background: var(--active-bg);
  border-color: var(--active-bg);
  color: var(--active-text);
  font-weight: 600;
}

.btn.subtle {
  border-color: color-mix(in srgb, var(--active-bg) 50%, var(--line));
  background: color-mix(in srgb, var(--active-bg) 14%, transparent);
  color: color-mix(in srgb, var(--active-bg) 74%, var(--text));
  font-weight: 600;
}

.btn.warn {
  border-color: var(--warn-border);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  color: var(--warn);
  font-weight: 600;
}

.btn.danger {
  border-color: var(--danger-border);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  font-weight: 600;
}

.btn.ghost {
  background: transparent;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.json-box,
.mini-json {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.json-box {
  font-size: 0.6875rem;
}

.mini-json {
  font-size: 0.625rem;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.625rem;
  padding: 0.625rem;
}

.metric-card {
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  padding: 0.5625rem;
  background: linear-gradient(145deg, color-mix(in srgb, var(--active-bg) 10%, transparent) 0%, var(--surface) 100%);
}

.metric-card p,
.metric-card strong {
  margin: 0;
}

.metric-card p {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.metric-card strong {
  font-size: 1.125rem;
  line-height: 1.1;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.625rem;
  padding: 0 0.625rem 0.625rem;
}

.quick-card {
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  background: linear-gradient(140deg, color-mix(in srgb, var(--active-bg) 12%, transparent) 0%, var(--surface) 100%);
  color: var(--text);
  display: grid;
  gap: 0.1875rem;
  text-align: left;
  padding: 0.5rem 0.5625rem;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.quick-card strong,
.quick-card span {
  margin: 0;
}

.quick-card strong {
  font-size: 0.75rem;
}

.quick-card span {
  font-size: 0.625rem;
  color: var(--text-muted);
}

.quick-card:hover {
  border-color: color-mix(in srgb, var(--active-bg) 52%, var(--text-muted-strong));
  transform: translateY(-0.0625rem) scale(1.005);
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: translateY(0.375rem) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (min-width: 100rem) {
  .nexus-layout {
    grid-template-columns: 16rem minmax(0, 1fr);
  }

  .layout-2col {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 76rem) {
  .nexus-layout {
    grid-template-columns: 1fr;
  }

  .nexus-sidebar {
    position: static;
  }

  .layout-2col,
  .metric-grid,
  .quick-grid,
  .stats-chart-grid {
    grid-template-columns: 1fr;
  }

  .panel-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .panel-tags {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nexus-root,
  .module-link,
  .btn,
  .quick-card {
    transition: none;
  }

  .modal-card {
    animation: none;
  }
}
</style>
