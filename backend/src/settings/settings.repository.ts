import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";

export interface SettingsRow {
  biometric_enabled: boolean;
  geolocation_enabled: boolean;
  face_enabled: boolean;
}

const DEFAULTS: SettingsRow = {
  biometric_enabled: false,
  geolocation_enabled: true,
  face_enabled: false,
};

/** SQL das preferências de segurança e do modelo facial cifrado. */
@Injectable()
export class SettingsRepository {
  constructor(private readonly db: Database) {}

  /** Sem linha gravada, valem os padrões (a linha nasce na primeira alteração). */
  async get(userId: string, q: Queryable = this.db.pool): Promise<SettingsRow> {
    const row = (
      await q.query(
        "SELECT biometric_enabled,geolocation_enabled,face_enabled FROM user_settings WHERE user_id=$1",
        [userId]
      )
    ).rows[0];
    return row ?? DEFAULTS;
  }

  /** UPSERT parcial: só os campos informados mudam. */
  async update(
    q: Queryable,
    userId: string,
    changes: Partial<{ biometric: boolean; geolocation: boolean; face: boolean }>
  ) {
    await q.query(
      `INSERT INTO user_settings(user_id,biometric_enabled,geolocation_enabled,face_enabled)
       VALUES($1,coalesce($2,false),coalesce($3,true),coalesce($4,false))
       ON CONFLICT(user_id) DO UPDATE SET
         biometric_enabled=coalesce($2,user_settings.biometric_enabled),
         geolocation_enabled=coalesce($3,user_settings.geolocation_enabled),
         face_enabled=coalesce($4,user_settings.face_enabled),
         updated_at=now()`,
      [userId, changes.biometric ?? null, changes.geolocation ?? null, changes.face ?? null]
    );
  }

  async saveTemplate(q: Queryable, userId: string, encrypted: string) {
    await q.query(
      `INSERT INTO face_templates(user_id,template) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET template=$2,enrolled_at=now()`,
      [userId, encrypted]
    );
  }

  async template(userId: string, q: Queryable = this.db.pool): Promise<string | undefined> {
    return (
      await q.query("SELECT template FROM face_templates WHERE user_id=$1", [userId])
    ).rows[0]?.template;
  }

  async deleteTemplate(q: Queryable, userId: string) {
    await q.query("DELETE FROM face_templates WHERE user_id=$1", [userId]);
  }
}
