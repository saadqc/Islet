import { useEffect, useRef, useState } from "react";
import { request, onHostEvent } from "../core/bridge";
import "./transfers.css";
interface Job {
  id: string;
  name: string;
  status: string;
  phase: string;
  bytes: number;
  total: number;
  error?: string;
  completed?: string[];
}
export function TransferPanel({ onComplete }: { onComplete: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const seen = useRef(new Set<string>());
  useEffect(() => {
    let disposed = false,
      close: (() => void) | undefined;
    void request<Job[]>("files.list")
      .then((active) => {
        if (!Array.isArray(active)) return;
        if (!disposed)
          setJobs((values) =>
            [
              ...active.filter(
                (job) => !values.some((value) => value.id === job.id),
              ),
              ...values,
            ].slice(-5),
          );
      })
      .catch(() => {});
    void onHostEvent("host-event", (event) => {
      if (event.type !== "file-transfer") return;
      const job = event.job as Job;
      setJobs((values) =>
        [...values.filter((value) => value.id !== job.id), job].slice(-5),
      );
      if (job.status === "complete" && !seen.current.has(job.id)) {
        seen.current.add(job.id);
        callback.current();
      }
    }).then((off) => {
      if (disposed) off();
      else close = off;
    });
    return () => {
      disposed = true;
      close?.();
    };
  }, []);
  if (!jobs.length) return null;
  return (
    <section className="file-transfers" aria-label="File transfers">
      {jobs.map((job) => (
        <div className="file-transfer" key={job.id}>
          <span>
            <strong>{job.name}</strong>
            <small role="status">
              {job.status === "running"
                ? job.phase === "preparing"
                  ? "Preparing…"
                  : `${job.phase === "copying" ? "Copying" : "Downloading"} · ${Math.round(job.bytes / 1024)} / ${Math.round(job.total / 1024)} KB`
                : job.status === "complete"
                  ? "Complete"
                  : job.error || job.status}
            </small>
          </span>
          {job.status === "running" && (
            <progress
              max={job.total || 1}
              value={job.bytes}
              aria-label={`Progress for ${job.name}`}
            />
          )}
          {job.status === "running" ? (
            <button
              onClick={() => void request("files.cancel", { id: job.id })}
            >
              Cancel
            </button>
          ) : (
            <button
              aria-label={`Dismiss transfer ${job.name}`}
              onClick={() =>
                setJobs((values) =>
                  values.filter((value) => value.id !== job.id),
                )
              }
            >
              Dismiss
            </button>
          )}
          {job.status === "failed" && !!job.completed?.length && (
            <small>{job.completed.length} item(s) already copied.</small>
          )}
        </div>
      ))}
    </section>
  );
}
