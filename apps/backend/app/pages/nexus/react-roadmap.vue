<template>
  <NexusAdminShell title="Admin Roadmap" @refresh="noop">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>全新项目 Roadmap</h2>
          <p>后台 UI 统一为 shadcn 简约风格，小程序 Taro React、移动端 React Native CLI 作为后续路线。</p>
        </div>
        <span class="rx-pill">2026</span>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr>
              <th>阶段</th>
              <th>目标</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Phase 1</td>
              <td>共享模型、calendar-core、api-client、ui-tokens</td>
              <td><span class="rx-pill">进行中</span></td>
            </tr>
            <tr>
              <td>Phase 2</td>
              <td>后端 Calendar API 兼容层</td>
              <td><span class="rx-pill">已起步</span></td>
            </tr>
            <tr>
              <td>Phase 3</td>
              <td>后台新模块拆分，不再堆 NexusConsole</td>
              <td><span class="rx-pill">已起步</span></td>
            </tr>
            <tr>
              <td>Phase 7</td>
              <td>React Native App，iOS Liquid Glass 优先，Android 原生组件</td>
              <td><span class="rx-pill">待创建</span></td>
            </tr>
            <tr>
              <td>Phase 8</td>
              <td>Taro React 小程序替代 uni-app</td>
              <td><span class="rx-pill">待创建</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
const noop = () => {};
</script>
