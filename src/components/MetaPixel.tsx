"use client";
/** Pixel do Meta no navegador: PageView em cada página e eventos com o mesmo id do servidor. */
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Fbq = (...args: unknown[]) => void;
declare global { interface Window { fbq?: Fbq } }

export function metaTrack(name: string, params: Record<string, unknown> = {}, eventId?: string) {
  try { window.fbq?.("track", name, params, eventId ? { eventID: eventId } : undefined); } catch { /* bloqueado pelo navegador */ }
}

export function MetaPixel({ pixelId }: { pixelId: string }) {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // o primeiro PageView sai junto com o script
    window.fbq?.("track", "PageView");
  }, [path]);
  if (!pixelId) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId.replace(/[^0-9]/g, "")}');fbq('track','PageView');`}</Script>
  );
}
