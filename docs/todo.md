已按你的方案完成了第一版端到端实现（含 Frontend Design 风格 UI）：

新增桌面应用骨架与实现（Tauri 2 + React + TS + Vite）
/Users/oolong/workspace/nanoclaw/apps/desktop
完成三栏向导 UI（步骤导航/当前配置/实时日志）、12 步配置输入与交互
App.tsx
styles.css
完成前端 setup API 包装（setup.startStep / retryStep / skipManualCheck / getState / cancel）
setupApi.ts
完成 Tauri 后端状态机与执行引擎（步骤执行、manual-block、事件流、状态/报告落盘、Keychain 存储、launchd 写入）
setup.rs
main.rs
新增共享 setup schema/steps/reducer（纯 TS，可复用）
schema.ts
steps.ts
reducer.ts
完成核心运行时改造：container-runner 环境注入优先 process.env，再回退 .env
container-runner.ts
/setup 技能改为桌面向导重定向
SKILL.md
文档与入口更新（desktop-first）
README.md
REQUIREMENTS.md
desktop-setup-wizard.md
增加根脚本与忽略规则
package.json
/Users/oolong/workspace/nanoclaw/.gitignore
验证情况：

rustfmt 已通过（Rust 代码可解析并格式化）。
cargo check 未完成：当前环境无法访问 crates registry 镜像（DNS/网络受限）。
npm --prefix apps/desktop install 未完成：当前环境无法访问 npm registry 镜像（网络受限）。
根项目 npm run typecheck 也有现存依赖/类型问题（与本次改动无直接关系）。
建议下一步（网络可用后）：

运行 npm run desktop:install
运行 npm run desktop:dev
在桌面向导里完整走一遍 12 步，并用 report.json 做验收。