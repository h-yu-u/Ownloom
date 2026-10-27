"""Small in-process fan-out for versioned Runtime events."""

import asyncio
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RuntimeEvent:
    seq: int
    type: str
    payload: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "type": self.type, "payload": self.payload}


class EventHub:
    def __init__(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self._sequence = 0
        self._subscribers: set[asyncio.Queue[RuntimeEvent]] = set()
        self._history: deque[RuntimeEvent] = deque(maxlen=1024)

    async def publish(self, event_type: str, payload: dict[str, Any]) -> RuntimeEvent:
        self._sequence += 1
        event = RuntimeEvent(self._sequence, event_type, payload)
        self._history.append(event)
        for queue in tuple(self._subscribers):
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(
                    RuntimeEvent(
                        event.seq,
                        "runtime.resync_required",
                        {
                            "instance_id": self.instance_id,
                            "reason": "subscriber_overflow",
                        },
                    )
                )
            else:
                queue.put_nowait(event)
        return event

    async def subscribe(self, after: int = 0) -> asyncio.Queue[RuntimeEvent]:
        queue: asyncio.Queue[RuntimeEvent] = asyncio.Queue(maxsize=512)
        replay = [event for event in self._history if event.seq > after]
        too_old = bool(self._history and after < self._history[0].seq - 1)
        if after > self._sequence or too_old or len(replay) > queue.maxsize:
            queue.put_nowait(
                RuntimeEvent(
                    self._sequence,
                    "runtime.resync_required",
                    {
                        "instance_id": self.instance_id,
                        "reason": "cursor_gap",
                    },
                )
            )
        else:
            for event in replay:
                queue.put_nowait(event)
        self._subscribers.add(queue)
        return queue

    @property
    def sequence(self) -> int:
        return self._sequence

    def unsubscribe(self, queue: asyncio.Queue[RuntimeEvent]) -> None:
        self._subscribers.discard(queue)
