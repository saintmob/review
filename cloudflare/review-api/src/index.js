import { badRequest, json, methodNotAllowed, noContent, notFound, text } from './http.js';
import { createStudent, createUploadRecord, getBootstrapData, getProgram, listStudents, listSummaries, listWorks } from './db.js';
import { buildMediaUrl, getMediaObject, isRenderableMedia, makeMediaKey, parseRangeHeader, putMedia } from './r2.js';

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function getMaxUploadBytes(env) {
  const parsed = Number(env.MAX_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonBody(request) {
  return request.json().catch(() => null);
}

function parseFormObject(formData) {
  const metadata = normalizeString(formData.get('metadata'));
  let metadataJson = {};

  if (metadata) {
    try {
      metadataJson = JSON.parse(metadata);
    } catch {
      metadataJson = {};
    }
  }

  return {
    assetKind: normalizeString(formData.get('assetKind')) || 'submission',
    fileName: normalizeString(formData.get('fileName')),
    contentType: normalizeString(formData.get('contentType')),
    fullName: normalizeString(formData.get('fullName')),
    workIndex: normalizeString(formData.get('workIndex')),
    durationMs: normalizeString(formData.get('durationMs')),
    width: normalizeString(formData.get('width')),
    height: normalizeString(formData.get('height')),
    metadata: metadataJson,
  };
}

function getUploadFile(formData) {
  const file = formData.get('file');
  return file instanceof File ? file : null;
}

function cacheJson(request, data, cacheControl, init = {}) {
  return json(request, data, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Cache-Control': cacheControl,
    },
  });
}

function normalizeWorkForCreate(work, index) {
  return {
    workIndex: Number(work?.workIndex || index + 1),
    workUrl: normalizeString(work?.workUrl),
    coverUrl: normalizeString(work?.coverUrl),
    coverUploadId: normalizeString(work?.coverUploadId),
    coverObjectKey: normalizeString(work?.coverObjectKey),
    coverFileName: normalizeString(work?.coverFileName),
  };
}

