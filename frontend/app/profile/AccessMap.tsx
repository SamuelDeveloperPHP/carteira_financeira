"use client";
/*
 * Mapas da trilha de acesso (Leaflet + OpenStreetMap).
 *
 *   AccessMiniMap     - UM mapa por acesso, com o marcador no ponto registrado
 *   AccessOverviewMap - UM mapa geral com o marcador de todos os acessos
 *
 * Cada marcador tem um tooltip com os dados do acesso (data no formato
 * dd/mm/yyyy h:mm:ss). A posição é a que o navegador DECLAROU no login: serve
 * para o usuário reconhecer acessos estranhos, não como prova de localização.
 *
 * O Leaflet mexe no DOM e precisa de `window`, então é importado sob demanda
 * dentro do efeito (nunca no servidor). Os blocos de mapa são desmontados com
 * `map.remove()` para não vazar listeners ao trocar de aba ou de página.
 *
 * Privacidade: o mapa-base vem do OpenStreetMap. O navegador baixa as imagens
 * da região exibida, então esse serviço pode inferir a área consultada (não o
 * usuário: as coordenadas não são enviadas pelo nosso servidor).
 */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { AccessEntry, dateTime, duration, END_REASONS, esc } from "./format";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** Conteúdo do tooltip. Tudo que vem do cliente (IP, aparelho) passa por `esc`. */
export function tooltipHtml(a: AccessEntry): string {
  const loc = a.location;
  const row = (label: string, value: string) =>
    `<div><strong>${label}:</strong> ${esc(value)}</div>`;
  return [
    row("Entrada", dateTime(a.startedAt)),
    row(
      "Saída",
      a.endedAt ? dateTime(a.endedAt) : a.active ? "sessão ativa" : "—"
    ),
    row("Permanência", duration(a.durationSeconds)),
    a.endReason ? row("Encerramento", END_REASONS[a.endReason] ?? a.endReason) : "",
    row("IP", a.ip ?? "—"),
    row("Aparelho", (a.device ?? "—").slice(0, 90)),
    loc.latitude !== undefined && loc.longitude !== undefined
      ? row(
          "Coordenadas",
          `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` +
            (loc.accuracy !== undefined ? ` (±${Math.round(loc.accuracy)} m)` : "")
        )
      : "",
    a.current ? '<div class="access-tip-now">Sessão atual</div>' : "",
  ].join("");
}

/** Coordenadas utilizáveis ou null. */
export function pointOf(a: AccessEntry): [number, number] | null {
  const { latitude, longitude, status } = a.location;
  return status === "granted" && latitude !== undefined && longitude !== undefined
    ? [latitude, longitude]
    : null;
}

/** Cria o mapa-base no elemento e devolve o objeto Leaflet. */
async function createMap(el: HTMLElement, interactive: boolean) {
  const L = (await import("leaflet")).default;
  const map = L.map(el, {
    scrollWheelZoom: false, // a roda do mouse rola a página, não dá zoom sem querer
    zoomControl: interactive,
    attributionControl: true,
  });
  L.tileLayer(TILES, {
    maxZoom: 19,
    attribution: ATTRIBUTION,
    // A política da API de tiles do OSM exige identificação da origem; o
    // gateway usa "no-referrer", então enviamos só a origem (sem caminho).
    referrerPolicy: "origin",
  } as any).addTo(map);
  return { L, map };
}

/** Pino em CSS (sem imagens externas): azul para os acessos, verde para a sessão atual. */
function pin(L: typeof import("leaflet"), current: boolean) {
  return L.divIcon({
    className: `access-pin${current ? " current" : ""}`,
    html: "<span></span>",
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    tooltipAnchor: [0, -30],
  });
}

/** Mapa de UM acesso: marcador, círculo de precisão e tooltip. */
export function AccessMiniMap({ access }: { access: AccessEntry }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const point = pointOf(access);
    if (!point || !box.current) return;
    let map: LeafletMap | undefined;
    let cancelled = false;
    (async () => {
      const created = await createMap(box.current!, true);
      if (cancelled) return created.map.remove();
      map = created.map;
      const { L } = created;
      const marker = L.marker(point, { icon: pin(L, access.current), keyboard: true, alt: "Local do acesso" })
        .addTo(map)
        .bindTooltip(tooltipHtml(access), { direction: "top", className: "access-tip" });
      // Toque em telas sem mouse: o tooltip abre ao tocar no marcador.
      marker.on("click", () => marker.openTooltip());
      const accuracy = access.location.accuracy;
      if (accuracy !== undefined && accuracy > 0) {
        // Enquadra o círculo de precisão (quanto mais preciso, maior o zoom). Os
        // limites vêm do cálculo em metros, pois `circle.getBounds()` exige que
        // o mapa já tenha uma visão definida.
        map.fitBounds(L.latLng(point).toBounds(accuracy * 2), { maxZoom: 17, padding: [12, 12] });
        L.circle(point, { radius: accuracy, weight: 1, fillOpacity: 0.12 }).addTo(map);
      } else map.setView(point, 15);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [access]);
  if (!pointOf(access))
    return <div className="map-empty">Sem coordenadas neste acesso.</div>;
  return (
    <div
      ref={box}
      className="access-map"
      role="img"
      aria-label={`Mapa do acesso de ${dateTime(access.startedAt)}`}
    />
  );
}

/** Mapa geral com um marcador por acesso que tem coordenadas. */
export function AccessOverviewMap({ items }: { items: AccessEntry[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const located = items.filter(i => pointOf(i));
    if (!located.length || !box.current) return;
    let map: LeafletMap | undefined;
    let cancelled = false;
    (async () => {
      const created = await createMap(box.current!, true);
      if (cancelled) return created.map.remove();
      map = created.map;
      const { L } = created;
      const bounds = L.latLngBounds([]);
      for (const item of located) {
        const point = pointOf(item)!;
        bounds.extend(point);
        const marker = L.marker(point, { icon: pin(L, item.current), alt: "Local de um acesso" })
          .addTo(map)
          .bindTooltip(tooltipHtml(item), { direction: "top", className: "access-tip" });
        marker.on("click", () => marker.openTooltip());
      }
      map.fitBounds(bounds, { maxZoom: 15, padding: [30, 30] });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [items]);
  if (!items.some(i => pointOf(i)))
    return (
      <div className="map-empty">
        Nenhum acesso com localização registrada. Ative a geolocalização e
        permita o acesso no navegador para ver os pontos aqui.
      </div>
    );
  return <div ref={box} className="access-map overview" role="img" aria-label="Mapa geral dos acessos" />;
}
