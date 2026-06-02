const DEFAULT_PROGRAM_ID = 1;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeJsonParse(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIsoTimestamp(value) {
  const text = toText(value, new Date(0).toISOString());
  return text || new Date(0).toISOString();
}

function normalizeRoles(value) {
  const parsed = Array.isArray(value) ? value : safeJsonParse(value, []);
  return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function normalizeWorkRows(rows) {
  return rows.map((row) => ({
    id: String(row.id || ''),
    studentId: String(row.student_id || row.studentId || ''),
    studentName: String(row.student_name || row.studentName || ''),
    workIndex: toNumber(row.work_index || row.workIndex || 0, 0),
    workUrl: String(row.work_url || row.workUrl || ''),
    coverUrl: String(row.cover_url || row.coverUrl || ''),
    createdAt: toIsoTimestamp(row.created_at || row.createdAt),
  }));
}

function normalizeStudentRow(row, workRows = []) {
  return {
    id: String(row.id || ''),
    fullName: String(row.full_name || row.fullName || ''),
    roles: normalizeRoles(row.roles_json || row.roles),
    textSummary: String(row.text_summary || row.textSummary || ''),
    videoSummaryUrl: String(row.video_summary_url || row.videoSummaryUrl || ''),
    works: workRows,
    createdAt: toIsoTimestamp(row.created_at || row.createdAt),
    updatedAt: toIsoTimestamp(row.updated_at || row.updatedAt),
  };
}

function normalizeProgramRow(row) {
  return {
    text: String(row?.text || ''),
    updatedAt: toIsoTimestamp(row?.updated_at || row?.updatedAt),
  };
}

function getProgramQuery(db) {
  return db.prepare('SELECT id, text, updated_at FROM program WHERE id = ? LIMIT 1').bind(DEFAULT_PROGRAM_ID);
}

export async function getProgram(db) {
  const row = await getProgramQuery(db).first();
  return row ? normalizeProgramRow(row) : { text: '', updatedAt: new Date(0).toISOString() };
}

export async function listWorks(db, limit = 120) {
  const { results } = await db
    .prepare(
      `SELECT id, student_id, student_name, work_index, work_url, cover_url, created_at
       FROM works
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(toNumber(limit, 120), 500)))
    .all();

  return normalizeWorkRows(results);
}

export async function listSummaries(db, limit = 120) {
  const { results } = await db
    .prepare(
      `SELECT id, full_name, text_summary, video_summary_url, created_at
       FROM students
       WHERE TRIM(video_summary_url) != '' AND TRIM(text_summary) != ''
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(toNumber(limit, 120), 500)))
    .all();

  return results.map((row) => ({
    id: String(row.id || ''),
    fullName: String(row.full_name || row.fullName || ''),
    textSummary: String(row.text_summary || row.textSummary || ''),
    videoSummaryUrl: String(row.video_summary_url || row.videoSummaryUrl || ''),
    createdAt: toIsoTimestamp(row.created_at || row.createdAt),
  }));
}

export async function listStudents(db, limit = 120) {
  const { results } = await db
    .prepare(
      `SELECT id, full_name, roles_json, text_summary, video_summary_url, created_at, updated_at
       FROM students
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(toNumber(limit, 120), 500)))
    .all();

  if (!results.length) {
    return [];
  }

  const studentIds = results.map((row) => String(row.id || ''));
  const placeholders = studentIds.map(() => '?').join(', ');
  const { results: workRows } = await db
    .prepare(
      `SELECT id, student_id, student_name, work_index, work_url, cover_url, created_at
       FROM works
       WHERE student_id IN (${placeholders})
       ORDER BY student_id ASC, work_index ASC, created_at DESC, id DESC`,
    )
    .bind(...studentIds)
    .all();

  const workMap = new Map();
  for (const work of normalizeWorkRows(workRows)) {
    const works = workMap.get(work.studentId) || [];
    works.push(work);
    workMap.set(work.studentId, works);
  }

  return results.map((row) => normalizeStudentRow(row, workMap.get(String(row.id || '')) || []));
}

export async function createStudent(db, input) {
  const studentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;
  const roles = normalizeRoles(input.roles);
  const works = Array.isArray(input.works) ? input.works : [];
  const workRecords = works.map((work, index) => ({
    id: crypto.randomUUID(),
    studentId,
    studentName: String(input.fullName || '').trim(),
    workIndex: toNumber(work.workIndex, index + 1),
    workUrl: String(work.workUrl || '').trim(),
    coverUrl: String(work.coverUrl || '').trim(),
    coverUploadId: String(work.coverUploadId || '').trim(),
    coverObjectKey: String(work.coverObjectKey || '').trim(),
    coverFileName: String(work.coverFileName || '').trim(),
  }));
  const metadata = {
    source: String(input.source || 'student-client'),
    uploadId: String(input.videoUploadId || ''),
    objectKey: String(input.videoObjectKey || ''),
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO students
          (id, full_name, roles_json, text_summary, video_summary_url, video_upload_id, video_object_key, video_file_name, video_content_type, video_size_bytes, video_duration_ms, video_width, video_height, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        studentId,
        String(input.fullName || '').trim(),
        JSON.stringify(roles),
        String(input.textSummary || '').trim(),
        String(input.videoSummaryUrl || '').trim(),
        String(input.videoUploadId || '').trim(),
        String(input.videoObjectKey || '').trim(),
        String(input.videoFileName || '').trim(),
        String(input.videoContentType || '').trim(),
        toNumber(input.videoSizeBytes, 0),
        toNumber(input.videoDurationMs, 0),
        toNumber(input.videoWidth, 0),
        toNumber(input.videoHeight, 0),
        JSON.stringify(metadata),
        createdAt,
        updatedAt,
      ),
    ...workRecords.map((work) =>
      db
        .prepare(
          `INSERT INTO works
            (id, student_id, student_name, work_index, work_url, cover_url, cover_upload_id, cover_object_key, cover_file_name, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          work.id,
          work.studentId,
          work.studentName,
          work.workIndex,
          work.workUrl,
          work.coverUrl,
          work.coverUploadId,
          work.coverObjectKey,
          work.coverFileName,
          JSON.stringify({
            source: String(input.source || 'student-client'),
            studentId,
          }),
          createdAt,
          updatedAt,
        ),
    ),
  ]);

  return {
    id: studentId,
    fullName: String(input.fullName || '').trim(),
    roles,
    textSummary: String(input.textSummary || '').trim(),
    videoSummaryUrl: String(input.videoSummaryUrl || '').trim(),
    works: workRecords.map((work) => ({
      id: work.id,
      studentId: work.studentId,
      studentName: work.studentName,
      workIndex: work.workIndex,
      workUrl: work.workUrl,
      coverUrl: work.coverUrl,
      createdAt,
    })),
    createdAt,
    updatedAt,
  };
}

