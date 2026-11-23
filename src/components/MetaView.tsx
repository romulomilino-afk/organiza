"use client";
/** Marca no pixel da Meta que a pessoa viu uma página importante do funil (ex.: a página do anúncio). */
import { useEffect } from "react";
import { metaTrack } from "./MetaPixel";

export function MetaView({ name }: { name: string }) {
  useEffect(() => {
    // o pixel carrega depois da página: tenta de novo por alguns segundos
    let n = 0;
    const id = setInterval(() => {
      if (window.fbq || ++n > 10) { clearInterval(id); metaTrack("ViewContent", { content_name: name }); }
    }, 500);
    return () => clearInterval(id);
  }, [name]);
  return null;
}
