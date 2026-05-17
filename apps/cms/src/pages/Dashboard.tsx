export function Dashboard() {
  return (
    <>
      <section className="grid">
        <article className="card"><span className="pill">CMS</span><h2>React</h2><p>全新后台尽量使用 React 重构。</p></article>
        <article className="card"><span className="pill">Style</span><h2>shadcn/ui</h2><p>黑白双色、简约高级、token 化。</p></article>
        <article className="card"><span className="pill">iOS</span><h2>Liquid Glass</h2><p>移动端预留 iOS 玻璃质感 token。</p></article>
        <article className="card"><span className="pill">Android</span><h2>Native</h2><p>Android 先走 RN 原生组件。</p></article>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>迁移原则</h2><p>旧 Nuxt CMS 保留可用，新模块逐步迁移到独立 React CMS。</p></div></div>
        <div className="table-wrap">
          <table><tbody>
            <tr><td>业务核心</td><td>packages/shared + calendar-core + api-client</td></tr>
            <tr><td>小程序</td><td>Taro React PoC：apps/miniapp</td></tr>
            <tr><td>App</td><td>React Native CLI 骨架：apps/mobile</td></tr>
            <tr><td>CMS</td><td>React Vite 骨架：apps/cms</td></tr>
          </tbody></table>
        </div>
      </section>
    </>
  );
}
