/** chibot's mark and name, at the top of the expanded sidebar. */
export function BrandMark() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={3.2}
          strokeLinecap="round"
        >
          <path d="M8.5 7.5C11.8 7.7 15 10.5 15 17V25" />
          <path d="M15 18C15 12.5 18.8 9.5 21.5 9.5" />
        </g>
        <circle className="bead" cx="23.7" cy="9.5" r="2.5" />
      </svg>
      chibot
    </span>
  )
}
