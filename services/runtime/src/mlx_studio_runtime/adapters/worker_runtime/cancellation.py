"""Serialize start/cancel ownership, including cancellation received before start."""

import threading
from collections import deque


class WorkerCancellation:
    def __init__(self, signal: threading.Event) -> None:
        self.signal = signal
        self.lock = threading.Lock()
        self.active: str | None = None
        self.cancelled: set[str] = set()
        self.order: deque[str] = deque()

    def cancel(self, job_id: str) -> None:
        with self.lock:
            if job_id not in self.cancelled:
                self.cancelled.add(job_id)
                self.order.append(job_id)
            while len(self.order) > 256:
                self.cancelled.discard(self.order.popleft())
            if self.active == job_id:
                self.signal.set()

    def begin(self, job_id: str) -> bool:
        with self.lock:
            if job_id in self.cancelled:
                return False
            self.active = job_id
            self.signal.clear()
            return True

    def finish(self, job_id: str) -> None:
        with self.lock:
            if self.active == job_id:
                self.active = None
