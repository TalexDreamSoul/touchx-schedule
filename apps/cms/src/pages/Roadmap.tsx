export function Roadmap() {
  const rows = [
    ["CMS", "独立 React + Vite，逐步替换 Nuxt NexusConsole", "已起步"],
    ["Shared", "calendar / notification / import 类型拆分", "已完成首批"],
    ["Core", "calendar-core 合成、覆盖、冲突、提醒候选", "已完成首批"],
    ["Miniapp", "Taro React 小程序", "已起步"],
    ["Mobile", "React Native CLI，iOS Liquid Glass / Android native", "已起步"],
  ];
  return (
    <section className="card">
      <div className="card-head"><div><h2>全新项目 Roadmap</h2><p>全量尽量 React，UI 走 shadcn/ui 风格黑白双色。</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>方向</th><th>目标</th><th>状态</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row[0]}><td>{row[0]}</td><td>{row[1]}</td><td><span className="pill">{row[2]}</span></td></tr>)}
      </tbody></table></div>
    </section>
  );
}
