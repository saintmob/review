# 回响

`/` 现在是活动公开页，直接读取已部署活动后端的 `/api/program`、`/api/works`、`/api/summaries`。`/upload` 是学生端最小可用上传页：提交 `fullName`、多选 `roles`、`textSummary`、`videoSummaryUrl`、1-2 张本地作品图片，并保留现有前置摄像头 WebM 录制流程。

默认活动后端：

```text
https://show-plan-event-backend.liucheng-show-plan.workers.dev
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
   VITE_EVENT_API_BASE="https://show-plan-event-backend.liucheng-show-plan.workers.dev"
   ```
4. 启动开发环境：
   ```bash
   npm run dev
   ```

公开页：http://localhost:3000/

学生上传页：http://localhost:3000/upload

## 学生端行为

- 公开页直接跨域访问活动后端，不再依赖旧 Firestore reflection 模型。
- 上传页提交时调用 `POST /api/students`。
- 作品封面改为本地文件选择，提交时先上传到 Firebase Storage，再把公开图片链接写入 `works.coverUrl`，不再要求填写图片链接。
- 录制视频仍使用：
  1. `POST /api/uploads/init`
  2. 浏览器 `PUT uploadUrl`
  3. `POST /api/uploads/complete`
- 上传完成后的 `publicUrl` 会自动写入 `videoSummaryUrl`。
- 本地封面上传需要配置 `FIREBASE_SERVICE_ACCOUNT_JSON` 和 `FIREBASE_STORAGE_BUCKET`。

## 备注

仓库里原有 `server.ts` 和 `api/*` 仍保留，便于不打断现有本地/部署方式；本次学生端已经改成前端直接访问活动后端，避免继续维护 reflection 的双套业务逻辑。
