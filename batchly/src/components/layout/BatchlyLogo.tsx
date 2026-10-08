interface Props {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
  /** kept for API compatibility — ignored, always renders for dark backgrounds */
  variant?: "dark" | "light";
}

export function BatchlyLogo({ size = "md", showText = true, className = "" }: Props) {
  const dim = size === "sm" ? 38 : size === "lg" ? 52 : 44;
  const textSizeCls = size === "sm" ? "text-[1rem]" : size === "lg" ? "text-[1.35rem]" : "text-[1.15rem]";

  /* Unique gradient id per rendered instance to avoid cross-SVG collision */
  const gId = `bly-g-${size}`;
  const iqId = `biq-g-${size}`;

  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      {/* ── Picnic basket icon ── */}
      <div
        style={{
          width: dim,
          height: dim,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          borderRadius: "12px",
          background: "var(--iq-surface-2)",
          border: "1px solid var(--iq-line)",
        }}
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          width={dim * 0.68}
          height={dim * 0.68}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gId} x1="5" y1="5" x2="35" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#eef2f9" />
              <stop offset="1" stopColor="#8fb6ff" />
            </linearGradient>
          </defs>
          {/* Handle arc */}
          <path
            d="M13 16 C13 8 27 8 27 16"
            stroke={`url(#${gId})`}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
          {/* Lid bar */}
          <rect x="7.5" y="14.5" width="25" height="4.5" rx="2.25" fill={`url(#${gId})`} />
          {/* Body */}
          <rect x="9" y="19" width="22" height="14.5" rx="2.5" fill={`url(#${gId})`} />
          {/* Weave lines */}
          <rect x="9" y="23.5" width="22" height="1" rx="0.5" fill="rgba(10,11,13,.2)" />
          <rect x="9" y="27.5" width="22" height="1" rx="0.5" fill="rgba(10,11,13,.2)" />
          <rect x="9" y="31.5" width="22" height="1" rx="0.5" fill="rgba(10,11,13,.2)" />
          {/* Clasp */}
          <rect x="17.5" y="15.5" width="5" height="3" rx="1.5" fill="rgba(10,11,13,.3)" />
        </svg>
      </div>

      {showText && (
        <div style={{ display: "grid", gap: "3px", paddingTop: "1px" }}>
          {/* Wordmark */}
          <p
            className={`m-0 leading-none font-bold tracking-tight ${textSizeCls}`}
            style={{
              background: "linear-gradient(135deg, #eef2f9 0%, #8fb6ff 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "-0.02em",
            }}
          >
            batchly
          </p>

          {/* "a product of inQueue" with iQ logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <svg
              viewBox="0 0 30 17"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width={22}
              height={13}
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={iqId} x1="0" y1="0" x2="30" y2="17" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#cdd4e0" />
                  <stop offset="1" stopColor="#8fb6ff" />
                </linearGradient>
              </defs>
              <circle cx="3" cy="3.5" r="2" fill={`url(#${iqId})`} />
              <rect x="1.5" y="7.5" width="3" height="8.5" rx="1.5" fill={`url(#${iqId})`} />
              <circle cx="19" cy="9.5" r="6" stroke={`url(#${iqId})`} strokeWidth="2.2" fill="none" />
              <line x1="23.5" y1="14" x2="28" y2="16.5" stroke={`url(#${iqId})`} strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span
              style={{
                fontSize: "0.67rem",
                fontWeight: 600,
                color: "var(--iq-text-3)",
                letterSpacing: "0.02em",
                lineHeight: 1,
              }}
            >
              a product of inQueue
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
