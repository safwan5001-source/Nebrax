'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postDecision } from './client';
import { DecisionQueue, type QueueJob } from './decision-queue';
import type { DecisionRequest } from './types';

/** غلاف React رفيع للطابور: مثيل واحد لكل مقارنة، وحالة المهام تُنعكس في الواجهة. لا منطق قرار هنا. */
export function useDecisionQueue(reconciliationId: string) {
  const [jobs, setJobs] = useState<readonly QueueJob[]>([]);
  const queueRef = useRef<DecisionQueue | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    const queue = new DecisionQueue({
      send: (request) => postDecision(reconciliationId, request),
      onChange: (next) => {
        if (liveRef.current) setJobs(next);
      },
    });
    queueRef.current = queue;
    return () => {
      liveRef.current = false;
      queueRef.current = null;
    };
  }, [reconciliationId]);

  const submit = useCallback((request: DecisionRequest): Promise<QueueJob> => {
    const queue = queueRef.current;
    if (!queue) return Promise.reject(new Error('queue_unavailable'));
    return queue.enqueue(request);
  }, []);

  const clearFinished = useCallback((lineId?: string) => queueRef.current?.clearFinished(lineId), []);
  const jobFor = useCallback(
    (lineId: string): QueueJob | null => {
      let found: QueueJob | null = null;
      for (const job of jobs) {
        if (job.lineId !== lineId) continue;
        if (!found || job.status === 'queued' || job.status === 'sending' || job.status === 'backoff') found = job;
      }
      return found;
    },
    [jobs],
  );
  const pendingCount = jobs.filter((job) => job.status === 'queued' || job.status === 'sending' || job.status === 'backoff').length;

  return { jobs, submit, jobFor, clearFinished, pendingCount };
}