export async function updateStudent(db, studentId, input) {
  const id = String(studentId || '').trim();
  const updatedAt = new Date().toISOString();
  const roles = normalizeRoles(input.roles);
  const works = Array.isArray(input.works) ? input.works : [];
  const workRecords = works.map((work, index) => ({
    id: String(work.id || '').trim() || crypto.randomUUID(),
    studentId: id,
    studentName: String(input.fullName || '').trim(),
    workIndex: toNumber(work.workIndex, index + 1),
    workUrl: String(work.workUrl || '').trim(),
    coverUrl: String(work.coverUrl || '').trim(),
    coverUploadId: String(work.coverUploadId || '').trim(),
    coverObjectKey: String(work.coverObjectKey || '').trim(),
    coverFileName: String(work.coverFileName || '').trim(),
  }));

  await db.batch([
    db
      .prepare(
        `UPDATE students
         SET full_name = ?,
             roles_json = ?,
             text_summary = ?,
             video_summary_url = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        String(input.fullName || '').trim(),
        JSON.stringify(roles),
        String(input.textSummary || '').trim(),
        String(input.videoSummaryUrl || '').trim(),
        updatedAt,
        id,
      ),
    db.prepare('DELETE FROM works WHERE student_id = ?').bind(id),
    ...workRecords.map((work) =>
      db
        .prepare(
          `INSERT INTO works
            (id, student_id, student_name, work_index, work_url, cover_url, cover_upload_id, cover_object_key, cover_file_name, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          work.id,
          work.studentId,
          work.studentName,
          work.workIndex,
          work.workUrl,
          work.coverUrl,
          work.coverUploadId,
          work.coverObjectKey,
          work.coverFileName,
          JSON.stringify({
            source: 'admin-editor',
            studentId: id,
          }),
          updatedAt,
          updatedAt,
        ),
    ),
  ]);

  return normalizeStudentRow(
    {
      id,
      full_name: String(input.fullName || '').trim(),
      roles_json: JSON.stringify(roles),
      text_summary: String(input.textSummary || '').trim(),
      video_summary_url: String(input.videoSummaryUrl || '').trim(),
      created_at: input.createdAt || updatedAt,
      updated_at: updatedAt,
    },
    normalizeWorkRows(
      workRecords.map((work) => ({
        id: work.id,
        student_id: work.studentId,
        student_name: work.studentName,
        work_index: work.workIndex,
        work_url: work.workUrl,
        cover_url: work.coverUrl,
        created_at: updatedAt,
      })),
    ),
  );
}

export async function deleteStudent(db, studentId) {
  const id = String(studentId || '').trim();
  await db.batch([
    db.prepare('DELETE FROM works WHERE student_id = ?').bind(id),
    db.prepare('DELETE FROM students WHERE id = ?').bind(id),
  ]);
}

export async function createUploadRecord(db, input) {
  const createdAt = new Date().toISOString();
  const upload = {
    id: crypto.randomUUID(),
    assetKind: String(input.assetKind || 'submission').trim() || 'submission',
    fileName: String(input.fileName || '').trim(),
    contentType: String(input.contentType || '').trim(),
    sizeBytes: toNumber(input.sizeBytes, 0),
    objectKey: String(input.objectKey || '').trim(),
    publicUrl: String(input.publicUrl || '').trim(),
    metadataJson: JSON.stringify(input.metadata || {}),
    createdAt,
  };

  await db
    .prepare(
      `INSERT INTO uploads
        (id, asset_kind, file_name, content_type, size_bytes, object_key, public_url, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      upload.id,
      upload.assetKind,
      upload.fileName,
      upload.contentType,
      upload.sizeBytes,
      upload.objectKey,
      upload.publicUrl,
      upload.metadataJson,
      upload.createdAt,
    )
    .run();

  return upload;
}

export async function getBootstrapData(db) {
  const [program, works, summaries, students] = await Promise.all([
    getProgram(db),
    listWorks(db),
    listSummaries(db),
    listStudents(db),
  ]);

  return { program, works, summaries, students };
}
