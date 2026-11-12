import { useEffect, useRef, useState, type UIEvent } from 'react'
import { REDUCED_MOTION } from '../ui/useMediaQuery.ts'

/** How long after the thread got shorter a scroll up is taken for the browser's own. */
const SHRINK_MS = 300

/**
 * Keeps the newest message in view while an answer streams, but only while the
 * user is at the bottom, so scrolling up to read isn't undone by every new
 * token. `id` is the open chat; `content` changes whenever messages do;
 * `empty` is whether the chat has none (the thread element then doesn't exist).
 */
export function useScrollFollow(
  id: string | undefined,
  content: unknown[],
  empty: boolean,
) {
  const endRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const scrollTopRef = useRef(0)
  // When the thread last got shorter (see `onScroll`).
  const threadHeightRef = useRef(0)
  const shrunkAtRef = useRef(-Infinity)
  // When the user last used the wheel, a touch, a key or the scrollbar on the list.
  const inputAtRef = useRef(-Infinity)
  // Scrolled up: a button jumps back to the latest message.
  const [away, setAway] = useState(false)

  useEffect(() => {
    followRef.current = true
    setAway(false)
  }, [id])

  const follow = () => {
    const height = threadRef.current?.offsetHeight ?? 0
    if (height < threadHeightRef.current)
      shrunkAtRef.current = performance.now()
    threadHeightRef.current = height
    if (followRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }
  useEffect(follow, content)

  // Content that grows after the scroll (the saved answer's actions, images)
  // must not leave the view short of the end.
  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    const observer = new ResizeObserver(follow)
    observer.observe(thread)
    return () => observer.disconnect()
    // `follow` only reads a ref, so it needn't be a dependency; the thread
    // element exists once there are messages.
  }, [empty])

  /** Wraps an action that starts a turn: the view follows its answer. */
  function following<A extends unknown[], R>(action: (...args: A) => R) {
    return (...args: A): R => {
      followRef.current = true
      return action(...args)
    }
  }

  const markInput = () => {
    inputAtRef.current = performance.now()
  }

  return {
    endRef,
    threadRef,
    away,
    follow,
    following,
    /** Spread on the scrolling list, with `onScroll`: they tell a scroll the user made from the layout's. */
    inputProps: {
      onWheel: markInput,
      onTouchMove: markInput,
      onKeyDown: markInput,
      onPointerDown: markInput,
    },
    onScroll(e: UIEvent<HTMLElement>) {
      const el = e.currentTarget
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      // Only scrolling up leaves the end: a scroll event measured after
      // the content grew (while following) isn't the user's. Nor is one after
      // it got shorter (the streamed answer is replaced by the saved one,
      // which is briefly shorter): the browser pulls the position up with it,
      // and the event, delivered after the content has grown again, looks like
      // a scroll up that left the end short of it.
      // (A scroll the user's own input just made always counts.)
      const now = performance.now()
      const shrunk = now - shrunkAtRef.current < SHRINK_MS
      const byUser = now - inputAtRef.current < SHRINK_MS
      const up = el.scrollTop < scrollTopRef.current && (!shrunk || byUser)
      scrollTopRef.current = el.scrollTop
      if (atEnd) followRef.current = true
      else if (up) followRef.current = false
      setAway(!atEnd)
    },
    jumpToLatest() {
      followRef.current = true
      endRef.current?.scrollIntoView({
        block: 'end',
        // Gliding is movement: not for those who ask for less.
        behavior: matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth',
      })
    },
  }
}
