const { z } = require("zod");
const { selectBoards } = require("./boards");

const weights = { relevanceToCandidate: 25, skillsSimilarity: 20, experienceSimilarity: 20,
  interestsAndDomain: 15, salaryAndCompensation: 15, roleQuality: 5 };
const score = z.number().min(0).max(10);
const resultSchema = z.object({
  relevantCandidate: z.boolean(),
  categoryScores: z.object(Object.fromEntries(Object.keys(weights).map(key => [key, key === "salaryAndCompensation" ? score.nullable() : score]))),
  hardConstraints: z.array(z.object({ name: z.string(), status: z.enum(["pass", "fail", "unknown"]), reason: z.string() })),
  summary: z.object({ recommendation: z.enum(["strong-interest", "review", "weak-fit", "ineligible"]), rationale: z.string(),
    strengths: z.array(z.string()), concerns: z.array(z.string()), missingInformation: z.array(z.string()) }),
  evidence: z.array(z.object({ category: z.string(), source: z.string(), text: z.string() })),
  confidence: z.number().min(0).max(1),
  predictedLikelihood: z.object({ estimate: z.number().min(0).max(1), confidence: z.number().min(0).max(1), basis: z.string(), warning: z.string() }).optional(),
}).passthrough();
function calculateTotal(scores) {
  const available = Object.keys(weights).filter(key => scores[key] !== null);
  const denominator = available.reduce((sum, key) => sum + weights[key], 0);
  return Math.round(available.reduce((sum, key) => sum + scores[key] / 10 * weights[key], 0) / denominator * 100);
}
async function requestGrade(config, job, signal, fetchImpl = fetch) {
  const response = await fetchImpl(config.endpoint, { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, thinking: { type: "disabled" }, temperature: 0.1, max_tokens: 3000,
      response_format: { type: "json_object" }, messages: [{ role: "system", content: config.system },
        { role: "user", content: `Evaluate this WaterlooWorks job. Return JSON only.\n\n${JSON.stringify(job, null, 2)}` }] }) });
  // Never persist provider response bodies: they can contain private prompt text.
  if (!response.ok) throw new Error(`Grading provider returned HTTP ${response.status}`);
  const payload = await response.json();
  try { return resultSchema.parse(JSON.parse(payload?.choices?.[0]?.message?.content)); }
  catch { throw new Error("Grading provider returned an invalid evaluation"); }
}
async function gradeJobs({ store, options, config, signal, report, fetchImpl }) {
  const boards = selectBoards(options.board);
  // Snapshot keys only. Each job and evaluation is read from SQLite when processed.
  const keys = store.database.prepare(`SELECT job_key FROM jobs WHERE board IN (${boards.map(() => "?").join(",")})
    ${options.jobKey ? "AND job_key = ?" : ""} ORDER BY job_key`).all(...boards, ...(options.jobKey ? [options.jobKey] : []));
  const progress = { total: keys.length, completed: 0, graded: 0, skipped: 0 };
  report(progress);
  for (const { job_key: key } of keys) {
    signal.throwIfAborted();
    const entry = store.getJob(key);
    if (!entry) continue;
    const old = entry.grade;
    if (!options.all && old?.sourceHash === entry.contentHash && old?.promptHash === config.promptHash &&
      old?.provider === config.provider && old?.model === config.model &&
      (!old.modelHash || old.modelHash === config.modelHash)) {
      progress.skipped++;
    } else {
      const result = await requestGrade(config, entry.job, signal, fetchImpl);
      signal.throwIfAborted();
      // A concurrent import/scrape may have changed this source while awaiting the provider.
      if (store.getJob(key)?.contentHash !== entry.contentHash) throw new Error("Job changed during grading; rerun to grade its current content");
      store.upsertEvaluation(key, { ...result, jobId: String(entry.job.id), board: entry.board,
        totalScore: calculateTotal(result.categoryScores), provider: config.provider, model: config.model,
        modelHash: config.modelHash, sourceHash: entry.contentHash, promptHash: config.promptHash,
        evaluatedAt: new Date().toISOString() });
      progress.graded++;
    }
    progress.completed++;
    report(progress);
  }
  return progress;
}
module.exports = { gradeJobs, requestGrade, resultSchema, calculateTotal, weights };
