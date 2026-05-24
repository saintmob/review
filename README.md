# 回响

课程总结播放与上传页面。`/` 是播放界面，`/upload` 是学生上传界面。学生填写姓名，选择视频或音频文件后，浏览器会通过 Vercel Blob client upload 直接上传到部署环境绑定的 Blob；上传成功返回的公开 URL 会自动写入表单状态；提交表单后，姓名、说明文字、`audioUrl` 和媒体类型会写入 Firebase Firestore。

## 本地运行

1. 安装依赖：
   ```bash
   npm install
   ```
2. 复制环境变量模板：
   ```bash
   cp .env.example .env.local
   ```
3. 配置服务端环境变量：
   ```bash
   BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxx"
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   FIREBASE_REFLECTIONS_COLLECTION="courseReflections"
   ```
4. 启动：
   ```bash
   npm run dev
   ```

播放界面：http://localhost:3000/

上传界面：http://localhost:3000/upload

## 部署说明

在 Vercel 项目里添加 `BLOB_READ_WRITE_TOKEN`。上传使用 client upload，视频不会先经过 serverless 函数请求体，因此不会被 Vercel 4.5 MB 请求体限制拦住。如果希望每个学生上传到自己的 Vercel Blob，需要让每个学生使用自己 Vercel 项目的 Blob token 部署同一套页面。

Firestore 写入使用 Firebase Admin SDK，因此还需要在部署环境中配置 `FIREBASE_SERVICE_ACCOUNT_JSON`。默认集合名是 `courseReflections`，可通过 `FIREBASE_REFLECTIONS_COLLECTION` 修改。
