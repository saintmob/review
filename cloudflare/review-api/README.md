# Cloudflare Review API

这个目录是学生作品提交与展示的 Cloudflare 后端，使用：

- Workers 处理 HTTP 接口
- D1 保存节目、学生、作品和上传记录
- R2 保存图片、视频、音频文件

## 接口

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/program`
- `GET /api/works`
- `GET /api/summaries`
- `GET /api/students`
- `POST /api/students`
- `POST /api/uploads`
- `GET /api/media/:key`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/session`
- `GET /api/admin/students`
- `PUT /api/admin/students/:id`
- `DELETE /api/admin/students/:id`

## 本地开发

1. 创建本地运行变量：
   ```bash
   cp cloudflare/review-api/.dev.vars.example cloudflare/review-api/.dev.vars
   ```
2. 在 Cloudflare 创建 D1 数据库和 R2 bucket，并把对应 ID / 名称填回 `wrangler.jsonc`
3. 启动 Worker：
   ```bash
   cd cloudflare/review-api
   wrangler dev
   ```

## 部署

1. 先创建 D1 数据库和 R2 bucket
2. 把 `cloudflare/review-api/wrangler.jsonc` 里的 `database_id` 替换成真实值
3. 用 `wrangler deploy` 发布 Worker
4. 在前端设置 `VITE_REVIEW_API_BASE` 为你的 Worker 公开地址

## 说明

- 上传接口是单次直传到 Worker，不再拆 `init / PUT / complete` 三步。
- `GET /api/bootstrap` 已经把节目单、作品、总结、学生列表聚合成一次请求。
- 前端提交时会继续使用 `videoSummaryUrl` 和每组 `workUrl + coverUrl` 的结构，不需要再引入 Firebase 或 Vercel Blob。
- 管理员密码保存在 D1 的哈希表中，源码不保存明文密码；管理接口使用 Bearer token 会话，并记录失败登录次数。
