<template>
  <el-card>
    <template #header>
      <div class="title">系统设置</div>
    </template>
    <el-alert type="info" :closable="false" show-icon title="本页用于企业微信、小程序、模板等系统配置。" />
    <p class="desc">首版可继续使用 legacy 页面中的完整配置项，后续逐步迁移到 Vue 管理端。</p>
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
