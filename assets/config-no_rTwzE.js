import{F as e,G as t,H as n,I as r,M as i,P as a,k as o}from"./vue-libs-C0LO4NBv.js";import"./site-D6igfXIk.js";var s={class:`pagoda-doc-markdown-body`},c={id:`vite-cha-jian-pei-zhi`,tabindex:`-1`,class:`pagoda-doc-md-h1 pagoda-doc-md-title`},l={__name:`config`,setup(l,{expose:u}){return u({frontmatter:{}}),(l,u)=>{let d=t(`pagoda-doc-qrcode`);return n(),i(`div`,s,[o(`h1`,c,[u[0]||=e(`Vite 插件配置`,-1),r(d,{class:`pagoda-doc-md-qrcode`})]),u[1]||=o(`p`,{class:`pagoda-doc-md-p`},`Vite 插件负责启动 OpenCode Web 服务，是浏览器扩展正常工作所必需的。默认配置即可满足大多数场景，以下配置用于高级定制。`,-1),u[2]||=o(`h2`,{id:`an-zhuang`,tabindex:`-1`,class:`pagoda-doc-md-h2 pagoda-doc-md-title`},[o(`a`,{class:`header-anchor pagoda-doc-md-a`,href:`#an-zhuang`},`#`),e(` 安装`)],-1),u[3]||=o(`pre`,{class:`pagoda-doc-markdown-code-block-wrapper`},[o(`code`,{class:`pagoda-doc-markdown-code-block language-bash`,"v-pre":``},`npm install -D vite-plugin-opencode-assistant
`)],-1),u[4]||=o(`h2`,{id:`zui-xiao-pei-zhi`,tabindex:`-1`,class:`pagoda-doc-md-h2 pagoda-doc-md-title`},[o(`a`,{class:`header-anchor pagoda-doc-md-a`,href:`#zui-xiao-pei-zhi`},`#`),e(` 最小配置`)],-1),u[5]||=o(`pre`,{class:`pagoda-doc-markdown-code-block-wrapper`},[o(`code`,{class:`pagoda-doc-markdown-code-block language-ts`,"v-pre":``},[o(`span`,{class:`hljs-keyword`},`import`),e(` { defineConfig } `),o(`span`,{class:`hljs-keyword`},`from`),e(),o(`span`,{class:`hljs-string`},`"vite"`),e(`;
`),o(`span`,{class:`hljs-keyword`},`import`),e(` opencodeAssistant `),o(`span`,{class:`hljs-keyword`},`from`),e(),o(`span`,{class:`hljs-string`},`"vite-plugin-opencode-assistant"`),e(`;

`),o(`span`,{class:`hljs-keyword`},`export`),e(),o(`span`,{class:`hljs-keyword`},`default`),e(),o(`span`,{class:`hljs-title function_`},`defineConfig`),e(`({
  `),o(`span`,{class:`hljs-attr`},`plugins`),e(`: [`),o(`span`,{class:`hljs-title function_`},`opencodeAssistant`),e(`()],
});
`)])],-1),u[6]||=o(`h2`,{id:`wan-zheng-pei-zhi`,tabindex:`-1`,class:`pagoda-doc-md-h2 pagoda-doc-md-title`},[o(`a`,{class:`header-anchor pagoda-doc-md-a`,href:`#wan-zheng-pei-zhi`},`#`),e(` 完整配置`)],-1),u[7]||=o(`pre`,{class:`pagoda-doc-markdown-code-block-wrapper`},[o(`code`,{class:`pagoda-doc-markdown-code-block language-ts`,"v-pre":``},[o(`span`,{class:`hljs-keyword`},`import`),e(` opencodeAssistant `),o(`span`,{class:`hljs-keyword`},`from`),e(),o(`span`,{class:`hljs-string`},`"vite-plugin-opencode-assistant"`),e(`;

`),o(`span`,{class:`hljs-title function_`},`opencodeAssistant`),e(`({
  `),o(`span`,{class:`hljs-comment`},`// === 基础配置 ===`),e(`
  `),o(`span`,{class:`hljs-attr`},`enabled`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`, `),o(`span`,{class:`hljs-comment`},`// 是否启用，默认 true`),e(`
  `),o(`span`,{class:`hljs-attr`},`webPort`),e(`: `),o(`span`,{class:`hljs-number`},`5097`),e(`, `),o(`span`,{class:`hljs-comment`},`// OpenCode Web 端口，默认 5097`),e(`
  `),o(`span`,{class:`hljs-attr`},`proxyPort`),e(`: `),o(`span`,{class:`hljs-number`},`6097`),e(`, `),o(`span`,{class:`hljs-comment`},`// 代理端口，默认 6097`),e(`
  `),o(`span`,{class:`hljs-attr`},`hostname`),e(`: `),o(`span`,{class:`hljs-string`},`"127.0.0.1"`),e(`, `),o(`span`,{class:`hljs-comment`},`// 绑定地址`),e(`
  `),o(`span`,{class:`hljs-attr`},`verbose`),e(`: `),o(`span`,{class:`hljs-literal`},`false`),e(`, `),o(`span`,{class:`hljs-comment`},`// 详细日志`),e(`

  `),o(`span`,{class:`hljs-comment`},`// === 主题与行为 ===`),e(`
  `),o(`span`,{class:`hljs-attr`},`theme`),e(`: `),o(`span`,{class:`hljs-string`},`"auto"`),e(`, `),o(`span`,{class:`hljs-comment`},`// light | dark | auto`),e(`
  `),o(`span`,{class:`hljs-attr`},`hotkey`),e(`: `),o(`span`,{class:`hljs-string`},`"ctrl+k"`),e(`, `),o(`span`,{class:`hljs-comment`},`// 面板快捷键`),e(`
  `),o(`span`,{class:`hljs-attr`},`language`),e(`: `),o(`span`,{class:`hljs-string`},`"zh"`),e(`, `),o(`span`,{class:`hljs-comment`},`// OpenCode 界面语言`),e(`

  `),o(`span`,{class:`hljs-comment`},`// === Chrome DevTools MCP ===`),e(`
  `),o(`span`,{class:`hljs-attr`},`warmupChromeMcp`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`, `),o(`span`,{class:`hljs-comment`},`// 启动时预热 Chrome DevTools`),e(`
  `),o(`span`,{class:`hljs-attr`},`chromeDevtoolsPort`),e(`: `),o(`span`,{class:`hljs-number`},`9222`),e(`, `),o(`span`,{class:`hljs-comment`},`// Chrome 调试端口`),e(`

  `),o(`span`,{class:`hljs-comment`},`// === OpenCode 内部设置 ===`),e(`
  `),o(`span`,{class:`hljs-attr`},`settings`),e(`: {
    `),o(`span`,{class:`hljs-attr`},`general`),e(`: {
      `),o(`span`,{class:`hljs-attr`},`showReasoningSummaries`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`,
      `),o(`span`,{class:`hljs-attr`},`showFileTree`),e(`: `),o(`span`,{class:`hljs-literal`},`false`),e(`,
      `),o(`span`,{class:`hljs-attr`},`followup`),e(`: `),o(`span`,{class:`hljs-string`},`"suggest"`),e(`,
    },
    `),o(`span`,{class:`hljs-attr`},`appearance`),e(`: {
      `),o(`span`,{class:`hljs-attr`},`fontSize`),e(`: `),o(`span`,{class:`hljs-number`},`14`),e(`,
      `),o(`span`,{class:`hljs-attr`},`mono`),e(`: `),o(`span`,{class:`hljs-string`},`"JetBrains Mono"`),e(`,
    },
    `),o(`span`,{class:`hljs-attr`},`permissions`),e(`: {
      `),o(`span`,{class:`hljs-attr`},`autoApprove`),e(`: `),o(`span`,{class:`hljs-literal`},`false`),e(`,
    },
    `),o(`span`,{class:`hljs-attr`},`notifications`),e(`: {
      `),o(`span`,{class:`hljs-attr`},`agent`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`,
      `),o(`span`,{class:`hljs-attr`},`permissions`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`,
      `),o(`span`,{class:`hljs-attr`},`errors`),e(`: `),o(`span`,{class:`hljs-literal`},`true`),e(`,
    },
  },

  `),o(`span`,{class:`hljs-comment`},`// === 自定义日志文件（让 AI 能读取外部服务日志）===`),e(`
  `),o(`span`,{class:`hljs-attr`},`logFiles`),e(`: [
    {
      `),o(`span`,{class:`hljs-attr`},`name`),e(`: `),o(`span`,{class:`hljs-string`},`"backend-logs"`),e(`,
      `),o(`span`,{class:`hljs-attr`},`path`),e(`: `),o(`span`,{class:`hljs-string`},`"/path/to/backend.log"`),e(`,
      `),o(`span`,{class:`hljs-attr`},`description`),e(`: `),o(`span`,{class:`hljs-string`},`"后端服务错误日志"`),e(`,
    },
  ],
});
`)])],-1),u[8]||=a(`<h2 id="pei-zhi-xiang-su-cha-biao" tabindex="-1" class="pagoda-doc-md-h2 pagoda-doc-md-title"><a class="header-anchor pagoda-doc-md-a" href="#pei-zhi-xiang-su-cha-biao">#</a> 配置项速查表</h2><table class="pagoda-doc-md-table"><thead class="pagoda-doc-md-thead"><tr class="pagoda-doc-md-tr"><th class="pagoda-doc-md-th">配置项</th><th class="pagoda-doc-md-th">类型</th><th class="pagoda-doc-md-th">默认值</th><th class="pagoda-doc-md-th">说明</th></tr></thead><tbody class="pagoda-doc-md-tbody"><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">enabled</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">boolean</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">true</code></td><td class="pagoda-doc-md-td">是否启用</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">webPort</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">number</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">5097</code></td><td class="pagoda-doc-md-td">OpenCode Web 端口</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">proxyPort</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">number</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">6097</code></td><td class="pagoda-doc-md-td">代理端口</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">hostname</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">string</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">&quot;127.0.0.1&quot;</code></td><td class="pagoda-doc-md-td">服务地址</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">theme</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">string</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">&quot;auto&quot;</code></td><td class="pagoda-doc-md-td">主题</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">hotkey</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">string</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">&quot;ctrl+k&quot;</code></td><td class="pagoda-doc-md-td">快捷键</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">verbose</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">boolean</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">false</code></td><td class="pagoda-doc-md-td">详细日志</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">warmupChromeMcp</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">boolean</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">true</code></td><td class="pagoda-doc-md-td">预热 Chrome MCP</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">chromeDevtoolsPort</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">number</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">9222</code></td><td class="pagoda-doc-md-td">Chrome 调试端口</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">language</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">string</code></td><td class="pagoda-doc-md-td">-</td><td class="pagoda-doc-md-td">界面语言</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">settings</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">object</code></td><td class="pagoda-doc-md-td">-</td><td class="pagoda-doc-md-td">OpenCode 内部设置</td></tr><tr class="pagoda-doc-md-tr"><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">logFiles</code></td><td class="pagoda-doc-md-td"><code class="pagoda-doc-md-code">array</code></td><td class="pagoda-doc-md-td">-</td><td class="pagoda-doc-md-td">自定义日志文件</td></tr></tbody></table><h3 id="logfiles-shuo-ming" tabindex="-1" class="pagoda-doc-md-h3 pagoda-doc-md-title"><a class="header-anchor pagoda-doc-md-a" href="#logfiles-shuo-ming">#</a> logFiles 说明</h3><p class="pagoda-doc-md-p">配置后 AI 可获得 <code class="pagoda-doc-md-code">get_{name}_logs</code> 工具，查看指定日志文件的最近 200 行：</p>`,4),u[9]||=o(`pre`,{class:`pagoda-doc-markdown-code-block-wrapper`},[o(`code`,{class:`pagoda-doc-markdown-code-block language-ts`,"v-pre":``},[o(`span`,{class:`hljs-attr`},`logFiles`),e(`: [
  {
    `),o(`span`,{class:`hljs-attr`},`name`),e(`: `),o(`span`,{class:`hljs-string`},`"backend-logs"`),e(`, `),o(`span`,{class:`hljs-comment`},`// 生成工具名 get_backend-logs_logs`),e(`
    `),o(`span`,{class:`hljs-attr`},`path`),e(`: `),o(`span`,{class:`hljs-string`},`"/path/to/error.log"`),e(`, `),o(`span`,{class:`hljs-comment`},`// 日志文件绝对路径`),e(`
    `),o(`span`,{class:`hljs-attr`},`description`),e(`: `),o(`span`,{class:`hljs-string`},`"后端错误日志"`),e(`, `),o(`span`,{class:`hljs-comment`},`// 告诉 AI 何时使用`),e(`
  },
];
`)])],-1),u[10]||=o(`blockquote`,{class:`pagoda-doc-md-blockquote`},[o(`p`,{class:`pagoda-doc-md-p`},[e(`详见 `),o(`a`,{href:`https://github.com/opencode-ai/vite-plugin-opencode-assistant`,class:`pagoda-doc-md-a`,target:`_blank`},[e(`Vite 插件配置完整参考`),o(`svg`,{xmlns:`http://www.w3.org/2000/svg`,"aria-hidden":`true`,focusable:`false`,x:`0px`,y:`0px`,viewBox:`0 0 100 100`,width:`15`,height:`15`,class:`v-md-svg-outbound`},[o(`path`,{fill:`currentColor`,d:`M18.8,85.1h56l0,0c2.2,0,4-1.8,4-4v-32h-8v28h-48v-48h28v-8h-32l0,0c-2.2,0-4,1.8-4,4v56C14.8,83.3,16.6,85.1,18.8,85.1z`}),e(),o(`polygon`,{fill:`currentColor`,points:`45.7,48.7 51.3,54.3 77.2,28.5 77.2,37.2 85.2,37.2 85.2,14.9 62.8,14.9 62.8,22.9 71.5,22.9`})])]),e(` 获取 `),o(`code`,{class:`pagoda-doc-md-code`},`settings`),e(` 全部子配置项。`)])],-1)])}}};export{l as default};