function normalizeStudentPayload(body) {
  const works = Array.isArray(body?.works) ? body.works : [];
  return {
    fullName: normalizeString(body?.fullName),
    roles: Array.isArray(body?.roles) ? body.roles.map((item) => normalizeString(item)).filter(Boolean) : [],
    textSummary: normalizeString(body?.textSummary),
    videoSummaryUrl: normalizeString(body?.videoSummaryUrl),
    videoUploadId: normalizeString(body?.videoUploadId),
    videoObjectKey: normalizeString(body?.videoObjectKey),
    videoFileName: normalizeString(body?.videoFileName),
    videoContentType: normalizeString(body?.videoContentType),
    videoSizeBytes: Number(body?.videoSizeBytes || 0),
    videoDurationMs: Number(body?.videoDurationMs || 0),
    videoWidth: Number(body?.videoWidth || 0),
    videoHeight: Number(body?.videoHeight || 0),
    works: works.map((work, index) => normalizeWorkForCreate(work, index)),
  };
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const file = getUploadFile(formData);
  if (!file) {
    return badRequest(request, '请上传文件');
  }

  const form = parseFormObject(formData);
  const contentType = normalizeString(file.type || form.contentType) || 'application/octet-stream';
  if (!isRenderableMedia(contentType)) {
    return badRequest(request, '只支持图片、视频或音频文件');
  }

  const maxBytes = getMaxUploadBytes(env);
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return badRequest(request, '文件不能为空');
  }
  if (file.size > maxBytes) {
    return json(request, { error: `文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` }, { status: 413 });
  }

  const fileName = form.fileName || normalizeString(file.name) || 'submission';
  const assetKind = form.assetKind || 'submission';
  if (!['video-summary', 'work-cover'].includes(assetKind)) {
    return badRequest(request, '不支持的上传类型');
  }
  const objectKey = makeMediaKey({
    prefix: env.MEDIA_PREFIX || 'submissions',
    assetKind,
    fileName,
    contentType,
  });

  await putMedia(env, objectKey, file, { contentType, fileName });

  const publicUrl = buildMediaUrl(request, objectKey);
  const uploadRecord = await createUploadRecord(env.DB, {
    assetKind,
    fileName,
    contentType,
    sizeBytes: file.size,
    objectKey,
    publicUrl,
    metadata: {
      ...form.metadata,
      fullName: form.fullName,
      workIndex: form.workIndex ? Number(form.workIndex) : undefined,
      durationMs: form.durationMs ? Number(form.durationMs) : undefined,
      width: form.width ? Number(form.width) : undefined,
      height: form.height ? Number(form.height) : undefined,
      originalFileName: file.name || '',
    },
  });

  return json(request, {
    ok: true,
    uploadId: uploadRecord.id,
    objectKey,
    publicUrl,
    fileName,
    contentType,
    sizeBytes: file.size,
    assetKind,
    createdAt: uploadRecord.createdAt,
  }, {
    status: 201,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

async function handleMedia(request, env, key) {
  if (!key) {
    return notFound(request);
  }

  const object = await getMediaObject(env, key, request.headers.get('Range') || '');
  if (!object) {
    return notFound(request);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');

  const hasRange = request.headers.has('Range');
  const status = hasRange ? 206 : 200;

  if (request.method === 'HEAD') {
    return new Response(null, { status, headers });
  }

  return new Response(object.body, { status, headers });
}

async function handleProgram(request, env) {
  const program = await getProgram(env.DB);
  return cacheJson(request, { program }, 'public, max-age=30, stale-while-revalidate=120');
}

async function handleWorks(request, env) {
  const works = await listWorks(env.DB);
  return cacheJson(request, { works }, 'public, max-age=30, stale-while-revalidate=120');
}

async function handleSummaries(request, env) {
  const summaries = await listSummaries(env.DB);
  return cacheJson(request, { summaries }, 'public, max-age=30, stale-while-revalidate=120');
}

async function handleStudents(request, env) {
  const students = await listStudents(env.DB);
  return cacheJson(request, { students }, 'public, max-age=15, stale-while-revalidate=60');
}

async function handleBootstrap(request, env) {
  const bootstrap = await getBootstrapData(env.DB);
  return cacheJson(request, bootstrap, 'public, max-age=15, stale-while-revalidate=60');
}

async function handleCreateStudent(request, env) {
  const body = await parseJsonBody(request);
  if (!body) {
    return badRequest(request, '请求体必须是 JSON');
  }

  const payload = normalizeStudentPayload(body);
  if (!payload.fullName) {
    return badRequest(request, '请输入学生姓名');
  }
  if (!payload.roles.length) {
    return badRequest(request, '请至少选择一个工作人员职能');
  }
  if (!payload.textSummary) {
    return badRequest(request, '请填写职位感悟');
  }
  if (!payload.videoSummaryUrl || !/^https?:\/\//i.test(payload.videoSummaryUrl)) {
    return badRequest(request, '请先上传视频总结');
  }
  if (!Array.isArray(body.works) || !body.works.length) {
    return badRequest(request, '请至少填写一组作品网页链接');
  }
  if (payload.works.length > 2) {
    return badRequest(request, '最多只能提交两组作品');
  }
  for (const [index, work] of payload.works.entries()) {
    if (!work.workUrl || !/^https?:\/\//i.test(work.workUrl)) {
      return badRequest(request, `作品 ${index + 1} 的网页链接必须是有效的 https URL`);
    }
    if (!work.coverUrl || !/^https?:\/\//i.test(work.coverUrl)) {
      return badRequest(request, `作品 ${index + 1} 的封面链接必须是有效的 https URL`);
    }
  }

  const student = await createStudent(env.DB, payload);
  return json(request, { ok: true, student }, { status: 201 });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return noContent(request);
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json(request, {
          status: 'ok',
          service: 'review-api',
        });
      }

      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        return handleBootstrap(request, env);
      }

      if (url.pathname === '/api/program' && request.method === 'GET') {
        return handleProgram(request, env);
      }

      if (url.pathname === '/api/works' && request.method === 'GET') {
        return handleWorks(request, env);
      }

      if (url.pathname === '/api/summaries' && request.method === 'GET') {
        return handleSummaries(request, env);
      }

      if (url.pathname === '/api/students' && request.method === 'GET') {
        return handleStudents(request, env);
      }

      if (url.pathname === '/api/students' && request.method === 'POST') {
        return handleCreateStudent(request, env);
      }

      if (url.pathname === '/api/uploads' && request.method === 'POST') {
        return handleUpload(request, env);
      }

      if (url.pathname.startsWith('/api/media/') && (request.method === 'GET' || request.method === 'HEAD')) {
        const key = decodeURIComponent(url.pathname.slice('/api/media/'.length));
        if (request.headers.has('Range')) {
          const probe = await env.MEDIA.get(key);
          const range = probe ? parseRangeHeader(request.headers.get('Range') || '', probe.size) : null;
          if (!range && request.headers.get('Range')) {
            return text(request, 'Range not satisfiable', {
              status: 416,
              headers: {
                'Content-Range': probe ? `bytes */${probe.size}` : 'bytes */0',
              },
            });
          }
        }
        return handleMedia(request, env, key);
      }

      return methodNotAllowed(request, ['GET', 'POST', 'HEAD', 'OPTIONS']);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('Worker error:', message, error);
      return json(request, { error: message }, { status: 500 });
    }
  },
};
