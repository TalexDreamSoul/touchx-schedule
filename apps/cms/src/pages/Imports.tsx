import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/api";

interface ImportJobRow {
  id?: string;
  jobId?: string;
  status?: string;
  totalFiles?: number;
  successCount?: number;
  failCount?: number;
  createdByUserId?: string;
  updatedAt?: string;
  fileName?: string;
  candidateSummary?: { total: number; pending: number; accepted: number; rejected: number; corrected: number };
}

interface CandidateRow {
  id: string;
  title: string;
  eventType: string;
  location: string;
  weekday?: number;
  startSection?: number;
  endSection?: number;
  date?: string;
  confidence: number;
  status: string;
}

interface CandidateFormState {
  id: string;
  title: string;
  eventType: string;
  location: string;
  weekday: string;
  startSection: string;
  endSection: string;
  date: string;
}

const emptyCandidateForm: CandidateFormState = {
  id: "",
  title: "",
  eventType: "course",
  location: "",
  weekday: "1",
  startSection: "1",
  endSection: "1",
  date: "",
};

const toCandidateForm = (item: CandidateRow): CandidateFormState => ({
  id: item.id,
  title: item.title,
  eventType: item.eventType || "course",
  location: item.location || "",
  weekday: String(item.weekday || 1),
  startSection: String(item.startSection || 1),
  endSection: String(item.endSection || item.startSection || 1),
  date: item.date || "",
});

