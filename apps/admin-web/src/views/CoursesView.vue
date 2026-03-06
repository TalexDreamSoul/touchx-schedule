<template>
  <el-card>
    <template #header>
      <div class="title">课表管理</div>
    </template>
    <el-alert type="info" :closable="false" show-icon title="保持 CSV 格式兼容，支持用户与课程导入导出。" />
    <p class="desc">请使用原有用户/课程 CSV 编辑流程，Vue 后台将逐步替代 legacy 页面。</p>
  </el-card>
</template>

<style scoped>
.title {
  font-weight: 700;
}

.desc {
  color: #606266;
}
</style>
