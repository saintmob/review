# 回响

`/` 是活动公开页，统一读取 Cloudflare Worker 的 `GET /api/bootstrap`。`/upload` 是学生端提交页，支持：

- 学生姓名
- 多选工作人员职能
- 文本感悟
- 摄像头录制或本地上传的视频总结
- 两组作品网页链接
- 两张本地作品封面

浏览器上传时不再直连 Firebase 或 Vercel Blob，所有文件都先发到 Worker，再由 Worker 写入 R2。

`/admin` 是管理员内容页，登录后可编辑或删除学生提交内容。管理员密码不写入源码，由 Cloudflare D1 保存哈希。

默认活动后端：

```text
https://review-api.saintmob.workers.dev
```

## 本地运行

1. 安装依赖：
   ```bash
   npm install
   ```
2. 复制环境变量模板：
   ```bash
   cp .env.example .env.local
   ```
3. 如需切换后端，设置：
   ```bash
   VITE_REVIEW_API_BASE="https://review-api.saintmob.workers.dev"
   ```
4. 启动开发环境：
   ```bash
   npm run dev
   ```

公开页：http://localhost:3000/

学生上传页：http://localhost:3000/upload

管理员内容页：http://localhost:3000/admin

## 前端行为

- 公开页一次性读取 `GET /api/bootstrap`，手动刷新时才重新拉取。
- 上传页提交时调用 `POST /api/students`。
- 作品封面是本地文件，提交前会压缩后上传到 Worker，返回公开图片链接后写入 `works.coverUrl`。
- 视频总结可由摄像头录制或选择本地视频文件，均通过 `POST /api/uploads` 上传到 Worker，再把返回的公开链接写入 `videoSummaryUrl`。
- 后端当前以 Cloudflare D1 + R2 为唯一运行时数据层，不再依赖 Firestore。

## 备注

仓库里原有 `server.ts` 和 `api/*` 仍保留作历史参考，但新的学生提交流程已经切到 Worker + D1 + R2。
