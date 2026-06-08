// Inline pin + leaf mark (matches /favicon.svg). Used in the brand wordmark.
export default function LeafMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="VaidyaRoute"
    >
      <path
        d="M32 4C18 4 8 15 8 28c0 16 24 32 24 32s24-16 24-32C56 15 46 4 32 4z"
        fill="#1D6B4A"
      />
      <g transform="rotate(-18 32 26)">
        <path d="M32 12c-8 6-8 22 0 28 8-6 8-22 0-28z" fill="#FFFFFF" />
        <path
          d="M32 14v24"
          stroke="#1D6B4A"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
