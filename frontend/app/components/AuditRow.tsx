"use client";
import { date, labels } from "../lib/format";
import type { AuditEvent } from "../lib/types";

export function AuditRow({
  event: e,
  expanded,
  showMap,
  toggle,
  map,
}: {
  event: AuditEvent;
  expanded: boolean;
  showMap: boolean;
  toggle: () => void;
  map: () => void;
}) {
  const loc = e.location,
    hasLocation =
      loc?.status === "granted" &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number";
  return (
    <>
      <tr>
        <td>
          {date(e.created_at)}
          <small className="d-block">
            {e.actor_email || "Não autenticado / sistema"}
          </small>
        </td>
        <td>{e.action}</td>
        <td>
          {e.ip}
          <small className="d-block">
            {hasLocation
              ? "Localização disponível"
              : loc?.status === "denied"
                ? "Localização recusada"
                : "Sem localização"}
          </small>
        </td>
        <td>
          <span className={`tag ${e.outcome}`}>{labels[e.outcome]}</span>
        </td>
        <td>
          <button
            className="btn btn-sm btn-outline-secondary"
            aria-expanded={expanded}
            onClick={toggle}
          >
            {expanded ? "Fechar" : "Detalhes"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5}>
            <div className="details">
              <dl>
                <dt>Responsável</dt>
                <dd>{e.actor_name || "Sistema / acesso não autenticado"}</dd>
                <dt>Recurso</dt>
                <dd>{e.resource || "—"}</dd>
                <dt>Correlação</dt>
                <dd>{e.correlation_id}</dd>
                <dt>Navegador</dt>
                <dd>{e.device}</dd>
                <dt>Motivo</dt>
                <dd>{e.reason || "—"}</dd>
                <dt>Localização</dt>
                <dd>
                  {hasLocation
                    ? `${loc.latitude}, ${loc.longitude} (precisão estimada: ${Math.round(loc.accuracy || 0)} m)`
                    : loc?.status === "denied"
                      ? "Permissão negada"
                      : labels[loc?.status] || "Indisponível"}
                </dd>
                <dt>Contexto</dt>
                <dd>{JSON.stringify(e.details)}</dd>
              </dl>
              {hasLocation && (
                <>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={map}
                  >
                    {showMap
                      ? "Fechar posição"
                      : "Visualizar posição geográfica"}
                  </button>
                  {showMap && (
                    <LocalPosition
                      latitude={loc.latitude!}
                      longitude={loc.longitude!}
                    />
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
function LocalPosition({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const x = 40 + (longitude + 180) * 2,
    y = 30 + (90 - latitude) * 2;
  return (
    <figure className="mt-3">
      <svg
        viewBox="0 0 800 420"
        role="img"
        aria-label={`Posição declarada: latitude ${latitude}, longitude ${longitude}`}
        style={{
          width: "100%",
          maxWidth: 800,
          background: "#e8f0f4",
          border: "1px solid #c5d6df",
        }}
      >
        <rect
          x="40"
          y="30"
          width="720"
          height="360"
          fill="#f9fcfd"
          stroke="#8ba5b6"
        />
        {[-120, -60, 0, 60, 120].map(lon => (
          <line
            key={lon}
            x1={40 + (lon + 180) * 2}
            y1="30"
            x2={40 + (lon + 180) * 2}
            y2="390"
            stroke="#cbdbe4"
          />
        ))}
        {[-60, -30, 0, 30, 60].map(lat => (
          <line
            key={lat}
            x1="40"
            y1={30 + (90 - lat) * 2}
            x2="760"
            y2={30 + (90 - lat) * 2}
            stroke="#cbdbe4"
          />
        ))}
        <text x="8" y="40" fontSize="12">
          90°N
        </text>
        <text x="8" y="215" fontSize="12">
          0°
        </text>
        <text x="8" y="390" fontSize="12">
          90°S
        </text>
        <text x="40" y="410" fontSize="12">
          180°O
        </text>
        <text x="395" y="410" fontSize="12">
          0°
        </text>
        <text x="724" y="410" fontSize="12">
          180°L
        </text>
        <circle
          cx={x}
          cy={y}
          r="10"
          fill="#176b57"
          stroke="#fff"
          strokeWidth="3"
        />
        <line
          x1={x}
          y1="30"
          x2={x}
          y2="390"
          stroke="#176b57"
          strokeDasharray="4 4"
          opacity=".5"
        />
        <line
          x1="40"
          y1={y}
          x2="760"
          y2={y}
          stroke="#176b57"
          strokeDasharray="4 4"
          opacity=".5"
        />
      </svg>
      <figcaption className="small muted mt-2">
        Grade geográfica local de latitude/longitude, sem envio de dados a
        serviços de mapas. Posição declarada pelo navegador; não verificada.
      </figcaption>
    </figure>
  );
}
