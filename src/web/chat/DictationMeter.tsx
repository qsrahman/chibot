import { useEffect, useRef, useState } from 'react'

/** `65` as `1:05`. */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/**
 * What a recording shows while it runs: how long it has gone on, and a bar
 * that follows the voice, so it is clear the microphone hears you. The visual
 * parts are hidden from screen readers (a timer ticking every second would
 * talk over everything); the mic button already says it is recording.
 */
export function DictationMeter({ stream }: { stream: MediaStream }) {
  const [seconds, setSeconds] = useState(0)
  const bar = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      250,
    )
    // The level is written straight to the bar: ten updates a second would
    // otherwise render the whole composer.
    const context = new AudioContext()
    void context.resume()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const meter = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += ((s - 128) / 128) ** 2
      // Speech sits low in a recording: scale so ordinary talking fills the bar.
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4)
      bar.current?.style.setProperty('--level', level.toFixed(2))
    }, 100)
    return () => {
      clearInterval(tick)
      clearInterval(meter)
      void context.close()
    }
  }, [stream])

  return (
    <span className="dictation-meter" aria-hidden>
      <span className="dictation-level">
        <span ref={bar} className="dictation-level-bar" />
      </span>
      <span className="dictation-time">{clock(seconds)}</span>
    </span>
  )
}