export function Imports() {
  const [legacyItems, setLegacyItems] = useState<ImportJobRow[]>([]);
  const [candidateJobs, setCandidateJobs] = useState<ImportJobRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [title, setTitle] = useState("");
  const [targetSourceId, setTargetSourceId] = useState("");
  const [publishMode, setPublishMode] = useState("publish");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadStudentNo, setUploadStudentNo] = useState("");
  const [uploadTerm, setUploadTerm] = useState("2025-2026-2");
  const [candidateForm, setCandidateForm] = useState<CandidateFormState>(emptyCandidateForm);
  const [calendarSources, setCalendarSources] = useState<Array<{ id: string; title: string }>>([]);
  const [storage, setStorage] = useState("unknown");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pendingCount = useMemo(() => candidateJobs.reduce((sum, item) => sum + Number(item.candidateSummary?.pending || 0), 0), [candidateJobs]);

  const loadCandidates = async (jobId: string) => {
    const data = await adminApi.listImportCandidates(jobId) as { items: CandidateRow[] };
    setSelectedJobId(jobId);
    setCandidates(data.items || []);
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [legacy, candidate, sources] = await Promise.all([
        adminApi.listImportJobs({ limit: 30 }) as Promise<{ items: ImportJobRow[]; storage?: string; warning?: string }>,
        adminApi.listImportCandidateJobs() as Promise<{ items: ImportJobRow[] }>,
        adminApi.listCalendarSources() as Promise<{ items: Array<{ id: string; title: string }> }>,
      ]);
      setLegacyItems(legacy.items || []);
      setStorage(legacy.storage || "unknown");
      setWarning(legacy.warning || "");
      setCandidateJobs(candidate.items || []);
      setCalendarSources(sources.items || []);
      if (selectedJobId) await loadCandidates(selectedJobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const convertLegacyJob = async (legacyJobId: string) => {
    if (!legacyJobId) return;
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.createImportCandidateJobFromScheduleImport(legacyJobId, { targetSourceId }) as { item: { id: string } };
      await load();
      await loadCandidates(data.item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "转换失败");
    } finally {
      setLoading(false);
    }
  };

  const createCandidateJob = async () => {
    if (!title.trim()) return;
    const data = await adminApi.createImportCandidateJob({ title, weekday: 1, startSection: 1, endSection: 1, targetSourceId }) as { item: { id: string } };
    setTitle("");
    await load();
    await loadCandidates(data.item.id);
  };

  const uploadScheduleImport = async () => {
    if (uploadFiles.length <= 0) return;
    setLoading(true);
    setError("");
    try {
      await adminApi.uploadScheduleImportJob(uploadFiles.map((file) => ({
        file,
        fileName: file.name,
        studentNo: uploadStudentNo,
        term: uploadTerm,
      })));
      setUploadFiles([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setLoading(false);
    }
  };

  const updateCandidate = async (id: string, action: "accept" | "reject" | "correct", body: Record<string, unknown> = {}) => {
    if (action === "accept") await adminApi.acceptImportCandidate(id);
    if (action === "reject") await adminApi.rejectImportCandidate(id);
    if (action === "correct") await adminApi.correctImportCandidate(id, body);
    if (selectedJobId) await loadCandidates(selectedJobId);
    await load();
  };

  const saveCandidateCorrection = async () => {
    if (!candidateForm.id) {
      setError("请选择要修正的候选事件");
      return;
    }
    if (!candidateForm.title.trim()) {
      setError("候选事件标题不能为空");
      return;
    }
    await updateCandidate(candidateForm.id, "correct", {
      title: candidateForm.title.trim(),
      eventType: candidateForm.eventType,
      location: candidateForm.location.trim(),
      weekday: Number(candidateForm.weekday || 1),
      startSection: Number(candidateForm.startSection || 1),
      endSection: Number(candidateForm.endSection || candidateForm.startSection || 1),
      date: candidateForm.date.trim(),
    });
    setCandidateForm(emptyCandidateForm);
  };

  const commitPersonal = async (id: string) => {
    await adminApi.commitImportCandidateToPersonal(id);
    if (selectedJobId) await loadCandidates(selectedJobId);
    await load();
  };

  const commitCalendar = async (id: string) => {
    await adminApi.commitImportCandidateToCalendar(id, { sourceId: targetSourceId, publish: publishMode !== "draft" });
    if (selectedJobId) await loadCandidates(selectedJobId);
    await load();
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card">
      <div className="card-head"><div><h2>导入中心</h2><p>ImportJob + ImportCandidateEvent 审核流。</p></div><button className="button ghost" onClick={load}>{loading ? "加载中..." : "刷新"}</button></div>
      <div className="grid" style={{ marginBottom: 12 }}>
        <article className="card"><span className="pill">Legacy</span><h2>{legacyItems.length}</h2><p>旧 PDF 任务。</p></article>
        <article className="card"><span className="pill">Candidate Jobs</span><h2>{candidateJobs.length}</h2><p>新审核任务。</p></article>
        <article className="card"><span className="pill">Pending</span><h2>{pendingCount}</h2><p>待审核候选。</p></article>
        <article className="card"><span className="pill">Storage</span><h2>{storage}</h2><p>{warning || "ready"}</p></article>
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input className="input" type="file" accept="application/pdf" multiple onChange={(event: any) => setUploadFiles(Array.from(event.target.files || []))} />
        <input className="input" value={uploadStudentNo} onChange={(event: any) => setUploadStudentNo(event.target.value)} placeholder="学号，可从文件名推断" />
        <input className="input" value={uploadTerm} onChange={(event: any) => setUploadTerm(event.target.value)} placeholder="学期，例如 2025-2026-2" />
        <button className="button" disabled={loading || uploadFiles.length <= 0} onClick={() => void uploadScheduleImport()}>上传 PDF</button>
        <span className="muted">已选择 {uploadFiles.length} 个文件</span>
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input className="input" value={title} onChange={(event: any) => setTitle(event.target.value)} placeholder="候选事件标题" />
        <select className="input" value={targetSourceId} onChange={(event: any) => setTargetSourceId(event.target.value)}>
          <option value="">默认日程源</option>
          {calendarSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
        </select>
        <select className="input" value={publishMode} onChange={(event: any) => setPublishMode(event.target.value)}>
          <option value="publish">提交并发布</option>
          <option value="draft">提交为草稿</option>
        </select>
        <button className="button" onClick={() => void createCandidateJob()}>创建候选任务</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}

      <h2>候选任务</h2>
      <div className="table-wrap" style={{ marginBottom: 16 }}><table><thead><tr><th>任务</th><th>状态</th><th>候选</th><th>操作</th></tr></thead><tbody>
        {candidateJobs.map((item) => <tr key={item.id}><td><strong>{item.id}</strong></td><td><span className="pill">{item.status}</span></td><td>{item.candidateSummary ? `总 ${item.candidateSummary.total} / 待 ${item.candidateSummary.pending}` : "-"}</td><td><button className="button ghost" onClick={() => void loadCandidates(String(item.id))}>候选</button></td></tr>)}
        {candidateJobs.length === 0 ? <tr><td colSpan={4} className="muted">暂无候选任务</td></tr> : null}
      </tbody></table></div>

      <h2>候选事件 {selectedJobId}</h2>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <input className="input" value={candidateForm.title} onChange={(event: any) => setCandidateForm((current) => ({ ...current, title: event.target.value }))} placeholder="修正标题" />
        <select className="input" value={candidateForm.eventType} onChange={(event: any) => setCandidateForm((current) => ({ ...current, eventType: event.target.value }))}>
          <option value="course">课程</option>
          <option value="exam">考试</option>
          <option value="todo">Todo</option>
          <option value="activity">活动</option>
          <option value="deadline">截止</option>
          <option value="custom">自定义</option>
        </select>
        <input className="input" value={candidateForm.location} onChange={(event: any) => setCandidateForm((current) => ({ ...current, location: event.target.value }))} placeholder="地点" />
        <input className="input" value={candidateForm.weekday} onChange={(event: any) => setCandidateForm((current) => ({ ...current, weekday: event.target.value }))} placeholder="周几 1-7" />
        <input className="input" value={candidateForm.startSection} onChange={(event: any) => setCandidateForm((current) => ({ ...current, startSection: event.target.value }))} placeholder="开始节次" />
        <input className="input" value={candidateForm.endSection} onChange={(event: any) => setCandidateForm((current) => ({ ...current, endSection: event.target.value }))} placeholder="结束节次" />
        <input className="input" value={candidateForm.date} onChange={(event: any) => setCandidateForm((current) => ({ ...current, date: event.target.value }))} placeholder="日期 YYYY-MM-DD，可选" />
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="button" onClick={() => void saveCandidateCorrection()}>保存修正</button>
        {candidateForm.id ? <button className="button ghost" onClick={() => setCandidateForm(emptyCandidateForm)}>取消修正</button> : null}
      </div>
      <div className="table-wrap" style={{ marginBottom: 16 }}><table><thead><tr><th>标题</th><th>时间</th><th>地点</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {candidates.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><div className="muted">{item.eventType} · {Math.round(item.confidence * 100)}%</div></td><td>{item.date || `周${item.weekday || "-"} 第${item.startSection || "-"}-${item.endSection || "-"}节`}</td><td>{item.location || "-"}</td><td><span className="pill">{item.status}</span></td><td><button className="button ghost" onClick={() => void updateCandidate(item.id, "accept")}>接受</button><button className="button ghost" onClick={() => void updateCandidate(item.id, "reject")}>拒绝</button><button className="button ghost" onClick={() => setCandidateForm(toCandidateForm(item))}>修正</button><button className="button ghost" onClick={() => void commitPersonal(item.id)}>提交个人</button><button className="button ghost" onClick={() => void commitCalendar(item.id)}>提交日程源</button></td></tr>)}
        {candidates.length === 0 ? <tr><td colSpan={5} className="muted">请选择任务</td></tr> : null}
      </tbody></table></div>

      <h2>旧导入任务</h2>
      <div className="table-wrap"><table><thead><tr><th>任务</th><th>状态</th><th>文件</th><th>成功</th><th>失败</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
        {legacyItems.map((item) => <tr key={item.id || item.jobId}><td><strong>{item.id || item.jobId}</strong><div className="muted">{item.fileName || "-"}</div></td><td><span className="pill">{item.status}</span></td><td>{item.totalFiles || 0}</td><td>{item.successCount || 0}</td><td>{item.failCount || 0}</td><td>{item.updatedAt || "-"}</td><td><button className="button ghost" onClick={() => void convertLegacyJob(String(item.id || item.jobId || ""))}>转候选</button></td></tr>)}
        {legacyItems.length === 0 ? <tr><td colSpan={7} className="muted">暂无旧任务</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
