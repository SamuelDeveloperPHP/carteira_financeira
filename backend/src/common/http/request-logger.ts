import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import { AppRequest } from "./request.types";

// Correlation id + one structured line per request (never bodies or secrets).
export function requestLogger(
  req: AppRequest,
  res: Response,
  next: NextFunction
) {
  req.correlationId = randomUUID();
  res.setHeader("X-Request-Id", req.correlationId);
  res.setHeader("Cache-Control", "no-store");
  const start = Date.now();
  res.on("finish", () => {
    if (req.path !== "/api/health")
      console.log(
        JSON.stringify({
          event: "http.request",
          correlationId: req.correlationId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        })
      );
  });
  next();
}
