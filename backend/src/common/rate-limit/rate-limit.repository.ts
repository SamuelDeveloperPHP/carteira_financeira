import { Injectable } from "@nestjs/common";
import { Database } from "../database/database.service";
import { digest } from "../security/crypto";

@Injectable()
export class RateLimitRepository {
  constructor(private readonly db: Database) {}
  // Fixed window per key; returns how many hits the current window has seen.
  async hit(key: string, seconds: number): Promise<number> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [digest(key), seconds]
    );
    return rows[0].count;
  }
}
