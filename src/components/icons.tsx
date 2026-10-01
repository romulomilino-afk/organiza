const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24" };

export const IconMic = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const IconSend = (p: { className?: string }) => (<svg {...base} strokeWidth={2.2} className={p.className} aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const IconCheck = (p: { className?: string }) => (<svg {...base} strokeWidth={3} className={p.className} aria-hidden><path d="M5 12l5 5 9-10" /></svg>);
export const IconHome = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>);
export const IconChat = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>);
export const IconCal = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>);
export const IconWallet = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 7V6a2 2 0 0 1 2-2h10v3M16 14h1" /></svg>);
export const IconCart = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>);
export const IconUser = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
export const IconEye = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>);
export const IconEyeOff = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></svg>);
export const IconHouse = (p: { className?: string }) => (<svg {...base} className={p.className} aria-hidden><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M10 21v-5h4v5" /></svg>);
