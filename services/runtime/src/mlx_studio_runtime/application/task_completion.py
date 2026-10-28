"""A resource owner must settle submitted work before compensating its side effects."""

import asyncio


async def finish_owned_task[T](task: asyncio.Future[T]) -> T:
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
    return task.result()
